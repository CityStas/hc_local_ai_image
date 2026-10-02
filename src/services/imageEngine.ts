import { ImageGenConfig, ImageGenResult, SdBackendStatus } from '../types';
import { enhanceImagePrompt, IMAGE_MODEL_NAME } from '../data/imagePrompt';

export function isImageModePrompt(text: string): boolean {
  return /^\/(image|draw|img|картинка|нарисуй)\s+/i.test(text.trim());
}

export function extractImagePrompt(text: string): string {
  return text.replace(/^\/(image|draw|img|картинка|нарисуй)\s+/i, '').trim();
}

/** Запрос на анализ фото (Vision), а не генерацию Z-Image */
export function isVisionIntentPrompt(text: string): boolean {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return /(опиш|описан|что\s+(на|в)\s+(этом\s+)?(фото|картин|изображ|снимк)|what('s| is) (in|on) (this |the )?(image|photo|picture)|describe|распозна|прочитай\s+текст|\bocr\b|калор|сколько\s+кал|список\s+объект|extract\s+text|analy[sz]e\s+(this\s+)?(image|photo)|анализ\s+(фото|картин|изображ)|сканер|что\s+это\s+(за\s+)?(на\s+)?(фото|картин))/i.test(t);
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.readAsDataURL(file);
  });
}

export interface InitImagePayload {
  width: number;
  height: number;
  data: number[];
}

/**
 * Источник для img2img. Предпочитаем dataUrl (base64 PNG) — дешёво и надёжно
 * передаётся через IPC. Формат `{width,height,data}` (из fileToRgb) для больших
 * фото создаёт огромный JS-массив и в IPC ненадёжен.
 */
export type InitImageInput = { dataUrl: string } | InitImagePayload;

export async function fileToRgb(file: File): Promise<InitImagePayload> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D недоступен');
  ctx.drawImage(bmp, 0, 0);
  const imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const rgb = new Uint8Array(bmp.width * bmp.height * 3);
  for (let i = 0, j = 0; i < imgData.data.length; i += 4, j += 3) {
    rgb[j] = imgData.data[i];
    rgb[j + 1] = imgData.data[i + 1];
    rgb[j + 2] = imgData.data[i + 2];
  }
  bmp.close();
  return { width: bmp.width, height: bmp.height, data: Array.from(rgb) };
}

/**
 * Прозрачный ли PNG (есть ли заметная доля пикселей с alpha < 250).
 * Для таких изображений работает режим compositing: фон генерится по запросу,
 * а объект кладётся сверху, сохраняясь 100% (не проходит через диффузию).
 */
export async function hasTransparency(file: File): Promise<boolean> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
    const w = Math.max(16, Math.round(bmp.width * scale));
    const h = Math.max(16, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) { bmp.close(); return false; }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const data = ctx.getImageData(0, 0, w, h).data;
    let semi = 0;
    const total = data.length / 4;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) semi++;
    }
    return semi / total > 0.03; // >3% непрозрачных/полупрозрачных пикселей → есть фон-альфа
  } catch {
    return false;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Не удалось загрузить изображение для композита'));
    img.src = src;
  });
}

/**
 * Удаляет белый/однотонный фон с непрозрачного изображения (flood-fill от краёв).
 * Фоновая альфа переводится в 0; края объекта сглаживаются (feather по границе).
 * Возвращает { dataUrl, ratio } — ratio = доля удалённых пикселей, чтобы понять,
 * был ли реально фон. Если фон не обнаружен — возвращает null (оставляем img2img).
 */
export async function removeWhiteBackground(
  file: File,
  whiteness = 0.96
): Promise<{ dataUrl: string; ratio: number } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
    const w = Math.max(32, Math.round(bmp.width * scale));
    const h = Math.max(32, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) { bmp.close(); return null; }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    const n = w * h;

    // Сегментная маска: 1 = фон, 0 = объект. Начинаем flood-fill от всех краевых
    // пикселей, которые "белые". Порог whiteness — минимальная доля минимальной
    // RGB-компоненты к максимальной (т.е. почти без цвета) и близость к 255.
    const mask = new Uint8Array(n);
    const stack: number[] = [];
    const isWhite = (i: number) => {
      const o = i * 4;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const minMax = mx > 0 ? mn / mx : 1;   // 1 = серый/белый, близко к 1 = почти без цвета
      return mx >= 240 && minMax >= whiteness;
    };
    const push = (i: number) => {
      if (!mask[i] && isWhite(i)) { mask[i] = 1; stack.push(i); }
    };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + (w - 1)); }

    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i / w) | 0;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (y > 0) push(i - w);
      if (y < h - 1) push(i + w);
    }

    // Обнуляем альфу фона, края — плавно (feather ~2px).
    const removed = mask.reduce((a, b) => a + b, 0);
    if (removed / n < 0.1) return null; // фон почти не удалён — это не фоновое фото

    for (let i = 0; i < n; i++) {
      if (mask[i]) data[i * 4 + 3] = 0;
    }
    // Feather: среднее альфы по 8 соседям для погран-пикселей объекта.
    // Упрощённо: там, где фон граничит с объектом, альфа получается 127.
    for (let i = 0; i < n; i++) {
      if (mask[i]) continue;
      const x = i % w, y = (i / w) | 0;
      let edge = false;
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx]) { edge = true; break; }
      }
      if (edge) data[i * 4 + 3] = 200; // полупрозрачная кромка для мягкого перехода
    }

    ctx.putImageData(img, 0, 0);
    return { dataUrl: canvas.toDataURL('image/png'), ratio: removed / n };
  } catch {
    return null;
  }
}

