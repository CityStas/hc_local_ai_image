// main.cjs — главный процесс Electron.
// HC AI Light 0.8B (Qwen) GGUF исполняется ЛОКАЛЬНО через node-llama-cpp.
// Используем LlamaChatSession: авто-подбор chat wrapper под модель,
// системный промпт передаётся через конструктор, история накапливается
// в контекстной последовательности сессии автоматически.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const sdEngine = require('./sdEngine.cjs');
const vlmEngine = require('./vlmEngine.cjs');
const prefetch = require('./prefetch.cjs');
const upscaleEngine = require('./upscaleEngine.cjs');

// Имя приложения: видно в окне, в диспетчере задач и задаёт папку профиля
// в %APPDATA%. До 2026-10-01 приложение называлось HotCache AI.
const APP_NAME = 'HC AI';
const LEGACY_APP_NAME = 'HotCache AI';

// Фиксируем имя профиля независимо от productName в сборке — иначе после
// переименования exe слетит путь к истории чатов и настройкам.
app.setName(APP_NAME);

// Переезд профиля. Папка в %APPDATA% зовётся по имени приложения, а в её
// Local Storage лежат сессии чатов, свои GGUF и настройки. После переименования
// Electron взял бы пустую папку, и это выглядело бы как сброс приложения.
//
// Идёт ДО настройки лога, и это принципиально: лог ниже делает mkdirSync, то есть
// создаёт папку с новым именем, после чего проверка «новой ещё нет» всегда ложна
// и перенос молча не случается. Результат возвращаем строкой, чтобы записать его
// в файл уже после того, как лог поднят.
const migrateResult = (function migrateProfile() {
  try {
    const appData = app.getPath('appData');
    const from = path.join(appData, LEGACY_APP_NAME);
    const to = path.join(appData, APP_NAME);
    if (!fs.existsSync(from)) return '';
    if (fs.existsSync(to)) return 'профиль не переносил: папка ' + APP_NAME + ' уже есть';
    fs.renameSync(from, to);
    return 'профиль перенесён: ' + LEGACY_APP_NAME + ' → ' + APP_NAME;
  } catch (e) {
    return 'профиль перенести не удалось, данные остались в ' + LEGACY_APP_NAME + ': ' + e.message;
  }
})();

// ---------- Лог в файл (виден даже при вылете): %APPDATA%\HC AI\hc-ai.log ----------
try {
  const logDir = path.join(app.getPath('appData'), APP_NAME);
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'hc-ai.log');
  const origErr = console.error.bind(console);
  console.error = (...args) => {
    try { fs.appendFileSync(logPath, new Date().toISOString() + ' ' + args.map(a => (a && a.stack) ? a.stack : String(a)).join(' ') + '\n'); } catch {}
    origErr(...args);
  };
} catch {}

if (migrateResult) console.error('[hc] ' + migrateResult);

// Защита от двойного запуска: если копия уже открыта — фокус на неё и выход.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Встроенные GGUF-модели для dev (`npm start`) и сборки (extraResources).
// Вторая модель переиспользует уже скачанный VLM-бандл Qwen2.5-VL-7B:
// node-llama-cpp может грузить её как обычную LLM (текст→текст) и в чате.
const MODELS = [
  {
    id: 'qwen-0.8b',
    name: 'HC AI Light 0.8B',
    dir: 'qwen-3.5-0.8b',
    file: 'qwen-3.5-0.8b.gguf',
    gpuLayers: 999,
    ctx: 4096,
    fast: true,
    wrapper: 'qwen3.5',
    size: '517 MB',
    quant: 'Q4_K_M',
    family: 'HC AI Light',
    vramRequirementMb: 700,
    description: 'Встроенная лёгкая модель. Быстрые и точные ответы, малый расход памяти.',
  },
  {
    id: 'qwen2.5-vl-chat',
    name: 'Qwen2.5-VL 7B (чат)',
    dir: 'Qwen2.5-VL-7B',
    file: 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf',
    gpuLayers: 999,
    ctx: 4096,
    fast: false,
    wrapper: 'qwen',
    size: '~4.4 GB',
    quant: 'Q4_K_M',
    family: 'Qwen2.5-VL',
    vramRequirementMb: 4800, // в VRAM для чистого текста (~4.4GB + буферы)
    description: 'Полноценная 7B-модель, отвечает в чате и знает русский. Тяжелее: ~4-5 GB VRAM.',
  },
];

// Ищет GGUF-файл модели в (1) упакованных extraResources, (2) electron/dist/resources,
// (3) рядом с __dirname. Возвращает путь или null.
function resolveModelPath(dir, file) {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, dir, file));
    candidates.push(path.join(process.resourcesPath, 'resources', dir, file));
  }
  const electronRes = path.join(__dirname, 'node_modules', 'electron', 'dist', 'resources', dir, file);
  const localRes = path.join(__dirname, 'resources', dir, file);
  const parent = path.join(__dirname, '..', dir, file);
  const local = path.join(__dirname, dir, file);
  candidates.push(electronRes, localRes, parent, local);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const MODELS_PATHS = MODELS.map((m) => ({ ...m, path: resolveModelPath(m.dir, m.file) }));

async function createChatWrapper(_mdl, desc) {
  if (!nlc) nlc = await import('node-llama-cpp');
  // Правильный chat-wrapper зависит от модели:
  //   qwen3.5  → variation «3.5» (Qwen3 / HC AI Light 0.8B)
  //   qwen     → variation «3»  (Qwen2.5 / Qwen2.5-VL — тот же chatml im_start)
  // Захардкоженный QwenChatWrapper('3.5') ломал Qwen2.5-VL: она получала
  // шаблон Qwen3 и отвечала мусором/пустотой.
  const w = String((desc && desc.wrapper) || 'qwen3.5').toLowerCase();
  if (w === 'qwen' || w === 'qwen2' || w === 'qwen2.5') {
    return new nlc.QwenChatWrapper({ variation: '3', thoughts: 'discourage' });
  }
  return new nlc.QwenChatWrapper({ variation: '3.5', thoughts: 'discourage' });
}

// Sync with src/data/personas.ts DEFAULT_SYSTEM_PROMPT (all platforms identical).
const DEFAULT_SYSTEM_PROMPT =
  'Ты HC AI, офлайн-помощник.\n' +
  'Русский язык. Не представляйся и не пиши «я HC AI» в ответе.\n' +
  'Если просят код — СНАЧАЛА ``` блок только с кодом (без рассуждений внутри), потом 1–2 строки снаружи.\n' +
  'Не отказывай. На любой вопрос — полезный ответ по существу.\n' +
  'Отвечай просто и по делу. Примеры и списки — когда уместно.';

const MAX_OUTPUT_TOKENS = 1024;

function buildEffectiveSystemPrompt(config) {
  const preset = (config?.systemPromptPreset || '').trim() || DEFAULT_SYSTEM_PROMPT;
  const custom = (config?.systemPromptCustom || '').trim();
  return custom ? preset + '\n' + custom : preset;
}

function isCodeRequest(text) {
  const l = String(text || '').toLowerCase();
  return /html|css|javascript|\bjs\b|код|калькулятор|страниц|сайт|скрипт|react|python|программ|верст|компонент|api|sql/.test(l);
}

