// One page linking outside the export (root-relative, or `..` above the ZIP root) must not
// abort a whole Notion import.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

test('dead links outside the ZIP become notices, not a failed import', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-notion-links-'));
  try {
    const stub = path.join(temp, 'stub.cjs');
    fs.writeFileSync(stub, `let n=0;module.exports={getDb:()=>({transaction:(fn)=>fn}),createDatabaseFromCsv:()=>({id:'d'}),listRows:()=>[],createPage:()=>({page:{id:'p'+(++n)}}),getPageDocumentForRow:()=>null,replacePageFromMarkdown:()=>({ok:true}),storePageAsset:()=>({blobHash:'h'})};`);
    const out = path.join(temp, 'notion.cjs');
    await build({ entryPoints: [path.join(root, 'electron/import/notionZipImport.ts')], outfile: out, bundle: true, format: 'cjs', platform: 'node', logLevel: 'error', external: ['electron', 'better-sqlite3'], tsconfig: path.join(root, 'tsconfig.json'),
      plugins: [{ name: 'stub', setup(b) { b.onResolve({ filter: /\/db\/(database|databasesRepo|pagesRepo)$/ }, () => ({ path: stub })); } }] });
    const { importNotionZip } = require(out);
    for (const body of ['# Home\n\nSee [docs](/docs/intro) for more.', '# Home\n\n![up](../shared.png)']) {
      const zip = new AdmZip();
      zip.addFile(`Home ${'d'.repeat(32)}.md`, Buffer.from(body));
      zip.addFile(`Other ${'e'.repeat(32)}.md`, Buffer.from('# Other page'));
      const file = path.join(temp, 'export.zip'); zip.writeZip(file);
      const result = importNotionZip(file);
      assert.equal(result.pages, 2, `${body} imports both pages`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
