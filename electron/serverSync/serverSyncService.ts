import os from 'node:os';
import { createHash } from 'node:crypto';
import { getDb, withVaultDatabase } from '../db/database';
import { getActiveVault, getVault } from '../vaults/vaultRegistry';
import { updateSettings } from '../db/settingsRepo';
import {
  clearNodusServerTokenFor,
  getNodusServerTokenFor,
  hasNodusServerTokenFor,
  setNodusServerToken,
} from '../secrets/secretStore';
import type {
  AppLanguage,
  NodusServerConnection,
  NodusServerOverview,
  NodusServerPairResult,
  NodusServerSyncPhase,
  VaultSummary,
} from '@shared/types';
import { normalizeUiLanguage } from '@shared/uiLanguage';
import { lightweightVaultRevision, type SnapshotAsset } from './serverSnapshot';
import { buildServerLibraryPublicationAsync, type ServerLibraryPackage } from './serverLibrary';
import type { VectorKind } from './serverVectors';
import { onGlobalLibraryChanged } from '../library/libraryRuntime';
import { nodiNotesPending, syncNodiNotes } from './nodiNotesSync';
import {
  closeReadOnlyPool,
  fetchWithTimeout,
  listVaultConfigs,
  normalizeUrl,
  openReadOnly,
  readVaultConfig,
  type VaultServerConfig,
} from './serverSyncShared';
import {
  clearPublishRetry,
  mayAttemptPublish,
  notePublishFailure,
  publishRetryIsDue,
} from './publishRetryPolicy';
import { buildServerSnapshotInUtility, publishVaultToCloudflareInUtility, cancelCloudflarePublications } from './serverPublishWorkerHost';
import { cloudflareSyncGate } from './cloudflareSyncSafety';
import { requireCloudflareSafety, ServerHttpError } from './serverNetwork';
import { publishSourceRevision } from './publishSourceRevision';
import {
  personalImportEndpoint,
  normalizeServerPublicationPolicy,
  RESTRICTIVE_SERVER_PUBLICATION_POLICY,
  type ServerPersonalImportEnvelope,
  type ServerPublicationPolicy,
} from '@shared/serverPublication';

// A Nodus Server pairing belongs to ONE vault and one remote space. Unlike the old
// single-active-vault publisher, every paired vault keeps publishing in the background
// no matter which vault is open: the timer walks all connected vaults, publishes the
// active one on change and refreshes the rest once per run. Connections are surfaced
// together so Settings shows them from any vault instead of pretending the current
// vault is "unconfigured".

// The mobile client watches the published revision, so this is the latency budget for the
// desktop half of that conversation. A short quiet window coalesces one editing gesture while
// the five-second publication floor prevents continuous snapshot churn. Together with mobile's
// two-second revision probe, a settled edit is normally visible on the other device in roughly
// three to seven seconds.
const CHECK_INTERVAL_MS = 2_000;
const QUIET_PERIOD_MS = 1_000;
const FIRST_TICK_MS = 1_500;
interface VaultRuntime {
  /** Last lightweight revision observed for the active vault (change detection). */
  observed: string | null;
  /** Timestamp of the latest observed write in the active vault; 0 when clean. */
  dirtySince: number;
  lastUploadStartedAt: number;
  /** Consecutive failed PUTs and the earliest time their next automatic retry may run. */
  consecutiveFailures: number;
  retryNotBefore: number;
  /** The vault wants a publish attempt on the next tick. */
  pending: boolean;
  /** Content hash last actually uploaded this session; skips redundant network. */
  lastRevision: string | null;
  /** Cheap per-connection DB revision that was last published successfully. */
  lastPublishedDatabaseRevision: string | null;
  phase: NodusServerSyncPhase;
  lastSyncAt: string | null;
  lastError: string | null;
  lastBytes: number | null;
  /** Images sent on the last publication; zero on a republish whose bytes were unchanged. */
  lastAssetsSent: number;
  /** Clean-Markdown ZIPs sent on the last publication. */
  lastLibraryPackagesSent: number;
  /** What the last collection from the mutation ledger did, for the Settings panel. */
  lastInbox: { applied: number; deleted: number; keptLocal: number; refused: number } | null;
  /** Fingerprint of the embeddings last uploaded, so an unchanged index is not resent. */
  lastVectorRevision: Partial<Record<VectorKind, string>>;
  lastVectors: Partial<Record<VectorKind, { count: number; dim: number; bytes: number }>>;
}

const runtimes = new Map<string, VaultRuntime>();
let timer: ReturnType<typeof setInterval> | null = null;
/** When Nodi's notes last went round, so an idle install is not asking every tick. */
let lastNodiNotesSyncAt = 0;
const NODI_NOTES_INTERVAL_MS = 60_000;
let firstTimer: ReturnType<typeof setTimeout> | null = null;
let publishing = false;
let ticking = false;
let syncGeneration = 0;

