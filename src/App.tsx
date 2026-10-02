import React, { useState, useEffect, useCallback } from 'react';
import { 
  ChatSession, 
  Message, 
  ModelInfo, 
  InferenceConfig, 
  TelemetryState, 
  GgufMetadata,
  SdBackendStatus,
} from './types';
import { PRESET_MODELS, EMBEDDED_MODEL, BUILTIN_MODELS, isElectron, localInferenceService } from './services/localEngine';
import {
  imageGenerationService,
  DEFAULT_IMAGE_CONFIG,
  fetchSdBackendStatus,
  isImageModePrompt,
  isVisionIntentPrompt,
  extractImagePrompt,
  fileToResizedDataUrl,
  fileToDataUrl,
  hasTransparency,
  compositeObjectOnBackground,
  toBackgroundPrompt,
  removeWhiteBackground,
  type CompositePosition,
} from './services/imageEngine';
import { visionAnalysisService } from './services/vlmEngine';
import { DEFAULT_VLM_MODEL_ID, type VlmMode, type VlmModelId } from './data/vlmModels';
import { IMAGE_MODEL_NAME, IMAGE_USER_HINTS } from './data/imagePrompt';
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL_ID, getImageModel, type ImageModelId } from './data/imageModels';
import { ImageModelPicker } from './components/ImageModelPicker';
import { PERSONA_PRESETS, DEFAULT_PERSONA } from './data/personas';
import { parseGgufHeader } from './utils/ggufParser';
import { soundEffects } from './utils/audioSynth';

import { AuraBackground } from './components/AuraBackground';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { ChatArea } from './components/ChatArea';
import { ModelSelectorModal } from './components/ModelSelectorModal';
import { GgufInspectorModal } from './components/GgufInspectorModal';
import { SettingsDrawer } from './components/SettingsDrawer';

const DEFAULT_CONFIG: InferenceConfig = {
  temperature: 0.5,
  topP: 0.9,
  maxTokens: 2048,
  repetitionPenalty: 1.1,
  contextWindow: 4096,
  systemPromptPreset: DEFAULT_PERSONA.prompt,
  systemPromptCustom: '',
  enableAudioFeedback: true,
  streamThinking: true,
  soundVolume: 0.2,
  imageGen: { ...DEFAULT_IMAGE_CONFIG },
};

