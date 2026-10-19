import { spawn } from 'node:child_process';
import { SupportError } from './files.mjs';

export function runProbe({ executable, args = [], root, action, signal, password, progress=()=>{} }) {
  return new Promise((resolve, reject) => {
    // A narrow bootstrap protocol validates and selects the copy before any normal imports.
    const child = spawn(executable, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', NODUS_SUPPORT_PROBE: '1', NODUS_SUPPORT_ACTION: action, NODUS_ISOLATED_ROOT: root, NODUS_USERDATA: '', NODUS_DISABLE_AUTO_UPDATE: '1' },
      stdio: ['pipe','pipe','pipe'], windowsHide: true,
    });
    child.stdin.on('error', () => {});
    child.stdin.end(password === undefined ? '' : JSON.stringify({ password }));
    let pending='',result;let settled = false;
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
    // Drain stderr without putting provider errors, user paths or memory dumps in public reports.
    child.stderr.on('data', () => {});
    child.on('error', () => finish(new SupportError('RUNTIME_UNAVAILABLE')));
    child.on('close', () => {
      consume(pending);
      if (!result) return finish(new SupportError('PROBE_NO_RESULT'));
      finish(null,result);
    });
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
  });
}
