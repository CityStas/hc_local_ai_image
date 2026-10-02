// sdEngine.cjs — HC AI (Z-Image-Turbo, stable-diffusion.cpp / leejet)
// https://github.com/leejet/stable-diffusion.cpp/blob/master/docs/z_image.md
// https://huggingface.co/leejet/Z-Image-Turbo-GGUF
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { spawn } = require('child_process');

const MODEL = {
  id: 'z-image-turbo',
  name: 'HC AI',
  tagline: 'Z-Image-Turbo · leejet/sdcpp · RU/EN',
  dir: 'z-image-turbo',
  diffusion: 'z_image_turbo-Q4_K.gguf',
  vae: 'ae.safetensors',
  llm: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
  family: 'z-image-turbo',
  sizeLabel: '~8 GB (3 файла)',
  steps: 10,
  cfg: 1.0,
  modelArgs: 'qwen_image_zero_cond_t=true',
};

// leejet/sdcpp: --cfg-scale 1.0 --steps 8
const DEFAULT_NEGATIVE = '';

// Z-Image-Turbo: distilled FLUX — обязательно distilledGuidance 3.5
// sampler: euler, schedule: sgm_uniform — рекомендация leejet z_image.md
// cache: taylorseer ускоряет CPU до 35%
const FAST_CPU = {
  width: 768,
  height: 768,
  steps: 10,
  cfg: 1,
  distilledGuidance: 3.5,
  sampleMethod: 'euler',
  scheduler: 'sgm_uniform',
  cacheMode: 'taylorseer',
  cachePreset: null,
};

const FAST_GPU = {
  width: 768,
  height: 768,
  steps: 8,
  cfg: 1,
  distilledGuidance: 3.5,
  sampleMethod: 'euler',
  scheduler: 'sgm_uniform',
  cacheMode: null,
};

let cachedBackend = null;
let modelMeta = null;

let sdMod = null;
let sdCtx = null;
let sdLoading = null;
let activeAbort = null;
let sdCallbacksReady = false;
let previewEnabledForGpu = false;
let progressSender = null;
let ctxHasEncoder = false;
let ctxSampleMethod = null;
let ctxScheduler = null;
let cliProcess = null;

// ── CLI (leejet sd.exe Vulkan) ─────────────────────────────────────────────

// ── CLI (leejet sd.exe Vulkan) ─────────────────────────────────────────────

