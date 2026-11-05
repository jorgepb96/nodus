import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DocumentVisualManifest, DocumentVisualTarget } from '../../shared/documentSkills';
import { DOCUMENT_VISUAL_DISCARD_REASONS } from '../../shared/documentSkills';
import { deleteChatAssets } from '../chatAssets';
import { validateViewDocument } from '../../packages/capability-api/src/views';

export const visualContentHash = (fields: Record<string, string>) => createHash('sha256').update(JSON.stringify(fields)).digest('hex');
const directory = (vaultId: string, target: DocumentVisualTarget) => path.join(app.getPath('userData'), 'document-visuals', createHash('sha256').update(JSON.stringify([vaultId, target.kind, target.id])).digest('hex'));
export function readDocumentVisuals(vaultId: string, target: DocumentVisualTarget, previous = false): DocumentVisualManifest | null {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(directory(vaultId, target), previous ? 'previous.json' : 'current.json'), 'utf8')) as DocumentVisualManifest;
    if (value.schemaVersion !== 1 || value.vaultId !== vaultId || value.target.kind !== target.kind || value.target.id !== target.id || !Array.isArray(value.blocks) || !Array.isArray(value.figures) || !value.usage || !value.policy || typeof value.revision !== 'string') return null;
    // Absent on manifests written before refusals were recorded; when present every entry
    // has to name a motive this build knows, or the panel would show a blank line.
    if (value.discarded !== undefined && (!Array.isArray(value.discarded) || value.discarded.some(item => !item || typeof item.blockId !== 'string' || typeof item.skillId !== 'string' || !(item.reason in DOCUMENT_VISUAL_DISCARD_REASONS)))) return null;
    for (const figure of value.figures) {
      if (typeof figure.id !== 'string' || typeof figure.caption !== 'string' || !Array.isArray(figure.sources) || figure.sources.some(source => typeof source !== 'string' || !/^nodus:\/\/[a-z-]+\//.test(source)) || !value.blocks.some(block => block.id === figure.blockId)) return null;
      if (figure.owner && !/^[a-f0-9]{64}$/.test(figure.owner)) return null;
      if (figure.view) figure.view = validateViewDocument(figure.view);
    }
    return value;
  } catch { return null; }
}
export function writeDocumentVisuals(manifest: DocumentVisualManifest, updatedAt = new Date().toISOString()): void {
  const dir = directory(manifest.vaultId, manifest.target);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  manifest.updatedAt = updatedAt;
  const usage = readDocumentVisualUsage(manifest.vaultId, manifest.target);
  for (const [id, value] of Object.entries(manifest.usage)) {
    const old = usage[id] ?? { attempts: 0, paidCalls: 0 };
    usage[id] = { attempts: Math.max(old.attempts, value.attempts), paidCalls: Math.max(old.paidCalls, value.paidCalls) };
  }
  Object.assign(manifest.usage, usage);
  fs.writeFileSync(path.join(dir, 'usage.tmp'), JSON.stringify(usage), { mode: 0o600 });
  fs.renameSync(path.join(dir, 'usage.tmp'), path.join(dir, 'usage.json'));
  fs.writeFileSync(path.join(dir, 'current.tmp'), JSON.stringify(manifest), { mode: 0o600 });
  fs.renameSync(path.join(dir, 'current.tmp'), path.join(dir, 'current.json'));
}
export function readDocumentVisualUsage(vaultId: string, target: DocumentVisualTarget): DocumentVisualManifest['usage'] {
  const file = path.join(directory(vaultId, target), 'usage.json');
  if (!fs.existsSync(file)) return {};
  const usage = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!usage || typeof usage !== 'object' || Array.isArray(usage) || Object.values(usage).some((value: any) => !Number.isSafeInteger(value?.attempts) || value.attempts < 0 || !Number.isSafeInteger(value?.paidCalls) || value.paidCalls < 0)) throw new Error('The saved skill usage is unreadable. Calls were not resumed.');
  return usage;
}
export function retainPreviousVisuals(vaultId: string, target: DocumentVisualTarget): void {
  const current = readDocumentVisuals(vaultId, target);
  const previous = readDocumentVisuals(vaultId, target, true);
  const currentOwners = new Set(current?.figures.map(figure => figure.owner));
  for (const figure of previous?.figures ?? []) if (figure.owner && !currentOwners.has(figure.owner)) deleteChatAssets(figure.owner);
  if (current) fs.writeFileSync(path.join(directory(vaultId, target), 'previous.json'), JSON.stringify(current), { mode: 0o600 });
}
export function undoDocumentVisuals(vaultId: string, target: DocumentVisualTarget): DocumentVisualManifest | null {
  const current = readDocumentVisuals(vaultId, target), previous = readDocumentVisuals(vaultId, target, true);
  const kept = new Set(previous?.figures.map(figure => figure.owner));
  for (const figure of current?.figures ?? []) if (figure.owner && !kept.has(figure.owner)) deleteChatAssets(figure.owner);
  if (previous) {
    for (const [id, usage] of Object.entries(current?.usage ?? {})) {
      const old = previous.usage[id] ?? { attempts: 0, paidCalls: 0 };
      previous.usage[id] = { attempts: Math.max(old.attempts, usage.attempts), paidCalls: Math.max(old.paidCalls, usage.paidCalls) };
    }
    writeDocumentVisuals(previous);
  }
  else fs.rmSync(path.join(directory(vaultId, target), 'current.json'), { force: true });
  fs.rmSync(path.join(directory(vaultId, target), 'previous.json'), { force: true });
  return previous;
}
export function deleteDocumentVisuals(vaultId: string, target: DocumentVisualTarget): void {
  for (const previous of [false, true]) for (const figure of readDocumentVisuals(vaultId, target, previous)?.figures ?? []) if (figure.owner) deleteChatAssets(figure.owner);
  fs.rmSync(directory(vaultId, target), { recursive: true, force: true });
}
