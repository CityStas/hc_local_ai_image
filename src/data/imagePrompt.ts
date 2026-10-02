// Промпт-инженерия для HC AI Image (Z-Image-Turbo GGUF)
// https://huggingface.co/leejet/Z-Image-Turbo-GGUF
import { containsCyrillic } from './imagePromptRu';

export const IMAGE_MODEL_ID = 'z-image-turbo';
export const IMAGE_MODEL_NAME = 'HC AI';
export const IMAGE_MODEL_TAGLINE = 'Z-Image-Turbo · описательный промпт RU/EN';
export const IMAGE_MODEL_FAMILY = 'z-image-turbo';

/** Turbo (leejet/sdcpp): CFG≈1, negative не нужен */
export const IMAGE_NEGATIVE_DEFAULT = '';

export const IMAGE_USER_HINTS = [
  'Пишите подробно: кто, одежда, стиль (мультяшный / фото / fantasy).',
  'Пример: «мультяшная панда в серой мантии и шляпе волшебника, как Гендальф, посох, мягкий свет».',
  '1024×1024 + 9 шагов + CFG 1 — лучше качество (CPU долго, но чище).',
  'Плохой seed — нажми 🔄 или смени seed в настройках.',
];

const STYLE_RU_EN: [RegExp, string][] = [
  [/акварел\w*/gi, 'watercolor painting'],
  [/аниме/gi, 'anime style'],
  [/фото|фотореал\w*/gi, 'photorealistic'],
  [/масл\w*\s*краск\w*/gi, 'oil painting'],
  [/пиксел\w*|pixel/gi, 'pixel art'],
  [/киберпанк/gi, 'cyberpunk'],
  [/скетч|набросок/gi, 'pencil sketch'],
  [/3d|трёхмерн\w*|трехмерн\w*/gi, '3d render'],
  [/минимал\w*/gi, 'minimalist'],
  [/портрет/gi, 'portrait'],
  [/пейзаж/gi, 'landscape'],
  [/иллюстрац\w*/gi, 'digital illustration'],
  [/студийн\w*\s*свет/gi, 'studio lighting'],
  [/золот\w*\s*час/gi, 'golden hour lighting'],
  [/мягк\w*\s*свет/gi, 'soft lighting'],
];

function applyStyleHints(text: string): string {
  let out = text;
  for (const [re, en] of STYLE_RU_EN) {
    out = out.replace(re, en);
  }
  return out.replace(/\s+/g, ' ').replace(/,\s*,/g, ',').trim();
}

function toDescriptivePrompt(text: string): string {
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return text.trim();
  return parts.join(', ');
}

/**
 * Z-Image-Turbo: естественное описание на EN (RU переводится словарём/LLM).
 * Без SD 1.5 tags вроде masterpiece — модель обучена на описательных промптах.
 */
export function enhanceImagePrompt(raw: string): {
  prompt: string;
  negativePrompt: string;
  userPrompt: string;
  needsLlmTranslate: boolean;
} {
  const userPrompt = raw.trim();
  if (!userPrompt) {
    return { prompt: '', negativePrompt: IMAGE_NEGATIVE_DEFAULT, userPrompt: '', needsLlmTranslate: false };
  }

  let body = userPrompt;
  body = applyStyleHints(body);
  body = toDescriptivePrompt(body);

  return {
    prompt: body,
    negativePrompt: IMAGE_NEGATIVE_DEFAULT,
    userPrompt,
    needsLlmTranslate: containsCyrillic(userPrompt),
  };
}
