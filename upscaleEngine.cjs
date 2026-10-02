// upscaleEngine.cjs — HC AI (Real-ESRGAN-ncnn-vulkan, апскейл ×4)
// Полностью автономен от LLM/SD/VLM: отдельный нативный Vulkan exe, запускается через
// spawn() как sd-cli.exe / llama-mtmd-cli.exe. Без PyTorch, без Python.
// Репозиторий: https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const MODEL_DIR = 'Real-ESRGAN-ncnn-vulkan';
// Основная модель для обычных фото (деноиз + x4). Для аниме — realesrgan-x4plus-anime.
const DEFAULT_MODEL = 'realesrgan-x4plus';
const DEFAULT_SCALE = 4;
const DEFAULT_TILE = 0; // без явного тайлинга — ncnn сам режет на тайлы при необходимости

let cliProcess = null;
let cliAbort = null;

function resourceRoots() {
  const roots = [];
  if (process.resourcesPath) {
    roots.push(path.join(process.resourcesPath, MODEL_DIR));
    roots.push(path.join(process.resourcesPath, 'resources', MODEL_DIR));
  }
  roots.push(path.join(__dirname, 'node_modules', 'electron', 'dist', 'resources', MODEL_DIR));
  roots.push(path.join(__dirname, 'resources', MODEL_DIR));
  return roots;
}

/** Ищет exe в папке Real-ESRGAN-ncnn-vulkan. Возвращает полный путь или null. */
function findUpscaleExe() {
  const names = ['realesrgan-ncnn-vulkan.exe', 'realesrgan-ncnn-vulkan'];
  for (const root of resourceRoots()) {
    for (const name of names) {
      const p = path.join(root, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/** Проверяет, что нужная модель лежит в models/ рядом с exe. */
function resolveModel(exe, modelName) {
  const dir = path.dirname(exe);
  const candidates = [
    path.join(dir, 'models', modelName + '.param'),
    path.join(dir, modelName + '.param'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.dirname(c);
  }
  return null;
}

function isAvailable() {
  const exe = findUpscaleExe();
  return !!exe && !!resolveModel(exe, DEFAULT_MODEL);
}

function getStatus() {
  const exe = findUpscaleExe();
  const modelDir = exe ? resolveModel(exe, DEFAULT_MODEL) : null;
  const models = exe ? (() => {
    const names = ['realesrgan-x4plus', 'realesrgan-x4plus-anime', 'realesr-animevideov3-x4', 'realesr-general-x4v3'];
    return names.map((n) => ({ id: n, ready: !!resolveModel(exe, n) }));
  })() : [];
  return {
    available: isAvailable(),
    exePath: exe,
    modelDir,
    models,
    scale: DEFAULT_SCALE,
    // Реальный рендер всегда идёт на Vulkan (GPU) — ncnn выберет первый Vulkan-девайс.
    deviceType: 'vulkan',
    sizeLabel: '~45 MB (exe + models/x4plus)',
  };
}

function abortUpscale() {
  const proc = cliProcess;
  cliProcess = null;
  if (!proc) return;
  const pid = proc.pid;
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true }).unref();
    } else {
      proc.kill('SIGKILL');
    }
  } catch {}
  if (cliAbort) { try { cliAbort.abort(); } catch {} cliAbort = null; }
}

/** dataUrl (base64 PNG/JPG) → base64 без data:-префикса. */
function base64FromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.*)$/s);
  if (m) return { mime: m[1], b64: m[2] };
  return null;
}

/**
 * Апскейлит изображение через realesrgan-ncnn-vulkan.
 * @param {{ dataUrl: string, scale?: number, model?: string }} options
 * @param {(channel: string, data: any) => void} send
 * @returns Promise<{ dataUrl, scale, model, elapsedMs }>
 */