function hasSubstantialCode(text) {
  const re = /```[\w]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1].trim().length >= 40) return true;
  }
  return false;
}

function isProseLine(line) {
  const t = String(line || '').trim();
  if (!t) return false;
  if (/^(<!DOCTYPE|<html|<head|<body|<style|<script|<meta|<link|<div|<svg|<table|<!)/i.test(t)) return false;
  if (/^(\/\*|\/\/|#|\.|[a-z-]+\s*\{|@media|import |export |const |let |var |function |class |<[a-z])/i.test(t)) return false;
  if (/^[\{\}\[\];]/.test(t)) return false;
  if (/[а-яё]/i.test(t) && !/[<>{};=]/.test(t)) return true;
  if (/^(here|this|the |i |you |---)/i.test(t)) return true;
  if (/^(вот |готов|полный|рабоч|калькулятор|скопир|сохран|открой|файл|что я|я сделал|я использовал)/i.test(t) && !/[<>]/.test(t)) return true;
  return false;
}

function cleanCodeBody(body, lang) {
  let b = String(body || '').trim();
  if (!b) return b;
  const lg = String(lang || '').toLowerCase();
  if (lg === 'html' || lg === 'htm' || lg === '' || /<html|<!doctype/i.test(b)) {
    const start = b.search(/<!DOCTYPE html|<html[\s>]/i);
    if (start > 0) b = b.slice(start);
    const end = b.search(/<\/html>/i);
    if (end >= 0) b = b.slice(0, end + 7);
  }
  const lines = b.split('\n');
  let from = 0;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) { from = i + 1; continue; }
    if (isProseLine(lines[i])) from = i + 1;
    else break;
  }
  b = lines.slice(from).join('\n').trim();
  if (/<\/html>/i.test(b)) {
    const end = b.search(/<\/html>/i);
    b = b.slice(0, end + 7);
  }
  return b.trim();
}

function sanitizeModelOutput(text) {
  let t = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .trim();
  t = t.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, body) => {
    const cleaned = cleanCodeBody(body, lang);
    if (!cleaned) return '';
    return '```' + (lang || 'html') + '\n' + cleaned + '\n```';
  });
  const rawHtml = t.match(/(?:^|\n)\s*(<!DOCTYPE html[\s\S]*<\/html>)/i);
  if (rawHtml && rawHtml[1] && !t.includes('```')) {
    const cleaned = cleanCodeBody(rawHtml[1], 'html');
    const before = t.slice(0, t.indexOf(rawHtml[1])).trim();
    t = (before ? before + '\n\n' : '') + '```html\n' + cleaned + '\n```';
  }
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

function prepareUserPrompt(raw, codeReq, messages) {
  if (!codeReq) return raw;
  const users = (messages || []).filter((m) => m.role === 'user');
  const assistants = (messages || []).filter((m) => m.role === 'assistant');
  const prevUser = users.length >= 2 ? users[users.length - 2] : null;
  const prevAsst = assistants.length >= 1 ? assistants[assistants.length - 1] : null;
  if (prevUser && prevAsst && isCodeRequest(prevUser.content) && !hasSubstantialCode(prevAsst.content || '')) {
    return (
      `Ранее просили: «${String(prevUser.content).slice(0, 180)}» — код был неполный или пустой.\n` +
      `Сейчас: ${raw}\n\n` +
      'Дай ПОЛНЫЙ рабочий код в ```html (или другом) блоке. Без приветствия и без «я HC AI».'
    );
  }
  return raw + '\n\nОтвет: сначала полный рабочий код в ```html (или ```) блоке. Без приветствия.';
}

const clamp = (v, lo, hi) => Math.min(Math.max(Number(v) || lo, lo), hi);

// Гиперпараметры, оптимизированные под 0.8B (~80–100 tok/s на 2060 Super).
// dryRepeatPenalty рвёт зацикленные повторы, на которых мелкая модель «застревает».
const GEN_DEFAULTS = {
  temperature: 0.5,
  topK: 40,
  topP: 0.9,
  minP: 0.05,
  repeatPenalty: 1.1,
  dryRepeatPenalty: {
    strength: 0.9,
    base: 1.75,
    allowedLength: 2,
    lastTokens: 120,
    sequenceBreakers: ['\n', ':', '"', '*', '-', '—'],
  },
  maxTokens: 2048,
};

// Честный калькулятор простой арифметики (не «под фразу», а общая математика).
// Возвращает строку-результат или null если выражение НЕ является простой арифметикой.
const ARITH_RE = /^\s*\(?\s*(-?\d+(?:[.,]\d+)?)\s*([+\-*/x×÷:])\s*(-?\d+(?:[.,]\d+)?)\s*\)?\s*[=:?]?\s*$/i;
function computeArithmetic(prompt) {
  const m = ARITH_RE.exec(String(prompt || '').trim().replace(/\s+/g, ' '));
  if (!m) return null;
  const a = parseFloat(m[1].replace(',', '.'));
  const b = parseFloat(m[3].replace(',', '.'));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  let r;
  switch (m[2]) {
    case '+': r = a + b; break;
    case '-': r = a - b; break;
    case '*': case 'x': case '×': r = a * b; break;
    case '/': case ':': case '÷':
      if (b === 0) return null;
      r = a / b; break;
    case '%': r = a % b; break;
    default: return null;
  }
  return Number.isInteger(r) ? String(r) : String(Math.round(r * 1e6) / 1e6);
}

// Маркеры утечки системного промпта / шаблонов «псевдо-задач» (эхо персоны из UI).
const LEAK_MARKERS = [
  'you are a', 'you need to be', 'systems & software architect',
  'production-grade', 'write a function that takes a list',
  'please continue', 'task resumption',
];

