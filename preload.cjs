// preload.cjs — безопасный мост между renderer и main (contextIsolation: true)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexus', {
  isElectron: true,

  status: () => ipcRenderer.invoke('llm:status'),

  // modelId — встроенную модель ('qwen-0.8b')
  load: (modelId) => ipcRenderer.invoke('llm:load', modelId),

  models: () => ipcRenderer.invoke('llm:models'),

  // sessionId — id сессии чата; messages — история; config — параметры инференса
  chat: (sessionId, messages, config, modelId) =>
    ipcRenderer.invoke('llm:chat', { sessionId, messages, config, modelId }),

  reset: (sessionId, modelId) => ipcRenderer.invoke('llm:reset', sessionId, modelId),

  abort: () => ipcRenderer.invoke('llm:abort'),

  onToken: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('llm:token', listener);
    return () => ipcRenderer.removeListener('llm:token', listener);
  },

  onStatus: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('llm:status-update', listener);
    return () => ipcRenderer.removeListener('llm:status-update', listener);
  },

  // Кастомные кнопки окна (тайтлбар со скрытой рамкой).
  minimizeWindow: () => ipcRenderer.invoke('win:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('win:maximize'),
  closeWindow: () => ipcRenderer.invoke('win:close'),

  // Stable Diffusion — text-to-image (офлайн)
  sdStatus: () => ipcRenderer.invoke('sd:status'),
  sdGenerate: (options) => ipcRenderer.invoke('sd:generate', options),
  sdAbort: () => ipcRenderer.invoke('sd:abort'),
  sdPreload: () => ipcRenderer.invoke('sd:preload'),
  onSdProgress: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('sd:progress', listener);
    return () => ipcRenderer.removeListener('sd:progress', listener);
  },
  onSdPreview: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('sd:preview', listener);
    return () => ipcRenderer.removeListener('sd:preview', listener);
  },

  // Vision Language Model — image-to-text (llama-mtmd-cli)
  vlmStatus: () => ipcRenderer.invoke('vlm:status'),
  vlmAnalyze: (options) => ipcRenderer.invoke('vlm:analyze', options),
  vlmAbort: () => ipcRenderer.invoke('vlm:abort'),
  onVlmProgress: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('vlm:progress', listener);
    return () => ipcRenderer.removeListener('vlm:progress', listener);
  },

  // Real-ESRGAN — апскейл ×4 изображений (офлайн, автономно)
  upscaleStatus: () => ipcRenderer.invoke('upscale:status'),
  upscaleGenerate: (options) => ipcRenderer.invoke('upscale:generate', options),
  upscaleAbort: () => ipcRenderer.invoke('upscale:abort'),
  onUpscaleProgress: (callback) => {
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on('upscale:progress', listener);
    return () => ipcRenderer.removeListener('upscale:progress', listener);
  },
});
