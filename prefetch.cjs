// prefetch.cjs — менеджер фонового прогрева GGUF-моделей в RAM page-cache.
// Запускает scripts/prefetch-worker.cjs ОТДЕЛЬНЫМ процессом, чтобы дисковое IO
// не блокировало главный процесс Electron. Даёт два метода:
//   - warm(target)   — прогреет модели режима в RAM (vlm | sd | llm | all)
//   - abort()        — немедленно остановить текущий прогрев (перед тяжёлой операцией)
// Цель: переключение Vision⇄Image не перечитывает <<~4.5GB>> с холодного диска
// (~35-50с), а берёт их из System Standby RAM (~1с). Синхронизировано с HC AI: после
// генерации картинки греем VLM под следующий фоточип, после анализа — SD под генерацию.
const path = require('path');
const { spawn } = require('child_process');

const WORKER = path.join(__dirname, 'scripts', 'prefetch-worker.cjs');
const IDLE_DELAY_MS = 8000; // ждём паузу после активности, чтобы не мешать пользователю

let child = null;
let timer = null;
let lastTarget = null;

function killCurrent() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (child) {
    try { child.kill(); } catch {}
    child = null;
  }
}

function start(target) {
  lastTarget = target;
  child = spawn(process.execPath, [WORKER, target], {
    windowsHide: true,
    // В Electron process.execPath — это electron.exe. ELECTRON_RUN_AS_NODE заставляет
    // его работать как чистый node (иначе воркер открыл бы ещё одно окно GUI).
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  child.on('message', (msg) => {
    try {
      const m = JSON.parse(String(msg));
      if (m?.kind === 'start') console.error(`[hc/prefetch] грею ${m.file} в RAM...`);
      else if (m?.kind === 'lowmem') console.error('[hc/prefetch] мало RAM — остановил прогрев');
      else if (m?.kind === 'ended') console.error(`[hc/prefetch] прогрев ${target} завершён`);
      else if (m?.kind === 'aborted') console.error('[hc/prefetch] прогрев прерван');
    } catch {}
  });
  child.on('exit', () => {
    if (child) child = null;
  });
}

/**
 * Прогреть модели target после idle-паузы. Повторный вызов с тем же target
 * не запускает дубль (если прогрев уже идёт — пропускаем).
 */
function warm(target) {
  const t = String(target || 'vlm').trim().toLowerCase();
  if (child && lastTarget !== t) killCurrent();    // сменился режим — переключаем прогрев
  if (child && lastTarget === t) return;           // уже греем то же — не дублируем
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    start(t);
  }, IDLE_DELAY_MS);
}

/** Немедленный стоп прогрева — вызывается перед активным действием. */
function abort() {
  killCurrent();
  lastTarget = null;
}

module.exports = { warm, abort };