function upscaleImage(options, send) {
  const exe = findUpscaleExe();
  if (!exe) {
    return Promise.reject(
      new Error('Real-ESRGAN не найден на диске. Положите папку ' +
        'Real-ESRGAN-ncnn-vulkan в node_modules/electron/dist/resources/')
    );
  }
  const modelName = String(options.model || DEFAULT_MODEL);
  if (!resolveModel(exe, modelName)) {
    return Promise.reject(new Error(`Real-ESRGAN: модель ${modelName} не найдена в models/.`));
  }

  const src = base64FromDataUrl(options.dataUrl);
  if (!src || !src.b64) return Promise.reject(new Error('Пустое изображение'));

  const scale = clamp(Math.round(Number(options.scale) || DEFAULT_SCALE), 2, 4);
  const startMs = Date.now();

  const tmpIn = path.join(os.tmpdir(), `hc_up_in_${Date.now()}.png`);
  const tmpOut = path.join(os.tmpdir(), `hc_up_out_${Date.now()}.png`);
  fs.writeFileSync(tmpIn, Buffer.from(src.b64, 'base64'));

  const args = ['-i', tmpIn, '-o', tmpOut, '-n', modelName, '-s', String(scale)];
  if (DEFAULT_TILE > 0) args.push('-t', String(DEFAULT_TILE));

  console.error('[hc/upscale] spawn:', exe);
  console.error('[hc/upscale] cmd:', args.join(' '));

  return new Promise((resolve, reject) => {
    const abort = new AbortController();
    cliAbort = abort;
    const proc = spawn(exe, args, {
      cwd: path.dirname(exe),
      windowsHide: true,
      env: { ...process.env },
    });
    cliProcess = proc;

    const TIMEOUT_MS = 5 * 60 * 1000;
    const timeoutId = setTimeout(() => {
      abortUpscale();
      reject(new Error('Таймаут апскейла (5 мин). Возможно, слишком большое изображение.'));
    }, TIMEOUT_MS);

    let stderr = '';

    // ncnn пишет прогресс в ВИДЕ строк "0,00%" (локаль-зависимая запятая) и в stdout, и в stderr.
    // Парсим из обоих потоков, чтобы UI видел живые проценты, а не только финальный 100%.
    const progressRe = /(\d+[.,]\d+)\s*%/g;
    let lastSent = -1;
    const handleProgress = (text) => {
      progressRe.lastIndex = 0;
      let m;
      let lastPct = null;
      while ((m = progressRe.exec(text)) !== null) {
        const pct = clamp(Math.round(parseFloat(String(m[1]).replace(',', '.'))), 0, 100);
        if (pct > lastPct) lastPct = pct;
      }
      if (lastPct != null && lastPct !== lastSent) {
        lastSent = lastPct;
        send?.('upscale:progress', {
          progress: lastPct,
          text: `Апскейл ×${scale} · ${lastPct}%`,
          phase: 'sample',
          scale,
        });
      }
    };
    // Строка вида "0,00%" — это прогресс, а не ошибка: из stderr-лога её выкидываем.
    const isProgressLine = (s) => /^\d+[.,]\d+\s*%/.test(s.trim());

    proc.stdout.on('data', (chunk) => {
      handleProgress(chunk.toString());
    });

    proc.stderr.on('data', (chunk) => {
      const line = chunk.toString();
      stderr += line;
      handleProgress(line);
      if (stderr.length < 2000 && !isProgressLine(line)) {
        console.error('[hc/upscale-stderr]', line.trimEnd());
      }
    });

    abort.signal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      abortUpscale();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      cliProcess = null;
      cliAbort = null;
      const cleanupIn = () => { try { fs.unlinkSync(tmpIn); } catch {} };
      if (abort.signal.aborted) {
        cleanupIn();
        return reject(new DOMException('Aborted', 'AbortError'));
      }
      if (code !== 0) {
        cleanupIn();
        console.error('[hc/upscale] stderr tail:', stderr.slice(-500));
        return reject(new Error(`realesrgan-ncnn-vulkan завершился с кодом ${code}.\n${stderr.slice(-200)}`));
      }
      if (!fs.existsSync(tmpOut)) {
        cleanupIn();
        return reject(new Error('realesrgan-ncnn-vulkan не создал выходной файл.'));
      }
      try {
        const buf = fs.readFileSync(tmpOut);
        const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
        fs.unlinkSync(tmpIn);
        fs.unlinkSync(tmpOut);
        send?.('upscale:progress', { progress: 100, text: `Апскейл ×${scale} готов`, phase: 'done', scale });
        resolve({ dataUrl, scale, model: modelName, elapsedMs: Date.now() - startMs });
      } catch (e) {
        reject(e);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      cliProcess = null;
      cliAbort = null;
      try { fs.unlinkSync(tmpIn); } catch {}
      reject(new Error(`Не удалось запустить realesrgan-ncnn-vulkan: ${err.message}`));
    });
  });
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(Number(v) || lo, lo), hi);
}

module.exports = {
  upscaleImage,
  abortUpscale,
  getStatus,
  isAvailable,
  findUpscaleExe,
  DEFAULT_MODEL,
  DEFAULT_SCALE,
};