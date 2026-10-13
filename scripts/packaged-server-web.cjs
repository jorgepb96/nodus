const childProcess = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

// The Nodus Server's own web app — the shell behind /app, /view, /library and every
// published deep link — is a separate Vite build that server.mjs serves from
// <server>/dist/web. The Docker image builds it; the desktop app ships server/ as an
// extra resource for basic mode and must carry it too. server.mjs does not refuse to
// start without it: serveWebApp() quietly returns false and those routes fall back or
// 404, so an app packed without the build boots and looks healthy. Hence one build
// step for beforePack and one assertion for afterPack, both here.
const SERVER_WEB_CONFIG = 'vite.server-web.config.ts';

function serverWebDir(serverRoot) {
  return path.join(serverRoot, 'dist', 'web');
}

/**
 * Files the server web app needs that are absent from `webDir`: index.html, every
 * /app/… asset it loads (an index without its bundle is a blank page), and the login
 * organism that server.mjs serves from the same directory.
 */
function missingServerWebFiles(webDir) {
  const index = path.join(webDir, 'index.html');
  if (!existsSync(index)) return ['index.html'];
  const assets = [...readFileSync(index, 'utf8').matchAll(/\b(?:src|href)="\/app\/([^"?#]+)"/g)].map((match) => match[1]);
  const missing = [...assets, 'organism.js'].filter((file) => !existsSync(path.join(webDir, file)));
  if (!assets.some((file) => file.endsWith('.js'))) missing.unshift('the /app/ script index.html should load');
  return missing;
}

function assertServerWeb(webDir, subject) {
  const missing = missingServerWebFiles(webDir);
  if (missing.length) {
    throw new Error(`${subject} does not carry the Nodus Server web app: ${missing.join(', ')} missing from ${webDir}`);
  }
}

/** `npm run build:server-web`, run with this Node so it needs no npm shim on Windows. */
function buildServerWeb(repoRoot, run = childProcess.execFileSync) {
  run(process.execPath, [path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', SERVER_WEB_CONFIG], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  const webDir = serverWebDir(path.join(repoRoot, 'server'));
  assertServerWeb(webDir, 'The server web build');
  return webDir;
}

module.exports = { SERVER_WEB_CONFIG, serverWebDir, missingServerWebFiles, assertServerWeb, buildServerWeb };
