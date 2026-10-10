import {
  API_PREFIX,
  HttpError,
  MAX_MUTATION_BATCH,
  MAX_MUTATION_BYTES,
  OBJECT_PART_BYTES,
  TABLE_CHUNK_BYTES,
  TABLE_CHUNK_ROWS,
  all,
  errorResponse,
  first,
  html,
  json,
  problem,
  readJson,
} from './util.mjs';
import {
  authorize,
  bootstrap,
  exchangeDeviceTicket,
  pairDevice,
  passwordLogin,
} from './auth.mjs';
import {
  abortMultipart,
  cleanupPublications,
  commitPublication,
  completeMultipart,
  createPublication,
  getObject,
  getSnapshot,
  negotiateObjects,
  publicationStatus,
  putMultipartPart,
  putSmallObject,
  startMultipart,
  uploadTableChunk,
} from './publications.mjs';
import { contextPackage, handleCorpus } from './corpus.mjs';
import { semanticSearch, uploadExactVectorSet, upsertVectorChunk } from './vectors.mjs';
import { ackMutations, cleanupSync, getMutations, getNodiNotes, postMutations, postNodiNotes } from './sync.mjs';
import { cancelSpaceAction, claimSpaceAction, createSpaceAction, getSpaceAction, listSpaceActions, updateSpaceAction } from './actions.mjs';
import {
  cancelLibraryCommand,
  claimLibraryCommand,
  createLibraryCommand,
  getLibraryObject,
  libraryChanges,
  listLibraryCommands,
  postLibraryRecords,
  putLibraryObject,
  updateLibraryCommand,
} from './librarySync.mjs';
import {
  authorizationServerMetadata,
  authorizeDecision,
  authorizePage,
  oauthCleanup,
  protectedResourceMetadata,
  registerClient,
  tokenEndpoint,
} from './oauth.mjs';
import { adminAction, dashboard, login, loginPage, recoveryKeyIndex, recoveryKeyManifest, recoveryKeyObject, recoveryKeyRows, recoveryKeySnapshot, recoveryManifest, recoveryObject, recoveryRows } from './admin.mjs';
import { handleMcp } from './mcp.mjs';
import { handleBridgeRelay } from './bridgeRelay.mjs';
export { NodusBridgeRelay } from './bridgeRelay.mjs';

function method(request, allowed) {
  if (!allowed.includes(request.method)) throw new HttpError(405, 'method_not_allowed', `Use ${allowed.join(' or ')}.`);
}

const UI_LANGUAGES = new Set(['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']);

async function capabilityDocument(env, request) {
  const installation = await first(env.DB, 'SELECT installation_id, name, language FROM installation WHERE id=1');
  const vectorizeDimensions = Object.keys(env)
    .map((key) => /^VECTORS_(\d+)$/.exec(key))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter((value) => Number.isSafeInteger(value) && value > 0 && value <= 1536)
    .sort((left, right) => left - right);
  return {
    api: 'v1',
    service: 'nodus-cloudflare', version: String(env.NODUS_VERSION || '1.0.0'), protocolVersion: 3,
    license: 'AGPL-3.0-only', sourceCodeUrl: String(env.NODUS_SOURCE_URL || ''),
    server: { name: installation?.name || 'Nodus Cloud', publicUrl: new URL(request.url).origin, language: installation?.language || 'en', installationId: installation?.installation_id || null, version: String(env.NODUS_VERSION || '1.0.0'), license: 'AGPL-3.0-only', sourceCodeUrl: String(env.NODUS_SOURCE_URL || '') },
    snapshotVersions: [1, 2], assets: true, libraryDocuments: true, mutations: true, vectors: true,
    spaceActions: { schemaVersion: 1, statuses: ['queued', 'claimed', 'running', 'applied', 'refused', 'failed', 'cancelled'] },
    accountLibrarySync: { schemaVersion: 1, immutableVersions: true, objects: 'sha256-r2', maxRecordBatch: 12 },
    desktopBridge: { protocol: '/bridge/v2', relay: Boolean(env.BRIDGE_RELAY), relayProtocolVersion: 1, transport: 'end-to-end-encrypted-websocket', endpoint: '/api/v1/bridge-relay' },
    resources: { api: `${new URL(request.url).origin}/api/v1`, mcp: `${new URL(request.url).origin}/mcp` },
    publication: { generations: true, resumable: true, tableChunkRows: TABLE_CHUNK_ROWS, tableChunkBytes: TABLE_CHUNK_BYTES, objectPartBytes: OBJECT_PART_BYTES, maxMutationBytes: MAX_MUTATION_BYTES, maxMutationBatch: MAX_MUTATION_BATCH },
    storage: { structured: 'd1', objects: 'r2', vectorSearch: vectorizeDimensions.length ? ['vectorize', 'r2-exact', 'lexical'] : ['r2-exact', 'lexical'], vectorizeDimensions },
    features: { snapshots: true, assets: true, library: true, librarySync: true, vectors: true, mutations: true, spaceActions: true, desktopBridgeRelay: Boolean(env.BRIDGE_RELAY), nodiNotes: true, oauth: true, mcp: true, recovery: true },
    maxAssetBytes: 8 * 1024 * 1024, maxSpaceAssetBytes: 1024 * 1024 * 1024,
    maxLibraryPackageBytes: 128 * 1024 * 1024, maxSpaceLibraryBytes: 4 * 1024 * 1024 * 1024,
    maxSnapshotBytes: 512 * 1024 * 1024, maxSnapshotJsonBytes: 512 * 1024 * 1024,
    maxMutationBatch: MAX_MUTATION_BATCH, maxMutationBytes: MAX_MUTATION_BYTES, maxMutationBatchBytes: 8 * 1024 * 1024, maxLedgerBytes: 50 * 1024 * 1024,
  };
}

