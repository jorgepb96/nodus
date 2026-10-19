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
import { assert, canonical, copyInventory, destination, hashFile, inside, inventory, noLinks, readJson, separate, sufficientSpace as sufficientSpaceForArchive, verifyInventory, writeNew,writeRecord } from './core/files.mjs';
import { runProbe } from './core/probe.mjs';
import { SolutionManager } from './core/solutions.mjs';
import { rememberSelection,selectCurrentProfile } from './core/selection.mjs';
import { activateInstallation, recoverInstallation } from './core/install-transaction.mjs';
import { acceptPlatformSignature, downloadArtifact, extractRuntime, installerCommand, preserveInstallation, resolveRelease, runInstaller } from './core/releases.mjs';
import { issueDraft } from '../../shared/support/report.mjs';
import { supportText, SUPPORT_LANGUAGES } from '../../shared/support/messages';
import trustedKeys from './trusted-release-keys.json';
import qualifiedRepairs from './qualified-repairs.json';
import { waitForTrial } from './core/trial-ready.mjs';
import { requireQualified } from './core/qualification.mjs';
import { guideUrl } from '../../shared/support/guides.mjs';
import { retainSupportRuntime } from './core/self-runtime.mjs';
import { verifyActivatedInstallation } from './core/installation.mjs';
import { protectInstallationRollback } from './core/rollback-protection.mjs';
import { supportSandbox } from './core/linux-sandbox.mjs';
import { SUPPORT_ACTIONS } from '../../shared/support/catalog.mjs';

