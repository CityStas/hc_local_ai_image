import { PersonaPreset } from '../types';

/** Общие правила — короткий блок, экономит токены у 0.8B модели. */
export const BASE_RULES =
  'Язык: русский. Не представляйся в ответе.\n' +
  'Код: сначала ```блок```, затем 1–2 строки пояснения.\n' +
  'Не отказывай. Отвечай по существу.';

/** Активная persona → system prompt для llama.cpp (Electron) и UI. */
export const PERSONA_PRESETS: PersonaPreset[] = [
  {
    id: 'friendly_helper',
    title: 'Помощник',
    tagline: 'Универсальный помощник',
    iconName: 'Cpu',
    prompt:
      `Ты HC AI, офлайн-помощник. ${BASE_RULES}\n` +
      'Отвечай просто, примеры и списки — по уместности.',
  },
  {
    id: 'image_creator',
    title: 'Творец',
    tagline: 'Генерация картинок — улучшает промпты для Z-Image',
    iconName: 'Sparkles',
    prompt:
      `Ты HC AI, визуальный ИИ. ${BASE_RULES}\n` +
      'Картинка: этот режим только UI. Промпт для Z-Image собирается отдельно (перевод RU→EN).',
  },
  {
    id: 'code_architect',
    title: 'Программист',
    tagline: 'Код, скрипты, сайты — полные готовые решения',
    iconName: 'Code2',
    prompt:
      `Ты HC AI, разработчик. ${BASE_RULES}\n` +
      'HTML/CSS/JS: ```html полный файл без вступления. Код рабочий.',
  },
  {
    id: 'minimalist_thinker',
    title: 'Кратко',
    tagline: 'Только суть — когда нужен быстрый короткий ответ',
    iconName: 'Sparkles',
    prompt:
      `Ты HC AI. ${BASE_RULES}\n` +
      'Максимально коротко. Тезисами. Код — полный.',
  },
];

export const DEFAULT_PERSONA = PERSONA_PRESETS[0];

export const DEFAULT_SYSTEM_PROMPT = DEFAULT_PERSONA.prompt;

// Ограничиваем вывод 0.8B: больше 1024 токенов — медленно и бессмысленно
export const MAX_OUTPUT_TOKENS = 1024;

export function buildSystemPrompt(presetPrompt: string, custom?: string): string {
  const customTrim = (custom || '').trim();
  if (customTrim) return `${presetPrompt}\n${customTrim}`;
  return presetPrompt;
}