async function api(env, request, segments) {
  const apiResource = `${new URL(request.url).origin}/api/v1`;
  const apiAuthorize = (options) => authorize(env, request, { resource: apiResource, ...options });
  const [head, ...rest] = segments;
  if (head === 'bridge-relay') return handleBridgeRelay(env, request, rest, apiAuthorize);
  if (head === 'capabilities') { method(request, ['GET']); return json(await capabilityDocument(env, request)); }
  if (head === 'bootstrap') { method(request, ['POST']); return json(await bootstrap(env, request), 201); }
  if (head === 'pair') { method(request, ['POST']); return json(await pairDevice(env, request)); }
  if (head === 'auth' && rest[0] === 'pair') { method(request, ['POST']); return json(await pairDevice(env, request)); }
  if (head === 'auth' && rest[0] === 'login') { method(request, ['POST']); return json(await passwordLogin(env, request)); }
  if (head === 'auth' && rest[0] === 'device') { method(request, ['POST']); return json(await exchangeDeviceTicket(env, request)); }
  if (head === 'me') {
    method(request, ['GET']);
    const auth = await apiAuthorize({ via: ['device', 'oauth'], scope: 'materials.read' });
    const spaces = await all(env.DB, `SELECT s.id,s.name,s.description,s.vault_json,s.updated_at,s.revision,m.role FROM memberships m JOIN spaces s ON s.id=m.space_id WHERE m.user_id=?1 ORDER BY s.name`, auth.user_id);
    return json({ user: { id: auth.user_id, email: auth.email, role: auth.user_role }, spaces: spaces.map((space) => ({ id: space.id, name: space.name, description: space.description, vault: space.vault_json ? JSON.parse(space.vault_json) : null, updatedAt: space.updated_at, hasSnapshot: Boolean(space.revision), role: space.role })), server: (await capabilityDocument(env, request)).server });
  }
  if (head === 'nodi' && rest[0] === 'notes') {
    const auth = await apiAuthorize({ via: ['device', 'oauth'], scope: request.method === 'GET' ? 'materials.read' : 'materials.write' });
    if (request.method === 'GET') return json(await getNodiNotes(env, auth, request));
    if (request.method === 'POST') return json(await postNodiNotes(env, auth, request));
    method(request, ['GET', 'POST']);
  }
  if (head === 'library') {
    const auth = await apiAuthorize({ via: ['device'] });
    if (rest[0] === 'changes') { method(request, ['GET']); return json(await libraryChanges(env, auth, request)); }
    if (rest[0] === 'records' && rest[1] === 'batch') { method(request, ['POST']); return json(await postLibraryRecords(env, auth, request)); }
    if (rest[0] === 'objects' && rest[1]) {
      method(request, ['GET', 'HEAD', 'PUT']);
      return request.method === 'PUT'
        ? json(await putLibraryObject(env, auth, decodeURIComponent(rest[1]), request))
        : getLibraryObject(env, auth, decodeURIComponent(rest[1]), request);
    }
    if (rest[0] === 'commands') {
      if (rest[1] === 'claim') {
        method(request, ['POST']);
        if (auth.device_kind !== 'publisher') throw new HttpError(403, 'publisher_required', 'Only Nodus Desktop may claim Library commands.');
        return json(await claimLibraryCommand(env, auth, request));
      }
      if (!rest[1]) {
        if (request.method === 'GET') return json(await listLibraryCommands(env, auth, request));
        if (request.method === 'POST') return json(await createLibraryCommand(env, auth, request), 201);
        method(request, ['GET', 'POST']);
      }
      if (rest[2] === 'cancel') { method(request, ['POST']); return json(await cancelLibraryCommand(env, auth, decodeURIComponent(rest[1]))); }
      if (rest[2] === 'status') {
        method(request, ['POST']);
        if (auth.device_kind !== 'publisher') throw new HttpError(403, 'publisher_required', 'Only Nodus Desktop may finish Library commands.');
        return json(await updateLibraryCommand(env, auth, decodeURIComponent(rest[1]), request));
      }
    }
    return problem(404, 'not_found');
  }
  if (head === 'settings' && rest[0] === 'language') {
    method(request, ['PUT']);
    const auth = await apiAuthorize({ via: ['device'] });
    if (auth.space_role !== 'owner' && auth.user_role !== 'admin') throw new HttpError(403, 'insufficient_role', 'Only a vault owner can change the server language.');
    const input = await readJson(request, 64 * 1024);
    const language = String(input.language || '');
    if (!UI_LANGUAGES.has(language)) throw new HttpError(400, 'unsupported_language', 'This interface language is not supported.');
    await env.DB.prepare('UPDATE installation SET language = ?1, updated_at = ?2 WHERE id = 1').bind(language, new Date().toISOString()).run();
    return json({ ok: true, language });
  }
  if (head !== 'spaces' || !rest[0]) return problem(404, 'not_found');
  const spaceId = decodeURIComponent(rest[0]);
  const tail = rest.slice(1); const resource = tail[0];

  if (resource === 'publications') {
    const auth = await apiAuthorize({ via: ['device'], spaceId, need: 'owner' });
    if (!tail[1]) { method(request, ['POST']); return json(await createPublication(env, auth, request), 201); }
    const publicationId = decodeURIComponent(tail[1]);
    if (tail.length === 2) { method(request, ['GET']); return json(await publicationStatus(env, spaceId, publicationId)); }
    if (tail[2] === 'tables' && tail[3]) { method(request, ['PUT']); return json(await uploadTableChunk(env, auth, publicationId, decodeURIComponent(tail[3]), request)); }
    if (tail[2] === 'commit') { method(request, ['POST']); return json(await commitPublication(env, auth, publicationId)); }
    if (tail[2] === 'uploads' && !tail[3]) { method(request, ['POST']); return json(await startMultipart(env, auth, publicationId, request), 201); }
    if (tail[2] === 'vectors' && tail[3] && tail[4] === 'exact') { method(request, ['PUT']); return json(await uploadExactVectorSet(env, auth, request, publicationId, decodeURIComponent(tail[3]))); }
    if (tail[2] === 'vectors' && tail[3] && tail[4] === 'vectorize') { method(request, ['PUT']); return json(await upsertVectorChunk(env, auth, request, publicationId, decodeURIComponent(tail[3]))); }
    return problem(404, 'not_found');
  }

  if (resource === 'uploads' && tail[1]) {
    const auth = await apiAuthorize({ via: ['device'], spaceId, need: 'owner' });
    const uploadId = decodeURIComponent(tail[1]);
    if (tail[2] === 'parts' && tail[3]) { method(request, ['PUT']); return json(await putMultipartPart(env, auth, uploadId, tail[3], request)); }
    if (tail[2] === 'complete') { method(request, ['POST']); return json(await completeMultipart(env, auth, uploadId)); }
    if (tail[2] === 'abort') { method(request, ['POST', 'DELETE']); return json(await abortMultipart(env, auth, uploadId)); }
    return problem(404, 'not_found');
  }

  if (resource === 'objects') {
    if (tail[1] === 'negotiate') {
      const auth = await apiAuthorize({ via: ['device'], spaceId, need: 'owner' });
      method(request, ['POST']); return json(await negotiateObjects(env, auth.space_id, await readJson(request, 1024 * 1024)));
    }
    const purpose = decodeURIComponent(tail[1] || ''); const hash = decodeURIComponent(tail[2] || '');
    const auth = await apiAuthorize({ via: ['device'], spaceId, need: 'owner' });
    method(request, ['PUT']); return json(await putSmallObject(env, auth, purpose, hash, request, new URL(request.url).searchParams.get('publicationId')));
  }

  if (resource === 'snapshot') {
    const auth = await apiAuthorize({ via: ['device', 'oauth'], spaceId, need: 'reader', scope: 'materials.read' });
    method(request, ['GET', 'HEAD']); return getSnapshot(env, auth, request);
  }
  if (resource === 'assets') {
    if (tail[1] === 'negotiate') {
      const auth = await apiAuthorize({ via: ['device', 'oauth'], spaceId, need: 'writer', scope: 'materials.write' });
      method(request, ['POST']); return json(await negotiateObjects(env, auth.space_id, await readJson(request, 1024 * 1024)));
    }
    const hash = decodeURIComponent(tail[1] || '');
    if (request.method === 'GET' || request.method === 'HEAD') {
      const auth = await apiAuthorize({ via: ['device', 'oauth'], spaceId, need: 'reader', scope: 'materials.read' });
      return getObject(env, auth.space_id, hash, request, 'asset');
    }
    const auth = await apiAuthorize({ via: ['device', 'oauth'], spaceId, need: 'writer', scope: 'materials.write' });
    method(request, ['PUT', 'POST']); return json(await putSmallObject(env, auth, 'asset', hash, request));
  }
  if (resource === 'mutations') {
    const ownerOperation = request.method === 'GET' || tail[1] === 'ack';
    const auth = await apiAuthorize({ via: ['device', 'oauth'], spaceId, need: ownerOperation ? 'owner' : 'writer', scope: ownerOperation ? 'materials.read' : 'materials.write' });
    if (tail[1] === 'ack') { method(request, ['POST']); return json(await ackMutations(env, auth, request)); }
    if (request.method === 'GET') return json(await getMutations(env, auth, request));
    if (request.method === 'POST') return json(await postMutations(env, auth, request));
    method(request, ['GET', 'POST']);
  }
  if (resource === 'actions') {
    if (tail[1] === 'claim') {
      const auth = await apiAuthorize({ via: ['device'], spaceId, need: 'owner' });
      method(request, ['POST']);
      if (auth.device_kind !== 'publisher') throw new HttpError(403, 'publisher_required', 'Only Nodus Desktop may claim actions.');
      return json(await claimSpaceAction(env, auth, request));
    }
    if (!tail[1]) {
      const auth = await apiAuthorize({ via: ['device', 'oauth'], spaceId, need: request.method === 'POST' ? 'writer' : 'reader', scope: request.method === 'POST' ? 'materials.write' : 'materials.read' });
      if (request.method === 'GET') return json(await listSpaceActions(env, auth, request));
      if (request.method === 'POST') return json(await createSpaceAction(env, auth, request), 201);
      method(request, ['GET', 'POST']);
    }
    const id = decodeURIComponent(tail[1]);
    if (tail[2] === 'cancel') {
      const auth = await apiAuthorize({ via: ['device', 'oauth'], spaceId, need: 'reader', scope: 'materials.read' });
      method(request, ['POST']); return json(await cancelSpaceAction(env, auth, id));
    }
    if (tail[2] === 'status') {
      const auth = await apiAuthorize({ via: ['device'], spaceId, need: 'owner' });
      method(request, ['POST']);
      if (auth.device_kind !== 'publisher') throw new HttpError(403, 'publisher_required', 'Only Nodus Desktop may finish actions.');
      return json(await updateSpaceAction(env, auth, id, request));
    }
    const auth = await apiAuthorize({ via: ['device', 'oauth'], spaceId, need: 'reader', scope: 'materials.read' });
    method(request, ['GET']); return json(await getSpaceAction(env, auth, id));
  }
  if (resource === 'search' && tail[1] === 'semantic') {
    const auth = await apiAuthorize({ via: ['device', 'oauth'], spaceId, need: 'reader', scope: 'materials.read' });
    method(request, ['POST']); return json(await semanticSearch(env, auth, await readJson(request, 8 * 1024 * 1024)));
  }
  if (resource === 'context') {
    const auth = await apiAuthorize({ via: ['device', 'oauth'], spaceId, need: 'reader', scope: 'materials.read' });
    method(request, ['POST']); return json(await contextPackage(env, auth, request, await readJson(request, 1024 * 1024)));
  }
  const auth = await apiAuthorize({ via: ['device', 'oauth'], spaceId, need: 'reader', scope: 'materials.read' });
  method(request, ['GET', 'HEAD']);
  return handleCorpus(env, auth, request, tail);
}

