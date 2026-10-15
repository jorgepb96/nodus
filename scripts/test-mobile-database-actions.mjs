import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-database-actions'))process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-db-actions-')),runtime=installRuntimeHooks(directory);
runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url);let providerCalls=0;const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{providerCalls++;throw new Error('This contract suite never calls external services');};
try {
 const database=require('../electron/db/database.ts');database.getDb();const vaults=require('../electron/vaults/vaultRegistry.ts');
 const vault=vaults.createVault('Isolated database action contract','databases');
 await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,async()=>{
  const repo=require('../electron/db/databasesRepo.ts'),actions=require('../electron/desktopBridge/MobileDatabaseActions.ts');
  const db=repo.createDatabase('Canonical fixture'),row=repo.createRow(db.id);
  const text=repo.createColumn(db.id,'Summary','ai'),image=repo.createColumn(db.id,'Image','ai_image'),button=repo.createColumn(db.id,'Run','button');
  repo.updateColumn(text.id,{config:{aiPrompt:'Summarize the actual row'}});repo.updateColumn(image.id,{config:{aiPrompt:'Illustrate the actual row'}});
  const request=(column,kind)=>({rowId:row.id,columnId:column.id,kind});
  const source=actions.getMobileDatabaseActionSource(request(text,'text'));
  const dispatch=require('../electron/desktopBridge/databaseActionsOperation.ts'),{MOBILE_OPERATIONS,MOBILE_JOB_OPERATIONS}=require('../shared/mobileOperations.ts');
  for(const method of dispatch.MOBILE_DATABASE_ACTION_METHODS){assert(MOBILE_OPERATIONS[method]);assert.equal(MOBILE_JOB_OPERATIONS.has(method),method!=='getMobileDatabaseActionSource');}
  assert.deepEqual(await dispatch.executeMobileDatabaseAction(vault.id,['corpus'],'getMobileDatabaseActionSource',[request(text,'text')]),source);
  await assert.rejects(()=>dispatch.executeMobileDatabaseAction(vault.id,[],'getMobileDatabaseActionSource',[request(text,'text')]),/permission_denied/);
  await assert.rejects(()=>dispatch.executeMobileDatabaseAction(vault.id,['corpus'],'runMobileDatabaseButton',[request(button,'button')]),/job_required/);
  await assert.rejects(()=>dispatch.executeMobileDatabaseAction(vault.id,['corpus','writing'],'generateMobileDatabaseText',[request(text,'text')],{deviceGrant:'fixture-grant',idempotencyKey:randomUUID()}),/permission_denied/);
  assert.equal(source.rowId,row.id);assert.equal(source.columnId,text.id);assert.match(source.revision,/^[a-f0-9]{64}$/);assert(source.prompt.includes('Summarize the actual row'));
  const other=repo.createDatabase('Foreign parent'),foreign=repo.createRow(other.id);
  assert.throws(()=>actions.getMobileDatabaseActionSource({...request(text,'text'),rowId:foreign.id}),/parent_unavailable/);
  const publication={requestId:randomUUID(),request:{...request(text,'text'),revision:source.revision},model:{provider:'openai',model:'fixture-device'},text:'Saved output'};
  await assert.rejects(()=>dispatch.executeMobileDatabaseAction(vault.id,['corpus','writing'],'saveMobileDatabaseGeneratedCell',[publication],{deviceGrant:'fixture-grant',idempotencyKey:randomUUID()}),/identity_conflict/);
  const saved=await dispatch.executeMobileDatabaseAction(vault.id,['corpus','writing'],'saveMobileDatabaseGeneratedCell',[publication],{deviceGrant:'fixture-grant',idempotencyKey:publication.requestId});assert.equal(saved.row.cells[text.id],'Saved output');
  assert.deepEqual(actions.saveMobileDatabaseGeneratedCell(publication,'fixture-grant',vault.id),saved,'Lost acknowledgement reuses exact receipt after source changes');
  assert.throws(()=>actions.saveMobileDatabaseGeneratedCell({...publication,text:'different'},'fixture-grant',vault.id),/identity_conflict/);
  assert.throws(()=>actions.saveMobileDatabaseGeneratedCell({...publication,requestId:randomUUID()},'fixture-grant',vault.id),/source_conflict/);
  const sourceImage=actions.getMobileDatabaseActionSource(request(image,'image'));
  const old=repo.addAttachment({rowId:row.id,columnId:image.id,fileName:'prior.png',mimeType:'image/png',bytes:3,blob:Buffer.from('old')});
  assert.throws(()=>actions.saveMobileDatabaseGeneratedCell({requestId:randomUUID(),request:{...request(image,'image'),revision:sourceImage.revision},model:publication.model,bytes:Buffer.from('new').toString('base64'),mime:'image/png'},'fixture-grant',vault.id),/source_conflict/);
  assert.equal(repo.listAttachments(row.id,image.id)[0].id,old.id,'A stale result cannot erase previous image');
  const blobSource=actions.getMobileDatabaseActionSource(request(image,'image'));
  const uploads=require('../electron/desktopBridge/databaseAttachmentUploads.ts');
  const blobId=randomUUID(),blobBytes=Buffer.from('actual staged generated bytes');
  const staged=uploads.stageMobileDatabaseImageBytes(vault.id,'fixture-grant',blobId,{rowId:row.id,columnId:image.id,fileName:'generated.png',mimeType:'image/png',expectedRowRevision:blobSource.rowRevision,expectedColumnRevision:blobSource.columnRevision},blobBytes);
  const blobPublication={requestId:randomUUID(),request:{...request(image,'image'),revision:blobSource.revision},model:publication.model,blobUploadId:staged.blobUploadId,sha256:staged.sha256,mime:staged.mimeType};
  const blobResult=actions.saveMobileDatabaseGeneratedCell(blobPublication,'fixture-grant',vault.id);assert.deepEqual(repo.getAttachmentBlob(blobResult.attachment.id),blobBytes);
  assert.deepEqual(actions.saveMobileDatabaseGeneratedCell(blobPublication,'fixture-grant',vault.id),blobResult,'Completed receipt survives staged blob cleanup');
  repo.updateColumn(text.id,{config:{aiPrompt:'Summarize',aiModel:{provider:'openai',model:'fixture'}}});
  const paidSource=actions.getMobileDatabaseActionSource(request(text,'text')),paidRequest={...request(text,'text'),revision:paidSource.revision},paidId=randomUUID(),cancel=new AbortController();let calls=0;
  const completion={text:async()=>{calls++;cancel.abort();return 'received paid output';}};
  await assert.rejects(actions.generateMobileDatabase(paidRequest,paidId,'paid-fixture',()=>{},cancel.signal,vault.id,completion),{name:'AbortError'});
  assert.equal(database.getDb().prepare('SELECT stage FROM mobile_database_action_receipts WHERE request_id=? AND device_grant=?').get(paidId,'paid-fixture').stage,'received');
  const recovered=await actions.generateMobileDatabase(paidRequest,paidId,'paid-fixture',()=>{},undefined,vault.id,completion);
  assert.equal(recovered.text,'received paid output');assert.equal(calls,1,'Received result resumes publication without purchasing another completion');
  const buttonSource=actions.getMobileDatabaseActionSource(request(button,'button')),buttonRequest={...request(button,'button'),revision:buttonSource.revision},id=randomUUID();
  const run=await actions.runMobileDatabaseButton(buttonRequest,id,'fixture-grant',vault.id);assert.equal(JSON.parse(run.row.cells[button.id]).clicks,1);
  assert.deepEqual(await actions.runMobileDatabaseButton(buttonRequest,id,'fixture-grant',vault.id),run);assert.equal(JSON.parse(repo.getRow(row.id).cells[button.id]).clicks,1);
  const interruptedId=randomUUID();database.getDb().prepare("INSERT INTO mobile_database_action_receipts VALUES(?,?,?,'started',NULL,NULL)").run(interruptedId,'fixture-grant',require('node:crypto').createHash('sha256').update(require('../shared/canonicalJson.ts').canonicalJson(buttonRequest)).digest('hex'));
  await assert.rejects(actions.runMobileDatabaseButton(buttonRequest,interruptedId,'fixture-grant',vault.id),/interrupted_review_required/);assert.equal(JSON.parse(repo.getRow(row.id).cells[button.id]).clicks,1);
  // Injected external receipt only: publication must never send this webhook.
  const automations=require('../electron/db/databaseAutomationsRepo.ts');
  const actionDb=repo.createDatabase('Device receipts'),actionRow=repo.createRow(actionDb.id),relatedRow=repo.createRow(actionDb.id);
  const actionButton=repo.createColumn(actionDb.id,'Execute','button'),stateColumn=repo.createColumn(actionDb.id,'State','text');
  const relation=repo.createColumn(actionDb.id,'Related','relation',{relationTargetKind:'db_row',relationTargetDatabaseId:actionDb.id});repo.addRelation(actionRow.id,relation.id,'db_row',relatedRow.id);
  const destination=repo.createDatabase('Created pages'),targetTitle=repo.createColumn(destination.id,'Title','title');
  automations.createAutomationRule(actionDb.id,{name:'Canonical five actions',trigger:{type:'button',columnId:actionButton.id},maxAttempts:1,actions:[
    {type:'set_property',columnId:stateColumn.id,value:{type:'literal',value:'device-set'}},
    {type:'update_related',relationColumnId:relation.id,changes:[{columnId:stateColumn.id,value:{type:'literal',value:'related-set'}}]},
    {type:'create_page',databaseId:destination.id,properties:{[targetTitle.id]:{type:'literal',value:'Device-created page'}},blocks:[{type:'paragraph',content:{text:'Exact device-authored page'}},{id:'exact-table',type:'table',content:{rows:[['Original canonical cell']],columnWidths:[180]}},{id:'exact-child',parentBlockId:'exact-table',type:'paragraph',content:{text:'Exact nested text',reference:{id:'preserved-source-ref'}}}]},
    {type:'notify',title:'Device notice',body:'Confirmed local steps'},
    {type:'webhook',url:'https://never-called.invalid/receipt',method:'POST',headers:{},body:'explicit-user-action'}
  ]});
  const beforeCapture=database.getDb().prepare('SELECT total_changes() AS n').get().n;
  const captured=actions.getMobileDatabaseActionSource({rowId:actionRow.id,columnId:actionButton.id,kind:'button'});
  assert.equal(database.getDb().prepare('SELECT total_changes() AS n').get().n,beforeCapture,'Capture never writes or executes actions');
  assert.deepEqual(new Set(captured.plan.operations.map(operation=>operation.type)),new Set(['button_click','set_property','create_page','notify','webhook']));
  const deviceId=randomUUID(),clickedAt='2026-10-15T10:00:00Z',plan=actions.instantiateMobileDatabaseButtonPlan(captured.plan,deviceId,clickedAt);
  const webhooks=Object.fromEntries(plan.operations.flatMap((operation,index)=>operation.type==='webhook'?[[String(index),{status:'succeeded',httpStatus:204,attempt:1}]]:[]));
  const deviceInput={requestId:deviceId,request:{rowId:actionRow.id,columnId:actionButton.id,kind:'button',revision:captured.revision},result:{clickedAt,finishedAt:'2026-10-15T10:00:01Z',completedSteps:plan.operations.length,webhooks}};
  const receipt=await dispatch.executeMobileDatabaseAction(vault.id,['corpus','writing'],'saveMobileDatabaseButtonResult',[deviceInput],{deviceGrant:'fixture-device-button',idempotencyKey:deviceId});
  assert.equal(repo.getRow(actionRow.id).cells[stateColumn.id],'device-set');assert.equal(repo.getRow(relatedRow.id).cells[stateColumn.id],'related-set');
  const created=plan.operations.find(operation=>operation.type==='create_page');assert.equal(repo.getRow(created.rowId).cells[targetTitle.id],'Device-created page');
  const page=require('../electron/db/pagesRepo.ts').getPageDocumentForRow(created.rowId);assert(page.markdown.includes('Exact device-authored page'));
  const acknowledgedPage=receipt.createdPages.find(document=>document.page.rowId===created.rowId);
  assert.equal(acknowledgedPage.page.id,`row:${created.rowId}`);assert.deepEqual(acknowledgedPage.blocks.map(block=>({id:block.id,type:block.type,content:block.content})),created.blocks.map(block=>({id:block.id,type:block.type,content:block.content})));
  assert(acknowledgedPage.revision>0 && acknowledgedPage.page.revision>0);
  assert.equal(automations.listAutomationNotifications(actionDb.id).length,1);
  const unchanged=database.getDb().prepare('SELECT total_changes() AS n').get().n;
  assert.deepEqual(actions.saveMobileDatabaseButtonResult(deviceInput,'fixture-device-button'),receipt);
  assert.equal(database.getDb().prepare('SELECT total_changes() AS n').get().n,unchanged,'Lost ACK never repeats notifications, hooks or local writes');
  // A real uncertain external attempt is represented by a persisted receipt,
  // not replayed. Only the explicitly approved prefix reaches canonical SQL.
  const uncertainButton=repo.createColumn(actionDb.id,'Uncertain action','button');
  automations.createAutomationRule(actionDb.id,{name:'Uncertain receipt',trigger:{type:'button',columnId:uncertainButton.id},maxAttempts:1,actions:[
    {type:'set_property',columnId:stateColumn.id,value:{type:'literal',value:'confirmed-prefix'}},
    {type:'webhook',url:'https://never-called.invalid/unknown',method:'POST',headers:{},body:'unknown outcome'},
    {type:'notify',title:'Must not execute',body:'After uncertain external step'}
  ]});
  const uncertainSource=actions.getMobileDatabaseActionSource({rowId:actionRow.id,columnId:uncertainButton.id,kind:'button'}),uncertainId=randomUUID();
  const uncertainPlan=actions.instantiateMobileDatabaseButtonPlan(uncertainSource.plan,uncertainId,clickedAt),pending=uncertainPlan.operations.findIndex(operation=>operation.type==='webhook');
  assert(pending>0 && pending<uncertainPlan.operations.length-1);
  const originalAttempt={clickedAt,completedSteps:pending,webhooks:{},pendingWebhook:pending};
  const resolvedInput={requestId:uncertainId,request:{rowId:actionRow.id,columnId:uncertainButton.id,kind:'button',revision:uncertainSource.revision},result:{clickedAt,finishedAt:'2026-10-15T10:00:05Z',completedSteps:pending,webhooks:{},interruptedStep:pending,resolution:'publishConfirmedPrefix',interruptedExecution:originalAttempt}};
  assert.throws(()=>actions.saveMobileDatabaseButtonResult({...resolvedInput,result:{...resolvedInput.result,interruptedStep:pending+1}},'uncertain-device'),/invalid_database_button_resolution/);
  const noticesBefore=automations.listAutomationNotifications(actionDb.id).length;
  const resolvedReceipt=actions.saveMobileDatabaseButtonResult(resolvedInput,'uncertain-device');
  assert.equal(repo.getRow(actionRow.id).cells[stateColumn.id],'confirmed-prefix');
  assert.equal(automations.listAutomationNotifications(actionDb.id).length,noticesBefore,'No unconfirmed suffix notification is dispatched');
  assert.deepEqual(resolvedReceipt.result.interruptedExecution,originalAttempt);
  const failedRun=database.getDb().prepare('SELECT * FROM automation_runs WHERE id=?').get(uncertainPlan.runs[0].id);
  assert.equal(failedRun.status,'failed');assert.match(failedRun.error,/no tiene respuesta confirmada/);
  const afterResolution=database.getDb().prepare('SELECT total_changes() AS n').get().n;
  assert.deepEqual(actions.saveMobileDatabaseButtonResult(resolvedInput,'uncertain-device'),resolvedReceipt);
  assert.equal(database.getDb().prepare('SELECT total_changes() AS n').get().n,afterResolution,'Resolution lost-ACK reuses receipt without hooks, notices or SQL changes');

 }));
 assert.equal(providerCalls,0);console.log('PASS real isolated canonical DB source/CAS/receipt/button contracts; no providers or external actions invoked');
}finally{globalThis.fetch=originalFetch;runtime.restore();fs.rmSync(directory,{recursive:true,force:true});}
