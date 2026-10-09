import { createHash, randomBytes, randomUUID, timingSafeEqual, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server as HttpsServer } from 'node:https';
import path from 'node:path';
import { app } from 'electron';
import { safeStorage } from '../secrets/safeStorageGate';
import { getDb, withVaultDatabase } from '../db/database';
import { ensureLanCert } from '../localServer/lanCert';
import { getVault } from '../vaults/vaultRegistry';

export const DESKTOP_BRIDGE_PROTOCOL = '/bridge/v1' as const;
export const DESKTOP_BRIDGE_DOMAINS = [
  'testimonies',
  'teaching-roster',
  'teaching-grades',
  'study-recordings',
  'primary-source-files',
  'prosopography-private',
] as const;
export type DesktopBridgeDomain = (typeof DESKTOP_BRIDGE_DOMAINS)[number];

const DOMAIN_TABLES: Record<DesktopBridgeDomain, readonly string[]> = {
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
}

interface PairingOffer {
  id: string;
  codeHash: string;
  vaultIds: string[];
  domains: DesktopBridgeDomain[];
  expiresAt: number;
}

export interface DesktopBridgeOffer {
  id: string;
  code: string;
  origins: string[];
  certificateFingerprint: string;
  vaultIds: string[];
  domains: DesktopBridgeDomain[];
  expiresAt: string;
}

export interface DesktopBridgeStatus {
  running: boolean;
  port: number | null;
  origins: string[];
  certificateFingerprint: string | null;
  pairings: Array<Omit<BridgePairing, 'tokenHash'>>;
  error: string | null;
}

let server: HttpsServer | null = null;
let port: number | null = null;
let origins: string[] = [];
let fingerprint: string | null = null;
let lastError: string | null = null;
const offers = new Map<string, PairingOffer>();

function stateFile(): string {
  return path.join(app.getPath('userData'), 'desktop-bridge', 'pairings.bin');
}

function readPairings(): BridgePairing[] {
  const file = stateFile();
  if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return [];
  try {
    const value = JSON.parse(safeStorage.decryptString(readFileSync(file))) as unknown;
    return Array.isArray(value) ? value as BridgePairing[] : [];
  } catch { return []; }
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
  pairing.lastSeenAt = new Date().toISOString();
  writePairings(pairings);
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
    reply(response, 200, { protocolVersion: 1, deviceId: 'nodus-desktop', deviceName: app.getName(), vaultIds: [], domains: DESKTOP_BRIDGE_DOMAINS });
    return;
  }
  if (request.method === 'POST' && url.pathname === `${DESKTOP_BRIDGE_PROTOCOL}/pair`) {
    const input = await body(request, 64 * 1024);
    const clean = String(input.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const codeHash = hash(clean);
    const offer = [...offers.values()].find((item) => item.expiresAt > Date.now() && equalHex(item.codeHash, codeHash));
    if (!offer) { reply(response, 400, { error: 'invalid_pairing_code' }); return; }
    offers.delete(offer.id);
    const token = randomBytes(32).toString('base64url');
    const pairing: BridgePairing = {
      id: offer.id, tokenHash: hash(token), deviceId: String(input.deviceId || randomUUID()).slice(0, 128),
      deviceName: String(input.deviceName || 'Nodus Mobile').slice(0, 200), vaultIds: offer.vaultIds,
      domains: offer.domains, createdAt: new Date().toISOString(), expiresAt: null, revokedAt: null, lastSeenAt: null,
    };
    writePairings([...readPairings(), pairing]);
    reply(response, 201, { token, pairing: { ...pairing, tokenHash: undefined } });
    return;
  }
  const pairing = authorize(request);
  if (!pairing) { reply(response, 401, { error: 'invalid_token' }); return; }
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

async function ensureServer(): Promise<void> {
  if (server) return;
  const cert = await ensureLanCert();
  const certPem = readFileSync(cert.certPath, 'utf8');
  fingerprint = new X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase();
  const candidate = createServer({ cert: certPem, key: readFileSync(cert.keyPath) }, (request, response) => {
    void handle(request, response).catch((error) => reply(response, 500, { error: error instanceof Error ? error.message : 'bridge_error' }));
  });
  await new Promise<void>((resolve, reject) => {
    candidate.once('error', reject);
    candidate.listen(0, '0.0.0', () => resolve());
  });
  server = candidate;
  port = (candidate.address() as import('node:net').AddressInfo).port;
  origins = cert.addresses.map((address) => `https://${address}:${port}`);
  if (!origins.length) origins = [`https://127.0.0.1:${port}`];
  lastError = null;
}

export async function createDesktopBridgeOffer(vaultIds: string[], domains: DesktopBridgeDomain[]): Promise<DesktopBridgeOffer> {
  const allowedVaults = [...new Set(vaultIds)].filter((id) => Boolean(getVault(id)));
  const allowedDomains = [...new Set(domains)].filter((value): value is DesktopBridgeDomain => DESKTOP_BRIDGE_DOMAINS.includes(value));
  if (!allowedVaults.length || !allowedDomains.length) throw new Error('Selecciona al menos una bóveda y un dominio privado.');
  await ensureServer();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = [...randomBytes(10)].map((byte) => alphabet[byte % alphabet.length]).join('');
  const id = randomUUID(); const expiresAt = Date.now() + 10 * 60_000;
  offers.set(id, { id, codeHash: hash(code), vaultIds: allowedVaults, domains: allowedDomains, expiresAt });
  return { id, code: `${code.slice(0, 5)}-${code.slice(5)}`, origins, certificateFingerprint: fingerprint!, vaultIds: allowedVaults, domains: allowedDomains, expiresAt: new Date(expiresAt).toISOString() };
}

export function revokeDesktopBridgePairing(id: string): boolean {
  const pairings = readPairings(); const pairing = pairings.find((item) => item.id === id && !item.revokedAt);
  if (!pairing) return false;
  pairing.revokedAt = new Date().toISOString(); writePairings(pairings); return true;
}

export function desktopBridgeStatus(): DesktopBridgeStatus {
  return { running: Boolean(server), port, origins, certificateFingerprint: fingerprint,
    pairings: readPairings().map(({ tokenHash: _tokenHash, ...pairing }) => pairing), error: lastError };
}

export async function stopDesktopBridge(): Promise<void> {
  offers.clear();
  const current = server; server = null; port = null; origins = []; fingerprint = null;
  if (!current) return;
  await new Promise<void>((resolve) => current.close(() => resolve()));
}

export function clearDesktopBridgePairings(): void {
  const file = stateFile(); if (existsSync(file)) unlinkSync(file);
}
