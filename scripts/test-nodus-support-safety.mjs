import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SupportService, detectLanguage, detectSources } from '../apps/nodus-support/core/service.mjs';
import { copyInventory, inventory, replaceRecoverably, sufficientSpace, verifyInventory } from '../apps/nodus-support/core/files.mjs';
import { issueDraft, publicReport, reportMarkdown } from '../shared/support/report.mjs';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-support-safety-')));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
function fixture(overrides = {}) {
  const base = path.join(scratch, randomUUID()); const profile = path.join(base, 'original');
  const vault = path.join(base, 'external-vault', 'vault.sqlite');
  const library = path.join(base, 'backup', 'nodus-library');
  put(path.join(profile, 'app-prefs.json'), { uiLanguage: 'ja', autoBackupFolder: path.dirname(library), libraryGlobalEnabled: true });
  put(path.join(profile, 'vaults.json'), { vaults: [{ id: 'external', name: 'Private title', path: vault }] });
  put(path.join(profile, 'nodus.sqlite'), 'SQLite fixture'); put(vault, 'external DB'); put(`${vault}-wal`, 'pending WAL'); put(`${vault}-shm`, 'shared memory');
  put(path.join(profile, 'nodi-notes.json'), { note: 'Do not lose this' });
  put(path.join(profile, 'secrets/ai_key_openai.bin'), Buffer.from([0,33,92,201,255]));
  put(path.join(library, 'documents/original.pdf'), 'private original PDF');
  const executable = path.join(base, 'installed', process.platform === 'win32' ? 'Nodus.exe' : 'Nodus');
  put(executable, 'test runtime'); put(path.join(path.dirname(executable), 'resources/nodus-support-protocol.json'), { protocol: 1, version: '5.13.0', platform: process.platform, arch: process.arch });
  // Use the non-mac layout for pure fixtures, independent of native executable packaging.
  const options = { storage: path.join(base, 'support'), profile, executable, platform: 'linux', arch: process.arch, locale: 'en', isRunning: async () => false, probe: async input => ({ protocol: 1, root: input.root, ok: true }), ...overrides };
  put(path.join(path.dirname(executable), 'resources/nodus-support-protocol.json'), { protocol: 1, version: '5.13.0', platform: 'linux', arch: process.arch });
  const service=new SupportService(options);
  // These tests exercise transactions with a test worker. Real executable/package
  // integrity is covered by the separate installation and native runtime suites.
  service.installation=async()=>JSON.parse(fs.readFileSync(path.join(path.dirname(executable),'resources/nodus-support-protocol.json'),'utf8'));
  return { base, profile, vault, library, executable, options, service };
}
const create = service => service.create({ symptom: 'startup', mode: 'guided' });

test('a report stays attached to its session source when another profile has been selected',async()=>{
  const f=fixture(),other=fixture();put(path.join(f.profile,'nodus-logs.json'),{entries:[{level:'error',code:'SQLITE_CORRUPT'}]});put(path.join(other.profile,'nodus-logs.json'),{entries:[{level:'error',code:'ENOSPC'}]});
  const session=await create(f.service);f.service.profile=other.profile;
  const report=await f.service.report(session.id,{limit:50});assert.match(report.markdown,/SQLITE_CORRUPT/);assert.ok(!report.markdown.includes('ENOSPC'));
  await assert.rejects(f.service.saveReport(session.id,{limit:50},report.markdown,f.profile),/OVERLAPPING_STORAGE/);
  await assert.rejects(f.service.saveReport(session.id,{limit:50},report.markdown,f.library),/OVERLAPPING_STORAGE/);
});

