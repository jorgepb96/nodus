import { initializeChatSkillDefaults } from './chatSkills';
import { flushWindowEditors, installEditorCloseGuard } from './editorFlush';
import { claimIsolatedProfile } from './qa/isolatedProfile';
import { initializePluginStore } from './skillPlugins';
import { initializeCapabilityPluginStore } from './capabilities/pluginStoreV2';
import { rebuildCapabilityRegistry } from './capabilities/registry';
import { migrateCapabilitiesForThisProfile, settleInstalledPluginMigrations } from './capabilities/migrationRunner';
import { checkForCapabilityUpdates } from './capabilities/updates';
import { startPluginUpdates, stopPluginUpdates } from './skillPluginUpdates';
import { app, BrowserWindow, dialog, nativeTheme, session, shell } from 'electron';
import path from 'node:path';
import { createRequire } from 'node:module';
import { constants as fsConstants, promises as fs } from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { getDb, closeDb } from './db/database';
import { documentIndexQueue } from './pipeline/documentIndexQueue';
import { reconcileAuthorLayerOnce, reconcileAuthorRolesOnce } from './db/authorsRepo';
import { pruneDormantIdeas } from './db/ideasRepo';
import { repairGraphIntegrityOnce } from './db/graphIntegrityRepair';
import { repairDocumentSupportPassagesOnce } from './ai/documentSupportRepair';
import {
  maybeRunAutoBackup,
  maybeRunBackupCleanup,
  runAutoBackupNow,
  runPreUpdateBackupNow,
} from './export/autoBackup';
import { registerIpc } from './ipc';
import { flushPipelineLogs } from './logging/pipelineLogHost';
import { scanQueue } from './pipeline/scanQueue';
import { getSettings } from './db/settingsRepo';
import { runDueDatabaseRowTemplates } from './db/databaseTasksRepo';
import { runDueAutomationRules } from './db/databaseAutomationsRepo';
import { startDatabaseFormServer, stopDatabaseFormServer } from './automation/formServer';
import { getActiveVault, listVaults } from './vaults/vaultRegistry';
import {
  cancelScheduledMigrationRecoveryRetention,
  scheduleMigrationRecoveryRetention,
} from './db/migrationRecoveryUtilityHost';
import { generateDemoPortraits, hasDemoPortraitKey, demoPortraitsPending } from './ai/genealogyDemoPortraits';
import { interruptDecorativeImageGenerations } from './ai/decorativeImages';
import { startRealtimeSync, stopRealtimeSync } from './sync/syncService';
import { startNodusServerSync, stopNodusServerSync } from './serverSync/serverSyncService';
import { startInboxPolling, stopInboxPolling } from './serverSync/inboxPoller';
import { startReplicaSync, stopReplicaSync } from './serverSync/replicaService';
import { killMcpTunnelSync, startMcpServer, startMcpTunnelIfConfigured, stopMcpServer } from './mcp';
import { killLocalServerSync, startLocalServerIfEnabled } from './localServer/process';
import { stopDesktopBridge } from './desktopBridge/server';
import { holdAwake, releaseAllPower } from './localServer/power';
import { setCopilotWindowProvider, startCopilotServer, stopCopilotServer } from './copilot/server';
import { setZoteroPluginWindowProvider, startZoteroPluginServer, stopZoteroPluginServer } from './zotero-plugin/server';
import { applyMascotWindow, destroyMascotWindow, setMascotTutorialVisible } from './mascotWindow';
import { installAppEditContextMenu } from './browser/editMenu';
import { menuLabel } from '@shared/menuLabels';
import { seedWelcomeNotification } from './notifications';
import { startRadarScheduler, stopRadarScheduler } from './radar/scheduler';
import { refreshAnnouncements } from './announcements';
import { startStudyCalendarReminders, stopStudyCalendarReminders } from './studyCalendarReminders';
import { startAppleCalendarSync, stopAppleCalendarSync } from './calendar/appleCalendarSync';
import { restorePersistedDockIcon } from './dockIcon';
import { stopAllWhisperCpp } from './stt/whisperCpp';
import { recoverLegacyApiKeys } from './secrets/legacySecretRecovery';
import { hasBackupPassword } from './secrets/secretStore';
import type { UpdateCheckResponse, UpdateProgressEvent } from '@shared/types';
import { installMediaRequestHeaders } from './mediaRequestHeaders';
import { killChatGptSubscriptionServer } from './ai/codexSubscription';
import { killGitHubCopilotSubscriptionServer } from './ai/githubCopilotSubscription';
import { killNodusLocalServerSync } from './ai/nodusLocalAi';
import { killSearxngSync } from './websearch/searxngService';
import { ensureDatabaseDeepResearchLane } from './ai/databaseDeepResearchLane';
import { installProcessSafetyNet } from './util/processSafety';
import { restoreAppWindows } from './windowLifecycle';
import { registerImageProtocol, registerImageSchemePrivileges } from './imageProtocol';
import { registerArchiveProtocol, registerArchiveSchemePrivileges } from './archiveProtocol';
import { registerLibraryProtocol, registerLibrarySchemePrivileges } from './libraryProtocol';
import { registerCapabilitySchemePrivileges } from '../skill-capabilities/sandbox/runtime';
import { closeGlobalLibraryRuntime } from './library/libraryRuntime';
import { setBrowserTheme } from './browser/tabs';
import { destroyBrowserSubsystem } from './browser/lifecycle';
import { ensurePreV4Recovery } from './recovery/preV4Recovery';
import { applyUpdateChannel, availableUpdateVersion, isPrereleaseVersion } from './updateChannel';
import { registerNodusClientVersion } from './ai/clientIdentity';
import {
  upgradeWorldbuildingDemoDynasties,
  upgradeWorldbuildingDemoImageQuality,
  upgradeWorldbuildingDemoNarrativeDepth,
  relocalizeWorldbuildingDemoData,
} from './db/worldbuildingDemoData';

// Before anything else: a stray rejection from any of the fire-and-forget
// timers below would otherwise terminate the process under Node's default.
installProcessSafetyNet();

const require = createRequire(__filename);
const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');

// Keep the released Safe Storage identity even though the product and every visible surface are
// now called Nodus Research. Changing this value would silently strand encrypted provider,
// server and Bridge credentials in the macOS Keychain. It is a compatibility identifier, not a
// user-facing product name.
app.setName('Nodus');

// The version every outbound API request announces in its User-Agent. Registered
// here rather than imported where it is used, because those modules are bundled
// by the node --test harnesses, where `electron` has no `app` on it.
registerNodusClientVersion(app.getVersion());

// Deeplink for OAuth: nodus://authorize?code=XYZ
// Google blocks OAuth in embedded webviews; the correct pattern is
// system browser -> your-site.com/authorize -> nodus://authorize?code=... .
// Register the scheme so the OS launches Nodus for nodus:// URLs.
if (!process.env.NODUS_USERDATA && !app.isDefaultProtocolClient('nodus')) {
  try { app.setAsDefaultProtocolClient('nodus'); } catch {}
}
registerImageSchemePrivileges();
registerArchiveSchemePrivileges();
registerLibrarySchemePrivileges();
registerCapabilitySchemePrivileges();

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

// Vite injects these env vars for the dev server / built output locations.
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '../dist');

// Optional userData override (separate profile / isolated testing). Must run
// before app is ready, i.e. before anything reads getPath('userData').
if (process.env.NODUS_USERDATA) {
  app.setPath('userData', process.env.NODUS_USERDATA);
}

