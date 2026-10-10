import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--svg-output-budget')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-svg-budget-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const sent = [];
const reply = '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><text x="20" y="40">Fixed</text></svg>\n```';
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => raw += chunk);
  req.on('end', () => {
    const body = JSON.parse(raw);
    sent.push(body);
    const provider = req.url.endsWith('/messages') ? 'anthropic' : 'openai';
    const ceiling = load('shared/providerContextWindows.ts').documentedMaxOutput(provider, body.model) ?? 10000;
    assert.ok(body.max_tokens <= ceiling, `incompatible output request: ${body.model}/${body.max_tokens} > ${ceiling}`);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(provider === 'anthropic'
      ? { content: [{ type: 'text', text: reply }], stop_reason: 'end_turn' }
      : { choices: [{ message: { content: reply }, finish_reason: 'stop' }] }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/v1`;
try {
  const settings = load('electron/db/settingsRepo.ts');
  load('electron/secrets/secretStore.ts').getApiKey = () => 'fixture-key';
  load('electron/ai/providers.ts').openAiCompatBase = () => base;
  process.env.ANTHROPIC_BASE_URL = base;
  // Any production fetch that bypasses the SDK's local base must also stay local.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    assert.equal(new URL(input).origin, new URL(base).origin);
    return originalFetch(input, options);
  };
  const { DEFAULT_CHAT_SKILLS, splitChatVisuals } = load('shared/chatSkills.ts');
  // Only font/layout inspection is simulated. Budgeting, default-model resolution,
  // completion and provider request serialization all use the production modules.
  const sandbox = load('electron/ai/svgSandboxWindow.ts');
  let inspections = 0;
  sandbox.evaluateInSvgSandbox = async () => inspections++ === 0 ? ['Overlapping labels'] : [];
  const repaired = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><text x="20" y="40">Fixed</text></svg>';
  const { refineChatSvg } = load('electron/ai/chatSvgQuality.ts');
  const drawing = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><!--' + 'x'.repeat(100000) + '--><text>Original</text></svg>';
  const answer = 'Explanation.\n```svg\n' + drawing + '\n```';
  const known = { provider: 'openai', model: 'gpt-4o' };
  const unknown = { provider: 'openai', model: 'unknown-model' };
  const cases = [
    { model: known, effective: known, tokens: 16384 },
    { model: { ...known, model: 'gpt-4o-2024-08-06' }, effective: { ...known, model: 'gpt-4o-2024-08-06' }, tokens: 16384 },
    { model: unknown, effective: unknown, tokens: 10000 },
    { model: undefined, effective: known, tokens: 16384 },
    { model: null, effective: known, tokens: 16384 },
    { model: { provider: 'openai', model: '' }, effective: known, tokens: 16384 },
    { model: undefined, effective: unknown, tokens: 10000 },
    { model: { provider: 'anthropic', model: 'claude-opus-5' }, effective: { provider: 'anthropic', model: 'claude-opus-5' }, tokens: Math.ceil(drawing.length / 2.5) + 2000 },
  ];
  for (const item of cases) {
    inspections = 0;
    settings.updateSettings({ synthesisModel: item.effective });
    const before = sent.length;
    const result = await refineChatSvg(answer, { question: 'Repair the diagram', skills: DEFAULT_CHAT_SKILLS, model: item.model, maxRepairs: 1 });
    assert.equal(sent.length, before + 1, 'the simulated transport received the repair');
    assert.equal(sent.at(-1).model, item.effective.model);
    assert.equal(sent.at(-1).max_tokens, item.tokens);
    assert.equal(splitChatVisuals(result).find(part => part.kind === 'svg').content, repaired);
    assert.match(result, /Explanation/);
  }
  // The default can change at the beforeRepair boundary. Sizing and dispatch must
  // still use the SAME effective model frozen before that callback.
  inspections = 0;
  settings.updateSettings({ synthesisModel: known });
  await refineChatSvg(answer, { question: 'Repair', skills: DEFAULT_CHAT_SKILLS, maxRepairs: 1,
    beforeRepair: () => settings.updateSettings({ synthesisModel: unknown }) });
  assert.equal(sent.at(-1).model, 'gpt-4o');
  assert.equal(sent.at(-1).max_tokens, 16384);
  inspections = 0;
  settings.updateSettings({ synthesisModel: null });
  const before = sent.length;
  const unresolved = await refineChatSvg(answer, { question: 'Repair', skills: DEFAULT_CHAT_SKILLS, maxRepairs: 1 });
  assert.equal(sent.length, before, 'a missing effective model cannot dispatch an unsized repair');
  assert.equal(splitChatVisuals(unresolved).find(part => part.kind === 'svg').content, drawing, 'a failed optional repair keeps the original');
  console.log('SVG output: known ceilings, unknown limits, default resolution and frozen dispatch passed.');
} finally {
  await new Promise(resolve => server.close(resolve));
  load('electron/db/database.ts').closeDb();
  fs.rmSync(scratch, { recursive: true, force: true });
}
