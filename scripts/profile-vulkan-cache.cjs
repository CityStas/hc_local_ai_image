// Профиль Vulkan + cache-dit: скрипт сам поднимает сервер флагами, тестирует, гасит.
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8699;
const RES = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'resources', 'z-image-turbo');
const EXE = path.join(__dirname, '..', 'sd-vulkan', 'sd-server.exe');

const args = [
  '--diffusion-model', path.join(RES, 'z_image_turbo-Q4_K.gguf'),
  '--vae', path.join(RES, 'ae.safetensors'),
  '--llm', path.join(RES, 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf'),
  '--listen-port', String(PORT),
  '--diffusion-fa',
  '--vae-tiling',
  '--cache-mode', 'cache-dit',
  '--cache-option', 'Fn=3,Bn=1,warmup=2',
  '--backend', 'diffusion=vulkan0,te=cpu',
  '--model-args', 'qwen_image_zero_cond_t=true',
];

const proc = spawn(EXE, args, { windowsHide: true });
let srvLog = '';
proc.stderr.on('data', (d) => { srvLog += d; });
proc.on('exit', (c) => { if (!done) console.log('[srv] exit', c); });

const health = async () => {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1200);
    const r = await fetch(`http://127.0.0.1:${PORT}/sdcpp/v1/capabilities`, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
};

let done = false;

(async () => {
  const t0 = Date.now();
  while (Date.now() - t0 < 3 * 60 * 1000) {
    if (await health()) break;
    if (proc.exitCode !== null) { console.log('сервер умер при старте'); console.log(srvLog.split('\n').slice(-15).join('\n')); process.exit(1); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!(await health())) { console.log('сервер не поднялся'); process.exit(1); }
  console.log('сервер готов (Vulkan + cache-dit)');

  for (const steps of [1, 1, 6, 12]) {
    const tg = Date.now();
    const post = await fetch(`http://127.0.0.1:${PORT}/sdcpp/v1/img_gen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'a red panda sitting on a branch, photorealistic',
        width: 768, height: 768, seed: 42, output_format: 'png',
        sample_params: { sample_steps: steps, sample_method: 'euler', scheduler: 'sgm_uniform', guidance: { txt_cfg: 1.0, distilled_guidance: 3.5 } },
      }),
    });
    const q = await post.json();
    const id = q.id || (q.poll_url || '').split('/').pop();
    let ok = false;
    while (Date.now() - tg < 5 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 500));
      if (proc.exitCode !== null) { console.log('сервер умер во время генерации'); break; }
      const j = await (await fetch(`http://127.0.0.1:${PORT}/sdcpp/v1/jobs/${id}`)).json();
      if (j.status === 'completed') { ok = true; break; }
      if (j.status === 'failed') break;
    }
    console.log(`steps=${steps}: ${ok ? ((Date.now() - tg) / 1000).toFixed(1) + 'с' : 'FAIL'}`);
  }
  done = true;
  try { spawn('taskkill', ['/PID', String(proc.pid), '/F', '/T'], { windowsHide: true }); } catch {}
  process.exit(0);
})();