/**
 * Only one Nodus may own a profile at a time.
 *
 * Every vault is a SQLite file plus a registry of which vault is active. Two
 * processes opening the same profile write to both concurrently: the second
 * one's vault switch rewrites the registry underneath the first, and their
 * writes interleave in the database itself. That is data loss, not slowness,
 * and it is silent until something fails to open.
 *
 * The lock is deliberately taken AFTER the userData override above, because
 * Electron scopes it to the profile directory. Isolated profiles — tests, the
 * demo instance, a second vault opened on purpose with NODUS_USERDATA — each
 * get their own lock and still run side by side. Only a genuine second copy of
 * the same profile is refused.
 *
 * The macOS unsigned updater is unaffected: its helper script waits for this
 * process to exit (`while kill -0 "$PID"`) before it replaces the bundle and
 * runs `open -n`, so the lock is already released by then.
 */
const isolatedUnlock = process.env.NODUS_ISOLATED_ROOT ? claimIsolatedProfile(process.env.NODUS_ISOLATED_ROOT) : null;
const hasSingleInstanceLock = process.env.NODUS_ISOLATED_ROOT ? Boolean(isolatedUnlock) : app.requestSingleInstanceLock();
if (isolatedUnlock) app.on('will-quit', isolatedUnlock);
if (!hasSingleInstanceLock) {
  // Hand over to the copy that already owns this profile and leave. Nothing
  // below has run yet, so no database or window has been touched.
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let updateCheckTimer: NodeJS.Timeout | null = null;
let installingUpdate = false;
let downloadedUpdateVersion: string | null = null;
let downloadedUpdateFile: string | null = null;
let activeUpdateVersion: string | null = null;
let activeUpdateCancellationToken: { cancel: () => void } | null = null;
let lastUpdateEvent: UpdateProgressEvent | null = null;
let lastDownloadProgressEmitAt = 0;
let lastDownloadProgressPercent = -1;
let installUpdateTimer: NodeJS.Timeout | null = null;
let useUnsignedMacUpdaterFallback = false;
let autoBackupTimer: NodeJS.Timeout | null = null;
let autoBackupFirstTimer: NodeJS.Timeout | null = null;
let autoBackupRunning = false;
let taskTemplateTimer: NodeJS.Timeout | null = null;
let taskTemplateFirstTimer: NodeJS.Timeout | null = null;
let databaseAutomationTimer: NodeJS.Timeout | null = null;
let databaseAutomationFirstTimer: NodeJS.Timeout | null = null;
let announcementsFirstTimer: NodeJS.Timeout | null = null;
/** Set once shutdown starts, so timers that fire mid-quit do not reopen the DB. */
let quitting = false;
let stopDocumentaryPreparation = () => {};
let stopResearchZotero = async () => {};

let pendingDeepLink: string | null = process.argv.find((arg) => arg.startsWith('nodus://')) ?? null;

function handleDeepLink(url: string): void {
  if (!url || !url.startsWith('nodus://')) return;
  const win = mainWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send('deeplink:received', url);
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  } else {
    pendingDeepLink = url;
  }
}

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const UPDATE_PROGRESS_MIN_INTERVAL_MS = 500;
/** Long enough that the first window has painted and a vault is open. */
const ANNOUNCEMENTS_STARTUP_DELAY_MS = 45 * 1000;

/** If the first window never reports itself loaded, the work still has to happen. */
const FIRST_PAINT_CEILING_MS = 60 * 1000;
/** A moment past the load event, because the renderer's own first frames are still work. */
const FIRST_PAINT_SETTLE_MS = 3 * 1000;

/** Defers work until the first window has painted, or until the ceiling above.
 *
 *  For anything that needs the main process to be responsive rather than merely awake.
 *  There is one event loop, and a launch is the moment it is genuinely contended: work
 *  that competes with it does not just run slowly, it runs against timers and child
 *  processes that are being starved at the same time. */
function afterFirstPaint(work: () => void): void {
  let started = false;
  const start = () => { if (started) return; started = true; setTimeout(work, FIRST_PAINT_SETTLE_MS).unref?.(); };
  const ceiling = setTimeout(start, FIRST_PAINT_CEILING_MS);
  ceiling.unref?.();
  const watch = (window: BrowserWindow) => {
    if (!window.webContents.isLoading()) { clearTimeout(ceiling); start(); return; }
    window.webContents.once('did-finish-load', () => { clearTimeout(ceiling); start(); });
  };
  if (mainWindow) { watch(mainWindow); return; }
  // The main window may be created later in the same ready handler, so this does not depend
  // on being called after it. The mascot is a window too and loads in no time, so the
  // listener waits a turn for `mainWindow` to be assigned rather than taking whichever
  // window appears first — the point is the launch being over, not a window existing.
  const onCreated = (_event: unknown, window: BrowserWindow) => setImmediate(() => {
    if (window !== mainWindow) return;
    app.off('browser-window-created', onCreated);
    watch(window);
  });
  app.on('browser-window-created', onCreated);
}

/** The 5.3.1 → 5.4.0 move, and the catalogue check that must not overlap it. */
function runCapabilityProfileMigration(): void {
  void migrateCapabilitiesForThisProfile()
    .then(outcome => {
      if (outcome.installed.length || outcome.adopted.length) rebuildCapabilityRegistry();
      for (const failure of outcome.failed) console.warn(`[capabilities] ${failure.pluginId} stopped at ${failure.phase}: ${failure.detail}`);
    })
    .catch(error => console.warn('[capabilities] migration could not run:', error))
    // Updates come after the move, never during it: an update mid-migration would change
    // the version the migration is halfway through. Delayed, because a launch has better
    // things to do with its first seconds than talk to GitHub — and skipped entirely when
    // this build was told not to update itself, which is what a test harness says when it
    // means "do not go near the network".
    .finally(() => process.env.NODUS_DISABLE_AUTO_UPDATE === '1' ? undefined : setTimeout(() => {
      void checkForCapabilityUpdates()
        .then(results => {
          for (const result of results) {
            if (result.state === 'updated') console.info(`[capabilities] ${result.pluginId} updated ${result.from} -> ${result.to}`);
            if (result.state === 'awaiting-approval') console.info(`[capabilities] ${result.pluginId} ${result.to} is waiting for permission approval`);
          }
        })
        .catch(error => console.warn('[capabilities] update check could not run:', error));
    }, 30_000).unref?.());
}

function macAppBundlePath(): string | null {
  if (process.platform !== 'darwin') return null;
  const marker = '.app/Contents/MacOS/';
  const markerIndex = process.execPath.indexOf(marker);
  if (markerIndex < 0) return null;
  return process.execPath.slice(0, markerIndex + '.app'.length);
}

function macAppHasDeveloperIdSignature(): boolean {
  const appPath = macAppBundlePath();
  if (!appPath) return false;
  const result = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
  const signature = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  return result.status === 0 && /Authority=Developer ID Application:/.test(signature);
}

