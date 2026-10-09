import fs from 'node:fs';
import path from 'node:path';
import { activeVaultDir } from '../vaults/vaultRegistry';
import { getDb } from '../db/database';

/** Only persisted attachments owned by an existing academic conversation can be
 * promoted. Never follow links outside that conversation or load image payloads. */
export function readResearchAttachmentSource(conversationId: string, attachmentId: string, includeUnsearchable = false): { name: string; text: string; kind: string; warning?: string } | null {
  if (![conversationId, attachmentId].every(id => /^[a-zA-Z0-9_-]{1,100}$/.test(id))) return null;
  if (!getDb().prepare('SELECT 1 FROM chat_conversations WHERE id=?').get(conversationId)) return null;
  try {
    const vault = fs.realpathSync(activeVaultDir());
    const folder = path.join(vault, 'research-attachments', 'research', conversationId, attachmentId);
    // Reject aliases even when they point at another otherwise authorized file.
    if (fs.realpathSync(folder) !== folder) return null;
    const filename = path.join(folder, 'metadata.json');
    if (fs.realpathSync(filename) !== filename || fs.realpathSync(path.join(folder, 'original')) !== path.join(folder, 'original')) return null;
    if (fs.statSync(filename).size > 100 * 1024 * 1024) return null;
    const meta = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (meta.id !== attachmentId || !(includeUnsearchable ? ['text', 'pdf', 'image', 'unsupported'] : ['text', 'pdf']).includes(meta.kind)
      || typeof meta.name !== 'string' || typeof meta.text !== 'string' || (!includeUnsearchable && !meta.text.trim())) return null;
    return { name: meta.name, text: meta.text, kind: meta.kind, warning: typeof meta.warning === 'string' ? meta.warning : undefined };
  } catch { return null; }
}

export function listResearchAttachmentSources(): Array<{ conversationId: string; attachmentId: string; source: NonNullable<ReturnType<typeof readResearchAttachmentSource>> }> {
  const sources: ReturnType<typeof listResearchAttachmentSources> = [];
  const conversations = getDb().prepare('SELECT id FROM chat_conversations').all() as { id: string }[];
  // Resolved once: it reads and normalizes the vault registry file on every call, and this ran it
  // once per conversation of the vault on every corpus inventory (0.67 s of the main thread per
  // research turn with 678 conversations, profile of 2026-10-09).
  const root = path.join(activeVaultDir(), 'research-attachments', 'research');
  for (const { id: conversationId } of conversations) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(conversationId)) continue;
    const folder = path.join(root, conversationId);
    let ids: string[];
    try { ids = fs.readdirSync(folder); } catch { continue; }
    for (const attachmentId of ids) {
      const source = readResearchAttachmentSource(conversationId, attachmentId);
      if (source) sources.push({ conversationId, attachmentId, source });
    }
  }
  return sources;
}