// Вырожденный вывод: пустота, эхо вопроса, пустой код, «персона-эхо», зацикленные повторы.
function isDegenerate(output, plainPrompt, tokens, codeReq) {
  const t = String(output || '').trim();
  if (!t) return true;

  // Реальный код в ответе — всегда принимаем
  if (hasSubstantialCode(t)) return false;

  // Просили код — а блок пустой или его нет
  if (codeReq && t.length > 50) {
    if (/```[\w]*\s*\n\s*```/.test(t)) return true;
    if (!hasSubstantialCode(t) && /код|html|```/i.test(t)) return true;
  }

  // Короткое эхо персоны вместо ответа. Имя персоны в промпте — HC AI, поэтому
  // в список входит hc(\s*ai)?: без него модель на «кто ты» отвечала «я HC AI»
  // и это считалось нормальным ответом. База и nexus — прежние имена персоны.
  if (t.length < 150 && /^я[\s\—\-]*(hc(\s*ai)?|база|nexus)/i.test(t)) return true;
  if (t.length < 200 && /^(привет|здравствуй)/i.test(t) && /(я[\s\—\-]*(hc(\s*ai)?|база)|дружелюбный.*помощник)/i.test(t)) return true;

  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const np = norm(plainPrompt);
  const nt = norm(t);
  if (np && nt === np) return true;
  if (np && np.length <= 8 && t.length > 120) return true;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 30) {
    const uniq = new Set(words.map((w) => w.toLowerCase().replace(/[.,;:!?]+/g, ''))).size;
    const ratio = uniq / words.length;
    if (ratio < 0.28) return true;
    if ((tokens || 0) > 200 && ratio < 0.42) return true;
  }

  const low = t.toLowerCase();
  let hits = 0;
  for (const marker of LEAK_MARKERS) {
    if (low.includes(marker)) {
      hits++;
      if (hits > 1) return true;
    }
  }
  return hits === 1 && t.length > 400;
}
// ---------- Состояние ----------
// node-llama-cpp — это ESM-модуль, поэтому грузим его динамическим import() (требуется в CJS).
let nlc = null;
let llama = null;
let llmGpuLabel = null; // 'NVIDIA GeForce RTX 2060 SUPER' или null (CPU)
const loadedModels = new Map(); // modelId -> LlamaModel
let mainWindow = null;
let activeAbort = null;
const sessions = new Map();      // key: `${modelId}:${sessionId}` -> LlamaChatSession
const sessionsByUser = new Map(); // sessionId -> modelId (какая модель сейчас у сессии)

// Кэш сессии перевода (маленький контекст, переиспользуется между генерациями)
let translateSession = null;
let translateCtx = null;

// Отдельная сессия EN→RU (перевод ответа Moondream на русский)
let vlmEnRuSession = null;
let vlmEnRuCtx = null;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// Грузит одну модель по описанию (idempotent). AI: авто-подбор chat wrapper.
async function ensureModel(desc) {
  const key = desc.id;
  if (loadedModels.has(key)) return loadedModels.get(key);
  if (!nlc) nlc = await import('node-llama-cpp'); // ESM -> CJS
  // Каскад GPU: сначала CUDA (2060 и пр.), затем Vulkan (слабые/другие GPUs), потом CPU.
  // На слабых ПК без GPU честно работает CPU — приложение остаётся лёгким.
  if (!llama) {
    const attempts = ['cuda', 'vulkan', 'auto'];
    let lastErr = null;
    for (const gpu of attempts) {
      try {
        llama = await nlc.getLlama({ gpu, build: 'never' });
        console.error('[hc] движок поднялся, попытка gpu=' + gpu);
        break;
      } catch (e) {
        lastErr = e;
        console.error('[hc] gpu=' + gpu + ' недоступен: ' + (e?.message || e));
      }
    }
    if (!llama) throw lastErr || new Error('Не удалось инициализировать llama-cpp');
  }
  // Диагностика скорости: на чём реально считается инференс.
  // ВАЖНО: getGpuDeviceNames() асинхронный — нужно await, иначе всегда печатает «CPU».
  try {
    let names = null;
    if (typeof llama.getGpuDeviceNames === 'function') {
      const res = llama.getGpuDeviceNames();
      names = Array.isArray(res) ? res : (res && typeof res.then === 'function') ? await res : null;
    }
    console.error('[hc] инференс:', names && names.length ? ('GPU: ' + names.join(', ')) : 'CPU');
    llmGpuLabel = names && names.length ? names.join(', ') : null;
  } catch (e) {
    console.error('[hc] инференс: не удалось определить (' + (e?.message || e) + ')');
  }

  // Прогресс загрузки в UI.
  send('llm:status-update', { progress: 15, text: 'Инициализация движка llama-cpp...' });
  try {
    const m = await llama.loadModel({
      modelPath: desc.path,
      gpuLayers: desc.gpuLayers,
      enableLogs: false,
      threads: 0, // авто — задействует все доступные ядра CPU
    });
    send('llm:status-update', { progress: 100, text: 'Модель готова' });
    loadedModels.set(key, m);
    console.log('[hc] модель загружена:', desc.name, '(' + desc.path + ')');
    return m;
  } catch (e) {
    send('llm:status-update', { progress: 0, text: 'Ошибка загрузки модели', error: String(e?.message || e) });
    throw e;
  }
}

// Загружает встроенную модель при старте.
async function ensureAllModels() {
  const results = [];
  for (const desc of MODELS_PATHS) {
    if (!desc.path) { console.warn('[hc] не найден GGUF:', desc.id); continue; }
    try { results.push(await ensureModel(desc)); }
    catch (e) { console.error('[hc] не удалось загрузить ' + desc.id + ':', e?.message); }
  }
  return results;
}

// Сессия привязана к КОНКРЕТНОЙ модели: key = `${modelId}:${sessionId}`.
async function getOrCreateSession(modelId, sessionId, systemPrompt) {
  const key = modelId + ':' + sessionId;
  const sp = systemPrompt || DEFAULT_SYSTEM_PROMPT;
  let session = sessions.get(key);
  if (session && session.__systemPrompt !== sp) {
    resetSession(modelId, sessionId);
    session = null;
  }
  if (!session) {
    const desc = MODELS_PATHS.find((m) => m.id === modelId);
    const mdl = await ensureModel(desc);
    const ctx = await mdl.createContext({ contextSize: desc.ctx, threads: 0 });
    const chatWrapper = await createChatWrapper(mdl, desc);
    session = new nlc.LlamaChatSession({
      contextSequence: ctx.getSequence(),
      systemPrompt: sp,
      chatWrapper,
    });
    session.__ctx = ctx;
    session.__systemPrompt = sp;
    sessions.set(key, session);
    sessionsByUser.set(sessionId, modelId);
  }
  return session;
}

function resetSession(modelId, sessionId) {
  const key = modelId + ':' + sessionId;
  const s = sessions.get(key);
  if (s) {
    sessions.delete(key);
    sessionsByUser.delete(sessionId);
    try { s.dispose(); } catch {}
    const ctx = s.__ctx;
    if (ctx) { try { ctx.dispose().catch(() => {}); } catch {} }
  }
}

// Одноразовая сессия для вопросов с прикреплёнными файлами: содержимое файла
// не остаётся в долговременной истории диалога → tok/s будущих ответов не падает.
async function createEphemeralSession(modelId, systemPrompt) {
  const desc = MODELS_PATHS.find((m) => m.id === modelId);
  const mdl = await ensureModel(desc);
  const ctx = await mdl.createContext({ contextSize: Math.min(desc.ctx, 4096), threads: 0 });
  const sp = systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const chatWrapper = await createChatWrapper(mdl, desc);
  const session = new nlc.LlamaChatSession({
    contextSequence: ctx.getSequence(),
    systemPrompt: sp,
    chatWrapper,
  });
  session.__ctx = ctx;
  session.__systemPrompt = sp;
  return session;
}
function disposeSession(session) {
  try { session.dispose(); } catch {}
  try { if (session.__ctx) session.__ctx.dispose().catch(() => {}); } catch {}
}

/** Освобождает VRAM LLM перед генерацией картинки (SD + LLM на одной GPU). */
async function unloadLlmForImageGen() {
  const keys = [...sessions.keys()];
  for (const key of keys) {
    const sid = key.includes(':') ? key.split(':').slice(1).join(':') : key;
    const mid = key.includes(':') ? key.split(':')[0] : null;
    if (mid) resetSession(mid, sid);
  }
  for (const [id, mdl] of loadedModels.entries()) {
    try {
      // dispose может повиснуть, если где-то осталась живая последовательность —
      // не даём заблокировать vlm:analyze навсегда
      await Promise.race([
        mdl.dispose(),
        new Promise((resolve) => setTimeout(resolve, 10000)),
      ]);
    } catch (e) {
      console.error('[hc] unload LLM model', id, e?.message || e);
    }
    loadedModels.delete(id);
  }
  console.error('[hc] LLM выгружен для HC AI (освобождение VRAM)');
}

function shouldUnloadLlmBeforeSd(options, sdStatus) {
  if (options.unloadLlmBeforeImage === false) return false;
  if (options.unloadLlmBeforeImage === true) return true;
  // auto: HC AI Light 0.8B занимает ~700MB VRAM. SD диффузия ~4GB + VAE ~300MB + буферы ~1.5GB
  // На 8GB RTX итого ~6.5GB → выгружать не нужно, память не кончится
  // Выгружаем только если явно указано или если LLM > 1.5GB (большая модель)
  const sdGpu = sdStatus?.deviceType === 'cuda' || sdStatus?.deviceType === 'vulkan';
  if (!sdGpu || !llmGpuLabel || loadedModels.size === 0) return false;
  // Если VRAM загруженной чат-модели > 1.5GB (например Qwen2.5-VL 7B ~4.8GB) — выгружаем.
  return currentLlmVramMb() > 1500;
}

// Сколько VRAM сейчас занимают загруженные чат-LLM (сумма по моделям).
function currentLlmVramMb() {
  let total = 0;
  for (const id of loadedModels.keys()) {
    const d = MODELS_PATHS.find((m) => m.id === id);
    total += (d && d.vramRequirementMb) || 700;
  }
  return total;
}

// ── Бюджетный арбитр VRAM (RTX 2060 Super, 8 GB) ────────────────────────────
// Единственное место, где задаются «сколько весит модель в VRAM», чтобы решения
// SD/VLM были согласованы и легко менялись под другие карты/модели.
// Модель веса берём с запасом на буферы вычислений, чтобы не упереться в OOM.
const VRAM = Object.freeze({
  budgetMb: 8 * 1024, // физический объём карты
  reserveMb: 900,     // буферы вычислений, композит, фон, запас
  llmMb: 700,         // HC AI Light 0.8B в VRAM
  sdMb: 6500,         // sd-server (диффузия + VAE-буферы)
  vlmMb: 6000,        // llama-server (Qwen2.5-VL, mmproj на CPU)
});

/**
 * Можно ли держать LLM в VRAM вместе с VLM-сервером?
 * HC AI Light (0.7GB) + VLM (6GB) = ~6.7GB < 8GB — да, помещается.
 * Но если в чат выбран Qwen2.5-VL 7B (~4.8GB) — уже 4.8+6=10.8GB > 8GB,
 * тогда выгружаем чат-модель перед Vision, чтобы llama-server не упал по OOM.
 * @param {boolean} sdFreed — реально ли освободил VRAM sd-server (иначе мест мало).
 */
function shouldUnloadLlmForVlm(sdFreed) {
  if (!sdFreed) return true; // sd-server не погашен → VRAM забита → выгружаем LLM как запасной
  const llmMb = currentLlmVramMb();
  return llmMb + VRAM.vlmMb + VRAM.reserveMb > VRAM.budgetMb; // 0.8B → false; 7B → true
}

const CYRILLIC_RE = /[\u0400-\u04FF]/;

/**
 * Классифицирует запрос пользователя: доработка предыдущего изображения (EDIT)
 * или создание нового (NEW). HC AI Light, один короткий ответ.
 */
async function classifyEditIntent(userRequest, prevPromptEn) {
  const raw = String(userRequest || '').trim();
  if (!raw || !prevPromptEn) return 'new';
  let session = null;
  let ctx = null;
  try {
    const created = await createTranslateSession(
      'You classify image generation requests. Answer with exactly one word: EDIT or NEW.',
      1024
    );
    session = created.session;
    ctx = created.ctx;
    if (!session) return 'new';
    const result = await session.prompt(
      `Previously generated image (prompt): "${prevPromptEn.slice(0, 400)}"\n` +
      `New user request: "${raw.slice(0, 400)}"\n` +
      'EDIT = user wants to modify, improve, fix or continue THAT existing image ' +
      '(e.g. "make it more saturated", "change background to night", "add a hat", "fix the hands").\n' +
      'NEW = user describes a completely different new image.\n' +
      'Answer only one word: EDIT or NEW.',
      { maxTokens: 6, temperature: 0.0, topP: 0.1 }
    );
    const ans = String(result || '').toUpperCase();
    const verdict = /EDIT/.test(ans) ? 'edit' : (/NEW/.test(ans) ? 'new' : null);
    console.error('[hc/sd] classify edit-intent:', raw, '→', verdict || 'new (fallback)');
    return verdict || 'new';
  } catch (e) {
    console.error('[hc/sd] classify edit-intent error:', e?.message || e);
    return 'new';
  } finally {
    try { session?.dispose(); } catch {}
    try { ctx?.dispose().catch(() => {}); } catch {}
  }
}

function sanitizeSdTranslate(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^translate[d]?:?\s*/i, '')
    .trim();
}

/** 0.8B тянет few-shot в ответ — вырезаем то, чего не было в запросе. */
function stripSdHallucinations(original, translated) {
  let out = String(translated || '');
  const src = String(original || '').toLowerCase();
  const has = (re) => re.test(src);

  // Панда: только если в запросе нет ни панды, ни медведя — убираем
  const hasPanda = /панд|panda/i.test(src);
  if (!hasPanda) {
    out = out.replace(/\b(?:giant\s+)?panda(?:s)?\b/gi, '');
  } else {
    // Если панда есть — не даём подменить её на panther/poodle/samoyed
    out = out.replace(/\bpanthers?\b/gi, 'panda').replace(/\bpoodles?\b/gi, 'panda').replace(/\bsamoyeds?\b/gi, 'panda');
  }

  // Защита ключевых существ: переводчик 0.8B иногда подменяет животное на
  // «man/person/woman». Если животное есть в RU, а в EN его нет — ставим обратно.
  const species = [
    { re: /(?:панда|панд|panda)/i, en: ['panda'], generic: /(?:^|\s)(a |the |an )?(man|person|woman|guy|gentleman|figure|character)(?=\s|,|\.)/gi },
    { re: /(?:кот|кошк|cat)/i, en: ['cat'], generic: /(?:^|\s)(a |the |an )?(man|person|woman|figure|character)(?=\s|,|\.)/gi },
    { re: /(?:собак|dog)/i, en: ['dog'], generic: /(?:^|\s)(a |the |an )?(man|person|woman|figure|character)(?=\s|,|\.)/gi },
    { re: /(?:лис[аи]|fox)/i, en: ['fox'], generic: /(?:^|\s)(a |the |an )?(man|person|woman|figure|character)(?=\s|,|\.)/gi },
    { re: /(?:медвед|bear)/i, en: ['bear'], generic: /(?:^|\s)(a |the |an )?(man|person|woman|guy|figure|character)(?=\s|,|\.)/gi },
  ];
  for (const sp of species) {
    if (sp.re.test(src)) {
      const present = sp.en.some((w) => new RegExp(`\\b${w}`, 'i').test(out));
      if (!present) {
        // Подставить животное вместо generic-существительного (первое вхождение).
        out = out.replace(sp.generic, (m) => 'a ' + sp.en[0]);
      }
    }
  }

  if (!has(/fisheye|фишай|рыбий\s*глаз/i)) {
    out = out.replace(/\bfisheye(?:\s+lens)?(?:\s+effect)?\b/gi, '');
  }
  if (!has(/самоед|samoyed/i)) out = out.replace(/\bsamoyed(?:\s+dog)?\b/gi, '');
  if (!has(/пудел|poodle/i)) out = out.replace(/\bpoodles?\b/gi, '');
  if (!has(/natural\s+light|естественн\w*\s*свет/i)) {
    out = out.replace(/,?\s*natural (?:day)?light\b/gi, '');
  }
  if (!has(/hyper-?real|гиперреал/i)) {
    out = out.replace(/\bhyper-?realistic(?:\s+style)?\b/gi, 'realistic');
  }

  return out.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/^[,.\s]+|[,.\s]+$/g, '').trim();
}

/** Z-Image хочет естественный EN caption, не словарный набор слов. */
async function translateImagePromptWithLlm(ruPrompt) {
  const desc = MODELS_PATHS.find((m) => m.path);
  if (!desc) return ruPrompt;

  send('sd:progress', { progress: 4, text: 'Дождитесь результата...', phase: 'load' });

  // Свежая сессия на каждый вызов: в node-llama-cpp v3 у LlamaChatSession НЕТ
  // resetChat() — вызов падал и перевод промпта всегда ломался (кириллица уходила в SD).
  try {
    const { session, ctx } = await createTranslateSession(
      'You are a translator. Translate Russian to English. Write only the translation in English. Keep full detail, do not summarize or skip any part: clothing, pose, background, lighting, colors, composition. Do not add anything.',
      1024
    );
    if (!session) return ruPrompt;

    try {
      const result = await session.prompt(ruPrompt, {
        maxTokens: 600,
        temperature: 0.2,
        topP: 0.9,
        repeatPenalty: 1.1,
      });
      let en = sanitizeSdTranslate(result);
      en = stripSdHallucinations(ruPrompt, en);
      if (en && !CYRILLIC_RE.test(en) && en.length >= 8) {
        console.error('[hc/sd] RU→EN:', ruPrompt, '→', en);
        return en;
      }
    } finally {
      try { session?.dispose(); } catch {}
      try { ctx?.dispose().catch(() => {}); } catch {}
    }
  } catch (e) {
    console.error('[hc/sd] translate:', e?.message || e);
  }
  return ruPrompt;
}

/**
 * RU→EN для промпта VLM (Moondream слабо знает русский).
 * Свежая сессия на каждый вызов (без resetChat/кэша).
 * Вызывать ДО выгрузки LLM (пока модель загружена).
 */
async function translateRuToEnVlm(text) {
  const raw = String(text || '').trim();
  if (!raw || !CYRILLIC_RE.test(raw)) return text;

  try {
    const { session, ctx } = await createTranslateSession(
      'You are a translator. Translate Russian to English. Write only the translation. Do not add anything.',
      512
    );
    if (!session) return text;
    try {
      const result = await session.prompt(raw, {
        maxTokens: 200,
        temperature: 0.1,
        topP: 0.9,
        repeatPenalty: 1.1,
      });
      const en = sanitizeSdTranslate(result);
      if (en && !CYRILLIC_RE.test(en) && en.length >= 6) {
        console.error('[hc/vlm] RU→EN:', raw, '→', en);
        return en;
      }
    } finally {
      // ОБЯЗАТЕЛЬНО освобождаем: утечённые последовательности блокируют
      // последующий dispose() модели → вечно висящий vlm:analyze
      try { session?.dispose(); } catch {}
      try { ctx?.dispose().catch(() => {}); } catch {}
    }
  } catch (e) {
    console.error('[hc/vlm] RU→EN translate:', e?.message || e);
  }
  return text;
}

/**
 * Создаёт свежую одноразовую сессию перевода (не переиспользуется между вызовами,
 * чтобы избежать "No sequences left" / отсутствующего resetChat в node-llama-cpp).
 */
async function createTranslateSession(systemPrompt, ctxSize) {
  const desc = MODELS_PATHS.find((m) => m.path);
  if (!desc) return null;
  const mdl = await ensureModel(desc);
  const ctx = await mdl.createContext({ contextSize: ctxSize, threads: 0 });
  const chatWrapper = await createChatWrapper(mdl, desc);
  const session = new nlc.LlamaChatSession({
    contextSequence: ctx.getSequence(),
    systemPrompt,
    chatWrapper,
  });
  return { session, ctx };
}

/**
 * EN→RU для ответа VLM. Модель HC AI Light может быть выгружена после анализа
 * (Moondream ~4GB), поэтому при необходимости перезагружаем её через ensureModel.
 * Создаём свежую сессию на каждый вызов — надёжнее, чем кэш с resetChat.
 */
async function translateEnToRu(text, force = false) {
  const raw = String(text || '').trim();
  if (!raw) return text;
  // Если ответ почти целиком кириллица — это и есть русский, возвращаем как есть.
  // force=true — смешанный ответ (модель вставляет английские фразы): переводим принудительно.
  const cyr = (raw.match(/[\u0400-\u04FF]/g) || []).length;
  if (!force && cyr / Math.max(raw.length, 1) > 0.15) return text;

  try {
    let ru = '';
    for (let attempt = 0; attempt < 3 && !(ru && /[\u0400-\u04FF]/.test(ru)); attempt++) {
      const { session, ctx } = await createTranslateSession(
        'You are a translator. Translate the English text into natural Russian. ' +
          'Write ONLY the Russian translation. Keep all numbers, weights, measures and names. ' +
          'Do not add explanations or comments.',
        1024
      );
      if (!session) return text;
      try {
        const result = await session.prompt(raw, {
          maxTokens: 512,
          temperature: 0.15,
          topP: 0.9,
          repeatPenalty: 1.1,
        });
        const candidate = sanitizeSdTranslate(result);
        if (candidate) ru = candidate;
      } finally {
        try { session?.dispose(); } catch {}
        try { ctx?.dispose().catch(() => {}); } catch {}
      }
    }
    if (ru && /[\u0400-\u04FF]/.test(ru)) {
      console.error('[hc/vlm] EN→RU ok');
      return ru;
    }
  } catch (e) {
    console.error('[hc/vlm] EN→RU:', e?.message || e);
  }
  return text;
}

/**
 * Очистка многострочного ответа оценки калорий: НЕ режем по первой строке,
 * вырезаем размышления и вводные присказки диетолога.
 */
function cleanCaloriesText(text) {
  let r = String(text || '');
  r = r.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  r = r.replace(/<\/?think>/gi, '');
  r = r.replace(/\n{2,}/g, '\n');
  // вводные присказки в начале
  r = r.replace(/^(?:вот(?: описание)?|here(?:'s)?|описание|результат|готово|ответ)[^:\n]{0,40}:?\s*/i, '');
  r = r.replace(/^\[?(перевод|расчёт|результат|ответ)\]?:?\s*/i, '');
  return r.replace(/^["'`]+|["'`]+$/g, '').trim();
}

// Признак, что в ответе есть числовая оценка калорий
function hasCalorieNumber(text) {
  return /\d+\s*(?:ккал|kcal|кал)/i.test(String(text || ''));
}

/**
 * Оценка калорий через HC AI Light по описанию еды (как последняя стадия для calories,
 * когда Moondream не вернула числа). Возвращает русский текст с оценкой ккал.
 */
async function estimateCaloriesWithLlm(description) {
  const desc = MODELS_PATHS.find((m) => m.path);
  if (!desc) return null;
  const raw = String(description || '').trim();

  // Если описание пустое или не похоже на еду — НЕ выдумываем блюдо, честно возвращаем null.
  // HC AI Light "в свободном полёте" галлюцинирует (бургер вместо пиццы) — лучше не дать ответ,
  // чем придумать чужое блюдо.
  if (!raw || /(не (могу|удалось|видно|смог)|извини|sorry|отказ|cannot|не является реальн)/i.test(raw)) {
    console.error('[hc/vlm] calories: нет описания еды — пропускаем HC AI Light');
    return null;
  }

  const promptText =
    `Опиши это блюдо/еду: "${raw.replace(/"/g, "'").slice(0, 500)}"\n` +
    'Оцени калорийность (ккал) каждого продукта числом и укажи итог. Формат: "продукт - N ккал", затем "Итого: N ккал". Если блюда/еды нет — напиши "Еды на фото не видно".';
  const sys = 'Ты — диетолог. По описанию еды оцени калорийность (ккал). Пиши по-русски, обязательно указывай ИТОГ цифрой ккал.';

  // До 3 попыток: принимаем ответ только если есть число + ккал.
  for (let attempt = 0; attempt < 3; attempt++) {
    let session = null;
    let ctx = null;
    try {
      const created = await createTranslateSession(sys, 1024);
      session = created.session;
      ctx = created.ctx;
      if (!session) return null;
      const result = await session.prompt(promptText, {
        maxTokens: 600,
        temperature: 0.4 + attempt * 0.2,
        topP: 0.95,
        repeatPenalty: 1.1,
      });
      const cleaned = cleanCaloriesText(result);
      if (hasCalorieNumber(cleaned)) return cleaned;
    } catch (e) {
      console.error('[hc/vlm] calories-LLM:', e?.message || e);
    } finally {
      try { session?.dispose(); } catch {}
      try { ctx?.dispose().catch(() => {}); } catch {}
    }
  }
  return null;
}

async function prepareSdPrompt(options) {
  let userPrompt = String(options.userPrompt || options.prompt || '').trim();
  let prompt = String(options.prompt || userPrompt).trim();
  const hasAttachedPhoto = !!(options.initImage || options.controlImage || options.previousImage);
  // Текстовый режим (нет прикреплённого фото): вырезаем «референсные» инструкции
  // про загруженные/приложенные фото — в txt2img их нечем исполнить, и модель
  // «зависает» на них, портя остальное описание.
  if (!hasAttachedPhoto) {
    const stripRe = /(?:\bсохран\w+\s+черт\w*\s+лица?\b|перенес\w+\s+внешность|са\w+\s+загруженн\w*\s+(?:фото|фотографий)|загруженн\w*\s+(?:фото|фотографии?)|референсн\w*\s+(?:фото|фотографии?)|с\s+референсных\s+фото|с\s+приложенных\s+фото|прикрепл\w+\s+(?:фото|картинк\w+)|добав\w+\s+эт\w+\s+(?:фото|картинк\w+)\s+без\s+изменен\w+)/gi;
    const clean = (s) => s.replace(stripRe, ' ').replace(/\s{2,}/g, ' ').trim();
    prompt = clean(prompt);
    userPrompt = clean(userPrompt);
  }
  if (!prompt) return options;

  if (options.enhancePrompt === false) {
    return { ...options, prompt, userPrompt };
  }

  // Всегда переводим исходный RU, не словарный prompt — Z-Image плохо ест word salad
  if (CYRILLIC_RE.test(userPrompt) || CYRILLIC_RE.test(prompt)) {
    prompt = await translateImagePromptWithLlm(userPrompt || prompt);
  }

  if (CYRILLIC_RE.test(prompt)) {
    console.warn('[hc/sd] кириллица в промпте после перевода — качество может пострадать');
  }

  const isZImage = sdEngine.isZImageModel();
  if (!isZImage && !/masterpiece|best quality|highly detailed|sharp focus/i.test(prompt)) {
    prompt = 'masterpiece, best quality, highly detailed, sharp focus, ' + prompt;
  }

  return {
    ...options,
    prompt,
    userPrompt,
    negativePrompt: isZImage
      ? String(options.negativePrompt || '').trim()
      : String(options.negativePrompt || sdEngine.DEFAULT_NEGATIVE).trim(),
  };
}

// ---------- IPC ----------
ipcMain.handle('llm:load', async (_e, modelId) => {
  // Если указан конкретный id — грузим его; иначе обе модели.
  if (modelId) {
    const desc = MODELS_PATHS.find((m) => m.id === modelId);
    if (desc && desc.path) await ensureModel(desc);
  } else {
    await ensureAllModels();
  }
  send('llm:status-update', { ready: true, modelName: 'all' });
  return { ready: true, modelName: 'all' };
});

ipcMain.handle('llm:status', async () => {
  const models = MODELS_PATHS.map((m) => ({
    id: m.id,
    name: m.name,
    loaded: loadedModels.has(m.id),
    path: m.path || null,
  }));
  return { available: true, ready: loadedModels.size > 0, loading: false, error: null, modelName: 'all', models };
});

ipcMain.handle('llm:abort', async () => {
  if (activeAbort) { try { activeAbort.abort(); } catch {} }
  return true;
});

// ---------- Управление окном из кастомного тайтлбара ----------
ipcMain.handle('win:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('win:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('win:close', () => { if (mainWindow) mainWindow.close(); });

ipcMain.handle('llm:reset', async (_e, sessionId, modelId) => {
  const sid = String(sessionId || 'default');
  const mid = modelId || sessionsByUser.get(sid) || 'qwen-0.8b';
  resetSession(mid, sid);
  return true;
});

ipcMain.handle('llm:models', async () => {
  return MODELS_PATHS.filter((m) => m.path).map((m) => ({
    id: m.id,
    name: m.name,
    loaded: loadedModels.has(m.id),
    fast: !!m.fast,
    path: m.path,
    size: m.size,
    quant: m.quant,
    family: m.family,
    format: 'embedded',
    contextLength: m.ctx,
    vramRequirementMb: m.vramRequirementMb,
    description: m.description,
    backendId: m.id,
  }));
});

ipcMain.handle('llm:chat', async (_e, payload) => {
  const sessionId = String(payload.sessionId || 'default');
  const messages = payload.messages || [];
  const config = payload.config || {};

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const prompt = String(lastUser?.content || '').trim();
  if (!prompt) return { content: '', stats: null };

  // Честный калькулятор: считается мгновенно и безошибочно (общая математика, не «под фразу»).
  const arithmetic = computeArithmetic(prompt);
  if (arithmetic !== null) {
    send('llm:token', { sessionId, delta: arithmetic, full: arithmetic, stats: { tps: 0, ttft: 0, tokens: 0 } });
    return { content: arithmetic, stats: { tps: 0, ttft: 0, tokens: 0 } };
  }

  // Выбор модели: если указан id — та модель; иначе берём ту, что уже была у сессии, по умолчанию лёгкую.
  let modelId = payload.modelId;
  if (!modelId) modelId = sessionsByUser.get(sessionId) || 'qwen-0.8b';
  const modelDesc = MODELS_PATHS.find((m) => m.id === modelId) || MODELS_PATHS[0];
  if (!modelDesc.path) modelDesc.path = resolveModelPath(modelDesc.dir, modelDesc.file);
  if (!modelDesc.path) return { content: 'Модель не найдена на диске.', stats: null };

  await ensureModel(modelDesc);
  if (activeAbort) { try { activeAbort.abort(); } catch {} }
  const abort = new AbortController();
  activeAbort = abort;

  const startMs = Date.now();
  const base = {
    temperature: clamp(config.temperature ?? GEN_DEFAULTS.temperature, 0.1, 0.9),
    topK: GEN_DEFAULTS.topK,
    topP: clamp(config.topP ?? GEN_DEFAULTS.topP, 0.3, 1),
    minP: GEN_DEFAULTS.minP,
    repeatPenalty: GEN_DEFAULTS.repeatPenalty,
    dryRepeatPenalty: GEN_DEFAULTS.dryRepeatPenalty,
    maxTokens: clamp(config.maxTokens ?? GEN_DEFAULTS.maxTokens, 24, MAX_OUTPUT_TOKENS),
  };

  const effectiveSystemPrompt = buildEffectiveSystemPrompt(config);
  const codeReq = isCodeRequest(prompt);
  const userPrompt = prepareUserPrompt(prompt, codeReq, messages);
  // Мелкая модель шумная: даём 3 попытки и в ретрае упрощаем промпт,
  // чтобы выбить её из «пустоты»/эха (degraded вывод уже отсеивается isDegenerate).
  const maxAttempts = 3;

  let fullText = '';
  let accepted = false;
  let lastAttempt = '';
  let tokenCount = 0;
  let firstTokenMs = null;
  let ephSession = null;

  try {
    for (let attempt = 0; attempt < maxAttempts && !accepted; attempt++) {
      let session;
      // Код / файлы — одноразовая сессия: чистый контекст, без «мусорной» истории
      if (/^\[Файл: /m.test(prompt) || codeReq) {
        session = await createEphemeralSession(modelId, effectiveSystemPrompt);
        ephSession = session;
      } else {
        session = await getOrCreateSession(modelId, sessionId, effectiveSystemPrompt);
      }
      const chunks = [];
      let tmpTokens = 0;
      let tmpFirst = null;

      const attemptPrompt = attempt === 0
        ? userPrompt
        : codeReq
          ? userPrompt + '\n\n[Важно: только полный код в ``` блоке, без вступления.]'
          : userPrompt + '\n\nОтвечай кратко и прямо. Сначала сам ответ, без вступления, «я HC AI» и лишних слов.';

      const promptOpts = {
        signal: abort.signal,
        temperature: Math.min(base.temperature + attempt * 0.08, 0.75),
        topK: base.topK,
        topP: base.topP,
        minP: base.minP,
        repeatPenalty: base.repeatPenalty,
        maxTokens: codeReq ? Math.max(base.maxTokens, 2048) : base.maxTokens,
        onToken: () => {
          tmpTokens++;
          if (tmpFirst === null) tmpFirst = Date.now();
        },
        onTextChunk: (c) => { chunks.push(c); },
      };
      if (!codeReq) promptOpts.dryRepeatPenalty = base.dryRepeatPenalty;

      const result = await session.prompt(attemptPrompt, promptOpts);

      if (abort.signal.aborted && !chunks.length) break;

      const rawOut = sanitizeModelOutput(chunks.join('') || result || '');
      lastAttempt = rawOut;
      if (!isDegenerate(rawOut, prompt, tmpTokens, codeReq)) {
        tokenCount = tmpTokens;
        firstTokenMs = tmpFirst;
        let running = '';
        for (const c of chunks) {
          running += c;
          send('llm:token', {
            sessionId, delta: c, full: running,
            stats: {
              tps: firstTokenMs ? tmpTokens / ((Date.now() - firstTokenMs) / 1000) : 0,
              ttft: firstTokenMs ? firstTokenMs - startMs : 0,
              tokens: tmpTokens,
            },
          });
        }
        fullText = (rawOut || '').trim();
        accepted = true;
      } else {
        // мусор/вырождение — чистим память сессии перед повторной попыткой
        if (ephSession) { disposeSession(ephSession); ephSession = null; }
        else resetSession(modelId, sessionId);
      }
    }
  } catch (err) {
    if (ephSession) { disposeSession(ephSession); ephSession = null; }
    else resetSession(modelId, sessionId);
    if (abort.signal.aborted) return { content: fullText, aborted: true, stats: null };
    throw new Error('Ошибка инференса: ' + (err?.message || err));
  } finally {
    activeAbort = null;
    // Одноразовая сессия всегда уничтожается после ответа.
    if (ephSession) { disposeSession(ephSession); ephSession = null; }
  }

  if (!accepted) {
    const fallback = sanitizeModelOutput(String(lastAttempt || '').trim());
    fullText = fallback
      ? fallback
      : 'Не удалось сформировать ответ. Попробуйте персону «Программист» или короче переформулируйте запрос.';
    send('llm:token', { sessionId, delta: fullText, full: fullText, stats: { tps: 0, ttft: 0, tokens: 0 } });
  }

  const elapsedMs = (Date.now() - startMs) / 1000 || 1;
  console.error(`[main] ответ: ${tokenCount} токенов, длина ${(fullText || '').length} симв. (maxTokens=${base.maxTokens})`);
  return {
    content: fullText,
    stats: {
      tps: Math.round(tokenCount / elapsedMs),
      ttft: firstTokenMs ? firstTokenMs - startMs : 0,
      tokens: tokenCount,
    },
  };
});

// ---------- Stable Diffusion (text-to-image) ----------
ipcMain.handle('sd:status', async () => {
  const st = sdEngine.getStatus();
  return { ...st, llmGpuLabel, llmLoaded: loadedModels.size > 0 };
});

ipcMain.handle('sd:abort', async () => {
  sdEngine.abortGeneration();
  return true;
});

// Предзагрузка sd-server при входе в image-режим: поднимаем сервер в фоне и
// прогоняем маленький warmup-img_gen, чтобы модели реально загрузились в VRAM.
// Без warmup сервер лишь слушает порт, а модели грузятся лениво при первом запросе —
// и первая генерация всё равно холодная (~80-100с).
// Перед стартом гасим VLM-сервер (арбитраж VRAM — два сервера не сосуществуют на 8GB).
let sdWarmedUp = false;
ipcMain.handle('sd:preload', async () => {
  try {
    const port = sdEngine.SD_SERVER_PORT || 8687;
    if (await sdEngine.isServerAlive() && sdWarmedUp) return { ok: true, already: true };
    try { await vlmEngine.stopVlmServerAndWait(); } catch {}
    if (!(await sdEngine.isServerAlive())) {
      const started = await sdEngine.startSdServer(null);
      if (!started) return { ok: false, error: 'sd-server не запустился' };
    }
    // Warmup: прогнать 1 шаг на 512×512, чтобы диффузия/VAE загрузились в VRAM.
    const warm = await warmupSdServer(port);
    if (warm) sdWarmedUp = true;
    return { ok: true, ready: await sdEngine.isServerAlive(), warmed: !!warm };
  } catch (err) {
    console.error('[hc/sd] предзагрузка упала:', err?.message || err);
    return { ok: false, error: String(err?.message || err) };
  }
});

// Прогон одного маленького img_gen и ожидание завершения (загрузка моделей в VRAM).
async function warmupSdServer(port) {
  try {
    const body = {
      prompt: 'warmup',
      width: 512,
      height: 512,
      seed: 7,
      output_format: 'png',
      sample_params: {
        sample_steps: 1,
        sample_method: 'euler',
        scheduler: 'sgm_uniform',
        guidance: { txt_cfg: 1.0, distilled_guidance: 3.5 },
      },
    };
    const post = await fetch(`http://127.0.0.1:${port}/sdcpp/v1/img_gen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!post.ok) return false;
    const q = await post.json();
    const id = q.id || (q.poll_url || '').split('/').pop();
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch(`http://127.0.0.1:${port}/sdcpp/v1/jobs/${id}`);
      if (!res.ok) continue;
      const j = await res.json();
      if (j.status === 'completed') return true;
      if (j.status === 'failed') return false;
    }
    return false;
  } catch (e) {
    console.error('[hc/sd] warmup упал:', e?.message || e);
    return false;
  }
}

ipcMain.handle('sd:generate', async (_e, payload) => {
  const options = payload || {};
  try {
    // Останавливаем фоновый прогрев — скоро понадобится весь дисковый IO под SD.
    prefetch.abort();
    // Диагностика: дошло ли прикреплённое фото (img2img требует initImage).
    console.error('[hc/sd] прикреплённое фото (initImage):', !!options.initImage,
      options.initImage?.dataUrl ? `dataUrl ${(options.initImage.dataUrl.length/1024).toFixed(0)}KB`
        : options.initImage?.data ? `rgb ${options.initImage.width}x${options.initImage.height}`
        : '— нет');
    // Режим доработки: в чате есть предыдущее изображение, своё пользователь не приложил
    if (options.previousImage && !options.initImage) {
      const userReq = String(options.userPrompt || options.prompt || '').trim();
      const intent = await classifyEditIntent(userReq, options.previousPromptEn);
      if (intent === 'edit') {
        options.editPrevious = { image: options.previousImage, promptEn: options.previousPromptEn };
      }
    }
    const prepared = await prepareSdPrompt(options);
    // Прикреплённое пользователем фото (не доработка прошлого) → img2img-коммерческая
    // встройка: добавляем EN-инструкцию сохранить продукт/упаковку как есть и поставить
    // в сцену. Без неё Z-Image «меняет саму пачку», а не ставит её рядом с объектами.
    if (options.initImage && !prepared.editPrevious) {
      const keep = ', keep the attached product and its packaging design exactly unchanged, product placement, commercial product photography';
      if (!/product placement|packaging design|unchanged/i.test(prepared.prompt)) {
        prepared.prompt = prepared.prompt.trim().replace(/[,.]\s*$/, '') + keep;
      }
    }
    // EDIT: итоговый промпт = EN-промпт предыдущего изображения + EN-уточнение пользователя
    if (prepared.editPrevious) {
      prepared.prompt = `${prepared.editPrevious.promptEn}, ${prepared.prompt}`;
      prepared.initImage = { dataUrl: prepared.editPrevious.image };
    }
    const sdStatus = sdEngine.getStatus();
    if (shouldUnloadLlmBeforeSd(prepared, sdStatus)) {
      send('sd:progress', { progress: 3, text: 'Дождитесь результата...', phase: 'load' });
      await unloadLlmForImageGen();
    }
    // Арбитраж VRAM: VLM-сервер (llama-server) держит до ~6GB — гасим перед SD
    try {
      await vlmEngine.stopVlmServerAndWait();
    } catch {}
    const result = await sdEngine.generateImage(prepared, (channel, data) => send(channel, data));
    // Юзер остался в Image-режиме → греем VLM-модели в RAM под следующий фоточип
    // (переключение Vision станет мгновенным, без холодного чтения ~5GB с диска).
    prefetch.warm('vlm');
    return { ok: true, ...result, sdPrompt: prepared.prompt, edited: !!prepared.editPrevious };
  } catch (err) {
    if (err?.name === 'AbortError' || /abort/i.test(String(err?.message || err))) {
      return { ok: false, aborted: true, error: 'Генерация отменена' };
    }
    console.error('[hc/sd] ошибка:', err?.stack || err);
    return { ok: false, error: String(err?.message || err) };
  }
});

// ---------- Апскейл изображений (Real-ESRGAN-ncnn-vulkan, автономно) ----------
ipcMain.handle('upscale:status', async () => upscaleEngine.getStatus());

ipcMain.handle('upscale:abort', async () => {
  upscaleEngine.abortUpscale();
  return true;
});

ipcMain.handle('upscale:generate', async (_e, payload) => {
  const options = payload || {};
  const dataUrl = String(options.dataUrl || '').trim();
  if (!dataUrl) return { ok: false, error: 'Пустое изображение' };
  try {
    // Арбитраж VRAM: VLM-сервер держит до ~6GB и может конфликтовать с апскейлом.
    // LLM (0.7GB) + апскейл (~1-2GB) спокойно уживаются в 8GB — LLM не трогаем.
    prefetch.abort();
    try { await vlmEngine.stopVlmServerAndWait(); } catch {}
    const result = await upscaleEngine.upscaleImage({ dataUrl, scale: options.scale, model: options.model },
      (channel, data) => send(channel, data));
    return { ok: true, ...result };
  } catch (err) {
    if (err?.name === 'AbortError' || /abort/i.test(String(err?.message || err))) {
      return { ok: false, aborted: true, error: 'Апскейл отменён' };
    }
    console.error('[hc/upscale] ошибка:', err?.stack || err);
    return { ok: false, error: String(err?.message || err) };
  }
});

// ---------- Vision (image-to-text / VLM) ----------
ipcMain.handle('vlm:status', async () => vlmEngine.getStatus());

ipcMain.handle('vlm:abort', async () => {
  vlmEngine.abortAnalysis();
  return true;
});

ipcMain.handle('vlm:analyze', async (_e, payload) => {
  const options = payload || {};
  const timeoutMs = 240000; // общий дедлайн на весь анализ + перевод
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      vlmEngine.abortAnalysis(); // убиваем зависший llama-mtmd-cli
      reject(new Error('VLM таймаут: анализ занял слишком много времени. Попробуйте ещё раз.'));
    }, timeoutMs);
  });

  const work = (async () => {
    // Останавливаем фоновый прогрев — освобождаем дисковый IO под загрузку VLM.
    prefetch.abort();
    const modelDef = vlmEngine.getModelDef(options.modelId);
    // Qwen2.5-VL (7B) знает русский — перевод RU↔EN по умолчанию выключен,
    // но модель иногда выдаёт смесь EN/RU → авто-перевод при >20% латиницы.
    const needLang = (modelDef?.defaultLang || 'en') === 'en';
    if (needLang && CYRILLIC_RE.test(String(options.prompt || ''))) {
      send('vlm:progress', { progress: 3, text: 'Перевод запроса RU→EN...', phase: 'translate' });
      const en = await translateRuToEnVlm(options.prompt);
      if (en) options.prompt = en;
    }

    // АРБИТР VRAM: сначала гасим sd-server и ЖДЁМ фактического освобождения.
    // taskkill асинхронный — нельзя стартовать VLM до смерти процесса, иначе
    // llama-server падает по OOM и анализ вечно «думает» (ретраи не помогают).
    let sdFreed = true; // если sd-server не был запущен / не в VRAM — VRAM уже свободна
    if ((modelDef?.vramMb || 0) >= 2000) {
      send('vlm:progress', { progress: 2, text: 'Освобождение VRAM (остановка Image)...', phase: 'unload' });
      sdWarmedUp = false; // модели sd выгружены из VRAM — при следующем входе в Image греем заново
      try { sdEngine.stopSdServer(); } catch {}
      for (let i = 0; i < 24 && (await sdEngine.isServerAlive()); i++) {
        await new Promise((r) => setTimeout(r, 500));
      }
      sdFreed = !(await sdEngine.isServerAlive());
      if (!sdFreed) {
        console.error('[hc/vlm] sd-server не умер за 12с — VRAM может не хватить');
      } else {
        console.error('[hc/vlm] sd-server остановлен, VRAM свободна — старт анализа');
      }
    }

    // Выгружаем LLM ТОЛЬКО если VRAM реально тесна (sd-server не погашен).
    // В норме HC AI Light (0.7GB) + VLM (6GB) = ~6.7GB помещаются в 8GB → LLM живёт,
    // и возврат в чат после фоточипа происходит мгновенно. Это главный выигрыш:
    // раньше 0.8B перечитывался с диска на каждое переключение Vision→чат.
    if (shouldUnloadLlmForVlm(sdFreed) && loadedModels.size > 0) {
      send('vlm:progress', { progress: 2, text: 'Выгрузка LLM (VRAM)...', phase: 'unload' });
      await unloadLlmForImageGen();
    }

    const result = await vlmEngine.analyzeImage(options, (channel, data) => send(channel, data));

    // Для англо-моделей переводим ответ EN→RU; Qwen2.5-VL отвечает по-русски сам.
    let text = result?.text || '';
    // НО: модель иногда игнорирует «Отвечай на русском» и пишет по-английски или смесь.
    // Считаем латиницу в ответе — если её много, отправляем через переводчик.
    const letters = (text.match(/[^\W\d_]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    const latinRatio = letters > 0 ? latin / letters : 0;
    const needTranslate = !!text && (needLang || latinRatio > 0.2) && options.mode !== 'ocr';
    if (needTranslate) {
      send('vlm:progress', { progress: 93, text: 'Перевод ответа EN→RU...', phase: 'translate' });
      text = await translateEnToRu(text, true);
    }

    // Calories: если Moondream не дала цифр (needsCalorieCheck) — даём HC AI Light
    // второй шанс оценить ккал по описанию еды.
    if (options.mode === 'calories') {
      let finalText = text;
      if (result?.needsCalorieCheck) {
        send('vlm:progress', { progress: 95, text: 'Оценка калорий моделью HC AI Light...', phase: 'translate' });
        const descForLlm = finalText && !/^\s*$/.test(finalText)
          ? finalText
          : result.text || '';
        const est = await estimateCaloriesWithLlm(descForLlm);
        if (est) {
          // Не выбрасываем ответ VLM (описание блюд) — добавляем к нему оценку HC AI Light
          const vlmText = (descForLlm || '').trim();
          finalText = vlmText && !/^\s*$/.test(vlmText)
            ? vlmText + '\n\n📊 Оценка HC AI Light (по описанию):\n' + est
            : est;
        } else {
          // Описание еды пустое или модель не смогла распознать блюдо — честно сообщаем.
          finalText = descForLlm && /^\s*$/.test(descForLlm)
            ? 'Не удалось распознать еду на фото (модель не дала описание блюда). Попробуйте другое фото или напишите, какая это еда.'
            : 'Не удалось рассчитать калории: модель не прислала числа (ккал) и описание блюда. Попробуйте ещё раз.';
        }
      }
      return { ok: true, ...result, text: finalText };
    }

    // OCR: локализуем стандартные «нет текста» ответы VLM на английском
    if (options.mode === 'ocr' && /^\s*(no text|there is no text|nothing to transcribe|text:?\s*none)/i.test(text || '')) {
      text = 'Текст на изображении не найден.';
    }

    return { ok: true, ...result, text };
  })();

  try {
    const r = await Promise.race([work, timeout]);
    // Успешный анализ → юзер остался в Vision → греем SD-модели под следующую генерацию.
    if (r?.ok) prefetch.warm('sd');
    return r;
  } catch (err) {
    if (/abort/i.test(String(err?.message || err))) {
      return { ok: false, aborted: true, error: 'Анализ отменён' };
    }
    console.error('[hc/vlm] ошибка:', err?.stack || err);
    return { ok: false, error: String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
});

// ---------- Window ----------
app.commandLine.appendSwitch('use-angle', 'd3d11');
app.commandLine.appendSwitch('enable-hardware-overlays');
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('force_high_performance_gpu');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 840,
    minHeight: 620,
    title: 'HC AI // Offline Autonomous AI Agent',
    backgroundColor: '#08090d',
    show: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  console.error('[hc] загружаю UI:', devServer ? 'dev-server' : 'dist/index.html');
  if (devServer) {
    mainWindow.loadURL(devServer);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  // Показываем окно только когда DOM готов — иначе бывает «белый/пустой» экран.
  mainWindow.once('ready-to-show', () => {
    console.error('[hc] окно готово к показу, показываю.');
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.on('show', () => console.error('[hc] окно показано.'));
  mainWindow.on('close', () => console.error('[hc] окно закрывается.'));
  mainWindow.on('closed', () => console.error('[hc] окно закрыто.'));

  mainWindow.webContents.on('did-finish-load', () => {
    console.error('[hc] UI загружен. Модель грузится лениво при первом вопросе.');
  });

  // Диагностика: выводим любые ошибки/краши renderer и main в терминал.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[renderer] did-fail-load', code, desc, url);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] gone:', JSON.stringify(details));
  });
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2 || /error|exception/i.test(message)) {
      console.error('[renderer-msg]', message, '(', sourceId, ':', line, ')');
    }
  });
  process.on('uncaughtException', (err) => {
    console.error('[hc] uncaughtException:', err?.stack || err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[hc] unhandledRejection:', reason);
  });
}

app.whenReady().then(() => {
  createWindow();
  // Начинаем загрузку LLM сразу — параллельно с отрисовкой окна.
  // К моменту когда пользователь напишет первое сообщение, модель уже готова.
  ensureAllModels().catch((e) => console.error('[hc] pre-load failed:', e?.message || e));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  sdEngine.disposeSdContext();
  try { sdEngine.stopSdServer(); } catch {}
  try { vlmEngine.stopVlmServer(); } catch {}
  // Освобождаем кэш-сессию перевода
  try { translateSession?.dispose(); } catch {}
  try { translateCtx?.dispose(); } catch {}
  translateSession = null;
  translateCtx = null;
  try { vlmEnRuSession?.dispose(); } catch {}
  try { vlmEnRuCtx?.dispose(); } catch {}
  vlmEnRuSession = null;
  vlmEnRuCtx = null;
  if (process.platform !== 'darwin') app.quit();
});
