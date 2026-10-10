import type { StudyIdeaConnection, StudyIdeaDetail, StudyIdeaSummary, StudyKnowledgeGraph } from './studyKnowledge';
import type { StudyProjectionRow } from './studyOrgProjection';

type Tables = Record<string, StudyProjectionRow[]>;

/** Reads the already prepared knowledge in a snapshot, without processing documents. */
export function studyKnowledgeProjection(tables: Tables) {
  const rows = (name: string) => {
    if (!Array.isArray(tables[name])) throw new Error(`La copia publicada no incluye la tabla ${name}. Descarga una publicación compatible.`);
    return tables[name];
  };
  const ideas = rows('study_ideas'), occurrences = rows('study_idea_occurrences');
  const evidence = rows('study_idea_evidence'), edges = rows('study_idea_edges');
  const byId = new Map(ideas.map(row => [String(row.id), row]));
  const occurrencesByIdea = group(occurrences, 'idea_id');
  const evidenceByOccurrence = group(evidence, 'occurrence_id');
  const edgesByIdea = new Map<string, StudyProjectionRow[]>();
  for (const edge of edges) for (const id of new Set([String(edge.from_id),String(edge.to_id)])) {
    const bucket = edgesByIdea.get(id) ?? []; bucket.push(edge); edgesByIdea.set(id,bucket);
  }
  const summary = (row: StudyProjectionRow): StudyIdeaSummary => {
    const sources = occurrencesByIdea.get(String(row.id)) ?? [];
    return {
      id:String(row.id), subjectId:String(row.subject_id), type:String(row.type) as StudyIdeaSummary['type'],
      label:String(row.label), statement:String(row.statement),
      evidenceCount:new Set(sources.flatMap(source=>evidenceByOccurrence.get(String(source.id)) ?? []).map(item=>item.id)).size,
      sourceCount:new Set(sources.map(item=>`${item.source_kind}:${item.source_id}`)).size,
      connectionCount:(edgesByIdea.get(String(row.id)) ?? []).length,
      createdAt:String(row.created_at), updatedAt:String(row.updated_at),
    };
  };
  const connection = (row: StudyProjectionRow, ideaId?: string): StudyIdeaConnection => {
    const otherId = ideaId ? String(row.from_id === ideaId ? row.to_id : row.from_id) : undefined;
    return {id:String(row.id), subjectId:String(row.subject_id), fromId:String(row.from_id), toId:String(row.to_id),
      type:String(row.type) as StudyIdeaConnection['type'], basis:String(row.basis ?? ''), confidence:Number(row.confidence ?? 0),
      ...(otherId ? {otherId,otherLabel:String(byId.get(otherId)?.label ?? '')} : {})};
  };
  function list(subjectId: string, query = ''): StudyIdeaSummary[] {
    const needle = query.trim();
    const matches = sqliteLike(needle);
    return ideas.filter(row=>row.subject_id===subjectId && (!needle || matches(String(row.label)) || matches(String(row.statement))))
      .map(summary).sort((a,b)=>b.sourceCount-a.sourceCount||b.connectionCount-a.connectionCount||compareText(a.label,b.label));
  }
  function detail(id: string): StudyIdeaDetail | null {
    const row = byId.get(id); if (!row) return null;
    const sources = new Map((occurrencesByIdea.get(id) ?? []).map(item=>[item.id,item]));
    return {...summary(row),
      evidence:[...sources.values()].flatMap(source=>evidenceByOccurrence.get(String(source.id)) ?? []).slice()
        .sort((a,b)=>Number(sources.get(b.occurrence_id)?.confidence ?? 0)-Number(sources.get(a.occurrence_id)?.confidence ?? 0)||Number(a.position ?? 0)-Number(b.position ?? 0))
        .map(item=>{const source=sources.get(item.occurrence_id)!;return {id:String(item.id),quote:String(item.quote),location:String(item.location ?? ''),
          sourceKind:String(source.source_kind) as 'material'|'document',sourceId:String(source.source_id),sourceTitle:String(source.source_title)};}),
      connections:(edgesByIdea.get(id) ?? []).filter(item=>byId.has(String(item.from_id))&&byId.has(String(item.to_id)))
        .slice().sort((a,b)=>Number(b.confidence ?? 0)-Number(a.confidence ?? 0)).map(item=>connection(item,id)),
    };
  }
  function graph(subjectId: string): StudyKnowledgeGraph {
    return {subjectId,nodes:list(subjectId).map(idea=>({id:idea.id,label:idea.label,statement:idea.statement,type:idea.type,evidenceCount:idea.evidenceCount,connectionCount:idea.connectionCount})),
      edges:edges.filter(item=>item.subject_id===subjectId).slice().sort((a,b)=>Number(b.confidence ?? 0)-Number(a.confidence ?? 0))
        .map(item=>({id:String(item.id),source:String(item.from_id),target:String(item.to_id),type:String(item.type) as StudyIdeaConnection['type'],basis:String(item.basis ?? ''),confidence:Number(item.confidence ?? 0)}))};
  }
  return {list,detail,graph};
}
function compareText(a: string,b: string):number { return a<b?-1:a>b?1:0; }
function group(rows: StudyProjectionRow[], key: string) {
  const map = new Map<string, StudyProjectionRow[]>();
  for (const row of rows) { const id=String(row[key]); const bucket=map.get(id) ?? []; bucket.push(row); map.set(id,bucket); }
  return map;
}
// SQLite LIKE folds ASCII case and treats % / _ as wildcards. Preserve that
// behaviour when the same search is made against a downloaded publication.
function sqliteLike(query: string) {
  const fold = (value: string) => value.replace(/[A-Z]/g, letter=>letter.toLowerCase());
  const pattern = fold(query).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/%/g,'.*').replace(/_/g,'.');
  const expression = new RegExp(`^.*${pattern}.*$`,'su');
  return (value: string) => expression.test(fold(value));
}
