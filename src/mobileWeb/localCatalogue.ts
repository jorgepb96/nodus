// @ts-expect-error The same pure projection is bundled by Nodus Server and Cloud.
import { workspaceAuthorPage } from '../../server/lib/core/academicWorkspace.mjs';
import type { AuthorSummary, CollectionFacet, WorkView, ZoteroTag } from '@shared/types';
import { parseJson } from '@shared/dictionaryRows';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
const compare = (a: string,b: string) => a < b ? -1 : a > b ? 1 : 0;
const fold = (text: string) => text.replace(/[A-Z]/g, letter => letter.toLowerCase());

/** All catalogue pages are read locally; no operation or provider is invoked. */
export function localCatalogue(tables: Tables) {
  const required = (table: string) => {
    if (!Array.isArray(tables[table])) throw new Error(`La copia publicada no incluye la tabla ${table}. Descarga una publicación compatible.`);
    return tables[table];
  };
  const works = required('works').filter(row => row.archived === 0);
  const workIds = new Set(works.map(row => row.nodus_id));
  function authors(): AuthorSummary[] {
    required('authors'); required('work_authors');
    const first = workspaceAuthorPage(tables,{offset:0,limit:100,sort:'ideas'});
    const result = [...first.items];
    for (let offset = first.limit; offset < first.total; offset += first.limit) result.push(...workspaceAuthorPage(tables,{offset,limit:first.limit,sort:'ideas'}).items);
    return result;
  }
  function workList(): WorkView[] {
    const themes = new Map(required('themes').map(row => [row.theme_id,row.label]));
    const tags = new Map(required('zotero_tags').map(row => [row.tag_id,row.label]));
    const links = required('work_themes'), tagLinks = required('work_zotero_tags'), occurrences = required('idea_occurrences');
    return works.slice().sort((a,b) => Number(b.year ?? -Infinity) - Number(a.year ?? -Infinity) || compare(fold(String(a.title)),fold(String(b.title))))
      .map(row => { const {authors_json,...rest} = row; return {...rest,authors:parseJson(authors_json,[]),themes:links.filter(link => link.nodus_id === row.nodus_id).map(link => String(themes.get(link.theme_id) ?? '')),zoteroTags:tagLinks.filter(link => link.nodus_id === row.nodus_id).map(link => String(tags.get(link.tag_id) ?? '')),ideaCount:occurrences.filter(link => link.nodus_id === row.nodus_id).length} as unknown as WorkView; });
  }
  function tags(): ZoteroTag[] {
    const links = required('work_zotero_tags').filter(row => workIds.has(row.nodus_id));
    return required('zotero_tags').flatMap(row => { const count = links.filter(link => link.tag_id === row.tag_id).length; return count ? [{label:String(row.label),workCount:count}] : []; })
      .sort((a,b) => b.workCount-a.workCount || compare(fold(a.label),fold(b.label)));
  }
  function collections(): CollectionFacet[] {
    const rows = required('collections'), links = required('work_collections').filter(row => workIds.has(row.nodus_id));
    const ids = new Set(rows.map(row => row.collection_key)), children = new Map<string|null,Row[]>();
    for (const row of rows) { const parent = row.parent_key && ids.has(row.parent_key) ? String(row.parent_key) : null, bucket = children.get(parent) ?? []; bucket.push(row); children.set(parent,bucket); }
    const count = (id: string,path = new Set<string>()): number => {
      if (path.has(id)) throw new Error('El árbol de colecciones de la copia contiene un ciclo.');
      const next = new Set(path).add(id);
      return new Set(links.filter(row => row.collection_key === id).map(row => row.nodus_id)).size + (children.get(id) ?? []).reduce((sum,row) => sum + count(String(row.collection_key),next),0);
    };
    const result: CollectionFacet[] = [];
    function walk(parent: string|null,depth: number) {
      for (const row of (children.get(parent) ?? []).slice().sort((a,b) => String(a.name ?? '').localeCompare(String(b.name ?? ''),undefined,{sensitivity:'base'}))) {
        const id = String(row.collection_key), workCount = count(id);
        if (workCount) result.push({key:id,name:String(row.name ?? id),parentKey:parent,depth,workCount});
        walk(id,depth+1);
      }
    }
    walk(null,0); return result;
  }
  return {authors,workList,tags,collections};
}