function ensureRuntime(vaultId: string): VaultRuntime {
  let rt = runtimes.get(vaultId);
  if (!rt) {
    rt = {
      observed: null, dirtySince: 0, lastUploadStartedAt: 0, pending: false,
      consecutiveFailures: 0, retryNotBefore: 0,
      lastRevision: null, lastPublishedDatabaseRevision: null,
      phase: 'idle', lastSyncAt: null, lastError: null, lastBytes: null,
      lastAssetsSent: 0, lastInbox: null, lastVectorRevision: {}, lastVectors: {},
      lastLibraryPackagesSent: 0,
    };
    runtimes.set(vaultId, rt);
  }
  return rt;
}

// A rejection for size is the one publish failure the user can act on from the app,
// so it says how big this vault actually is and which switch shrinks it. The server
// only knows the compressed upload; the uncompressed figure lives here.
function tooLargeMessage(config: VaultServerConfig, serverError: string, rawBytes: number): string {
  const size = `Esta bóveda ocupa ${(rawBytes / (1024 * 1024)).toFixed(1)} MiB sin comprimir.`;
  const lever = config.includePassages
    ? 'Desactiva «Incluir pasajes extraídos» para dejar fuera el texto completo de las obras.'
    : config.includeUserContent
      ? 'Desactiva «Incluir contenido creado por mí» para dejar fuera notas, proyectos y borradores.'
      : 'Pide a quien administra el servidor que amplíe NODUS_MAX_SNAPSHOT_JSON_BYTES.';
  return `${serverError || 'El servidor ha rechazado la publicación por su tamaño.'} ${size} ${lever}`;
}

function logPublishPerf(phase: string, startedAt: bigint, metadata: Record<string, string | number> = {}): bigint {
  const endedAt = process.hrtime.bigint();
  const elapsedMs = Number(endedAt - startedAt) / 1_000_000;
  const rssMiB = process.memoryUsage().rss / (1024 * 1024);
  const details = Object.entries(metadata).map(([key, value]) => `${key}=${value}`).join(' ');
  console.log(`[perf][publish] phase=${phase} elapsedMs=${elapsedMs.toFixed(1)} rssMiB=${rssMiB.toFixed(1)}${details ? ` ${details}` : ''}`);
  return endedAt;
}

/**
 * Whether a publication is in flight right now.
 *
 * The inbox poller skips its tick while this holds. buildServerSnapshot keeps the database
 * for a long synchronous stretch, and better-sqlite3 gives no way to interleave with it —
 * so the poller waits thirty seconds rather than queueing behind it.
 */
export function isPublishing(): boolean {
  return publishing;
}

/**
 * Say that a vault's contents changed, so the next tick publishes it.
 *
 * This is how the inbox poller keeps the promise publishVault used to keep by collecting
 * mutations itself: what a collaborator sent is applied here, and then travels outward on
 * the following publication instead of sitting unseen until something else happened to
 * make the vault look dirty.
 */
export function markVaultDirty(vaultId: string): void {
  ensureRuntime(vaultId).pending = true;
}

/** Last revision this process actually published, for optimistic action preconditions. */
export function currentPublishedRevision(vaultId: string): string | null {
  return runtimes.get(vaultId)?.lastRevision ?? null;
}

/** Record what the last drain of the mutation ledger did, for the Settings panel. */
export function noteVaultInbox(
  vaultId: string,
  counts: { applied: number; deleted: number; keptLocal: number; refused: number },
): void {
  ensureRuntime(vaultId).lastInbox = counts;
}

/** Whether this address names this very machine, and so never crosses a network. */
export function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

// ── Overview surfaced to the renderer ───────────────────────────────────────

function connectionFrom(config: VaultServerConfig): NodusServerConnection {
  const rt = runtimes.get(config.vaultId);
  const phase: NodusServerSyncPhase = rt?.phase ?? (config.enabled ? 'idle' : 'disconnected');
  return {
    vaultId: config.vaultId,
    vaultName: config.vaultName,
    vaultType: config.vaultType,
    isActiveVault: config.isActiveVault,
    url: config.url,
    spaceId: config.spaceId,
    spaceName: config.spaceName,
    language: config.language,
    enabled: config.enabled,
    autoSync: config.autoSync,
    includeUserContent: config.includeUserContent,
    includePassages: config.includePassages,
    includeLibraryDocuments: config.includeLibraryDocuments,
    includeVectors: config.includeVectors,
    includePrimarySources: config.includePrimarySources,
    includeTestimonies: config.includeTestimonies,
    phase,
    lastSyncAt: rt?.lastSyncAt ?? null,
    lastError: rt?.lastError ?? null,
    lastBytes: rt?.lastBytes ?? null,
    lastInbox: rt?.lastInbox ?? null,
  };
}

