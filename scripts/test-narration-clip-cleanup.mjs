// Narrated content must not outlive the item it belongs to. Saved clips are a WAV file
// plus a row in audio_clips; deleting a conversation, a saved report, an immersion or a
// dictionary entry has to remove both. This drives the real repositories and audio service
// against a migrated vault, so a future delete that forgets the cleanup fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-narration-clip-cleanup')) process.exit(0);

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-narration-cleanup-'));
const require = createRequire(import.meta.url);
installRuntimeHooks(root);
const load = (file) => require(path.join(repoRoot, file));

function wav(sampleRate = 24000) {
  const data = Buffer.alloc(2400); // 50 ms of silence, enough for a real duration.
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii'); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii'); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

try {
  const vaults = load('electron/vaults/vaultRegistry.ts');
  const vault = vaults.createVault('Narration cleanup');
  vaults.setActiveVault(vault.id);

  const db = load('electron/db/database.ts').getDb();
  const audio = load('electron/audio/audioService.ts');
  const { audioFilePath } = load('electron/audio/audioPaths.ts');
  const chats = load('electron/db/chatRepo.ts');
  const reports = load('electron/db/writingDraftsRepo.ts');
  const immersion = load('electron/db/immersionRepo.ts');
  const dictionary = load('electron/db/dictionaryRepo.ts');

  const save = (kind, id) => audio.saveClip(kind, id, {
    segmentIndex: 0,
    segmentLabel: 'Fragmento 1',
    provider: 'ming',
    voice: 'cc0:es-dave',
    language: 'es',
    modelId: 'ming3-0.5b-mlx-8bit',
    bytes: wav(),
  });
  const rows = (kind, id) => db.prepare('SELECT COUNT(*) AS n FROM audio_clips WHERE entity_kind = ? AND entity_id = ?').get(kind, id).n;
  const assertClipsGone = (label, kind, id, clip) => {
    assert.equal(rows(kind, id), 0, `${label}: audio_clips row removed`);
    assert.equal(fs.existsSync(audioFilePath(clip.fileName)), false, `${label}: WAV removed`);
  };

  // ── Conversation ─────────────────────────────────────────────────────────────
  const conversation = chats.createConversation({ title: 'Charla con narración' });
  chats.saveMessages(conversation.id, [
    { id: 'message-1', role: 'user', content: '¿Qué es la memoria?' },
    { id: 'message-2', role: 'assistant', content: 'La memoria es una práctica social.' },
  ]);
  const chatClip = save('chat_message', `${conversation.id}:message-2`);
  assert.equal(chatClip.modelId, 'ming3-0.5b-mlx-8bit', 'the checkpoint that produced the audio is recorded');
  assert.equal(rows('chat_message', `${conversation.id}:message-2`), 1);
  assert.equal(fs.existsSync(audioFilePath(chatClip.fileName)), true);
  chats.deleteConversation(conversation.id);
  assertClipsGone('conversation', 'chat_message', `${conversation.id}:message-2`, chatClip);

  // ── Saved Deep Research report ───────────────────────────────────────────────
  const brief = { kind: 'deep_research', objective: 'La memoria de la posguerra' };
  const report = reports.saveWritingWorkshopDraft({
    draft: { title: brief.objective, brief, selection: {}, draftMarkdown: 'Memoria y archivo.' },
    title: brief.objective,
    model: null,
  });
  const reportClip = save('deep_research', report.id);
  assert.equal(rows('deep_research', report.id), 1);
  assert.equal(fs.existsSync(audioFilePath(reportClip.fileName)), true);
  assert.equal(reports.deleteWritingWorkshopDraft(report.id), true);
  assertClipsGone('report', 'deep_research', report.id, reportClip);

  // ── Immersion ────────────────────────────────────────────────────────────────
  const plan = {
    topic: 'Memoria', title: 'Ruta de memoria', language: 'es', minutes: 45,
    generatedAt: new Date().toISOString(), model: null, overview: '', keyTerms: [], stations: [],
    contrasts: {}, frontiers: [], exam: {}, graph: { nodes: [], edges: [] }, ideaIndex: [],
    stats: { stations: 0, ideas: 0, works: 0, authors: 0, citations: 0, quizQuestions: 0 }, stoppedReason: null,
  };
  const session = immersion.saveImmersionSession(plan, null);
  const immersionClip = save('immersion', session.id);
  assert.equal(rows('immersion', session.id), 1);
  assert.equal(fs.existsSync(audioFilePath(immersionClip.fileName)), true);
  immersion.deleteImmersionSession(session.id);
  assertClipsGone('immersion', 'immersion', session.id, immersionClip);

  // ── Dictionary entry ─────────────────────────────────────────────────────────
  const entry = dictionary.createDictionaryEntry({
    name: 'Memoria colectiva', aliases: [], focusPrompt: 'Explícala con estas fuentes.',
    scope: { kind: 'vault' }, outputLanguage: 'es', detailLevel: 'concise', tags: [],
  });
  const dictionaryClip = save('dictionary_entry', entry.id);
  assert.equal(rows('dictionary_entry', entry.id), 1);
  assert.equal(fs.existsSync(audioFilePath(dictionaryClip.fileName)), true);
  assert.equal(dictionary.deleteDictionaryEntries([entry.id]), 1);
  assertClipsGone('dictionary entry', 'dictionary_entry', entry.id, dictionaryClip);

  console.log('narration clip cleanup tests passed');
} finally {
  try { load('electron/db/database.ts').closeDb(); } catch {}
  await rm(root, { recursive: true, force: true });
}
