// @ts-expect-error The provider-free projection also runs in Server and Cloud.
import { workspaceAuthorDossier } from '../server/lib/core/academicWorkspace.mjs';
import { parseJson } from './dictionaryRows';
import type { AuthorDossier, Edge, EdgeDetail, Evidence, GapDetail, Idea, IdeaByWorkPage, IdeaDetail, WorkMeta, WorkView, WorkSummary, WorkIdeaSynthesis } from './types';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Source dossiers are assembled from the downloaded corpus, without retrieval,
 * indexing or AI. Missing required tables are compatibility errors, not empty
 * dossiers. Passage bodies remain in the separate, citation-scoped projection. */
export function snapshotSourceDetails(tables: Tables) {
  const required = (name: string): Row[] => {
    if (!Array.isArray(tables[name])) throw new Error(`La copia publicada no incluye la tabla ${name}. Descarga una publicación compatible.`);
    return tables[name];
  };
  const indexed = new Map<string, Map<unknown, Row>>();
  const row = (name: string, field: string, id: string): Row | undefined => {
    if (!indexed.has(name)) indexed.set(name, new Map(required(name).map(value => [value[field], value])));
    return indexed.get(name)!.get(id);
  };
  function idea(id: string): Idea | null {
    const value = row('ideas', 'global_id', id);
    return value ? { global_id: id, type: value.type ?? 'claim', label: value.label ?? id,
      statement: value.statement ?? '', created_at: value.created_at, embedding: null } as Idea : null;
  }
  function work(id: string): WorkView | null {
    const value = row('works', 'nodus_id', id);
    if (!value) return null;
    const labels = (links: string, source: string, key: string, noCase = false) => {
      const names = new Map(required(source).map(item => [item[key], item.label]));
      return required(links).filter(link => link.nodus_id === id && names.has(link[key]))
        .map(link => String(names.get(link[key]))).sort((a, b) => noCase
          ? compare(a.replace(/[A-Z]/g, letter => letter.toLowerCase()), b.replace(/[A-Z]/g, letter => letter.toLowerCase())) : compare(a, b));
    };
    const { authors_json, ...rest } = value;
    return { ...rest, authors: parseJson(authors_json, []), themes: labels('work_themes', 'themes', 'theme_id'),
      zoteroTags: labels('work_zotero_tags', 'zotero_tags', 'tag_id', true),
      ideaCount: required('idea_occurrences').filter(link => link.nodus_id === id).length } as unknown as WorkView;
  }
  function ideaDetail(id: string): IdeaDetail | null {
    const value = idea(id);
    if (!value) return null;
    const occurrences = required('idea_occurrences').filter(link => link.global_id === id).flatMap(link => {
      const source = work(String(link.nodus_id));
      return source ? [{ ...link, work: source }] : [];
    });
    const themeNames = new Map(required('themes').map(value => [value.theme_id, value.label]));
    const themes = [...new Set(required('idea_theme_links').filter(link => link.global_id === id && themeNames.has(link.theme_id))
      .map(link => String(themeNames.get(link.theme_id))))].sort(compare);
    return { idea: value, occurrences: occurrences as unknown as IdeaDetail['occurrences'],
      evidence: required('evidence').filter(value => value.global_id === id) as unknown as Evidence[], themes };
  }
  function edgeDetail(id: string): EdgeDetail | null {
    const edge = row('edges', 'id', id);
    if (!edge) return null;
    const from = idea(String(edge.from_id)), to = idea(String(edge.to_id));
    const short = (value: string) => { const text = value.replace(/\s+/g, ' ').trim(); return text.length <= 180 ? text : `${text.slice(0, 179).trim()}...`; };
    const explanation = ['contradicts', 'refutes'].includes(String(edge.type))
      ? `La ${edge.type === 'refutes' ? 'refutación' : 'contradicción'} detectada es que "${short(from?.statement || from?.label || String(edge.from_id))}" entra en tensión con "${short(to?.statement || to?.label || String(edge.to_id))}".` : null;
    const feedback = required('edge_feedback').find(value => value.type === edge.type &&
      (value.from_id === edge.from_id && value.to_id === edge.to_id || value.from_id === edge.to_id && value.to_id === edge.from_id)) ?? null;
    // Current publications omit local generation traces, as the published
    // Debate projection does. A future compatible publication may carry them.
    const traceRow = tables.edge_traces?.find(value => value.edge_id === id);
    const trace = traceRow ? { edgeId: id, method: traceRow.method, model: parseJson(traceRow.model_json, null),
      embeddingProvider: traceRow.embedding_provider, embeddingModel: traceRow.embedding_model,
      similarity: traceRow.similarity, rationale: traceRow.rationale, createdAt: traceRow.created_at } : null;
    return { edge: edge as unknown as Edge, fromLabel: from?.label ?? String(edge.from_id), toLabel: to?.label ?? String(edge.to_id),
      explanation, evidence: edge.source_work ? required('evidence').filter(value => value.nodus_id === edge.source_work && [edge.from_id, edge.to_id].includes(value.global_id)) as unknown as Evidence[] : [],
      trace, feedback } as EdgeDetail;
  }
  function ideaEdges(id: string): EdgeDetail[] {
    const rejected = new Set(required('edge_feedback').filter(value => value.verdict === 'rejected').flatMap(value =>
      [`${value.type}\0${value.from_id}\0${value.to_id}`, `${value.type}\0${value.to_id}\0${value.from_id}`]));
    // Source dossiers include containment edges too; the graph-only projection
    // deliberately excludes them, but Desktop's getIdeaEdges does not.
    return required('edges').filter(value => !rejected.has(`${value.type}\0${value.from_id}\0${value.to_id}`) && (value.from_id === id || value.to_id === id))
      .sort((a, b) => Number(b.confidence) - Number(a.confidence) || compare(String(a.id), String(b.id)))
      .flatMap(value => { const detail = edgeDetail(String(value.id)); return detail ? [detail] : []; });
  }
  function ideasByWork(id: string, limit: number, offset: number): IdeaByWorkPage {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('La página de ideas solicitada no es válida.');
    const occurrences = required('idea_occurrences').filter(value => value.nodus_id === id);
    const ideas = occurrences.flatMap(value => {
      const source = row('ideas', 'global_id', String(value.global_id));
      return source ? [{ global_id: source.global_id, type: source.type, label: source.label, statement: source.statement,
        role: value.role, confidence: value.confidence, development: value.development }] : [];
    }).sort((a, b) => compare(String(a.global_id), String(b.global_id))).slice(offset, offset + limit);
    return { ideas, total: occurrences.length } as IdeaByWorkPage;
  }
  function workSummary(id: string): WorkSummary | null {
    const value = row('work_summaries', 'nodus_id', id);
    return value ? { nodus_id: id, summary: value.summary, source_level: value.source_level,
      created_at: value.created_at, updated_at: value.updated_at } as WorkSummary : null;
  }
  async function workSynthesis(id: string): Promise<WorkIdeaSynthesis | null> {
    const value = row('work_idea_synthesis', 'nodus_id', id);
    if (!value) return null;
    const source = required('idea_occurrences').filter(link => link.nodus_id === id)
      .sort((a, b) => compare(String(a.global_id), String(b.global_id)))
      .map(link => `${link.global_id}:${link.role}:${Number(link.confidence).toFixed(4)}`).join('|');
    const bytes = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(source));
    const fingerprint = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
    const remember = parseJson<unknown>(value.remember_json, []);
    return { thesis: String(value.thesis), remember: Array.isArray(remember) ? remember.filter((item): item is string => typeof item === 'string') : [],
      positioning: String(value.positioning), model: parseJson(value.model_json, null), generatedAt: String(value.generated_at), stale: value.fingerprint !== fingerprint };
  }
  function authorDossier(id: string): AuthorDossier | null {
    for (const table of ['authors', 'works', 'work_authors', 'ideas', 'idea_occurrences', 'evidence', 'themes', 'idea_theme_links', 'author_relations', 'author_dossier_synthesis']) required(table);
    const dossier = workspaceAuthorDossier(tables, id) as AuthorDossier | null;
    if (!dossier) return null;
    // Keep the Desktop dossier DTO rather than exposing extra raw columns from
    // the Server projection. Its shared-theme query explicitly uses SQLite's
    // binary label order; locale sorting changes the displayed source order.
    const { author_id, name, affiliation } = dossier.author;
    const frequency = new Map<string, number>();
    for (const value of dossier.ideas) for (const label of value.themes) frequency.set(label, (frequency.get(label) ?? 0) + 1);
    return { ...dossier, author: { author_id, name, affiliation },
      themes: [...frequency].sort((a, b) => b[1] - a[1]).map(([label]) => label),
      ideas: dossier.ideas.map(value => ({ ...value, evidence: value.evidence.map(({ id, global_id, nodus_id, quote, location, kind }) => ({ id, global_id, nodus_id, quote, location, kind })) })),
      relations: dossier.relations.map(value => ({ ...value, sharedThemes: value.sharedThemes.slice().sort(compare) })) };
  }
  function gapDetail(id: string): GapDetail | null {
    const gap = row('gaps', 'id', id);
    if (!gap) return null;
    const work = row('works', 'nodus_id', String(gap.nodus_id));
    if (!work) return null;
    const related = gap.related_idea ? row('ideas', 'global_id', String(gap.related_idea)) : undefined;
    const evidence = gap.evidence_id ? row('evidence', 'id', String(gap.evidence_id)) : undefined;
    return { gap: { id, nodus_id: gap.nodus_id, related_idea: gap.related_idea, kind: gap.kind, statement: gap.statement, confidence: gap.confidence, evidence_id: gap.evidence_id },
      work: { nodus_id: work.nodus_id, title: work.title, zotero_key: work.zotero_key, authors: parseJson(work.authors_json, []), year: work.year, item_type: work.item_type },
      relatedIdea: related?.global_id && related.type && related.label && related.statement ? { global_id: related.global_id, type: related.type, label: related.label, statement: related.statement } : null,
      evidence: evidence?.id && evidence.global_id && evidence.nodus_id && evidence.quote && evidence.kind ? { id: evidence.id, global_id: evidence.global_id, nodus_id: evidence.nodus_id, quote: evidence.quote, location: evidence.location, kind: evidence.kind } : null } as GapDetail;
  }
  function workMeta(id: string): WorkMeta | null {
    // Desktop can fetch this optional enrichment from Zotero. Downloads must
    // not make a Zotero or provider request; the canonical work remains usable.
    return (tables.work_metadata?.find(value => value.nodus_id === id)?.metadata as WorkMeta | undefined) ?? null;
  }
  return { work, workMeta, ideaDetail, edgeDetail, ideaEdges, ideasByWork, workSummary, workSynthesis, authorDossier, gapDetail };
}
