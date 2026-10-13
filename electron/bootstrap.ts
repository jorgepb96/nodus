// The application dependency graph must not execute until the profile is fixed.
import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { assertIsolatedProductionSeparation, isolatedPath, validateIsolatedRoot } from './qa/isolatedProfile';

const requestedRoot = process.env.NODUS_ISOLATED_ROOT;
if (process.env.NODUS_QA_DEFER_CREDENTIAL_STATUS !== undefined && !requestedRoot) {
  throw new Error('Deferred credential status requires an isolated QA profile');
}
if (requestedRoot) {
  const root = validateIsolatedRoot(requestedRoot);
  assertIsolatedProductionSeparation(root, app.getPath('appData'), os.userInfo().homedir, process.platform);
  if (process.env.NODUS_USERDATA && path.resolve(process.env.NODUS_USERDATA) !== path.join(root, 'profile')) {
    throw new Error('Conflicting isolated userData');
  }
  process.env.NODUS_USERDATA = isolatedPath(root, 'profile');
  process.env.XDG_CONFIG_HOME = isolatedPath(root, 'profile/config');
  process.env.XDG_CACHE_HOME = isolatedPath(root, 'profile/cache');
  process.env.NODUS_QA_ROOT = root;
  process.env.NODUS_QA_DATABASE_AUDIT_LOG = path.join(process.env.NODUS_USERDATA, 'database-access.jsonl');
  process.env.NODUS_DISABLE_AUTO_UPDATE = '1';
  process.env.NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI = '1';
  process.env.NODUS_TESSDATA_CACHE = isolatedPath(root, 'cache/tessdata');
  const zoteroEndpoint = new URL(process.env.NODUS_ZOTERO_API_BASE || 'http://127.0.0.1:1/api');
  if (zoteroEndpoint.protocol !== 'http:' || zoteroEndpoint.hostname !== '127.0.0.1' || !zoteroEndpoint.port
      || zoteroEndpoint.port === '23119' || zoteroEndpoint.pathname !== '/api' || zoteroEndpoint.username || zoteroEndpoint.password) {
    throw new Error('Isolated tests require an independent loopback Zotero endpoint');
  }
  process.env.NODUS_ZOTERO_API_BASE = zoteroEndpoint.href;
  process.env.TMPDIR = isolatedPath(root, 'tmp');
  process.env.TMP = process.env.TMPDIR;
  process.env.TEMP = process.env.TMPDIR;
  app.setPath('appData', isolatedPath(root, 'app-data'));
  app.setPath('userData', process.env.NODUS_USERDATA);
  app.setPath('sessionData', isolatedPath(root, 'sessions'));
  app.setPath('temp', process.env.TMPDIR);
  app.setPath('crashDumps', isolatedPath(root, 'crashes'));
  app.setPath('downloads', isolatedPath(root, 'downloads'));
  app.setPath('documents', isolatedPath(root, 'documents'));
  app.setAppLogsPath(isolatedPath(root, 'logs'));
  app.commandLine.appendSwitch('disk-cache-dir', isolatedPath(root, 'cache/chromium'));
  app.on('browser-window-created', (_event, window) => {
    const label = 'Nodus Research · Desarrollo';
    window.setTitle(label);
    window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(label); });
    window.webContents.on('did-finish-load', () => {
      void window.webContents.insertCSS('body::after{content:"Nodus Research · Desarrollo";position:fixed;bottom:4px;right:12px;z-index:2147483647;background:#7f1d1d;color:white;padding:4px 10px;border-radius:4px;font:12px system-ui;pointer-events:none}');
    });
  });
} else if (process.env.NODUS_USERDATA) {
  // Compatibility with existing explicitly isolated development harnesses.
  app.setPath('userData', path.resolve(process.env.NODUS_USERDATA));
}

// A computed URL keeps Rollup from hoisting the application's side effects into
// this entry. application.js is a separate named build entry, including in dev.
const applicationUrl = new URL('./application.js', import.meta.url).href;
void import(/* @vite-ignore */ applicationUrl).catch(error => {
  console.error('[startup] Application initialization failed', error);
  app.exit(1);
});
