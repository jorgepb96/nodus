// Explicit paid A/B against a read-only SQLite snapshot of the local Nodus corpus.
// The Electron child has the existing OS isolation; only the cost-reserving proxy
// can reach the configured DeepSeek/BGE endpoints. No provider keys are printed.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createResearchTestRoot, researchTestEnvironment, macResearchSandbox, verifyResearchSandbox } from './research-isolation.mjs';
import { importResearchTestCredentials } from './research-test-credentials.mjs';
import { startResearchProviderProxy } from './research-provider-proxy.mjs';
import { validationCases } from './lib/research-validation-cases.mjs';

const require = createRequire(import.meta.url);
const repo = path.resolve(import.meta.dirname, '..');
const source = process.argv.find(arg => arg.startsWith('--source-profile='))?.slice(17);
const validationRound = process.argv.find(arg => arg.startsWith('--validation-round='))?.slice('--validation-round='.length);
if (validationRound && !['1', '2'].includes(validationRound)) throw new Error('Validation round must be 1 or 2');
const validationIds = process.argv.find(arg => arg.startsWith('--validation-cases='))?.slice('--validation-cases='.length).split(',');
if (validationIds && (!validationRound || new Set(validationIds).size !== validationIds.length || validationIds.some(id => !validationCases[validationRound].some(item => item.id === id)))) throw new Error('Choose distinct declared validation case IDs');
const noAudit = process.argv.includes('--v1-no-audit');
const formatReplay = process.argv.includes('--v1-format-replay');
const coherentReview = Boolean(validationRound) || formatReplay || process.argv.includes('--v1-coherent-review');
const semanticExpansionV2 = process.argv.includes('--semantic-expansion-v2');
const semanticExpansion = semanticExpansionV2 || process.argv.includes('--semantic-expansion');
if ([noAudit, semanticExpansion, coherentReview].filter(Boolean).length > 1) throw new Error('Choose one evaluation scenario');
const scenario = validationRound ? `v1-validation-${validationIds ? "corrections" : "round"}-${validationRound}` : formatReplay ? 'v1-format-replay' : coherentReview ? 'v1-coherent-review' : noAudit ? 'v1-no-audit' : semanticExpansionV2 ? 'semantic-expansion-v2' : 'semantic-expansion';
const campaignName = noAudit || semanticExpansion || coherentReview ? `${scenario}.json` : 'campaign.json';
if (!source) throw new Error('Pass --source-profile=/absolute/path to explicitly enable paid research A/B');
const requested = process.argv.find(arg => arg.startsWith('--resume-root='))?.slice(14);
if ((noAudit || formatReplay) && !requested) throw new Error('Audit ablation requires --resume-root with the original frozen A/B corpus');
const replaySource = process.argv.find(arg => arg.startsWith('--replay-source='))?.slice('--replay-source='.length) ?? 'v1-coherent-review.json';
if (!/^[a-z0-9-]+\.json$/.test(replaySource)) throw new Error('Replay source must be an isolated campaign filename');
const root = requested ? fs.realpathSync(requested) : createResearchTestRoot();
const artifacts = path.join(root, 'artifacts');
const output = path.join(repo, 'artifacts/research-harness-ab'); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'latest.json'), JSON.stringify({ root, artifacts, startedAt: new Date().toISOString() }, null, 2));
if (!requested) {
  console.log(`Preparing consistent corpus snapshot: ${root}`);
  const snapshot = spawnSync('python3', ['-c', `
from pathlib import Path
import sqlite3,json,sys,shutil
src=Path(sys.argv[1]); root=Path(sys.argv[2]); profile=root/'profile'
reg=json.loads((src/'vaults.json').read_text()); vault=next(v for v in reg['vaults'] if v['id']==reg['activeVaultId'])
assert vault.get('type','academic')=='academic'
files=[(Path(vault['path']),profile/'nodus.sqlite'),(src/'documentary/store.sqlite',profile/'documentary/store.sqlite'),(src/'library/catalog.sqlite',profile/'library/catalog.sqlite')]
receipts=[]
for source,target in files:
 if not source.exists(): continue
 target.parent.mkdir(parents=True,exist_ok=True)
 original=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True); clone=sqlite3.connect(target)
 original.backup(clone,pages=4096); original.close(); clone.close()
 receipts.append({'source':str(source),'snapshot':str(target),'bytes':target.stat().st_size,'method':'SQLite online backup from read-only handle'})
for rel in ['library/device.json','profile-migrations/library-origin.json']:
 if (src/rel).exists():
  (profile/rel).parent.mkdir(parents=True,exist_ok=True); shutil.copy2(src/rel,profile/rel)
db=sqlite3.connect(profile/'nodus.sqlite')
settings=json.loads(db.execute("SELECT value FROM settings WHERE key='app'").fetchone()[0])
settings.update({'autoLightScan':False,'autoDeepScanOnReadTag':False,'autoSummaryAfterDeep':False,'autoBridgeAfterQueue':False,'autoBackupFolder':str(root/'library'),'researchAnswerVerification':'off','researchWebSearch':'off','researchHarnessVersion':'legacy','onboardingComplete':True})
db.execute("UPDATE settings SET value=? WHERE key='app'",(json.dumps(settings),));db.commit();db.close()
(profile/'app-prefs.json').write_text(json.dumps({'autoBackupFolder':str(root/'library'),'embeddingProvider':'openrouter','embeddingModel':'baai/bge-m3','promptLanguage':'es','uiLanguage':'es','autoLightScan':False}))
(root/'artifacts/source-snapshot.json').write_text(json.dumps({'sourceProfile':str(src),'activeVault':vault['name'],'snapshots':receipts},indent=2))
`, path.resolve(source), root], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (snapshot.status !== 0) throw new Error(snapshot.stderr || 'Snapshot failed');
  importResearchTestCredentials(root);
}
let applicationRepo = repo;
if (noAudit) {
  // Reuse the exact application sources measured in the original A/B. The
  // current branch includes semantic planning changes that would confound it.
  const identity = JSON.parse(fs.readFileSync(path.join(artifacts, 'code-identity.json'), 'utf8'));
  const baselineCommit = identity.contentCommit;
  applicationRepo = path.join(root, `app-baseline-${baselineCommit.slice(0, 12)}`);
  if (!fs.existsSync(applicationRepo)) {
    fs.mkdirSync(applicationRepo);
    const archive = spawnSync('git', ['archive', baselineCommit, 'electron', 'shared', 'packages', 'skill-capabilities', 'runtime', 'package.json', 'scripts/lib/tsRuntimeHooks.mjs'], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
    if (archive.status !== 0) throw new Error('Cannot archive the measured application revision');
    const unpack = spawnSync('tar', ['-x', '-C', applicationRepo], { input: archive.stdout });
    if (unpack.status !== 0) throw new Error('Cannot unpack the measured application revision');
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(applicationRepo, 'node_modules'));
    fs.symlinkSync(path.join(repo, 'dist-electron'), path.join(applicationRepo, 'dist-electron'));
  }
  if (!fs.existsSync(path.join(applicationRepo, 'packages'))) {
    const archive = spawnSync('git', ['archive', baselineCommit, 'packages'], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
    if (archive.status !== 0 || spawnSync('tar', ['-x', '-C', applicationRepo], { input: archive.stdout }).status !== 0) throw new Error('Cannot restore baseline capability package sources');
  }
  if (!fs.existsSync(path.join(applicationRepo, 'skill-capabilities'))) {
    const archive = spawnSync('git', ['archive', baselineCommit, 'skill-capabilities', 'runtime'], { cwd: repo, maxBuffer: 64 * 1024 * 1024 });
    if (archive.status !== 0 || spawnSync('tar', ['-x', '-C', applicationRepo], { input: archive.stdout }).status !== 0) throw new Error('Cannot restore baseline capability runtime sources');
  }
  for (const [file, hash] of Object.entries(identity.files)) if (file.startsWith('electron/')) {
    if (createHash('sha256').update(fs.readFileSync(path.join(applicationRepo, file))).digest('hex') !== hash) throw new Error(`Baseline source mismatch: ${file}`);
  }
  fs.writeFileSync(path.join(artifacts, 'v1-no-audit-code-identity.json'), JSON.stringify({ baselineCommit, runnerCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), applicationRepo,
    baselineSourcesVerified: true, intervention: 'Only replace repairResearchDraft in the isolated test process with identity; preserve planner, retrieval, supervisor and citation finalization.',
    documentaryWorker: { path: path.join(repo, 'dist-electron/documentaryRetrievalWorker.js'), sha256: createHash('sha256').update(fs.readFileSync(path.join(repo, 'dist-electron/documentaryRetrievalWorker.js'))).digest('hex') } }, null, 2));
  const missingProviders = ['deepseek', 'openrouter'].filter(provider => !fs.existsSync(path.join(root, `profile/secrets/ai_key_${provider}.bin`)));
  if (missingProviders.length) importResearchTestCredentials(root, undefined, missingProviders);
}
if (coherentReview) {
  const previousPath = path.join(artifacts, campaignName);
  if (fs.existsSync(previousPath)) {
    const previous = JSON.parse(fs.readFileSync(previousPath, 'utf8'));
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const expectedIds = validationIds ?? (validationRound ? validationCases[validationRound].map(item => item.id) : null);
    if (previous.commit !== commit || (expectedIds && JSON.stringify(previous.cases.map(item => item.id)) !== JSON.stringify(expectedIds))) {
      throw new Error('Archive the previous campaign before testing changed code or cases; resuming would reuse completed results.');
    }
  }
  const missing = ['deepseek', 'openrouter'].filter(provider => !fs.existsSync(path.join(root, `profile/secrets/ai_key_${provider}.bin`)));
  if (missing.length) importResearchTestCredentials(root, undefined, missing);
  const files = ['electron/ai/researchAssistant.ts', 'electron/ai/researchHarnessVerification.ts', 'electron/ai/researchHarnessContext.ts', 'shared/researchAnswerReview.ts', 'shared/researchReasoning.ts', 'electron/ai/researchGenerationOptions.ts', 'electron/ai/thinkingEffort.ts', 'shared/researchChatGrounding.ts', 'electron/ai/researchCorpusRun.ts', 'electron/ai/researchActionCoordinator.ts', 'electron/ai/researchTurnPlanner.ts', 'shared/researchClaimAudit.ts', 'scripts/lib/research-validation-cases.mjs', 'scripts/lib/research-harness-ab-electron.mjs'];
  fs.writeFileSync(path.join(artifacts, `${scenario}-code-identity.json`), JSON.stringify({ commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), files: Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(repo, file))).digest('hex')])), intervention: 'Current v1 product with semantic expansion and coherent evidence review; no audit bypass.' }, null, 2));
}
let sequence = fs.existsSync(path.join(artifacts, 'request-map.jsonl')) ? fs.readFileSync(path.join(artifacts, 'request-map.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length : 0;
const proxy = await startResearchProviderProxy(root, { limitUsd: 7, maxOutputTokens: 393216,
  dispatch: async (url, options) => {
    const active = JSON.parse(fs.readFileSync(path.join(artifacts, 'active-case.json'), 'utf8'));
    const body = JSON.parse(Buffer.from(options.body).toString('utf8'));
    const id = ++sequence;
    const requestHash = createHash('sha256').update(options.body).digest('hex');
    fs.appendFileSync(path.join(artifacts, 'request-map.jsonl'), JSON.stringify({ ...active, id, requestHash, model: body.model,
      ...(body.input ? { embeddingInputs: Array.isArray(body.input) ? body.input.length : 1 } : {}), at: new Date().toISOString() }) + '\n');
    if (body.messages) fs.writeFileSync(path.join(artifacts, `${active.caseId}-${active.mode}-request-${id}.json`), JSON.stringify(body, null, 2), { mode: 0o600 });
    return fetch(url, options);
  }, catalogDispatch: fetch });
try {
  const sandbox = macResearchSandbox(root, [Number(new URL(proxy.url).port)]);
  const proof = verifyResearchSandbox(root, sandbox);
  fs.writeFileSync(path.join(artifacts, 'isolation-proof.json'), JSON.stringify(proof, null, 2));
  const env = { ...researchTestEnvironment(root), NODUS_RESEARCH_PROVIDER_PROXY: proxy.url, NODUS_AB_REPO: applicationRepo,
    ...(noAudit || semanticExpansion || coherentReview ? { NODUS_AB_SCENARIO: scenario } : {}),
    ...(formatReplay ? { NODUS_AB_REPLAY_SOURCE: replaySource } : {}),
    ...(validationIds ? { NODUS_AB_VALIDATION_CASES: JSON.stringify(validationIds) } : {}),
    NODUS_AB_GIT: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), NODUS_EMBEDDING_QA_TRACE: '1' };
  const child = spawn('/usr/bin/sandbox-exec', ['-p', sandbox, require('electron'), '--no-sandbox', path.join(repo, 'scripts/lib/research-harness-ab-electron.mjs')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = fs.createWriteStream(path.join(artifacts, 'execution.log'), { flags: 'a', mode: 0o600 });
  let partial = '';
  child.stdout.on('data', bytes => { log.write(bytes); partial += bytes; const lines = partial.split('\n'); partial = lines.pop(); for (const line of lines) if (line.startsWith('AB:')) console.log(line); });
  child.stderr.on('data', bytes => log.write(bytes));
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  log.end();
  console.log(`A/B exit ${code}; artifacts: ${artifacts}`);
  const result = JSON.parse(fs.readFileSync(path.join(artifacts, campaignName), 'utf8'));
  fs.copyFileSync(path.join(artifacts, campaignName), path.join(output, campaignName));
  if (code !== 0 || result.fatal || !result.completedAt || result.runs.length !== (validationIds ? validationIds.length : validationRound === '1' ? 15 : noAudit || coherentReview ? 10 : semanticExpansion ? 1 : 20) || result.runs.some(run => run.error || run.aborted)) process.exitCode = 1;
} finally { await proxy.close(); }
