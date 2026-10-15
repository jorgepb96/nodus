// Live citation labels.
//
// A saved report is prose plus a set of claims about the corpus. The prose is the
// author's and must never change; the claims must stay true. Nodus writes every
// inline citation as `[Apellido, I. (año)](nodus://idea/g-123)`, so the visible
// label is the perishable part and the anchor is the durable one. When the corpus
// corrects a work's byline — an editor who had been miscredited as its author —
// the anchor still points at the right source while the label keeps naming the
// wrong person.
//
// This module re-derives the label from the anchor at read time. It rewrites only
// the text inside the brackets, never the anchor, never the surrounding sentence,
// and only when the stored text is one this codebase generated (see
// looksLikeGeneratedLabel). A label it cannot resolve is left exactly as it was:
// a stale name is a smaller harm than an empty citation.
import { getDb } from '../db/database';
import {
  NODUS_LINK_RE,
  authorYearLabel,
  looksLikeGeneratedLabel,
  normalizeName,
  referenceEntry,
  splitPageSuffix,
  surnameOfLabel,
  yearOfLabel,
} from '@shared/citationLabel';
import type { PromptLanguage, WritingWorkshopDraft, WritingWorkshopSavedDraft } from '@shared/types';
// The report generator's own label table. Imported rather than re-declared: it
// falls back to English for languages with no table of their own, and a private
// copy that guessed a French "Auteur inconnu" would rewrite entries that were
// never wrong. deepResearchCore is a pure module — it imports nothing but types.
import { labels as reportLabels } from '../ai/deepResearchCore';

interface WorkFacts {
  authors: string[];
  year: number | null;
  title: string;
  doi: string | null;
}

