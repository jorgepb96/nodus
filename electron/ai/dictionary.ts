import { balanceDictionarySources, dictionaryGenerators, generateDictionaryDefinition } from '@shared/dictionaryGenerationCore';
export { __dictionaryCoveragePromptForTesting, __dictionaryEvidencePromptForTesting, __structuredDictionaryCoverageProblemsForTesting, __renderStructuredDictionaryForTesting, __dictionaryCitationLabelForTesting, __groundingProblemsForTesting, __extractiveDictionaryFallbackForTesting, __insufficientDictionaryMarkdownForTesting, __dictionaryRetryCorrectionForTesting, __dictionaryEvidenceAliasesForTesting } from '@shared/dictionaryGenerationCore';
import { createHash } from "node:crypto";
import type {
  DictionaryDuplicateMatch,
  DictionaryEntryDetail,
  DictionaryEvidenceItem,
  DictionaryGenerationRequest,
  DictionaryScope,
  DictionaryResearchOptions,
  DictionaryVersion,
} from "@shared/dictionary";
import type {
  IdeaType,
  PromptLanguage,
} from "@shared/types";
import { completeJson, embed, embedMany, resolveModelRef } from "./aiClient";
import { aiVerifyCitations } from "./deepResearch";
import { findSimilarIdeasPaged } from "../db/ideasRepo";
import {
  getPassageDetail,
  findSimilarPassagesPaged,
  lexicalPassageSearch,
  type SimilarPassage,
} from "../db/passagesRepo";
import { expandCollectionKeys } from "../db/collectionsRepo";
import { getDb } from "../db/database";
import { getSettings } from "../db/settingsRepo";
import {
  dictionaryRuntimeCopy,
} from "@shared/academicPromptPacks";
import {
  currentDictionaryChangeSequence,
  detectDictionaryDuplicates,
  getDictionaryEntry,
  getDictionaryEntryDetail,
  includedEvidence,
  entriesNeedingDictionaryScan,
  listDictionaryEntries,
  markDictionaryEvidenceScanned,
  normalizeDictionaryTerm,
  saveDictionaryVersion,
  upsertDictionaryEvidence,
  type DictionaryEvidenceUpsert,
} from "../db/dictionaryRepo";

import { getDocumentaryPassageDetail } from '../citations/documentaryCitations';
import { getScopedLegacyPassageDetail } from '../citations/scopedLegacyCitations';
import { RETRIEVAL_PRESETS } from '@shared/researchCorpus';
import { ResearchCorpusRun } from './researchCorpusRun';
import { resolveAcademicResearchScope } from './researchNotebookService';
import { ResearchWebGrant, webDepth } from './researchWebStep';
import { withJobThinkingEffort, withResearchValidationThinking } from './thinkingEffort';
import { withResearchActivity } from './researchActivity';
import type { DictionaryProgress } from '@shared/dictionary';

function dictionaryPromptLanguage(requested?: PromptLanguage): PromptLanguage {
  if (requested) return requested;
  try {
    return getSettings().promptLanguage ?? 'es';
  } catch {
    // Headless migrations/tests can run without Electron's app paths. The
    // persisted setting remains the normal source; Spanish is the safe API
    // default when settings cannot be read at all.
    return 'es';
  }
}

type WorkRow = {
  nodus_id: string;
  title: string;
  authors_json: string;
  year: number | null;
  zotero_key: string | null;
};

function json<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === "string" ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(",");
}

const DICTIONARY_RETRIEVAL_LIMITS = { ideas: 36, passages: 48 } as const;
const DICTIONARY_SELECTION_LIMITS = { ideas: 12, passages: 8 } as const;

function balanceDictionaryCandidates(
  candidates: DictionaryEvidenceUpsert[],
): DictionaryEvidenceUpsert[] {
  return balanceDictionarySources(candidates);
}

export const __balanceDictionaryCandidatesForTesting =
  balanceDictionaryCandidates;

