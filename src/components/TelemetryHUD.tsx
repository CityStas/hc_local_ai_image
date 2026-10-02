import React from 'react';
import { Zap, Clock, Hash, Database, Activity } from 'lucide-react';
import { TelemetryState } from '../types';

interface TelemetryHUDProps {
  telemetry: TelemetryState;
  maxContext: number;
  centered?: boolean; // на главном экране элементы полосы центрируются
}

export function TelemetryHUD({ telemetry, maxContext, centered }: TelemetryHUDProps) {
  const contextPct = Math.min(100, Math.round((telemetry.contextUsed / maxContext) * 100));

  const getStatusDisplay = () => {
    switch (telemetry.status) {
      case 'thinking':
        return { text: 'REASONING...', color: 'text-purple-300 bg-[#7000ff]/20 border-[#7000ff]/40 shadow-[0_0_8px_rgba(112,0,255,0.2)]' };
      case 'generating':
        return { text: 'STREAMING', color: 'text-[#00f2ff] bg-[#00f2ff]/10 border-[#00f2ff]/30 shadow-[0_0_8px_rgba(0,242,255,0.2)]' };
      case 'generating_image':
        return { text: 'SD RENDER', color: 'text-purple-300 bg-purple-500/15 border-purple-400/40 shadow-[0_0_8px_rgba(168,85,247,0.2)]' };
      case 'loading_model':
        return { text: 'LOADING WEIGHTS', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
      case 'error':
        return { text: 'HALTED', color: 'text-red-400 bg-red-500/10 border-red-500/30' };
      default:
        return { text: 'STANDBY', color: 'text-slate-400 bg-white/[0.04] border-white/10' };
    }
  };

  const status = getStatusDisplay();

  return (
    <div
      id="telemetry-hud"
      className={`border-b border-white/10 bg-[#0f0f14]/60 backdrop-blur-md px-4 py-1.5 flex items-center text-[11px] font-mono text-slate-400 select-none overflow-x-auto ${centered ? 'justify-center gap-4' : 'justify-between'}`}
    >
      {/* Left: Status & TPS */}
      <div className="flex items-center gap-4 shrink-0">
        <div className={`px-2 py-0.5 rounded border text-[10px] font-bold flex items-center gap-1.5 tracking-wider ${status.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${telemetry.status !== 'idle' ? 'animate-ping' : ''} bg-current`} />
          {status.text}
        </div>

        {/* Speed / TPS */}
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-[#00f2ff]" />
          <span>{telemetry.status === 'generating_image' ? 'STEP/S:' : 'SPEED:'}</span>
          <span className="text-white font-bold">
            {telemetry.currentTps > 0
              ? telemetry.status === 'generating_image'
                ? `${telemetry.currentTps} st/s`
                : `${telemetry.currentTps} tok/s`
              : '--'}
          </span>
        </div>

        {/* TTFT */}
        <div className="hidden sm:flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-indigo-400" />
          <span>{telemetry.status === 'generating_image' ? 'ELAPSED:' : 'TTFT:'}</span>
          <span className="text-white font-bold">
            {telemetry.activeTtft > 0
              ? telemetry.status === 'generating_image'
                ? `${(telemetry.activeTtft / 1000).toFixed(0)}s`
                : `${telemetry.activeTtft} ms`
              : '--'}
          </span>
        </div>
      </div>

      {/* Right: Tokens, Memory & Context Window Gauge */}
      <div className="flex items-center gap-4 shrink-0">
        {/* Tokens Count */}
        <div className="hidden md:flex items-center gap-1.5">
          <Hash className="w-3.5 h-3.5 text-emerald-400" />
          <span>TOKENS:</span>
          <span className="text-white font-bold">{telemetry.totalTokens}</span>
        </div>

        {/* VRAM / RAM Footprint */}
        <div className="hidden lg:flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-purple-400" />
          <span>MEM:</span>
          <span className="text-white font-bold">{telemetry.vramUsedMb} MB</span>
        </div>

        {/* Context Window Fill Bar */}
        <div className="flex items-center gap-2">
          <span className="text-[10px]">CTX:</span>
          <div className="w-20 sm:w-28 h-2 rounded-full bg-white/[0.08] overflow-hidden p-[1px] border border-white/10">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                contextPct > 80 ? 'bg-amber-500' : 'bg-gradient-to-r from-[#00f2ff] to-[#7000ff]'
              }`}
              style={{ width: `${Math.max(4, contextPct)}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-300 font-medium">{contextPct}%</span>
        </div>
      </div>
    </div>
  );
}
