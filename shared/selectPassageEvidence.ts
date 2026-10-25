import type {HierarchicalPassageHit} from '../electron/ai/hierarchicalRetrieval';
export function selectPassageEvidence(
  hits: HierarchicalPassageHit[],
  limit: number,
  options: { preferLexical?: boolean; preferSourceDiversity?: boolean } = {},
): HierarchicalPassageHit[] {
  if (limit <= 0) return [];
  type Lane = HierarchicalPassageHit['lanes'][number];
  const lanes: Lane[] = ['global', 'support', 'lexical', 'document'];
  const queues = new Map(lanes.map((lane) => [lane, hits.filter((hit) => hit.lanes.includes(lane))]));
  const positions = new Map(lanes.map((lane) => [lane, 0]));
  // Literal matches receive two turns because one coverage question commonly
  // contains several independent operations (e.g. catalogue + distribute), while
  // global semantic evidence keeps the first and final slots of a six-item menu.
  const schedule: Lane[] = options.preferLexical
    ? ['lexical', 'global', 'support', 'lexical', 'document', 'global']
    : ['global', 'lexical', 'support', 'lexical', 'document', 'global'];
  const selected: HierarchicalPassageHit[] = [];
  const seen = new Set<string>();
  const selectedWorks = new Set<string>();
  while (selected.length < limit) {
    let progressed = false;
    for (const lane of schedule) {
      if (selected.length >= limit) break;
      const queue = queues.get(lane) ?? [];
      let position = positions.get(lane) ?? 0;
      if (options.preferSourceDiversity && selectedWorks.size < Math.min(3, limit)) {
        const diverseAt = queue.findIndex((hit, index) =>
          index >= position && !seen.has(hit.passage_id) && !selectedWorks.has(hit.nodus_id));
        if (diverseAt >= position) {
          const [diverse] = queue.splice(diverseAt, 1);
          queue.splice(position, 0, diverse);
        }
      }
      while (position < queue.length) {
        const hit = queue[position++];
        positions.set(lane, position);
        if (seen.has(hit.passage_id)) continue;
        seen.add(hit.passage_id);
        selectedWorks.add(hit.nodus_id);
        selected.push(hit);
        progressed = true;
        break;
      }
    }
    if (!progressed) break;
  }
  if (selected.length < limit) {
    for (const hit of hits) {
      if (seen.has(hit.passage_id)) continue;
      seen.add(hit.passage_id);
      selectedWorks.add(hit.nodus_id);
      selected.push(hit);
      if (selected.length >= limit) break;
    }
  }
  return selected;
}