function resolveScopeWorkIds(scope: DictionaryScope): {
  ids: string[];
  restricted: boolean;
} {
  const db = getDb();
  if (scope.kind === "vault") {
    return {
      ids: (
        db
          .prepare("SELECT nodus_id FROM works WHERE archived=0")
          .all() as Array<{ nodus_id: string }>
      ).map((row) => row.nodus_id),
      restricted: false,
    };
  }
  if (scope.kind === "works")
    return { ids: [...new Set(scope.workIds)], restricted: true };
  if (scope.kind === "authors") {
    if (!scope.authorIds.length) return { ids: [], restricted: true };
    return {
      ids: (
        db
          .prepare(
            `SELECT DISTINCT nodus_id FROM work_attributions WHERE author_id IN (${placeholders(scope.authorIds)})`,
          )
          .all(...scope.authorIds) as Array<{ nodus_id: string }>
      ).map((row) => row.nodus_id),
      restricted: true,
    };
  }
  const expanded = expandCollectionKeys(scope.collectionKeys);
  const clauses: string[] = [];
  const params: string[] = [];
  if (scope.zoteroTags.length) {
    clauses.push(`EXISTS (SELECT 1 FROM work_zotero_tags wt JOIN zotero_tags zt ON zt.tag_id=wt.tag_id
      WHERE wt.nodus_id=w.nodus_id AND lower(zt.label) IN (${placeholders(scope.zoteroTags)}))`);
    params.push(...scope.zoteroTags.map((tag) => tag.toLocaleLowerCase()));
  }
  if (expanded.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM work_collections wc WHERE wc.nodus_id=w.nodus_id AND wc.collection_key IN (${placeholders(expanded)}))`,
    );
    params.push(...expanded);
  }
  if (!clauses.length) return { ids: [], restricted: true };
  const rows = db
    .prepare(
      `SELECT w.nodus_id FROM works w WHERE w.archived=0 AND (${clauses.join(" OR ")})`,
    )
    .all(...params) as Array<{ nodus_id: string }>;
  return { ids: rows.map((row) => row.nodus_id), restricted: true };
}

function workRows(ids: string[]): Map<string, WorkRow> {
  if (!ids.length) return new Map();
  const rows = getDb()
    .prepare(
      `SELECT nodus_id,title,authors_json,year,zotero_key FROM works WHERE nodus_id IN (${placeholders(ids)})`,
    )
    .all(...ids) as WorkRow[];
  return new Map(rows.map((row) => [row.nodus_id, row]));
}

function canonicalAuthors(
  workIds: string[],
): Map<string, DictionaryEvidenceItem["authors"]> {
  if (!workIds.length) return new Map();
  const rows = getDb()
    .prepare(
      `SELECT wa.nodus_id,a.author_id,a.name,wa.basis FROM work_attributions wa
    JOIN authors a ON a.author_id=wa.author_id WHERE wa.nodus_id IN (${placeholders(workIds)}) ORDER BY a.name`,
    )
    .all(...workIds) as Array<{
    nodus_id: string;
    author_id: string;
    name: string;
    basis: "author" | "editor_only";
  }>;
  const map = new Map<string, DictionaryEvidenceItem["authors"]>();
  for (const row of rows)
    map.set(row.nodus_id, [
      ...(map.get(row.nodus_id) ?? []),
      { id: row.author_id, name: row.name, attributionBasis: row.basis },
    ]);
  return map;
}

function lexicalIdeaIds(
  query: string,
  workIds: string[],
  limit: number,
): Array<{ global_id: string; similarity: number }> {
  if (!workIds.length) return [];
  const terms = normalizeDictionaryTerm(query)
    .split(" ")
    .filter((term) => term.length >= 3)
    .slice(0, 8);
  if (!terms.length) return [];
  const termSql = terms
    .map(
      () =>
        `(lower(i.label) LIKE ? OR lower(i.statement) LIKE ? OR lower(io.development) LIKE ? OR lower(ev.quote) LIKE ?)`,
    )
    .join(" OR ");
  const params = terms.flatMap((term) => Array(4).fill(`%${term}%`));
  return getDb()
    .prepare(
      `SELECT i.global_id, COUNT(DISTINCT io.nodus_id) + COUNT(DISTINCT ev.id) AS hits
    FROM ideas i JOIN idea_occurrences io ON io.global_id=i.global_id
    LEFT JOIN evidence ev ON ev.global_id=i.global_id AND ev.nodus_id=io.nodus_id
    WHERE io.nodus_id IN (${placeholders(workIds)}) AND (${termSql})
    GROUP BY i.global_id ORDER BY hits DESC LIMIT ?`,
    )
    .all(...workIds, ...params, limit)
    .map((row: any) => ({
      global_id: String(row.global_id),
      similarity: Math.min(0.8, 0.25 + Number(row.hits) * 0.05),
    }));
}

function ideaEvidence(
  ids: Array<{ global_id: string; similarity: number }>,
  workIds: string[],
  restricted: boolean,
): DictionaryEvidenceUpsert[] {
  if (!ids.length || !workIds.length) return [];
  const db = getDb();
  const workMap = workRows(workIds);
  const authorMap = canonicalAuthors(workIds);
  const selectedIdeaIds = new Set(ids.map((item) => item.global_id));
  const out: DictionaryEvidenceUpsert[] = [];
  for (const hit of ids) {
    // `ideas` has never had an `updated_at` column. Retrieval must use the real
    // persisted shape: asking SQLite for the nonexistent field made every semantic
    // hit fail after the expensive embedding search had already completed.
    const idea = db
      .prepare(
        "SELECT type,label,statement,created_at FROM ideas WHERE global_id=?",
      )
      .get(hit.global_id) as
      | {
          type: IdeaType;
          label: string;
          statement: string;
          created_at?: string;
        }
      | undefined;
    if (!idea) continue;
    const occurrences = db
      .prepare(
        `SELECT nodus_id,development,confidence FROM idea_occurrences
         WHERE global_id=? AND nodus_id IN (${placeholders(workIds)})
         ORDER BY confidence DESC LIMIT 20`,
      )
      .all(hit.global_id, ...workIds) as Array<{
      nodus_id: string;
      development: string;
      confidence: number;
    }>;
    if (!occurrences.length) continue;
    const scopedWorks = [...new Set(occurrences.map((row) => row.nodus_id))];
    const quoteRows = db
      .prepare(
        `SELECT quote,location,nodus_id FROM evidence
         WHERE global_id=? AND nodus_id IN (${placeholders(scopedWorks)})
         ORDER BY rowid LIMIT 40`,
      )
      .all(hit.global_id, ...scopedWorks) as Array<{
      quote: string;
      location: string | null;
      nodus_id: string;
    }>;
    const quoteBuckets = new Map<string, typeof quoteRows>();
    for (const quote of quoteRows)
      quoteBuckets.set(quote.nodus_id, [
        ...(quoteBuckets.get(quote.nodus_id) ?? []),
        quote,
      ]);
    const quotes: typeof quoteRows = [];
    while (quotes.length < 12) {
      let added = false;
      for (const bucket of quoteBuckets.values()) {
        const quote = bucket.shift();
        if (!quote) continue;
        quotes.push(quote);
        added = true;
        if (quotes.length >= 12) break;
      }
      if (!added) break;
    }
    const themeRows = db
      .prepare(
        `SELECT DISTINCT t.label FROM idea_theme_links l JOIN themes t ON t.theme_id=l.theme_id
      WHERE l.global_id=? AND l.nodus_id IN (${placeholders(scopedWorks)}) ORDER BY t.label`,
      )
      .all(hit.global_id, ...scopedWorks) as Array<{ label: string }>;
    const relationRows = (
      db
        .prepare(
          `SELECT e.from_id,e.to_id,e.type,e.basis,e.confidence,e.source_work,related.label AS related_label
      FROM edges e JOIN ideas related ON related.global_id=CASE WHEN e.from_id=? THEN e.to_id ELSE e.from_id END
      WHERE e.from_id=? OR e.to_id=? ORDER BY e.confidence DESC LIMIT 24`,
        )
        .all(hit.global_id, hit.global_id, hit.global_id) as Array<{
        from_id: string;
        to_id: string;
        type: string;
        basis: string;
        confidence: number;
        source_work: string | null;
        related_label: string;
      }>
    )
      .filter((row) =>
        selectedIdeaIds.has(
          row.from_id === hit.global_id ? row.to_id : row.from_id,
        ),
      )
      .filter(
        (row) => !row.source_work || scopedWorks.includes(row.source_work),
      );
    const sourceHeading = (workId: string): string => {
      const work = workMap.get(workId);
      const names = (authorMap.get(workId) ?? [])
        .filter((author) => author.attributionBasis !== "editor_only")
        .map((author) => author.name);
      return `Obra: ${work?.title ?? workId}${names.length ? ` | Autoría: ${names.join(", ")}` : ""}`;
    };
    const relationParts = relationRows.map((row) => {
      const currentIsSource = row.from_id === hit.global_id;
      const from = currentIsSource ? idea.label : row.related_label;
      const to = currentIsSource ? row.related_label : idea.label;
      const source = row.source_work
        ? `${sourceHeading(row.source_work)} | `
        : "";
      return `${source}Relación almacenada en el grafo: «${from}» ${row.type.replaceAll("_", " ")} «${to}» (${row.basis}, confianza ${row.confidence.toFixed(2)}).`;
    });
    const occurrenceParts = occurrences.map(
      (row) =>
        `${sourceHeading(row.nodus_id)}\nAportación documentada: ${row.development}`,
    );
    const quoteParts = quotes.map(
      (row) =>
        `${sourceHeading(row.nodus_id)}\nCita textual: “${row.quote}”${row.location ? ` (${row.location})` : ""}`,
    );
    const textParts = restricted
      ? [
          `Idea localizada: ${idea.label}`,
          ...occurrenceParts,
          ...quoteParts,
          ...relationParts,
        ]
      : [
          `Síntesis global de la idea: ${idea.statement}`,
          ...occurrenceParts,
          ...quoteParts,
          ...relationParts,
        ];
    const works = scopedWorks.map((id) => {
      const work = workMap.get(id);
      const authors = authorMap.get(id) ?? [];
      return {
        id,
        title: work?.title ?? id,
        zoteroKey: work?.zotero_key ?? null,
        authors: authors.map((author) => author.name),
        year: work?.year ?? null,
      };
    });
    const allAuthors = new Map<
      string,
      DictionaryEvidenceItem["authors"][number]
    >();
    for (const id of scopedWorks)
      for (const author of authorMap.get(id) ?? [])
        allAuthors.set(author.id ?? author.name, author);
    const primary = works[0];
    const text = textParts.filter((part) => part?.trim()).join("\n\n");
    out.push({
      kind: "idea",
      refId: hit.global_id,
      decision: "unused",
      score: hit.similarity,
      reason: relationParts.length
        ? "Idea recuperada por relevancia semántica con sus relaciones del grafo."
        : "Idea recuperada por relevancia semántica en el ámbito seleccionado.",
      label: idea.label,
      text,
      workId: primary?.id ?? "",
      workTitle: primary?.title ?? "",
      zoteroKey: primary?.zoteroKey ?? null,
      works,
      pageLabel: quotes[0]?.location ?? null,
      authors: [...allAuthors.values()],
      tags: themeRows.map((row) => row.label),
      sourceRevision: createHash("sha256").update(text).digest("hex"),
    });
  }
  return out;
}

function passageEvidence(hits: SimilarPassage[]): DictionaryEvidenceUpsert[] {
  const works = workRows(hits.map((hit) => hit.nodus_id));
  const authors = canonicalAuthors(hits.map((hit) => hit.nodus_id));
  return hits.map((hit) => {
    const work = works.get(hit.nodus_id);
    const workAuthors = authors.get(hit.nodus_id) ?? [];
    return {
      kind: "passage" as const,
      refId: hit.passage_id,
      decision: "unused" as const,
      score: hit.similarity,
      reason:
        "Pasaje recuperado por relevancia semántica en el ámbito seleccionado.",
      label: `${hit.title}${hit.page_label ? ` · ${hit.page_label}` : ""}`,
      text: hit.text,
      workId: hit.nodus_id,
      workTitle: hit.title,
      zoteroKey: hit.zotero_key || null,
      works: [
        {
          id: hit.nodus_id,
          title: hit.title,
          zoteroKey: hit.zotero_key || null,
          authors: workAuthors.map((author) => author.name),
          year: work?.year ?? hit.year,
        },
      ],
      pageLabel: hit.page_label,
      authors: workAuthors.length
        ? workAuthors
        : json<string[]>(hit.authors_json, []).map((name) => ({
            id: null,
            name,
          })),
      tags: [],
      sourceRevision: createHash("sha256").update(hit.text).digest("hex"),
    };
  });
}

/** Corpus-only preparation for a phone-owned provider. No embedding or generation
 * call runs on the Mac; lexical source receipts remain tied to this vault's scope. */
export function dictionaryMobileGenerationContext(entryId: string, webSearch: string = 'off') {
  const entry = getDictionaryEntry(entryId);
  if (!entry) throw new Error('dictionary_entry_unavailable');
  const scope = resolveScopeWorkIds(entry.scope);
  const allowed = new Set(scope.ids);
  const current = includedEvidence(entryId).filter(item => !item.unavailable && item.text.trim()
    && (item.id.startsWith('web:') ? webSearch !== 'off' : (!item.workId || allowed.has(item.workId)) && item.works.every(work => allowed.has(work.id))));
  let evidence = current;
  if (!evidence.length && scope.ids.length) {
    const query = [entry.name, ...entry.aliases].filter(Boolean).join('. ');
    const decisions = new Map((getDb().prepare('SELECT kind,ref_id,decision FROM dictionary_evidence WHERE entry_id=?').all(entryId) as Array<{kind:string;ref_id:string;decision:string}>).map(row => [`${row.kind}:${row.ref_id}`, row.decision]));
    const candidates = [
      ...ideaEvidence(lexicalIdeaIds(query, scope.ids, DICTIONARY_RETRIEVAL_LIMITS.ideas), scope.ids, scope.restricted),
      ...passageEvidence(lexicalPassageSearch(query, DICTIONARY_RETRIEVAL_LIMITS.passages, {nodusIds:scope.ids})),
    ].filter(item => !decisions.has(`${item.kind}:${item.refId}`) || decisions.get(`${item.kind}:${item.refId}`) === 'included');
    evidence = (['idea','passage'] as const).flatMap(kind => balanceDictionaryCandidates(candidates.filter(item => item.kind === kind)).slice(0, DICTIONARY_SELECTION_LIMITS[kind === 'idea' ? 'ideas' : 'passages'])).map(item => ({
      ...item, entryId, id:item.refId, decision:'included' as const, isNew:false, usedInCurrentVersion:false, citedInCurrentVersion:false, unavailable:false,
      reason:'Corpus recuperado mediante búsqueda léxica para el proveedor del móvil.',
    }));
  }
  evidence = evidence.filter((item, index, all) => all.findIndex(other => other.kind === item.kind && other.workId === item.workId && other.sourceRevision === item.sourceRevision) === index);
  const revision = createHash('sha256').update(JSON.stringify({entry, evidence:evidence.map(item => ({kind:item.kind,id:item.id,sourceRevision:item.sourceRevision,text:item.text}))})).digest('hex');
  return { entry, evidence, revision, retrieval: current.length ? 'included' as const : 'lexical' as const };
}

/** Store corpus search receipts using the same selection and exclusion policy as
 * Desktop. The phone's provider handles generation; this lookup starts no AI,
 * extraction or indexing on the Mac. */
export function scanMobileDictionaryEvidence(entryId: string) {
  const entry = getDictionaryEntry(entryId);
  if (!entry) throw new Error('dictionary_entry_unavailable');
  const scope = resolveScopeWorkIds(entry.scope);
  const query = [entry.name, ...entry.aliases].filter(Boolean).join('. ');
  const candidates = scope.ids.length ? [
    ...ideaEvidence(lexicalIdeaIds(query, scope.ids, DICTIONARY_RETRIEVAL_LIMITS.ideas), scope.ids, scope.restricted),
    ...passageEvidence(lexicalPassageSearch(query, DICTIONARY_RETRIEVAL_LIMITS.passages, {nodusIds:scope.ids})),
  ] : [];
  return getDb().transaction(() => storeDictionaryCandidates(entryId, 'scan', candidates))();
}

export function saveMobileDictionaryDefinition(input: { definition: import('@shared/dictionaryGenerationCore').DictionaryDefinition; contextRevision: string; webSearch?: string }) {
  const definition = input?.definition;
  const text = (value: unknown, limit: number) => typeof value === 'string' && value.length <= limit;
  const reference = (value: unknown) => !!value && typeof value === 'object'
    && ['idea','passage'].includes((value as {kind:string}).kind)
    && text((value as {id:string}).id, 1024) && (value as {id:string}).id.length > 0;
  if (!definition || !text(definition.entryId, 128) || !definition.entryId.length || !text(definition.contentMarkdown, 1_000_000) || !definition.contentMarkdown.trim()
    || !text(input.contextRevision, 64) || !/^[a-f0-9]{64}$/.test(input.contextRevision)
    || (input.webSearch !== undefined && !['off','auto','on'].includes(input.webSearch))
    || !Array.isArray(definition.evidence) || definition.evidence.length > 80 || !Array.isArray(definition.citations) || definition.citations.length > 1000
    || !Array.isArray(definition.authorSummaries) || definition.authorSummaries.length > 100 || !Array.isArray(definition.generationProblems)
    || definition.generationProblems.length > 100 || definition.generationProblems.some(problem => !text(problem, 10_000))
    || !definition.evidence.every(reference) || !definition.citations.every(ref => reference(ref) && text(ref.label, 10_000)
      && Array.isArray(ref.tags) && ref.tags.length <= 100 && ref.tags.every(tag => text(tag, 1024)))
    || definition.authorSummaries.some(author => !author || !text(author.id, 1024) || !text(author.name, 10_000)
      || !text(author.summaryMarkdown, 100_000) || !Number.isInteger(author.ideaCount) || author.ideaCount < 0
      || !Number.isInteger(author.workCount) || author.workCount < 0 || (author.attributionBasis !== undefined && !['author','editor_only'].includes(author.attributionBasis)))
    || (definition.model !== null && (!definition.model || !text(definition.model.provider, 128) || !text(definition.model.model, 1024) || !definition.model.model.length))
    || typeof definition.insufficientEvidence !== 'boolean'
    || !['applied','proposed','degraded'].includes(definition.state) || !['synthesis','insufficient','degraded'].includes(definition.outcome)
    || !['creation','update','regeneration'].includes(definition.trigger) || !Number.isInteger(definition.generationAttempts) || definition.generationAttempts < 1 || definition.generationAttempts > 3
    || (definition.outcome === 'degraded') !== (definition.state === 'degraded')
    || (definition.outcome === 'insufficient') !== definition.insufficientEvidence
    || (definition.outcome === 'degraded' ? !['output_truncated','malformed_output','schema_error','invalid_evidence_refs','missing_citations','semantic_rejection','grounding_failure','legacy_extractive_fallback'].includes(definition.degradationReason ?? '') : definition.degradationReason !== null)
    || (definition.outcome === 'synthesis' && (!definition.evidence.length || !definition.citations.length))) throw new Error('invalid_dictionary_definition');
  return getDb().transaction(() => {
    const context = dictionaryMobileGenerationContext(definition.entryId, input.webSearch);
    if (context.revision !== input.contextRevision) throw new Error('dictionary_generation_conflict');
    const source = new Map(context.evidence.map(item => [`${item.kind}:${item.id}`, item]));
    const references = new Set(definition.evidence.map(ref => `${ref.kind}:${ref.id}`));
    if (references.size !== definition.evidence.length || [...references].some(key => !source.has(key)) || definition.citations.some(ref => !references.has(`${ref.kind}:${ref.id}`))) throw new Error('invalid_dictionary_evidence');
    for (const ref of definition.evidence) {
      const item = source.get(`${ref.kind}:${ref.id}`)!;
      upsertDictionaryEvidence(definition.entryId, [{...item,refId:item.id}]);
    }
    return saveDictionaryVersion(definition);
  })();
}

export async function retrieveDictionaryEvidence(
  entryId: string,
  mode: "initial" | "scan" = "initial",
): Promise<DictionaryEntryDetail> {
  const entry = getDictionaryEntry(entryId);
  if (!entry) throw new Error("La entrada de Dictionary ya no existe.");
  const scope = resolveScopeWorkIds(entry.scope);
  if (scope.restricted && !scope.ids.length) {
    markDictionaryEvidenceScanned(entryId, currentDictionaryChangeSequence());
    return getDictionaryEntryDetail(entryId)!;
  }
  // The focus is an editorial instruction, not part of the concept's vocabulary.
  // Mixing a long preset such as "compare authors" into the embedding diluted rare
  // terms and favored generic passages. Retrieval therefore searches only the name
  // and aliases; the focus is applied later by the writer.
  const query = [entry.name, ...entry.aliases].filter(Boolean).join(". ");
  let ideaHits: Array<{ global_id: string; similarity: number }> = [];
  let passageHits: SimilarPassage[] = [];
  try {
    const vector = await embed(query);
    if (!vector) throw new Error("No hay un modelo de embeddings disponible.");
    [ideaHits, passageHits] = await Promise.all([
      findSimilarIdeasPaged(vector, -1, DICTIONARY_RETRIEVAL_LIMITS.ideas, {
        nodusIds: scope.ids,
      }),
      findSimilarPassagesPaged(
        vector,
        -1,
        DICTIONARY_RETRIEVAL_LIMITS.passages,
        { nodusIds: scope.ids },
      ),
    ]);
  } catch {
    ideaHits = lexicalIdeaIds(
      query,
      scope.ids,
      DICTIONARY_RETRIEVAL_LIMITS.ideas,
    );
    passageHits = lexicalPassageSearch(
      query,
      DICTIONARY_RETRIEVAL_LIMITS.passages,
      { nodusIds: scope.ids },
    );
  }
  return storeDictionaryCandidates(entryId, mode, [
    ...ideaEvidence(ideaHits, scope.ids, scope.restricted),
    ...passageEvidence(passageHits),
  ]);
}

function storeDictionaryCandidates(
  entryId: string,
  mode: "initial" | "scan",
  retrieved: DictionaryEvidenceUpsert[],
): DictionaryEntryDetail {
  const rows = getDb().prepare(
    "SELECT kind,ref_id,decision,work_id,source_revision FROM dictionary_evidence WHERE entry_id=?",
  ).all(entryId) as Array<{kind: string; ref_id: string; decision: DictionaryEvidenceUpsert["decision"]; work_id: string; source_revision: string | null}>;
  const existing = new Map(rows.map(row => [`${row.kind}:${row.ref_id}`, row.decision]));
  // A scoped receipt can change its id without changing the source text. Never
  // reintroduce an excluded passage through another scope or a legacy id.
  const revisions = new Map<string, DictionaryEvidenceUpsert['decision']>();
  for (const row of rows) {
    if (!row.source_revision) continue;
    const key = `${row.kind}:${row.work_id}:${row.source_revision}`;
    const previous = revisions.get(key);
    if (!previous || row.decision === 'excluded' || (previous === 'included' && row.decision === 'unused')) revisions.set(key, row.decision);
  }
  // Ideas and passages have separate selection allowances. A concept extracted
  // from a work must not displace that work's original text in the passage quota.
  const candidates = (['idea', 'passage'] as const).flatMap(kind =>
    balanceDictionaryCandidates(retrieved.filter(candidate => candidate.kind === kind))).filter((candidate, index, all) =>
    all.findIndex(other => other.kind === candidate.kind && other.workId === candidate.workId
      && other.sourceRevision === candidate.sourceRevision) === index);

  const allowed = new Set(resolveScopeWorkIds(getDictionaryEntry(entryId)!.scope).ids);
  const usable = includedEvidence(entryId).filter(item => !item.unavailable
    && (!item.workId || allowed.has(item.workId)) && item.works.every(work => allowed.has(work.id)));
  let selectedIdeas = usable.filter(item => item.kind === 'idea').length;
  let selectedPassages = usable.filter(item => item.kind === 'passage').length;
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.refId}`;
    const oldDecision = existing.get(key) ?? revisions.get(`${candidate.kind}:${candidate.workId}:${candidate.sourceRevision}`);
    candidate.isNew = mode === "scan" && !oldDecision;
    if (oldDecision)
      candidate.decision = oldDecision as DictionaryEvidenceUpsert["decision"];
    else if (
      mode === "initial" &&
      ((candidate.kind === "idea" &&
        selectedIdeas < DICTIONARY_SELECTION_LIMITS.ideas) ||
        (candidate.kind === "passage" &&
          selectedPassages < DICTIONARY_SELECTION_LIMITS.passages))
    ) {
      candidate.decision = "included";
      if (candidate.kind === "idea") selectedIdeas += 1;
      else selectedPassages += 1;
    }
  }
  upsertDictionaryEvidence(entryId, candidates);
  markDictionaryEvidenceScanned(entryId, currentDictionaryChangeSequence());
  return getDictionaryEntryDetail(entryId)!;
}

