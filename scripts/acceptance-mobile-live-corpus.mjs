import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-mobile-live')) process.exit(0);
const lab = process.env.NODUS_MOBILE_ACCEPTANCE_LAB;
if (!lab || !fs.existsSync(path.join(lab, '.nodus-mobile-acceptance-lab'))) throw new Error('An isolated lab with its marker is required. Missing configuration is a failure.');
const metadata = JSON.parse(fs.readFileSync(path.join(lab, '.nodus-mobile-acceptance-lab'), 'utf8'));
assert.equal(metadata.sourceDesktopCommit, '0a173fd9c698a7cb2d5989aa64b59cddd329bcf9');
installRuntimeHooks(lab);
const require = createRequire(import.meta.url);
const { serveLiveCorpus } = require('../electron/desktopBridge/liveCorpus.ts');
const { getVault, listVaults } = require('../electron/vaults/vaultRegistry.ts');
const { MOBILE_OPERATIONS } = require('../shared/mobileOperations.ts');
assert.ok(!Object.hasOwn(MOBILE_OPERATIONS, 'extractDocuments'));
assert.ok(Object.hasOwn(MOBILE_OPERATIONS, 'createManualIdea'), 'Authored ideas are permitted without document extraction or indexing.');
assert.ok(!Object.hasOwn(MOBILE_OPERATIONS, 'startBrowser'));
assert.ok(!Object.hasOwn(MOBILE_OPERATIONS, 'rebuildManualIndex'));
assert.ok(listVaults().every(vault => path.resolve(vault.path).startsWith(path.resolve(lab) + path.sep)), 'Every database must be isolated.');

async function query(segments, params = {}) {
  const url = new URL('https://bridge.invalid/bridge/v2/vaults/default/corpus/' + segments.join('/'));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let status = 0, bytes;
  const response = { setHeader() {}, writeHead(value) { status = value; }, end(value) { bytes = value; } };
  await serveLiveCorpus({ method: 'GET', headers: {} }, response, url, 'default', segments);
  assert.equal(status, 200, `Route ${segments.join('/')} must load`);
  return { bytes, value: JSON.parse(String(bytes)) };
}
const overview = (await query([])).value;
assert.equal(overview.vault.id, getVault('default').id);
assert.equal(overview.counts.writing_saved_drafts >= 28, true);
let offset = 0, reports = [], total;
do {
  const page = (await query(['deep-research'], { limit: 7, offset })).value;
  total = page.total; assert.equal(page.offset, offset);
  reports.push(...page.reports);
  if (!page.hasMore) break;
  assert.ok(page.reports.length > 0, 'Pagination must make progress'); offset += page.reports.length;
} while (true);
assert.ok(reports.length >= 28, 'The original 28 reports must remain available alongside reports generated in the isolated lab.');
assert.equal(reports.length, total);
for (const report of reports) {
  const detail = (await query(['deep-research', report.id])).value;
  assert.equal(detail.report.id, report.id);
  assert.ok(detail.report.draft, 'A saved report must include its structured document');
  assert.ok(Array.isArray(detail.translations));
  assert.ok(Array.isArray(detail.annotations));
}
console.log(JSON.stringify({ result: 'passed', vaultId: 'default', reports: reports.length, pagination: '7-per-page', details: reports.length,
  referenceCommits: { desktop: metadata.sourceDesktopCommit, mobile: metadata.sourceMobileCommit }, validation: 'Live corpus projection on isolated real vault copies. TLS, UI and generation require separate tests.' }));
process.exit(0);
