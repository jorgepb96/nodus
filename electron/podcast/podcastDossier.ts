// SPDX-License-Identifier: AGPL-3.0-only
/** Pure mapping from a research snapshot to the podcast dossier, kept apart from the engines so it can be tested alone. */
import type { WritingWorkshopSnapshot } from '@shared/types';
import type { PodcastEvidence, PodcastSource, PodcastTension } from '@shared/podcast';

const MAX_PASSAGES = 40;
const MAX_IDEAS = 12;
const MAX_WEB = 8;
const EXCERPT = 2_000;

export function clip(text: string | null | undefined, limit = EXCERPT): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

function authorLabel(authors: readonly string[] | undefined): string | undefined {
  if (!authors?.length) return undefined;
  const surname = (name: string) => name.split(',')[0]?.trim() || name.trim();
  return authors.length > 2 ? `${surname(authors[0])} et al.` : authors.map(surname).join(' & ');
}

/** Maps an academic snapshot (plus web passages) to the dossier; ids are `S1`… in rank order. */
export function dossierFromSnapshot(
  snapshot: Pick<WritingWorkshopSnapshot, 'passages' | 'ideas' | 'contradictions' | 'gaps'>,
  web: ReadonlyArray<{ id: string; title?: string; site?: string; url?: string; published?: string | null; text: string; citation?: string }>,
  log: string,
): PodcastEvidence {
  const sources: PodcastSource[] = [];
  const next = () => `S${sources.length + 1}`;
  for (const passage of snapshot.passages.slice(0, MAX_PASSAGES)) {
    const excerpt = clip(passage.summary);
    if (!excerpt) continue;
    sources.push({
      id: next(), kind: 'passage', title: passage.label, authors: authorLabel(passage.authors), year: passage.year,
      ...(passage.pageLabel ? { location: `p. ${passage.pageLabel}` } : {}), excerpt, link: passage.citation,
    });
  }
  for (const idea of snapshot.ideas.slice(0, MAX_IDEAS)) {
    const work = idea.works[0];
    const excerpt = clip(idea.statement || idea.summary);
    if (!excerpt) continue;
    sources.push({
      id: next(), kind: 'idea', title: idea.label, authors: authorLabel(work?.authors), year: work?.year ?? null, excerpt,
      link: `nodus://idea/${encodeURIComponent(idea.id)}`,
    });
  }
  for (const page of web.slice(0, MAX_WEB)) {
    const excerpt = clip(page.text);
    if (!excerpt) continue;
    sources.push({ id: next(), kind: 'web', title: page.title || page.site || page.url || 'web', authors: page.site, year: page.published?.slice(0, 4) ?? null, excerpt, url: page.url, link: page.citation });
  }
  // A disagreement becomes a source of its own (both statements), so a debate can cite it.
  const tensions: PodcastTension[] = [];
  for (const contradiction of snapshot.contradictions.slice(0, 8)) {
    const id = next();
    sources.push({
      id, kind: 'idea', title: contradiction.label, authors: contradiction.sources?.join('; '), excerpt: clip(contradiction.summary),
      link: `nodus://contradiction/${encodeURIComponent(contradiction.id)}`,
    });
    tensions.push({ id: contradiction.id, summary: clip(`${contradiction.fromLabel} / ${contradiction.toLabel}: ${contradiction.summary}`, 600), sourceIds: [id] });
  }
  const gaps = snapshot.gaps.slice(0, 8).map((gap) => clip(gap.summary, 400)).filter(Boolean);
  return { sources, tensions, gaps, log };
}

