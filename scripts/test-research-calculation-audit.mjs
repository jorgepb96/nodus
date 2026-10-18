import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-calculation-audit')) process.exit(0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-calculation-audit-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const ai = load('electron/ai/aiClient.ts');
const original = ai.completeJson;
const shared = load('shared/researchClaimAudit.ts');
const { auditResearchProse } = load('electron/ai/researchClaimAudit.ts');
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/research-audit/r007-calculation.json', import.meta.url)));
const markdown = fixture.input.sentences.map(s => s.text).join('\n');
const sources = fixture.input.sources.map(source => ({ ...source, id: decodeURIComponent(source.citation.split('nodus://passage/')[1]) }));
const transport = shared.researchAuditSourceTransport(sources);
const calc = fixture.input.sentences[1].text;
let calls;
async function run(first, retry = claim => ({ ...claim, index: 0, explicitInference: true }), prose = markdown) {
  calls = [];
  ai.completeJson = async (options, guard) => {
    const input = JSON.parse(options.user); calls.push(input);
    assert.ok(guard({ claims: [] }));
    if (calls.length === 1) return structuredClone(first);
    assert.equal(calls.length, 2, 'at most one bounded consistency retry');
    assert.deepEqual(input.sentences.map(s => s.index), [0]);
    assert.match(input.verdictSchemaRepair.errors[0], /inference_label/);
    assert.deepEqual(input.sources, transport.sources, 'same evidence on the retry');
    return { claims: [retry(structuredClone(first.claims[1]))] };
  };
  return auditResearchProse(prose, sources, { provider: 'custom', model: 'qa-replay' });
}
try {
  const baseline = shared.applyResearchProseVerdicts(markdown, sources,
    shared.normalizeResearchProseVerdicts(transport.restore(fixture.verdict), fixture.input.sentences.length, sources));
  assert.equal(baseline.claims[1].failure, 'unqualified_inference');
  assert.ok(!baseline.markdown.includes('21 puntos porcentuales'), 'exact recorded verdict reproduces the historical loss');
  let result = await run(fixture.verdict);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].sentences[0].text, calc, 'only the contradictory calculation verdict is re-audited');
  assert.ok(result.markdown.includes(calc), 'a fresh consistent approval preserves the original calculation and citation');
  assert.equal(result.claims[1].status, 'supported');
  assert.ok(result.claims[1].evidence.every(e => e.id === sources[3].id), 'canonical source restored before acceptance');
  assert.deepEqual(result.claims.filter((_, i) => i !== 1), baseline.claims.filter((_, i) => i !== 1));

  result = await run(fixture.verdict, claim => ({ ...claim, index: 0 }));
  assert.equal(calls.length, 2); assert.ok(!result.markdown.includes('21 puntos porcentuales'), 'repeated contradictory metadata never auto-passes');
  result = await run(fixture.verdict, claim => ({ ...claim, index: 0, supported: false, explicitInference: true,
    unsupportedParts: ['a favor de la recuperación espaciada'] }));
  assert.ok(!result.markdown.includes('21 puntos porcentuales'), 'independent rejection stays rejected');
  result = await run(fixture.verdict, () => { throw new Error('unavailable auditor'); });
  assert.ok(!result.markdown.includes('21 puntos porcentuales'), 'failed retry stays unverified');

  for (const mutate of [
    claim => { claim.premises[0].evidence[0].quote = 'A fabricated quote not present in any source.'; },
    claim => { claim.premises[2].from = []; },
    claim => { claim.premises[0].entailed = false; },
    claim => { claim.unsupportedParts = ['an unsupported causal assertion']; },
    claim => { claim.supported = false; },
  ]) {
    const verdict = structuredClone(fixture.verdict); mutate(verdict.claims[1]);
    result = await run(verdict);
    assert.equal(calls.length, 1, 'invalid support is not repaired as a label contradiction');
    assert.ok(!result.markdown.includes('21 puntos porcentuales'));
  }
  result = await run(fixture.verdict, undefined, markdown.replace('Cálculo: ', ''));
  assert.equal(calls.length, 1, 'unlabelled inference is still withheld without this retry');
  assert.ok(!result.markdown.includes('21 puntos porcentuales'));
  console.log('Recorded R007: baseline loss reproduced; bounded fresh label audit preserves arithmetic only on independent approval; literal evidence, inference dependencies, rejection and exhaustion remain strict. No model calls.');
} finally { ai.completeJson = original; fs.rmSync(root, { recursive: true, force: true }); }