/** User-triggered evidence searches use the same investigation as generation.
 * Newly found scan results remain unused until the user includes them. */
export async function retrieveDictionaryResearchEvidence(entryId: string, mode: 'initial' | 'scan', options: DictionaryResearchOptions = {}) {
  const model = resolveModelRef(options.model ?? getSettings().dictionaryModel);
  await withJobThinkingEffort(options.thinkingEffort, model, () =>
    investigateDictionaryEvidence({ ...options, model, entryId, mode: 'creation' }, mode));
  return getDictionaryEntryDetail(entryId)!;
}

/** Explicit generation shares Research chat's scope inventory, supervisor and
 * original-document readers. Background scans remain bounded local lookups. */
export async function investigateDictionaryEvidence(request: DictionaryGenerationRequest, mode: 'initial' | 'scan' = 'initial') {
  const entry = getDictionaryEntry(request.entryId);
  if (!entry) throw new Error("La entrada de Dictionary ya no existe.");
  const allowed = resolveScopeWorkIds(entry.scope);
  const scope = resolveAcademicResearchScope({ enabled: true, workIds: allowed.ids, authorIds: [] });
  const query = [entry.name, ...entry.aliases].filter(Boolean).join('. ');
  const retrieval = RETRIEVAL_PRESETS.balanced;
  const run = new ResearchCorpusRun(scope, retrieval, undefined, true);
  // A user may explicitly request web research in the editorial focus without
  // diluting the concept's semantic retrieval query with that instruction.
  run.web = new ResearchWebGrant(request.webSearch ?? 'auto', webDepth(retrieval),
    `${query}. ${entry.focusPrompt}`, undefined, request.model, 12000);
  await withResearchValidationThinking(request.model, async () => {
    await run.investigate(query, request.model);
    await run.web!.afterLibrary({ evidence: run.evidence.size, matched: run.matchedDocuments.size,
      supervised: run.supervised, titles: scope.documents.filter(d => run.matchedDocuments.has(d.id)).map(d => d.title) });
  });
  const snapshot = run.snapshotFromEvidence({ kind: 'research_question', objective: query, language: entry.outputLanguage });
  const passages: SimilarPassage[] = snapshot.passages.flatMap(p => {
    // Retrieval may add page markers for the prompt. Store the canonical receipt
    // text so its revision and the citation modal refer to precisely the same text.
    const detail = p.id.startsWith('documentary:') ? getDocumentaryPassageDetail(p.id)
      : p.id.startsWith('scoped:') ? getScopedLegacyPassageDetail(p.id) : getPassageDetail(p.id);
    if (!detail) return [];
    return [{ passage_id: p.id, nodus_id: p.nodus_id, title: detail.work.title,
      text: detail.text, similarity: p.score, authors_json: JSON.stringify(detail.work.authors), year: detail.work.year,
      zotero_key: detail.work.zotero_key, page_label: detail.page_label } as SimilarPassage];
  });
  const candidates = [
    ...ideaEvidence(snapshot.ideas.map(idea => ({ global_id: idea.id, similarity: idea.score })), allowed.ids, true),
    ...passageEvidence(passages),
    ...run.web.contextPassages().map(p => ({
      kind: 'passage' as const, refId: p.id, decision: 'unused' as const, score: 1,
      reason: `Web: ${p.url}`, label: p.title, text: p.text, workId: '', workTitle: p.title,
      zoteroKey: null, works: [], pageLabel: p.page ? String(p.page) : null, authors: [], tags: [],
      sourceRevision: createHash('sha256').update(p.text).digest('hex'),
    })),
  ];
  run.validate();
  const current = getDictionaryEntry(entry.id);
  if (!current || JSON.stringify(current.scope) !== JSON.stringify(entry.scope)) throw new Error('dictionary_scope_changed');
  storeDictionaryCandidates(entry.id, mode, candidates);
  const traversal = run.coverage();
  const web = run.web.stats();
  console.info('[dictionary:research]', JSON.stringify({ entryId: entry.id, traversal, web }));
  return { traversal, web };
}