export function getNodusServerOverview(): NodusServerOverview {
  const configs = listVaultConfigs();
  const connections = configs
    .filter((config) => config.configured)
    .map((config) => connectionFrom(config));
  let active: VaultSummary | null = null;
  try { active = getActiveVault(); } catch { active = null; }
  const activeConfig = configs.find((config) => config.isActiveVault);
  return {
    connections,
    activeVault: {
      id: active?.id ?? '',
      name: active?.name ?? '',
      type: active?.type ?? 'academic',
      connected: Boolean(activeConfig?.configured),
    },
    transport: 'outbound-https',
  };
}

// ── Publishing ──────────────────────────────────────────────────────────────

/**
 * Send the images this publication references, skipping the ones the server already holds.
 *
 * The negotiation round-trip is what makes republishing an unchanged vault nearly free: a
 * corpus with two hundred portraits re-uploads none of them, because the address of an image
 * is the hash of its bytes and unchanged bytes keep their address.
 *
 * A single image failing is not fatal to the publication. The snapshot still names it, the
 * server serves a 404 for that one asset, and the next tick retries — which is a far better
 * outcome than refusing to publish an entire corpus over one unreadable thumbnail.
 */
async function uploadAssets(
  baseUrl: string,
  spaceId: string,
  token: string,
  assets: SnapshotAsset[],
  rt: VaultRuntime,
): Promise<void> {
  const wanted = new Map<string, { data: Buffer; mime: string }>();
  for (const asset of assets) {
    wanted.set(asset.hash, { data: asset.data, mime: asset.mime });
    if (asset.thumbHash && asset.thumbData) wanted.set(asset.thumbHash, { data: asset.thumbData, mime: asset.thumbMime ?? 'image/jpeg' });
  }
  if (wanted.size === 0) return;

  const endpoint = `${baseUrl}/api/v1/spaces/${encodeURIComponent(spaceId)}`;
  const negotiation = await fetchWithTimeout(`${endpoint}/assets/negotiate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ assets: [...wanted].map(([hash, value]) => ({ hash, bytes: value.data.length, mime: value.mime })) }),
  });
  // A server too old to know about assets simply has no such route. Publishing the JSON is
  // still the right thing to do; it just arrives without its illustrations.
  if (negotiation.status === 404) return;
  if (!negotiation.ok) return;
  const { missing = [] } = await negotiation.json().catch(() => ({ missing: [] })) as { missing?: string[] };

  let sent = 0;
  for (const hash of missing) {
    const asset = wanted.get(hash);
    if (!asset) continue;
    try {
      const response = await fetchWithTimeout(`${endpoint}/assets/${hash}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': asset.mime },
        body: asset.data,
      });
      if (response.ok) sent += 1;
    } catch {
      // Network trouble on one image; the next tick negotiates again and retries it.
    }
  }
  rt.lastAssetsSent = sent;
}

