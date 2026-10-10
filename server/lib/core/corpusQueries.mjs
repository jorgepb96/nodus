// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only
// Provider-free read queries shared by Server and the private Mac companion.
// The host owns authorization, body limits, snapshot identity and vector loading.
import { embeddingMatches } from './vectors.mjs';
import { searchVectorsOffThread } from './vectorSearchPool.mjs';
import { lexicalSearch } from './search.mjs';
import { rows } from './snapshot.mjs';
import { embeddingContractsCompatible, fingerprintEmbeddingContract } from './embeddingContract.mjs';
const MAX_CONTEXT_CHARS = 600_000;
const response = (status, body) => ({ status, body });
export function validQueryKind(input) { return ['ideas', 'documents', 'passages'].includes(String(input?.kind || 'ideas')); }

export async function semanticReadQuery(snapshot, input, set, locked = null) {
    if (!validQueryKind(input)) return response(400, { error: 'invalid_vector_kind' });
    const kind = String(input.kind || 'ideas');
    const requested = { provider: String(input.provider || ''), model: String(input.model || ''), dim: Number(input.dim || 0) };

    // An empty list is never allowed to stand in for "this space has no index" or "your
    // provider does not match mine". Reporting absence of evidence from a search that never
    // ran is the exact failure the desktop contract already forbids.
    if (!set) {
      return response(200, {
        results: lexicalSearch(snapshot, input.query, Math.min(50, Number(input.limit) || 20)),
        indexed: false,
        reason: 'no_vectors',
        fallback: 'lexical',
        warning: 'This space has not published semantic vectors, so these results come from a literal text search. An empty result does NOT mean the corpus lacks the topic.',
      });
    }
    const suppliedContract = input.embeddingContract;
    const exactContract = locked && suppliedContract ? embeddingContractsCompatible(locked.contract, suppliedContract) : false;
    const legacyCompatible = locked?.contract?.protocol === 'legacy_locked' && embeddingMatches(set.header, requested);
    if (!exactContract && !legacyCompatible) {
      return response(200, {
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
    }
    const vector = Array.isArray(input.vector) ? input.vector : [];
    if (!vector.every(value => typeof value === 'number' && Number.isFinite(value))) return response(400, { error: 'bad_vector' });
    if (vector.length !== set.dim) {
      return response(400, { error: 'bad_vector', error_description: `This space is indexed at ${set.dim} dimensions and the query vector has ${vector.length}.` });
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
    return response(200, {
      results: matches.map((match) => ({ id: match.id, score: match.score, row: byId.get(String(match.id)) ?? null })),
      indexed: true,
      kind,
      indexable: set.count,
      embedding: locked ?? { provider: set.header.provider, model: set.header.model, dim: set.dim },
    });
}

export function contextReadQuery(snapshot, input, revision) {
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

    return response(200, {
      sections,
      stats: { chars: used, budget, truncated, matched: hits.length },
      vault: snapshot.vault ?? null,
      revision,
      // A citation always resolves against real corpus rows, never against model output.
      citationScheme: { idea: 'nodus://idea/<global_id>', passage: 'nodus://passage/<passage_id>', work: 'nodus://work/<nodus_id>' },
      documentProfilePolicy: 'orientation_only',
    });
}
