// Offline instrumentation repair and durable export. Never calls a provider or
// edits a generated answer. Keep the original measurements for an audit trail.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const destination = path.resolve('artifacts/research-harness-ab');
const pointer = JSON.parse(fs.readFileSync(path.join(destination, 'latest.json'), 'utf8'));
const root = process.argv[2] ?? pointer.root;
const artifacts = path.join(root, 'artifacts');
const file = path.join(artifacts, 'campaign.json');
const campaign = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.ok(campaign.completedAt, 'Campaign still running');
assert.equal(campaign.runs.length, 20);
assert.equal(new Set(campaign.runs.map(run => `${run.caseId}/${run.mode}`)).size, 20);
assert.ok(campaign.runs.every(run => !run.error && !run.aborted && run.answer?.trim()), 'Not all responses completed');
for (const item of campaign.cases) {
  const pair = campaign.runs.filter(run => run.caseId === item.id);
  assert.equal(pair.length, 2);
  assert.deepEqual(pair[0].context.selection, pair[1].context.selection, 'Unequal grants');
  assert.equal(pair[0].stats.researchTraversal.scopeId, pair[1].stats.researchTraversal.scopeId, 'Unequal source scope');
}
const original = path.join(artifacts, 'campaign.before-instrumentation-correction.json');
if (!fs.existsSync(original)) fs.copyFileSync(file, original);
if (campaign.fatal) {
  assert.match(campaign.fatal, /UNIQUE constraint failed: chat_messages.id/);
  (campaign.priorInfrastructureFailures ??= []).push({ error: campaign.fatal, correction: 'Stale setup failure retained on resume; all 20 unique responses subsequently completed.' });
  delete campaign.fatal;
}
const ideas = JSON.parse(execFileSync('python3', ['-c', `
import sqlite3,json,sys
from pathlib import Path
db=sqlite3.connect(Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
ids=json.load(sys.stdin);result={}
for id in ids:
 row=db.execute('SELECT global_id,label,statement FROM ideas WHERE global_id=?',(id,)).fetchone()
 if row:
  entry=dict(row)
  entry['works']=[dict(work) for work in db.execute('SELECT w.nodus_id,w.title,w.authors_json,w.year FROM idea_occurrences o JOIN works w ON w.nodus_id=o.nodus_id WHERE o.global_id=?',(id,))]
  result[id]=entry
print(json.dumps(result))
`, path.join(root, 'profile/nodus.sqlite')], { encoding: 'utf8', input: JSON.stringify([...new Set(campaign.runs.flatMap(run => run.evidence.filter(e => e.ref.kind === 'idea').map(e => e.ref.id)))]) }));
let repaired = 0;
for (const run of campaign.runs) {
  const answer = run.answer;
  for (const entry of run.evidence) if (entry.ref.kind === 'idea' && entry.error?.includes('no such column: nodus_id')) {
    assert.ok(ideas[entry.ref.id], `Unresolved idea ${entry.ref.id}`);
    entry.measurementCorrection = { originalError: entry.error, method: 'Read-only frozen SQLite idea and occurrence lookup; ideas use a many-to-many occurrence table.' };
    entry.detail = ideas[entry.ref.id]; delete entry.error; repaired++;
  }
  assert.equal(run.answer, answer);
  fs.writeFileSync(path.join(artifacts, `${run.caseId}-${run.mode}.json`), JSON.stringify(run, null, 2), { mode: 0o600 });
}
campaign.instrumentationCorrections = { ideaReferenceLookups: campaign.runs.flatMap(run => run.evidence).filter(entry => entry.measurementCorrection).length,
  generatedAnswersChanged: false, original: path.basename(original) };
fs.writeFileSync(file, JSON.stringify(campaign, null, 2), { mode: 0o600 });
for (const name of fs.readdirSync(artifacts)) if (/^(?:campaign|measurements|paired-answers|source-snapshot|isolation-proof|code-identity|provider-metrics|cost-ledger|request-map|gold-)/.test(name) || /^\d{2}-.+-(?:legacy|v1)\.(?:json|md)$/.test(name)) {
  fs.copyFileSync(path.join(artifacts, name), path.join(destination, name));
}
console.log(JSON.stringify({ responses: 20, successfulPairs: 10, repairedIdeaReferenceMeasurements: repaired, destination }));
