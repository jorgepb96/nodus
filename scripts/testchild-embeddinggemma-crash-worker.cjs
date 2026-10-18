let configuration;
const { parentPort } = require('node:worker_threads');
parentPort.on('message', message => {
  if (message.operation === 'init') {
    configuration = { directory: message.directory, threads: message.threads, dtype: message.dtype };
    parentPort.postMessage({ id: 0, operation: 'ready', configuration });
    return;
  }
  if (!configuration) throw new Error('init missing');
  if (message.operation === 'plan') { parentPort.postMessage({ id: message.id, ok: true, result: [[0]] }); return; }
  if (message.operation === 'infer' && message.texts[0].endsWith('query: crash')) {
    // SIGKILL the owned child process containing this worker thread. This avoids
    // core dumps while exercising the same native-crash containment boundary.
    process.kill(process.pid, 'SIGKILL');
  }
  parentPort.postMessage({ id: message.id, ok: true, result: [[7]] });
});
