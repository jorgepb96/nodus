import type {StudySearchIndexEntry,StudySearchOptions} from './studySearch';
import {normalizeStudySearchText,rankStudySearchEntries} from './studySearch';
import {studyAssistantSourceKey} from './studyAssistant';

export function assistantFragmentKey(entry: StudySearchIndexEntry): string {
  return JSON.stringify([entry.kind, entry.sourceId, entry.location, entry.contentHash]);
}

export function matchesAssistantRetrievalOptions(entry: StudySearchIndexEntry, options: StudySearchOptions): boolean {
  if (options.kinds?.length && !options.kinds.includes(entry.kind)) return false;
  if (options.courseId && entry.scope.courseId !== options.courseId) return false;
  if (options.subjectId && entry.scope.subjectId !== options.subjectId) return false;
  if (options.folderId && entry.scope.folderId !== options.folderId) return false;
  if (options.topicId && entry.scope.topicId !== options.topicId) return false;
  if (options.sourceId && entry.sourceId !== options.sourceId) return false;
  if (options.tags?.length && !options.tags.every((tag) => entry.tags.some((entryTag) => normalizeStudySearchText(entryTag) === normalizeStudySearchText(tag)))) return false;
  if (options.dateFrom && entry.updatedAt < options.dateFrom) return false;
  if (options.dateTo && entry.updatedAt > `${options.dateTo}T23:59:59.999Z`) return false;
  return true;
}

export function studyChatCandidates(entries:StudySearchIndexEntry[],options:StudySearchOptions,sourceKeys:string[]):StudySearchIndexEntry[] {
  const selected = new Set(sourceKeys);
  const seenFragments = new Set<string>();
  const candidates = entries.filter((entry) => !entry.excluded
    && (!selected.size || selected.has(studyAssistantSourceKey(entry.kind, entry.sourceId)))
    && matchesAssistantRetrievalOptions(entry, options)).filter((entry) => {
      const key = assistantFragmentKey(entry);
      if (seenFragments.has(key)) return false;
      seenFragments.add(key); return true;
    });
  return candidates;
}
export function orderStudyChatEntries(query:string,candidates:StudySearchIndexEntry[],options:StudySearchOptions,sourceKeys:string[],queryVector:number[]|null,limit:number):StudySearchIndexEntry[] {
  const ranked = rankStudySearchEntries(query, candidates, { ...options, limit: Math.max(limit * 3, 60) }, queryVector);
  const byId = new Map(candidates.map((entry) => [entry.indexId, entry]));
  const ordered = ranked.map((result) => byId.get(result.indexId)).filter((entry): entry is StudySearchIndexEntry => Boolean(entry));
  // Manual selection means "use these sources", even when the wording of the
  // question has no literal overlap. The same fallback is necessary for automatic
  // scopes when embeddings are unavailable: otherwise a Spanish question against
  // an English vault (or any other cross-language pair) always returns zero context.
  if ((sourceKeys.length || !queryVector) && ordered.length < limit) {
    const rankedIds = new Set(ordered.map((entry) => entry.indexId));
    const fallbackCandidates = candidates
      .filter((entry) => !rankedIds.has(entry.indexId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // Prefer breadth before adding a second fragment from the same source. This
    // gives the model useful coverage of a library rather than twenty adjacent
    // chunks from whichever document was edited most recently.
    const seenSources = new Set(ordered.map((entry) => studyAssistantSourceKey(entry.kind, entry.sourceId)));
    const diverse: StudySearchIndexEntry[] = [];
    const repeated: StudySearchIndexEntry[] = [];
    for (const entry of fallbackCandidates) {
      const sourceKey = studyAssistantSourceKey(entry.kind, entry.sourceId);
      if (seenSources.has(sourceKey)) repeated.push(entry);
      else { seenSources.add(sourceKey); diverse.push(entry); }
    }
    ordered.push(...diverse, ...repeated);
  }
  return ordered.slice(0, limit);
}
