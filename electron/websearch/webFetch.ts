import {decodeWebText} from '@shared/webTextDecoding';
import { fetchPublicResource } from '../network/publicDownload';
import { researchWebFixture } from '../qa/researchWebFixture';
import { fetchScholarlyRecord, scholarlyRoute, type ScholarlyRecord } from './scholarlySources';

export type WebFetchFailure = 'blocked' | 'timeout' | 'too_large' | 'unsupported' | 'not_found' | 'failed' | 'cancelled';
export interface FetchedWebPage {
  url: string; finalUrl: string; kind: 'html' | 'text' | 'pdf'; body: string | Uint8Array; contentType: string;
  /** Set when the text came from the service's open API instead of the page. */
  record?: ScholarlyRecord;
}
export class WebFetchError extends Error {
  constructor(readonly reason: WebFetchFailure, message: string = reason) { super(message); }
}

export const WEB_PAGE_LIMITS = { htmlBytes: 3 * 1024 * 1024, pdfBytes: 12 * 1024 * 1024, timeoutMs: 9000 };
// A browser-shaped identity that still names Nodus. It is a plain declaration,
// not a disguise: pages that answer with a bot check are reported as blocked.
const USER_AGENT = 'Mozilla/5.0 (compatible; Nodus Research/5.6; +https://github.com/jorgepb96/nodus) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36';

