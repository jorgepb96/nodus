import { createHash } from 'node:crypto';
import { canonicalJson } from '../../shared/canonicalJson';
import { MOBILE_CHAT_MAX_BYTES, type MobileChatDocument, type MobileChatEdit, type MobileChatKind,type MobileChatOrganisation,type MobileChatPlacement } from '../../shared/mobileChatHistory';
import { getDb, withVaultDatabase } from '../db/database';
import { getActiveVault, withOwningVault } from '../vaults/vaultRegistry';
import * as research from '../db/chatRepo';
import * as world from '../db/worldChatRepo';
import * as database from '../db/databaseChatRepo';
import {getDatabase} from '../db/databasesRepo';
import { getStudyAssistantConversation, listStudyAssistantConversations } from '../ai/studyAssistant';
import { readStudyChatStore, writeStudyChatStore, type StudyAssistantStore } from '../ai/studyChatHistory';
import type { StudyAssistantMessage } from '../../shared/studyAssistant';
import { deleteResearchAttachments } from '../researchAttachments';
import { chatAssetOwner,deleteChatAssets } from '../chatAssets';
import { withMobileOperation } from './executionBoundary';
import {normalizeMobileStudyChatOptions} from '../../shared/mobileStudyChat';
import {verifyStudyChatCitation} from './studyChatEvidence';
import * as researchOrganisation from '../db/researchChatProjectsRepo';
import {listResearchNotebooks,getResearchNotebook,associateNotebookConversation} from '../db/researchNotebooksRepo';
import {RESEARCH_CHAT_PIN_LIMIT} from '../../shared/types';
import {listResearchAttachments} from '../researchAttachments';

