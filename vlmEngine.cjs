// vlmEngine.cjs — Image-to-Text через llama-mtmd-cli (Vulkan)
// node-llama-cpp НЕ поддерживает mmproj/картинки — только этот CLI.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const VLM_MODELS = {
  qwen25vl: {
    id: 'qwen25vl',
    name: 'Qwen2.5-VL 7B',
    dir: 'Qwen2.5-VL-7B',
    model: 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf',
    mmproj: 'mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf',
    chatTemplate: null, // шаблон встроен в GGUF — mtmd-cli определит сам
    sizeLabel: '~5.5 GB (Q4_K_M)',
    vramMb: 6000,
    defaultLang: 'ru',
    // 8GB VRAM: модель+mmproj+буферы впритык → mmproj на CPU и лимит vision-токенов
    extraArgs: ['--no-mmproj-offload', '--image-max-tokens', '1024'],
  },
};

const PRESET_PROMPTS = {
  describe: {
    en: 'Describe this image in detail for someone who cannot see it. Cover: (1) the overall scene and setting; (2) every main object/person with position, color, size; (3) background details; (4) lighting, mood and style; (5) any visible text. Write at least 6-8 sentences.',
    ru: 'Подробно опиши изображение для человека, который его не видит. Обязательно раскрой: (1) общую сцену и обстановку; (2) каждый главный объект/человека — где находится, какого цвета, какого размера; (3) детали фона; (4) освещение, настроение и стиль; (5) любой видимый текст. Напиши развёрнуто, минимум 6-8 предложений. Отвечай на русском.',
  },
  ocr: {
    en: 'Transcribe ALL visible text in this image exactly as written, preserving the original line breaks and layout. Mark each text block separately. Include small labels, watermarks and numbers. If no text, say "No text found".',
    ru: 'Распознай ВЕСЬ видимый текст на изображении точно как написано, сохраняя переносы строк и структуру. Каждый текстовый блок — отдельной строкой. Включай мелкие подписи, водяные знаки и числа. Если текста нет — напиши "Текст не найден". Отвечай на русском.',
  },
  objects: {
    en: 'List every distinct object visible in this image as a bullet list. For each object add 1-2 details: color, position, state (open/closed, fresh/rotten, etc). Be specific and thorough.',
    ru: 'Перечисли КАЖДЫЙ отдельный объект на изображении списком. Для каждого объекта добавь 1-2 детали: цвет, расположение, состояние (открыт/закрыт, свежий/испорченный и т.п.). Будь конкретен и полон. Отвечай на русском.',
  },
  calories: {
    en: 'Identify every food and drink item visible in this photo, including ingredients and garnishes. For each item: estimate the portion size (grams/ml) and the calories (kcal) as a number. Format each line as "item (~N g) - N kcal". At the end write "Total: N kcal". Consider cooking method (fried adds oil calories). If there is no food, answer "No food".',
    ru: 'Определи КАЖДЫЙ продукт/блюдо/напиток на фото, включая ингредиенты и гарниры. Для каждого: оцени размер порции (г/мл) и калорийность (ккал) числом. Формат строки: "блюдо/ингредиент (~N г) - N ккал". Если на фото одно блюдо (например, салат) — разбей его на ингредиенты и укажи ккал каждого отдельно, затем порцию и итог. В конце напиши "Итого: N ккал". Учитывай способ приготовления (жарка добавляет масло). Если еды нет — напиши "Еды нет". Отвечай ТОЛЬКО на русском, без английских слов и фраз.',
  },
};

const LANG = { en: 'en', ru: 'ru' };

function modelLang(modelDef) {
  return (modelDef?.defaultLang === 'ru') ? LANG.ru : LANG.en;
}

function buildPrompt(mode, customPrompt, lang) {
  const custom = String(customPrompt || '').trim();
  const preset = PRESET_PROMPTS[mode] || PRESET_PROMPTS.describe;
  const base = preset[lang] || preset.en;
  if (mode === 'custom' || !PRESET_PROMPTS[mode]) {
    return custom || base;
  }
  // пресет + уточнение пользователя
  return custom ? `${base}\n\nUser request: ${custom}` : base;
}

