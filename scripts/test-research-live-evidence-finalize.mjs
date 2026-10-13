import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { after, test } from 'node:test';
import { finalizeResearchEvidenceCampaign } from './research-live-evidence-finalize.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const roots = [];
after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-posthoc-test-')); roots.push(root);
  const repo = path.join(root, 'repo'); const qa = path.join(root, 'qa');
  fs.mkdirSync(repo); fs.mkdirSync(path.join(qa, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(qa, 'isolation.json'), JSON.stringify({ format: 'nodus.isolated-research-profile/1', root: fs.realpathSync(qa) }));
  const sourceFile = path.join(repo, 'a.mjs'), buildFile = path.join(repo, 'dist.js');
  fs.writeFileSync(sourceFile, 'frozen source'); fs.writeFileSync(buildFile, 'frozen build');
  const embeddingContract = { profileId: 'q8-512', dimensions: 512 };
  const scopeContract = { notebookId: 'notebook-1', sourceCount: 40 };
  const profileHash = sha(JSON.stringify(embeddingContract)), scopeHash = sha(JSON.stringify(scopeContract));
  const queries = Array.from({ length: 80 }, (_, index) => ({ id: `R${String(index + 1).padStart(3, '0')}`,
    kind: index < 10 ? 'hard-negative' : index < 60 ? 'monolingual' : 'no-evidence', question: `Question ${index + 1}`,
    language: 'en', isAnswerable: index < 60 }));
  const rows = queries.map(query => {
    const sourceContext = JSON.stringify({ question: query.question, permitted: [] });
    const sourcesContext = { receipts: [] };
    const sourceContextSha256 = sha(sourceContext), sourcesContextSha256 = sha(JSON.stringify(sourcesContext));
    const citations = query.id === 'R001' ? ['doc:passage:1'] : [];
    const resolved = [...citations];
    const row = { id: query.id, cohortKind: query.kind, question: query.question, language: query.language,
      isAnswerable: query.isAnswerable, sourceContext, sourceContextSha256, sourcesContext, sourcesContextSha256,
      retrievalTraces: [{ type: 'documentary-retrieval' }], retrievalContractAudit: [{ status: 'verified' }],
      semanticParticipated: true, lexicalFallback: false, sourceEvidence: citations.map(citationId => ({ citationId })),
      citationResolution: { attempted: citations.length, attemptedIds: citations, resolved: resolved.length, resolvedIds: resolved,
        unresolved: 0, unresolvedIds: [], resolvedTextsMatchSearch: true, resolvedDocumentsAuthorized: true },
      scopeLeaks: [], searchError: null };
    row.caseSourceSnapshotSha256 = sha(JSON.stringify({ caseId: row.id, question: row.question, language: row.language,
      isAnswerable: row.isAnswerable, sourceContextSha256, sourcesContextSha256,
      profileContractSha256: profileHash, scopeContractSha256: scopeHash }));
    return row;
  });
  const sourceDocuments = Array.from({ length: 40 }, (_, index) => ({ id: `fixture-${String(index + 1).padStart(2, '0')}`, sha256: sha(`corpus-${index + 1}`) }));
  const importedDocuments = sourceDocuments.map((row, index) => ({ ...row, libraryItemId: `library-${index + 1}` }));
  const overall = sha(JSON.stringify(rows.map(row => ({ id: row.id, caseSourceSnapshotSha256: row.caseSourceSnapshotSha256 }))));
  const prereg = { format: 'nodus.research-live-evidence-preregistration/1', counts: { total: 80, answerable: 60, insufficient: 20 },
    queries, sourceDocuments, annotationGold: Object.fromEntries(queries.map(row => [row.id, { excluded: true }])) };
  const progress = { format: 'nodus.research-live-evidence-campaign/1', campaignRoot: fs.realpathSync(qa), profileId: 'q8-512', modelCalls: 0,
    retrievalCompleted: 80, electronPid: 123, status: 'preparing', sourceVersionBefore: { 'a.mjs': sha('frozen source') },
    buildArtifactsBefore: { 'dist.js': sha('frozen build') }, profileContractSha256: profileHash, scopeContractSha256: scopeHash,
    embeddingContract, scopeContract, extraction: importedDocuments.map(row => ({ itemId: row.libraryItemId, status: 'done' })),
    preparation: importedDocuments.map((row, index) => ({ id: row.libraryItemId, preparation: { status: 'ready', lexical: 'ready', embeddings: 'ready', passages: index + 1, embedded: index + 1 } })),
    importedDocuments, overallCaseSourceSnapshotSha256: overall,
    caseSourceSnapshotSha256: overall };
  const source = { format: 'nodus.research-case-sources/1', profileRoot: fs.realpathSync(qa), profileId: 'q8-512', profileContract: embeddingContract,
    profileContractSha256: profileHash, scopeContract, scopeContractSha256: scopeHash, caseSourceSnapshotSha256: overall, corpusSourceHashes: sourceDocuments, cases: rows };
  const manifest = { documents: sourceDocuments };
  const artifacts = path.join(qa, 'artifacts');
  for (const [name, value] of [['progress.json', progress], ['case-sources.json', source], ['preregistration.json', prereg], ['source-manifest.json', manifest]]) {
    fs.writeFileSync(path.join(artifacts, name), JSON.stringify(value));
  }
  fs.writeFileSync(path.join(artifacts, 'electron-process-events.jsonl'), `${JSON.stringify({ event: 'child-close', pid: 123, code: 0, signal: null })}\n`);
  fs.writeFileSync(path.join(artifacts, 'coordinator-terminal-error.log'), "TypeError: Cannot read properties of undefined (reading '_object')\n at toImpl\n at ElectronApplication2.process\n at file:///repo/scripts/research-live-evidence-campaign.mjs:760:40\n");
  return { root: qa, repo };
}

