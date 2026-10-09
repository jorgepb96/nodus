// Recorded-reaction ids (ORD and Lowe's USPTO patent records) and the bond-edit audit's flags, as
// the precedent, synthesis-evidence and textbook sections show them.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-record-audit-'));
test.after(() => rm(tmp, { recursive: true, force: true }));

async function bundle(entry, name) {
  const outfile = path.join(tmp, name);
  await build({ entryPoints: [path.join(root, entry)], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent', alias: { '@shared': path.join(root, 'shared') } });
  return import(pathToFileURL(outfile).href);
}

const audit = await bundle('shared/recordAudit.ts', 'record-audit.mjs');
const inspection = await bundle('shared/moleculeInspection.ts', 'inspection.mjs');
const evidence = await bundle('shared/synthesisEvidence.ts', 'evidence.mjs');
const textbook = await bundle('shared/textbookSchemes.ts', 'textbook.mjs');

const ORD = `ord-${'a'.repeat(32)}`;

test('record ids: ORD and Lowe patent records are accepted; anything else is not', () => {
  for (const id of [ORD, 'lg:US05155269:', 'la:US20060211688A1:0055']) assert.ok(audit.RECORD_ID.test(id), id);
  for (const id of ['ord-xyz', 'lx:US1:', 'lg:US05155269', 'tb-' + 'a'.repeat(32), 'javascript:alert(1)']) assert.ok(!audit.RECORD_ID.test(id), id);
});

test('record labels: a patent is cited by its number and paragraph, linked; grant padding is dropped', () => {
  assert.equal(audit.recordLabel('la:US20060211688A1:0055'), '[US20060211688A1 ¶55](https://patents.google.com/patent/US20060211688A1)');
  assert.equal(audit.recordLabel('lg:US05155269:'), '[US5155269](https://patents.google.com/patent/US5155269)');
  assert.equal(audit.recordLabel(ORD), `\`${ORD}\``);
});

test('audit flags: only the audit\'s own flags pass, and the note says what citing requires', () => {
  assert.deepEqual(audit.normalizeAuditFlags(['1,2-shift', 'made-up', 3, '1,2-shift']), ['1,2-shift']);
  const note = audit.auditNote(['reorganised skeleton', 'unactivated C–C']);
  assert.match(note, /carbon skeleton is reorganised/);
  assert.match(note, /must name the rearrangement or radical step/);
  assert.equal(audit.auditNote(['made-up']), '');
});

test('ORD precedents: patent samples are kept and linked; a flagged record carries its audit note', () => {
  const precedent = inspection.normalizeReactionPrecedent({
    reactions: [{ input: 'CCO>>CC=O', key: 'k', count: 2, samples: [ORD, 'lg:US05155269:', 'bogus'], auditFlags: ['1,2-shift', 'nope'] }],
    products: [], similar: [],
  });
  assert.deepEqual(precedent.reactions[0].samples, [ORD, 'lg:US05155269:']);
  assert.deepEqual(precedent.reactions[0].auditFlags, ['1,2-shift']);
  const text = inspection.formatReactionPrecedents(precedent);
  assert.match(text, /\[US5155269\]\(https:\/\/patents\.google\.com\/patent\/US5155269\)/);
  assert.match(text, /⚑ Bond-edit audit: as recorded, a carbon moves to its neighbour/);
  const clean = inspection.formatReactionPrecedents(inspection.normalizeReactionPrecedent({ reactions: [{ input: 'CCO>>CC=O', key: 'k', count: 1, samples: [ORD] }], products: [], similar: [] }));
  assert.doesNotMatch(clean, /Bond-edit audit/);
});

test('disconnections: a flagged recorded preparation and a flagged recorded proposal carry the note', () => {
  const [brief] = evidence.normalizeDisconnections({ disconnections: [{
    input: 'CC=O', target: 'CC=O',
    madeBy: { reactions: [{ reaction: 'CCO>>CC=O', count: 3, auditFlags: ['unactivated C–X'] }] },
    proposals: [{ precursors: 'CCO', recorded: 3, available: true, auditFlags: ['reorganised skeleton'] }, { precursors: 'CC#N', recorded: 0, available: true }],
  }] });
  assert.match(brief.recordedRoutes[0].audit, /C–heteroatom bond forms at a carbon nothing activates/);
  assert.match(brief.proposals[0].audit, /carbon skeleton is reorganised/);
  assert.equal(brief.proposals[1].audit, undefined);
});

test('textbook citations: a flagged scheme stays cited, with its audit note', () => {
  const record = { key: 'k', book: 'Carey B', nodusId: 'X', page: 12, kind: 'crop', reagents: 'heat', yield: null, status: 'confirmed', reaction: 'C=CCC=C>>C1=CCCC1', audit: ['reorganised skeleton'] };
  const citation = textbook.textbookCitation('tb-' + 'b'.repeat(32), record);
  assert.deepEqual(citation.audit, ['reorganised skeleton']);
  assert.match(textbook.formatTextbookCitation(citation), /\*Carey B\*, p\. 12 · conditions: heat ⚑ Bond-edit audit/);
  const plain = textbook.textbookCitation('tb-' + 'c'.repeat(32), { ...record, audit: undefined });
  assert.equal(plain.audit, undefined);
  assert.doesNotMatch(textbook.formatTextbookCitation(plain), /audit/);
});
