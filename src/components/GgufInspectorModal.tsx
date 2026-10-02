import React, { useState } from 'react';
import { X, FileCode, Cpu, Layers, HardDrive, CheckCircle2, ShieldCheck, Search } from 'lucide-react';
import { GgufMetadata } from '../types';

interface GgufInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  metadata: GgufMetadata | null;
  onActivateModel?: () => void;
}

export function GgufInspectorModal({
  isOpen,
  onClose,
  metadata,
  onActivateModel,
}: GgufInspectorModalProps) {
  const [filterQuery, setFilterQuery] = useState('');

  if (!isOpen || !metadata) return null;

  const rawEntries = Object.entries(metadata.rawKv || {}).filter(([k, v]) =>
    k.toLowerCase().includes(filterQuery.toLowerCase()) ||
    String(v).toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-3xl bg-[#090b10] border border-cyan-500/30 rounded-2xl shadow-[0_0_50px_rgba(6,182,212,0.15)] overflow-hidden flex flex-col max-h-[88vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white font-['Syne']">
                  ИНСПЕКТОР БИНАРНОГО ФОРМАТА GGUF
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  MAGIC: {metadata.magic} (OK)
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono truncate max-w-md">
                Файл: {metadata.fileName || 'custom_model.gguf'}
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

        {/* Quick Spec Matrix */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-5 bg-white/[0.01] border-b border-white/[0.06]">
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="text-[10px] text-slate-500 font-mono uppercase">Архитектура</div>
            <div className="text-sm font-bold text-cyan-300 font-mono mt-0.5">
              {metadata.architecture}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="text-[10px] text-slate-500 font-mono uppercase">Квантование</div>
            <div className="text-sm font-bold text-purple-300 font-mono mt-0.5">
              {metadata.quantization || 'Q4_K_M'}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="text-[10px] text-slate-500 font-mono uppercase">Контекст (Tokens)</div>
            <div className="text-sm font-bold text-emerald-300 font-mono mt-0.5">
              {metadata.contextLength.toLocaleString()}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <div className="text-[10px] text-slate-500 font-mono uppercase">Тензоры / Слои</div>
            <div className="text-sm font-bold text-indigo-300 font-mono mt-0.5">
              {metadata.tensorCount} / {metadata.blockCount || 24}
            </div>
          </div>
        </div>

        {/* Metadata Key-Value Search & Table */}
        <div className="p-5 flex-1 overflow-y-auto space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-300 font-mono uppercase tracking-wider">
              Заголовки и Метаданные ({rawEntries.length} полей)
            </h3>

            <div className="relative w-48">
              <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={filterQuery}
                onChange={e => setFilterQuery(e.target.value)}
                placeholder="Фильтр ключей..."
                className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-cyan-500/40 rounded-lg pl-7 pr-2 py-1 text-[11px] text-slate-300 focus:outline-none font-mono"
              />
            </div>
          </div>

          <div className="rounded-xl border border-white/[0.08] overflow-hidden bg-black/40">
            <div className="max-h-60 overflow-y-auto divide-y divide-white/[0.04] text-[11px] font-mono">
              {rawEntries.map(([key, val], idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 hover:bg-white/[0.02]">
                  <span className="text-cyan-400/90 font-medium truncate max-w-[45%]">{key}</span>
                  <span className="text-slate-300 text-right truncate max-w-[50%] select-text">
                    {String(val)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 border-t border-white/[0.08] bg-white/[0.02] flex items-center justify-between">
          <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>GGUF Header v{metadata.version} верифицирован</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs text-white font-mono transition-colors cursor-pointer"
            >
              Закрыть
            </button>
            {onActivateModel && (
              <button
                onClick={() => {
                  onActivateModel();
                  onClose();
                }}
                className="px-4 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-xs text-black font-bold font-mono transition-all shadow-[0_0_15px_#22d3ee] cursor-pointer"
              >
                Активировать модель
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
