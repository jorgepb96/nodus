import { createHash } from "node:crypto";
import type {
  CompassFilters,
  CompassIdentifier,
  CompassPublicationType,
  CompassQueryPlan,
} from "@shared/compass";
import {
  conceptsInCompassQuery,
  detectCompassLanguage,
  normalizeCompassTerm,
} from "./compassVocabulary";
import { probableCompassAuthorName } from "./authorNames";

const LANGUAGES: Record<string, string> = {
  english: "en",
  inglés: "en",
  anglais: "en",
  french: "fr",
  francés: "fr",
  français: "fr",
  german: "de",
  alemán: "de",
  deutsch: "de",
  spanish: "es",
  español: "es",
  castellano: "es",
  catalan: "ca",
  català: "ca",
  portuguese: "pt",
  portugués: "pt",
  português: "pt",
  italian: "it",
  italiano: "it",
};
const TYPE_MAP: Record<string, CompassPublicationType> = {
  article: "article",
  articles: "article",
  artículo: "article",
  artículos: "article",
  book: "book",
  books: "book",
  libro: "book",
  libros: "book",
  livre: "book",
  chapter: "chapter",
  chapters: "chapter",
  capítulo: "chapter",
  thesis: "thesis",
  theses: "thesis",
  tesis: "thesis",
  dissertation: "thesis",
  report: "report",
  reports: "report",
  informe: "report",
  dataset: "dataset",
  datasets: "dataset",
  preprint: "preprint",
  preprints: "preprint",
  fotografía: "photograph",
  fotografias: "photograph",
  photograph: "photograph",
  photographs: "photograph",
  photographie: "photograph",
  newspaper: "newspaper",
  prensa: "newspaper",
  journal: "newspaper",
  map: "map",
  mapa: "map",
  carte: "map",
  manuscript: "manuscript",
  manuscrito: "manuscript",
  audio: "audio",
  video: "video",
  archive: "archive-item",
  archivo: "archive-item",
};
const PUBLICATION_CUE =
  /\b(?:publicad[oa]s?|publicaci[oó]n|published|publication|publi[eé]s?|depuis|desde|since|after|antes|before|entre|between|from|hasta|until|von|zwischen|pubblicat[oa]|pubblicazione)\b/i;
const clean = (value: unknown, max = 2_000) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const unique = (values: string[], max = 120) => [
  ...new Set(
    values
      .map((value) => clean(value, max).toLocaleLowerCase())
      .filter(Boolean),
  ),
];
const quote = (value: string) => `"${value.replaceAll('"', "")}"`;