export default function App() {
  // Chat Sessions State
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem('nexus_sessions');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      {
        id: 'session_init',
        title: 'Первый диалог',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      },
    ];
  });

  // При запуске ВСЕГДА открываем новый пустой диалог (главный экран).
  // История прошлых сессий остаётся в сайдбаре.
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return sessions[0]?.id || 'session_init';
  });

  useEffect(() => {
    const cur = sessions.find(s => s.id === activeSessionId);
    if (cur && cur.messages.length > 0) {
      const fresh = {
        id: 'session_' + Date.now(),
        title: 'Новый диалог',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [] as never[],
      };
      setSessions(prev => [fresh as any, ...prev]);
      setActiveSessionId(fresh.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Models State: под Electron — встроенная модель (0.8B Лёгкая).
  const [activeModel, setActiveModel] = useState<ModelInfo>(
    () => (typeof window !== 'undefined' && isElectron() ? EMBEDDED_MODEL : PRESET_MODELS[0])
  );
  const [customGgufs, setCustomGgufs] = useState<ModelInfo[]>(() => {
    try {
      const saved = localStorage.getItem('nexus_custom_ggufs');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Под Electron гарантируем, что обе встроенные модели в списке
        if (isElectron()) {
          const builtinIds = new Set(BUILTIN_MODELS.map((m) => m.id));
          const known = [...BUILTIN_MODELS, ...parsed.filter((m: ModelInfo) => !builtinIds.has(m.id))];
          return known;
        }
        return parsed;
      }
      return isElectron() ? [...BUILTIN_MODELS] : [];
    } catch {
      return isElectron() ? [...BUILTIN_MODELS] : [];
    }
  });

  // Config & Hardware State
  const [config, setConfig] = useState<InferenceConfig>(() => {
    try {
      const saved = localStorage.getItem('nexus_config');
      if (saved) {
        const parsed = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
        const personaOk = PERSONA_PRESETS.some(p => p.prompt === parsed.systemPromptPreset);
        if (!personaOk) parsed.systemPromptPreset = DEFAULT_PERSONA.prompt;
        if (parsed.maxTokens < 512) parsed.maxTokens = DEFAULT_CONFIG.maxTokens;
        if (!parsed.imageGen) parsed.imageGen = { ...DEFAULT_IMAGE_CONFIG };
        else parsed.imageGen = { ...DEFAULT_IMAGE_CONFIG, ...parsed.imageGen };
        return parsed;
      }
    } catch {}
    return DEFAULT_CONFIG;
  });

  const [webGpuState, setWebGpuState] = useState<{ supported: boolean; adapterName?: string }>({
    supported: false,
  });

  const [sdBackend, setSdBackend] = useState<SdBackendStatus | null>(null);

  useEffect(() => {
    if (!isElectron()) return;
    fetchSdBackendStatus().then(setSdBackend).catch(() => {});
  }, []);

  // Telemetry State
  const [telemetry, setTelemetry] = useState<TelemetryState>({
    currentTps: 0,
    activeTtft: 0,
    totalTokens: 0,
    contextUsed: 0,
    maxContext: config.contextWindow,
    vramUsedMb: activeModel.vramRequirementMb,
    status: 'idle',
    loadProgress: 0,
    loadText: '',
  });

  // UI State
  const [inputPrompt, setInputPrompt] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGgufInspectorOpen, setIsGgufInspectorOpen] = useState(false);
  const [selectedGgufMeta, setSelectedGgufMeta] = useState<GgufMetadata | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);

  // Active Session & Persona
  const currentSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const activePersona = PERSONA_PRESETS.find(p => p.prompt === config.systemPromptPreset) || PERSONA_PRESETS[0];

  // Check WebGPU support on mount
  useEffect(() => {
    localInferenceService.checkWebGpuSupport().then(res => {
      setWebGpuState(res);
    });
  }, []);

  // При старте модель НЕ грузится (лёгкий запуск). Она поднимется лениво
  // при первом вопросе — llama загрузится внутри llm:chat в main.cjs.
  useEffect(() => {
    if (!isElectron() || !window.nexus) return;

    const off = window.nexus.onStatus((s: any) => {
      if (s && typeof s.progress === 'number') {
        setTelemetry(prev => ({ ...prev, loadProgress: s.progress, loadText: s.text || '' }));
      }
    });

    return () => {
      if (off) off();
    };
  }, []);

  // Save sessions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('nexus_sessions', JSON.stringify(sessions));
    } catch {}
  }, [sessions]);

  // Save custom GGUFs to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('nexus_custom_ggufs', JSON.stringify(customGgufs));
    } catch {}
  }, [customGgufs]);

  // Save config to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('nexus_config', JSON.stringify(config));
    } catch {}
  }, [config]);

  // Смена persona → сброс KV-сессии в main (как nativeSetSystemPrompt на Android)
  useEffect(() => {
    if (!isElectron() || !window.nexus) return;
    window.nexus.reset(activeSessionId, activeModel.backendId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.systemPromptPreset, config.systemPromptCustom]);

  // Handle Model Loading
  const handleSelectModel = useCallback(async (model: ModelInfo) => {
    setIsLoadingModel(true);
    setTelemetry(prev => ({
      ...prev,
      status: 'loading_model',
      vramUsedMb: model.vramRequirementMb,
      loadProgress: 5,
      loadText: `Подготовка ${model.name}...`,
    }));

    await localInferenceService.loadModel(model, (progress, text) => {
      setTelemetry(prev => ({
        ...prev,
        loadProgress: progress,
        loadText: text,
      }));
    });

    if (isElectron() && window.nexus) {
      window.nexus.reset(activeSessionId, model.backendId || model.id).catch(() => {});
    }

    setActiveModel(model);
    setIsLoadingModel(false);
    setTelemetry(prev => ({
      ...prev,
      status: 'idle',
      loadProgress: 100,
      loadText: 'Модель готова',
    }));

    if (config.enableAudioFeedback) {
      soundEffects.modelLoaded(config.soundVolume);
    }
  }, [config, activeSessionId]);

  // Прикреплённые текстовые/код файлы — добавляются к следующему сообщению модели
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string }[]>([]);
  const [attachedImage, setAttachedImage] = useState<{ name: string; file: File } | null>(null);
  const [scenePosition, setScenePosition] = useState<CompositePosition>('center');
  const [imageMode, setImageMode] = useState(false);
  const [imageModelId, setImageModelId] = useState<ImageModelId>(DEFAULT_IMAGE_MODEL_ID);
  const [vlmModelId, setVlmModelId] = useState<VlmModelId>(DEFAULT_VLM_MODEL_ID);
  const [isImageModelPickerOpen, setIsImageModelPickerOpen] = useState(false);

  // Обновляем VRAM в телеметрии и переключаем персону при смене режима
  useEffect(() => {
    setTelemetry(prev => ({
      ...prev,
      vramUsedMb: imageMode ? 6600 : activeModel.vramRequirementMb,
    }));
    // Автопереключение персоны: Творец ↔ Помощник
    const imagePersona = PERSONA_PRESETS.find(p => p.id === 'image_creator');
    const defaultPersona = PERSONA_PRESETS[0];
    if (imagePersona) {
      setConfig(prev => ({
        ...prev,
        systemPromptPreset: imageMode ? imagePersona.prompt : defaultPersona.prompt,
      }));
    }
  }, [imageMode, activeModel.vramRequirementMb]);

  // Предзагрузка sd-server при входе в image-режим (фоновый старт, горячий к моменту запроса).
  // Стартует один раз при переключении в true; повторные входы не перезапускают (main отсекает by isServerAlive).
  useEffect(() => {
    if (!imageMode || !isElectron() || !window.nexus?.sdPreload) return;
    window.nexus.sdPreload().catch(() => {});
  }, [imageMode]);

  // Handle file drop & parse: .gguf/.bin → инспектор моделей; остальное → вложение в чат
  const handleGgufFileDrop = useCallback(async (file: File) => {
    const lower = file.name.toLowerCase();

    if (lower.endsWith('.gguf') || lower.endsWith('.bin')) {
      try {
        const metadata = await parseGgufHeader(file);
        setSelectedGgufMeta(metadata);

        const customModel: ModelInfo = {
          id: `gguf_${Date.now()}`,
          name: file.name.replace(/\.gguf$/i, ''),
          size: `${metadata.fileSizeMb || 450} MB`,
          quant: metadata.quantization || 'Q4_K_M',
          family: metadata.architecture,
          format: 'gguf',
          contextLength: metadata.contextLength,
          cached: true,
          vramRequirementMb: Math.round((metadata.fileSizeMb || 450) * 1.25),
          description: `Пользовательская модель GGUF (${metadata.architecture}, ${metadata.tensorCount} тензоров)`,
          isCustomGguf: true,
          ggufMetadata: metadata,
        };

        setCustomGgufs(prev => [customModel, ...prev.filter(m => m.name !== customModel.name)]);
        setIsGgufInspectorOpen(true);
      } catch (err: any) {
        alert(`Ошибка чтения GGUF: ${err?.message || 'Неверный заголовок файла'}`);
      }
      return;
    }

    // Изображение: без режима 🖼 → Vision (img2txt); с 🖼 → img2img
    if (/\.(png|jpe?g|webp|bmp)$/i.test(lower)) {
      setAttachedImage({ name: file.name, file });
      if (config.enableAudioFeedback) soundEffects.click(config.soundVolume);
      return;
    }

    // Текстовый/код файл: читаем и прикрепляем к следующему сообщению.
    // Лимит ~6К символов ≈ 1.5К токенов — остаётся место для ответа и истории.
    try {
      const raw = await file.text();
      const MAX = 6000;
      const content = raw.length > MAX
        ? raw.slice(0, MAX) + '\n...[файл обрезан: превышен лимит контекста]'
        : raw;
      setAttachedFiles(prev => [...prev.filter(f => f.name !== file.name), { name: file.name, content }]);
      if (config.enableAudioFeedback) soundEffects.click(config.soundVolume);
    } catch (err: any) {
      alert(`Не удалось прочитать файл: ${err?.message || err}`);
    }
  }, [config]);

  // Global Drag & Drop: любые файлы (текстовые → вложение, gguf → инспектор)
  useEffect(() => {
    const handleWindowDrop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
        handleGgufFileDrop(e.dataTransfer.files[0]);
      }
    };

    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    window.addEventListener('drop', handleWindowDrop);
    window.addEventListener('dragover', handleWindowDragOver);

    return () => {
      window.removeEventListener('drop', handleWindowDrop);
      window.removeEventListener('dragover', handleWindowDragOver);
    };
  }, [handleGgufFileDrop]);

  // Create New Session
  const handleNewSession = () => {
    const newSession: ChatSession = {
      id: `session_${Date.now()}`,
      title: 'Новый диалог',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
  };
  // Delete Session
  const handleDeleteSession = (id: string) => {
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (filtered.length === 0) {
        const fallback: ChatSession = {
          id: `session_${Date.now()}`,
          title: 'Новый диалог',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        };
        setActiveSessionId(fallback.id);
        return [fallback];
      }
      if (activeSessionId === id) {
        setActiveSessionId(filtered[0].id);
      }
      return filtered;
    });
  };

  // Toggle Pin
  const handleTogglePin = (id: string) => {
    setSessions(prev =>
      prev.map(s => (s.id === id ? { ...s, pinned: !s.pinned } : s))
    );
  };

  // Clear current chat
  const handleClearCurrentChat = () => {
    if (isElectron() && window.nexus) window.nexus.reset(activeSessionId, activeModel.backendId).catch(() => {});
    setSessions(prev =>
      prev.map(s => (s.id === activeSessionId ? { ...s, messages: [] } : s))
    );
  };

  // Submit Prompt (текст / генерация / vision)
  const handleSubmitPrompt = async (promptOverride?: string) => {
    let prompt = (promptOverride !== undefined ? promptOverride : inputPrompt).trim();

    const hasAttach = !!attachedImage?.file;
    const slashImage = isImageModePrompt(prompt || '');
    const visionIntent = isVisionIntentPrompt(prompt || '');

    // Приоритет: прикреплённое фото + (не режим 🖼 ИЛИ явный запрос описания) → Vision
    // «дай текстового описания что на фото» НЕ должно уходить в Z-Image
    if (hasAttach && !slashImage && (!imageMode || visionIntent)) {
      await handleSubmitVision(prompt, prompt ? 'custom' : 'describe');
      return;
    }

    const useImage = imageMode || slashImage;
    if (useImage) {
      const imgPrompt = slashImage ? extractImagePrompt(prompt) : prompt;
      if (!imgPrompt) return;
      await handleSubmitImage(imgPrompt);
      return;
    }

    if (!prompt) return;

    // Вложения: содержимое файлов идёт перед текстом сообщения
    if (attachedFiles.length > 0) {
      const attText = attachedFiles
        .map(f => `[Файл: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n\n');
      prompt = `${attText}\n\n${prompt}`;
      setAttachedFiles([]);
    }

    setInputPrompt('');

    const userMessage: Message = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };

    const assistantMessageId = `msg_a_${Date.now()}`;
    const initialAssistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      modelUsed: activeModel.name,
    };

    // Update active session messages
    const updatedMessages = [...currentSession.messages, userMessage];

    // Auto-update session title if it's the first message
    const isFirstMessage = currentSession.messages.length === 0;
    const sessionTitle = isFirstMessage
      ? prompt.slice(0, 32) + (prompt.length > 32 ? '...' : '')
      : currentSession.title;

    setSessions(prev =>
      prev.map(s =>
        s.id === activeSessionId
          ? {
              ...s,
              title: sessionTitle,
              updatedAt: Date.now(),
              messages: [...updatedMessages, initialAssistantMessage],
            }
          : s
      )
    );

    setTelemetry(prev => ({
      ...prev,
      status: 'thinking',
      currentTps: 0,
      activeTtft: 0,
    }));

    await localInferenceService.generateStream(
      updatedMessages,
      activeModel,
      config,
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sessionId: activeSessionId as any,
        onToken: (_tok, fullContent, thinking) => {
          setSessions(prev =>
            prev.map(s =>
              s.id === activeSessionId
                ? {
                    ...s,
                    messages: s.messages.map(m =>
                      m.id === assistantMessageId
                        ? { ...m, content: fullContent, thinking: thinking || undefined }
                        : m
                    ),
                  }
                : s
            )
          );
        },
        onTelemetry: stats => {
          setTelemetry(prev => ({ ...prev, ...stats }));
        },
        onComplete: (fullContent, thinking, stats) => {
          setSessions(prev =>
            prev.map(s =>
              s.id === activeSessionId
                ? {
                    ...s,
                    messages: s.messages.map(m =>
                      m.id === assistantMessageId
                        ? {
                            ...m,
                            content: fullContent,
                            thinking: thinking || undefined,
                            speedTps: stats?.tps,
                            ttftMs: stats?.ttft,
                            tokensGenerated: stats?.tokens,
                          }
                        : m
                    ),
                  }
                : s
            )
          );
          setTelemetry(prev => ({
            ...prev,
            status: 'idle',
            currentTps: stats?.tps || prev.currentTps,
          }));
        },
        onError: err => {
          setTelemetry(prev => ({ ...prev, status: 'error' }));
          setSessions(prev =>
            prev.map(s =>
              s.id === activeSessionId
                ? {
                    ...s,
                    messages: s.messages.map(m =>
                      m.id === assistantMessageId
                        ? { ...m, content: `[Ошибка инференса: ${err}]` }
                        : m
                    ),
                  }
                : s
            )
          );
        },
      }
    );
  };

  const handleSubmitVision = async (prompt: string, mode: VlmMode = 'custom') => {
    const imgFile = attachedImage?.file;
    const imgName = attachedImage?.name || 'image';
    if (!imgFile) return;

    let previewDataUrl = '';
    try {
      previewDataUrl = await fileToDataUrl(imgFile);
    } catch {}

    setInputPrompt('');
    setAttachedImage(null);

    const modeLabel =
      mode === 'ocr' ? 'OCR' :
      mode === 'objects' ? 'Объекты' :
      mode === 'calories' ? 'Калории' :
      mode === 'describe' ? 'Описание' : 'Vision';

    const userMessage: Message = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content: prompt ? prompt : `[Режим: ${modeLabel}]`,
      timestamp: Date.now(),
      imageUrl: previewDataUrl || undefined,
    };

    const assistantMessageId = `msg_a_${Date.now()}`;
    const initialAssistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: 'Анализ изображения...',
      timestamp: Date.now(),
      modelUsed: vlmModelId,
    };

    const isFirstMessage = currentSession.messages.length === 0;
    const sessionTitle = isFirstMessage
      ? `${modeLabel}: ${imgName}`.slice(0, 40)
      : currentSession.title;

    setSessions(prev =>
      prev.map(s =>
        s.id === activeSessionId
          ? {
              ...s,
              title: sessionTitle,
              updatedAt: Date.now(),
              messages: [...s.messages, userMessage, initialAssistantMessage],
            }
          : s
      )
    );

    setTelemetry(prev => ({
      ...prev,
      status: 'thinking',
      loadProgress: 5,
      loadText: 'Vision: кодирование...',
    }));

    try {
      const result = await visionAnalysisService.analyze(imgFile, {
        mode,
        prompt: mode === 'custom' ? prompt : prompt,
        modelId: vlmModelId,
        onProgress: (progress, text) => {
          setTelemetry(prev => ({
            ...prev,
            status: 'thinking',
            loadProgress: progress,
            loadText: text,
          }));
        },
      });

      // Prefer ready model if selected missing — engine already picks fallback via status
      setSessions(prev =>
        prev.map(s =>
          s.id === activeSessionId
            ? {
                ...s,
                messages: s.messages.map(m =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        content: result.text,
                        modelUsed: result.modelName,
                        speedTps: 0,
                        ttftMs: result.elapsedMs,
                      }
                    : m
                ),
              }
            : s
        )
      );
      if (config.enableAudioFeedback) soundEffects.modelLoaded(config.soundVolume);
    } catch (err: any) {
      setSessions(prev =>
        prev.map(s =>
          s.id === activeSessionId
            ? {
                ...s,
                messages: s.messages.map(m =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        content:
                          `[Ошибка Vision: ${err?.message || err}]\n` +
                          `Скачай: npm run download:moondream`,
                      }
                    : m
                ),
              }
            : s
        )
      );
      setTelemetry(prev => ({ ...prev, status: 'error' }));
    } finally {
      setTelemetry(prev => ({
        ...prev,
        status: 'idle',
        loadProgress: 100,
        loadText: '',
        vramUsedMb: activeModel.vramRequirementMb,
      }));
    }
  };

  const handleSubmitImage = async (prompt: string) => {
    setInputPrompt('');

    let previewDataUrl = '';
    if (attachedImage?.file) {
      try {
        previewDataUrl = await fileToDataUrl(attachedImage.file);
      } catch {}
    }

    const userMessage: Message = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      imageUrl: previewDataUrl || undefined,
    };

    const assistantMessageId = `msg_a_${Date.now()}`;
    const activeImgModel = getImageModel(imageModelId);
    const initialAssistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: 'Генерация (~20-90 сек.)',
      timestamp: Date.now(),
      modelUsed: activeImgModel.label,
    };

    const isFirstMessage = currentSession.messages.length === 0;
    const sessionTitle = isFirstMessage
      ? prompt.slice(0, 32) + (prompt.length > 32 ? '...' : '')
      : currentSession.title;

    setSessions(prev =>
      prev.map(s =>
        s.id === activeSessionId
          ? {
              ...s,
              title: sessionTitle,
              updatedAt: Date.now(),
              messages: [...s.messages, userMessage, initialAssistantMessage],
            }
          : s
      )
    );

    setTelemetry(prev => ({
      ...prev,
      status: 'generating_image',
      loadProgress: 0,
      loadText: 'Генерация (~20-90 сек.)',
      vramUsedMb: 6600,
    }));

    let initImage;
    const imgFile = attachedImage?.file;
    setAttachedImage(null);
    const imageGenSteps = { step: 0, total: config.imageGen.steps };
    const imgStartMs = Date.now();

    try {
      // Источник объекта для compositing. Если PNG изначально прозрачный — берём как есть.
      // Если непрозрачный, но на однотонном (белом) фоне — пытаемся удалить фон через
      // flood-fill от краёв; при успехе тоже идём в compositing.
      let objDataUrl: string | null = null;
      const transparent = imgFile ? await hasTransparency(imgFile) : false;
      if (imgFile && !transparent) {
        const removed = await removeWhiteBackground(imgFile);
        if (removed && removed.ratio > 0.2) {
          objDataUrl = removed.dataUrl;
        }
      }

      const useComposite = !!(imgFile && (transparent || objDataUrl));

      const bgPrompt = useComposite ? toBackgroundPrompt(prompt, scenePosition) : null;
      const bgGen = useComposite
        ? { ...config.imageGen, imageModelId }
        : null;

      // Режим доработки: последнее сгенерированное в этом чате изображение
      // (если пользователь не приложил своё). main.cjs сам решит — EDIT (img2img) или NEW.
      let previousImage: string | undefined;
      let previousPromptEn: string | undefined;
      if (!imgFile) {
        const lastImgMsg = [...currentSession.messages]
          .reverse()
          .find(m => m.role === 'assistant' && m.imageUrl && m.imageMeta?.promptEn);
        if (lastImgMsg) {
          previousImage = lastImgMsg.imageUrl;
          previousPromptEn = lastImgMsg.imageMeta?.promptEn;
        }
      }

      let result;
      if (useComposite && bgPrompt && bgGen) {
        // --- Compositing: фон по запросу + продукт пиксельно поверх ---
        // Продукт НЕ проходит через диффузию → этикетка/цвета сохраняются 100%.
        // objDataUrl приходит из removeWhiteBackground (если фон был удалён) либо
        // создаётся из оригинального прозрачного PNG.
        const objSrc = objDataUrl ?? (await fileToDataUrl(imgFile!));
        const bg = await imageGenerationService.generate(bgPrompt, bgGen, {
          onProgress: (progress, text, meta) => {
            if (meta?.steps) imageGenSteps.total = meta.steps;
            if (meta?.step) imageGenSteps.step = meta.step;
            const elapsedSec = (Date.now() - imgStartMs) / 1000;
            const stepsPerSec = imageGenSteps.step > 0
              ? Math.round((imageGenSteps.step / elapsedSec) * 10) / 10
              : 0;
            setTelemetry(prev => ({ ...prev, status: 'generating_image', loadProgress: progress, loadText: text, currentTps: stepsPerSec, activeTtft: Math.round(elapsedSec * 1000) }));
          },
        });
        // Накладываем продукт в выбранную пользователем позицию. Второй проход
        // (img2img) НЕ делаем — он перерисовывал продукт, а по требованию
        // прикреплённое фото должно оставаться неизменным.
        const composed = await compositeObjectOnBackground(bg.dataUrl, objSrc, { position: scenePosition });
        result = { ...bg, dataUrl: composed };
      } else {
        // --- Обычный img2img / txt2img ---
        // Прикреплённое фото (непрозрачное) → img2img через dataUrl (ресайз до 1024).
        let initImage;
        if (imgFile) {
          const resized = await fileToResizedDataUrl(imgFile, 1024);
          if (resized) initImage = resized;
        }
        // Для прикреплённого фото снижаем strength: при 0.65 модель почти полностью
        // перерисовывает объект, а нужно вписать его в сцену..
        const genConfig = { ...config.imageGen, imageModelId };
        if (imgFile && (genConfig.strength === undefined || genConfig.strength === DEFAULT_IMAGE_CONFIG.strength)) {
          genConfig.strength = 0.5;
        }

        result = await imageGenerationService.generate(prompt, genConfig, {
          initImage,
          previousImage,
          previousPromptEn,
          onProgress: (progress, text, meta) => {
            if (meta?.steps) imageGenSteps.total = meta.steps;
            if (meta?.step) imageGenSteps.step = meta.step;
            const elapsedSec = (Date.now() - imgStartMs) / 1000;
            const stepsPerSec = imageGenSteps.step > 0
              ? Math.round((imageGenSteps.step / elapsedSec) * 10) / 10
              : 0;
            setTelemetry(prev => ({
              ...prev,
              status: 'generating_image',
              loadProgress: progress,
              loadText: text,
              currentTps: stepsPerSec,
              activeTtft: Math.round(elapsedSec * 1000),
            }));
          },
          onPreview: (dataUrl, step) => {
            const total = imageGenSteps.total || config.imageGen.steps;
            const minStep = Math.max(3, Math.ceil(total * 0.55));
            if (step < minStep) return;
            setSessions(prev =>
              prev.map(s =>
                s.id === activeSessionId
                  ? {
                      ...s,
                      messages: s.messages.map(m =>
                        m.id === assistantMessageId ? { ...m, previewUrl: dataUrl } : m
                      ),
                    }
                  : s
              )
            );
          },
        });
      }

      setSessions(prev =>
        prev.map(s =>
          s.id === activeSessionId
            ? {
                ...s,
                messages: s.messages.map(m =>
                  m.id === assistantMessageId
                    ? {
                        ...m,
                        content: result.edited
                          ? `Изображение (доработка): «${prompt}»`
                          : `Изображение: «${prompt}»`,
                        imageUrl: result.dataUrl,
                        previewUrl: undefined,
                        modelUsed: result.modelName || IMAGE_MODEL_NAME,
                        imageMeta: {
                          width: result.width,
                          height: result.height,
                          steps: result.steps,
                          cfg: result.cfg,
                          seed: result.seed,
                          elapsedMs: result.elapsedMs,
                          prompt: result.prompt,
                          promptEn: result.promptEn,
                        },
                      }
                    : m
                ),
              }
            : s
        )
      );

      if (config.enableAudioFeedback) soundEffects.modelLoaded(config.soundVolume);
      fetchSdBackendStatus().then(setSdBackend).catch(() => {});
    } catch (err: any) {
      setSessions(prev =>
        prev.map(s =>
          s.id === activeSessionId
            ? {
                ...s,
                messages: s.messages.map(m =>
                  m.id === assistantMessageId
                    ? { ...m, content: `[Ошибка генерации: ${err?.message || err}]` }
                    : m
                ),
              }
            : s
        )
      );
      setTelemetry(prev => ({ ...prev, status: 'error' }));
    } finally {
      setTelemetry(prev => ({
        ...prev,
        status: 'idle',
        loadProgress: 100,
        loadText: '',
        vramUsedMb: activeModel.vramRequirementMb,
        currentTps: 0,
        activeTtft: 0,
      }));
    }
  };

  // Stop Generation
  const handleStop = () => {
    localInferenceService.abort();
    imageGenerationService.abort();
    visionAnalysisService.abort();
    setTelemetry(prev => ({ ...prev, status: 'idle' }));
  };

  // Export all chats
  const handleExportAllChats = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(sessions, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `nexus_offline_chats_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Import chats
  const handleImportChats = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = event => {
        try {
          const parsed = JSON.parse(event.target?.result as string);
          if (Array.isArray(parsed)) {
            setSessions(parsed);
            if (parsed[0]?.id) setActiveSessionId(parsed[0].id);
          }
        } catch {
          alert('Ошибка парсинга JSON файла истории');
        }
      };
      reader.readAsText(e.target.files[0]);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#07080c] text-[#e2e8f0] relative overflow-hidden font-sans select-none">
      {/* Dynamic Futuristic Mesh Aura Background */}
      <AuraBackground status={telemetry.status} />

      {/* Electron-Ready Window TitleBar */}
      <TitleBar
        activeModel={activeModel}
        onOpenModelSelector={() => setIsModelSelectorOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        soundEnabled={config.enableAudioFeedback}
        onToggleSound={() => setConfig(c => ({ ...c, enableAudioFeedback: !c.enableAudioFeedback }))}
        engineStatus={telemetry.status}
        webGpuSupported={webGpuState.supported}
      />

      {/* Live Telemetry & Speed HUD (removed: status moved to input bar) */}
      <div id="telemetry-hud" className="hidden" aria-hidden />

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* Collapsible Sidebar */}
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          onTogglePin={handleTogglePin}
          onGgufFileDrop={handleGgufFileDrop}
          activeModel={activeModel}
          onExportAllChats={handleExportAllChats}
          onImportChats={handleImportChats}
          soundEnabled={config.enableAudioFeedback}
          imageMode={imageMode}
          imageModelId={imageModelId}
          onOpenModelSelector={() => setIsModelSelectorOpen(true)}
        />

        {/* Chat Stream & Floating Dock */}
        <ChatArea
          messages={currentSession.messages}
          inputPrompt={inputPrompt}
          setInputPrompt={setInputPrompt}
          onSubmit={handleSubmitPrompt}
          onStop={handleStop}
          engineStatus={telemetry.status}
          activeModel={activeModel}
          activePersona={activePersona}
          onOpenModelSelector={() => setIsModelSelectorOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onClearCurrentChat={handleClearCurrentChat}
          onGgufFileDrop={handleGgufFileDrop}
          soundEnabled={config.enableAudioFeedback}
          attachedFiles={attachedFiles}
          onRemoveAttachment={name => setAttachedFiles(prev => prev.filter(f => f.name !== name))}
          imageMode={imageMode}
          onToggleImageMode={() => setImageMode(prev => !prev)}
          imageModelId={imageModelId}
          onOpenImageModelPicker={() => setIsImageModelPickerOpen(true)}
          attachedImage={attachedImage}
          onRemoveAttachedImage={() => setAttachedImage(null)}
          onVlmChip={(mode) => {
            if (!attachedImage?.file) return;
            if (config.enableAudioFeedback) soundEffects.click(config.soundVolume);
            handleSubmitVision(inputPrompt.trim(), mode);
          }}
          scenePosition={scenePosition}
          onSetScenePosition={(p) => setScenePosition(p)}
          vlmModelId={vlmModelId}
        />
      </div>

      {/* Modals & Drawers */}
      <ModelSelectorModal
        isOpen={isModelSelectorOpen}
        onClose={() => setIsModelSelectorOpen(false)}
        activeModel={activeModel}
        onSelectModel={m => {
          handleSelectModel(m);
          setImageMode(false);
          setIsModelSelectorOpen(false);
        }}
        onGgufFileDrop={handleGgufFileDrop}
        customGgufs={customGgufs}
        onOpenGgufInspector={meta => {
          setSelectedGgufMeta(meta);
          setIsGgufInspectorOpen(true);
        }}
        loadProgress={telemetry.loadProgress}
        loadText={telemetry.loadText}
        isLoading={isLoadingModel}
        soundEnabled={config.enableAudioFeedback}
        imageMode={imageMode}
        onSelectImageMode={() => {
          setImageMode(true);
          setIsModelSelectorOpen(false);
        }}
      />

      <ImageModelPicker
        isOpen={isImageModelPickerOpen}
        current={imageModelId}
        onSelect={id => { setImageModelId(id); setImageMode(true); }}
        onClose={() => setIsImageModelPickerOpen(false)}
      />

      <GgufInspectorModal        isOpen={isGgufInspectorOpen}
        onClose={() => setIsGgufInspectorOpen(false)}
        metadata={selectedGgufMeta}
        onActivateModel={() => {
          if (selectedGgufMeta) {
            const matched = customGgufs.find(g => g.ggufMetadata === selectedGgufMeta);
            if (matched) handleSelectModel(matched);
          }
        }}
      />

      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        onChangeConfig={setConfig}
        webGpuSupported={webGpuState.supported}
        webGpuAdapterName={webGpuState.adapterName}
        sdBackend={sdBackend}
        soundEnabled={config.enableAudioFeedback}
      />
    </div>
  );
}
