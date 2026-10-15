import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { connectAcceptanceBridge } from './lib/mobileAcceptanceClient.mjs';

const client = await connectAcceptanceBridge('Mobile library acceptance');
try {
  const summary = await client.request(`${client.root}/corpus/library`);
  assert(summary.documents > 0 && summary.downloadableDocuments > 0, 'Reading fixtures are required');
  const page = await client.request(`${client.root}/corpus/library/documents?limit=1&offset=0`);
  assert(page.items.length && page.items[0].annotations, 'The native catalogue contract requires annotations');
  const id = page.items.find(item => item.id === 'nodus:acceptance-report')?.id ?? 'nodus:acceptance-report';
  const detail = await client.request(`${client.root}/corpus/library/documents/${encodeURIComponent(id)}`);
  assert(detail.document.packageHash && detail.document.originalAvailable && detail.document.cleanAvailable);
  const bytes = await client.binary(`${client.root}/corpus/library/documents/${encodeURIComponent(id)}/download.zip`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), detail.document.packageHash);
  const zip = new AdmZip(bytes);
  assert(zip.readAsText('document.md').length > 1_000);
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  assert.equal(zip.readFile(manifest.original.path).subarray(0, 5).toString(), '%PDF-');
  const capabilities = await client.request('/bridge/v2/capabilities');
  assert.equal(new Set(capabilities.vaults.map(vault => vault.type)).size, 9);
  const other = capabilities.vaults.find(vault => vault.id !== client.vault.id);
  await client.request(`/bridge/v2/vaults/${encodeURIComponent(other.id)}/corpus/library/documents/${encodeURIComponent(id)}`, 'GET', undefined, 404);
  console.log(JSON.stringify({ executed: 1, passed: 1, skipped: 0, failed: 0, checks: { types: 9, cleanMarkdown: true, pdf: true, contentHash: true, scopedLibrary: true } }));
} finally { await client.close(); }
