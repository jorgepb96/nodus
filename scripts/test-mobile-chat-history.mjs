import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-chat-history'))process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-chat-history-'));
const runtime=installRuntimeHooks(directory);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),fetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Chat synchronization must never invoke a model');};
let db;
try {
  db=require('../electron/db/database.ts');db.getDb();
  const vaults=require('../electron/vaults/vaultRegistry.ts'),api=require('../electron/desktopBridge/chatHistory.ts');
  const research=require('../electron/db/chatRepo.ts'),world=require('../electron/db/worldChatRepo.ts'),data=require('../electron/db/databaseChatRepo.ts'),study=require('../electron/ai/studyAssistant.ts');
  const studyStore=require('../electron/ai/studyChatHistory.ts');
  const projects=require('../electron/db/researchChatProjectsRepo.ts'),notebooks=require('../electron/db/researchNotebooksRepo.ts');
  const domains=['corpus','writing','study-recordings'];
  const inVault=(id,work)=>vaults.withOwningVault(id,()=>db.withVaultDatabase(id,work));
  const cases=[['research','academic'],['world','worldbuilding'],['database','databases'],['study','estudio'],['study','docencia']];
  for(const [kind,type] of cases) {
    const vault=vaults.createVault(`Historial aislado ${type}`,type),grant=randomUUID();
    await inVault(vault.id,async()=>{
      const organizer=kind==='world'?world.worldChatOrganizer:kind==='database'?data.databaseChatOrganizer:projects;
      const createProject=input=>kind==='study'?studyStore.createStudyChatProject(input):organizer.createChatProject(input);
      const createFolder=input=>kind==='study'?studyStore.createStudyChatFolder(input):organizer.createChatProjectFolder(input);
      const project=createProject({name:'Proyecto 🌊',instructions:'Compara fuentes sin convertir preferencias en evidencia.'}),foreignProject=createProject({name:'Otro proyecto'});
      const parent=createFolder({projectId:project.id,name:'Material'}),folder=createFolder({projectId:project.id,parentId:parent.id,name:'Lecturas'}),foreignFolder=createFolder({projectId:foreignProject.id,name:'Fuera'});
      const notebook=kind==='study'?null:kind==='research'?notebooks.saveResearchNotebook({name:'Cuaderno',mode:'fixed',sources:[],exclusions:[]},[]):organizer.createChatNotebook({name:'Cuaderno',selection:{scope:'auto',entryKeys:[]}});
      const id=randomUUID(),messages=Array.from({length:151},(_,i)=>({id:randomUUID(),role:i%2?'assistant':'user',content:`Turno ${i} 🌊`,createdAt:new Date(Date.UTC(2026,0,2,10,0,i)).toISOString()}));
      const placement={projectId:project.id,folderId:folder.id,notebookId:null,pinned:true};
      const request={version:1,id:randomUUID(),conversationId:id,expectedRevision:null,action:'save',draft:{title:'Conversación desde el móvil',archived:false,messages,placement},companion:{messages:messages.map(message=>({id:message.id,text:message.content}))}};
      const first=await api.saveMobileChat(vault.id,grant,kind,request,domains);
      assert.equal(first.snapshot.data.projectId,project.id);assert.equal(first.snapshot.data.folderId,folder.id);assert(first.snapshot.data.pinnedAt);
      const catalogue=await api.listMobileChats(vault.id,kind,0,domains);
      assert.equal(catalogue.organisation.projects.find(row=>row.id===project.id).instructions,project.instructions);
      assert.equal(catalogue.organisation.folders.find(row=>row.id===folder.id).parentId,parent.id);
      if(notebook)assert(catalogue.organisation.notebooks.some(row=>row.id===notebook.id));
      assert.equal(first.snapshot.id,id);assert.equal(first.snapshot.data.messages.length,151);
      assert.deepEqual(first.snapshot.companion,request.companion);
      assert.deepEqual(await api.saveMobileChat(vault.id,grant,kind,request,domains),first,'Frozen receipt replay is exact');
      const doc=await api.readMobileChat(vault.id,kind,id,domains);
      assert.equal(doc.revision,first.snapshot.revision);
      const changed={...request,id:randomUUID(),expectedRevision:doc.revision,draft:{...request.draft,messages:doc.data.messages,title:'Nueva pregunta',archived:true}};
      const archived=await api.saveMobileChat(vault.id,grant,kind,changed,domains);
      assert.equal(archived.snapshot.data.archived,true);
      assert.equal(archived.snapshot.data.pinnedAt,null,'Archiving always frees the pin');
      assert.equal(archived.snapshot.data.messages.length,151,'Readable history is never truncated to a model window');
      assert.deepEqual(archived.snapshot.data.messages.map(message=>message.createdAt),messages.map(message=>message.createdAt),'Archiving and subsequent saves retain actual per-turn time');
      assert.deepEqual(await api.saveMobileChat(vault.id,grant,kind,request,domains),first,'Lost ACK cannot overwrite later archiving');
      await assert.rejects(api.saveMobileChat(vault.id,grant,kind,{...request,id:randomUUID(),expectedRevision:doc.revision},domains),error=>error.code==='chat_revision_conflict'&&error.remote.revision===archived.snapshot.revision);
      await assert.rejects(api.saveMobileChat(vault.id,grant,kind,{...request,draft:{...request.draft,title:'Changed frozen payload'}},domains),error=>error.code==='idempotency_conflict');
      await assert.rejects(api.saveMobileChat(vault.id,grant,kind,request,['corpus']),error=>error.code==='permission_denied');
      await assert.rejects(api.listMobileChats(vault.id,kind==='research'?'database':'research',0,domains),error=>error.code==='chat_kind_forbidden');
      const rich=structuredClone(archived.snapshot.data.messages);rich[0].attachments=[{id:randomUUID(),path:'/a/foreign/private/file'}];
      await assert.rejects(api.saveMobileChat(vault.id,grant,kind,{...changed,id:randomUUID(),expectedRevision:archived.snapshot.revision,draft:{...changed.draft,messages:rich}},domains),error=>error.code==='chat_rich_turn_changed');
      const invalidDate=structuredClone(archived.snapshot.data.messages);invalidDate[0].createdAt='not a date';
      await assert.rejects(api.saveMobileChat(vault.id,grant,kind,{...changed,id:randomUUID(),expectedRevision:archived.snapshot.revision,draft:{...changed.draft,messages:invalidDate}},domains),error=>error.code==='invalid_chat_message_date');
      await assert.rejects(api.saveMobileChat(vault.id,grant,kind,{...changed,id:randomUUID(),expectedRevision:archived.snapshot.revision,draft:{...changed.draft,placement:{...placement,folderId:foreignFolder.id}}},domains),error=>error.code==='chat_placement_unavailable');
      const pinned=[];
      for(let i=0;i<5;i++) {
        const value=await api.saveMobileChat(vault.id,grant,kind,{version:1,id:randomUUID(),conversationId:randomUUID(),expectedRevision:null,action:'save',draft:{title:`Fijada ${i}`,archived:false,messages:[],placement:{projectId:null,folderId:null,notebookId:null,pinned:true}}},domains);pinned.push(value.snapshot);
      }
      const sixth=randomUUID();
      await assert.rejects(api.saveMobileChat(vault.id,grant,kind,{version:1,id:randomUUID(),conversationId:sixth,expectedRevision:null,action:'save',draft:{title:'Sexta',archived:false,messages:[],placement:{projectId:null,folderId:null,notebookId:null,pinned:true}}},domains),error=>error.code==='chat_pin_limit');
      await assert.rejects(api.readMobileChat(vault.id,kind,sixth,domains),error=>error.code==='chat_unavailable');
      for(const snapshot of pinned)await api.saveMobileChat(vault.id,grant,kind,{version:1,id:randomUUID(),conversationId:snapshot.id,expectedRevision:snapshot.revision,action:'delete'},domains);
      if(notebook) {
        const request={version:1,id:randomUUID(),conversationId:randomUUID(),expectedRevision:null,action:'save',draft:{title:'Dentro del cuaderno',archived:false,messages:[],placement:{projectId:null,folderId:null,notebookId:notebook.id,pinned:false}}};
        const saved=await api.saveMobileChat(vault.id,grant,kind,request,domains);
        assert.equal(saved.snapshot.data.notebookId,notebook.id);
        await api.saveMobileChat(vault.id,grant,kind,{version:1,id:randomUUID(),conversationId:saved.snapshot.id,expectedRevision:saved.snapshot.revision,action:'delete'},domains);
      }
      if(kind==='research') {
        const legacy=research.createConversation({title:'Original timestamps'}),turns=[{id:randomUUID(),role:'user',content:'Already on Mac'}];
        research.saveMessages(legacy.id,turns);
        const before=research.getConversation(legacy.id).messages[0].createdAt;
        research.saveMessages(legacy.id,turns);
        assert.equal(research.getConversation(legacy.id).messages[0].createdAt,before,'Legacy saves without timestamps do not retimestamp existing Mac turns');
        research.deleteConversation(legacy.id);
      }
      const remove={version:1,id:randomUUID(),conversationId:id,expectedRevision:archived.snapshot.revision,action:'delete'};
      const deleted=await api.saveMobileChat(vault.id,grant,kind,remove,domains);
      assert.equal(deleted.deleted,true);assert.deepEqual(await api.saveMobileChat(vault.id,grant,kind,remove,domains),deleted);
      await assert.rejects(api.readMobileChat(vault.id,kind,id,domains),error=>error.code==='chat_unavailable');
      for(let i=0;i<205;i++) {
        if(kind==='research') research.createConversation({title:`Historia ${i}`});
        else if(kind==='world') world.createWorldChatConversation({title:`Historia ${i}`,selection:{scope:'manual',entryKeys:['fixture-entry'],keepFocus:true},model:null});
        else if(kind==='database') data.createDatabaseChatConversation({title:`Historia ${i}`,databaseIds:['fixture-db']});
        else study.createStudyAssistantConversation({title:`Historia ${i}`});
      }
      const seen=new Set();let cursor=0,revision;
      for(;;) {
        const page=await api.listMobileChats(vault.id,kind,cursor,domains,revision);revision=page.revision;
        for(const row of page.rows) { assert(!seen.has(row.id));seen.add(row.id); }
        assert.equal(page.cursor,cursor+page.rows.length);cursor=page.cursor;if(!page.hasMore)break;
      }
      assert.equal(seen.size,205);
      const before=await api.listMobileChats(vault.id,kind,0,domains);
      const existing=before.rows[0],full=await api.readMobileChat(vault.id,kind,existing.id,domains);
      const save={version:1,id:randomUUID(),conversationId:existing.id,expectedRevision:full.revision,action:'save',draft:{title:'Edición conservando el alcance',archived:false,messages:full.data.messages},companion:null};
      const updated=await api.saveMobileChat(vault.id,grant,kind,save,domains);
      for(const field of ['selection','focus','databaseIds','projectId','folderId','notebookId','model','task','tone','language']) {
        if(field in full.data) assert.deepEqual(updated.snapshot.data[field],full.data[field],`Preserve ${kind}.${field}`);
      }
      await assert.rejects(api.listMobileChats(vault.id,kind,100,domains,before.revision),error=>error.code==='chat_catalogue_changed');
      if(kind==='study') {
        const native=study.updateStudyAssistantConversation(existing.id,{messages});
        assert.equal(native.messages.length,151,'The ordinary Desktop save also preserves all historical turns');
        assert(studyStore.readStudyChatStore().mobileCompanion.receipts[`${grant}:${save.id}`],'Desktop saves preserve companion receipts');
        fs.writeFileSync(studyStore.studyChatStorePath(),'{broken');
        await assert.rejects(api.listMobileChats(vault.id,kind,0,domains),/study_chat_history_unreadable/);
      }
    });
  }
  console.log('Research/world/database/study/teaching history: private CAS, atomic replay, complete pagination, preserved scopes, long histories and genuine errors passed. Device acceptance remains separate.');
} finally {
  globalThis.fetch=fetch;try{db?.getDb().close();}catch{}runtime.restore();fs.rmSync(directory,{recursive:true,force:true});
}
