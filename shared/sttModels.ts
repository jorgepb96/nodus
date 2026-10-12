export type StudySttProvider = 'transformers' | 'whisper_cpp' | 'openai';

export interface StudySttModel {
  id: string;
  label: string;
  sizeMb: number;
  ramMb: number;
  speed: 'muy_rapido' | 'rapido' | 'equilibrado' | 'preciso';
  accuracy: 'basica' | 'buena' | 'alta' | 'muy_alta';
  multilingual: boolean;
}

export const STUDY_STT_MODELS: readonly StudySttModel[] = [
  { id: 'Xenova/whisper-tiny', label: 'Whisper Tiny', sizeMb: 75, ramMb: 420, speed: 'muy_rapido', accuracy: 'basica', multilingual: true },
  { id: 'Xenova/whisper-base', label: 'Whisper Base', sizeMb: 142, ramMb: 650, speed: 'rapido', accuracy: 'buena', multilingual: true },
  { id: 'Xenova/whisper-small', label: 'Whisper Small', sizeMb: 466, ramMb: 1500, speed: 'equilibrado', accuracy: 'alta', multilingual: true },
  { id: 'Xenova/whisper-medium', label: 'Whisper Medium', sizeMb: 1500, ramMb: 3900, speed: 'preciso', accuracy: 'muy_alta', multilingual: true },
] as const;

export interface WhisperCppModel {
  id: string;
  label: string;
  sizeMb: number;
  multilingual: boolean;
}

export interface OpenAiStudySttModel {
  id: 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'gpt-4o-transcribe-diarize';
  label: string;
  diarization: boolean;
}

export const DEFAULT_OPENAI_TRANSCRIPTION_MODEL: OpenAiStudySttModel['id'] = 'gpt-4o-transcribe';

/** Models accepted by the OpenAI audio-transcriptions endpoint and intentionally
 * exposed by Nodus. Chat favorites never belong in this selector: their provider
 * may be OpenAI too, but the audio endpoint cannot run them. */
