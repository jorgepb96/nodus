import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--concilium-test')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-concilium-test-'));
const ipc = new EventEmitter();
installRuntimeHooks(scratch, { ipcRenderer: ipc });
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('Network forbidden in Concilium regression tests'); };
const models = [{ provider: 'deepseek', model: 'deepseek-flash' }, { provider: 'gemini', model: 'gemini-2.5-flash-lite' }, { provider: 'opencode-go', model: 'mimo-v2.5' }];
const selection = { ideas: false, themes: false, contradictions: false, gaps: false, readingPath: false, authors: false, documents: false, passages: false, graph: false, graphParts: {} };
try {
  const { validateConcilium } = load('shared/researchConcilium.ts');
  for (const config of [{ models: models.slice(0, 1), chairman: 0 }, { models: [...models, ...models], chairman: 0 }, { models, chairman: 3 }, { models: [models[0], models[0]], chairman: 0 }, { models: [null, models[1]], chairman: 0 }]) assert.throws(() => validateConcilium(config));
  assert.equal(validateConcilium({ models: [...models, { provider: 'deepseek', model: 'mock-four' }, { provider: 'gemini', model: 'mock-five' }], chairman: 4 }).models.length, 5);
  load('electron/db/settingsRepo.ts').updateSettings({ synthesisModel: models[0], chatModel: models[0], promptLanguage: 'en', researchWebSearch: 'off' });
  const skills = load('electron/chatSkills.ts');
  for (const skill of skills.restoreChatSkills()) skills.saveChatSkill({ ...skill, enabled: { assistant: skill.builtin === 'svg', nodi: false } });
  const ai = load('electron/ai/aiClient.ts');
  ai.embedQuery = async () => null;
  let answerMode = 'constructive';
  ai.completeJson = async (_options, validate) => {
    const plan = { goal: 'Compose a fictional debate', queries: ['fictional debate'], authors: [], titles: [], explicitLibrary: false, kind: 'fact', answerMode };
    assert(validate(plan)); return plan;
  };
  const calls = [], executions = [];
  load('skill-capabilities/registry/main.ts').executeRegisteredChatSkills = async (answer, execution) => { executions.push(execution); return answer; };
  ai.completeTextStream = async (options, delta, model, signal) => {
    calls.push({ options, model });
    const synthesis = options.system.includes('You are the Concilium chairman.');
    if (synthesis) {
      assert.ok(models.every(m => options.user.includes(`Assessment from ${m.model}`)));
      delta('Verified consensus.'); return 'Verified consensus.';
    }
    delta('Independent reasoning.', 'reasoning');
    await new Promise(resolve => setTimeout(resolve, model.provider === 'gemini' ? 5 : 15));
    const answer = `Assessment from ${model.model}`;
    delta(answer); return answer;
  };
  const research = load('electron/ai/researchAssistant.ts');
  const request = { messages: [{ role: 'user', content: 'Compose a fictional debate.' }], selection, model: models[0], concilium: { models, chairman: 1 } };
  const snapshots = [], chat = [], activity = [];
  const response = await research.streamResearchChat(request, delta => chat.push(delta), undefined, update => snapshots.push(update), event => activity.push(event));
  assert.equal(response.concilium.status, 'complete');
  assert.equal(response.concilium.members.length, 3);
  assert.equal(calls.length, 4);
  const writes = activity.filter(event => event.layer === 'response' && event.operation === 'write');
  assert.equal(writes.filter(event => event.status === 'active').length, 4);
  assert.equal(writes.filter(event => event.status === 'completed').length, 4);
  assert.ok(models.every(model => writes.some(event => event.subject === model.model)), 'concurrent model operations identify the participating model');
  assert.equal(activity.filter(event => event.status === 'active').length, activity.filter(event => event.status !== 'active').length);
  const activityCount = activity.length;
  assert.deepEqual(chat, ['Verified consensus.'], 'member answers and reasoning never enter the main chat');
  assert.equal(executions.length, 1, 'only the chairman executes skills');
  assert.deepEqual(executions[0].model, models[1]);
  assert.equal(executions[0].skills.length, 0, 'academic corpus scope disables external skill tools, including the chairman');
  for (const call of calls.slice(0, 3)) {
    assert.match(call.options.system, /No skills or tools are available/);
    assert.equal(JSON.parse(call.options.user).application_output_contract, undefined);
    assert.doesNotMatch(call.options.system, /nodus-svg/);
  }
  assert.doesNotMatch(calls[3].options.system, /nodus-svg/);
  assert.ok(snapshots.some(s => s.members[1].status === 'complete' && s.members[0].status === 'thinking'), 'out-of-order completion is delivered live');
  const { SCHEMA_VERSION } = load('electron/db/migrations.ts');
  assert.equal(load('electron/db/database.ts').getDb().pragma('user_version', { simple: true }), SCHEMA_VERSION, 'Concilium migration matches the advertised schema version');
  const chats = load('electron/db/chatRepo.ts');
  const conversation = chats.createConversation({ model: models[1], selection });
  chats.saveMessages(conversation.id, [{ id: 'user', role: 'user', content: 'Question' }, { id: 'answer', role: 'assistant', content: response.answer, concilium: response.concilium }]);
  load('electron/db/database.ts').closeDb();
  assert.deepEqual(chats.getConversation(conversation.id).messages[1].concilium, response.concilium, 'all individual answers survive a database reopen');
  const { runConcilium } = load('electron/ai/researchConcilium.ts');
  let synthesis = 0;
  const partial = await runConcilium({ models, chairman: 0 }, async model => { if (model.provider === 'gemini') throw new Error('Provider unavailable'); return { answer: 'Evidence' }; }, async () => { synthesis++; return { answer: 'Partial consensus' }; });
  assert.equal(partial.concilium.members[1].status, 'error'); assert.equal(synthesis, 1);
  const failed = await runConcilium({ models, chairman: 0 }, async () => { throw new Error('Offline'); }, async () => { throw new Error('Must not synthesize'); });
  assert.equal(failed.concilium.status, 'error');
  const controller = new AbortController();
  const cancelled = await runConcilium({ models, chairman: 0 }, async () => { controller.abort(); return { answer: 'Partial assessment' }; }, async () => { throw new Error('Must not synthesize after cancellation'); }, undefined, controller.signal);
  assert.equal(cancelled.concilium.status, 'cancelled');
  assert.ok(cancelled.concilium.members.every(m => m.status === 'cancelled'));
  const failedUpdates = [];
  await assert.rejects(runConcilium({ models, chairman: 0 }, async () => ({ answer: 'Opinion' }), async () => { throw new Error('Chairman unavailable'); }, update => failedUpdates.push(update)));
  assert.equal(failedUpdates.at(-1).status, 'error');
  calls.length = 0; executions.length = 0;
  await research.streamResearchChat({ ...request, concilium: undefined }, () => {});
  assert.equal(activity.length, activityCount, 'a subsequent request without an observer cannot reach the previous observer');
  assert.equal(calls.length, 1, 'ordinary chat still makes one model call');
  assert.equal(executions.length, 1);
  // A documentary chairman cannot publish the members' opinions or its own
  // draft as factual evidence when the frozen corpus contains no passages.
  answerMode = 'documentary';
  const documentaryChat = [];
  const gap = await research.streamResearchChat({ ...request, messages: [{ role: 'user', content: 'Compare the evidence.' }] }, delta => documentaryChat.push(delta));
  assert.match(gap.answer, /cannot support an answer with the available excerpts/);
  assert.doesNotMatch(gap.answer, /Verified consensus|Assessment from/);
  assert(documentaryChat.every(delta => !delta.includes('Verified consensus')));
  const { academicApi } = load('electron/preload/academic.ts');
  const received = [];
  ipc.invoke = async (channel, id) => {
    assert.equal(channel, 'research:chatStream');
    ipc.emit('research:chatStream:concilium', {}, 'unrelated-request', response.concilium);
    ipc.emit('research:chatStream:concilium', {}, id, response.concilium);
    return response;
  };
  await academicApi.researchChatStream(request, { onDelta() {}, onConcilium: result => received.push(result) });
  assert.equal(received.length, 1, 'IPC ignores another request’s council events');
  assert.equal(ipc.listenerCount('research:chatStream:concilium'), 0, 'council subscription is removed on completion');
  ipc.invoke = async () => { throw new Error('IPC failure'); };
  await assert.rejects(academicApi.researchChatStream(request, { onDelta() {} }));
  assert.equal(ipc.listenerCount('research:chatStream:concilium'), 0, 'council subscription is removed on rejection');
  console.log('Concilium: bounds, duplicates, independent parallel streaming, chairman-only chat/skills, fan-in, persistence, partial/all failures, cancellation and ordinary chat passed. No network.');
} finally { load('electron/db/database.ts').closeDb(); fs.rmSync(scratch, { recursive: true, force: true }); }
