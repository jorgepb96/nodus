import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { assert, canonical, copyInventory, destination, hashFile, inside, inventory, noLinks, readJson, separate, sufficientSpace, verifyInventory, writeNew, writeRecord } from './files.mjs';
import { executableArchitectures, readInstalledPackage } from './installation.mjs';
import { issueDraft, publicReport, reportMarkdown, safeError } from '../../../shared/support/report.mjs';
import { technicalLogEntry } from '../../../shared/support/logs.mjs';
import { SUPPORT_ACTIONS } from '../../../shared/support/catalog.mjs';

const SYMPTOMS = new Set(['startup', 'tool', 'data', 'sync', 'update', 'other']);
const ACTIONS = new Set(SUPPORT_ACTIONS);
const LANGUAGES = ['es','en','fr','de','pt','pt-BR','it','tr','zh-CN','zh-TW','ja','ko'];
const now = () => new Date().toISOString();
const optionalJson = file => { try { return readJson(file); } catch { return null; } };
export function detectLanguage(value, locale = 'en') {
  for (const candidate of [value, locale, locale?.split('-')[0], 'en']) if (LANGUAGES.includes(candidate)) return candidate;
  return 'en';
}
export function detectSources(profile) {
  noLinks(profile); assert(fs.statSync(profile).isDirectory(), 'PROFILE_NOT_FOUND');
  const roots = [canonical(profile)]; const missing = [];
  const registry = optionalJson(path.join(profile, 'vaults.json'));
  const prefs = optionalJson(path.join(profile, 'app-prefs.json'));
  assert(!fs.existsSync(path.join(profile, 'vaults.json')) || registry && Array.isArray(registry.vaults), 'REGISTRY_UNREADABLE');
  assert(!fs.existsSync(path.join(profile, 'app-prefs.json')) || prefs && typeof prefs === 'object' && !Array.isArray(prefs), 'PREFERENCES_UNREADABLE');
  for (const vault of registry?.vaults ?? []) {
    if (typeof vault.path !== 'string' || !path.isAbsolute(vault.path)) { missing.push('INVALID_VAULT_PATH'); continue; }
    if (!fs.existsSync(vault.path)) { missing.push('VAULT_UNAVAILABLE'); continue; }
    for (const file of [vault.path, `${vault.path}-wal`, `${vault.path}-shm`]) if (fs.existsSync(file)) {noLinks(file);roots.push(canonical(file));}
  }
  if (typeof prefs?.autoBackupFolder === 'string' && prefs.autoBackupFolder.trim()) {
    const library = path.join(prefs.autoBackupFolder, 'nodus-library');
    if (fs.existsSync(library)) {noLinks(library);roots.push(canonical(library));}
    else if (prefs.libraryGlobalEnabled) missing.push('LIBRARY_UNAVAILABLE');
  }
  const unique = [...new Set(roots)].filter((root, index, all) => !all.some((other, i) => i !== index && canonical(other) !== canonical(root) && path.relative(other, root) && !path.relative(other, root).startsWith('..') && !path.isAbsolute(path.relative(other, root))));
  return { roots: unique, missing, registry, prefs };
}
export class SupportService {
  constructor({ storage, profile, executable = null, versionHint=null, osVersion=os.release().split('-')[0], platform = process.platform, arch = process.arch, locale = 'en', probe, isRunning = async () => true, progress = () => {}, privateDirectory = async () => {}, onIdle = () => {} }) {
    this.storage = path.resolve(storage); this.profile = path.resolve(profile); this.executable = executable;
    this.platform = platform; this.arch = arch; this.locale = locale; this.probe = probe;
    this.versionHint=/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(versionHint??'')?versionHint:null;
    this.osVersion=/^\d+(?:\.\d+){1,3}$/.test(osVersion)?osVersion:null;
    this.isRunning = isRunning; this.progress = progress; this.privateDirectory = privateDirectory;
    this.busy = false; this.controller = null; this.activeId = null; this.onIdle = onIdle;
  }
  async exclusive(task) { assert(!this.busy, 'OPERATION_RUNNING'); this.busy = true; try { return await task(); } finally { this.busy = false; this.onIdle(); } }
  sessionFolder(id) { assert(/^[0-9a-f-]{36}$/.test(id), 'INVALID_SESSION'); return destination(canonical(this.storage), `sessions/${id}`); }
  async inspect() {
    const findings = []; let sources = { roots: [], missing: [], prefs: null };
    if(this.selectionError)findings.push({code:'RECOVERY_SELECTION_CONFLICT',component:'profile',level:'error'});
    try { sources = detectSources(this.profile); }
    catch { findings.push({ code: 'PROFILE_UNAVAILABLE', component: 'profile', level: 'error' }); }
    for (const code of sources.missing) findings.push({ code, component: 'storage', level: 'error' });
    if (fs.existsSync(path.join(this.profile, 'vaults.json')) && !optionalJson(path.join(this.profile, 'vaults.json'))) findings.push({ code: 'REGISTRY_UNREADABLE', component: 'profile', level: 'error' });
    if (fs.existsSync(path.join(this.profile, 'app-prefs.json')) && !optionalJson(path.join(this.profile, 'app-prefs.json'))) findings.push({ code: 'PREFERENCES_UNREADABLE', component: 'profile', level: 'error' });
    let metadata = null;
    try { metadata = this.executable ? await this.installation() : null; }
    catch {
      findings.push({ code: 'INSTALLATION_UNAVAILABLE', component: 'installation', level: 'warning' });
      // A damaged executable/archive must never run, but readable version
      // metadata is still useful to select a verified same-version installer.
      let version=this.versionHint;
      try{const folder=this.platform==='darwin'?path.resolve(this.executable,'../../Resources'):path.join(path.dirname(this.executable),'resources');const pkg=readInstalledPackage(folder);if(pkg.name==='nodus'&&/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(pkg.version))version=pkg.version;}catch{/* Keep the explicit bundled version hint, if present. */}
      metadata={version,protocol:null};
    }
    if (!metadata) findings.push({ code: 'INSTALLATION_NOT_SELECTED', component: 'installation', level: 'warning' });
    if (metadata && metadata.protocol !== 1) findings.push({ code: 'LEGACY_READ_ONLY', component: 'installation', level: 'warning' });
    try { if (await this.isRunning()) findings.push({ code: 'CLOSE_NODUS_FIRST', component: 'app', level: 'warning' }); }
    catch { findings.push({ code: 'PROCESS_CHECK_UNAVAILABLE', component: 'app', level: 'error' }); }
    let sessions=[];
    try{sessions=await this.sessions();if(this.unreadableSessions)findings.push({code:'SESSION_UNREADABLE',component:'storage',level:'warning'});}
    catch{findings.push({code:'SESSION_UNREADABLE',component:'storage',level:'warning'});}
    const inspection = { profile: this.profile, executable: this.executable, version: metadata?.version ?? null, protocol: metadata?.protocol ?? null, language: detectLanguage(sources.prefs?.uiLanguage, this.locale), platform: this.platform, osVersion:this.osVersion, arch: this.arch, findings, roots: sources.roots };
    return { inspection, sessions, storage: this.storage };
  }
  async installation(executable=this.executable) {
    if (!executable || !fs.existsSync(executable)) return null;
    noLinks(executable); const folder = this.platform === 'darwin' ? path.resolve(executable, '../../Resources') : path.join(path.dirname(executable), 'resources');
    const metadata = optionalJson(path.join(folder, 'nodus-support-protocol.json'));
    let pkg=null;try{pkg=readInstalledPackage(folder);}catch{/* A damaged package can still supply direct logs and source protection. */}
    const version=pkg?.name==='nodus'&&/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(pkg.version)?pkg.version:null;
    if(metadata?.protocol===1&&metadata.platform===this.platform&&metadata.arch===this.arch&&metadata.version===version) {
      assert(executableArchitectures(executable).includes(this.arch),'RELEASE_INCOMPATIBLE');
      assert(/^[a-f0-9]{64}$/.test(metadata.archiveSha256??'')&&await hashFile(path.join(folder,'app.asar'))===metadata.archiveSha256,'INSTALLATION_INTEGRITY_FAILED');
      return metadata;
    }
    return {version:version??(executable===this.executable?this.versionHint:null),protocol:null};
  }
  async runtimeFor(session) {
    const runtime=session.diagnosticRuntime;
    if(!runtime)return {executable:this.executable,installation:await this.installation()};
    assert(runtime.folder.startsWith(`${session.folder}${path.sep}`),'INVALID_SESSION');
    const candidate=destination(runtime.folder,'candidate');
    assert(runtime.candidate===candidate&&runtime.executable.startsWith(`${candidate}${path.sep}`),'INVALID_SESSION');
    await verifyInventory(candidate,runtime.inventory);
    const installation=await this.installation(runtime.executable);
    assert(installation?.protocol===1&&installation.version===runtime.version,'RELEASE_INCOMPATIBLE');
    return {executable:runtime.executable,installation};
  }
  async sessions() {
    this.unreadableSessions=0;
    const folder = path.join(this.storage, 'sessions'); if (!fs.existsSync(folder)) return [];
    noLinks(folder);
    const result = [];
    for (const name of await fsp.readdir(folder)) {
      if (!/^[0-9a-f-]{36}$/.test(name)) continue;
      try { result.push(await this.session(name)); } catch { this.unreadableSessions++; /* Preserve and report unreadable sessions. */ }
    }
    return result.sort((a, b) => b.at.localeCompare(a.at));
  }
  async session(id) {
    const folder = this.sessionFolder(id); noLinks(folder);
    const initial = readJson(path.join(folder, 'session.json')); assert(initial.id === id && initial.format === 'nodus.support-session/1', 'INVALID_SESSION');
    const events = (await fsp.readdir(path.join(folder, 'journal'))).filter(x => /^\d{8}\.json$/.test(x)).sort();
    let state = initial;
    for (const [index, file] of events.entries()) { const entry = readJson(path.join(folder, 'journal', file)); assert(entry.sequence === index + 1, 'JOURNAL_INVALID'); state = { ...state, ...entry.state }; }
    assert(state.id === id && state.folder === folder && state.format === initial.format && Array.isArray(state.actions) && Array.isArray(state.recoveredProfiles), 'JOURNAL_INVALID');
    if (this.activeId !== id && ['protecting', 'testing'].includes(state.status)) state = { ...state, status: 'interrupted' };
    return state;
  }
  async event(id, state) {
    const folder = path.join(this.sessionFolder(id), 'journal');
    const files = (await fsp.readdir(folder)).filter(x => /^\d{8}\.json$/.test(x)); const sequence = files.length + 1;
    await writeRecord(path.join(folder, `${String(sequence).padStart(8, '0')}.json`), { sequence, at: now(), state });
    return this.session(id);
  }
  async create(input) {
    assert(SYMPTOMS.has(input?.symptom) && ['guided', 'automatic'].includes(input?.mode), 'INVALID_REQUEST');
    noLinks(this.storage);
    const id = randomUUID(); const folder = this.sessionFolder(id);
    const inspection = (await this.inspect()).inspection;
    // An active recovery profile can live in an older session below storage.
    // Its new protection must be a sibling session, never inside that profile.
    for(const source of new Set([this.profile,...inspection.roots])) {
      assert(!inside(canonical(source),canonical(this.storage)),'OVERLAPPING_STORAGE');separate(source,folder);
    }
    assert(!fs.existsSync(folder),'DESTINATION_EXISTS');
    await fsp.mkdir(this.storage, { recursive: true, mode: 0o700 }); await this.privateDirectory(this.storage);
    await fsp.mkdir(path.join(folder, 'journal'), { recursive: true, mode: 0o700 });
    const session = { format: 'nodus.support-session/1', id, at: now(), symptom: input.symptom, mode: input.mode, status: 'created', actions: [], files: 0, bytes: 0, folder, recoveredProfiles: [], inspection };
    await writeRecord(path.join(folder, 'session.json'), session); return this.session(id);
  }
  async guardSource(session) {
    assert(!this.selectionError,'RECOVERY_SELECTION_CONFLICT');
    assert(session.inspection.profile === this.profile && session.inspection.executable === this.executable, 'SOURCE_SELECTION_CHANGED');
    assert(!await this.isRunning(), 'CLOSE_NODUS_FIRST');
    const { roots, missing } = detectSources(this.profile);
    assert(!missing.length, missing[0]);
    for (const root of roots) { noLinks(root);assert(!inside(canonical(root),canonical(this.storage)),'OVERLAPPING_STORAGE');separate(root,session.folder); }
    return roots;
  }
  async protect(id) {
    return this.exclusive(async () => {
      const session = await this.session(id); this.activeId = id; this.controller = new AbortController();
      try {
        const roots = await this.guardSource(session);
        await this.event(id, { status: 'protecting' });
        const inventories = [];
        for (const root of roots) inventories.push(await inventory(root, this.controller.signal, this.progress));
        const bytes = inventories.reduce((n, x) => n + x.bytes, 0); await sufficientSpace(session.folder, bytes);
        const snapshotId = randomUUID(); const folder = path.join(session.folder, 'protection', snapshotId);
        const sources = [];
        for (let i = 0; i < roots.length; i++) {
          assert(!await this.isRunning(), 'CLOSE_NODUS_FIRST');
          const copy = path.join(folder, `source-${i}`); await fsp.mkdir(folder, { recursive: true, mode: 0o700 });
          await copyInventory(roots[i], copy, inventories[i], this.controller.signal, this.progress);
          sources.push({ original: roots[i], copy, inventory: inventories[i] });
        }
        assert(!await this.isRunning(), 'CLOSE_NODUS_FIRST');
        for (let i=0;i<roots.length;i++) await verifyInventory(roots[i],inventories[i],this.controller.signal);
        const manifest = { format: 'nodus.support-protection/1', id: snapshotId, at: now(), sources };
        await writeNew(path.join(folder, 'manifest.json'), manifest);
        await this.event(id, { status: 'protected', protection: path.join(folder, 'manifest.json'), files: inventories.reduce((n, x) => n + x.entries.filter(e => e.type === 'file').length, 0), bytes });
        return await this.session(id);
      } catch (e) { return await this.blocked(id, e); }
      finally { this.controller = null; this.activeId = null; }
    });
  }
  async protectedSources(session) {
    assert(typeof session.protection === 'string' && session.protection.startsWith(`${session.folder}${path.sep}`), 'PROTECTION_REQUIRED');
    const manifest = readJson(session.protection); assert(manifest.format === 'nodus.support-protection/1', 'PROTECTION_REQUIRED');
    for (const source of manifest.sources) {
      assert(source.copy.startsWith(`${session.folder}${path.sep}`), 'PATH_ESCAPE');
      await verifyInventory(source.copy, source.inventory, this.controller?.signal);
    }
    return manifest.sources;
  }
  async workingCopy(session, fresh = false) {
    const sources = await this.protectedSources(session); const root = path.join(session.folder, 'tests', randomUUID());
    await sufficientSpace(session.folder, session.bytes);
    await fsp.mkdir(root, { recursive: true, mode: 0o700 }); const profile = path.join(root, 'profile');
    const mappings = []; const parents = new Map();
    if (fresh) await fsp.mkdir(profile, { mode: 0o700 });
    else {
      for (let i = 0; i < sources.length; i++) {
        let copy = profile;
        if (i !== 0) {
          const parent = path.dirname(sources[i].original);
          if (!parents.has(parent)) parents.set(parent, path.join(profile, 'support-external', String(parents.size)));
          copy = path.join(parents.get(parent), path.basename(sources[i].original));
        }
        await fsp.mkdir(path.dirname(copy), { recursive: true, mode: 0o700 });
        await copyInventory(sources[i].copy, copy, await inventory(sources[i].copy, this.controller?.signal), this.controller?.signal);
        mappings.push({ original: sources[i].original, copy });
      }
      const remap = value => {
        if (typeof value === 'string') {
          const resolved=path.isAbsolute(value)?canonical(value):value;
          for (const mapping of [...mappings].sort((a,b) => b.original.length - a.original.length)) {
            if (resolved === mapping.original || resolved.startsWith(`${mapping.original}${path.sep}`)) return mapping.copy + resolved.slice(mapping.original.length);
          }
          return value;
        }
        if (Array.isArray(value)) return value.map(remap);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, remap(v)]));
        return value;
      };
      for (const name of ['vaults.json', 'app-prefs.json']) {
        const file = path.join(profile, name); if (!fs.existsSync(file)) continue;
        const parsed = readJson(file);
        if (name === 'app-prefs.json') {
          const library = mappings.find(m => path.basename(m.original) === 'nodus-library');
          if (library) parsed.autoBackupFolder = path.dirname(library.copy);
        }
        const original = `${file}.support-original`;
        await fsp.rename(file, original); await writeNew(file, remap(parsed));
      }
    }
    await writeNew(path.join(root, 'isolation.json'), { format: 'nodus.isolated-research-profile/1', root: fs.realpathSync(root) });
    await writeNew(path.join(root, 'support-session.json'), { protocol: 1, id: session.id, root: fs.realpathSync(root), at:now(), origin:'protected-profile', mappings, network: false });
    return { root, profile };
  }
  async test(id, action) {
    assert(ACTIONS.has(action), 'INVALID_ACTION');
    return this.exclusive(async () => {
      const session = await this.session(id); const attempt = { id: randomUUID(), action, status: 'running', at: now() };
      this.activeId = id; this.controller = new AbortController();
      try {
        await this.guardSource(session); await this.protectedSources(session);
        assert(['protected', 'reverted', 'blocked'].includes(session.status), 'INVALID_STATE');
        const {executable,installation}=await this.runtimeFor(session); assert(installation?.protocol === 1, 'LEGACY_READ_ONLY');
        assert(typeof this.probe === 'function', 'PROBE_UNAVAILABLE');
        const working = await this.workingCopy(session, ['fresh-profile','archive-roundtrip'].includes(action));
        await this.event(id, { status: 'testing', trialOpened: null, actions: [...session.actions, attempt] });
        const result = await this.probe({ ...working, executable, action, signal: this.controller.signal, progress: this.progress });
        assert(result?.protocol === 1 && result.root === working.root, 'PROBE_INVALID');
        if(result.appVersion!==undefined&&installation.version!==undefined)assert(result.appVersion===installation.version,'RELEASE_INCOMPATIBLE');
        attempt.status = result.ok ? 'passed' : 'failed'; if (!result.ok) attempt.code = safeError(result.code);
        await writeNew(path.join(working.root, 'result.json'), { ...result, appVersion:installation.version, action, at: now() });
        const diagnostic=result.diagnostic===true;
        const findings=[...(session.findings??[]),...(result.findings??[]),...(!result.ok?[{code:safeError(result.code),component:'app',level:'error'}]:[]),...(result.partial?[{code:'PARTIAL_RECOVERY',component:'database',level:'warning'}]:[])];
        return this.event(id, { status: diagnostic ? 'protected' : result.ok ? 'awaiting-user' : 'reverted', findings:findings.filter((finding,index)=>findings.findIndex(other=>other.code===finding.code&&other.component===finding.component)===index), actions: [...session.actions, attempt], recoveredProfiles: diagnostic ? session.recoveredProfiles : [...session.recoveredProfiles, working.root] });
      } catch (error) {
        attempt.status = 'blocked'; attempt.code = error.code ?? 'TEST_FAILED';
        await this.event(id, { actions: [...session.actions, attempt] }); return this.blocked(id, error);
      } finally { this.activeId = null; this.controller = null; }
    });
  }
  async answer(id, works) {
    return this.exclusive(async () => {
      const session = await this.session(id); assert(session.status === 'awaiting-user', 'INVALID_STATE');
      assert(typeof works === 'boolean', 'INVALID_REQUEST');
      // No source file was replaced: reverting means retaining the attempted profile and
      // ending its selection. Even edits made during a trial survive in recoveredProfiles.
      return this.event(id, { status: works ? 'confirmed' : 'reverted', userConfirmed: works });
    });
  }
  async cancel(id) {
    if (this.activeId === id && this.controller) { this.controller.abort(); return this.session(id); }
    // Completion can race a click on Stop. Never relabel an already applied
    // recovery selection as reverted when there is no running work to cancel.
    return this.session(id);
  }
  async resume(id) {
    return this.exclusive(async () => {
      const session = await this.session(id);
      if (!session.protection) return this.event(id, { status: 'created' });
      try { await this.protectedSources(session); return this.event(id, { status: ['confirmed','awaiting-user','reverted','conflict'].includes(session.status) ? session.status : 'protected' }); }
      catch (error) { return this.blocked(id, error); }
    });
  }
  async blocked(id, error) {
    const session = await this.session(id); const code = /^[A-Z][A-Z0-9_]*$/.test(error.code ?? '') ? error.code : 'OPERATION_FAILED';
    return this.event(id, { status: 'blocked', lastError: code, actions: [...session.actions, { id: randomUUID(), action: 'safety-check', status: 'blocked', code, at: now() }] });
  }
  logFiles(profile=this.profile) {
    const candidates = ['nodus-logs.json', 'electron_debug.log', 'nodus-startup.log'].map(name => path.join(profile, name));
    const startup = path.join(profile, 'support-startup');
    if (fs.existsSync(startup)) for (const entry of fs.readdirSync(startup)) if (/^[a-zA-Z0-9.-]+\.jsonl$/.test(entry)) candidates.push(path.join(startup, entry));
    return candidates.filter(file => { try { noLinks(file); return fs.statSync(file).isFile(); } catch { return false; } });
  }
  privateProbeLogs(session) {
    const tests=path.join(this.sessionFolder(session.id),'tests');if(!fs.existsSync(tests))return [];
    noLinks(tests);const files=[];
    for(const name of fs.readdirSync(tests).filter(name=>/^[0-9a-f-]{36}$/.test(name))) {
      const folder=path.join(tests,name);noLinks(folder);if(!fs.statSync(folder).isDirectory())continue;
      for(const name of fs.readdirSync(folder).filter(name=>/^probe-private-[0-9a-f-]{36}\.log$/.test(name))) {
        const file=path.join(folder,name);noLinks(file);if(fs.statSync(file).isFile())files.push(file);
      }
    }
    return files;
  }
  async errors(selection = { limit: 50 },profile=this.profile) {
    assert([20,50,100,'all'].includes(selection.limit), 'INVALID_REQUEST');
    for (const date of [selection.since, selection.until]) assert(date === undefined || Number.isFinite(Date.parse(date)), 'INVALID_REQUEST');
    const entries = [];
    for (const file of this.logFiles(profile)) {
      const input = fs.createReadStream(file, { highWaterMark: 64 * 1024 });
      let text = ''; let bytes = 0;
      // Application JSON is bounded by its retention; enormous files remain available
      // through the explicit streaming original-log export, never parsed unboundedly.
      for await (const chunk of input) { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) { input.destroy(); break; } text += chunk.toString('utf8'); }
      if (path.basename(file) === 'nodus-logs.json') {
        let parsed; try { parsed = JSON.parse(text); } catch { entries.push({ code: 'LOG_UNREADABLE', component: 'logging' }); continue; }
        if(!Array.isArray(parsed.entries)){entries.push({code:'LOG_UNREADABLE',component:'logging'});continue;}
        for (const [index,entry] of parsed.entries.entries()) {
          if (!entry || entry.level !== 'error') continue;
          if (selection.since && (!entry.at || entry.at < selection.since) || selection.until && (!entry.at || entry.at > selection.until)) continue;
          const context=parsed.entries.slice(Math.max(0,index-2),index+3).filter(other=>other&&other!==entry&&(!entry.jobId||other.jobId===entry.jobId)).slice(0,4).map(other=>({...technicalLogEntry(other,safeError),level:other.level}));
          entries.push({...technicalLogEntry(entry,safeError),context});
        }
      } else for (const line of text.split('\n')) {
        if (!/error|failed|cannot find|SQLITE_|EACCES|ENOSPC/i.test(line)) continue;
        let parsed; try { parsed = JSON.parse(line); } catch { /* Raw console line. */ }
        const at = parsed?.at;
        if (selection.since && (!at || at < selection.since) || selection.until && (!at || at > selection.until)) continue;
        entries.push({ code: safeError(parsed?.causeCode ?? parsed?.code ?? line), component: 'startup', at });
      }
    }
    entries.sort((a,b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
    return selection.limit === 'all' ? entries : entries.slice(0, selection.limit);
  }
  async report(id, selection) {
    const session = await this.session(id); const errors = await this.errors(selection,session.inspection.profile);
    const report = publicReport(session.inspection, session, [...session.inspection.findings,...(session.findings??[])], errors);
    const markdown = reportMarkdown(report); return { markdown, ...issueDraft(report, markdown), errors: report.errors.map(e => e.code), report };
  }
  async saveReport(id, selection, reviewed, output) {
    assert(typeof reviewed === 'string' && reviewed.length <= 200000, 'INVALID_REQUEST');
    const { report } = await this.report(id, selection); const session=await this.session(id);const folder = path.join(output, `nodus-support-${randomUUID()}`);
    for(const source of new Set([session.inspection.profile,...session.inspection.roots]))separate(source,folder);
    await fsp.mkdir(folder, { mode: 0o700 }); await this.privateDirectory(folder);
    await writeNew(path.join(folder, 'report.md'), reviewed);
    await writeNew(path.join(folder, 'diagnostics.json'), report);
    await writeNew(path.join(folder, 'errors.txt'), report.errors.map(e => `${e.component}: ${e.code}`).join('\n'));
    const manifest = await inventory(folder); await writeNew(path.join(folder, 'manifest.json'), { format: 'nodus.support-export/1', files: manifest.entries.filter(e => e.type === 'file') });
    return folder;
  }
}
