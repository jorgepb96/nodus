import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  LibraryBibliographyImportReport,
  LibraryCreator,
  LibraryItemMetadata,
  LibraryItemRecord,
  LibraryItemSource,
  LibraryItemType,
} from '@shared/libraryTypes';
import { normalizeLibraryMetadata } from './libraryRecord';
import { LibraryCatalog } from './libraryCatalog';
import { LibraryDiskStore } from './libraryStorage';
import { generateCitationKey } from './libraryCitation';

export interface ParsedBibliographicItem {
  source: Exclude<LibraryItemSource, 'nodus' | 'zotero' | 'legacy'>;
  citationKey?: string;
  metadata: LibraryItemMetadata;
}

function extras(entries: Iterable<[string, unknown]>, known: Set<string>, prefix: string): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.toLowerCase(); if (known.has(key) || rawValue == null) continue;
    const value = Array.isArray(rawValue) ? rawValue.map(String).filter(Boolean).join('\n') : typeof rawValue === 'object' ? JSON.stringify(rawValue) : String(rawValue);
    if (value.trim()) result[`${prefix}:${rawKey}`] = value.trim();
  }
  return Object.keys(result).length ? result : undefined;
}

function values(map: Map<string, string[]>, ...keys: string[]): string[] {
  return keys.flatMap((key) => map.get(key) ?? []).map((value) => value.trim()).filter(Boolean);
}

function year(value: unknown): number | null {
  const match = /(?:^|\D)(-?\d{3,4})(?:\D|$)/.exec(String(value ?? ''));
  const parsed = Number(match?.[1]);
  return Number.isInteger(parsed) && parsed > -10_000 && parsed < 10_000 ? parsed : null;
}

function itemType(value: unknown): LibraryItemType {
  const type = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (['jour', 'journalarticle', 'article', 'articlejournal', 'magazinearticle', 'newspaperarticle'].includes(type)) return 'article-journal';
  if (['book', 'editedbook', 'monograph'].includes(type)) return 'book';
  if (['chap', 'booksection', 'inbook', 'incollection', 'chapter', 'bookchapter'].includes(type)) return 'book-chapter';
  if (['preprint', 'postedcontent'].includes(type)) return 'preprint';
  if (['standard', 'std'].includes(type)) return 'standard';
  if (['conf', 'conferencepaper', 'inproceedings', 'proceedings'].includes(type)) return 'conference-paper';
  if (['thes', 'thesis', 'phdthesis', 'mastersthesis'].includes(type)) return 'thesis';
  if (['rprt', 'report', 'techreport'].includes(type)) return 'report';
  if (['web', 'webpage', 'online', 'misc'].includes(type)) return 'webpage';
  if (type === 'dataset') return 'dataset';
  return 'document';
}

function nameCreator(name: string): LibraryCreator {
  const clean = name.trim();
  const comma = /^([^,]+),\s*(.+)$/.exec(clean);
  return comma
    ? { creatorType: 'author', firstName: comma[2].trim(), lastName: comma[1].trim() }
    : { creatorType: 'author', name: clean };
}

function identifiers(input: string[]): { isbn: string[]; issn: string[] } {
  const isbn: string[] = []; const issn: string[] = [];
  for (const raw of input) {
    const clean = raw.toUpperCase().replace(/[^0-9X]/g, '');
    if (/^\d{7}[\dX]$/.test(clean)) issn.push(raw.trim());
    else if (/^(?:\d{9}[\dX]|\d{13})$/.test(clean)) isbn.push(raw.trim());
  }
  return { isbn: [...new Set(isbn)], issn: [...new Set(issn)] };
}

