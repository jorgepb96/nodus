import type {NoteSource} from './types';
export const WORKSPACE_NOTE_KINDS = ['markdown','assistant','writing','debate','idea','hypothesis'] as const;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const optionalString=(value:unknown)=>value===undefined||value===null||typeof value==='string';
/** Provenance is data, never an instruction to run a provider or indexer. Keep
 * the entire canonical source, including structured chat citations and model
 * assignment metadata, rather than reconstructing a reduced mobile variant. */
export function validWorkspaceNoteSource(value:unknown):value is NoteSource|null|undefined {
 if(value===undefined||value===null)return true;
 if(!object(value)||!WORKSPACE_NOTE_KINDS.includes(value.origin as typeof WORKSPACE_NOTE_KINDS[number])||Object.keys(value).some(key=>!['origin','model','ref','note','authoredOn','researchChat'].includes(key))||!optionalString(value.ref)||!optionalString(value.note)||(value.authoredOn!==undefined&&value.authoredOn!=='mobile'))return false;
 if(value.model!==undefined&&value.model!==null){const m=value.model;if(!object(m)||typeof m.provider!=='string'||!m.provider||typeof m.model!=='string'||!m.model||(m.pending!==undefined&&typeof m.pending!=='boolean')||(m.reasoningEffort!==undefined&&typeof m.reasoningEffort!=='string')||Object.keys(m).some(key=>!['provider','model','pending','reasoningEffort'].includes(key)))return false;}
 if(value.researchChat!==undefined&&value.researchChat!==null){const chat=value.researchChat;if(!object(chat)||!['research','database','study','world'].includes(String(chat.surface))||!['conversationId','conversationTitle','messageId'].every(key=>typeof chat[key]==='string')||(chat.messageIndex!==undefined&&chat.messageIndex!==null&&(!Number.isSafeInteger(chat.messageIndex)||Number(chat.messageIndex)<0))||!Array.isArray(chat.references)||Object.keys(chat).some(key=>!['surface','conversationId','conversationTitle','messageId','messageIndex','references'].includes(key)))return false;
  if(!chat.references.every(ref=>object(ref)&&typeof ref.label==='string'&&['citationId','subtitle','quote','href'].every(key=>optionalString(ref[key]))&&Object.keys(ref).every(key=>['citationId','label','subtitle','quote','href'].includes(key))))return false;
 }
 return true;
}
