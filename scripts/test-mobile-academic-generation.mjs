import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-academic'))process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-companion-academic-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),fetch=globalThis.fetch;let database,providers=0;
globalThis.fetch=async()=>{providers++;throw new Error('Source capture and publication must not use a provider');};
try{
  const prose=require('../shared/companionProseDraft.ts'),{composeProseReviewContext}=require('../shared/worldProseReview.ts'),{PROMPT_LANGUAGES}=require('../shared/types.ts');
  const draft={sceneTitle:'Título local',text:'[Ada](nodus://world/character/ada) cruza [[Puerta]].',beats:[{threadKind:'rule',threadId:'real-rule',threadTitle:'La puerta',mark:'breaks',text:'Se paga.'}]};
  for(const language of PROMPT_LANGUAGES){
    const baseline={sceneId:'real-scene',beats:[],sources:{sceneTitle:'Título anterior',beats:[],prose:'Texto guardado'},noMaterial:true,prompt:{system:'original',user:'before',plainContext:true,temperature:.2,maxTokens:600},draftTemplate:prose.proseDraftTemplate(language)};
    const current=prose.applyProseDraft(baseline,draft);
    assert.equal(current.sources.prose,'Ada cruza Puerta.');assert.equal(current.sources.sceneTitle,'Título local');assert.equal(current.noMaterial,false);
    assert.equal(current.prompt.user,composeProseReviewContext(current.sources,language),'the portable draft uses the exact original Desktop language prompt');
    assert.equal(baseline.sources.prose,'Texto guardado','consulting the local draft cannot mutate the stored scene');
  }
  assert.throws(()=>prose.validateProseDraft({...draft,beats:[...draft.beats,...draft.beats]}),/duplicate_prose_draft_beat/);
  assert.throws(()=>prose.validateProseDraft({...draft,beats:[{...draft.beats[0],mark:'step'}]}),/invalid_prose_draft_beat/);
  assert.notEqual(prose.proseDraftRevisionInput('a'.repeat(64),draft),prose.proseDraftRevisionInput('a'.repeat(64),{...draft,text:'Actualización'}));
  database=require('../electron/db/database.ts');database.getDb();
  const vaults=require('../electron/vaults/vaultRegistry.ts'),vault=vaults.createVault('Síntesis companion aisladas','academic');
  const academic=require('../electron/desktopBridge/academicGeneration.ts'),authors=require('../electron/ai/authorDossier.ts'),{withMobileOperation}=require('../electron/desktopBridge/executionBoundary.ts');
  await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,()=>withMobileOperation(()=>{
    const db=database.getDb();
    db.prepare('INSERT INTO authors(author_id,name,canonical_key) VALUES(?,?,?)').run('real-author','Autora real','real-author');
    db.prepare('INSERT INTO works(nodus_id,title,authors_json,archived,read_tag) VALUES(?,?,?,0,0)').run('real-work','Obra real','["Autora real"]');
    db.prepare('INSERT INTO work_authors(nodus_id,author_id,role) VALUES(?,?,?)').run('real-work','real-author','author');
    db.prepare('INSERT INTO themes(theme_id,label) VALUES(?,?)').run('real-theme','Tema real');
    for(let index=0;index<3;index++){
      db.prepare('INSERT INTO ideas(global_id,type,label,statement) VALUES(?,?,?,?)').run(`real-idea-${index}`,'claim',`Idea ${index}`,`Afirmación ${index}`);
      db.prepare('INSERT INTO idea_occurrences(global_id,nodus_id,role,confidence) VALUES(?,?,?,?)').run(`real-idea-${index}`,'real-work','central',0.9);
      db.prepare('INSERT INTO idea_theme_links(global_id,nodus_id,theme_id) VALUES(?,?,?)').run(`real-idea-${index}`,'real-work','real-theme');
    }
    const request={kind:'author',authorId:'real-author',language:'es'},before=db.prepare('SELECT total_changes() AS n').get().n;
    const source=academic.mobileAcademicSource(request);assert.match(source.revision,/^[a-f0-9]{64}$/);assert.ok(source.source.prompt.user.includes('Autora real'));assert.equal(source.source.prompt.system,authors.prepareAuthorDossierSynthesis('real-author','es').prompt.system);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
    const response={thesis:' Tesis del móvil ',remember:[' Punto real ',''],positioning:' Posición '};
    const input={request,revision:source.revision,raw:JSON.stringify(response),model:{provider:'openai',model:'phone-only-model'},requestId:randomUUID(),generatedAt:'2026-10-11T08:00:00Z'};
    const result=academic.saveMobileAcademicResult(input);assert.equal(result.thesis,'Tesis del móvil');assert.deepEqual(result.remember,['Punto real']);assert.deepEqual(academic.saveMobileAcademicResult(input),result);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mobile_academic_publications').get().n,1);
    assert.equal(authors.buildAuthorDossier('real-author').synthesis.thesis,'Tesis del móvil');
    assert.throws(()=>academic.saveMobileAcademicResult({...input,raw:'{}'}),/idempotency_conflict/);
    db.prepare('UPDATE ideas SET statement=? WHERE global_id=?').run('Texto ajeno cambiado','real-idea-0');
    assert.throws(()=>academic.saveMobileAcademicResult({...input,requestId:randomUUID()}),/academic_source_conflict/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mobile_academic_publications').get().n,1);
    const matrixRequest={kind:'matrix',authorId:'real-author',themeId:'real-theme',language:'es'},matrix=academic.mobileAcademicSource(matrixRequest);
    const cell=academic.saveMobileAcademicResult({...input,request:matrixRequest,revision:matrix.revision,raw:'{"stance":" Posición en el tema "}',requestId:randomUUID()});
    assert.equal(cell.ideaCount,3);assert.equal(cell.stance,'Posición en el tema');assert.equal(db.prepare('SELECT stance FROM synthesis_matrix_cell WHERE author_id=? AND theme_id=?').get('real-author','real-theme').stance,cell.stance);
    assert.throws(()=>academic.mobileAcademicSource({...request,method:'arbitrary'}),/invalid_academic_source/);
    const argumentRequest={kind:'argument',seedIdeaId:'real-idea-0',language:'es'},argument=academic.mobileAcademicSource(argumentRequest);
    const argumentInput={...input,request:argumentRequest,revision:argument.revision,raw:'{}',requestId:randomUUID()};
    const map=academic.saveMobileAcademicResult(argumentInput);assert.equal(map.root.ideaId,'real-idea-0');assert.deepEqual(academic.saveMobileAcademicResult(argumentInput),map);
    const catalogue=academic.listSavedCompanionArgumentMaps(null,1);assert.equal(catalogue.items.length,1);assert.equal(catalogue.items[0].id,argumentInput.requestId);assert.deepEqual(catalogue.items[0].map,map);
    const liveId=randomUUID(),liveArgs=[{seedIdeaId:'real-idea-0',mode:'ai'}];
    assert.deepEqual(academic.saveCompanionLiveArgumentMap(liveId,liveArgs,map),map);
    assert.deepEqual(academic.savedCompanionLiveArgumentMap(liveId),map);
    assert.deepEqual(academic.saveCompanionLiveArgumentMap(liveId,liveArgs,{...map,overview:'Must not replace a completed receipt'}),map);
    assert.throws(()=>academic.saveCompanionLiveArgumentMap(liveId,[{seedIdeaId:'other',mode:'ai'}],map),/idempotency_conflict/);
    assert(academic.listSavedCompanionArgumentMaps(null,100).items.some(item=>item.id===liveId));
    assert.throws(()=>withMobileOperation(()=>academic.saveMobileAcademicResult(input),['corpus']),/permission_denied/);
    assert.equal(providers,0);
  },['corpus','writing'])));
  const world=vaults.createVault('Borrador de escena aislado','worldbuilding');
  await vaults.withOwningVault(world.id,()=>database.withVaultDatabase(world.id,()=>withMobileOperation(()=>{
    const {createScene}=require('../electron/db/worldStoryRepo.ts'),{prepareWorldProseReview}=require('../electron/ai/worldProseReview.ts');
    const scene=createScene({title:'Escena guardada'}),baseRequest={kind:'prose',sceneId:scene.sceneId,language:'es'};
    const db=database.getDb(),before=db.prepare('SELECT total_changes() AS n').get().n;
    const baseline=academic.mobileAcademicSource(baseRequest),request={...baseRequest,draft};
    const captured=academic.mobileAcademicSource(request);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before,'capturing a draft cannot materialise text or beats');
    assert.equal(captured.source.sources.prose,'Ada cruza Puerta.');assert.equal(captured.source.sources.sceneTitle,'Título local');
    assert.equal(captured.revision,createHash('sha256').update(prose.proseDraftRevisionInput(baseline.revision,draft)).digest('hex'));
    const input={request,revision:captured.revision,raw:'LATIDO: sí — Cruza la puerta.',model:{provider:'phone',model:'model'},requestId:randomUUID(),generatedAt:'2026-10-11T12:00:00.000Z'};
    const result=academic.saveMobileAcademicResult(input);
    assert.equal(result.beats[0].threadId,'real-rule');assert.equal(result.beats[0].present,true);
    assert.deepEqual(academic.saveMobileAcademicResult(input),result);
    assert.equal(prepareWorldProseReview(scene.sceneId,'es').sources.prose,'');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM world_beats WHERE scene_id=?').get(scene.sceneId).n,0);
    const pending={...input,requestId:randomUUID()};
    db.prepare('UPDATE world_scenes SET title=? WHERE scene_id=?').run('Título cambiado en Mac',scene.sceneId);
    assert.throws(()=>academic.saveMobileAcademicResult(pending),/academic_source_conflict/);
    assert.equal(providers,0);
  },['corpus','writing'])));
  const offlineWorld=vaults.createVault('Escena autónoma antes de sincronizar','worldbuilding');
  const sceneId=`scn_${randomUUID()}`,ruleId=`rul_${randomUUID()}`,creationMutationId=randomUUID(),grant='phone-creation';
  const baselineDraft={sceneTitle:'Escena nueva del móvil',text:'',beats:[{threadKind:'rule',threadId:ruleId,threadTitle:'La puerta',mark:'breaks',text:'Se paga.'}]};
  const currentDraft={...baselineDraft,text:'Ada cruza la puerta pagando el precio.'};
  const request={kind:'prose',sceneId,language:'es',draft:currentDraft},template=prose.portableProseReviewTemplate('es');
  const {canonicalJson}=require('../shared/canonicalJson.ts');
  const sha=value=>createHash('sha256').update(value).digest('hex');
  const packaged=JSON.parse(fs.readFileSync(new URL('../../nodus-mobile/ios/Packages/NodusKit/Sources/NodusKit/Resources/prose-draft-templates.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(packaged.templates).sort(),[...PROMPT_LANGUAGES].sort());
  for(const language of PROMPT_LANGUAGES){const source=prose.portableProseReviewTemplate(language);assert.deepEqual(packaged.templates[language].source,source);assert.equal(packaged.templates[language].templateRevision,sha(canonicalJson(source)));}
  const seed=sha(prose.localSceneBaselineRevisionInput(sceneId,'es',creationMutationId,sha(canonicalJson(template))));
  const input={request,revision:sha(prose.proseDraftRevisionInput(sha(prose.proseDraftRevisionInput(seed,baselineDraft)),currentDraft)),
    localScene:{creationMutationId,baselineDraft},raw:'LATIDO: sí — Se paga.',model:{provider:'phone',model:'model'},requestId:randomUUID(),generatedAt:new Date().toISOString()};
  const capture=()=>vaults.withOwningVault(offlineWorld.id,()=>database.withVaultDatabase(offlineWorld.id,()=>withMobileOperation(()=>academic.saveMobileAcademicResult(input,grant),['corpus','writing'])));
  await assert.rejects(capture,/local_scene_creation_unconfirmed/,'A provider result cannot claim its Mac scene has already been created');
  const {applyBridgeMutations}=require('../electron/desktopBridge/mutations.ts'),stamp=new Date().toISOString(),times={created_at:stamp,updated_at:stamp};
  const mutation=(id,table,key,row)=>({id,kind:'upsert',clientId:grant,table,key,row,assets:[],schemaVersion:database.SCHEMA_VERSION,createdAt:stamp});
  const edits=[mutation(creationMutationId,'world_scenes',[sceneId],{scene_id:sceneId,title:baselineDraft.sceneTitle,narrative_order:0,...times}),
    mutation(randomUUID(),'world_rules',[ruleId],{rule_id:ruleId,title:'La puerta',title_key:'la puerta',...times}),
    mutation(randomUUID(),'world_beats',['rule',ruleId,sceneId],{thread_kind:'rule',thread_id:ruleId,scene_id:sceneId,mark:'breaks',text:'Se paga.',...times})];
  assert.equal((await applyBridgeMutations(offlineWorld.id,grant,edits,['corpus','writing'])).applied.length,3);
  await vaults.withOwningVault(offlineWorld.id,()=>database.withVaultDatabase(offlineWorld.id,()=>withMobileOperation(()=>{
    assert.throws(()=>academic.saveMobileAcademicResult(input,'different-phone'),/local_scene_creation_unconfirmed/);
    const result=academic.saveMobileAcademicResult(input,grant);assert.equal(result.beats[0].present,true);
    assert.deepEqual(academic.saveMobileAcademicResult(input,grant),result);
    const db=database.getDb();
    assert.equal(db.prepare('SELECT count(*) n FROM world_scene_text WHERE scene_id=?').get(sceneId).n,0,'Reviewing an unsaved draft cannot write its prose');
    db.prepare('UPDATE world_scenes SET title=? WHERE scene_id=?').run('Cambio posterior del Mac',sceneId);
    assert.throws(()=>academic.saveMobileAcademicResult({...input,requestId:randomUUID()},grant),/academic_source_conflict/);
    assert.deepEqual(academic.saveMobileAcademicResult(input,grant),result,'A completed receipt survives later canonical changes');
    assert.equal(providers,0);
  },['corpus','writing'])));
  console.log('Canonical academic sources, current manuscript drafts, persisted argument catalogue, provider-free publication, duplicate receipt and source conflict passed.');
}finally{globalThis.fetch=fetch;database?.closeDb();fs.rmSync(root,{recursive:true,force:true});}
