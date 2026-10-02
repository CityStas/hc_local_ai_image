import React from 'react';
import { ImageIcon, Check, X } from 'lucide-react';
import { ImageModelId, IMAGE_MODELS, ImageModelDef } from '../data/imageModels';

interface ImageModelPickerProps {
  isOpen: boolean;
  current: ImageModelId;
  onSelect: (id: ImageModelId) => void;
  onClose: () => void;
}

export function ImageModelPicker({ isOpen, current, onSelect, onClose }: ImageModelPickerProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-sm rounded-2xl bg-[#0f0f14] border border-white/10 shadow-2xl p-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-bold text-white font-mono">
            <ImageIcon className="w-4 h-4 text-purple-400" />
            Модель изображений
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {IMAGE_MODELS.map((model: ImageModelDef) => {
            const active = model.id === current;
            return (
              <button
                key={model.id}
                onClick={() => { onSelect(model.id); onClose(); }}
                className={`w-full text-left px-3.5 py-3 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                  active
                    ? `${model.accent} border-opacity-100`
                    : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.15]'
                }`}
              >
                <div>
                  <div className={`font-bold text-sm font-mono ${active ? model.color : 'text-slate-200'}`}>
                    {model.name}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{model.description}</div>
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-slate-500">
                    <span>{model.steps} steps</span>
                    <span>·</span>
                    <span>CFG {model.cfg}</span>
                    <span>·</span>
                    <span>guidance {model.distilledGuidance}</span>
                  </div>
                </div>
                {active && <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
