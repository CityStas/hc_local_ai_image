import React, { useRef, useEffect } from 'react';
import { 
  Send, 
  Square, 
  Sparkles, 
  Cpu, 
  Code2, 
  Paperclip, 
  Trash2,
  Sliders,
  ImageIcon,
  Eye
} from 'lucide-react';
import { Message, ModelInfo, EngineStatus, PersonaPreset } from '../types';
import { getImageModel } from '../data/imageModels';
import { VLM_MODE_CHIPS, getVlmModel, type VlmMode, type VlmModelId } from '../data/vlmModels';
import { MessageItem } from './MessageItem';
import { soundEffects } from '../utils/audioSynth';

interface ChatAreaProps {
  messages: Message[];
  inputPrompt: string;
  setInputPrompt: (val: string) => void;
  onSubmit: (prompt?: string) => void;
  onStop: () => void;
  engineStatus: EngineStatus;
  activeModel: ModelInfo;
  activePersona: PersonaPreset;
  onOpenModelSelector: () => void;
  onOpenSettings: () => void;
  onClearCurrentChat: () => void;
  onGgufFileDrop: (file: File) => void;
  soundEnabled: boolean;
  attachedFiles?: { name: string; content: string }[];
  onRemoveAttachment?: (name: string) => void;
  imageMode?: boolean;
  onToggleImageMode?: () => void;
  imageModelId?: string;
  onOpenImageModelPicker?: () => void;
  attachedImage?: { name: string; file: File } | null;
  onRemoveAttachedImage?: () => void;
  scenePosition?: 'left' | 'center' | 'right';
  onSetScenePosition?: (p: 'left' | 'center' | 'right') => void;
  onVlmChip?: (mode: VlmMode) => void;
  vlmModelId?: VlmModelId;
}

