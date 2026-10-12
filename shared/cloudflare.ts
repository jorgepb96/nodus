/**
 * Public contract shared by Nodus Desktop, Mobile and the Cloudflare Worker.
 *
 * Keep this file browser-safe.  It is intentionally free of Electron, Node and
 * Cloudflare runtime imports so the mobile application can consume the same
 * protocol package without pulling a platform implementation with it.
 */

export const NODUS_CLOUDFLARE_PROTOCOL = 3 as const;
export const NODUS_CLOUDFLARE_SERVICE = 'nodus-cloudflare' as const;

export const CLOUDFLARE_SAFETY_UPGRADE_MESSAGE = 'Actualiza el Worker de Nodus Cloud y aplica sus migraciones antes de sincronizar: esta instalación todavía no anuncia los límites acumulados y la limpieza persistente.';
export function hasCloudflareSafetyFeatures(value: unknown): boolean {
  const features = (value as { features?: Record<string, unknown> } | null)?.features;
  return ['syncBudget','durableObjectCleanup','binarySync','mutationRelay'].every((name)=>features?.[name]===true);
}
export const NODUS_CLOUDFLARE_WORKER_VERSION = '1.0.0' as const;
export const NODUS_CLOUDFLARE_TEMPLATE_URL = 'https://github.com/jorgepb96/nodus/tree/main/cloudflare' as const;
export const NODUS_CLOUDFLARE_DEPLOY_ORIGIN = 'https://deploy.workers.cloudflare.com' as const;

export type NodusServerKind = 'classic' | 'cloudflare';
export type CloudflareVectorMode = 'none' | 'vectorize' | 'r2-exact';

export interface CloudflareCapabilityDocument {
  service: typeof NODUS_CLOUDFLARE_SERVICE;
  version: string;
  protocolVersion: number;
  sourceCodeUrl: string;
  license: 'AGPL-3.0-only';
  server: {
    name: string;
    language: string;
    installationId?: string | null;
  };
  publication: {
    generations: true;
    resumable: true;
    tableChunkRows: number;
    tableChunkBytes: number;
    objectPartBytes: number;
    maxMutationBytes: number;
    maxMutationBatch: number;
  };
  storage: {
    structured: 'd1';
    objects: 'r2';
    vectorSearch: Array<'vectorize' | 'r2-exact' | 'lexical'>;
    /** Vectorize bindings actually present in this user-owned deployment. */
    vectorizeDimensions?: number[];
  };
  features: {
    snapshots: true;
    assets: true;
    library: true;
    vectors: true;
    mutations: true;
    binarySync?: true;
    mutationRelay?: true;
    syncBudget?: true;
    durableObjectCleanup?: true;
    nodiNotes: true;
    oauth: true;
    mcp: true;
    recovery: true;
  };
}

export interface CloudflareVaultInventory {
  vaultId: string;
  vaultName: string;
  vaultType: string;
  schemaVersion: number;
  generatedAt: string;
  structured: {
    tables: number;
    rows: number;
    jsonBytes: number;
    estimatedD1Bytes: number;
    estimatedIndexBytes: number;
  };
  objects: {
    uniqueObjects: number;
    structuredOverflowBytes: number;
    assetBytes: number;
    libraryBytes: number;
    snapshotBytes: number;
    vectorBackupBytes: number;
    retainedGenerationBytes: number;
  };
  vectors: Array<{
    kind: 'ideas' | 'documents' | 'passages';
    provider: string;
    model: string;
    count: number;
    dimensions: number;
    bytes: number;
    mode: CloudflareVectorMode;
  }>;
  activity: {
    devices: number;
    publicationsPerMonth: number;
    apiReadsPerMonth: number;
    semanticQueriesPerMonth: number;
    mutationRowsPerMonth: number;
    estimatedWorkerRequestsPerMonth: number;
    averageWorkerCpuMs: number;
    estimatedEgressBytesPerMonth: number;
  };
}

export interface CloudflarePriceSource {
  url: string;
  checkedAt: string;
  label: string;
}

