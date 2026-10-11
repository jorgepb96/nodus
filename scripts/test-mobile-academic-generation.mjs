import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-academic'))process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-companion-academic-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),fetch=globalThis.fetch;let database,providers=0;
globalThis.fetch=async()=>{providers++;throw new Error('Source capture and publication must not use a provider');};
try{
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
    assert.throws(()=>withMobileOperation(()=>academic.saveMobileAcademicResult(input),['corpus']),/permission_denied/);
    assert.equal(providers,0);
  },['corpus','writing'])));
    console.log('Canonical academic sources, persisted argument catalogue, provider-free publication, duplicate receipt and source conflict passed.');
}finally{globalThis.fetch=fetch;database?.closeDb();fs.rmSync(root,{recursive:true,force:true});}