function unsignedMacUpdateHelperScript(): string {
  // The helper is outside the bundle, so it can replace the .app after this
  // process exits. electron-updater has already verified the ZIP checksum.
  return [
    '#!/bin/sh',
    'set -eu',
    'PID="$1"',
    'ZIP="$2"',
    'TARGET="$3"',
    'STATE="$4"',
    // Force-quitting the app kills its descendants, and this helper is one. Without
    // ignoring the terminating signals it dies mid-wait, leaving the update staged
    // but never installed — which is exactly what a user reaching for Force Quit
    // does every single time the quit below fails to land.
    "trap '' TERM HUP INT",
    'STAGING="$(/usr/bin/mktemp -d "${TMPDIR:-/private/tmp}/nodus-update.XXXXXX")"',
    'BACKUP="${TARGET}.previous"',
    'finish() { /bin/rm -rf "$STAGING"; /bin/rm -f "$0"; }',
    "fail() { /usr/bin/printf '%s\\n' '{\"status\":\"failed\"}' > \"$STATE\"; finish; exit 1; }",
    'trap finish EXIT',
    // Never wait forever. If the app is still alive after this many seconds the
    // quit did not land, and a helper that waits until the heat death of the
    // universe is worse than one that reports the failure.
    'WAITED=0',
    'while /bin/kill -0 "$PID" 2>/dev/null; do',
    '  /bin/sleep 0.1',
    '  WAITED=$((WAITED + 1))',
    '  [ "$WAITED" -ge 1200 ] && fail',
    'done',
    '/usr/bin/ditto -x -k "$ZIP" "$STAGING" || fail',
    // Match the bundle by SHAPE, not by name. A named search is what broke the
    // 4.2.3 -> 4.2.4 update: the helper doing the searching always belongs to the
    // version being replaced, so the day the bundle is renamed, every copy already
    // in the field looks for a name that is no longer there, fails after the app
    // has quit, and never reopens. There is exactly one bundle at the top of the
    // staging directory. `-maxdepth 2` keeps this off the nested helper apps in
    // Contents/Frameworks, which live far deeper.
    'NEW_APP="$(/usr/bin/find "$STAGING" -maxdepth 2 -type d -name \'*.app\' -print -quit)"',
    '[ -n "$NEW_APP" ] && [ -d "$NEW_APP/Contents" ] || fail',
    '/bin/rm -rf "$BACKUP"',
    '/bin/mv "$TARGET" "$BACKUP" || fail',
    'if ! /bin/mv "$NEW_APP" "$TARGET"; then /bin/mv "$BACKUP" "$TARGET" || true; fail; fi',
    '/usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true',
    // The swap has landed, so the displaced copy has stopped being a rollback and
    // started being a problem. `.previous` is a suffix on the DIRECTORY name only:
    // inside it is a complete application bundle carrying the same
    // CFBundleIdentifier, so LaunchServices registers it as a second copy of Nodus
    // and macOS shows two Dock icons for one app. It is also ~1.8 GB, kept forever,
    // by every update.
    //
    // Unregister before relaunching, so nothing can resolve to it, but delete after,
    // because removing that much takes seconds the user would spend staring at no
    // window at all.
    'LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    '[ -x "$LSREGISTER" ] && "$LSREGISTER" -u "$BACKUP" >/dev/null 2>&1 || true',
    " /usr/bin/printf '%s\\n' '{\"status\":\"installed\"}' > \"$STATE\"",
    // Not `open -n`. The app is known dead here (the wait above only ends when the
    // PID is gone), so -n buys nothing, and if anything did manage to start Nodus
    // meanwhile it would force a SECOND process instead of activating the first.
    '/usr/bin/open "$TARGET" || true',
    '/bin/rm -rf "$BACKUP" 2>/dev/null || true',
  ].join('\n');
}

/**
 * Remove a bundle an earlier update left standing beside this one.
 *
 * The helper that performs an update always belongs to the version being
 * REPLACED, so fixing the helper only helps the update after next. Every release
 * up to 4.2.4 moved the running bundle to "<app>.previous" and left it there, and
 * ".previous" is a suffix on the directory name only: what remains is a complete
 * application bundle carrying the same CFBundleIdentifier, which LaunchServices
 * registers as a second copy of Nodus. macOS then shows two Dock icons for one
 * app, and roughly 1.8 GB stays on disk forever.
 *
 * So the app also cleans up after itself on launch. That closes the gap the
 * helper cannot reach: whichever version installed this one, the leftover is gone
 * the first time it runs.
 *
 * Unregistered before deletion so nothing resolves to it in the meantime, and
 * done off the startup path entirely — it is housekeeping, not a prerequisite for
 * a window.
 */
