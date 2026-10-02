export type Role = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  thinking?: string;
  tokensGenerated?: number;
  speedTps?: number;
  ttftMs?: number;
  modelUsed?: string;
  /** base64 data URL финального изображения */
  imageUrl?: string;
  /** превью во время генерации */
  previewUrl?: string;
  imageMeta?: ImageGenMeta;
}

export interface ImageGenMeta {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  elapsedMs: number;
  prompt: string;
  promptEn?: string;
}

export interface ImageGenResult {
  dataUrl: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  elapsedMs: number;
  prompt: string;
  promptEn?: string;
  modelName?: string;
  /** true — сработал режим доработки предыдущего изображения (img2img) */
  edited?: boolean;
}

export interface ImageGenConfig {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: number;
  negativePrompt: string;
  strength: number;
  /** автоматически улучшать промпт (quality tags + стили) */
  enhancePrompt?: boolean;
  /** выгружать LLM перед генерацией (auto = если SD+LLM на GPU) */
  unloadLlmBeforeImage?: boolean | 'auto';
  /** текущая image-модель */
  imageModelId?: 'z-image-turbo';
}

export interface SdBackendStatus {
  available: boolean;
  loaded: boolean;
  modelPath: string | null;
  modelName: string;
  missingFiles?: string[];
  deviceType: 'cpu' | 'cuda' | 'vulkan' | 'metal';
  deviceLabel: string;
  prebuilt: boolean;
  gpuCapable: boolean;
  llmGpuLabel?: string | null;
  llmLoaded?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  systemPrompt?: string;
  pinned?: boolean;
}

export interface GgufMetadata {
  magic: string;
  version: number;
  tensorCount: number;
  kvCount: number;
  architecture: string;
  contextLength: number;
  embeddingLength?: number;
  blockCount?: number;
  fileType?: string;
  quantization?: string;
  fileSizeMb?: number;
  fileName?: string;
  rawKv?: Record<string, string | number>;
}

export interface ModelInfo {
  id: string;
  name: string;
  size: string;
  quant: string;
  family: string;
  format: 'gguf' | 'webllm' | 'local_ipc' | 'embedded';
  contextLength: number;
  cached: boolean;
  vramRequirementMb: number;
  description: string;
  isCustomGguf?: boolean;
  ggufMetadata?: GgufMetadata;
  downloadUrl?: string;
  backendId?: string;
}

export interface InferenceConfig {
  temperature: number;
  topP: number;
  maxTokens: number;
  repetitionPenalty: number;
  contextWindow: number;
  systemPromptPreset: string;
  systemPromptCustom: string;
  enableAudioFeedback: boolean;
  streamThinking: boolean;
  soundVolume: number;
  imageGen: ImageGenConfig;
}

export type EngineStatus = 'idle' | 'loading_model' | 'thinking' | 'generating' | 'generating_image' | 'error';

export interface TelemetryState {
  currentTps: number;
  activeTtft: number;
  totalTokens: number;
  contextUsed: number;
  maxContext: number;
  vramUsedMb: number;
  status: EngineStatus;
  loadProgress: number;
  loadText: string;
}

export interface PersonaPreset {
  id: string;
  title: string;
  tagline: string;
  iconName: string;
  prompt: string;
}
