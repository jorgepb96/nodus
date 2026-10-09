import type { PrimarySourceSearchRequest } from '@shared/primarySourcesTypes';
import { searchPrimarySourceCorpus, primarySourceSemanticItemIds } from '../db/primarySourceResearchRepo';
import { findArchiveItemsSimilar } from '../db/archiveRepo';
import { embedQuery } from './aiClient';
import { getDb } from '../db/database';

export async function searchPrimarySourceHybrid(request: PrimarySourceSearchRequest) {
  const db = getDb();
  const literal = searchPrimarySourceCorpus(request);
  if (literal.queryText.trim().length < 2) return literal;
  const ids = primarySourceSemanticItemIds(request);
  if (!ids.length) return literal;
  try {
    const vector = await embedQuery(literal.queryText);
    if (!vector || getDb() !== db || !db.open) return { ...literal, semanticAvailable: false };
    const hits = await findArchiveItemsSimilar(vector, { includeItemIds: ids, limit: request.limit ?? 250, minSimilarity: 0.3 });
    if (getDb() !== db || !db.open) return { ...literal, semanticAvailable: false };
    return { ...searchPrimarySourceCorpus(request, new Map(hits.map((hit) => [hit.itemId, hit.similarity]))), semanticAvailable: true };
  } catch { return { ...literal, semanticAvailable: false }; }
}
