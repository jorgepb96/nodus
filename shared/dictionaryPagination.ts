import type { DictionaryEntryPage, DictionaryListRequest, DictionaryEvidencePage, DictionaryEvidenceRequest } from './dictionary';

/** Read the complete filtered catalogue, including servers which cap page sizes. */
export async function readDictionaryCatalogue(
  fetchPage: (request: DictionaryListRequest) => Promise<DictionaryEntryPage>,
  request: Omit<DictionaryListRequest, 'offset' | 'limit'>,
): Promise<DictionaryEntryPage> {
  return readCompleteDictionaryPages(fetchPage, request);
}

export async function readDictionaryEvidence(
  fetchPage: (request: DictionaryEvidenceRequest) => Promise<DictionaryEvidencePage>,
  request: Omit<DictionaryEvidenceRequest, 'offset' | 'limit'>,
): Promise<DictionaryEvidencePage> {
  return readCompleteDictionaryPages(fetchPage, request);
}

async function readCompleteDictionaryPages<Item extends {id: string}, Request>(
  fetchPage: (request: Request & {offset: number; limit: number}) => Promise<{items:Item[];total:number;offset:number;limit:number}>,
  request: Request,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const items: Item[] = [];
    const ids = new Set<string>();
    let total: number | undefined;
    let changed = false;
    do {
      const page = await fetchPage({ ...request, offset: items.length, limit: 200 });
      if (!Number.isSafeInteger(page.total) || page.total < 0 || page.offset !== items.length)
        throw new Error('invalid_dictionary_page');
      if (total !== undefined && total !== page.total) { changed = true; break; }
      total = page.total;
      if ((!page.items.length && items.length < total) || items.length + page.items.length > total)
        throw new Error('incomplete_dictionary_catalogue');
      for (const entry of page.items) {
        if (ids.has(entry.id)) { changed = true; break; }
        ids.add(entry.id); items.push(entry);
      }
      if (changed) break;
    } while (items.length < total!);
    if (!changed) return { items, total: total!, offset: 0, limit: items.length };
  }
  throw new Error('dictionary_catalogue_changed_retry');
}
