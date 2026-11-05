import {markdownToBlockNote,validateBlockNoteDocument} from '../../shared/blockNoteDocument';
/** The same importer as StudyEditor: only new Markdown copies are converted.
 * Existing structured documents never pass through a Markdown round trip. */
export function seedStudyKnowledgeNote(input:unknown) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Apunte no válido.');
 const value=input as Record<string,unknown>;
 if(typeof value.contentMarkdown!=='string')throw new Error('Falta el contenido del apunte.');
 return {...value,nativeDocument:validateBlockNoteDocument(markdownToBlockNote(value.contentMarkdown))};
}