function findSdExe() {
  const candidates = [
    path.join(__dirname, 'sd-vulkan', 'sd-cli.exe'),
    path.join(__dirname, 'sd-vulkan', 'sd.exe'),
    path.join(__dirname, 'sd-vulkan', 'bin', 'sd-cli.exe'),
    path.join(__dirname, 'sd-bin', 'sd-cli.exe'),
    path.join(__dirname, 'sd-bin', 'sd.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function isCLIMode() {
  return !!findSdExe();
}

async function generateImageCLI(options, send) {
  const userPrompt = String(options.prompt || '').trim();
  if (!userPrompt) throw new Error('Пустой промпт.');

  const modelDef = getModelDef(options.imageModelId);
  const bundle = resolveBundle(modelDef);
  if (!bundle.ok) throw new Error(modelMissingError(bundle));

  const sdExe = findSdExe();
  const defs = FAST_GPU;
  const startMs = Date.now();

  // Убиваем предыдущий процесс (на Windows SIGTERM не работает — он мог зависнуть)
  await killPreviousCLI();

  const width  = align64(options.width  ?? defs.width,  512, 2048);
  const height = align64(options.height ?? defs.height, 512, 2048);
  const steps  = clamp(options.steps ?? modelDef.steps ?? defs.steps, 4, 20);
  const cfg    = clamp(options.cfg   ?? modelDef.cfg   ?? defs.cfg,   0,  2);
  const distilledGuidance = clamp(options.distilledGuidance ?? defs.distilledGuidance ?? 3.5, 0, 10);
  const seed   = Number.isFinite(options.seed) && options.seed >= 0 ? options.seed : Math.floor(Math.random() * 2147483647);
  const negativePrompt = String(options.negativePrompt || '').trim();

  const tmpOut = path.join(os.tmpdir(), `hc_img_${Date.now()}.png`);

  const args = [
    '--diffusion-model', bundle.diffusion,
    '--vae', bundle.vae,
    '--llm', bundle.llm,
    '-p', userPrompt,
    '-o', tmpOut,
    '--cfg-scale', String(cfg),
    '--guidance', String(distilledGuidance),
    '--steps', String(steps),
    '--sampling-method', options.sampleMethod || defs.sampleMethod,
    '--scheduler', options.scheduler || defs.scheduler,
    '-W', String(width),
    '-H', String(height),
    '-s', String(seed),
    '--diffusion-fa',
    '--vae-tiling',
    '--backend', 'diffusion=vulkan0,te=cpu',
  ];
  if (modelDef.modelArgs) {
    args.push('--model-args', modelDef.modelArgs);
  }
  if (negativePrompt) args.push('-n', negativePrompt);

  // img2img: init-изображение → temp-файл + --init-img/--strength
  const initB64 = initImageToBase64(options.initImage);
  let tmpInit = null;
  if (initB64) {
    const strength = clamp(options.strength ?? 0.65, 0.1, 0.95);
    tmpInit = path.join(os.tmpdir(), `hc_init_${Date.now()}.png`);
    fs.writeFileSync(tmpInit, Buffer.from(initB64, 'base64'));
    args.push('--init-img', tmpInit, '--strength', String(strength));
  }

  send?.('sd:progress', {
    progress: 5,
    text: `Генерация (~20-90 сек.)`,
    phase: 'load',
  });

  console.error('[hc/cli] spawn:', sdExe);
  console.error('[hc/cli] cmd:', args.join(' '));

  return new Promise((resolve, reject) => {
    const abort = new AbortController();
    activeAbort = abort;

    const proc = spawn(sdExe, args, {
      env: {
        ...process.env,
        GGML_VK_VISIBLE_DEVICES: process.env.GGML_VK_VISIBLE_DEVICES ?? '0',
        VK_ICD_FILENAMES: undefined,
      },
    });
    cliProcess = proc;

    // Таймаут 5 мин — если sd-cli.exe завис, возвращаем ошибку вместо вечной загрузки
    const TIMEOUT_MS = 5 * 60 * 1000;
    const timeoutId = setTimeout(() => {
      console.error('[hc/cli] TIMEOUT >5 мин, убиваем sd-cli.exe pid=', proc.pid);
      abortCLI();
      reject(new Error('Таймаут генерации (5 мин). Возможно VRAM переполнена — перезапустите приложение.'));
    }, TIMEOUT_MS);

    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      const line = chunk.toString();
      stderr += line;
      // Логируем первые 3000 символов для диагностики
      if (stderr.length < 3000) console.error('[hc/sd-stderr]', line.trimEnd());

      const m = line.match(/step\s+(\d+)\s*\/\s*(\d+)/i);
      if (m && send) {
        const step  = parseInt(m[1], 10);
        const total = parseInt(m[2], 10);
        const pct = Math.min(95, Math.round(15 + (step / total) * 78));
        const elapsed = (Date.now() - startMs) / 1000;
        const secPerStep = step > 0 ? elapsed / step : 0;
        const eta = secPerStep > 0 ? Math.round(secPerStep * (total - step)) : 0;
        send('sd:progress', {
          progress: pct,
          text: `Шаг ${step}/${total}${eta > 0 ? ` · ~${eta}с` : ''}`,
          phase: 'sample',
          step, steps: total, etaSec: eta,
        });
      }
    });

    proc.stdout.on('data', (chunk) => {
      const line = chunk.toString();
      // Логируем stdout тоже — sd-cli.exe часто пишет ошибки туда
      console.error('[hc/sd-stdout]', line.trimEnd());
      const m = line.match(/step\s+(\d+)\s*\/\s*(\d+)/i);
      if (m && send) {
        const step = parseInt(m[1], 10);
        const total = parseInt(m[2], 10);
        const pct = Math.min(95, Math.round(15 + (step / total) * 78));
        send('sd:progress', { progress: pct, text: `Шаг ${step}/${total}`, phase: 'sample', step, steps: total });
      }
    });

    abort.signal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      abortCLI();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      cliProcess = null;
      activeAbort = null;
      if (tmpInit) { try { fs.unlinkSync(tmpInit); } catch {} }
      console.error('[hc/cli] exit code=', code);

      if (abort.signal.aborted) {
        try { fs.unlinkSync(tmpOut); } catch {}
        return reject(new DOMException('Aborted', 'AbortError'));
      }

      if (code !== 0) {
        console.error('[hc/cli] stderr tail:', stderr.slice(-800));
        return reject(new Error(`sd.exe завершился с кодом ${code}.\n${stderr.slice(-300)}`));
      }

      if (!fs.existsSync(tmpOut)) {
        return reject(new Error('sd.exe не создал выходной файл.'));
      }
      if (tmpInit) { try { fs.unlinkSync(tmpInit); } catch {} }

      try {
        const buf = fs.readFileSync(tmpOut);
        const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
        fs.unlinkSync(tmpOut);
        send?.('sd:progress', { progress: 100, text: 'Готово', phase: 'done' });
        resolve({
          dataUrl,
          width, height, seed, steps, cfg,
          elapsedMs: Date.now() - startMs,
          prompt: userPrompt,
          userPrompt: options.userPrompt || userPrompt,
          modelName: modelDef.name + ' (Vulkan)',
          modelId: modelDef.id,
        });
      } catch (e) {
        reject(e);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      cliProcess = null;
      reject(new Error(`Не удалось запустить sd.exe: ${err.message}`));
    });
  });
}

