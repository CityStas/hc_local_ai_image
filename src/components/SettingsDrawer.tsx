import React from 'react';
import { 
  X, 
  Sliders, 
  Cpu, 
  Sparkles, 
  Volume2, 
  Brain, 
  RotateCcw, 
  Check, 
  ShieldCheck,
  ImageIcon
} from 'lucide-react';
import { InferenceConfig, PersonaPreset, SdBackendStatus } from '../types';
import { MAX_OUTPUT_TOKENS, DEFAULT_PERSONA, PERSONA_PRESETS } from '../data/personas';
import { DEFAULT_IMAGE_CONFIG } from '../services/imageEngine';
import { IMAGE_MODEL_NAME, IMAGE_MODEL_TAGLINE, IMAGE_USER_HINTS, IMAGE_NEGATIVE_DEFAULT } from '../data/imagePrompt';
import { soundEffects } from '../utils/audioSynth';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  config: InferenceConfig;
  onChangeConfig: (newConfig: InferenceConfig) => void;
  webGpuSupported: boolean;
  webGpuAdapterName?: string;
  sdBackend?: SdBackendStatus | null;
  soundEnabled: boolean;
}

export function SettingsDrawer({
  isOpen,
  onClose,
  config,
  onChangeConfig,
  webGpuSupported,
  webGpuAdapterName,
  sdBackend,
  soundEnabled,
}: SettingsDrawerProps) {
  if (!isOpen) return null;

  const sdDeviceLabel = sdBackend?.deviceLabel || 'CPU';
  const sdOnGpu = sdBackend?.deviceType === 'cuda' || sdBackend?.deviceType === 'vulkan';
  const sdHint = sdOnGpu
    ? 'GPU: 1024×1024 · 8 шагов · CFG 1'
    : 'CPU: 768×768 · 8 шагов · CFG 1. Модель: 3 файла (~8 GB).';
  const sdMissing = sdBackend?.missingFiles?.length
    ? ` Не хватает: ${sdBackend.missingFiles.join(', ')} → npm run download:zimage`
    : '';

  const handlePersonaSelect = (preset: PersonaPreset) => {
    if (soundEnabled) soundEffects.click();
    onChangeConfig({
      ...config,
      systemPromptPreset: preset.prompt,
    });
  };

  const handleReset = () => {
    if (soundEnabled) soundEffects.click();
    onChangeConfig({
      temperature: 0.7,
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
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#090b10] border-l border-white/[0.08] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white font-['Syne']">Настройки</h2>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={handleReset}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/[0.04] transition-colors cursor-pointer"
              title="Сброс по умолчанию"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.04] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Persona Presets */}
          <div className="space-y-2.5">
            <label className="text-xs font-bold text-slate-300 font-mono flex items-center gap-1.5 uppercase">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>Персона</span>
            </label>

            <div className="grid grid-cols-2 gap-2">
              {PERSONA_PRESETS.map(preset => {
                const isActive = config.systemPromptPreset === preset.prompt;
                return (
                  <div
                    key={preset.id}
                    onClick={() => handlePersonaSelect(preset)}
                    className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                      isActive
                        ? 'bg-cyan-500/10 border-cyan-400 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                        : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05] text-slate-400'
                    }`}
                  >
                    <div className="text-xs font-bold font-['Syne'] flex items-center justify-between">
                      <span>{preset.title}</span>
                      {isActive && <Check className="w-3 h-3 text-cyan-400" />}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 line-clamp-1 font-sans">
                      {preset.tagline}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Custom System Directive */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 font-mono flex items-center justify-between uppercase">
              <span>Кастомная системная инструкция</span>
              <span className="text-[10px] text-slate-500 font-normal">Опционально</span>
            </label>
            <textarea
              rows={3}
              value={config.systemPromptCustom}
              onChange={e => onChangeConfig({ ...config, systemPromptCustom: e.target.value })}
              placeholder="Введите собственные правила поведения для ИИ-агента..."
              className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-cyan-500/40 rounded-xl p-2.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none resize-none font-mono"
            />
          </div>

          {/* Sampling Sliders */}
          <div className="space-y-4 pt-2 border-t border-white/[0.06]">
            {/* Temperature */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300">Температура (Temperature)</span>
                <span className="text-cyan-400 font-bold">{config.temperature}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.5"
                step="0.05"
                value={config.temperature}
                onChange={e => onChangeConfig({ ...config, temperature: parseFloat(e.target.value) })}
                className="w-full accent-cyan-400 bg-white/[0.08] h-1.5 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-600 font-mono">
                <span>0.1 (Строго/Код)</span>
                <span>1.5 (Креативно)</span>
              </div>
            </div>

            {/* Top-P */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300">Top-P Сэмплинг</span>
                <span className="text-cyan-400 font-bold">{config.topP}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={config.topP}
                onChange={e => onChangeConfig({ ...config, topP: parseFloat(e.target.value) })}
                className="w-full accent-cyan-400 bg-white/[0.08] h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            {/* Context Window */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300">Окно контекста (Context Window)</span>
                <span className="text-cyan-400 font-bold">{config.contextWindow} tok</span>
              </div>
              <input
                type="range"
                min="512"
                max="8192"
                step="512"
                value={config.contextWindow}
                onChange={e => onChangeConfig({ ...config, contextWindow: parseInt(e.target.value) })}
                className="w-full accent-cyan-400 bg-white/[0.08] h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            {/* Max Output Tokens */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300">Макс. токенов ответа</span>
                <span className="text-cyan-400 font-bold">{config.maxTokens} tok</span>
              </div>
              <input
                type="range"
                min="256"
                max={MAX_OUTPUT_TOKENS}
                step="128"
                value={config.maxTokens}
                onChange={e => onChangeConfig({ ...config, maxTokens: parseInt(e.target.value) })}
                className="w-full accent-cyan-400 bg-white/[0.08] h-1.5 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          {/* HC AI — Image */}
          <div className="space-y-4 pt-2 border-t border-white/[0.06]">
            <label className="text-xs font-bold text-slate-300 font-mono flex items-center gap-1.5 uppercase">
              <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
              <span>{IMAGE_MODEL_NAME}</span>
              <span className={`ml-auto text-[10px] font-normal normal-case px-1.5 py-0.5 rounded border ${
                sdOnGpu
                  ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
                  : 'text-slate-400 border-white/10 bg-white/[0.03]'
              }`}>
                {sdOnGpu ? `GPU: ${sdDeviceLabel}` : `CPU · prebuilt`}
              </span>
            </label>
            <p className="text-[10px] text-slate-500 font-sans leading-relaxed">
              {IMAGE_MODEL_TAGLINE}. Z-Image-Turbo (leejet/sdcpp). {sdHint}{sdMissing}
            </p>
            <ul className="text-[10px] text-slate-500 space-y-1 list-disc pl-4">
              {IMAGE_USER_HINTS.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-300 font-mono">Улучшение промпта</div>
                <div className="text-[10px] text-slate-500">RU→EN + описательный промпт для Z-Image</div>
              </div>
              <button
                onClick={() => onChangeConfig({ ...config, imageGen: { ...config.imageGen, enhancePrompt: !config.imageGen.enhancePrompt } })}
                className={`w-10 h-6 rounded-full transition-colors p-1 flex items-center cursor-pointer ${
                  config.imageGen.enhancePrompt !== false ? 'bg-purple-500 justify-end' : 'bg-white/[0.1] justify-start'
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-300 font-mono">Выгружать LLM перед картинкой</div>
                <div className="text-[10px] text-slate-500">
                  {config.imageGen.unloadLlmBeforeImage === false
                    ? 'VRAM общая — риск OOM на 4–6 ГБ'
                    : config.imageGen.unloadLlmBeforeImage === true
                      ? 'Всегда освобождать VRAM перед SD'
                      : 'Авто: если SD и LLM на одной GPU'}
                </div>
              </div>
              <button
                onClick={() => {
                  const cur = config.imageGen.unloadLlmBeforeImage ?? 'auto';
                  const next = cur === 'auto' ? true : cur === true ? false : 'auto';
                  onChangeConfig({
                    ...config,
                    imageGen: { ...config.imageGen, unloadLlmBeforeImage: next },
                  });
                }}
                className={`w-10 h-6 rounded-full transition-colors p-1 flex items-center cursor-pointer ${
                  config.imageGen.unloadLlmBeforeImage !== false ? 'bg-purple-500 justify-end' : 'bg-white/[0.1] justify-start'
                }`}
                title="auto → всегда → никогда"
              >
                <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[768, 1024].map(size => (
                <button
                  key={size}
                  onClick={() =>
                    onChangeConfig({
                      ...config,
                      imageGen: { ...config.imageGen, width: size, height: size },
                    })
                  }
                  className={`px-2 py-1.5 rounded-lg border text-xs font-mono cursor-pointer transition-all ${
                    config.imageGen.width === size
                      ? 'bg-purple-500/15 border-purple-400/40 text-purple-200'
                      : 'bg-white/[0.02] border-white/[0.06] text-slate-400 hover:bg-white/[0.05]'
                  }`}
                >
                  {size}×{size}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300">Шаги (steps)</span>
                <span className="text-purple-300 font-bold">{config.imageGen.steps}</span>
              </div>
              <input
                type="range"
                min="4"
                max="15"
                step="1"
                value={config.imageGen.steps}
                onChange={e =>
                  onChangeConfig({
                    ...config,
                    imageGen: { ...config.imageGen, steps: parseInt(e.target.value) },
                  })
                }
                className="w-full accent-purple-400 bg-white/[0.08] h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300">CFG Scale</span>
                <span className="text-purple-300 font-bold">{config.imageGen.cfg}</span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.5"
                value={config.imageGen.cfg}
                onChange={e =>
                  onChangeConfig({
                    ...config,
                    imageGen: { ...config.imageGen, cfg: parseFloat(e.target.value) },
                  })
                }
                className="w-full accent-purple-400 bg-white/[0.08] h-1.5 rounded-lg cursor-pointer"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono text-slate-300">Seed (−1 = случайный)</label>
              <input
                type="number"
                value={config.imageGen.seed}
                onChange={e =>
                  onChangeConfig({
                    ...config,
                    imageGen: { ...config.imageGen, seed: parseInt(e.target.value) || -1 },
                  })
                }
                className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-purple-500/40 rounded-xl p-2 text-xs text-slate-200 font-mono focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono text-slate-300">Negative prompt</label>
              <textarea
                rows={2}
                value={config.imageGen.negativePrompt}
                onChange={e =>
                  onChangeConfig({
                    ...config,
                    imageGen: { ...config.imageGen, negativePrompt: e.target.value },
                  })
                }
                className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-purple-500/40 rounded-xl p-2 text-xs text-slate-200 font-mono focus:outline-none resize-none"
              />
            </div>

            <p className="text-[10px] text-slate-500 font-sans">
              Команды: <code className="text-purple-300">/image</code>, <code className="text-purple-300">/нарисуй</code> — или 🖼. Превью по шагам.
            </p>
          </div>

          {/* Toggles */}
          <div className="space-y-3 pt-2 border-t border-white/[0.06]">
            {/* Stream Thinking */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-300 font-mono flex items-center gap-1.5">
                  <Brain className="w-3.5 h-3.5 text-purple-400" />
                  <span>Трансляция цепочки рассуждений</span>
                </div>
                <div className="text-[10px] text-slate-500 font-sans">
                  Отображение блока &lt;think&gt; в реальном времени
                </div>
              </div>
              <button
                onClick={() => onChangeConfig({ ...config, streamThinking: !config.streamThinking })}
                className={`w-10 h-6 rounded-full transition-colors p-1 flex items-center cursor-pointer ${
                  config.streamThinking ? 'bg-cyan-500 justify-end' : 'bg-white/[0.1] justify-start'
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
              </button>
            </div>

            {/* Audio Feedback */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-300 font-mono flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Футуристичные звуки интерфейса</span>
                </div>
                <div className="text-[10px] text-slate-500 font-sans">
                  Синтезатор кликов, потока токенов и завершения
                </div>
              </div>
              <button
                onClick={() => onChangeConfig({ ...config, enableAudioFeedback: !config.enableAudioFeedback })}
                className={`w-10 h-6 rounded-full transition-colors p-1 flex items-center cursor-pointer ${
                  config.enableAudioFeedback ? 'bg-cyan-500 justify-end' : 'bg-white/[0.1] justify-start'
                }`}
              >
                <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
              </button>
            </div>
          </div>

          {/* Hardware Diagnostic Info */}
          <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1.5 text-[11px] font-mono">
            <div className="flex items-center gap-1.5 text-slate-300 font-bold">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              <span>Аппаратный статус:</span>
            </div>
            <div className="text-slate-400 text-[10px]">
              {webGpuSupported ? (
                <span className="text-emerald-400">
                  ✓ WebGPU Активен ({webGpuAdapterName || 'GPU Accelerator'})
                </span>
              ) : (
                <span className="text-amber-400">
                  ! WebGPU недоступен — активен автономный Wasm/CPU движок
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/[0.06] bg-white/[0.02] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-black text-xs font-bold font-mono transition-all shadow-[0_0_15px_#22d3ee] cursor-pointer"
          >
            Сохранить и закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
