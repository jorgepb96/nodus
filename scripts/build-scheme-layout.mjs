#!/usr/bin/env node
// Builds a scheme layout file for one or more PDFs (see electron/ai/schemeCleaning.ts):
// the pages' reaction-scheme, figure and margin lines, filed by page text. Passages built
// from those pages afterwards leave the lines out; the book text itself is not changed.
//
//   node scripts/build-scheme-layout.mjs <file.pdf> [...]   # writes <userData>/scheme-layout/<name>.json
//   node scripts/build-scheme-layout.mjs --out <dir> <file.pdf>
//
// Then rebuild the work's passages (Work status → rebuild passages) to apply it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outDir = outAt >= 0 ? args.splice(outAt, 2)[1] : path.join(os.homedir(), 'Library/Application Support/Nodus/scheme-layout');
if (!args.length) { console.error('usage: build-scheme-layout.mjs [--out dir] <file.pdf> [...]'); process.exit(2); }

installRuntimeHooks(fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-scheme-layout-')));
const { buildSchemeLayout } = require(path.join(repoRoot, 'electron/extraction/schemeSidecar.ts'));
fs.mkdirSync(outDir, { recursive: true });
for (const file of args) {
  const started = Date.now();
  const layout = await buildSchemeLayout(path.resolve(file));
  const name = `${path.basename(file, path.extname(file)).replace(/[^\w.-]+/g, '_').slice(0, 80)}-${createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 8)}.json`;
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(layout));
  const lines = Object.values(layout.pages).reduce((sum, page) => sum + page.scheme.length + page.margin.length, 0);
  console.log(`${path.basename(file)}: body ${layout.body} pt, ${Object.keys(layout.pages).length} pages with ${lines} lines → ${path.join(outDir, name)} (${Date.now() - started} ms)`);
}
