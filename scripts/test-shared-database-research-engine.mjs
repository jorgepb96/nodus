import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-shared-db-engine-'));
const runtime=installRuntimeHooks(directory),require=createRequire(import.meta.url);
const engine=require('../shared/databaseResearchEngine.ts');
const completion=require('../shared/databaseResearchCompletion.ts');
test('portable SHA-256 retains Desktop snapshot fingerprints for Unicode and key order',()=>{
  for(const value of [{b:1,a:'🌊/ñ'},[0,null,false,{'z':1,'a':[2,3]}],{wide:'A'.repeat(200_000)}]) {
    const canonical=JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
    assert.equal(engine.sha256Snapshot(value),createHash('sha256').update(canonical).digest('hex'));
  }
});
test('shared calculations verify exact claims and reject unsupported model operations',()=>{
  const columns=[{id:'metric',databaseId:'database',type:'number',name:'Métrica',config:{},position:0}];
  const rows=[2,4,6].map((value,i)=>({id:`row-${i}`,databaseId:'database',position:i,cells:{metric:String(value)}}));
  const snapshot={databaseId:'database',databaseName:'Datos',revision:37,rowCount:3,totalRowCount:3,truncated:false,columns:['metric'],rows,relationEdges:[],capturedAt:'2026-10-11T00:00:00Z',hash:'source'};
  const deps={readSnapshot:()=>snapshot,readColumns:()=>columns,now:()=>snapshot.capturedAt};
  const request={databaseId:'database',objective:'Media exacta',seed:37,plan:{steps:[{id:'mean',operation:'describe',columnId:'metric'}]}};
  const result=engine.runDatabaseDeepResearch(request,deps,[{stepId:'mean',path:'mean',expected:4},{stepId:'mean',path:'mean',expected:99}]);
  assert.equal(result.claims[0].verified,true);assert.equal(result.claims[1].verified,false);
  assert.equal(result.evidence[0].n,3);assert.equal(result.evidence[0].hash.length,64);
  assert.throws(()=>engine.runDatabaseDeepResearch({...request,plan:{steps:[{operation:'executeSQL'}]}},deps),/operation|unsupported|allowed/i);
  assert.throws(()=>engine.runDatabaseDeepResearch(request),/immutable research source/);
});
test('shared prompts expose artifacts while redacting raw aggregate labels',()=>{
  const result=completion.databaseResearchCompletionInput({role:'writer',objective:'Comparar',model:{provider:'mobile',model:'chosen'},evidence:[{stepId:'private-row',operation:'frequencies',columnIds:['column-secret'],n:2,hash:'a'.repeat(64),value:{counts:{'private-user-value':2},warnings:['private-text']}}]});
  assert(!result.user.includes('private-user-value'));assert(!result.user.includes('private-text'));assert(!result.user.includes('column-secret'));assert(result.user.includes('a'.repeat(64)));
});
test.after(()=>{runtime.restore();fs.rmSync(directory,{recursive:true,force:true});});