async function synthesize(...args: Parameters<ReturnType<typeof dictionaryGenerators>['generator']>) {
  const entry = getDictionaryEntry(args[0]);
  if (!entry) throw new Error(dictionaryRuntimeCopy(dictionaryPromptLanguage(args[5])).noEntryError);
  return dictionaryGenerators(entry, completeJson).generator(...args);
}
async function synthesizeAuthorSummaries(...args: Parameters<ReturnType<typeof dictionaryGenerators>['authorGenerator']>) {
  const entry = getDictionaryEntry(args[0]);
  if (!entry) throw new Error(dictionaryRuntimeCopy(dictionaryPromptLanguage(args[4])).noEntryError);
  return dictionaryGenerators(entry, completeJson).authorGenerator(...args);
}

export async function generateDictionaryEntry(
  request: DictionaryGenerationRequest,
  report?: (progress: DictionaryProgress) => void,
): Promise<DictionaryVersion> {
  const model = resolveModelRef(request.model ?? getSettings().dictionaryModel);
  const resolved = { ...request, model };
  return withJobThinkingEffort(request.thinkingEffort, model, () => withResearchActivity(
    event => report?.({ entryId: request.entryId, phase: 'retrieving', message: 'Analizando corpus', activity: event }),
    undefined,
    async () => {
      report?.({ entryId: request.entryId, phase: 'retrieving', message: 'Analizando corpus' });
      await investigateDictionaryEvidence(resolved);
      report?.({ entryId: request.entryId, phase: 'generating', message: 'Generando definición' });
      return generateDictionaryEntryUsing(resolved, synthesize,
        (claims, ref) => withResearchValidationThinking(ref, () => aiVerifyCitations(claims, ref)),
        synthesizeAuthorSummaries);
    },
  ));
}

