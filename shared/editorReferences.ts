import type { BlockNoteDocument, NativeInline } from './blockNoteDocument';

export type EditorReferenceKind = 'idea' | 'author' | 'work' | 'note' | 'studyDocument' | 'studyMaterial' | 'passage';
export interface EditorReferenceOptions { includePassages?: boolean; search?: string; onlyWorks?: boolean; limit?: number }
export interface EditorReference { id: string; kind: EditorReferenceKind; title: string; subtitle?: string; bibliography?: import('./libraryTypes').LibraryItemMetadata; href: string; pageLabel?:string;physicalPage?:number }
const collections = [
  ['ideas', 'idea', 'global_id', 'label', 'statement', 'idea'],
  ['authors', 'author', 'author_id', 'name', 'affiliation', 'author'],
  ['works', 'work', 'nodus_id', 'title', 'year', 'work'],
  ['passages', 'passage', 'passage_id', 'text', 'page_label', 'passage'],
  ['notes', 'note', 'id', 'title', '', 'note'],
  ['study_docs', 'studyDocument', 'id', 'title', 'description', 'study/doc'],
  ['study_materials', 'studyMaterial', 'id', 'title', 'description', 'study/material'],
] as const;
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();

/** BlockNote 0.55 exposes the validation callback, but not its default helper. */
export function editorLinkAllowed(href: string): boolean {
  const clean = href.replace(/[\p{White_Space}\p{Cc}\p{Cf}]/gu, '');
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(clean)?.[1].toLowerCase();
  if (!scheme) return true; // Relative URLs and document anchors.
  if (scheme === 'nodus') return clean.startsWith('nodus://') && clean.length > 8;
  return ['http', 'https', 'ftp', 'ftps', 'mailto', 'tel', 'callto', 'sms', 'cid', 'xmpp'].includes(scheme);
}

export function parseEditorReference(href: string): { kind: EditorReferenceKind; id: string } | null {
  const route = collections.find(collection => href.startsWith(`nodus://${collection[5]}/`));
  if (!route) return null;
  try {
    const raw = href.slice(`nodus://${route[5]}/`.length).split(/[?#]/)[0];
    if (!raw || raw.includes('/')) return null;
    const id = decodeURIComponent(raw);
    return id && id.length <= 512 ? { kind: route[1], id } : null;
  } catch { return null; }
}

/** The same metadata-only catalogue for the active desktop vault and an authorized publication. */
export function editorReferenceCatalog(tables: Record<string, Array<Record<string, unknown>>>): EditorReference[] {
  const result: EditorReference[] = [];
  const ideaIds = new Set<string>();
  for (const [table, kind, key, titleKey, subtitleKey, route] of collections) {
    for (const row of tables[table] ?? []) {
      if (row.deleted_at || row.trashed_at || row.archived_at || row.orphaned_at || Number(row.archived) === 1) continue;
      const id = String(row[key] ?? '').trim(), title = String(row[titleKey] ?? '').trim();
      if (!id || !title) continue;
      if (kind === 'idea') ideaIds.add(id);
      if (kind === 'note') {
        try {
          const source = typeof row.source_json === 'string' ? JSON.parse(row.source_json) : row.source_json;
          if (source?.note === 'manual-idea' && ideaIds.has(source.ref)) continue;
        } catch { /* A legacy note with unrecognized metadata remains a document. */ }
      }
      let bibliography: import('./libraryTypes').LibraryItemMetadata | undefined;
      if(kind==='work') {
        let authors:string[]=[];try{authors=typeof row.authors_json==='string'?JSON.parse(row.authors_json):Array.isArray(row.authors)?row.authors as string[]:[];}catch{}
        bibliography={title,itemType: String(row.item_type??'document').replace('journalArticle','article-journal').replace('bookSection','chapter') as import('./libraryTypes').LibraryItemType,creators:(()=>{try{const creators=typeof row.creators_json==='string'?JSON.parse(row.creators_json):[];if(creators?.length)return creators.map((c:any)=>({creatorType:c.role??c.creatorType??'author',name:c.name??undefined,lastName:c.lastName??undefined,firstName:c.firstName??undefined}));}catch{}return authors.map(name=>({creatorType:'author',name}));})(),year:row.year==null?null:Number(row.year),doi:typeof row.doi==='string'?row.doi:undefined};
      }
      result.push({ id, kind, title:kind==='passage'?title.slice(0,160):title, ...(kind==='passage'?{pageLabel:row.page_label?String(row.page_label):undefined,physicalPage:Number(row.page_number)||undefined}:{}), ...(bibliography?{bibliography}:{}), subtitle: String(row[subtitleKey] ?? '').replace(/\s+/g, ' ').trim().slice(0, 180) || undefined, href: `nodus://${route}/${encodeURIComponent(id)}` });
    }
  }
  return searchEditorReferences(result, '');
}

/** No result cap: every idea remains reachable through search, scrolling and keyboard. */
export function searchEditorReferences(items: EditorReference[], query: string): EditorReference[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return terms.every(term => normalize(`${item.title} ${item.subtitle ?? ''}`).includes(term));
  }).sort((a, b) => {
    const exact = (item: EditorReference) => Number(terms.length > 0 && normalize(item.title) === normalize(query));
    return exact(b) - exact(a) || collections.findIndex(entry => entry[1] === a.kind) - collections.findIndex(entry => entry[1] === b.kind) || a.title.localeCompare(b.title) || a.href.localeCompare(b.href);
  });
}

/** References are native BlockNote links, so Markdown export remains interoperable. */
export function documentReferences(document: BlockNoteDocument | null | undefined): EditorReference[] {
  const result: EditorReference[] = [], seen = new Set<string>();
  const inline = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const entry of value as NativeInline[]) {
      const href = entry.type === 'link' ? entry.href : entry.type === 'nodusWiki' ? String(entry.props?.reference ?? '') : '';
      const route = href && collections.find(collection => href.startsWith(`nodus://${collection[5]}/`));
      if (route && !seen.has(href!)) {
        try {
          const id = decodeURIComponent(href!.slice(`nodus://${route[5]}/`.length).split(/[?#]/)[0]);
          const title = entry.type === 'nodusWiki' ? String(entry.props?.label ?? id) : (entry.content ?? []).map(item => item.text ?? '').join('');
          if (id) { seen.add(href!); result.push({ id, kind: route[1], title: title || id, href: href! }); }
        } catch { /* Keep an unknown link in the native document without guessing a destination. */ }
      }
      inline(entry.content);
    }
  };
  const blocks = (value: BlockNoteDocument) => value.forEach(block => {
    inline(block.content);
    if (block.type === 'table') for (const row of (block.content as { rows?: Array<{ cells: unknown[] }> })?.rows ?? []) for (const cell of row.cells) inline(Array.isArray(cell) ? cell : (cell as { content?: unknown })?.content);
    blocks(block.children ?? []);
  });
  blocks(document ?? []); return result;
}