export function parseRis(text: string): ParsedBibliographicItem[] {
  const records: Array<Map<string, string[]>> = [];
  let current = new Map<string, string[]>();
  let lastTag = '';
  const flush = () => { if (current.size) records.push(current); current = new Map(); lastTag = ''; };
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^([A-Z0-9]{2})\s{0,2}-\s?(.*)$/.exec(line);
    if (match) {
      const [, tag, raw] = match;
      if (tag === 'TY' && current.size) flush();
      if (tag === 'ER') { flush(); continue; }
      current.set(tag, [...(current.get(tag) ?? []), raw.trim()]); lastTag = tag;
    } else if (lastTag && line.trim()) {
      const entries = current.get(lastTag)!; entries[entries.length - 1] = `${entries[entries.length - 1]} ${line.trim()}`;
    }
  }
  flush();
  return records.flatMap((record) => {
    const title = values(record, 'TI', 'T1', 'CT')[0];
    if (!title) return [];
    const date = values(record, 'PY', 'Y1', 'DA')[0];
    const serials = identifiers(values(record, 'SN'));
    const firstPage = values(record, 'SP')[0]; const lastPage = values(record, 'EP')[0];
    const known = new Set(['ty', 'id', 'ti', 't1', 'ct', 'au', 'a1', 'a2', 'ab', 'n2', 'py', 'y1', 'da', 'la', 'pb', 'jo', 'jf', 't2', 'vl', 'is', 'sp', 'ep', 'cy', 'pp', 'ur', 'do', 'sn', 'kw']);
    return [{ source: 'ris' as const, citationKey: values(record, 'ID')[0], metadata: normalizeLibraryMetadata({
      title, itemType: itemType(values(record, 'TY')[0]), creators: values(record, 'AU', 'A1', 'A2').map(nameCreator),
      abstract: values(record, 'AB', 'N2')[0], date, year: year(date), language: values(record, 'LA')[0],
      publisher: values(record, 'PB')[0], publicationTitle: values(record, 'JO', 'JF', 'T2')[0],
      volume: values(record, 'VL')[0], issue: values(record, 'IS')[0], pages: firstPage ? `${firstPage}${lastPage ? `-${lastPage}` : ''}` : undefined,
      place: values(record, 'CY', 'PP')[0], url: values(record, 'UR')[0], doi: values(record, 'DO')[0],
      isbn: serials.isbn, issn: serials.issn, tags: values(record, 'KW'), extra: extras(record, known, 'ris'),
    }, title) }];
  });
}

