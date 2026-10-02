export type ImageModelId = 'z-image-turbo';

export interface ImageModelDef {
  id: ImageModelId;
  name: string;
  label: string;
  description: string;
  steps: number;
  cfg: number;
  distilledGuidance: number;
  sampleMethod: string;
  scheduler: string;
  color: string;
  accent: string;
}

export const IMAGE_MODELS: ImageModelDef[] = [
  {
    id: 'z-image-turbo',
    name: 'Z-Image Turbo',
    label: 'HC AI',
    description: 'Встроенная модель изображений. Быстрая генерация 768×768, малый расход памяти.',
    steps: 10,
    cfg: 1,
    distilledGuidance: 3.5,
    sampleMethod: 'euler',
    scheduler: 'sgm_uniform',
    color: 'text-purple-300',
    accent: 'border-purple-400/40 bg-purple-500/10',
  },
];

export const DEFAULT_IMAGE_MODEL_ID: ImageModelId = 'z-image-turbo';

export function getImageModel(id?: ImageModelId | null): ImageModelDef {
  return IMAGE_MODELS.find(m => m.id === id) ?? IMAGE_MODELS[0];
}