/**
 * Кладёт прозрачный объект (objDataUrl) на сгенерированный фон (bgDataUrl).
 * Объект вписывается в нижнюю треть, в позицию position (left/center/right),
 * с мягкой тенью и сохранением альфа-канала. Возвращает композит как PNG dataUrl.
 */
export type CompositePosition = 'left' | 'center' | 'right';

export async function compositeObjectOnBackground(
  bgDataUrl: string,
  objDataUrl: string,
  opts: { targetHeight?: number; bottomMarginRatio?: number; position?: CompositePosition } = {}
): Promise<string> {
  const bg = await loadImage(bgDataUrl);
  const obj = await loadImage(objDataUrl);
  const W = bg.naturalWidth || 768;
  const H = bg.naturalHeight || 768;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D недоступен');

  ctx.drawImage(bg, 0, 0, W, H);

  // Масштаб объекта: высота ~45-55% фона, не шире 70% ширины.
  const maxH = opts.targetHeight ?? Math.round(H * 0.5);
  const maxW = Math.round(W * 0.7);
  const ratio = Math.min(
    maxH / (obj.naturalHeight || 1),
    maxW / (obj.naturalWidth || 1),
    1
  );
  // Объект в нижней трети, в выбранной позиции по горизонтали, с drop-shadow,
  // чтобы читался «стоящим на поверхности» рядом с другими объектами сцены.
  const ow = obj.naturalWidth * ratio;
  const oh = obj.naturalHeight * ratio;
  const sideMargin = Math.round(W * 0.06);
  const position: CompositePosition = opts.position ?? 'center';
  const ox =
    position === 'left' ? sideMargin
    : position === 'right' ? W - ow - sideMargin
    : (W - ow) / 2;
  const oy = H - oh - Math.round(H * 0.08); // почти на «полу»/столе

  // Реалистичная drop-shadow: рисуем силуэт объекта, размываем и смещаем вниз.
  try {
    ctx.save();
    ctx.translate(ox + ow / 2, oy + oh);
    ctx.filter = `blur(${Math.max(3, Math.round(oh * 0.05))}px)`;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(0, Math.round(oh * 0.02), ow / 2, oh * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } catch { /* filter может быть недоступен — тень пропускаем */ }

  // Объект поверх фона.
  ctx.drawImage(obj, ox, oy, ow, oh);

  return canvas.toDataURL('image/png');
}

/**
 * Промпт для ФОНА (когда объект накладывается отдельно): убираем ссылки на
 * прикреплённое фото / упаковку, оставляем описание сцены. Модель не должна
 * рисовать продукт (он придёт композитом), поэтому указываем ПУСТОЕ место
 * под продукт в выбранной позиции — остальная сцена заполняется вокруг.
 */
export function toBackgroundPrompt(raw: string, position: CompositePosition = 'center'): string {
  let t = String(raw || '').trim();
  t = t
    .replace(/используй\s+прикрепл\w*\s+фото/gi, '')
    .replace(/прикрепл\w+\s+фото/gi, '')
    .replace(/используй\s+это\s+фото/gi, '')
    .replace(/\bэто\s+(упаковка|пачка|продукт)\b/gi, '')
    .replace(/\bприложенн\w+\b/gi, '')
    .replace(/\bдобав\w+\s+этот\s+корм\b/gi, '')
    .replace(/\bдобав\w+\s+эт\w+\b/gi, '')
    .replace(/\bпостав\w+\s+рядом\b/gi, '')
    .replace(/\bупаковка\b/gi, '')
    .replace(/\bпачка\b/gi, '')
    .replace(/\bслева\b/gi, '')
    .replace(/\bсправа\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const scene = t || 'a clean commercial product photography backdrop, soft studio lighting';
  // Указываем модели, ГДЕ должно остаться пустое место под продукт, чтобы
  // другие объекты (миска и т.д.) генерировались с противоположной стороны.
  const placement =
    position === 'left' ? 'leave the left side of the frame empty for product placement, place other objects to the right'
    : position === 'right' ? 'leave the right side of the frame empty for product placement, place other objects to the left'
    : 'empty central area for product display';
  return scene + `, ${placement}, no packaging or product in frame`.trim();
}

/** Декодирует dataUrl в base64 (без префикса) для IPC. */
export function stripDataUrlPrefix(dataUrl: string): string {
  return String(dataUrl || '').replace(/^data:[^;]+;base64,/, '');
}

/**
 * Читает файл в dataUrl, при необходимости ресайзит до максимум `maxSize` по большей
 * стороне. Для img2img крупные фото не нужны (768×768 выход), а маленький вход
 * быстрее декодируется на GPU и не раздувает IPC. Возвращает null при ошибке.
 */
export async function fileToResizedDataUrl(
  file: File,
  maxSize = 1024,
  outputMime = 'image/png'
): Promise<InitImageInput | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bmp.width, bmp.height));
    const w = Math.max(64, Math.min(Math.round(bmp.width * scale), maxSize));
    const h = Math.max(64, Math.min(Math.round(bmp.height * scale), maxSize));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bmp.close(); return null; }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return { dataUrl: canvas.toDataURL(outputMime, 0.95) };
  } catch {
    return null;
  }
}

