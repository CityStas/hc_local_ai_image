import React, { useState } from 'react';
import { 
  Plus, 
  MessageSquare, 
  Trash2, 
  Pin, 
  Search, 
  ImageIcon,
} from 'lucide-react';
import { ChatSession, ModelInfo } from '../types';
import { soundEffects } from '../utils/audioSynth';
import { getImageModel, type ImageModelId } from '../data/imageModels';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onTogglePin: (id: string) => void;
  onGgufFileDrop: (file: File) => void;
  activeModel: ModelInfo;
  onExportAllChats: () => void;
  onImportChats: (e: React.ChangeEvent<HTMLInputElement>) => void;
  soundEnabled: boolean;
  imageMode?: boolean;
  imageModelId?: ImageModelId;
  onOpenModelSelector: () => void;
}

export function Sidebar({
  isOpen,
  onToggle,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onTogglePin,
  onGgufFileDrop,
  activeModel,
  onExportAllChats,
  onImportChats,
  soundEnabled,
  imageMode = false,
  imageModelId,
  onOpenModelSelector,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const filteredSessions = sessions.filter(s =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pinnedSessions = filteredSessions.filter(s => s.pinned);
  const regularSessions = filteredSessions.filter(s => !s.pinned);

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
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        id="hc-ai-sidebar"
        className={`fixed lg:static top-10 bottom-0 left-0 z-40 w-[260px] bg-black/40 lg:bg-black/20 border-r border-white/10 backdrop-blur-xl flex flex-col p-4 transition-all duration-300 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-0 lg:p-0 lg:overflow-hidden lg:border-r-0'
        }`}
      >
        {/* Active Model Info Card */}
        {imageMode ? (() => {
          const imgModel = getImageModel(imageModelId);
          // Z-Image: ~4GB diffusion + ~2.3GB LLM ≈ 6600MB → of 8192MB
          const usedMb = 6600;
          const totalMb = 8192;
          const pct = Math.round((usedMb / totalMb) * 100);
          return (
            <button
              onClick={onOpenModelSelector}
              title="Выбрать модель изображений"
              className="w-full text-left bg-[#0f0f14]/70 border border-purple-500/20 hover:border-purple-400/60 rounded-xl p-3.5 mb-4 shadow-sm transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <ImageIcon className="w-3 h-3 text-purple-400" />
                <span className="text-[10px] text-purple-400/70 uppercase tracking-wider font-mono">IMAGE MODEL</span>
              </div>
              <div className="font-mono text-[13px] text-white font-medium truncate mb-2">
                {imgModel.name}
              </div>
              <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                <span>VRAM Est.</span>
                <span>{(usedMb / 1024).toFixed(1)}GB / {(totalMb / 1024).toFixed(0)}GB</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full mt-1.5 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-violet-400 rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </button>
          );
        })() : (
          <button
            onClick={onOpenModelSelector}
            title="Выбрать модель"
            className="w-full text-left bg-[#0f0f14]/70 border border-white/10 hover:border-[#00f2ff]/40 rounded-xl p-3.5 mb-4 shadow-sm transition-colors cursor-pointer"
          >
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1 font-mono">MODEL</span>
            <div className="font-mono text-[13px] text-white font-medium truncate mb-2">
              {activeModel.name}
            </div>
            <div className="flex justify-between text-[11px] text-slate-400 font-mono">
              <span>VRAM Usage</span>
              <span>{(activeModel.vramRequirementMb / 1024).toFixed(1)}GB / {activeModel.vramRequirementMb > 2000 ? '8GB' : '4GB'}</span>
            </div>
            <div className="h-1 bg-white/5 rounded-full mt-1.5 overflow-hidden">
              <div
                className="h-full bg-[#7000ff] rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(10, Math.round((activeModel.vramRequirementMb / 4000) * 100)))}%` }}
              />
            </div>
          </button>
        )}

        {/* New Chat Button */}
        <button
          id="btn-new-chat"
          onClick={() => {
            if (soundEnabled) soundEffects.click();
            onNewSession();
          }}
          className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-[#00f2ff]/10 to-[#7000ff]/10 hover:from-[#00f2ff]/20 hover:to-[#7000ff]/20 border border-white/10 hover:border-[#00f2ff]/40 text-xs font-mono font-medium text-[#00f2ff] flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm group mb-3"
        >
          <Plus className="w-3.5 h-3.5 text-[#00f2ff] group-hover:rotate-90 transition-transform duration-200" />
          <span>НОВЫЙ ДИАЛОГ</span>
        </button>

        {/* Search Bar */}
        <div className="mb-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск..."
              className="w-full bg-[#0f0f14]/50 border border-white/10 focus:border-[#00f2ff]/40 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none transition-colors font-mono"
            />
          </div>
        </div>

        {/* Conversations Label */}
        <div className="mb-2 px-1 text-[10px] uppercase opacity-40 tracking-wider font-bold font-mono">
          Conversations
        </div>

        {/* Chat History List */}
        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {/* Pinned Chats */}
          {pinnedSessions.length > 0 && (
            <div className="mb-2">
              <div className="px-1 pb-1 text-[9px] font-mono text-[#00f2ff]/80 uppercase tracking-wider flex items-center gap-1">
                <Pin className="w-2.5 h-2.5" />
                <span>Закрепленные</span>
              </div>
              <div className="space-y-1">
                {pinnedSessions.map(session => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={session.id === activeSessionId}
                    onSelect={() => {
                      if (soundEnabled) soundEffects.click();
                      onSelectSession(session.id);
                    }}
                    onDelete={() => onDeleteSession(session.id)}
                    onTogglePin={() => onTogglePin(session.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Regular Chats */}
          {regularSessions.length === 0 && pinnedSessions.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-slate-600 font-mono">
              История пуста
            </div>
          ) : (
            regularSessions.map(session => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onSelect={() => {
                  if (soundEnabled) soundEffects.click();
                  onSelectSession(session.id);
                }}
                onDelete={() => onDeleteSession(session.id)}
                onTogglePin={() => onTogglePin(session.id)}
              />
            ))
          )}
        </div>

        {/* Быстрая загрузка GGUF / Экспорт / Импорт скрыты по требованию. */}

        {/* User Profile / Autonomous Link */}
          <div className="mt-3 pt-3 border-t border-white/5">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-500 to-purple-600 shrink-0 shadow-[0_0_8px_rgba(0,242,255,0.3)]" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-200 font-mono leading-none">USER_01</div>
                <div className="text-[9px] opacity-40 text-slate-400 font-mono mt-0.5">Autonomous Link</div>
              </div>
            </div>
          </div>
        </aside>
    </>
  );
}

function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onTogglePin,
}: {
  key?: React.Key;
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`group relative flex items-center justify-between px-3 py-2.5 rounded-lg text-[13px] cursor-pointer transition-all border-l-2 ${
        isActive
          ? 'bg-[#7000ff]/10 border-[#7000ff] text-white shadow-sm font-medium'
          : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.05] border-transparent'
      }`}
    >
      <div className="flex items-center gap-2 truncate pr-2">
        <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#00f2ff]' : 'text-slate-600 group-hover:text-slate-400'}`} />
        <span className="truncate font-sans">{session.title || 'Новый диалог'}</span>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={e => {
            e.stopPropagation();
            onTogglePin();
          }}
          className={`p-1 rounded hover:bg-white/[0.08] ${session.pinned ? 'text-[#00f2ff]' : 'text-slate-500'}`}
          title={session.pinned ? "Открепить" : "Закрепить"}
        >
          <Pin className="w-3 h-3" />
        </button>
        <button
          onClick={e => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400"
          title="Удалить сессию"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
