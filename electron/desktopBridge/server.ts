import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, request as httpsRequest, type Server as HttpsServer } from 'node:https';
import path from 'node:path';
import { hostname } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { app, safeStorage } from 'electron';
import { getDb, withVaultDatabase } from '../db/database';
import { ensureLanCert, lanAddresses } from '../localServer/lanCert';
import { getVault } from '../vaults/vaultRegistry';
import { isReadOnlyCorpusQuery, serveLiveCorpus } from './liveCorpus';
import { authorizeMobileOperation, executeMobileOperation } from './operations';
import { MOBILE_OPERATIONS, MOBILE_JOB_OPERATIONS } from '../../shared/mobileOperations';
import { BridgeJobStore, type BridgeJob } from './jobs';
import { applyBridgeMutations } from './mutations';
import { applyWorkspaceEdit, WorkspaceEditFailure } from './workspaceEdits';
import { readMobileExport } from './exports';
import { serveBridgeFile } from './files';
import { DesktopRelayHost, type RelayConfiguration } from './relayHost';
import { listVaultConfigs } from '../serverSync/serverSyncShared';
import { getNodusServerTokenFor } from '../secrets/secretStore';
import {desktopPairingQR} from '../../shared/desktopPairingQR';
import {desktopBridgeOrigins} from '../../shared/desktopBridgeOrigins';

export const DESKTOP_BRIDGE_PROTOCOL = '/bridge/v1' as const;
export const DESKTOP_BRIDGE_DOMAINS = [
  'corpus',
  'writing', 'research-generation',
  'testimonies',
  'teaching-roster',
  'teaching-grades',
  'study-recordings',
  'primary-source-files',
  'prosopography-private',
] as const;
export type DesktopBridgeDomain = (typeof DESKTOP_BRIDGE_DOMAINS)[number];

const DOMAIN_TABLES: Record<DesktopBridgeDomain, readonly string[]> = {
  corpus: [],
  writing: [], 'research-generation': [],
  testimonies: [
    'persons',
    'testimony_interviews', 'testimony_participant_profiles', 'testimony_interview_participants',
    'testimony_sessions', 'testimony_media', 'testimony_transcripts', 'testimony_transcript_segments',
    'testimony_codes', 'testimony_annotations', 'testimony_annotation_codes', 'testimony_agreements',
    'testimony_contrasts', 'testimony_contrast_items', 'testimony_note_links',
  ],
  'teaching-roster': ['teaching_groups', 'teaching_students'],
  'teaching-grades': ['teaching_assessment_plans', 'teaching_assessment_items', 'teaching_grade_entries', 'teaching_rubric_evaluations'],
  'study-recordings': ['study_recordings', 'study_transcripts', 'study_transcript_segments', 'study_audio_markers'],
  'primary-source-files': [
    'archive_folders', 'archive_items', 'archive_item_tags', 'archive_item_persons', 'archive_item_folders',
    'archive_repositories', 'archive_description_units', 'archive_item_units', 'archive_capture_sessions',
    'archive_item_profiles', 'archive_item_files', 'archive_text_versions', 'archive_text_segments',
    'archive_excerpts', 'archive_entity_proposals', 'archive_source_analyses', 'archive_place_mentions',
    'archive_person_mentions', 'archive_integrity_checks', 'archive_exports', 'archive_description_templates',
    'archive_audit_log', 'archive_proposal_decisions', 'archive_place_resolution_decisions',
  ],
  'prosopography-private': [
    'persons', 'prosop_studies', 'prosop_methodology_versions', 'prosop_population_criteria',
    'prosop_population_memberships', 'prosop_membership_assessments', 'prosop_questionnaire_versions',
    'prosop_variables', 'prosop_vocabularies', 'prosop_vocabulary_terms', 'prosop_term_labels',
    'prosop_variable_revisions', 'prosop_person_profiles', 'prosop_sources', 'prosop_source_assessments',
    'prosop_source_segments', 'prosop_capture_templates', 'prosop_capture_batches', 'prosop_capture_rows',
    'prosop_proposals', 'prosop_factoids', 'prosop_name_attestations', 'prosop_identity_hypotheses',
    'prosop_identity_decision_evidence', 'prosop_authority_ids', 'prosop_organizations',
    'prosop_organization_names', 'prosop_statements', 'prosop_statement_entities', 'prosop_resolutions',
    'prosop_resolution_statements', 'prosop_missing_values', 'prosop_cohorts', 'prosop_cohort_members',
    'prosop_analysis_definitions', 'prosop_analysis_runs', 'prosop_network_layers', 'prosop_network_edges',
    'prosop_network_edge_factoids', 'prosop_audit_log',
  ],
};

