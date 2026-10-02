import React from 'react';
import { ModelInfo } from '../types';
import { Settings, Minus, Square, X } from 'lucide-react';

interface TitleBarProps {
  activeModel: ModelInfo;
  onOpenModelSelector: () => void;
  onOpenSettings: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  engineStatus: string;
  webGpuSupported: boolean;
}

export function TitleBar(props: TitleBarProps) {
  const winApi = () => (window as any).nexus;

  return (
    <header
      id="hc-ai-titlebar"
      className="h-10 border-b border-white/10 bg-black/30 backdrop-blur-md px-4 flex items-center justify-between select-none relative z-30 drag-region"
    >
      {/* Левое: бренд */}
      <div className="flex items-center gap-4 no-drag">
        <div className="flex items-center gap-2">
          <span className="text-[11px] opacity-40 font-medium tracking-widest font-mono uppercase">
            HC AI
          </span>
        </div>
      </div>

      {/* Правое: настройки + кнопки окна */}
      <div className="flex items-center gap-1 no-drag">
        <button
          onClick={props.onOpenSettings}
          title="Настройки (температура и т.д.)"
          className="w-8 h-8 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
        >
          <Settings className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-white/10 mx-1" />

        <button
          onClick={() => winApi()?.minimizeWindow?.()}
          title="Свернуть"
          className="w-9 h-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer rounded-l-md"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => winApi()?.maximizeWindow?.()}
          title="Развернуть"
          className="w-9 h-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          onClick={() => winApi()?.closeWindow?.()}
          title="Закрыть"
          className="w-9 h-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-red-500/80 transition-colors cursor-pointer rounded-r-md"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