async function route(env, request) {
  const url = new URL(request.url);
  if (url.pathname === '/health' || url.pathname === '/api/health') return json({ ok: true, service: 'nodus-cloudflare', version: String(env.NODUS_VERSION || '1.0.0'), now: new Date().toISOString() });
  if (url.pathname === '/source') {
    method(request, ['GET', 'HEAD']);
    try {
      const sourceUrl = new URL(String(env.NODUS_SOURCE_URL || ''));
      if (sourceUrl.protocol === 'https:') return new Response(null, { status: 302, headers: { location: sourceUrl.toString() } });
    } catch {
      // Invalid release metadata must never become an open redirect.
    }
    return problem(404, 'source_unavailable');
  }
  if (url.pathname === '/.well-known/oauth-authorization-server') return authorizationServerMetadata(request);
  if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') return protectedResourceMetadata(request, 'mcp');
  if (url.pathname === '/.well-known/oauth-protected-resource/api') return protectedResourceMetadata(request, 'api');
  if (url.pathname === '/oauth/register') { method(request, ['POST']); return registerClient(env, request); }
  if (url.pathname === '/oauth/authorize') return request.method === 'GET' ? authorizePage(env, request) : request.method === 'POST' ? authorizeDecision(env, request) : problem(405, 'method_not_allowed');
  if (url.pathname === '/oauth/token') { method(request, ['POST']); return tokenEndpoint(env, request); }
  if (url.pathname === '/mcp') return handleMcp(env, request);
  if (url.pathname === '/recovery/index.json') { method(request, ['GET']); return recoveryKeyIndex(env, request); }
  let recoveryMatch = /^\/recovery\/([^/]+)\/(manifest\.json|rows\.ndjson|snapshot)$/.exec(url.pathname);
  if (recoveryMatch) {
    method(request, ['GET']); const spaceId = decodeURIComponent(recoveryMatch[1]);
    return recoveryMatch[2] === 'manifest.json' ? recoveryKeyManifest(env, request, spaceId) : recoveryMatch[2] === 'rows.ndjson' ? recoveryKeyRows(env, request, spaceId) : recoveryKeySnapshot(env, request, spaceId);
  }
  const recoveryObjectMatch = /^\/recovery\/([^/]+)\/objects\/([^/]+)\/([0-9a-f]{64})$/.exec(url.pathname);
  if (recoveryObjectMatch) {
    method(request, ['GET', 'HEAD']);
    return recoveryKeyObject(env, request, decodeURIComponent(recoveryObjectMatch[1]), decodeURIComponent(recoveryObjectMatch[2]), recoveryObjectMatch[3]);
  }
  if (url.pathname === '/admin/login') return request.method === 'GET' ? loginPage(request) : request.method === 'POST' ? login(env, request) : problem(405, 'method_not_allowed');
  if (url.pathname === '/admin/action') { method(request, ['POST']); return adminAction(env, request); }
  if (url.pathname === '/admin') return dashboard(env, request);
  let match = /^\/admin\/recovery\/([^/]+)\/(manifest\.json|rows\.ndjson)$/.exec(url.pathname);
  if (match) return match[2] === 'manifest.json' ? recoveryManifest(env, request, decodeURIComponent(match[1])) : recoveryRows(env, request, decodeURIComponent(match[1]));
  const adminObjectMatch = /^\/admin\/recovery\/([^/]+)\/objects\/([^/]+)\/([0-9a-f]{64})$/.exec(url.pathname);
  if (adminObjectMatch) {
    method(request, ['GET', 'HEAD']);
    return recoveryObject(env, request, decodeURIComponent(adminObjectMatch[1]), decodeURIComponent(adminObjectMatch[2]), adminObjectMatch[3]);
  }
  const apiPrefix = ['/api/v3', API_PREFIX].find((prefix) => url.pathname.startsWith(`${prefix}/`));
  if (apiPrefix) return api(env, request, url.pathname.slice(apiPrefix.length + 1).split('/').filter(Boolean));
  if (url.pathname === '/') {
    const installation = await first(env.DB, 'SELECT name FROM installation WHERE id=1');
    if (installation) return new Response(null, { status: 302, headers: { location: '/admin' } });
    return html('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Nodus Cloud</title><body style="font:16px system-ui;max-width:680px;margin:12vh auto;padding:24px"><h1>Nodus Cloud is ready</h1><p>Return to Nodus Desktop to finish the private setup. It will create your administrator and first vault without exposing the one-time deployment credential in this page.</p></body></html>');
  }
  return problem(404, 'not_found');
}

export default {
  async fetch(request, env) {
    try { return await route(env, request); } catch (error) { console.error(error); return errorResponse(error); }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([cleanupPublications(env), cleanupSync(env), oauthCleanup(env)]));
  },
};
