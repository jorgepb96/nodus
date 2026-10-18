import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { build } from 'esbuild';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-background-process-'));
const require = createRequire(import.meta.url);
let worker;
try {
  const host = path.join(root, 'host.cjs');
  await build({ entryPoints: ['electron/workers/backgroundProcess.ts'], outfile: host, bundle: true, platform: 'node', format: 'cjs',
    plugins: [{ name: 'no-electron-main', setup(build) {
      build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'exports.utilityProcess = undefined', loader: 'js' }));
    } }] });
  const port = path.join(root, 'port.cjs');
  await build({ entryPoints: ['electron/workers/backgroundParentPort.ts'], outfile: port, bundle: true, platform: 'node', format: 'cjs' });
  const source = path.join(root, 'fixture.cjs');
  fs.writeFileSync(source, `const {parentPort}=require('./port.cjs');parentPort.on('message', value=>{parentPort.postMessage({pid:process.pid,value});if(value.block)while(true){}});`);
  const { backgroundProcess } = require(host);
  worker = backgroundProcess(source, 'Nodus isolated process fixture');
  const reply = once(worker, 'message');
  worker.postMessage({ payload: Buffer.from('synthetic') });
  const [message] = await reply;
  assert.notEqual(message.pid, process.pid, 'heavy work must use a distinct OS process');
  assert.equal(message.pid, worker.pid);
  assert.equal(Buffer.from(message.value.payload).toString(), 'synthetic');
  const blocked = once(worker, 'message');
  worker.postMessage({ block: true });
  await blocked;
  await worker.terminate();
  assert.throws(() => process.kill(message.pid, 0), error => error.code === 'ESRCH', 'cancellation waits for the owned process to exit even during synchronous work');
  const noisy = path.join(root, 'noisy.cjs');
  fs.writeFileSync(noisy, `process.stdout.write('qa stdout marker\\n');process.stderr.write('qa stderr marker\\n');setTimeout(()=>process.exit(0),50);`);
  worker = backgroundProcess(noisy, 'Default output remains discarded');
  const discarded = [];
  worker.on('output', event => discarded.push(event));
  await once(worker, 'exit');
  assert.equal(discarded.length, 0, 'stdout/stderr capture stays off by default');
  worker = backgroundProcess(noisy, 'QA output capture fixture', { captureOutput: true });
  const output = [];
  worker.on('output', event => output.push(event));
  await once(worker, 'exit');
  assert(output.some(event => event.stream === 'stdout' && event.data.includes('qa stdout marker')));
  assert(output.some(event => event.stream === 'stderr' && event.data.includes('qa stderr marker')));
  worker = backgroundProcess(path.join(root, 'absent.cjs'), 'Missing test entry');
  assert.notEqual((await once(worker, 'exit'))[0], 0, 'a worker startup failure is observable');
  await worker.terminate();
  worker = null;
  console.log('Background processes: distinct PID, IPC, synchronous cancellation and startup failure passed');
} finally {
  if (worker) await worker.terminate();
  fs.rmSync(root, { recursive: true, force: true });
}
