// E2E: sdEngine.generateImage → sd-server (CUDA) → png.
const e = require('../sdEngine.cjs');
const fs = require('fs');
const path = require('path');

e.generateImage({ prompt: 'a red panda, photorealistic', width: 768, height: 768, steps: 6 }, (ch, d) => {
  if (d.text) console.log(ch, d.text);
}).then((r) => {
  console.log('OK:', r.modelName, Math.round(r.elapsedMs / 1000) + 's');
  fs.writeFileSync(path.join(__dirname, 'e2e.png'), Buffer.from(r.dataUrl.split(',')[1], 'base64'));
  console.log('png сохранён: scripts/e2e.png');
  process.exit(0);
}).catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
