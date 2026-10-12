// Every corpus inventory lists the vault's research attachments. That listing resolved the active
// vault's folder once per conversation, and each resolution reads and normalizes the vault registry
// file: 0.67 s of the main thread per research turn on a vault with 678 conversations. The registry
// must be read a fixed number of times per listing, and the listing must not change.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-attachment-sources-registry')) process.exit(0);
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nodus-attachment-sources-'));
installRuntimeHooks(root);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
try {
  const db = load('electron/db/database.ts').getDb();
  const { activeVaultDir } = load('electron/vaults/vaultRegistry.ts');
  const CONVERSATIONS = 400;
  const insert = db.prepare("INSERT INTO chat_conversations(id,title,created_at,updated_at) VALUES(?,?,datetime('now'),datetime('now'))");
  db.transaction(() => { for (let index = 0; index < CONVERSATIONS; index += 1) insert.run(`c${index}`, `Conversation ${index}`); })();
  // Two conversations hold one attachment each, laid out as research attachments are stored.
  const vault = fs.realpathSync(activeVaultDir());
  for (const [conversation, attachment, text] of [['c3', 'a1', 'First attachment text.'], ['c250', 'a2', 'Second attachment text.']]) {
    const folder = path.join(vault, 'research-attachments', 'research', conversation, attachment);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'original'), text);
    fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify({ id: attachment, kind: 'text', name: `${attachment}.txt`, text }));
  }
  const { listResearchAttachmentSources } = load('electron/ai/researchAttachmentSources.ts');
  const registry = 'vaults.json';
  const readFileSync = fs.readFileSync;
  let registryReads = 0;
  fs.readFileSync = function (file, ...rest) {
    if (typeof file === 'string' && path.basename(file) === registry) registryReads += 1;
    return readFileSync.call(this, file, ...rest);
  };
  let sources;
  try { sources = listResearchAttachmentSources(); } finally { fs.readFileSync = readFileSync; }
  assert.deepEqual(sources.map(source => [source.conversationId, source.attachmentId, source.source.text]).sort(),
    [['c250', 'a2', 'Second attachment text.'], ['c3', 'a1', 'First attachment text.']]);
  assert.ok(registryReads > 0, 'the listing resolves the active vault');
  assert.ok(registryReads <= 10, `listing ${CONVERSATIONS} conversations read the vault registry ${registryReads} times`);
  console.log(`Research attachment sources: ${sources.length} found across ${CONVERSATIONS} conversations, vault registry read ${registryReads} times.`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
