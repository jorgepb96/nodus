import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, shell } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import archiver from 'archiver';
import { open as openZip } from 'yauzl';
import { SupportService } from './core/service.mjs';
import { assert, copyInventory, destination, inventory, noLinks, readJson, separate, sufficientSpace as sufficientSpaceForArchive, verifyInventory, writeNew } from './core/files.mjs';
import { runProbe } from './core/probe.mjs';
import { SolutionManager } from './core/solutions.mjs';
import { resolvePolicy } from './core/policies.mjs';
import { activateInstallation, recoverInstallation } from './core/install-transaction.mjs';
import { downloadArtifact, extractRuntime, installerCommand, preserveInstallation, resolveRelease, runInstaller } from './core/releases.mjs';
import { issueDraft } from '../../shared/support/report.mjs';
import { supportText, SUPPORT_LANGUAGES } from '../../shared/support/messages';
import trustedKeys from './trusted-release-keys.json';
import qualifiedRepairs from './qualified-repairs.json';
import { requireQualified } from './core/qualification.mjs';
import { guideUrl } from '../../shared/support/guides.mjs';
import { retainSupportRuntime } from './core/self-runtime.mjs';

const exec = promisify(execFile);
app.setName('Nodus Support'); app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: 'nodus-support', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const stateRoot = argument('support-state') ?? path.join(app.getPath('appData'), 'Nodus Support');
app.setPath('userData', path.join(stateRoot, 'interface'));
let win; let service; let quitRequested = false;
const text = key => supportText(service?.locale ?? 'en', key);
const privateDirectory = async folder => {
  const directory = (await fsp.stat(folder)).isDirectory();
  if (process.platform !== 'win32') return fsp.chmod(folder, directory ? 0o700 : 0o600);
  const username = os.userInfo().username;
  await exec('icacls.exe', [folder, '/inheritance:r', '/grant:r', `${username}:${directory ? '(OI)(CI)' : ''}F`], { windowsHide: true });
};
function detectExecutable() {
  const candidates = process.platform === 'darwin' ? ['/Applications/Nodus.app/Contents/MacOS/Nodus',path.join(app.getPath('home'),'Applications/Nodus.app/Contents/MacOS/Nodus')]
    : process.platform === 'win32' ? [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA,'Programs/Nodus/Nodus.exe'),process.env.ProgramFiles && path.join(process.env.ProgramFiles,'Nodus/Nodus.exe')]
    : ['/opt/Nodus/nodus','/opt/nodus/nodus','/usr/lib/nodus/nodus'];
  return candidates.find(file=>file && fs.existsSync(file)) ?? null;
}
const isRunning = async () => {
  if (process.platform === 'win32') {
    const { stdout } = await exec('tasklist.exe', ['/FI','IMAGENAME eq Nodus.exe','/FO','CSV','/NH'], { windowsHide: true });
    return /"Nodus\.exe"/i.test(stdout);
  }
  const { stdout } = await exec('/bin/ps', ['-A','-o','comm=']);
  return stdout.split('\n').some(line => ['Nodus','nodus'].includes(path.basename(line.trim())));
};
async function loadState() {
  let config = {};
  const folder = path.join(stateRoot, 'choices');
  if (fs.existsSync(folder)) {
    const files = fs.readdirSync(folder).filter(file => /^\d+-[a-f0-9-]+\.json$/.test(file)).sort();
    try { if (files.length) config = readJson(path.join(folder, files.at(-1))); } catch { /* Choices can always be selected again. */ }
  }
  const defaultProfile = ['Nodus','nodus'].map(name => path.join(app.getPath('appData'), name)).find(folder => fs.existsSync(folder)) ?? path.join(app.getPath('appData'), 'Nodus');
  service = new SupportService({ storage: config.storage ?? path.join(stateRoot, 'retained'), profile: argument('nodus-profile') ?? config.profile ?? defaultProfile, executable: argument('nodus-executable') ?? config.executable ?? detectExecutable(), locale: app.getLocale(), isRunning, probe: runProbe, privateDirectory, onIdle: () => { if (quitRequested) queueMicrotask(() => app.quit()); },
    progress: progress => { if (win && !win.isDestroyed()) win.webContents.send('support:progress', progress); } });
  service.locale = config.language ?? (await service.inspect()).inspection.language;
  const active=resolvePolicy(path.join(stateRoot,'launch-policies'),service.profile);
  if(active?.recoveredRoot) {service.originProfile=service.profile;service.profile=path.join(active.recoveredRoot,'profile');}
}
async function remember() {
  await writeNew(path.join(stateRoot, 'choices', `${Date.now()}-${randomUUID()}.json`), { storage: service.storage, profile: service.originProfile??service.profile, executable: service.executable, language: service.locale });
}
async function choose(kind) {
  assert(!service.busy, 'OPERATION_RUNNING');
  const result = await dialog.showOpenDialog(win, { properties: kind === 'executable' ? ['openFile', ...(process.platform === 'darwin' ? ['openDirectory'] : [])] : ['openDirectory','createDirectory'] });
  if (result.canceled) return null;
  const chosen = result.filePaths[0]; noLinks(chosen);
  if (kind === 'profile') { separate(chosen, service.storage); service.profile = chosen; service.originProfile=null; }
  else if (kind === 'storage') { separate(chosen, service.profile); service.storage = path.join(chosen, 'Nodus-Support-retained'); }
  else if (process.platform === 'darwin' && chosen.endsWith('.app')) service.executable = path.join(chosen, 'Contents/MacOS/Nodus');
  else service.executable = chosen;
  await remember(); return service.inspect();
}
const confirmation = async (message, detail) => (await dialog.showMessageBox(win, { type: 'question', message, detail, buttons: [text('cancel'), text('confirm')], defaultId: 0, cancelId: 0, noLink: true })).response === 1;
async function saveZip(folder) {
  const output = `${folder}.zip`;
  // Set a private ACL while the archive is still empty, before writing any raw logs.
  const fd = await fsp.open(output,'wx',0o600); await fd.close(); await privateDirectory(output);
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(output, { flags: 'r+', mode: 0o600 });
    const archive = archiver('zip', { zlib: { level: 6 }, forceZip64: true });
    archive.on('error', reject); stream.on('error', reject); stream.on('close', resolve);
    archive.pipe(stream); archive.directory(folder, false); void archive.finalize();
  }); return output;
}
async function chooseExport() {
  const picked = await dialog.showOpenDialog(win, { properties: ['openDirectory','createDirectory'] });
  return picked.canceled ? null : picked.filePaths[0];
}
async function verifyPlatformSignature(executable) {
  if (process.platform === 'darwin') {
    const bundle = path.resolve(executable,'../../..');
    await exec('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
    await exec('/usr/sbin/spctl',['--assess','--type','execute',bundle]);
  } else if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    await exec(powershell,['-NoProfile','-NonInteractive','-Command',"if ((Get-AuthenticodeSignature -LiteralPath $env:NODUS_SUPPORT_VERIFIED_INSTALLER).Status -ne 'Valid') { exit 1 }"],{env:{...process.env,NODUS_SUPPORT_VERIFIED_INSTALLER:executable},windowsHide:true});
  }
}
async function reinstall(id,update=false) {
  assert(typeof update==='boolean','INVALID_REQUEST');
  requireQualified(qualifiedRepairs, process.platform, process.arch, 'reinstall');
  const session = await service.session(id); await service.guardSource(session); await service.protectedSources(session);
  if (!await confirmation(text('reinstall'), text('automaticHelp'))) return session;
  return service.exclusive(async () => {
    service.activeId = id; service.controller = new AbortController();
    try {
      assert(trustedKeys.keys.length > 0, 'RELEASE_SIGNING_NOT_CONFIGURED');
      const version = session.inspection.version;
      assert(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version ?? ''), 'RELEASE_VERSION_UNKNOWN');
      const {manifest,previous}=await resolveRelease(version,trustedKeys.keys,process.platform,process.arch,{fetch:net.fetch.bind(net),signal:service.controller.signal,update,approveUpgrade:({from,to})=>confirmation(text('updateCompatible'),`${from} → ${to}\n${text('trial')}`)});
      const folder = path.join(session.folder, 'installation', randomUUID()); await fsp.mkdir(folder, { recursive: true, mode: 0o700 });
      await service.event(id, { status: 'testing', installationAttempt: folder });
      const runtime = await downloadArtifact(manifest.runtime, folder, { fetch: net.fetch.bind(net), signal:service.controller.signal, progress: service.progress });
      const candidate = path.join(folder, 'candidate'); await extractRuntime(runtime, candidate, openZip);
      const executable = destination(candidate, manifest.executable);
      await verifyPlatformSignature(executable);
      const working = await service.workingCopy(session);
      const dataCheck=await runProbe({executable,root:working.root,action:'database-check',signal:service.controller.signal});
      assert(dataCheck.ok&&dataCheck.protocol===1&&dataCheck.root===working.root,'CANDIDATE_FAILED');
      const check = await runProbe({ executable, root: working.root, action: 'fresh-profile', signal:service.controller.signal });
      assert(check.ok && check.protocol === 1 && check.root === working.root, 'CANDIDATE_FAILED');
      let format;
      if (process.platform === 'win32') format = 'nsis';
      else if (process.platform === 'darwin') format = 'zip';
      else if (service.executable.endsWith('.AppImage')) format = 'AppImage';
      else { try { await exec('/usr/bin/dpkg-query', ['-S', service.executable]); format = 'deb'; } catch { await exec('/usr/bin/rpm', ['-qf', service.executable]); format = 'rpm'; } }
      const artifact = manifest.installers.find(entry => entry.format === format); assert(artifact, 'INSTALLER_NOT_SUPPORTED');
      const installer = await downloadArtifact(artifact, folder, { fetch: net.fetch.bind(net), signal:service.controller.signal, progress: service.progress });
      if (process.platform === 'win32') await verifyPlatformSignature(installer);
      let rollbackInstaller=installer;
      if(manifest.version!==version&&['nsis','deb','rpm'].includes(format)) {
        const artifact=previous?.installers.find(entry=>entry.format===format);assert(artifact,'INSTALLATION_RECOVERY_REQUIRED');
        rollbackInstaller=await downloadArtifact(artifact,path.join(folder,'rollback-installer'),{fetch:net.fetch.bind(net),signal:service.controller.signal,progress:service.progress});
        if(process.platform==='win32')await verifyPlatformSignature(rollbackInstaller);
      }
      const original = process.platform === 'darwin' ? path.resolve(service.executable, '../../..') : format === 'AppImage' ? service.executable : path.dirname(service.executable);
      for (const root of session.inspection.roots) separate(original, root);
      const old = await preserveInstallation(original, folder);
      await service.event(id, { installationOriginal: original, installationPrevious: old, installerVerified: artifact.name, installerFormat:format, installationPreviousInstaller:rollbackInstaller, installationVersion:manifest.version });
      assert(!await isRunning(), 'CLOSE_NODUS_FIRST');
      for(const source of await service.protectedSources(session))await verifyInventory(source.original,source.inventory,service.controller.signal);
      service.controller.signal.throwIfAborted();
      if (process.platform === 'darwin' || format === 'AppImage') {
        const retained = `${original}.support-retained-${randomUUID()}`;
        const staged = `${original}.support-candidate-${randomUUID()}`;
        if(process.platform==='darwin') {
          await exec('/usr/bin/ditto',[path.resolve(executable,'../../..'),staged]);
          await exec('/usr/bin/codesign',['--verify','--deep','--strict',staged]);
        } else {await fsp.copyFile(installer,staged,fs.constants.COPYFILE_EXCL);await fsp.chmod(staged,0o700);}
        const transaction={original,retained,staged,previousInventory:await inventory(original,undefined,undefined,{links:true}),candidateInventory:await inventory(staged,undefined,undefined,{links:true})};
        await activateInstallation(transaction,installationTransaction=>service.event(id,{installationTransaction}));
      } else {
        await service.event(id,{installationSystemPending:true});
        const command=installerCommand(process.platform,format,installer,original);
        await runInstaller(command.command,command.args);
        await service.event(id,{installationSystemPending:false});
      }
      return service.event(id, { status: 'awaiting-user', actions: [...session.actions, { id: randomUUID(), action: 'reinstall', status: 'passed', at: new Date().toISOString() }] });
    } catch (error) { return service.blocked(id, error); }
    finally { service.activeId = null; service.controller = null; }
  });
}
async function launchRecovered(id, index) {
  requireQualified(qualifiedRepairs, process.platform, process.arch, 'interactive-copy');
  const session = await service.session(id); assert(Number.isInteger(index) && index >= 0 && index < session.recoveredProfiles.length, 'INVALID_REQUEST');
  const root = session.recoveredProfiles[index]; noLinks(root);
  assert(root.startsWith(`${session.folder}${path.sep}`) && service.executable, 'INVALID_REQUEST');
  assert((await service.installation())?.protocol === 1, 'LEGACY_READ_ONLY');
  // Interactive copies use the normal application only with the validated isolated bootstrap.
  const child = spawn(service.executable, [], { detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '', NODUS_USERDATA: '', NODUS_ISOLATED_ROOT: root, NODUS_SUPPORT_INTERACTIVE: '1', NODUS_QA_DEFER_CREDENTIAL_STATUS: '1', NODUS_STELLAR_PREVIEW: '1', NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_HARNESS_KEYS_FILE: path.join(root, 'no-provider-keys.json') } });
  await new Promise((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject); }); child.unref();
  return service.event(id,{trialOpened:root});
}
async function rollbackInstallation(id) {
  const session = await service.session(id); await service.guardSource(session); await service.protectedSources(session);
  assert(session.installationOriginal && session.installationPrevious, 'NO_INSTALLATION_CHANGE');
  const original = session.installationOriginal;
  for (const root of session.inspection.roots) separate(original,root);
  const protection = readJson(path.join(path.dirname(session.installationPrevious),'installation-protection.json'));
  assert(protection.source === original && protection.copy === session.installationPrevious,'INVALID_SESSION');
  await verifyInventory(protection.copy,protection.inventory);
  if(['nsis','deb','rpm'].includes(session.installerFormat)) {
    assert(session.installationPreviousInstaller,'INSTALLATION_RECOVERY_REQUIRED');
    if(!await confirmation(text('undoSolution'),text('reinstall')))return session;
    const command=installerCommand(process.platform,session.installerFormat,session.installationPreviousInstaller,original,{rollback:true});
    await service.event(id,{installationSystemRollbackPending:true});
    await runInstaller(command.command,command.args);
    await service.event(id,{installationSystemRollbackPending:false});
  } else {
    const staged=`${original}.support-rollback-${randomUUID()}`,retained=`${original}.support-attempt-${randomUUID()}`;
    await copyInventory(protection.copy,staged,await inventory(protection.copy,undefined,undefined,{links:true}));
    const transaction={original,retained,staged,previousInventory:await inventory(original,undefined,undefined,{links:true}),candidateInventory:protection.inventory};
    await activateInstallation(transaction,installationRollbackTransaction=>service.event(id,{installationRollbackTransaction}));
  }
  return service.event(id,{status:'reverted',installationPrevious:null,actions:[...session.actions,{id:randomUUID(),action:'undo-solution',status:'reverted',at:new Date().toISOString()}]});
}
async function handlers() {
  const handle = (name, fn) => ipcMain.handle(`support:${name}`, async (event, ...args) => {
    assert(event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame, 'INVALID_SENDER');
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, code: /^[A-Z][A-Z0-9_]*$/.test(error.code ?? '') ? error.code : 'OPERATION_FAILED' }; }
  });
  handle('setLanguage', async language => { assert(SUPPORT_LANGUAGES.includes(language),'INVALID_REQUEST'); service.locale = language; await remember(); });
  handle('openGuide',async id=>{assert(typeof id==='string','INVALID_REQUEST');await shell.openExternal(guideUrl(id,process.platform));});
  handle('inspect', async () => ({...await service.inspect(),qualifiedRepairs:qualifiedRepairs.platforms[`${process.platform}-${process.arch}`] ?? []})); handle('chooseProfile', () => choose('profile')); handle('chooseExecutable', () => choose('executable')); handle('chooseStorage', () => choose('storage'));
  handle('create', input => service.create(input)); handle('protect', id => service.protect(id)); handle('test', (id, action) => service.test(id, action));
  handle('answer', async (id, works) => {
    const session = await service.session(id);
    if (works === true) assert(session.trialOpened || session.installationPrevious,'USER_TRIAL_REQUIRED');
    if (works === false && session.installationPrevious) return service.exclusive(() => rollbackInstallation(id));
    return service.answer(id,works);
  });
  handle('cancel', id => service.cancel(id));
  handle('resume', async id => {
    const session=await service.session(id);
    if(session.inspection.profile!==service.profile||session.inspection.executable!==service.executable) {
      assert(await confirmation(text('resume'),`${text('profile')}: ${session.inspection.profile}\n${text('retained')}`),'TEST_CANCELLED');
      service.profile=session.inspection.profile;service.originProfile=null;service.executable=session.inspection.executable;await remember();
    }
    for(const key of ['installationTransaction','installationRollbackTransaction'])if(session[key]) {
      await service.guardSource(session);await service.protectedSources(session);
      const status=await recoverInstallation(session[key],transaction=>service.event(id,{[key]:transaction}));
      await service.event(id,{status:key==='installationRollbackTransaction'&&status==='awaiting-user'?'reverted':status});
    }
    if(session.installationSystemPending||session.installationSystemRollbackPending) {
      // A system installer can outlive the assistant. Require an explicit retry or rollback.
      return service.event(id,{status:'blocked',lastError:'INSTALLATION_RECOVERY_REQUIRED'});
    }
    await new SolutionManager(service,path.join(stateRoot,'launch-policies')).recover(id);
    return service.resume(id);
  });
  handle('launchRecovered', launchRecovered); handle('report', (id, selection) => service.report(id, selection)); handle('reinstall', reinstall);
  handle('applySolution', async (id,index) => {
    requireQualified(qualifiedRepairs,process.platform,process.arch,'apply-solution');
    if(!await confirmation(text('applySolution'),text('trial')))return service.session(id);
    return new SolutionManager(service,path.join(stateRoot,'launch-policies')).apply(id,index);
  });
  handle('undoSolution',async (id,choice='check')=>{
    const session=await service.session(id);
    if(session.installationPrevious)return service.exclusive(()=>rollbackInstallation(id));
    if(choice==='use-previous'&&!await confirmation(text('undoSolution'),text('changed')))return session;
    return new SolutionManager(service,path.join(stateRoot,'launch-policies')).undo(id,choice);
  });
  handle('reveal', async id => { const session = await service.session(id); await shell.openPath(session.folder); });
  handle('copyReport', value => { assert(typeof value === 'string' && value.length <= 200000, 'INVALID_REQUEST'); clipboard.writeText(value); });
  handle('saveReport', async (id, selection, reviewed) => { const folder = await chooseExport(); return folder ? saveZip(await service.saveReport(id, selection, reviewed, folder)) : null; });
  handle('exportOriginalLogs', async id => {
    const session = await service.session(id);
    if (!await confirmation(text('raw'), text('rawWarning'))) return null;
    const output = await chooseExport(); if (!output) return null;
    const folder = path.join(output, `nodus-private-logs-${randomUUID()}`); separate(service.profile, folder);
    await fsp.mkdir(folder, { mode: 0o700 }); await privateDirectory(folder);
    let i = 0;
    for (const source of service.logFiles()) { const manifest = await inventory(source); await copyInventory(source, path.join(folder, `log-${i++}${path.extname(source)}`), manifest); }
    await writeNew(path.join(folder, 'PRIVATE.txt'), text('rawWarning'));
    await service.event(session.id, { lastPrivateExport: folder }); return saveZip(folder);
  });
  handle('openIssue', async (id, selection, reviewed) => {
    assert(typeof reviewed === 'string' && reviewed.length <= 200000, 'INVALID_REQUEST');
    if (!await confirmation(text('review'), text('issueHelp'))) return;
    const { report } = await service.report(id, selection); const draft = issueDraft(report, reviewed);
    if (draft.needsClipboard) clipboard.writeText(reviewed);
    await shell.openExternal(draft.issueUrl);
  });
  handle('restore', async (id, password) => {
    requireQualified(qualifiedRepairs, process.platform, process.arch, 'restore-copy');
    assert(typeof password === 'string' && password.length > 0 && password.length <= 4096, 'RECOVERY_PASSWORD_REQUIRED');
    const session = await service.session(id); await service.guardSource(session); await service.protectedSources(session);
    assert((await service.installation())?.protocol === 1, 'LEGACY_READ_ONLY');
    const choice = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Nodus', extensions: ['nodus'] }] });
    if (choice.canceled) return session;
    return service.exclusive(async () => {
      service.activeId = id; service.controller = new AbortController();
      try {
        const working = await service.workingCopy(session, true);
        const archive = fs.realpathSync(choice.filePaths[0]); const manifest = await inventory(archive);
        await sufficientSpaceForArchive(working.root, manifest.bytes);
        await copyInventory(archive, path.join(working.root, 'recovery.nodus'), manifest, service.controller.signal);
        await service.event(id, { status: 'testing', recoveryAttempt: working.root });
        const result = await runProbe({ executable: service.executable, root: working.root, action: 'restore-archive', password, signal:service.controller.signal });
        assert(result.protocol === 1 && result.root === working.root, 'PROBE_INVALID');
        return service.event(id, { status: result.ok ? 'awaiting-user' : 'blocked', recoveredProfiles: result.ok ? [...session.recoveredProfiles, working.root] : session.recoveredProfiles, actions: [...session.actions, { id: randomUUID(), action: 'restore-copy', status: result.ok ? 'passed' : 'failed', code: result.code, at: new Date().toISOString() }] });
      } catch (error) { return service.blocked(id, error); }
      finally { service.activeId = null; service.controller = null; }
    });
  });
}
async function start() {
await app.whenReady();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  await fsp.mkdir(stateRoot, { recursive: true, mode: 0o700 }); await privateDirectory(stateRoot);
  await loadState();
  // Run from a retained copy before an installer can replace the bundled helper.
  if (app.isPackaged && !argument('support-retained')) {
    const source = process.platform === 'darwin' ? path.resolve(process.execPath, '../../..') : path.dirname(process.execPath);
    const target=await retainSupportRuntime(source,path.join(stateRoot,'runtimes'),process.platform==='darwin'?{copy:async(from,to)=>exec('/usr/bin/ditto',[from,to])}:{});
    const executable = process.platform === 'darwin' ? path.join(target, 'Contents/MacOS/nodus-support') : path.join(target, path.basename(process.execPath));
    app.releaseSingleInstanceLock();
    const child = spawn(executable, ['--support-retained=1', ...process.argv.slice(1).filter(arg => arg.startsWith('--nodus-') || arg.startsWith('--support-state='))], { detached: true, stdio: 'ignore' });
    await new Promise((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject); }); child.unref(); app.quit();
  } else {
    const ui = path.join(__dirname, 'ui');
    protocol.handle('nodus-support', request => {
      const url = new URL(request.url); const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      try { return net.fetch(pathToFileURL(destination(ui, relative)).href); } catch { return new Response('', { status: 403 }); }
    });
    win = new BrowserWindow({ width: 1120, height: 850, minWidth: 720, minHeight: 580, title: 'Nodus Support', icon: path.join(__dirname,'icon.png'), backgroundColor: '#171717', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, nodeIntegration: false, contextIsolation: true } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('nodus-support://app/')) event.preventDefault(); });
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, done) => done(false));
    await handlers(); await win.loadURL('nodus-support://app/index.html');
    app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
    app.on('before-quit', event => { if (service.busy) { event.preventDefault(); quitRequested = true; if (service.activeId) void service.cancel(service.activeId); } });
  }
}
app.on('window-all-closed', () => app.quit());
}
void start().catch(() => { dialog.showErrorBox('Nodus Support','SUPPORT_STARTUP_FAILED'); app.exit(1); });
