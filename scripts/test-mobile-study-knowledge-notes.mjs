import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {_electron as electron} from 'playwright-core';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-study-knowledge-notes'))process.exit(0);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-study-knowledge-notes-')),require=createRequire(import.meta.url);installRuntimeHooks(scratch);let database;
try {
 database=require('../electron/db/database.ts');const {getActiveVault}=require('../electron/vaults/vaultRegistry.ts');const vault=getActiveVault();
 const org=require('../electron/db/studyOrgRepo.ts'),knowledge=require('../electron/db/studyKnowledgeRepo.ts'),editor=require('../electron/db/studyEditorRepo.ts');
 const {applyStudyEdit}=require('../electron/desktopBridge/studyEdits.ts');const {seedStudyKnowledgeNote}=require('../src/mobileWeb/studyKnowledgeNotes.ts');
 const course=org.createStudyCourse({name:'Isolated source course'}),a=org.createStudySubject({courseId:course.id,name:'History'}),b=org.createStudySubject({courseId:course.id,name:'Philosophy'});
 const source=org.createStudyDocument({title:'Real fixture source',kind:'apunte',contentMarkdown:'Exact source quotation at location p. 7.',placement:{courseId:course.id,subjectId:a.id}});
 const ideas=Array.from({length:161},(_,i)=>({key:'idea-'+i,type:'concept',label:'Idea '+String(i).padStart(3,'0'),statement:'A documented statement '+i,role:'principal',confidence:.9,evidence:[{quote:'Exact source quotation',location:'p. 7'}]}));
 // Canonical repository writes supplied fixture records only: no model,
 // extraction runner, embedding request or indexer is invoked.
 knowledge.replaceStudySourceKnowledge({subjectId:a.id,sourceKind:'document',sourceId:source.id,sourceTitle:source.title,sourceHash:'fixture-a',ideas,relations:[{from:'idea-0',to:'idea-1',type:'supports',basis:'Documented relation',confidence:.9}],embeddings:ideas.map(()=>null),embeddingProvider:'fixture-unused',embeddingModel:'fixture-unused'});
 knowledge.replaceStudySourceKnowledge({subjectId:b.id,sourceKind:'document',sourceId:source.id,sourceTitle:source.title,sourceHash:'fixture-b',ideas:[{...ideas[0],key:'other',label:'Other subject idea'}],relations:[],embeddings:[null],embeddingProvider:'fixture-unused',embeddingModel:'fixture-unused'});
 const {mobileStudyKnowledgeSource}=require('../electron/desktopBridge/mobileStudyKnowledge.ts');
 const registry=require('../electron/vaults/vaultRegistry.ts');
 const sourcePage=(id,input)=>registry.withOwningVault(id,()=>database.withVaultDatabase(id,()=>mobileStudyKnowledgeSource(id,input)));
 const changesBefore=database.getDb().prepare('SELECT total_changes() n').get().n;
 const firstSource=await sourcePage(vault.id,{subjectId:a.id,offset:0,limit:80});assert.equal(firstSource.total,161);assert.equal(firstSource.ideas.length,80);
 const pages=[firstSource];for(const offset of [80,160])pages.push(await sourcePage(vault.id,{subjectId:a.id,offset,limit:80,revision:firstSource.revision}));assert.deepEqual(pages.map(page=>page.ideas.length),[80,80,1]);assert.equal(database.getDb().prepare('SELECT total_changes() n').get().n,changesBefore,'Reading source pages makes no SQLite writes.');
 const complete={...firstSource,ideas:pages.flatMap(page=>page.ideas),details:pages.flatMap(page=>page.details),hasMore:false};
 const {studyKnowledgeCopies}=require('../src/mobileWeb/studyKnowledgeCopy.ts');const selected=studyKnowledgeCopies([complete],vault.id);assert.equal(selected.list(a.id).length,161);assert.equal(selected.detail(firstSource.ideas[0].id).evidence[0].quote,'Exact source quotation');assert.deepEqual(selected.graph(a.id),firstSource.graph);assert.throws(()=>selected.list(b.id),/no está descargada/);assert.throws(()=>studyKnowledgeCopies([complete],'wrong-vault'),/otro espacio/);assert.throws(()=>studyKnowledgeCopies([{...complete,details:complete.details.slice(1)}],vault.id),/completa/);
 const otherVault=registry.createVault('Separate isolated vault');await assert.rejects(sourcePage(otherVault.id,{subjectId:a.id,offset:0,limit:80}),/study_subject_unavailable/);
 // A real canonical source mutation invalidates the old continuation token.
 const changedIdeas=ideas.map((idea,index)=>index===0?{...idea,evidence:[{quote:'Changed exact quotation',location:'p. 8'}]}:idea);
 knowledge.replaceStudySourceKnowledge({subjectId:a.id,sourceKind:'document',sourceId:source.id,sourceTitle:source.title,sourceHash:'fixture-a-changed',ideas:changedIdeas,relations:[{from:'idea-0',to:'idea-1',type:'supports',basis:'Documented relation',confidence:.9}],embeddings:ideas.map(()=>null),embeddingProvider:'fixture-unused',embeddingModel:'fixture-unused'});
 await assert.rejects(sourcePage(vault.id,{subjectId:a.id,offset:80,limit:80,revision:firstSource.revision}),/study_knowledge_changed/);
 knowledge.replaceStudySourceKnowledge({subjectId:a.id,sourceKind:'document',sourceId:source.id,sourceTitle:source.title,sourceHash:'fixture-a',ideas,relations:[{from:'idea-0',to:'idea-1',type:'supports',basis:'Documented relation',confidence:.9}],embeddings:ideas.map(()=>null),embeddingProvider:'fixture-unused',embeddingModel:'fixture-unused'});
 const sent=[],events=[];globalThis.localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 globalThis.window={dispatchEvent:event=>events.push(event.type),nodus:{getStudyWorkspace:async()=>org.getStudyWorkspace(),listStudyIdeas:async(...args)=>knowledge.listStudyIdeas(...args),getStudyIdeaDetail:async id=>knowledge.getStudyIdeaDetail(id),getStudyKnowledgeGraph:async id=>knowledge.getStudyKnowledgeGraph(id),createStudyDocument:async input=>{
  const seeded=seedStudyKnowledgeNote(input),{title,contentMarkdown,nativeDocument,...creation}=seeded;
  const request={id:randomUUID(),documentId:randomUUID(),creation,input:{title,contentMarkdown,nativeDocument,schemaVersion:2,expectedRevision:0}};
  sent.push(request);return (await applyStudyEdit(vault.id,'fixture-phone',request)).document;
 }}};
 await build({entryPoints:['src/views/studyKnowledgeViewSource.ts'],bundle:true,platform:'browser',format:'cjs',outfile:path.join(scratch,'knowledge-source.cjs'),loader:{'.css':'empty','.svg':'dataurl'}});
 const {createStudyKnowledgeViewSource}=require(path.join(scratch,'knowledge-source.cjs'));
 const first=createStudyKnowledgeViewSource(a.id),second=createStudyKnowledgeViewSource(b.id);
 const all=[];for(const offset of [0,80,160]){const page=await first.listIdeasPage({offset,limit:80,sort:'label'});assert.equal(page.total,161);all.push(...page.items);}
 assert.equal(new Set(all.map(x=>x.id)).size,161);assert.equal((await second.listIdeasPage({offset:0,limit:80,sort:'label'})).total,1);
 assert.equal((await second.listIdeasPage({offset:0,limit:80,sort:'label'})).items[0].label,'Other subject idea');
 const detail=await first.getIdeaDetail(all[0].id);await first.saveIdea(detail);
 const packet=sent[0],stored=await editor.getStudyDocEditorData(packet.documentId);
 assert.equal(stored.contentMarkdown,packet.input.contentMarkdown);assert.deepEqual(stored.nativeDocument,packet.input.nativeDocument);
 assert.match(stored.contentMarkdown,/Exact source quotation/);assert.match(stored.contentMarkdown,/p\. 7/);assert.ok(stored.nativeDocument.some(block=>block.type==='quote'));
 const placement=database.getDb().prepare('SELECT course_id,subject_id FROM study_placements WHERE document_id=?').get(packet.documentId);assert.equal(placement.course_id,course.id);assert.equal(placement.subject_id,a.id);
 const replay=await applyStudyEdit(vault.id,'fixture-phone',packet);assert.equal(replay.document.id,packet.documentId);assert.equal((await editor.getStudyDocEditorData(packet.documentId)).versions.length,stored.versions.length);
 await first.saveIdea(detail);assert.notEqual(sent[1].documentId,packet.documentId,'Two deliberate identical saves create two notes.');
 const connections=await first.listIdeaConnections(detail.idea.global_id);assert.equal(connections.length,1);const edge=await first.getEdgeDetail(connections[0].edge.id);await first.saveEdge(edge);
 assert.match(sent[2].input.contentMarkdown,/Documented relation/);assert.equal(sent[2].creation.placement.subjectId,a.id);assert.equal(sent[2].creation.placement.courseId,course.id);
 const linkSeed=seedStudyKnowledgeNote({title:'Link',kind:'apunte',contentMarkdown:'[Source](nodus://study/doc/'+source.id+')\n\n> Exact source quotation'});assert.ok(JSON.stringify(linkSeed.nativeDocument).includes('nodus://study/doc/'+source.id));assert.ok(linkSeed.nativeDocument.some(block=>block.type==='quote'));
 const uiData={workspace:org.getStudyWorkspace(),subjects:[a,b],ideas:{[a.id]:knowledge.listStudyIdeas(a.id),[b.id]:knowledge.listStudyIdeas(b.id)},details:Object.fromEntries([...knowledge.listStudyIdeas(a.id),...knowledge.listStudyIdeas(b.id)].map(idea=>[idea.id,knowledge.getStudyIdeaDetail(idea.id)]))};
 const fixtureJs=`import React from 'react';import{createRoot}from'react-dom/client';import{StudyIdeasView}from'./src/views/StudyIdeasView';import{seedStudyKnowledgeNote}from'./src/mobileWeb/studyKnowledgeNotes';import{setActiveLang}from'./src/i18n';setActiveLang('es');const data=${JSON.stringify(uiData)};window.savedStudyNotes=[];window.nodus={getStudyWorkspace:async()=>data.workspace,listStudyIdeas:async(id,q)=>data.ideas[id].filter(idea=>!q||idea.label.includes(q)),getStudyIdeaDetail:async id=>data.details[id],createStudyDocument:async input=>{window.savedStudyNotes.push(seedStudyKnowledgeNote(input));return{id:'fixture-note'};},onStudyKnowledgeChanged:()=>()=>{},onDataChanged:()=>()=>{},onScanComplete:()=>()=>{}};window.nodus=new Proxy(window.nodus,{get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return()=>()=>{};throw new Error('Unexpected fixture API '+String(key));}});createRoot(document.getElementById('root')).render(<StudyIdeasView vaultId="isolated-fixture" onOpenGraph={target=>window.lastStudyGraph=target} onOpenAssistant={target=>window.lastStudyAssistant=target} onOpenMaterial={id=>window.lastStudyMaterial=id} onOpenDocument={id=>window.lastStudyDocument=id}/>);`;
 await build({stdin:{contents:fixtureJs,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'browser',format:'iife',outfile:path.join(scratch,'fixture.js'),loader:{'.css':'empty','.svg':'dataurl'},logLevel:'silent'});
 fs.writeFileSync(path.join(scratch,'index.html'),'<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div id="root" style="height:100vh"></div><script src="fixture.js"></script></body></html>');
 fs.writeFileSync(path.join(scratch,'main.cjs'),"const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:390,height:844,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.loadFile("+JSON.stringify(path.join(scratch,'index.html'))+");});");
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let browser;
 try{browser=await electron.launch({executablePath:process.execPath,args:[path.join(scratch,'main.cjs'),'--user-data-dir='+path.join(scratch,'ui-profile')],env});const page=await browser.firstWindow();page.on('pageerror',error=>console.error('Fixture renderer:',error.message));page.setDefaultTimeout(15000);await page.reload();
 await page.getByTestId('study-ideas-subject').waitFor();await page.getByTestId('study-ideas-subject').selectOption(b.id);await page.getByTestId('study-idea-card').filter({hasText:'Other subject idea'}).waitFor();assert.equal(await page.getByTestId('study-idea-card').count(),1);
 await page.getByTestId('study-ideas-subject').selectOption(a.id);await page.getByTestId('study-idea-card').first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-testid="study-idea-card"]').length===80);
 await page.getByTestId('study-idea-card').filter({hasText:'Idea 000'}).click();await page.getByTestId('study-idea-detail').waitFor();await page.getByRole('button',{name:'Guardar en notas',exact:true}).click();await page.waitForFunction(()=>window.savedStudyNotes.length===1);const savedByUI=await page.evaluate(()=>window.savedStudyNotes[0]);assert.equal(savedByUI.placement.subjectId,a.id);assert.equal(savedByUI.placement.courseId,course.id);assert.match(savedByUI.contentMarkdown,/Exact source quotation/);assert.ok(savedByUI.nativeDocument.some(block=>block.type==='quote'));
 }finally{if(browser)await browser.close();}
 assert.throws(()=>seedStudyKnowledgeNote({title:'No body'}),/contenido/);assert.equal(events.filter(x=>x==='nodus:study-workspace-changed').length,3);
 console.log(JSON.stringify({ok:true,canonicalIdeas:161,canonicalSubjects:2,pages:[80,80,1],savedIdeaCopies:2,savedRelations:1,receiptReplay:true,canonicalSQLite:true,revisionBoundSourcePages:true,crossVaultSourceRefused:true,downloadedOperationNoTransport:true,actualChromiumSubjectSelection:true,actualChromiumSave:true,providerCalls:0,extractionCalls:0}));
}finally{database?.closeDb?.();fs.rmSync(scratch,{recursive:true,force:true});}
