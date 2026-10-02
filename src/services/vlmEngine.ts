import type { VlmMode, VlmModelId } from '../data/vlmModels';

export interface VlmAnalyzeResult {
  text: string;
  modelId: VlmModelId;
  modelName: string;
  mode: VlmMode;
  elapsedMs: number;
  prompt: string;
}

export interface VlmBackendStatus {
  exeOk: boolean;
  ready: boolean;
  activeModelId: string | null;
  hint: string | null;
  models: Array<{
    id: string;
    name: string;
    sizeLabel: string;
    vramMb: number;
    ready: boolean;
    missing: string[];
  }>;
}

function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return reject(new Error('Не удалось прочитать изображение'));
      resolve({ mimeType: m[1], base64: m[2] });
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsDataURL(file);
  });
}

export class VisionAnalysisService {
  abort() {
    window.nexus?.vlmAbort?.().catch(() => {});
  }

  async status(): Promise<VlmBackendStatus | null> {
    if (!window.nexus?.vlmStatus) return null;
    return window.nexus.vlmStatus();
  }

  async analyze(
    file: File,
    opts: {
      mode?: VlmMode;
      prompt?: string;
      modelId?: VlmModelId;
      onProgress?: (progress: number, text: string) => void;
    } = {}
  ): Promise<VlmAnalyzeResult> {
    if (!window.nexus?.vlmAnalyze) {
      throw new Error('Vision доступен только в десктопной версии (Electron).');
    }

    const off = window.nexus.onVlmProgress?.((p) => {
      opts.onProgress?.(p.progress ?? 0, p.text || '');
    });

    try {
      // Гасим возможный висячий анализ в main (после стопа/перезапуска чата),
      // чтобы новый запрос не завис из-за занятого llama-mtmd-cli
      window.nexus?.vlmAbort?.().catch(() => {});
      const { base64, mimeType } = await fileToBase64(file);
      // Свой таймаут: если main завис — UI не должен висеть вечно
      // (иначе telemetry.status залипает в 'thinking' и чипы блокируются во всех чатах)
      const TIMEOUT_MS = 250_000;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('VLM: превышено время ожидания (250с). Попробуйте ещё раз.')), TIMEOUT_MS);
      });
      let res: any;
      try {
        res = await Promise.race([
          window.nexus.vlmAnalyze({
            imageBase64: base64,
            mimeType,
            mode: opts.mode || 'describe',
            prompt: opts.prompt || '',
            modelId: opts.modelId,
            maxTokens: 900,
          }),
          timeout,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!res?.ok) {
        if (res?.aborted) throw new Error('Анализ отменён');
        throw new Error(res?.error || 'Ошибка VLM');
      }
      return {
        text: res.text,
        modelId: res.modelId,
        modelName: res.modelName,
        mode: res.mode,
        elapsedMs: res.elapsedMs,
        prompt: res.prompt,
      };
    } finally {
      off?.();
    }
  }
}

export const visionAnalysisService = new VisionAnalysisService();
