import type { AppLanguage } from './types';
import L0 from './signI18n/en';
import L1 from './signI18n/fr';
import L2 from './signI18n/de';
import L3 from './signI18n/pt';
import L4 from './signI18n/pt-BR';
import L5 from './signI18n/it';
import L6 from './signI18n/tr';
import L7 from './signI18n/zh-CN';
import L8 from './signI18n/zh-TW';
import L9 from './signI18n/ja';
import L10 from './signI18n/ko';

// Shared by the renderer and Electron native dialogs; no runtime translation or network.
export const SIGN_TRANSLATIONS: Record<Exclude<AppLanguage, 'es'>, Record<string, string>> = {
  'en': L0,
  'fr': L1,
  'de': L2,
  'pt': L3,
  'pt-BR': L4,
  'it': L5,
  'tr': L6,
  'zh-CN': L7,
  'zh-TW': L8,
  'ja': L9,
  'ko': L10,
};
export function signText(language: AppLanguage, key: string): string {
  return language === 'es' ? key : SIGN_TRANSLATIONS[language]?.[key] ?? L0[key as keyof typeof L0] ?? key;
}