export function ChatArea({
  messages,
  inputPrompt,
  setInputPrompt,
  onSubmit,
  onStop,
  engineStatus,
  activeModel,
  activePersona,
  onOpenModelSelector,
  onOpenSettings,
  onClearCurrentChat,
  onGgufFileDrop,
  soundEnabled,
  attachedFiles,
  onRemoveAttachment,
  imageMode,
  onToggleImageMode,
  imageModelId,
  onOpenImageModelPicker,
  attachedImage,
  onRemoveAttachedImage,
  scenePosition,
  onSetScenePosition,
  onVlmChip,
  vlmModelId,
}: ChatAreaProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isGenerating = engineStatus === 'generating' || engineStatus === 'thinking' || engineStatus === 'generating_image';
  const vlmModel = getVlmModel(vlmModelId);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, engineStatus]);

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputPrompt(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputPrompt.trim() && !isGenerating) {
        if (soundEnabled) soundEffects.click();
        onSubmit();
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      }
    }
  };

  return (
    <div id="nexus-chat-area" className="flex-1 flex flex-col h-full overflow-hidden relative z-10">
      {/* Messages Scroll Area */}
      <div className="flex-1 flex flex-col overflow-y-auto pb-4">
        {messages.length === 0 ? (
          <EmptyState
            activeModel={activeModel}
            activePersona={activePersona}
            onSelectPrompt={prompt => {
              if (soundEnabled) soundEffects.click();
              onSubmit(prompt);
            }}
            onOpenModelSelector={onOpenModelSelector}
            imageMode={imageMode}
            imageModelId={imageModelId}
            onToggleImageMode={onToggleImageMode}
          />
        ) : (
          <div className="p-4 md:p-8 flex flex-col gap-5 max-w-4xl mx-auto w-full">
            {messages.map((message, idx) => (
              <MessageItem
                key={message.id || idx}
                message={message}
                isLast={idx === messages.length - 1}
                isGenerating={isGenerating}
                soundEnabled={soundEnabled}
                onRegenerate={
                  idx === messages.length - 1 && message.role === 'assistant'
                    ? () => {
                        const lastUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0];
                        if (lastUserMsg) onSubmit(lastUserMsg.content);
                      }
                    : undefined
                }
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Floating Input Dock (Immersive Capsule) */}
      <div className="p-4 md:px-10 md:pb-8 max-w-4xl w-full mx-auto">
        {/* Attached Files Chips */}
        {attachedFiles && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pb-1.5">
            {attachedFiles.map(f => (
              <span
                key={f.name}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.04] border border-cyan-500/20 text-[11px] font-mono text-slate-300"
                title="Содержимое файла будет отправлено модели вместе с следующим сообщением"
              >
                <Paperclip className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="truncate max-w-[240px]">{f.name}</span>
                <button
                  onClick={() => onRemoveAttachment?.(f.name)}
                  className="ml-0.5 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                  title="Убрать файл"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {attachedImage && (
          <div className="flex flex-col gap-1.5 px-3 pb-1.5">
            <div className="flex flex-wrap gap-2 items-center">
              <span className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-mono ${
                imageMode
                  ? 'bg-purple-500/10 border border-purple-400/30 text-purple-200'
                  : 'bg-cyan-500/10 border border-cyan-400/30 text-cyan-200'
              }`}>
                {imageMode ? <ImageIcon className="w-3 h-3 shrink-0" /> : <Eye className="w-3 h-3 shrink-0" />}
                <span className="truncate max-w-[200px]">{attachedImage.name}</span>
                <span className="opacity-60">{imageMode ? '→ img2img (🖼 вкл)' : '→ vision'}</span>
                <button
                  onClick={() => onRemoveAttachedImage?.()}
                  className="ml-0.5 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                  title="Убрать изображение"
                >
                  ×
                </button>
              </span>
              <span
                className="px-2 py-1 rounded-lg text-[10px] font-mono text-slate-400 border border-white/10"
                title="Moondream 2 — ответ переводится на русский через HC AI Light"
              >
                {vlmModel.name}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {VLM_MODE_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  disabled={isGenerating}
                  title={chip.title}
                  onClick={() => {
                    if (soundEnabled) soundEffects.click();
                    onVlmChip?.(chip.id);
                  }}
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-mono border border-cyan-400/25 text-cyan-200/90 bg-cyan-500/5 hover:bg-cyan-500/15 hover:border-cyan-400/50 disabled:opacity-40 cursor-pointer transition-colors"
                >
                  {chip.label}
                </button>
              ))}
              {imageMode && attachedImage && (
                <></>
              )}
              {imageMode && (
                <span className="px-2 py-0.5 text-[10px] font-mono text-purple-300/80 self-center">
                  🖼 вкл = генерация; чипы выше = текст по фото
                </span>
              )}
            </div>
          </div>
        )}

        {/* Quick Chip Toolbar */}
        <div className="flex items-center justify-between px-3 pb-2 text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[#00f2ff] bg-[#00f2ff]/10 px-2.5 py-0.5 rounded-full border border-[#00f2ff]/30">
              <Sparkles className="w-3 h-3 text-[#00f2ff]" />
              <span>{activePersona.title}</span>
            </span>

            {/* Mini engine status (right of active mode chip) */}
            <span
              className={`px-2 py-0.5 rounded border text-[9px] font-bold tracking-wider flex items-center gap-1.5 ${
                engineStatus === 'thinking' ? 'text-purple-300 bg-[#7000ff]/20 border-[#7000ff]/40'
                : engineStatus === 'generating' ? 'text-[#00f2ff] bg-[#00f2ff]/10 border-[#00f2ff]/30'
                : engineStatus === 'generating_image' ? 'text-purple-300 bg-purple-500/15 border-purple-400/40'
                : engineStatus === 'loading_model' ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                : engineStatus === 'error' ? 'text-red-400 bg-red-500/10 border-red-500/30'
                : 'text-slate-400 bg-white/[0.04] border-white/10'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${engineStatus !== 'idle' ? 'animate-ping' : ''} bg-current`} />
              {engineStatus === 'thinking' ? 'REASONING...'
                : engineStatus === 'generating' ? 'STREAMING'
                : engineStatus === 'generating_image' ? 'SD RENDER'
                : engineStatus === 'loading_model' ? 'LOADING WEIGHTS'
                : engineStatus === 'error' ? 'HALTED'
                : 'STANDBY'}
            </span>

            <span className="hidden sm:inline-block text-slate-600">•</span>
            <span className="hidden sm:inline-block text-slate-400 truncate max-w-[200px] font-mono text-[10px]">
              {imageMode ? getImageModel(imageModelId as any).name : activeModel.name}
            </span>
          </div>

          {messages.length > 0 && (
            <button
              onClick={() => {
                if (soundEnabled) soundEffects.click();
                onClearCurrentChat();
              }}
              className="flex items-center gap-1 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
              title="Очистить текущий диалог"
            >
              <Trash2 className="w-3 h-3" />
              <span>Очистить</span>
            </button>
          )}
        </div>

        {/* Immersive UI Capsule Input Box */}
        <div className="relative rounded-[100px] bg-[#0f0f14]/90 border border-white/10 focus-within:border-[#00f2ff]/50 transition-colors duration-200 px-5 py-2.5 flex items-center gap-3">

          {/* Model/GGUF Quick Drop Trigger */}
          <label 
            className="p-1 rounded-full text-slate-400 hover:text-[#00f2ff] transition-colors cursor-pointer shrink-0"
            title="Прикрепить файл или изображение"
          >
            <input
              type="file"
              accept=".txt,.md,.html,.css,.js,.jsx,.ts,.tsx,.json,.py,.c,.cpp,.h,.cs,.java,.rs,.go,.sh,.bat,.yaml,.yml,.xml,.csv,.log,.png,.jpg,.jpeg,.webp,.bmp"
              className="hidden"
              onChange={e => {
                if (e.target.files && e.target.files[0]) {
                  const file = e.target.files[0];
                  // Сбрасываем value — иначе выбор того же файла не триггерит change повторно
                  e.target.value = '';
                  if (soundEnabled) soundEffects.modelLoaded();
                  onGgufFileDrop(file);
                }
              }}
            />
            <Paperclip className="w-4 h-4" />
          </label>

          {/* Mode switch: Text <-> Image (переключение режимов) */}
          <button
            type="button"
            onClick={() => {
              if (soundEnabled) soundEffects.click();
              onToggleImageMode?.();
            }}
            className={`p-1 rounded-full transition-colors shrink-0 cursor-pointer ${
              imageMode
                ? 'text-slate-400 hover:text-cyan-300'
                : 'text-cyan-300 bg-cyan-500/15 border border-cyan-400/40'
            }`}
            title={imageMode ? 'Переключиться на текстовый режим' : 'Текстовый режим (активен)'}
          >
            <Cpu className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              if (soundEnabled) soundEffects.click();
              onToggleImageMode?.();
            }}
            className={`p-1 rounded-full transition-colors shrink-0 cursor-pointer ${
              imageMode
                ? 'text-purple-300 bg-purple-500/20 border border-purple-400/40'
                : 'text-slate-400 hover:text-purple-300'
            }`}
            title={imageMode ? 'Режим текста' : 'HC AI — генерация картинок'}
          >
            <ImageIcon className="w-4 h-4" />
          </button>

          {/* Input Textarea / Field */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputPrompt}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={imageMode ? 'Опишите картинку…' : 'Задайте вопрос...'}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 resize-none focus:outline-none py-1.5 px-1 max-h-32 leading-relaxed font-sans"
          />

          {/* Shortcut & Submit */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[10px] opacity-40 font-mono hidden sm:inline">⌘+ENTER</span>

            {isGenerating ? (
              <button
                id="btn-stop-generation"
                onClick={() => {
                  if (soundEnabled) soundEffects.click();
                  onStop();
                }}
                className="p-2 rounded-full bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 transition-all cursor-pointer shadow-[0_0_15px_rgba(239,68,68,0.25)] shrink-0"
                title="Остановить генерацию"
              >
                <Square className="w-3.5 h-3.5 fill-current animate-pulse" />
              </button>
            ) : (
              <button
                id="btn-submit-prompt"
                disabled={!inputPrompt.trim()}
                onClick={() => {
                  if (inputPrompt.trim()) {
                    if (soundEnabled) soundEffects.click();
                    onSubmit();
                    if (textareaRef.current) textareaRef.current.style.height = 'auto';
                  }
                }}
                className={`p-2 rounded-full transition-all shrink-0 ${
                  inputPrompt.trim()
                    ? 'bg-[#00f2ff] text-black shadow-[0_0_15px_#00f2ff] hover:scale-105 cursor-pointer'
                    : 'text-slate-600 cursor-not-allowed opacity-50'
                }`}
                title="Отправить запрос (Enter)"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Minimal Footer Hint */}
        <div className="flex items-center justify-end mt-2 px-3 text-[10px] font-mono text-slate-500">
          <span>Нажмите <kbd className="px-1 py-0.5 rounded bg-white/[0.05] text-slate-400">Enter</kbd> для отправки</span>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  activeModel,
  activePersona,
  onSelectPrompt,
  onOpenModelSelector,
  imageMode,
  imageModelId,
  onToggleImageMode,
}: {
  activeModel: ModelInfo;
  activePersona: PersonaPreset;
  onSelectPrompt: (prompt: string) => void;
  onOpenModelSelector: () => void;
  imageMode?: boolean;
  imageModelId?: string;
  onToggleImageMode?: () => void;
}) {
  const imgModel = imageMode ? getImageModel(imageModelId as any) : null;

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-3xl w-full px-4 flex flex-col items-center text-center py-8">

        {/* Futuristic Center HC AI Aura */}
        <div className="relative mb-4">
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center border ${
            imageMode
              ? 'bg-gradient-to-tr from-purple-500/15 to-violet-500/15 border-purple-400/30'
              : 'bg-gradient-to-tr from-cyan-500/15 to-purple-500/15 border-cyan-400/30'
          }`}>
            <div className="w-12 h-12 rounded-xl bg-[#08090d] flex items-center justify-center border border-white/[0.1]">
              {imageMode
                ? <ImageIcon className="w-6 h-6 text-purple-400" />
                : <Sparkles className="w-6 h-6 text-cyan-400" />
              }
            </div>
          </div>
          <div className={`absolute -inset-2 rounded-3xl blur-xl -z-10 ${imageMode ? 'bg-purple-500/10' : 'bg-cyan-500/10'}`} />
        </div>

        {/* Heading */}
        <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight font-['Syne'] mb-6">
          HC AI
        </h1>
      </div>
    </div>
  );
}