interface BridgePairing {
  relayKeyId?: string;
  relaySecret?: string;
  relayChannelId?: string;
  id: string;
  tokenHash: string;
  deviceId: string;
  deviceName: string;
  vaultIds: string[];
  domains: DesktopBridgeDomain[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  renewedAt?: string;
}

interface PairingOffer {
  renewalPairingId?: string;
  relaySecret?: string;
  id: string;
  codeHash: string;
  vaultIds: string[];
  domains: DesktopBridgeDomain[];
  expiresAt: number;
}

export interface DesktopBridgeOffer {
  renewalPairingId?: string;
  id: string;
  code: string;
  origins: string[];
  certificateFingerprint: string;
  vaultIds: string[];
  domains: DesktopBridgeDomain[];
  expiresAt: string;
  pairingURL: string;
  qrURL?: string;
}

export interface DesktopBridgeStatus {
  running: boolean;
  port: number | null;
  origins: string[];
  certificateFingerprint: string | null;
  pairings: Array<Omit<BridgePairing, 'tokenHash' | 'relaySecret'>>;
  relay: { state: string; origin?: string };
  error: string | null;
}

let server: HttpsServer | null = null;
let port: number | null = null;
let origins: string[] = [];
let fingerprint: string | null = null;
let lastError: string | null = null;
const offers = new Map<string, PairingOffer>();
const advertisements = new Map<string, ChildProcess>();
const pairingAttempts = new Map<string, { started: number; count: number }>();
let jobs: BridgeJobStore | undefined;
let relayConfiguration: RelayConfiguration | undefined;
let relayHost: DesktopRelayHost | undefined;
let serverStarting: Promise<void> | undefined;
let relayStarting: Promise<void> | undefined;
let relayState = 'unconfigured';
function relayFor(keyId: string, secret: string) {
  if (!relayConfiguration) return undefined;
  const { url, id, clientToken, expiresAt, certificateFingerprint } = relayConfiguration;
  return { url, id, keyId, clientToken, expiresAt, secret, certificateFingerprint };
}
function ensureRelay(): Promise<void> {
  if (relayHost) return Promise.resolve();
  return relayStarting ??= startRelay().finally(() => { relayStarting = undefined; });
}
async function startRelay(): Promise<void> {
  const file = path.join(app.getPath('userData'), 'desktop-bridge', 'relay.bin');
  if (existsSync(file)) {
    const stored = JSON.parse(safeStorage.decryptString(readFileSync(file))) as RelayConfiguration;
    if (Date.parse(stored.expiresAt) > Date.now()) relayConfiguration = stored;
  }
  if (!relayConfiguration) {
    const target = listVaultConfigs().find(config => config.configured && config.url.startsWith('https://'));
    if (!target) return;
    const token = getNodusServerTokenFor(target.vaultId); if (!token) return;
    const response = await fetch(new URL('/api/v1/bridge-relay/channels', target.url), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ macId: macIdentity() }),
    });
    if (response.status !== 201) { relayState = 'server_upgrade_required'; return; }
    const configuration = await response.json() as Omit<RelayConfiguration, 'url'>;
    if (!/^[a-f0-9-]{36}$/i.test(configuration.id) || !configuration.hostToken || !configuration.clientToken || !Number.isFinite(Date.parse(configuration.expiresAt)) || Date.parse(configuration.expiresAt) <= Date.now()) throw new Error('invalid_relay_configuration');
    relayConfiguration = { ...configuration, url: new URL(target.url).origin };
    writeFileSync(file, safeStorage.encryptString(JSON.stringify(relayConfiguration)), { mode: 0o600 });
  }
  const cert = readFileSync(path.join(app.getPath('userData'), 'desktop-bridge', 'server.crt'));
  relayHost = new DesktopRelayHost(relayConfiguration, input => new Promise((resolve, reject) => {
    const address = new URL(input.path, `https://127.0.0.1:${port}`);
    if (address.origin !== `https://127.0.0.1:${port}`) { reject(new Error('invalid_relay_path')); return; }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.headers ?? {})) if (['authorization', 'content-type', 'accept'].includes(name.toLowerCase()) && typeof value === 'string') headers[name.toLowerCase()] = value;
    const request = httpsRequest(address, { method: input.method, headers, ca: cert, allowPartialTrustChain: true, checkServerIdentity: (_host, leaf) => {
      if (!leaf.raw || createHash('sha256').update(leaf.raw).digest('hex') !== fingerprint) return new Error('bridge_certificate_mismatch');
    } }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 512 * 1024 * 1024) request.destroy(new Error('relay_response_too_large')); else chunks.push(chunk); });
      response.on('error', reject); response.on('end', () => resolve({ status: response.statusCode ?? 502, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => typeof value === 'string')) as Record<string, string>, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject); request.setTimeout(120_000, () => request.destroy(new Error('relay_request_timeout')));
    request.end(input.bodyBase64 ? Buffer.from(input.bodyBase64, 'base64') : undefined);
  }), keyId => {
    const offer = offers.get(keyId); if (offer?.expiresAt && offer.expiresAt > Date.now()) return offer.relaySecret;
    return readPairings().find(pairing => pairing.relayKeyId === keyId && pairing.relayChannelId === relayConfiguration?.id && !pairing.revokedAt && (!pairing.expiresAt || Date.parse(pairing.expiresAt) > Date.now()))?.relaySecret;
  }, state => { relayState = state; });
  relayHost.start();
}
function jobStore(): BridgeJobStore {
  return jobs ??= new BridgeJobStore(path.join(app.getPath('userData'), 'desktop-bridge', 'jobs'),
    (job, emit, signal) => executeMobileOperation(job.vaultId, job.domains, job.method, job.args, emit, signal, job.id, job.mayHaveStarted),
    async job => {
      if (job.method !== 'enqueueDeepResearchJob') return;
      const queue = await executeMobileOperation(job.vaultId, job.domains, 'listDeepResearchJobs', []) as Array<{ id: string; bridgeJobId?: string }>;
      const owned = queue.find(record => record.bridgeJobId === job.id);
      if (owned) await executeMobileOperation(job.vaultId, job.domains, 'cancelDeepResearchJob', [owned.id]);
    });
}
function jobResponse(job: BridgeJob, cursor = 0): unknown {
  return { id: job.id, vaultId: job.vaultId, method: job.method, state: job.state,
    createdAt: job.createdAt, updatedAt: job.updatedAt, nextSequence: job.nextSequence,
    events: job.events.filter(event => event.sequence > cursor), result: job.result ?? null, error: job.error ?? null };
}