function bibEntries(text: string): Array<{ type: string; key: string; fields: Map<string, string> }> {
  const entries: Array<{ type: string; key: string; fields: Map<string, string> }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('@', cursor); if (start < 0) break;
    const header = /^@([A-Za-z]+)\s*([{(])/.exec(text.slice(start)); if (!header) { cursor = start + 1; continue; }
    const openAt = start + header[0].lastIndexOf(header[2]); const closeChar = header[2] === '{' ? '}' : ')';
    let depth = 1; let quote = false; let index = openAt + 1;
    for (; index < text.length && depth > 0; index += 1) {
      const character = text[index];
      if (character === '"' && text[index - 1] !== '\\') quote = !quote;
      if (quote) continue;
      if (character === header[2]) depth += 1; else if (character === closeChar) depth -= 1;
    }
    const body = text.slice(openAt + 1, index - 1); cursor = index;
    let split = 0; depth = 0; quote = false;
    for (; split < body.length; split += 1) { const character = body[split]; if (character === '"' && body[split - 1] !== '\\') quote = !quote; if (!quote && character === '{') depth += 1; if (!quote && character === '}') depth -= 1; if (!quote && depth === 0 && character === ',') break; }
    const key = body.slice(0, split).trim(); const fields = new Map<string, string>(); let at = split + 1;
    while (at < body.length) {
      while (/[\s,]/.test(body[at] ?? '')) at += 1;
      const name = /^[A-Za-z][A-Za-z0-9_-]*/.exec(body.slice(at)); if (!name) break;
      at += name[0].length; while (/\s/.test(body[at] ?? '')) at += 1; if (body[at] !== '=') break; at += 1; while (/\s/.test(body[at] ?? '')) at += 1;
      let value = '';
      if (body[at] === '{') { let level = 1; const from = ++at; while (at < body.length && level) { if (body[at] === '{') level += 1; else if (body[at] === '}') level -= 1; at += 1; } value = body.slice(from, at - 1); }
      else if (body[at] === '"') { const from = ++at; while (at < body.length && (body[at] !== '"' || body[at - 1] === '\\')) at += 1; value = body.slice(from, at); at += 1; }
      else { const from = at; while (at < body.length && body[at] !== ',') at += 1; value = body.slice(from, at); }
      fields.set(name[0].toLowerCase(), value.replace(/[{}]/g, '').replace(/\\([&%_$#])/g, '$1').replace(/\s+/g, ' ').trim());
    }
    entries.push({ type: header[1], key, fields });
  }
  return entries;
}

export function parseBibtex(text: string, source: 'bibtex' | 'biblatex' = 'bibtex'): ParsedBibliographicItem[] {
  return bibEntries(text).flatMap((entry) => {
    const get = (...keys: string[]) => keys.map((key) => entry.fields.get(key)).find(Boolean);
    const title = get('title'); if (!title) return [];
    const authors = String(get('author') ?? '').split(/\s+and\s+/i).map(nameCreator).filter((creator) => creator.name || creator.firstName || creator.lastName);
    const rawYear = get('year', 'date');
    const known = new Set(['title', 'author', 'abstract', 'year', 'date', 'language', 'publisher', 'journaltitle', 'journal', 'booktitle', 'volume', 'number', 'issue', 'pages', 'edition', 'address', 'location', 'url', 'doi', 'isbn', 'issn', 'keywords']);
    return [{ source, citationKey: entry.key || undefined, metadata: normalizeLibraryMetadata({
      title, itemType: itemType(entry.type), creators: authors, abstract: get('abstract'), date: get('date'), year: year(rawYear),
      language: get('language'), publisher: get('publisher'), publicationTitle: get('journaltitle', 'journal', 'booktitle'),
      volume: get('volume'), issue: get('number', 'issue'), pages: get('pages'), edition: get('edition'), place: get('address', 'location'),
      url: get('url'), doi: get('doi'), isbn: get('isbn')?.split(/[,;]\s*/) ?? [], issn: get('issn')?.split(/[,;]\s*/) ?? [],
      tags: get('keywords')?.split(/[,;]\s*/) ?? [], extra: extras(entry.fields, known, source),
    }, title) }];
  });
}

function cslDate(value: unknown): { date?: string; year: number | null } {
  const parts = ((value as { 'date-parts'?: unknown } | undefined)?.['date-parts'] as unknown[][] | undefined)?.[0];
  if (!Array.isArray(parts) || !parts.length) return { year: null };
  return { date: parts.map(String).join('-'), year: year(parts[0]) };
}

function cslItem(raw: unknown, source: 'csl-json' | 'mendeley'): ParsedBibliographicItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>; const title = String(item.title ?? '').trim(); if (!title) return null;
  const issued = cslDate(item.issued ?? (item.year ? { 'date-parts': [[item.year]] } : null));
  const rawAuthors = Array.isArray(item.author) ? item.author : Array.isArray(item.authors) ? item.authors : [];
  const creators = rawAuthors.flatMap((rawAuthor) => {
    if (typeof rawAuthor === 'string') return [nameCreator(rawAuthor)]; if (!rawAuthor || typeof rawAuthor !== 'object') return [];
    const author = rawAuthor as Record<string, unknown>; const firstName = String(author.given ?? author.first_name ?? '').trim(); const lastName = String(author.family ?? author.last_name ?? '').trim(); const name = String(author.literal ?? author.name ?? '').trim();
    return firstName || lastName || name ? [{ creatorType: 'author', ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}), ...(name ? { name } : {}) }] : [];
  });
  const identifiersMap = item.identifiers && typeof item.identifiers === 'object' ? item.identifiers as Record<string, unknown> : {};
  const list = (value: unknown) => (Array.isArray(value) ? value : value == null ? [] : [value]).map(String).flatMap((value) => value.split(/[,;]\s*/)).filter(Boolean);
  const known = new Set(['id', 'citation_key', 'type', 'title', 'author', 'authors', 'abstract', 'issued', 'year', 'language', 'publisher', 'container-title', 'source', 'volume', 'issue', 'page', 'pages', 'edition', 'publisher-place', 'city', 'url', 'doi', 'isbn', 'issn', 'identifiers', 'keyword', 'keywords', 'tags', 'pmid', 'pmcid', 'arxiv']);
  return { source, citationKey: String(item.id ?? item.citation_key ?? '').trim() || undefined, metadata: normalizeLibraryMetadata({
    title, itemType: itemType(item.type), creators, abstract: item.abstract, date: issued.date, year: issued.year,
    language: item.language, publisher: item.publisher, publicationTitle: item['container-title'] ?? item.source,
    volume: item.volume, issue: item.issue, pages: item.page ?? item.pages, edition: item.edition, place: item['publisher-place'] ?? item.city,
    url: item.URL ?? item.url, doi: item.DOI ?? item.doi ?? identifiersMap.doi,
    pmid: item.PMID ?? item.pmid ?? identifiersMap.pmid, pmcid: item.PMCID ?? item.pmcid ?? identifiersMap.pmcid,
    arxiv: item.arXiv ?? item.arxiv ?? identifiersMap.arxiv,
    isbn: list(item.ISBN ?? item.isbn ?? identifiersMap.isbn), issn: list(item.ISSN ?? item.issn ?? identifiersMap.issn),
    tags: list(item.keyword ?? item.keywords ?? item.tags), extra: extras(Object.entries(item), known, 'csl'),
  }, title) };
}

export function parseCslJson(text: string): ParsedBibliographicItem[] {
  const parsed = JSON.parse(text) as unknown;
  const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { documents?: unknown }).documents) ? (parsed as { documents: unknown[] }).documents : [parsed];
  const mendeley = values.some((entry) => !!entry && typeof entry === 'object' && ('authors' in entry || 'identifiers' in entry || 'citation_key' in entry));
  return values.map((entry) => cslItem(entry, mendeley ? 'mendeley' : 'csl-json')).filter((entry): entry is ParsedBibliographicItem => !!entry);
}

