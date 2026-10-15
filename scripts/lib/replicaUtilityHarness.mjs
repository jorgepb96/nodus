import { build } from 'esbuild';
import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';

/** A genuine separate Node/Electron process, using the same message contract as utilityProcess. */
export async function replicaUtilityHarness(directory) {
  const worker = path.join(directory,'replica-worker.cjs');
  await build({entryPoints:['electron/serverSync/serverReplicaWorker.ts'],outfile:worker,bundle:true,platform:'node',format:'cjs',target:'node24',alias:{'@shared':path.resolve('shared')},external:['better-sqlite3','*.node'],
    banner:{js:`process.parentPort={on:(_event,listener)=>process.on('message',data=>listener({data})),postMessage:data=>process.send(data)};`} });
  const children = new Set();
  return { worker, utilityProcess:{fork(file) {
    const emitter = new EventEmitter();
    const child = fork(file,[],{execPath:process.execPath,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:`${path.resolve('node_modules')}${path.delimiter}${process.env.NODE_PATH||''}`} ,stdio:['ignore','pipe','pipe','ipc']});
    children.add(child);
    child.on('message',message=>emitter.emit('message',message));
    child.on('exit',code=>{children.delete(child);emitter.emit('exit',code);});
    child.on('error',()=>emitter.emit('exit',-1));
    emitter.postMessage = data=>child.send(data);
    emitter.kill = ()=>child.kill();
    emitter.stdout=child.stdout; emitter.stderr=child.stderr;
    return emitter;
  }}, cleanup(){for(const child of children) child.kill();} };
}
