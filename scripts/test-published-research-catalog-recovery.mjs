import test from 'node:test';
import assert from 'node:assert/strict';
import { createCorpusRoutes } from '../server/lib/routes/corpus.mjs';

const report = id => ({ id, title: `Report ${id}`, brief_json: JSON.stringify({ kind: 'deep_research', objective: id }),
  draft_json: JSON.stringify({ title: id, draftMarkdown: `Persisted content ${id}` }) });

async function read(snapshot, suffix = '', headers = {}) {
  let status; let body;
  const routes = createCorpusRoutes({ readSnapshot: () => snapshot });
  const before = JSON.stringify(snapshot);
  const res = { writeHead(value) { status = value; }, end() {} };
  const answered = await routes.handle({ headers }, res, {
    json(_res, code, value) { status = code; body = value; },
    url: new URL(`https://example.test/api/v1/spaces/s1/deep-research${suffix}`),
    space: { id: 's1', revision: 'research-test' }, segments: ['deep-research', ...suffix.split('?')[0].split('/').filter(Boolean)],
  });
  assert.equal(answered, true);
  assert.equal(JSON.stringify(snapshot), before, 'reading and reporting damaged rows must preserve the exact published contents');
  return { status, body };
}

test('an unreadable research brief cannot appear as an empty published library', async () => {
  for (const brief_json of ['{broken', 'null', '[]', '42']) {
    const snapshot = { tables: { writing_saved_drafts: [{ ...report('broken'), brief_json }] } };
    const { status, body } = await read(snapshot);
    assert.equal(status, 422); assert.equal(body.error, 'invalid_saved_reports');
    assert.equal(Object.hasOwn(body, 'reports'), false, 'no success or empty catalogue envelope may accompany the error');
  }
});

test('damaged report content after the first page fails explicitly and can be repaired without dropping records', async () => {
  const drafts = Array.from({ length: 205 }, (_, i) => report(String(i)));
  const snapshot = { tables: { writing_saved_drafts: drafts } };
  const original = drafts[204].draft_json;
  for (const draft_json of ['{broken', 'null', '[]', '42']) {
    drafts[204].draft_json = draft_json;
    const list = await read(snapshot, '?limit=100');
    assert.equal(list.status, 422); assert.equal(list.body.error, 'invalid_saved_reports');
    const detail = await read(snapshot, '/204');
    assert.equal(detail.status, 422); assert.equal(detail.body.error, 'invalid_saved_reports');
    const document = await read(snapshot, '/204/document.html');
    assert.equal(document.status, 422); assert.equal(document.body.error, 'invalid_saved_reports');
  }
  drafts[204].draft_json = original;
  const pages = await Promise.all([0, 100, 200].map(offset => read(snapshot, `?limit=100&offset=${offset}`)));
  assert.ok(pages.every(page => page.status === 200 && page.body.total === 205));
  assert.deepEqual(pages.map(page => page.body.hasMore), [true, true, false]);
  assert.deepEqual(pages.flatMap(page => page.body.reports.map(row => row.id)), drafts.map(row => row.id));
  assert.equal((await read(snapshot, '/204')).body.report.draft.draftMarkdown, 'Persisted content 204');
});

test('a valid empty library and legacy research documents retain their existing response contracts', async () => {
  const empty = await read({ tables: { writing_saved_drafts: [] } });
  assert.equal(empty.status, 200); assert.deepEqual(empty.body.reports, []); assert.equal(empty.body.total, 0);
  const snapshot = { tables: { writing_saved_drafts: [report('legacy'), { ...report('writing'), brief_json: '{"kind":"section"}', draft_json: '{}' }] } };
  assert.deepEqual((await read(snapshot)).body.reports.map(row => row.id), ['legacy']);
  assert.equal((await read(snapshot, '/missing')).status, 404);
});