function buildPrompt(mode, customPrompt, lang) {
  const custom = String(customPrompt || '').trim();
  const preset = PRESET_PROMPTS[mode] || PRESET_PROMPTS.describe;
  const base = preset[lang] || preset.en;
  if (mode === 'custom' || !PRESET_PROMPTS[mode]) {
    return custom || base;
  }
  // пресет + уточнение пользователя
  return custom ? `${base}\n\nUser request: ${custom}` : base;
}

// ── VLM Server mode (llama-server.exe — модель грузится ОДИН раз) ──────────
// CLI-режим (llama-mtmd-cli) перечитывает 4.7-5.5GB модели на каждый чип.
// llama-server держит модель в VRAM; запросы через OpenAI-совместимый API.
// На 8GB VRAM VLM-сервер и sd-server сосуществовать не могут — main.cjs
// гасит sd-server перед анализом (уже реализовано) и vlm-сервер перед генерацией.

const VLM_SERVER_PORT = 8765;
let vlmServerProc = null;
let vlmServerStarting = null;
let vlmServerModelId = null;

function findLlamaServer() {
  const candidates = [
    path.join(__dirname, 'llama-mtmd', 'llama-server.exe'),
    path.join(__dirname, 'llama-mtmd', 'bin', 'llama-server.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function isVlmServerAlive() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${VLM_SERVER_PORT}/health`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const j = await res.json().catch(() => ({}));
    // ok | ok with slots; "loading" — ещё грузится
    return String(j.status || j.error?.message || '') === 'ok';
  } catch {
    return false;
  }
}

async function startVlmServer(modelDef, send) {
  const alive = await isVlmServerAlive();
  if (alive && vlmServerModelId === modelDef.id) return true;
  if (alive && vlmServerModelId !== modelDef.id) stopVlmServer(); // смена модели
  if (vlmServerStarting) return vlmServerStarting;

  const exe = findLlamaServer();
  const bundle = resolveBundle(modelDef);
  if (!exe || !bundle.ok) return false;

  serverLog('запускаю llama-server:', exe);
  send?.('vlm:progress', { progress: 8, text: 'Загрузка VLM в память (сервер)...', phase: 'load' });

  vlmServerStarting = (async () => {
    const args = [
      '-m', bundle.modelPath,
      '--mmproj', bundle.mmprojPath,
      '--host', '127.0.0.1',
      '--port', String(VLM_SERVER_PORT),
      '-ngl', '99',
      '-c', '4096',
    ];
    if (Array.isArray(modelDef.extraArgs)) args.push(...modelDef.extraArgs);

    vlmServerProc = spawn(exe, args, {
      cwd: path.dirname(exe),
      windowsHide: true,
      env: { ...process.env },
    });
    vlmServerModelId = modelDef.id;
    const t0 = Date.now();
    while (Date.now() - t0 < 5 * 60 * 1000) {
      if (vlmServerProc.exitCode !== null) {
        serverLog('llama-server завершился с кодом', vlmServerProc.exitCode);
        vlmServerProc = null;
        vlmServerStarting = null;
        return false;
      }
      if (await isVlmServerAlive()) {
        serverLog('llama-server готов на порту', VLM_SERVER_PORT);
        vlmServerStarting = null;
        return true;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    vlmServerStarting = null;
    stopVlmServer();
    return false;
  })();

  return vlmServerStarting;
}

function stopVlmServer() {
  const proc = vlmServerProc;
  vlmServerProc = null;
  vlmServerStarting = null;
  vlmServerModelId = null;
  if (!proc) return;
  const pid = proc.pid;
  serverLog('останавливаю llama-server pid=', pid);
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true }).unref();
    } else {
      proc.kill('SIGKILL');
    }
  } catch {}
}

