import {markdownToBlockNote,validateBlockNoteDocument} from '../../shared/blockNoteDocument';
import {validWorkspaceNoteSource,WORKSPACE_NOTE_KINDS} from '../../shared/mobileWorkspaceNoteCreation';
/** New Markdown captures use the same importer as the canonical editor. An
 * existing structured document is never round-tripped through this entry point. */
export function seedWorkspaceNote(input:unknown) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Nota no válida.');
 const value=input as Record<string,unknown>;
 if(typeof value.title!=='string'||typeof value.content!=='string'||(value.kind!==undefined&&!WORKSPACE_NOTE_KINDS.includes(value.kind as typeof WORKSPACE_NOTE_KINDS[number]))||!validWorkspaceNoteSource(value.source))throw new Error('Nota no válida.');
 const nativeDocument=value.content===''?[]:validateBlockNoteDocument(markdownToBlockNote(value.content));
 const check=(blocks:typeof nativeDocument)=>{for(const block of blocks){if(['image','audio','video','file'].includes(block.type)&&typeof block.props.url==='string'&&/^(?:blob:|file:|\/|\.\.?\/)/i.test(block.props.url))throw new Error('Este archivo sólo está disponible en el dispositivo. Incorpora sus bytes al documento antes de guardarlo.');if(block.children)check(block.children);}};check(nativeDocument);
 return {...value,nativeDocument};
}
