import { isElectron } from './localEngine';

export interface UpscaleStatus {
  available: boolean;
  exePath: string | null;
  modelDir: string | null;
  models: Array<{ id: string; ready: boolean }>;
  scale: number;
  deviceType: string;
  sizeLabel: string;
}

export interface UpscaleResult {
  dataUrl: string;
  scale: number;
  model: string;
  elapsedMs: number;
}

export class UpscaleEngineService {
  async isAvailable(): Promise<boolean> {
    if (!isElectron() || !window.nexus?.upscaleStatus) return false;
    try {
      const st = await window.nexus.upscaleStatus();
      return !!st?.available;
    } catch {
      return false;
    }
  }

  async status(): Promise<UpscaleStatus | null> {
    if (!isElectron() || !window.nexus?.upscaleStatus) return null;
    try {
      return (await window.nexus.upscaleStatus()) as UpscaleStatus;
    } catch {
      return null;
    }
  }

  abort() {
    window.nexus?.upscaleAbort().catch(() => {});
  }

  /**
   * Апскейлит изображение ×4 через Real-ESRGAN (офлайн).
   * @param dataUrl base64 data URL исходного изображения
   */
  async upscale(
    dataUrl: string,
    callbacks: {
      onProgress?: (progress: number, text: string) => void;
    } = {}
  ): Promise<UpscaleResult> {
    if (!window.nexus?.upscaleGenerate) {
      throw new Error('Апскейл доступен только в десктопной версии.');
    }
    const offProgress = window.nexus.onUpscaleProgress?.((p) => {
      callbacks.onProgress?.(p.progress ?? 0, p.text || '');
    });

    try {
      const res = await window.nexus.upscaleGenerate({ dataUrl });
      if (res?.aborted) throw new Error('Апскейл отменён');
      if (!res?.ok || !res?.dataUrl) throw new Error(res?.error || 'Не удалось увеличить изображение');
      return {
        dataUrl: res.dataUrl,
        scale: res.scale ?? 4,
        model: res.model ?? 'realesrgan-x4plus',
        elapsedMs: res.elapsedMs ?? 0,
      };
    } finally {
      offProgress?.();
    }
  }
}

export const upscaleEngineService = new UpscaleEngineService();
export const fetchUpscaleStatus = async (): Promise<UpscaleStatus | null> =>
  new UpscaleEngineService().status();