function abortCLI() {
  const proc = cliProcess;
  cliProcess = null;
  if (!proc) return;
  const pid = proc.pid;
  if (!pid) return;
  try {
    // На Windows SIGTERM не работает — используем taskkill для дерева процессов
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true }).unref();
    } else {
      proc.kill('SIGKILL');
    }
  } catch {}
}

// ── Server mode (sd-server.exe — модели остаются загруженными в VRAM) ──────
// CLI-режим перечитывает ~6.6GB моделей с диска на каждую генерацию (30-50s).
// sd-server.exe держит модели в памяти и генерирует за ~15-25s.
// API: POST /sdcpp/v1/img_gen → {id, poll_url}; GET /sdcpp/v1/jobs/{id} → {status, result}.

const SD_SERVER_PORT = 8687;
let serverProc = null;
let serverStarting = null;
let serverJobId = null;

function findSdServerExe() {
  const candidates = [
    path.join(__dirname, 'sd-vulkan', 'sd-server.exe'),
    path.join(__dirname, 'sd-bin', 'sd-server.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function isServerAlive() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${SD_SERVER_PORT}/sdcpp/v1/capabilities`, { signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function startSdServer(send) {
  if (await isServerAlive()) return true;
  if (serverStarting) return serverStarting;

  const exe = findSdServerExe();
  const bundle = resolveModelBundle();
  if (!exe || !bundle.ok) return false;

  serverStarting = (async () => {
    console.error('[hc/server] запускаю sd-server.exe:', exe);
    send?.('sd:progress', {
      progress: 5,
      text: 'Запуск HC AI (загрузка моделей в память)...',
      phase: 'load',
    });
    const args = [
      '--diffusion-model', bundle.diffusion,
      '--vae', bundle.vae,
      '--llm', bundle.llm,
      '--listen-port', String(SD_SERVER_PORT),
      '--diffusion-fa',
      '--vae-tiling',
      '--backend', 'diffusion=vulkan0,te=cpu',
      '--model-args', 'qwen_image_zero_cond_t=true',
    ];
    serverProc = spawn(exe, args, {
      env: {
        ...process.env,
        GGML_VK_VISIBLE_DEVICES: process.env.GGML_VK_VISIBLE_DEVICES ?? '0',
        VK_ICD_FILENAMES: undefined,
      },
    });
    const t0 = Date.now();
    while (Date.now() - t0 < 10 * 60 * 1000) {
      if (serverProc.exitCode !== null) {
        console.error('[hc/server] sd-server.exe завершился с кодом', serverProc.exitCode);
        serverProc = null;
        serverStarting = null;
        return false;
      }
      if (await isServerAlive()) {
        console.error('[hc/server] sd-server готов на порту', SD_SERVER_PORT);
        serverStarting = null;
        return true;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    serverStarting = null;
    stopSdServer();
    return false;
  })();

  return serverStarting;
}

function stopSdServer() {
  const proc = serverProc;
  serverProc = null;
  serverStarting = null;
  serverJobId = null;
  if (!proc) return;
  const pid = proc.pid;
  console.error('[hc/server] останавливаю sd-server pid=', pid);
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true }).unref();
    } else {
      proc.kill('SIGKILL');
    }
  } catch {}
}

