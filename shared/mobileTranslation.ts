import type {ContentTranslationSummary, GenerateTranslationRequest, TranslationLanguage} from './types';

export interface MobileTranslationContext {
  revision: string;
  language: TranslationLanguage;
}
export interface MobileTranslationSave {
  request: GenerateTranslationRequest;
  revision: string;
  markdown: string;
  requestId: string;
}
export type MobileTranslationResult = ContentTranslationSummary;