const exec = promisify(execFile);
app.setName('Nodus Support'); app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: 'nodus-support', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const stateRoot = argument('support-state') ?? path.join(app.getPath('appData'), 'Nodus Support');
app.setPath('userData', path.join(stateRoot, 'interface'));
let win; let service; let quitRequested = false;let rememberTail=Promise.resolve();
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
  const names=new Set(['Nodus','nodus','Nodus.exe',...(service?.executable?[path.basename(service.executable)]:[])].map(name=>name.toLowerCase()));
  if (process.platform === 'win32') {
    const { stdout } = await exec('tasklist.exe', ['/FO','CSV','/NH'], { windowsHide: true });
    return stdout.split('\n').some(line=>names.has(line.trim().match(/^"([^"]+)"/)?.[1]?.toLowerCase()));
  }
  const { stdout } = await exec('/bin/ps', ['-A','-o','comm=']);
  return stdout.split('\n').some(line=>{const name=path.basename(line.trim()).toLowerCase();return names.has(name)||name.length===15&&[...names].some(expected=>expected.startsWith(name));});
};
async function loadState() {
  let config = {},choicesError=false;
  const folder = path.join(stateRoot, 'choices');
  if (fs.existsSync(folder)) {
    const files = fs.readdirSync(folder).filter(file => /^\d+-[a-f0-9-]+\.json$/.test(file)).sort();
    try {
      if (files.length) {
        const value=readJson(path.join(folder,files.at(-1)));
        assert(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_REQUEST');
        for(const key of ['profile','storage','executable'])assert(value[key]===undefined||value[key]===null||typeof value[key]==='string'&&path.isAbsolute(value[key]),'INVALID_PATH');
        config=value;
      }
    } catch { choicesError=true; }
  }
  const defaultProfile = ['Nodus','nodus'].map(name => path.join(app.getPath('appData'), name)).find(folder => fs.existsSync(folder)) ?? path.join(app.getPath('appData'), 'Nodus');
  service = new SupportService({ storage: config.storage ?? path.join(stateRoot, 'retained'), profile: argument('nodus-profile') ?? config.profile ?? defaultProfile, executable: argument('nodus-executable') ?? config.executable ?? detectExecutable(), versionHint:argument('nodus-version')??config.versionHint, osVersion:process.getSystemVersion?.()??os.release().split('-')[0], locale: app.getLocale(), isRunning, probe: runProbe, privateDirectory, onIdle: () => { if (quitRequested) queueMicrotask(() => app.quit()); },
    progress: progress => { if (win && !win.isDestroyed()) win.webContents.send('support:progress', progress); } });
  service.choicesError=choicesError;rememberSelection(service);selectCurrentProfile(service,path.join(stateRoot,'launch-policies'));
  service.locale = SUPPORT_LANGUAGES.includes(config.language)?config.language:(await service.inspect()).inspection.language;
}
async function remember() {
  assert(!service.choicesError,'RECOVERY_SELECTION_CONFLICT');
  const value={storage:service.storage,profile:service.selectedProfile,executable:service.selectedExecutable,versionHint:service.selectedVersionHint,language:service.locale};
  const task=rememberTail.then(async()=>{
    const folder=path.join(stateRoot,'choices'),latest=fs.existsSync(folder)?Math.max(0,...fs.readdirSync(folder).filter(name=>/^\d+-[a-f0-9-]+\.json$/.test(name)).map(name=>Number(name.split('-')[0]))):0;
    await writeRecord(path.join(folder,`${Math.max(Date.now(),latest+1)}-${randomUUID()}.json`),value);
  });rememberTail=task.catch(()=>{});await task;
}
async function choose(kind) {
  assert(!service.busy, 'OPERATION_RUNNING');
  const result = await dialog.showOpenDialog(win, { properties: kind === 'executable' ? ['openFile', ...(process.platform === 'darwin' ? ['openDirectory'] : [])] : ['openDirectory','createDirectory'] });
  if (result.canceled) return null;
  const chosen = result.filePaths[0]; noLinks(chosen);
  if (kind === 'profile') { assert(!inside(canonical(chosen),canonical(service.storage)),'OVERLAPPING_STORAGE'); service.selectedProfile=chosen;service.choicesError=false;selectCurrentProfile(service,path.join(stateRoot,'launch-policies')); }
  else if (kind === 'storage') { separate(chosen, service.profile); service.storage = path.join(chosen, 'Nodus-Support-retained'); }
  else if (process.platform === 'darwin' && chosen.endsWith('.app')) {service.executable = service.selectedExecutable = path.join(chosen, 'Contents/MacOS/Nodus');service.versionHint=service.selectedVersionHint=null;}
  else {service.executable = service.selectedExecutable = chosen;service.versionHint=service.selectedVersionHint=null;}
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
async function verifyPlatformSignature(executable,policy) {
  if (process.platform === 'darwin') {
    const bundle = path.resolve(executable,'../../..');
    await exec('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
    await exec('/usr/sbin/spctl',['--assess','--type','execute',bundle]);
  } else if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    const {stdout}=await exec(powershell,['-NoProfile','-NonInteractive','-Command',"(Get-AuthenticodeSignature -LiteralPath $env:NODUS_SUPPORT_VERIFIED_INSTALLER).Status.ToString()"],{env:{...process.env,NODUS_SUPPORT_VERIFIED_INSTALLER:executable},windowsHide:true});
    acceptPlatformSignature(stdout.trim(),policy);
  }
}
async function reinstall(id,update=false) {
  assert(typeof update==='boolean','INVALID_REQUEST');
  assert(service.executable&&fs.existsSync(service.executable),'INSTALLATION_NOT_SELECTED');
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
      service.controller.signal.throwIfAborted();
      const executable = destination(candidate, manifest.executable);
      await verifyPlatformSignature(executable,manifest.runtime.platformSignature);
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
      if(format==='nsis')assert(artifact.repairProtocol===1,'INSTALLER_NOT_SUPPORTED');
      const installer = await downloadArtifact(artifact, folder, { fetch: net.fetch.bind(net), signal:service.controller.signal, progress: service.progress });
      if (process.platform === 'win32') await verifyPlatformSignature(installer,artifact.platformSignature);
      let rollbackInstaller=installer,rollbackArtifact=artifact;
      if(manifest.version!==version&&['nsis','deb','rpm'].includes(format)) {
        const artifact=previous?.installers.find(entry=>entry.format===format);assert(artifact,'INSTALLATION_RECOVERY_REQUIRED');
        rollbackArtifact=artifact;
        rollbackInstaller=await downloadArtifact(artifact,path.join(folder,'rollback-installer'),{fetch:net.fetch.bind(net),signal:service.controller.signal,progress:service.progress});
        if(process.platform==='win32')await verifyPlatformSignature(rollbackInstaller,artifact.platformSignature);
      }
      const original = process.platform === 'darwin' ? path.resolve(service.executable, '../../..') : format === 'AppImage' ? service.executable : path.dirname(service.executable);
      for (const root of session.inspection.roots) separate(original, root);
      const diagnosticRuntime={folder,candidate,executable,version:manifest.version,inventory:await inventory(candidate,service.controller.signal,service.progress,{links:true})};
      const old = await preserveInstallation(original, folder,{signal:service.controller.signal,progress:service.progress});
      await service.event(id, { installationOriginal: original, installationPrevious: old, installerVerified: artifact.name, installerFormat:format, installationPreviousInstaller:rollbackInstaller, installationPreviousArtifact:rollbackArtifact, installationVersion:manifest.version });
      assert(!await isRunning(), 'CLOSE_NODUS_FIRST');
      if(process.platform==='win32'&&artifact.platformSignature==='none')assert(await confirmation(text('reinstall'),text('manifestVerified')),'TEST_CANCELLED');
      for(const source of await service.protectedSources(session))await verifyInventory(source.original,source.inventory,service.controller.signal);
      service.controller.signal.throwIfAborted();
      // A system installer/atomic rename cannot safely be killed halfway. A
      // close request waits for its verification and durable journal instead.
      service.controller=null;
      service.progress({phase:'installing',completed:0,total:0});
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
        const command=installerCommand(process.platform,format,installer,original,{repairProtocol:artifact.repairProtocol});
        await runInstaller(command.command,command.args);
        await service.event(id,{installationSystemPending:false});
      }
      await verifyActivatedInstallation({format,original,artifact,version:manifest.version,installation:()=>service.installation()});
      for(const source of await service.protectedSources(session))await verifyInventory(source.original,source.inventory);
      await writeNew(path.join(working.root,'result.json'),{...check,appVersion:manifest.version,action:'reinstall',diagnostic:false,at:new Date().toISOString()});
      return service.event(id, { status: 'awaiting-user',diagnosticRuntime,diagnosticVersion:manifest.version,trialOpened:null,recoveredProfiles:[...session.recoveredProfiles,working.root], actions: [...session.actions, { id: randomUUID(), action: 'reinstall', status: 'passed', at: new Date().toISOString() }] });
    } catch (error) { return service.blocked(id, error); }
    finally { service.activeId = null; service.controller = null; }
  });
}
async function ensureDiagnosticRuntime(id) {
  let session=await service.session(id);
  if(session.diagnosticRuntime){await service.runtimeFor(session);return session;}
  try{if((await service.installation())?.protocol===1)return session;}catch{/* A damaged installation must never be executed. */}
  return service.exclusive(async()=>{
    service.activeId=id;service.controller=new AbortController();
    try {
      await service.guardSource(session);await service.protectedSources(session);
      assert(trustedKeys.keys.length,'RELEASE_SIGNING_NOT_CONFIGURED');
      assert(await confirmation(text('compatibleRuntime'),text('trial')),'TEST_CANCELLED');
      const version=session.inspection.version??app.getVersion();
      const {manifest}=await resolveRelease(version,trustedKeys.keys,process.platform,process.arch,{fetch:net.fetch.bind(net),signal:service.controller.signal,approveUpgrade:({from,to})=>confirmation(text('compatibleRuntime'),`${from} → ${to}\n${text('trial')}`)});
      const folder=path.join(session.folder,'runtimes',randomUUID());await fsp.mkdir(folder,{recursive:true,mode:0o700});
      await service.event(id,{status:'testing',runtimePrepared:folder});
      const archive=await downloadArtifact(manifest.runtime,folder,{fetch:net.fetch.bind(net),signal:service.controller.signal,progress:service.progress});
      const candidate=path.join(folder,'candidate');await extractRuntime(archive,candidate,openZip);
      service.controller.signal.throwIfAborted();
      const executable=destination(candidate,manifest.executable);await verifyPlatformSignature(executable,manifest.runtime.platformSignature);
      const installation=await service.installation(executable);assert(installation?.protocol===1&&installation.version===manifest.version,'RELEASE_INCOMPATIBLE');
      const diagnosticRuntime={folder,candidate,executable,version:manifest.version,inventory:await inventory(candidate,service.controller.signal,service.progress,{links:true})};
      session=await service.session(id);
      return service.event(id,{status:'protected',diagnosticRuntime,diagnosticVersion:manifest.version,actions:[...session.actions,{id:randomUUID(),action:'prepare-runtime',status:'passed',at:new Date().toISOString()}]});
    }catch(error){await service.blocked(id,error);throw error;}
    finally{service.activeId=null;service.controller=null;}
  });
}
async function launchRecovered(id, index) {
  requireQualified(qualifiedRepairs, process.platform, process.arch, 'interactive-copy');
  const session = await service.session(id); assert(Number.isInteger(index) && index >= 0 && index < session.recoveredProfiles.length, 'INVALID_REQUEST');
  const root = session.recoveredProfiles[index]; noLinks(root);
  assert(root.startsWith(`${session.folder}${path.sep}`), 'INVALID_REQUEST');
  const {executable,installation}=await service.runtimeFor(session);assert(installation?.protocol===1,'LEGACY_READ_ONLY');assert(installation.trialReadyProtocol===1,'COMPATIBLE_INSTALL_REQUIRED');
  const result=readJson(path.join(root,'result.json'));
  assert(result.protocol===1&&result.root===root&&result.appVersion===installation.version,'COMPATIBLE_INSTALL_REQUIRED');
  // Interactive copies use the normal application only with the validated isolated bootstrap.
  const token=randomUUID();
  const env={ ...process.env, NODUS_SUPPORT_TRIAL_TOKEN:token, NODUS_ISOLATED_ROOT: root, NODUS_SUPPORT_INTERACTIVE: '1', NODUS_SUPPORT_LANGUAGE:service.locale, NODUS_QA_DEFER_CREDENTIAL_STATUS: '1', NODUS_STELLAR_PREVIEW: '1', NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_HARNESS_KEYS_FILE: path.join(root, 'no-provider-keys.json') };
  delete env.ELECTRON_RUN_AS_NODE;delete env.NODUS_USERDATA;delete env.NODUS_SUPPORT_PROBE;
  return service.exclusive(async()=>{
    service.activeId=id;service.controller=new AbortController();
    try {
      await service.event(id,{trialOpened:null,trialPending:{root,token,version:installation.version}});
      const child = spawn(executable, [], { detached: true, stdio: 'ignore', env });
      await new Promise((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject); });child.unref();
      await service.event(id,{trialPending:{root,token,version:installation.version,pid:child.pid}});
      await waitForTrial({root,token,version:installation.version,pid:child.pid,signal:service.controller.signal});
      return service.event(id,{trialOpened:root,trialPending:null});
    }finally{service.activeId=null;service.controller=null;}
    // Cancelling the wait never kills a trial which may contain unsaved new work.
  });
}
async function rollbackInstallation(id) {
  const session = await service.session(id); await service.guardSource(session); await service.protectedSources(session);
  assert(session.installationOriginal && session.installationPrevious, 'NO_INSTALLATION_CHANGE');
  const original = session.installationOriginal;
  for (const root of session.inspection.roots) separate(original,root);
  const protection = readJson(path.join(path.dirname(session.installationPrevious),'installation-protection.json'));
  assert(protection.source === original && protection.copy === session.installationPrevious,'INVALID_SESSION');
  await verifyInventory(protection.copy,protection.inventory);
  service.progress({phase:'installing',completed:0,total:0});
  await protectInstallationRollback(service,session);
  if(['nsis','deb','rpm'].includes(session.installerFormat)) {
    assert(session.installationPreviousInstaller,'INSTALLATION_RECOVERY_REQUIRED');
    const artifact=session.installationPreviousArtifact;assert(artifact,'INSTALLATION_RECOVERY_REQUIRED');
    assert(fs.statSync(session.installationPreviousInstaller).size===artifact.bytes&&await hashFile(session.installationPreviousInstaller)===artifact.sha256,'DOWNLOAD_HASH_MISMATCH');
    if(process.platform==='win32')await verifyPlatformSignature(session.installationPreviousInstaller,artifact.platformSignature);
    if(!await confirmation(text('undoSolution'),text('reinstall')))return session;
    const command=installerCommand(process.platform,session.installerFormat,session.installationPreviousInstaller,original,{rollback:true,repairProtocol:artifact.repairProtocol});
    await service.event(id,{installationSystemRollbackPending:true});
    await runInstaller(command.command,command.args);
    const restored=await service.installation();assert(restored?.version===session.inspection.version,'INSTALLATION_INTEGRITY_FAILED');
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
    catch (error) {
      if(['applySolution','undoSolution','launchRecovered','reinstall','restore','resume'].includes(name)&&/^[0-9a-f-]{36}$/.test(args[0]??'')&&!service.busy)try{await service.blocked(args[0],error);}catch{/* Preserve an unreadable journal without attempting to rewrite it. */}
      return { ok: false, code: /^[A-Z][A-Z0-9_]*$/.test(error.code ?? '') ? error.code : 'OPERATION_FAILED' };
    }
  });
  handle('setLanguage', async language => { assert(SUPPORT_LANGUAGES.includes(language),'INVALID_REQUEST'); service.locale = language; await remember(); });
  handle('openGuide',async id=>{assert(typeof id==='string','INVALID_REQUEST');await shell.openExternal(guideUrl(id,process.platform));});
  handle('inspect', async () => ({...await service.inspect(),qualifiedRepairs:qualifiedRepairs.platforms[`${process.platform}-${process.arch}`] ?? []})); handle('chooseProfile', () => choose('profile')); handle('chooseExecutable', () => choose('executable')); handle('chooseStorage', () => choose('storage'));
  handle('create', input => {assert(!service.busy,'OPERATION_RUNNING');selectCurrentProfile(service,path.join(stateRoot,'launch-policies'));return service.create(input);}); handle('protect', id => service.protect(id)); handle('test', async(id,action)=>{assert(SUPPORT_ACTIONS.includes(action),'INVALID_ACTION');await ensureDiagnosticRuntime(id);return service.test(id,action);});
  handle('answer', async (id, works) => {
    const session = await service.session(id);
    if (works === true) assert(session.trialOpened || session.installationPrevious,'USER_TRIAL_REQUIRED');
    if (works === false && session.installationPrevious) return service.exclusive(() => rollbackInstallation(id));
    return service.answer(id,works);
  });
  handle('cancel', id => service.cancel(id));
  handle('resume', async id => {
    const session=await service.session(id);
    if(service.selectionError||session.inspection.profile!==service.profile||session.inspection.executable!==service.executable) {
      assert(await confirmation(text('resume'),`${text('profile')}: ${session.inspection.profile}\n${text('retained')}`),'TEST_CANCELLED');
      service.profile=session.inspection.profile;service.originProfile=null;service.executable=session.inspection.executable;service.selectionError=false;
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
  handle('launchRecovered', launchRecovered); handle('report', async(id,selection)=>{const {report:_report,...summary}=await service.report(id,selection);return summary;}); handle('reinstall', reinstall);
  handle('applySolution', async (id,index) => {
    requireQualified(qualifiedRepairs,process.platform,process.arch,'apply-solution');
    assert(!(await service.session(id)).installationPrevious,'INVALID_STATE');
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
    const folder = path.join(output, `nodus-private-logs-${randomUUID()}`);for(const source of new Set([session.inspection.profile,...session.inspection.roots]))separate(source,folder);
    await fsp.mkdir(folder, { mode: 0o700 }); await privateDirectory(folder);
    let i = 0;
    const startup=path.join(stateRoot,'startup-errors'),startupFiles=fs.existsSync(startup)?fs.readdirSync(startup).filter(name=>/^\d+-[a-f0-9-]{36}\.json$/.test(name)).map(name=>path.join(startup,name)):[];
    for (const source of [...service.logFiles(session.inspection.profile),...service.privateProbeLogs(session),...startupFiles]) { const manifest = await inventory(source); await copyInventory(source, path.join(folder, `log-${i++}${path.extname(source)}`), manifest); }
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
    await ensureDiagnosticRuntime(id);
    const session = await service.session(id); await service.guardSource(session); await service.protectedSources(session);
    const {executable,installation}=await service.runtimeFor(session);assert(installation?.protocol===1,'LEGACY_READ_ONLY');assert(installation.trialReadyProtocol===1,'COMPATIBLE_INSTALL_REQUIRED');
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
        const result = await runProbe({ executable, root: working.root, action: 'restore-archive', password, signal:service.controller.signal,progress:service.progress });
        assert(result.protocol === 1 && result.root === working.root, 'PROBE_INVALID');
        await writeNew(path.join(working.root,'result.json'),{...result,action:'restore-copy',at:new Date().toISOString()});
        return service.event(id, { status: result.ok ? 'awaiting-user' : 'blocked', recoveryInfo:{...(session.recoveryInfo??{}),[working.root]:{source:path.basename(archive),backupDate:result.backupDate}}, recoveredProfiles: result.ok ? [...session.recoveredProfiles, working.root] : session.recoveredProfiles, actions: [...session.actions, { id: randomUUID(), action: 'restore-copy', status: result.ok ? 'passed' : 'failed', code: result.code, at: new Date().toISOString() }] });
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
    const retainedEnv={...process.env},sandbox=supportSandbox(process.execPath,process.env.CHROME_DEVEL_SANDBOX);
    if(sandbox)retainedEnv.CHROME_DEVEL_SANDBOX=sandbox;
    const child = spawn(executable, ['--support-retained=1', ...process.argv.slice(1).filter(arg => arg.startsWith('--nodus-') || arg.startsWith('--support-state=') || arg.startsWith('--support-launch-token='))], { detached: true, stdio: 'ignore',env:retainedEnv });
    await new Promise((resolve,reject) => { child.once('spawn',resolve); child.once('error',reject); }); child.unref(); app.quit();
  } else {
    const ui = path.join(__dirname, 'ui');
    protocol.handle('nodus-support', request => {
      const url = new URL(request.url); const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      try { const file=path.resolve(ui,relative);assert(inside(ui,file)&&file!==ui&&!relative.includes('\0'),'PATH_ESCAPE');return net.fetch(pathToFileURL(file).href); } catch { return new Response('', { status: 403 }); }
    });
    win = new BrowserWindow({ width: 1120, height: 850, minWidth: 720, minHeight: 580, title: 'Nodus Support', icon: path.join(__dirname,'icon.png'), backgroundColor: '#171717', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, nodeIntegration: false, contextIsolation: true } });
    const announceReady=async(argv)=>{
      const token=argv.find(value=>value.startsWith('--support-launch-token='))?.slice('--support-launch-token='.length);
      if(token&&/^[a-f0-9-]{36}$/.test(token))try{await writeRecord(path.join(stateRoot,'launch-receipts',`${token}.json`),{format:'nodus.support-ready/1',token,pid:process.pid,version:app.getVersion()});}catch{/* Existing receipts are retained. */}
    };
    win.webContents.once('did-finish-load',()=>{void announceReady(process.argv);});
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('nodus-support://app/')) event.preventDefault(); });
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, done) => done(false));
    await handlers(); await win.loadURL('nodus-support://app/index.html');
    app.on('second-instance', (_event,argv) => { if (win) { win.show(); win.focus();void announceReady(argv); } });
    app.on('before-quit', event => { if (service.busy) { event.preventDefault(); quitRequested = true; if (service.activeId) void service.cancel(service.activeId); } });
  }
}
app.on('window-all-closed', () => app.quit());
}
void start().catch(async error => {
  // Private local diagnostic; never included automatically in a public report.
  try{await writeRecord(path.join(stateRoot,'startup-errors',`${Date.now()}-${randomUUID()}.json`),{at:new Date().toISOString(),code:error?.code??'SUPPORT_STARTUP_FAILED',stack:String(error?.stack??error).slice(0,12000)});}catch{/* Preserve startup even when logging itself is unavailable. */}
  dialog.showErrorBox('Nodus Support','SUPPORT_STARTUP_FAILED'); app.exit(1);
});