function removeDisplacedMacBundle(): void {
  if (process.env.NODUS_ISOLATED_ROOT || process.platform !== 'darwin' || !app.isPackaged) return;
  const appPath = macAppBundlePath();
  if (!appPath) return;
  const displaced = `${appPath}.previous`;
  void (async () => {
    try {
      await fs.access(displaced, fsConstants.F_OK);
    } catch {
      return; // Nothing left behind. The common case once this has run once.
    }
    const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/'
      + 'LaunchServices.framework/Support/lsregister';
    try {
      spawnSync(lsregister, ['-u', displaced], { stdio: 'ignore', timeout: 20_000 });
    } catch {
      // Unregistering is a courtesy to the Dock; removal is the part that matters.
    }
    try {
      await fs.rm(displaced, { recursive: true, force: true });
      console.log(`[updates] removed the bundle a previous update left behind: ${displaced}`);
    } catch (error) {
      console.warn(`[updates] could not remove ${displaced}: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();
}

async function installUnsignedMacUpdate(downloadedFile: string): Promise<void> {
  const appPath = macAppBundlePath();
  if (!appPath) throw new Error('No se pudo localizar la aplicación de macOS para actualizarla.');
  if (path.extname(downloadedFile).toLowerCase() !== '.zip') {
    throw new Error('El paquete descargado no es un ZIP de macOS válido.');
  }
  await Promise.all([
    fs.access(downloadedFile, fsConstants.R_OK),
    fs.access(appPath, fsConstants.R_OK),
    fs.access(path.dirname(appPath), fsConstants.W_OK),
  ]);

  const statePath = path.join(app.getPath('userData'), 'update-install-state.json');
  const helperPath = path.join(os.tmpdir(), `nodus-update-${process.pid}-${Date.now()}.sh`);
  await fs.writeFile(helperPath, unsignedMacUpdateHelperScript(), { encoding: 'utf8', mode: 0o700 });
  await fs.writeFile(statePath, JSON.stringify({ status: 'starting', version: downloadedUpdateVersion }), 'utf8');

  const helper = spawn('/bin/sh', [helperPath, String(process.pid), downloadedFile, appPath, statePath], {
    detached: true,
    stdio: 'ignore',
  });
  helper.unref();
  quitForUpdate();
}

/** Quit so the waiting helper can replace the bundle — and make sure the quit
 *  actually lands.
 *
 *  app.quit() is cooperative: it runs before-quit, closes every window, then
 *  will-quit, and any one of those steps can leave the process alive. On macOS
 *  that is not theoretical. Finishing a download makes electron-updater's
 *  MacUpdater start a local proxy server and hand the app to the native
 *  Squirrel.Mac updater via setFeedURL, both of which happen before it consults
 *  autoInstallOnAppQuit — so they happen even here, where Nodus installs the
 *  update itself and wants nothing to do with Squirrel. The app then sits idle in
 *  its run loop, the helper waits for a PID that never dies, and the user force
 *  quits, which kills the helper too. Nothing installs, every time.
 *
 *  app.exit() skips the cooperative path entirely and terminates. before-quit has
 *  already run by then, so the database and the vendor runtimes are closed down
 *  the same way they would be on any other quit. */
function quitForUpdate(): void {
  app.quit();
  const giveUp = setTimeout(() => {
    console.warn('[updates] app.quit() did not terminate the process; forcing exit so the installer can proceed');
    app.exit(0);
  }, 4000);
  giveUp.unref?.();
}

function updateInstallStatePath(): string {
  return path.join(app.getPath('userData'), 'update-install-state.json');
}

/** Report an install that was staged but never finished.
 *
 *  The helper records its outcome in this file and, until now, nothing ever read
 *  it. So when an install stalled the app started up on the old version, offered
 *  the very same update again, and staged another helper doomed the same way —
 *  a loop with no visible symptom beyond "the update does nothing". */
async function reportInterruptedUpdateInstall(): Promise<void> {
  const statePath = updateInstallStatePath();
  let state: { status?: string; version?: string };
  try {
    state = JSON.parse(await fs.readFile(statePath, 'utf8')) as typeof state;
  } catch {
    return; // no install was ever staged from this profile
  }
  // Clear it either way: this is a report about the previous launch, and keeping
  // it would turn one failure into a permanent warning.
  await fs.rm(statePath, { force: true }).catch(() => { /* reported anyway */ });
  if (!state?.status || state.status === 'installed') return;
  if (state.version && state.version === app.getVersion()) return; // it did land
  emitUpdate({
    status: 'error',
    errorCode: 'update-install-incomplete',
    message: state.version
      ? `La actualización a Nodus ${state.version} se descargó pero no llegó a instalarse, así que sigues en la ${app.getVersion()}. Vuelve a intentarlo desde Ajustes.`
      : 'Una actualización descargada no llegó a instalarse. Vuelve a intentarlo desde Ajustes.',
    version: state.version ?? app.getVersion(),
    progress: null,
  });
}

function emitUpdate(event: UpdateCheckResponse): UpdateCheckResponse {
  lastUpdateEvent = { ...event, downloadedVersion: downloadedUpdateVersion, at: new Date().toISOString() };
  mainWindow?.webContents.send('updates:progress', lastUpdateEvent);
  return lastUpdateEvent;
}

/** Stop a prerelease already in flight when the user leaves the beta channel. */
function discardPendingPrereleaseUpdate(): boolean {
  const candidate = downloadedUpdateVersion ?? activeUpdateVersion;
  if (!isPrereleaseVersion(candidate)) return false;

  activeUpdateCancellationToken?.cancel();
  activeUpdateCancellationToken = null;
  if (installUpdateTimer) {
    clearTimeout(installUpdateTimer);
    installUpdateTimer = null;
  }
  installingUpdate = false;
  downloadedUpdateVersion = null;
  downloadedUpdateFile = null;
  activeUpdateVersion = null;
  // A native updater may already have staged the package by the time the setting
  // changes. Do not let an ordinary quit install it behind the stable preference.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoDownload = false;
  console.log('[updates] discarded pending prerelease after beta opt-out');
  return true;
}

function configureUpdateChannel(betaUpdates: boolean, reason: string): void {
  const channel = applyUpdateChannel(autoUpdater, betaUpdates);
  const discardedPrerelease = !betaUpdates && discardPendingPrereleaseUpdate();
  console.log(`[updates] channel ${channel} (${reason}); downgrades disabled`);
  if (discardedPrerelease) {
    emitUpdate({
      status: 'not-available',
      message: 'Beta updates está desactivado. La próxima actualización será una versión estable más reciente.',
      version: app.getVersion(),
      progress: null,
    });
  }
}

function hasUsableRecoverySetup(): boolean {
  return Boolean(getSettings().autoBackupFolder && hasBackupPassword());
}

function hasConfiguredRecoveryFolder(): boolean {
  return Boolean(getSettings().autoBackupFolder);
}

function isSafeExternalUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim());
}

function openExternalSafely(url: string): void {
  if (!isSafeExternalUrl(url)) return;
  void shell.openExternal(url.trim()).catch((error) => {
    console.error(`[navigation] could not open external URL: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/** Never let a website replace Nodus inside its main BrowserWindow. */
function protectMainWindowNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL();
    let sameOrigin = false;
    try {
      const target = new URL(url);
      const current = new URL(currentUrl);
      sameOrigin = /^https?:$/i.test(target.protocol) && target.origin === current.origin;
    } catch {
      sameOrigin = false;
    }
    if (sameOrigin) return;
    event.preventDefault();
    openExternalSafely(url);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload imports `electron` and nothing else — no Node builtins — which
      // is exactly the constraint a sandboxed renderer places on it. webUtils is
      // designed for this case and keeps drag-and-drop file paths working.
      sandbox: true,
    },
  });
  protectMainWindowNavigation(mainWindow);
  installEditorCloseGuard(mainWindow, () => quitting);

  // Right-clicking any text field in Nodus — the browser's address bar above all
  // — offers Cut, Copy and Paste. Views that draw their own HTML context menu
  // call preventDefault(), so Electron never raises this event for them.
  installAppEditContextMenu(
    mainWindow.webContents,
    (key: string) => menuLabel(key, getSettings().uiLanguage),
  );

  // `nodi:tutorialVisible` is set by a React effect in BasicsTutorial and cleared by
  // that effect's cleanup — which a full page reload never runs. The main process
  // was then left believing a tutorial was still on screen and refused to bring the
  // overlay back for the rest of the session. A navigation is a fresh renderer, so
  // nothing is on screen yet; whatever mounts will say so again.
  mainWindow.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) setMascotTutorialVisible(false);
  });

  if (VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  mainWindow.on('closed', () => {
    // On macOS closing the last window does not quit the app. Native Browser
    // views must still die with their host instead of surviving invisibly until
    // a later Cmd+Q or being retained when a new main window is created.
    destroyBrowserSubsystem();
    mainWindow = null;
    // Don't let the always-on-top mascot window keep the app alive after the main
    // window closes (matters on Windows/Linux, where window-all-closed quits).
    destroyMascotWindow();
  });
}

async function checkForUpdates(reason: string): Promise<UpdateCheckResponse> {
  // Deterministic real-window coverage for the startup banner without contacting
  // release infrastructure from the isolated E2E profile.
  if (process.env.NODUS_E2E_UPDATE_STATUS === 'not-available') {
    return emitUpdate({
      status: 'not-available',
      message: `Nodus ${app.getVersion()} ya está actualizado.`,
      version: app.getVersion(),
      progress: null,
    });
  }
  if (!app.isPackaged || process.env.NODUS_DISABLE_AUTO_UPDATE === '1') {
    return emitUpdate({
      status: 'disabled',
      message: 'Las actualizaciones solo están disponibles en la app empaquetada.',
      version: app.getVersion(),
      progress: null,
    });
  }
  configureUpdateChannel(getSettings().betaUpdates, reason);
  autoUpdater.autoDownload = true;
  if (installingUpdate) {
    if (lastUpdateEvent?.status === 'backing-up' || lastUpdateEvent?.status === 'installing') return lastUpdateEvent;
    return emitUpdate({
      status: 'installing',
      message: 'Actualización descargada. Nodus se está cerrando para instalarla.',
      version: downloadedUpdateVersion ?? app.getVersion(),
      progress: 100,
    });
  }
  if (downloadedUpdateVersion) {
    return emitUpdate({
      status: 'downloaded',
      message: `Actualización ${downloadedUpdateVersion} descargada. Puedes instalarla y reiniciar cuando quieras.`,
      version: downloadedUpdateVersion,
      progress: 100,
    });
  }
  console.log(`[updates] checking (${reason})`);
  emitUpdate({
    status: 'checking',
    message: 'Buscando actualizaciones…',
    version: app.getVersion(),
    progress: null,
  });
  try {
    const result = await autoUpdater.checkForUpdates();
    const cancellationToken = result?.cancellationToken ?? null;
    activeUpdateCancellationToken = cancellationToken;
    if (result?.downloadPromise) {
      void result.downloadPromise.then(
        () => {
          if (activeUpdateCancellationToken === cancellationToken) activeUpdateCancellationToken = null;
        },
        () => {
          if (activeUpdateCancellationToken === cancellationToken) activeUpdateCancellationToken = null;
        },
      );
    }
    const version = availableUpdateVersion(result, app.getVersion());
    if (isPrereleaseVersion(version) && !getSettings().betaUpdates) {
      cancellationToken?.cancel();
      if (activeUpdateCancellationToken === cancellationToken) activeUpdateCancellationToken = null;
      activeUpdateVersion = null;
      return emitUpdate({
        status: 'not-available',
        message: `Nodus ${app.getVersion()} ya está actualizado.`,
        version: app.getVersion(),
        progress: null,
      });
    }
    if (version) {
      return emitUpdate({
        status: 'available',
        message: `Actualización ${version} encontrada. La descarga empezará automáticamente.`,
        version,
        progress: 0,
      });
    }
    return emitUpdate({
      status: 'not-available',
      message: `Nodus ${app.getVersion()} ya está actualizado.`,
      version: app.getVersion(),
      progress: null,
    });
  } catch (e) {
    console.error(`[updates] check failed: ${e instanceof Error ? e.message : String(e)}`);
    return emitUpdate({
      status: 'error',
      errorCode: 'update-check-failed',
      message: e instanceof Error ? e.message : String(e),
      version: app.getVersion(),
      progress: null,
    });
  }
}

