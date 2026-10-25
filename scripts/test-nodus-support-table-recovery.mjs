import test from 'node:test';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';

test('table recovery commits the readable prefix when a source page fails between batches',async()=>{
 const folder=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-recover-prefix-'))),profile=path.join(folder,'copy');fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'nodus.sqlite'),'synthetic unchanged source');
 const file=path.join(folder,'probe.mjs');
 try {
  await build({stdin:{contents:`import assert from 'node:assert/strict';import fs from 'node:fs';import {recoverReadableTables}from'./electron/support/diagnostics.ts';const profile=process.env.NODUS_SUPPORT_TEST_PROFILE;const result=recoverReadableTables(profile);assert.deepEqual(result,{rows:501,tables:0,partial:true});assert.equal(globalThis.recoveredRows.length,501);assert.equal(globalThis.commits,2);assert.equal(fs.readFileSync(profile+'/nodus.sqlite','utf8'),'synthetic unchanged source');`,resolveDir:path.resolve(import.meta.dirname,'..')},outfile:file,bundle:true,format:'esm',platform:'node',plugins:[{name:'corrupt-page',setup(builder){
    builder.onResolve({filter:/^node:module$/},()=>({path:'native',namespace:'test-recovery'}));
    builder.onLoad({filter:/.*/,namespace:'test-recovery'},()=>({contents:`
      globalThis.recoveredRows=[];globalThis.commits=0;
      class Database {
        constructor(file){this.source=file.endsWith('nodus.sqlite');this.inTransaction=false;this.pending=[];}
        defaultSafeIntegers(){}close(){this.pending=[];}pragma(){return 'ok';}
        exec(sql){if(sql==='BEGIN IMMEDIATE'){this.inTransaction=true;this.pending=[];}if(sql==='COMMIT'){globalThis.recoveredRows.push(...this.pending);this.pending=[];this.inTransaction=false;globalThis.commits++;}if(sql==='ROLLBACK'){this.pending=[];this.inTransaction=false;}}
        prepare(sql){if(!this.source)return {run:(...values)=>this.pending.push(values)};if(sql.includes('sqlite_master'))return {all:()=>[{name:'events'}]};if(sql.startsWith('PRAGMA'))return {all:()=>[{name:'id',type:'INTEGER'}]};return {raw:()=>({iterate:function*(){for(let i=0;i<501;i++)yield [BigInt(i)];throw new Error('SQLITE_CORRUPT');}})};}
      }
      export const createRequire=()=>()=>Database;
    `,loader:'js'}));
  }}]});
  execFileSync(process.execPath,[file],{env:{...process.env,NODUS_SUPPORT_TEST_PROFILE:profile},stdio:'pipe'});
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