async function readBounded(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    if (signal.aborted) throw new WebFetchError('cancelled');
    total += chunk.byteLength;
    if (total > maxBytes) { await response.body.cancel().catch(() => {}); throw new WebFetchError('too_large'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const decode = decodeWebText;

/** One bounded public GET. Private and loopback targets are refused at every
 * redirect (the shared public-download guard pins DNS), sizes are capped while
 * streaming, and only HTML, plain text and PDF are accepted. */
/** PubMed and Europe PMC records always come from their APIs (their pages answer
 * automated requests with a browser check); other pages are read directly and only
 * fall back to OpenAlex, by DOI, when the page itself refuses or fails. */
export async function fetchWebPage(url: string, signal: AbortSignal, limits = WEB_PAGE_LIMITS, language = 'es,en;q=0.8'): Promise<FetchedWebPage> {
  const route = scholarlyRoute(url);
  if (route && route.kind !== 'doi') {
    const record = await fetchScholarlyFallback(url, signal);
    if (record) return record;
  }
  try { return await fetchPage(url, signal, limits, language); }
  catch (error) {
    if (!(error instanceof WebFetchError) || error.reason === 'cancelled' || error.reason === 'too_large' || error.reason === 'unsupported' || route?.kind !== 'doi') throw error;
    const record = await fetchScholarlyFallback(url, signal);
    if (record) return record;
    throw error;
  }
}

/** The open-API record for a scholarly URL, or null when there is none. */
export async function fetchScholarlyFallback(url: string, signal: AbortSignal): Promise<FetchedWebPage | null> {
  const route = scholarlyRoute(url);
  if (!route || researchWebFixture()) return null;
  try {
    const record = await fetchScholarlyRecord(route, async (api, accept) => {
      const result = await fetchPublicResource(api, { accept, headers: { 'User-Agent': USER_AGENT }, maxBytes: 4 * 1024 * 1024, timeoutMs: 8000, signal });
      return decode(await readBounded(result.response, 4 * 1024 * 1024, signal), result.response.headers.get('content-type') ?? '');
    });
    return record ? { url, finalUrl: url, kind: 'text', body: record.abstract, contentType: 'text/plain', record } : null;
  } catch { return null; }
}

/** The languages Nodus answers in, keyed by both spellings the two URL forms use:
 * ELI paths carry the three-letter code (`…/oj/spa`) and `legal-content` the
 * two-letter one (`/legal-content/ES/TXT`). */
const EU_LANGUAGES: Record<string, string> = {
  es: 'spa', spa: 'spa', en: 'eng', eng: 'eng', fr: 'fra', fra: 'fra', de: 'deu', deu: 'deu', pt: 'por', por: 'por', it: 'ita', ita: 'ita',
  tr: 'tur', tur: 'tur', ru: 'rus', rus: 'rus', uk: 'ukr', ukr: 'ukr', ja: 'jpn', jpn: 'jpn', ko: 'kor', kor: 'kor', vi: 'vie', vie: 'vie', zh: 'zho', zho: 'zho',
};
/** ELI document types, as their CELEX sector letters. */
const EU_ACT_SECTORS: Record<string, string> = { reg: 'R', dir: 'L', dec: 'D' };

/** The Publications Office copy of an EU legal act, or null for anything else.
 *
 * EUR-Lex renders its pages client-side: a reader gets an empty document and the
 * web step ends up citing a reprint of the regulation somewhere else. The same act
 * is one request away from the Publications Office, which serves it as a document
 * once it is asked for the right content type and language. The ELI path carries
 * everything the CELEX identifier needs (`/eli/reg/2024/1689/oj/eng` → `32024R1689`),
 * and the `?uri=CELEX:…` form carries it directly. */
export function publicationsOfficeTarget(raw: string): { url: string; language: string } | null {
  let source: URL;
  try { source = new URL(raw); } catch { return null; }
  if (!/(^|\.)(eur-lex\.europa\.eu|publications\.europa\.eu)$/i.test(source.hostname)) return null;
  const fromQuery = /[?&]uri=celex[:%3a]*([0-9]{5}[a-z]{1,2}[0-9]+)/i.exec(source.search)?.[1];
  const fromEli = /^\/eli\/(reg|dir|dec)\/(\d{4})\/(\d+)\//i.exec(source.pathname);
  const celex = fromQuery ? fromQuery.toUpperCase() : fromEli ? `3${fromEli[2]}${EU_ACT_SECTORS[fromEli[1].toLowerCase()]}${fromEli[3]}` : null;
  if (!celex) return null;
  // The language is the last three-letter segment of an ELI path (`…/oj/spa`), or
  // the two-letter one right after `legal-content` (`/legal-content/ES/TXT`).
  const segments = source.pathname.split('/').filter(Boolean);
  const declared = (/^legal-content\/([a-z]{2})(\/|$)/i.exec(segments.join('/'))?.[1]
    ?? [...segments].reverse().find(segment => /^[a-z]{3}$/i.test(segment)) ?? '').toLowerCase();
  return { url: `http://publications.europa.eu/resource/celex/${celex}`, language: EU_LANGUAGES[declared] ?? EU_LANGUAGES[declared.slice(0, 2)] ?? 'eng' };
}

async function fetchPage(url: string, signal: AbortSignal, limits: typeof WEB_PAGE_LIMITS, language: string): Promise<FetchedWebPage> {
  const fixture = researchWebFixture();
  const timeout = AbortSignal.timeout(limits.timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);
  const official = publicationsOfficeTarget(url);
  let result;
  try {
    result = await fetchPublicResource(official?.url ?? url, {
      accept: official ? 'application/xhtml+xml' : 'text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.1',
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': official ? official.language : language },
      maxBytes: limits.pdfBytes, timeoutMs: limits.timeoutMs, signal: combined,
      ...(fixture ? { fetcher: fetch, assertPublic: async (raw: string) => {
        const target = new URL(raw);
        if (target.origin !== fixture.origin) throw new WebFetchError('failed', 'Only the fixture origin is reachable in an isolated profile.');
        return target;
      } } : {}),
    });
  } catch (error) {
    if (signal.aborted) throw new WebFetchError('cancelled');
    if (timeout.aborted) throw new WebFetchError('timeout');
    if (error instanceof WebFetchError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const status = Number(/returned (\d{3})/.exec(message)?.[1] ?? 0);
    throw new WebFetchError(status === 401 || status === 403 || status === 429 || status === 451 ? 'blocked' : status === 404 || status === 410 ? 'not_found' : /larger than/.test(message) ? 'too_large' : 'failed', message.slice(0, 200));
  }
  // An official copy is cited by the address the reader recognises, not by the API.
  const finalUrl = official ? url : result.finalUrl;
  const contentType = (result.response.headers.get('content-type') ?? '').toLowerCase();
  try {
    const isPdf = contentType.includes('application/pdf') || /\.pdf($|\?)/i.test(new URL(finalUrl).pathname);
    const isHtml = /text\/html|application\/xhtml|application\/xml|text\/xml/.test(contentType) || (!contentType && !isPdf);
    if (!isPdf && !isHtml && !contentType.startsWith('text/plain')) { await result.response.body?.cancel().catch(() => {}); throw new WebFetchError('unsupported'); }
    const bytes = await readBounded(result.response, isPdf ? limits.pdfBytes : limits.htmlBytes, combined);
    if (isPdf || Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-') return { url, finalUrl, kind: 'pdf', body: bytes, contentType };
    return { url, finalUrl, kind: contentType.startsWith('text/plain') ? 'text' : 'html', body: decode(bytes, contentType), contentType };
  } catch (error) {
    if (error instanceof WebFetchError) throw error;
    if (signal.aborted) throw new WebFetchError('cancelled');
    if (timeout.aborted) throw new WebFetchError('timeout');
    throw new WebFetchError('failed');
  }
}
