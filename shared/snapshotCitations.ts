import type { CitationPreview, CitationRef, PassageDetail } from './types';
import { buildCitationPreview } from '../electron/citations/citationPreview';
import { parseJson } from './dictionaryRows';

type Row = Record<string, unknown>;

/** Citation lookups against an immutable publication. A missing source stays
 * unverified; a missing published table is an explicit compatibility error. */
export function snapshotCitations(tables: Record<string, Row[]>) {
  const indexed = new Map<string, Map<unknown, Row>>();
  function row(table: string, field: string, id: string): Row | undefined {
    if (!Array.isArray(tables[table])) throw new Error(`La copia publicada no incluye la tabla ${table}. Descarga una publicación compatible.`);
    if (!indexed.has(table)) indexed.set(table, new Map(tables[table].map(item => [item[field], item])));
    return indexed.get(table)!.get(id);
  }
  function resolve(ref: CitationRef): Row | undefined {
    if (ref.kind === 'idea') return row('ideas', 'global_id', ref.id);
    if (ref.kind === 'work') return row('works', 'nodus_id', ref.id);
    if (ref.kind === 'contradiction') return row('edges', 'id', ref.id);
    if (ref.kind === 'gap') {
      const gap = row('gaps', 'id', ref.id);
      return gap && row('works', 'nodus_id', String(gap.nodus_id)) ? gap : undefined;
    }
    if (ref.kind !== 'passage') return undefined;
    // Scoped and documentary receipts need their canonical, permission-aware
    // publication. Their text in a Dictionary evidence row is not that receipt.
    if (/^(scoped|documentary|web):/.test(ref.id)) return undefined;
    const passage = row('passages', 'passage_id', ref.id);
    const work = passage && row('works', 'nodus_id', String(passage.nodus_id));
    if (!work) return undefined;
    const current = work.resolved_text_hash != null
      ? passage!.content_hash != null && passage!.content_hash === work.resolved_text_hash
      : work.deep_hash == null || passage!.content_hash != null && passage!.content_hash === work.deep_hash;
    return current ? passage : undefined;
  }
  function verify(refs: CitationRef[]): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const ref of refs) result[`${ref.kind}:${ref.id}`] = Boolean(resolve(ref));
    return result;
  }
  function preview(ref: CitationRef): CitationPreview | null {
    const source = resolve(ref);
    if (!source) return null;
    if (ref.kind === 'idea') return buildCitationPreview('idea', { title: String(source.label ?? ''), snippet: String(source.statement ?? '') });
    if (ref.kind === 'contradiction') {
      const from = row('ideas', 'global_id', String(source.from_id)), to = row('ideas', 'global_id', String(source.to_id));
      const short = (value: unknown) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length <= 180 ? text : `${text.slice(0,179).trim()}...`; };
      const explanation = ['contradicts','refutes'].includes(String(source.type))
        ? `La ${source.type === 'refutes' ? 'refutación' : 'contradicción'} detectada es que "${short(from?.statement || from?.label || source.from_id)}" entra en tensión con "${short(to?.statement || to?.label || source.to_id)}".` : null;
      return buildCitationPreview('contradiction', {title:`${from?.label ?? source.from_id} × ${to?.label ?? source.to_id}`,snippet:explanation});
    }
    const work = ref.kind === 'work' ? source : row('works','nodus_id',String(source.nodus_id))!;
    const authors = parseJson<string[]>(work.authors_json,[]).slice(0,ref.kind === 'work' ? 3 : 2).join('; ');
    const subtitle = [authors, ref.kind === 'passage' ? source.page_label : work.year ? String(work.year) : ''].filter(Boolean).join(' · ');
    return buildCitationPreview(ref.kind,{title:String(work.title ?? ''),subtitle,snippet:ref.kind === 'passage' ? String(source.text ?? '') : ref.kind === 'gap' ? String(source.statement ?? '') : null});
  }
  function passage(id: string): PassageDetail | null {
    const source = resolve({kind:'passage',id});
    if (!source) return null;
    const work = row('works','nodus_id',String(source.nodus_id))!;
    return {passage_id:String(source.passage_id),nodus_id:String(source.nodus_id),text:String(source.text ?? ''),
      page_label:source.page_label as string|null,source_ref:source.source_ref as string|null,
      page_number:source.page_number as number|null,chunk_index:Number(source.chunk_index),
      work:{title:String(work.title),authors:parseJson(work.authors_json,[]),year:work.year as number|null,zotero_key:String(work.zotero_key)}};
  }
  return {verify,preview,passage};
}
