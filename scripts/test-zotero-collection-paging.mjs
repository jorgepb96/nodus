// collectionItems must page a whole collection even when Zotero sends no Total-Results header.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('collection paging does not stop at 100 items without Total-Results', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-zotero-paging-'));
  const realFetch = globalThis.fetch;
  try {
    const out = path.join(temp, 'zotero.cjs');
    await build({ entryPoints: [path.join(root, 'electron/zotero/zoteroClient.ts')], outfile: out, bundle: true, format: 'cjs', platform: 'node', logLevel: 'error', external: ['electron', 'better-sqlite3'], tsconfig: path.join(root, 'tsconfig.json') });
    const { collectionItems } = createRequire(import.meta.url)(out);
    const TOTAL = 250;
    for (const withHeader of [true, false]) {
      globalThis.fetch = async (url) => {
        const u = new URL(url); const start = Number(u.searchParams.get('start')); const limit = Number(u.searchParams.get('limit'));
        const page = Array.from({ length: Math.max(0, Math.min(limit, TOTAL - start)) }, (_, i) => ({ key: `K${start + i}`, data: { key: `K${start + i}`, itemType: 'book', title: 't', collections: ['C1'] } }));
        return new Response(JSON.stringify(page), { status: 200, headers: withHeader ? { 'Total-Results': String(TOTAL) } : {} });
      };
      const items = await collectionItems('0', 'C1');
      assert.equal(items.length, TOTAL, `header ${withHeader ? 'present' : 'absent'}`);
    }
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
