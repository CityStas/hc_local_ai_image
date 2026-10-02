// bench-memory.cjs — замер скорости чтения GGUF-моделей: "холодный" диск vs "тёплый" RAM page-cache.
// Показывает, сколько задействование RAM (System Standby / page cache) ускоряет повторную загрузку моделей.
// Использование: node scripts/bench-memory.cjs [--size=<MB>] [--out=<path.md>]
// Пишет/дополняет результаты в BENCHMARKS.md рядом с файлом.
const path = require('path');
const fs = require('fs');

// Точные пути к моделям (как их находит движок в resourceRoots)
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

// Читаем только первые N байт файла, чтобы бенч был быстрым (хватает для оценки MB/s).
async function readChunkSpeed(file, bytes) {
  const fd = fs.openSync(file, 'r');
  const chunkSize = 4 * 1024 * 1024; // 4MB
  let read = 0;
  const start = Date.now();
  const buf = Buffer.alloc(chunkSize);
  try {
    while (read < bytes) {
      const n = fs.readSync(fd, buf, 0, Math.min(chunkSize, bytes - read), read);
      if (n <= 0) break;
      read += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  const ms = Date.now() - start;
  return { bytes: read, ms };
}

function fmtSpeed(bytes, ms) {
  const mbs = (bytes / (1024 * 1024)) / Math.max(ms, 1) * 1000;
  return { mbs: Math.round(mbs), sec: +(ms / 1000).toFixed(2) };
}

async function main() {
  const args = process.argv.slice(2);
  const sizeArg = args.find((a) => a.startsWith('--size='));
  const defaultSizeMB = 1024; // 1 GB — достаточно для оценки скорости
  const sizeMB = sizeArg ? parseInt(sizeArg.split('=')[1], 10) : defaultSizeMB;
  const bytes = sizeMB * 1024 * 1024;

  // Реальный суммарный размер всех GGUF-моделей на диске (для моделирования полной загрузки)
  const models = [
    { name: 'LLM  HC AI Light 0.8B', file: resolv('qwen-3.5-0.8b', 'qwen-3.5-0.8b.gguf') },
    { name: 'VLM  Qwen2.5-VL языковая', file: resolv('Qwen2.5-VL-7B', 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf') },
    { name: 'VLM  mmproj', file: resolv('Qwen2.5-VL-7B', 'mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf') },
    { name: 'SD   диффузия Z-Image', file: resolv('z-image-turbo', 'z_image_turbo-Q4_K.gguf') },
    { name: 'SD   текст-энкодер Qwen3-4B', file: resolv('z-image-turbo', 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf') },
  ].filter((m) => m.file);

  const totalBytes = models.reduce((acc, m) => acc + fs.statSync(m.file).size, 0);

  const results = [];
  console.log(`Бенч чтения GGUF (порция ${sizeMB} MB) — ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  for (const m of models) {
    const size = fs.statSync(m.file).size;
    const portion = Math.min(bytes, size);
    // 1-й проход: как правило "холодный" (файл не в свежем кэше) или частично тёплый.
    const cold = await readChunkSpeed(m.file, portion);
    // 2-й проход: файл (его начало) уже в RAM page-cache → "тёплый".
    const warm = await readChunkSpeed(m.file, portion);
    const c = fmtSpeed(portion, cold.ms);
    const w = fmtSpeed(portion, warm.ms);
    const ratio = w.mbs > 0 && c.mbs > 0 ? +(w.mbs / c.mbs).toFixed(1) : 0;
    const fullCold = size / (1024 * 1024) / Math.max(c.mbs, 1);
    const fullWarm = size / (1024 * 1024) / Math.max(w.mbs, 1);
    results.push({ name: m.name, sizeMB: Math.round(size / 1024 / 1024), cold: c, warm: w, ratio, fullColdSec: +fullCold.toFixed(1), fullWarmSec: +fullWarm.toFixed(1) });
    console.log(`${m.name.padEnd(26)} ${Math.round(size / 1024 / 1024)}MB  холодно ${c.mbs}MB/s(${c.sec}s)  тёпло ${w.mbs}MB/s(${w.sec}s)  x${ratio}` +
      `  [полн: ${fullCold.toFixed(1)}с → ${fullWarm.toFixed(1)}с]`);
  }

  // Сводка по всему набору (допуская одинаковую скорость для всего файла)
  const avgCold = results.reduce((a, r) => r.cold.mbs > 0 ? a + r.cold.mbs * r.sizeMB : a, 0);
  const avgWarm = results.reduce((a, r) => r.warm.mbs > 0 ? a + r.warm.mbs * r.sizeMB : a, 0);
  const sumMB = results.reduce((a, r) => a + r.sizeMB, 0);
  const coldTotalMs = totalBytes / (avgCold / (sumMB || 1)) * 1000 / (1024 * 1024);
  const warmTotalMs = totalBytes / (avgWarm / (sumMB || 1)) * 1000 / (1024 * 1024);

  const summary = {
    date: new Date().toISOString(),
    sizeMB,
    totalModelsMB: Math.round(totalBytes / 1024 / 1024),
    avgColdMBs: Math.round(avgCold / Math.max(sumMB, 1) * 100) / 100,
    avgWarmMBs: Math.round(avgWarm / Math.max(sumMB, 1) * 100) / 100,
    totalColdSec: +(coldTotalMs / 1000).toFixed(1),
    totalWarmSec: +(warmTotalMs / 1000).toFixed(1),
    speedup: +((warmTotalMs > 0 && coldTotalMs > 0) ? (coldTotalMs / warmTotalMs).toFixed(1) : 0),
    rows: results,
  };

  writeReport(args, summary);
  console.log('='.repeat(70));
  console.log(`ИТОГО моделей: ${Math.round(totalBytes / 1024 / 1024)} MB`);
  console.log(`Средн. скорость хол.-прогрева: ${summary.avgColdMBs} MB/s (полная загрузка всего набора ~${summary.totalColdSec}с)`);
  console.log(`Средн. скорость из RAM-кэша:   ${summary.avgWarmMBs} MB/s (~${summary.totalWarmSec}с)`);
  console.log(`Ускорение нагрузки из RAM:      x${summary.speedup}`);
}
function mdPath(args) {
  const out = args.find((a) => a.startsWith('--out='));
  return out ? out.split('=')[1] : path.join(__dirname, '..', 'BENCHMARKS.md');
}

function writeReport(args, s) {
  const p = mdPath(args);
  const lines = [];
  lines.push(`### ${s.date} — замер GMT`);
  lines.push('');
  lines.push(`Порция чтения: **${s.sizeMB} MB** · Всего моделей на диске: **${s.totalModelsMB} MB**`);
  lines.push('');
  lines.push('| Модель | Размер, MB | Холодно MB/s | Тёпло (RAM) MB/s | Ускорение | Полная холодно, с | Полная тёпло, с |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of s.rows) {
    lines.push(`| ${r.name} | ${r.sizeMB} | ${r.cold.mbs} | ${r.warm.mbs} | x${r.ratio} | ${r.fullColdSec} | ${r.fullWarmSec} |`);
  }
  lines.push('');
  lines.push(`**Среднее:** холодно **${s.avgColdMBs}** MB/s → тёпло **${s.avgWarmMBs}** MB/s.`);
  lines.push(`Полная нагрузка всего GGUF-набора (~${s.totalModelsMB} MB): ~${s.totalColdSec} с (с диска) → ~${s.totalWarmSec} с (из RAM-кэша).`);
  lines.push(`**Множитель задействования RAM: ${s.speedup}x**`);
  lines.push('');
  lines.push('---');
  fs.appendFileSync(p, '\n' + lines.join('\n') + '\n', 'utf8');
  console.log(`\n[отчёт] дописано в ${p}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});