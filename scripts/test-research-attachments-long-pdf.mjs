// A research attachment PDF over 20 pages keeps only its text layer. One blank page must
// not make the whole document unreadable; a PDF with no text on any page still is.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--research-attachments-long-pdf')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-attachments-long-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url), load = (file) => require(path.join(repoRoot, file));
globalThis.fetch = () => { throw new Error('External network forbidden in attachment tests'); };
try {
  const store = load('electron/researchAttachments.ts');
  const chats = load('electron/db/chatRepo.ts');
  const own = { surface: 'research', conversationId: chats.createConversation({}).id };
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  async function pdf(name, pages, blank) {
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let n = 1; n <= pages; n++) { const page = doc.addPage(); if (!blank(n)) page.drawText(`Page ${n}: census total 42.`, { font }); }
    const file = path.join(scratch, name); fs.writeFileSync(file, await doc.save()); return file;
  }
  const mostlyText = await store.importResearchAttachment(own, await pdf('paper.pdf', 30, (n) => n === 2));
  assert.equal(mostlyText.kind, 'pdf', 'one blank page in a 30-page PDF does not make it unsupported');
  const context = store.readResearchAttachmentContext(own, [mostlyText.id]);
  assert.match(context.text, /Page 29: census total 42/);
  const scanned = await store.importResearchAttachment(own, await pdf('scan.pdf', 25, () => true));
  assert.equal(scanned.kind, 'unsupported', 'a long PDF with no text layer at all is still refused');
  assert.throws(() => store.readResearchAttachmentContext(own, [scanned.id]));
  console.log('# long PDF attachment tests passed');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
