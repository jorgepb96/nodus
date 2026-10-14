import type {ResearchAttachment} from '@shared/researchAttachments';
import type {ResearchContextSelection} from '@shared/types';
export interface ResearchComposerDraft { input:string; attachments:ResearchAttachment[]; selection:ResearchContextSelection }
interface DraftStore { lastId:string|null; drafts:Record<string,ResearchComposerDraft> }
const memory=new Map<string,DraftStore>();
const key=(vaultId:string)=>`nodus.researchComposerDrafts.v1:${vaultId}`;
export function composerDraftStore(vaultId:string|null):DraftStore {
 if(!vaultId)return {lastId:null,drafts:{}};
 const cached=memory.get(vaultId);if(cached)return cached;
 let store:DraftStore={lastId:null,drafts:{}};
 try{const parsed=JSON.parse(localStorage.getItem(key(vaultId))??'null');if(parsed&&typeof parsed.drafts==='object'&&parsed.drafts)store=parsed;}catch{/* In-memory preservation remains available. */}
 memory.set(vaultId,store);return store;
}
export function rememberComposerDraft(vaultId:string|null,id:string|null,draft:ResearchComposerDraft) {
 if(!vaultId)return;
 const store=composerDraftStore(vaultId);store.lastId=id;store.drafts[id??'new']=draft;
 try{localStorage.setItem(key(vaultId),JSON.stringify(store));}catch{/* The draft still survives navigation in memory. */}
}
