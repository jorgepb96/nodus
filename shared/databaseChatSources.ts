import type {DatabaseColumn,DatabaseRow,PromptLanguage} from './types';
import {computeProfile,profileToText,type DatabaseProfile} from './dataProfile';
import {buildDbChatContext,type DbChatPart} from './databaseChat';
import {decodeCheckbox,decodeMultiSelect} from './databases';

/** A compact, complete numerical profile and the same sample used on Desktop.
 * Attachment content and private filesystem locations never enter this pack. */
export interface DatabaseChatSample { id:string; cells:DatabaseRow['cells'];attachmentCounts:Record<string,number>;relationCounts:Record<string,number>; }
export interface DatabaseChatSource { databaseId:string;name:string;columns:DatabaseColumn[];profile:DatabaseProfile;sample:DatabaseChatSample[]; }
export function captureDatabaseChatSource(databaseId:string,name:string,columns:DatabaseColumn[],rows:DatabaseRow[]):DatabaseChatSource {
  return {databaseId,name,columns,profile:computeProfile(columns,rows),sample:rows.slice(0,10).map(row=>({id:row.id,cells:row.cells,attachmentCounts:Object.fromEntries(Object.entries(row.attachments??{}).map(([id,files])=>[id,files.length])),relationCounts:row.relationCounts??{}}))};
}
/**
 * The sample only has to show what a row looks like — the profile is what answers questions —
 * so it stays small enough to leave the profile the bulk of the context. Ollama runs models at
 * a 4096-token window by default and silently drops the overflow, so a context that fits it is
 * the difference between the chat working out of the box on a local model and refusing.
 */
const SAMPLE_ROWS = 10;
const SAMPLE_COLS = 8;
/**
 * Longest a single value may be in the sample. Rows and columns were already bounded, but a
 * cell was not: one `Descripcion visual` in a real catalogue runs to 3k characters, so 15
 * rows became ~24k of a 27k context. That buried the profile the answers are supposed to come
 * from, pushed the whole prompt past a local model's window, and left the model answering
 * "15 rows" for a 7k-row table from the only thing it could still see. The sample exists to
 * show the shape of a row, and a clipped value shows that just as well.
 */
const SAMPLE_VALUE_CHARS = 120;

const clip = (v: string) => (v.length > SAMPLE_VALUE_CHARS ? `${v.slice(0, SAMPLE_VALUE_CHARS).trimEnd()}…` : v);

/** One compact line per row: "col: value; …" resolving option labels. */
function sampleText(columns: DatabaseColumn[], rows: DatabaseChatSample[], language: PromptLanguage = 'es'): string {
  const booleanCopy = {
    es: ['sí', 'no'], en: ['yes', 'no'], fr: ['oui', 'non'], de: ['ja', 'nein'],
    pt: ['sim', 'não'], 'pt-BR': ['sim', 'não'], it: ['sì', 'no'], tr: ['evet', 'hayır'],
    'zh-Hans': ['是', '否'], 'zh-Hant': ['是', '否'], vi: ['có', 'không'], ja: ['はい', 'いいえ'],
    ru: ['да', 'нет'], uk: ['так', 'ні'], ko: ['예', '아니요'],
  } as const;
  const [yes, no] = booleanCopy[language] ?? booleanCopy.es;
  const cols = columns.filter((c) => c.type !== 'ai').slice(0, SAMPLE_COLS);
  return rows
    .slice(0, SAMPLE_ROWS)
    .map((row, i) => {
      const parts = cols
        .map((col) => {
          const raw = row.cells[col.id] ?? null;
          let v = '';
          if (col.type === 'select' || col.type === 'status') v = col.options.find((o) => o.id === raw)?.label ?? '';
          else if (col.type === 'multi_select')
            v = decodeMultiSelect(raw)
              .map((id) => col.options.find((o) => o.id === id)?.label ?? '')
              .filter(Boolean)
              .join('/');
          else if (col.type === 'checkbox') v = decodeCheckbox(raw) ? yes : no;
          else if (col.type === 'attachment' || col.type === 'files') v = String(row.attachmentCounts[col.id] ?? 0);
          else if (col.type === 'relation') v = String(row.relationCounts?.[col.id] ?? 0);
          else v = raw ?? '';
          return v && v.trim() ? `${col.name}: ${clip(v.trim())}` : '';
        })
        .filter(Boolean);
      return `${i + 1}. ${parts.join('; ')}`;
    })
    .join('\n');
}


/** Byte-for-byte profile/sample composition is shared by linked and device chat. */
export function composeDatabaseChatSources(sources:DatabaseChatSource[],language:PromptLanguage='es'):{context:string;names:string[]} {
  const parts:DbChatPart[]=sources.map(source=>({name:source.name,profileText:profileToText(source.name,source.profile,language),sample:sampleText(source.columns,source.sample,language),rowCount:source.profile.rowCount,sampleSize:source.sample.length}));
  return {context:buildDbChatContext(parts,language),names:sources.map(source=>source.name)};
}
