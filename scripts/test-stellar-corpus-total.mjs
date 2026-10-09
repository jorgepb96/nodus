// Paging the Stellar corpus must not re-run the full-corpus scans on every page: the COUNTs
// and the OFFSET queries push every visible edge through the eligibility filter (~0.5 s
// per page on a real library, rising to ~1.4 s at deep offsets, for ~580 pages).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the corpus is scanned once per database state, not once per page', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-stellar-total-'));
  try {
    const outfile = path.join(tmp, 'stellar.mjs');
    await build({
      entryPoints: [path.join(root, 'electron/graph/stellarService.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /\/db\/database$|\/vaults\/vaultRegistry$|^electron$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: args.path.endsWith('database')
          ? 'export const getDb = () => globalThis.__db;'
          : args.path === 'electron' ? 'export const app = {};' : 'export const getActiveVault = () => ({ id: "v", name: "V" });' }));
      } }],
    });
    const { stellarPage } = await import(pathToFileURL(outfile).href);
    let changes = 0, scans = 0;
    const ideaIds = Array.from({ length: 450 }, (_, i) => `g-${String(i).padStart(4, '0')}`);
    const edgeIds = Array.from({ length: 300 }, (_, i) => `e-${String(i).padStart(4, '0')}`);
    globalThis.__db = {
      pragma: () => 1,
      prepare(sql) {
        // A full-corpus scan: a COUNT, or an eligibility-filtered listing without a json_each id list.
        const fullScan = /COUNT\(\*\)/.test(sql) || (/ORDER BY (i\.global_id|e\.id)/.test(sql) && !/json_each/.test(sql));
        return {
          get() {
            if (/total_changes\(\)/.test(sql)) return { n: changes };
            if (fullScan) { scans += 1; return { n: /FROM visible_edges/.test(sql) ? edgeIds.length : ideaIds.length }; }
            return undefined;
          },
          all(...args) {
            if (fullScan) {
              scans += 1;
              const offset = /OFFSET/.test(sql) ? args.at(-1) : 0, limit = /LIMIT/.test(sql) ? args.at(-2) : Infinity;
              const ideas = /^SELECT i\.global_id/.test(sql);
              return (ideas ? ideaIds : edgeIds).slice(offset, offset + limit).map((id) => ideas ? { id } : { id, source: 'a', target: 'b' });
            }
            if (/json_each/.test(sql) && /visible_edges/.test(sql)) return JSON.parse(args[0]).map((id) => ({ id, source: 'a', target: 'b' }));
            return [];
          },
        };
      },
    };
    const seenEdges = [];
    for (const cursor of [0, 200, 400]) {
      const page = stellarPage({ kind: 'corpus', cursor, limit: 200 });
      assert.equal(page.total, 450);
      seenEdges.push(...page.edges.map((edge) => edge.id));
    }
    assert.deepEqual(seenEdges, edgeIds, 'every edge is paged exactly once, in id order');
    assert.equal(scans, 2, 'the corpus was scanned once (ideas + edges) for three pages');
    changes += 1; // a write on this connection invalidates the cached corpus
    stellarPage({ kind: 'corpus', cursor: 0, limit: 200 });
    assert.equal(scans, 4);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
