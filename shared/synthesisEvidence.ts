/**
 * Evidence gathered before the model plans a synthesis route: one-step disconnections of the
 * target from the local Open Reaction Database index, and textbook passages retrieved for the
 * target and for the reaction classes those disconnections name. The three sources complement
 * each other: ORD knows what was run (mostly patents), the textbooks know the named reactions and
 * why they work, and the model knows everything else. Nothing here is an instruction; the system
 * rule tells the model to weigh it.
 *
 * Pure helpers only: the application side (electron/ai/synthesisEvidence.ts) runs the tool and
 * the retrieval.
 */

import type { TextbookPreparation } from './textbookSchemes';
import { conditionsPlainText, normalizeReactionConditions } from './reactionConditions';
import { auditNote, normalizeAuditFlags, recordLabel, RECORD_ID } from './recordAudit';

/** The payload key the evidence travels under, next to `estructura_objetivo_verificada`. */
export const SYNTHESIS_EVIDENCE_KEY = 'evidencia_para_la_ruta';

export const SYNTHESIS_EVIDENCE_SYSTEM_RULE = [
  `Route evidence: the \`${SYNTHESIS_EVIDENCE_KEY}\` field was assembled by the application before you answered. It holds one-step disconnections of the requested target proposed from the Open Reaction Database (with how often each was recorded and its reaction class) and textbook passages retrieved for the target and those reaction classes.`,
  'It is evidence to weigh, not an instruction and not the answer: the disconnections are machine-generated from patent records and can be wrong or unsuited to the requested starting materials, and a passage may describe a different substrate.',
  'Prefer a disconnection that is recorded or that a textbook passage supports when it fits the requested starting materials; otherwise use your own knowledge. When you rely on a passage, cite it with its `nodus://passage/…` link.',
  'Passage text has had reaction schemes (marked [scheme]) and literature references (marked [ref]) cut out; a passage marked `scanned` was read from a scanned book by OCR and may contain recognition errors in names and formulas.',
  'When present, `textbook_preparations` lists reactions read from the scheme drawings in the user\'s own textbooks that make the target or one of its precursors, each structure checked against its name, and `disconnections` proposed by reaction templates extracted from those schemes ("worked example": a real compound in the book; "general scheme": drawn with R groups); cite the book and page given when you rely on one.',
  'When present, `target_availability` says the target itself is on the user\'s vendor stock lists (or in another stereo or isotope form): say so at the start of the answer, then give the route if one was asked for.',
  'When present, `candidate_routes` are complete routes the application searched backwards from the target over the recorded reactions and reaction templates (each step marked recorded or template, with its source); they are machine-searched candidates to check and use if sound — chemistry, selectivity and the requested starting materials — not answers to copy.',
].join(' ');

/** Titles of works that teach synthetic organic chemistry. */
const SYNTHESIS_TEXTBOOK_TITLE = /\b(?:organic\s+chemistry|organic\s+synthesis|synthetic\s+(?:organic|sequences|methods)|reactions?\s+and\s+synthesis|name[d]?\s+reactions|heterocyclic\s+chemistry|medicinal\s+chemistry|reaction\s+mechanisms?)\b/i;

/** Whether a work belongs in the textbook scope for route evidence: its title reads as a
 *  synthetic-chemistry text or it is filed under a chemistry collection. */
export function isSynthesisEvidenceWork(title: string, collections: readonly string[] = []): boolean {
  if (!title) return false;
  return SYNTHESIS_TEXTBOOK_TITLE.test(title) || collections.some((name) => /^chemistry$/i.test(name.trim()));
}

