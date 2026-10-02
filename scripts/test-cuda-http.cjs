// Только HTTP: сервер уже запущен отдельно. Аргумент: количество генераций.
const PORT = 8699;
const fs = require('fs');
const path = require('path');

const health = async () => {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1200);
    const r = await fetch(`http://127.0.0.1:${PORT}/sdcpp/v1/capabilities`, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
};

(async () => {
  const n = parseInt(process.argv[2] || '2', 10);
  if (!(await health())) { console.log('сервер не отвечает'); process.exit(1); }
  console.log('health OK');
  for (let i = 0; i < n; i++) {
    const tg = Date.now();
    const post = await fetch(`http://127.0.0.1:${PORT}/sdcpp/v1/img_gen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'a red panda sitting on a branch, photorealistic',
        width: 768, height: 768, seed: 42 + i, output_format: 'png',
        sample_params: { sample_steps: parseInt(process.argv[3] || '6', 10), sample_method: 'euler', scheduler: 'sgm_uniform', guidance: { txt_cfg: 1.0, distilled_guidance: 3.5 } },
      }),
    });
    if (!post.ok) { console.log('img_gen HTTP', post.status, (await post.text()).slice(-200)); continue; }
    const q = await post.json();
    const id = q.id || (q.poll_url || '').split('/').pop();
    let done = false;
    while (Date.now() - tg < 5 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/sdcpp/v1/jobs/${id}`);
        if (!res.ok) continue;
        const j = await res.json();
        if (['completed', 'failed', 'cancelled'].includes(j.status)) {
          const secs = ((Date.now() - tg) / 1000).toFixed(1);
          const img = j.result?.images?.[0] || {};
          const raw = String(img.data || img.b64_json || img.url || '');
          const b64 = raw.replace(/^data:[^;]+;base64,/, '');
          if (j.status === 'completed' && b64) fs.writeFileSync(path.join(__dirname, `cuda_gen${i}.png`), Buffer.from(b64, 'base64'));
          console.log(`gen#${i}: ${j.status} за ${secs}с`, b64 ? '(png сохранён)' : 'imgKeys=' + JSON.stringify(Object.keys(img)));
          done = true;
          break;
        }
      } catch (e) { console.log('poll error:', e?.message); }
    }
    if (!done) console.log(`gen#${i}: таймаут`);
  }
  process.exit(0);
})();
