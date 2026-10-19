import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {runProbe} from '../apps/nodus-support/core/probe.mjs';

test('worker progress is bounded, validated and survives oversized private console output',async()=>{
  const root='/synthetic-copy',events=[];
  const frames=[{protocol:1,root,phase:'restoring',completed:10,total:20,private:'never expose this'}, {protocol:1,root:'/wrong',phase:'restoring',completed:20,total:20}];
  const script=`process.stdout.write('private canary '.repeat(100000)+'\\n');${frames.map(frame=>`process.stdout.write(${JSON.stringify(`@@NODUS_SUPPORT_PROGRESS@@${JSON.stringify(frame)}\n`)});`).join('')}process.stdout.write(${JSON.stringify(`@@NODUS_SUPPORT@@${JSON.stringify({protocol:1,root,ok:true,code:'ARCHIVE_RECOVERED'})}\n`)});`;
  const result=await runProbe({executable:process.execPath,args:['-e',script],root,action:'restore-archive',progress:value=>events.push(value)});
  assert.equal(result.ok,true);assert.deepEqual(events,[{phase:'restoring',completed:10,total:20}]);assert.ok(!JSON.stringify({events,result}).includes('canary'));
});
test('a cancelled worker terminates its own process',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(runProbe({executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],root:'/synthetic',action:'fresh-profile',signal:controller.signal}),/TEST_CANCELLED/);
});
test('a GUI worker can complete with a durable outcome and no stdout',async()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-outcome-')));
  try {
    const script=`const fs=require('node:fs'),path=require('node:path');if('ELECTRON_RUN_AS_NODE' in process.env)process.exit(9);const root=process.env.NODUS_ISOLATED_ROOT,requestId=process.env.NODUS_SUPPORT_REQUEST_ID;const fd=fs.openSync(path.join(root,'probe-result-'+requestId+'.json'),'wx',0o600);fs.writeFileSync(fd,JSON.stringify({requestId,root,protocol:1,ok:true,code:'CONFIGURATION_CHECKED'}));fs.fsyncSync(fd);fs.closeSync(fd);`;
    const result=await runProbe({executable:process.execPath,args:['-e',script],root,action:'configuration-check'});
    assert.equal(result.ok,true);assert.equal(result.code,'CONFIGURATION_CHECKED');
    assert.equal(fs.readdirSync(root).length,1,'The completed outcome remains available locally');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('stale outcomes and private stderr cannot become a successful or public result',async()=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-outcome-'))),seen=[];
  try {
    fs.writeFileSync(path.join(root,'probe-result-old.json'),JSON.stringify({protocol:1,root,ok:true}));
    await assert.rejects(runProbe({executable:process.execPath,args:['-e',`process.stderr.write('synthetic private canary');process.exit(7)`],root,action:'configuration-check',diagnostic:value=>seen.push(value)}),error=>error.code==='PROBE_NO_RESULT'&&!JSON.stringify(error).includes('canary'));
    assert.equal(seen[0].exitCode,7);assert.match(seen[0].stderr,/canary/);
    const retained=fs.readdirSync(root).filter(name=>name.startsWith('probe-private-'));assert.equal(retained.length,1);assert.match(fs.readFileSync(path.join(root,retained[0]),'utf8'),/PRIVATE.*personal data[\s\S]*canary/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
