import type { BrowserConnectorCaptureRequest, BrowserCaptureJob } from '../../shared/browserConnector';
export type CaptureReview = BrowserConnectorCaptureRequest & {
  snapshotAvailable?: boolean;
  attachmentIndexes: number[];
  includeSnapshot: boolean;
};
export function createCaptureReview(capture: BrowserConnectorCaptureRequest & { snapshotAvailable?: boolean }): CaptureReview;
export function reviewedCaptureRequest(review: CaptureReview, collectionId: string | null): BrowserConnectorCaptureRequest;
export function attachmentOrigins(attachments: { url: string }[]): string[];
export function captureJobSummary(job: BrowserCaptureJob): { saved: number; total: number; files: number; pending: number; errors: string[] };