function quoted(query: string): string[] {
  return [...query.matchAll(/"([^"\n]{2,200})"|'([^'\n]{2,200})'/g)]
    .map((match) => match[1] || match[2])
    .filter(Boolean);
}
function publicationYears(query: string): {
  fromYear?: number;
  toYear?: number;
} {
  if (!PUBLICATION_CUE.test(query)) return {};
  const range = query.match(
    /\b(1[0-9]{3}|20\d{2})\s*(?:-|–|—|to|a|y|e|and|et|hasta|until|au|bis|und)\s*(1[0-9]{3}|20\d{2})\b/i,
  );
  if (range) return { fromYear: Number(range[1]), toYear: Number(range[2]) };
  const since = query.match(
    /\b(?:since|desde|after|después de|depuis|ab|dopo)\s+(1[0-9]{3}|20\d{2})\b/i,
  );
  if (since) return { fromYear: Number(since[1]) };
  const before = query.match(
    /\b(?:before|antes de|hasta|until|avant|vor)\s+(1[0-9]{3}|20\d{2})\b/i,
  );
  if (before) return { toYear: Number(before[1]) };
  const only = query.match(/\b(1[0-9]{3}|20\d{2})\b/);
  return only ? { fromYear: Number(only[1]), toYear: Number(only[1]) } : {};
}
function identifiers(query: string): CompassIdentifier[] {
  const out: CompassIdentifier[] = [];
  for (const match of query.matchAll(/\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/gi))
    out.push({ scheme: "doi", value: match[1].replace(/[.,;]+$/, "") });
  for (const match of query.matchAll(
    /\b(?:ISBN(?:-1[03])?[:\s]*)?((?:97[89][ -]?)?\d[\d -]{8,16}[\dX])\b/gi,
  )) {
    const value = match[1].replace(/[ -]/g, "").toUpperCase();
    if (value.length === 10 || value.length === 13)
      out.push({ scheme: "isbn", value });
  }
  for (const [scheme, expression] of [
    ["orcid", /\b(?:ORCID[:\s]*)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\b/gi],
    ["pmid", /\bPMID[:\s]*(\d{5,10})\b/gi],
    ["pmcid", /\b(PMC\d{4,12})\b/gi],
    ["arxiv", /\b(?:arXiv:)?(\d{4}\.\d{4,5}(?:v\d+)?)\b/gi],
    ["issn", /\b(?:ISSN[:\s]*)?(\d{4}-\d{3}[\dX])\b/gi],
  ] as const)
    for (const match of query.matchAll(expression))
      out.push({ scheme, value: match[1] });
  const orcids = out
    .filter((entry) => entry.scheme === "orcid")
    .map((entry) => entry.value);
  return out.filter(
    (entry, index, all) =>
      !(
        entry.scheme === "issn" &&
        orcids.some((orcid) => orcid.includes(entry.value))
      ) &&
      all.findIndex(
        (other) =>
          other.scheme === entry.scheme &&
          other.value.toLocaleLowerCase() === entry.value.toLocaleLowerCase(),
      ) === index,
  );
}
function expressions(
  text: string,
  exact: string[],
  excluded: string[],
  concepts: string[][],
) {
  const quotedText = exact.map(quote);
  const exclusions = excluded.map((term) => `-${quote(term)}`);
  const conceptTerms = concepts.map(
    (group) => `(${group.slice(0, 5).map(quote).join(" OR ")})`,
  );
  const plain = text
    .replace(/(?:^|\s)-[\p{L}\d][\p{L}\d-]*/gu, " ")
    .replace(/["']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const balanced = [
    ...quotedText,
    ...(conceptTerms.length ? conceptTerms : [plain]),
    ...exclusions,
  ]
    .filter(Boolean)
    .join(" ");
  // Strict needs at least one positive term. With no quotes and no concept match it used to
  // be the exclusions alone ("spanish civil war -novel" became just -"novel"), a query of
  // only a negative term; the plain words are the positive part then.
  const positives = [...quotedText, ...conceptTerms].filter(Boolean);
  const strict =
    [...(positives.length ? positives : [plain]), ...exclusions]
      .filter(Boolean)
      .join(" AND ") || plain;
  const semantic = [...exact, ...concepts.map((group) => group[0]), plain]
    .filter(Boolean)
    .join(" · ");
  const heads = concepts.map((group) => group.slice(0, 3).join(" OR "));
  const conceptPairs: string[] = [];
  for (let left = 0; left < heads.length; left += 1)
    for (let right = left + 1; right < heads.length; right += 1)
      conceptPairs.push(`(${heads[left]}) (${heads[right]})`);
  return {
    strict,
    balanced: balanced || plain,
    semantic,
    conceptPairs: conceptPairs.slice(0, 8),
  };
}

export function interpretCompassQuery(
  input: string,
  filters: CompassFilters = {},
): CompassQueryPlan {
  const source = clean(input);
  const exactPhrases = quoted(source);
  const excludedTerms = unique(
    [...source.matchAll(/(?:^|\s)-([\p{L}\d][\p{L}\d-]*)/gu)].map(
      (match) => match[1],
    ),
  );
  const explicitAuthors = unique(
    [
      ...source.matchAll(
        /(?:author|autor|autora|auteur|by|por):\s*(?:"([^"]+)"|([^,;]+?))(?=\s+(?:type|tipo|language|lang|idioma|langue|venue|journal|revista|publication|publicación):|[,;]|$)/gi,
      ),
    ].map((match) => (match[1] || match[2]).trim()),
    300,
  );
  const bareAuthor = explicitAuthors.length
    ? null
    : probableCompassAuthorName(source);
  const authors = bareAuthor ? unique([bareAuthor], 300) : explicitAuthors;
  const venues = unique(
    [
      ...source.matchAll(
        /(?:venue|journal|revista|publication|publicación):\s*("[^"]+"|[^,;]+)/gi,
      ),
    ].map((match) => match[1].replaceAll('"', "").trim()),
    300,
  );
  const explicitLanguages = [
    ...source
      .toLocaleLowerCase()
      .matchAll(/(?:language|lang|idioma|langue):?\s*([\p{L}-]+)/gu),
  ].map((match) => LANGUAGES[match[1]] || match[1]);
  const detectedLanguage = detectCompassLanguage(source);
  const types: CompassPublicationType[] = [];
  for (const word of source.toLocaleLowerCase().split(/[^\p{L}]+/u))
    if (TYPE_MAP[word]) types.push(TYPE_MAP[word]);
  const concepts = conceptsInCompassQuery(source);
  const range = publicationYears(source);
  const lane =
    filters.lane ??
    (types.some((type) =>
      [
        "photograph",
        "newspaper",
        "map",
        "manuscript",
        "audio",
        "video",
        "archive-item",
      ].includes(type),
    ) ||
    /\b(?:fuente primaria|primary source|archivo|archive|fotograf|photograph|prensa|newspaper|mapa|map|manuscri|audio|video)\b/i.test(
      source,
    )
      ? "primary"
      : "scholarly");
  const languages = unique(
    [
      ...(filters.languages ?? []),
      ...explicitLanguages,
      ...(explicitLanguages.length
        ? []
        : detectedLanguage
          ? [detectedLanguage]
          : []),
    ],
    20,
  );
  const mergedTypes = [...new Set([...(filters.types ?? []), ...types])];
  const plan: CompassQueryPlan = {
    text: source,
    detectedLanguage,
    exactPhrases,
    excludedTerms,
    authors,
    venues,
    identifiers: identifiers(source),
    fromYear: filters.fromYear ?? range.fromYear,
    toYear: filters.toYear ?? range.toYear,
    languages,
    types: mergedTypes,
    disciplines: unique(filters.disciplines ?? [], 120),
    concepts,
    expressions: expressions(source, exactPhrases, excludedTerms, concepts),
    openAccessOnly:
      filters.openAccessOnly === true ||
      /\b(?:open\s+access|oa|acceso\s+abierto|accès\s+ouvert|acesso\s+aberto)\b/i.test(
        source,
      ),
    providers: filters.providers ?? [],
    lane,
  };
  return plan;
}

export function compassQueryFingerprint(
  plan: CompassQueryPlan,
  filters: CompassFilters = {},
): string {
  return createHash("sha256")
    .update(JSON.stringify({ plan, filters }))
    .digest("hex");
}

export function normalizedCompassConcept(value: string): string {
  return normalizeCompassTerm(value);
}
