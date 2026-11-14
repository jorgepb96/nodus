import {createHash} from 'node:crypto';
import {canonicalJson} from '../../shared/canonicalJson';
import {getDb,withVaultDatabase} from '../db/database';
import {withOwningVault} from '../vaults/vaultRegistry';
import {getNotesTree,getNote,getNoteFolder,createNoteFolderWithIdentity,renameNoteFolder,trashNoteFolder,moveNote,patchNoteTags,restoreNotes} from '../db/notesRepo';
import {invalidateLiveCorpus} from './liveCorpus';

export class WorkspaceOrganizationFailure extends Error {
  constructor(public readonly code:string,public readonly remote?:unknown){super(code);}
}
export function workspaceOrganizationFailureResponse(error:unknown){
 if(!(error instanceof WorkspaceOrganizationFailure))return undefined;
 return {status:error.code.endsWith('conflict')||error.code.endsWith('unavailable')?409:error.code==='workspace_edit_too_large'?413:400,body:{error:error.code,...(error.remote?{remote:error.remote}:{})}};
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Row=Record<string,unknown>;
export function workspaceFolderAncestry(id:string|null,tree=getNotesTree(true)):unknown[]{
 const rows:unknown[]=[],seen=new Set<string>();
 while(id){if(seen.has(id)||seen.size>=256)throw new WorkspaceOrganizationFailure('placement_unavailable');seen.add(id);const folder=tree.folders.find(f=>f.id===id);if(!folder)throw new WorkspaceOrganizationFailure('placement_unavailable');rows.push({id:folder.id,parentId:folder.parentId,name:folder.name});id=folder.parentId;}
 return rows;
}
export function workspaceFolderSubtree(id:string,tree=getNotesTree(true)){
 const ids=new Set([id]);for(let i=0;i<=tree.folders.length;i++){let changed=false;for(const f of tree.folders)if(f.parentId&&ids.has(f.parentId)&&!ids.has(f.id)){ids.add(f.id);changed=true;}if(!changed)break;}
 if(!tree.folders.some(f=>f.id===id))throw new WorkspaceOrganizationFailure('folder_unavailable');
 return {folders:tree.folders.filter(f=>ids.has(f.id)).map(f=>({id:f.id,parentId:f.parentId,name:f.name})).sort((a,b)=>a.id.localeCompare(b.id)),notes:tree.notes.filter(n=>n.folderId&&ids.has(n.folderId)).map(n=>({id:n.id,folderId:n.folderId,trashedAt:n.trashedAt})).sort((a,b)=>a.id.localeCompare(b.id))};
}
export function mobileWorkspaceOrganizationTree(){
 const tree=getNotesTree(true);
 return {mobileOrganizationComplete:true,folders:tree.folders.map(f=>({id:f.id,parentId:f.parentId,name:f.name,summary:f.summary,orderIdx:f.orderIdx,createdAt:f.createdAt,updatedAt:f.updatedAt})),notes:tree.notes.map(n=>({id:n.id,title:n.title,kind:n.kind,folderId:n.folderId,tags:n.tags,trashedAt:n.trashedAt,orderIdx:n.orderIdx,createdAt:n.createdAt,updatedAt:n.updatedAt}))};
}
function exact(a:unknown,b:unknown,_remote:unknown){if(canonicalJson(a)!==canonicalJson(b))throw new WorkspaceOrganizationFailure('organization_conflict',mobileWorkspaceOrganizationTree());}
/** Metadata-only commands never enter the full/native editor save path. */
export async function applyWorkspaceOrganization(vaultId:string,grantId:string,raw:unknown):Promise<unknown>{
 if(Buffer.byteLength(JSON.stringify(raw),'utf8')>32*1024*1024)throw new WorkspaceOrganizationFailure('workspace_edit_too_large');
 const packet=raw as Row,command=packet?.command as Row;
 if(!packet||typeof packet!=='object'||Array.isArray(packet)||Object.keys(packet).some(k=>!['id','noteId','input','command'].includes(k))||!uuid.test(String(packet.id))||!command||typeof command!=='object'||Array.isArray(command)||Object.keys(command).some(k=>!['action','operation'].includes(k))||command.action!=='workspaceOrganization'||!packet.input||typeof packet.input!=='object'||Array.isArray(packet.input)||Object.keys(packet.input).length)throw new WorkspaceOrganizationFailure('invalid_workspace_organization');
 const op=command.operation as Row,type=op?.type;
 const keys:Record<string,string[]>={move:['type','id','expectedFolderId','targetFolderId','targetAncestry'],tags:['type','id','add','remove'],restore:['type','id','expectedTrashedAt','expectedFolderId'],folderCreate:['type','id','name','parentId','parentAncestry'],folderRename:['type','id','expectedName','name'],folderTrash:['type','id','expectedSubtree']};
 if(typeof type!=='string'||!keys[type]||!op||(Object.keys(op).some(k=>!keys[type].includes(k))||keys[type].some(k=>!(k in op)))||typeof op.id!=='string'||!op.id||op.id.length>128||packet.noteId!==op.id)throw new WorkspaceOrganizationFailure('invalid_workspace_organization');
 if(['folderCreate','folderRename'].includes(type)&&(typeof op.name!=='string'||!op.name.trim()||op.name.length>4096))throw new WorkspaceOrganizationFailure('invalid_workspace_organization');
 for(const k of ['parentId','targetFolderId','expectedFolderId'])if(k in op&&op[k]!==null&&(typeof op[k]!=='string'||!op[k]||String(op[k]).length>128))throw new WorkspaceOrganizationFailure('invalid_workspace_organization');
 if(type==='tags'&&(['add','remove'].some(k=>!Array.isArray(op[k])||(op[k] as unknown[]).length>100||(op[k] as unknown[]).some(t=>typeof t!=='string'||t.length>80))))throw new WorkspaceOrganizationFailure('invalid_workspace_organization');
 const hash=createHash('sha256').update(canonicalJson({noteId:packet.noteId,command})).digest('hex');
 const result=await withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>{
 const db=getDb();db.exec('CREATE TABLE IF NOT EXISTS desktop_workspace_organization_receipts (grant_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(grant_id,request_id))');
 return db.transaction(()=>{
 const old=db.prepare('SELECT payload_hash,result_json FROM desktop_workspace_organization_receipts WHERE grant_id=? AND request_id=?').get(grantId,packet.id) as {payload_hash:string,result_json:string}|undefined;if(old){if(old.payload_hash!==hash)throw new WorkspaceOrganizationFailure('idempotency_conflict');return JSON.parse(old.result_json);}
 const tree=getNotesTree(true);let value:unknown;
 if(type==='folderCreate'){if(!uuid.test(op.id as string)||getNoteFolder(op.id as string))throw new WorkspaceOrganizationFailure('identity_conflict');exact(workspaceFolderAncestry(op.parentId as string|null,tree),op.parentAncestry,tree);value=createNoteFolderWithIdentity({name:op.name as string,parentId:op.parentId as string|null},op.id as string);}
 else if(type==='folderRename'){const folder=getNoteFolder(op.id as string);if(!folder)throw new WorkspaceOrganizationFailure('folder_unavailable',mobileWorkspaceOrganizationTree());exact(folder.name,op.expectedName,tree);value=renameNoteFolder(folder.id,op.name as string);}
 else if(type==='folderTrash'){exact(workspaceFolderSubtree(op.id as string,tree),op.expectedSubtree,tree);value=trashNoteFolder(op.id as string);}
 else{const note=getNote(op.id as string);if(!note)throw new WorkspaceOrganizationFailure('document_unavailable',mobileWorkspaceOrganizationTree());
 if(type==='restore'){if(typeof op.expectedTrashedAt!=='string'||!op.expectedTrashedAt)throw new WorkspaceOrganizationFailure('invalid_workspace_organization');exact({trashedAt:note.trashedAt,folderId:note.folderId},{trashedAt:op.expectedTrashedAt,folderId:op.expectedFolderId},tree);value=restoreNotes([note.id]);}
 else{if(note.trashedAt)throw new WorkspaceOrganizationFailure('document_unavailable',mobileWorkspaceOrganizationTree());if(type==='move'){exact(note.folderId,op.expectedFolderId,tree);exact(workspaceFolderAncestry(op.targetFolderId as string|null,tree),op.targetAncestry,tree);value=moveNote(note.id,op.targetFolderId as string|null);}else value=patchNoteTags([note.id],{add:op.add as string[],remove:op.remove as string[]});}}
 const snapshot=mobileWorkspaceOrganizationTree();
 const affected=type==='folderTrash'?value as string[]:[op.id as string];
 const changedTree={folders:snapshot.folders.filter(f=>f.id===op.id),notes:snapshot.notes.filter(n=>affected.includes(n.id))};
 const result=type==='move'?changedTree.notes[0]:type==='tags'?changedTree.notes:value;
 const response={result,tree:changedTree};db.prepare('INSERT INTO desktop_workspace_organization_receipts VALUES(?,?,?,?)').run(grantId,packet.id,hash,JSON.stringify(response));return response;
 })();}));await invalidateLiveCorpus(vaultId);return result;
}
