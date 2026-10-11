import { validateModelAsset, isModelMimeType } from '../packages/capability-api/src/models';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { LIMITS } from '../packages/capability-api/src/limits';

const versions = new Map<string, number>();
const retainedOwners=new Map<string,number>();
/** While a live reply creates tools/results, checkpoints may not collect files
 * that have been created but whose final reference has not streamed yet. */
export function retainChatAssets(owner:string):()=>void {
  directory(owner);retainedOwners.set(owner,(retainedOwners.get(owner)??0)+1);
  let released=false;
  return ()=>{if(released)return;released=true;const count=(retainedOwners.get(owner)??1)-1;if(count)retainedOwners.set(owner,count);else retainedOwners.delete(owner);};
}
const root = () => path.join(app.getPath('userData'), 'chat-assets');
export const chatAssetOwner = (surface: string, conversationId: string, vaultId = '') =>
  createHash('sha256').update(JSON.stringify([surface, vaultId, conversationId])).digest('hex');
export const chatAssetVersion = (owner: string) => versions.get(owner) ?? 0;
function directory(owner: string): string {
  if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error('Invalid image owner.');
  return path.join(root(), owner);
}
export function storeChatImage(owner: string, image: { bytes: Buffer; mimeType: string }, metadata: Record<string, string>): string {
  if (image.bytes.length > 40 * 1024 * 1024) throw new Error('The generated image exceeds 40 MB.');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) throw new Error('Unsupported generated image format.');
  const id = randomUUID();
  const dir = directory(owner);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, `${id}.image`), image.bytes, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ ...metadata, mimeType: image.mimeType }), { mode: 0o600 });
  } catch (error) {
    fs.rmSync(path.join(dir, `${id}.image`), { force: true });
    fs.rmSync(path.join(dir, `${id}.json`), { force: true });
    throw error;
  }
  return `nodus-image://chat/${owner}/${id}`;
}
export function getChatImage(id: string): { blob: Buffer; mime: string } | null {
  if (!/^[a-f0-9]{64}\/[a-f0-9-]{36}$/.test(id)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(root(), `${id}.json`), 'utf8'));
    return { blob: fs.readFileSync(path.join(root(), `${id}.image`)), mime: meta.mimeType };
  } catch { return null; }
}
export function getChatImageMetadata(source: string): Record<string, string> | null {
  const match = /^nodus-image:\/\/chat\/([a-f0-9]{64}\/[a-f0-9-]{36})$/.exec(source);
  if (!match) return null;
  try { return JSON.parse(fs.readFileSync(path.join(root(), `${match[1]}.json`), 'utf8')); } catch { return null; }
}
export function deleteChatAssets(owner: string): void {
  versions.set(owner, chatAssetVersion(owner) + 1);
  fs.rmSync(directory(owner), { recursive: true, force: true });
}
export function storeCapabilityFile(owner: string, input: { bytes: Buffer; mimeType: string; name: string; title?: string }): string {
  const isModel = isModelMimeType(input.mimeType);
  if (isModel) validateModelAsset(input.bytes, input.mimeType);
  const maximum = isModel ? LIMITS.modelBytes : input.mimeType.startsWith('image/') ? LIMITS.imageBytes : input.mimeType.startsWith('audio/') ? LIMITS.audioBytes : 10_000_000;
  if (input.bytes.length > maximum || !input.bytes.length) throw new Error('Capability file exceeds its size limit.');
  if (!input.name || /[\\/\0]/.test(input.name) || input.name.length > 160 || !/^[\w.+-]+\/[\w.+-]+$/i.test(input.mimeType)) throw new Error('Invalid capability file metadata.');
  const id = randomUUID(), dir = directory(owner); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(path.join(dir, `${id}.capability`), input.bytes, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, `${id}.capability.json`), JSON.stringify({ mimeType: input.mimeType, name: input.name, title: input.title ?? input.name }), { mode: 0o600 });
  } catch (error) {
    fs.rmSync(path.join(dir, `${id}.capability`), { force: true }); fs.rmSync(path.join(dir, `${id}.capability.json`), { force: true }); throw error;
  }
  return `nodus-capability://chat/${owner}/${id}`;
}
export function getCapabilityFile(source: string): { blob: Buffer; mimeType: string; name: string; title: string } | null {
  const match = /^nodus-capability:\/\/chat\/([a-f0-9]{64}\/[a-f0-9-]{36})$/.exec(source); if (!match) return null;
  try {
    const file=path.join(root(),`${match[1]}.capability`),meta=path.join(root(),`${match[1]}.capability.json`),stat=fs.lstatSync(file),metaStat=fs.lstatSync(meta);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024||!metaStat.isFile()||metaStat.isSymbolicLink()||metaStat.size>32*1024)return null;
    const metadata=JSON.parse(fs.readFileSync(meta,'utf8'));
    if(typeof metadata.mimeType!=='string'||typeof metadata.name!=='string'||typeof metadata.title!=='string')return null;
    return {blob:fs.readFileSync(file),mimeType:metadata.mimeType,name:metadata.name,title:metadata.title};
  }
  catch { return null; }
}
/** Remove images dropped by regeneration, message truncation, or history retention.
 *
 *  What counts as "still referenced" is wider than the message text. A capability result
 *  is stored as an artifact and the message keeps only a reference to it; whatever that
 *  result points at — a file to download, a 3D model to open — is named inside the
 *  artifact, not in the conversation. Reading the message alone would collect exactly the
 *  attachments a saved result still needs, and the failure would only show up later, as a
 *  download or a model that had quietly stopped existing. */
