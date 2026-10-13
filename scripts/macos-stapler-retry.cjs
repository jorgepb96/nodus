/* eslint-disable @typescript-eslint/no-require-imports -- This preload modifies the pinned CommonJS export used by electron-builder. */
// @electron/notarize 2.5.0 wraps stapleApp in promise-retry, but its callback
// never calls retry(error). A lost CloudKit connection therefore aborts a
// successfully notarized build on the first attempt. Retry only that download,
// keeping the original notarization submission and all verification gates.
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');

const INSTALLED = Symbol.for('nodus.macos.staplerRetries');
const RETRY_DELAYS = [15_000, 30_000, 60_000, 120_000, 120_000];

function lostTicketConnection(error) {
  const message = error instanceof Error ? error.message : '';
  return /Failed to staple your application with code:\s*68\b/.test(message)
    && /NSURLErrorDomain Code=-1005\b|The network connection was lost\./.test(message);
}

function retryStapler(stapleApp, { sleep = wait, log = console.warn } = {}) {
  if (typeof stapleApp !== 'function') throw new TypeError('stapleApp must be a function');
  return async function stapleWithNetworkRetries(...args) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await Reflect.apply(stapleApp, this, args);
      } catch (error) {
        if (!lostTicketConnection(error) || attempt >= RETRY_DELAYS.length) throw error;
        const milliseconds = RETRY_DELAYS[attempt];
        log(`[macOS stapling] Apple ticket connection lost; retry ${attempt + 2}/${RETRY_DELAYS.length + 1} in ${milliseconds / 1000}s`);
        await sleep(milliseconds);
      }
    }
  };
}

function installStaplerRetries(options) {
  // The pinned package exposes this CommonJS export. Mutating it before the
  // packager starts also reaches index.js's staple_1.stapleApp call. Fail here
  // if an upgrade changes that contract, rather than silently losing retries.
  const entry = require.resolve('@electron/notarize');
  const stapler = require(path.join(path.dirname(entry), 'staple.js'));
  if (typeof stapler.stapleApp !== 'function') throw new TypeError('Unsupported @electron/notarize stapleApp export');
  if (!stapler.stapleApp[INSTALLED]) {
    const wrapped = retryStapler(stapler.stapleApp, options);
    Object.defineProperty(wrapped, INSTALLED, { value: true });
    stapler.stapleApp = wrapped;
  }
  return stapler.stapleApp;
}

if (process.env.NODUS_RETRY_MACOS_STAPLING === '1') installStaplerRetries();

module.exports = { installStaplerRetries, lostTicketConnection, retryStapler };
