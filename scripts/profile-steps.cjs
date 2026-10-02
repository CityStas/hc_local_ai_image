// Профиль против живого сервера. Аргументы: порт, шаги через запятую.
const PORT = parseInt(process.argv[2] || '8687', 10);
const stepsList = (process.argv[3] || '1,6,12').split(',').map(Number);

(async () => {
  for (const steps of stepsList) {
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
      const j = await (await fetch(`http://127.0.0.1:${PORT}/sdcpp/v1/jobs/${id}`)).json();
      if (j.status === 'completed') { ok = true; break; }
      if (j.status === 'failed') break;
    }
    console.log(`steps=${steps}: ${ok ? ((Date.now() - tg) / 1000).toFixed(1) + 'с' : 'FAIL'}`);
  }
  process.exit(0);
})();

