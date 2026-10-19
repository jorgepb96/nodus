import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SupportError } from './files.mjs';

export function runProbe({ executable, args = [], root, action, signal, password, progress=()=>{}, diagnostic=()=>{} }) {
  return new Promise((resolve, reject) => {
    // A narrow bootstrap protocol validates and selects the copy before any normal imports.
    const requestId=randomUUID();
    const env={ ...process.env, NODUS_SUPPORT_REQUEST_ID:requestId, NODUS_SUPPORT_PROBE: '1', NODUS_SUPPORT_ACTION: action, NODUS_ISOLATED_ROOT: root, NODUS_DISABLE_AUTO_UPDATE: '1' };
    delete env.ELECTRON_RUN_AS_NODE;delete env.NODUS_USERDATA;delete env.NODUS_SUPPORT_INTERACTIVE;
    const child = spawn(executable, args, {
      env,
      stdio: ['pipe','pipe','pipe'], windowsHide: true,
    });
    child.stdin.on('error', () => {});
    child.stdin.end(password === undefined ? '' : JSON.stringify({ password }));
    let pending='',stderr='',result;let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); if (error) reject(error); else resolve(result); };
    const cancel = () => { child.kill('SIGTERM'); finish(new SupportError('TEST_CANCELLED')); };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new SupportError('TEST_TIMEOUT')); }, action === 'restore-archive' ? 30 * 60 * 1000 : 60000);
    const consume=line=>{
      try {
        if(line.startsWith('@@NODUS_SUPPORT@@'))result=JSON.parse(line.slice(17));
        else if(line.startsWith('@@NODUS_SUPPORT_PROGRESS@@')) {
          const value=JSON.parse(line.slice(26));
          if(value.protocol===1&&value.root===root&&['preparing','decrypting','verifying','restoring','finalizing','complete'].includes(value.phase)&&Number.isSafeInteger(value.completed)&&value.completed>=0&&Number.isSafeInteger(value.total)&&value.total>=value.completed)progress({phase:value.phase,completed:value.completed,total:value.total});
        }
      }catch{/* Ignore console output and malformed frames; require a final result. */}
    };
    child.stdout.on('data',chunk=>{const lines=(pending+chunk.toString()).split('\n');pending=lines.pop().slice(-65536);for(const line of lines)if(line.length<=65536)consume(line);});
    // Bounded private diagnostics are only sent to an explicitly supplied local
    // observer (the synthetic CI harness). They never enter the public result.
    child.stderr.on('data', chunk => { stderr=(stderr+chunk.toString()).slice(-32768); });
    child.on('error', () => finish(new SupportError('RUNTIME_UNAVAILABLE')));
    child.on('close', (exitCode,exitSignal) => {
      consume(pending);
      // Windows GUI processes do not always expose a usable stdout pipe. A
      // unique durable outcome also avoids depending on stdout flushing at quit.
      const file=path.join(root,`probe-result-${requestId}.json`);
      try {
        const stat=fs.lstatSync(file);
        if(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=65536) {
          const saved=JSON.parse(fs.readFileSync(file,'utf8'));
          if(saved.requestId===requestId&&saved.protocol===1&&saved.root===root)result=saved;
        }
      }catch{/* Missing or interrupted outcomes fail closed unless stdout completed. */}
      if (!result) { try{diagnostic({exitCode,signal:exitSignal,stderr});}catch{/* Observers cannot change the outcome. */}return finish(new SupportError('PROBE_NO_RESULT')); }
      finish(null,result);
    });
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
  });
}