export class ImageGenerationService {
  abort() {
    window.nexus?.sdAbort().catch(() => {});
  }

  async generate(
    prompt: string,
    config: ImageGenConfig,
    callbacks: {
      onProgress?: (progress: number, text: string, meta?: { step?: number; steps?: number; etaSec?: number }) => void;
      onPreview?: (dataUrl: string, step: number) => void;
      initImage?: InitImageInput;
      /** Последнее сгенерированное в этом чате изображение (dataUrl) — для режима доработки img2img */
      previousImage?: string;
      /** EN-промпт того изображения */
      previousPromptEn?: string;
    }
  ): Promise<ImageGenResult> {
    if (!window.nexus?.sdGenerate) {
      throw new Error('Генерация изображений доступна только в десктопной версии.');
    }

    const offProgress = window.nexus.onSdProgress?.((p) => {
      callbacks.onProgress?.(p.progress ?? 0, p.text || '', {
        step: p.step,
        steps: p.steps,
        etaSec: p.etaSec,
      });
    });
    const offPreview = window.nexus.onSdPreview?.((p) => {
      if (p.dataUrl) callbacks.onPreview?.(p.dataUrl, p.step ?? 0);
    });

    try {
      const enhanced = config.enhancePrompt !== false
        ? enhanceImagePrompt(prompt)
        : { prompt, negativePrompt: config.negativePrompt, userPrompt: prompt, needsLlmTranslate: false };

      const res = await window.nexus.sdGenerate({
        prompt: enhanced.prompt,
        userPrompt: enhanced.userPrompt,
        width: config.width,
        height: config.height,
        steps: config.steps,
        cfg: config.cfg,
        seed: config.seed,
        negativePrompt: config.negativePrompt || enhanced.negativePrompt,
        initImage: callbacks.initImage,
        previousImage: callbacks.previousImage,
        previousPromptEn: callbacks.previousPromptEn,
        strength: config.strength,
        unloadLlmBeforeImage: config.unloadLlmBeforeImage ?? 'auto',
        enhancePrompt: config.enhancePrompt !== false,
        needsLlmTranslate: enhanced.needsLlmTranslate,
      });

      if (res.aborted) throw new Error('Генерация отменена');
      if (!res.ok || !res.dataUrl) throw new Error(res.error || 'Не удалось сгенерировать изображение');

      return {
        dataUrl: res.dataUrl,
        width: res.width ?? config.width,
        height: res.height ?? config.height,
        seed: res.seed ?? config.seed,
        steps: res.steps ?? config.steps,
        cfg: res.cfg ?? config.cfg,
        elapsedMs: res.elapsedMs ?? 0,
        prompt: res.userPrompt ?? enhanced.userPrompt ?? prompt,
        promptEn: res.sdPrompt ?? res.prompt,
        modelName: res.modelName ?? IMAGE_MODEL_NAME,
      };
    } finally {
      offProgress?.();
      offPreview?.();
    }
  }
}

export const imageGenerationService = new ImageGenerationService();

export const DEFAULT_IMAGE_CONFIG: ImageGenConfig = {
  width: 768,
  height: 768,
  steps: 8,
  cfg: 1,
  seed: -1,
  negativePrompt: '',
  strength: 0.65,
  enhancePrompt: true,
  unloadLlmBeforeImage: 'auto',
};

export async function fetchSdBackendStatus(): Promise<SdBackendStatus | null> {
  if (!window.nexus?.sdStatus) return null;
  try {
    const st = await window.nexus.sdStatus();
    return st as SdBackendStatus;
  } catch {
    return null;
  }
}
