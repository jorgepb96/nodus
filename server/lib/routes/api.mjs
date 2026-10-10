// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

// The /api/v1 control plane: authentication for replicas, capability negotiation, the
// snapshot channel, assets, vectors and the mutation ledger. Corpus reads live next door in
// corpus.mjs; this file owns everything that writes or that decides who may.

import { digest, token } from '../store.mjs';
import { can } from '../roles.mjs';
import { REPLICA_TOKEN_DAYS } from '../auth.mjs';
import * as ledger from '../ledger.mjs';
import {
  assetExists, collectAssetGarbage, hashBytes, isValidAssetHash, readAsset, snapshotAssetHashes, sniffImageMime, writeAsset,
} from '../assets.mjs';
import {
  collectLibraryPackageGarbage, hashLibraryPackage, isValidLibraryPackageHash,
  inspectLibraryPackage, libraryPackageExists, looksLikeZip, readLibraryPackage, snapshotLibraryPackageHashes,
  libraryPackageOriginalEntry, readLibraryPackageEntry, spaceLibraryPackageBytes, writeLibraryPackage,
} from '../libraryPackages.mjs';
import { isUserScopedMutation, MAX_MUTATION_BATCH, validateMutation } from '../core/mutations.mjs';
import {
  MAX_NODI_NOTES, mergeNodiNotes, notesSince, validateNodiNote,
} from '../core/nodiNotes.mjs';
import { decodeVectorSet, embeddingMatches } from '../core/vectors.mjs';
import { searchVectorsOffThread } from '../core/vectorSearchPool.mjs';
import { lexicalSearch } from '../core/search.mjs';
import { rows } from '../core/snapshot.mjs';
import { NODUS_LICENSE, NODUS_SOURCE_URL, NODUS_VERSION } from '../version.mjs';
import { AnnotationQuotaError, AnnotationVersionConflict, sanitizeAnnotations } from '../privateAnnotations.mjs';
import { redactText } from '../ai/redact.mjs';
import { securityHeaders } from '../http.mjs';
import { gzipSync } from 'node:zlib';
import {
  createEmbeddingContract, embeddingContractsCompatible, fingerprintEmbeddingContract,
  migrateLegacyVectorV1Header,
} from '../core/embeddingContract.mjs';

const AUTH_BODY_BYTES = 32 * 1024;
const TICKET_TTL_MS = 5 * 60_000;
const VECTOR_QUERY_BYTES = 256 * 1024;
const SHARED_BLOB_CHUNK_BYTES = 1024 * 1024;
const ACTION_BODY_BYTES = 512 * 1024;
const MAX_PRIVATE_OWNERSHIP_KEYS = 250_000;
const ACTION_KINDS = new Set([
  'deepResearch.generate', 'deepResearch.saveToNotes', 'idea.delete', 'idea.saveToNotes',
  'author.synthesis.generate', 'authors.matrix.generate', 'argumentMap.generate',
  'library.importToSpace', 'academic.recompute', 'hypothesis.saveToNotes', 'writing.generate',
  'projects.create', 'projects.update', 'projects.section.update', 'projects.chapter.import',
  'worldbuilding.continuity', 'worldbuilding.entityDelete', 'worldbuilding.proseReview',
  'pages.restoreRevision', 'databases.importCSV', 'pages.automationRun', 'toolkit.desktopRun',
]);
const ACTION_TERMINAL = new Set(['applied', 'refused', 'failed', 'cancelled']);
const POLICY_FIELDS = [
  'allowUserContent', 'allowPersonalImports', 'allowLibraryDocuments', 'allowPassages',
  'allowVectors', 'allowPrimarySources', 'allowTestimonies',
];
const PERMANENT_PUBLICATION_DENYLIST = new Set([
  'audio_clips', 'testimony_media', 'testimony_interview_media', 'social_contacts',
  'testimony_agreements', 'testimony_agreement_versions', 'teaching_groups', 'teaching_students',
  'teaching_assessment_plans', 'teaching_assessment_items', 'teaching_grade_entries',
  'teaching_rubric_evaluations', 'teaching_attendance', 'teaching_attendance_holidays', 'study_attempts', 'study_attempt_answers', 'study_grading_runs',
  'study_grading_annotations', 'study_mastery', 'study_reviews', 'study_srs_state',
]);
const USER_CONTENT_TABLES = new Set([
  'note_folders', 'notes', 'note_versions', 'workspace_library_links', 'pages', 'page_blocks',
  'page_favorites', 'page_links', 'page_revisions', 'page_comments', 'page_comment_reactions',
  'page_comment_mentions', 'workspace_actors', 'workspace_groups', 'workspace_group_members',
  'acl_entries', 'writing_saved_drafts', 'projects', 'project_sections', 'project_chapters',
  'project_chapter_versions', 'project_chapter_chunks', 'project_chapter_ideas',
  'project_chapter_idea_relations', 'project_links', 'project_insertion_suggestions',
  'saved_searches', 'immersion_sessions', 'dictionary_entries', 'dictionary_evidence',
  'dictionary_versions', 'dictionary_relations', 'decorative_images', 'content_translations',
]);
const PRIMARY_SOURCE_TABLES = new Set([
  'record_evidence', 'archive_folders', 'archive_items', 'archive_item_tags', 'archive_item_folders',
  'archive_item_persons', 'archive_repositories', 'archive_description_units', 'archive_item_units',
  'archive_item_profiles', 'archive_text_versions', 'archive_text_segments', 'archive_excerpts',
  'archive_person_mentions', 'archive_place_mentions', 'entity_resolutions', 'archive_source_analyses',
  'primary_source_note_profiles', 'primary_source_citation_settings',
]);
const TESTIMONY_TABLES = new Set([
  'testimony_interviews', 'testimony_transcripts', 'testimony_transcript_segments',
  'testimony_annotation_codes', 'testimony_codes', 'testimony_contrasts', 'testimony_contrast_items',
]);
const SECRET_COLUMN = /(?:api[-_]?keys?|access[-_]?tokens?|refresh[-_]?tokens?|id[-_]?tokens?|client[-_]?secrets?|passwords?|passphrases?|secrets?|credentials?|authorization|cookies?|private[-_]?keys?|signing[-_]?keys?|webhook[-_]?secrets?)/i;
const LOCAL_COLUMN = /(?:file[-_]?paths?|local[-_]?paths?|absolute[-_]?paths?|audio[-_]?keys?)|(?:^|[-_])path$/i;
const ACTION_SECRET_KEY = /(?:api[-_]?keys?|token|password|secret|credential|authorization|cookie|private[-_]?key)/i;

function isUserScopedMutationEntry(entry) {
  if (isUserScopedMutation(entry?.table)) return true;
  // Notes create a deterministic compatibility page. That page is part of the
  // same private entity even though native pages are shared vault content.
  const table = String(entry?.table || '');
  if (table === 'pages' && (
    (entry?.row?.note_id !== null && entry?.row?.note_id !== undefined && String(entry.row.note_id) !== '')
    || String(entry?.key?.[0] || '').startsWith('note:')
  )) return true;
  // Every row below a note-backed compatibility page is part of that same private entity.
  const pageColumns = table === 'page_links' ? ['from_page_id', 'to_page_id']
    : ['page_blocks', 'page_document_updates', 'page_revisions', 'page_comments'].includes(table) ? ['page_id'] : [];
  return pageColumns.some((column) => String(entry?.row?.[column] || '').startsWith('note:'));
}

function isSecretPublicationColumn(table, column) {
  // `secret_id` is a domain foreign key in Worldbuilding, not authentication material.
  if (column === 'secret_id' && (table === 'world_secrets' || table === 'secret_knowers')) return false;
  return SECRET_COLUMN.test(String(column).replace(/([a-z0-9])([A-Z])/g, '$1_$2'));
}

function isLocalPublicationColumn(column) {
  return LOCAL_COLUMN.test(String(column).replace(/([a-z0-9])([A-Z])/g, '$1_$2'));
}

function sanitizePublicationValue(value, table = '', depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactText(value);
  if (depth >= 20 || Buffer.isBuffer(value) || value instanceof Uint8Array) return null;
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => sanitizePublicationValue(entry, table, depth + 1, seen));
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSecretPublicationColumn(table, key) || isLocalPublicationColumn(key)) continue;
    output[key] = sanitizePublicationValue(entry, table, depth + 1, seen);
  }
  return output;
}

function containsSensitiveActionValue(value, depth = 0, seen = new WeakSet()) {
  if (depth > 20) return true;
  if (typeof value === 'string') return redactText(value) !== value;
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveActionValue(entry, depth + 1, seen));
  return Object.entries(value).some(([key, entry]) => (
    ACTION_SECRET_KEY.test(key) || containsSensitiveActionValue(entry, depth + 1, seen)
  ));
}

function authoritativeMutationRow(row, auth, space, store) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  const identity = {
    userid: auth.user.id, owneruserid: auth.user.id, ownerid: auth.user.id, actoruserid: auth.user.id,
    createdby: auth.user.id, updatedby: auth.user.id,
    vaultid: space.id, spaceid: space.id,
    origininstanceid: store.state.settings.instanceId,
    origindeviceid: auth.device?.hash || `oauth:${auth.user.id}`,
  };
  return Object.fromEntries(Object.entries(row).map(([column, value]) => (
    Object.hasOwn(identity, column.replaceAll('_', '').replaceAll('-', '').toLowerCase())
      ? [column, identity[column.replaceAll('_', '').replaceAll('-', '').toLowerCase()]] : [column, value]
  )));
}

/**
 * A size a person can act on, in the unit that distinguishes it from its neighbours.
 *
 * `mib()` is right for an image ceiling of 8 MiB and useless here: a 187 KiB report and a
 * 256 KiB limit both render as "0.2 MiB", so the sentence meant to end the guessing would have
 * printed the same number twice.
 */
function sizeLabel(bytes) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
/** Matches the desktop research assistant's ceiling (electron/ai/researchAssistant.ts). */
const MAX_CONTEXT_CHARS = 600_000;

