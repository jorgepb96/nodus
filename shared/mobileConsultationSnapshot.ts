type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const sourceTables = new Set(['works', 'authors', 'work_authors', 'work_themes', 'themes', 'zotero_tags', 'work_zotero_tags',
  'ideas', 'idea_occurrences', 'idea_theme_links', 'evidence', 'edges', 'edge_feedback', 'gaps',
  'work_summaries', 'work_idea_synthesis', 'author_relations', 'author_dossier_synthesis', 'work_metadata', 'edge_traces']);
const dictionaryTables = new Set(['dictionary_entries', 'dictionary_evidence', 'dictionary_versions', 'dictionary_relations',
  'works', 'authors', 'work_authors', 'work_themes', 'themes', 'zotero_tags', 'work_zotero_tags',
  'collections', 'work_collections', 'idea_occurrences', 'idea_theme_links', 'author_relations', 'author_dossier_synthesis']);

/** The live companion needs a consultation projection, not every passage in the vault.
 * The complete snapshot route remains available for deliberate offline downloads. */
export function mobileConsultationSnapshot(document: Record<string, unknown>, projection: 'dictionary' | 'sources'): Record<string, unknown> {
  const tables = document.tables as Tables;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) throw new Error('invalid_snapshot_tables');
  const names = projection === 'sources' ? sourceTables : dictionaryTables;
  const selected: Tables = Object.fromEntries(Object.entries(tables).filter(([name]) => names.has(name)));
  if (projection === 'dictionary') {
    const refs = new Map<string, Set<string>>();
    const add = (kind: string, id: string) => {
      if (!refs.has(kind)) refs.set(kind, new Set());
      refs.get(kind)!.add(id);
    };
    for (const row of tables.dictionary_evidence ?? []) {
      if (typeof row.kind === 'string' && typeof row.ref_id === 'string') add(row.kind, row.ref_id);
    }
    for (const name of ['dictionary_entries', 'dictionary_versions']) {
      for (const row of tables[name] ?? []) {
        if (typeof row.content_markdown !== 'string') continue;
        for (const match of row.content_markdown.matchAll(/nodus:\/\/(idea|passage|work|gap|contradiction)\/([^\s)\]<>"?#]+(?:#[^\s)\]<>"?]+)?)/g)) {
          let id = match[2];
          try { id = decodeURIComponent(id); } catch { /* Legacy literal identifiers remain queryable. */ }
          add(match[1], id);
        }
      }
    }
    // A contradiction preview names both ideas and their actual statements.
    // Keeping only the edge would leave historical citations with raw identifiers.
    for (const edge of tables.edges ?? []) {
      if (typeof edge.id === 'string' && refs.get('contradiction')?.has(edge.id)) {
        for (const field of ['from_id', 'to_id']) if (typeof edge[field] === 'string') add('idea', edge[field] as string);
      }
    }
    for (const [table, kind, field] of [['ideas', 'idea', 'global_id'], ['passages', 'passage', 'passage_id'], ['gaps', 'gap', 'id'], ['edges', 'contradiction', 'id']]) {
      if (Array.isArray(tables[table])) selected[table] = tables[table].filter(row => typeof row[field] === 'string' && refs.get(kind)?.has(row[field] as string));
    }
  }
  // A partial projection must not advertise unrelated assets or documents as downloaded.
  return { ...document, tables: selected, assets: [], library: undefined,
    capabilities: { ...(document.capabilities as Record<string, unknown> ?? {}), includesUserContent: false,
      includesPassages: Boolean(selected.passages?.length), hasAssets: false, includesLibraryDocuments: false } };
}