async function installDownloadedUpdate(): Promise<UpdateCheckResponse> {
  if (!app.isPackaged || process.env.NODUS_DISABLE_AUTO_UPDATE === '1') {
    return emitUpdate({
      status: 'disabled',
      message: 'Las actualizaciones solo están disponibles en la app empaquetada.',
      version: app.getVersion(),
      progress: null,
    });
  }
  if (!downloadedUpdateVersion) {
    return emitUpdate({
      status: 'not-available',
      message: 'No hay ninguna actualización descargada pendiente de instalar.',
      version: app.getVersion(),
      progress: null,
    });
  }
  if (isPrereleaseVersion(downloadedUpdateVersion) && !getSettings().betaUpdates) {
    discardPendingPrereleaseUpdate();
    return emitUpdate({
      status: 'not-available',
      message: 'Beta updates está desactivado. La próxima actualización será una versión estable más reciente.',
      version: app.getVersion(),
      progress: null,
    });
  }
  if (installingUpdate) {
    return lastUpdateEvent ?? {
      status: 'installing',
      message: 'Instalando actualización…',
      version: downloadedUpdateVersion,
      progress: 100,
    };
  }

  const targetVersion = downloadedUpdateVersion;
  const prerelease = isPrereleaseVersion(targetVersion);
  installingUpdate = true;
  // A quit while the safety snapshot is being built must never let the native updater
  // bypass this gate. The explicit quitAndInstall below is the only installation path.
  autoUpdater.autoInstallOnAppQuit = false;

  const recoveryConfigured = hasConfiguredRecoveryFolder();
  const recoveryReady = recoveryConfigured && hasUsableRecoverySetup();
  if (prerelease && !recoveryReady) {
    installingUpdate = false;
    return emitUpdate({
      status: 'error',
      errorCode: 'pre-update-backup-required',
      message: 'La beta no se instalará hasta que configures Recuperación con una carpeta y contraseña válidas.',
      version: targetVersion,
      progress: null,
    });
  }

  // Beta is fail-closed. Stable remains backward-compatible: when Recovery is ready it
  // gets the same additional protection, but a backup problem never blocks a normal
  // release or changes the established stable update contract.
  if (prerelease || recoveryConfigured) {
    emitUpdate({
      status: 'backing-up',
      message: `Creando y verificando una copia de seguridad antes de actualizar a Nodus ${targetVersion}…`,
      version: targetVersion,
      progress: null,
    });
    const backup = await runPreUpdateBackupNow(app.getVersion(), targetVersion).catch((error) => ({
      ok: false as const, message: error instanceof Error ? error.message : String(error),
    }));
    if (prerelease && !getSettings().betaUpdates) {
      discardPendingPrereleaseUpdate();
      return emitUpdate({
        status: 'not-available',
        message: 'Beta updates está desactivado. La próxima actualización será una versión estable más reciente.',
        version: app.getVersion(),
        progress: null,
      });
    }
    if (!backup.ok) {
      if (prerelease) {
        installingUpdate = false;
        console.error(`[updates] beta install blocked because pre-update backup failed: ${backup.message}`);
        return emitUpdate({
          status: 'error',
          errorCode: 'pre-update-backup-failed',
          message: `La beta no se instaló porque no pudo crearse una copia de seguridad verificable: ${backup.message}`,
          version: targetVersion,
          progress: null,
        });
      }
      console.warn(`[updates] stable pre-update backup failed; continuing without blocking stable: ${backup.message}`);
    } else {
      console.log(`[updates] verified pre-update snapshot: ${backup.path}`);
    }
  }

  const response = emitUpdate({
    status: 'installing',
    message: `Instalando Nodus ${targetVersion} y reiniciando…`,
    version: targetVersion,
    progress: 100,
  });
  installUpdateTimer = setTimeout(() => {
    installUpdateTimer = null;
    void (async () => {
      try {
        if (useUnsignedMacUpdaterFallback) {
          if (!downloadedUpdateFile) throw new Error('No se encontró el paquete descargado para instalar la actualización.');
          await installUnsignedMacUpdate(downloadedUpdateFile);
        } else {
          autoUpdater.quitAndInstall(false, true);
        }
      } catch (e) {
        installingUpdate = false;
        emitUpdate({
          status: 'error',
          errorCode: 'update-install-failed',
          message: e instanceof Error ? e.message : String(e),
          version: downloadedUpdateVersion ?? app.getVersion(),
          progress: null,
        });
      }
    })();
  }, 650);
  return response;
}

