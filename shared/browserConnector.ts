// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import type { LibraryItemMetadata } from './libraryTypes';

/** A desktop confirmation requested before a browser origin receives its local token. */
export interface BrowserConnectorPairingPrompt {
  requestId: string;
  origin: string;
  official: boolean;
}

export interface BrowserConnectorAttachmentCandidate {
  url: string;
  title: string;
  fileName?: string;
  mimeType?: string;
  role?: 'original' | 'supplement' | 'snapshot' | 'image' | 'dataset' | 'other';
  /** The URL is a scholarly landing link whose publisher-declared PDF must be resolved. */
  resolveFullText?: boolean;
}

export interface BrowserConnectorCaptureRequest {
  pageUrl: string;
  metadataSource: 'highwire' | 'json-ld' | 'coins' | 'dublin-core' | 'open-graph' | 'direct-file' | 'generic';
  metadata: LibraryItemMetadata;
  /** Reviewed values must not be replaced by another provider lookup on save. */
  metadataReviewed?: boolean;
  /** Idempotency key retained across worker restarts and uncertain responses. */
  captureRequestId?: string;
  /** Several independent records share the listing URL. */
  sourceIsResultPage?: boolean;
  collectionId?: string | null;
  tags?: string[];
  attachments?: BrowserConnectorAttachmentCandidate[];
  snapshotHtml?: string;
}

export interface BrowserConnectorCapturePreviewItem {
  request: BrowserConnectorCaptureRequest & { snapshotAvailable?: boolean };
  warnings: string[];
}

export interface BrowserConnectorCapturePreview extends BrowserConnectorCapturePreviewItem {
  /** Independent records advertised by a search/results page. Omitted for a normal page. */
  candidates?: BrowserConnectorCapturePreviewItem[];
}

export interface BrowserConnectorPendingUpload extends BrowserConnectorAttachmentCandidate {
  reason: string;
}

export type BrowserConnectorSaveDisposition = 'created' | 'updated' | 'existing';

export interface BrowserConnectorSaveResult {
  ok: true;
  itemId: string;
  /** Whether capture created a record, changed an existing one, or was a no-op. */
  disposition: BrowserConnectorSaveDisposition;
  /** True when the capture matched an existing record instead of creating one. */
  deduplicated: boolean;
  matchedBy?: 'request' | 'identifier' | 'bibliography' | 'url';
  title: string;
  attachmentCount: number;
  extractionStatus: string | null;
  warnings: string[];
  pendingUploads: BrowserConnectorPendingUpload[];
}

export interface BrowserCaptureJob {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: 'queued' | 'saving' | 'downloading' | 'needs-permission' | 'failed' | 'complete';
  port?: number;
  temporaryOrigins?: string[];
  entries: Array<{
    title: string;
    request: BrowserConnectorCaptureRequest | null;
    result: BrowserConnectorSaveResult | null;
    error: string | null;
    uploads: Array<{
      attachment: BrowserConnectorPendingUpload;
      status: 'queued' | 'downloading' | 'needs-permission' | 'failed' | 'complete';
      error: string | null;
    }>;
  }>;
}