export function reconcileChatAssets(owner: string, messages: Array<{ content: string;concilium?:unknown }>): void {
  if(retainedOwners.has(owner))return;
  const dir = directory(owner);
  if (!fs.existsSync(dir)) return;
  const text = messages.flatMap(message => {
    const council=message.concilium as {members?:Array<{answer?:unknown}>}|undefined;
    return [message.content,...(Array.isArray(council?.members)?council.members.flatMap(member=>typeof member.answer==='string'?[member.answer]:[]):[])];
  }).join('\n');
  const files = fs.readdirSync(dir);

  // Only artifacts the conversation still refers to: one that was itself dropped must not
  // keep its attachments alive.
  const live = files
    .filter(file => file.endsWith('.artifact') && text.includes(`nodus-artifact://chat/${owner}/${file.slice(0, -'.artifact'.length)}`))
    .map(file => { try { return fs.readFileSync(path.join(dir, file), 'utf8'); } catch { return ''; } });
  const referenced = [text, ...live].join('\n');

  for (const file of files) {
    if (file.endsWith('.artifact') || file.endsWith('.artifact.json')) {
      const id = file.replace(/\.artifact(?:\.json)?$/, '');
      if (!text.includes(`nodus-artifact://chat/${owner}/${id}`)) fs.rmSync(path.join(dir, file), { force: true });
      continue;
    }
    if (file.endsWith('.genomics')) {
      if (!text.includes(`nodus-genomics://chat/${owner}/${file.slice(0, -9)}`)) fs.rmSync(path.join(dir, file), { force: true });
      continue;
    }
    if (file.endsWith('.capability') || file.endsWith('.capability.json')) {
      // Either spelling counts: a view that travelled inline carries the whole URI, and
      // one inside an artifact carries the identifier alone.
      const id = file.replace(/\.capability(?:\.json)?$/, '');
      if (!referenced.includes(id)) fs.rmSync(path.join(dir, file), { force: true });
      continue;
    }
    const id = file.replace(/\.(json|image)$/, '');
    if (!text.includes(`nodus-image://chat/${owner}/${id}`)) fs.rmSync(path.join(dir, file), { force: true });
  }
}
