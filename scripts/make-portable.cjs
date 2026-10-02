// Создаёт portable-архив из win-unpacked (NSIS portable не работает >2 ГБ).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const unpacked = path.join(dist, 'win-unpacked');
const zipOut = path.join(dist, 'HC-AI-portable.zip');
const sevenZip = 'C:\\Program Files\\7-Zip\\7z.exe';

if (!fs.existsSync(unpacked)) {
  console.error('[portable] win-unpacked не найден — сначала npm run dist:dir');
  process.exit(1);
}

if (!fs.existsSync(sevenZip)) {
  console.error('[portable] 7-Zip не найден:', sevenZip);
  process.exit(1);
}

if (fs.existsSync(zipOut)) fs.unlinkSync(zipOut);

console.error('[portable] упаковка win-unpacked → HC-AI-portable.zip ...');
execSync(`"${sevenZip}" a -tzip -mx=5 "${zipOut}" "${path.join(unpacked, '*')}"`, {
  stdio: 'inherit',
  shell: true,
});

const mb = (fs.statSync(zipOut).size / 1024 / 1024).toFixed(0);
console.error(`[portable] готово: ${zipOut} (${mb} MB)`);
