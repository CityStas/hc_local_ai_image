export type VlmModelId = 'qwen25vl';
export type VlmMode = 'describe' | 'ocr' | 'objects' | 'calories' | 'custom';

export interface VlmModelDef {
  id: VlmModelId;
  name: string;
  sizeLabel: string;
  vramMb: number;
  downloadHint: string;
}

export const VLM_MODELS: VlmModelDef[] = [
  {
    id: 'qwen25vl',
    name: 'Qwen2.5-VL 7B',
    sizeLabel: '~5.5 GB Q4_K_M',
    vramMb: 6000,
    downloadHint: 'Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf + mmproj-...-Q8_0.gguf',
  },
];

export const DEFAULT_VLM_MODEL_ID: VlmModelId = 'qwen25vl';

export function getVlmModel(id?: string): VlmModelDef {
  return VLM_MODELS.find((m) => m.id === id) || VLM_MODELS[0];
}

export const VLM_MODE_CHIPS: { id: VlmMode; label: string; title: string }[] = [
  { id: 'describe', label: 'Описать', title: 'Подробное описание сцены' },
  { id: 'ocr', label: 'OCR', title: 'Распознать весь текст' },
  { id: 'calories', label: 'Калории', title: 'Оценка калорий по фото еды' },
];