function xmlDecode(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function xmlValues(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi'))].map((match) => xmlDecode(match[1])).filter(Boolean);
}

function xmlRecordExtra(xml: string, known: Set<string>, prefix: string): Record<string, string> | undefined {
  const entries = [...xml.matchAll(/<([\w:-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)].map((match) => [match[1], xmlDecode(match[2])] as [string, string]);
  return extras(entries, known, prefix);
}

export function parseEndNoteXml(text: string): ParsedBibliographicItem[] {
  return [...text.matchAll(/<record(?:\s[^>]*)?>([\s\S]*?)<\/record>/gi)].flatMap((match) => {
    const xml = match[1]; const title = xmlValues(xml, 'title')[0]; if (!title) return [];
    const rawYear = xmlValues(xml, 'year')[0] ?? xmlValues(xml, 'dates')[0];
    const authorsXml = /<authors(?:\s[^>]*)?>([\s\S]*?)<\/authors>/i.exec(xml)?.[1] ?? '';
    const authors = xmlValues(authorsXml, 'author').map(nameCreator);
    const urls = xmlValues(xml, 'url'); const doi = xmlValues(xml, 'electronic-resource-num').find((value) => /^10\./.test(value));
    const isbnValues = identifiers(xmlValues(xml, 'isbn')); const known = new Set(['ref-type', 'rec-number', 'title', 'authors', 'author', 'year', 'dates', 'secondary-title', 'publisher', 'volume', 'number', 'pages', 'edition', 'pub-location', 'abstract', 'language', 'url', 'electronic-resource-num', 'isbn', 'keywords', 'keyword']);
    return [{ source: 'endnote-xml' as const, citationKey: xmlValues(xml, 'label')[0] ?? xmlValues(xml, 'rec-number')[0], metadata: normalizeLibraryMetadata({
      title, itemType: itemType(/<ref-type[^>]*name="([^"]+)"/i.exec(xml)?.[1]), creators: authors, year: year(rawYear), date: rawYear,
      publicationTitle: xmlValues(xml, 'secondary-title')[0], publisher: xmlValues(xml, 'publisher')[0], volume: xmlValues(xml, 'volume')[0],
      issue: xmlValues(xml, 'number')[0], pages: xmlValues(xml, 'pages')[0], edition: xmlValues(xml, 'edition')[0], place: xmlValues(xml, 'pub-location')[0],
      abstract: xmlValues(xml, 'abstract')[0], language: xmlValues(xml, 'language')[0], url: urls[0], doi,
      isbn: isbnValues.isbn, issn: isbnValues.issn, tags: xmlValues(xml, 'keyword'), extra: xmlRecordExtra(xml, known, 'endnote'),
    }, title) }];
  });
}

export function parseZoteroRdf(text: string): ParsedBibliographicItem[] {
  const matches = [...text.matchAll(/<(bib:Article|bib:Book|bib:BookSection|z:item|rdf:Description)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi)];
  return matches.flatMap((match) => {
    const xml = match[3]; const title = xmlValues(xml, 'dc:title')[0]; if (!title) return [];
    const citationKey = /rdf:about="urn:nodus:([^"]+)"/i.exec(match[2] ?? '')?.[1];
    const date = xmlValues(xml, 'dc:date')[0]; const creators = [...xml.matchAll(/<(?:foaf:Person|rdf:li)(?:\s[^>]*)?>([\s\S]*?)<\/(?:foaf:Person|rdf:li)>/gi)]
      .flatMap((entry) => { const name = xmlValues(entry[1], 'foaf:surname')[0] ? `${xmlValues(entry[1], 'foaf:surname')[0]}, ${xmlValues(entry[1], 'foaf:givenName')[0] ?? ''}` : xmlDecode(entry[1]); return name ? [nameCreator(name)] : []; });
    creators.push(...xmlValues(xml, 'dc:creator').map(nameCreator));
    const identifierValues = xmlValues(xml, 'dc:identifier'); const doi = identifierValues.find((value) => /^(?:doi:)?10\./i.test(value))?.replace(/^doi:/i, '');
    const serials = identifiers(identifierValues); const known = new Set(['dc:title', 'dc:creator', 'dc:date', 'dc:publisher', 'dc:identifier', 'dc:subject', 'dc:description', 'dc:language', 'dc:rights', 'dcterms:ispartof', 'prism:publicationname', 'prism:volume', 'prism:number', 'prism:startingpage', 'z:itemtype', 'foaf:person', 'foaf:surname', 'foaf:givenname', 'rdf:li']);
    return [{ source: 'zotero-rdf' as const, ...(citationKey ? { citationKey: xmlDecode(citationKey) } : {}), metadata: normalizeLibraryMetadata({
      title, itemType: itemType(xmlValues(xml, 'z:itemType')[0]), creators, date, year: year(date), publisher: xmlValues(xml, 'dc:publisher')[0],
      publicationTitle: xmlValues(xml, 'prism:publicationName')[0], volume: xmlValues(xml, 'prism:volume')[0], issue: xmlValues(xml, 'prism:number')[0],
      pages: xmlValues(xml, 'prism:startingPage')[0], abstract: xmlValues(xml, 'dc:description')[0], language: xmlValues(xml, 'dc:language')[0],
      rights: xmlValues(xml, 'dc:rights')[0], doi, url: identifierValues.find((value) => /^https?:/i.test(value)), isbn: serials.isbn, issn: serials.issn,
      tags: xmlValues(xml, 'dc:subject'), extra: xmlRecordExtra(xml, known, 'zotero-rdf'),
    }, title) }];
  });
}

