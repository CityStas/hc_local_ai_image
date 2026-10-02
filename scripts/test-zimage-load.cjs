const path = require('path');
const sd = require('stable-diffusion-cpp-node-api');
const { resolveModelBundle, MODEL } = require('../sdEngine.cjs');

sd.setLogCallback(({ level, text }) => {
  if (level <= 1) process.stderr.write(String(text) + '\n');
});

(async () => {
  const bundle = resolveModelBundle();
  console.log('bundle:', bundle);
  if (!bundle.ok) {
    console.error('Missing:', bundle.missing);
    console.error('Run: npm run download:zimage');
    process.exit(1);
  }

  try {
    const meta = await sd.extractMetaData(bundle.diffusion);
    console.log('diffusion meta:', JSON.stringify(meta, null, 2));
  } catch (e) {
    console.error('meta error:', e?.message);
  }

  try {
    console.log('systemInfo:', sd.getSystemInfo?.());
    const ctx = await sd.StableDiffusionContext.create({
      diffusionModelPath: bundle.diffusion,
      vaePath: bundle.vae,
      llmPath: bundle.llm,
      nThreads: 4,
      enableMmap: true,
      vaeDecodeOnly: true,
      offloadParamsToCpu: true,
    });
    console.log('OK loaded. sample=', ctx.getDefaultSampleMethod?.(), 'sched=', ctx.getDefaultScheduler?.());
    ctx.close();
  } catch (e) {
    console.error('create error:', e?.message || e);
    process.exit(1);
  }
})();
