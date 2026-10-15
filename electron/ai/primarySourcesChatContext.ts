// Grounded, bounded context for Nodi inside a Primary Sources vault. This is
// intentionally separate from genealogy: it preserves archival hierarchy, access
// policy, literal/reviewed text, locators, evidence roles and researcher analysis.

import { embedQuery } from './aiClient';
import { findArchiveItemsSimilar } from '../db/archiveRepo';
import { getDb } from '../db/database';
import { searchPrimarySourceCorpus } from '../db/primarySourceResearchRepo';
import {
  primarySourceExcerptDeepLink,
  primarySourceItemDeepLink,
} from '@shared/primarySourceDeepLink';

const MAX_SOURCES = 10;
const MAX_TEXT_CHARS = 1_800;
const MAX_EXCERPTS = 6;
const MAX_EVIDENCE = 10;

function clip(value: string | null | undefined, limit: number): string | null {
  const clean = String(value ?? '').split('\u0000').join('').trim();
  if (!clean) return null;
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

type SourceRow = {
  item_id: string;
  title: string;
  description: string | null;
  doc_type: string | null;
  access_status: string;
  sensitivity: string;
  reference_code: string | null;
  unit_title: string | null;
  date_display: string | null;
  creator_display: string | null;
  repository_name: string | null;
};

function sourceRow(itemId: string): SourceRow | null {
  const row = getDb().prepare(
    `SELECT ai.item_id, ai.title, ai.description, ai.doc_type,
            p.access_status, p.sensitivity, u.reference_code,
            u.title AS unit_title, u.date_display, u.creator_display,
            r.name AS repository_name
       FROM archive_items ai
       JOIN archive_item_profiles p ON p.item_id=ai.item_id
       LEFT JOIN archive_item_units iu
         ON iu.item_id=ai.item_id AND iu.relation_kind='describes'
       LEFT JOIN archive_description_units u ON u.unit_id=iu.unit_id
       LEFT JOIN archive_repositories r ON r.repository_id=u.repository_id
      WHERE ai.item_id=?`
  ).get(itemId) as SourceRow | undefined;
  return row ?? null;
}

function externallySafe(row: SourceRow | null): row is SourceRow {
  // Nodi has no per-item consent dialogue. It therefore uses only openly
  // accessible, non-highly-sensitive source content in a remote-model context.
  return Boolean(row && row.access_status === 'open' && row.sensitivity !== 'highly_sensitive');
}

function preferredText(itemId: string): {
  textVersionId: string;
  kind: string;
  status: string;
  content: string;
} | null {
  const row = getDb().prepare(
    `SELECT text_version_id AS textVersionId, kind, status, content
       FROM archive_text_versions
      WHERE item_id=?
      ORDER BY
        CASE status WHEN 'reviewed' THEN 0 WHEN 'closed' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
        CASE kind WHEN 'diplomatic' THEN 0 WHEN 'transcription' THEN 0 WHEN 'ocr' THEN 1 WHEN 'normalized' THEN 2 ELSE 3 END,
        updated_at DESC
      LIMIT 1`
  ).get(itemId) as {
    textVersionId: string;
    kind: string;
    status: string;
    content: string;
  } | undefined;
  return row ?? null;
}

function sourceContext(row: SourceRow, semanticScore: number | null, lexicalLayers: string[]) {
  const text = preferredText(row.item_id);
  const excerpts = (getDb().prepare(
    `SELECT excerpt_id, locator_display, quoted_text, review_status
       FROM archive_excerpts
      WHERE item_id=?
      ORDER BY CASE review_status WHEN 'reviewed' THEN 0 ELSE 1 END, created_at DESC
      LIMIT ?`
  ).all(row.item_id, MAX_EXCERPTS) as Array<{
    excerpt_id: string;
    locator_display: string;
    quoted_text: string | null;
    review_status: string;
  }>).map((excerpt) => ({
    locator: excerpt.locator_display,
    quote: clip(excerpt.quoted_text, 700),
    reviewStatus: excerpt.review_status,
    link: primarySourceExcerptDeepLink(row.item_id, excerpt.excerpt_id),
  }));
  const persons = getDb().prepare(
    `SELECT pm.original_label, pm.role, pm.certainty, pm.identity_status,
            p.display_name
       FROM archive_person_mentions pm
       LEFT JOIN persons p ON p.person_id=pm.person_id
      WHERE pm.item_id=? AND pm.person_id IS NOT NULL
      ORDER BY pm.created_at LIMIT 20`
  ).all(row.item_id) as Array<Record<string, unknown>>;
  const places = getDb().prepare(
    `SELECT original_label, role, certainty, status
       FROM archive_place_mentions
      WHERE item_id=? AND place_id IS NOT NULL AND status='resolved'
      ORDER BY created_at LIMIT 20`
  ).all(row.item_id) as Array<Record<string, unknown>>;
  const evidence = getDb().prepare(
    `SELECT target_kind, target_id, evidence_role, certainty, review_status,
            quote, location
       FROM record_evidence
      WHERE source_kind='archive' AND nodus_id=?
      ORDER BY CASE evidence_role WHEN 'contradicts' THEN 0 ELSE 1 END, created_at DESC
      LIMIT ?`
  ).all(row.item_id, MAX_EVIDENCE) as Array<Record<string, unknown>>;
  const analysis = getDb().prepare(
    `SELECT origin_notes, purpose_audience, content_form, perspective_bias,
            silences_limits, authenticity_notes, representativeness, corroboration,
            questions, status
       FROM archive_source_analyses WHERE item_id=?`
  ).get(row.item_id) as Record<string, unknown> | undefined;

  return {
    sourceId: row.item_id,
    title: row.title,
    link: primarySourceItemDeepLink(row.item_id),
    repository: row.repository_name,
    archivalUnit: row.unit_title,
    reference: row.reference_code,
    literalDate: row.date_display,
    creator: row.creator_display,
    documentType: row.doc_type,
    description: row.description,
    retrieval: {
      semanticScore,
      lexicalLayers: [...new Set(lexicalLayers)],
    },
    preferredText: text ? {
      kind: text.kind,
      reviewStatus: text.status,
      content: clip(text.content, MAX_TEXT_CHARS),
    } : null,
    excerpts,
    acceptedPersonMentions: persons,
    acceptedPlaceMentions: places,
    evidence,
    // This block is explicitly labelled interpretation so it cannot be confused
    // with the document or its reviewed transcription.
    researcherInterpretation: analysis ?? null,
  };
}

export interface PrimarySourcesChatContext {
  summary: {
    selectedSources: number;
    semanticRetrievalAvailable: boolean;
    policy: string;
  };
  sources: ReturnType<typeof sourceContext>[];
}

export async function buildPrimarySourcesChatContext(question: string): Promise<PrimarySourcesChatContext> {
  const ids: string[] = [];
  const layers = new Map<string, string[]>();
  const add = (itemId: string | null | undefined, layer?: string) => {
    if (!itemId) return;
    if (layer) layers.set(itemId, [...(layers.get(itemId) ?? []), layer]);
    if (!ids.includes(itemId) && externallySafe(sourceRow(itemId))) ids.push(itemId);
  };

  if (question.trim()) {
    const lexical = searchPrimarySourceCorpus({
      query: question,
      limit: 60,
      allowPrivateContent: false,
      allowRestrictedContent: false,
      allowUnknownRightsContent: false,
    });
    for (const result of lexical.results) add(result.itemId, result.layer);
  }

  let semanticAvailable = false;
  const scores = new Map<string, number>();
  try {
    const vector = question.trim() ? await embedQuery(question.trim()) : null;
    if (vector) {
      const similar = await findArchiveItemsSimilar(vector, { limit: MAX_SOURCES * 2, minSimilarity: 0.25 });
      semanticAvailable = similar.length > 0;
      for (const item of similar) {
        if (!externallySafe(sourceRow(item.itemId))) continue;
        scores.set(item.itemId, item.similarity);
        add(item.itemId, 'semantic');
      }
    }
  } catch {
    // A missing provider, changed embedding dimension or temporary endpoint failure
    // must not disable grounded lexical/recent retrieval.
    semanticAvailable = false;
  }

  if (ids.length < Math.min(6, MAX_SOURCES)) {
    const recent = getDb().prepare(
      `SELECT ai.item_id
         FROM archive_items ai
         JOIN archive_item_profiles p ON p.item_id=ai.item_id
        WHERE p.access_status='open' AND p.sensitivity<>'highly_sensitive'
        ORDER BY ai.updated_at DESC
        LIMIT ?`
    ).all(MAX_SOURCES) as Array<{ item_id: string }>;
    for (const row of recent) add(row.item_id, 'recent_fallback');
  }

  const selected = ids.slice(0, MAX_SOURCES)
    .map((id) => sourceRow(id))
    .filter((row): row is SourceRow => externallySafe(row));
  return {
    summary: {
      selectedSources: selected.length,
      semanticRetrievalAvailable: semanticAvailable,
      policy: 'Only open, non-highly-sensitive source content; notes and pending proposals excluded.',
    },
    sources: selected.map((row) => sourceContext(
      row,
      scores.get(row.item_id) ?? null,
      layers.get(row.item_id) ?? [],
    )),
  };
}

/** Remove invented or policy-ineligible primary-source links from a model answer. */
export function validatePrimarySourceAnswerCitations(answer: string): string {
  return answer.replace(
    /\[([^\]]+)\]\((nodus:\/\/primary-source\/[^)\s]+)\)/gu,
    (whole, label: string, link: string) => {
      let itemId = '';
      let excerptId: string | null = null;
      try {
        const match = link.match(/^nodus:\/\/primary-source\/([^/]+)(?:\/excerpt\/([^/]+))?$/u);
        if (!match) return label;
        itemId = decodeURIComponent(match[1]);
        excerptId = match[2] ? decodeURIComponent(match[2]) : null;
      } catch {
        return label;
      }
      const row = sourceRow(itemId);
      if (!externallySafe(row)) return label;
      if (excerptId) {
        const excerpt = getDb().prepare(
          'SELECT 1 FROM archive_excerpts WHERE excerpt_id=? AND item_id=?'
        ).get(excerptId, itemId);
        if (!excerpt) return label;
      }
      return whole;
    },
  );
}