function stateFile(): string {
  return path.join(app.getPath('userData'), 'desktop-bridge', 'pairings.bin');
}

function macIdentity(): string {
  const file = path.join(app.getPath('userData'), 'desktop-bridge', 'identity');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(path.dirname(file), { recursive: true });
  const id = randomUUID();
  writeFileSync(file, id, { mode: 0o600 });
  return id;
}

function readPairings(): BridgePairing[] {
  const file = stateFile();
  if (!existsSync(file)) return [];
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El llavero del sistema está bloqueado; no se pueden leer los dispositivos vinculados.');
  try {
    const value = JSON.parse(safeStorage.decryptString(readFileSync(file))) as unknown;
    if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object'
      || typeof item.id !== 'string' || typeof item.tokenHash !== 'string'
      || !Array.isArray(item.vaultIds) || !item.vaultIds.every((id: unknown) => typeof id === 'string')
      || !Array.isArray(item.domains))) throw new Error('Invalid pairing store');
    return value as BridgePairing[];
  } catch {
    throw new Error('No se pueden descifrar los dispositivos vinculados. Sus credenciales se conservan; desbloquea el llavero o restaura su copia de seguridad.');
  }
}

function writePairings(pairings: BridgePairing[]): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El llavero del sistema no está disponible; el Bridge no guardará credenciales sin cifrar.');
  const file = stateFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(pairings)), { mode: 0o600 });
  renameSync(temporary, file);
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function equalHex(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex'); const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function reply(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function body(request: import('node:http').IncomingMessage, max = 512 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > max) throw new Error('payload_too_large');
    chunks.push(data);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json');
  return parsed as Record<string, unknown>;
}

function bearer(request: import('node:http').IncomingMessage): string | null {
  return /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '')?.[1]?.trim() || null;
}

function authorize(request: import('node:http').IncomingMessage): BridgePairing | null {
  const token = bearer(request);
  if (!token) return null;
  const tokenHash = hash(token);
  const pairings = readPairings();
  const pairing = pairings.find((item) => !item.revokedAt && equalHex(item.tokenHash, tokenHash));
  if (!pairing || pairing.expiresAt && Date.parse(pairing.expiresAt) <= Date.now()) return null;
  if (!pairing.lastSeenAt || Date.now() - Date.parse(pairing.lastSeenAt) > 60_000) {
    pairing.lastSeenAt = new Date().toISOString();
    writePairings(pairings);
  }
  return pairing;
}

function portable(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { binary: true, bytes: value.length, sha256: hash(value) };
  if (typeof value === 'bigint') return value.toString();
  return value;
}

async function records(vaultId: string, domain: DesktopBridgeDomain, table: string, cursor: number, limit: number): Promise<unknown> {
  if (!DOMAIN_TABLES[domain].includes(table)) throw new Error('table_forbidden');
  if (!getVault(vaultId)) throw new Error('vault_not_found');
  return withVaultDatabase(vaultId, () => {
    const db = getDb();
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!exists) return { rows: [], cursor, hasMore: false };
    const rows = db.prepare(`SELECT rowid AS _bridge_cursor, * FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`).all(cursor, limit + 1) as Record<string, unknown>[];
    const page = rows.slice(0, limit).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, portable(value)])));
    return { rows: page, cursor: Number(page.at(-1)?._bridge_cursor ?? cursor), hasMore: rows.length > limit };
  });
}