function setupAutoUpdates(): void {
  if (!app.isPackaged || process.env.NODUS_DISABLE_AUTO_UPDATE === '1') {
    console.log('[updates] disabled outside packaged app');
    return;
  }

  useUnsignedMacUpdaterFallback = process.platform === 'darwin' && !macAppHasDeveloperIdSignature();
  autoUpdater.autoDownload = true;
  // Squirrel.Mac only reliably hands off to a Developer ID-signed app. For the
  // current ad-hoc fallback, keep electron-updater's verified ZIP and replace
  // the writable .app with our external helper instead of waiting forever for
  // a native event that macOS never delivers.
  // Download silently, but never install on quit: every platform uses the
  // explicit install action and its verified-backup gate.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  configureUpdateChannel(getSettings().betaUpdates, 'startup');
  console.log(
    useUnsignedMacUpdaterFallback
      ? '[updates] using unsigned macOS fallback installer'
      : '[updates] using native updater hand-off'
  );

  autoUpdater.on('checking-for-update', () => console.log('[updates] checking for update'));
  autoUpdater.on('update-available', (info) => {
    if (downloadedUpdateVersion || installingUpdate) return;
    if (isPrereleaseVersion(info.version) && !getSettings().betaUpdates) {
      // Defensive race guard: a preference change can land while a network check
      // is resolving. Prevent autoDownload before checkForUpdates continues.
      autoUpdater.autoDownload = false;
      activeUpdateVersion = null;
      console.warn(`[updates] ignored prerelease ${info.version} on the stable channel`);
      return;
    }
    // Prereleases always require a verified snapshot. Stable releases also use one
    // when Recovery is configured. Prevent native install-on-quit from racing the
    // asynchronous snapshot and bypassing its verification.
    if (isPrereleaseVersion(info.version) || hasConfiguredRecoveryFolder()) {
      autoUpdater.autoInstallOnAppQuit = false;
    }
    console.log(`[updates] update available: ${info.version}`);
    activeUpdateVersion = info.version;
    lastDownloadProgressEmitAt = 0;
    lastDownloadProgressPercent = -1;
    emitUpdate({
      status: 'available',
      message: `Actualización ${info.version} encontrada. Descargando…`,
      version: info.version,
      progress: 0,
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    if (downloadedUpdateVersion || installingUpdate) return;
    console.log(`[updates] up to date: ${info.version}`);
    if (!downloadedUpdateVersion) activeUpdateVersion = null;
    emitUpdate({
      status: 'not-available',
      message: `Nodus ${app.getVersion()} ya está actualizado.`,
      version: app.getVersion(),
      progress: null,
    });
  });
  autoUpdater.on('download-progress', (p) => {
    if (downloadedUpdateVersion || installingUpdate) return;
    const percent = Math.max(0, Math.min(100, p.percent ?? 0));
    const roundedPercent = Math.round(percent);
    const now = Date.now();
    // electron-updater can report several byte-level samples per animation frame on
    // fast links. The UI only displays whole percentages, so repeated or sub-500 ms
    // samples buy no visible fidelity and otherwise cause IPC, React and log churn.
    if (roundedPercent === lastDownloadProgressPercent
      || (roundedPercent < 100 && now - lastDownloadProgressEmitAt < UPDATE_PROGRESS_MIN_INTERVAL_MS)) return;
    lastDownloadProgressPercent = roundedPercent;
    lastDownloadProgressEmitAt = now;
    console.log(`[updates] downloading ${roundedPercent}% (${Math.round((p.bytesPerSecond ?? 0) / 1024)} KiB/s)`);
    emitUpdate({
      status: 'downloading',
      message: `Descargando actualización… ${roundedPercent}%`,
      version: downloadedUpdateVersion ?? undefined,
      progress: percent,
      bytesPerSecond: p.bytesPerSecond ?? null,
      transferred: p.transferred ?? null,
      total: p.total ?? null,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    if (installingUpdate) return;
    if (isPrereleaseVersion(info.version) && !getSettings().betaUpdates) {
      activeUpdateVersion = info.version;
      discardPendingPrereleaseUpdate();
      emitUpdate({
        status: 'not-available',
        message: 'Se ignoró una versión beta porque Beta updates está desactivado.',
        version: app.getVersion(),
        progress: null,
      });
      return;
    }
    downloadedUpdateVersion = info.version;
    downloadedUpdateFile = info.downloadedFile;
    console.log(`[updates] downloaded ${info.version}; waiting for user to restart`);
    emitUpdate({
      status: 'downloaded',
      message: `Actualización ${info.version} descargada. Puedes instalarla y reiniciar cuando quieras.`,
      version: info.version,
      progress: 100,
    });
  });
  autoUpdater.on('error', (e) => {
    const failedDuringInstall = installingUpdate;
    if (installUpdateTimer) {
      clearTimeout(installUpdateTimer);
      installUpdateTimer = null;
    }
    installingUpdate = false;
    activeUpdateCancellationToken = null;
    console.error(`[updates] error: ${e instanceof Error ? e.message : String(e)}`);
    emitUpdate({
      status: 'error',
      errorCode: failedDuringInstall ? 'update-install-failed' : 'update-download-failed',
      message: e instanceof Error ? e.message : String(e),
      version: downloadedUpdateVersion ?? app.getVersion(),
      progress: null,
    });
  });

  // The renderer's startup banner performs the immediate check and
  // presents its result. Keep the long-running scheduled checks here.
  //
  // Announcements ride this timer rather than starting a second one: they change a few
  // times a year, so a tick of their own would be a wake-up bought for nothing. The
  // first check is delayed instead of immediate — startup is the one moment the main
  // process's single event loop is genuinely contended, and nothing here is urgent.
  updateCheckTimer = setInterval(() => {
    void checkForUpdates('scheduled');
    void refreshAnnouncements('scheduled');
  }, UPDATE_CHECK_INTERVAL_MS);
  announcementsFirstTimer = setTimeout(() => void refreshAnnouncements('startup'), ANNOUNCEMENTS_STARTUP_DELAY_MS);
}

// Deeplink via OS (macOS open-url) — must be registered before ready.
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// A second copy of this profile tried to start. It has already quit; bring the
// window the user was actually looking for to the front.
// If it was a nodus:// deeplink (OAuth callback via system browser), forward it.
app.on('second-instance', (_event, argv) => {
  const deeplink = argv.find((arg) => typeof arg === 'string' && arg.startsWith('nodus://'));
  if (deeplink) handleDeepLink(deeplink);
  restoreAppWindows(mainWindow, createWindow, applyMascotWindow);
  const win = mainWindow;
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
});

app.whenReady().then(async () => {
  // Losing the lock queues a quit; do not open the database or a window.
  if (!hasSingleInstanceLock) return;
  // Which capabilities exist has to be settled before the skill library is read: a skill
  // that depends on one cannot be judged available until its provider has registered.
  initializeCapabilityPluginStore();
  rebuildCapabilityRegistry();
  initializeChatSkillDefaults();
  initializePluginStore();
  // The three disciplines that became packages are adopted in the background. A profile
  // that needs one keeps the skill it already had until the package is in place, and a
  // migration that cannot finish must never hold up the window or turn a skill off: it
  // leaves a retry in the journal and says so in the interface.
  //
  // It waits for the window rather than starting here, because the move needs a utility
  // process and this is the one moment the main process cannot spare one. Measured on a
  // real profile: with the loop stalled the child is not serviced, and depending on how
  // long the stall runs it either never spawns inside its deadline or spawns, completes
  // its handshake and is torn down in the same millisecond — reported either way as a
  // capability that would not start, for a worker that comes up in about 100 ms on a free
  // loop. Nothing here is urgent, and 5.4.0 shipped this in the contended window.
  if (!process.env.NODUS_ISOLATED_ROOT) void afterFirstPaint(() => {
    void settleInstalledPluginMigrations()
      .then(settled => { if (settled.length) rebuildCapabilityRegistry(); })
      .catch(error => console.warn('[capabilities] outstanding data migrations could not be settled:', error));
    runCapabilityProfileMigration();
  });
  removeDisplacedMacBundle();
  restorePersistedDockIcon();
  // YouTube (embedded by the PDF Presenter's audience overlay) flags Electron's
  // User-Agent as a bot. Strip the Electron/app tokens so the embed loads; the
  // change is cosmetic for every other kind of web content Nodus may open.
  const cleanUa = session.defaultSession
    .getUserAgent()
    .replace(/\s*Electron\/[\S]+/g, '')
    .replace(/\s*nodus\/[\S]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  session.defaultSession.setUserAgent(cleanUa);
  // Same embeds, second obstacle: a packaged renderer is served from file://, so the
  // frame request carries no http(s) referer and YouTube answers with error 153.
  // OpenStreetMap also needs an identified client. A single scoped listener keeps
  // both rules active: registering another listener would replace the first one.
  installMediaRequestHeaders(session.defaultSession.webRequest, app.getVersion());
  // Nodus Toolkit OCR caches its Tesseract language traineddata here (the one
  // opt-in network call), so downloads persist across sessions in userData.
  if (!process.env.NODUS_TESSDATA_CACHE) {
    process.env.NODUS_TESSDATA_CACHE = path.join(app.getPath('userData'), 'tessdata');
  }
  // This must be the final operation before opening SQLite. Nodus 4 can rewrite
  // schemas and Library manifests that a 3.x binary does not understand, so the first
  // v4 launch takes and verifies one immutable copy while every database is closed.
  const preV4 = await ensurePreV4Recovery({
    userDataDirectory: app.getPath('userData'),
    targetVersion: app.getVersion(),
  });
  if (preV4.snapshotPath) console.log(`[recovery] pre-v4 snapshot: ${preV4.snapshotPath}`);
  getDb(); // open + migrate before anything touches data
  const startupVault = getActiveVault();
  if (startupVault.type === 'databases') ensureDatabaseDeepResearchLane(startupVault.id);
  // Do this before creating either the main window or a browser tab: Chromium
  // then exposes the same effective preference to pages from their first frame.
  setBrowserTheme(getSettings().theme);
  // A form server that cannot listen is a missing feature, not a failed launch: this await
  // sits before the window exists, and a rejection here quit the app with a startup error.
  if (!process.env.NODUS_ISOLATED_ROOT && process.env.NODUS_STELLAR_PREVIEW !== '1') await startDatabaseFormServer(Number.parseInt(process.env.NODUS_DATABASE_FORM_PORT ?? '0', 10) || 0)
    .catch((error) => console.error(`[database-forms] server did not start: ${error instanceof Error ? error.message : String(error)}`));
  upgradeWorldbuildingDemoDynasties();
  upgradeWorldbuildingDemoImageQuality();
  upgradeWorldbuildingDemoNarrativeDepth();
  relocalizeWorldbuildingDemoData();
  registerImageProtocol();
  registerArchiveProtocol();
  registerLibraryProtocol();
  reconcileAuthorLayerOnce(); // one-time: collapse duplicate author nodes onto Zotero identity
  reconcileAuthorRolesOnce(); // one-time: stop crediting volume editors as authors
  repairGraphIntegrityOnce(); // one-time: drop links to deleted themes, put edge-only ideas back to sleep
  repairDocumentSupportPassagesOnce(); // one-time: point citation supports at the passage holding their quote
  // Maintenance: drop ideas that have sat dormant (no occurrences) for >30 days.
  // Recent dormancy is kept — it lets fusion revive an idea with the same
  // global_id when its work is rescanned.
  try {
    const prunedIdeas = pruneDormantIdeas();
    if (prunedIdeas > 0) console.log(`[maintenance] pruned ${prunedIdeas} long-dormant ideas`);
  } catch (error) {
    // Maintenance must never keep the app from opening.
    console.error(`[maintenance] dormant-idea prune failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  setCopilotWindowProvider(() => mainWindow);
  setZoteroPluginWindowProvider(() => mainWindow);
  registerIpc(
    () => mainWindow,
    () => checkForUpdates('manual'),
    installDownloadedUpdate,
    (betaUpdates) => configureUpdateChannel(betaUpdates, 'setting changed'),
    () => lastUpdateEvent,
  );
  createWindow();
  // The isolated graph review copy never resumes background jobs or connects integrations.
  const { initializeDocumentaryPreparation, closeDocumentaryPreparation } = await import('./ai/documentaryPreparation');
  stopDocumentaryPreparation = closeDocumentaryPreparation;
  stopResearchZotero = (await import('./mcp/researchZotero')).closeResearchZotero;
  await initializeDocumentaryPreparation();
  if (process.env.NODUS_ISOLATED_ROOT || process.env.NODUS_STELLAR_PREVIEW === '1') return;
  // Existing installs may have one full database copy per historical schema update.
  // Queue every registered vault after the window exists; the utility worker applies
  // retention without delaying startup or opening any vault on the main thread.
  scheduleMigrationRecoveryRetention(listVaults().map((vault) => vault.path));
  // Deliver any nodus:// deeplink that launched the app (OAuth callback via
  // system browser, e.g. nodus://authorize?code=XYZ).
  if (pendingDeepLink) {
    const url = pendingDeepLink;
    pendingDeepLink = null;
    // createWindow is async (loadURL); wait a tick so webContents exists.
    setTimeout(() => handleDeepLink(url), 800);
  }

  // Recover API keys encrypted by the pre-2.3 lowercase Safe Storage identity.
  // The window is created first so any macOS Keychain authorization prompt has
  // visible app context. On success the renderer refreshes Settings, and the
  // configured recovery workspace immediately receives a complete new snapshot.
  void recoverLegacyApiKeys().then(async (result) => {
    if (result.recoveredProviders.length > 0) {
      mainWindow?.webContents.send('settings:apiKeysRecovered', result);
      const recoverySettings = getSettings();
      if (recoverySettings.autoBackupEnabled && recoverySettings.autoBackupFolder) {
        const backup = await runAutoBackupNow(app.getVersion());
        console.log(`[backup] API-key recovery snapshot: ${backup.ok ? 'ok' : 'error'}: ${backup.message}`);
      }
    } else if (result.remainingLockedProviders.length > 0) {
      mainWindow?.webContents.send('settings:apiKeysRecovered', result);
    }
  }).catch((error) => console.error(`[secrets] recovery failed safely: ${error instanceof Error ? error.message : String(error)}`));

  const settings = getSettings();
  // Queue resume is opt-in: pending DB state may come from previous automatic versions.
  if (settings.autoResumeQueue) scanQueue.resumePending();

  // Automatic backups: first check shortly after launch (so an overdue backup
  // runs without waiting a full interval), then a low-frequency heartbeat. The
  // heavy work (SQLite snapshot + scrypt + AES) is a single async pass and the
  // schedule state lives in settings, so missed ticks self-correct.
  const autoBackupTick = () => {
    // A backup snapshots every vault, so on a large library it can outlast the
    // 30-minute heartbeat. Overlapping runs would hold two full copies of the
    // whole library in memory at once, so a tick that arrives while one is
    // still running is dropped — the schedule lives in settings, so the next
    // tick picks it up.
    if (autoBackupRunning) {
      console.log('[backup] skipped: the previous backup is still running');
      return;
    }
    if (quitting) return;
    autoBackupRunning = true;
    void (async () => {
      const backup = await maybeRunAutoBackup(app.getVersion());
      if (backup) console.log(`[backup] ${backup.ok ? 'ok' : 'error'}: ${backup.message}`);
      // Never age-clean immediately after a due backup failed: preserving every older
      // recovery point is safer than applying retention without a fresh snapshot.
      if (backup && !backup.ok) return;
      const cleanup = await maybeRunBackupCleanup();
      if (cleanup) console.log(`[backup-cleanup] ${cleanup.ok ? 'ok' : 'error'}: ${cleanup.message}`);
    })().catch((error) => {
        // Without this the rejection was unhandled, which under Node's default
        // terminates the process — unattended, every 30 minutes.
        console.error(`[backup] failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        autoBackupRunning = false;
      });
  };
  autoBackupFirstTimer = setTimeout(autoBackupTick, 2 * 60 * 1000);
  autoBackupTimer = setInterval(autoBackupTick, 30 * 60 * 1000);

  // Recurring database templates are local, transactional and idempotent. A short
  // heartbeat also covers vault switches; every occurrence key is unique, so a crash
  // or overlapping wake-up cannot create the same scheduled page twice.
  const recurringTemplateTick = () => {
    if (quitting) return;
    try {
      const created = runDueDatabaseRowTemplates(new Date().toISOString(), 25);
      if (created.length) mainWindow?.webContents.send('db:templatesInstantiated', { count: created.length });
    } catch (error) {
      console.error(`[database-templates] failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  taskTemplateFirstTimer = setTimeout(recurringTemplateTick, 5_000);
  taskTemplateTimer = setInterval(recurringTemplateTick, 60_000);

  // Automation schedules share the same idempotent run log as interactive triggers.
  // A single-flight tick prevents slow webhooks from overlapping with the next wake-up.
  let databaseAutomationRunning = false;
  const databaseAutomationTick = () => {
    if (quitting || databaseAutomationRunning) return;
    databaseAutomationRunning = true;
    void runDueAutomationRules(new Date().toISOString(), 25)
      .then((runs) => {
        if (runs.length) mainWindow?.webContents.send('db:automationsRan', { count: runs.length });
      })
      .catch((error) => console.error(`[database-automations] failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => { databaseAutomationRunning = false; });
  };
  databaseAutomationFirstTimer = setTimeout(databaseAutomationTick, 7_000);
  databaseAutomationTimer = setInterval(databaseAutomationTick, 60_000);

  if (settings.syncMode === 'realtime') startRealtimeSync();
  startNodusServerSync();
  // And the other direction, on its own timer too: an incoming mutation dirties nothing,
  // so an idle desktop that only ever published would never collect what was sent to it.
  startInboxPolling();
  startPluginUpdates();
  // Connected vaults pull on their own timer: a replica must stay current whichever vault
  // happens to be open, exactly like the publisher already does.
  startReplicaSync();
  if (settings.mcpEnabled) void startMcpServer().then(() => startMcpTunnelIfConfigured());
  // Basic mode: the Nodus Server the user chose to run on this computer, plus whichever sleep
  // defence they left held. Both are fire-and-forget — a server that will not start is a
  // message in Settings, not a reason to hold up the window.
  void startLocalServerIfEnabled();
  if (settings.localServerKeepAwake) holdAwake();
  if (settings.copilotEnabled) void startCopilotServer();
  if (settings.zoteroPluginEnabled || settings.browserConnectorEnabled) void startZoteroPluginServer();
  // Nodi mascot: open the always-on-top desktop window when the user has opted into it.
  seedWelcomeNotification();
  startRadarScheduler();
  startStudyCalendarReminders();
  startAppleCalendarSync();
  applyMascotWindow();
  setupAutoUpdates();
  void reportInterruptedUpdateInstall();

  // Genealogy demo: fill in the daguerreotype portraits in the background if this
  // vault is showing the demo, a Gemini key is present, and some are still missing.
  if (settings.demoMode && getActiveVault().type === 'genealogy' && hasDemoPortraitKey() && demoPortraitsPending()) {
    void generateDemoPortraits({
      onProgress: (done, total) => mainWindow?.webContents.send('demo:portraits', { done, total }),
    }).catch(() => undefined);
  }

  app.on('activate', () => {
    restoreAppWindows(mainWindow, createWindow, applyMascotWindow);
  });
}).catch((error) => {
  // Startup opens and migrates the database before the first window exists, so
  // a failure here used to leave no window and no message — the app simply
  // never appeared. Tell the user which step failed instead.
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[startup] failed before the window was ready: ${message}`);
  dialog.showErrorBox(
    'Nodus no pudo iniciarse',
    `Fallo al preparar la biblioteca:\n\n${message}\n\n` +
      'Si el problema persiste, restaura una copia de seguridad o abre otra bóveda.'
  );
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    quitting = true;
    if (autoBackupTimer) clearInterval(autoBackupTimer);
    if (autoBackupFirstTimer) clearTimeout(autoBackupFirstTimer);
    if (taskTemplateTimer) clearInterval(taskTemplateTimer);
    if (taskTemplateFirstTimer) clearTimeout(taskTemplateFirstTimer);
    if (databaseAutomationTimer) clearInterval(databaseAutomationTimer);
    if (databaseAutomationFirstTimer) clearTimeout(databaseAutomationFirstTimer);
    cancelScheduledMigrationRecoveryRetention();
    void stopDatabaseFormServer();
    stopRealtimeSync();
    stopNodusServerSync();
    stopInboxPolling();
    stopPluginUpdates();
    stopRadarScheduler();
    stopReplicaSync();
    void stopDesktopBridge();
    interruptDecorativeImageGenerations();
    stopAllWhisperCpp();
    destroyBrowserSubsystem();
    closeGlobalLibraryRuntime();
    killNodusLocalServerSync();
  // Research Chat's search server: stdin closes too, so it would also exit on its own.
  killSearxngSync();
    documentIndexQueue.stop();
    closeDb();
    app.quit();
  }
});

let editorQuitApproved = false;
let editorQuitPending = false;
app.on('before-quit', event => {
  if (!editorQuitApproved && mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    if (!editorQuitPending) {
      editorQuitPending = true;
      void flushWindowEditors(mainWindow).then(saved => {
        editorQuitPending = false;
        if (saved) { editorQuitApproved = true; app.quit(); }
      });
    }
    return;
  }
  quitting = true;
  stopDocumentaryPreparation();
  void stopResearchZotero();
  stopStudyCalendarReminders();
  stopAppleCalendarSync();
  stopAllWhisperCpp();
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (installUpdateTimer) clearTimeout(installUpdateTimer);
  if (announcementsFirstTimer) clearTimeout(announcementsFirstTimer);
  // getDb() reopens (and re-migrates) lazily, so a backup tick landing after
  // closeDb() would resurrect the database on a shutting-down process.
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  if (autoBackupFirstTimer) clearTimeout(autoBackupFirstTimer);
  if (taskTemplateTimer) clearInterval(taskTemplateTimer);
  if (taskTemplateFirstTimer) clearTimeout(taskTemplateFirstTimer);
  if (databaseAutomationTimer) clearInterval(databaseAutomationTimer);
  if (databaseAutomationFirstTimer) clearTimeout(databaseAutomationFirstTimer);
  cancelScheduledMigrationRecoveryRetention();
  void stopDatabaseFormServer();
  stopRealtimeSync();
  stopNodusServerSync();
  stopInboxPolling();
  stopPluginUpdates();
  stopRadarScheduler();
  stopReplicaSync();
  void stopDesktopBridge();
  interruptDecorativeImageGenerations();
  killMcpTunnelSync();
  // The local server is a child process and the sleep defences are machine-wide state: both
  // have to be let go here, or quitting leaves an orphan serving and a laptop that cannot sleep.
  killLocalServerSync();
  releaseAllPower();
  void stopMcpServer();
  void stopCopilotServer();
  void stopZoteroPluginServer();
  // Kill synchronously: this handler cannot await, so the graceful stops below would
  // be abandoned mid-drain and leave the vendor runtimes running as orphans.
  killChatGptSubscriptionServer();
  killGitHubCopilotSubscriptionServer();
  killNodusLocalServerSync();
  // Research Chat's search server: stdin closes too, so it would also exit on its own.
  killSearxngSync();
  destroyBrowserSubsystem();
  closeGlobalLibraryRuntime();
  documentIndexQueue.stop();
  // The log coalesces its writes, so the last seconds of a corpus run are still in memory
  // and this handler cannot await. Flush before the database goes away.
  flushPipelineLogs();
  closeDb();
});

// Final idempotent backstop for every cooperative quit path. before-quit does
// the substantive shutdown; will-quit proves no Browser-owned WebContents can
// survive a handler added later that closes the window in a different order.
app.on('will-quit', () => {
  destroyBrowserSubsystem();
});

const updateAwareApp = app as typeof app & { on(event: 'before-quit-for-update', listener: () => void): typeof app };
updateAwareApp.on('before-quit-for-update', () => {
  quitting = true;
  killNodusLocalServerSync();
  // Research Chat's search server: stdin closes too, so it would also exit on its own.
  killSearxngSync();
  if (updateCheckTimer) clearInterval(updateCheckTimer);
  if (announcementsFirstTimer) clearTimeout(announcementsFirstTimer);
  if (autoBackupTimer) clearInterval(autoBackupTimer);
  if (autoBackupFirstTimer) clearTimeout(autoBackupFirstTimer);
  if (taskTemplateTimer) clearInterval(taskTemplateTimer);
  if (taskTemplateFirstTimer) clearTimeout(taskTemplateFirstTimer);
  if (databaseAutomationTimer) clearInterval(databaseAutomationTimer);
  if (databaseAutomationFirstTimer) clearTimeout(databaseAutomationFirstTimer);
  cancelScheduledMigrationRecoveryRetention();
  void stopDatabaseFormServer();
  stopRealtimeSync();
  stopNodusServerSync();
  stopInboxPolling();
  stopPluginUpdates();
  stopRadarScheduler();
  stopReplicaSync();
  void stopDesktopBridge();
  interruptDecorativeImageGenerations();
  stopAllWhisperCpp();
  killMcpTunnelSync();
  // The local server is a child process and the sleep defences are machine-wide state: both
  // have to be let go here, or quitting leaves an orphan serving and a laptop that cannot sleep.
  killLocalServerSync();
  releaseAllPower();
  void stopMcpServer();
  void stopCopilotServer();
  void stopZoteroPluginServer();
  // Kill synchronously: this handler cannot await, so the graceful stops below would
  // be abandoned mid-drain and leave the vendor runtimes running as orphans.
  killChatGptSubscriptionServer();
  killGitHubCopilotSubscriptionServer();
  destroyBrowserSubsystem();
  closeGlobalLibraryRuntime();
  documentIndexQueue.stop();
  closeDb();
});
