/**
 * Очистка и санитизация вывода моделей для отображения в UI.
 */

/**
 * Стемит вывод: чистятся только обычные текстовые фрагменты.
 * Содержимое код-блоков (```... ```) СОХРАНЯЕТСЯ как есть —
 * иначе теги внутри HTML/CSS/JS кода вырезались и блок становился пустым
 * («блок кода пуст»), хотя модель реально прислала код.
 */
export function sanitizeModelOutput(raw: string): string {
  if (!raw) return '';
  const out = String(raw);
  // Разбиваем на код-блоки и обычный текст. Код-фрагменты не трогаем.
  const parts = out.split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith('```')) return part; // код как есть
      return part
        .replace(/<[\s\S]*?<\/[\s\S]*?>/g, '') // парные теги в прозе
        .replace(/<\/?[\w-]+>/g, '');           // одиночные теги в прозе
    })
    .join('')
    .trim();
}

/**
 * Очистка содержимого блока кода перед подсветкой/копированием.
 * Срезает возможные обрамляющие артефакты и нормализует отступы.
 */
export function cleanCodeBody(code: string, _lang: string): string {
  if (!code) return '';
  let out = String(code);
  // Служебные маркеры (например, эхо промпта или открывающие кавычки)
  out = out.replace(/^```\w*\n?/, '');
  out = out.replace(/\n?```$/, '');
  return out.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}
