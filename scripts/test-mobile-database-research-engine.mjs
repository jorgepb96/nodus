import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-database-engine-')),runtime=installRuntimeHooks(directory),require=createRequire(import.meta.url);
const engine=require('../shared/databaseResearchEngine.ts'),mobile=require('../shared/mobileDatabaseResearch.ts');
function fixture() {
  const database={id:'database',shortId:'DB-37',name:'Datos elegidos',icon:null,position:0,rowCount:20,createdAt:'2026-10-11T00:00:00Z',updatedAt:'2026-10-11T00:00:00Z'};
  const columns=[{id:'metric',databaseId:database.id,name:'Métrica',type:'number',position:0,config:{},options:[]}];
  const rows=Array.from({length:20},(_,i)=>({id:`row-${i}`,databaseId:database.id,position:i,cells:{metric:String(i+1)}}));
  const snapshot={databaseId:database.id,databaseName:database.name,revision:37,rowCount:20,totalRowCount:20,truncated:false,columns:['metric'],rows,relationEdges:[],capturedAt:database.createdAt,hash:''};snapshot.hash=engine.rehashDatabaseResearchSnapshot(snapshot);
  const pack={version:1,vaultId:'vault',capturedAt:database.createdAt,id:'',signature:'0'.repeat(64),databases:[{database,snapshot,columns,views:[],viewRows:{},viewId:null,viewRevision:null}]};pack.id=engine.sha256Snapshot(mobile.databaseSourcePackPayload(pack));
  const request={databaseIds:[database.id],objective:'Describir la métrica',depth:'focused',language:'es',reportType:'general',autoConfigure:false,model:{provider:'openai',model:'fixture'},viewIds:[],filters:{query:'',columnIds:[]},roles:{},planSections:[]};
  return {pack,request};
}
test('a complete chosen source produces the shared verified report without a provider',async()=>{
  const {pack,request}=fixture(),sources=mobile.mobileDatabaseSources([pack],request.databaseIds);
  const repository=new mobile.MobileDatabaseResearchRepository(mobile.createMobileDatabaseResearchDetail('dbr_mobile_00000000-0000-4000-8000-000000000037',request,sources));
  const report=await engine.processDatabaseResearchRun(repository.detail.run.id,{},mobile.mobileDatabaseResearchHost(repository,sources,async(...args)=>engine.runDatabaseDeepResearch(...args)));
  assert(['completed','partial'].includes(report.run.status));assert(report.report.markdown.length>0);assert(report.report.structured.evidence.length>0);
  assert.equal(report.report.runId,repository.detail.run.id);assert.equal(report.report.provenance.promptVersion,require('../shared/databaseDeepResearchPrompts.ts').DATABASE_DEEP_RESEARCH_PROMPT_VERSION);
  assert.equal(report.run.snapshotManifest.downloadedSourceProbe.verified,true);assert.equal(report.run.snapshotManifest.sqliteReadonlyProbe,undefined);
  assert.equal(pack.databases[0].snapshot.rows.length,20,'The persisted source remains immutable');
  const restored=new mobile.MobileDatabaseResearchRepository(JSON.parse(JSON.stringify(report)));
  assert.equal(restored.getDatabaseResearchRunDetail(report.run.id).report.id,report.report.id);
});
test('incomplete, damaged and unselected data cannot enter a model pipeline',()=>{
  const {pack,request}=fixture();
  const truncated=structuredClone(pack);truncated.databases[0].snapshot.rows.pop();assert.throws(()=>mobile.mobileDatabaseSources([truncated],request.databaseIds),/source_pack/);
  const changed=structuredClone(pack);changed.databases[0].snapshot.rows[0].cells.metric='999';assert.throws(()=>mobile.mobileDatabaseSources([changed],request.databaseIds),/source_pack/);
  assert.throws(()=>mobile.mobileDatabaseSources([pack],['foreign-database']),/no está descargada/);
  const sources=mobile.mobileDatabaseSources([pack],request.databaseIds);
  assert.throws(()=>mobile.createMobileDatabaseResearchDetail('run',{...request,roles:{outcome:'foreign-column'}},sources),/roles_or_views/);
});
test('cancelling a calculation never saves an available report',async()=>{
  const {pack,request}=fixture(),sources=mobile.mobileDatabaseSources([pack],request.databaseIds),repository=new mobile.MobileDatabaseResearchRepository(mobile.createMobileDatabaseResearchDetail('cancelled',request,sources));
  const host=mobile.mobileDatabaseResearchHost(repository,sources,async(...args)=>{repository.detail.run.status='cancelling';return engine.runDatabaseDeepResearch(...args);});
  await assert.rejects(engine.processDatabaseResearchRun(repository.detail.run.id,{},host),/cancel/i);
  assert.equal(repository.detail.run.status,'cancelled');assert.equal(repository.detail.report,null);
});
test.after(()=>{runtime.restore();fs.rmSync(directory,{recursive:true,force:true});});