export async function __generateDictionaryEntryForTesting(
  request: DictionaryGenerationRequest,
  generator: typeof synthesize,
  verifyCitations: typeof aiVerifyCitations = aiVerifyCitations,
  authorGenerator: typeof synthesizeAuthorSummaries = async () => ({
    authorSummaries: [],
  }),
): Promise<DictionaryVersion> {
  return generateDictionaryEntryUsing(
    request,
    generator,
    verifyCitations,
    authorGenerator,
  );
}

async function generateDictionaryEntryUsing(
  request: DictionaryGenerationRequest,
  generator: typeof synthesize,
  verifyCitations: typeof aiVerifyCitations,
  authorGenerator: typeof synthesizeAuthorSummaries,
): Promise<DictionaryVersion> {
  const entry = getDictionaryEntry(request.entryId);
  const promptLanguage = dictionaryPromptLanguage(request.language);
  const copy = dictionaryRuntimeCopy(promptLanguage);
  if (!entry) throw new Error(copy.noEntryError);
  const scopeIds = new Set(resolveScopeWorkIds(entry.scope).ids);
  const evidence = includedEvidence(request.entryId).filter((item, index, all) => {
    if (item.unavailable || !item.text.trim()) return false;
    if (item.id.startsWith('web:')) return request.webSearch !== 'off';
    if (item.works.some(work => !scopeIds.has(work.id)) || (item.workId && !scopeIds.has(item.workId))) return false;
    return all.findIndex(other => !other.unavailable && other.kind === item.kind && other.workId === item.workId
      && other.sourceRevision === item.sourceRevision) === index;
  });
  if (!evidence.length) {
    throw new Error(copy.noEvidenceError);
  }
  return saveDictionaryVersion(await generateDictionaryDefinition(entry, evidence, { ...request, language: promptLanguage }, { generator, verifyCitations, authorGenerator }));
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export async function detectDictionaryDuplicatesSemantic(
  name: string,
  aliases: string[],
): Promise<DictionaryDuplicateMatch[]> {
  const exact = detectDictionaryDuplicates(name, aliases);
  const exactIds = new Set(exact.map((item) => item.entry.id));
  const entries = listDictionaryEntries({
    offset: 0,
    limit: 500,
    sort: { key: "name", dir: "asc" },
  }).items.filter((entry) => !exactIds.has(entry.id));
  if (!name.trim() || !entries.length) return exact;
  try {
    const vectors = await embedMany([
      [name, ...aliases].join(". "),
      ...entries.map((entry) => [entry.name, ...entry.aliases].join(". ")),
    ]);
    const query = vectors[0];
    if (!query) return exact;
    return [
      ...exact,
      ...entries
        .map((entry, index) => ({
          entry,
          match: "semantic" as const,
          similarity: vectors[index + 1]
            ? cosine(query, vectors[index + 1]!)
            : 0,
        }))
        .filter((item) => item.similarity >= 0.78)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 8),
    ];
  } catch {
    return exact;
  }
}

export function dictionaryEntryNeedsScan(entryId: string): boolean {
  const entry = getDictionaryEntry(entryId);
  return (
    !!entry &&
    entry.lastEvidenceScanAt !== null &&
    entry.newEvidenceCount === 0 &&
    (
      getDb()
        .prepare(
          "SELECT COALESCE(MAX(seq),0) AS seq FROM dictionary_corpus_changes",
        )
        .get() as { seq: number }
    ).seq >
      (
        getDb()
          .prepare("SELECT last_change_seq FROM dictionary_entries WHERE id=?")
          .get(entryId) as { last_change_seq: number }
      ).last_change_seq
  );
}

export async function scanChangedDictionaryEntries(
  limit = 4,
): Promise<string[]> {
  const ids = entriesNeedingDictionaryScan(limit);
  for (const id of ids) await retrieveDictionaryEvidence(id, "scan");
  return ids;
}