export interface CloudflarePricingCatalog {
  schemaVersion: 1;
  currency: 'USD';
  effectiveAt: string;
  checkedAt: string;
  sources: Record<string, CloudflarePriceSource>;
  workers: {
    freeRequestsPerDay: number;
    freeCpuMsPerInvocation: number;
    paidMinimumPerMonth: number;
    paidIncludedRequestsPerMonth: number;
    paidRequestPerMillion: number;
    paidIncludedCpuMsPerMonth: number;
    paidCpuPerMillionMs: number;
  };
  d1: {
    freeRowsReadPerDay: number;
    freeRowsWrittenPerDay: number;
    freeStorageBytes: number;
    freeDatabaseBytes: number;
    paidIncludedRowsReadPerMonth: number;
    paidRowsReadPerMillion: number;
    paidIncludedRowsWrittenPerMonth: number;
    paidRowsWrittenPerMillion: number;
    paidIncludedStorageBytes: number;
    paidStoragePerGbMonth: number;
  };
  r2: {
    freeStandardStorageBytesMonth: number;
    freeClassAOpsPerMonth: number;
    freeClassBOpsPerMonth: number;
    standardStoragePerGbMonth: number;
    classAPerMillion: number;
    classBPerMillion: number;
    egressPerGb: 0;
  };
  vectorize: {
    freeStoredDimensions: number;
    freeQueriedDimensionsPerMonth: number;
    paidIncludedStoredDimensions: number;
    paidIncludedQueriedDimensionsPerMonth: number;
    storedPerHundredMillion: number;
    queriedPerMillion: number;
    maxDimensions: number;
  };
}

export interface CloudflareCostLine {
  service: 'Workers' | 'D1' | 'R2' | 'Vectorize';
  metric: string;
  amount: number;
  unit: string;
  freeAllowance: number;
  estimatedUsd: number;
  withinFreeAllowance: boolean;
  sourceUrl: string;
}

export interface CloudflareCostScenario {
  id: 'reduced' | 'expected' | 'intensive';
  multiplier: number;
  estimatedUsdPerMonth: number;
  withinFreeTier: boolean;
  blockers: string[];
  lines: CloudflareCostLine[];
}

export interface CloudflareCostEstimate {
  inventory: CloudflareVaultInventory;
  catalogCheckedAt: string;
  catalogEffectiveAt: string;
  catalogStale: boolean;
  scenarios: CloudflareCostScenario[];
  summary: string;
}

export interface CloudflareDeployPreview {
  estimate: CloudflareCostEstimate;
  catalogLive: boolean;
  catalogWarning: string | null;
  officialSources: CloudflarePriceSource[];
}

export type CloudflareDeployStepId =
  | 'inventory'
  | 'prepare'
  | 'cloudflare-deploy'
  | 'verify'
  | 'bootstrap'
  | 'publish';

export interface CloudflareDeployStep {
  id: CloudflareDeployStepId;
  label: string;
  state: 'pending' | 'running' | 'complete' | 'action-required' | 'error';
  detail: string | null;
}

export interface CloudflareDeploymentRecord {
  deploymentMethod: 'cloudflare-button';
  installationId: string;
  spaceId: string;
  url: string;
  workerVersion: string;
  deployedAt: string;
  templateUrl: string;
}

export interface CloudflareDeployState {
  phase: 'idle' | 'estimating' | 'ready' | 'awaiting-cloudflare' | 'connecting' | 'complete' | 'error';
  estimate: CloudflareCostEstimate | null;
  steps: CloudflareDeployStep[];
  deployment: CloudflareDeploymentRecord | null;
  /** Official Cloudflare URL. It contains only the public template URL. */
  deployUrl: string | null;
  /** SHA-256 verifier pasted into Cloudflare; it cannot bootstrap the Worker by itself. */
  setupCode: string | null;
  error: string | null;
  /** Displayed once after bootstrap; never persisted in renderer-readable settings. */
  recoveryKey: string | null;
}

export interface CloudflareCompleteDirectDeployInput {
  workerUrl: string;
  administratorEmail: string;
  administratorPassword: string;
  activity?: Partial<CloudflareVaultInventory['activity']>;
}

export interface CloudflareDirectDeployPreparation {
  deployUrl: string;
  templateUrl: string;
  setupCode: string;
}

export interface CloudflarePublicationManifest {
  protocolVersion: typeof NODUS_CLOUDFLARE_PROTOCOL;
  revision: string;
  schemaVersion: number;
  vault: { id: string; name: string; type: string };
  capabilities: Record<string, boolean>;
  counts: Record<string, number>;
  assets: unknown[];
  rowObjects?: Array<{ hash: string; bytes: number; table: string; key: string }>;
  library: unknown | null;
  snapshot?: { bytes: number; sha256: string; contentEncoding: 'gzip' | 'identity' };
  vectors?: Array<{
    kind: 'ideas' | 'documents' | 'passages';
    provider: string;
    model: string;
    dimensions: number;
    count: number;
    sha256: string;
    bytes: number;
    mode: CloudflareVectorMode;
  }>;
}

export interface CloudflarePublicationSession {
  id: string;
  generation: number;
  deduplicated?: boolean;
  committed?: boolean;
  expiresAt?: string;
  tableChunkRows?: number;
  tableChunkBytes?: number;
  objectPartBytes?: number;
  received?: Record<string, number>;
}
