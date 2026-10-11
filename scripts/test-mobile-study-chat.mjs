import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-study-chat'))process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-study-chat-'));
const runtime=installRuntimeHooks(directory);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;let db,providerCalls=0;
globalThis.fetch=async()=>{providerCalls++;throw new Error('Source capture, composition and synchronization cannot invoke Mac providers');};
try {
  db=require('../electron/db/database.ts');db.getDb();
  const vaults=require('../electron/vaults/vaultRegistry.ts'),search=require('../electron/ai/studySearch.ts'),native=require('../electron/ai/studyAssistant.ts');
  const boundary=require('../electron/desktopBridge/executionBoundary.ts'),shared=require('../shared/mobileStudyChat.ts'),prompt=require('../shared/studyChatPrompt.ts'),answer=require('../shared/studyAssistant.ts'),history=require('../electron/desktopBridge/chatHistory.ts');
  const questions=require('../electron/db/studyQuestionsRepo.ts'),assessments=require('../electron/db/studyAssessmentsRepo.ts'),sha=require('../shared/databaseResearchEngine.ts').sha256Snapshot;
  for(const type of ['estudio','docencia']) {
    const vault=vaults.createVault(`Estudio aislado ${type}`,type);
    await vaults.withOwningVault(vault.id,()=>db.withVaultDatabase(vault.id,async()=>boundary.withMobileOperation(async()=>{
      const course=randomUUID(),subject=randomUUID(),topic=randomUUID(),source=randomUUID(),transcript=randomUUID(),when='2026-10-11T08:00:00.000Z';
      const entries=Array.from({length:250},(_,index)=>({indexId:`fragment-${index}`,kind:'document',sourceId:index<4?source:randomUUID(),title:`Membrana ${index}`,subtitle:'Biología · Transporte',tags:['biología'],text:`La membrana regula el transporte ${index}. El gradiente permite intercambio. La permeabilidad determina el paso.`,scope:{courseId:course,subjectId:subject,topicId:topic,folderId:null},location:{documentId:source,pageNumber:index+1,from:index*100,to:index*100+99},createdAt:when,updatedAt:when,contentHash:`hash-${index}`,embedding:null,excluded:false}));
      entries.push({...entries[0],indexId:'recording-fragment',kind:'transcript',sourceId:transcript,location:{recordingId:transcript,timestampSeconds:45}});
      entries.push({...entries[0],indexId:'excluded-fragment',sourceId:randomUUID(),excluded:true});
      // Duplicate placements describe the same source fragment, not extra evidence.
      entries.push({...entries[0],indexId:'second-placement',scope:{...entries[0].scope,folderId:randomUUID()}});
      const indexFile=path.join(vaults.activeVaultDir(),'study-search-index.json');
      const stored={version:1,updatedAt:when,modelProvider:'openai',modelName:'',entries,excludedSourceIds:[],savedSearches:[],history:[]};
      fs.writeFileSync(indexFile,JSON.stringify(stored));const originalIndex=fs.readFileSync(indexFile,'utf8');
      const selection={scope:'library',sourceKeys:[]},pack=search.getMobileStudyChatSourcePack(selection);
      assert.equal(pack.entries.length,251);assert.ok(pack.entries.every(entry=>entry.embedding===null&&!entry.excluded));
      assert.equal(fs.readFileSync(indexFile,'utf8'),originalIndex,'Mobile capture must not extract, reindex or write the index');
      const question='Explica el gradiente de membrana',messages=[{id:randomUUID(),role:'user',content:question,createdAt:when}];
      const base={selection,task:'answer',level:'standard',tone:'clear',language:'es',allowExternalKnowledge:false,messages};
      const retrieved=await search.retrieveStudyAssistantEntries(question,{},[],20),expected=shared.makeStudyChatCitations(retrieved,question);
      for(const task of ['answer','summary','explain','compare','outline','timeline','table','concept-map','glossary','critique','review-questions'])for(const language of ['es','en','fr']) {
        const request={...base,task,language},result=shared.prepareStudyChat({packs:[pack],request,vaultId:vault.id,interfaceLanguage:'es'});
        assert.deepEqual(result.citations,expected.citations);assert.deepEqual({system:result.system,user:result.user},prompt.buildStudyChatPrompt(request,expected.citations,'es'));
        assert.deepEqual(native.buildStudyAssistantPrompt(request,expected.citations),{system:result.system,user:result.user});
      }
      for(const [scope,id] of [['course',course],['subject',subject],['topic',topic]]) {
        const selected={scope,sourceKeys:[],[`${scope}Id`]:id};
        const scoped=search.getMobileStudyChatSourcePack(selected);assert.ok(scoped.entries.every(entry=>entry.scope[`${scope}Id`]===id));
      }
      const manual={scope:'manual',sourceKeys:[`document:${source}`]},manualPack=search.getMobileStudyChatSourcePack(manual);
      assert.equal(manualPack.entries.length,4);
      const item=questions.createStudyQuestion({prompt:'¿Qué regula el intercambio de membrana?',type:'short',answer:{text:'El gradiente'},explanation:'El gradiente de concentración permite el intercambio.'});
      const exam=assessments.createStudyAssessment({kind:'exam',title:'Examen de membrana',description:'Fuentes seleccionadas',questionIds:[item.id]});
      const attempt=assessments.startStudyAttempt({assessmentId:exam.id,mode:'practice'});
      assessments.saveStudyAttemptAnswer(attempt.id,{assessmentItemId:exam.items[0].id,response:{text:'El gradiente'},responseMs:4200});
      assessments.submitStudyAttempt(attempt.id);
      const extra=[{...entries[0],indexId:`question:${item.id}`,kind:'question',sourceId:item.id,title:item.prompt,text:item.prompt},{...entries[0],indexId:`exam:${exam.id}`,kind:'exam',sourceId:exam.id,title:exam.title,text:exam.description}];
      fs.writeFileSync(indexFile,JSON.stringify({...stored,entries:[...entries,...extra]}));
      const originals=search.getMobileStudyChatSourcePack({scope:'manual',sourceKeys:[`question:${item.id}`,`exam:${exam.id}`]});
      shared.validateMobileStudyChatSourcePack(originals,vault.id);
      assert.deepEqual(originals.originals[`question:${item.id}`].data,questions.getStudyQuestion(item.id));
      assert.deepEqual(originals.originals[`exam:${exam.id}`].data,assessments.getStudyAssessment(exam.id));
      assert.equal(originals.originals[`exam:${exam.id}`].data.items[0].question.answer.text,'El gradiente');
      assert.deepEqual(originals.originals[`question:${item.id}`].related.versions,questions.listStudyQuestionVersions(item.id));
      assert.equal(originals.originals[`question:${item.id}`].related.attempts.length,1);
      assert.equal(originals.originals[`question:${item.id}`].related.attempts[0].answers[0].response.text,'El gradiente');
      assert.equal(originals.originals[`exam:${exam.id}`].related.attempts[0].id,attempt.id);
      assert.equal(originals.originals[`exam:${exam.id}`].related.attempts[0].assessment,undefined);
      const foreignHistory=structuredClone(originals.originals[`question:${item.id}`]);foreignHistory.related.attempts[0].answers[0].questionId=randomUUID();
      assert.throws(()=>shared.validateMobileStudyChatOriginal(foreignHistory),/invalid_study_chat_original_attempts/);
      assert.deepEqual(search.getMobileStudyChatOriginal({kind:'exam',sourceId:exam.id}),originals.originals[`exam:${exam.id}`]);
      const misplaced=structuredClone(originals);misplaced.originals[`question:${item.id}`].sourceId=randomUUID();misplaced.id=sha(shared.studyChatPackPayload(misplaced));
      assert.throws(()=>shared.validateMobileStudyChatSourcePack(misplaced,vault.id),/invalid_study_chat_original/);
      const unrelated=structuredClone(manualPack);unrelated.originals=originals.originals;unrelated.id=sha(shared.studyChatPackPayload(unrelated));
      assert.throws(()=>shared.validateMobileStudyChatSourcePack(unrelated,vault.id),/study_chat_original_outside_selection/);
      const older=structuredClone(originals);delete older.originals;older.id=sha(shared.studyChatPackPayload(older));shared.validateMobileStudyChatSourcePack(older,vault.id);
      questions.setStudyQuestionLifecycle(item.id,'delete');
      assert.throws(()=>search.getMobileStudyChatOriginal({kind:'question',sourceId:item.id}),/study_chat_original_unavailable/);
      fs.writeFileSync(indexFile,originalIndex);
      const input={packs:[manualPack],request:{...base,selection:manual},vaultId:vault.id,interfaceLanguage:'es'},prepared=shared.prepareStudyChat(input);
      assert.throws(()=>shared.prepareStudyChat({...input,vaultId:randomUUID()}),/source_pack/);
      assert.throws(()=>shared.prepareStudyChat({...input,request:{...input.request,selection:{scope:'course',sourceKeys:[]}}}),/scope_missing/);
      assert.throws(()=>shared.prepareStudyChat({...input,request:{...input.request,selection:{scope:'manual',sourceKeys:[`document:${randomUUID()}`]}}}),/not_downloaded/);
      const tampered=structuredClone(manualPack);tampered.entries[0].text='Inventado';assert.throws(()=>shared.prepareStudyChat({...input,packs:[tampered]}),/source_pack/);
      const noRecording=boundary.withMobileOperation(()=>search.getMobileStudyChatSourcePack(selection),['corpus']);assert.ok(noRecording.entries.every(entry=>entry.kind!=='transcript'));
      const result=answer.validateStudyAssistantAnswer('La membrana regula el transporte [S1]. Fuente inventada [S999].',prepared.citations);
      assert.equal(result.citations.length,1);assert.ok(!result.answer.includes('S999'));
      const turn={id:randomUUID(),role:'assistant',content:result.answer,createdAt:when,citations:result.citations};
      const study={selection:manual,task:'compare',level:'advanced',tone:'academic',language:'fr',allowExternalKnowledge:false};
      const edit={version:1,id:randomUUID(),conversationId:randomUUID(),expectedRevision:null,action:'save',draft:{title:'Comparación autónoma',archived:false,messages:[...messages,turn],study,studyEvidence:{[turn.id]:prepared.evidence}}};
      // Once captured, real citations survive a later reindex of the Mac.
      fs.writeFileSync(indexFile,JSON.stringify({...stored,entries:[]}));
      const grant=randomUUID(),saved=await history.saveMobileChat(vault.id,grant,'study',edit,['corpus','writing','study-recordings']);
      assert.deepEqual(saved.snapshot.data.selection,manual);assert.equal(saved.snapshot.data.task,'compare');assert.deepEqual(saved.snapshot.data.messages[1].citations,result.citations);
      assert.deepEqual(await history.saveMobileChat(vault.id,grant,'study',edit,['corpus','writing','study-recordings']),saved);
      const forged=structuredClone(edit);forged.id=randomUUID();forged.conversationId=randomUUID();forged.draft.messages[1].citations[0].quote='Una afirmación inventada';
      await assert.rejects(history.saveMobileChat(vault.id,grant,'study',forged,['corpus','writing']),error=>error.code==='invalid_study_chat_evidence');
      const foreign=vaults.createVault('Prueba de identidad ajena',type);
      await assert.rejects(history.saveMobileChat(foreign.id,grant,'study',{...edit,id:randomUUID(),conversationId:randomUUID()},['corpus','writing']),error=>error.code==='invalid_study_chat_evidence');
      fs.writeFileSync(indexFile,'{incomplete');assert.throws(()=>search.getMobileStudyChatSourcePack(selection),/unreadable/);
    },['corpus','writing','study-recordings'])));
  }
  assert.equal(providerCalls,0);
  console.log('Actual isolated Study/Teaching indexed sources, native/shared contexts, all tasks/languages, scopes, recording grants, immutable signed evidence, reindex survival and provider-free idempotent history passed. Native/device acceptance remains separate.');
} finally { globalThis.fetch=originalFetch;db?.closeDb();runtime.restore();fs.rmSync(directory,{recursive:true,force:true}); }
