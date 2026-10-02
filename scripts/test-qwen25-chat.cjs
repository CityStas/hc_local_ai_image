// test-qwen25-chat.cjs - check Qwen2.5-VL-7B GGUF as a text chat via node-llama-cpp
// Run: node scripts/test-qwen25-chat.cjs
// With path: node scripts/test-qwen25-chat.cjs "<path to gguf>"

const path = require('path');
const fs = require('fs');

const DEFAULT_MODEL = path.join(
  __dirname,
  '..',
  'node_modules',
  'electron',
  'dist',
  'resources',
  'Qwen2.5-VL-7B',
  'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf'
);

const PROMPTS = [
  ['HELLO', 'Привет (hello). Кто ты и что умеешь? Ответь кратко.'],
  ['RU_LOGIC', 'Коротко объясни, что такое гравитация.'],
  ['MATH', 'Сколько будет 2 плюс 2 умноженное на 3? Ответь числом.'],
  ['CALC', 'Мне нужен код калькулятора в стиле ios на HTML. Покажи его в ```html блоке, без вступления.']
];

// ---- Replica of main.cjs sanitize pipeline (to find where code gets emptied) ----
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
function appSanitize(text) {
  let t = String(text || '').trim();
  t = t.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, body) => {
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

async function main() {
  const modelPathValue = process.argv[2] || DEFAULT_MODEL;
  if (!fs.existsSync(modelPathValue)) {
    console.error('Model not found:', modelPathValue);
    process.exit(1);
  }

  const nlc = await import('node-llama-cpp');

  let llama = null;
  let lastErr = null;
  for (const gpu of ['cuda', 'vulkan', 'auto']) {
    try {
      llama = await nlc.getLlama({ gpu: gpu, build: 'never' });
      console.error('[engine] gpu=', gpu, ' OK');
      break;
    } catch (e) {
      lastErr = e;
      console.error('[engine] gpu=', gpu, ' ERR:', e.message || e);
    }
  }
  if (!llama) {
    throw lastErr || new Error('no llama');
  }

  console.error('Loading model...');
  const tLoad = Date.now();
  const model = await llama.loadModel({
    modelPath: modelPathValue,
    gpuLayers: 999,
    enableLogs: false,
    threads: 0
  });
  console.error('Model loaded in', ((Date.now() - tLoad) / 1000).toFixed(1), 's');

  const ctx = await model.createContext({ contextSize: 2048, threads: 0 });

  // chat-wrapper for Qwen2.5 = variation '3' (as in main.cjs for qwen2.5-vl-chat).
  const chatWrapper = new nlc.QwenChatWrapper({ variation: '3', thoughts: 'discourage' });

  const session = new nlc.LlamaChatSession({
    contextSequence: ctx.getSequence(),
    systemPrompt:
      'Ты HC AI, офлайн-помощник.\n' +
      'Русский язык. Не представляйся в ответе. Отвечай по делу.',
    chatWrapper
  });

  for (const [name, text] of PROMPTS) {
    console.error('===', name);
    try {
      const t0 = Date.now();
      let tokens = 0;
      let ttft = null;
      const answer = await session.prompt(text, {
        temperature: 0.4,
        topK: 40,
        topP: 0.9,
        repeatPenalty: 1.1,
        maxTokens: 1024,
        onToken: () => { tokens++; if (ttft === null) ttft = Date.now() - t0; }
      });
      const elapsed = (Date.now() - t0) / 1000;
      console.error('[answer]', tokens, ' tokens in', elapsed.toFixed(1), 's',
        tokens ? Math.round(tokens / elapsed) + ' tok/s' : '(0 tokens)');
      console.error('------------------');
      console.log(String(answer || '' ).trim());
      if (name === 'CALC') {
        const s = appSanitize(String(answer || ''));
        console.error('=== SANITIZED (main.cjs pipeline) ===');
        console.error(JSON.stringify(s).slice(0, 1500));
        console.error('San copyable: <<<' + s + '>>>');
      }
    } catch (e) {
      console.error('Err on', name, ':', e.message || e);
    }
  }

  // Decisive: CALC with app's GEN_DEFAULTS (incl. dryRepeatPenalty).
  console.error('=== CALC_DRY (GEN_DEFAULTS with dryRepeatPenalty) ===');
  try {
    const t0 = Date.now();
    let tokens = 0;
    const dryAnswer = await session.prompt(
      'Мне нужен код калькулятора в стиле ios на HTML. Покажи его в ```html блоке, без вступления.',
      {
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
          sequenceBreakers: ['\n', ':', '"', '*', '-', '—']
        },
        maxTokens: 2048,
        onToken: () => { tokens++; }
      }
    );
    const elapsed = (Date.now() - t0) / 1000;
    console.error('[CALC_DRY]', tokens, ' tokens in', elapsed.toFixed(1), 's');
    const s = appSanitize(String(dryAnswer || ''));
    console.error('[CALC_DRY] sanitized len=', s.length, ' hasEmptyBlock=', /```[\w]*\s*\n\s*```/.test(s));
    console.error('CALC_DRY raw: <<<' + String(dryAnswer || '').trim() + '>>>');
  } catch (e) {
    console.error('Err CALC_DRY:', e.message || e);
  }

  try { session.dispose(); } catch {}
  try { ctx.dispose().catch(function() {}); } catch {}
  try { model.dispose().catch(function() {}); } catch {}
  console.error('Done.');
}

main().catch(function(e) { console.error('Fatal:', e.message || e); process.exit(1); });
