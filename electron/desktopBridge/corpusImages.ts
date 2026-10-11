import { createHash } from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import { getDb, withVaultDatabase } from '../db/database';
import { withOwningVault } from '../vaults/vaultRegistry';
import { chatAssetOwner } from '../chatAssets';
import { internalImagePayloadFromUrl } from '../imageProtocol';
import { readStudyChatStore } from '../ai/studyChatHistory';
import { readDocumentVisuals } from '../capabilities/documentStore';
import { listGlobalLibraryVaultLinks } from '../library/libraryService';
import { libraryReaderChatAssetOwner } from '../libraryReader/libraryReaderStore';

const conversations = [['assistant','chat_conversations'],['world-assistant','world_chat_conversations'],
  ['character','character_chat_conversations'],['database','database_chat_conversations']] as const;

/** Internal image identities resolve through their owning vault. This endpoint
 * cannot fetch a URL, select a filesystem path or read another vault's chat assets. */
export async function serveCorpusImage(request: IncomingMessage,response: ServerResponse,url: URL,vaultId: string,
  domains: readonly string[], source: string, action: string): Promise<void> {
  const json = (status: number,value: unknown) => { response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'}); response.end(request.method === 'HEAD' ? undefined : JSON.stringify(value)); };
  if (!domains.includes('corpus')) { json(403,{error:'permission_denied'}); return; }
  let address: URL;
  try { address = new URL(source); } catch { json(400,{error:'invalid_image_source'}); return; }
  if (source.length > 2048 || address.protocol !== 'nodus-image:' || address.username || address.password || address.port || address.hash ||
      [...address.searchParams.keys()].some(key=>key !== 'v') || !['portrait','world','map','character-chat','chat','portrait-thumbnail','world-thumbnail','map-thumbnail','character-chat-thumbnail'].includes(address.hostname)) {
    json(400,{error:'invalid_image_source'}); return;
  }
  await withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=> {
    const db = getDb();
    let identity: string;
    try { identity = decodeURIComponent(address.pathname.replace(/^\/+/,'')); } catch { json(400,{error:'invalid_image_source'}); return; }
    if (!identity || identity.length > 512) { json(400,{error:'invalid_image_source'}); return; }
    if (address.hostname === 'chat') {
      const owner = identity.split('/')[0];
      let owned = false;
      for (const [surface,table] of conversations) {
        for (const row of db.prepare(`SELECT id FROM "${table}"`).iterate() as Iterable<{id:string}>) {
          if (chatAssetOwner(surface,row.id,vaultId) === owner) { owned = true; break; }
        }
        if (owned) break;
      }
      if (!owned) owned = readStudyChatStore().conversations.some(row=>chatAssetOwner('study',row.id,vaultId) === owner);
      if (!owned) {
        for (const [kind,table] of [['deep-research','writing_saved_drafts'],['immersion','immersion_sessions']] as const) {
          for (const row of db.prepare(`SELECT id FROM "${table}"`).iterate() as Iterable<{id:string}>) {
            if ([false,true].some(previous=>readDocumentVisuals(vaultId,{kind,id:row.id},previous)?.figures.some(figure=>figure.owner === owner))) { owned=true; break; }
          }
          if (owned) break;
        }
      }
      if (!owned) {
        const documents = new Set((db.prepare('SELECT nodus_id FROM works').all() as {nodus_id:string}[]).map(row=>row.nodus_id));
        for (const link of listGlobalLibraryVaultLinks()) if (link.vaultId === vaultId) documents.add(link.itemId);
        owned = [...documents].some(id=>libraryReaderChatAssetOwner(id) === owner);
      }
      if (!owned) { json(403,{error:'image_owner_forbidden'}); return; }
    }
    const requiredDomains = ['corpus'];
    if (address.hostname.startsWith('portrait')) {
      for (const [table,domain] of [['prosop_person_profiles','prosopography-private'],['testimony_participant_profiles','testimonies']]) {
        if (db.prepare(`SELECT 1 FROM "${table}" WHERE person_id=?`).get(identity)) {
          if (!domains.includes(domain)) { json(403,{error:'permission_denied'}); return; }
          requiredDomains.push(domain);
        }
      }
    }
    const payload = internalImagePayloadFromUrl(source);
    if (!payload) { json(404,{error:'image_not_found'}); return; }
    if (!['image/png','image/jpeg','image/webp','image/gif','image/avif','image/svg+xml'].includes(payload.mime) || !payload.blob.length || payload.blob.length > 40 * 1024 * 1024) { json(422,{error:'image_format_unavailable'}); return; }
    const size = payload.blob.length, chunkSize = 4 * 1024 * 1024;
    if (action === 'descriptor') {
      const suffix: Record<string,string> = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/avif':'avif','image/svg+xml':'svg'};
      json(200,{kind:'corpusImage',id:source,filename:`Nodus.${suffix[payload.mime]}`,mime:payload.mime,byteSize:size,requiredDomains,
        sha256:createHash('sha256').update(payload.blob).digest('hex'),chunkSize}); return;
    }
    const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || chunkSize);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit) || offset < 0 || offset > size || limit < 1 || limit > chunkSize) { json(416,{error:'invalid_file_range'}); return; }
    const bytes = payload.blob.subarray(offset,Math.min(offset+limit,size));
    response.writeHead(200,{'content-type':payload.mime,'content-length':String(bytes.length),'cache-control':'no-store',
      'x-nodus-file-offset':String(offset),'x-nodus-file-size':String(size)});
    response.end(request.method === 'HEAD' ? undefined : bytes);
  }));
}
