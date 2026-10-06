import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { utilityProcess } from 'electron';
import path from 'node:path';

export interface BackgroundProcess extends EventEmitter {
  readonly pid?: number;
  postMessage(message: unknown): void;
  terminate(): Promise<number>;
  unref(): void;
}

/** CPU/memory-heavy document work has its own OS process, not an isolate inside
 * Electron's main process. Plain Node/Electron-as-Node harnesses use fork IPC. */
export function backgroundProcess(filename: string, serviceName: string): BackgroundProcess {
  const events = new EventEmitter() as BackgroundProcess;
  let stopped = false;
  if (process.type === 'browser' && utilityProcess?.fork) {
    // Playwright/dev launches inspect the main process. Inheriting those flags
    // leaves a utility waiting for a debugger, before its spawn/IPC handshake.
    const child = utilityProcess.fork(path.join(__dirname, 'backgroundUtility.js'), [filename], { serviceName, stdio: 'ignore', execArgv: [] });
    let ready = false;
    const pending: unknown[] = [];
    child.once('spawn', () => {
      ready = true;
      events.emit('spawn', child.pid);
      if (stopped) { child.kill(); return; }
      for (const message of pending.splice(0)) child.postMessage(message);
    });
    Object.defineProperty(events, 'pid', { get: () => child.pid });
    const startup = setTimeout(() => { if (!ready && !stopped) { events.emit('error', new Error(`Background process did not start: ${serviceName}`)); } }, 15000);
    startup.unref();
    const exited = new Promise<number>(resolve => child.once('exit', code => { clearTimeout(startup); events.emit('exit', code); resolve(code ?? 1); }));
    child.once('spawn', () => clearTimeout(startup));
    child.on('message', message => { if (!stopped) events.emit('message', message); });
    child.on('error', error => { if (!stopped) events.emit('error', error); });
    events.postMessage = message => { if (!stopped) { if (ready) child.postMessage(message); else pending.push(message); } };
    events.terminate = () => { stopped = true; clearTimeout(startup); pending.length = 0; child.kill(); return exited; };
    events.unref = () => { /* The bounded operation owns this utility process. */ };
  } else {
    const child = fork(filename, [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] });
    Object.defineProperty(events, 'pid', { get: () => child.pid });
    const exited = new Promise<number>(resolve => child.once('exit', code => { events.emit('exit', code); resolve(code ?? 1); }));
    child.on('message', message => { if (!stopped) events.emit('message', message); });
    child.on('error', error => { if (!stopped) events.emit('error', error); });
    events.postMessage = message => {
      if (!stopped && child.connected) child.send(message as Parameters<typeof child.send>[0], error => { if (error && !stopped) events.emit('error', error); });
    };
    events.terminate = () => { stopped = true; child.kill(); return exited; };
    // Keep IPC referenced until completion, including in awaited CLI fixtures.
    events.unref = () => child.unref();
  }
  return events;
}
