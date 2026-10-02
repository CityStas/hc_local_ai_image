import { ModelInfo, Message, InferenceConfig, TelemetryState, SdBackendStatus } from '../types';
import { soundEffects } from '../utils/audioSynth';

// Мост Electron (см. preload.cjs).
declare global {
  interface Window {
    nexus?: {
      isElectron: boolean;
      status: () => Promise<{ available: boolean; ready: boolean; loading: boolean; error: string | null; modelName: string }>;
      load: (modelId?: string) => Promise<{ ready: boolean; modelName: string }>;
      models: () => Promise<any[]>;
      chat: (
        sessionId: string,
        messages: Message[],
        config: InferenceConfig,
        modelId?: string
      ) => Promise<{ content: string; aborted?: boolean; stats: any }>;
      reset: (sessionId: string, modelId?: string) => Promise<boolean>;
      abort: () => Promise<boolean>;
      onToken: (cb: (payload: any) => void) => () => void;
      onStatus: (cb: (payload: any) => void) => () => void;
      sdStatus: () => Promise<SdBackendStatus & { modelId?: string; tagline?: string; defaults?: Record<string, unknown> }>;
      sdGenerate: (options: Record<string, unknown>) => Promise<any>;
      sdAbort: () => Promise<boolean>;
      sdPreload: () => Promise<{ ok: boolean; already?: boolean; ready?: boolean; error?: string }>;
      onSdProgress: (cb: (payload: { progress: number; text: string; phase?: string; step?: number; steps?: number; etaSec?: number }) => void) => () => void;
      onSdPreview: (cb: (payload: { step: number; dataUrl: string }) => void) => () => void;
      vlmStatus: () => Promise<{
        exeOk: boolean;
        ready: boolean;
        activeModelId: string | null;
        hint: string | null;
        models: Array<{ id: string; name: string; sizeLabel: string; vramMb: number; ready: boolean; missing: string[] }>;
      }>;
      vlmAnalyze: (options: Record<string, unknown>) => Promise<any>;
      vlmAbort: () => Promise<boolean>;
      onVlmProgress: (cb: (payload: { progress: number; text: string; phase?: string }) => void) => () => void;
      upscaleStatus: () => Promise<{
        available: boolean;
        exePath: string | null;
        modelDir: string | null;
        models: Array<{ id: string; ready: boolean }>;
        scale: number;
        deviceType: string;
        sizeLabel: string;
      }>;
      upscaleGenerate: (options: { dataUrl: string; scale?: number; model?: string }) => Promise<{
        ok: boolean;
        aborted?: boolean;
        error?: string;
        dataUrl?: string;
        scale?: number;
        model?: string;
        elapsedMs?: number;
      }>;
      upscaleAbort: () => Promise<boolean>;
      onUpscaleProgress: (cb: (payload: { progress: number; text: string; phase?: string; scale?: number }) => void) => () => void;
    };
  }
}

// Встроенная GGUF-модель (файл в electron/dist/resources/...).
export const EMBEDDED_MODEL: ModelInfo = {
  id: 'qwen-0.8b',
  name: 'HC AI Light 0.8B',
  size: '517 MB',
  quant: 'Q4_K_M',
  family: 'HC AI Light',
  format: 'embedded',
  contextLength: 4096,
  cached: true,
  vramRequirementMb: 700,
  description: 'Встроенная лёгкая модель. Быстрые и точные ответы, малый расход памяти.',
  backendId: 'qwen-0.8b',
};

// Qwen2.5-VL 7B уже скачана для Vision — node-llama-cpp умеет грузить её и в чат.
export const QWEN25VL_CHAT_MODEL: ModelInfo = {
  id: 'qwen2.5-vl-chat',
  name: 'Qwen2.5-VL 7B (чат)',
  size: '~4.4 GB',
  quant: 'Q4_K_M',
  family: 'Qwen2.5-VL',
  format: 'embedded',
  contextLength: 4096,
  cached: true,
  vramRequirementMb: 4800,
  description: 'Полноценная 7B-модель, отвечает в чате и знает русский. Тяжелее: ~4-5 GB VRAM.',
  backendId: 'qwen2.5-vl-chat',
};

export const BUILTIN_MODELS: ModelInfo[] = [EMBEDDED_MODEL, QWEN25VL_CHAT_MODEL];
export const isElectron = () => typeof window !== 'undefined' && !!window.nexus?.isElectron;

// Вне Electron реального движка нет; доступна только встроенная модель.
export const PRESET_MODELS: ModelInfo[] = [...BUILTIN_MODELS];

export interface StreamCallbacks {
  sessionId?: string;
  onToken: (token: string, fullContent: string, thinking?: string) => void;
  onTelemetry: (telemetry: Partial<TelemetryState>) => void;
  onComplete: (fullContent: string, thinking?: string, stats?: { tps: number; ttft: number; tokens: number }) => void;
  onError: (error: string) => void;
}

export class LocalInferenceService {
  private abortController: AbortController | null = null;

  // Инференс выполняется в main Electron (node-llama-cpp) — WebGPU в renderer не участвует.
  async checkWebGpuSupport(): Promise<{ supported: boolean; adapterName?: string }> {
    return { supported: false };
  }

  async loadModel(model: ModelInfo, onProgress: (progress: number, text: string) => void): Promise<boolean> {
    if (isElectron() && window.nexus) {
      onProgress(30, 'Связь с локальным движком (node-llama-cpp)...');
      const status = await window.nexus.status();
      if (status.error) {
        onProgress(100, status.error);
        throw new Error(status.error);
      }
      onProgress(60, `Загрузка ${model.name} в память...`);
      await window.nexus.load(model.backendId || model.id);
      onProgress(100, `${model.name} готова.`);
      return true;
    }
    onProgress(100, 'Модель выбрана (десктопный движок недоступен в браузере).');
    return true;
  }

  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (isElectron() && window.nexus) {
      window.nexus.abort().catch(() => {});
    }
  }

  async generateStream(
    messages: Message[],
    model: ModelInfo,
    config: InferenceConfig,
    callbacks: StreamCallbacks
  ): Promise<void> {
    this.abort();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Electron: локальный инференс через node-llama-cpp в main.
    if (isElectron() && window.nexus) {
      try {
        const sessionId = (callbacks as any).sessionId || 'default';
        const unsubscribe = window.nexus.onToken((payload: any) => {
          if (signal.aborted) return;
          const stats = payload.stats || {};
          callbacks.onTelemetry({
            currentTps: Math.round((stats.tps || 0) * 10) / 10,
            activeTtft: Math.round(stats.ttft || 0),
            totalTokens: stats.tokens || 0,
            contextUsed: (stats.tokens || 0) + 150,
            status: 'generating',
          });
          callbacks.onToken(payload.delta || '', payload.full || '', undefined);
        });

        const res = await window.nexus.chat(sessionId, messages, config, (model as any)?.backendId || model.id);
        unsubscribe();

        if (res?.aborted) {
          callbacks.onComplete(res.content || '', undefined, null);
          return;
        }
        callbacks.onComplete(res.content || '', undefined, res.stats);
        return;
      } catch (err: any) {
        callbacks.onError(err?.message || String(err));
        return;
      } finally {
        this.abortController = null;
      }
    }

    // Вне Electron — движка нет, предлагаем десктопную версию.
    callbacks.onTelemetry({ status: 'error' });
    callbacks.onError('Инференс доступен только в десктопной версии (Electron). Запустите через npm start.');
  }
}

export const localInferenceService = new LocalInferenceService();