// A SMILES in parentheses or backticks — "phenol (Oc1ccccc1)", "benzene (`c1ccccc1`)" — or after
// "SMILES:". Each candidate is checked by RDKit later; a word that happens to match is dropped then.
const PAREN_SMILES = /(?:\(\s*(?:SMILES\s*[:=]\s*)?|`|\bSMILES\s*[:=]\s*`?)([A-Za-z0-9@+\-=\\#()[\]/.%]{1,400}?)\s*(?:`|\)(?=[\s,.;:]|$)|[,;](?=\s)|$)/g;
const SMILES_TOKEN = /^(?=.*[A-Za-z])[A-Za-z0-9@+\-=\\#()[\]/.%]+$/;
const START_CLAUSE = /\b(?:starting\s+(?:from|with)|from|using)\b([\s\S]*)$/i;
// Words a parenthesis may hold that are not structures ("(aspirin, SMILES: …)", "(1 equiv)").
const NOT_SMILES = /^(?:[a-z]{4,}|\d+|[Ee]quiv|[Ee]xcess|cat|aq|s|l|g)$/;

function smilesIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(PAREN_SMILES)) {
    let value = match[1].trim().replace(/[.,;]+$/, '');
    const unbalanced = () => (value.match(/\)/g) ?? []).length > (value.match(/\(/g) ?? []).length;
    while (value.endsWith(')') && unbalanced()) value = value.slice(0, -1);
    if (!value || !SMILES_TOKEN.test(value) || NOT_SMILES.test(value)) continue;
    // A lowercase word longer than an aromatic ring label is prose, not a structure.
    if (/^[a-z]{5,}$/.test(value) && !/^c1/.test(value)) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/** The starting materials the request names with a structure: every SMILES after "starting
 *  from/with", "from" or "using", except the target itself. At most sixteen. */
/**
 * Per-phase timings for one gather, printed as a single line the way `[routeReport]` already does.
 *
 *  Without this the whole evidence phase was one opaque number: measured at ~394s per turn, 43%
 *  of a 31-minute round, against a model that was only 39% — and nothing said which phase inside
 *  it was slow, so any tuning would have been guesswork. `[routeReport]` decomposes itself and
 *  that is precisely why it was diagnosable in one pass.
 *
 *  Timing starts when the work STARTS, not when it is awaited, because two of the phases are
 *  launched early and awaited last; measuring at the await would report the sliver left by then
 *  and make a slow parallel phase look instant. A phase that FAILS is still recorded: how long
 *  something took before giving up is exactly what you want to know. `now` is injectable so the
 *  behaviour can be tested without real time.
 */
export function evidencePhases(now: () => number = Date.now) {
  const recorded: string[] = [];
  return {
    track<T>(label: string, work: Promise<T>): Promise<T> {
      const started = now();
      return work.finally(() => { recorded.push(`${label} ${((now() - started) / 1000).toFixed(1)}s`); });
    },
    /** Settle order, which is itself informative: it shows what was still running when. */
    line(): string { return recorded.join(' · '); },
  };
}

export function findStartingSmiles(text: string, target?: string | null): string[] {
  const clause = START_CLAUSE.exec(text);
  if (!clause) return [];
  return smilesIn(clause[1]).filter((value) => value !== target).slice(0, 16);
}

/** The target's name as written before its SMILES ("a synthesis of 3-bromoaniline (SMILES: …)"),
 *  for the textbook query. Null when the request gives no name. */
export function findTargetName(text: string): string | null {
  // The parenthesis before SMILES may hold a synonym with its own parentheses:
  // "ibuprofen (2-(4-isobutylphenyl)propanoic acid, SMILES: …)".
  const match = /\b(?:synthes[a-z]*(?:\s+(?:of|for))?|preparation\s+of|route\s+(?:to|for))\s+([\s\S]{2,160}?)\s*\((?:[^()]|\([^()]*\))*?\bSMILES\s*[:=]/i.exec(text);
  if (!match) return null;
  const name = match[1].replace(/\s+/g, ' ').replace(/^(?:the|a|an)\s+/i, '').trim();
  return name.length >= 2 ? name : null;
}

export interface DisconnectionProposal {
  /** Precursor SMILES, dot-separated. */
  precursors: string;
  /** Reaction-class names, most specific first. */
  classes: string[];
  /** How many ORD records hold exactly this disconnection (0: template only). */
  recorded: number;
  /** Whether every organic precursor is a common ORD reactant. */
  available: boolean;
  /** Whether it is made only from the requested starting materials and routine reagents. */
  fromStarts?: boolean;
  /** Every organic precursor is on one of the user's imported vendor stock lists. */
  purchasable?: boolean;
  /** The stock lists holding them, when purchasable. */
  vendors?: string[];
  /** The retro templates (SMARTS) that proposed it, most common first; kept so an index that
   *  documents its templates (the textbook-scheme index) can cite their sources. Not sent to the
   *  model. */
  templates?: string[];
  /** For a recorded disconnection, what its most recorded sample was run with (one plain line). */
  conditions?: string;
  /** The bond-edit audit's note when this disconnection is a flagged record (see recordAudit). */
  audit?: string;
}

export interface TargetDisconnections {
  /** The molecule as sent; `target` is the package's canonical form of it. */
  input: string;
  target: string;
  /** ORD reactions that make this molecule, most recorded first. */
  /** `conditions`: what the most recorded sample was run with, one plain line (absent without an
   *  index conditions table). */
  recordedRoutes: Array<{ precursors: string; count: number; conditions?: string; audit?: string }>;
  proposals: DisconnectionProposal[];
}

/** The vendors that stock every precursor of a purchasable proposal. */
function stockVendors(inStock: unknown): string[] {
  const lists = Object.values((inStock ?? {}) as Record<string, unknown>).map((vendors) => (Array.isArray(vendors) ? vendors.filter((v): v is string => typeof v === 'string') : []));
  if (!lists.length) return [];
  return lists.reduce((common, vendors) => common.filter((vendor) => vendors.includes(vendor)));
}

const ORD_ID = RECORD_ID;

/** The first well-formed recorded conditions as one plain line, for the model's payload. */
function firstConditions(value: unknown): string | undefined {
  const [first] = normalizeReactionConditions(value, ORD_ID);
  return first ? conditionsPlainText(first) || undefined : undefined;
}

const asNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const asString = (value: unknown) => (typeof value === 'string' ? value : '');

/** Reads the tool's `reaction-disconnections` artifact into the brief the model sees, dropping
 *  what it does not need (template counts, sample ids, per-molecule use counts). */
export function normalizeDisconnections(data: unknown, perTarget = 6): TargetDisconnections[] {
  const entries = (data as { disconnections?: unknown })?.disconnections;
  if (!Array.isArray(entries)) return [];
  const out: TargetDisconnections[] = [];
  for (const raw of entries) {
    const entry = raw as Record<string, unknown> | null;
    const target = asString(entry?.target);
    if (!target) continue;
    const madeBy = (entry?.madeBy as { reactions?: unknown[] } | null)?.reactions;
    const recordedRoutes: TargetDisconnections['recordedRoutes'] = [];
    for (const reaction of Array.isArray(madeBy) ? madeBy : []) {
      const smiles = asString((reaction as Record<string, unknown>)?.reaction);
      const precursors = smiles.split('>>')[0];
      if (!precursors || recordedRoutes.some((route) => route.precursors === precursors)) continue;
      const conditions = firstConditions((reaction as Record<string, unknown>).conditions);
      const audit = auditNote(normalizeAuditFlags((reaction as Record<string, unknown>).auditFlags));
      recordedRoutes.push({ precursors, count: asNumber((reaction as Record<string, unknown>).count), ...(conditions ? { conditions } : {}), ...(audit ? { audit } : {}) });
      if (recordedRoutes.length >= 3) break;
    }
    const proposals: DisconnectionProposal[] = [];
    for (const rawProposal of Array.isArray(entry?.proposals) ? entry.proposals : []) {
      const proposal = rawProposal as Record<string, unknown>;
      const precursors = asString(proposal.precursors);
      if (!precursors) continue;
      proposals.push({
        precursors,
        classes: Array.isArray(proposal.classes) ? proposal.classes.filter((name): name is string => typeof name === 'string').slice(0, 3) : [],
        recorded: asNumber(proposal.recorded),
        available: proposal.available === true,
        ...(typeof proposal.fromStarts === 'boolean' ? { fromStarts: proposal.fromStarts } : {}),
        ...(proposal.purchasable === true ? { purchasable: true, vendors: stockVendors(proposal.inStock) } : {}),
        ...(firstConditions(proposal.conditions) ? { conditions: firstConditions(proposal.conditions) } : {}),
        ...(auditNote(normalizeAuditFlags(proposal.auditFlags)) ? { audit: auditNote(normalizeAuditFlags(proposal.auditFlags)) } : {}),
        ...(Array.isArray(proposal.templates) && proposal.templates.length
          ? { templates: proposal.templates.filter((smarts): smarts is string => typeof smarts === 'string').slice(0, 3) } : {}),
      });
      if (proposals.length >= perTarget) break;
    }
    out.push({ input: asString(entry?.input) || target, target, recordedRoutes, proposals });
  }
  return out;
}

/** The distinct reaction classes the disconnections name, in rank order. */
export function disconnectionClasses(briefs: TargetDisconnections[], max = 4): string[] {
  const classes: string[] = [];
  for (const brief of briefs) {
    for (const proposal of brief.proposals) {
      for (const name of proposal.classes) {
        if (!classes.includes(name)) classes.push(name);
        if (classes.length >= max) return classes;
      }
    }
  }
  return classes;
}

/** The precursors worth a second disconnection: organic ones from the top proposals that are not
 *  starting materials already. Small molecules (six heavy atoms or fewer by a rough count) are
 *  treated as reagents. */
export function secondLevelTargets(briefs: TargetDisconnections[], starting: readonly string[], max = 4): string[] {
  const out: string[] = [];
  const heavy = (smiles: string) => (smiles.replace(/\[[^\]]*\]/g, 'X').match(/Cl|Br|[BCNOPSFIcnops]|X/g) ?? []).length;
  for (const brief of briefs) {
    for (const proposal of brief.proposals.slice(0, 3)) {
      for (const molecule of proposal.precursors.split('.')) {
        if (!molecule || starting.includes(molecule) || out.includes(molecule) || !/[Cc]/.test(molecule) || heavy(molecule) <= 6) continue;
        out.push(molecule);
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

// A textbook indexes a reaction under its textbook name; where the class name the tagger uses is
// descriptive, search for that name instead. A class with no textbook meaning is not searched.
const CLASS_QUERIES: Record<string, string | null> = {
  'enolate alkylation (malonic or acetoacetic ester synthesis)': 'malonic ester synthesis acetoacetic ester synthesis',
  'intramolecular aldol condensation (Robinson annulation)': 'Robinson annulation',
  'amide hydrolysis (deprotection of an acetamide)': 'hydrolysis of amides',
  'diazonium salt substitution (Sandmeyer)': 'Sandmeyer reaction diazonium salts',
  'Kolbe-Schmitt carboxylation of a phenol': 'Kolbe-Schmitt carboxylation phenoxide',
  'nitro group reduction to amine': 'reduction of nitro compounds to arylamines',
  'acylation of an alcohol or phenol': 'acetylation acetic anhydride ester',
  'amide formation by acylation of an amine': 'amides from acid chlorides and amines',
  'rearrangement or isomerization': null,
};

/** Methods a request's own starting materials imply. The ORD disconnections of a target need
 *  not propose the textbook route: for 2-methylbutanoic acid from diethyl malonate they
 *  proposed alkylations and ester hydrolyses but no malonic ester synthesis (the index holds
 *  two records making diethyl methylmalonate), so the textbook search never asked for it. */
const STARTING_MATERIAL_METHODS: Array<{ pattern: RegExp; smiles: string[]; className: string }> = [
  { pattern: /\b(?:diethyl|dimethyl)\s+(?:malonate|propanedioate)\b|\bmalonic ester\b/i, smiles: ['CCOC(=O)CC(=O)OCC', 'COC(=O)CC(=O)OC'], className: 'enolate alkylation (malonic or acetoacetic ester synthesis)' },
  { pattern: /\b(?:ethyl|methyl)\s+(?:acetoacetate|3-oxobutanoate)\b|\bacetoacetic ester\b/i, smiles: ['CCOC(=O)CC(C)=O', 'COC(=O)CC(C)=O'], className: 'enolate alkylation (malonic or acetoacetic ester synthesis)' },
  { pattern: /\bbut-3-en-2-one\b|\bmethyl vinyl ketone\b/i, smiles: ['C=CC(C)=O', 'CC(=O)C=C'], className: 'intramolecular aldol condensation (Robinson annulation)' },
];

export function requestMethodClasses(question: string): string[] {
  // SMILES as written in the request: whitespace-separated, without a sentence's full stop or the
  // parentheses a SMILES is often wrapped in ("(CCOC(=O)CC(=O)OCC)").
  const balance = (text: string) => [...text].reduce((depth, character) => depth + (character === '(' ? 1 : character === ')' ? -1 : 0), 0);
  const written = new Set(question.split(/\s+/).map((token) => {
    let smiles = token.replace(/[.,;:]+$/, '');
    while (smiles.startsWith('(') && balance(smiles) > 0) smiles = smiles.slice(1);
    while (smiles.endsWith(')') && balance(smiles) < 0) smiles = smiles.slice(0, -1);
    return smiles.replace(/[.,;:]+$/, '');
  }).filter((token) => token.length >= 3));
  const out: string[] = [];
  for (const method of STARTING_MATERIAL_METHODS) {
    if ((method.pattern.test(question) || method.smiles.some((smiles) => written.has(smiles))) && !out.includes(method.className)) out.push(method.className);
  }
  return out;
}

/** The textbook queries for a route request: the target by name, then each reaction class the
 *  ORD disconnections name, as its textbook name. Short queries on purpose: the lexical lane
 *  ranks by how many query roots a passage covers, and generic words dilute a named reaction. */
export function synthesisEvidenceQueries(targetName: string | null, classes: readonly string[]): string[] {
  const queries: string[] = [];
  if (targetName) queries.push(`${targetName} synthesis`);
  for (const name of classes) {
    const query = textbookQueryForClass(name);
    if (query && !queries.includes(query)) queries.push(query);
  }
  return queries.slice(0, 7);
}

/** The textbook search for one reaction class, or null for a class with no textbook name. */
export function textbookQueryForClass(name: string): string | null {
  return name in CLASS_QUERIES ? CLASS_QUERIES[name] : name;
}

/** The query the research chat retrieves its corpus context with for a route request: the
 *  target's name and the reaction classes in play, instead of a prompt that is mostly output
 *  rules. Falls back to the request when it names no target. */
export function synthesisRetrievalQuery(question: string, evidence: SynthesisEvidence | null): string {
  const name = findTargetName(question);
  const classes = evidence ? disconnectionClasses(evidence.disconnections, 4) : [];
  const query = synthesisEvidenceQueries(name, classes).join('; ');
  return query || question;
}

/** What a passage must say to count as a textbook account of a reaction class: every pattern in
 *  `all` must match, and none in `not`. Retrieval alone is a keyword or embedding match, so a
 *  page on the enzyme that decarboxylates L-DOPA was offered for heating a malonic acid, and a
 *  page on lead tetraacetate for a Beckmann rearrangement. A class not listed needs its own
 *  name's first word. */
const CLASS_RELEVANCE: Record<string, { all: RegExp[]; not?: RegExp[] }> = {
  'enolate alkylation (malonic or acetoacetic ester synthesis)': { all: [/malonic|acetoacetic|enolate/i, /alkylat/i] },
  'intramolecular aldol condensation (Robinson annulation)': { all: [/robinson annulation|aldol/i] },
  'amide hydrolysis (deprotection of an acetamide)': { all: [/hydroly/i, /amide/i] },
  'diazonium salt substitution (Sandmeyer)': { all: [/sandmeyer|diazonium/i] },
  'Kolbe-Schmitt carboxylation of a phenol': { all: [/kolbe/i] },
  'nitro group reduction to amine': { all: [/nitro|nitrat/i, /reduc|hydrogenat/i, /amine|aniline/i] },
  'aromatic nitration': { all: [/nitrat/i] },
  'Fischer esterification': { all: [/esterif/i] },
  'acylation of an alcohol or phenol': { all: [/acylat|acetylat|esterif/i] },
  'amide formation by acylation of an amine': { all: [/amide/i, /amine|ammonia/i, /acid chloride|acyl chloride|acylat|anhydride/i] },
  'ester hydrolysis': { all: [/hydroly|saponif/i, /ester/i] },
  'reduction of an ester to an alcohol': { all: [/reduc/i, /ester/i], not: [/hydroly|saponif/i] },
  'nitrile hydrolysis': { all: [/nitrile/i, /hydroly/i] },
  'acid chloride formation with thionyl chloride': { all: [/thionyl chloride|SOCl\s*2/i, /acid chloride|acyl chloride|carboxylic acid/i] },
  'oxidation to a carboxylic acid': { all: [/oxidi[sz]|oxidation/i, /carboxylic acid/i] },
  'oxidation of an alcohol': { all: [/oxidi[sz]|oxidation/i, /alcohol/i] },
  'benzylic oxidation': { all: [/benzylic/i, /oxidi[sz]|oxidation/i] },
  'reduction of a carbonyl compound': { all: [/reduc/i, /aldehyde|ketone|carbonyl/i] },
  'Suzuki cross-coupling': { all: [/suzuki/i] },
  'nucleophilic aromatic substitution': { all: [/nucleophilic aromatic substitution|S\s*N\s*Ar/i] },
  'Friedel-Crafts acylation': { all: [/friedel.crafts/i] },
  'halogenation': { all: [/halogenat|brominat|chlorinat/i] },
  'conversion of an alcohol to an alkyl halide': { all: [/alcohol/i, /halide|PBr3|SOCl2|HBr|HCl/i] },
  'SN2 alkylation': { all: [/S\s*_?N\s*_?2|nucleophilic substitution/i] },
  'Grignard reaction': { all: [/grignard/i] },
  'Wittig reaction': { all: [/wittig/i] },
  'partial hydrogenation of an alkyne': { all: [/alkyne|lindlar/i, /hydrogenat/i] },
  'hydrogenation of an alkene': { all: [/hydrogenat/i, /alkene|double bond/i] },
  'Michael addition': { all: [/michael/i] },
  'alkylation of an acetylide': { all: [/acetylide/i] },
  'benzoin condensation': { all: [/benzoin/i] },
  'benzilic acid rearrangement': { all: [/benzilic/i] },
  'oxime formation': { all: [/oxime/i] },
  'Beckmann rearrangement': { all: [/beckmann/i] },
  decarboxylation: { all: [/decarboxylat/i], not: [/decarboxylase|pyridoxal|enzym|\bPLP\b|L-?DOPA/i] },
  chlorosulfonation: { all: [/chlorosulfon/i] },
  'sulfonamide formation': { all: [/sulfonamide/i] },
  'Diels-Alder cycloaddition': { all: [/diels.alder/i] },
};

function classRule(name: string): { all: RegExp[]; not?: RegExp[] } {
  const rule = CLASS_RELEVANCE[name];
  if (rule) return rule;
  const word = name.split(/[\s(]+/).find((item) => item.length > 3);
  return { all: word ? [new RegExp(word.slice(0, Math.max(5, word.length - 3)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')] : [] };
}

/** Where in a passage the reaction class is discussed: the offset of the first stretch of about
 *  two sentences that names every term the class needs, or -1 when none does (or an excluded
 *  term appears anywhere). */
function relevantOffset(name: string, flat: string): number {
  const rule = classRule(name);
  if ((rule.not ?? []).some((pattern) => pattern.test(flat))) return -1;
  // The terms must appear together: a page that mentions an acid chloride in one paragraph and a
  // reduction in another is not about either reaction.
  for (let start = 0; start < Math.max(1, flat.length); start += RELEVANCE_STEP) {
    const window = flat.slice(start, start + RELEVANCE_WINDOW);
    if (!rule.all.every((pattern) => pattern.test(window))) continue;
    // Where the discussion starts: the earliest required term in the window.
    const first = Math.min(...rule.all.map((pattern) => window.search(pattern)).filter((at) => at >= 0), 0 + window.length);
    return start + (Number.isFinite(first) ? first : 0);
  }
  return -1;
}

/** Whether a passage is a textbook account of the reaction class. */
export function passageFitsClass(name: string, text: string): boolean {
  return relevantOffset(name, text.replace(/\s+/g, ' ')) >= 0;
}

/** The excerpt to quote for a reaction class: the stretch that discusses it, from a sentence
 *  start, not the passage's first characters (often the tail of an unrelated paragraph). */
export function relevantExcerpt(name: string, text: string, chars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  let start = Math.max(0, relevantOffset(name, flat));
  if (start > 0) {
    // Back to the start of that sentence, when it began not long before.
    const before = flat.slice(Math.max(0, start - 200), start);
    const boundary = Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! '));
    start = boundary >= 0 ? start - before.length + boundary + 2 : start;
  }
  const body = flat.slice(start);
  const cut = body.length > chars ? `${body.slice(0, chars).replace(/\s+\S*$/, '')}…` : body;
  return start > 0 ? `…${cut}` : cut;
}
const RELEVANCE_WINDOW = 300;
const RELEVANCE_STEP = 100;

/** Whether a passage found for a query fits it: a reaction-class query must pass that class's
 *  relevance rule; the target query ("<name> synthesis") must name the target. */
export function passageFitsQuery(query: string, text: string): boolean {
  for (const name of [...Object.keys(CLASS_QUERIES), ...Object.keys(CLASS_RELEVANCE)]) {
    if (textbookQueryForClass(name) === query) return passageFitsClass(name, text);
  }
  const target = /^(.+) synthesis$/.exec(query)?.[1];
  if (target) return text.toLowerCase().includes(target.toLowerCase());
  return true;
}

/** A back-of-book index or a reference list: mostly page numbers, no chemistry to read. */
export function isIndexLikePassage(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words > 0 && (text.match(/\d+/g) ?? []).length / words > 0.25;
}

export interface EvidencePassage {
  text: string;
  /** From a book read mostly by OCR: names and formulas may carry recognition errors. */
  scanned?: boolean;
  location: string | null;
  work: { title: string; year: number | null };
  /** The query that found it (the target, or a reaction class). */
  retrievedFor: string;
  citation: string;
}

export interface SynthesisEvidence {
  target: string;
  startingMaterials: string[];
  disconnections: TargetDisconnections[];
  passages: EvidencePassage[];
  /** Reactions read from the scheme drawings in the user's textbooks that make the target or a
   *  precursor, cited by book and page (absent without a textbook-scheme index). */
  textbookPreparations?: TextbookPreparation[];
  /** Complete routes found by the route search over the ORD and textbook indexes (absent when
   *  the package has no route search or nothing complete was found in time). */
  candidateRoutes?: CandidateRoute[];
  /** The target itself is on the user's stock lists (absent when it is not, or stock is off). */
  targetAvailability?: string;
}

/** A route the application's search found, compact for the payload: steps in synthesis order. */
export interface CandidateRoute {
  steps: Array<{ reaction: string; basis: 'recorded' | 'template'; source: string; recorded?: number; citations?: string[] }>;
  starting_materials: Array<{ smiles: string; status: 'given' | 'in stock' | 'to source' }>;
}

const CANDIDATE_ROUTES = 3;
const CANDIDATE_STEPS = 6;
const STEP_CITATIONS = 2;
const ORD_SAMPLE = RECORD_ID;
const TEXTBOOK_SAMPLE = /^tb-[0-9a-f]{32}$/;

/** Reads `candidate-routes` data (the worker's route search): each route's steps in synthesis
 *  order with their basis and source, cited by ORD ids, textbook records (`citeTextbook`: record ids
 *  to formatted citations) or, for a textbook template step, the schemes its templates came from
 *  (`citeTemplates`); and its starting materials, marked given, in stock or still to source. */
export function candidateRoutes(
  data: unknown,
  citeTextbook?: (ids: string[]) => string[],
  citeTemplates?: (templates: string[]) => string[],
): CandidateRoute[] {
  const routes = (data as { routes?: unknown })?.routes;
  if (!Array.isArray(routes)) return [];
  const out: CandidateRoute[] = [];
  for (const raw of routes) {
    const route = raw as { steps?: unknown; startingMaterials?: unknown } | null;
    const steps: CandidateRoute['steps'] = [];
    for (const item of Array.isArray(route?.steps) ? route.steps : []) {
      const step = item as { product?: unknown; precursors?: unknown; kind?: unknown; index?: unknown; recorded?: unknown; samples?: unknown; templates?: unknown };
      const precursors = Array.isArray(step.precursors) ? step.precursors.filter((p): p is string => typeof p === 'string' && !!p) : [];
      if (typeof step.product !== 'string' || !step.product || !precursors.length) continue;
      const source = step.index === 'textbook' ? 'textbook' : step.index === 'ord' ? 'ORD' : typeof step.index === 'string' ? step.index : 'index';
      const basis = step.kind === 'recorded' ? 'recorded' : 'template';
      const samples = Array.isArray(step.samples) ? step.samples.filter((id): id is string => typeof id === 'string') : [];
      const templates = Array.isArray(step.templates) ? step.templates.filter((t): t is string => typeof t === 'string' && t.includes('>>')) : [];
      let citations: string[] = [];
      // A patent record is cited by its number (and paragraph), linked; an ORD record by its id.
      if (basis === 'recorded' && source === 'ORD') citations = samples.filter((id) => ORD_SAMPLE.test(id)).slice(0, STEP_CITATIONS).map((id) => recordLabel(id).replace(/^`|`$/g, ''));
      else if (basis === 'recorded' && source === 'textbook' && citeTextbook) citations = citeTextbook(samples.filter((id) => TEXTBOOK_SAMPLE.test(id))).slice(0, STEP_CITATIONS);
      else if (basis === 'template' && source === 'textbook' && citeTemplates && templates.length) citations = citeTemplates(templates).slice(0, STEP_CITATIONS);
      steps.push({
        reaction: `${precursors.join('.')}>>${step.product}`.slice(0, 600),
        basis,
        source,
        ...(basis === 'recorded' && typeof step.recorded === 'number' && step.recorded > 0 ? { recorded: step.recorded } : {}),
        ...(citations.length ? { citations } : {}),
      });
    }
    if (!steps.length || steps.length > CANDIDATE_STEPS) continue;
    const starting = (Array.isArray(route?.startingMaterials) ? route.startingMaterials : []).flatMap((item) => {
      const value = item as { smiles?: unknown; given?: unknown; inStock?: unknown };
      if (typeof value.smiles !== 'string' || !value.smiles) return [];
      const status: CandidateRoute['starting_materials'][number]['status'] = value.given === true ? 'given' : value.inStock === true ? 'in stock' : 'to source';
      return [{ smiles: value.smiles.slice(0, 400), status }];
    });
    out.push({ steps, starting_materials: starting });
    if (out.length >= CANDIDATE_ROUTES) break;
  }
  return out;
}

/** The payload value, or null when there is nothing to add. */
export function synthesisEvidencePayload(evidence: SynthesisEvidence | null): Record<string, unknown> | null {
  if (!evidence || (!evidence.disconnections.length && !evidence.passages.length && !evidence.textbookPreparations?.length && !evidence.candidateRoutes?.length && !evidence.targetAvailability)) return null;
  return {
    target: evidence.target,
    ...(evidence.targetAvailability ? { target_availability: evidence.targetAvailability } : {}),
    ...(evidence.startingMaterials.length ? { starting_materials: evidence.startingMaterials } : {}),
    ...(evidence.disconnections.length ? {
      ord_disconnections: evidence.disconnections.map((brief) => ({
        molecule: brief.target,
        ...(brief.recordedRoutes.length ? { recorded_preparations: brief.recordedRoutes } : {}),
        proposals: brief.proposals.map(({ templates: _templates, ...proposal }) => proposal),
      })),
    } : {}),
    ...(evidence.passages.length ? { textbook_passages: evidence.passages } : {}),
    ...(evidence.textbookPreparations?.length ? { textbook_preparations: evidence.textbookPreparations } : {}),
    ...(evidence.candidateRoutes?.length ? { candidate_routes: evidence.candidateRoutes } : {}),
  };
}

/** A carbon atom in a SMILES: `C` not starting Cl, Cr, Ca, Cu…, or aromatic `c` not ending Sc, Tc… */
export function hasCarbon(smiles: string): boolean {
  return /C(?![a-z])/.test(smiles) || /(?<![A-Z])c/.test(smiles);
}

/** A route's starting materials: organic reactants no earlier step makes, in first-use order. */
export function routeStartingMaterials(labels: Array<Array<{ role: string; byproduct: boolean; name: string; smiles: string }>>): Array<{ name: string; smiles: string }> {
  const made = new Set<string>();
  const out = new Map<string, { name: string; smiles: string }>();
  for (const step of labels) {
    for (const label of step) {
      if (label.role === 'reactant' && !label.byproduct && hasCarbon(label.smiles) && !made.has(label.smiles) && !out.has(label.smiles)) {
        out.set(label.smiles, { name: label.name || label.smiles, smiles: label.smiles });
      }
    }
    for (const label of step) if (label.role === 'product') made.add(label.smiles);
  }
  return [...out.values()];
}

/** The route's target: the last step's organic product (not a byproduct), or null. */
export function routeTargetSmiles(labels: Array<Array<{ role: string; byproduct: boolean; name: string; smiles: string }>>): { name: string; smiles: string } | null {
  const last = labels[labels.length - 1] ?? [];
  const product = last.find((label) => label.role === 'product' && !label.byproduct && hasCarbon(label.smiles));
  return product ? { name: product.name || product.smiles, smiles: product.smiles } : null;
}

/** What the stock lists say about one compound: in stock, the same compound in another stereo or
 *  isotope form (InChIKey connectivity block), or orderable (make-on-demand). */
export interface CompoundAvailability {
  inStock: string[];
  sameCompoundOtherForm: string[];
  orderable: string[];
  orderableOtherForm: string[];
}

/** The availability of one molecule from a check-stock reply. */
export function compoundAvailability(
  smiles: string,
  data: { stock?: Record<string, string[]>; orderable?: Record<string, string[]>; sameSkeleton?: Record<string, string[]>; sameSkeletonOrderable?: Record<string, string[]> },
): CompoundAvailability {
  return {
    inStock: data.stock?.[smiles] ?? [],
    sameCompoundOtherForm: data.sameSkeleton?.[smiles] ?? [],
    orderable: data.orderable?.[smiles] ?? [],
    orderableOtherForm: data.sameSkeletonOrderable?.[smiles] ?? [],
  };
}

/** One plain sentence when the target itself can be bought, or ''. */
export function formatTargetAvailability(name: string, availability: CompoundAvailability): string {
  const vendors = (list: string[]) => list.map((vendor) => vendor.replace(/-full$/, '')).join(', ');
  if (availability.inStock.length) {
    return `The target itself (${name}) is commercially available (${vendors(availability.inStock)}, in stock) — a route may be unnecessary.`;
  }
  if (availability.sameCompoundOtherForm.length) {
    return `The target (${name}) is commercially available in another stereo or isotope form, or with stereochemistry unspecified (${vendors(availability.sameCompoundOtherForm)}, in stock) — check whether that form serves before making it.`;
  }
  if (availability.orderable.length) {
    return `The target itself (${name}) can be ordered (${vendors(availability.orderable)}, make-on-demand).`;
  }
  if (availability.orderableOtherForm.length) {
    return `The target (${name}) can be ordered in another stereo or isotope form (${vendors(availability.orderableOtherForm)}, make-on-demand).`;
  }
  return '';
}

/** One line under the route report: which starting materials the user's stock lists hold
 *  (ready to ship), and which are only orderable from a make-on-demand catalogue. */
export function formatStartingMaterialStock(
  starting: Array<{ name: string; smiles: string }>,
  stock: Record<string, string[]>,
  lists: string[],
  orderable: Record<string, string[]> = {},
  orderLists: string[] = [],
): string {
  if (!starting.length || !(lists.length || orderLists.length)) return '';
  const parts = starting.map(({ name, smiles }) => {
    const vendors = stock[smiles] ?? [];
    if (vendors.length) return `${name} (in stock: ${vendors.join(', ')})`;
    const order = orderable[smiles] ?? [];
    return order.length ? `${name} (orderable, make-on-demand: ${order.join(', ')})` : `${name} (not on your stock lists)`;
  });
  const held = starting.filter(({ smiles }) => (stock[smiles] ?? []).length).length;
  const listed = [...lists, ...orderLists.map((list) => `${list} (make-on-demand)`)].join(', ');
  return `**Starting materials:** ${held} of ${starting.length} in stock (${listed}) — ${parts.join('; ')}.`;
}