function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') { if (quoted && text[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted; }
    else if (character === ',' && !quoted) { row.push(value); value = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) { if (character === '\r' && text[index + 1] === '\n') index += 1; row.push(value); if (row.some((entry) => entry.trim())) rows.push(row); row = []; value = ''; }
    else value += character;
  }
  row.push(value); if (row.some((entry) => entry.trim())) rows.push(row); return rows;
}

export function parseBibliographyCsv(text: string): ParsedBibliographicItem[] {
  const [headers = [], ...rows] = csvRows(text.replace(/^\uFEFF/, ''));
  const keys = headers.map((header) => header.trim().toLowerCase());
  return rows.flatMap((row) => {
    const raw = Object.fromEntries(keys.map((key, index) => [key, row[index]?.trim() ?? ''])); const title = raw.title; if (!title) return [];
    const known = new Set(['citationkey', 'citation key', 'type', 'title', 'author', 'authors', 'year', 'date', 'abstract', 'publication', 'publicationtitle', 'publisher', 'volume', 'issue', 'pages', 'doi', 'isbn', 'issn', 'url', 'language', 'tags', 'pmid', 'pmcid', 'arxiv']);
    const get = (...names: string[]) => names.map((name) => raw[name]).find(Boolean);
    return [{ source: 'csv' as const, citationKey: get('citationkey', 'citation key'), metadata: normalizeLibraryMetadata({
      title, itemType: itemType(raw.type), creators: String(get('authors', 'author') ?? '').split(/\s*;\s*/).filter(Boolean).map(nameCreator),
      year: year(get('year', 'date')), date: raw.date, abstract: raw.abstract, publicationTitle: get('publicationtitle', 'publication'), publisher: raw.publisher,
      volume: raw.volume, issue: raw.issue, pages: raw.pages, doi: raw.doi, isbn: raw.isbn?.split(/\s*;\s*/) ?? [], issn: raw.issn?.split(/\s*;\s*/) ?? [],
      url: raw.url, language: raw.language, tags: raw.tags?.split(/\s*;\s*/) ?? [], pmid: raw.pmid, pmcid: raw.pmcid, arxiv: raw.arxiv,
      extra: {
        ...Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.startsWith('extra.') && value).map(([key, value]) => [key.slice(6), value])),
        ...(extras(Object.entries(raw).filter(([key]) => !key.startsWith('extra.')), known, 'csv') ?? {}),
      },
    }, title) }];
  });
}

