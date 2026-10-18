import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-audit-batching')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-audit-batching-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const ai = load('electron/ai/aiClient.ts');
const original = ai.completeJson;
const model = { provider: 'deepseek', model: 'deepseek-flash' };
const sentences = Array.from({ length: 8 }, (_, i) => `Plot ${i + 1} measured ${20 + i} units.`);
const sources = [{ id: 'source', text: sentences.join(' '), label: 'Synthetic field record', citation: 'nodus://passage/source' }];
const verdict = ({ index, text }) => ({ index, kind: 'fact', premises: [{ text, type: 'fact', entailed: true, evidence: [{ id: 'source-1', quote: text }], from: [] }], unsupportedParts: [], explicitInference: false, supported: true, reason: 'literal source' });
const calls = [];
let behavior;
ai.completeJson = async (options, guard, selected) => {
  const input = JSON.parse(options.user);calls.push(input);
  assert.deepEqual(selected, model);
  assert.deepEqual(input.sources, [{ ...sources[0], id: 'source-1' }], 'every split uses the exact same request-local source alias');
  assert.equal(options.maxTokens, 6000);
  assert.equal(options.noRetry, true);
  assert.deepEqual(input.sentences.map(s => s.index), input.sentences.map((_, i) => i));
  for (const s of input.sentences) { const index = sentences.indexOf(s.text);assert.equal(s.context, index > 0 ? sentences[index - 1] : ''); }
  return behavior(input, options);
};
try {
  const { auditResearchProse } = load('electron/ai/researchClaimAudit.ts');
  const { withJobThinkingEffort } = load('electron/ai/thinkingEffort.ts');
  const truncated = () => new ai.AiError('fixture output limit', true, false, 'output_truncated');
  behavior = input => { if (input.sentences.length > 2) throw truncated();return { claims: input.sentences.map(verdict) }; };
  let result = await auditResearchProse(sentences.join(' '), sources, model);
  assert.deepEqual(calls.map(c => c.sentences.length), [8, 4, 2, 2, 4, 2, 2], 'oversized batches bisect instead of repeating the same failed request');
  assert.equal(result.claims.length, 8);
  assert.deepEqual(result.claims.map(c => c.premises[0].text), sentences, 'split verdicts stay attached to their original sentences');
  assert.ok(result.claims.every(c => c.status === 'supported'));
  assert.ok(result.claims.every(c => c.evidence[0].id === 'source'), 'every split verdict restores the canonical source identity');
  for (const s of sentences) assert.ok(result.markdown.includes(s), 'all original positions survive reindexing');

  calls.length = 0;
  behavior = input => ({ claims: input.sentences.map(verdict) });
  await withJobThinkingEffort('low', model, () => auditResearchProse(sentences.join(' '), sources, model));
  assert.deepEqual(calls.map(c => c.sentences.length), [4, 4], 'thinking starts with smaller batches');
  calls.length = 0;
  await withJobThinkingEffort('standard', model, () => auditResearchProse(sentences.join(' '), sources, model));
  assert.deepEqual(calls.map(c => c.sentences.length), [8], 'Standard retains its normal batch size');

  calls.length = 0;
  behavior = input => ({ claims: input.sentences.filter((_, i) => calls.length > 1 || i !== 3).map(verdict) });
  result = await auditResearchProse(sentences.join(' '), sources, model);
  assert.deepEqual(calls.map(c => c.sentences.length), [8, 1], 'valid verdicts are not purchased again');
  assert.equal(calls[1].sentences[0].text, sentences[3]);
  assert.ok(result.claims.every(c => c.status === 'supported'));

  calls.length = 0;
  behavior = () => { throw truncated(); };
  result = await auditResearchProse(sentences.slice(0, 2).join(' '), sources, model);
  assert.deepEqual(calls.map(c => c.sentences.length), [2, 1, 1], 'single sentences are never bisected or retried after truncation');
  assert.equal(result.markdown, '');
  assert.ok(result.claims.every(c => c.status === 'unverified'), 'a failed judge cannot approve a claim');

  calls.length = 0;
  const controller = new AbortController();
  behavior = () => { controller.abort();throw truncated(); };
  await assert.rejects(auditResearchProse(sentences.join(' '), sources, model, controller.signal), { name: 'AbortError' });
  assert.equal(calls.length, 1, 'cancellation prevents any split or retry');
  console.log('Audit batching: bounded truncation recovery, original contexts and indices, unresolved-only retry, thinking batch size, conservative exhaustion and cancellation passed.');
} finally {
  ai.completeJson = original;
  fs.rmSync(root, { recursive: true, force: true });
}
