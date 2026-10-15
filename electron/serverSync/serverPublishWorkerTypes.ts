import type { VaultSummary } from '@shared/types';
import type { PublishedLibraryManifest } from './serverLibrary';
import type { BuiltServerLibraryPublication } from './serverLibrary';
import type { SnapshotAsset, ServerSnapshotSettings } from './serverSnapshot';
import type { ServerPersonalImportEnvelope } from '@shared/serverPublication';
import type { VaultServerConfig } from './serverSyncShared';
import type { CloudflarePublishResult } from './cloudflarePublisher';
import type { VectorKind, VectorSetSummary } from './serverVectors';

export interface PreparedServerVectorWire {
  kind: VectorKind;
  revision: string;
  compressed: Uint8Array;
  summary: VectorSetSummary;
}

interface BaseWorkerRequest {
  id: number;
  vaultPath: string;
  vault: VaultSummary;
}

export interface ServerSnapshotWorkerRequest extends BaseWorkerRequest {
  kind: 'build';
  settings: ServerSnapshotSettings;
  library: PublishedLibraryManifest | null;
  libraryAnnotations?: import('@shared/serverPublication').ServerPersonalLibraryAnnotation[];
  vectorKinds: VectorKind[];
  publisherId: string;
}

export interface CloudflarePublishWorkerRequest extends BaseWorkerRequest {
  kind: 'publish-cloudflare';
  config: VaultServerConfig;
  token: string;
  library: BuiltServerLibraryPublication | null;
}

export type ServerPublishWorkerRequest = ServerSnapshotWorkerRequest | CloudflarePublishWorkerRequest;

export type ServerPublishWorkerResponse = {
  kind: 'done';
  id: number;
  compressed: Uint8Array;
  rawBytes: number;
  revision: string;
  counts: Record<string, number>;
  assets: SnapshotAsset[];
  schemaVersion: number;
  personal: ServerPersonalImportEnvelope | null;
  vectors: PreparedServerVectorWire[];
} | {
  kind: 'cloudflare-done';
  id: number;
  result: CloudflarePublishResult;
} | {
  kind: 'error';
  id: number;
  error: string;
  status?: number;
};