test('registered sources cannot conceal a directory link or Windows junction through canonicalization',async()=>{
  const f=fixture(),alias=path.join(f.base,'vault-alias');fs.symlinkSync(path.dirname(f.vault),alias,'junction');
  put(path.join(f.profile,'vaults.json'),{vaults:[{id:'external',path:path.join(alias,'vault.sqlite')}]});
  assert.throws(()=>detectSources(f.profile),/LINK_NOT_SUPPORTED/);
  const session=await f.service.protect((await create(f.service)).id);assert.equal(session.status,'blocked');assert.equal(session.lastError,'LINK_NOT_SUPPORTED');
  const libraryFixture=fixture(),libraryAlias=path.join(libraryFixture.base,'library-alias');fs.symlinkSync(path.dirname(libraryFixture.library),libraryAlias,'junction');
  put(path.join(libraryFixture.profile,'app-prefs.json'),{autoBackupFolder:libraryAlias,libraryGlobalEnabled:true});
  assert.throws(()=>detectSources(libraryFixture.profile),/LINK_NOT_SUPPORTED/);
});
test('a destination inside an external library is rejected before session files are written',async()=>{
  const f=fixture();f.service.storage=path.join(f.library,'do-not-create');
  const before=await inventory(f.library);await assert.rejects(create(f.service),/OVERLAPPING_STORAGE/);
  assert.equal(fs.existsSync(f.service.storage),false);assert.deepEqual(await inventory(f.library),before);
});

test('an unreadable previous journal stays visible as a finding and all its files are retained',async()=>{
  const f=fixture(),session=await create(f.service),file=path.join(session.folder,'journal/00000001.json');
  put(file,'{ interrupted or damaged journal');const before=await inventory(session.folder);
  const state=await f.service.inspect();assert.ok(state.inspection.findings.some(finding=>finding.code==='SESSION_UNREADABLE'));
  assert.deepEqual(await inventory(session.folder),before);
  const next=await create(f.service),report=await f.service.report(next.id,{limit:50});assert.match(report.markdown,/SESSION_UNREADABLE/);
});
test('an unresolved current profile cannot begin a file-changing check',async()=>{
  const f=fixture(),before=await inventory(f.profile);f.service.selectionError=true;
  const state=await f.service.inspect();assert.ok(state.inspection.findings.some(finding=>finding.code==='RECOVERY_SELECTION_CONFLICT'));
  const session=await f.service.protect((await create(f.service)).id);assert.equal(session.lastError,'RECOVERY_SELECTION_CONFLICT');
  assert.deepEqual(await inventory(f.profile),before);
});
test('private worker logs are available only to the separate raw export',async()=>{
  const f=fixture({probe:async input=>{
    put(path.join(input.root,'probe-private-00000000-0000-4000-8000-000000000003.log'),'PRIVATE synthetic personal canary');
    return {protocol:1,root:input.root,ok:false,code:'TEST_FAILED'};
  }});
  let session=await create(f.service);session=await f.service.protect(session.id);session=await f.service.test(session.id,'copy-profile');
  const files=f.service.privateProbeLogs(session);assert.equal(files.length,1);assert.match(fs.readFileSync(files[0],'utf8'),/personal canary/);
  const report=await f.service.report(session.id,{limit:50});assert.ok(!JSON.stringify(report).includes('personal canary'));
  assert.ok(!f.service.logFiles().includes(files[0]));
});