export const OPENAI_STUDY_STT_MODELS: readonly OpenAiStudySttModel[] = [
  { id: 'gpt-4o-mini-transcribe', label: 'GPT-4o mini Transcribe', diarization: false },
  { id: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe', diarization: false },
  { id: 'gpt-4o-transcribe-diarize', label: 'GPT-4o Transcribe Diarize', diarization: true },
] as const;

export function isOpenAiStudySttModel(value: string | null | undefined): value is OpenAiStudySttModel['id'] {
  const clean = value?.trim();
  return Boolean(clean && OPENAI_STUDY_STT_MODELS.some((model) => model.id === clean));
}

export function isOpenAiDiarizationModel(value: string | null | undefined): boolean {
  return OPENAI_STUDY_STT_MODELS.some((model) => model.id === value?.trim() && model.diarization);
}

/** Official multilingual GGML files published by whisper.cpp. English-only
 * variants are deliberately omitted because the UI allows per-audio language
 * selection. */
export const WHISPER_CPP_MODELS: readonly WhisperCppModel[] = [
  { id: 'tiny', label: 'Whisper Tiny', sizeMb: 75, multilingual: true },
  { id: 'base', label: 'Whisper Base', sizeMb: 142, multilingual: true },
  { id: 'small', label: 'Whisper Small', sizeMb: 466, multilingual: true },
  { id: 'medium', label: 'Whisper Medium', sizeMb: 1536, multilingual: true },
  { id: 'large-v3-turbo-q5_0', label: 'Whisper Large v3 Turbo Q5', sizeMb: 547, multilingual: true },
] as const;

const WHISPER_LANGUAGE_ENTRIES = [
  ['en', 'English'], ['zh', 'Chinese'], ['de', 'German'], ['es', 'Spanish'], ['ru', 'Russian'],
  ['ko', 'Korean'], ['fr', 'French'], ['ja', 'Japanese'], ['pt', 'Portuguese'], ['tr', 'Turkish'],
  ['pl', 'Polish'], ['ca', 'Catalan'], ['nl', 'Dutch'], ['ar', 'Arabic'], ['sv', 'Swedish'],
  ['it', 'Italian'], ['id', 'Indonesian'], ['hi', 'Hindi'], ['fi', 'Finnish'], ['vi', 'Vietnamese'],
  ['he', 'Hebrew'], ['uk', 'Ukrainian'], ['el', 'Greek'], ['ms', 'Malay'], ['cs', 'Czech'],
  ['ro', 'Romanian'], ['da', 'Danish'], ['hu', 'Hungarian'], ['ta', 'Tamil'], ['no', 'Norwegian'],
  ['th', 'Thai'], ['ur', 'Urdu'], ['hr', 'Croatian'], ['bg', 'Bulgarian'], ['lt', 'Lithuanian'],
  ['la', 'Latin'], ['mi', 'Maori'], ['ml', 'Malayalam'], ['cy', 'Welsh'], ['sk', 'Slovak'],
  ['te', 'Telugu'], ['fa', 'Persian'], ['lv', 'Latvian'], ['bn', 'Bengali'], ['sr', 'Serbian'],
  ['az', 'Azerbaijani'], ['sl', 'Slovenian'], ['kn', 'Kannada'], ['et', 'Estonian'], ['mk', 'Macedonian'],
  ['br', 'Breton'], ['eu', 'Basque'], ['is', 'Icelandic'], ['hy', 'Armenian'], ['ne', 'Nepali'],
  ['mn', 'Mongolian'], ['bs', 'Bosnian'], ['kk', 'Kazakh'], ['sq', 'Albanian'], ['sw', 'Swahili'],
  ['gl', 'Galician'], ['mr', 'Marathi'], ['pa', 'Punjabi'], ['si', 'Sinhala'], ['km', 'Khmer'],
  ['sn', 'Shona'], ['yo', 'Yoruba'], ['so', 'Somali'], ['af', 'Afrikaans'], ['oc', 'Occitan'],
  ['ka', 'Georgian'], ['be', 'Belarusian'], ['tg', 'Tajik'], ['sd', 'Sindhi'], ['gu', 'Gujarati'],
  ['am', 'Amharic'], ['yi', 'Yiddish'], ['lo', 'Lao'], ['uz', 'Uzbek'], ['fo', 'Faroese'],
  ['ht', 'Haitian Creole'], ['ps', 'Pashto'], ['tk', 'Turkmen'], ['nn', 'Nynorsk'], ['mt', 'Maltese'],
  ['sa', 'Sanskrit'], ['lb', 'Luxembourgish'], ['my', 'Myanmar'], ['bo', 'Tibetan'], ['tl', 'Tagalog'],
  ['mg', 'Malagasy'], ['as', 'Assamese'], ['tt', 'Tatar'], ['haw', 'Hawaiian'], ['ln', 'Lingala'],
  ['ha', 'Hausa'], ['ba', 'Bashkir'], ['jw', 'Javanese'], ['su', 'Sundanese'],
] as const;

export const STUDY_STT_LANGUAGES = [
  { code: 'auto', label: 'Detectar automáticamente' },
  ...WHISPER_LANGUAGE_ENTRIES.map(([code, label]) => ({ code, label })),
] as const;

export interface WhisperCppStatus {
  executablePath: string | null;
  executableReady: boolean;
  models: Array<{ id: string; path: string; downloaded: boolean; bytes: number }>;
}

export interface StudySttStreamHandlers {
  onProgress?: (fraction: number) => void;
  onPartial?: (text: string) => void;
}

export interface StudySttDeviceProfile {
  memoryGb?: number | null;
  logicalCores?: number | null;
}

export function recommendStudySttModel(profile: StudySttDeviceProfile): StudySttModel {
  const memory = profile.memoryGb ?? 4;
  const cores = profile.logicalCores ?? 4;
  if (memory >= 16 && cores >= 8) return STUDY_STT_MODELS[2];
  if (memory >= 8 && cores >= 4) return STUDY_STT_MODELS[1];
  return STUDY_STT_MODELS[0];
}

export function getStudySttModel(id: string): StudySttModel {
  return STUDY_STT_MODELS.find((model) => model.id === id) ?? STUDY_STT_MODELS[0];
}

const WHISPER_LANGUAGES = Object.fromEntries(WHISPER_LANGUAGE_ENTRIES.map(([code, label]) => [code, label.toLocaleLowerCase()]));

export function whisperLanguageName(language: string): string | undefined {
  const normalized = language.trim().toLocaleLowerCase();
  if (!normalized || normalized === 'auto') return undefined;
  return WHISPER_LANGUAGES[normalized] ?? WHISPER_LANGUAGES[normalized.split('-')[0]];
}

export type StudyDictationAction = 'finish' | 'undo' | 'delete_last_sentence' | null;

export interface StudyDictationTransformOptions {
  removeFillers?: boolean;
  customDictionary?: string[];
}

export interface StudyDictationTransform {
  text: string;
  action: StudyDictationAction;
}

const ACTIONS: Array<[RegExp, Exclude<StudyDictationAction, null>]> = [
  [/^(?:finalizar|terminar dictado|finish dictation)$/iu, 'finish'],
  [/^(?:deshacer|undo)$/iu, 'undo'],
  [/^(?:borrar (?:la )?última frase|delete (?:the )?last sentence)$/iu, 'delete_last_sentence'],
];

const SPOKEN_PUNCTUATION: Array<[RegExp, string]> = [
  [/(?:^|\s)(?:nuevo párrafo|new paragraph)(?=\s|$)/giu, '\n\n'],
  [/(?:^|\s)(?:punto y coma|semicolon)(?=\s|$)/giu, '; '],
  [/(?:^|\s)(?:dos puntos|colon)(?=\s|$)/giu, ': '],
  [/(?:^|\s)(?:punto|period|full stop)(?=\s|$)/giu, '. '],
  [/(?:^|\s)(?:coma|comma)(?=\s|$)/giu, ', '],
];

function capitalizeSentences(value: string): string {
  return value.replace(/(^|[.!?]\s+|\n+)(\p{Ll})/gu, (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase()}`);
}

function preserveDictionaryCase(value: string, dictionary: string[]): string {
  return dictionary.reduce((text, term) => {
    const clean = term.trim();
    if (!clean) return text;
    const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`\\b${escaped}\\b`, 'giu'), clean);
  }, value);
}

export function transformStudyDictation(raw: string, options: StudyDictationTransformOptions = {}): StudyDictationTransform {
  const clean = raw.replace(/\s+/g, ' ').trim();
  for (const [pattern, action] of ACTIONS) {
    if (pattern.test(clean)) return { text: '', action };
  }
  const structural = clean.match(/^(título|title|subtítulo|subtitle|lista|list)\s+(.+)$/iu);
  if (structural) {
    const marker = /^(título|title)$/iu.test(structural[1]) ? '# ' : /^(subtítulo|subtitle)$/iu.test(structural[1]) ? '## ' : '- ';
    return { text: `${marker}${capitalizeSentences(preserveDictionaryCase(structural[2], options.customDictionary ?? []))}`, action: null };
  }
  let text = clean;
  for (const [pattern, replacement] of SPOKEN_PUNCTUATION) text = text.replace(pattern, replacement);
  if (options.removeFillers) {
    text = text.replace(/(?:^|\s)(?:eh+|em+|mmm+|um+|este(?:ee)*)(?=\s|$)/giu, ' ');
  }
  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
  text = capitalizeSentences(preserveDictionaryCase(text, options.customDictionary ?? []));
  return { text, action: null };
}

export function deleteLastStudySentence(markdown: string): string {
  const clean = markdown.trimEnd();
  const matches = [...clean.matchAll(/[.!?](?=\s|$)/g)];
  if (matches.length < 2) return '';
  return clean.slice(0, (matches.at(-2)?.index ?? -1) + 1).trimEnd();
}

export function insertStudyDictation(markdown: string, text: string, cursor: number): { markdown: string; from: number; to: number } {
  const at = Math.max(0, Math.min(markdown.length, cursor));
  const before = markdown.slice(0, at);
  const after = markdown.slice(at);
  const prefix = before && !/[\s\n]$/.test(before) && !/^[,.;:!?]/.test(text) ? ' ' : '';
  const suffix = after && !/^\s/.test(after) && !/[\s\n]$/.test(text) ? ' ' : '';
  const inserted = `${prefix}${text}${suffix}`;
  return { markdown: `${before}${inserted}${after}`, from: at + prefix.length, to: at + prefix.length + text.length };
}

export function buildStudySttPrompt(vocabulary: string[], limit = 80): string {
  const unique = [...new Set(vocabulary.map((term) => term.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, limit);
  return unique.length ? `Vocabulario del curso: ${unique.join(', ')}.` : '';
}

export interface StudySttRequest {
  /** Keep a local model resident for rolling dictation windows. An empty WAV
   * payload prepares this session; cancel its requestId to release the model. */
  realtime?: boolean;
  /** Live dictation can skip a short phrase that contains no recognized speech. */
  allowEmpty?: boolean;
  audioBytes: Uint8Array;
  mimeType: string;
  provider?: StudySttProvider | null;
  model?: string | null;
  language?: string | null;
  prompt?: string | null;
  requestId?: string | null;
}

export interface StudySttResult {
  text: string;
  provider: StudySttProvider;
  model: string;
  chunks?: Array<{
    text: string;
    timestamp: [number | null, number | null] | null;
    speaker?: string;
  }>;
}
