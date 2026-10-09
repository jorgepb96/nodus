import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

// The integral run's @SVG Studio answer was cut at 6,000 tokens: the academic chat always
// knows its model's window, and that branch capped every answer at 6,000, skills or not.
test('an answer with invoked skills keeps its larger allowance when the window is known', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-answer-tokens-'));
  try {
    await build({ entryPoints: ['shared/researchRetrievalBudget.ts'], outfile: path.join(root, 'budget.cjs'), bundle: true, platform: 'node', format: 'cjs' });
    const { researchAnswerTokens } = require(path.join(root, 'budget.cjs'));
    assert.equal(researchAnswerTokens(null, false), 8000, 'prose drawn from several sources carries long citation links');
    assert.equal(researchAnswerTokens(null, true), 10_000);
    assert.equal(researchAnswerTokens(131_072, false), 8000);
    assert.equal(researchAnswerTokens(131_072, true), 10_000, 'a large window does not shrink a skill answer to the prose allowance');
    assert.equal(researchAnswerTokens(8192, true), Math.floor((8192 - 410) * 0.3), 'a small window still bounds it');
    assert.equal(researchAnswerTokens(512, true), 320);
    const assistant = fs.readFileSync(path.join(import.meta.dirname, '../electron/ai/researchAssistant.ts'), 'utf8');
    assert.match(assistant, /maxTokens = researchAnswerTokens\(window, skills\.length > 0, documentedMaxOutput\(model\.provider, model\.model\)\)/,
      'the chat uses it, and passes the model\'s own output ceiling');

    // A long answer needs output in proportion to the window, not a flat figure. A route written
    // as one short step per stage was cut off at 10,000 tokens and the run could go no further.
    assert.equal(researchAnswerTokens(1_000_000, true, 128_000), 80_000,
      'a 1M window with a 128K ceiling gets its share of the window, not the flat figure');
    assert.equal(researchAnswerTokens(1_000_000, false, 128_000), 60_000, 'prose takes the smaller share');

    // The safety property: a model whose ceiling is not documented keeps exactly what it had.
    // A max_tokens above what a model will emit is rejected by the provider, not trimmed, so an
    // unknown ceiling must never be guessed upward.
    assert.equal(researchAnswerTokens(1_000_000, true), 10_000, 'an unknown ceiling keeps the flat allowance');
    assert.equal(researchAnswerTokens(1_000_000, true, null), 10_000, 'and so does an explicit null');

    // The ceiling binds when it is smaller than the share.
    assert.equal(researchAnswerTokens(1_000_000, true, 16_000), 16_000, 'the model ceiling wins over the share');
    // What fits beside the prompt still binds on a small window, ceiling or not.
    assert.equal(researchAnswerTokens(8192, true, 128_000), Math.floor((8192 - 410) * 0.3),
      'a small window bounds it however large the model ceiling is');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the documented output ceiling is recorded only where it is sourced', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-max-output-'));
  try {
    await build({ entryPoints: ['shared/providerContextWindows.ts'], outfile: path.join(root, 'windows.cjs'), bundle: true, platform: 'node', format: 'cjs' });
    const { documentedMaxOutput, documentedContextWindow } = require(path.join(root, 'windows.cjs'));
    assert.equal(documentedMaxOutput('anthropic', 'claude-opus-5'), 128_000);
    assert.equal(documentedMaxOutput('anthropic', 'claude-opus-4-8'), 128_000);
    // Recorded where the provider publishes it: DeepSeek documents a 384K output ceiling beside
    // its 1M window. An ABSENT ceiling is not neutral — the answer budget falls back to its flat
    // figure, which pinned every provider without an entry at 10,000 output tokens however large
    // its window, and cut a reply off mid-answer on a model holding a million tokens of context.
    assert.equal(documentedMaxOutput('deepseek', 'deepseek-flash'), 384_000);
    // Not recorded is still null, never a guess: the caller then keeps its conservative default.
    assert.equal(documentedMaxOutput('anthropic', 'claude-made-up-9'), null);
    assert.equal(documentedMaxOutput('deepseek', 'deepseek-made-up-9'), null);
    // The output ceiling is a different limit from the window and must not be confused with it.
    assert.equal(documentedContextWindow('anthropic', 'claude-opus-5'), 1_000_000);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the answer budget plus its thinking reserve stays inside what the model will emit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-output-clamp-'));
  try {
    // The reserve is added ON TOP of the answer budget, so the two together could exceed the
    // model's own output ceiling — and a max_tokens above that ceiling is rejected outright, not
    // trimmed. At `high` the reserve is 65,536 tokens and at `max` it is 131,072, so the sum
    // could pass a 128,000-token ceiling before the answer budget was allowed to scale at all.
    await build({ entryPoints: ['shared/researchRetrievalBudget.ts'], outfile: path.join(root, 'budget.cjs'), bundle: true, platform: 'node', format: 'cjs' });
    const { withinModelOutput } = require(path.join(root, 'budget.cjs'));
    assert.equal(withinModelOutput(96_384, 'anthropic', 'claude-opus-5'), 96_384, 'a sum inside the ceiling is untouched');
    assert.equal(withinModelOutput(141_072, 'anthropic', 'claude-opus-5'), 128_000, 'a sum past the ceiling is held at it');
    assert.equal(withinModelOutput(128_000, 'anthropic', 'claude-opus-5'), 128_000, 'the ceiling itself is allowed');
    // A model whose ceiling is not recorded is left alone rather than guessed at.
    assert.equal(withinModelOutput(141_072, 'deepseek', 'deepseek-flash'), 141_072);
    assert.equal(withinModelOutput(141_072, 'anthropic', 'claude-made-up-9'), 141_072);
    assert.equal(withinModelOutput(42_043, 'openai', 'gpt-4o'), 16_384);
    assert.equal(withinModelOutput(42_043, 'openai', 'unknown-model', 10_000), 10_000,
      'content-sized requests supply a conservative fallback for unrecorded ceilings');
    assert.equal(withinModelOutput(8000, 'openai', 'unknown-model', 10_000), 8000);
    // And the call site applies it to the sum, not to the answer budget alone.
    const generation = fs.readFileSync(path.join(import.meta.dirname, '../electron/ai/researchGenerationOptions.ts'), 'utf8');
    assert.match(generation, /withinModelOutput\(maxTokens \+ thinkingOutputAllowance\(/, 'the clamp wraps the sum');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the budget can be asked before a row is written', async () => {
  // A receipt has to be written before its id exists, so the budget was consulted second and a
  // refused passage had already consumed a receipt row — the receipt count then no longer
  // equalled the evidence used. Asking first costs nothing and keeps the two in step.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-would-accept-'));
  try {
    await build({ entryPoints: ['shared/researchRetrievalBudget.ts'], outfile: path.join(root, 'b.cjs'), bundle: true, platform: 'node', format: 'cjs' });
    const { ResearchRetrievalBudget } = require(path.join(root, 'b.cjs'));
    const budget = new ResearchRetrievalBudget({ preset: 'custom', rounds: 2, candidates: 4, passagesPerRound: 2,
      evidenceTokens: 256, decisionTokens: 256, autoExpand: false, threshold: { mode: 'automatic' } }, 300, 300);
    assert.equal(budget.wouldAccept('x'.repeat(200)), true, 'it fits');
    assert.equal(budget.usedEvidenceTokens, 0, 'and asking reserves nothing');
    assert.equal(budget.partial, false, 'nor does it mark the run partial');
    assert.equal(budget.accept('a', 'x'.repeat(200)), true);
    assert.equal(budget.usedEvidenceTokens, 200, 'accepting does reserve');
    assert.equal(budget.wouldAccept('y'.repeat(200)), false, 'the next one would not fit');
    assert.equal(budget.accept('b', 'y'.repeat(200)), false, 'and accepting it is refused');
    assert.equal(budget.accept('a', 'x'.repeat(5)), false, 'a duplicate id is still refused by accept, not by the check');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
