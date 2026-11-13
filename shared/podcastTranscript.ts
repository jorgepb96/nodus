// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The exported transcript of an episode: chapters, who says what and, at the end, the sources
 * by author, year and title. In-app links (`nodus://…`) are left out: they mean nothing
 * outside Nodus.
 */
import type { PodcastEpisode, PodcastLanguage } from './podcast';

const LABELS: Record<PodcastLanguage, { sources: string; chapter: string }> = {
  es: { sources: 'Fuentes', chapter: 'Capítulo' },
  en: { sources: 'Sources', chapter: 'Chapter' },
  fr: { sources: 'Sources', chapter: 'Chapitre' },
  de: { sources: 'Quellen', chapter: 'Kapitel' },
  pt: { sources: 'Fontes', chapter: 'Capítulo' },
};

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

export function podcastTranscriptMarkdown(episode: Pick<PodcastEpisode, 'title' | 'language' | 'plan' | 'script' | 'request' | 'sources' | 'timeline'>): string {
  const labels = LABELS[episode.language] ?? LABELS.en;
  const names = new Map(episode.request.hosts.map((host) => [host.speaker, host.name]));
  const starts = new Map(episode.timeline.turns.map((turn) => [turn.turnId, turn.startS]));
  const lines: string[] = [`# ${episode.title}`, ''];
  if (episode.plan.summary) lines.push(episode.plan.summary, '');
  let chapter = -1;
  const twoHosts = episode.request.hosts.length > 1;
  for (const turn of episode.script.turns) {
    if (turn.chapterIndex !== chapter) {
      chapter = turn.chapterIndex;
      const title = episode.plan.chapters[chapter]?.title ?? `${labels.chapter} ${chapter + 1}`;
      const start = episode.timeline.chapters.find((entry) => entry.index === chapter)?.startS;
      lines.push(`## ${title}${start != null ? ` (${clock(start)})` : ''}`, '');
    }
    const at = starts.get(turn.id);
    const who = twoHosts ? `**${names.get(turn.speaker) ?? turn.speaker}:** ` : '';
    lines.push(`${at != null && twoHosts ? `[${clock(at)}] ` : ''}${who}${turn.text}`, '');
  }
  const cited = new Set(episode.script.turns.flatMap((turn) => turn.sourceIds));
  const sources = episode.sources.filter((source) => cited.has(source.id));
  if (sources.length) {
    lines.push(`## ${labels.sources}`, '');
    for (const source of sources) {
      const who = [source.authors, source.year].filter(Boolean).join(', ');
      lines.push(`- ${who ? `${who}. ` : ''}${source.title}${source.location ? `, ${source.location}` : ''}${source.url ? ` — ${source.url}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
