import { createHash } from "node:crypto";
import type {
  CompassAuthor,
  CompassDownloadLink,
  CompassIdentifier,
  CompassLane,
  CompassProviderAdapter,
  CompassProviderContext,
  CompassProviderDescriptor,
  CompassProviderId,
  CompassProviderPage,
  CompassPublicationType,
  CompassResult,
} from "@shared/compass";

export const USER_AGENT =
  "Nodus Compass/2.0 (+https://nodus.app/compass; anonymous public-client)";
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_XML_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export class CompassProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      "http" | "offline" | "invalid-response" | "too-large" | "rate-limit",
    readonly status?: number,
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = "CompassProviderError";
  }
}
export class CompassProviderHttpError extends CompassProviderError {
  constructor(message: string, status: number, retryAt?: number) {
    super(message, status === 429 ? "rate-limit" : "http", status, retryAt);
    this.name = "CompassProviderHttpError";
  }
}
export const text = (value: unknown, max = 4_000): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
export function identifier(
  scheme: string,
  value: unknown,
): CompassIdentifier | null {
  const normalized = normalizeIdentifier(scheme, text(value, 300));
  return normalized
    ? { scheme: scheme.toLocaleLowerCase(), value: normalized }
    : null;
}
export function author(value: unknown): CompassAuthor | null {
  if (typeof value === "string")
    return text(value, 300) ? { name: text(value, 300) } : null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const given = text(record.given ?? record.firstName, 120) || undefined;
  const family = text(record.family ?? record.lastName, 120) || undefined;
  const name = text(
    record.name ??
      record.display_name ??
      record.fullName ??
      [given, family].filter(Boolean).join(" "),
    300,
  );
  return name
    ? {
        name,
        given,
        family,
        orcid:
          normalizeIdentifier("orcid", text(record.orcid ?? record.ORCID, 120)) ||
          undefined,
      }
    : null;
}
function isbn13From10(value: string): string | undefined {
  if (!/^\d{9}[\dX]$/.test(value)) return undefined;
  const base = `978${value.slice(0, 9)}`;
  let total = 0;
  for (let index = 0; index < 12; index += 1)
    total += Number(base[index]) * (index % 2 ? 3 : 1);
  return `${base}${(10 - (total % 10)) % 10}`;
}
export function normalizeIdentifier(scheme: string, raw: string): string {
  const key = scheme.toLocaleLowerCase();
  let value = raw.trim();
  if (key === "doi")
    value = value
      .replace(/^doi:\s*/i, "")
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
      .replace(/[.,;]+$/, "")
      .toLocaleLowerCase();
  if (key === "isbn") {
    value = value.replace(/[^\dX]/gi, "").toUpperCase();
    value = isbn13From10(value) ?? value;
  }
  if (key === "issn") value = value.replace(/[^\dX]/gi, "").toUpperCase();
  if (key === "pmid") value = value.replace(/^pmid:\s*/i, "");
  if (key === "pmcid") value = value.replace(/^pmcid:\s*/i, "").toUpperCase();
  if (key === "arxiv")
    value = value
      .replace(/^arxiv:\s*/i, "")
      .replace(/v\d+$/i, "")
      .toLocaleLowerCase();
  if (key === "orcid")
    value = value
      .replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, "")
      .replace(/^orcid:\s*/i, "")
      .toUpperCase();
  return text(value, 300);
}
export function canonicalKey(
  ids: CompassIdentifier[],
  title: string,
  firstAuthor = "",
  year?: number,
  provider?: CompassProviderId,
  providerId?: string,
): string {
  // ISSN identifies a serial, not an individual work. It remains in metadata,
  // but must never merge every article from the same publication.
  const strength = ["doi", "isbn", "pmid", "pmcid", "arxiv"];
  const preferred = strength
    .map((scheme) =>
      ids.find((entry) => entry.scheme.toLocaleLowerCase() === scheme),
    )
    .find(Boolean);
  const normalizeText = (value: string) =>
    value
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const raw = preferred
    ? `${preferred.scheme.toLocaleLowerCase()}:${normalizeIdentifier(preferred.scheme, preferred.value)}`
    : provider && providerId
      ? `${provider}:${text(providerId, 500).toLocaleLowerCase()}`
      : `${normalizeText(title)}|${normalizeText(firstAuthor)}|${year ?? ""}`;
  return `compass:${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
}
export function downloadLink(
  provider: CompassProviderId,
  url: unknown,
  options: Partial<
    Omit<CompassDownloadLink, "provider" | "url" | "open" | "verifiedAt">
  > & { open?: boolean } = {},
): CompassDownloadLink | null {
  const value = text(url, 2_000);
  if (!/^https:\/\//i.test(value)) return null;
  return {
    provider,
    url: value,
    open: options.open !== false,
    verifiedAt: new Date().toISOString(),
    mediaType: options.mediaType,
    format: options.format,
    license: options.license,
    rights: options.rights,
  };
}
export function result(input: {
  provider: CompassProviderId;
  providerId: string;
  title: string;
  authors?: CompassAuthor[];
  year?: number;
  issuedDate?: string;
  type?: CompassPublicationType;
  lane?: CompassLane;
  abstract?: string;
  url?: string;
  doi?: string;
  ids?: CompassIdentifier[];
  language?: string;
  venue?: string;
  citationCount?: number;
  nativeScore?: number;
  rights?: string;
  downloads?: CompassDownloadLink[];
}): CompassResult {
  const safeLandingUrl = (() => {
    const value = text(input.url, 2_000);
    if (!value) return undefined;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:"
        ? parsed.toString()
        : undefined;
    } catch {
      return undefined;
    }
  })();
  const ids = [
    ...(input.ids ?? []),
    ...(input.doi
      ? [{ scheme: "doi", value: normalizeIdentifier("doi", input.doi) }]
      : []),
  ]
    .filter((entry) => entry.value)
    .filter(
      (entry, index, all) =>
        all.findIndex(
          (other) =>
            other.scheme.toLocaleLowerCase() ===
              entry.scheme.toLocaleLowerCase() &&
            normalizeIdentifier(other.scheme, other.value) ===
              normalizeIdentifier(entry.scheme, entry.value),
        ) === index,
    );
  const authors = input.authors ?? [];
  const downloads = (input.downloads ?? []).filter(
    (entry, index, all) =>
      all.findIndex((other) => other.url === entry.url) === index,
  );
  return {
    canonicalKey: canonicalKey(
      ids,
      input.title,
      authors[0]?.name,
      input.year,
      input.provider,
      input.providerId,
    ),
    title: text(input.title, 1_000) || "Untitled work",
    abstract: text(input.abstract, 12_000) || undefined,
    authors,
    issuedDate: text(input.issuedDate, 40) || undefined,
    issuedYear: input.year,
    language: text(input.language, 30) || undefined,
    type: input.type ?? "other",
    lane: input.lane ?? "scholarly",
    disciplines: [],
    topics: [],
    venue: text(input.venue, 400) || undefined,
    identifiers: ids,
    landingUrl: safeLandingUrl,
    doiUrl: input.doi
      ? `https://doi.org/${normalizeIdentifier("doi", input.doi)}`
      : undefined,
    rights: text(input.rights, 1_000) || undefined,
    digitallyAvailable: downloads.length > 0,
    downloadLinks: downloads,
    citationCount: input.citationCount,
    provenance: [
      {
        provider: input.provider,
        providerId: text(input.providerId, 500),
        retrievedAt: new Date().toISOString(),
        sourceUrl: safeLandingUrl,
      },
    ],
    providerRanks: {},
    nativeScore: input.nativeScore,
    lexicalScore: 0,
    finalScore: 0,
    reasons: [],
  };
}
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
async function backoff(
  signal: AbortSignal,
  attempt: number,
  retryAfter?: number,
): Promise<void> {
  const delay = Math.min(
    30_000,
    retryAfter ?? 250 * 2 ** attempt + Math.floor(Math.random() * 251),
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
async function responseBody(
  url: string,
  signal: AbortSignal,
  accept: string,
  maxBytes: number,
  init: RequestInit = {},
): Promise<{ body: string; response: Response }> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const attemptSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ]);
      const response = await fetch(url, {
        ...init,
        signal: attemptSignal,
        redirect: "follow",
        headers: {
          Accept: accept,
          "User-Agent": USER_AGENT,
          ...(init.headers ?? {}),
        },
      });
      const retryMs = retryAfterMs(response);
      const retryAt = retryMs == null ? undefined : Date.now() + retryMs;
      if (!response.ok) {
        const failure = new CompassProviderHttpError(
          `Provider HTTP ${response.status}`,
          response.status,
          retryAt,
        );
        if (!RETRYABLE.has(response.status) || attempt === 2) throw failure;
        await backoff(signal, attempt, retryMs);
        continue;
      }
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > maxBytes)
        throw new CompassProviderError(
          "Provider response exceeds the Compass size limit.",
          "too-large",
        );
      const body = await response.text();
      if (Buffer.byteLength(body) > maxBytes)
        throw new CompassProviderError(
          "Provider response exceeds the Compass size limit.",
          "too-large",
        );
      return { body, response };
    } catch (error) {
      if (signal.aborted) throw error;
      last = error;
      if (error instanceof CompassProviderError || attempt === 2) throw error;
      if (attempt < 2) await backoff(signal, attempt);
    }
  }
  throw last instanceof Error
    ? last
    : new CompassProviderError("Provider request failed.", "offline");
}
export async function requestJson(
  url: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<{ data: any; response: Response }> {
  const { body, response } = await responseBody(
    url,
    signal,
    "application/json",
    MAX_JSON_BYTES,
    init,
  );
  try {
    const data = JSON.parse(body);
    if (!data || (typeof data !== "object" && !Array.isArray(data)))
      throw new Error();
    return { data, response };
  } catch {
    throw new CompassProviderError(
      "Provider returned invalid JSON.",
      "invalid-response",
    );
  }
}
export async function requestText(
  url: string,
  signal: AbortSignal,
  init: RequestInit = {},
): Promise<{ data: string; response: Response }> {
  const { body, response } = await responseBody(
    url,
    signal,
    "application/xml,text/xml,application/atom+xml,text/plain;q=0.8",
    MAX_XML_BYTES,
    init,
  );
  if (!body.trim().startsWith("<"))
    throw new CompassProviderError(
      "Provider returned invalid XML.",
      "invalid-response",
    );
  return { data: body, response };
}
export function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Numeric references (&#241; &#x2013;) are how most XML feeds escape non-ASCII titles.
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (whole, hex: string | undefined, dec: string | undefined) => {
      const code = hex ? Number.parseInt(hex, 16) : Number(dec);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    })
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function xmlValues(block: string, localName: string): string[] {
  const expression = new RegExp(
    `<(?:[\\w.-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`,
    "gi",
  );
  return [...block.matchAll(expression)]
    .map((match) => decodeXml(match[1]))
    .filter(Boolean);
}
export function queryFor(context: CompassProviderContext): string {
  if (context.strategy === "concept-pair")
    return (
      context.query.expressions.conceptPairs[0] ??
      context.query.expressions.balanced
    );
  return (
    context.query.expressions[
      context.strategy === "semantic" || context.strategy === "similar"
        ? "semantic"
        : context.strategy === "strict"
          ? "strict"
          : "balanced"
    ] || context.query.text
  );
}
export function page(
  records: CompassResult[],
  provider: CompassProviderId,
  nextCursor?: string,
  attribution?: string,
): CompassProviderPage {
  return {
    provider,
    records: records.slice(0, 25),
    nextCursor,
    hasMore: Boolean(nextCursor),
    attribution,
  };
}
export const adapter = (
  descriptor: CompassProviderDescriptor,
  search: CompassProviderAdapter["search"],
): CompassProviderAdapter => ({ id: descriptor.id, descriptor, search });