/** Останавливает VLM-сервер и ждёт фактической смерти (для арбитража VRAM перед SD). */
async function stopVlmServerAndWait() {
  if (!vlmServerProc && !(await isVlmServerAlive())) return;
  stopVlmServer();
  for (let i = 0; i < 24 && (await isVlmServerAlive()); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (await isVlmServerAlive()) serverLog('llama-server не умер за 12с — VRAM может не хватить SD');
  else serverLog('llama-server остановлен, VRAM свободна');
}

async function analyzeImageServer(options, bundle, modelDef, promptText, maxTokens) {
  const mime = options.mimeType || 'image/jpeg';
  const dataUrl = `data:${mime};base64,${options.imageBase64}`;
  const body = {
    max_tokens: maxTokens,
    temperature: 0.2,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: promptText },
      ],
    }],
  };
  const res = await fetch(`http://127.0.0.1:${VLM_SERVER_PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`llama-server HTTP ${res.status}: ${errText.slice(-200)}`);
  }
  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content || !String(content).trim()) throw new Error('llama-server вернул пустой ответ.');
  return String(content);
}

function serverLog(...args) {
  console.error('[hc/vlm-server]', ...args);
}

let cliProcess = null;

function resolveResource(...parts) {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, ...parts));
    candidates.push(path.join(process.resourcesPath, 'resources', ...parts));
  }
  candidates.push(path.join(__dirname, 'node_modules', 'electron', 'dist', 'resources', ...parts));
  candidates.push(path.join(__dirname, 'resources', ...parts));
  candidates.push(path.join(__dirname, ...parts));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function findMtmdExe() {
  const names = ['llama-mtmd-cli.exe', 'llama-mtmd-cli'];
  const dirs = [
    path.join(__dirname, 'llama-mtmd'),
    path.join(__dirname, 'llama-mtmd', 'bin'),
    process.resourcesPath ? path.join(process.resourcesPath, 'llama-mtmd') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'resources', 'llama-mtmd') : null,
  ].filter(Boolean);

  for (const dir of dirs) {
    for (const name of names) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function getModelDef(modelId) {
  return VLM_MODELS[modelId] || VLM_MODELS.qwen25vl;
}

function resolveBundle(modelDef) {
  const modelPath = resolveResource(modelDef.dir, modelDef.model);
  const mmprojPath = resolveResource(modelDef.dir, modelDef.mmproj);
  const missing = [];
  if (!modelPath) missing.push(modelDef.model);
  if (!mmprojPath) missing.push(modelDef.mmproj);
  return {
    ok: missing.length === 0,
    modelPath,
    mmprojPath,
    missing,
    modelDef,
  };
}

function getStatus(preferredId) {
  const exe = findMtmdExe();
  const models = Object.values(VLM_MODELS).map((m) => {
    const b = resolveBundle(m);
    return {
      id: m.id,
      name: m.name,
      sizeLabel: m.sizeLabel,
      vramMb: m.vramMb,
      ready: b.ok,
      missing: b.missing,
    };
  });
  const preferred = preferredId && models.find((m) => m.id === preferredId && m.ready);
  const ready = preferred || models.find((m) => m.ready) || null;
  return {
    exeOk: !!exe,
    exePath: exe,
    ready: !!(exe && ready),
    activeModelId: ready?.id || null,
    models,
    hint: !exe
      ? 'Скачай CLI: npm run download:vlm'
      : !ready
        ? 'Скачай модель: npm run download:moondream'
        : null,
  };
}

function abortAnalysis() {
  if (!cliProcess) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(cliProcess.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      cliProcess.kill('SIGKILL');
    }
  } catch {}
  cliProcess = null;
}

function killPrevious() {
  return new Promise((resolve) => {
    if (!cliProcess) return resolve();
    abortAnalysis();
    setTimeout(resolve, 200);
  });
}

function writeTempImage(imageBase64, mimeType) {
  const raw = String(imageBase64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!raw) throw new Error('Пустое изображение');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length < 32) throw new Error('Изображение слишком маленькое');
  const ext =
    /png/i.test(mimeType || '') ? 'png' :
    /webp/i.test(mimeType || '') ? 'webp' :
    /gif/i.test(mimeType || '') ? 'gif' : 'jpg';
  const tmp = path.join(os.tmpdir(), `HC AI_vlm_${Date.now()}.${ext}`);
  fs.writeFileSync(tmp, buf);
  return tmp;
}

// Moondream 0.5B на реальных фото часто впадает в шаблонный отказ.
// Аппроксимация рефьюза: ответ начинается/содержит фразы отказа ИЛИ прямо говорит «cannot generate».
const REFUSAL_RE =
  /(^|\b)(i am sorry|i'?m sorry|sorry about|sorry for|sorry,|sorry\.|as an ai|i cannot|i can'?t|i apologize|unfortunately|i am unable|i was trying to help|please provide|please give me|i don'?t understand|cannot determine)[,.]?(\b|$)|cannot\s+(generate|create|produce|provide)\b/i;

function isRefusal(text) {
  const t = String(text || '').trim();
  if (t.length < 20) return false;
  // Короткий извиняющийся ответ без смыслового содержания = отказ.
  return REFUSAL_RE.test(t);
}

// Для режима calories модель обязана дать числа (ккал) — иначе это не расчёт.
function answerMeetsMode(text, mode) {
  if (mode !== 'calories') return true;
  const t = String(text || '');
  // Число + единица (ккал/kcal), либо слово "calories"/"ккал".
  return /\d+\s*(?:kcal|cal|ккал|кал)/i.test(t) || /\b(?:calories|calorie)\b/i.test(t) || /ккал/i.test(t);
}

// Лестница промптов: если модель отказалась или не ответил по делу (calories) —
// пробуем «продолжи» (completion) или режим-специфичный повтор.
// Модель дообучается дописывать continuation, а не отклонять.
function fallbackPrompts(original, mode, lang) {
  if (mode === 'ocr') {
    // Модель часто ограничивается заголовком — второй заход требует ВСЁ подряд.
    const strict =
      'Transcribe EVERY piece of text on this image, top to bottom, line by line. ' +
      'Include table rows, player/team names, scores, numbers, dates, small labels and footers. ' +
      'Do NOT summarize. Do NOT stop after the title. Output only the transcription.';
    const strictRu =
      'Перепиши ВЕСЬ текст с изображения сверху вниз, строка за строкой. ' +
      'Включай каждую строку таблицы, имена, очки, числа, даты, мелкие подписи и колонтитулы. ' +
      'Не сокращай. Не останавливайся после заголовка. Выводи только транскрипцию.';
    return [original, strict, strictRu, strict + ' Continue the transcription from the beginning.'];
  }
  if (mode === 'calories') {
    if (lang === LANG.ru) {
      return [
        original,
        'Определи каждый ИНГРЕДИЕНТ блюда на фото (листья салата, курица, сыр, соус, гарнир — всё отдельно). ' +
          'Для каждого ингредиента: порция в граммах и калорийность числом. ' +
          'Каждый ингредиент — ОБЯЗАТЕЛЬНО на отдельной строке, формат: "ингредиент (~N г) - N ккал". ' +
          'НЕ объединяй блюдо в одну строку. В конце "Итого: N ккал". Если еды нет — "Еды нет". Отвечай на русском.',
        'Перечисли продукты на фото построчно, каждый на своей строке, с числом ккал: ',
        'Назови, какие продукты/блюда есть на этом фото. Просто перечисли названия. Если еды нет — "Еды нет". Отвечай на русском.',
      ];
    }
    return [
      original,
      'Identify each INGREDIENT of the dish on the photo (lettuce, chicken, cheese, sauce, garnish — all separately). ' +
        'For each ingredient: portion in grams and calories as a number. ' +
        'Each ingredient on its OWN line, format: "ingredient (~N g) - N kcal". ' +
        'Do NOT collapse the dish into a single line. End with "Total: N kcal". If there is no food, answer "No food".',
      'List the food items on the photo line by line, each on its own line, with kcal numbers: ',
      'Describe exactly what food or drink items are in this photo. Just name the dishes and ingredients. If there is no food, answer "No food".',
    ];
  }
  if (lang === LANG.ru) {
    return [
      original,
      'Что ты видишь на этом изображении? Перечисли объекты, их цвета и сцену. Отвечай кратко и по делу, без лишних дисклеймеров. На русском.',
      'На этом фото изображено ',
      'Опиши главный объект и окружение. Начни прямо: ',
      'На изображении находится ',
    ];
  }
  return [
    original,
    'What do you see in this image? List the objects, their colors and the scene. Answer directly without disclaimers.',
    'This photo shows ',
    'Describe the main subject and surroundings. Start directly: ',
    'The image contains ',
  ];
}

/**
 * Один прогон llama-mtmd-cli с указанным промптом. Возвращает очищенный текст.
 */
function runMtmdOnce(bundle, exe, modelDef, tmpImg, promptText, maxTokens, send) {
  // Промпт через UTF-8 файл (-f), а не argv (-p): на Windows CRT декодирует
  // argv в ANSI code page (cp1251) и рвёт UTF-8 → модель получает мусор.
  const tmpPrompt = path.join(os.tmpdir(), `HC AI_vlm_prompt_${Date.now()}.txt`);
  try {
    fs.writeFileSync(tmpPrompt, promptText, 'utf8');
  } catch {
    return Promise.reject(new Error('Не удалось записать промпт'));
  }

  const args = [
    '-m', bundle.modelPath,
    '--mmproj', bundle.mmprojPath,
    '--image', tmpImg,
    '--file', tmpPrompt,
    '-n', String(maxTokens),
    '--temp', '0.2',
    '-ngl', '99',
  ];
  if (modelDef.chatTemplate) {
    args.push('--chat-template', modelDef.chatTemplate);
  }
  if (Array.isArray(modelDef.extraArgs)) {
    args.push(...modelDef.extraArgs);
  }

  return new Promise((resolve, reject) => {
    const outChunks = [];
    const errChunks = [];
    let settled = false;

    const finish = (err, text) => {
      if (settled) return;
      settled = true;
      cliProcess = null;
      try { fs.unlinkSync(tmpPrompt); } catch {}
      if (err) reject(err);
      else resolve(text);
    };

    let proc;
    try {
      console.error('[hc/vlm] spawn llama-mtmd-cli:', exe);
      proc = spawn(exe, args, {
        cwd: path.dirname(exe),
        windowsHide: true,
        env: { ...process.env },
      });
      proc.__startMs = Date.now();
    } catch (e) {
      return finish(e);
    }

    const timeout = setTimeout(() => {
      abortAnalysis();
      finish(new Error('VLM таймаут >3 мин'));
    }, 180000);

    proc.stdout.on('data', (chunk) => {
      outChunks.push(chunk);
      const progress = 20 + Math.floor(outChunks.reduce((n, c) => n + c.length, 0) / 40);
      send?.('vlm:progress', {
        progress: Math.min(90, progress),
        text: 'Анализ изображения...',
        phase: 'gen',
      });
    });
    proc.stderr.on('data', (chunk) => {
      errChunks.push(chunk);
      // Прогресс загрузки модели виден только в stderr — стримим в main-лог,
      // иначе зависание mtmd-cli полностью невидимо.
      const lines = String(chunk).split('\n').map(s => s.trim()).filter(Boolean);
      for (const line of lines) {
        if (/llama_|ggml_|clip_|mtmd_|load|error|fail|alloc/i.test(line)) {
          console.error('[hc/vlm-stderr]', line.slice(0, 200));
        }
      }
    });

    proc.on('error', (e) => {
      clearTimeout(timeout);
      finish(e);
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      console.error('[hc/vlm] llama-mtmd-cli exit', code, 'за',
        ((Date.now() - (proc.__startMs || Date.now())) / 1000).toFixed(1) + 'с');
      const stdout = Buffer.concat(outChunks).toString('utf8');
      const stderr = Buffer.concat(errChunks).toString('utf8');
      if (code !== 0 && !stdout.trim()) {
        const errTail = stderr.split('\n').filter(Boolean).slice(-8).join('\n');
        return finish(new Error(`llama-mtmd-cli exit ${code}. ${errTail || 'нет вывода'}`));
      }
      const text = cleanMtmdOutput(stdout, promptText);
      if (!text) {
        return finish(new Error('Пустой ответ VLM. ' + (stderr.slice(-400) || '')));
      }
      finish(null, text);
    });
  });
}

/**
 * @param {{ imageBase64: string, mimeType?: string, mode?: string, prompt?: string, modelId?: string, maxTokens?: number }} options
 * @param {(channel: string, data: any) => void} send
 */
async function analyzeImage(options, send) {
  const status = getStatus(options.modelId);
  if (!status.exeOk) {
    throw new Error(`llama-mtmd-cli не найден. ${status.hint}`);
  }

  const modelDef = getModelDef(options.modelId || status.activeModelId);
  const bundle = resolveBundle(modelDef);
  if (!bundle.ok) {
    throw new Error(
      `VLM-модель ${modelDef.name} не найдена (нет: ${bundle.missing.join(', ')}). ` +
        'npm run download:moondream'
    );
  }

  await killPrevious();

  const tmpImg = writeTempImage(options.imageBase64, options.mimeType);
  const lang = modelLang(modelDef);
  const originalPrompt = buildPrompt(options.mode || 'describe', options.prompt, lang);
  const maxTokens = Math.min(Math.max(Number(options.maxTokens) || 700, 64), 1024);
  const exe = findMtmdExe();
  const startMs = Date.now();

  send?.('vlm:progress', { progress: 5, text: `Загрузка ${modelDef.name}...`, phase: 'load' });

  const prompts = fallbackPrompts(originalPrompt, options.mode, lang);
  let lastErr = null;
  let accepted = null; // ответ, прошедший валидацию режима
  let backup = null;   // запасной осмысленный ответ (для не-calories)

  try {
    // Server mode: llama-server держит модель в VRAM — последующие чипы мгновенные.
    // При любом сбое — откат на CLI (killPrevious уже провернул).
    let serverReady = false;
    if (findLlamaServer()) {
      try {
        serverReady = await startVlmServer(modelDef, send);
      } catch (e) {
        serverLog('старт не удался:', e?.message || e);
        serverReady = false;
      }
    }

    for (let i = 0; i < prompts.length; i++) {
      if (i > 0) {
        send?.('vlm:progress', {
          progress: 25 + i * 15,
          text: 'Модель не по делу — пробуем иначе...',
          phase: 'retry',
        });
      }
      let lastText = '';
      try {
        if (serverReady) {
          const t0 = Date.now();
          const ctl = new AbortController();
          const tm = setTimeout(() => ctl.abort(), 180000);
          let raw;
          try {
            raw = await analyzeImageServer(options, bundle, modelDef, prompts[i], maxTokens);
          } finally {
            clearTimeout(tm);
          }
          send?.('vlm:progress', { progress: 60, text: 'Анализ изображения...', phase: 'gen' });
          lastText = cleanMtmdOutput(raw, prompts[i]);
          console.error('[hc/vlm-server] запрос за', ((Date.now() - t0) / 1000).toFixed(1) + 'с');
        } else {
          lastText = await runMtmdOnce(bundle, exe, modelDef, tmpImg, prompts[i], maxTokens, send);
        }
      } catch (e) {
        lastErr = e;
        lastText = '';
        // Сервер сломался посреди лестницы — откатываемся на CLI
        if (serverReady) {
          serverLog('запрос упал, откат на CLI:', e?.message || e);
          serverReady = false;
        }
      }
      if (!lastText) continue;
      const refusal = isRefusal(lastText);
      // Эвристики «модель ответила не по формату»:
      //  OCR: 1) короткий ответ (<60 симв.) — только заголовок;
      //       2) ответ заканчивается на двоеточие — вступление без транскрипции.
      //  Calories: меньше 2 строк или <80 симв. — схлопнул блюдо в одну строку,
      //       проигнорировал разбивку по ингредиентам.
      // Ретраим со строгим промптом, если остались попытки (последнюю принимаем как есть).
      const trimmed = lastText.trim();
      const ocrIncomplete = options.mode === 'ocr' && i < prompts.length - 1 &&
        (lastText.length < 60 || /[:：]\s*$/.test(trimmed));
      const calShort = options.mode === 'calories' && i < prompts.length - 1 &&
        (lastText.split('\n').filter((l) => l.trim()).length < 2 || lastText.length < 80);
      const meets = answerMeetsMode(lastText, options.mode) && !ocrIncomplete && !calShort;
      console.error('[hc/vlm] попытка', i + 1, '| refusal:', refusal, '| meets:', meets,
        '| ответ:', JSON.stringify(lastText.slice(0, 300)));
      if (!refusal && meets) {
        accepted = lastText;
        break;
      }
      if (!refusal && !backup) backup = lastText;
    }

    const finalText = accepted || (options.mode === 'calories' ? null : backup);
    if (!finalText) {
      // Для calories обязательны цифры; но даже без них у нас может быть описание еды
      // от запасного ответа — вернуть его с флагом, чтобы main.cjs дал HC AI второй шанс.
      if (options.mode === 'calories') {
        return {
          text: backup || '',
          modelId: modelDef.id,
          modelName: modelDef.name,
          mode: 'calories',
          elapsedMs: Date.now() - startMs,
          prompt: originalPrompt,
          needsCalorieCheck: true,
        };
      }
      throw lastErr || new Error('VLM не дал содержательного ответа');
    }

    send?.('vlm:progress', { progress: 100, text: 'Готово', phase: 'done' });
    return {
      text: finalText,
      modelId: modelDef.id,
      modelName: modelDef.name,
      mode: options.mode || 'describe',
      elapsedMs: Date.now() - startMs,
      prompt: originalPrompt,
    };
  } finally {
    try { fs.unlinkSync(tmpImg); } catch {}
  }
}

/** Вырезает эхо промпта / служебный мусор mtmd-cli из stdout. */
function cleanMtmdOutput(raw, prompt) {
  let t = String(raw || '').replace(/\r/g, '');
  // убрать ANSI
  t = t.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = t.split('\n');
  const promptNorm = String(prompt || '').trim().toLowerCase();

  // часто ответ после маркеров
  const markers = [
    /^(assistant|ASSISTANT)\s*:?\s*$/i,
    /^>\s*$/,
    /^response\s*:?\s*$/i,
  ];
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (markers.some((re) => re.test(lines[i].trim()))) {
      start = i + 1;
    }
  }
  t = lines.slice(start).join('\n').trim();

  // если целиком задублирован промпт в начале
  if (promptNorm && t.toLowerCase().startsWith(promptNorm)) {
    t = t.slice(prompt.length).trim();
  }

  // выкинуть строки лога llama
  t = t
    .split('\n')
    .filter((line) => {
      const s = line.trim();
      if (!s) return true;
      if (/^(llama_|ggml_|clip_|mtmd_|main:|load_)/i.test(s)) return false;
      if (/^slot\s/i.test(s)) return false;
      if (/system_info|sampling|generate:|prompt eval/i.test(s)) return false;
      return true;
    })
    .join('\n')
    .trim();

  // Китайские модели (Qwen и др.) иногда прорывают иероглифы/китайский токенайзер
  // в середине русского ответа. Вырезаем CJK-блоки.
  t = t
    .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+/g, ' ')
    .replace(/[，。；：！？、（）【】《》“”‘’]/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return t;
}

module.exports = {
  VLM_MODELS,
  PRESET_PROMPTS,
  getStatus,
  analyzeImage,
  abortAnalysis,
  getModelDef,
  stopVlmServer,
  stopVlmServerAndWait,
};