/** Убивает предыдущий CLI-процесс и ждёт 800ms для освобождения VRAM */
async function killPreviousCLI() {
  if (!cliProcess) return;
  console.error('[hc/cli] killPreviousCLI: убиваем зависший процесс pid=', cliProcess.pid);
  abortCLI();
  await new Promise(r => setTimeout(r, 800));
}

/** initImage → base64 PNG без data:-префикса (для сервера и temp-файла). */
function initImageToBase64(initImage) {
  if (!initImage) return null;
  if (initImage.dataUrl) {
    return String(initImage.dataUrl).replace(/^data:[^;]+;base64,/, '');
  }
  if (Array.isArray(initImage.data) && initImage.width && initImage.height) {
    const dataUrl = sdImageToPngBase64({
      width: initImage.width,
      height: initImage.height,
      channel: 3,
      data: Buffer.from(initImage.data),
    });
    return dataUrl ? dataUrl.replace(/^data:[^;]+;base64,/, '') : null;
  }
  return null;
}

async function generateImageServer(options, send) {
  const userPrompt = String(options.prompt || '').trim();
  if (!userPrompt) throw new Error('Пустой промпт.');

  const modelDef = getModelDef(options.imageModelId);
  const bundle = resolveBundle(modelDef);
  if (!bundle.ok) throw new Error(modelMissingError(bundle));

  const started = await startSdServer(send);
  if (!started) throw new Error('sd-server не запустился.');

  const defs = FAST_GPU;
  const startMs = Date.now();

  const width  = align64(options.width  ?? defs.width,  512, 2048);
  const height = align64(options.height ?? defs.height, 512, 2048);
  const steps  = clamp(options.steps ?? modelDef.steps ?? defs.steps, 4, 20);
  const cfg    = clamp(options.cfg   ?? modelDef.cfg   ?? defs.cfg,   0,  2);
  const distilledGuidance = clamp(options.distilledGuidance ?? defs.distilledGuidance ?? 3.5, 0, 10);
  const seed   = Number.isFinite(options.seed) && options.seed >= 0 ? options.seed : Math.floor(Math.random() * 2147483647);
  const negativePrompt = String(options.negativePrompt || '').trim();

  const body = {
    prompt: userPrompt,
    width,
    height,
    seed,
    output_format: 'png',
    sample_params: {
      sample_steps: steps,
      sample_method: options.sampleMethod || defs.sampleMethod,
      scheduler: options.scheduler || defs.scheduler,
      guidance: {
        txt_cfg: cfg,
        distilled_guidance: distilledGuidance,
      },
    },
  };
  if (negativePrompt) body.negative_prompt = negativePrompt;

  console.error('[hc/server] img_gen:', JSON.stringify({ width, height, steps, cfg, distilledGuidance, seed }));

  send?.('sd:progress', { progress: 10, text: 'Генерация (модели в памяти)...', phase: 'load' });

  const TIMEOUT_MS = 5 * 60 * 1000;
  const t0 = Date.now();

  // ── img2img: есть init-изображение → A1111-совместимый синхронный эндпоинт ──
  const initB64 = initImageToBase64(options.initImage);
  if (initB64) {
    const strength = clamp(options.strength ?? 0.65, 0.1, 0.95);
    const payload = {
      init_images: [initB64],
      prompt: userPrompt,
      denoising_strength: strength,
      width,
      height,
      steps,
      cfg_scale: cfg,
      seed,
      sampler_name: options.sampleMethod || defs.sampleMethod,
      scheduler: options.scheduler || defs.scheduler,
      output_format: 'png',
    };
    if (negativePrompt) payload.negative_prompt = negativePrompt;

    console.error('[hc/server] img2img:', JSON.stringify({ width, height, steps, strength, cfg, seed }));

    const post2 = await fetch(`http://127.0.0.1:${SD_SERVER_PORT}/sdapi/v1/img2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!post2.ok) {
      const errText = await post2.text().catch(() => '');
      throw new Error(`sd-server img2img HTTP ${post.status}: ${errText.slice(-200)}`);
    }
    const res2 = await post2.json();
    const outB64 = res2?.images?.[0];
    if (!outB64) throw new Error('sd-server img2img не вернул изображение.');
    serverJobId = null;

    send?.('sd:progress', { progress: 100, text: 'Готово', phase: 'done' });
    return {
      dataUrl: 'data:image/png;base64,' + outB64,
      width, height, seed, steps, cfg,
      elapsedMs: Date.now() - startMs,
      prompt: userPrompt,
      userPrompt: options.userPrompt || userPrompt,
      modelName: modelDef.name + ' (Server img2img)',
      modelId: modelDef.id,
    };
  }

  const post = await fetch(`http://127.0.0.1:${SD_SERVER_PORT}/sdcpp/v1/img_gen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!post.ok) throw new Error(`sd-server img_gen HTTP ${post.status}`);
  const queued = await post.json();
  const jobId = queued.id || (queued.poll_url || '').split('/').pop();
  if (!jobId) throw new Error('sd-server не вернул id задачи.');
  serverJobId = jobId;

  let job = null;
  let lastProgressSent = 10;
  while (Date.now() - t0 < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 500));
    const res = await fetch(`http://127.0.0.1:${SD_SERVER_PORT}/sdcpp/v1/jobs/${jobId}`);
    if (!res.ok) continue;
    job = await res.json();
    // Псевдопрогресс: сервер не отдаёт номера шагов — плавный рост по времени
    const elapsed = (Date.now() - startMs) / 1000;
    const est = Math.min(92, Math.round(10 + Math.min(elapsed / (steps * 2.2), 1) * 82));
    if (est > lastProgressSent) {
      lastProgressSent = est;
      send?.('sd:progress', { progress: est, text: `Генерация · ${elapsed.toFixed(0)}с`, phase: 'sample', etaSec: 0 });
    }
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') break;
  }
  serverJobId = null;

  if (!job) throw new Error('sd-server не ответил.');
  if (job.status !== 'completed') {
    const errText = job.error ? (typeof job.error === 'string' ? job.error : JSON.stringify(job.error)) : '';
    throw new Error(`sd-server: задача ${job.status}${errText ? ': ' + errText : ''}`);
  }

  const img = job.result?.images?.[0];
  const b64 = img?.data || img?.b64_json;
  if (!b64) throw new Error('sd-server не вернул изображение.');
  const dataUrl = 'data:image/png;base64,' + b64;

  send?.('sd:progress', { progress: 100, text: 'Готово', phase: 'done' });

  return {
    dataUrl,
    width, height, seed, steps, cfg,
    elapsedMs: Date.now() - startMs,
    prompt: userPrompt,
    userPrompt: options.userPrompt || userPrompt,
    modelName: modelDef.name + ' (Server)',
    modelId: modelDef.id,
  };
}