function parseAuthors(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

function workFacts(nodusId: string): WorkFacts | null {
  const row = getDb()
    .prepare('SELECT title, authors_json, year, doi FROM works WHERE nodus_id = ?')
    .get(nodusId) as { title: string; authors_json: string | null; year: number | null; doi: string | null } | undefined;
  if (!row) return null;
  return { authors: parseAuthors(row.authors_json), year: row.year, title: row.title ?? '', doi: row.doi };
}

/**
 * The works a cited idea occurs in, ranked exactly as the report generator ranked
 * them (see ideaWorks in writingWorkshop). The ORDER BY is not cosmetic and must
 * not be "improved".
 */
function ideaWorks(globalId: string): WorkFacts[] {
  const rows = getDb()
    .prepare(
      `SELECT w.title, w.authors_json, w.year, w.doi
         FROM idea_occurrences io
         JOIN works w ON w.nodus_id = io.nodus_id
        WHERE io.global_id = ?
        ORDER BY io.role = 'principal' DESC, io.confidence DESC, w.year DESC
        LIMIT 5`
    )
    .all(globalId) as { title: string; authors_json: string | null; year: number | null; doi: string | null }[];
  return rows.map((row) => ({
    authors: parseAuthors(row.authors_json),
    year: row.year,
    title: row.title ?? '',
    doi: row.doi,
  }));
}

/**
 * Which of an idea's works a stored citation was named after.
 *
 * An idea anchor names the idea, not the source: `nodus://idea/g-5293` says nothing
 * about which of its five works the sentence was citing. The generator picked the
 * top-ranked one, but that ranking moves — a rescan changes a confidence, a new
 * occurrence appears — and g-5293's top two works are both `principal` at
 * confidence 1.0, separated only by year. Re-deriving from the top work alone
 * turned "Moreno Garrido, A. (2004)" into "Pack, S. (2009)": not a corrected name
 * but a different source, silently substituted under a sentence written about the
 * first one.
 *
 * So the stored label is treated as evidence of which work was meant. Its year
 * must match, because a byline repair never moves a year; among the works that
 * match, the one whose byline still contains the stored surname is preferred,
 * since a miscredited editor is reordered and marked by the repair but never
 * removed. No match means no confident answer, and the citation keeps the text it
 * has: a stale name is a smaller harm than a citation pointing somewhere else.
 */
function ideaWorkForLabel(globalId: string, storedLabel: string): WorkFacts | null {
  const works = ideaWorks(globalId);
  if (works.length === 0) return null;
  const year = yearOfLabel(storedLabel);
  if (year === null) return null;
  const sameYear = works.filter((work) => work.year === year);
  if (sameYear.length === 0) return null;
  if (sameYear.length === 1) return sameYear[0];
  const surname = surnameOfLabel(storedLabel);
  const named = sameYear.filter((work) =>
    work.authors.some((author) => surnameOfLabel(author) === surname || normalizeName(author).includes(surname))
  );
  // Still ranked, so ties fall back to the generator's own order.
  return named[0] ?? sameYear[0];
}

/** A gap belongs to exactly one work, so its label has no ambiguity to guard. */
function gapWork(gapId: string): WorkFacts | null {
  const row = getDb()
    .prepare(
      `SELECT w.title, w.authors_json, w.year, w.doi
         FROM gaps g JOIN works w ON w.nodus_id = g.nodus_id
        WHERE g.id = ?`
    )
    .get(gapId) as { title: string; authors_json: string | null; year: number | null; doi: string | null } | undefined;
  if (!row) return null;
  return { authors: parseAuthors(row.authors_json), year: row.year, title: row.title ?? '', doi: row.doi };
}

function passageWork(passageId: string): WorkFacts | null {
  const row = getDb()
    .prepare(
      `SELECT w.title, w.authors_json, w.year, w.doi
         FROM passages p JOIN works w ON w.nodus_id = p.nodus_id
        WHERE p.passage_id = ?`
    )
    .get(passageId) as { title: string; authors_json: string | null; year: number | null; doi: string | null } | undefined;
  if (!row) return null;
  return { authors: parseAuthors(row.authors_json), year: row.year, title: row.title ?? '', doi: row.doi };
}

/**
 * The label a citation would be given if the report were written today, or null
 * when the anchor names something this module does not label by author and year
 * (a gap or a contradiction), or a source the corpus no longer holds.
 */
export function resolveCitationLabel(kind: string, id: string, storedLabel = ''): string | null {
  let facts: WorkFacts | null = null;
  switch (kind) {
    case 'idea':
      // An idea can be cited from any of its works, so the stored label is needed
      // to tell which one this citation meant. See ideaWorkForLabel.
      facts = ideaWorkForLabel(id, storedLabel);
      break;
    case 'work':
      facts = workFacts(id);
      break;
    case 'passage':
      facts = passageWork(id);
      break;
    case 'gap':
      facts = gapWork(id);
      break;
    // A contradiction links two ideas and its label names one of their works,
    // with nothing recorded to say which. Re-deriving it would be the same guess
    // that turned one source into another for idea anchors, so it is left alone.
    default:
      return null;
  }
  if (!facts) return null;
  // With neither byline nor title the label is only the placeholder for an
  // anonymous work, written in the report's own language. There is nothing to
  // correct, and re-deriving it here would swap that language for the default.
  if (!facts.authors[0]?.trim() && !facts.title?.trim()) return null;
  const label = authorYearLabel(facts.authors[0], facts.year, facts.title);
  return label || null;
}

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export interface RelabelResult {
  markdown: string;
  /** Citations whose visible name changed, for verification and reporting. */
  changed: { kind: string; id: string; from: string; to: string }[];
  /** Anchors left alone: unresolvable, hand-written, or already correct. */
  kept: number;
}

/** Re-derive every generated citation label in a markdown body. */
export function relabelCitationsDetailed(markdown: string): RelabelResult {
  const changed: RelabelResult['changed'] = [];
  let kept = 0;
  const out = markdown.replace(NODUS_LINK_RE, (full, label: string, kind: string, rawId: string) => {
    const stored = String(label);
    if (!looksLikeGeneratedLabel(stored)) {
      kept += 1;
      return full;
    }
    const id = decode(rawId);
    const fresh = resolveCitationLabel(kind, id, stored);
    if (!fresh) {
      kept += 1;
      return full;
    }
    // A passage label carries a page locator after the author-year. That part came
    // from the passage, not the byline, so it survives the relabel untouched.
    const { suffix } = splitPageSuffix(stored);
    const next = `${fresh}${suffix}`;
    if (next === stored) {
      kept += 1;
      return full;
    }
    changed.push({ kind, id, from: stored, to: next });
    return `[${next}](nodus://${kind}/${rawId})`;
  });
  return { markdown: out, changed, kept };
}

/** Re-derive every generated citation label in a markdown body. */
export function relabelCitations(markdown: string): string {
  return relabelCitationsDetailed(markdown).markdown;
}

/**
 * Rebuild the reference list from the works the report actually cited.
 *
 * Reference lines carry no anchor, so they are matched to a work by title — the
 * one part of an entry the byline repair cannot move. A line no work matches
 * unambiguously is left alone, in both the array and the prose, so the two can
 * never end up disagreeing with each other.
 */
function relabelBibliography(
  bibliography: string[],
  workIds: string[],
  labels: { unknownAuthor: string; noDate: string }
): { entries: string[]; replacements: Map<string, string> } {
  const byTitle = new Map<string, WorkFacts[]>();
  for (const id of workIds) {
    const facts = workFacts(id);
    if (!facts?.title) continue;
    const key = facts.title.replace(/\s+/g, ' ').trim().toLowerCase();
    byTitle.set(key, [...(byTitle.get(key) ?? []), facts]);
  }

  const replacements = new Map<string, string>();
  const entries = bibliography.map((line) => {
    const haystack = line.replace(/\s+/g, ' ').toLowerCase();
    let match: WorkFacts | null = null;
    let ambiguous = false;
    for (const [title, works] of byTitle) {
      if (!title || !haystack.includes(title)) continue;
      if (works.length > 1) {
        ambiguous = true;
        break;
      }
      // Longest title wins: one work's title can be a prefix of another's.
      if (!match || title.length > (match.title?.length ?? 0)) match = works[0];
    }
    if (ambiguous || !match) return line;
    const next = referenceEntry(match, labels);
    if (next === line) return line;
    replacements.set(line, next);
    return next;
  });
  return { entries, replacements };
}

/**
 * Every perishable name in a stored report, refreshed against the corpus: the
 * inline citations, the matrix's source column, and the reference list. Returns a
 * new draft; the stored row is never written back, so the repair costs nothing if
 * the corpus later changes again.
 */
export function relabelDraft(draft: WritingWorkshopDraft): WritingWorkshopDraft {
  const labels = reportLabels((draft.brief?.language ?? 'es') as PromptLanguage);
  const { entries, replacements } = relabelBibliography(
    Array.isArray(draft.bibliography) ? draft.bibliography : [],
    Array.isArray(draft.selection?.workIds) ? draft.selection.workIds : [],
    labels
  );

  let markdown = relabelCitations(draft.draftMarkdown ?? '');
  // The reference list is printed inside the prose as well as held in the array.
  // Both are updated from the same replacement map so they stay identical.
  for (const [from, to] of replacements) markdown = markdown.split(from).join(to);

  const matrix = Array.isArray(draft.matrix)
    ? draft.matrix.map((row) => {
        const anchor = /^nodus:\/\/([a-z]+)\/(.+)$/.exec((row.citation ?? '').trim());
        if (!anchor || !looksLikeGeneratedLabel(row.sourceLabel ?? '')) return row;
        const fresh = resolveCitationLabel(anchor[1], decode(anchor[2]), row.sourceLabel ?? '');
        return fresh && fresh !== row.sourceLabel ? { ...row, sourceLabel: fresh } : row;
      })
    : draft.matrix;

  return { ...draft, draftMarkdown: markdown, bibliography: entries, matrix };
}

/** The same refresh, applied to a saved report as it leaves the database. */
export function relabelSavedDraft(saved: WritingWorkshopSavedDraft): WritingWorkshopSavedDraft {
  return { ...saved, draft: relabelDraft(saved.draft) };
}
