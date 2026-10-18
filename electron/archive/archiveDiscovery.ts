// Turn the evidence archive into an active research surface. Two complementary ways
// to discover which documents concern which people, both of which only ever PROPOSE a
// link the user confirms:
//   • lexical — a person's name appears (as whole words) in a document's text;
//   • semantic — a document's embedding is close to a person's profile vector, so a
//     letter that never spells the full name but is clearly about them still surfaces.
// Embeddings reuse the same provider + float32-BLOB + vec_cosine machinery as ideas.

import {
  archiveEmbeddingCount,
  archiveItemForEmbedding,
  archiveItemsForEmbedding,
  findArchiveItemsSimilar,
  getItem,
  listItemsForPerson,
  setItemEmbedding,
} from '../db/archiveRepo';
import { getPerson, listEvents, listPersons } from '../db/entitiesRepo';
import { currentEmbeddingConfig, embeddingTextHash } from '../db/ideasRepo';
import { getDb } from '../db/database';
import { getPrimarySourcePolicySettings } from '../db/primarySourceGovernanceRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { embedDocument, embedQuery } from '../ai/aiClient';
import { archiveEmbeddingText, documentHasGenealogyAnchor, nameAppearsInText, personProfileText } from '@shared/archiveDiscovery';
import { decidePrimarySourcePolicy } from '@shared/primarySourcesTypes';
import type { DocumentLinkSuggestion, PersonLinkSuggestion } from '@shared/types';

/**
 * Primary Sources has a stricter content boundary than the legacy evidence archive.
 * Background indexing has no per-item consent UI, so it may only send an open source
 * to an external embedding provider when the vault has disabled confirmation.
 */
function archiveEmbeddingAllowed(itemId: string): boolean {
  if (getActiveVault().type !== 'primary_sources') return true;
  const row = getDb().prepare(
    'SELECT access_status, sensitivity, embargo_until FROM archive_item_profiles WHERE item_id=?'
  ).get(itemId) as {
    access_status: 'open' | 'private' | 'restricted' | 'embargoed' | 'unknown';
    sensitivity: 'normal' | 'personal' | 'sensitive' | 'highly_sensitive';
    embargo_until: string | null;
  } | undefined;
  if (!row) return false;
  const config = currentEmbeddingConfig();
  const local = config.provider === 'nodus'
    || config.provider === 'ollama'
    || config.provider === 'lmstudio';
  const policy = getPrimarySourcePolicySettings();
  if (!local && policy.requireExternalConfirmation) return false;
  return decidePrimarySourcePolicy({
    accessStatus: row.access_status,
    sensitivity: row.sensitivity,
    embargoUntil: row.embargo_until,
    action: local ? 'local_ai' : 'external_ai',
    allowRestrictedLocalAi: policy.allowRestrictedLocalAi,
    allowPrivateExternalAi: policy.allowPrivateExternalAi,
  }).decision === 'allow';
}

/** Embed one archive item's text for semantic discovery. Returns false when there is
 *  no text or no embedding provider configured. */
export async function embedArchiveItem(itemId: string): Promise<boolean> {
  if (!archiveEmbeddingAllowed(itemId)) return false;
  const item = archiveItemForEmbedding(itemId);
  if (!item) return false;
  const text = archiveEmbeddingText(item);
  if (!text) return false;
  const vec = await embedDocument(text);
  if (!vec) return false;
  const config = currentEmbeddingConfig();
  setItemEmbedding(itemId, vec, config.provider, config.model, embeddingTextHash(text));
  return true;
}

/** Index every text-bearing item whose embedding is missing or stale. */
export async function embedArchiveBacklog(): Promise<{ indexed: number; skipped: number }> {
  const config = currentEmbeddingConfig();
  let indexed = 0;
  let skipped = 0;
  for (const row of archiveItemsForEmbedding()) {
    const text = archiveEmbeddingText(row);
    const fresh =
      row.hasEmbedding &&
      row.embeddingProvider === config.provider &&
      row.embeddingModel === config.model &&
      row.embeddingDim != null &&
      row.embeddingDim > 0 &&
      row.embeddingTextHash === embeddingTextHash(text);
    if (fresh) continue;
    if (!archiveEmbeddingAllowed(row.itemId)) {
      skipped++;
      continue;
    }
    const ok = await embedArchiveItem(row.itemId);
    if (ok) indexed++;
    else skipped++;
  }
  return { indexed, skipped };
}

export function archiveIndexStatus(): { indexed: number; total: number } {
  return archiveEmbeddingCount();
}

/** Persons whose name appears in this document's text but who are not yet linked. */
export function suggestPersonsForItem(itemId: string): PersonLinkSuggestion[] {
  const item = getItem(itemId);
  if (!item) return [];
  const text = [item.extractedText, item.description].filter(Boolean).join('\n');
  if (!text) return [];
  const linked = new Set(item.linkedPersons.map((p) => p.personId));
  const out: PersonLinkSuggestion[] = [];
  for (const p of listPersons()) {
    if (linked.has(p.personId)) continue;
    const variants = p.names.map((n) => n.name);
    const hit = nameAppearsInText(p.displayName, variants, text);
    if (hit) out.push({ personId: p.personId, displayName: p.displayName, reason: 'name', score: 1, snippet: hit.matched });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Documents that likely concern this person: first any whose text names them
 * (lexical, high precision), then semantically similar ones not already matched.
 * Excludes documents already linked to the person — discovery proposes only new links.
 */
export async function suggestDocumentsForPerson(personId: string): Promise<DocumentLinkSuggestion[]> {
  const person = getPerson(personId);
  if (!person) return [];
  const linkedIds = new Set(listItemsForPerson(personId).map((i) => i.itemId));
  const variants = person.names.map((n) => n.name);

  const out: DocumentLinkSuggestion[] = [];
  const matched = new Set<string>();

  // Lexical pass: the person's name appears in the document text.
  for (const row of archiveItemsForEmbedding()) {
    if (linkedIds.has(row.itemId)) continue;
    const text = [row.extractedText, row.description].filter(Boolean).join('\n');
    const hit = nameAppearsInText(person.displayName, variants, text);
    if (hit) {
      out.push({ itemId: row.itemId, title: row.title, docType: row.docType, reason: 'name', score: 1, snippet: hit.matched });
      matched.add(row.itemId);
    }
  }

  // Semantic pass: documents close to the person's profile, not already matched.
  const events = listEvents({ personId }).map((e) => ({ type: e.type, date: e.date, place: e.placeName }));
  const places = [...new Set(events.map((e) => e.place).filter((p): p is string => Boolean(p)))];
  const profile = personProfileText({ name: person.displayName, variants, birthDate: person.birthDate, deathDate: person.deathDate, events, places });
  const vec = profile ? await embedQuery(profile) : null;
  if (vec) {
    const similar = await findArchiveItemsSimilar(vec, {
      limit: 8,
      excludePersonId: personId,
      excludeItemIds: [...matched],
    });
    for (const s of similar) {
      const candidateText = [s.extractedText, s.description].filter(Boolean).join('\n');
      if (s.similarity < 0.72 && !documentHasGenealogyAnchor({ name: person.displayName, variants, birthDate: person.birthDate, deathDate: person.deathDate, events, places }, candidateText)) continue;
      out.push({ itemId: s.itemId, title: s.title, docType: s.docType, reason: 'semantic', score: Math.round(s.similarity * 100) / 100, snippet: null });
    }
  }
  return out;
}