export function parseBibliographyMarkdown(text: string): ParsedBibliographicItem[] {
  return text.split(/\r?\n\r?\n(?=---\r?\n)/).flatMap((block) => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(block.trim()); if (!match) return [];
    const raw = Object.fromEntries(match[1].split(/\r?\n/).flatMap((line) => { const entry = /^([\w .:-]+):\s*(.*)$/.exec(line); return entry ? [[entry[1].trim().toLowerCase(), entry[2].trim().replace(/^['"]|['"]$/g, '').replace(/\\"/g, '"')]] : []; }));
    const title = raw.title; if (!title) return [];
    const known = new Set(['citationkey', 'type', 'title', 'authors', 'year', 'date', 'abstract', 'publication', 'publisher', 'volume', 'issue', 'pages', 'doi', 'isbn', 'issn', 'url', 'language', 'tags', 'pmid', 'pmcid', 'arxiv']);
    return [{ source: 'markdown' as const, citationKey: raw.citationkey, metadata: normalizeLibraryMetadata({
      title, itemType: itemType(raw.type), creators: String(raw.authors ?? '').split(/\s*;\s*/).filter(Boolean).map(nameCreator), year: year(raw.year ?? raw.date), date: raw.date,
      abstract: raw.abstract, publicationTitle: raw.publication, publisher: raw.publisher, volume: raw.volume, issue: raw.issue, pages: raw.pages,
      doi: raw.doi, isbn: raw.isbn?.split(/\s*;\s*/) ?? [], issn: raw.issn?.split(/\s*;\s*/) ?? [], url: raw.url, language: raw.language,
      tags: raw.tags?.split(/\s*;\s*/) ?? [], pmid: raw.pmid, pmcid: raw.pmcid, arxiv: raw.arxiv,
      extra: {
        ...Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.startsWith('extra.') && value).map(([key, value]) => [key.slice(6), value])),
        ...(extras(Object.entries(raw).filter(([key]) => !key.startsWith('extra.')), known, 'markdown') ?? {}),
      },
    }, title) }];
  });
}

export function parseBibliographyFile(file: string): ParsedBibliographicItem[] {
  const text = fs.readFileSync(file, 'utf8'); const extension = path.extname(file).toLowerCase();
  if (extension === '.ris') return parseRis(text);
  if (['.bib', '.bibtex'].includes(extension)) return parseBibtex(text, extension === '.bib' && /@(?:online|mvbook|inreference)\b/i.test(text) ? 'biblatex' : 'bibtex');
  if (extension === '.biblatex') return parseBibtex(text, 'biblatex');
  if (extension === '.json') return parseCslJson(text);
  if (extension === '.xml') return /<records\b/i.test(text) ? parseEndNoteXml(text) : parseZoteroRdf(text);
  if (extension === '.rdf') return parseZoteroRdf(text);
  if (extension === '.csv') return parseBibliographyCsv(text);
  if (['.md', '.markdown'].includes(extension)) return parseBibliographyMarkdown(text);
  throw new Error(`Formato bibliográfico no compatible: ${extension || path.basename(file)}`);
}

