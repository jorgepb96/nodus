// The application dependency graph must not execute until the profile is fixed.
import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { assertIsolatedProductionSeparation, isolatedPath, validateIsolatedRoot } from './qa/isolatedProfile';
import fs from 'node:fs';
import { resolvePolicy } from '../apps/nodus-support/core/policies.mjs';
import { isolateSupportApplication } from './support/isolation';
import { supportText, SUPPORT_LANGUAGES } from '../shared/support/messages';
import type { AppLanguage } from '../shared/types';
import { trialReceiptPath } from '../apps/nodus-support/core/trial-ready.mjs';
import { prepareSupportLauncher } from './supportLauncher';

prepareSupportLauncher();

if (!process.env.NODUS_ISOLATED_ROOT && !process.env.NODUS_USERDATA && !process.env.NODUS_SUPPORT_PROBE) {
  try {
    const policies = path.join(app.getPath('appData'),'Nodus Support','launch-policies');
    for (const name of ['Nodus','nodus']) {
      const original = path.join(app.getPath('appData'),name);
      if (!fs.existsSync(original)) continue;
      const policy = resolvePolicy(policies,original); if (!policy) continue;
      if (policy.softwareGraphics) app.disableHardwareAcceleration();
      if (policy.recoveredRoot) {
        process.env.NODUS_SUPPORT_ORIGINAL_PROFILE = original;
        process.env.NODUS_ISOLATED_ROOT = policy.recoveredRoot;
        process.env.NODUS_SUPPORT_INTERACTIVE = '1';
        process.env.NODUS_STELLAR_PREVIEW = '1';
        process.env.NODUS_QA_DEFER_CREDENTIAL_STATUS = '1';
        process.env.NODUS_HARNESS_KEYS_FILE = path.join(policy.recoveredRoot,'no-provider-keys.json');
      }
      break;
    }
  } catch {
    // An invalid pointer must never fall back silently and open a different dataset.
    console.error('[support] launch selection could not be verified'); app.exit(1);
  }
}

// Register failure reporting before importing the application graph. Startup logs stay local.
let startupFile: string | undefined;
const startupLog = (code: string, causeCode?: string) => {
  if (process.env.NODUS_ISOLATED_ROOT || process.env.NODUS_USERDATA || process.env.NODUS_SUPPORT_PROBE) return;
  try {
    const startupFolder = path.join(app.getPath('userData'), 'support-startup');
    startupFile ??= path.join(startupFolder, `${Date.now()}-${process.pid}.jsonl`);
    fs.mkdirSync(startupFolder, { recursive: true, mode: 0o700 });
    fs.appendFileSync(startupFile, JSON.stringify({ at: new Date().toISOString(), code, causeCode, version: app.getVersion(), platform: process.platform, arch: process.arch }) + '\n', { mode: 0o600 });
  } catch { /* Logging must never prevent startup. */ }
};
startupLog('STARTUP_BEGIN');

if (process.env.NODUS_SUPPORT_PROBE === '1') {
  const probeUrl = new URL('./supportProbe.js', import.meta.url).href;
  void import(/* @vite-ignore */ probeUrl).then(module => module.runSupportProbe()).catch(error => {
    // Local stderr is useful to diagnose bootstrap failures. It is never used
    // as a public report field or included in a prepared issue.
    console.error('[support] isolated probe failed', error); app.exit(1);
  });
} else {

const requestedRoot = process.env.NODUS_ISOLATED_ROOT;
if (process.env.NODUS_SUPPORT_INTERACTIVE && !requestedRoot) throw new Error('Interactive support requires an isolated root');
if (process.env.NODUS_QA_DEFER_CREDENTIAL_STATUS !== undefined && !requestedRoot) {
  throw new Error('Deferred credential status requires an isolated QA profile');
}
if (requestedRoot) {
  const root = validateIsolatedRoot(requestedRoot);
  if (process.env.NODUS_SUPPORT_INTERACTIVE === '1') {
    process.env.NODUS_SUPPORT_ORIGINAL_APP_DATA=app.getPath('appData');
    process.env.NODUS_SUPPORT_ORIGINAL_TEMP=app.getPath('temp');
    const support = JSON.parse(fs.readFileSync(path.join(root, 'support-session.json'), 'utf8'));
    if (support.protocol !== 1 || support.root !== root || support.network !== false) throw new Error('Invalid interactive support profile');
    const resultFile = path.join(root, 'result.json');
    if (fs.existsSync(resultFile) && JSON.parse(fs.readFileSync(resultFile, 'utf8')).softwareGraphics === true) app.disableHardwareAcceleration();
  }
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
  if (process.env.NODUS_SUPPORT_INTERACTIVE === '1') isolateSupportApplication(root);
  app.on('browser-window-created', (_event, window) => {
    let label = 'Nodus Research · Desarrollo';
    if (process.env.NODUS_SUPPORT_INTERACTIVE === '1') {
      const prefsFile=path.join(root,'profile/app-prefs.json');
      const prefs=fs.existsSync(prefsFile)?JSON.parse(fs.readFileSync(prefsFile,'utf8')):{};
      const locale=SUPPORT_LANGUAGES.includes(prefs.uiLanguage)?prefs.uiLanguage:(SUPPORT_LANGUAGES.includes(app.getLocale() as AppLanguage)?app.getLocale():'en');
      const marker=JSON.parse(fs.readFileSync(path.join(root,'support-session.json'),'utf8'));
      process.env.NODUS_SUPPORT_LANGUAGE=locale;
      const date=marker.at?new Date(marker.at).toLocaleString(locale):'';
      label=`Nodus Support · ${supportText(locale,'recoveryWorkspace')} · ${supportText(locale,'sourceRetained')} ${date}`;
    }
    window.setTitle(label);
    window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(label); });
    window.webContents.once('did-finish-load', () => {
      const token=process.env.NODUS_SUPPORT_TRIAL_TOKEN;
      if(process.env.NODUS_SUPPORT_INTERACTIVE!=='1'||!token)return;
      const file=trialReceiptPath(root,token),until=Date.now()+60000;
      const ready=async()=>{
        if(window.isDestroyed()||Date.now()>until||fs.existsSync(file))return;
        try {
          const loaded=await window.webContents.executeJavaScript('Boolean(window.nodus && document.getElementById("root")?.children.length)');
          if(loaded){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({protocol:1,root,token,version:app.getVersion(),pid:process.pid}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return;}
        }catch{/* Loading/closing windows must never produce a false readiness receipt. */}
        setTimeout(()=>void ready(),200).unref();
      };
      void ready();
    });
    window.webContents.on('did-finish-load', () => {
      void window.webContents.insertCSS(`body::after{content:${JSON.stringify(label)};position:fixed;bottom:4px;right:12px;max-width:calc(100vw - 48px);z-index:2147483647;background:#323109;color:#f3ef9c;padding:4px 10px;border-radius:4px;font:12px system-ui;pointer-events:none}`);
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
  const cause = String(error?.code ?? error?.message ?? '').match(/\b(?:MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|EACCES|EPERM|ENOSPC|ENOENT)\b/)?.[0];
  startupLog('STARTUP_IMPORT_FAILED', cause);
  console.error('[startup] Application initialization failed', error);
  app.exit(1);
});
}