async function handle(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
  const url = new URL(request.url || '/', 'https://bridge.invalid');
  if (request.method === 'GET' && url.pathname === `${DESKTOP_BRIDGE_PROTOCOL}/capabilities`) {
    reply(response, 200, { protocolVersion: 1, deviceId: macIdentity(), deviceName: hostname(), vaultIds: [], domains: DESKTOP_BRIDGE_DOMAINS.filter(value => !['corpus', 'writing', 'research-generation'].includes(value)) });
    return;
  }
  if (request.method === 'POST' && url.pathname === `${DESKTOP_BRIDGE_PROTOCOL}/pair`) {
    const address = request.socket.remoteAddress ?? 'unknown';
    const previous = pairingAttempts.get(address);
    const attempt = previous && Date.now() - previous.started < 60_000 ? previous : { started: Date.now(), count: 0 };
    pairingAttempts.set(address, attempt);
    if (++attempt.count > 10) { reply(response, 429, { error: 'too_many_pairing_attempts' }); return; }
    const input = await body(request, 64 * 1024);
    const clean = String(input.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const codeHash = hash(clean);
    const offer = [...offers.values()].find((item) => item.expiresAt > Date.now() && equalHex(item.codeHash, codeHash));
    if (!offer) { reply(response, 400, { error: 'invalid_pairing_code' }); return; }
    const pairings = readPairings();
    const existing = offer.renewalPairingId ? authorize(request) : null;
    if (offer.renewalPairingId && existing?.id !== offer.renewalPairingId) {
      reply(response, 401, { error: 'renewal_requires_existing_device' }); return;
    }
    if ((existing || input.nextToken !== undefined) && (typeof input.nextToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.nextToken))) {
      reply(response, 400, { error: 'invalid_pairing_token' }); return;
    }
    // New clients persist a candidate before sending the single-use code. If the
    // response is lost, they recover this exact grant using that credential.
    // Older clients still receive a server-generated credential.
    const token = typeof input.nextToken === 'string' ? input.nextToken : randomBytes(32).toString('base64url');
    if (pairings.some(item => item.id !== existing?.id && !item.revokedAt && equalHex(item.tokenHash, hash(token)))) {
      reply(response, 400, { error: 'pairing_token_already_used' }); return;
    }
    const pairing: BridgePairing = existing ? {
      ...existing, tokenHash: hash(token), renewedAt: new Date().toISOString(),
    } : {
      id: offer.id, tokenHash: hash(token), deviceId: String(input.deviceId || randomUUID()).slice(0, 128),
      deviceName: String(input.deviceName || 'Nodus Mobile').slice(0, 200), vaultIds: offer.vaultIds,
      domains: offer.domains, createdAt: new Date().toISOString(), expiresAt: null, revokedAt: null, lastSeenAt: null,
      ...(offer.relaySecret && relayConfiguration ? { relayKeyId: randomUUID(), relaySecret: randomBytes(32).toString('base64'), relayChannelId: relayConfiguration.id } : {}),
    };
    writePairings([...pairings.filter(item => item.id !== pairing.id), pairing]);
    // A failed encrypted write leaves the single-use offer available for retry.
    offers.delete(offer.id);
    advertisements.get(offer.id)?.kill(); advertisements.delete(offer.id);
    reply(response, 201, { token, pairing: { ...pairing, tokenHash: undefined, relaySecret: undefined },
      relay: pairing.relayKeyId && pairing.relaySecret ? relayFor(pairing.relayKeyId, pairing.relaySecret) : undefined });
    return;
  }
  const pairing = authorize(request);
  if (!pairing) { reply(response, 401, { error: 'invalid_token' }); return; }
  if (request.method === 'GET' && url.pathname === '/bridge/v2/pairing') {
    reply(response, 200, { pairing: { ...pairing, tokenHash: undefined, relaySecret: undefined },
      relay: pairing.relayKeyId && pairing.relaySecret ? relayFor(pairing.relayKeyId, pairing.relaySecret) : undefined });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/bridge/v2/pairing/renew') {
    const input = await body(request, 1024);
    // Body delivery can overlap another renewal or revocation. Check again before writing.
    const current = authorize(request);
    if (!current || current.id !== pairing.id) { reply(response, 401, { error: 'invalid_token' }); return; }
    if (typeof input.nextToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.nextToken)) {
      reply(response, 400, { error: 'invalid_renewal_token' }); return;
    }
    const renewed = { ...current, tokenHash: hash(input.nextToken), renewedAt: new Date().toISOString() };
    writePairings(readPairings().map(item => item.id === current.id ? renewed : item));
    reply(response, 200, { id: renewed.id, renewedAt: renewed.renewedAt }); return;
  }
  if (request.method === 'DELETE' && url.pathname === '/bridge/v2/pairing') {
    revokeDesktopBridgePairing(pairing.id); reply(response, 200, { revoked: true }); return;
  }
  if (request.method === 'GET' && url.pathname === '/bridge/v2/health') { reply(response, 200, { ok: true, version: app.getVersion() }); return; }
  if (request.method === 'GET' && url.pathname === '/bridge/v2/server-capabilities') {
    reply(response, 200, { api: 'v1', version: app.getVersion(), server: { name: hostname(), publicUrl: origins[0], language: 'es', installationId: macIdentity(), version: app.getVersion() },
      snapshotVersions: [1, 2], assets: true, libraryDocuments: true, mutations: pairing.domains.includes('writing'), vectors: false, resources: {},
      maxAssetBytes: 8 * 1024 * 1024, maxSpaceAssetBytes: 1024 * 1024 * 1024, maxSnapshotBytes: 512 * 1024 * 1024, maxSnapshotJsonBytes: 512 * 1024 * 1024,
      maxMutationBatch: 100, maxMutationBytes: 8 * 1024 * 1024, maxMutationBatchBytes: 16 * 1024 * 1024,
      desktopBridge: { protocol: '/bridge/v2', relay: Boolean(pairing.relaySecret && relayConfiguration), relayState, relayProtocolVersion: 1, transport: 'private-tls-or-encrypted-websocket' } }); return;
  }
  if (request.method === 'GET' && url.pathname === '/bridge/v2/capabilities') {
    reply(response, 200, { protocolVersion: 2, deviceId: macIdentity(), deviceName: hostname(),
      vaultIds: pairing.vaultIds, domains: pairing.domains,
      vaults: pairing.vaultIds.map(id => getVault(id)).filter(Boolean).map(vault => ({ id: vault!.id, name: vault!.name, type: vault!.type })),
      operations: Object.entries(MOBILE_OPERATIONS).filter(([, [, permission]]) => pairing.domains.includes(permission)).map(([method]) => method),
      workspaceEdits: pairing.domains.includes('writing') ? { version: 1, structured: true } : undefined,
      jobs: { version: 1, states: ['accepted', 'running', 'saved', 'available', 'failed', 'interrupted', 'cancelled'], methods: [...MOBILE_JOB_OPERATIONS] } }); return;
  }
  const jobRoute = /^\/bridge\/v2\/vaults\/([^/]+)\/jobs(?:\/([a-f0-9-]+))?$/.exec(url.pathname);
  if (jobRoute) {
    const vaultId = decodeURIComponent(jobRoute[1]);
    if (!pairing.vaultIds.includes(vaultId)) { reply(response, 403, { error: 'permission_denied' }); return; }
    try {
      if (request.method === 'POST' && !jobRoute[2]) {
        const input = await body(request, 4 * 1024 * 1024);
        const method = String(input.method || ''); authorizeMobileOperation(pairing.domains, method);
        if (!MOBILE_JOB_OPERATIONS.has(method) || !Array.isArray(input.args) || input.args.length > 12) throw new Error('invalid_job');
        const job = jobStore().submit({ deviceGrant: pairing.id, vaultId, domains: pairing.domains, method, args: input.args, idempotencyKey: String(input.idempotencyKey || '') });
        reply(response, 202, { job: jobResponse(job) }); return;
      }
      if (request.method === 'GET' && !jobRoute[2]) {
        reply(response, 200, { jobs: jobStore().list(pairing.id, vaultId).map(job => jobResponse(job, Number.MAX_SAFE_INTEGER)) }); return;
      }
      const job = jobRoute[2] && (request.method === 'DELETE' ? jobStore().cancel(jobRoute[2], pairing.id, vaultId) : jobStore().get(jobRoute[2], pairing.id, vaultId));
      if (!job || !['GET', 'DELETE'].includes(request.method || '')) { reply(response, 404, { error: 'job_not_found' }); return; }
      reply(response, 200, { job: jobResponse(job, Math.max(0, Number(url.searchParams.get('cursor')) || 0)) }); return;
    } catch (error) { reply(response, 400, { error: error instanceof Error ? error.message : 'job_failed' }); return; }
  }
  const exported = /^\/bridge\/v2\/vaults\/([^/]+)\/exports\/([a-f0-9-]+)$/.exec(url.pathname);
  if (exported && ['GET', 'HEAD'].includes(request.method || '')) {
    const vaultId = decodeURIComponent(exported[1]);
    if (!pairing.vaultIds.includes(vaultId) || !pairing.domains.includes('corpus')) { reply(response, 403, { error: 'permission_denied' }); return; }
    const file = readMobileExport(vaultId, exported[2]);
    if (!file) { reply(response, 404, { error: 'export_expired' }); return; }
    response.writeHead(200, { 'content-type': file.mime, 'content-length': file.bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}` });
    response.end(request.method === 'HEAD' ? undefined : file.bytes); return;
  }
  const corpus = /^\/bridge\/v2\/vaults\/([^/]+)\/corpus(?:\/(.*))?$/.exec(url.pathname);
  if (request.method === 'POST' && corpus && corpus[2] === 'mutations') {
    const vaultId = decodeURIComponent(corpus[1]);
    if (!pairing.vaultIds.includes(vaultId) || !pairing.domains.includes('writing')) { reply(response, 403, { error: 'permission_denied' }); return; }
    const input = await body(request, 16 * 1024 * 1024);
    reply(response, 200, await applyBridgeMutations(vaultId, pairing.id, input.mutations)); return;
  }
  const workspaceEdit = /^\/bridge\/v2\/vaults\/([^/]+)\/workspace-edits$/.exec(url.pathname);
  if (request.method === 'POST' && workspaceEdit) {
    const vaultId = decodeURIComponent(workspaceEdit[1]);
    if (!pairing.vaultIds.includes(vaultId) || !pairing.domains.includes('writing')) { reply(response, 403, { error: 'permission_denied' }); return; }
    const input = await body(request, 4 * 1024 * 1024);
    try { reply(response, 200, await applyWorkspaceEdit(vaultId, pairing.id, input)); }
    catch (error) {
      if (error instanceof WorkspaceEditFailure) reply(response, error.code.endsWith('conflict') ? 409 : error.code === 'document_unavailable' ? 404 : 400, { error: error.code, ...(error.remote ? { remote: error.remote } : {}) });
      else reply(response, 400, { error: 'invalid_document', error_description: error instanceof Error ? error.message : 'The document could not be saved.' });
    }
    return;
  }
  const operation = /^\/bridge\/v2\/vaults\/([^/]+)\/operations$/.exec(url.pathname);
  if (request.method === 'POST' && operation) {
    const vaultId = decodeURIComponent(operation[1]);
    if (!pairing.vaultIds.includes(vaultId)) { reply(response, 403, { error: 'permission_denied' }); return; }
    const input = await body(request, 4 * 1024 * 1024);
    try {
      const method = String(input.method || '');
      let result = await executeMobileOperation(vaultId, pairing.domains, method, input.args as unknown[]);
      if (method === 'listDictionaryGenerationJobs' && Array.isArray(result)) {
        const progress = new Map(result.map(item => [item.entryId, item]));
        for (const job of jobStore().list(pairing.id, vaultId).filter(job => job.method === 'startDictionaryGeneration')) {
          const request = job.args[0] as { entryId?: string; mode?: string };
          if (!request?.entryId) continue;
          const latest = job.events.filter(event => event.channel === 'mobile:dictionary:progress').at(-1)?.args[0] as Record<string, unknown> | undefined;
          progress.set(request.entryId, { entryId: request.entryId, mode: request.mode, ...latest,
            ...(['failed', 'interrupted', 'cancelled'].includes(job.state) ? { phase: 'failed', message: 'La solicitud no se completó', error: job.error ?? job.state }
              : job.state === 'accepted' ? { phase: 'queued', message: 'Aceptado por el Mac' }
              : job.state === 'available' ? job.result as Record<string, unknown> : latest ?? { phase: 'retrieving', message: 'Analizando corpus' }) });
        }
        result = [...progress.values()];
      }
      reply(response, 200, { result: result ?? null });
    } catch (error) { reply(response, 400, { error: error instanceof Error ? error.message : 'operation_failed' }); }
    return;
  }
  if (corpus && (request.method === 'GET' || request.method === 'HEAD' || isReadOnlyCorpusQuery(request.method, corpus[2]))) {
    const vaultId = decodeURIComponent(corpus[1]);
    if (!pairing.vaultIds.includes(vaultId) || !pairing.domains.includes('corpus')) {
      reply(response, 403, { error: 'permission_denied' }); return;
    }
    const query = request.method === 'POST' ? await body(request, 256 * 1024) : undefined;
    await serveLiveCorpus(request, response, url, vaultId, (corpus[2] || '').split('/').filter(Boolean).map(decodeURIComponent), query);
    return;
  }
  const file = /^\/bridge\/v2\/vaults\/([^/]+)\/files\/([^/]+)\/([^/]+)\/(descriptor|content)$/.exec(url.pathname);
  if (['GET', 'HEAD'].includes(request.method || '') && file) {
    const vaultId = decodeURIComponent(file[1]);
    if (!pairing.vaultIds.includes(vaultId)) { reply(response, 403, { error: 'permission_denied' }); return; }
    await serveBridgeFile(request, response, url, vaultId, pairing.domains, decodeURIComponent(file[2]), decodeURIComponent(file[3]), file[4]);
    return;
  }
  const match = /^\/bridge\/v1\/vaults\/([^/]+)\/([^/]+)\/records$/.exec(url.pathname);
  if (request.method === 'GET' && match) {
    const vaultId = decodeURIComponent(match[1]);
    const domain = decodeURIComponent(match[2]) as DesktopBridgeDomain;
    if (!pairing.vaultIds.includes(vaultId) || !pairing.domains.includes(domain)) { reply(response, 403, { error: 'permission_denied' }); return; }
    const table = String(url.searchParams.get('table') || '');
    const cursor = Math.max(0, Number(url.searchParams.get('cursor') || 0) || 0);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50) || 50));
    try { reply(response, 200, await records(vaultId, domain, table, cursor, limit)); }
    catch (error) { reply(response, 400, { error: error instanceof Error ? error.message : 'bridge_error' }); }
    return;
  }
  reply(response, 404, { error: 'not_found' });
}

function ensureServer(): Promise<void> {
  if (server) return Promise.resolve();
  return serverStarting ??= startServer().finally(() => { serverStarting = undefined; });
}
async function startServer(): Promise<void> {
  const directory = path.join(app.getPath('userData'), 'desktop-bridge');
  mkdirSync(directory, { recursive: true });
  const certificateFile = path.join(directory, 'server.crt');
  const keyFile = path.join(directory, 'server.key');
  // The Bridge has a stable TLS identity. Changes to LAN/VPN addresses must not
  // rotate the leaf pinned by already linked phones.
  if (!existsSync(certificateFile) || !existsSync(keyFile)) {
    const cert = await ensureLanCert();
    writeFileSync(certificateFile, readFileSync(cert.certPath), { mode: 0o600 });
    writeFileSync(keyFile, readFileSync(cert.keyPath), { mode: 0o600 });
  }
  const certPem = readFileSync(certificateFile, 'utf8');
  fingerprint = new X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase();
  const candidate = createServer({ cert: certPem, key: readFileSync(keyFile) }, (request, response) => {
    void handle(request, response).catch((error) => reply(response, 500, { error: error instanceof Error ? error.message : 'bridge_error' }));
  });
  await new Promise<void>((resolve, reject) => {
    candidate.once('error', reject);
    const portFile = path.join(directory, 'port');
    const savedPort = existsSync(portFile) ? Number(readFileSync(portFile, 'utf8')) : 0;
    if (!Number.isInteger(savedPort) || savedPort < 0 || savedPort > 65535) { reject(new Error('invalid_bridge_port')); return; }
    candidate.listen(savedPort, '0.0.0', () => resolve());
  });
  server = candidate;
  port = (candidate.address() as import('node:net').AddressInfo).port;
  writeFileSync(path.join(directory, 'port'), String(port), { mode: 0o600 });
  refreshOrigins();
  lastError = null;
}

export async function createDesktopBridgeOffer(vaultIds: string[], domains: DesktopBridgeDomain[], renewalPairingId?: string, transport: 'direct' | 'automatic' = 'automatic'): Promise<DesktopBridgeOffer> {
  if (transport !== 'direct' && transport !== 'automatic') throw new Error('invalid_pairing_transport');
  // Refuse a new offer before opening any endpoint when existing credentials
  // cannot be read. Pairing must never overwrite an inaccessible encrypted store.
  const existing = readPairings();
  const renewal = renewalPairingId ? existing.find(pairing => pairing.id === renewalPairingId && !pairing.revokedAt
    && (!pairing.expiresAt || Date.parse(pairing.expiresAt) > Date.now())) : undefined;
  if (renewalPairingId && !renewal) throw new Error('La conexión ya no está activa. Crea una nueva vinculación.');
  for (const [id, offer] of offers) if (offer.expiresAt <= Date.now()) offers.delete(id);
  const allowedVaults = renewal ? renewal.vaultIds : [...new Set(vaultIds)].filter((id) => Boolean(getVault(id)));
  const allowedDomains = renewal ? renewal.domains : [...new Set(domains)].filter((value): value is DesktopBridgeDomain => DESKTOP_BRIDGE_DOMAINS.includes(value));
  if (!allowedVaults.length || !allowedDomains.length) throw new Error('Selecciona al menos una bóveda y un dominio privado.');
  await ensureServer();
  refreshOrigins();
  // The primary LAN/VPN flow must not wait for an advanced Server/Cloud channel.
  if (transport === 'automatic') {
    try { await ensureRelay(); } catch { relayState = 'disconnected'; }
  }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = [...randomBytes(10)].map((byte) => alphabet[byte % alphabet.length]).join('');
  const id = randomUUID(); const expiresAt = Date.now() + 10 * 60_000;
  const relaySecret = transport === 'automatic' && relayConfiguration ? randomBytes(32).toString('base64') : undefined;
  offers.set(id, { id, codeHash: hash(code), vaultIds: allowedVaults, domains: allowedDomains, expiresAt, relaySecret,
    ...(renewal ? { renewalPairingId: renewal.id } : {}) });
  const offer = { id, code: `${code.slice(0, 5)}-${code.slice(5)}`, origins, certificateFingerprint: fingerprint!, vaultIds: allowedVaults, domains: allowedDomains, expiresAt: new Date(expiresAt).toISOString(),
    deviceName: hostname(), macDeviceId: macIdentity(), ...(renewal ? { renewalPairingId: renewal.id } : {}), relay: relaySecret ? relayFor(id, relaySecret) : undefined, vaults: allowedVaults.map(id => getVault(id)).filter(Boolean).map(vault => ({ id: vault!.id, name: vault!.name, type: vault!.type })) };
  if (process.platform === 'darwin') {
    // The code is never advertised. Its HMAC authenticates the whole offer,
    // including the TLS pin, before iOS sends a pairing request.
    // Code discovery uses pinned direct HTTPS. Never advertise a relay encryption key.
    const payload = Buffer.from(JSON.stringify({ version: 2, ...offer, code: undefined, relay: undefined, deviceName: hostname(), vaults: allowedVaults.map(id => getVault(id)).filter(Boolean).map(vault => ({ id: vault!.id, name: vault!.name, type: vault!.type })) })).toString('base64url');
    const proof = createHmac('sha256', code).update(payload).digest('base64url');
    const chunks = payload.match(/.{1,180}/g) || [];
    const advertisement = spawn('/usr/bin/dns-sd', ['-R', `Nodus ${id.slice(0, 8)}`, '_nodus-mobile._tcp', 'local', String(port), `n=${chunks.length}`, `proof=${proof}`, ...chunks.map((chunk, index) => `p${index}=${chunk}`)], { stdio: 'ignore' });
    advertisement.on('error', () => advertisements.delete(id));
    advertisements.set(id, advertisement);
    setTimeout(() => { advertisements.get(id)?.kill(); advertisements.delete(id); offers.delete(id); }, Math.max(1, expiresAt - Date.now())).unref();
  }
  const link = new URL('nodus://pair');
  link.searchParams.set('offer', Buffer.from(JSON.stringify({ version: 2, ...offer })).toString('base64url'));
  return { ...offer, pairingURL: link.toString(), qrURL: desktopPairingQR(offer) };
}

/** Reopen the same endpoint on launch when this Mac has active device grants. */
export async function resumeDesktopBridge(): Promise<void> {
  try {
    const active = readPairings().filter(pairing => !pairing.revokedAt && (!pairing.expiresAt || Date.parse(pairing.expiresAt) > Date.now()));
    if (!active.length) return;
    await ensureServer();
    if (active.some(pairing => pairing.relaySecret)) {
      void ensureRelay().catch(() => { relayState = 'disconnected'; });
    }
  } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
}

export function revokeDesktopBridgePairing(id: string): boolean {
  const pairings = readPairings(); const pairing = pairings.find((item) => item.id === id && !item.revokedAt);
  if (!pairing) return false;
  pairing.revokedAt = new Date().toISOString(); writePairings(pairings); jobs?.revoke(id); return true;
}

export function desktopBridgeStatus(): DesktopBridgeStatus {
  refreshOrigins();
  let pairings: BridgePairing[] = [];
  let issue = lastError;
  try { pairings = readPairings(); } catch (error) { issue = error instanceof Error ? error.message : String(error); }
  return { running: Boolean(server), port, origins, certificateFingerprint: fingerprint,
    pairings: pairings.map(({ tokenHash: _tokenHash, relaySecret: _secret, ...pairing }) => pairing), relay: { state: relayState, origin: relayConfiguration?.url }, error: issue };
}

function refreshOrigins(): void {
  origins = port === null ? [] : desktopBridgeOrigins(port, lanAddresses(), hostname());
}

export async function stopDesktopBridge(): Promise<void> {
  await Promise.allSettled([serverStarting, relayStarting].filter((pending): pending is Promise<void> => Boolean(pending)));
  relayHost?.stop(); relayHost = undefined; relayState = 'disconnected';
  offers.clear();
  for (const advertisement of advertisements.values()) advertisement.kill(); advertisements.clear();
  const current = server; server = null; port = null; origins = []; fingerprint = null;
  if (!current) return;
  await new Promise<void>((resolve) => current.close(() => resolve()));
}

export function clearDesktopBridgePairings(): void {
  const file = stateFile(); if (existsSync(file)) unlinkSync(file);
}