function cleanId(value: string | undefined): string {
  return String(value ?? '').toLocaleLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/[^a-z0-9]/g, '');
}

function normalizedTitle(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function creatorIdentity(record: LibraryItemRecord): string {
  const creator = record.metadata.creators[0];
  return normalizedTitle(creator?.name || [creator?.firstName, creator?.lastName].filter(Boolean).join(' '));
}

function duplicate(existing: LibraryItemRecord[], metadata: LibraryItemMetadata): LibraryItemRecord | null {
  const doi = cleanId(metadata.doi); const isbns = new Set((metadata.isbn ?? []).map(cleanId).filter(Boolean));
  const title = normalizedTitle(metadata.title); const firstCreator = normalizedTitle(metadata.creators[0]?.name || [metadata.creators[0]?.firstName, metadata.creators[0]?.lastName].filter(Boolean).join(' '));
  return existing.find((record) => {
    if (doi && cleanId(record.metadata.doi) === doi) return true;
    if (isbns.size && (record.metadata.isbn ?? []).some((value) => isbns.has(cleanId(value)))) return true;
    return title && normalizedTitle(record.metadata.title) === title && record.metadata.year === metadata.year && creatorIdentity(record) === firstCreator;
  }) ?? null;
}

export function importBibliographyFiles(options: {
  files: string[]; collectionId?: string | null; store: LibraryDiskStore; catalog: LibraryCatalog;
}): LibraryBibliographyImportReport {
  const report: LibraryBibliographyImportReport = { created: 0, updated: 0, duplicates: 0, skipped: 0, itemIds: [], warnings: [] };
  const all = options.store.scanMaterializedItems().records;
  // Citation keys stay unique across every record, but only a live record can be the
  // one an entry duplicates: an item in the trash, or the losing side of a merge (kept
  // with deletedAt), would swallow the entry and report an ID nobody can see.
  const records = all.filter((record) => !record.deletedAt);
  const citationKeys = new Set(all.map((record) => record.citationKey).filter((value): value is string => !!value));
  for (const file of options.files) {
    let entries: ParsedBibliographicItem[];
    try { entries = parseBibliographyFile(file); } catch (error) { report.skipped += 1; report.warnings.push(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`); continue; }
    if (!entries.length) { report.skipped += 1; report.warnings.push(`${path.basename(file)} no contenía referencias reconocibles.`); continue; }
    for (const entry of entries) {
      const same = duplicate(records, entry.metadata);
      if (same) {
        report.duplicates += 1; report.itemIds.push(same.id);
        // Importing into a collection files the reference there whether or not the
        // library already held it; otherwise the collection silently lacks it.
        if (options.collectionId && !same.collectionIds.includes(options.collectionId)) {
          const filed = options.store.upsertItem({ ...same, collectionIds: [...same.collectionIds, options.collectionId] }, same.clock.revision);
          records[records.indexOf(same)] = filed;
          report.updated += 1;
        }
        continue;
      }
      const uuid = randomUUID(); const id = `nodus:${uuid}`;
      const citationKey = generateCitationKey(entry.metadata, citationKeys, entry.citationKey); citationKeys.add(citationKey);
      const created = options.store.upsertItem({
        id, storageId: id, source: entry.source, citationKey,
        metadata: entry.metadata, collectionIds: options.collectionId ? [options.collectionId] : [], attachments: [],
        files: { annotations: 'annotations.json' }, extraction: { status: 'unsupported', error: 'Referencia sin archivo adjunto.' }, deletedAt: null,
      });
      records.push(created); report.created += 1; report.itemIds.push(created.id);
    }
  }
  if (report.created || report.updated) options.catalog.rebuild(options.store);
  return report;
}