test('protection includes external SQLite WAL, library, notes and encrypted blobs without modifying a source', async () => {
  const f = fixture(); const sources = detectSources(f.profile).roots;
  const before = await Promise.all(sources.map(root => inventory(root)));
  let session = await create(f.service); session = await f.service.protect(session.id);
  assert.equal(session.status, 'protected'); assert.ok(session.bytes > 0);
  const manifest = JSON.parse(fs.readFileSync(session.protection, 'utf8'));
  assert.equal(manifest.sources.length, 5);
  for (const source of manifest.sources) await verifyInventory(source.copy, source.inventory);
  session = await f.service.test(session.id, 'copy-profile'); assert.equal(session.status, 'awaiting-user');
  const copy = session.recoveredProfiles[0]; const registry = JSON.parse(fs.readFileSync(path.join(copy, 'profile/vaults.json'), 'utf8'));
  const copiedVault = registry.vaults[0].path;
  assert.ok(copiedVault.startsWith(path.join(copy, 'profile')));
  assert.equal(fs.readFileSync(`${copiedVault}-wal`, 'utf8'), 'pending WAL');
  const prefs = JSON.parse(fs.readFileSync(path.join(copy, 'profile/app-prefs.json'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(prefs.autoBackupFolder, 'nodus-library/documents/original.pdf'), 'utf8'), 'private original PDF');
  put(path.join(copy, 'profile/new-work.txt'), 'new trial edits');
  session = await f.service.answer(session.id, false); assert.equal(session.status, 'reverted');
  assert.equal(fs.readFileSync(path.join(copy, 'profile/new-work.txt'), 'utf8'), 'new trial edits');
  assert.deepEqual(await Promise.all(sources.map(root => inventory(root))), before);
  for (const source of manifest.sources) await verifyInventory(source.copy, source.inventory);
});
test('an active Nodus prevents protection rather than force closing or opening SQLite', async () => {
  const f = fixture({ isRunning: async () => true }); const before = await inventory(f.profile);
  const session = await f.service.protect((await create(f.service)).id);
  assert.equal(session.status, 'blocked'); assert.equal(session.lastError, 'CLOSE_NODUS_FIRST');
  assert.deepEqual(await inventory(f.profile), before);
});
test('invalid registries and unavailable external sources block protection', async () => {
  const f = fixture(); put(path.join(f.profile, 'vaults.json'), '{bad JSON');
  let session = await f.service.protect((await create(f.service)).id); assert.equal(session.status, 'blocked');
  put(path.join(f.profile, 'vaults.json'), { vaults: [{ path: path.join(f.base, 'disconnected/vault.sqlite') }] });
  session = await f.service.protect((await create(f.service)).id); assert.equal(session.lastError, 'VAULT_UNAVAILABLE');
});
test('overlapping output, symlinks and unexpected special paths fail closed', async () => {
  const f = fixture(); const overlap = new SupportService({ ...f.options, storage: path.join(f.profile, 'support') });
  await assert.rejects(create(overlap), /OVERLAPPING_STORAGE/);
  if (process.platform !== 'win32') {
    fs.symlinkSync(f.library, path.join(f.profile, 'linked-library'));
    const session = await f.service.protect((await create(f.service)).id); assert.equal(session.lastError, 'LINK_NOT_SUPPORTED');
    assert.equal(fs.readFileSync(path.join(f.library, 'documents/original.pdf'), 'utf8'), 'private original PDF');
  }
});
test('corrupt protected copies cannot be used for tests or promoted by resume', async () => {
  const f = fixture(); const session = await f.service.protect((await create(f.service)).id);
  const manifest = JSON.parse(fs.readFileSync(session.protection, 'utf8'));
  put(path.join(manifest.sources[0].copy, 'nodus.sqlite'), 'broken copy');
  const next = await f.service.test(session.id, 'database-check'); assert.equal(next.lastError, 'COPY_NOT_VERIFIED');
  const resumed = await f.service.resume(session.id); assert.equal(resumed.lastError, 'COPY_NOT_VERIFIED');
  assert.equal(fs.readFileSync(path.join(f.profile, 'nodus.sqlite'), 'utf8'), 'SQLite fixture');
});
test('a restarted assistant recognizes interrupted work and verifies protection before resuming', async () => {
  const f = fixture(); const session = await f.service.protect((await create(f.service)).id);
  await f.service.event(session.id, { status: 'testing' });
  const restarted = new SupportService(f.options); assert.equal((await restarted.session(session.id)).status, 'interrupted');
  assert.equal((await restarted.resume(session.id)).status, 'protected');
});
test('cancelling a probe retains all originals and trial files', async () => {
  let began; const started = new Promise(resolve => { began = resolve; });
  const f = fixture({ probe: async input => { began(); return new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })); } });
  let session = await f.service.protect((await create(f.service)).id); const before = await inventory(f.profile);
  const pending = f.service.test(session.id, 'fresh-profile'); await started; await f.service.cancel(session.id);
  session = await pending; assert.equal(session.status, 'blocked'); assert.deepEqual(await inventory(f.profile), before);
  assert.ok(fs.readdirSync(path.join(session.folder, 'tests')).length > 0);
});
test('legacy versions are read-only and cannot start unknown executables', async () => {
  let probes = 0; const f = fixture({ probe: async () => { probes++; } });
  put(path.join(path.dirname(f.executable), 'resources/nodus-support-protocol.json'), { protocol: 0 });
  const session = await f.service.protect((await create(f.service)).id);
  const next = await f.service.test(session.id, 'fresh-profile'); assert.equal(next.lastError, 'LEGACY_READ_ONLY'); assert.equal(probes, 0);
});
test('configuration rollback refuses concurrent changes and retains preimages', async () => {
  const folder = path.join(scratch, randomUUID()); const file = path.join(folder, 'settings.json'); put(file, 'before');
  const original = await inventory(folder); const hash = original.entries.find(entry => entry.type === 'file').sha256;
  const previous = await replaceRecoverably(file, 'after', hash);
  assert.equal(fs.readFileSync(previous, 'utf8'), 'before'); assert.equal(fs.readFileSync(file, 'utf8'), 'after');
  await assert.rejects(replaceRecoverably(file, 'lost edit', hash), /CONCURRENT_CHANGE/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'after');
});
test('streamed copies verify data and refuse an existing destination', async () => {
  const folder = path.join(scratch, randomUUID()); put(path.join(folder, 'input'), Buffer.alloc(8 * 1024 * 1024, 123));
  const manifest = await inventory(folder); const output = `${folder}-copy`;
  await copyInventory(folder, output, manifest); await verifyInventory(output, manifest);
  await assert.rejects(copyInventory(folder, output, manifest), /DESTINATION_EXISTS/);
  await assert.rejects(sufficientSpace(folder, Number.MAX_SAFE_INTEGER), /NOT_ENOUGH_SPACE/);
});
test('logs are read-only and public exports do not leak raw content, titles, URLs, paths or credentials', async () => {
  const f = fixture();
  const privateText = 'Alice alice@example.org sk-secret-test C:\\Users\\Alice\\Private.pdf https://private.example/?token=secret';
  put(path.join(f.profile, 'nodus-logs.json'), { entries: [{ level: 'error', at: '2026-10-19T10:00:00Z', detail: `EACCES ${privateText}`, documentTitle: privateText, vaultName: privateText }] });
  const before = await inventory(f.profile); const session = await create(f.service);
  const report = await f.service.report(session.id, { limit: 50 });
  for (const secret of ['Alice','alice@','sk-secret','private.example','Private.pdf','token=']) assert.ok(!JSON.stringify(report).includes(secret));
  assert.match(report.markdown, /EACCES/); assert.deepEqual(await inventory(f.profile), before);
  const output = path.join(f.base, 'exports'); fs.mkdirSync(output);
  const saved = await f.service.saveReport(session.id, { limit: 50 }, report.markdown, output);
  assert.deepEqual(fs.readdirSync(saved).sort(), ['diagnostics.json','errors.txt','manifest.json','report.md']);
  assert.deepEqual(await inventory(f.profile), before);
});
test('selection filters dates and counts without pruning the underlying log', async () => {
  const f = fixture(); const entries = Array.from({ length: 120 }, (_,i) => ({ level: 'error', at: `2026-10-${i < 60 ? '18' : '19'}T10:00:00Z`, detail: 'ENOSPC private payload' }));
  put(path.join(f.profile, 'nodus-logs.json'), { entries });
  assert.equal((await f.service.errors({ limit: 20 })).length, 20);
  assert.equal((await f.service.errors({ limit: 'all', since: '2026-10-19T00:00:00Z' })).length, 60);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.profile, 'nodus-logs.json'), 'utf8')).entries.length, 120);
});
test('actual pipeline badges and nearby technical events survive without message parameters or identifiers',async()=>{
  const f=fixture(),secret='Alice private document sk-canary-token',jobId='private-job-Alice';
  put(path.join(f.profile,'nodus-logs.json'),{entries:[{level:'info',at:'2026-10-19T10:00:00Z',category:'provider',code:'connection',jobId,documentTitle:secret,message:{id:'ok',params:{detail:secret}}},{level:'error',at:'2026-10-19T10:00:01Z',category:'provider',code:'auth',httpStatus:401,repeat:3,jobId,detail:secret,model:secret}]});
  const before=await inventory(f.profile),report=await f.service.report((await create(f.service)).id,{limit:50});
  assert.equal(report.report.errors[0].code,'PIPELINE_AUTH');assert.equal(report.report.errors[0].httpStatus,401);assert.equal(report.report.errors[0].repeat,3);assert.equal(report.report.errors[0].context[0].code,'PIPELINE_CONNECTION');
  for(const privateValue of ['Alice','private document','sk-canary','private-job'])assert.ok(!JSON.stringify(report).includes(privateValue));
  assert.deepEqual(await inventory(f.profile),before);
});
test('GitHub drafts are bounded, carry no account tokens and use the existing form', () => {
  const report = publicReport({ version: '5.13.0', platform: 'win32', arch: 'x64' }, { symptom: 'startup', status: 'blocked', actions: [] }, [], []);
  const draft = issueDraft(report, reportMarkdown(report)); assert.ok(draft.issueUrl.includes('bug_report.yml'));
  const long = issueDraft(report, 'x'.repeat(10000)); assert.equal(long.needsClipboard, true); assert.ok(long.issueUrl.length <= 2000);
  const malicious = publicReport({ version: 'secret@example.org', platform: 'secret', arch: 'secret' }, { symptom: 'secret', status: 'secret', actions: [{ action: 'Alice.pdf', status: 'token=foo', code: 'private data' }] }, [{ code: 'https://private.example', component: 'Alice.pdf' }], []);
  assert.ok(!JSON.stringify(malicious).includes('Alice')); assert.ok(!JSON.stringify(malicious).includes('private.example'));
});
test('language resolution covers exact variants, system language and English fallback', () => {
  assert.equal(detectLanguage('pt-BR', 'en'), 'pt-BR'); assert.equal(detectLanguage('xx', 'fr-FR'), 'fr');
  assert.equal(detectLanguage(undefined, 'zh-TW'), 'zh-TW'); assert.equal(detectLanguage(null, 'unknown'), 'en');
});
test('untrusted IPC fields cannot inject a protection path or replace session identity',async () => {
  const f=fixture();
  const session=await f.service.create({symptom:'startup',mode:'guided',id:'forged',folder:f.profile,protection:f.vault,policyApplied:'forged'});
  assert.notEqual(session.id,'forged');assert.notEqual(session.folder,f.profile);assert.equal(session.protection,undefined);assert.equal(session.policyApplied,undefined);
});
test('changes made while copying stop protection and keep the new original and partial copy',async () => {
  let changed=false; const f=fixture({progress:value=>{
    if(value.phase==='protecting'&&!changed){changed=true;put(path.join(f.profile,'recent-work.txt'),'new unsaved-by-support work');}
  }});
  const session=await f.service.protect((await create(f.service)).id);
  assert.equal(session.status,'blocked');assert.equal(session.lastError,'SOURCE_CHANGED');assert.equal(session.protection,undefined);
  assert.equal(fs.readFileSync(path.join(f.profile,'recent-work.txt'),'utf8'),'new unsaved-by-support work');
  assert.ok(fs.readdirSync(path.join(session.folder,'protection')).length>0);
});
test('startup codes are classified without copying path-bearing error messages',async () => {
  const f=fixture();put(path.join(f.profile,'support-startup/early.jsonl'),JSON.stringify({at:'2026-10-19T10:00:00.000Z',code:'STARTUP_IMPORT_FAILED',causeCode:'MODULE_NOT_FOUND',message:'Alice /private/secret.pdf'}));
  const report=await f.service.report((await create(f.service)).id,{limit:50});
  assert.ok(report.markdown.includes('MODULE_NOT_FOUND'));assert.ok(!report.markdown.includes('Alice'));
  const unsafe=publicReport({}, {actions:[],status:'blocked'},[{code:'ALICE_PRIVATE_NAME',component:'private-paper'}],[{code:'ERR_PRIVATE_SECRET',component:'alice-paper',at:'alice@example.org'}]);
  assert.ok(!JSON.stringify(unsafe).includes('PRIVATE'));assert.ok(!JSON.stringify(unsafe).includes('alice'));
});
test('inspection remains usable when process discovery fails, while protection stays blocked',async () => {
  const f=fixture({isRunning:async()=>{throw new Error('process discovery unavailable');}});
  const state=await f.service.inspect();assert.ok(state.inspection.findings.some(finding=>finding.code==='PROCESS_CHECK_UNAVAILABLE'));
  const session=await f.service.protect((await create(f.service)).id);assert.equal(session.status,'blocked');
  const report=await f.service.report(session.id,{limit:50});assert.ok(report.markdown.includes('PROCESS_CHECK_UNAVAILABLE'));
});