/** Upload only the document ZIPs this space does not already hold. */
async function uploadLibraryPackages(
  baseUrl: string,
  spaceId: string,
  token: string,
  packages: ServerLibraryPackage[],
  rt: VaultRuntime,
): Promise<void> {
  rt.lastLibraryPackagesSent = 0;
  if (packages.length === 0) return;
  const endpoint = `${baseUrl}/api/v1/spaces/${encodeURIComponent(spaceId)}/library`;
  const negotiation = await fetchWithTimeout(`${endpoint}/negotiate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ packages: packages.map((entry) => ({ hash: entry.hash, bytes: entry.bytes })) }),
  });
  if (negotiation.status === 404) throw new Error('Actualiza Nodus Server para poder publicar documentos de la biblioteca.');
  if (!negotiation.ok) throw new Error(`El servidor rechazó la negociación de documentos (HTTP ${negotiation.status}).`);
  const { missing = [] } = await negotiation.json().catch(() => ({ missing: [] })) as { missing?: string[] };
  const byHash = new Map(packages.map((entry) => [entry.hash, entry]));
  for (const hash of missing) {
    const item = byHash.get(hash);
    if (!item) continue;
    const response = await fetchWithTimeout(`${endpoint}/packages/${hash}`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/zip',
        'content-length': String(item.data.length),
      },
      body: item.data,
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({})) as { error_description?: string; error?: string };
      throw new Error(problem.error_description || problem.error || `El servidor rechazó ${item.documentId} (HTTP ${response.status}).`);
    }
    rt.lastLibraryPackagesSent += 1;
  }
}

/**
 * Read the owner's publication policy before taking a snapshot. A missing
 * endpoint is treated as a restrictive policy: old servers continue to work
 * for the canonical core, while no newly introduced opt-in projection leaks
 * during an upgrade.
 */
async function readPublicationPolicy(
  config: VaultServerConfig,
  token: string,
): Promise<ServerPublicationPolicy> {
  const endpoint = `${normalizeUrl(config.url)}/api/v1/spaces/${encodeURIComponent(config.spaceId)}/publication-policy`;
  try {
    const response = await fetchWithTimeout(endpoint, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (!response.ok) return RESTRICTIVE_SERVER_PUBLICATION_POLICY;
    const value = await response.json().catch(() => null);
    const policy = normalizeServerPublicationPolicy(value);
    return policy.version === 0 ? RESTRICTIVE_SERVER_PUBLICATION_POLICY : policy;
  } catch {
    return RESTRICTIVE_SERVER_PUBLICATION_POLICY;
  }
}

function effectivePublicationConfig(config: VaultServerConfig, policy: ServerPublicationPolicy): VaultServerConfig {
  return {
    ...config,
    includeUserContent: config.includeUserContent && policy.allowUserContent,
    includePassages: config.includePassages && policy.allowPassages,
    includeLibraryDocuments: config.includeLibraryDocuments && policy.allowLibraryDocuments,
    includeVectors: config.includeVectors && policy.allowVectors,
    includePrimarySources: config.includePrimarySources && policy.allowPrimarySources,
    includeTestimonies: config.includeTestimonies && policy.allowTestimonies,
    includePersonalImports: config.includePersonalImports && policy.allowPersonalImports,
  };
}

function publisherIdForToken(token: string): string {
  // The classic server identifies a publisher by the SHA-256 digest of its
  // bearer token. Sending the same opaque digest lets the personal import
  // endpoint attach rows to the authenticated publisher without exposing it.
  return createHash('sha256').update(token).digest('hex');
}

async function uploadPersonalImport(
  config: VaultServerConfig,
  token: string,
  envelope: ServerPersonalImportEnvelope | null,
): Promise<void> {
  if (!envelope) return;
  // The server import endpoint accepts the compact annotation list. Keep the
  // richer envelope in the wire body as an audit/idempotency envelope, while
  // also projecting its rows into the endpoint's additive legacy shape.
  const annotations = envelope.batches.flatMap((batch) => [
    ...batch.rows
      .filter((entry) => entry.table !== 'writing_draft_reads')
      .map((entry) => ({ ...entry.row, table: entry.table })),
    ...batch.libraryAnnotations.map((entry) => ({ ...entry.annotation, documentId: entry.documentId })),
  ]);
  const body = JSON.stringify({ ...envelope, annotations });
  const base = normalizeUrl(config.url);
  const endpoint = personalImportEndpoint(base, config.spaceId);
  const request = {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'content-type': 'application/vnd.nodus.personal-import+json',
      'x-nodus-publisher-id': envelope.publisher.id,
      'x-nodus-import-id': envelope.batches[0]?.id || '',
    },
    body,
  } satisfies RequestInit;
  let response = await fetchWithTimeout(endpoint, request);
  // Keep the compact alias as a compatibility retry for the first server-web
  // builds while the descriptive route remains canonical.
  if (response.status === 404) {
    response = await fetchWithTimeout(`${base}/api/v1/spaces/${encodeURIComponent(config.spaceId)}/personal/import`, request);
  }
  if (response.status === 404) {
    throw new Error('Actualiza Nodus Server para poder importar anotaciones personales.');
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string; error_description?: string };
    throw new Error(result.error_description || result.error || `El servidor rechazó la importación personal (HTTP ${response.status}).`);
  }
}

/**
 * Publish the corpus embeddings so the server can answer a semantic query.
 *
 * Separate from the snapshot on purpose: the matrix is binary, it is an order of magnitude
 * larger than the JSON, and it changes only when the vault is re-indexed — so it carries its
 * own fingerprint and is skipped entirely on a normal publication.
 *
 * Ideas always; passages only when the user has chosen to share the passages themselves,
 * because a vector set is derived from the very text that switch exists to withhold.
 */
async function publishVectors(
  config: VaultServerConfig,
  token: string,
  vectors: Awaited<ReturnType<typeof buildServerSnapshotInUtility>>['vectors'],
  rt: VaultRuntime,
): Promise<void> {
  if (!config.includeVectors) return;
  const endpoint = `${normalizeUrl(config.url)}/api/v1/spaces/${encodeURIComponent(config.spaceId)}/vectors`;
  for (const vector of vectors) {
    const { kind, revision, compressed, summary } = vector;
    if (rt.lastVectorRevision[kind] === revision) continue;
    try {
      const response = await fetchWithTimeout(`${endpoint}?kind=${kind}`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/vnd.nodus.vectors',
          'content-encoding': 'gzip',
        },
        body: compressed,
      });
      // A server too old to know about vectors has no such route; the corpus is still
      // published and semantic search simply reports itself as unindexed there.
      if (response.status === 404) return;
      if (!response.ok) return;
      rt.lastVectorRevision[kind] = revision;
      rt.lastVectors = { ...rt.lastVectors, [kind]: { count: summary.count, dim: summary.dim, bytes: compressed.length } };
    } catch {
      // Retried on the next publication; nothing was recorded as sent.
    }
  }
}

/** Upload one vault's filtered snapshot. Serialized: at most one publish at a time. */
async function publishVault(vaultId: string, automatic = false): Promise<void> {
  if (publishing) return;
  const vault = getVault(vaultId);
  if (!vault) { runtimes.delete(vaultId); return; }
  const config = readVaultConfig(vault);
  const token = getNodusServerTokenFor(vaultId);
  if (!config.configured || !config.enabled || !token) return;

  const db = vault.active ? getDb() : openReadOnly(vault.path);
  if (!db) return;
  const cloudGate = config.kind === 'cloudflare' ? cloudflareSyncGate(`publish:${vaultId}`, config.url, token) : null;
  if (cloudGate && !cloudGate.begin(!automatic)) return;

  publishing = true;
  const publicationGeneration = syncGeneration;
  const rt = ensureRuntime(vaultId);
  rt.lastUploadStartedAt = Date.now();
  rt.phase = 'syncing';
  try {
    if (config.kind === 'cloudflare') {
      const databaseRevision = publishSourceRevision(lightweightVaultRevision(db), config);
      if (databaseRevision && rt.lastPublishedDatabaseRevision === databaseRevision) {
        rt.phase = 'ok';
        rt.pending = false;
        rt.dirtySince = 0;
        clearPublishRetry(rt);
        return;
      }
      const library = config.includeLibraryDocuments ? await buildServerLibraryPublicationAsync() : null;
      if (publicationGeneration !== syncGeneration) throw new Error('La publicación se ha detenido.');
      const result = await publishVaultToCloudflareInUtility({
        vaultPath: vault.path,
        vault,
        config,
        token,
        library,
      });
      rt.lastRevision = result.revision;
      rt.dirtySince = 0;
      rt.pending = false;
      rt.phase = 'ok';
      rt.lastError = null;
      rt.lastSyncAt = result.updatedAt;
      rt.lastBytes = result.bytes;
      rt.lastAssetsSent = result.assetsSent;
      rt.lastLibraryPackagesSent = result.libraryPackagesSent;
      rt.lastPublishedDatabaseRevision = databaseRevision;
      clearPublishRetry(rt);
      if (vault.active) rt.observed = lightweightVaultRevision(db);
      return;
    }
    // Collecting what collaborators sent used to happen here, right before the snapshot, so
    // their work travelled back out in the same publication. It now belongs to inboxPoller,
    // which drains the ledger every thirty seconds whether or not anything is published —
    // an idle desktop never published, and so never collected at all. What the comment here
    // defended is preserved by the poller calling markVaultDirty() after it applies: the
    // next publication carries the collaborator's work outward exactly as before.
    //
    // Splitting them also disposes of the concurrency question rather than answering it.
    // better-sqlite3 is synchronous and both would run on the one main-process thread, so
    // "never at the same time" would have to be a flag shared between two modules.
    // total_changes + data_version is connection-local but stable for the pooled connection.
    // It cannot miss writes made by this connection or another one. Library packages live
    // outside SQLite, so that opt-in deliberately bypasses this early shortcut.
    const policy = await readPublicationPolicy(config, token);
    const publicationConfig = effectivePublicationConfig(config, policy);
    const databaseRevision = publishSourceRevision(lightweightVaultRevision(db), publicationConfig);
    if (databaseRevision && rt.lastPublishedDatabaseRevision === databaseRevision) {
      rt.phase = 'ok';
      rt.pending = false;
      rt.dirtySince = 0;
      clearPublishRetry(rt);
      return;
    }
    const library = publicationConfig.includeLibraryDocuments ? await buildServerLibraryPublicationAsync() : null;
    if (publicationGeneration !== syncGeneration) throw new Error('La publicación se ha detenido.');
    let publishPhaseStartedAt = process.hrtime.bigint();
    const snapshot = await buildServerSnapshotInUtility({
      vaultPath: vault.path,
      vault: { ...vault },
      settings: {
        nodusServerIncludeUserContent: publicationConfig.includeUserContent,
        nodusServerIncludePassages: publicationConfig.includePassages,
        nodusServerIncludePrimarySources: publicationConfig.includePrimarySources,
        nodusServerIncludeTestimonies: publicationConfig.includeTestimonies,
        nodusServerIncludePersonalImports: publicationConfig.includePersonalImports,
      },
      library: library?.manifest ?? null,
      libraryAnnotations: library?.personalAnnotations,
      publisherId: publisherIdForToken(token),
      vectorKinds: publicationConfig.includeVectors
        ? (publicationConfig.includePassages ? ['ideas', 'documents', 'passages'] : ['ideas', 'documents']) as VectorKind[]
        : [],
    });
    publishPhaseStartedAt = logPublishPerf('utility-snapshot-gzip:complete', publishPhaseStartedAt, {
      rawBytes: snapshot.rawBytes,
      compressedBytes: snapshot.compressed.byteLength,
    });
    // Nothing changed since our last upload this session: keep the server as-is and
    // avoid the round-trip. The very first publish after launch always runs (no cache).
    if (rt.lastRevision && rt.lastRevision === snapshot.revision) {
      await publishVectors(publicationConfig, token, snapshot.vectors, rt);
      rt.phase = 'ok';
      rt.pending = false;
      rt.dirtySince = 0;
      rt.lastPublishedDatabaseRevision = databaseRevision;
      clearPublishRetry(rt);
      if (vault.active) rt.observed = lightweightVaultRevision(db);
      return;
    }
    // Images travel on their own content-addressed channel, before the JSON that references
    // them: a snapshot naming a hash the server does not hold would leave a report with a
    // broken illustration until the next publication.
    if (snapshot.assets.length > 0) {
      await uploadAssets(normalizeUrl(config.url), config.spaceId, token, snapshot.assets, rt);
    }
    if (library) {
      await uploadLibraryPackages(normalizeUrl(config.url), config.spaceId, token, library.packages, rt);
    }
    const response = await fetchWithTimeout(
      `${normalizeUrl(config.url)}/api/v1/spaces/${encodeURIComponent(config.spaceId)}/snapshot`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/vnd.nodus.snapshot+json',
          'content-encoding': 'gzip',
          'x-nodus-revision': snapshot.revision,
        },
        body: snapshot.compressed,
      },
    );
    logPublishPerf('snapshot-put:complete', publishPhaseStartedAt, {
      status: response.status,
      bytes: snapshot.compressed.byteLength,
    });
    const result = await response.json().catch(() => ({})) as { updatedAt?: string; error?: string };
    if (response.status === 401 || response.status === 403) {
      // The server revoked this device. Drop only the token so the vault stops trying
      // and shows as needing a fresh pairing; leave its settings for a quick reconnect.
      clearNodusServerTokenFor(vaultId);
      rt.phase = 'error';
      rt.lastError = 'El servidor ha revocado este dispositivo. Genera un código nuevo y vuelve a emparejar el vault.';
      rt.pending = false;
      return;
    }
    if (response.status === 413) throw new Error(tooLargeMessage(config, result.error || '', snapshot.rawBytes));
    if (!response.ok) throw new Error(result.error || `El servidor respondió con HTTP ${response.status}.`);
    await uploadPersonalImport(publicationConfig, token, snapshot.personal);
    rt.lastRevision = snapshot.revision;
    rt.dirtySince = 0;
    rt.pending = false;
    rt.phase = 'ok';
    rt.lastPublishedDatabaseRevision = databaseRevision;
    clearPublishRetry(rt);
    // Cleared here and nowhere else it mattered: this was written on failure and never taken
    // back, so one 502 while the server restarted stayed on the panel for the rest of the
    // session — beside a publication that had just succeeded and an inbox that had just
    // applied a change. An error that outlives its cause is worse than no error at all,
    // because the reader cannot tell it is over.
    rt.lastError = null;
    rt.lastSyncAt = result.updatedAt || new Date().toISOString();
    rt.lastBytes = snapshot.compressed.length;
    // After the snapshot, so a client that sees the new revision already has rows for
    // whatever the matrix points at.
    await publishVectors(publicationConfig, token, snapshot.vectors, rt);
    if (vault.active) rt.observed = lightweightVaultRevision(db);
  } catch (error) {
    rt.phase = 'error';
    rt.lastError = error instanceof Error ? error.message : String(error);
    rt.pending = false;
    rt.dirtySince = 0;
    notePublishFailure(rt);
    if (cloudGate) {
      cloudGate.finish(true, error instanceof ServerHttpError ? error.status : undefined);
      if (error instanceof ServerHttpError && (error.status === 401 || error.status === 403)) clearNodusServerTokenFor(vaultId);
      if (cloudGate.paused) rt.lastError += ' La sincronización automática se ha detenido para evitar llamadas repetidas. Vuelve a conectar o sincroniza manualmente tras resolver el error.';
    }
  } finally {
    if (cloudGate && rt.phase !== 'error') cloudGate.finish();
    publishing = false;
  }
}

/**
 * Nodi's notes, on the same tick but on their own terms.
 *
 * They are not a space, so they do not belong to any of the per-vault runtimes: one exchange
 * per tick, over whichever connection happens to be configured, and never more than once
 * even when five vaults are connected to the same server.
 */
async function tickNodiNotes(configs: VaultServerConfig[]): Promise<void> {
  const target = configs.find((config) => config.url && hasNodusServerTokenFor(config.vaultId));
  if (!target) return;
  const token = getNodusServerTokenFor(target.vaultId);
  if (!token) return;
  const gate = target.kind === 'cloudflare' ? cloudflareSyncGate('nodi-notes', target.url, token) : null;
  if (Date.now() - lastNodiNotesSyncAt < NODI_NOTES_INTERVAL_MS && !nodiNotesPending(target.url)) return;
  if (gate && !gate.begin()) return;
  lastNodiNotesSyncAt = Date.now();
  try {
    if (gate) await requireCloudflareSafety(target.url);
    const result = await syncNodiNotes({ url: target.url, token });
    gate?.finish(Boolean(result.error), result.status ?? undefined);
  } catch (error) {
    gate?.finish(true,error instanceof ServerHttpError ? error.status : undefined);
    throw error;
  }
}

async function tick(): Promise<void> {
  if (publishing || ticking) return;
  ticking = true;
  try { await tickOnce(); }
  catch (error) { console.warn('[server-sync] background pass failed', error); }
  finally { ticking = false; }
}

async function tickOnce(): Promise<void> {
  const configs = listVaultConfigs().filter((config) => config.configured && config.enabled);
  if (configs.length === 0) return;

  // 0) Nodi's notes first: one small request, and it must not wait behind a 40 MB snapshot.
  await tickNodiNotes(configs);

  // 1) The active vault is the only one whose contents change while the app runs.
  //    Detect a change cheaply and, after the quiet + min-interval windows, flag it.
  const active = configs.find((config) => config.isActiveVault);
  if (active && active.autoSync) {
    const rt = ensureRuntime(active.vaultId);
    try {
      const revision = lightweightVaultRevision(getDb());
      if (rt.observed === null) rt.observed = revision;
      else if (revision !== rt.observed) {
        rt.observed = revision;
        // A quiet period is measured from the latest write, not the first one. Otherwise a
        // long paragraph is published halfway through merely because typing began five seconds
        // ago, followed by another almost-identical snapshot as soon as the interval allows.
        rt.dirtySince = Date.now();
      }
      if (
        rt.dirtySince &&
        Date.now() - rt.dirtySince >= QUIET_PERIOD_MS &&
        mayAttemptPublish(rt)
      ) {
        rt.pending = true;
      }
    } catch { /* the active DB may be mid-switch */ }
  }

  // 2) Publish one pending vault per tick (active-first so edits win over refreshes).
  const selectionNow = Date.now();
  for (const config of configs) {
    const rt = ensureRuntime(config.vaultId);
    if (publishRetryIsDue(rt, selectionNow)) rt.pending = true;
  }
  const target = [active, ...configs.filter((config) => !config.isActiveVault)]
    .find((config) => {
      if (!config || !config.autoSync) return false;
      const rt = ensureRuntime(config.vaultId);
      const token = getNodusServerTokenFor(config.vaultId);
      return rt.pending && mayAttemptPublish(rt, selectionNow)
        && (config.kind !== 'cloudflare' || Boolean(token && cloudflareSyncGate(`publish:${config.vaultId}`, config.url, token).ready(selectionNow)));
    });
  if (target) await publishVault(target.vaultId, true);
}

export function startNodusServerSync(): void {
  stopNodusServerSync();
  const configs = listVaultConfigs().filter((config) => config.configured);
  // Queue a refresh publish for every enabled connection: this reflects any change made
  // while the app was closed or while another vault was open, and flips their status to
  // "ok" on startup instead of leaving them stuck at idle. Content-hash caching in
  // publishVault keeps unchanged vaults from re-uploading beyond the first launch pass.
  for (const config of configs) {
    const rt = ensureRuntime(config.vaultId);
    // stop/start closes the read-only pool. A fresh SQLite connection resets
    // total_changes/data_version, so no pre-build fingerprint may cross that boundary.
    rt.lastPublishedDatabaseRevision = null;
    if (config.enabled && config.autoSync) rt.pending = true;
    if (config.isActiveVault) rt.observed = null;
  }
  // Prune runtime for vaults that are no longer connected.
  const live = new Set(configs.map((config) => config.vaultId));
  for (const id of [...runtimes.keys()]) if (!live.has(id)) runtimes.delete(id);

  if (configs.length === 0) return;
  firstTimer = setTimeout(() => void tick(), FIRST_TICK_MS);
  firstTimer.unref?.();
  timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  timer.unref?.();
}

// A global-library write does not increment any vault database's change counter. Mark every
// opted-in connection explicitly so the next normal publisher tick includes it.
onGlobalLibraryChanged(() => {
  for (const config of listVaultConfigs()) {
    if (config.configured && config.enabled && config.autoSync && config.includeLibraryDocuments) {
      ensureRuntime(config.vaultId).pending = true;
    }
  }
});

export function stopNodusServerSync(): void {
  syncGeneration += 1;
  if (timer) clearInterval(timer);
  if (firstTimer) clearTimeout(firstTimer);
  timer = null; firstTimer = null;
  cancelCloudflarePublications();
  closeReadOnlyPool();
}

export function restartNodusServerSync(): void {
  startNodusServerSync();
}

// ── User actions ────────────────────────────────────────────────────────────

export async function pairNodusServer(urlValue: string, code: string): Promise<NodusServerPairResult> {
  const url = normalizeUrl(urlValue);
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode) throw new Error('Introduce el código temporal generado por Nodus Server.');
  if (cleanCode.length > 64) throw new Error('El código temporal no es válido.');
  const active = getActiveVault();
  const rt = ensureRuntime(active.id);
  rt.phase = 'checking';
  rt.lastError = null;
  try {
    const response = await fetchWithTimeout(`${url}/api/v1/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: cleanCode, deviceName: `Nodus Desktop · ${os.hostname()}` }),
    });
    const result = await response.json().catch(() => ({})) as { accessToken?: string; error?: string; space?: { id: string; name: string }; server?: { name: string; service?: string; publicUrl: string; language?: AppLanguage } };
    if (!response.ok || !result.accessToken || !result.space) throw new Error(result.error || `El servidor respondió con HTTP ${response.status}.`);
    // A server states its own public URL, and normally that is the address worth keeping: the
    // domain people type is not necessarily the one used to pair. The exception is a server on
    // this very machine — basic mode — whose public URL names how *other devices* reach it, over
    // a certificate this process cannot validate. Pairing over loopback means the caller wants
    // the loopback channel, so it keeps it.
    const pairedUrl = isLoopbackUrl(url) ? url : normalizeUrl(result.server?.publicUrl || url);
    // Pairing always targets the currently open vault, so the active-vault token wrapper
    // and updateSettings both write to the right place.
    setNodusServerToken(result.accessToken);
    const language = normalizeUiLanguage(result.server?.language ?? 'en');
    updateSettings({ nodusServerKind: result.server?.service === 'nodus-cloudflare' ? 'cloudflare' : 'classic', nodusServerUrl: pairedUrl, nodusServerSpaceId: result.space.id, nodusServerSpaceName: result.space.name, nodusServerLanguage: language, nodusServerEnabled: true });
    runtimes.delete(active.id);
    startNodusServerSync();
    // The one explicit full publication happens immediately; later work is debounced.
    await publishVault(active.id);
    return { ok: true, serverName: result.server?.name || 'Nodus Server', spaceId: result.space.id, spaceName: result.space.name, language };
  } catch (error) {
    rt.phase = 'error';
    rt.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/** Publish one vault right now (ignores the debounce and autoSync, honors the pause switch). */
export async function syncNodusServerVaultNow(vaultId: string): Promise<NodusServerOverview> {
  const vault = getVault(vaultId);
  const token = getNodusServerTokenFor(vaultId);
  if (vault && token) {
    const config = readVaultConfig(vault);
    if (config.kind === 'cloudflare') {
      cloudflareSyncGate(`inbox:${vaultId}`, config.url, token).resume();
      cloudflareSyncGate('nodi-notes', config.url, token).resume();
    }
  }
  await publishVault(vaultId);
  return getNodusServerOverview();
}

export async function setNodusServerLanguage(languageValue: AppLanguage, vaultId?: string): Promise<NodusServerOverview> {
  const targetId = vaultId || getActiveVault().id;
  const vault = getVault(targetId);
  if (!vault) throw new Error('Bóveda no encontrada.');
  const config = readVaultConfig(vault);
  const token = getNodusServerTokenFor(targetId);
  if (!config.url || !config.spaceId || !token) {
    throw new Error('Conecta este vault a Nodus Server antes de cambiar su idioma.');
  }
  const language = normalizeUiLanguage(languageValue);
  const response = await fetchWithTimeout(`${normalizeUrl(config.url)}/api/v1/settings/language`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ language }),
  });
  const result = await response.json().catch(() => ({})) as { language?: AppLanguage; error?: string };
  if (!response.ok || !result.language) throw new Error(result.error || `El servidor respondió con HTTP ${response.status}.`);
  const accepted = normalizeUiLanguage(result.language);
  if (vault.active) updateSettings({ nodusServerLanguage: accepted });
  else await withVaultDatabase(targetId, () => { updateSettings({ nodusServerLanguage: accepted }); });
  const rt = runtimes.get(targetId);
  if (rt) rt.lastError = null;
  return getNodusServerOverview();
}

export async function disconnectNodusServerVault(vaultId: string): Promise<NodusServerOverview> {
  const vault = getVault(vaultId);
  const clearBlob = () => updateSettings({ nodusServerEnabled: false, nodusServerUrl: '', nodusServerSpaceId: '', nodusServerSpaceName: '' });
  if (vault?.active) clearBlob();
  else if (vault) await withVaultDatabase(vaultId, clearBlob);
  clearNodusServerTokenFor(vaultId);
  runtimes.delete(vaultId);
  startNodusServerSync();
  return getNodusServerOverview();
}
