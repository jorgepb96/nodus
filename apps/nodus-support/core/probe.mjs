import { spawn } from 'node:child_process';
import { SupportError } from './files.mjs';

export function runProbe({ executable, args = [], root, action, signal, password }) {
  return new Promise((resolve, reject) => {
    // A narrow bootstrap protocol validates and selects the copy before any normal imports.
    const child = spawn(executable, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', NODUS_SUPPORT_PROBE: '1', NODUS_SUPPORT_ACTION: action, NODUS_ISOLATED_ROOT: root, NODUS_USERDATA: '', NODUS_DISABLE_AUTO_UPDATE: '1' },
      stdio: ['pipe','pipe','pipe'], windowsHide: true,
    });
    child.stdin.on('error', () => {});
    child.stdin.end(password === undefined ? '' : JSON.stringify({ password }));
    let output = ''; let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); if (error) reject(error); else resolve(result); };
    const cancel = () => { child.kill('SIGTERM'); finish(new SupportError('TEST_CANCELLED')); };
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new SupportError('TEST_TIMEOUT')); }, action === 'restore-archive' ? 30 * 60 * 1000 : 60000);
    child.stdout.on('data', chunk => { if (output.length < 1024 * 1024) output += chunk.toString(); });
    // Drain stderr without putting provider errors, user paths or memory dumps in public reports.
    child.stderr.on('data', () => {});
    child.on('error', () => finish(new SupportError('RUNTIME_UNAVAILABLE')));
    child.on('close', () => {
      const line = output.split('\n').find(line => line.startsWith('@@NODUS_SUPPORT@@'));
      if (!line) return finish(new SupportError('PROBE_NO_RESULT'));
      try { finish(null, JSON.parse(line.slice('@@NODUS_SUPPORT@@'.length))); } catch { finish(new SupportError('PROBE_INVALID')); }
    });
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
  });
}
