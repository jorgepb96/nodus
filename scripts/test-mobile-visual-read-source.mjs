// Fictional, self-contained SQLite regression for persisted versus live-labelled reads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--visual-read-source'))process.exit(0);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-visual-read-source-'));
const runtime=installRuntimeHooks(scratch),require=createRequire(import.meta.url);
runtime.app.on=()=>{};runtime.app.once=()=>{};
let database;
try {
 database=require('../electron/db/database.ts');
 const vaults=require('../electron/vaults/vaultRegistry.ts'),vault=vaults.createVault('Fictional visual source','academic');
 await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,async()=>{
  const db=database.getDb(),id='48309d71-e141-4689-9463-82f591e6d874',work='fictional-visual-source';
  db.prepare('INSERT INTO works(nodus_id,zotero_key,title,authors_json,year) VALUES(?,?,?,?,?)').run(work,'FICTION1','Fictional source',JSON.stringify(['Beatriz Sol']),2001);
  const {saveWritingWorkshopDraft,getWritingWorkshopDraft}=require('../electron/db/writingDraftsRepo.ts');
  const raw={title:'Fictional report',abstract:'',draftMarkdown:`A fictional sentence [Luna, A. (2001)](nodus://work/${work}).`,brief:{kind:'deep_research',language:'es'},selection:{workIds:[work],ideaIds:[]},bibliography:[]};
  saveWritingWorkshopDraft({draft:raw},id);
  // Bypass no source rules: this is the actual canonical read-time relabelling.
  const current=getWritingWorkshopDraft(id).draft;
  assert.notEqual(raw.draftMarkdown,current.draftMarkdown,'fixture must exercise genuinely changed generated citation labels');
  assert.match(current.draftMarkdown,/Sol/);
  const persisted=JSON.parse(db.prepare('SELECT draft_json FROM writing_saved_drafts WHERE id=?').get(id).draft_json);
  assert.equal(persisted.draftMarkdown,raw.draftMarkdown,'read-time byline correction must not rewrite stored prose');
  const {readMobileDeepResearchVisualAsset}=require('../electron/desktopBridge/researchVisualSource.ts');
  const {executeMobileOperation}=require('../electron/desktopBridge/operations.ts');
  const target={kind:'deep-research',id},request=expectedDraft=>({action:'context',reportId:id,expectedDraft});
  const before=db.prepare('SELECT total_changes() n').get().n;
  for(const draft of [persisted,current]) {
   assert.equal(readMobileDeepResearchVisualAsset(request(draft)).manifest,null,'a report without figures is a successful empty visual context');
   assert.equal(await executeMobileOperation(vault.id,['corpus'],'getDocumentVisuals',[target,{expectedDraft:draft}]),null,'legacy read endpoint uses the same exact-source fence');
  }
  for(const draft of [persisted,current]) {
   const changed={...draft,draftMarkdown:draft.draftMarkdown+'\n\nDifferent factual prose.'};
   assert.throws(()=>readMobileDeepResearchVisualAsset(request(changed)),/research_visual_source_revision_conflict/);
   await assert.rejects(executeMobileOperation(vault.id,['corpus'],'getDocumentVisuals',[target,{expectedDraft:changed}]),/research_visual_source_revision_conflict/);
  }
  assert.throws(()=>readMobileDeepResearchVisualAsset(request({...persisted,title:'Different report'})),/research_visual_source_revision_conflict/);
  assert.throws(()=>readMobileDeepResearchVisualAsset({...request(persisted),reportId:'58309d71-e141-4689-9463-82f591e6d874'}),/research_visual_source_revision_conflict/);
  assert.throws(()=>readMobileDeepResearchVisualAsset({reportId:id,assetId:'68309d71-e141-4689-9463-82f591e6d874',owner:'a'.repeat(64),offset:0,count:1,expected:{contentHash:'0'.repeat(64),revision:null}}),/research_visual_source_revision_conflict/);
  assert.equal(db.prepare('SELECT total_changes() n').get().n,before,'all source checks remain read-only and never create authoring proof or assets');
  console.log('PASS fictional SQLite: persisted/current citation projections, both reader endpoints, real body/title/target/hash rejection; no provider or user corpus.');
 }));
} finally {database?.closeDb();fs.rmSync(scratch,{recursive:true,force:true});}
