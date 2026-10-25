import type { AcademicSource } from '@shared/academicDocument';

const doiKey = (doi?: string | null) => doi?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');

/** Search local metadata only; opening the picker must never wait for Zotero HTTP. */
export async function desktopAcademicSources(query: string): Promise<AcademicSource[]> {
  const [references, global] = await Promise.all([
    window.nodus.listEditorReferences({ onlyWorks: true, search: query, limit: 50 }),
    window.nodus.listGlobalLibraryItems({ search: query || undefined, limit: 50, includeFacets: false }).catch(() => null),
  ]);
  const sources: AcademicSource[] = (global?.items ?? []).map(item => ({
    id: 'global:' + item.id, refId: item.id, scope: 'global', metadata: item.metadata,
    citationKey: item.citationKey, href: `nodus://library/${item.id}`,
  }));
  const globalDois = new Set(sources.map(source => doiKey(source.metadata.doi)).filter(Boolean));
  for (const reference of references) {
    if (!reference.bibliography || globalDois.has(doiKey(reference.bibliography.doi))) continue;
    sources.push({ id: 'vault:' + reference.id, refId: reference.id, scope: 'vault',
      metadata: reference.bibliography, citationKey: null, href: reference.href });
  }
  return sources;
}

/** Fetch complete details for the chosen source, rather than every search result. */
export async function desktopAcademicSourceDetails(source: AcademicSource): Promise<AcademicSource> {
  if (source.scope === 'global') {
    const record = await window.nodus.getGlobalLibraryItem(source.refId);
    return record ? { ...source, metadata: record.metadata, citationKey: record.citationKey ?? null, aliases: record.aliases } : source;
  }
  if (source.scope !== 'vault') return source;
  const meta = await window.nodus.getWorkMeta(source.refId, { timeoutMs: 1500 }).catch(() => null);
  return meta ? { ...source, metadata: { ...source.metadata,
    publisher: meta.publisher ?? undefined, publicationTitle: meta.container ?? undefined,
    pages: meta.pages ?? undefined, volume: meta.volume ?? undefined, issue: meta.issue ?? undefined,
    edition: meta.edition ?? undefined, place: meta.place ?? undefined, url: meta.url ?? undefined,
  } } : source;
}