function isZImageModel() {
  return MODEL.family === 'z-image-turbo' || modelMeta?.isZImage === true;
}

function resourceRoots() {
  const roots = [];
  if (process.resourcesPath) {
    roots.push(process.resourcesPath);
    roots.push(path.join(process.resourcesPath, 'resources'));
  }
  roots.push(path.join(__dirname, 'node_modules', 'electron', 'dist', 'resources'));
  roots.push(path.join(__dirname, 'resources'));
  return roots;
}

function resolveComponent(fileName) {
  for (const root of resourceRoots()) {
    const full = path.join(root, MODEL.dir, fileName);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function resolveBundle(modelDef) {
  const diffusion = resolveComponent2(modelDef.dir, modelDef.diffusion);
  const vae = resolveComponent2(modelDef.dir, modelDef.vae);
  const llm = resolveComponent2(modelDef.dir, modelDef.llm);
  const missing = [];
  if (!diffusion) missing.push(`${modelDef.dir}/${modelDef.diffusion}`);
  if (!vae)       missing.push(`${modelDef.dir}/${modelDef.vae}`);
  if (!llm)       missing.push(`${modelDef.dir}/${modelDef.llm}`);
  return { diffusion, vae, llm, ok: missing.length === 0, missing };
}

function resolveComponent2(dir, fileName) {
  for (const root of resourceRoots()) {
    const full = path.join(root, dir, fileName);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function resolveModelBundle() {
  return resolveBundle(MODEL);
}

function getModelDef(_imageModelId) {
  return MODEL;
}

/** @deprecated используй resolveModelBundle */
function resolveModelPath() {
  return resolveModelBundle().diffusion;
}

function modelMissingError(bundle) {
  const lines = (bundle.missing || []).map((m) => `  • ${m}`).join('\n');
  return (
    `Z-Image-Turbo: не хватает файлов модели.\n${lines}\n\n` +
    `Положите их в node_modules/electron/dist/resources/${MODEL.dir}/\n` +
    `или запустите: npm run download:zimage`
  );
}

function parseBackendFromLog(text) {
  const s = String(text || '');
  const found = s.match(/Found\s+(\d+)\s+backend\s+devices?\s*:?\s*(.*)/i);
  if (!found) return null;
  const tail = found[2] || '';
  const devices = [];
  const re = /#(\d+):\s*([^,\n]+?)(?:,\s*VRAM\s*([\d.]+)\s*MB)?/gi;
  let m;
  while ((m = re.exec(tail))) {
    const name = String(m[2] || '').trim();
    const vramMb = m[3] != null ? parseFloat(m[3]) : null;
    let deviceType = 'cpu';
    if (/cuda/i.test(name)) deviceType = 'cuda';
    else if (/vulkan|gpu/i.test(name)) deviceType = 'vulkan';
    else if (/metal/i.test(name)) deviceType = 'metal';
    else if (/cpu/i.test(name)) deviceType = 'cpu';
    devices.push({ index: parseInt(m[1], 10), name, deviceType, vramMb });
  }
  if (!devices.length) return null;
  const primary = devices.find((d) => d.deviceType !== 'cpu') || devices[0];
  return {
    deviceType: primary.deviceType,
    deviceLabel: primary.name,
    devices,
    vramMb: primary.vramMb,
    prebuilt: false,
  };
}

function readGpuBackendMarker() {
  try {
    const pkg = path.join(__dirname, 'node_modules', '@stable-diffusion-cpp-node-api', 'win32-x64', '.gpu-backend');
    if (fs.existsSync(pkg)) {
      const v = fs.readFileSync(pkg, 'utf8').trim().toLowerCase();
      if (v === 'cuda' || v === 'vulkan' || v === 'gpu') {
        return { marker: v === 'gpu' ? 'cuda' : v, prebuilt: false };
      }
    }
  } catch {}
  return { marker: null, prebuilt: true };
}

function getFastDefaults() {
  const b = cachedBackend || probeBackendSync();
  return b && b.deviceType !== 'cpu' ? FAST_GPU : FAST_CPU;
}

function probeBackendSync() {
  if (cachedBackend) return cachedBackend;
  const marker = readGpuBackendMarker();
  if (marker.marker) {
    cachedBackend = {
      deviceType: marker.marker,
      deviceLabel: marker.marker === 'cuda' ? 'CUDA (custom build)' : 'Vulkan (custom build)',
      devices: [],
      vramMb: null,
      prebuilt: false,
    };
    return cachedBackend;
  }
  cachedBackend = {
    deviceType: 'cpu',
    deviceLabel: 'CPU',
    devices: [{ index: 0, name: 'CPU', deviceType: 'cpu', vramMb: 0 }],
    vramMb: 0,
    prebuilt: true,
  };
  return cachedBackend;
}

function initSdCallbacks(onGpu) {
  if (sdCallbacksReady && previewEnabledForGpu === !!onGpu) return;
  sdCallbacksReady = true;
  previewEnabledForGpu = !!onGpu;
  const sd = require('stable-diffusion-cpp-node-api');
  sd.setLogCallback?.((msg) => {
    const level = msg?.level ?? 0;
    const text = msg?.text ?? msg;
    const line = String(text || '').trim();
    const parsed = parseBackendFromLog(line);
    if (parsed) {
      cachedBackend = parsed;
      console.error('[hc/image] backend:', parsed.deviceLabel, parsed.devices?.map((d) => d.name).join(', '));
    }
    if (level <= 1) console.error('[hc/image]', line);
  });
  sd.setProgressCallback(({ step, steps, time }) => {
    if (!progressSender || !steps || steps > 100) return;
    const pct = Math.min(95, Math.round(15 + (step / steps) * 78));
    const secPerStep = Number(time) || 0;
    const etaSec = secPerStep > 0 ? Math.round(secPerStep * Math.max(0, steps - step)) : 0;
    progressSender('sd:progress', {
      progress: pct,
      text: `Шаг ${step}/${steps}${etaSec > 0 ? ` · ~${etaSec}с` : ''}`,
      phase: 'sample',
      step,
      steps,
      etaSec,
    });
  });
  // На CPU: preview выключаем — промежуточные шаги выглядят как глитч + замедляют генерацию
  sd.setPreviewCallback?.(
    onGpu
      ? ({ step, frames }) => {
          if (!progressSender || !frames?.length) return;
          try {
            const dataUrl = sdImageToPngBase64(frames[0]);
            if (dataUrl) progressSender('sd:preview', { step, dataUrl });
          } catch (e) {
            console.error('[hc/image] preview:', e?.message || e);
          }
        }
      : null,
    onGpu ? { mode: 'proj', interval: 2, denoised: true, noisy: false } : undefined
  );
}

async function getSdModule() {
  if (!sdMod) sdMod = require('stable-diffusion-cpp-node-api');
  return sdMod;
}

async function ensureModelMeta(diffusionPath) {
  if (modelMeta) return modelMeta;
  try {
    const sd = await getSdModule();
    if (sd.extractMetaData && diffusionPath) {
      modelMeta = await sd.extractMetaData(diffusionPath);
      console.error('[hc/image] meta:', modelMeta?.versionLabel || modelMeta?.version, 'isZImage=', modelMeta?.isZImage);
    }
  } catch (e) {
    console.error('[hc/image] meta:', e?.message || e);
  }
  return modelMeta;
}

async function ensureContext(onProgress, needEncoder) {
  const bundle = resolveModelBundle();
  if (!bundle.ok) throw new Error(modelMissingError(bundle));

  const wantEncoder = !!needEncoder;
  if (sdCtx && !sdCtx.isClosed && ctxHasEncoder === wantEncoder) return sdCtx;
  if (sdCtx && !sdCtx.isClosed) {
    try { sdCtx.close(); } catch {}
    sdCtx = null;
    ctxSampleMethod = null;
    ctxScheduler = null;
  }
  if (sdLoading) return sdLoading;

  sdLoading = (async () => {
    const sd = await getSdModule();
    await ensureModelMeta(bundle.diffusion);
    onProgress?.({ progress: 10, text: `Загрузка ${MODEL.name} (${MODEL.sizeLabel})...` });
    console.error('[hc/image] diffusion:', bundle.diffusion);
    console.error('[hc/image] vae:', bundle.vae);
    console.error('[hc/image] llm:', bundle.llm);
    const backend = probeBackendSync();
    const onGpu = backend.deviceType !== 'cpu';
    const threads = Math.max(4, os.cpus()?.length || 4);
    const ctx = await sd.StableDiffusionContext.create({
      diffusionModelPath: bundle.diffusion,
      vaePath: bundle.vae,
      llmPath: bundle.llm,
      nThreads: threads,
      enableMmap: true,
      vaeDecodeOnly: !wantEncoder,
      freeParamsImmediately: false,
      offloadParamsToCpu: true,
      keepVaeOnCpu: !onGpu,
      keepClipOnCpu: !onGpu,
      diffusionFlashAttn: onGpu,
      qwenImageZeroCondT: true,   // Z-Image-Turbo: zero-conditioned Qwen encoder
    });
    try {
      ctxSampleMethod = ctx.getDefaultSampleMethod?.() || FAST_GPU.sampleMethod;
      ctxScheduler = ctx.getDefaultScheduler?.(ctxSampleMethod) || FAST_GPU.scheduler;
    } catch {
      ctxSampleMethod = FAST_GPU.sampleMethod;
      ctxScheduler = FAST_GPU.scheduler;
    }
    onProgress?.({ progress: 100, text: `${MODEL.name} готов` });
    sdCtx = ctx;
    ctxHasEncoder = wantEncoder;
    sdLoading = null;
    return ctx;
  })();

  try {
    return await sdLoading;
  } catch (e) {
    sdLoading = null;
    throw e;
  }
}

function abortGeneration() {
  abortCLI();
  if (activeAbort) {
    try { activeAbort.abort(); } catch {}
    activeAbort = null;
  }
  if (sdCtx && !sdCtx.isClosed) {
    try { sdCtx.abort(); } catch {}
  }
  // Отменяем активную задачу sd-server (если есть)
  if (serverJobId) {
    const jobId = serverJobId;
    fetch(`http://127.0.0.1:${SD_SERVER_PORT}/sdcpp/v1/jobs/${jobId}/cancel`, { method: 'POST' })
      .catch(() => {});
  }
}

function crc32(buf) {
  const CRC_TABLE = sdEngine_crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

let _crcTable = null;
function sdEngine_crcTable() {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    _crcTable[i] = c;
  }
  return _crcTable;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crcBuf]);
}

function sdImageToPngBase64(img) {
  const width = img?.width || 0;
  const height = img?.height || 0;
  const channel = img?.channel || 3;
  const buf = Buffer.isBuffer(img?.data) ? img.data : Buffer.from(img?.data || []);
  if (!width || !height || !buf.length) return null;

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * channel;
      const di = y * stride + 1 + x * 3;
      raw[di] = buf[si] ?? 0;
      raw[di + 1] = buf[si + 1] ?? 0;
      raw[di + 2] = channel >= 3 ? (buf[si + 2] ?? 0) : raw[di];
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 4 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(Number(v) || lo, lo), hi);
}

function align64(n, lo, hi) {
  const v = Math.round(Number(n) / 64) * 64;
  return clamp(v, lo, hi);
}

async function generateImage(options, send) {
  // Приоритет — sd-server.exe (модели остаются в VRAM, ~15-25с на генерацию).
  // Фолбэк — sd-cli.exe (каждый раз перечитывает модели с диска, 60-100с).
  if (findSdServerExe()) {
    try {
      return await generateImageServer(options, send);
    } catch (e) {
      console.error('[hc/server] упал, фолбэк на CLI:', e?.message || e);
      send?.('sd:progress', { progress: 8, text: 'Server недоступен — запуск CLI...', phase: 'load' });
      if (/abort/i.test(String(e?.message || e))) throw e;
    }
  }
  return generateImageCLI(options, send);
}

function getStatus() {
  const bundle = resolveModelBundle();
  const cliMode = isCLIMode();
  let systemInfo = '';
  let version = '';
  if (!cliMode) {
    try {
      initSdCallbacks(false);
      const sd = require('stable-diffusion-cpp-node-api');
      systemInfo = sd.getSystemInfo?.() || '';
      version = sd.version?.() || '';
    } catch (e) {
      systemInfo = String(e?.message || e);
    }
  } else {
    systemInfo = `sd.exe CLI Vulkan: ${findSdExe()}`;
    version = 'leejet-vulkan';
  }
  const backend = cliMode
    ? { deviceType: 'vulkan', deviceLabel: 'Vulkan GPU (sd.exe)', devices: [], vramMb: null, prebuilt: true }
    : probeBackendSync();
  const defaults = getFastDefaults();
  const serverMode = !!findSdServerExe();
  return {
    available: bundle.ok,
    missingFiles: bundle.missing,
    loaded: cliMode ? true : !!(sdCtx && !sdCtx.isClosed),
    cliMode,
    serverMode,
    serverRunning: serverMode, // синхронно статус сокета не проверить — см. isServerAlive()
    sdExePath: findSdExe(),
    modelPath: bundle.diffusion,
    modelPaths: { diffusion: bundle.diffusion, vae: bundle.vae, llm: bundle.llm },
    modelName: MODEL.name,
    modelId: MODEL.id,
    tagline: MODEL.tagline,
    backend: cliMode ? 'vulkan-cli' : 'z-image-turbo',
    modelFamily: MODEL.family,
    isZImage: isZImageModel(),
    deviceType: backend.deviceType,
    deviceLabel: backend.deviceLabel,
    devices: backend.devices,
    vramMb: backend.vramMb,
    prebuilt: backend.prebuilt,
    systemInfo: String(systemInfo).trim(),
    version,
    defaults,
    gpuCapable: backend.deviceType !== 'cpu',
    modelSize: MODEL.sizeLabel,
  };
}

function disposeSdContext() {
  abortGeneration();
  if (sdCtx && !sdCtx.isClosed) {
    try { sdCtx.close(); } catch {}
  }
  sdCtx = null;
  sdLoading = null;
  ctxHasEncoder = false;
  ctxSampleMethod = null;
  ctxScheduler = null;
}

module.exports = {
  generateImage,
  getStatus,
  abortGeneration,
  disposeSdContext,
  stopSdServer,
  isServerAlive,
  startSdServer,
  SD_SERVER_PORT,
  resolveModelPath,
  resolveModelBundle,
  isZImageModel,
  MODEL,
  DEFAULT_NEGATIVE,
  FAST_CPU,
  FAST_GPU,
  getFastDefaults,
};