export function createApiRoutes(ctx) {
  const {
    store, authorize, json, body, jsonBody, readSnapshot, invalidateSnapshot, expandSnapshot, privateAnnotations,
    publicUrl, resourceMap, language, rateLimit, clearRateLimit, limits, corpus, mib,
  } = ctx;

  const vectorCache = new Map();
  const mutationListeners = new Map();
  const presenceBySpace = new Map();

  function notifyMutationListeners(spaceId, cursor) {
    const encoded = `event: mutation\ndata: ${JSON.stringify({ cursor })}\n\n`;
    for (const response of mutationListeners.get(spaceId) ?? []) {
      try { response.write(encoded); } catch { /* close handler removes it */ }
    }
  }

  function notifyPresenceListeners(spaceId, count) {
    const encoded = `event: presence\ndata: ${JSON.stringify({ count })}\n\n`;
    for (const response of mutationListeners.get(spaceId) ?? []) {
      try { response.write(encoded); } catch { /* close handler removes it */ }
    }
  }

  function livePresence(spaceId) {
    const now = Date.now();
    const entries = presenceBySpace.get(spaceId) ?? new Map();
    for (const [key, value] of entries) if (value.expiresAt <= now) entries.delete(key);
    if (!entries.size) presenceBySpace.delete(spaceId);
    return entries;
  }

  async function updatePresence(req, res, space, auth) {
    const key = auth.device?.hash || `oauth:${auth.user.id}`;
    const entries = livePresence(space.id);
    if (req.method === 'DELETE') {
      entries.delete(key); notifyPresenceListeners(space.id, entries.size);
      json(res, 200, { ok: true }); return true;
    }
    if (req.method === 'GET') {
      json(res, 200, { participants: [...entries.values()].map(({ expiresAt, ...entry }) => entry) }); return true;
    }
    const input = await jsonBody(req, 16 * 1024);
    const cursor = input.cursor && typeof input.cursor === 'object' ? {
      anchor: Math.max(0, Math.floor(Number(input.cursor.anchor) || 0)),
      head: Math.max(0, Math.floor(Number(input.cursor.head) || 0)),
    } : null;
    const entry = {
      id: key.slice(0, 24), userId: auth.user.id, name: String(auth.device?.deviceName || auth.user.email).slice(0, 120),
      pageId: String(input.pageId || '').slice(0, 240) || null,
      blockId: String(input.blockId || '').slice(0, 240) || null,
      cursor, color: /^#[0-9a-f]{6}$/i.test(String(input.color || '')) ? String(input.color) : null,
      updatedAt: new Date().toISOString(), expiresAt: Date.now() + 45_000,
    };
    entries.set(key, entry); presenceBySpace.set(space.id, entries);
    notifyPresenceListeners(space.id, entries.size);
    json(res, 200, { ok: true, participant: { ...entry, expiresAt: undefined } }); return true;
  }

  function mutationEvents(req, res, space) {
    res.writeHead(200, securityHeaders({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'private, no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    }));
    res.write(`event: ready\ndata: ${JSON.stringify({ cursor: Number(space.mutationCursor || 0) })}\n\n`);
    let listeners = mutationListeners.get(space.id);
    if (!listeners) { listeners = new Set(); mutationListeners.set(space.id, listeners); }
    listeners.add(res);
    const heartbeat = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch { /* close follows */ } }, 25_000);
    heartbeat.unref?.();
    req.on('close', () => {
      clearInterval(heartbeat); listeners.delete(res); if (!listeners.size) mutationListeners.delete(space.id);
    });
    return true;
  }

  function spacesFor(user) {
    return store.state.memberships
      .filter((entry) => entry.userId === user.id)
      .map((entry) => {
        const space = store.state.spaces.find((candidate) => candidate.id === entry.spaceId);
        if (!space) return null;
        return {
          id: space.id,
          name: space.name,
          description: space.description ?? '',
          role: entry.role,
          vault: space.vault ?? null,
          vaultType: space.vaultType ?? space.vault?.type ?? 'academic',
          storageKind: space.storageKind ?? 'desktop_published',
          authorityMode: space.authorityMode ?? 'desktop',
          initializationState: space.initializationState ?? (space.storageKind === 'server_native' ? 'ready' : 'published'),
          updatedAt: space.updatedAt,
          revision: space.revision ?? '',
          schemaVersion: space.schemaVersion ?? 0,
          // How far the owner has acknowledged. A sender keeps the cursor its own POST
          // returned and compares, which is what lets a phone say "delivered" rather than
          // only "on the server". Readable by any member, and it reveals nothing but a
          // count. Only meaningful because nextSeq is seeded from this same value.
          mutationCursor: Number(space.mutationCursor || 0),
          hasSnapshot: Boolean(space.updatedAt),
        };
      })
      .filter(Boolean);
  }

  function capabilities() {
    return {
      api: 'v1',
      // The release this server is running. The desktop, the phone and this process ship as
      // one version, so a client that shows both side by side turns "it stopped working" into
      // "these two are not the same release".
      version: NODUS_VERSION,
      license: NODUS_LICENSE,
      sourceCodeUrl: NODUS_SOURCE_URL,
      server: { name: store.state.settings.name, publicUrl: publicUrl(), language: language(), version: NODUS_VERSION, license: NODUS_LICENSE, sourceCodeUrl: NODUS_SOURCE_URL },
      snapshotVersions: [1, 2],
      assets: true,
      libraryDocuments: true,
      desktopBridge: { protocol: '/bridge/v2', relay: true, relayProtocolVersion: 1, transport: 'end-to-end-encrypted-websocket', endpoint: '/api/v1/bridge-relay' },
      mutations: true,
      documentUpdates: 'content-addressed-binary',
      sharedBlobs: { transport: 'resumable-chunks', chunkBytes: SHARED_BLOB_CHUNK_BYTES, maxBytes: limits.maxLibraryPackageBytes },
      vectors: true,
      resources: resourceMap(),
      maxAssetBytes: limits.maxAssetBytes,
      maxSpaceAssetBytes: limits.maxSpaceAssetBytes,
      maxLibraryPackageBytes: limits.maxLibraryPackageBytes,
      maxSpaceLibraryBytes: limits.maxSpaceLibraryBytes,
      maxSnapshotBytes: limits.maxSnapshotBytes,
      maxSnapshotJsonBytes: limits.maxSnapshotJsonBytes,
      maxMutationBatch: MAX_MUTATION_BATCH,
      // Published so a client can measure a row before spending twenty minutes generating it.
      // Their absence is why the only way to discover this limit was to be refused by it.
      maxMutationBytes: limits.maxMutationBytes,
      maxMutationBatchBytes: limits.maxMutationBatchBytes,
      maxLedgerBytes: limits.maxLedgerBytes,
      mutationEvents: 'sse',
      presence: { transport: 'ephemeral-sse', ttlSeconds: 45 },
      spaceActions: { schemaVersion: 1, statuses: ['queued', 'claimed', 'running', 'applied', 'refused', 'failed', 'cancelled'] },
    };
  }

  // ── Replica authentication ────────────────────────────────────────────────
  // The pairing code stays for publishers: an owner should not type their password into the
  // desktop app. A reader creating a replica has no administrator to ask for a code, so they
  // sign in. Two steps, because the client cannot know the space ids in advance.

  async function login(req, res) {
    if (!rateLimit(req, res, 'device-login-global', 240, 5 * 60_000, 'all')) return true;
    if (!rateLimit(req, res, 'device-login-ip', 60, 15 * 60_000)) return true;
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    const identity = digest(String(input.email || '').trim().toLowerCase());
    if (!rateLimit(req, res, 'device-login-account', 10, 10 * 60_000, identity)) return true;
    const user = store.authenticate(input.email, input.password);
    if (!user) {
      json(res, 401, { error: 'invalid_credentials', error_description: 'That email and password do not match an account.' });
      return true;
    }
    clearRateLimit('device-login-account', identity);
    store.cleanup();
    const raw = token(24);
    store.state.authTickets.push({ hash: digest(raw), userId: user.id, expiresAt: new Date(Date.now() + TICKET_TTL_MS).toISOString(), usedAt: null });
    store.save();
    json(res, 200, {
      ticket: raw,
      expiresIn: Math.floor(TICKET_TTL_MS / 1000),
      user: { id: user.id, email: user.email, role: user.role },
      spaces: spacesFor(user),
      server: capabilities().server,
    });
    return true;
  }

  async function createDeviceToken(req, res) {
    if (!rateLimit(req, res, 'device-login-global', 240, 5 * 60_000, 'all')) return true;
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    store.cleanup();
    const ticket = store.state.authTickets.find((entry) => entry.hash === digest(String(input.ticket || '')) && !entry.usedAt);
    if (!ticket) {
      json(res, 401, { error: 'invalid_ticket', error_description: 'That sign-in ticket has expired or was already used.' });
      return true;
    }
    const spaceId = String(input.spaceId || '');
    const membership = store.state.memberships.find((entry) => entry.userId === ticket.userId && entry.spaceId === spaceId);
    const space = store.state.spaces.find((entry) => entry.id === spaceId);
    if (!membership || !space) {
      json(res, 403, { error: 'forbidden', error_description: 'You do not have access to that space.' });
      return true;
    }
    ticket.usedAt = new Date().toISOString();
    const raw = token();
    store.state.deviceTokens.push({
      hash: digest(raw),
      userId: ticket.userId,
      spaceId: space.id,
      kind: 'replica',
      deviceName: String(input.deviceName || 'Nodus replica').slice(0, 120),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      expiresAt: new Date(Date.now() + REPLICA_TOKEN_DAYS * 86400_000).toISOString(),
      grandfathered: false,
    });
    store.save();
    json(res, 200, {
      deviceToken: raw,
      space: { id: space.id, name: space.name, vault: space.vault ?? null, updatedAt: space.updatedAt, revision: space.revision ?? '' },
      role: membership.role,
      capabilities: capabilities(),
    });
    return true;
  }

  // ── Assets ────────────────────────────────────────────────────────────────

  function referencedAssets(spaceId) {
    const snapshot = readSnapshot(spaceId);
    const referenced = snapshot ? snapshotAssetHashes(snapshot) : new Set();
    for (const hash of ledger.pendingAssetHashes(store, spaceId)) referenced.add(hash);
    return referenced;
  }

  function documentUpdateExists(spaceId, hash) {
    return isValidAssetHash(hash) && ctx.fs.existsSync(store.documentUpdatePath(spaceId, hash));
  }

  function directoryBytes(root) {
    if (!ctx.fs.existsSync(root)) return 0;
    let total = 0;
    const pending = [root];
    while (pending.length) {
      const current = pending.pop();
      const stat = ctx.fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`Storage directory must not contain symbolic links: ${current}`);
      if (stat.isFile()) { total += stat.size; continue; }
      if (stat.isDirectory()) for (const name of ctx.fs.readdirSync(current)) pending.push(ctx.path.join(current, name));
    }
    return total;
  }

  function collectStaleBlobUploads(spaceId, now = Date.now()) {
    const root = store.sharedBlobUploadsDir(spaceId);
    if (!ctx.fs.existsSync(root)) return 0;
    let removed = 0;
    for (const name of ctx.fs.readdirSync(root)) {
      const dir = ctx.path.join(root, name);
      const stat = ctx.fs.lstatSync(dir);
      if (stat.isSymbolicLink()) throw new Error(`Blob upload directory must not be a symbolic link: ${dir}`);
      if (!stat.isDirectory() || now - stat.mtimeMs < 24 * 60 * 60_000) continue;
      ctx.fs.rmSync(dir, { recursive: true, force: true }); removed += 1;
    }
    return removed;
  }

  function reservedSharedBlobBytes(spaceId) {
    collectStaleBlobUploads(spaceId);
    let total = directoryBytes(store.sharedBlobsDir(spaceId));
    const root = store.sharedBlobUploadsDir(spaceId);
    if (!ctx.fs.existsSync(root)) return total;
    for (const name of ctx.fs.readdirSync(root)) {
      try {
        const manifest = JSON.parse(ctx.fs.readFileSync(ctx.path.join(root, name, 'manifest.json'), 'utf8'));
        total += Math.max(0, Number(manifest.totalBytes) || 0);
      } catch { /* malformed partials count against the actual partial-byte quota below */ }
    }
    return total;
  }

  async function uploadDocumentUpdate(req, res, space, hash) {
    if (!rateLimit(req, res, 'document-update-upload', 240, 60_000)) return true;
    if (!isValidAssetHash(hash)) {
      json(res, 400, { error: 'bad_hash' });
      return true;
    }
    const target = store.documentUpdatePath(space.id, hash);
    if (ctx.fs.existsSync(target)) {
      json(res, 200, { ok: true, deduplicated: true });
      return true;
    }
    const bytes = await body(req, limits.maxAssetBytes);
    if (hashBytes(bytes) !== hash) {
      json(res, 400, { error: 'hash_mismatch' });
      return true;
    }
    const used = directoryBytes(store.documentUpdatesDir(space.id));
    if (used + bytes.length > limits.maxSpaceDocumentUpdateBytes) {
      json(res, 507, { error: 'document_update_quota_exceeded', limitBytes: limits.maxSpaceDocumentUpdateBytes }); return true;
    }
    ctx.fs.mkdirSync(ctx.path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    ctx.fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    ctx.fs.renameSync(temporary, target);
    json(res, 200, { ok: true, deduplicated: false, bytes: bytes.length });
    return true;
  }

  function downloadDocumentUpdate(req, res, space, hash) {
    if (!documentUpdateExists(space.id, hash)) {
      json(res, 404, { error: 'not_found' });
      return true;
    }
    const bytes = ctx.fs.readFileSync(store.documentUpdatePath(space.id, hash));
    res.writeHead(200, securityHeaders({
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.length),
      'cache-control': 'private, immutable, max-age=31536000',
      etag: `"${hash}"`,
    }));
    if (req.method === 'HEAD') res.end(); else res.end(bytes);
    return true;
  }

  function sharedBlobExists(spaceId, hash) {
    return isValidAssetHash(hash) && ctx.fs.existsSync(store.sharedBlobPath(spaceId, hash));
  }

  function sharedBlobStatus(req, res, space, hash) {
    if (!isValidAssetHash(hash)) { json(res, 400, { error: 'bad_hash' }); return true; }
    collectStaleBlobUploads(space.id);
    const complete = sharedBlobExists(space.id, hash);
    const uploadDir = store.sharedBlobUploadDir(space.id, hash);
    let manifest = null;
    try { manifest = JSON.parse(ctx.fs.readFileSync(ctx.path.join(uploadDir, 'manifest.json'), 'utf8')); } catch { /* no partial upload */ }
    const received = [];
    if (!complete && manifest) {
      for (let index = 0; index < Number(manifest.totalChunks || 0); index += 1) {
        if (ctx.fs.existsSync(ctx.path.join(uploadDir, `${index}.part`))) received.push(index);
      }
    }
    json(res, 200, { complete, received, chunkBytes: SHARED_BLOB_CHUNK_BYTES, totalChunks: manifest?.totalChunks ?? null, totalBytes: manifest?.totalBytes ?? null });
    return true;
  }

  async function uploadSharedBlobChunk(req, res, space, hash, indexText) {
    if (!rateLimit(req, res, 'shared-blob-upload', 600, 60_000)) return true;
    const index = Number(indexText);
    const totalChunks = Number(req.headers['x-nodus-total-chunks']);
    const totalBytes = Number(req.headers['x-nodus-total-bytes']);
    const chunkHash = String(req.headers['x-nodus-chunk-sha256'] || '');
    if (!isValidAssetHash(hash) || !Number.isInteger(index) || index < 0
      || !Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > Math.ceil(limits.maxLibraryPackageBytes / SHARED_BLOB_CHUNK_BYTES)
      || index >= totalChunks || !Number.isInteger(totalBytes) || totalBytes < 0 || totalBytes > limits.maxLibraryPackageBytes
      || !isValidAssetHash(chunkHash)) {
      json(res, 400, { error: 'bad_chunk_metadata' }); return true;
    }
    if (sharedBlobExists(space.id, hash)) { json(res, 200, { ok: true, complete: true }); return true; }
    const bytes = await body(req, SHARED_BLOB_CHUNK_BYTES);
    if (hashBytes(bytes) !== chunkHash) { json(res, 400, { error: 'chunk_hash_mismatch' }); return true; }
    const expectedBytes = index === totalChunks - 1 ? totalBytes - index * SHARED_BLOB_CHUNK_BYTES : SHARED_BLOB_CHUNK_BYTES;
    if (bytes.length !== expectedBytes) { json(res, 400, { error: 'bad_chunk_size', expectedBytes }); return true; }
    const dir = store.sharedBlobUploadDir(space.id, hash);
    ctx.fs.mkdirSync(dir, { recursive: true });
    const manifestFile = ctx.path.join(dir, 'manifest.json');
    let manifest = null;
    try { manifest = JSON.parse(ctx.fs.readFileSync(manifestFile, 'utf8')); } catch { /* first chunk */ }
    if (manifest && (Number(manifest.totalChunks) !== totalChunks || Number(manifest.totalBytes) !== totalBytes)) {
      json(res, 409, { error: 'upload_shape_changed' }); return true;
    }
    if (!manifest) {
      if (reservedSharedBlobBytes(space.id) + totalBytes > limits.maxSpaceSharedBlobBytes) {
        json(res, 507, { error: 'shared_blob_quota_exceeded', limitBytes: limits.maxSpaceSharedBlobBytes }); return true;
      }
    }
    const target = ctx.path.join(dir, `${index}.part`);
    const existingBytes = ctx.fs.existsSync(target) ? ctx.fs.statSync(target).size : 0;
    const partialBytes = directoryBytes(store.sharedBlobUploadsDir(space.id));
    if (partialBytes - existingBytes + bytes.length > limits.maxSpacePartialBlobBytes) {
      if (!manifest) ctx.fs.rmSync(dir, { recursive: true, force: true });
      json(res, 507, { error: 'partial_blob_quota_exceeded', limitBytes: limits.maxSpacePartialBlobBytes }); return true;
    }
    if (!manifest) ctx.fs.writeFileSync(manifestFile, JSON.stringify({ hash, totalChunks, totalBytes, createdAt: new Date().toISOString() }), { mode: 0o600 });
    const temporary = `${target}.tmp-${process.pid}`;
    ctx.fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    ctx.fs.renameSync(temporary, target);
    json(res, 200, { ok: true, index, bytes: bytes.length });
    return true;
  }

  function completeSharedBlob(req, res, space, hash) {
    if (!isValidAssetHash(hash)) { json(res, 400, { error: 'bad_hash' }); return true; }
    if (sharedBlobExists(space.id, hash)) { json(res, 200, { ok: true, deduplicated: true }); return true; }
    const dir = store.sharedBlobUploadDir(space.id, hash);
    let manifest;
    try { manifest = JSON.parse(ctx.fs.readFileSync(ctx.path.join(dir, 'manifest.json'), 'utf8')); }
    catch { json(res, 409, { error: 'upload_not_started' }); return true; }
    const parts = [];
    for (let index = 0; index < Number(manifest.totalChunks); index += 1) {
      try { parts.push(ctx.fs.readFileSync(ctx.path.join(dir, `${index}.part`))); }
      catch { json(res, 409, { error: 'missing_chunks', missing: [index] }); return true; }
    }
    const bytes = Buffer.concat(parts);
    if (bytes.length !== Number(manifest.totalBytes) || hashBytes(bytes) !== hash) {
      json(res, 400, { error: 'blob_checksum_mismatch' }); return true;
    }
    const target = store.sharedBlobPath(space.id, hash);
    ctx.fs.mkdirSync(ctx.path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}`;
    ctx.fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    ctx.fs.renameSync(temporary, target);
    ctx.fs.rmSync(dir, { recursive: true, force: true });
    json(res, 200, { ok: true, deduplicated: false, bytes: bytes.length });
    return true;
  }

  function downloadSharedBlob(req, res, space, hash) {
    if (!sharedBlobExists(space.id, hash)) { json(res, 404, { error: 'not_found' }); return true; }
    const file = store.sharedBlobPath(space.id, hash);
    const bytes = ctx.fs.readFileSync(file);
    let start = 0; let end = bytes.length - 1; let status = 200;
    const range = String(req.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      start = Number(range[1]); end = range[2] ? Math.min(bytes.length - 1, Number(range[2])) : bytes.length - 1;
      if (!Number.isInteger(start) || start < 0 || start > end || start >= bytes.length) {
        res.writeHead(416, securityHeaders({ 'content-range': `bytes */${bytes.length}` })); res.end(); return true;
      }
      status = 206;
    }
    const slice = bytes.subarray(start, end + 1);
    res.writeHead(status, securityHeaders({
      'content-type': 'application/octet-stream', 'content-length': String(slice.length),
      'accept-ranges': 'bytes', ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}),
      etag: `"${hash}"`, 'cache-control': 'private, immutable, max-age=31536000',
    }));
    if (req.method === 'HEAD') res.end(); else res.end(slice);
    return true;
  }

  async function negotiateAssets(req, res, space) {
    const input = await jsonBody(req, 1024 * 1024);
    const wanted = Array.isArray(input.assets) ? input.assets : [];
    const missing = [];
    for (const asset of wanted) {
      const hash = String(asset?.hash ?? '');
      if (!isValidAssetHash(hash)) continue;
      if (Number(asset?.bytes) > limits.maxAssetBytes) continue;
      if (!assetExists(store, space.id, hash)) missing.push(hash);
    }
    json(res, 200, { missing: [...new Set(missing)] });
    return true;
  }

  async function uploadAsset(req, res, space, hash) {
    if (!isValidAssetHash(hash)) {
      json(res, 400, { error: 'bad_hash', error_description: 'An asset is addressed by the lowercase hex sha256 of its bytes.' });
      return true;
    }
    if (assetExists(store, space.id, hash)) {
      json(res, 200, { ok: true, deduplicated: true });
      return true;
    }
    const announced = Number(req.headers['content-length'] || 0);
    if (announced > limits.maxAssetBytes) {
      json(res, 413, { error: 'too_large', error_description: `This server accepts images of up to ${mib(limits.maxAssetBytes)} (NODUS_MAX_ASSET_BYTES).`, limitBytes: limits.maxAssetBytes });
      return true;
    }
    if (Number(space.assetBytes || 0) + announced > limits.maxSpaceAssetBytes) {
      json(res, 507, { error: 'space_full', error_description: `This space has reached its image budget of ${mib(limits.maxSpaceAssetBytes)} (NODUS_MAX_SPACE_ASSET_BYTES).`, limitBytes: limits.maxSpaceAssetBytes });
      return true;
    }
    const bytes = await body(req, limits.maxAssetBytes);
    if (hashBytes(bytes) !== hash) {
      json(res, 400, { error: 'hash_mismatch', error_description: 'The uploaded bytes do not hash to the address they were sent to.' });
      return true;
    }
    // The client is not trusted about what it is sending. Only four image formats get in,
    // and the RIFF check reads bytes 8..12 so a WAV cannot pass itself off as a WEBP.
    const mime = sniffImageMime(bytes);
    if (!mime) {
      json(res, 415, { error: 'unsupported_media_type', error_description: 'Only PNG, JPEG, WEBP and GIF images may be published. Documents and audio never travel to the server.' });
      return true;
    }
    writeAsset(store, space.id, hash, bytes);
    space.assetBytes = Number(space.assetBytes || 0) + bytes.length;
    store.save();
    json(res, 200, { ok: true, deduplicated: false, mime, bytes: bytes.length });
    return true;
  }

  // ── Published global library ─────────────────────────────────────────────

  function libraryManifest(spaceId) {
    const value = readSnapshot(spaceId)?.library;
    return value?.format === 'nodus.server-library' && Number(value?.formatVersion) === 1
      ? value
      : null;
  }

  async function negotiateLibraryPackages(req, res, space) {
    const input = await jsonBody(req, 1024 * 1024);
    const wanted = Array.isArray(input.packages) ? input.packages : [];
    const missing = [];
    for (const entry of wanted) {
      const hash = String(entry?.hash ?? '');
      const bytes = Number(entry?.bytes ?? 0);
      if (!isValidLibraryPackageHash(hash) || bytes <= 0 || bytes > limits.maxLibraryPackageBytes) continue;
      if (!libraryPackageExists(store, space.id, hash)) missing.push(hash);
    }
    json(res, 200, { missing: [...new Set(missing)] });
    return true;
  }

  async function uploadLibraryPackage(req, res, space, hash) {
    if (!isValidLibraryPackageHash(hash)) {
      json(res, 400, { error: 'bad_hash', error_description: 'A library package is addressed by the lowercase hex sha256 of its bytes.' });
      return true;
    }
    if (libraryPackageExists(store, space.id, hash)) {
      json(res, 200, { ok: true, deduplicated: true });
      return true;
    }
    const announced = Number(req.headers['content-length'] || 0);
    if (announced > limits.maxLibraryPackageBytes) {
      json(res, 413, { error: 'too_large', error_description: `This server accepts one library reading package of up to ${mib(limits.maxLibraryPackageBytes)} (NODUS_MAX_LIBRARY_PACKAGE_BYTES).`, limitBytes: limits.maxLibraryPackageBytes });
      return true;
    }
    if (Number(space.libraryPackageBytes || 0) + announced > limits.maxSpaceLibraryBytes) {
      json(res, 507, { error: 'space_full', error_description: `This space has reached its published-library budget of ${mib(limits.maxSpaceLibraryBytes)} (NODUS_MAX_SPACE_LIBRARY_BYTES).`, limitBytes: limits.maxSpaceLibraryBytes });
      return true;
    }
    const bytes = await body(req, limits.maxLibraryPackageBytes);
    if (Number(space.libraryPackageBytes || 0) + bytes.length > limits.maxSpaceLibraryBytes) {
      json(res, 507, { error: 'space_full', error_description: `This space has reached its published-library budget of ${mib(limits.maxSpaceLibraryBytes)} (NODUS_MAX_SPACE_LIBRARY_BYTES).`, limitBytes: limits.maxSpaceLibraryBytes });
      return true;
    }
    if (hashLibraryPackage(bytes) !== hash) {
      json(res, 400, { error: 'hash_mismatch', error_description: 'The uploaded bytes do not hash to the address they were sent to.' });
      return true;
    }
    if (!looksLikeZip(bytes)) {
      json(res, 415, { error: 'unsupported_media_type', error_description: 'A published library document must be a ZIP containing Clean Markdown and/or one supported original.' });
      return true;
    }
    const inspection = inspectLibraryPackage(bytes);
    if (!inspection.ok) {
      json(res, 415, { error: 'invalid_library_package', error_description: inspection.reason });
      return true;
    }
    writeLibraryPackage(store, space.id, hash, bytes);
    space.libraryPackageBytes = Number(space.libraryPackageBytes || 0) + bytes.length;
    store.save();
    json(res, 200, { ok: true, deduplicated: false, bytes: bytes.length });
    return true;
  }

  function libraryUnavailable(res) {
    json(res, 409, { error: 'library_not_published', error_description: 'The owner has not enabled library publication for this space.' });
    return true;
  }

  function librarySummary(req, res, space) {
    const library = libraryManifest(space.id);
    if (!library) {
      json(res, 200, {
        published: false, generatedAt: null, collections: 0, documents: 0,
        downloadableDocuments: 0, packageBytes: 0,
      });
      return true;
    }
    const documents = Array.isArray(library.documents) ? library.documents : [];
    json(res, 200, {
      published: true,
      generatedAt: library.generatedAt,
      collections: Array.isArray(library.collections) ? library.collections.length : 0,
      documents: documents.length,
      downloadableDocuments: documents.filter((document) => document?.cleanAvailable || document?.originalAvailable).length,
      packageBytes: documents.reduce((sum, document) => sum + Math.max(0, Number(document?.packageBytes) || 0), 0),
    });
    return true;
  }

  function validatePublishedLibrary(spaceId, library) {
    if (library == null) return null;
    if (library?.format !== 'nodus.server-library' || Number(library?.formatVersion) !== 1
        || !Array.isArray(library.collections) || !Array.isArray(library.documents)) {
      return { status: 400, error: 'invalid_library', error_description: 'The published library manifest is malformed.' };
    }
    const ids = new Set();
    for (const document of library.documents) {
      const id = String(document?.id ?? '');
      if (!id || ids.has(id)) return { status: 400, error: 'invalid_library', error_description: 'Every published library document needs a unique id.' };
      ids.add(id);
      const hash = String(document?.packageHash ?? '');
      const needsPackage = Boolean(document?.cleanAvailable || document?.originalAvailable);
      if (needsPackage && (!isValidLibraryPackageHash(hash) || !libraryPackageExists(store, spaceId, hash))) {
        return { status: 409, error: 'package_unavailable', error_description: `The published reading package for ${id} has not reached the server.` };
      }
      if (hash && !isValidLibraryPackageHash(hash)) return { status: 400, error: 'invalid_library', error_description: `The package fingerprint for ${id} is invalid.` };
      if (needsPackage) {
        const packageBytes = readLibraryPackage(store, spaceId, hash);
        const inspection = packageBytes ? inspectLibraryPackage(packageBytes) : null;
        if (!inspection?.ok || String(inspection.manifest?.documentId ?? '') !== id) {
          return { status: 409, error: 'package_mismatch', error_description: `The reading package for ${id} is invalid or belongs to a different document.` };
        }
        if (Number(inspection.manifest?.formatVersion) >= 2
            && (Boolean(document?.cleanAvailable) !== Boolean(inspection.hasMarkdown)
              || Boolean(document?.originalAvailable) !== Boolean(inspection.hasOriginal))) {
          return { status: 409, error: 'package_mismatch', error_description: `The reading formats declared for ${id} do not match its package.` };
        }
      }
    }
    return null;
  }

  function libraryCollections(req, res, space) {
    const library = libraryManifest(space.id);
    // An authorised space without a library publication is a valid empty
    // catalogue, not a failed request. This distinction lets Server Web render
    // its normal empty state while the owner has not published any documents.
    if (!library) {
      json(res, 200, { collections: [], published: false, generatedAt: null });
      return true;
    }
    json(res, 200, { collections: Array.isArray(library.collections) ? library.collections : [], generatedAt: library.generatedAt });
    return true;
  }

  function libraryDocuments(req, res, space, url) {
    const library = libraryManifest(space.id);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    if (!library) {
      json(res, 200, { items: [], total: 0, limit, offset, hasMore: false, published: false, generatedAt: null });
      return true;
    }
    const query = String(url.searchParams.get('q') || '').trim().toLocaleLowerCase();
    const collectionId = String(url.searchParams.get('collectionId') || '');
    const all = (Array.isArray(library.documents) ? library.documents : []).filter((document) => {
      if (collectionId && !(Array.isArray(document?.collectionIds) && document.collectionIds.includes(collectionId))) return false;
      if (!query) return true;
      return [document?.title, document?.abstract, ...(Array.isArray(document?.creators) ? document.creators : []), ...(Array.isArray(document?.tags) ? document.tags : [])]
        .filter(Boolean).join('\n').toLocaleLowerCase().includes(query);
    });
    json(res, 200, { items: all.slice(offset, offset + limit), total: all.length, limit, offset, hasMore: offset + limit < all.length, generatedAt: library.generatedAt });
    return true;
  }

  function libraryDocument(req, res, space, documentId) {
    const library = libraryManifest(space.id);
    if (!library) return libraryUnavailable(res);
    const document = (Array.isArray(library.documents) ? library.documents : []).find((entry) => String(entry?.id) === documentId);
    if (!document) {
      json(res, 404, { error: 'document_not_found' });
      return true;
    }
    json(res, 200, { document, generatedAt: library.generatedAt });
    return true;
  }

  function downloadLibraryDocument(req, res, space, documentId) {
    const library = libraryManifest(space.id);
    if (!library) return libraryUnavailable(res);
    const document = (Array.isArray(library.documents) ? library.documents : []).find((entry) => String(entry?.id) === documentId);
    if (!document) {
      json(res, 404, { error: 'document_not_found' });
      return true;
    }
    const hash = String(document.packageHash ?? '');
    const bytes = readLibraryPackage(store, space.id, hash);
    if (!bytes) {
      json(res, 409, { error: 'package_unavailable', error_description: 'The reading package has not reached the server yet.' });
      return true;
    }
    const title = String(document.title || 'document').replace(/[\\/\r\n";]/g, ' ').trim().slice(0, 120) || 'document';
    const encodedTitle = encodeURIComponent(`${title}.zip`).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    const tag = `"${hash}"`;
    if (req.headers['if-none-match'] === tag) {
      res.writeHead(304, securityHeaders({ etag: tag })); res.end(); return true;
    }
    res.writeHead(200, securityHeaders({
      'content-type': 'application/zip',
      'content-length': String(bytes.length),
      // filename is the conservative ASCII fallback; filename* carries the real Unicode title.
      'content-disposition': `attachment; filename="document.zip"; filename*=UTF-8''${encodedTitle}`,
      'cache-control': 'private, max-age=31536000, immutable',
      etag: tag,
    }));
    if (req.method === 'HEAD') res.end(); else res.end(bytes);
    return true;
  }

  function libraryDocumentPackage(space, documentId) {
    const library = libraryManifest(space.id);
    const document = (Array.isArray(library?.documents) ? library.documents : []).find((entry) => String(entry?.id) === documentId);
    if (!document) return { error: 'document_not_found' };
    const bytes = readLibraryPackage(store, space.id, String(document.packageHash ?? ''));
    if (!bytes) return { error: 'package_unavailable' };
    return { document, bytes };
  }

  function inlineLibraryContent(req, res, space, documentId, kind, assetPath = '') {
    const packaged = libraryDocumentPackage(space, documentId);
    if (packaged.error) {
      json(res, packaged.error === 'document_not_found' ? 404 : 409, { error: packaged.error });
      return true;
    }
    let content = null;
    let mime = 'application/octet-stream';
    let filename = 'document';
    if (kind === 'content') {
      content = readLibraryPackageEntry(packaged.bytes, 'document.md');
      mime = 'text/markdown; charset=utf-8'; filename = 'document.md';
    } else if (kind === 'original') {
      const original = libraryPackageOriginalEntry(packaged.bytes);
      content = original?.content ?? null;
      const extension = String(original?.path || '').split('.').pop()?.toLowerCase();
      const extensionMime = ({ pdf: 'application/pdf', epub: 'application/epub+zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8', html: 'text/plain; charset=utf-8', htm: 'text/plain; charset=utf-8' })[extension];
      mime = String(packaged.document.originalMimeType || original?.manifest?.mimeType || extensionMime || 'application/octet-stream');
      filename = String(packaged.document.originalFileName || original?.manifest?.fileName || original?.path?.split('/').pop() || 'document');
    } else if (kind === 'asset') {
      let decoded;
      try { decoded = decodeURIComponent(assetPath); } catch { decoded = ''; }
      if (!/^assets\/[A-Za-z0-9._/-]{1,512}$/.test(decoded) || decoded.split('/').some((part) => part === '..')) {
        json(res, 400, { error: 'bad_asset_path' }); return true;
      }
      content = readLibraryPackageEntry(packaged.bytes, decoded);
      const extension = decoded.split('.').pop()?.toLowerCase();
      mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' })[extension] || 'application/octet-stream';
      filename = decoded.split('/').pop() || 'figure';
    }
    if (!content) { json(res, 404, { error: 'content_not_available' }); return true; }
    const safeName = filename.replace(/[\\/\r\n"]/g, '_').slice(0, 160) || 'document';
    res.writeHead(200, securityHeaders({
      'content-type': mime,
      'content-length': String(content.length),
      'content-disposition': `inline; filename="${safeName}"`,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'referrer-policy': 'no-referrer',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'cross-origin-resource-policy': 'same-origin',
      'content-security-policy': kind === 'original' && mime === 'application/pdf'
        ? "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; sandbox"
        : "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; sandbox",
    }));
    if (req.method === 'HEAD') res.end(); else res.end(content);
    return true;
  }

  function downloadAsset(req, res, space, hash) {
    const asset = readAsset(store, space.id, hash);
    if (!asset) {
      json(res, 404, { error: 'not_found' });
      return true;
    }
    const tag = `"${hash}"`;
    if (req.headers['if-none-match'] === tag) {
      res.writeHead(304, securityHeaders({ etag: tag }));
      res.end();
      return true;
    }
    res.writeHead(200, securityHeaders({
      'content-type': asset.mime,
      'content-length': String(asset.bytes.length),
      etag: tag,
      // Content-addressed, so the bytes behind a URL can never change.
      'cache-control': 'private, max-age=31536000, immutable',
      'content-disposition': 'attachment',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'referrer-policy': 'no-referrer',
    }));
    if (req.method === 'HEAD') res.end();
    else res.end(asset.bytes);
    return true;
  }

  // ── Vectors and semantic search ───────────────────────────────────────────

  function loadVectors(spaceId, kind) {
    const file = store.vectorsPath(spaceId, kind);
    const fs = ctx.fs;
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    const cached = vectorCache.get(`${spaceId}:${kind}`);
    if (cached?.mtimeMs === stat.mtimeMs) return cached.set;
    try {
      const set = decodeVectorSet(fs.readFileSync(file));
      vectorCache.set(`${spaceId}:${kind}`, { mtimeMs: stat.mtimeMs, set });
      return set;
    } catch {
      return null;
    }
  }

  async function uploadVectors(req, res, space) {
    const kind = String(new URL(req.url, publicUrl()).searchParams.get('kind') || 'ideas');
    let bytes = await body(req, limits.maxVectorBytes);
    // The matrix is highly compressible and the desktop sends it gzipped, exactly like a
    // snapshot. Decoding the raw body would fail on the header before saying anything useful.
    if (req.headers['content-encoding'] === 'gzip') {
      try { bytes = ctx.gunzip(bytes, limits.maxVectorBytes); }
      catch {
        json(res, 400, { error: 'bad_vectors', error_description: 'The payload declares gzip but could not be decompressed.' });
        return true;
      }
    }
    let set;
    try { set = decodeVectorSet(bytes); }
    catch (error) {
      json(res, 400, { error: 'bad_vectors', error_description: error instanceof Error ? error.message : String(error) });
      return true;
    }
    if (set.header.kind !== kind) {
      json(res, 400, { error: 'kind_mismatch', error_description: `The payload declares kind "${set.header.kind}" but the request asked for "${kind}".` });
      return true;
    }
    let contract;
    try {
      contract = set.header.embeddingContract
        ? createEmbeddingContract(set.header.embeddingContract)
        : migrateLegacyVectorV1Header(set.header);
    } catch (error) {
      json(res, 400, { error: 'invalid_embedding_contract', error_description: error instanceof Error ? error.message : String(error) });
      return true;
    }
    const contracts = space.embeddingContracts && typeof space.embeddingContracts === 'object' ? space.embeddingContracts : {};
    const existing = contracts[kind]?.contract;
    if (existing && !embeddingContractsCompatible(existing, contract)) {
      json(res, 409, {
        error: 'embedding_contract_locked',
        error_description: 'This index is already locked to a different embedding contract. Rebuild it explicitly instead of mixing incompatible vectors.',
        expectedFingerprint: contracts[kind].fingerprint,
        receivedFingerprint: fingerprintEmbeddingContract(contract),
      });
      return true;
    }
    ctx.fs.writeFileSync(store.vectorsPath(space.id, kind), bytes, { mode: 0o600 });
    space.embeddingContracts = {
      ...contracts,
      [kind]: { contract, fingerprint: fingerprintEmbeddingContract(contract), lockedAt: contracts[kind]?.lockedAt || new Date().toISOString() },
    };
    store.save();
    vectorCache.delete(`${space.id}:${kind}`);
    json(res, 200, {
      ok: true, kind, count: set.count, dim: set.dim,
      provider: set.header.provider, model: set.header.model,
      embeddingContract: space.embeddingContracts[kind],
    });
    return true;
  }

  async function semanticSearch(req, res, space) {
    if (!rateLimit(req, res, 'semantic-search', 30, 60_000)) return true;
    const input = await jsonBody(req, VECTOR_QUERY_BYTES);
    const kind = String(input.kind || 'ideas');
    const snapshot = readSnapshot(space.id);
    if (!snapshot) {
      json(res, 409, { error: 'not_published' });
      return true;
    }
    const set = loadVectors(space.id, kind);
    const requested = { provider: String(input.provider || ''), model: String(input.model || ''), dim: Number(input.dim || 0) };

    // An empty list is never allowed to stand in for "this space has no index" or "your
    // provider does not match mine". Reporting absence of evidence from a search that never
    // ran is the exact failure the desktop contract already forbids.
    if (!set) {
      json(res, 200, {
        results: lexicalSearch(snapshot, input.query, Math.min(50, Number(input.limit) || 20)),
        indexed: false,
        reason: 'no_vectors',
        fallback: 'lexical',
        warning: 'This space has not published semantic vectors, so these results come from a literal text search. An empty result does NOT mean the corpus lacks the topic.',
      });
      return true;
    }
    const locked = space.embeddingContracts?.[kind] ?? null;
    const suppliedContract = input.embeddingContract;
    const exactContract = locked && suppliedContract ? embeddingContractsCompatible(locked.contract, suppliedContract) : false;
    const legacyCompatible = locked?.contract?.protocol === 'legacy_locked' && embeddingMatches(set.header, requested);
    if (!exactContract && !legacyCompatible) {
      json(res, 200, {
        results: lexicalSearch(snapshot, input.query, Math.min(50, Number(input.limit) || 20)),
        indexed: false,
        reason: 'provider_mismatch',
        expected: {
          provider: set.header.provider, model: set.header.model, dim: set.dim,
          ...(locked ? { contract: locked.contract, fingerprint: locked.fingerprint } : {}),
        },
        received: suppliedContract ? { fingerprint: (() => { try { return fingerprintEmbeddingContract(suppliedContract); } catch { return null; } })() } : requested,
        fallback: 'lexical',
        warning: 'This space is indexed with a different embedding provider or model, so its vectors cannot be compared with yours. These results come from a literal text search instead.',
      });
      return true;
    }
    const vector = Array.isArray(input.vector) ? input.vector : [];
    if (vector.length !== set.dim) {
      json(res, 400, { error: 'bad_vector', error_description: `This space is indexed at ${set.dim} dimensions and the query vector has ${vector.length}.` });
      return true;
    }
    // Off the event loop: the dot products are the one piece of work here that is measured in
    // hundreds of milliseconds, and every other request on the server waits behind it.
    const matches = await searchVectorsOffThread(set, vector, {
      limit: Math.max(1, Math.min(100, Number(input.limit) || 20)),
      threshold: Number.isFinite(Number(input.threshold)) ? Number(input.threshold) : 0,
    });
    const source = kind === 'ideas'
      ? { table: 'ideas', idColumn: 'global_id' }
      : kind === 'documents'
        ? { table: 'document_vectors', idColumn: 'vector_id' }
        : { table: 'passages', idColumn: 'passage_id' };
    const { table, idColumn } = source;
    const byId = new Map(rows(snapshot, table).map((row) => [String(row[idColumn]), row]));
    json(res, 200, {
      results: matches.map((match) => ({ id: match.id, score: match.score, row: byId.get(String(match.id)) ?? null })),
      indexed: true,
      kind,
      indexable: set.count,
      embedding: locked ?? { provider: set.header.provider, model: set.header.model, dim: set.dim },
    });
    return true;
  }

  /**
   * The retrieval package for a client-side chat.
   *
   * The phone calls its own provider with its own key; the server never sees that key and
   * must not, or state.json becomes the first place in this project to hold a third-party
   * credential. So what comes back is the material and the budget, not an answer.
   */
  async function contextPackage(req, res, space) {
    const input = await jsonBody(req, VECTOR_QUERY_BYTES);
    const snapshot = readSnapshot(space.id);
    if (!snapshot) {
      json(res, 409, { error: 'not_published' });
      return true;
    }
    const requestedBudget = input.budget ?? input.maxChars;
    const budget = Math.min(MAX_CONTEXT_CHARS, Math.max(1000, Number(requestedBudget) || MAX_CONTEXT_CHARS));
    const sections = [];
    let used = 0;
    let truncated = false;

    const push = (kind, items) => {
      const kept = [];
      for (const item of items) {
        const cost = JSON.stringify(item).length;
        if (used + cost > budget) { truncated = true; break; }
        used += cost;
        kept.push(item);
      }
      if (kept.length) sections.push({ kind, items: kept });
    };

    const wanted = new Set(Array.isArray(input.include) && input.include.length ? input.include : [
      'ideas', 'passages', 'themes', 'gaps', 'works',
      'document_profile_versions', 'document_profile_fields', 'document_sections',
    ]);
    const hits = lexicalSearch(snapshot, input.query, 200);
    const hitIds = new Set(hits.map((hit) => String(hit.id)));

    if (wanted.has('ideas')) push('ideas', rows(snapshot, 'ideas').filter((row) => hitIds.has(String(row.global_id))));
    if (wanted.has('passages')) push('passages', rows(snapshot, 'passages').filter((row) => hitIds.has(String(row.passage_id))));
    if (wanted.has('themes')) push('themes', rows(snapshot, 'themes'));
    if (wanted.has('gaps')) push('gaps', rows(snapshot, 'gaps').filter((row) => hitIds.has(String(row.id))));
    if (wanted.has('works')) push('works', rows(snapshot, 'works').filter((row) => hitIds.has(String(row.nodus_id))));
    if (wanted.has('document_profile_versions')) push('document_profile_versions', rows(snapshot, 'document_profile_versions').filter((row) => hitIds.has(String(row.version_id))));
    if (wanted.has('document_profile_fields')) push('document_profile_fields', rows(snapshot, 'document_profile_fields').filter((row) => hitIds.has(String(row.field_id))));
    if (wanted.has('document_sections')) push('document_sections', rows(snapshot, 'document_sections').filter((row) => hitIds.has(String(row.section_id))));

    json(res, 200, {
      sections,
      stats: { chars: used, budget, truncated, matched: hits.length },
      vault: snapshot.vault ?? null,
      revision: space.revision,
      // A citation always resolves against real corpus rows, never against model output.
      citationScheme: { idea: 'nodus://idea/<global_id>', passage: 'nodus://passage/<passage_id>', work: 'nodus://work/<nodus_id>' },
      documentProfilePolicy: 'orientation_only',
    });
    return true;
  }

  // ── Desktop actions ───────────────────────────────────────────────────────
  // Keep the classic server's wire contract identical to the Cloudflare worker. Mobile queues
  // typed work here; the paired Desktop claims it and reports the terminal result later.

  function actionView(action) {
    return {
      id: action.id,
      sequence: Number(action.sequence),
      spaceId: action.spaceId,
      idempotencyKey: action.idempotencyKey,
      kind: action.kind,
      schemaVersion: Number(action.schemaVersion),
      payload: action.payload,
      actorUserId: action.actorUserId,
      createdByDevice: action.createdByDevice,
      inputRevision: action.inputRevision,
      inputFingerprint: action.inputFingerprint,
      status: action.status,
      claimedByDevice: action.claimedByDevice,
      result: action.result,
      errorCode: action.errorCode,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      claimedAt: action.claimedAt,
      finishedAt: action.finishedAt,
    };
  }

  function actionVisible(auth, action) {
    // Vault ownership grants authority over shared vault data, never over another
    // member's prompts, job payloads or results.
    return action.actorUserId === auth.user.id;
  }

  function spaceActions() {
    if (!Array.isArray(store.state.spaceActions)) store.state.spaceActions = [];
    return store.state.spaceActions;
  }

  async function createSpaceAction(req, res, space, auth) {
    if (!rateLimit(req, res, 'space-actions-create', 120, 60_000)) return true;
    const input = await jsonBody(req, ACTION_BODY_BYTES);
    const id = String(input.id || `act_${token(16)}`);
    const idempotencyKey = String(input.idempotencyKey || '');
    const kind = String(input.kind || '');
    const schemaVersion = Number(input.schemaVersion);
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(id) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(idempotencyKey)) {
      json(res, 400, { error: 'bad_id', error_description: 'Action and idempotency identifiers must be 1–128 safe characters.' });
      return true;
    }
    if (!ACTION_KINDS.has(kind)) {
      json(res, 400, { error: 'unknown_action_kind', error_description: 'This action kind is not part of the typed Nodus contract.' });
      return true;
    }
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      json(res, 400, { error: 'bad_schema_version' });
      return true;
    }
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      json(res, 400, { error: 'bad_payload' });
      return true;
    }
    if (containsSensitiveActionValue(input.payload)) {
      json(res, 400, { error: 'payload_contains_secret', error_description: 'Credentials and authorization material are not accepted in vault actions.' });
      return true;
    }
    const actions = spaceActions();
    const duplicate = actions.find((action) => action.spaceId === space.id && action.idempotencyKey === idempotencyKey);
    if (duplicate) {
      if (duplicate.kind !== kind || Number(duplicate.schemaVersion) !== schemaVersion || JSON.stringify(duplicate.payload) !== JSON.stringify(input.payload)) {
        json(res, 409, { error: 'idempotency_conflict' });
        return true;
      }
      json(res, 200, { action: actionView(duplicate), duplicate: true });
      return true;
    }
    const now = new Date().toISOString();
    const sequence = actions.reduce((highest, action) => action.spaceId === space.id ? Math.max(highest, Number(action.sequence) || 0) : highest, 0) + 1;
    const action = {
      id,
      sequence,
      spaceId: space.id,
      idempotencyKey,
      kind,
      schemaVersion,
      payload: input.payload,
      actorUserId: auth.user.id,
      createdByDevice: auth.device?.hash ?? null,
      inputRevision: input.inputRevision == null ? null : String(input.inputRevision),
      inputFingerprint: input.inputFingerprint == null ? null : String(input.inputFingerprint),
      status: 'queued',
      claimedByDevice: null,
      result: null,
      errorCode: null,
      createdAt: now,
      updatedAt: now,
      claimedAt: null,
      finishedAt: null,
    };
    actions.push(action);
    store.save();
    json(res, 201, { action: actionView(action), duplicate: false });
    return true;
  }

  function listSpaceActions(req, res, space, auth, url) {
    const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
    const visible = spaceActions()
      .filter((action) => action.spaceId === space.id && action.sequence > since && actionVisible(auth, action))
      .sort((left, right) => left.sequence - right.sequence);
    const page = visible.slice(0, limit);
    json(res, 200, { actions: page.map(actionView), cursor: Number(page.at(-1)?.sequence || since), hasMore: visible.length > limit });
    return true;
  }

  function getSpaceAction(req, res, space, auth, id) {
    const action = spaceActions().find((candidate) => candidate.spaceId === space.id && candidate.id === id);
    if (!action || !actionVisible(auth, action)) { json(res, 404, { error: 'action_not_found' }); return true; }
    json(res, 200, { action: actionView(action) });
    return true;
  }

  async function cancelSpaceAction(req, res, space, auth, id) {
    const action = spaceActions().find((candidate) => candidate.spaceId === space.id && candidate.id === id);
    if (!action || !actionVisible(auth, action)) { json(res, 404, { error: 'action_not_found' }); return true; }
    if (ACTION_TERMINAL.has(action.status)) { json(res, 200, { action: actionView(action), changed: false }); return true; }
    if (!['queued', 'claimed'].includes(action.status)) { json(res, 409, { error: 'action_running' }); return true; }
    const now = new Date().toISOString();
    Object.assign(action, { status: 'cancelled', updatedAt: now, finishedAt: now });
    store.save();
    json(res, 200, { action: actionView(action), changed: true });
    return true;
  }

  async function claimSpaceAction(req, res, space, auth) {
    if (!auth.device || auth.device.kind !== 'publisher') { json(res, 403, { error: 'publisher_required' }); return true; }
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    const requested = input.id == null ? null : String(input.id);
    const action = spaceActions().find((candidate) => candidate.spaceId === space.id
      && candidate.actorUserId === auth.user.id && candidate.status === 'queued'
      && (!requested || candidate.id === requested));
    if (!action) { json(res, 200, { action: null }); return true; }
    const now = new Date().toISOString();
    Object.assign(action, { status: 'claimed', claimedByDevice: auth.device.hash, claimedAt: now, updatedAt: now });
    store.save();
    json(res, 200, { action: actionView(action) });
    return true;
  }

  async function updateSpaceAction(req, res, space, auth, id) {
    if (!auth.device || auth.device.kind !== 'publisher') { json(res, 403, { error: 'publisher_required' }); return true; }
    const input = await jsonBody(req, ACTION_BODY_BYTES);
    const status = String(input.status || '');
    if (!['running', 'applied', 'refused', 'failed'].includes(status)) { json(res, 400, { error: 'bad_action_status' }); return true; }
    const action = spaceActions().find((candidate) => candidate.spaceId === space.id && candidate.id === id);
    if (!action) { json(res, 404, { error: 'action_not_found' }); return true; }
    if (action.claimedByDevice !== auth.device.hash) { json(res, 403, { error: 'wrong_action_owner' }); return true; }
    if (action.actorUserId !== auth.user.id) { json(res, 403, { error: 'wrong_action_owner' }); return true; }
    if (input.result != null && containsSensitiveActionValue(input.result)) {
      json(res, 400, { error: 'result_contains_secret', error_description: 'Credentials and authorization material are not accepted in action results.' });
      return true;
    }
    if (ACTION_TERMINAL.has(action.status)) { json(res, 200, { action: actionView(action), changed: false }); return true; }
    const now = new Date().toISOString();
    Object.assign(action, {
      status,
      result: input.result == null ? null : input.result,
      errorCode: input.errorCode == null ? null : String(input.errorCode).slice(0, 128),
      updatedAt: now,
      finishedAt: status === 'running' ? null : now,
    });
    store.save();
    json(res, 200, { action: actionView(action), changed: true });
    return true;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async function postMutations(req, res, space, auth) {
    // The one write route that had no rate limit, which was tolerable only while a mutation
    // could not be large. It can now, and the body this accepts is measured in megabytes.
    if (!rateLimit(req, res, 'mutations', 120, 60_000)) return true;
    const input = await jsonBody(req, limits.maxMutationBatchBytes);
    const batch = Array.isArray(input.mutations) ? input.mutations : [];
    if (batch.length === 0) {
      json(res, 400, { error: 'empty_batch' });
      return true;
    }
    if (batch.length > MAX_MUTATION_BATCH) {
      json(res, 413, { error: 'batch_too_large', error_description: `At most ${MAX_MUTATION_BATCH} mutations per request.`, limit: MAX_MUTATION_BATCH });
      return true;
    }
    const snapshot = readSnapshot(space.id);
    const hasAsset = (hash) => assetExists(store, space.id, hash);
    const hasDocumentUpdate = (hash) => documentUpdateExists(space.id, hash);
    const hasSharedBlob = (hash) => sharedBlobExists(space.id, hash);
    const accepted = [];
    const duplicate = [];
    const rejected = [];
    const missingAssets = new Set();

    // Durable relationship ownership closes the gap between a private note page and its
    // nominally shared child tables. It survives ledger compaction, supports equal local ids
    // in different accounts, and never trusts an owner supplied by the client.
    const ownership = space.privateMutationOwnership && typeof space.privateMutationOwnership === 'object'
      ? space.privateMutationOwnership
      : (space.privateMutationOwnership = { version: 1, pages: {}, comments: {}, entities: {} });
    for (const field of ['pages', 'comments', 'entities']) {
      if (!ownership[field] || typeof ownership[field] !== 'object' || Array.isArray(ownership[field])) ownership[field] = {};
    }
    const ownersFor = (bucket, key) => {
      if (key === null || key === undefined || String(key) === '') return new Set();
      const value = bucket[String(key)];
      return new Set(Array.isArray(value) ? value.map(String) : typeof value === 'string' && value ? [value] : []);
    };
    const rememberOwner = (bucket, key, userId) => {
      if (key === null || key === undefined || String(key) === '') return;
      const owners = ownersFor(bucket, key); owners.add(String(userId)); bucket[String(key)] = [...owners];
    };
    const locator = (entry) => `${String(entry.table)}:${JSON.stringify(entry.key)}`;
    const explicitOwner = (entry) => String(entry?.ownerScope || '').startsWith('user:')
      ? String(entry.ownerScope).slice(5) : '';
    for (const historical of ledger.readAll(store, space.id)) {
      const owner = explicitOwner(historical) || (isUserScopedMutationEntry(historical) ? String(historical.actorId || historical.userId || '') : '');
      if (!owner) continue;
      rememberOwner(ownership.entities, locator(historical), owner);
      if (historical.table === 'pages') rememberOwner(ownership.pages, historical.row?.id ?? historical.key?.[0], owner);
      if (historical.table === 'page_comments') rememberOwner(ownership.comments, historical.row?.id ?? historical.key?.[0], owner);
    }

    const pendingPageOwners = {};
    const pendingCommentOwners = {};
    for (const mutation of batch) {
      if (String(mutation?.table || '') === 'pages' && isUserScopedMutationEntry(mutation)) {
        rememberOwner(pendingPageOwners, mutation?.row?.id ?? mutation?.key?.[0], auth.user.id);
      }
    }
    const relatedPrivateOwners = (entry) => {
      const owners = new Set();
      const table = String(entry.table || '');
      if (isUserScopedMutationEntry(entry)) owners.add(String(auth.user.id));
      const pageIds = table === 'page_links' ? [entry.row?.from_page_id, entry.row?.to_page_id]
        : ['page_blocks', 'page_document_updates', 'page_revisions', 'page_comments'].includes(table) ? [entry.row?.page_id] : [];
      for (const pageId of pageIds.filter(Boolean)) {
        for (const owner of ownersFor(ownership.pages, pageId)) owners.add(owner);
        for (const owner of ownersFor(pendingPageOwners, pageId)) owners.add(owner);
      }
      if (['page_comment_reactions', 'page_comment_mentions'].includes(table)) {
        for (const owner of ownersFor(ownership.comments, entry.row?.comment_id ?? entry.key?.[0])) owners.add(owner);
        for (const owner of ownersFor(pendingCommentOwners, entry.row?.comment_id ?? entry.key?.[0])) owners.add(owner);
      }
      if (!owners.size) for (const owner of ownersFor(ownership.entities, locator(entry))) owners.add(owner);
      return owners;
    };

    for (const mutation of batch) {
      if (String(mutation?.table || '') !== 'page_comments') continue;
      const owners = relatedPrivateOwners(mutation);
      if (owners.has(String(auth.user.id))) {
        rememberOwner(pendingCommentOwners, mutation?.row?.id ?? mutation?.key?.[0], auth.user.id);
      }
    }

    let ownershipKeyCount = ['pages', 'comments', 'entities']
      .reduce((count, field) => count + Object.keys(ownership[field]).length, 0);

    for (const mutation of batch) {
      if (mutation?.id && ledger.has(store, space.id, String(mutation.id))) {
        duplicate.push(mutation.id);
        continue;
      }
      const verdict = validateMutation(mutation, { snapshot, hasAsset, hasDocumentUpdate, hasSharedBlob, maxBytes: limits.maxMutationBytes });
      if (!verdict.ok) {
        if (verdict.missing) missingAssets.add(verdict.missing);
        if (verdict.missingDocumentUpdate) missingAssets.add(verdict.missingDocumentUpdate);
        if (verdict.missingSharedBlob) missingAssets.add(verdict.missingSharedBlob);
        // Only `too_large` carries numbers, and only because they are the whole difference
        // between a dead end and an explanation. Every other reason stays a bare code.
        rejected.push(verdict.reason === 'too_large'
          ? { id: mutation?.id ?? null, reason: verdict.reason, bytes: verdict.bytes, limitBytes: verdict.limit, error_description: `This row is ${sizeLabel(verdict.bytes)} and this server accepts up to ${sizeLabel(verdict.limit)} per row (NODUS_MAX_MUTATION_BYTES).` }
          : { id: mutation?.id ?? null, reason: verdict.reason });
        continue;
      }
      const receivedAt = new Date().toISOString();
      const candidate = {
        id: String(mutation.id),
        clientId: String(mutation.clientId || ''),
        kind: mutation.kind,
        table: mutation.table,
        key: mutation.key,
        row: mutation.kind === 'upsert' ? authoritativeMutationRow(mutation.row, auth, space, store) : null,
        assets: Array.isArray(mutation.assets) ? mutation.assets : [],
        schemaVersion: Number(mutation.schemaVersion) || 0,
        // Identity and ordering authority come from the authenticated request. Client
        // values remain only as non-authoritative provenance hints.
        createdAt: receivedAt,
        actorId: auth.user.id,
        deviceId: auth.device?.hash || `oauth:${auth.user.id}`,
        hlc: '',
        clientCreatedAt: typeof mutation.createdAt === 'string' ? mutation.createdAt : null,
        clientHlc: typeof mutation.hlc === 'string' ? mutation.hlc : null,
        originInstanceId: store.state.settings.instanceId,
        vaultId: space.id,
        documentHash: mutation.documentHash ? String(mutation.documentHash) : null,
        blobHash: mutation.blobHash ? String(mutation.blobHash) : null,
        userId: auth.user.id,
      };
      const privateOwners = relatedPrivateOwners(candidate);
      if (privateOwners.size > 0 && !privateOwners.has(String(auth.user.id))) {
        rejected.push({ id: mutation?.id ?? null, reason: 'private_parent_forbidden' });
        continue;
      }
      candidate.privateOwnerId = privateOwners.has(String(auth.user.id)) ? String(auth.user.id) : null;
      if (candidate.privateOwnerId) {
        const targets = [[ownership.entities, locator(candidate)]];
        if (candidate.table === 'pages') targets.push([ownership.pages, candidate.row?.id ?? candidate.key?.[0]]);
        if (candidate.table === 'page_comments') targets.push([ownership.comments, candidate.row?.id ?? candidate.key?.[0]]);
        const unseen = targets.filter(([bucket, key]) => key !== null && key !== undefined && String(key) !== '' && !Object.hasOwn(bucket, String(key)));
        if (ownershipKeyCount + unseen.length > MAX_PRIVATE_OWNERSHIP_KEYS) {
          rejected.push({ id: mutation?.id ?? null, reason: 'private_ownership_capacity' });
          continue;
        }
        for (const [bucket, key] of targets) rememberOwner(bucket, key, candidate.privateOwnerId);
        ownershipKeyCount += unseen.length;
      }
      accepted.push(candidate);
    }

    if (missingAssets.size > 0) {
      json(res, 409, { error: 'missing_assets', missing: [...missingAssets], error_description: 'Upload the referenced images before sending the mutations that point at them.' });
      return true;
    }

    let receiveSequence = Number(space.receiveSequence || 0);
    const authoritative = accepted.map((entry) => {
      const sequence = ++receiveSequence;
      const ownerScope = entry.privateOwnerId ? `user:${entry.privateOwnerId}` : 'vault';
      const wallTime = Number.isFinite(Date.parse(entry.createdAt)) ? Date.parse(entry.createdAt) : Date.now();
      const { privateOwnerId: _privateOwnerId, ...publicEntry } = entry;
      return {
        ...publicEntry,
        // Server receive order is the deterministic conflict clock. Client clocks are
        // retained only as provenance and never decide authority on the relay.
        hlc: `${String(wallTime).padStart(13, '0')}-${String(sequence % 1_000_000).padStart(6, '0')}-${store.state.settings.instanceId}`,
        receiveSequence: sequence,
        ownerScope,
        // A private note with the same local id in two accounts is two different entities.
        // Shared vault rows deliberately omit a user id so every member addresses one row.
        entityId: `${space.id}:${ownerScope}:${entry.table}:${JSON.stringify(entry.key)}`,
        entityVersion: sequence,
        baseRevision: space.revision || null,
        clientBaseRevision: typeof batch.find((candidate) => candidate?.id === entry.id)?.baseRevision === 'string'
          ? String(batch.find((candidate) => candidate?.id === entry.id).baseRevision).slice(0, 256) : null,
        tombstone: entry.kind === 'delete',
        payloadHash: digest(JSON.stringify({ kind: entry.kind, table: entry.table, key: entry.key, row: entry.row })),
        provenanceSchemaVersion: 4,
      };
    });

    // A full ledger is a temporary condition, not a bad request: it fills because the owner
    // has not opened Nodus, and it empties when they do. So this refuses the batch whole and
    // keeps nothing, which leaves the sender's queue intact to retry — deliberately unlike a
    // rejection, which would throw away a colleague's work over the owner's holiday.
    const incoming = authoritative.reduce((total, entry) => total + Buffer.byteLength(JSON.stringify(entry)) + 1, 0);
    if (ledger.bytes(store, space.id) + incoming > limits.maxLedgerBytes) {
      json(res, 507, {
        error: 'ledger_full',
        error_description: `This space is holding ${mib(limits.maxLedgerBytes)} of changes that its owner has not collected yet. Nothing was lost. Send again once they have opened Nodus.`,
        limitBytes: limits.maxLedgerBytes,
      });
      return true;
    }

    const stamped = ledger.append(store, space.id, authoritative);
    if (stamped.length) { space.receiveSequence = receiveSequence; store.save(); }
    if (stamped.length) notifyMutationListeners(space.id, Number(stamped.at(-1).seq));
    json(res, 200, {
      accepted: stamped.map((entry) => entry.id),
      duplicate,
      rejected,
      cursor: stamped.length ? Number(stamped.at(-1).seq) : null,
    });
    return true;
  }

  function getMutations(req, res, space, url, auth) {
    const explicit = url.searchParams.get('since');
    const cursor = explicit == null ? Number(auth.device?.mutationCursor || space.mutationCursor || 0) : Number(explicit || 0);
    const limit = Math.max(1, Math.min(MAX_MUTATION_BATCH, Number(url.searchParams.get('limit')) || MAX_MUTATION_BATCH));
    // Bounded by bytes as well as by count, so a page of large rows cannot become a response
    // this process is unable to serialize. Callers follow `hasMore`; a short page is normal.
    const page = ledger.since(store, space.id, cursor, limit, limits.maxMutationBatchBytes);
    // Personal rows use the same durable/cursored transport so existing Desktop clients keep
    // working, but only devices belonging to the authenticated author can observe them. Keep
    // the unfiltered cursor: otherwise another user's private row would block this replica at
    // the same invisible sequence forever.
    const mutations = page.mutations.filter((entry) => {
      const explicitOwner = String(entry.ownerScope || '').startsWith('user:')
        ? String(entry.ownerScope).slice(5) : '';
      if (explicitOwner) return explicitOwner === String(auth.user.id);
      if (!isUserScopedMutationEntry(entry)) return true;
      // Historical private rows without authoritative ownership metadata are quarantined.
      // Treating an empty owner as shared was a fail-open migration and exposed old notes.
      const legacyOwner = String(entry.actorId || entry.userId || '');
      return Boolean(legacyOwner) && legacyOwner === String(auth.user.id);
    });
    json(res, 200, { ...page, mutations, spaceSchemaVersion: space.schemaVersion ?? 0 });
    return true;
  }

  async function ackMutations(req, res, space, auth) {
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    const cursor = Number(input.cursor || 0);
    if (auth.device) auth.device.mutationCursor = Math.max(Number(auth.device.mutationCursor || 0), cursor);
    const devices = store.state.deviceTokens.filter((entry) => entry.spaceId === space.id
      && (!entry.expiresAt || Date.parse(entry.expiresAt) > Date.now()));
    const compactTo = devices.length ? Math.min(...devices.map((entry) => Number(entry.mutationCursor || 0))) : 0;
    const remaining = compactTo > Number(space.mutationCursor || 0) ? ledger.compact(store, space.id, compactTo) : ledger.readAll(store, space.id).length;
    space.mutationCursor = Math.max(Number(space.mutationCursor || 0), compactTo);
    store.save();
    // Anything the acknowledged mutations were holding alive may now be collectable.
    collectAssetGarbage(store, space.id, referencedAssets(space.id), limits.assetGraceMs);
    json(res, 200, { ok: true, cursor: space.mutationCursor, pending: remaining });
    return true;
  }

  // ── Snapshot channel ──────────────────────────────────────────────────────

  async function putSnapshot(req, res, space, device) {
    if (!rateLimit(req, res, 'snapshot-publish', 60, 5 * 60_000)) return true;
    if (req.headers['content-encoding'] !== 'gzip') {
      json(res, 415, { error: 'The publication must be gzip-compressed.' });
      return true;
    }
    const revision = String(req.headers['x-nodus-revision'] || '');
    if (revision && revision === space.revision) {
      json(res, 200, { ok: true, unchanged: true, updatedAt: space.updatedAt });
      return true;
    }
    const announced = Number(req.headers['content-length'] || 0);
    if (announced > limits.maxSnapshotBytes) {
      json(res, 413, { error: `The compressed publication is ${mib(announced)} and this server accepts uploads of up to ${mib(limits.maxSnapshotBytes)} (NODUS_MAX_SNAPSHOT_BYTES).`, limitBytes: limits.maxSnapshotBytes, uploadBytes: announced });
      return true;
    }
    const bytes = await body(req, limits.maxSnapshotBytes);
    const expanded = expandSnapshot(bytes);
    if (expanded.reason === 'too-large') {
      const size = expanded.expanded === null ? 'past the limit' : `to ${mib(expanded.expanded)}`;
      json(res, 413, { error: `The publication expands ${size} and this server accepts up to ${mib(limits.maxSnapshotJsonBytes)} of expanded data (NODUS_MAX_SNAPSHOT_JSON_BYTES).`, limitBytes: limits.maxSnapshotJsonBytes, expandedBytes: expanded.expanded });
      return true;
    }
    if (expanded.reason) {
      json(res, 400, { error: 'The compressed publication is not readable: the body must be gzipped JSON.' });
      return true;
    }
    const legacyAnnotations = Array.isArray(expanded.value?.tables?.writing_draft_annotations)
      ? expanded.value.tables.writing_draft_annotations : [];
    const snapshot = sanitizePublishedSnapshot(expanded.value, space);
    const formatVersion = Number(snapshot?.formatVersion);
    if (snapshot?.format !== 'nodus.server-snapshot' || !capabilities().snapshotVersions.includes(formatVersion)) {
      json(res, 400, { error: 'Unsupported publication format.' });
      return true;
    }
    const libraryProblem = validatePublishedLibrary(space.id, snapshot.library);
    if (libraryProblem) {
      json(res, libraryProblem.status, { error: libraryProblem.error, error_description: libraryProblem.error_description });
      return true;
    }
    const publishedAt = new Date().toISOString();
    // Snapshot provenance is an authoritative envelope around the projection. Never preserve
    // client-supplied ownership/provenance fields here: the authenticated publisher, receiving
    // installation and accepted revision are the source of truth for this publication.
    snapshot.provenance = {
      schemaVersion: 4, vaultId: space.id, publishedByUserId: device?.userId ?? null,
      originInstanceId: store.state.settings.instanceId, originDeviceId: device?.hash ?? null,
      acceptedRevision: revision || snapshot.revision || '', publishedAt,
    };
    // Persist exactly what was validated and sanitised. Keeping the original gzip here would
    // reintroduce the private tables when a later reader downloaded the snapshot.
    const publicationBytes = (ctx.gzip || gzipSync)(Buffer.from(JSON.stringify(snapshot)));
    store.writeSnapshot(space.id, publicationBytes);
    invalidateSnapshot(space.id);
    space.updatedAt = publishedAt;
    space.revision = revision || snapshot.revision || '';
    space.vault = snapshot.vault;
    if (snapshot?.vault?.type) space.vaultType = String(snapshot.vault.type);
    space.bytes = publicationBytes.length;
    space.schemaVersion = Number(snapshot.schemaVersion) || 0;
    space.snapshotFormatVersion = formatVersion;
    space.currentPublication = { ...snapshot.provenance };
    if (device) device.lastUsedAt = space.updatedAt;
    store.save();
    // Older publishers may still send local writing annotations in the snapshot. An explicit
    // owner policy permits a one-way, sanitised import into that owner's private sidecar;
    // publication itself remains successful if this optional migration cannot be stored.
    if (legacyAnnotations.length && privateAnnotations && policyFor(space).allowLegacyPublisherImport && device?.userId) {
      try {
        privateAnnotations.apply(device.userId, space.id, sanitizeAnnotations(legacyAnnotations).map((annotation) => ({ op: 'upsert', annotation })));
      } catch (error) {
        console.warn('[nodus-server] legacy annotation import skipped:', error instanceof Error ? error.message : String(error));
      }
    }
    // A republication is the moment an image can stop being referenced. The grace window in
    // collectAssetGarbage is what keeps it from racing an upload that is still in flight.
    const removed = collectAssetGarbage(store, space.id, referencedAssets(space.id), limits.assetGraceMs);
    const removedLibraryPackages = collectLibraryPackageGarbage(
      store, space.id, snapshotLibraryPackageHashes(snapshot), limits.assetGraceMs,
    );
    if (removed.length) {
      space.assetBytes = Math.max(0, Number(space.assetBytes || 0));
      store.save();
    }
    if (removedLibraryPackages.length) {
      space.libraryPackageBytes = spaceLibraryPackageBytes(store, space.id);
      store.save();
    }
    json(res, 200, { ok: true, unchanged: false, updatedAt: space.updatedAt, bytes: publicationBytes.length, assetsCollected: removed.length, libraryPackagesCollected: removedLibraryPackages.length });
    return true;
  }

  function getSnapshot(req, res, space) {
    const file = store.snapshotPath(space.id);
    if (!ctx.fs.existsSync(file)) {
      json(res, 409, { error: 'not_published' });
      return true;
    }
    const tag = `W/"${space.revision || space.updatedAt || 'none'}"`;
    if (req.headers['if-none-match'] === tag) {
      res.writeHead(304, securityHeaders({ etag: tag }));
      res.end();
      return true;
    }
    const bytes = ctx.fs.readFileSync(file);
    res.writeHead(200, securityHeaders({
      'content-type': 'application/vnd.nodus.snapshot+json',
      'content-encoding': 'gzip',
      'content-length': String(bytes.length),
      etag: tag,
      'cache-control': 'private, no-cache',
      'x-nodus-revision': space.revision || '',
    }));
    if (req.method === 'HEAD') res.end();
    else res.end(bytes);
    return true;
  }

  // ── Nodi's quick notes ────────────────────────────────────────────────────

  const NODI_NOTES_BODY_BYTES = 8 * 1024 * 1024;

  /** `?since=` in epoch milliseconds, so a client can ask only for what changed. */
  function sinceParam(url) {
    const raw = url.searchParams.get('since');
    if (raw === null || raw === '') return Number.NaN;
    const value = Number(raw);
    return Number.isFinite(value) ? value : Number.NaN;
  }

  function getNodiNotes(req, res, url) {
    const auth = authorize(req, res, { via: ['device', 'oauth'], resource: 'api', scope: 'materials.read' });
    if (!auth) return true;
    const notes = store.readNodiNotes(auth.user.id);
    json(res, 200, {
      notes: notesSince(notes, sinceParam(url)),
      total: notes.filter((note) => note.deletedAt === null).length,
      // The client's clock is not the server's, and `since` is compared against the
      // server's. Handing back the reference it should send next time is what keeps a
      // skewed device from re-reading everything or, worse, missing a note.
      serverTime: Date.now(),
    });
    return true;
  }

  async function postNodiNotes(req, res, url) {
    const auth = authorize(req, res, { via: ['device', 'oauth'], resource: 'api', scope: 'materials.write' });
    if (!auth) return true;
    // One person's own notes, so the limit is about a runaway client rather than abuse.
    if (!rateLimit(req, res, 'nodi-notes', 120, 60_000)) return true;

    const input = await jsonBody(req, NODI_NOTES_BODY_BYTES);
    const incoming = Array.isArray(input?.notes) ? input.notes : null;
    if (!incoming) {
      json(res, 400, { error: 'malformed', error_description: 'Send { notes: [...] }.' });
      return true;
    }
    if (incoming.length > MAX_NODI_NOTES) {
      json(res, 413, { error: 'too_many', error_description: `At most ${MAX_NODI_NOTES} notes per request.` });
      return true;
    }

    const now = Date.now();
    const accepted = [];
    const rejected = [];
    for (const value of incoming) {
      const { note, error } = validateNodiNote(value, now);
      if (note) accepted.push(note);
      else rejected.push({ id: String(value?.id ?? ''), reason: error });
    }

    const merged = mergeNodiNotes(store.readNodiNotes(auth.user.id), accepted, now);
    store.writeNodiNotes(auth.user.id, merged);
    json(res, 200, {
      notes: notesSince(merged, sinceParam(url)),
      total: merged.filter((note) => note.deletedAt === null).length,
      rejected,
      serverTime: now,
    });
    return true;
  }

  // ── Private personal annotations ─────────────────────────────────────────

  function csrfValue(req, input = null) {
    return String(req.headers['x-csrf-token'] || req.headers['x-csrf'] || input?.csrf || input?._csrf || '');
  }

  function sameOriginMutation(req, res, auth, input = null) {
    if (auth?.principal?.kind !== 'session') return true;
    let origin = String(req.headers.origin || '').trim();
    if (!origin) {
      try { origin = new URL(String(req.headers.referer || '')).origin; } catch { origin = ''; }
    }
    let expected = '';
    try { expected = new URL(publicUrl()).origin; } catch { /* configured URL is validated at boot */ }
    const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    const validFetchSite = !fetchSite || fetchSite === 'same-origin' || fetchSite === 'same-site';
    if (!origin || origin !== expected || !validFetchSite || !auth.principal.session
      || csrfValue(req, input) !== String(auth.principal.session.csrf || '')) {
      json(res, 403, { error: 'csrf_failed', error_description: 'A same-origin request and a valid CSRF token are required.' });
      return false;
    }
    return true;
  }

  function policyFor(space) {
    const input = space?.publicationPolicy && typeof space.publicationPolicy === 'object' ? space.publicationPolicy : {};
    const policy = {
      version: 1,
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : null,
    };
    for (const field of POLICY_FIELDS) policy[field] = input[field] === true;
    // Compatibility aliases remain explicit and never broaden a missing policy.
    if (input.allowLegacyPublisherImport === true) policy.allowPersonalImports = true;
    policy.allowLegacyPublisherImport = policy.allowPersonalImports;
    policy.publishPersonalAnnotations = false;
    return policy;
  }

  function sanitizePublishedSnapshot(snapshot, space) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.tables || typeof snapshot.tables !== 'object') return snapshot;
    // These tables historically travelled inside publisher snapshots. They are user-local
    // annotations, not corpus material, and must not become readable by another member/admin.
    const privateTables = new Set([
      'writing_draft_annotations', 'writing_draft_reads', 'study_annotations', 'study_material_annotations',
      'note_annotations', 'personal_annotations', 'testimony_annotations', 'library_annotations',
      'library_document_annotations', 'document_annotations', 'annotations',
    ]);
    for (const table of Object.keys(snapshot.tables)) if (isUserScopedMutation(table)) privateTables.add(table);
    const safeSnapshot = {};
    for (const [key, value] of Object.entries(snapshot)) {
      if (key === 'tables' || isSecretPublicationColumn('', key) || isLocalPublicationColumn(key)) continue;
      safeSnapshot[key] = sanitizePublicationValue(value);
    }
    const tables = {};
    // Treat the publisher as untrusted even when it is a paired owner device. Desktop
    // already strips these values, but the server independently enforces the boundary so
    // a modified client cannot publish credentials, local paths or nested binary payloads.
    for (const [table, inputRows] of Object.entries(snapshot.tables)) {
      if (!Array.isArray(inputRows)) continue;
      tables[table] = inputRows.map((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return {};
        return Object.fromEntries(Object.entries(row).flatMap(([column, value]) => (
          !isSecretPublicationColumn(table, column)
          && !isLocalPublicationColumn(column)
          && (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
            ? [[column, typeof value === 'string' ? redactText(value) : value]] : []
        )));
      });
    }
    for (const table of new Set([...privateTables, ...PERMANENT_PUBLICATION_DENYLIST])) delete tables[table];
    // A note-backed `pages` row is only a compatibility projection of that private
    // note. Publishing the page after removing its note both leaks private topology
    // and leaves a dangling FK that makes Connected Vault hydration fail closed.
    // Native vault pages (`note_id` absent) remain shared when policy permits them.
    if (Array.isArray(tables.pages)) {
      const removedPageIds = new Set(tables.pages
        .filter((row) => row?.note_id !== null && row?.note_id !== undefined && String(row.note_id) !== '')
        .map((row) => String(row.id)));
      if (removedPageIds.size > 0) {
        tables.pages = tables.pages.filter((row) => !removedPageIds.has(String(row?.id)));
        for (const child of ['page_blocks', 'page_favorites', 'page_revisions', 'page_comments']) {
          if (Array.isArray(tables[child])) tables[child] = tables[child].filter((row) => !removedPageIds.has(String(row?.page_id)));
        }
        if (Array.isArray(tables.page_links)) tables.page_links = tables.page_links.filter((row) => (
          !removedPageIds.has(String(row?.from_page_id)) && !removedPageIds.has(String(row?.to_page_id))
        ));
      }
    }
    const policy = policyFor(space);
    if (!policy.allowUserContent) for (const table of USER_CONTENT_TABLES) delete tables[table];
    if (!policy.allowPassages) delete tables.passages;
    if (!policy.allowPrimarySources) for (const table of PRIMARY_SOURCE_TABLES) delete tables[table];
    if (!policy.allowTestimonies) for (const table of TESTIMONY_TABLES) delete tables[table];
    return { ...safeSnapshot, library: policy.allowLibraryDocuments ? safeSnapshot.library : null, tables };
  }

  function personalAnnotationView(value) {
    return {
      version: Number(value?.version || 0),
      formatVersion: 1,
      updatedAt: value?.updatedAt ?? null,
      annotations: Array.isArray(value?.annotations) ? value.annotations : [],
    };
  }

  async function personalAnnotations(req, res, spaceId, url, mode = 'normal') {
    const auth = authorize(req, res, {
      spaceId,
      // A personal overlay is a web-session resource. Device/OAuth publishers may only use
      // the explicit owner import endpoint, never read or mutate somebody's overlay.
      need: mode === 'import' ? 'own' : 'read',
      via: mode === 'import' ? ['device'] : ['session'],
      resource: 'api',
      scope: req.method === 'GET' || req.method === 'HEAD' ? 'materials.read' : 'materials.write',
    });
    if (!auth) return true;
    if (!privateAnnotations) { json(res, 503, { error: 'annotations_unavailable' }); return true; }
    if (mode === 'import' && (auth.device?.kind ?? 'publisher') !== 'publisher') {
      json(res, 403, { error: 'publisher_required' }); return true;
    }
    const current = privateAnnotations.read(auth.user.id, spaceId);
    if (req.method === 'GET' || req.method === 'HEAD') {
      const resource = String(url.searchParams.get('resource') || '');
      const documentId = String(url.searchParams.get('documentId') || '');
      const view = personalAnnotationView(current);
      if (resource) view.annotations = view.annotations.filter((entry) => String(entry.resource || '') === resource);
      if (documentId) view.annotations = view.annotations.filter((entry) => String(entry.documentId || '') === documentId);
      const headers = { etag: `"${view.version}"`, 'cache-control': 'private, no-cache' };
      if (req.method === 'HEAD') { res.writeHead(200, securityHeaders(headers)); res.end(); } else json(res, 200, view, headers);
      return true;
    }
    const input = await jsonBody(req, 8 * 1024 * 1024);
    if (!sameOriginMutation(req, res, auth, input)) return true;
    const match = String(req.headers['if-match'] || '').replace(/^W\//, '').replace(/^"|"$/g, '');
    const expectedVersion = input.baseVersion ?? input.expectedVersion ?? input.version ?? (match || null);
    try {
      let next;
      if (mode === 'import') {
        if (!policyFor(auth.space).allowPersonalImports) {
          json(res, 403, { error: 'publisher_annotation_import_disabled' }); return true;
        }
        const incoming = Array.isArray(input.annotations) ? input.annotations : (Array.isArray(input.items) ? input.items : []);
        // Import is additive and sanitises legacy publisher rows before they enter the private
        // sidecar. It never writes to another account, even if a publisher submits userId.
        next = privateAnnotations.apply(auth.user.id, spaceId, sanitizeAnnotations(incoming).map((annotation) => ({ op: 'upsert', annotation })), expectedVersion === null ? null : expectedVersion);
      } else if (req.method === 'PUT') {
        const annotations = Array.isArray(input.annotations) ? input.annotations : [];
        next = privateAnnotations.replace(auth.user.id, spaceId, annotations, expectedVersion === null ? null : expectedVersion);
      } else {
        const operations = Array.isArray(input.operations)
          ? input.operations
          : [{ op: input.op || (req.method === 'DELETE' ? 'delete' : 'upsert'), id: input.id || url.searchParams.get('annotationId'), annotation: input.annotation ?? input }];
        next = privateAnnotations.apply(auth.user.id, spaceId, operations, expectedVersion === null ? null : expectedVersion);
      }
      json(res, 200, personalAnnotationView(next), { etag: `"${next.version}"` });
    } catch (error) {
      if (error instanceof AnnotationVersionConflict) {
        json(res, 409, { error: 'version_conflict', current: personalAnnotationView(error.current) });
      } else if (error instanceof AnnotationQuotaError) {
        json(res, 413, { error: 'annotation_quota_exceeded', error_description: error.message });
      } else {
        json(res, 400, { error: 'invalid_annotations', error_description: error instanceof Error ? error.message : String(error) });
      }
    }
    return true;
  }

  function webMe(req, res) {
    const auth = authorize(req, res, { via: ['session'], resource: 'api', scope: 'materials.read' });
    if (!auth) return true;
    json(res, 200, {
      user: { id: auth.user.id, email: auth.user.email, role: auth.user.role },
      spaces: spacesFor(auth.user),
      csrfToken: auth.principal.session.csrf,
      server: capabilities().server,
    });
    return true;
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/v1')) return false;
    try { url.pathname.split('/').filter(Boolean).forEach((value) => decodeURIComponent(value)); }
    catch { json(res, 400, { error: 'bad_path' }); return true; }
    const segments = url.pathname.slice('/api/v1'.length).split('/').filter(Boolean);

    if (segments.length === 1 && segments[0] === 'capabilities' && req.method === 'GET') {
      json(res, 200, capabilities());
      return true;
    }
    if (segments.length === 2 && segments[0] === 'auth' && segments[1] === 'login' && req.method === 'POST') return login(req, res);
    if (segments.length === 2 && segments[0] === 'auth' && segments[1] === 'device' && req.method === 'POST') return createDeviceToken(req, res);

    if (segments.length === 2 && segments[0] === 'web' && segments[1] === 'me' && req.method === 'GET') return webMe(req, res);

    if (segments.length === 1 && segments[0] === 'me' && req.method === 'GET') {
      const auth = authorize(req, res, { via: ['device', 'oauth'], resource: 'api', scope: 'materials.read' });
      if (!auth) return true;
      json(res, 200, {
        user: { id: auth.user.id, email: auth.user.email, role: auth.user.role },
        spaces: spacesFor(auth.user),
        device: auth.device ? { name: auth.device.deviceName, kind: auth.device.kind ?? 'publisher', spaceId: auth.device.spaceId, expiresAt: auth.device.expiresAt ?? null } : null,
        server: capabilities().server,
      });
      return true;
    }

    // ── Nodi's quick notes ────────────────────────────────────────────────
    //
    // The only resource here that is not a space. Nodi is the companion, and its notes are
    // shared across every vault a person opens, so they hang off the account: the same
    // device token authorises them, by the user it was issued to rather than by the space
    // it was scoped to.
    if (segments.length === 2 && segments[0] === 'nodi' && segments[1] === 'notes') {
      if (req.method === 'GET') return getNodiNotes(req, res, url);
      if (req.method === 'POST') return postNodiNotes(req, res, url);
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    // Session-backed personal notes have both the long, resource-oriented spelling and a
    // compact spelling used by the web app. Neither route ever accepts an admin-wide view.
    if (segments[0] === 'personal-annotations') {
      const spaceId = decodeURIComponent(segments[1] || url.searchParams.get('spaceId') || '');
      if (!spaceId) { json(res, 400, { error: 'space_required' }); return true; }
      if (segments[2] === 'import' && req.method === 'POST') return personalAnnotations(req, res, spaceId, url, 'import');
      if (segments[2] && req.method === 'POST' && segments[2] === 'import') return personalAnnotations(req, res, spaceId, url, 'import');
      if (segments[2]) url.searchParams.set('annotationId', decodeURIComponent(segments[2]));
      if (['GET', 'HEAD', 'POST', 'PUT', 'PATCH'].includes(req.method)) return personalAnnotations(req, res, spaceId, url);
      if (req.method === 'DELETE') return personalAnnotations(req, res, spaceId, url);
      json(res, 405, { error: 'method_not_allowed' }); return true;
    }

    if (segments[0] !== 'spaces' || segments.length < 2) return false;
    const spaceId = decodeURIComponent(segments[1]);
    const rest = segments.slice(2);
    const head = rest[0];

    if (head === 'personal-annotations') {
      if (rest[1] === 'import' && req.method === 'POST') return personalAnnotations(req, res, spaceId, url, 'import');
      if (rest[1]) url.searchParams.set('annotationId', decodeURIComponent(rest[1]));
      if (['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return personalAnnotations(req, res, spaceId, url);
      json(res, 405, { error: 'method_not_allowed' }); return true;
    }
    if (head === 'personal' && rest[1] === 'import' && req.method === 'POST') {
      return personalAnnotations(req, res, spaceId, url, 'import');
    }

    if (head === 'publication-policy') {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const auth = authorize(req, res, { spaceId, need: 'own', via: ['session', 'device'], resource: 'api', scope: 'materials.read' });
        if (!auth) return true;
        json(res, 200, policyFor(auth.space));
        return true;
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const auth = authorize(req, res, { spaceId, need: 'own', via: ['session'], resource: 'api', scope: 'materials.write' });
        if (!auth) return true;
        const input = await jsonBody(req, AUTH_BODY_BYTES);
        if (!sameOriginMutation(req, res, auth, input)) return true;
        const aliases = input.allowLegacyPublisherImport ?? input.importLegacyAnnotations ?? input.allowPublisherImport;
        if (aliases !== undefined && typeof aliases !== 'boolean') { json(res, 400, { error: 'invalid_policy' }); return true; }
        for (const field of POLICY_FIELDS) {
          if (input[field] !== undefined && typeof input[field] !== 'boolean') { json(res, 400, { error: 'invalid_policy', field }); return true; }
        }
        const currentPolicy = policyFor(auth.space);
        const nextPolicy = { version: 1, updatedAt: new Date().toISOString() };
        for (const field of POLICY_FIELDS) nextPolicy[field] = input[field] === undefined ? currentPolicy[field] : input[field];
        if (aliases !== undefined) nextPolicy.allowPersonalImports = aliases;
        nextPolicy.allowLegacyPublisherImport = nextPolicy.allowPersonalImports;
        nextPolicy.publishPersonalAnnotations = false;
        auth.space.publicationPolicy = nextPolicy;
        store.save();
        json(res, 200, policyFor(auth.space));
        return true;
      }
      json(res, 405, { error: 'method_not_allowed' }); return true;
    }

    // The publish channel keeps the device-only door it has always had; everything else
    // accepts an OAuth token too, because that is how the mobile app arrives.
    if (head === 'snapshot' && req.method === 'PUT') {
      const auth = authorize(req, res, { spaceId, need: 'own', via: ['device'], resource: 'api' });
      if (!auth) return true;
      return putSnapshot(req, res, auth.space, auth.device);
    }

    const need = mutatingNeed(req.method, head, rest);
    const sessionSafeRead = need === 'read' && (
      ['GET', 'HEAD'].includes(req.method)
      || (req.method === 'POST' && (head === 'context' || (head === 'search' && rest[1] === 'semantic')))
    );
    const auth = authorize(req, res, {
      spaceId,
      need,
      // Browser sessions may read the published corpus, but are never accepted for control
      // plane mutations. This is what lets the SPA use HttpOnly cookies without bearer tokens.
      via: sessionSafeRead ? ['device', 'oauth', 'session'] : ['device', 'oauth'],
      resource: 'api',
      scope: need === 'read' ? 'materials.read' : 'materials.write',
    });
    if (!auth) return true;
    const space = auth.space;

    if (head === 'snapshot' && (req.method === 'GET' || req.method === 'HEAD')) return getSnapshot(req, res, space);

    if (head === 'assets') {
      if (rest[1] === 'negotiate' && req.method === 'POST') return negotiateAssets(req, res, space);
      const hash = rest[1] ? decodeURIComponent(rest[1]) : '';
      if (req.method === 'POST' || req.method === 'PUT') return uploadAsset(req, res, space, hash);
      if (req.method === 'GET' || req.method === 'HEAD') return downloadAsset(req, res, space, hash);
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (head === 'document-updates') {
      const hash = rest[1] ? decodeURIComponent(rest[1]) : '';
      if (req.method === 'PUT') return uploadDocumentUpdate(req, res, space, hash);
      if (req.method === 'GET' || req.method === 'HEAD') return downloadDocumentUpdate(req, res, space, hash);
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    if (head === 'blobs') {
      const hash = rest[1] ? decodeURIComponent(rest[1]) : '';
      if (rest[2] === 'status' && req.method === 'GET') return sharedBlobStatus(req, res, space, hash);
      if (rest[2] === 'chunks' && rest[3] != null && req.method === 'PUT') return uploadSharedBlobChunk(req, res, space, hash, rest[3]);
      if (rest[2] === 'complete' && req.method === 'POST') return completeSharedBlob(req, res, space, hash);
      if (!rest[2] && (req.method === 'GET' || req.method === 'HEAD')) return downloadSharedBlob(req, res, space, hash);
      json(res, 405, { error: 'method_not_allowed' }); return true;
    }

    if (head === 'library') {
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && !policyFor(space).allowLibraryDocuments) {
        json(res, 403, { error: 'library_publication_disabled' }); return true;
      }
      if (rest[1] === 'negotiate' && req.method === 'POST') return negotiateLibraryPackages(req, res, space);
      if (rest[1] === 'packages' && rest[2] && req.method === 'PUT') return uploadLibraryPackage(req, res, space, decodeURIComponent(rest[2]));
      if (!rest[1] && req.method === 'GET') return librarySummary(req, res, space);
      if (rest[1] === 'collections' && req.method === 'GET') return libraryCollections(req, res, space);
      if (rest[1] === 'documents' && !rest[2] && req.method === 'GET') return libraryDocuments(req, res, space, url);
      if (rest[1] === 'documents' && rest[2] && rest[3] === 'download.zip' && (req.method === 'GET' || req.method === 'HEAD')) return downloadLibraryDocument(req, res, space, decodeURIComponent(rest[2]));
      if (rest[1] === 'documents' && rest[2] && rest[3] === 'content' && (req.method === 'GET' || req.method === 'HEAD')) return inlineLibraryContent(req, res, space, decodeURIComponent(rest[2]), 'content');
      if (rest[1] === 'documents' && rest[2] && rest[3] === 'original' && (req.method === 'GET' || req.method === 'HEAD')) return inlineLibraryContent(req, res, space, decodeURIComponent(rest[2]), 'original');
      if (rest[1] === 'documents' && rest[2] && rest[3] === 'assets' && rest.length >= 5 && (req.method === 'GET' || req.method === 'HEAD')) return inlineLibraryContent(req, res, space, decodeURIComponent(rest[2]), 'asset', `assets/${rest.slice(4).join('/')}`);
      if (rest[1] === 'documents' && rest[2] && req.method === 'GET') return libraryDocument(req, res, space, decodeURIComponent(rest[2]));
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    if (head === 'vectors' && req.method === 'PUT') {
      if (!policyFor(space).allowVectors) { json(res, 403, { error: 'vector_publication_disabled' }); return true; }
      return uploadVectors(req, res, space);
    }
    if (head === 'search' && rest[1] === 'semantic' && req.method === 'POST') return semanticSearch(req, res, space);
    if (head === 'context' && req.method === 'POST') return contextPackage(req, res, space);

    if (head === 'actions') {
      if (rest[1] === 'claim') {
        if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return true; }
        return claimSpaceAction(req, res, space, auth);
      }
      if (!rest[1]) {
        if (req.method === 'GET') return listSpaceActions(req, res, space, auth, url);
        if (req.method === 'POST') return createSpaceAction(req, res, space, auth);
        json(res, 405, { error: 'method_not_allowed' });
        return true;
      }
      const id = decodeURIComponent(rest[1]);
      if (rest[2] === 'cancel') {
        if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return true; }
        return cancelSpaceAction(req, res, space, auth, id);
      }
      if (rest[2] === 'status') {
        if (req.method !== 'POST') { json(res, 405, { error: 'method_not_allowed' }); return true; }
        return updateSpaceAction(req, res, space, auth, id);
      }
      if (req.method === 'GET') return getSpaceAction(req, res, space, auth, id);
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    if (head === 'mutations') {
      if (rest[1] === 'events' && req.method === 'GET') return mutationEvents(req, res, space);
      if (rest[1] === 'ack' && req.method === 'POST') return ackMutations(req, res, space, auth);
      if (req.method === 'POST') return postMutations(req, res, space, auth);
      if (req.method === 'GET') return getMutations(req, res, space, url, auth);
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }

    if (head === 'presence' && ['GET', 'POST', 'DELETE'].includes(req.method)) return updatePresence(req, res, space, auth);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 405, { error: 'method_not_allowed' });
      return true;
    }
    return corpus.handle(req, res, { json, url, space, segments: rest });
  }

  /**
   * What a route demands of the caller's space role.
   *
   * Reading and acknowledging the shared operation stream is `read`; every device keeps its
   * own cursor, so acknowledging no longer drains another replica's queue.
   */
  function mutatingNeed(method, head, rest) {
    if (head === 'mutations') return method === 'POST' && rest[1] !== 'ack' ? 'write' : 'read';
    if (head === 'actions') {
      if (rest[1] === 'claim' || rest[2] === 'status') return 'own';
      if (rest[2] === 'cancel') return 'read';
      return method === 'POST' ? 'write' : 'read';
    }
    if (head === 'vectors') return 'own';
    if (head === 'assets') return method === 'POST' || method === 'PUT' ? 'write' : 'read';
    if (head === 'document-updates') return method === 'PUT' ? 'write' : 'read';
    if (head === 'blobs') return method === 'PUT' || method === 'POST' ? 'write' : 'read';
    if (head === 'library') return method === 'POST' || method === 'PUT' ? 'own' : 'read';
    return 'read';
  }

  return { handle, capabilities, spacesFor, mutatingNeed };
}

export { can };
