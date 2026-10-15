// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/** Review state belongs to each reference, including its own tags and files. */
export function createCaptureReview(capture) {
  return {
    ...capture, metadata: structuredClone(capture.metadata),
    attachmentIndexes: (capture.attachments || []).map((_entry, index) => index),
    includeSnapshot: Boolean(capture.snapshotAvailable && !capture.attachments?.length),
  };
}

export function reviewedCaptureRequest(review, collectionId) {
  const { attachmentIndexes, includeSnapshot, snapshotAvailable, ...capture } = review;
  return {
    ...capture, collectionId, metadataReviewed: true,
    tags: [...(capture.metadata.tags || [])],
    attachments: (capture.attachments || []).filter((_entry, index) => attachmentIndexes.includes(index)),
    snapshotHtml: includeSnapshot ? capture.snapshotHtml : '',
  };
}

export function attachmentOrigins(attachments) {
  return [...new Set(attachments.flatMap((attachment) => {
    try {
      const url = new URL(attachment.url);
      return /^https?:$/.test(url.protocol) ? [`${url.protocol}//${url.hostname}/*`] : [];
    } catch { return []; }
  }))];
}

export function captureJobSummary(job) {
  const entries = job.entries || [];
  return {
    saved: entries.filter((entry) => entry.result).length,
    total: entries.length,
    files: entries.reduce((count, entry) => count + (entry.result?.attachmentCount || 0), 0),
    pending: entries.reduce((count, entry) => count + entry.uploads.filter((upload) => upload.status !== 'complete').length, 0),
    errors: entries.flatMap((entry) => [entry.error, ...entry.uploads.map((upload) => upload.error)].filter(Boolean)),
  };
}
