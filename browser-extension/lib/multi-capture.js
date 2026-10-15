// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import { DETECTOR_LABELS, detectCapture } from './detector.js';

function identity(capture) {
  const metadata = capture?.metadata || {};
  return String(metadata.doi || metadata.pmid || metadata.pmcid || metadata.arxiv
    || metadata.isbn?.[0] || metadata.title || '').normalize('NFKD').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function jsonLdEntities(values) {
  const entities = [];
  const visit = (value, depth = 0) => {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) { for (const entry of value) visit(entry, depth + 1); return; }
    if (typeof value !== 'object') return;
    if (value['@graph']) { visit(value['@graph'], depth + 1); return; }
    if (value['@type']) entities.push(value);
  };
  for (const raw of values || []) {
    try { visit(JSON.parse(raw)); } catch { /* malformed publisher JSON-LD */ }
  }
  return entities;
}

function candidateSnapshot(snapshot, patch) {
  return {
    ...snapshot,
    metas: [], links: [], anchors: [], coins: [], jsonLd: [], html: '',
    ...patch,
  };
}

/**
 * Return several bibliographic records when a results page exposes independent
 * COinS or Schema.org entities. A normal article page still produces one record.
 *
 * `labels` is forwarded to the detector so each adapter reviews the batch in the
 * language it renders.
 */
export function detectCaptureCandidates(snapshot, labels = DETECTOR_LABELS, limit = 50) {
  const candidates = [];
  if ((snapshot?.coins || []).length > 1) {
    for (const coin of snapshot.coins.slice(0, limit)) {
      try {
        const capture = detectCapture(candidateSnapshot(snapshot, { coins: [coin] }), labels);
        if (capture.metadataSource === 'coins') candidates.push(capture);
      } catch { /* one malformed result must not hide the others */ }
    }
  }
  if (candidates.length < 2) {
    candidates.length = 0;
    for (const entity of jsonLdEntities(snapshot?.jsonLd).slice(0, limit)) {
      try {
        const capture = detectCapture(candidateSnapshot(snapshot, { jsonLd: [JSON.stringify(entity)] }), labels);
        if (capture.metadataSource === 'json-ld') candidates.push(capture);
      } catch { /* one malformed result must not hide the others */ }
    }
  }
  const unique = [...new Map(candidates.map((capture) => [identity(capture), capture]).filter(([key]) => key)).values()];
  if (unique.length > 1) return unique.slice(0, limit).map((capture) => ({ ...capture, sourceIsResultPage: true }));
  return [detectCapture(snapshot, labels)];
}
