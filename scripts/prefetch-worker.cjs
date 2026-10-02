// scripts/prefetch-worker.cjs — фоновое чтение GGUF в RAM page-cache (System Standby).
// Запускается ОТДЕЛЬНЫМ процессом (spawn/child), чтобы синхронное дисковое IO
// не заблокировало главный процесс Electron. Вызывается как:
//   node scripts/prefetch-worker.cjs <target> [--low]
// где target ∈ { vlm, sd, all }.
// Суть: Windows кэширует прочитанные страницы файла в оперативной памяти, поэтому
// повторная загрузка модели (переключение режима) идёт из RAM, а не с холодного диска.
// По бенчу (scripts/bench-memory.cjs) тёплое чтение до x40 быстрее холодного.
const fs = require('fs');
const path = require('path');
const os = require('os');

const RES_ROOTS = [
  path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'resources'),
  path.join(__dirname, '..', 'resources'),
];

function resolv(...parts) {
  for (const root of RES_ROOTS) {
    const full = path.join(root, ...parts);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

const TARGETS = {
  vlm: [
    ['Qwen2.5-VL-7B', 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf'],
    ['Qwen2.5-VL-7B', 'mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf'],
  ],
  sd: [
    ['z-image-turbo', 'z_image_turbo-Q4_K.gguf'],
    ['z-image-turbo', 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf'],
    ['z-image-turbo', 'ae.safetensors'],
  ],
  llm: [['qwen-3.5-0.8b', 'qwen-3.5-0.8b.gguf']],
};

const args = process.argv.slice(2);
const target = (args[0] || 'vlm').trim().toLowerCase();
const entries = (TARGETS[target] || TARGETS.vlm)
  .map(([dir, file]) => ({ dir, file, full: resolv(dir, file) }))
  .filter((e) => e.full);

// Порог: если свободной RAM меньше MIN_FREE_MB — сворачиваемся, чтобы не вытеснять
// рабочее. Не трогаем Steam/браузер/фон активной работы.
const MIN_FREE_MB = 2500;
// Кандидаты в кэш уже сидят в Standby? free()+buffers не отражает Standby, поэтому
// дополнительно смотрим на суммарно занятую память и не прогреваем сверх лимита.
const MAX_PREFETCH_MB = 6000; // столько готовы подвинуть в RAM единовременно

let aborted = false;
process.on('SIGTERM', () => { aborted = true; });
process.on('SIGINT', () => { aborted = true; });

function freeMb() {
  return os.freemem() / 1024 / 1024;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function warmFile(file, bill) {
  const fd = await fs.promises.open(file, 'r');
  const size = (await fd.stat()).size;
  const chunk = Buffer.alloc(4 * 1024 * 1024); // 4 MB
  let off = 0;
  try {
    while (off < size) {
      if (aborted) { repo('aborted', file); return false; }
      if (freeMb() < MIN_FREE_MB) { repo('lowmem', file); return false; }
      if (bill.consumed > MAX_PREFETCH_MB) { repo('cap', file); return false; }
      const { bytesRead } = await fd.read(chunk, 0, Math.min(chunk.length, size - off), off);
      if (bytesRead <= 0) break;
      off += bytesRead;
      const mb = bytesRead / 1024 / 1024;
      bill.consumed += mb;
      // Пауза между чанками = низкий приоритет: не обжираем диск, пока юзер работает.
      await sleep(30);
    }
  } finally {
    await fd.close().catch(() => {});
  }
  return true;
}

function repo(kind, file) {
  process.send?.(JSON.stringify({ kind, file: file ? path.basename(file) : null }));
}

(async () => {
  let bill = { consumed: 0 };
  for (const e of entries) {
    repo('start', e.full);
    await warmFile(e.full, bill);
    if (aborted) break;
  }
  repo(aborted ? 'aborted' : 'ended', null);
  process.exit(0);
})();