test('finalizes 80 preregistered cases with exact hashes and separates coordinator failure from Electron exit', () => {
  const { root, repo } = fixture();
  const result = finalizeResearchEvidenceCampaign({ root, repoRoot: repo });
  assert.equal(result.output.verification.cases, 80);
  assert.equal(result.output.verification.answerable, 60);
  assert.equal(result.output.verification.insufficient, 20);
  assert.deepEqual(result.output.verification.citationResolution, { captured: 1, resolved: 1, unresolved: 0, rate: 1 });
  assert.equal(result.output.termination.coordinatorExitCode, 1);
  assert.equal(result.output.termination.electronExitCode, 0);
  assert.equal(result.output.termination.electronExitedNormally, true);
  assert.equal(result.output.campaignRoot, fs.realpathSync(root));
  assert.equal(result.output.profileId, 'q8-512');
  assert.equal(result.output.profileContractSha256, result.output.campaign.profileContractSha256);
  assert.equal(result.output.scopeContractSha256, result.output.campaign.scopeContractSha256);
  assert.equal(result.output.caseSourceSnapshotSha256, result.output.campaign.caseSourceSnapshotSha256);
  assert.equal(result.output.retrievalContractAudit.checks.length, 80);
  assert.equal(fs.existsSync(path.join(root, 'artifacts/campaign-posthoc-finalized-002.json')), true);
  assert.throws(() => finalizeResearchEvidenceCampaign({ root, repoRoot: repo }), /Refusing to overwrite/u);
});

test('rejects question/case mutation even when the QA root marker is valid', () => {
  const { root, repo } = fixture();
  const sourcePath = path.join(root, 'artifacts/case-sources.json');
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  source.cases[0].question = 'tampered';
  fs.writeFileSync(sourcePath, JSON.stringify(source));
  assert.throws(() => finalizeResearchEvidenceCampaign({ root, repoRoot: repo }), /Question identity/u);
});

test('rejects source or build changes after the frozen snapshots', () => {
  for (const target of ['a.mjs', 'dist.js']) {
    const { root, repo } = fixture();
    fs.writeFileSync(path.join(repo, target), 'changed');
    assert.throws(() => finalizeResearchEvidenceCampaign({ root, repoRoot: repo }), /changed since campaign/u);
  }
});

test('rejects unsafe snapshot paths and altered individual context bytes', () => {
  const { root, repo } = fixture();
  const progressPath = path.join(root, 'artifacts/progress.json');
  const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
  progress.sourceVersionBefore = { '../secret': '0'.repeat(64) };
  fs.writeFileSync(progressPath, JSON.stringify(progress));
  assert.throws(() => finalizeResearchEvidenceCampaign({ root, repoRoot: repo }), /unsafe path/u);
  const second = fixture();
  const sourcePath = path.join(second.root, 'artifacts/case-sources.json');
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  source.cases[0].sourceContext += ' changed';
  fs.writeFileSync(sourcePath, JSON.stringify(source));
  assert.throws(() => finalizeResearchEvidenceCampaign({ root: second.root, repoRoot: second.repo }), /Individual source context hash/u);
});

test('rejects ready-but-unprepared sources and corpus identity/hash mismatches', () => {
  const { root, repo } = fixture();
  const progressPath = path.join(root, 'artifacts/progress.json');
  const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
  progress.preparation[0].preparation.embedded = 0;
  fs.writeFileSync(progressPath, JSON.stringify(progress));
  assert.throws(() => finalizeResearchEvidenceCampaign({ root, repoRoot: repo }), /not fully lexical- and embedding-ready/u);
  const second = fixture();
  const preregPath = path.join(second.root, 'artifacts/preregistration.json');
  const prereg = JSON.parse(fs.readFileSync(preregPath, 'utf8'));
  prereg.sourceDocuments[0].sha256 = '0'.repeat(64);
  fs.writeFileSync(preregPath, JSON.stringify(prereg));
  assert.throws(() => finalizeResearchEvidenceCampaign({ root: second.root, repoRoot: second.repo }), /Source manifest source IDs\/SHA-256 set mismatch/u);
});

test('rejects an unrelated coordinator error instead of labelling it the known reporting failure', () => {
  const { root, repo } = fixture();
  fs.writeFileSync(path.join(root, 'artifacts/coordinator-terminal-error.log'), 'unrelated failure');
  assert.throws(() => finalizeResearchEvidenceCampaign({ root, repoRoot: repo }), /does not match the reviewed Playwright/u);
});
