import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Copy, 
  Check, 
  Brain, 
  ChevronDown, 
  ChevronRight, 
  Volume2, 
  RefreshCw, 
  Zap, 
  Code2, 
  Eye, 
  Play,
  Download,
  ImageIcon,
  Maximize2,
  ZoomIn
} from 'lucide-react';
import { Message } from '../types';
import { soundEffects } from '../utils/audioSynth';
import { cleanCodeBody, sanitizeModelOutput } from '../utils/sanitizeOutput';
import { upscaleEngineService } from '../services/upscaleEngine';

interface MessageItemProps {
  key?: React.Key;
  message: Message;
  isLast: boolean;
  isGenerating: boolean;
  onRegenerate?: () => void;
  soundEnabled: boolean;
}

export function MessageItem({
  message,
  isLast,
  isGenerating,
  onRegenerate,
  soundEnabled,
}: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  const isUser = message.role === 'user';
  const displayImage = message.imageUrl || message.previewUrl;
  const isPreview = !message.imageUrl && !!message.previewUrl;

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    if (soundEnabled) soundEffects.click();
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSpeak = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message.content);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div
      className={`flex flex-col w-full transition-all duration-200 ${
        isUser ? 'items-end' : 'items-start'
      }`}
    >
      {/* Картинка ВНЕ bubble с backdrop-blur — иначе fixed/lightbox и img ломаются в Electron */}
      {displayImage && (
        <ImageBlock
          src={displayImage}
          alt={message.imageMeta?.prompt || 'Изображение'}
          isPreview={isPreview}
          isGenerating={isLast && isGenerating}
          imageMeta={message.imageMeta}
          imageUrl={message.imageUrl}
          onOpenLightbox={() => setLightbox(true)}
          soundEnabled={soundEnabled}
        />
      )}

      <div
        className={`max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed transition-all ${
          isUser
            ? 'bg-[#7000ff]/15 border border-[#7000ff]/30 text-white rounded-br-sm shadow-[0_4px_20px_rgba(112,0,255,0.1)]'
            : 'bg-[#0f0f14]/70 border border-white/10 text-slate-200 rounded-bl-sm backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.3)]'
        }`}
      >
        {/* AI Header Label & Telemetry Badge */}
        {!isUser && (
          <div className="flex items-center justify-between gap-3 mb-2 pb-1.5 border-b border-white/5">
            <div className="flex items-center gap-2">
              <span className="text-[#00f2ff] text-xs font-bold uppercase tracking-wider font-mono">
                HC AI
              </span>
              {/* Анимация «думает/прогружается» — три пульсирующие точки во время генерации */}
              {isLast && isGenerating && !message.imageUrl && (
                <span className="flex items-center gap-1 ml-1" aria-label="Генерация...">
                  {[0, 150, 300].map((d) => (
                    <span
                      key={d}
                      className="w-1.5 h-1.5 rounded-full bg-[#00f2ff] animate-bounce"
                      style={{ animationDelay: `${d}ms`, opacity: 0.6 }}
                    />
                  ))}
                </span>
              )}
              {isLast && isGenerating && isPreview && (
                <span className="text-[10px] text-purple-300 font-mono ml-1">превью</span>
              )}
            </div>

            {/* Stats Pill */}
            {(message.speedTps || message.tokensGenerated || message.imageMeta) && (
              <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 bg-white/[0.04] px-2 py-0.5 rounded-full border border-white/5">
                {message.imageMeta ? (
                  <>
                    <span className="text-purple-300 flex items-center gap-0.5 font-bold">
                      <ImageIcon className="w-2.5 h-2.5" />
                      {message.modelUsed || 'HC AI'}
                    </span>
                    <span>{message.imageMeta.width}×{message.imageMeta.height}</span>
                    <span>{Math.round(message.imageMeta.elapsedMs / 1000)}s</span>
                    {message.imageMeta.seed >= 0 && <span>seed {message.imageMeta.seed}</span>}
                  </>
                ) : (
                  <>
                    {message.speedTps && (
                      <span className="text-[#00f2ff] flex items-center gap-0.5 font-bold">
                        <Zap className="w-2.5 h-2.5" />
                        {message.speedTps} tok/s
                      </span>
                    )}
                    {message.ttftMs && <span>{message.ttftMs}ms TTFT</span>}
                    {message.tokensGenerated && <span>{message.tokensGenerated} tok</span>}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* User Header */}
        {isUser && (
          <div className="flex items-center justify-end gap-2 mb-1.5 text-[10px] text-purple-300/60 font-mono">
            <span>USER_01</span>
            <span>•</span>
            <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )}

        {/* Expandable Thinking Section (<think> block) */}
        {message.thinking && (
          <div className="rounded-xl border border-[#7000ff]/20 bg-[#7000ff]/10 overflow-hidden text-xs my-2">
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="w-full px-3 py-1.5 flex items-center justify-between bg-[#7000ff]/20 hover:bg-[#7000ff]/30 text-purple-200 font-mono text-[11px] cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <Brain className="w-3.5 h-3.5 text-purple-300 animate-pulse" />
                <span className="font-semibold">ЦЕПОЧКА МЫШЛЕНИЯ (REASONING PROCESS)</span>
              </div>
              {showThinking ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>

            {showThinking && (
              <div className="p-3 font-mono text-[11px] text-purple-200/90 leading-relaxed whitespace-pre-wrap border-t border-[#7000ff]/15 bg-black/40 select-text">
                {message.thinking}
              </div>
            )}
          </div>
        )}

        {/* Rendered Text Content */}
        <div className="text-slate-100 text-[14px] leading-relaxed select-text space-y-2.5">
          {!displayImage && (
            <FormattedMessageContent content={sanitizeModelOutput(message.content)} soundEnabled={soundEnabled} />
          )}
          {displayImage && message.content && !/^Шаг \d+\/\d+/.test(message.content) && !message.content.startsWith('Загрузка') && !message.content.startsWith('HC AI') && !message.content.startsWith('Проверка') && (
            <p className="text-slate-400 text-xs">{message.content}</p>
          )}
          {displayImage && (/^Шаг \d+\/\d+/.test(message.content) || message.content.startsWith('Загрузка') || message.content.startsWith('HC AI')) && isLast && isGenerating && (
            <p className="text-purple-300/80 text-xs font-mono animate-pulse">{message.content}</p>
          )}
        </div>

        {/* Bottom Action Toolbar for AI */}
        {!isUser && (
          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-white/5 text-slate-500 text-xs">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-white/[0.06] hover:text-slate-200 transition-colors cursor-pointer text-[11px] font-mono"
              title="Скопировать ответ"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Скопировано' : 'Копировать'}</span>
            </button>

            {onRegenerate && !isGenerating && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1 px-2 py-1 rounded hover:bg-white/[0.06] hover:text-slate-200 transition-colors cursor-pointer text-[11px] font-mono ml-auto"
                title="Перегенерировать ответ"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Перегенерировать</span>
              </button>
            )}
          </div>
        )}
      </div>

      {lightbox && displayImage && (
        <ImageLightbox src={displayImage} onClose={() => setLightbox(false)} />
      )}
    </div>
  );
}

function ImageBlock({
  src,
  alt,
  isPreview,
  isGenerating,
  imageMeta,
  imageUrl,
  onOpenLightbox,
  soundEnabled,
}: {
  src: string;
  alt: string;
  isPreview: boolean;
  isGenerating: boolean;
  imageMeta?: Message['imageMeta'];
  imageUrl?: string;
  onOpenLightbox: () => void;
  soundEnabled: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const [upscaling, setUpscaling] = useState(false);
  const [upscalePct, setUpscalePct] = useState(0);
  const [upscaleErr, setUpscaleErr] = useState<string | null>(null);
  const [upscaledUrl, setUpscaledUrl] = useState<string | null>(null);

  useEffect(() => {
    setBroken(false);
    setUpscaledUrl(null);
    setUpscaleErr(null);
  }, [src]);

  // Обновляем отображаемое изображение: сначала исходник, потом результат апскейла.
  const displaySrc = upscaledUrl || src;

  const handleUpscale = async () => {
    if (upscaling || isPreview || isGenerating) return;
    setUpscaling(true);
    setUpscalePct(0);
    setUpscaleErr(null);
    try {
      const result = await upscaleEngineService.upscale(src, {
        onProgress: (p) => setUpscalePct(p),
      });
      setUpscaledUrl(result.dataUrl);
      if (soundEnabled) soundEffects.modelLoaded?.();
    } catch (e: any) {
      setUpscaleErr(String(e?.message || e));
      console.error('[upscale]', e);
    } finally {
      setUpscaling(false);
    }
  };

  return (
    <div className="max-w-[min(100%,640px)] w-full mb-2 rounded-xl border border-purple-500/25 bg-[#0a0a0f] overflow-hidden shadow-lg">
      <div className="relative group">
        {!broken ? (
          <img
            src={displaySrc}
            alt={alt}
            decoding="async"
            className={`block w-full h-auto max-h-[560px] object-contain bg-[#0a0a0f] cursor-zoom-in ${
              isPreview ? 'opacity-95 ring-1 ring-purple-400/30' : ''
            } ${isGenerating && !isPreview ? 'opacity-90' : ''}`}
            onClick={onOpenLightbox}
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="p-6 text-center text-slate-400 text-xs font-mono">
            Не удалось показать превью — скачайте PNG
          </div>
        )}
        {isPreview && (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/75 text-[10px] font-mono text-purple-200 border border-purple-400/30">
            превью · формируется...
          </span>
        )}
        {/* Оверлей прогресса апскейла */}
        {upscaling && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-44 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-[#00f2ff] transition-all" style={{ width: `${Math.max(4, upscalePct)}%` }} />
            </div>
            <span className="mt-2 text-[11px] font-mono text-[#00f2ff]">
              Апскейл ×4 · {upscalePct}%
            </span>
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onOpenLightbox}
            className="p-1.5 rounded-lg bg-black/70 border border-white/10 text-slate-200 hover:text-white cursor-pointer"
            title="Открыть на весь экран"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          {imageUrl && (
            <button
              type="button"
              onClick={() => {
                const a = document.createElement('a');
                a.href = displaySrc;
                a.download = `hc-ai-${Date.now()}.png`;
                a.click();
                if (soundEnabled) soundEffects.click();
              }}
              className="p-1.5 rounded-lg bg-black/70 border border-white/10 text-slate-200 hover:text-white cursor-pointer"
              title="Скачать PNG"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {/* Панель действий — всегда видима, не зависит от hover */}
      {!isPreview && !isGenerating && (
        <div className="px-3 py-2 border-t border-white/5 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleUpscale}
            disabled={upscaling || upscalePct > 0}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono cursor-pointer transition-colors ${
              upscaledUrl
                ? 'bg-emerald-500/15 border border-emerald-400/40 text-emerald-300'
                : 'bg-[#00f2ff]/10 border border-[#00f2ff]/40 text-[#00f2ff] hover:bg-[#00f2ff]/20'
            }${upscaling ? ' disabled:opacity-60 cursor-wait' : ''}`}
            title="Увеличить изображение ×4 и убрать шум (Real-ESRGAN)"
          >
            {upscaling ? (
              <span>{upscalePct}%</span>
            ) : upscaledUrl ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <ZoomIn className="w-3.5 h-3.5" />
            )}
            <span>{upscaling ? 'Увеличиваю…' : upscaledUrl ? 'Увеличено ×4' : 'Увеличить ×4'}</span>
          </button>
          {upscaledUrl && (
            <span className="text-[10px] font-mono text-slate-400">Результат показан вверху</span>
          )}
        </div>
      )}
      {upscaleErr && (
        <div className="px-3 py-2 text-[10px] font-mono text-red-400 bg-red-500/10 border-t border-red-500/20">
          Апскейл не удался: {upscaleErr}
        </div>
      )}
      {imageMeta && (
        <div className="px-3 py-2 text-[10px] font-mono text-slate-500 border-t border-white/5 space-y-1">
          <div>
            {imageMeta.steps} steps · CFG {imageMeta.cfg}
            {imageMeta.seed >= 0 ? ` · seed ${imageMeta.seed}` : ''}
            {upscaledUrl && <span className="text-[#00f2ff]"> · увеличено ×4</span>}
          </div>
          {imageMeta.promptEn && (
            <div className="text-slate-400 normal-case leading-snug">{imageMeta.promptEn}</div>
          )}
        </div>
      )}
    </div>
  );
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[200] bg-black/92 flex items-center justify-center p-4 sm:p-8 cursor-zoom-out"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <img
        src={src}
        alt=""
        className="max-w-[min(96vw,1400px)] max-h-[92vh] w-auto h-auto object-contain shadow-2xl rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  );
}

function FormattedMessageContent({ content, soundEnabled }: { content: string; soundEnabled: boolean }) {
  // Parse code blocks with regex
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <>
      {parts.map((part, idx) => {
        if (part.startsWith('```')) {
          const firstLineEnd = part.indexOf('\n');
          const lang = part.slice(3, firstLineEnd).trim() || 'code';
          // Закрытый блок: режем ``` в конце; незакрытый (стриминг/обрыв) — код до конца текста.
          const closed = part.endsWith('```');
          const code = closed ? part.slice(firstLineEnd + 1, -3) : part.slice(firstLineEnd + 1);

          if (!code.trim()) {
            return (
              <p key={idx} className="text-slate-500 text-xs font-mono italic">
                [блок кода пуст — попробуйте «Перегенерировать» или персону «Программист»]
              </p>
            );
          }

          return <CodeSnippet key={idx} lang={lang} code={cleanCodeBody(code, lang)} soundEnabled={soundEnabled} />;
        }

        // Parse standard text lines & headers
        return (
          <div key={idx} className="whitespace-pre-wrap font-sans">
            {renderMarkdownText(part)}
          </div>
        );
      })}
    </>
  );
}

function CodeSnippet({ lang, code, soundEnabled }: { key?: React.Key; lang: string; code: string; soundEnabled: boolean }) {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    if (soundEnabled) soundEffects.click();
    setTimeout(() => setCopied(false), 2000);
  };

  const isHtml = lang === 'html' || lang === 'xml';

  return (
    <div className="my-3 rounded-xl border border-white/10 bg-[#090b10] overflow-hidden shadow-lg">
      {/* Code Header */}
      <div className="flex items-center justify-between px-3.5 py-2 bg-white/[0.03] border-b border-white/10 text-xs font-mono">
        <div className="flex items-center gap-2 text-[#00f2ff]">
          <Code2 className="w-3.5 h-3.5" />
          <span className="uppercase text-[11px] font-bold">{lang}</span>
        </div>

        <div className="flex items-center gap-2">
          {isHtml && (
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#00f2ff]/10 border border-[#00f2ff]/30 text-[#00f2ff] text-[10px] hover:bg-[#00f2ff]/20 cursor-pointer"
            >
              <Eye className="w-3 h-3" />
              <span>{showPreview ? 'Код' : 'Превью'}</span>
            </button>
          )}

          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-slate-400 hover:text-slate-200 text-[11px] transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Скопировано' : 'Копировать'}</span>
          </button>
        </div>
      </div>

      {/* Code Body or Live Preview */}
      {showPreview && isHtml ? (
        <div className="p-4 bg-white rounded-b-xl">
          <iframe
            srcDoc={code}
            title="HTML Preview"
            className="w-full min-h-[220px] border-0"
            sandbox="allow-scripts"
          />
        </div>
      ) : (
        <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed selection:bg-[#00f2ff]/30">
          <code>{highlightCode(lang, code)}</code>
        </pre>
      )}
    </div>
  );
}

function renderMarkdownText(text: string) {
  // Simple markdown renderer for bold, list, and headers
  const lines = text.split('\n');

  return lines.map((line, lIdx) => {
    if (line.startsWith('### ')) {
      return (
        <h3 key={lIdx} className="text-base font-bold text-[#00f2ff] mt-3 mb-1 font-['Syne']">
          {line.replace('### ', '')}
        </h3>
      );
    }
    if (line.startsWith('## ')) {
      return (
        <h2 key={lIdx} className="text-lg font-bold text-white mt-4 mb-2 font-['Syne']">
          {line.replace('## ', '')}
        </h2>
      );
    }
    if (line.startsWith('#### ')) {
      return (
        <h4 key={lIdx} className="text-sm font-semibold text-slate-200 mt-2 mb-1">
          {line.replace('#### ', '')}
        </h4>
      );
    }
    if (line.startsWith('* ') || line.startsWith('- ')) {
      return (
        <div key={lIdx} className="flex items-start gap-2 my-1 pl-1">
          <span className="text-slate-500 mt-0.5 shrink-0">–</span>
          <span>{renderInlineFormatting(line.slice(2))}</span>
        </div>
      );
    }

    return (
      <p key={lIdx} className={line.trim() === '' ? 'h-2' : 'my-1'}>
        {renderInlineFormatting(line)}
      </p>
    );
  });
}

function renderInlineFormatting(text: string) {
  // Replace **bold** and `code`
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);

  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={idx} className="px-1.5 py-0.5 rounded bg-white/[0.08] text-[#00f2ff] font-mono text-xs border border-white/10">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
// Лёгкая подсветка синтаксиса без внешних зависимостей.
// Определяет язык и раскрашивает ключевые слова, строки, комментарии, числа, теги.
const HIGHLIGHT_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch',
  'case', 'break', 'continue', 'import', 'export', 'from', 'default', 'new', 'class',
  'extends', 'super', 'async', 'await', 'try', 'catch', 'finally', 'typeof', 'instanceof',
  'in', 'of', 'this', 'null', 'undefined', 'true', 'false', 'package', 'interface', 'type',
  'enum', 'public', 'private', 'protected', 'static', 'readonly',
]);

// Цвета темы (тёмная).
const C = {
  str: '#a5d6ff',      // строки
  num: '#f9c74f',      // числа
  kw: '#00f2ff',       // ключевые слова (циан)
  comment: '#7d8590',  // комментарии
  tag: '#f07178',      // html-теги
  attr: '#82aaff',     // html-атрибуты
  css: '#c792ea',      // css-селекторы/свойства
  fn: '#82aaff',       // функции
  punct: '#9aa5b1',    // пунктуация
};

function tok(text: string, color?: string, className?: string) {
  return <span key={text + (Math.random() * 1e7 | 0)} className={className || ''} style={color ? { color } : undefined}>{text}</span>;
}

function highlightCode(lang, raw) {
  const code = String(raw || '');
  const lines = code.split('\n');

  const renderLine = (line: string, lineIdx: number) => {
    const lineNo = lineIdx + 1;
    const html = lang === 'html' || lang === 'xml' || lang === 'markup'
      ? highlightHtml(line)
      : lang === 'css'
      ? highlightCss(line)
      : highlightJs(line, lang);

    return (
      <div key={lineIdx} className="flex">
        <span className="select-none text-right pr-3 text-slate-600 w-8 shrink-0">{lineNo}</span>
        <span className="whitespace-pre">{html}</span>
      </div>
    );
  };

  return (
    <div className="space-y-0">
      {code.split('\n').map((l, i) => renderLine(l, i))}
    </div>
  );
}

function highlightJs(line, lang) {
  const parts = [];
  // комментарии
  const commentMatch = line.match(/^(\s*)(\/\/.*|\/\*[\s\S]*)$/);
  if (commentMatch && !line.includes('"') && !line.includes("'")) {
    return tok(commentMatch[1] + commentMatch[2], C.comment);
  }
  // строки
  const strRe = /("[^"]*"|'[^']*'|`[^`]*`)/g;
  let lastIdx = 0;
  let m;
  const out = [];
  while ((m = strRe.exec(line)) !== null) {
    if (m.index > lastIdx) {
      const pre = line.slice(lastIdx, m.index);
      if (pre.trim()) out.push(tok(pre, undefined, ''));
      else if (pre) out.push(tok(pre, undefined, ''));
    }
    out.push(tok(m[0], C.num));
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < line.length) out.push(tok(line.slice(lastIdx), undefined, ''));

  // keywords, numbers, function calls
  const final = [];
  for (let i = 0; i < out.length; i++) {
    let el = out[i];
    if (el.props.style === undefined) {
      const words = String(el.props.children || '').split(/([^\w\s])/g);
      final.push(...words.map((w) => {
        if (!w) return '';
        if (HIGHLIGHT_KEYWORDS.has(w)) return tok(w, C.kw);
        if (/^\d+(\.\d+)?$/.test(w)) return tok(w, C.num);
        return w;
      }));
    } else {
      final.push(el);
    }
  }
  return (
    <>{final}</>
  );
}

function highlightCss(line) {
  const out = [];
  const re = /(\{|\}|\;|\:)|([a-zA-Z-]+)(?=\s*:)|(#[0-9a-fA-F]{3,8})|(--?[a-zA-Z][\w-]*)/g;
  // Упрощённо: свойства с двоеточием, селекторы, hex-цвета
  const inComment = line.includes('/*');
  let cursor = 0;
  let m;
  const re2 = /(".*?"|'[^']*'|\/\*[\s\S]*?\*\/|#[0-9a-fA-F]{3,8}|\b\d+(?:\.\d+)?(?:px|em|rem|%)?\b|([\w-]+)\s*:|\{|\})/g;
  const seg = [];
  while ((m = re2.exec(line)) !== null) {
    if (m.index > cursor) seg.push(tok(line.slice(cursor, m.index), undefined, ''));
    const t = m[0];
    if (t.includes('#')  || /^\d/.test(t)|| t.includes('/*')) {
      seg.push(tok(t, t.includes('#') || /^\d/.test(t) ? C.num : C.comment));
    } else if (t.includes(':')) {
      seg.push(tok(t.replace(':',''), C.css));
    } else seg.push(tok(t, undefined, ''));
    cursor = m.index + t.length;
  }
  if (cursor < line.length) seg.push(tok(line.slice(cursor), undefined, ''));
  return <>{seg}</>;
}

function highlightHtml(line) {
  const out = [];
  const re = /(<\/?)([\w-]+)|([\w-]+)\s?=|("[^"]*")|(&[a-z]+;|\s*\/>|>)/g;
  let cursor = 0;
  let m;
  const seg = [];
  while ((m = re.exec(line)) !== null) {
    if (m.index > cursor) seg.push(tok(line.slice(cursor, m.index), undefined, ''));
    if (m[2]) seg.push(tok(m[1] + m[2], C.tag));
    else if (m[3]) seg.push(tok(m[3], C.attr));
    else if (m[4]) seg.push(tok(m[4], C.num));
    else seg.push(tok(m[0], C.tag));
    cursor = m.index + m[0].length;
  }
  if (cursor < line.length) seg.push(tok(line.slice(cursor), undefined, ''));
  return <>{seg}</>;
}
