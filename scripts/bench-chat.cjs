// bench-chat.cjs — быстрая метрика качества и скорости чат-LLM (HC AI).
//
// Замеряет на наборе простых вопросов: время до первого токена (ttft),
// темп токенов/с, и долю «плохих» ответов (пусто / эхо вопроса / бессвязный шум).
//
// Запуск (из папки hotcache_v0):
//   node scripts/bench-chat.cjs qwen-0.8b 8
//   node scripts/bench-chat.cjs qwen2.5-vl-chat 8
//
// Выбор модели:
//   qwen-0.8b        — встроенная лёгкая (517 MB/Qwen3), дефолт чата
//   qwen2.5-vl-chat  — Qwen2.5-VL 7B (переиспользуется Vision-бандл, ~4.4GB)
const path = require('path');
const fs = require('fs');

const MODELS = {
  'qwen-0.8b': {
    path: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'resources', 'qwen-3.5-0.8b', 'qwen-3.5-0.8b.gguf'),
    wrapper: 'qwen3.5',
  },
  'qwen2.5-vl-chat': {
    path: path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'resources', 'Qwen2.5-VL-7B', 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf'),
    wrapper: 'qwen',
  },
};

const QUESTIONS = [
  'Сколько будет 2+2?',
  'Что такое водород?',
  'Назови столицу Франции.',
  'Какой сегодня год?',
  'Зачем нужны переменные в программировании?',
  'Расскажи про кошек в одном предложении.',
  'Что тяжелее: килограмм ваты или килограмм железа?',
  'Переведи на английский: «доброе утро».',
];

const SYS = 'Ты умный офлайн-помощник. Отвечай по-русски кратко и по делу, без приветствия и лишних слов.';

function pickQuestions(n) {
  n = Math.max(1, Math.min(n, QUESTIONS.length));
  return QUESTIONS.slice(0, n);
}

// Грубая проверка «плохого» ответа мелкой модели (зеркалит main.cjs isDegenerate).
function isBad(text, prompt) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^\s*(ответ|готово|ой|хм|э-э)/i.test(t) && t.length < 20) return true;
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const np = norm(prompt);
  const nt = norm(t);
  if (np && nt === np) return true; // чистое эхо вопроса
  if (np && np.length <= 8 && t.length > 120) return true;
  return false;
}

async function makeSession(nlc, modelId) {
  const { path: modelPath, wrapper } = MODELS[modelId] || MODELS['qwen-0.8b'];
  if (!fs.existsSync(modelPath)) {
    throw new Error('Не найден GGUF: ' + modelPath);
  }
  const llama = await nlc.getLlama({ gpu: 'auto', build: 'never' });
  console.log('Загрузка:', modelPath);
  const t0 = Date.now();
  const model = await llama.loadModel({ modelPath, gpuLayers: 999, enableLogs: false, threads: 0 });
  const ctx = await model.createContext({ contextSize: 4096, threads: 0 });
  console.log('Готово за', ((Date.now() - t0) / 1000).toFixed(1) + 'с\n');

  const chatWrapper = wrapper === 'qwen'
    ? new nlc.QwenChatWrapper({ variation: '3', thoughts: 'discourage' })
    : new nlc.QwenChatWrapper({ variation: '3.5', thoughts: 'discourage' });

  const session = new nlc.LlamaChatSession({
    contextSequence: ctx.getSequence(),
    systemPrompt: SYS,
    chatWrapper,
  });
  return { session, ctx };
}

(async () => {
  const modelSel = (process.argv[2] || 'qwen-0.8b');
  const n = parseInt(process.argv[3] || '8', 10);
  if (!MODELS[modelSel]) {
    console.error('Неизвестная модель. Допустимо: ' + Object.keys(MODELS).join(', '));
    process.exit(1);
  }
  const nlc = await import('node-llama-cpp');
  const { session, ctx } = await makeSession(nlc, modelSel);
  const prompts = pickQuestions(n);

  let totalTps = 0, totalTtft = 0, bad = 0;
  console.log('Модель:', modelSel, '· вопросов:', prompts.length);

  for (let i = 0; i < prompts.length; i++) {
    const q = prompts[i];
    let ttft = null, tokens = 0;
    const start = Date.now();
    const chunkStart = process.hrtime.bigint();
    let raw = '';
    const result = await session.prompt(q, {
      maxTokens: 200,
      temperature: 0.5,
      minP: 0.05,
      repeatPenalty: 1.1,
      onTextChunk: (c) => {
        if (ttft === null) ttft = Number(process.hrtime.bigint() - chunkStart) / 1e6;
        raw += c;
      },
      onToken: () => { tokens++; },
    });
    const elapsedMs = Date.now() - start;
    const text = (raw || result || '').trim();
    const tps = elapsedMs > 0 ? Math.round((tokens / elapsedMs) * 1000) : 0;
    totalTps += tps;
    totalTtft += ttft || 0;
    const badOne = isBad(text, q);
    if (badOne) bad++;

    console.log(`\n#${i + 1} «${q}»`);
    console.log(`  tok/s=${tps} ttft=${ttft ? Math.round(ttft) + 'ms' : '—'} len=${text.length}${badOne ? ' ⚠ ПЛОХОЙ' : ''}`);
    console.log(`  → ${text.slice(0, 160)}`);
  }

  const k = prompts.length;
  console.log('\n========== ИТОГ ==========');
  console.log('Среднее tok/s :', Math.round(totalTps / k));
  console.log('Средний ttft  :', Math.round(totalTtft / k) + ' ms');
  console.log('«Плохих» ответов:', bad + ' из ' + k, `(${Math.round((bad / k) * 100)}%)`);
  try { await ctx.dispose(); } catch {}
})().catch((e) => {
  console.error('Ошибка:', e && e.stack ? e.stack : e);
  process.exit(1);
});