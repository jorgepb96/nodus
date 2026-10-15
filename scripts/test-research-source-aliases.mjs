import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--source-aliases')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-source-aliases-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('Network forbidden in source routing regressions'); };
const shared = load('shared/researchClaimAudit.ts');
const ai = load('electron/ai/aiClient.ts');
const audit = load('electron/ai/researchClaimAudit.ts');
const source = { id: `documentary:${'a'.repeat(64)}:${'b'.repeat(64)}:0`, label: 'Survey',
  citation: `nodus://passage/${encodeURIComponent(`documentary:${'a'.repeat(64)}:${'b'.repeat(64)}:0`)}`,
  text: 'Verbatim excerpt:\nThe sensor measures turbidity with green light at 530 nm.' };
const original = structuredClone(source);
const transport = shared.researchAuditSourceTransport([source]);
assert.equal(transport.sources[0].id, 'source-1');
assert.equal(transport.sources[0].text, source.text);
assert.equal(transport.sources[0].citation, source.citation, 'routing labels do not alter canonical citations');
const verdict = id => ({ claims: [{ index: 0, kind: 'fact', supported: true, explicitInference: false, unsupportedParts: [], reason: 'Literal fixture.',
  premises: [{ text: 'The sensor uses green light at 530 nm.', type: 'fact', entailed: true, from: [],
    evidence: [{ id, quote: 'The sensor measures turbidity with green light at 530 nm.' }] }] }] });
const raw = verdict('source-1');
const restored = transport.restore(raw);
assert.equal(restored.claims[0].premises[0].evidence[0].id, source.id);
assert.equal(raw.claims[0].premises[0].evidence[0].id, 'source-1', 'raw model output is preserved');
assert.equal(transport.restore(verdict('source-9')).claims[0].premises[0].evidence[0].id, 'source-9', 'unknown aliases are never guessed');
const collisions = shared.researchAuditSourceTransport([{ ...source, id: 'source-1' }, { ...source, id: '_source-2' }]);
assert.ok(collisions.sources.every(row => !['source-1', '_source-2'].includes(row.id)), 'alias namespace cannot collide with original source IDs');
assert.deepEqual(collisions.bindings.map(row => row.sourceId), ['source-1', '_source-2']);

try {
  for (const mode of ['valid', 'unknown-alias', 'invented-quote', 'rejected-premise']) {
    let calls = 0;
    ai.completeJson = async (options, validate) => {
      calls++;
      const input = JSON.parse(options.user);
      assert.equal(input.sources[0].id, 'source-1', 'the production auditor sends short request-local IDs');
      assert.equal(input.sources[0].text, source.text);
      const value = verdict(mode === 'unknown-alias' ? 'source-99' : input.sources[0].id);
      if (mode === 'invented-quote') value.claims[0].premises[0].evidence[0].quote = 'The sensor measures oxygen with blue light at 400 nm.';
      if (mode === 'rejected-premise') {
        value.claims[0].premises[0].entailed = false;
        value.claims[0].supported = false;
      }
      assert.equal(validate(value), true);
      return value;
    };
    const result = await audit.auditResearchProse('The sensor uses green light at 530 nm.', [source], null);
    assert.equal(calls, 1);
    assert.equal(result.claims[0].status, mode === 'valid' ? 'supported' : 'removed', `${mode}: routing cannot approve unsupported evidence`);
    if (mode === 'valid') {
      assert.equal(result.claims[0].evidence[0].id, source.id, 'published audit identities remain canonical');
      assert.ok(result.markdown.includes(source.citation));
    }
    assert.deepEqual(source, original, 'source snapshot remains immutable');
  }
  console.log('Research source aliases: exact routing, collision avoidance, immutable raw output and full production literal/semantic gates passed.');
} finally {
  load('electron/db/database.ts').closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}
