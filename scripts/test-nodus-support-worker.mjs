import test from 'node:test';
import assert from 'node:assert/strict';
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
