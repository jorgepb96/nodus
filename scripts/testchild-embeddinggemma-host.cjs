const { Worker } = require('node:worker_threads');
const worker = new Worker(process.argv[2]);
process.on('message', message => worker.postMessage(message));
worker.on('message', message => { if (process.send) process.send(message); });
worker.on('error', error => { if (process.send) process.send({ id: -1, operation: 'error', error: error.message }); process.exitCode = 1; });
worker.on('exit', code => { if (code && !process.killed) process.exitCode = code; });
