import React, { useState, useEffect } from 'react';
import { 
  X, 
  Cpu, 
  UploadCloud, 
  Check, 
  Zap, 
  ShieldCheck, 
  FileCode,
  HardDrive,
  ImageIcon,
} from 'lucide-react';
import { ModelInfo, GgufMetadata } from '../types';
import { PRESET_MODELS, isElectron } from '../services/localEngine';
import { soundEffects } from '../utils/audioSynth';
import { getImageModel } from '../data/imageModels';

interface ModelSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeModel: ModelInfo;
  onSelectModel: (model: ModelInfo) => void;
  onGgufFileDrop: (file: File) => void;
  customGgufs: ModelInfo[];
  onOpenGgufInspector: (metadata: GgufMetadata) => void;
  loadProgress: number;
  loadText: string;
  isLoading: boolean;
  soundEnabled: boolean;
  imageMode?: boolean;
  onSelectImageMode?: () => void;
}

export function ModelSelectorModal({
  isOpen,
  onClose,
  activeModel,
  onSelectModel,
  onGgufFileDrop,
  customGgufs,
  onOpenGgufInspector,
  loadProgress,
  loadText,
  isLoading,
  soundEnabled,
  imageMode = false,
  onSelectImageMode,
}: ModelSelectorModalProps) {
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('presets');
  const [isDragOver, setIsDragOver] = useState(false);
  const [presetModels, setPresetModels] = useState<ModelInfo[]>(PRESET_MODELS);

  useEffect(() => {
    if (!isOpen) return;
    if (!isElectron() || !window.nexus?.models) {
      setPresetModels(PRESET_MODELS);
      return;
    }
    window.nexus.models().then((rows) => {
      const list = (rows || []).map((m: Record<string, unknown>) => ({
        id: String(m.id),
        name: String(m.name),
        size: String(m.size || ''),
        quant: String(m.quant || 'Q4_K_M'),
        family: String(m.family || ''),
        format: 'embedded' as const,
        contextLength: Number(m.contextLength || 4096),
        cached: true,
        vramRequirementMb: Number(m.vramRequirementMb || 700),
        description: String(m.description || ''),
        backendId: String(m.backendId || m.id),
      }));
      setPresetModels(list.length > 0 ? list : PRESET_MODELS);
    }).catch(() => setPresetModels(PRESET_MODELS));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.gguf') || file.name.endsWith('.bin')) {
        if (soundEnabled) soundEffects.modelLoaded();
        onGgufFileDrop(file);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div 
        className="w-full max-w-2xl bg-[#090b10] border border-white/[0.1] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
              <Cpu className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white font-['Syne']">
                МЕНЕДЖЕР МОДЕЛЕЙ
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                100% автономный запуск локально — Vulkan GPU / CPU
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Loading Progress State */}
        {isLoading && (
          <div className="px-5 py-3 bg-cyan-950/40 border-b border-cyan-500/20">
            <div className="flex items-center justify-between text-xs font-mono text-cyan-300 mb-1.5">
              <span>{loadText || 'Инициализация весов...'}</span>
              <span>{loadProgress}%</span>
            </div>
            <div className="w-full h-1.5 bg-cyan-950 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 to-indigo-400 transition-all duration-300"
                style={{ width: `${loadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center px-5 pt-3 border-b border-white/[0.04] gap-2">
          <button
            onClick={() => setActiveTab('presets')}
            className={`px-3 py-1.5 text-xs font-mono border-b-2 transition-all cursor-pointer ${
              activeTab === 'presets'
                ? 'border-cyan-400 text-cyan-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Предустановленные модели ({presetModels.length})
          </button>
          {/* Вкладка «Загруженные GGUF» отключена — используем только встроенную модель */}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'presets' ? (
            <div className="space-y-2.5">
              {/* Text models */}
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mb-1 px-0.5">Языковые модели</div>
              {presetModels.map(model => {
                const isSelected = !imageMode && activeModel.id === model.id;
                return (
                  <div
                    key={model.id}
                    onClick={() => {
                      if (soundEnabled) soundEffects.click();
                      onSelectModel(model);
                    }}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? 'bg-cyan-500/10 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.15)]'
                        : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/[0.12]'
                    }`}
                  >
                    <div className="space-y-1 max-w-[75%]">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white font-mono">{model.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-cyan-300 font-mono">{model.quant}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{model.size}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-1 font-sans">{model.description}</p>
                      <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 pt-0.5">
                        <span>Контекст: {model.contextLength} tok</span>
                        <span>•</span>
                        <span>VRAM / Память: ~{model.vramRequirementMb} MB</span>
                      </div>
                    </div>
                    <div className="shrink-0 pl-2">
                      {isSelected ? (
                        <div className="w-7 h-7 rounded-full bg-cyan-400 text-black flex items-center justify-center shadow-[0_0_10px_#22d3ee]">
                          <Check className="w-4 h-4 stroke-[3]" />
                        </div>
                      ) : (
                        <div className="px-2.5 py-1 rounded-lg bg-white/[0.04] text-[11px] font-mono text-slate-300 hover:text-cyan-300 hover:bg-white/[0.08]">
                          Выбрать
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Image model section */}
              {onSelectImageMode && (() => {
                const imgModel = getImageModel();
                const isSelected = imageMode;
                return (
                  <>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono mt-4 mb-1 px-0.5">Модели изображений</div>
                    <div
                      onClick={() => {
                        if (soundEnabled) soundEffects.click();
                        onSelectImageMode();
                        onClose();
                      }}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'bg-purple-500/10 border-purple-400/80 shadow-[0_0_20px_rgba(168,85,247,0.15)]'
                          : 'bg-white/[0.02] border-white/[0.06] hover:bg-purple-500/[0.05] hover:border-purple-400/30'
                      }`}
                    >
                      <div className="space-y-1 max-w-[75%]">
                        <div className="flex items-center gap-2">
                          <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
                          <span className="text-xs font-bold text-white font-mono">{imgModel.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 font-mono">Q4_K</span>
                          <span className="text-[10px] text-slate-500 font-mono">~6.2 GB</span>
                        </div>
                        <p className="text-[11px] text-slate-400 line-clamp-1 font-sans">{imgModel.description}</p>
                        <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 pt-0.5">
                          <span>Разрешение: 768×768</span>
                          <span>•</span>
                          <span>Шаги: {imgModel.steps}</span>
                          <span>•</span>
                          <span>VRAM: ~6.6 GB</span>
                        </div>
                      </div>
                      <div className="shrink-0 pl-2">
                        {isSelected ? (
                          <div className="w-7 h-7 rounded-full bg-purple-400 text-black flex items-center justify-center shadow-[0_0_10px_rgba(168,85,247,0.6)]">
                            <Check className="w-4 h-4 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="px-2.5 py-1 rounded-lg bg-white/[0.04] text-[11px] font-mono text-slate-300 hover:text-purple-300 hover:bg-white/[0.08]">
                            Выбрать
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Dropzone for GGUF */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`p-6 rounded-2xl border-2 border-dashed transition-all text-center ${
                  isDragOver
                    ? 'border-cyan-400 bg-cyan-500/10 shadow-[0_0_30px_rgba(6,182,212,0.25)]'
                    : 'border-white/[0.1] hover:border-cyan-500/40 bg-white/[0.02]'
                }`}
              >
                <label className="cursor-pointer block space-y-2">
                  <input
                    type="file"
                    accept=".gguf,.bin"
                    className="hidden"
                    onChange={e => {
                      if (e.target.files && e.target.files[0]) {
                        if (soundEnabled) soundEffects.modelLoaded();
                        onGgufFileDrop(e.target.files[0]);
                      }
                    }}
                  />
                  <UploadCloud className="w-8 h-8 text-cyan-400 mx-auto" />
                  <div className="text-xs font-mono text-slate-200 font-bold">
                    Выберите или перетащите <span className="text-cyan-400">.GGUF</span> файл
                  </div>
                  <p className="text-[11px] text-slate-400 max-w-sm mx-auto font-sans">
                    Парсер прочитает метаданные (квантование, тензоры, слои) и подготовит веса к инференсу.
                  </p>
                </label>
              </div>

              {/* Uploaded GGUFs List */}
              {customGgufs.length === 0 ? (
                <div className="p-4 rounded-xl bg-white/[0.01] border border-white/[0.04] text-center text-xs text-slate-500 font-mono">
                  Локальные GGUF файлы еще не добавлены. Загрузите файл выше.
                </div>
              ) : (
                <div className="space-y-2">
                  {customGgufs.map(gguf => {
                    const isSelected = activeModel.id === gguf.id;
                    return (
                      <div
                        key={gguf.id}
                        className={`p-3.5 rounded-xl border flex items-center justify-between ${
                          isSelected
                            ? 'bg-cyan-500/10 border-cyan-400'
                            : 'bg-white/[0.02] border-white/[0.06]'
                        }`}
                      >
                        <div className="space-y-1 max-w-[70%]">
                          <div className="flex items-center gap-2">
                            <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                            <span className="text-xs font-bold text-white font-mono truncate">
                              {gguf.name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-cyan-300 font-mono">
                              {gguf.quant}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono flex items-center gap-2">
                            <span>Размер: {gguf.size}</span>
                            <span>•</span>
                            <span>Архитектура: {gguf.family}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {gguf.ggufMetadata && (
                            <button
                              onClick={() => onOpenGgufInspector(gguf.ggufMetadata!)}
                              className="px-2 py-1 rounded bg-white/[0.04] text-[10px] font-mono text-slate-300 hover:text-cyan-300 cursor-pointer"
                            >
                              Инфо GGUF
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (soundEnabled) soundEffects.click();
                              onSelectModel(gguf);
                            }}
                            className={`px-3 py-1 rounded text-xs font-mono transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-cyan-400 text-black font-bold'
                                : 'bg-white/[0.06] text-slate-200 hover:bg-cyan-500/20 hover:text-cyan-300'
                            }`}
                          >
                            {isSelected ? 'Активна' : 'Выбрать'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Note */}
        <div className="px-5 py-3 border-t border-white/[0.06] bg-white/[0.01] flex items-center justify-between text-[11px] font-mono text-slate-500">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>100% приватность: веса остаются на вашем ПК</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs text-white font-mono transition-colors cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
