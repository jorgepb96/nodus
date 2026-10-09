import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { utilityProcess } from 'electron';
import path from 'node:path';

export interface BackgroundProcess extends EventEmitter {
  readonly pid?: number;
  postMessage(message: unknown): void;
  terminate(): Promise<number>;
  unref(): void;
  /** A long-lived process between requests: while idle it does not keep the parent running.
   *  Only a forked child can; a utility process never holds Electron open. */
  setIdle(idle: boolean): void;
}

/** CPU/memory-heavy document work has its own OS process, not an isolate inside
 * Electron's main process. Plain Node/Electron-as-Node harnesses use fork IPC. */
export function backgroundProcess(filename: string, serviceName: string): BackgroundProcess {
  const events = new EventEmitter() as BackgroundProcess;
  let stopped = false;
  if (process.type === 'browser' && utilityProcess?.fork) {
    const child = utilityProcess.fork(path.join(__dirname, 'backgroundUtility.js'), [filename], { serviceName, stdio: 'ignore' });
    let ready = false;
    const pending: unknown[] = [];
    child.once('spawn', () => {
      ready = true;
      if (stopped) { child.kill(); return; }
      for (const message of pending.splice(0)) child.postMessage(message);
    });
    Object.defineProperty(events, 'pid', { get: () => child.pid });
    const exited = new Promise<number>(resolve => child.once('exit', code => { events.emit('exit', code); resolve(code ?? 1); }));
    child.on('message', message => { if (!stopped) events.emit('message', message); });
    child.on('error', error => { if (!stopped) events.emit('error', error); });
    events.postMessage = message => { if (!stopped) { if (ready) child.postMessage(message); else pending.push(message); } };
    events.terminate = () => { stopped = true; pending.length = 0; child.kill(); return exited; };
    events.unref = () => { /* The bounded operation owns this utility process. */ };
    events.setIdle = () => { /* See setIdle. */ };
  } else {
    const child = fork(filename, [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
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
    events.setIdle = idle => {
      if (idle) { child.unref(); child.channel?.unref(); } else { child.ref(); child.channel?.ref(); }
    };
  }
  return events;
}