export class MobileChatFailure extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly remote?: MobileChatDocument) { super(code); }
}
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);
const identity = (value: unknown): value is string => typeof value === 'string' && /^[\p{L}\p{N}_-]{1,256}$/u.test(value);
const hash = (value: unknown) => typeof value === 'string' && /^[a-f\d]{64}$/.test(value);
function assertKind(kind: string): asserts kind is MobileChatKind {
  const type = getActiveVault().type;
  const expected = type === 'worldbuilding' ? 'world' : type === 'databases' ? 'database' : ['estudio','docencia'].includes(type) ? 'study' : 'research';
  if (kind !== expected) throw new MobileChatFailure(403,'chat_kind_forbidden');
}
function ensureTables() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS mobile_chat_companions (kind TEXT NOT NULL, conversation_id TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(kind,conversation_id));
    CREATE TABLE IF NOT EXISTS mobile_chat_receipts (grant_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY(grant_id,request_id));`);
}
function organisation(kind:MobileChatKind,store?:StudyAssistantStore):MobileChatOrganisation {
  const study=kind==='study'?(store??readStudyChatStore()):null;
  const organizer=kind==='world'?world.worldChatOrganizer:kind==='database'?database.databaseChatOrganizer:researchOrganisation;
  const projects=study?study.projects:organizer.listChatProjects(),folders=study?study.folders:organizer.listChatProjectFolders();
  const notebooks=kind==='study'?[]:kind==='research'?listResearchNotebooks():(kind==='world'?world.worldChatOrganizer:database.databaseChatOrganizer).listChatNotebooks();
  return {version:1,kind,projects:projects.map(({id,name,instructions})=>({id,name,instructions:instructions??''})),folders:folders.map(({id,projectId,parentId,name,position})=>({id,projectId,parentId,name,position})),notebooks:notebooks.map(({id,name})=>({id,name}))};
}
function validatePlacement(raw:unknown,kind:MobileChatKind):asserts raw is MobileChatPlacement {
  if(!object(raw)||Object.keys(raw).some(key=>!['projectId','folderId','notebookId','pinned'].includes(key))||typeof raw.pinned!=='boolean'||[raw.projectId,raw.folderId,raw.notebookId].some(id=>id!==null&&!identity(id)))throw new MobileChatFailure(400,'invalid_chat_placement');
  // Surface-local identity; an ID that belongs to a different chat family is
  // never accepted simply because it is a valid UUID in this vault.
  const available=organisation(kind);
  if(raw.projectId&&!available.projects.some(row=>row.id===raw.projectId)||raw.folderId&&!available.folders.some(row=>row.id===raw.folderId&&row.projectId===raw.projectId)||raw.notebookId&&!available.notebooks.some(row=>row.id===raw.notebookId)||raw.notebookId&&kind!=='research'&&(raw.projectId||raw.folderId))throw new MobileChatFailure(409,'chat_placement_unavailable');
}
function savePlacement(kind:Exclude<MobileChatKind,'study'>,id:string,value:MobileChatPlacement,archived:boolean) {
  const organizer=kind==='world'?world.worldChatOrganizer:kind==='database'?database.databaseChatOrganizer:researchOrganisation;
  organizer.setConversationProject(id,value.projectId);organizer.setConversationFolder(id,value.folderId);
  if(kind==='research') {if(value.notebookId&&!getResearchNotebook(value.notebookId))throw new MobileChatFailure(409,'chat_placement_unavailable');associateNotebookConversation(value.notebookId,id);}
  else (kind==='world'?world.worldChatOrganizer:database.databaseChatOrganizer).setConversationNotebook(id,value.notebookId);
  try {organizer.setConversationPinned(id,archived?false:value.pinned);}catch(error){if(error instanceof Error&&error.message==='research_chat_pin_limit')throw new MobileChatFailure(409,'chat_pin_limit');throw error;}
}
function rawConversation(kind: MobileChatKind,id: string): Record<string,unknown> | null {
  const value = kind === 'research' ? research.getConversation(id) : kind === 'world' ? world.getWorldChatConversation(id) : kind === 'database' ? database.getDatabaseChatConversation(id) : getStudyAssistantConversation(id);
  return value ? value as unknown as Record<string,unknown> : null;
}
export function mobileChatAssetOwner(kind:string,id:string,domains:readonly string[]) {
  assertKind(kind);
  if(!domains.includes('corpus')||!identity(id))throw new MobileChatFailure(403,'permission_denied');
  const data=rawConversation(kind,id);if(!data)throw new MobileChatFailure(404,'chat_unavailable');
  const protectedRecording=kind==='study'&&Array.isArray(data.messages)&&data.messages.some(message=>object(message)&&(String(message.content).includes('nodus://study/recording/')||Array.isArray(message.citations)&&message.citations.some(citation=>object(citation)&&citation.kind==='transcript')));
  if(protectedRecording&&!domains.includes('study-recordings'))throw new MobileChatFailure(403,'permission_denied');
  const surface={research:'assistant',world:'world-assistant',database:'database',study:'study'}[kind];
  return {owner:chatAssetOwner(surface,id,getActiveVault().id),data,requiredDomains:['corpus',...(protectedRecording?['study-recordings']:[])]};
}
function snapshot(kind: MobileChatKind,id: string,store?: StudyAssistantStore): MobileChatDocument {
  const data = rawConversation(kind,id);
  if (!data) throw new MobileChatFailure(404,'chat_unavailable');
  const companion = kind === 'study' ? (store ?? readStudyChatStore()).mobileCompanion?.documents[id] ?? null : (() => {
    ensureTables();
    const row = getDb().prepare('SELECT data_json FROM mobile_chat_companions WHERE kind=? AND conversation_id=?').get(kind,id) as {data_json:string}|undefined;
    return row ? JSON.parse(row.data_json) as Record<string,unknown> : null;
  })();
  const value = {kind,id,data,companion};
  return {version:1,...value,revision:digest(value)};
}
export async function readMobileChat(vaultId: string,kind: string,id: string,domains: readonly string[]) {
  return withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>withMobileOperation(()=>{
    assertKind(kind);if (!id || id.length > 256) throw new MobileChatFailure(400,'invalid_chat');
    mobileChatAssetOwner(kind,id,domains);
    const result = snapshot(kind,id);
    if (Buffer.byteLength(JSON.stringify(result),'utf8') > MOBILE_CHAT_MAX_BYTES) throw new MobileChatFailure(413,'chat_too_large');
    return result;
  },domains)));
}
/** A complete catalogue uses small metadata pages. The revision detects changes
 * during paging instead of silently skipping/repeating newly updated chats. */
export async function listMobileChats(vaultId: string,kind: string,cursor: number,domains: readonly string[],expected?: string) {
  return withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>withMobileOperation(()=>{
    assertKind(kind);
    const rows = kind === 'research' ? research.listConversations(true) : kind === 'world' ? world.listWorldChatConversations(true) : kind === 'database' ? database.listDatabaseChatConversations(true) : listStudyAssistantConversations(true);
    const catalogue=organisation(kind),revision = digest({rows,organisation:catalogue});
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new MobileChatFailure(400,'invalid_chat_cursor');
    if (expected && expected !== revision) throw new MobileChatFailure(409,'chat_catalogue_changed');
    if(Buffer.byteLength(JSON.stringify(catalogue),'utf8')>8*1024*1024)throw new MobileChatFailure(413,'chat_organisation_too_large');
    return {version:1,kind,revision,...(cursor===0?{organisation:catalogue}:{}),rows:rows.slice(cursor,cursor+100),cursor:cursor+Math.min(100,Math.max(0,rows.length-cursor)),hasMore:cursor+100<rows.length};
  },domains)));
}
function validate(raw: unknown,current: MobileChatDocument | null,kind: MobileChatKind,trustedMessage?:{id:string;role:'user'|'assistant'}): MobileChatEdit {
  if (Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8') > MOBILE_CHAT_MAX_BYTES) throw new MobileChatFailure(413,'chat_too_large');
  if (!object(raw) || raw.version !== 1 || !uuid(raw.id) || !identity(raw.conversationId) ||
      raw.expectedRevision !== null && !hash(raw.expectedRevision) || !['save','delete'].includes(String(raw.action)) ||
      Object.keys(raw).some(key=>!['version','id','conversationId','expectedRevision','action','draft','companion'].includes(key))) throw new MobileChatFailure(400,'invalid_chat_edit');
  if (raw.action === 'delete') {
    if (raw.draft !== undefined || raw.companion !== undefined) throw new MobileChatFailure(400,'invalid_chat_edit');
    return raw as unknown as MobileChatEdit;
  }
  if(raw.expectedRevision===null&&!uuid(raw.conversationId)) throw new MobileChatFailure(400,'invalid_chat_creation');
  const draft = raw.draft;
  if (!object(draft) || Object.keys(draft).some(key=>!['title','archived','messages','databaseIds','study','studyEvidence','world','placement'].includes(key)) || typeof draft.title !== 'string' || draft.title.length > 4096 || typeof draft.archived !== 'boolean' || !Array.isArray(draft.messages) || draft.messages.length > 100_000 || raw.companion != null && !object(raw.companion)) throw new MobileChatFailure(400,'invalid_chat_edit');
  if(draft.placement!==undefined)validatePlacement(draft.placement,kind);
  if(draft.databaseIds!==undefined && (kind!=='database'||!Array.isArray(draft.databaseIds)||draft.databaseIds.length>30||new Set(draft.databaseIds).size!==draft.databaseIds.length||draft.databaseIds.some(id=>typeof id!=='string'||!getDatabase(id))))throw new MobileChatFailure(400,'invalid_chat_database_selection');
  if(draft.study!==undefined){if(kind!=='study')throw new MobileChatFailure(400,'invalid_study_chat_options');try{normalizeMobileStudyChatOptions(draft.study as Parameters<typeof normalizeMobileStudyChatOptions>[0]);}catch{throw new MobileChatFailure(400,'invalid_study_chat_options');}}
  if(draft.studyEvidence!==undefined&&(kind!=='study'||!object(draft.studyEvidence)))throw new MobileChatFailure(400,'invalid_study_chat_evidence');
  if(draft.world!==undefined){
    const value=draft.world,selection=object(value)?value.selection:null;
    if(kind!=='world'||!object(value)||Object.keys(value).some(key=>!['selection','focus'].includes(key))||!object(selection)||Object.keys(selection).some(key=>!['scope','entryKeys','keepFocus'].includes(key))||!['auto','manual'].includes(String(selection.scope))||typeof selection.keepFocus!=='boolean'||!Array.isArray(selection.entryKeys)||selection.entryKeys.length>100||new Set(selection.entryKeys).size!==selection.entryKeys.length||selection.entryKeys.some(key=>typeof key!=='string'||key.length>512)||!Array.isArray(value.focus)||value.focus.length>6||value.focus.some(ref=>!object(ref)||Object.keys(ref).some(key=>!['kind','id','title'].includes(key))||typeof ref.kind!=='string'||typeof ref.id!=='string'||typeof ref.title!=='string'||ref.id.length>256||ref.title.length>4096))throw new MobileChatFailure(400,'invalid_world_chat_selection');
  }
  const old = Array.isArray(current?.data.messages) ? current!.data.messages as Array<Record<string,unknown>> : [];
  const ids = new Set<string>();
  draft.messages.forEach((message,index)=>{
    if (!object(message) || !['user','assistant'].includes(String(message.role)) || typeof message.content !== 'string') throw new MobileChatFailure(400,'invalid_chat_message');
    if(message.createdAt!==undefined&&(typeof message.createdAt!=='string'||message.createdAt.length>64||!Number.isFinite(Date.parse(message.createdAt))))throw new MobileChatFailure(400,'invalid_chat_message_date');
    if (message.id !== undefined) {
      if (typeof message.id !== 'string' || !message.id || message.id.length > 256 || ids.has(message.id)) throw new MobileChatFailure(400,'invalid_chat_message');
      ids.add(message.id);
    }
    // Rich Desktop attachments, citations, tool/Concilium output and scope are
    // immutable on this portable lane. Native authored additions contain text;
    // unchanged rich turns retain their exact original record and assets.
    const original = message.id ? old.find(item=>item.id===message.id) : old[index];
    // The closed Mac stream adapter supplies only its own generated reply ID.
    // This permission is never a wire field or part of the public edit endpoint.
    if(trustedMessage&&message.id===trustedMessage.id&&message.role===trustedMessage.role)return;
    const rich = (item:Record<string,unknown>)=>Object.fromEntries(Object.entries(item).filter(([key])=>!['id','role','content','createdAt','error','interrupted'].includes(key)));
    if(!original&&kind==='study'&&Array.isArray(message.citations)) {
      if(message.role!=='assistant'||!uuid(message.id)||Object.keys(rich(message)).some(key=>key!=='citations'))throw new MobileChatFailure(400,'chat_rich_turn_changed');
      const question=[...draft.messages.slice(0,index)].reverse().find(item=>object(item)&&item.role==='user');
      const proofs=object(draft.studyEvidence)?draft.studyEvidence[message.id]:undefined;
      const cited=new Set<string>();
      for(const citation of message.citations) {
        if(!object(citation)||typeof citation.id!=='string'||cited.has(citation.id)||!object(proofs)||!object(proofs[citation.id])||!question||!verifyStudyChatCitation(citation as unknown as Parameters<typeof verifyStudyChatCitation>[0],proofs[citation.id] as unknown as Parameters<typeof verifyStudyChatCitation>[1],String(question.content)))throw new MobileChatFailure(400,'invalid_study_chat_evidence');
        cited.add(citation.id);
      }
    } else if (Object.keys(rich(message)).length && (!original || canonicalJson(rich(original)) !== canonicalJson(rich(message)))) throw new MobileChatFailure(400,'chat_rich_turn_changed');
    if (original && canonicalJson(rich(original)) !== canonicalJson(rich(message))) throw new MobileChatFailure(400,'chat_rich_turn_changed');
  });
  return raw as unknown as MobileChatEdit;
}
function createSQL(kind: Exclude<MobileChatKind,'study'>,id: string,title: string) {
  const now = new Date().toISOString(),db=getDb();
  if (kind==='research') db.prepare('INSERT INTO chat_conversations (id,title,created_at,updated_at,archived,model_json,selection_json) VALUES(?,?,?,?,0,NULL,NULL)').run(id,title,now,now);
  else if(kind==='world') db.prepare('INSERT INTO world_chat_conversations (id,title,selection_json,focus_json,messages_json,model_json,created_at,updated_at) VALUES(?,?,?,?,?,NULL,?,?)').run(id,title,'{"scope":"auto","entryKeys":[],"keepFocus":false}','[]','[]',now,now);
  else db.prepare('INSERT INTO database_chat_conversations (id,title,database_ids_json,messages_json,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,title,'[]','[]',now,now);
}
type GeneratedMetadata={model?:import('../../shared/types').ModelRef|null;selection?:import('../../shared/types').ResearchContextSelection};
function saveSQL(kind: Exclude<MobileChatKind,'study'>,request: MobileChatEdit,metadata?:GeneratedMetadata) {
  const id=request.conversationId,draft=request.draft!,data=rawConversation(kind,id)!;
  if(kind==='research') { research.saveMessages(id,draft.messages as unknown as Parameters<typeof research.saveMessages>[1],metadata);research.renameConversation(id,draft.title);research.setArchived(id,draft.archived); }
  else if(kind==='world') { world.saveWorldChatConversation(id,draft.messages as unknown as Parameters<typeof world.saveWorldChatConversation>[1],draft.world?.selection??data.selection as Parameters<typeof world.saveWorldChatConversation>[2],draft.world?.focus??data.focus as Parameters<typeof world.saveWorldChatConversation>[3],(metadata?.model??data.model) as Parameters<typeof world.saveWorldChatConversation>[4]);world.renameWorldChatConversation(id,draft.title);world.setWorldChatConversationArchived(id,draft.archived); }
  else { database.saveDatabaseChatConversation(id,draft.messages as unknown as Parameters<typeof database.saveDatabaseChatConversation>[1],draft.databaseIds ?? data.databaseIds as string[]);database.renameDatabaseChatConversation(id,draft.title);database.setDatabaseChatConversationArchived(id,draft.archived); }
  if(draft.placement)savePlacement(kind,id,draft.placement,draft.archived);
}
/** Receipts and data commit in one SQLite transaction (or one study-history
 * atomic file replacement). A lost ACK never re-applies a later edited chat. */
export function saveMobileChat(vaultId:string,grantId:string,kind:string,raw:unknown,domains:readonly string[]) {
  return saveMobileChatInternal(vaultId,grantId,kind,raw,domains);
}
export function saveMacGeneratedChatReply(vaultId:string,grantId:string,kind:string,raw:MobileChatEdit,domains:readonly string[],replyId:string,metadata?:GeneratedMetadata) {
  if(!uuid(replyId)||!raw.draft?.messages.some(message=>message.id===replyId&&message.role==='assistant'))throw new MobileChatFailure(400,'invalid_generated_reply');
  return saveMobileChatInternal(vaultId,grantId,kind,raw,domains,{id:replyId,role:'assistant'},metadata);
}
/** Attach only actual stored records owned by this chat, after the ordinary
 * question acknowledgement. A native request cannot forge their metadata. */
export async function saveMacStoredQuestionAttachments(vaultId:string,grantId:string,kind:MobileChatKind,raw:MobileChatEdit,domains:readonly string[],questionId:string,ids:string[]) {
  return withOwningVault(vaultId,()=>withVaultDatabase(vaultId,async()=>{
    assertKind(kind);
    if(!domains.includes('corpus')||!domains.includes('writing')||!uuid(questionId)||new Set(ids).size!==ids.length)throw new MobileChatFailure(403,'permission_denied');
    const stored=listResearchAttachments({surface:kind,conversationId:raw.conversationId});
    const selected=ids.map(id=>{const attachment=stored.find(item=>item.id===id);if(!attachment)throw new MobileChatFailure(404,'chat_attachment_unavailable');return attachment;});
    const draft=raw.draft;
    if(!draft||!draft.messages.some(message=>message.id===questionId&&message.role==='user'))throw new MobileChatFailure(400,'invalid_live_chat_question');
    const edit={...raw,draft:{...draft,messages:draft.messages.map(message=>message.id===questionId?{...message,attachments:selected}:message)}};
    return saveMobileChatInternal(vaultId,grantId,kind,edit,domains,{id:questionId,role:'user'});
  }));
}
async function saveMobileChatInternal(vaultId: string,grantId: string,kind: string,raw: unknown,domains: readonly string[],trustedMessage?:{id:string;role:'user'|'assistant'},metadata?:GeneratedMetadata) {
  return withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>withMobileOperation(()=>{
    assertKind(kind);
    if(!domains.includes('corpus')||!domains.includes('writing')) throw new MobileChatFailure(403,'permission_denied');
    // Validate the outer identity before receipt lookup; large hostile inputs do
    // not evade limits through an already acknowledged request identity.
    if(!object(raw)||!uuid(raw.id)||!identity(raw.conversationId)||Buffer.byteLength(JSON.stringify(raw),'utf8')>MOBILE_CHAT_MAX_BYTES) throw new MobileChatFailure(400,'invalid_chat_edit');
    const payload = digest({kind,raw}),receiptKey=`${grantId}:${raw.id}`;
    const apply=(store?:StudyAssistantStore)=>{
      const previous = kind==='study' ? store!.mobileCompanion?.receipts[receiptKey] : getDb().prepare('SELECT payload_hash AS hash,result_json AS json FROM mobile_chat_receipts WHERE grant_id=? AND request_id=?').get(grantId,raw.id) as {hash:string;json:string}|undefined;
      if(previous) {
        if(previous.hash!==payload) throw new MobileChatFailure(409,'idempotency_conflict');
        return JSON.parse(previous.json) as {id:string;snapshot?:MobileChatDocument;deleted?:boolean};
      }
      const current = rawConversation(kind,raw.conversationId) ? snapshot(kind,raw.conversationId,store) : null;
      const request=validate(raw,current,kind,trustedMessage);
      if(request.expectedRevision===null ? current!==null : !current || current.revision!==request.expectedRevision) throw new MobileChatFailure(409,'chat_revision_conflict',current ?? undefined);
      if(kind==='study' && !domains.includes('study-recordings') && request.draft?.messages.some(message=>String(message.content).includes('nodus://study/recording/') || Array.isArray(message.citations) && message.citations.some(citation=>object(citation)&&citation.kind==='transcript'))) throw new MobileChatFailure(403,'permission_denied');
      if(request.action==='delete') {
        if(kind==='study') store!.conversations=store!.conversations.filter(item=>item.id!==request.conversationId);
        else if(kind==='research') research.deleteConversation(request.conversationId);
        else if(kind==='world') world.deleteWorldChatConversation(request.conversationId);
        else database.deleteDatabaseChatConversation(request.conversationId);
      } else if(kind==='study') {
        const now=new Date().toISOString();
        const existing=store!.conversations.find(item=>item.id===request.conversationId);
        const next={...(existing ?? {id:request.conversationId,createdAt:now,selection:{scope:'library' as const,sourceKeys:[]},model:null,task:'answer' as const,level:'standard' as const,tone:'clear' as const,language:'auto' as const,allowExternalKnowledge:false,projectId:null,folderId:null,pinnedAt:null}),...(request.draft!.study??{}),...(metadata?.model?{model:metadata.model}:{}),title:request.draft!.title.trim().slice(0,120)||'Conversación sin título',archived:request.draft!.archived,messages:request.draft!.messages as unknown as StudyAssistantMessage[],messageCount:request.draft!.messages.length,updatedAt:now};
        if(request.draft!.placement) {
          const placement=request.draft!.placement;
          if(placement.pinned&&!next.archived&&!existing?.pinnedAt&&store!.conversations.filter(item=>item.id!==next.id&&item.pinnedAt&&!item.archived).length>=RESEARCH_CHAT_PIN_LIMIT)throw new MobileChatFailure(409,'chat_pin_limit');
          next.projectId=placement.projectId;next.folderId=placement.folderId;next.pinnedAt=placement.pinned&&!next.archived?existing?.pinnedAt??now:null;
        }
        if(next.archived) next.pinnedAt=null;
        store!.conversations=store!.conversations.filter(item=>item.id!==next.id);store!.conversations.push(next as StudyAssistantStore['conversations'][number]);
      } else {
        if(!current) createSQL(kind,request.conversationId,request.draft!.title);
        saveSQL(kind,request,metadata);
      }
      if(kind==='study') {
        store!.mobileCompanion ??= {documents:{},receipts:{}};
        if(request.action==='delete') delete store!.mobileCompanion.documents[request.conversationId];
        else store!.mobileCompanion.documents[request.conversationId]=request.companion ?? null;
      } else if(request.action==='delete') getDb().prepare('DELETE FROM mobile_chat_companions WHERE kind=? AND conversation_id=?').run(kind,request.conversationId);
      else getDb().prepare('INSERT OR REPLACE INTO mobile_chat_companions VALUES(?,?,?)').run(kind,request.conversationId,JSON.stringify(request.companion??null));
      // Study's just-authored state has not reached disk yet. Snapshot that same
      // in-memory record, so the acknowledgement and replacement are identical.
      const data = kind==='study' && request.action!=='delete' ? store!.conversations.find(item=>item.id===request.conversationId)! : undefined;
      const value=data ? {kind,id:request.conversationId,data:data as unknown as Record<string,unknown>,companion:store!.mobileCompanion!.documents[request.conversationId]} : undefined;
      const result={id:request.id,...(request.action==='delete'?{deleted:true}:{snapshot:value?{version:1 as const,...value,revision:digest(value)}:snapshot(kind,request.conversationId)})};
      if(kind==='study') store!.mobileCompanion!.receipts[receiptKey]={hash:payload,json:JSON.stringify(result)};
      else getDb().prepare('INSERT INTO mobile_chat_receipts VALUES(?,?,?,?)').run(grantId,request.id,payload,JSON.stringify(result));
      return result;
    };
    if(kind==='study') {
      const store=readStudyChatStore(),result=apply(store);writeStudyChatStore(store);
      // Cleanup follows the atomic authored-history/receipt commit and is
      // replayed after lost ACKs. It cannot delete a still-live conversation.
      if('deleted' in result && result.deleted) {
        deleteResearchAttachments({surface:'study',conversationId:raw.conversationId});
        deleteChatAssets(chatAssetOwner('study',raw.conversationId,getActiveVault().id));
      }
      return result;
    }
    ensureTables();return getDb().transaction(()=>apply())();
  },domains)));
}
