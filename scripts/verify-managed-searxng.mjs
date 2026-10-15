#!/usr/bin/env node
/** Verifies the managed SearXNG runtime the way the application uses it.
 *
 * Starts the staged runtime under the private interpreter, with the same
 * environment, token and stdin pipe the app gives it, and checks the promises
 * the web step depends on: it becomes ready, it answers on the loopback
 * interface only, it refuses a request without the token, it returns real JSON
 * results, it stops when its stdin closes, and it cannot outlive a parent that
 * is killed outright.
 *
 *   node scripts/verify-managed-searxng.mjs [--disposable-ci]
 *
 * `--disposable-ci` keeps every session directory inside a throwaway tree, which
 * is what the platform workflow runs; without it the session lives under the
 * system temporary directory and is removed at the end either way.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const disposable = process.argv.includes('--disposable-ci');
const runtime = process.env.NODUS_RUNTIME_ROOT ? path.resolve(process.env.NODUS_RUNTIME_ROOT) : path.join(repoRoot, 'build/zotero-mcp');
const python = path.join(runtime, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
const serve = path.join(runtime, 'searxng', 'serve.py');

const failures = [];
const check = (name, condition, detail = '') => {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!condition) failures.push(name);
};
const sessionRoot = fs.mkdtempSync(path.join(disposable ? os.tmpdir() : repoRoot, disposable ? 'nodus-searxng-ci-' : '.nodus-searxng-'));
const session = () => fs.mkdtempSync(path.join(sessionRoot, 'session-'));
const token = () => randomBytes(32).toString('hex');

function launch(directory) {
  const secret = token();
  const child = spawn(python, ['-I', '-B', serve], {
    cwd: directory, stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, TEMP: directory, TMP: directory, NODUS_SEARXNG_TOKEN: secret, LANG: 'C.UTF-8' },
  });
  const ready = new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('the runtime never reported ready')), 45_000);
    child.stdout.on('data', chunk => {
      buffer += String(chunk);
      const line = buffer.split('\n').find(entry => entry.includes('"ready"'));
      if (!line) return;
      clearTimeout(timer);
      resolve(JSON.parse(line).port);
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`the runtime exited with ${code}`)); });
  });
  return { child, secret, ready };
}

const request = async (port, secret, query) => {
  const url = new URL(`http://127.0.0.1:${port}/search`);
  for (const [key, value] of Object.entries({ q: query, format: 'json', categories: 'general', language: 'auto', safesearch: '0' })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: secret ? { 'X-Nodus-Token': secret } : {}, signal: AbortSignal.timeout(30_000) });
  return { status: response.status, body: response.status === 200 ? await response.json() : null };
};

/** A local address that is not the loopback interface, if the machine has one. */
const externalAddress = () => Object.values(os.networkInterfaces()).flat()
  .find(entry => entry && entry.family === 'IPv4' && !entry.internal)?.address ?? null;

const run = async () => {
  check('the staged runtime exists', fs.existsSync(python) && fs.existsSync(serve), runtime);
  if (!fs.existsSync(python) || !fs.existsSync(serve)) return;

  // 1. Ready, loopback only, token enforced, real results.
  const firstDirectory = session();
  const first = launch(firstDirectory);
  const port = await first.ready;
  check('it reports ready with the port it chose', Number.isInteger(port) && port > 0, `port ${port}`);
  const refused = await request(port, null, 'represión franquista historiografía');
  check('a request without the token is refused', refused.status === 403, `HTTP ${refused.status}`);
  const answered = await request(port, first.secret, 'represión franquista posguerra víctimas historiografía');
  check('a request with the token returns JSON results', answered.status === 200 && Array.isArray(answered.body?.results), `${answered.body?.results?.length ?? 0} results`);
  const outside = externalAddress();
  if (outside) {
    const reachable = await new Promise(resolve => {
      const socket = net.connect({ host: outside, port, timeout: 4000 });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.once('timeout', () => { socket.destroy(); resolve(false); });
    });
    check('it does not answer on a non-loopback address', reachable === false, `${outside}:${port}`);
  } else {
    console.log('skip  it does not answer on a non-loopback address — no external IPv4 on this machine');
  }

  // 2. A closed stdin stops it.
  first.child.stdin.end();
  const stopped = await Promise.race([
    new Promise(resolve => first.child.once('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), 10_000)),
  ]);
  check('closing its stdin stops it', stopped === true);
  if (!stopped) first.child.kill('SIGKILL');

  // 3. A parent killed outright cannot leave it running: the app crashes, not stops.
  const parentDirectory = session();
  const parent = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const child = spawn(process.argv[1], ['-I', '-B', process.argv[2]], {
      cwd: process.argv[3], stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: process.argv[3], TMPDIR: process.argv[3], TEMP: process.argv[3], TMP: process.argv[3], NODUS_SEARXNG_TOKEN: process.argv[4], LANG: 'C.UTF-8' },
    });
    console.log(child.pid);
    setInterval(() => {}, 1000);
  `, python, serve, parentDirectory, token()], { stdio: ['ignore', 'pipe', 'inherit'] });
  const orphanPid = await new Promise(resolve => {
    let buffer = '';
    parent.stdout.on('data', chunk => { buffer += String(chunk); const line = buffer.split('\n')[0].trim(); if (line) resolve(Number(line)); });
  });
  await new Promise(resolve => setTimeout(resolve, 1500));
  parent.kill('SIGKILL');
  const gone = await new Promise(resolve => {
    const started = Date.now();
    const poll = () => {
      const alive = (() => { try { process.kill(orphanPid, 0); return true; } catch { return false; } })();
      if (!alive) return resolve(true);
      if (Date.now() - started > 15_000) return resolve(false);
      setTimeout(poll, 250);
    };
    poll();
  });
  check('a parent killed with SIGKILL leaves no orphan behind', gone === true, `pid ${orphanPid}`);
  if (!gone) { try { process.kill(orphanPid, 'SIGKILL'); } catch { /* already gone */ } }

  // 4. The session directory holds what the runtime wrote, nowhere else. Read from the
  // instance that reached ready and answered a search: the one killed above dies about a
  // second into its start, and on a slow runner it has not opened its cache yet.
  const written = fs.readdirSync(firstDirectory);
  check('the session keeps its own settings and cache', written.includes('settings.yml') && written.some(name => name.startsWith('sxng_cache')), written.join(', '));
};

try {
  await run();
} catch (error) {
  check('the runtime verification ran to the end', false, error instanceof Error ? error.message : String(error));
} finally {
  // Windows can briefly retain cache/directory handles after process exit.
  // Retry only transient filesystem failures, and still fail if cleanup cannot
  // complete. Awaiting removal keeps success tied to a fully cleaned session.
  await fs.promises.rm(sessionRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
assert.equal(failures.length, 0, `${failures.length} check(s) failed: ${failures.join(', ')}`);
console.log('\nthe managed runtime behaves as the web step expects');
