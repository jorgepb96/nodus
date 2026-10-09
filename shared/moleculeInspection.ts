/** Deterministic molecule description shared with the chemistry capability.
 *
 * The `nodus:chemistry` package exposes a read-only `inspect` tool that parses a
 * SMILES with RDKit and returns a `molecule-dossier` artifact whose `data` is a
 * `MoleculeDossier`. Research Chat injects that dossier as authoritative context
 * so a model reasons over a verified graph instead of re-reading SMILES text. */

import { correctionTargetPlanRule, ROUTE_LABEL_LINES, routeSpeciesRules } from './routeRules';
import { similarityBand } from './reactionSimilarity';
import { conditionsText, normalizeReactionConditions, type ReactionConditions } from './reactionConditions';
import { auditNote, normalizeAuditFlags, recordLabel, RECORD_ID } from './recordAudit';
import { looksLikeSynthesisRequest } from './synthesisPrompt';

export { similarityBand };

export interface MoleculeAtom {
  /** 0-based position in the parsed graph; bond endpoints use this index. */
  index: number;
  element: string;
  charge?: number;
  isotope?: number;
  /** Explicit plus implicit hydrogen count on the atom, when reported. */
  hydrogens?: number;
  /** CIP descriptor for a stereocentre (R/S) or stereogenic bond (E/Z). */
  cip?: string;
}

export interface MoleculeBond {
  a: number;
  b: number;
  order: number;
  stereo?: string;
}

export interface MoleculeDossier {
  canonicalSmiles: string;
  inputSmiles?: string;
  formula?: string;
  molecularWeight?: number;
  atomCount: number;
  bondCount: number;
  atoms: MoleculeAtom[];
  bonds: MoleculeBond[];
  caveats?: string[];
}

/** Appended to the Research Chat system prompt when a dossier is present. */
export const MOLECULE_DOSSIER_SYSTEM_RULE = [
  'Verified molecular structure: the `estructura_objetivo_verificada` field was produced by RDKit, not by you, and is authoritative.',
  'Reason from its canonical SMILES, atom table (including CIP stereochemistry) and bond table, never from re-reading the raw SMILES text.',
  'If a proposed reaction, intermediate or product implies a connectivity or stereochemistry absent from that table, it is wrong and must be corrected before it is written.',
].join(' ');

/** Appended when Chemistry Studio is enabled: a multi-step route is one object, and the
 *  intermediate that leaves one step has to be the exact molecule that enters the next. */
export const ROUTE_CONTINUITY_SYSTEM_RULE = [
  'Synthesis route continuity: when you plan more than one reaction step, the intermediate carried from one step into the next must be written with the exact same systematic IUPAC name, including its stereodescriptors, in both places, so the application can confirm it is the same molecule.',
  'Do not rename, re-protonate or otherwise rewrite a carried intermediate. If a structure genuinely changes between steps (a protonation, a salt formation, a different stereoisomer), that change is a step of its own with its four labelled lines: the application compares structures, not explanations, and rejects a carried intermediate that differs however the prose justifies it.',
  'In a route, do not write a reaction SMILES or a reaction line: the application derives every structure and every balanced equation from the species names you list.',
].join(' ');

/** One species of a route step, as the chemistry capability reports it. */
export interface RouteSpeciesSummary {
  input: string;
  canonicalSmiles: string;
  skeletonSmiles: string;
  formula: string;
  charge: number;
  heavyAtoms: number;
  stereocentres: number;
  unspecifiedStereocentres: number;
  /** For a species written as a free acid with a stereocentre carrying a nitrogen — a chiral
   *  building block — the CIP descriptor at that centre, as the package measured it. Reported,
   *  not judged: a block of the opposite configuration parses and balances exactly like the
   *  intended one, so the atom check can never see it, and the letter that corresponds to a
   *  given series flips when a sulfur-bearing branch outranks the carboxyl. The report puts the
   *  measurement beside what the author's own name asserts. */
  alphaConfiguration?: '(R)' | '(S)' | 'unassigned';
  /** The systematic name the author wrote for this species, when the answer carries one. */
  name?: string;
  /** Set by the capability when it could resolve the name: true when the name denotes this
   *  structure, false when it denotes a different one. Absent when no name was supplied or
   *  the name could not be resolved. */
  nameOk?: boolean;
  /** The species is a byproduct rather than the intended product. A display/authoring label
   *  only: like any other product it stays on the product side of the equation. */
  byproduct?: boolean;
  /** The coefficient the checker solved for this species, when the step balances. */
  coefficient?: number;
}

export type RouteLabelRole = 'reactant' | 'product' | 'agent';

/** A species the author named in the step prose: the IUPAC name and the isomeric SMILES it
 *  was written with. The prose is the fixed reference; the checker compares the name and the
 *  structure to it. */
export interface RouteSpeciesLabel {
  role: RouteLabelRole;
  byproduct: boolean;
  name: string;
  smiles: string;
}

export interface RouteStepAudit {
  index: number;
  reaction: string;
  ok: boolean;
  error?: string;
  reactants: RouteSpeciesSummary[];
  agents: RouteSpeciesSummary[];
  products: RouteSpeciesSummary[];
  balanced: boolean | null;
  chargeBalanced: boolean | null;
  differences: string[];
  unspecifiedStereocentres: number;
  /** One sentence per supplied name that denotes a different structure than the species it
   *  was written beside, as the capability resolved it. */
  nameProblems?: string[];
  /** The request declared this step racemic; its open centres are a stated outcome. */
  racemic?: boolean;
  /** The step's open stereocentres cannot reach the target (requested without stereo), so the
   *  checker does not require them to be specified or declared. */
  stereoNotRequired?: boolean;
  /** The equation balances only by assembling a product from more than one substrate. */
  assemblyProblem?: string;
  /** Why the per-molecule packing search gave up. Absent when the step's shape is simply outside
   *  what packing models (a convergent coupling), which is not a gap in coverage. */
  assemblyUnchecked?: string;
  /** Set when the coefficient search gave up: more species free to vary than it determines
   *  coefficients for. `balanced` is false, so the step fails, but it is unchecked, not unbalanced,
   *  and its one action is to split the step. */
  balanceUnchecked?: string;
  /** The bonds at carbon this balanced step forms and breaks, read as a graph edit by the
   *  capability. Facts for the report and the reviewer, whether or not the step was refused. */
  skeleton?: RouteSkeletonFacts;
  /** Net bonds the step makes (+) and breaks (−) by element pair, every bond type. */
  bonds?: Record<string, number>;
  /** The request declared this step a rearrangement, or a radical / C–H functionalisation. */
  rearrangement?: boolean;
  radical?: boolean;
  /** A bond edit at carbon the step cannot explain: an undeclared 1,2-shift, or a new C–C or
   *  C–heteroatom bond at a carbon nothing activates. */
  skeletonProblem?: string;
  /** Set when the step balanced only because a species listed under Reactants was treated as
   *  taking no part. Reported because the arithmetic cannot tell a condition that was never
   *  consumed from a reagent that was, whose product the author forgot to name. */
  refiledReactant?: string;
  /** A species anywhere in the step written as a lone atom of an element whose free form is
   *  diatomic — an inert atmosphere given as `[N]`. It hides under Agents, which take no part
   *  in the balance, so nothing else in the check compares it with the name beside it. */
  monatomicSpecies?: string;
}

export interface RouteSkeletonFacts {
  change: 'none' | 'formed' | 'cleaved' | 'formed+cleaved' | 'unchecked';
  formed: number;
  cleaved: number;
  ringSizes: number[];
  migration: boolean;
  /** A C–C bond broken while its two carbons stay joined in the product (not a 1,2-shift). */
  reorganised: boolean;
  unactivated: number;
  unactivatedHetero: number;
  heteroElements: string[];
  /** Why the bond-edit search could not settle this step, when `change` is 'unchecked'. */
  reason?: string;
}

export interface RouteLinkAudit {
  from: number;
  to: number;
  ok: boolean;
  reason: 'carried' | 'constitution-only' | 'no-overlap' | 'declared-mismatch' | 'parse-failed';
  carried: Array<{ canonicalSmiles: string; formula: string; heavyAtoms: number }>;
  skeletonOnly: Array<{ product: string; reactant: string; skeletonSmiles: string }>;
  declaredCarrier?: { input: string; canonicalSmiles: string | null; inProduct: boolean; inReactant: boolean };
}

export interface RouteTargetAudit {
  input: string;
  canonicalSmiles: string | null;
  formula: string | null;
  formedAt: number | null;
  reason: 'formed' | 'stereo-mismatch' | 'not-formed' | 'unparsed';
  /** What the route delivered at each centre the REQUEST left open, measured from the product.
   *  A request that leaves a centre open accepts either configuration, so the route is not
   *  refused for choosing one — but which one it chose is the author's to accept. */
  openCentres?: Array<{ atom: number; delivered: string }>;
}

export interface RouteAudit {
  steps: RouteStepAudit[];
  links: RouteLinkAudit[];
  continuous: boolean;
  blocked: string[];
  /** Steps connected to nothing. Older packages only say so in `blocked`. */
  isolated?: number[];
  /** Whether the route forms the requested target; absent when none was named. */
  target?: RouteTargetAudit;
}

/** One looked-up reaction or product, with how many precedents the local index holds. */
export interface ReactionPrecedentEntry {
  input: string;
  count: number;
  /** For a product, a few example reaction hashes that make it. */
  keys?: string[];
  /** For a reaction, which form of the step matched when it was not the step as written. */
  form?: string;
  /** For a reaction, the products are all among the reactants (a purification or salt step). */
  unchanged?: boolean;
  /** For a matched reaction, up to three Open Reaction Database ids that record it. */
  samples?: string[];
  /** For a matched reaction, the index's SMILES for it, to draw. */
  reaction?: string;
  /** For a reaction, the reaction classes the package reads from its group changes. */
  classes?: string[];
  /** For a matched reaction, what up to two of its recorded samples were run with. */
  conditions?: ReactionConditions[];
  /** The bond-edit audit's flags on this record (kept cited; see recordAudit). */
  auditFlags?: string[];
}

export interface ReactionPrecedentNeighbor {
  key: string;
  distance: number;
  count: number;
  /** Tanimoto similarity of the reaction fingerprints, 0..1 (1 = the same bond changes). */
  similarity?: number;
  reaction?: string;
  /** The package's drawing of the reaction exactly as recorded (unbalanced). */
  svg?: string;
  /** For the closest reaction of an unmatched step: its recorded sample ids and their conditions. */
  samples?: string[];
  conditions?: ReactionConditions[];
  /** The bond-edit audit's flags on this record (kept cited; see recordAudit). */
  auditFlags?: string[];
}

export interface ReactionPrecedentSimilar {
  input: string;
  neighbors: ReactionPrecedentNeighbor[];
  unchanged?: boolean;
}

/** Evidence from the local Open Reaction Database index, looked up by the application. */
export interface ReactionPrecedent {
  reactions: ReactionPrecedentEntry[];
  products: ReactionPrecedentEntry[];
  similar: ReactionPrecedentSimilar[];
}

/** One route step as looked up in the index: its 0-based step index and the query sent. */
export interface PrecedentQuery {
  step: number;
  query: string;
}

/** What the precedent section needs beyond the lookup: which route step each query is, the
 *  species names to title it with, the target, and the ORD reaction drawn for each step. */
export interface PrecedentContext {
  queries: PrecedentQuery[];
  labels: RouteSpeciesLabel[][];
  target?: { smiles: string; name?: string } | null;
  /** Rendered drawing per 0-based route step. */
  drawings?: Map<number, string>;
  /** Textbook support and ORD alternatives per 0-based route step. */
  support?: Map<number, StepSupport>;
}

/** Evidence for one route step beyond its own precedent: a textbook passage on its reaction
 *  class, and — for a step that failed or has no precedent — other ways the index records or
 *  proposes to make its product. */
export interface StepSupport {
  passage?: { title: string; location: string | null; citation: string; excerpt: string; about: string; scanned?: boolean };
  alternatives?: { product: string; proposals: Array<{ precursors: string; classes: string[]; recorded: number }> };
  /** High-severity functional-group clashes the compatibility check found in the step. */
  compatibility?: string[];
}

const ALTERNATIVES_SHOWN = 3;

function alternativeLine(proposal: { precursors: string; classes: string[]; recorded: number }): string {
  const about = [proposal.classes[0], proposal.recorded > 0 ? `recorded ${proposal.recorded}×` : 'template only'].filter(Boolean).join('; ');
  return `\`${proposal.precursors}\` (${about})`;
}

/** The support lines under a step in the precedent section. */
function stepSupportLines(entry: ReactionPrecedentEntry, support: StepSupport | undefined): string[] {
  const lines: string[] = [];
  if (entry.classes?.length) lines.push(`- Reaction class: ${entry.classes.join(', ')}.`);
  if (support?.passage) {
    const { title, location, citation, excerpt, about } = support.passage;
    lines.push(`- Textbook, on ${about}: [${title}${location ? `, ${location}` : ''}](${citation})${support?.passage?.scanned ? ' (scanned book, OCR text)' : ''} — “${excerpt}”`);
  }
  const alternatives = support?.alternatives?.proposals.slice(0, ALTERNATIVES_SHOWN) ?? [];
  if (alternatives.length) lines.push(`- Other ways to make \`${support!.alternatives!.product}\` (Open Reaction Database): ${alternatives.map(alternativeLine).join(' · ')}.`);
  return lines;
}

const SMILES_CHARS = /^[A-Za-z0-9@+\-=\\#()[\]/.,%*:]+$/;
const STRUCTURAL = /[()[\]\\=#@/]|\d/;

/** A SMILES never begins or ends with a bond, a separator or a stereodescriptor. A token
 *  that does is a fragment the reply quoted in backticks (`/C=C\`, `=O`), not a species. */
const BOND_EDGE = /^[.\\/=#\-@]|[.\\/=#\-@]$/;

/** Sentence punctuation glued to a SMILES by prose ("...CC(=O)O.", "\"CCO\""). A
 *  SMILES never starts or ends with a quote or a bare separator, so peeling these off
 *  before the structural test recovers the molecule the author meant. Interior dots are
 *  a salt or reaction separator and stay, so `[Na+].[Cl-]` is left whole. */
const SENTENCE_LEADING = /^[\s"'\u2018\u2019\u201c\u201d]+/;
const SENTENCE_TRAILING = /[\s"'\u2018\u2019\u201c\u201d.,;:!?]+$/;
function trimSentenceEdges(token: string): string {
  return token.replace(SENTENCE_LEADING, '').replace(SENTENCE_TRAILING, '');
}

/** Whether a species the model wrote as a NAME is in fact a bare SMILES. Only ever asked of a
 *  name no reference service could resolve: a real systematic name ("butan-2-one") passes the
 *  shape test below, so this must not be used to pre-empt resolution — the structure is taken
 *  only once the name has failed, where the alternative is discarding a species the author
 *  described unambiguously. */
/** A systematic name separates locants with commas; a SMILES string does not carry one. A hyphen
 *  is NOT a tell — it is an explicit single bond in a biaryl linkage (`c2ccccc2-c2ccccc21`) — so
 *  the lowercase-run test below is what rejects `2-methylbutan-2-ol`. */
const NAME_PUNCTUATION = /,/;
/** Lowercase outside a bracket atom spells aromatic atoms and nothing else. */
const AROMATIC_RUN = /^(?:se|as|[bcnops])+$/;

/** Whether a name is in fact a structure written where a name belongs. Deliberately much
 *  stricter than `isSmilesLike`, which only has to find a candidate inside prose that other
 *  evidence then confirms: here the answer decides whether a species is taken as author-declared,
 *  so a false positive silently turns an ordinary systematic name into its own structure. Every
 *  numbered name — `4-nitrophenol`, `bornan-2-ol`, `benzene-1,2-diamine` — satisfies the looser
 *  test, because a locant digit reads as a ring closure. */
export function isBareSmilesName(name: string): boolean {
  const token = name.trim();
  if (!isSmilesLike(token, 3)) return false;
  // Outside bracket atoms only: a charge (`[Cl-]`) and an isotope live inside one.
  const outside = token.replace(/\[[^\]]*\]/g, '');
  if (NAME_PUNCTUATION.test(outside)) return false;
  const runs = outside.match(/[a-z]+/g) ?? [];
  if (runs.some(run => !AROMATIC_RUN.test(run))) return false;
  // Real structure, not merely a digit: a bond, a branch or a bracket atom — or a ring closure
  // on an aromatic run, which is how benzene is written.
  return /[()[\]\\=#@/]/.test(token) || (runs.length > 0 && /\d/.test(token));
}

function isSmilesLike(token: string, minLength: number): boolean {
  return token.length >= minLength
    && token.length <= 2000
    && !BOND_EDGE.test(token)
    && SMILES_CHARS.test(token)
    && STRUCTURAL.test(token)
    && /[A-Za-z]/.test(token);
}

/** SMILES-shaped runs, with composer line wraps reassembled. Prose is rejected by the
 *  structural/length filters; the capability parses each candidate and is the final
 *  authority on whether it is a real molecule. */
export function findSmilesCandidates(text: string): string[] {
  const out: string[] = [];
  const push = (token: string) => {
    if (!token || out.includes(token) || out.length >= 4) return;
    out.push(token);
  };
  let run: string[] = [];
  const flush = () => {
    if (!run.length) return;
    const joined = trimSentenceEdges(run.join(''));
    if (isSmilesLike(joined, 4)) push(joined);
    run = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) { flush(); continue; }
    const whole = trimSentenceEdges(trimmed);
    if (isSmilesLike(whole, 4)) { run.push(whole); continue; }
    const first = trimSentenceEdges(trimmed.split(/\s+/)[0]);
    if (isSmilesLike(first, 8)) { run.push(first); flush(); continue; }
    flush();
    for (const raw of trimmed.split(/\s+/)) {
      const token = trimSentenceEdges(raw);
      if (isSmilesLike(token, 8)) push(token);
    }
  }
  flush();
  return out;
}

export function formatMoleculeDossier(dossier: MoleculeDossier): string {
  const lines: string[] = [`Canonical isomeric SMILES: ${dossier.canonicalSmiles}`];
  if (dossier.formula) {
    lines.push(`Formula: ${dossier.formula}${typeof dossier.molecularWeight === 'number' ? ` (MW ${dossier.molecularWeight.toFixed(2)})` : ''}`);
  }
  lines.push(`Atoms: ${dossier.atomCount}, bonds: ${dossier.bondCount}`);
  lines.push('Atom table (index element charge hydrogens CIP):');
  for (const atom of dossier.atoms) {
    const parts = [`#${atom.index}`, atom.element];
    if (typeof atom.charge === 'number' && atom.charge !== 0) parts.push(`charge ${atom.charge}`);
    if (typeof atom.isotope === 'number') parts.push(`isotope ${atom.isotope}`);
    if (typeof atom.hydrogens === 'number') parts.push(`H${atom.hydrogens}`);
    if (atom.cip) parts.push(atom.cip);
    lines.push(`  ${parts.join(' ')}`);
  }
  lines.push('Bond table (a-b order stereo):');
  for (const bond of dossier.bonds) {
    lines.push(`  ${bond.a}-${bond.b} ${bond.order}${bond.stereo ? ` ${bond.stereo}` : ''}`);
  }
  if (dossier.caveats?.length) {
    lines.push('Caveats:');
    for (const caveat of dossier.caveats) lines.push(`  - ${caveat}`);
  }
  return lines.join('\n');
}

const SMILES_TOKEN_ONLY = /^[A-Za-z0-9@+\-=\\#()[\]/.,%*:]+$/;
const SMILES_SIGNAL = /[()[\]@=#/\\]|[A-Z]/;
/** A role heading a names-first step backticks ("`Reactants:`"). It is shaped like a SMILES
 *  token (letters plus the colon) but is a label, not a molecule the model proposed. */
const ROLE_LABEL = /^(?:reactants?|products?|byproducts?|agents?|reagents?|catalysts?|solvents?|conditions?|notes?):?$/i;

function isSpeciesToken(token: string): boolean {
  if (ROLE_LABEL.test(token)) return false;
  return token.length >= 1 && token.length <= 2000 && !BOND_EDGE.test(token) && SMILES_TOKEN_ONLY.test(token) && SMILES_SIGNAL.test(token);
}

/** Species the model proposed in its answer: backticked reaction SMILES (split into every
 *  reactant/product/agent) and backticked single species. Only code spans are read — free
 *  prose is not scanned, because a chemical name, a markdown link or a path would otherwise
 *  be reported as an unparseable molecule and drown the real findings. */
export function findAnswerSpecies(answer: string): string[] {
  const out: string[] = [];
  const push = (token: string) => {
    if (!token || out.includes(token) || out.length >= 24) return;
    out.push(token);
  };
  for (const match of answer.matchAll(/`([^`\n]{1,4000})`/g)) {
    const span = match[1].trim();
    if (!span) continue;
    if (span.includes('>')) {
      for (const field of span.split('>')) for (const part of field.split('.')) if (isSpeciesToken(part.trim())) push(part.trim());
    } else if (isSpeciesToken(span)) {
      push(span);
    }
  }
  return out;
}

/** A deterministic appendix: what RDKit made of every species the model wrote. Generated
 *  by the app, so the model cannot claim a structure was verified when it was not. */
export function formatStructureAudit(candidates: string[], dossiers: MoleculeDossier[]): string {
  const byInput = new Map(dossiers.map((dossier) => [dossier.inputSmiles ?? dossier.canonicalSmiles, dossier]));
  const lines = [
    '### Structure check (RDKit)',
    '',
    'Every SMILES below was parsed with RDKit. This block is generated by the application, not by the model.',
    '',
  ];
  for (const smiles of candidates) {
    const dossier = byInput.get(smiles);
    if (!dossier) {
      lines.push(`- FAIL \`${smiles}\` — could not be parsed as a molecule`);
      continue;
    }
    const stereo = dossier.atoms.filter((atom) => atom.cip).length;
    const notes = [`${dossier.atomCount} atoms`, ...(stereo ? [`${stereo} stereocentres`] : []), ...(dossier.caveats ?? [])];
    const canonical = dossier.canonicalSmiles && dossier.canonicalSmiles !== smiles ? ` → \`${dossier.canonicalSmiles}\`` : '';
    lines.push(`- OK \`${smiles}\`${canonical} — ${notes.join(', ')}`);
  }
  return lines.join('\n');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/** Accepts only a dossier the capability can actually have produced, so a malformed
 *  artifact degrades to "no dossier" instead of injecting junk into the prompt. */
export function normalizeMoleculeDossier(data: unknown, inputSmiles: string): MoleculeDossier | null {
  const value = asRecord(data);
  if (!value) return null;
  const canonicalSmiles = typeof value.canonicalSmiles === 'string' ? value.canonicalSmiles.trim() : '';
  if (!canonicalSmiles || !Array.isArray(value.atoms) || !Array.isArray(value.bonds)) return null;

  const atoms: MoleculeAtom[] = [];
  for (const entry of value.atoms) {
    const atom = asRecord(entry);
    if (!atom) continue;
    const element = atom.element;
    if (typeof element !== 'string' || !element) continue;
    const index = atom.index;
    const charge = atom.charge;
    const isotope = atom.isotope;
    const hydrogens = atom.hydrogens;
    const cip = atom.cip;
    atoms.push({
      index: typeof index === 'number' ? index : atoms.length,
      element,
      ...(typeof charge === 'number' ? { charge } : {}),
      ...(typeof isotope === 'number' ? { isotope } : {}),
      ...(typeof hydrogens === 'number' ? { hydrogens } : {}),
      ...(typeof cip === 'string' && cip ? { cip } : {}),
    });
  }
  if (!atoms.length) return null;

  const bonds: MoleculeBond[] = [];
  for (const entry of value.bonds) {
    const bond = asRecord(entry);
    if (!bond) continue;
    const a = bond.a;
    const b = bond.b;
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    const order = bond.order;
    const stereo = bond.stereo;
    bonds.push({
      a,
      b,
      order: typeof order === 'number' ? order : 1,
      ...(typeof stereo === 'string' && stereo ? { stereo } : {}),
    });
  }

  return {
    canonicalSmiles,
    inputSmiles,
    ...(typeof value.formula === 'string' ? { formula: value.formula } : {}),
    ...(typeof value.molecularWeight === 'number' ? { molecularWeight: value.molecularWeight } : {}),
    atomCount: typeof value.atomCount === 'number' ? value.atomCount : atoms.length,
    bondCount: typeof value.bondCount === 'number' ? value.bondCount : bonds.length,
    atoms,
    bonds,
    ...(Array.isArray(value.caveats)
      ? { caveats: value.caveats.filter((entry): entry is string => typeof entry === 'string').slice(0, 12) }
      : {}),
  };
}

const CONDITIONS_PATTERN = /\b(?:reagents?\s+and\s+)?conditions?\s*\*{0,3}\s*:\s*([^\n]{3,400})/gi;

/** The model writes a step's conditions as a sentence; an arrow label has room for a phrase.
 *  Take the first clause, drop the parenthesised asides, and cap the length. */
function conciseConditions(value: string): string {
  const clause = (value.split(';')[0] ?? value).replace(/\s*\([^)]*\)/g, '');
  return clause.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 72).trim();
}

/** The “Reagents and conditions: …” prose for each step, in step order, aligned with
 *  `findReactionLines` by position, reduced to a short phrase for the arrow. This is the only
 *  source for the temperature, time and workup the schema cannot hold; it is annotation only,
 *  never checked. Missing steps are empty strings. */
export function findStepConditions(text: string, count: number): string[] {
  // Read each step's conditions inside its own section, so a step without a conditions line or
  // an extra summary "Reaction conditions:" line does not shift every later step.
  const sections = stepSections(text);
  if (sections) {
    return Array.from({ length: count }, (_, index) => {
      const section = sections[index];
      if (!section) return '';
      const match = new RegExp(CONDITIONS_PATTERN.source, 'i').exec(text.slice(section.start, section.end));
      return match ? conciseConditions(match[1]) : '';
    });
  }
  const found: string[] = [];
  for (const match of text.matchAll(CONDITIONS_PATTERN)) {
    const value = conciseConditions(match[1]);
    if (value) found.push(value);
  }
  const out: string[] = [];
  for (let index = 0; index < count; index++) out.push(found[index] ?? '');
  return out;
}

/** A step's title and the first paragraph under its heading, stopping at its species lines. */
function stepProseText(title: string, block: string): string {
  const body = block.replace(/^[^\n]*\n?/, '');
  const cut = body.search(/(?:(?:`{1,2}|\*\*|__)[ \t]*|(?<![ \t])[ \t]+)?\b(?:reactants?|products?|by[-\s]?products?|agents?)[ \t]*[:：]/i);
  const paragraph = (cut >= 0 ? body.slice(0, cut) : body).split(/\n{2,}/)[0] ?? '';
  const prose = paragraph.replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 360);
  return prose ? `${title} — ${prose}` : title;
}

/** Each step's whole section of the answer, as written (links included), in step order; missing
 *  steps are empty strings. A step starts at a line that begins "Step N" (a heading, a bold
 *  lead-in or plain) and runs to the next step, a markdown heading or a whole-line bold heading
 *  ("**Target structure**"): those belong to the answer, not to the last step. The first
 *  section for each number wins. The evidence summary reads its citations from here. */
export function findStepBlocks(text: string, count: number): string[] {
  // The same sections the species, prose and conditions are read from, when the answer has them.
  // Matched on its own, a "Step 1: …" line in an overview above the route claimed step 1 (the first
  // section for each number wins), and every citation in the real step was counted as cited
  // outside the steps — the step read "model knowledge only" beside its own textbook citation.
  const sections = stepSections(text);
  if (sections) return Array.from({ length: count }, (_, index) => sections[index] ? text.slice(sections[index].start, sections[index].end) : '');
  const lines = text.split('\n');
  let starts: Array<{ step: number; line: number }> = [];
  lines.forEach((line, at) => {
    const match = /^[ \t]{0,3}(?:#{1,6}[ \t]*|\*\*|__)?[ \t]*Step[ \t]+(\d+)\b/i.exec(line);
    if (match) starts.push({ step: Number(match[1]) - 1, line: at });
  });
  // No "Step N" anywhere: a numbered list ("1. **Acid-catalysed rearrangement.** …") is the
  // route when its items, and only they, carry the labelled species lines — a numbered list of
  // conditions inside one step does not.
  if (!starts.length) {
    const numbered = lines.flatMap((line, at) => {
      // Unindented only: an indented item belongs to a list inside a step.
      const match = /^(?:#{1,6}[ \t]*)?(\d+)[.)][ \t]+\S/.exec(line);
      return match ? [{ step: Number(match[1]) - 1, line: at }] : [];
    });
    const labelled = numbered.filter((entry, index) => {
      const end = numbered[index + 1]?.line ?? lines.length;
      return lines.slice(entry.line, end).some((line) => /^\s*(?:[-*]\s*)?(?:`{1,2}|\*\*|__)?\s*(?:reactants|products)\s*[:：]/i.test(line));
    });
    if (labelled.length === count && labelled.every((entry, index) => entry.step === index)) starts = labelled;
  }
  const blocks: string[] = Array.from({ length: count }, () => '');
  starts.forEach(({ step, line }, index) => {
    if (step < 0 || step >= count || blocks[step]) return;
    const next = starts[index + 1]?.line ?? lines.length;
    let stop = next;
    for (let at = line + 1; at < next; at++) {
      if (HASH_HEADING.test(lines[at]) || BOLD_HEADING.test(lines[at])) { stop = at; break; }
    }
    blocks[step] = lines.slice(line, stop).join('\n');
  });
  return blocks;
}

/** A step block's heading title without its "Step N" prefix ("Oxidation of 4-nitrotoluene"). */
function stepBlockTitle(block: string): string {
  const firstLine = block.split(/\r?\n/)[0] ?? '';
  const heading = (HASH_HEADING.exec(firstLine) ?? /^[ \t]{0,3}(?:\*\*|__)(.+?)(?:\*\*|__)/.exec(firstLine))?.[1] ?? '';
  return heading.replace(/[*_`]/g, '').replace(/^step\s*\d+\s*[—–:.-]*\s*/i, '').replace(/[.:]\s*$/, '').trim();
}

/** One step's support among the four sources a route can draw on. */
export interface StepEvidence {
  step: number;
  title: string;
  /** Open Reaction Database: a recorded precedent, or the closest record's similarity (0..1). */
  ord: { kind: 'exact'; count: number } | { kind: 'similar'; similarity: number } | null;
  /** Library passages cited in the step: passage ids (route evidence and corpus search alike). */
  library: Array<{ id: string; label: string }>;
  /** Web pages cited in the step. */
  web: Array<{ label: string; host: string }>;
  /** The textbook passage the route check found for the step's reaction class, if any. */
  found?: string;
}

/** ORD counts as support for a step at a recorded precedent or at the "same transformation,
 *  different substrate" band of the similarity scale. */
const ORD_SUPPORT_SIMILARITY = 0.7;
const PASSAGE_LINK = /\[([^\]]+)\]\(nodus:\/\/passage\/([^)\s]+)\)/g;
const WEB_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
/** The third citation the application can emit, and the one this used to miss. An answer may
 *  cite an idea from the author's own graph — `[Author, Year](nodus://idea/<id>)`, the form every
 *  prompt pack asks for — and only passages and web pages were recognised here, so a step whose
 *  only support was an idea was counted as resting on the model's own knowledge. It belongs in the
 *  library column: an idea is the author's library, read through the graph rather than the page.
 *  `sourceFor` is a passage lookup and returns null for an idea id, which falls back to the label
 *  the answer wrote — the author and year — so the row still names its source. */
const IDEA_LINK = /\[([^\]]+)\]\(nodus:\/\/idea\/([^)\s]+)\)/g;

function citationsIn(text: string): { library: StepEvidence['library']; web: StepEvidence['web'] } {
  const library: StepEvidence['library'] = [];
  const web: StepEvidence['web'] = [];
  for (const match of text.matchAll(PASSAGE_LINK)) {
    let id = match[2];
    try { id = decodeURIComponent(id); } catch { /* keep as written */ }
    if (id.startsWith('web:')) { if (!web.some((entry) => entry.label === match[1])) web.push({ label: match[1], host: '' }); }
    else if (!library.some((entry) => entry.id === id)) library.push({ id, label: match[1] });
  }
  for (const match of text.matchAll(IDEA_LINK)) {
    let id = match[2];
    try { id = decodeURIComponent(id); } catch { /* keep as written */ }
    if (!library.some((entry) => entry.id === id)) library.push({ id, label: match[1] });
  }
  for (const match of text.matchAll(WEB_LINK)) {
    let host = '';
    try { host = new URL(match[2]).host.replace(/^www\./, ''); } catch { /* keep the label */ }
    if (!web.some((entry) => entry.host === host && entry.label === match[1])) web.push({ label: match[1], host });
  }
  return { library, web };
}

/** Where each step's support came from: the ORD lookup for the step and the citations in the
 *  step's own section of the answer. Citations outside every step are returned separately. */
export function collectStepEvidence(answer: string, stepCount: number, precedent: ReactionPrecedent | null, queries: PrecedentQuery[], support: Map<number, StepSupport> = new Map()): { steps: StepEvidence[]; elsewhere: { library: StepEvidence['library']; web: StepEvidence['web'] } } {
  const blocks = findStepBlocks(answer, stepCount);
  const similarByInput = new Map((precedent?.similar ?? []).map((item) => [item.input, item]));
  const ordByStep = new Map<number, StepEvidence['ord']>();
  (precedent?.reactions ?? []).forEach((entry, position) => {
    const step = queries[position]?.step ?? position;
    if (entry.unchanged) return;
    if (entry.count > 0) { ordByStep.set(step, { kind: 'exact', count: entry.count }); return; }
    const scores = (similarByInput.get(entry.input)?.neighbors ?? []).map((neighbor) => neighbor.similarity).filter((value): value is number => typeof value === 'number');
    if (scores.length) ordByStep.set(step, { kind: 'similar', similarity: Math.max(...scores) });
  });
  const steps = blocks.map((block, index) => ({ step: index, title: stepBlockTitle(block), ord: ordByStep.get(index) ?? null, ...citationsIn(block), ...foundPassage(support.get(index)) }));
  let rest = answer;
  for (const block of blocks) if (block) rest = rest.replace(block, '');
  const reports = rest.search(/^### (?:Route check|Structure check|Known reactions)/m);
  return { steps, elsewhere: citationsIn(reports >= 0 ? rest.slice(0, reports) : rest) };
}

function foundPassage(support: StepSupport | undefined): { found?: string } {
  const passage = support?.passage;
  const page = passage?.location ? (/^\d/.test(passage.location) ? `p. ${passage.location}` : passage.location) : null;
  return passage ? { found: `${page ? `${passage.title}, ${page}` : passage.title}${passage.scanned ? ' (scanned)' : ''}` } : {};
}

const ordSupports = (ord: StepEvidence['ord']): boolean => ord?.kind === 'exact' || (ord?.kind === 'similar' && ord.similarity >= ORD_SUPPORT_SIMILARITY);

/** The evidence summary appended to a checked route: one row per step, the four sources
 *  (Open Reaction Database, textbooks and library, web, the model's own knowledge) and a total.
 *  `sourceFor` turns a library passage id into "Title, p. N" when the library holds it. */
export function formatEvidenceSources(evidence: ReturnType<typeof collectStepEvidence>, sourceFor: (passageId: string) => string | null = () => null): string {
  const { steps, elsewhere } = evidence;
  if (!steps.length) return '';
  const library = (entries: StepEvidence['library']) => [...new Set(entries.map((entry) => sourceFor(entry.id) ?? entry.label))];
  const web = (entries: StepEvidence['web']) => [...new Set(entries.map((entry) => entry.host || entry.label))];
  const lines = ['### Where the evidence came from',
    'Generated by the application from the answer\'s own citations and the Open Reaction Database lookup (a local snapshot); the model does not write it. The database column says whether the snapshot records the step or a reaction with the same bond changes (70% similar or more); it is coverage, not a confidence score. "Found by the check" marks a textbook passage the route check looked up for the step\'s reaction class, not one the answer cited. A step with none of these rests on the model\'s own knowledge — which says where the claim comes from, not whether it is right.', '',
    '| Step | Open Reaction Database | Textbooks and library | Web |', '|---|---|---|---|'];
  let ordCount = 0, libraryCount = 0, webCount = 0, modelOnly = 0, foundCount = 0;
  for (const step of steps) {
    const ord = step.ord?.kind === 'exact' ? `recorded (${step.ord.count}×)`
      : step.ord?.kind === 'similar' ? `${Math.round(step.ord.similarity * 100)}% similar${step.ord.similarity >= ORD_SUPPORT_SIMILARITY ? ' (same transformation)' : ' (weak)'}` : '—';
    const books = library(step.library);
    const pages = web(step.web);
    const supported = ordSupports(step.ord);
    ordCount += supported ? 1 : 0;
    libraryCount += books.length ? 1 : 0;
    webCount += pages.length ? 1 : 0;
    // `step.found` counts. The block's own header lists "Found by the check" among the things
    // that stop a step resting on the model's knowledge, and the row printed the found passage
    // and "model knowledge only" side by side — the header and the row disagreeing about the
    // same step. A passage the check looked up is weaker evidence than one the answer cited,
    // which the row already distinguishes by labelling it; it is not an absence.
    const none = !supported && !books.length && !pages.length && !step.found;
    modelOnly += none ? 1 : 0;
    const title = step.title ? ` — ${step.title.replace(/\|/g, '/').slice(0, 60)}` : '';
    foundCount += step.found ? 1 : 0;
    const shelf = [...books, ...(step.found && !books.includes(step.found) ? [`${step.found} (found by the check)`] : [])];
    lines.push(`| ${step.step + 1}${title} | ${ord} | ${shelf.join('; ') || '—'} | ${pages.join('; ') || '—'}${none ? ' · _model knowledge only_' : ''} |`);
  }
  const n = steps.length;
  const otherBooks = library(elsewhere.library);
  const otherPages = web(elsewhere.web);
  // The last count is an ATTRIBUTION, and saying which kind matters. A citation is credited to a
  // step only when it sits inside that step's own block, so a source cited in a strategy preamble
  // or a closing note counts for no step and every step it actually supports reads as model
  // knowledge. Read as "unsupported", that number is simply wrong — and the sources were right
  // there, in a trailing line the reader had to join up themselves. Where any exist, the sentence
  // now says so, rather than leaving the stronger reading as the obvious one.
  const outside = otherBooks.length + otherPages.length;
  lines.push('', `**${n} step(s):** the Open Reaction Database snapshot records ${ordCount} (or the same transformation), the answer cites textbooks or library passages in ${libraryCount} and the web in ${webCount}${foundCount ? `, the check found a textbook passage for ${foundCount}` : ''}; ${modelOnly} ${modelOnly === 1 ? 'cites nothing of its own and rests' : 'cite nothing of their own and rest'} on the model's own knowledge.${outside ? ` A citation counts for a step only inside that step's own text, and this answer cites ${outside} further source${outside === 1 ? '' : 's'} outside the steps, so ${modelOnly === 1 ? 'that step' : `some of those ${modelOnly}`} may rest on the sources listed below rather than on nothing.` : ''}`);
  if (outside) lines.push('', `Cited outside the steps: ${[...otherBooks, ...otherPages].join('; ')}.`);
  return `\n${lines.join('\n')}\n`;
}

/** The “Step N — <title>” heading and the paragraph under it for each step, in step order, so
 *  the route review can judge the transformation the author intended, not only the species.
 *  The heading already names the reaction ("Dehydration of citric acid…"); the prose explains
 *  it. Missing steps are empty strings. */
export function findStepProse(text: string, count: number): string[] {
  // Each step's prose is read from its own section (see findStepConditions); a duplicated summary
  // "Step 1" heading without species is not taken for step 1.
  const sections = stepSections(text);
  if (sections) {
    return Array.from({ length: count }, (_, index) => {
      const section = sections[index];
      if (!section) return '';
      const block = text.slice(section.start, section.end);
      const firstLine = block.split(/\r?\n/)[0] ?? '';
      const heading = (HASH_HEADING.exec(firstLine) ?? BOLD_HEADING.exec(firstLine))?.[1];
      if (heading !== undefined) return stepProseText(heading.trim(), block);
      // A bold lead-in ("**Step 2: aldol addition.** Treat the triketone…"): the first line is the
      // paragraph itself, so keep what follows the bold title as the step's prose.
      const leadIn = BOLD_LEAD_IN.exec(firstLine);
      if (leadIn) return stepProseText(leadIn[1].trim(), `\n${firstLine.slice(leadIn[0].length)}${block.slice(firstLine.length)}`);
      // Neither a heading nor a bold title: the first line is already the step's prose.
    return stepProseText('', `\n${block}`);
    });
  }
  // No sections: split on the step openings ("## Step 1 …", "**Step 1 — …**", or a bold lead-in
  // that opens the paragraph, "**Step 1: … .** Treat…") as the evidence summary does.
  return findStepBlocks(text, count).map((block) => {
    if (!block) return '';
    const firstLine = block.split(/\r?\n/)[0] ?? '';
    const heading = (HASH_HEADING.exec(firstLine) ?? BOLD_HEADING.exec(firstLine))?.[1];
    if (heading !== undefined) return stepProseText(heading.trim(), block);
    const leadIn = BOLD_LEAD_IN.exec(firstLine);
    if (leadIn) return stepProseText(leadIn[1].trim(), `\n${firstLine.slice(leadIn[0].length)}${block.slice(firstLine.length)}`);
    // Neither a heading nor a bold title: the first line is already the step's prose.
    return stepProseText('', `\n${block}`);
  });
}

// ---------------------------------------------------------------- species labels

/** A role marker wherever it appears: line-leading, bulleted, inline in a paragraph, and
 *  wrapped in the backticks or bold a model likes to use (`` `Reactants:` ``, `**Products:**`).
 *  The colon is required so ordinary prose ("each reactant") is never mistaken for a label. */
/** Blanks before a label are taken only from the start of their run (`(?<![ \t])`). A bare
 *  `[ \t]*` ahead of `\b` is retried from every position of a run of blanks, which is quadratic
 *  in the run — and `maskDrawnRegions` turns every drawing into exactly such a run: a 100 KB
 *  picture took 13 s to scan, per call. The match still starts where it did, so every offset into
 *  the answer is unchanged. */
const ROLE_MARKER = /(?:(?:`{1,2}|\*\*|__)[ \t]*|(?<![ \t])[ \t]+)?\b(reactants?|products?|by[-\s]?products?|agents?)[ \t]*[:：][ \t]*(?:`{1,2}|\*\*|__)?/gi;
/** The name-first path reads only the four plural labels the contract asks for. A model's
 *  prose sentence that begins with a singular "Product:" (its own summary, beside the real
 *  `Products:` list) is therefore not mistaken for a species label. The legacy path keeps the
 *  singular-tolerant `ROLE_MARKER` so older answers still parse. */
const NAME_ROLE_MARKER = /(?:(?:`{1,2}|\*\*|__)[ \t]*|(?<![ \t])[ \t]+)?\b(reactants|products|by[-\s]?products|agents)[ \t]*[:：][ \t]*(?:`{1,2}|\*\*|__)?/gi;
/** A markdown heading (`## …`) or a wholly bold line (`**…**`). The route's step headings are
 *  the subset whose title begins with "Step N"; a heading like "Alternative for Step 3" is a
 *  section of the answer, not a step, and its labels are not part of the sequential route. */
const HASH_HEADING = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)\s*$/;
const BOLD_HEADING = /^[ \t]{0,3}\*\*([^*]+)\*\*[ \t]*$/;
const STEP_TITLE = /^step\b[ \t]*\d+/i;
/** A bold title that opens a paragraph ("**Step 2: aldol addition.** Treat…"). */
const BOLD_LEAD_IN = /^[ \t]{0,3}(?:\d+[.)][ \t]+)?(?:\*\*|__)([^*_]+?)(?:\*\*|__)[ \t]*/;
function roleOf(label: string): { role: RouteLabelRole; byproduct: boolean } | null {
  const value = label.toLowerCase().replace(/\s+/g, '');
  if (value.startsWith('reactant')) return { role: 'reactant', byproduct: false };
  if (value.startsWith('byproduct') || value.startsWith('by-product')) return { role: 'product', byproduct: true };
  if (value.startsWith('product')) return { role: 'product', byproduct: false };
  if (value.startsWith('agent')) return { role: 'agent', byproduct: false };
  return null;
}

/** A systematic name for an assembled chain is long, and cutting one leaves it SYNTACTICALLY
 *  INCOMPLETE, so it can never resolve — the step is then reported as "no structure resolved",
 *  which reads as the author's naming problem when it was our cut. Observed on a six-unit chain:
 *  five steps unbuilt, every rejected name exactly 200 characters long.
 *
 *  Sized from the longest target in the suite rather than guessed. At roughly 40 characters per
 *  unit in the nested style a model actually writes: 13 units ~580, 32 units ~1,340, 40 units
 *  ~1,660. The bound is only a guard against a runaway reply, so it clears the longest by more
 *  than twice and matches the 4000 already used for a declared structure in this file. */
export const MAX_SPECIES_NAME = 4000;

/** The typographic hyphens and primes a model writes into a name (`4‑nitrophenol` with U+2011,
 *  `N,N′-dicyclohexylurea`, `2−methylpropan−2−ol`), as the ASCII the references hold. The local
 *  PubChem mirror matches a synonym exactly, so each of these missed it and went to the network
 *  service, through the pacer, for a name the mirror had. */
function asciiNamePunctuation(name: string): string {
  return name.replace(/[\u2010-\u2013\u2212\uFE63\uFF0D]/g, '-').replace(/[\u2032\u2019]/g, "'").replace(/\u2033/g, "''").replace(/\u2034/g, "'''");
}

function cleanSpeciesName(raw: string): string {
  return asciiNamePunctuation(raw).replace(/^[\s>*_`:：-]+/, '').replace(/[\s*_`]+$/, '').replace(/\s+/g, ' ').trim().slice(0, MAX_SPECIES_NAME);
}

/** Whether a parsed species name can be a chemical name at all. A model that draws its route
 *  as an inline SVG writes the role labels into the picture too ("Byproducts: isobutylene, CO2…"
 *  inside a `<text>` element), and those were read as species: they cannot resolve, so the step
 *  they land on is emptied and reported as unbuilt even though the author's own list was
 *  complete. Markup is not a name. */
function isNameLikeSpecies(name: string): boolean {
  // Braces are NOT a tell: they are standard IUPAC punctuation for a nested substituent prefix,
  // and every protected building block has them — "(2R)-2-{[(9H-fluoren-9-yl)methoxycarbonyl]
  // amino}-3-(pyridin-3-yl)propanoic acid". Rejecting them dropped exactly those species from
  // the declaration, silently: the step kept its other reactant, the balance was computed on an
  // equation nobody wrote, and the author was told a species it HAD declared was missing. The
  // markup this guard exists for carries angle brackets, quotes, backslashes, pipes or newlines,
  // and a capability fence's JSON payload is already blanked by maskDrawnRegions.
  return !/[<>\\"\n\r\t|]/.test(name) && !name.includes('→');
}

/** The answer with the blocks the interface renders specially blanked, the same length, so
 *  offsets into it still address the original text. A species list the author wrote in prose, in
 *  an ordinary code fence or in a table is untouched.
 *
 *  A model may emit its own picture through a capability fence (`nodus-view`, which
 *  splitChatVisuals classifies as a view, not prose) and hand-write the SVG inside it. Seen on a
 *  solid-phase route: the drawing repeated the role labels in its `<text>` elements and ran out
 *  before `</svg>`, so one `Byproducts:` inside the picture claimed every character to the end of
 *  the answer and two fragments of markup became species of that step. They resolve to nothing,
 *  so the step was emptied and reported as unbuilt although the author's own list was complete.
 *  A picture of a route is not a declaration of one. */
function maskDrawnRegions(text: string): string {
  const blank = (value: string, from: number, to: number) =>
    value.slice(0, from) + ' '.repeat(Math.max(0, to - from)) + value.slice(to);
  let out = text;
  // A capability fence carries a structured payload, not a species list. An unclosed one runs to
  // the end of the answer, which is what a truncated drawing leaves behind.
  for (const open of [...text.matchAll(/```nodus-[A-Za-z0-9_-]*/g)].reverse()) {
    const from = open.index ?? 0;
    const close = out.indexOf('```', from + open[0].length);
    out = blank(out, from, close >= 0 ? close + 3 : out.length);
  }
  // Raw markup outside a fence, with the same allowance for a drawing that was cut off.
  for (const open of [...out.matchAll(/<svg\b/gi)].reverse()) {
    const from = open.index ?? 0;
    const close = /<\/svg\s*>/i.exec(out.slice(from));
    const fence = out.indexOf('```', from);
    const to = close ? from + (close.index ?? 0) + close[0].length : fence >= 0 ? fence : out.length;
    out = blank(out, from, to);
  }
  return out;
}

interface RoleSegment { role: RouteLabelRole; byproduct: boolean; start: number; end: number }

/** Every labelled segment, in document order, with the span of text that belongs to it. */
function roleSegments(text: string, pattern: RegExp = ROLE_MARKER): RoleSegment[] {
  const markers = [...text.matchAll(pattern)];
  const segments: RoleSegment[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const parsed = roleOf(marker[1] ?? '');
    if (!parsed) continue;
    const start = (marker.index ?? 0) + marker[0].length;
    const end = index + 1 < markers.length ? (markers[index + 1].index ?? text.length) : text.length;
    segments.push({ role: parsed.role, byproduct: parsed.byproduct, start, end });
  }
  return segments;
}

interface SectionHeading { offset: number; step: boolean }

/** Every heading in the answer, flagged as a route step (its title starts with "Step N") or
 *  not (an alternative, a notes section, the target summary). */
function sectionHeadings(text: string): SectionHeading[] {
  const out: SectionHeading[] = [];
  let offset = 0;
  for (const line of text.split(/\r?\n/)) {
    const match = HASH_HEADING.exec(line) ?? BOLD_HEADING.exec(line);
    let title = (match?.[1] ?? '').trim();
    // A step opened by a bold lead-in with its prose on the same line ("**Step 1 — Isomerisation.**
    // The pinane skeleton…") is a step heading too. Without it, an answer mixing that style with
    // full-line headings lost the lead-in steps, and every later step's prose moved up a place.
    if (!title) {
      const lead = BOLD_LEAD_IN.exec(line)?.[1]?.trim() ?? '';
      if (lead && STEP_TITLE.test(lead)) title = lead;
    }
    if (title) out.push({ offset, step: STEP_TITLE.test(title) });
    offset += line.length + 1;
  }
  return out;
}

/** The offset of the most recent heading at or before `offset`, if it is a step heading. A
 *  segment under a later non-step heading (an "Alternative…", a notes block) returns null. */
function lastStepHeadingOffset(headings: SectionHeading[], offset: number): number | null {
  let last: SectionHeading | null = null;
  for (const heading of headings) { if (heading.offset <= offset) last = heading; else break; }
  return last && last.step ? last.offset : null;
}

/** The route's steps as sections of the answer: each step heading that has species listed under
 *  it (the same headings the species are assigned by, so a prose-only summary "Step 1" is not a
 *  step), running to the next heading. Null when the answer has no such headings. */
function stepSections(text: string): Array<{ start: number; end: number }> | null {
  const headings = sectionHeadings(text);
  if (!headings.some((heading) => heading.step)) return null;
  const segments = roleSegments(text, NAME_ROLE_MARKER);
  const active = [...new Set(segments.map((segment) => lastStepHeadingOffset(headings, segment.start)).filter((offset): offset is number => offset !== null))].sort((a, b) => a - b);
  if (!active.length) return null;
  return active.map((start) => ({ start, end: headings.find((heading) => heading.offset > start)?.offset ?? text.length }));
}

// ---------------------------------------------------------------- name-first route

/** A species the answer names without a structure: the model gives the IUPAC name and the
 *  role, and the application derives the SMILES from the name. `declaredSmiles` is kept only
 *  as a fallback for a name the references cannot resolve. */
export interface NamedSpecies {
  role: RouteLabelRole;
  byproduct: boolean;
  name: string;
  declaredSmiles?: string;
}

/** A named species after the reference services resolved it, or failed to. `source` is the
 *  resolver that produced the structure, or `declared` when the model's own SMILES was used
 *  as a fallback. */
export interface ResolvedSpecies extends NamedSpecies {
  status: 'resolved' | 'fallback' | 'unresolved';
  smiles?: string;
  formula?: string;
  source?: 'pubchem' | 'opsin' | 'declared' | 'builtin';
  feedback?: string;
}

/** Where a role segment's species list ends: at the first blank line or block marker. Without
 *  this the last `Agents:` segment would run to the end of the answer and swallow the summary,
 *  the target artifacts and the route report as if they were species names. */
function speciesListEnd(text: string, start: number, end: number): number {
  let offset = start;
  const lines = text.slice(start, end).split('\n');
  for (let index = 0; index < lines.length && index < 8; index += 1) {
    const trimmed = lines[index].replace(/\r$/, '').trim();
    // The list ends at a blank line, a heading/block marker, or any further role label —
    // including a singular prose "Product:" that the name-first path does not treat as a label.
    const boundary = !trimmed
      || /^(#{1,6}\s|nodus-|```|\{|\||<\?xml|<\w|>)/.test(trimmed)
      || /^[>*_`\s]*(reactants?|products?|by[-\s]?products?|agents?)\b[ \t]*[:：]/i.test(trimmed);
    if (index > 0 && boundary) break;
    offset += lines[index].length + (index < lines.length - 1 ? 1 : 0);
  }
  return Math.min(offset, end);
}

interface RoleEntry { name: string; declaredSmiles?: string; start: number; end: number }

/** Entry spans split on `;`/newlines, but not inside parentheses — so "none (H₂SO₄ is consumed…;
  * the product is obtained after neutralization)" stays one entry. When the parentheses do not
  * balance (a name like "ε-caprolactam (azepan-2-one" with no closing), fall back to a plain
  * split so an unclosed bracket cannot swallow the rest of the list. The full-width `；` of an
  * answer written in Chinese or Japanese separates entries too, as the role markers already accept
  * its full-width colon; read as one name, two species resolved to nothing. */
function splitEntrySpans(list: string): Array<{ start: number; end: number }> {
  let balance = 0;
  for (const character of list) { if (character === '(') balance += 1; else if (character === ')') balance = Math.max(0, balance - 1); }
  const spans: Array<{ start: number; end: number }> = [];
  if (balance !== 0) {
    for (const match of list.matchAll(/[^;；\n]+/g)) spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
    return spans;
  }
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= list.length; index += 1) {
    const character = list[index];
    if (index === list.length || (depth === 0 && (character === ';' || character === '；' || character === '\n'))) {
      if (index > start) spans.push({ start, end: index });
      start = index + 1;
    } else if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
  }
  return spans;
}

/** Split one role fragment into entries with their offsets, so the species list can be
 *  rewritten in place without touching the prose around it. An entry may still carry a legacy
 *  `name — \`smiles\`` pair, kept as a fallback; otherwise the entry is the name alone. */
function parseRoleEntries(fragment: string): RoleEntry[] {
  const out: RoleEntry[] = [];
  const list = fragment.slice(0, speciesListEnd(fragment, 0, fragment.length));
  let first = true;
  for (const span of splitEntrySpans(list)) {
    const raw = list.slice(span.start, span.end);
    const entry = raw.replace(/^[\s>*_`]+/, '').trim();
    if (!entry) continue;
    const leading = first;
    first = false;
    const pair = /^(.+?)\s*[—–]\s*`([^`]+)`/.exec(entry);
    if (pair) {
      const name = cleanSpeciesName(pair[1]);
      if (name && isNameLikeSpecies(name)) out.push({ name, declaredSmiles: pair[2].trim(), start: span.start, end: span.end });
      continue;
    }
    const name = cleanSpeciesName(entry.replace(/[—–]?\s*`[^`]*`/g, '').replace(/[*_`]/g, '').replace(/[.,;:\s]+$/, ''));
    // A side that opens with "none" is empty, and whatever follows on it is the author explaining
    // why ("Byproducts: none; the rearrangement loses no atoms"). Read as a species, that sentence
    // became a byproduct no reference resolves: a name-correction call, then an unbuilt step.
    // A bare "NO" stays a formula the step may need, so only "no <word>" opens an empty side.
    if (leading && (/^(?:none|n\/a|nil)\b|^no\s/i.test(name) || /^[—–-]+$/.test(name))) break;
    if (!name || !isNameLikeSpecies(name) || /^(?:none|no|n\/a|nil)\b/i.test(name) || /^[—–-]+$/.test(name)) continue;
    out.push({ name, start: span.start, end: span.end });
  }
  return out;
}

interface NamedSegment { step: number; role: RouteLabelRole; byproduct: boolean; entries: RoleEntry[]; listStart: number }

/** Every named role segment, assigned to its step. In the name-first path only the plural
 *  labels count; a non-step section (an "Alternative…") is skipped; without headings the role
 *  cycle splits the steps. */
function namedSegments(answer: string, count: number): NamedSegment[] {
  const text = maskDrawnRegions(answer);
  const segments = roleSegments(text, NAME_ROLE_MARKER);
  if (!segments.length) return [];
  const headings = sectionHeadings(text);
  const out: NamedSegment[] = [];
  if (headings.some((heading) => heading.step)) {
    // Assign by the step heading a segment actually sits under, so a duplicated summary heading
    // (a prose "Step 1" followed by a species-list "Step 1") does not create phantom steps.
    const active = [...new Set(segments.map((segment) => lastStepHeadingOffset(headings, segment.start)).filter((offset): offset is number => offset !== null))].sort((a, b) => a - b);
    for (const segment of segments) {
      const offset = lastStepHeadingOffset(headings, segment.start);
      if (offset === null) continue; // an alternative or notes section, not a step
      const step = Math.min(active.indexOf(offset), Math.max(0, count - 1));
      const boundary = headings.find((heading) => heading.offset > segment.start && heading.offset < segment.end)?.offset ?? segment.end;
      out.push({ step, role: segment.role, byproduct: segment.byproduct, listStart: segment.start, entries: parseRoleEntries(text.slice(segment.start, boundary)) });
    }
    return out;
  }
  let step = 0;
  let sawProduct = false;
  for (const segment of segments) {
    if (segment.role === 'reactant' && sawProduct) { step = Math.min(step + 1, count - 1); sawProduct = false; }
    if (segment.role === 'product') sawProduct = true;
    out.push({ step, role: segment.role, byproduct: segment.byproduct, listStart: segment.start, entries: parseRoleEntries(text.slice(segment.start, segment.end)) });
  }
  return out;
}

/** How many numbered steps the answer contains: the number of step headings that actually
 *  carry species, or the role cycle (a new step begins at a `Reactants:` that follows a
 *  product) when there are no headings. A prose summary heading with no species under it does
 *  not count, so a route written twice is still one route. */
export function countRouteSteps(answer: string): number {
  const text = maskDrawnRegions(answer);
  const segments = roleSegments(text, NAME_ROLE_MARKER);
  const headings = sectionHeadings(text);
  const stepHeadings = headings.filter((heading) => heading.step);
  if (stepHeadings.length) {
    if (!segments.length) return stepHeadings.length;
    const active = new Set(segments.map((segment) => lastStepHeadingOffset(headings, segment.start)).filter((offset): offset is number => offset !== null));
    return active.size || stepHeadings.length;
  }
  if (!segments.length) return 0;
  let count = 1;
  let sawProduct = false;
  for (const segment of segments) {
    if (segment.role === 'reactant' && sawProduct) { count += 1; sawProduct = false; }
    if (segment.role === 'product') sawProduct = true;
  }
  return count;
}

/** A note the author put after a name, in parentheses after a space: "sodium borohydride (1.2
 *  equiv)", "sulfuric acid (cat.)", "ethanal (distilled off as it forms)", a trivial name after the
 *  systematic one. The contract asks for names only, a model adds these anyway, and no reference
 *  holds the name with its note: a reactant or product so written cost a name-correction call to the
 *  model, an agent was simply never resolved. Only a note with a lowercase word goes, so an oxidation
 *  state, a charge or a descriptor written apart ("palladium (0)", "copper (II)", "(2R)") stays. */
function withoutTrailingNote(name: string): string {
  let out = name;
  for (let match = /\s+\(([^()]*)\)$/.exec(out); match && /[a-z]{2}/.test(match[1]) && match.index > 0; match = /\s+\(([^()]*)\)$/.exec(out)) {
    out = out.slice(0, match.index).trimEnd();
  }
  return out;
}

/** The names the answer assigns to each step, in document order per step. */
export function findStepNamedSpecies(text: string, count: number): NamedSpecies[][] {
  if (count < 1) return [];
  const steps: NamedSpecies[][] = Array.from({ length: count }, () => []);
  for (const segment of namedSegments(text, count)) {
    for (const entry of segment.entries) {
      if (steps[segment.step].length >= 48) break;
      steps[segment.step].push({ role: segment.role, byproduct: segment.byproduct, name: withoutTrailingNote(entry.name), ...(entry.declaredSmiles ? { declaredSmiles: entry.declaredSmiles } : {}) });
    }
  }
  return steps;
}

/** Build one `reactants>agents>products` line per step from the resolved species. Each ion is
 *  written once per side and the coefficient is left to the solver, as the contract asks: a
 *  named salt resolves to its ions, and two salts sharing an ion (`chromium(III) sulfate` and
 *  `sodium sulfate`) would otherwise put the same token on one side twice, which admits more
 *  than one balance. A step with no reactant or no product cannot form an equation: it stays as
 *  an empty line, so every later step keeps its number and lines up with its labels, prose and
 *  conditions, and the checker reports that step as unbuilt. */
export function buildRouteSteps(speciesByStep: Array<Array<Pick<ResolvedSpecies, 'role' | 'smiles'>>>): string[] {
  // Every fragment of every species, in order, with nothing dropped. The components of one
  // species are written out because a reaction SMILES has no other way to carry them; the
  // package regroups them from the labels, so a salt still counts once and takes one coefficient.
  //
  // This used to discard a repeated token, to stop two salts sharing an ion from putting the same
  // token on one side twice. That cost atoms: the set was per ROLE, so calcium chloride written
  // as `[Ca+2].[Cl-].[Cl-]` lost a chloride, and any salt with repeated counterions — magnesium
  // bromide, sodium sulfate, potassium carbonate — could then never balance. Losing an atom to
  // avoid an ambiguous balance is the wrong trade: a duplicate token is at worst reported as
  // several possible equations, which the author can see and fix, while a missing atom is a
  // verdict on an equation nobody wrote.
  const fragments = (step: Array<Pick<ResolvedSpecies, 'role' | 'smiles'>>, role: RouteLabelRole): string[] => {
    const out: string[] = [];
    for (const entry of step.filter((item) => item.role === role)) {
      for (const part of (entry.smiles ?? '').split('.')) {
        const token = part.trim();
        if (token) out.push(token);
      }
    }
    return out;
  };
  return speciesByStep.map((step) => {
    // A reactant or product the resolver could not turn into a structure must not just be left
    // out. What remains is a different equation, and the checker then returns a verdict on a
    // step the author never wrote: a cyclisation whose precursor and product were both name-only
    // came back as "oxygen -> water", failing because "the reactants lack exactly H2". An empty
    // step is reported as unbuilt instead, which is what the author has to fix. Agents take no
    // part in the balance, so a condition that does not resolve — a named coupling reagent, a
    // buffer — is still dropped and the step still checked.
    if (step.some((entry) => entry.role !== 'agent' && !(entry.smiles ?? '').trim())) return '';
    const reactants = fragments(step, 'reactant');
    const agents = fragments(step, 'agent');
    const products = fragments(step, 'product');
    if (!reactants.length || !products.length) return '';
    return `${reactants.join('.')}>${agents.join('.')}>${products.join('.')}`;
  });
}

/** Whether a SMILES contains carbon: an organic-subset `C`/`c`, or a bracket atom whose element is
 *  carbon (`[C@@H]`, `[cH]`), never `Cl`, `Ca`, `Cs` or `Co`. */
export function smilesHasCarbon(smiles: string): boolean {
  for (const match of smiles.matchAll(/\[([^\]]+)\]|Cl|Br|[BCNOPSFI]|[bcnops]/g)) {
    const element = match[1] !== undefined ? (/^\d*([A-Z][a-z]?|[a-z]{1,2})/.exec(match[1])?.[1] ?? '') : match[0];
    if (element === 'C' || element === 'c') return true;
  }
  return false;
}

/** A carbon-free species a step lists as a main product beside an organic one — sodium chloride,
 *  water, a hydrogen halide — is a co-product, so it is shown, corrected and looked up as a
 *  byproduct. Products and byproducts are both the product side of the equation, so the equation
 *  the checker balances, and its coefficients, are unchanged. */
export function classifyCoProducts<T extends { role: RouteLabelRole; byproduct: boolean; smiles?: string }>(step: T[]): T[] {
  const organicProduct = step.some((entry) => entry.role === 'product' && !entry.byproduct && entry.smiles && smilesHasCarbon(entry.smiles));
  if (!organicProduct) return step;
  return step.map((entry) => entry.role === 'product' && !entry.byproduct && entry.smiles && !smilesHasCarbon(entry.smiles) ? { ...entry, byproduct: true } : entry);
}

/** The steps as looked up in the reaction index: byproducts are left out, because the Open
 *  Reaction Database records a reaction's main product and an extra species never matches. A
 *  step that marks every product as a byproduct keeps them all rather than being dropped. */
export function buildPrecedentQueries(labels: RouteSpeciesLabel[][]): PrecedentQuery[] {
  return labels.flatMap((step, index) => {
    const main = step.filter((entry) => !(entry.role === 'product' && entry.byproduct));
    // Built one step at a time so an unusable step does not shift the later step numbers.
    const [query] = buildRouteSteps([main.some((entry) => entry.role === 'product') ? main : step]);
    return query ? [{ step: index, query }] : [];
  });
}

/** Attach the resolved SMILES to each species entry in place, replacing any declared SMILES.
 *  Only the species-list span of each role segment is rewritten, so a name that is a substring
 *  of another ("cyclohexanone" in "cyclohexanone oxime"), and the prose and headings around it,
 *  are left untouched. Each resolved entry lines up positionally with the parsed entry. */
export function annotateSpeciesSmiles(answer: string, speciesByStep: ResolvedSpecies[][]): string {
  const segments = namedSegments(answer, speciesByStep.length);
  const cursor = new Map<number, number>();
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const segment of segments) {
    const start = cursor.get(segment.step) ?? 0;
    const resolved = speciesByStep[segment.step].slice(start, start + segment.entries.length);
    cursor.set(segment.step, start + segment.entries.length);
    segment.entries.forEach((entry, index) => {
      const match = resolved[index];
      const name = match?.name ?? entry.name;
      const smiles = match?.smiles;
      replacements.push({ start: segment.listStart + entry.start, end: segment.listStart + entry.end, text: smiles ? `${name} — \`${smiles}\`` : name });
    });
  }
  let out = answer;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, replacement.start) + replacement.text + out.slice(replacement.end);
  }
  return out;
}

/** A placeholder the author wrote where a species belongs: "see prose", "as above", "see step 2".
 *  It is not a name a resolver could ever turn into a structure, and asking for "its structure"
 *  invites the author to invent one. Seen live: a step whose Byproducts line read "see prose",
 *  which made the whole step uncheckable. The rules already say a step that gives its species
 *  only in prose cannot be checked; this names the specific thing the author did. */
export function isPlaceholderSpecies(name: string): boolean {
  return /^(?:see|as)\b[^.]{0,40}\b(?:prose|above|below|text|step\s*\d*|described|discussion|list)\b/i.test(name.trim())
    || /^(?:unchanged|same as|ditto|various|etc\.?|multiple|several)\b/i.test(name.trim());
}

/** A condition the Agents line names in place of a substance: a temperature, a time, a pressure,
 *  light or heat ("110 °C", "12 h", "reflux", "hν"). The contract invites them there ("or other
 *  condition the step does not consume"), and no reference holds one, so looking one up only spends
 *  a turn of the PubChem pacer (0.2 s, 1 s or 5 s each, one at a time) to learn that. Whole entries
 *  only: "10% palladium on carbon" or "2 M hydrochloric acid" is a substance and is still resolved. */
const CONDITION_QUANTITY = /^(?:[-−~≈<>≤≥]?\s*\d[\d.,]*\s*(?:[-–−]\s*\d[\d.,]*\s*)?(?:°\s*[CF]|K|h|hrs?|hours?|min|minutes?|days?|atm|bar|mbar|psi|torr|kPa|MPa|nm)(?![\p{L}\d])[\s,;]*)+$/iu;
const CONDITION_WORD = /^(?:rt|r\.t\.|room temperature|ambient temperature|reflux(?:ing)?|at reflux|heat(?:ing)?|Δ|hν|h\s*ν|light|uv light|visible light|uv irradiation|irradiation|microwave(?: irradiation| heating)?|overnight|sonication|ultrasound|inert atmosphere)$/i;

export function isConditionPhrase(name: string): boolean {
  const value = name.trim();
  return CONDITION_QUANTITY.test(value) || CONDITION_WORD.test(value);
}

/** A species name as the resolver feedback may return it: a short label with letters, and no
 *  markup or escaped syntax. A reply that smuggled an SVG, a JSON fragment or a newline into a
 *  name is not shown to the user as a "correction". */
function isPlausibleSpeciesName(value: string): boolean {
  return value.length >= 2 && value.length <= MAX_SPECIES_NAME
    && /[A-Za-z]/.test(value)
    && !/[<>{}\\\n\r\t`|"]/.test(value)
    && !value.includes('→');
}

/** A compact, user-facing note listing the names the resolver corrected, or the empty string
 *  when nothing changed. A full declared-vs-resolved table was a temporary debug aid. Entries
 *  that are not two plausible names, and names corrected twice (A → B, B → C), are folded so
 *  the note stays a short list of the names that actually changed. */
export function formatNameCorrectionNote(corrections: string[]): string {
  const rename = new Map<string, string>();
  for (const raw of corrections) {
    const [from, to] = String(raw).split('→').map((part) => part.trim());
    if (!from || !to || from === to) continue;
    if (!isPlausibleSpeciesName(from) || !isPlausibleSpeciesName(to)) continue;
    rename.set(from, to);
  }
  const resolve = (name: string): string => {
    let current = name;
    const seen = new Set<string>();
    while (rename.has(current) && !seen.has(current)) { seen.add(current); current = rename.get(current)!; }
    return current;
  };
  const intermediates = new Set(rename.values());
  const entries: string[] = [];
  for (const from of rename.keys()) {
    if (intermediates.has(from)) continue; // a name that was itself only an intermediate
    const to = resolve(from);
    const entry = `${from} → ${to}`;
    if (from !== to && !entries.includes(entry)) entries.push(entry);
  }
  return entries.length ? `Name corrections: ${entries.join('; ')}` : '';
}

/** App report sections an assistant turn carries, as they appear in replayed history. The route
 *  drawings are always dropped: once their pictures are stripped, only empty step labels and a
 *  "Not drawn" list repeating the route check remain. The structure and route checks are kept
 *  for the latest answer only, as are the model review, its "Check failed" recap and the known
 *  reactions: that is the route the next turn corrects, and every earlier one has been superseded
 *  (a correction prompt repeats the failures it asks about anyway). */
const HISTORY_ALWAYS_DROPPED = ['### Route drawings (RDKit)', '### Where the evidence came from'];
const HISTORY_LATEST_ONLY = [
  '### Structure check (RDKit)', '### Route check (RDKit)',
  '### Route review (model)', '### Route review (model, advisory)',
  '### Known reactions (Open Reaction Database)',
  '### Known reactions (textbook schemes)', '### Functional-group compatibility',
];
/** App notes that follow the reports without a heading of their own; a dropped section ends there. */
const HISTORY_NOTE = /^(?:Name corrections:|Author-supplied structures)/;

/** An earlier correction prompt as replayed in history: what failed and what could change are
 *  kept, the shared species rules it carried are not — every correction repeats the same rules,
 *  and the current prompt carries them in full. Any other message is returned unchanged. */
export function routeFixPromptForHistory(text: string): string {
  if (!isRouteFixPrompt(text)) return text;
  const cut = text.indexOf('\nRules for every step:');
  return cut < 0 ? text : `${text.slice(0, cut).trimEnd()}\n[The shared route rules followed here.]`;
}

/** Every picture, wherever it sits, replaced by a word. A drawing has already been rendered and
 *  read; replaying its markup only spends the window.
 *
 *  Dropping the route drawings section was not enough. A precedent section is KEPT for the latest
 *  answer — it is the evidence the next turn reasons from — and it carries drawings of its own, so
 *  a correction turn still replayed them. Measured on a real route: 652,000 characters of answer,
 *  604,000 of it SVG, and the model opened its reply with "the complete preceding answer is not
 *  included in the supplied history… below is a complete reconstruction". It then rebuilt the route
 *  from scratch rather than correcting it, and the step count swung 9 -> 2 -> 8 -> 2 -> 9 across
 *  four rounds. The pictures had pushed the route out of the window.
 *
 *  An unterminated `<svg` is handled too: a truncated drawing otherwise claims the rest of the
 *  answer, which is the same fault the species parser had to be taught about. */
function withoutDrawings(prose: string): string {
  return prose
    .replace(/<svg[\s\S]*?<\/svg>/gi, '[drawing omitted from history]')
    .replace(/<svg[\s\S]*$/i, '[drawing omitted from history]');
}

export function routeReportsForHistory(prose: string, latest: boolean): string {
  const dropped = latest ? HISTORY_ALWAYS_DROPPED : [...HISTORY_ALWAYS_DROPPED, ...HISTORY_LATEST_ONLY];
  const kept: string[] = [];
  let skipping = false;
  for (const line of withoutDrawings(prose).split('\n')) {
    if (dropped.includes(line.trim())) { skipping = true; continue; }
    if (skipping && (/^#{1,3}\s/.test(line) || HISTORY_NOTE.test(line))) skipping = false;
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The request's target, from the usual phrasing "a synthesis of <name> (SMILES: <smiles>)".
 *  A SMILES named after "from", "starting" or "using" is a starting material, not the target,
 *  so the match stops there rather than guess. */
// The target named after "synthesis of/for …", "synthesize …", "preparation of …" or "route to/for
// …", then "SMILES:". The name may wrap and may be a long systematic name, so the run before SMILES
// crosses newlines (up to 400 characters); it stops at a "from/starting/using/with" clause so it
// never wanders into the starting materials.
const TARGET_PATTERN = /\b(?:synthes[a-z]*(?:\s+(?:of|for))?|preparation\s+of|route\s+(?:to|for)|s[ií]ntesis\s+(?:de|del)|sintetiz[a-záéíóú]*|preparaci[oó]n\s+(?:de|del)|ruta\s+(?:de|para|hacia))\b(?:(?!\b(?:from|starting|using|with|desde|usando|con)\b|\ba\s+partir\s+de\b)[\s\S]){0,400}?\bSMILES\s*[:=]\s*`?([^\s`,;]+)/i;

/** The verb that opens a route request, and where its target description ends. The same two
 *  halves `TARGET_PATTERN` encodes, split out so the labelled and the bare form look in the same
 *  place rather than drifting apart. */
const TARGET_LEAD = /\b(?:synthes[a-z]*(?:\s+(?:of|for))?|preparation\s+of|route\s+(?:to|for)|s[ií]ntesis\s+(?:de|del)|sintetiz[a-záéíóú]*|preparaci[oó]n\s+(?:de|del)|ruta\s+(?:de|para|hacia))\b/i;
const TARGET_END = /\b(?:from|starting|using|with|desde|usando|con)\b|\ba\s+partir\s+de\b/i;

function cleanTarget(value: string): string | null {
  let out = trimSentenceEdges(value).replace(/\.+$/, '');
  // "(SMILES: CCO)" leaves the prose's closing parenthesis on the SMILES.
  const unbalanced = () => (out.match(/\)/g) ?? []).length > (out.match(/\(/g) ?? []).length;
  while (out.endsWith(')') && unbalanced()) out = out.slice(0, -1);
  return out && out.length <= 2000 && SMILES_CHARS.test(out) ? out : null;
}

/** The target of a route request: the labelled form first, then a bare structure written where
 *  the target belongs.
 *
 *  The labelled form is all this used to accept, and the cost of that was invisible. A person
 *  typing a request writes the structure bare — "a laboratory synthesis of OC(...)=O starting
 *  from standard precursors" — with no `SMILES:` anywhere, so this returned null, and
 *  `gatherSynthesisEvidence` opens by returning null on a missing target BEFORE it logs anything.
 *  The entire pre-answer gather was therefore skipped without a word: no known-reaction
 *  disconnections, no textbook passages, no candidate routes, no availability, and no evidence
 *  rule in the system prompt. Measured on two of the author's own prompts, both null, against
 *  harness prompts that write `(SMILES: …)` and had the evidence all along — so the harness and
 *  the application were not running the same system, and no measurement could be compared across
 *  them.
 *
 *  The bare form is admitted by `isBareSmilesName`, not by the looser `isSmilesLike`, and for the
 *  same reason that function exists: here a false positive sends the whole gather after a molecule
 *  nobody asked for. Every numbered name — `4-nitrotoluene`, `benzene-1,2-diamine` — satisfies the
 *  looser test because a locant reads as a ring closure, and is correctly refused by this one.
 *  The price is that a structure with no branch, bond or aromatic ring (`C1COCCO1`) is not
 *  recognised bare; it still resolves through the labelled form. */
export function findRequestedTarget(text: string): string | null {
  const labelled = TARGET_PATTERN.exec(text);
  if (labelled) return cleanTarget(labelled[1]);
  const lead = TARGET_LEAD.exec(text);
  if (!lead) return null;
  const after = text.slice(lead.index + lead[0].length, lead.index + lead[0].length + 2400);
  const end = TARGET_END.exec(after);
  for (const raw of (end ? after.slice(0, end.index) : after).split(/\s+/)) {
    const token = cleanTarget(raw);
    if (token && isBareSmilesName(token)) return token;
  }
  return null;
}

/** The first line of the route-fix prompt, so the request behind a correction can be found. */
export const ROUTE_FIX_PROMPT_LEAD = 'Correction needed for the synthesis route above.';
/** The per-step chip starts differently from the all/backwards chips; keep the lead stable so
 *  every generated correction is recognisable. */
export const ROUTE_FIX_STEP_LEAD = 'Correction needed for step ';
export const ROUTE_CLARIFICATION_LEAD = 'The species names in the synthesis route above do not match the prose, or the prose is ambiguous, and the correction could not be resolved automatically. Please confirm the intended chemistry.';
export const ROUTE_UNRESOLVED_LEAD = 'The application could not resolve some species names to structures, so those steps could not be built. For each unresolved species give its correct systematic IUPAC name, or — when you cannot name it — its isomeric SMILES (write it as its name followed by the SMILES in backticks).';
/** Said in place of a route check the application could not run, so a missing report is never
 *  mistaken for a route that needed none. */
export function formatRouteCheckUnavailable(reason: string): string {
  return `_Route check unavailable: ${reason.replace(/\s+/g, ' ').trim().slice(0, 300) || 'the chemistry package failed'}. The route above has not been checked._`;
}

/** A turn working on a route whose answer carries NO route the checker can read, so there was
 *  nothing to check.
 *
 *  The sibling case — steps present but no labelled species — already says so
 *  (ROUTE_MISSING_SPECIES_LEAD). This one said nothing: the legacy path only offers its chip when
 *  `steps > 0`, so a reply carrying no steps was returned exactly as written and the round looked
 *  like a success that produced prose.
 *
 *  First observed on a correction: it answered with two paragraphs of commentary, declining to
 *  re-state the route on the grounds that the earlier steps were missing from its context. They
 *  were not — the replayed history carried all six — and the prompt had asked in as many words for
 *  the complete route. Then observed on a first answer, which is worse: nine numbered steps with
 *  balanced equations and four citations, written with neither `Step N` headings nor the labelled
 *  lines, so `countRouteSteps` read 0 and not one of them was resolved, balanced or drawn. The
 *  reader had no way to tell that from a route that passed.
 *
 *  Which is the standing rule: a check that could not run has to say so. The harness has reported
 *  this for a while ("no route check in the answer"); the application had no equivalent.
 *
 *  `steps === 0` is precisely "no `Step N` heading AND no role label anywhere" — with headings and
 *  no labels the count is the heading count, which lands in the sibling case — so the note can
 *  name both without re-deriving which one was missing.
 *
 *  Empty when there is nothing to report, so the caller appends it unconditionally. */
export function uncheckedRouteNote(answer: string, options: { correction: boolean }): string {
  if (countRouteSteps(typeof answer === 'string' ? answer : '') > 0) return '';
  return options.correction
    ? '_This reply re-stated no route, so nothing in it could be checked or drawn. The last checked route is the one above it._'
    : UNCHECKED_ROUTE_NOTE;
}

/** The first-answer note names the four labels itself, so `countRouteSteps` reads it as a route;
 *  `routeConversationState` removes it before counting. */
const UNCHECKED_ROUTE_NOTE = '_Nothing in this reply was checked. A route is read from numbered `Step N` headings with `Reactants:`, `Products:`, `Byproducts:` and `Agents:` lines under each step, and this reply has neither, so no name was resolved, no equation was balanced and no step was drawn. Whatever steps it describes stand as unverified prose._';

/** Whether the application asked this turn for a route: a fresh request, one of its own fix
 *  chips, or a turn in a conversation whose route request no answer has met yet.
 *
 *  Written once because two places must agree on it. The prompt uses it to decide whether to send
 *  the output contract; the audit uses it to decide whether a turn that produced no readable route
 *  has to say so. If they disagree, the application either asks for a route and says nothing when
 *  none arrives, or reports an ordinary question as unchecked. */
export function asksForRoute(turns: ReadonlyArray<{ role: string; content: string }>): boolean {
  const list = Array.isArray(turns) ? turns : [];
  let latest = '';
  for (const turn of list) if (turn?.role === 'user' && typeof turn.content === 'string') latest = turn.content;
  if (isRouteFixPrompt(latest) || looksLikeSynthesisRequest(latest)) return true;
  const state = routeConversationState(list);
  return state.request !== null && !state.delivered;
}

/** What a conversation is doing about a route: the request it is working on, and whether any
 *  answer since has delivered a route the checker could read.
 *
 *  The route lane used to be decided from the latest message alone — a fresh synthesis request, or
 *  one of the application's own fix chips. A human follow-up is neither, so a conversation that
 *  had asked for a route fell out of the lane the moment the author typed a sentence of their own:
 *  no output contract was sent, no evidence was gathered, and the answer that finally carried the
 *  route was the one turn nothing was asked of. Measured on a real pair of turns — the request
 *  opened the lane, "the alpha carbon will not have stereochemistry so you can solve this
 *  directly" closed it, and the nine-step answer that followed went unchecked.
 *
 *  `request` is also the retrieval anchor. Deriving that from "the latest message that is not a fix
 *  chip" has the same hole: a human follow-up becomes the anchor, so the evidence is gathered for
 *  the follow-up sentence instead of for the target.
 *
 *  `delivered` is what keeps this from re-sending the contract forever: once an answer carries a
 *  readable route, corrections carry their own rules and this stops asking. */
export function routeConversationState(turns: ReadonlyArray<{ role: string; content: string }>): { request: string | null; delivered: boolean } {
  const list = Array.isArray(turns) ? turns : [];
  let asked = -1;
  for (let index = 0; index < list.length; index += 1) {
    const turn = list[index];
    // A correction chip names the synthesis and its rules name reagents, so a short one reads as a
    // request; it is never the conversation's request.
    if (turn?.role === 'user' && typeof turn.content === 'string' && !isRouteFixPrompt(turn.content) && looksLikeSynthesisRequest(turn.content)) asked = index;
  }
  if (asked < 0) return { request: null, delivered: false };
  const delivered = list.slice(asked + 1).some((turn) => turn?.role === 'assistant'
    && countRouteSteps(typeof turn.content === 'string' ? turn.content.split(UNCHECKED_ROUTE_NOTE).join('') : '') > 0);
  return { request: list[asked].content, delivered };
}

export const ROUTE_MISSING_SPECIES_LEAD = 'The synthesis route describes steps but does not list the species under the four required labels, so the application could not check or draw it.';

/** Whether a user message is a correction the application generated (a route-fix chip or a
 *  clarification), not a fresh research request. A correction answers the route checker: it
 *  carries no target of its own and needs no citation. */
export function isRouteFixPrompt(text: string): boolean {
  const trimmed = typeof text === 'string' ? text.trimStart() : '';
  return trimmed.startsWith(ROUTE_FIX_PROMPT_LEAD)
    || trimmed.startsWith(ROUTE_FIX_STEP_LEAD)
    || trimmed.startsWith(ROUTE_CLARIFICATION_LEAD)
    || trimmed.startsWith(ROUTE_UNRESOLVED_LEAD)
    || trimmed.startsWith(ROUTE_MISSING_SPECIES_LEAD);
}

/** The target of the conversation's current synthesis request. A correction carries no target
 *  of its own, and neither does an ordinary follow-up ("why is step 2 needed?"), so both are
 *  skipped back to the request that named one. A new synthesis request ends the search even
 *  when it names no SMILES, so an earlier route's target never carries over into a new route. */
// A request for a new route ("propose a synthesis of…", "synthesize…", "suggest a route to…"), as
// opposed to a question about the current one ("why does the synthesis need step 2?").
// A named request need not contain an imperative: "Now a synthesis of paracetamol" and
// "Ahora una ruta de síntesis de paracetamol" both replace the earlier target. Do not
// carry its structure into the new route merely because the new request gives only a name.
const NEW_ROUTE_REQUEST = /\b(?:propose|suggest|design|plan|give|outline|devise|provide)\b[^.?!\n]{0,60}\b(?:synthes[a-z]*|route)\b|\bsynthesi[sz]e\b|\b(?:synthesis|preparation)\s+(?:of|for)\b|\broute\s+(?:to|for)\b|\b(?:s[ií]ntesis|preparaci[oó]n)\s+(?:de|del)\b|\bruta\s+(?:de|para|hacia)\b|\bsintetiz[a-záéíóú]*\b/i;

export function requestedTargetFor(userMessages: string[]): string | null {
  for (let index = userMessages.length - 1; index >= 0; index--) {
    const message = userMessages[index];
    if (isRouteFixPrompt(message)) continue;
    const target = findRequestedTarget(message);
    if (target) return target;
    if (NEW_ROUTE_REQUEST.test(message)) return null;
  }
  return null;
}

// "Achiral" is not here: an achiral product has no stereocentre to excuse, and calling a chiral
// product achiral is a mistake the checker should report, not accept.
const RACEMIC_PATTERN = /\bracemic\b|\bracemate\b|\bracemi[cs]\b|\bmeso\b|\bnot\s+stereodefined\b|\bnot\s+stereo(?:chemically\s+)?(?:defined|specified|assigned)\b|\bstereo(?:chemistry)?(?:\s+(?:of|at|in)\s+(?:this|the|each|that)\s+(?:step|reaction|centres?|centers?|carbons?))?\s+(?:is\s+|are\s+)?not\s+(?:controlled|defined|specified|assigned)\b|\b(?:mixture|pair)\s+of\s+(?:enantiomers|diastereomers)\b|\bunassigned\s+stereo(?:centres?|centers?|chemistry)?\b/i;

/** Whether a step's prose declares a stereochemically open outcome. The model may state it in
 *  several ways — a racemate, a meso product, or "stereochemistry not controlled" —
 *  and each is a stated outcome, so the route audit reports the open centre as declared
 *  instead of refusing the step for leaving it unspecified. This is model prose, not a
 *  verification. */
export function declaresRacemic(text: string): boolean {
  return RACEMIC_PATTERN.test(text);
}

/** Per step: whether its own section of the answer declares an open outcome. Read from the
 *  whole section, not the 360-character prose the reviewer gets: Sonnet's declarations ("The
 *  stereochemistry of this step is not controlled. The product is racemic…") came after 324–470
 *  characters, and four correct steps failed four turns each. The labelled species lines are
 *  left out, so a name never counts as a declaration. */
export function stepDeclaresRacemic(answer: string, count: number): boolean[] {
  return stepDeclares(answer, count, declaresRacemic);
}

/** Each step's own section (labelled species lines left out, so a name never counts) tested
 *  with `declares`, falling back to the step's prose. */
function stepDeclares(answer: string, count: number, declares: (text: string) => boolean, proseOnlyWithoutBlock = false): boolean[] {
  const blocks = findStepBlocks(answer, count);
  const prose = findStepProse(answer, count);
  return Array.from({ length: count }, (_, index) => {
    const block = (blocks[index] ?? '').split(/\r?\n/).filter((line) => !/^\s*(?:[-*]\s*)?(?:`{1,2}|\*\*|__)?\s*(?:reactants|products|by[-\s]?products|agents)\s*[:：]/i.test(line)).join('\n');
    if (declares(block)) return true;
    // The prose list can fall out of step with the numbering when header styles are mixed, so a
    // declaration that clears a refusal reads it only where the numbered section is missing.
    return proseOnlyWithoutBlock && block.trim() ? false : declares(prose[index] ?? '');
  });
}

// Named on the verified-route corpus: every legitimate rearrangement there was declared with one
// of these, and "isomerisation" / "the skeleton reorganises" are how pinene → camphene is put.
const REARRANGEMENT_PATTERN = /rearrange|\bmigrat|\bisomeri[sz]|\breorgani[sz]|\bskeletal\s+(?:change|shift)|\b1,2-(?:alkyl\s+|hydride\s+|methyl\s+|aryl\s+)?shift|\bwagner|\bmeerwein|\bpinacol|\bbenzilic|\bfavorskii|\bwolff\b|\barndt|\bcope\b|\bclaisen\s+rearr|\bsemipinacol|\btiffeneau|\bdemjanov|\bring\s+(?:expansion|contraction)|\bschleyer|\bmetathesis/gi;
const RADICAL_PATTERN = /\bradical|\bphotochem|\bhν|\bhv\b|\bNBS\b|N-bromosuccinimide|\bperoxide\s+initiat|\bAIBN\b|\bC[–-]H\s+(?:activation|functionali[sz]ation|insertion|oxidation)|\bhofmann[–-]l[öo]ffler/gi;
// "No rearrangement occurs", "without a 1,2-shift": a negated mention is not a declaration.
const NEGATED = /\b(?:no|not|without|nor|never|neither|avoids?|avoiding|rather\s+than|instead\s+of|free\s+of)\b[^.;:]{0,30}$/i;

function declaresUnnegated(pattern: RegExp, text: string): boolean {
  for (const match of text.matchAll(pattern)) {
    if (!NEGATED.test(text.slice(Math.max(0, match.index! - 40), match.index))) return true;
  }
  return false;
}

/** Per step: whether its own section names a skeletal rearrangement. The route audit then
 *  reports a 1,2-shift or a bond at an unactivated carbon on that step instead of refusing it.
 *  Model prose, not a verification. */
export function stepDeclaresRearrangement(answer: string, count: number): boolean[] {
  return stepDeclares(answer, count, (text) => declaresUnnegated(REARRANGEMENT_PATTERN, text), true);
}

/** Per step: whether its own section names a radical or C–H functionalisation, which explains a
 *  new bond at a carbon nothing else activates (bromination with NBS or light). */
export function stepDeclaresRadical(answer: string, count: number): boolean[] {
  return stepDeclares(answer, count, (text) => declaresUnnegated(RADICAL_PATTERN, text), true);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeRouteSpecies(entry: unknown): RouteSpeciesSummary | null {
  const value = asRecord(entry);
  if (!value) return null;
  const canonicalSmiles = typeof value.canonicalSmiles === 'string' ? value.canonicalSmiles.trim() : '';
  if (!canonicalSmiles) return null;
  const input = typeof value.input === 'string' ? value.input.trim() : '';
  return {
    input: input || canonicalSmiles,
    canonicalSmiles,
    skeletonSmiles: typeof value.skeletonSmiles === 'string' && value.skeletonSmiles ? value.skeletonSmiles : canonicalSmiles,
    formula: typeof value.formula === 'string' ? value.formula : '',
    charge: numberOr(value.charge, 0),
    heavyAtoms: numberOr(value.heavyAtoms, 0),
    stereocentres: numberOr(value.stereocentres, 0),
    unspecifiedStereocentres: numberOr(value.unspecifiedStereocentres, 0),
    ...(value.alphaConfiguration === '(R)' || value.alphaConfiguration === '(S)' || value.alphaConfiguration === 'unassigned'
      ? { alphaConfiguration: value.alphaConfiguration } : {}),
    ...(typeof value.name === 'string' && value.name.trim() ? { name: value.name.trim().slice(0, MAX_SPECIES_NAME) } : {}),
    ...(typeof value.nameOk === 'boolean' ? { nameOk: value.nameOk } : {}),
    ...(value.byproduct === true ? { byproduct: true } : {}),
    ...(typeof value.coefficient === 'number' && Number.isInteger(value.coefficient) && value.coefficient > 0 ? { coefficient: value.coefficient } : {}),
  };
}

const routeSpecies = (list: unknown): RouteSpeciesSummary[] =>
  (Array.isArray(list) ? list.map(normalizeRouteSpecies).filter((entry): entry is RouteSpeciesSummary => entry !== null) : []).slice(0, 24);

const ROUTE_LINK_REASONS: RouteLinkAudit['reason'][] = ['carried', 'constitution-only', 'no-overlap', 'declared-mismatch', 'parse-failed'];

function normalizeRouteStep(entry: unknown, index: number): RouteStepAudit | null {
  const value = asRecord(entry);
  const reaction = value && typeof value.reaction === 'string' ? value.reaction : '';
  // 2.5.7 reports an unresolved step with an empty reaction and ok:false. It must
  // survive normalization, otherwise even a correctly aligned plugin audit shifts here.
  if (!value || typeof value.reaction !== 'string' || (!reaction && value.ok !== false)) return null;
  return {
    index: numberOr(value.index, index),
    reaction,
    ok: boolOr(value.ok, false),
    // The checker's messages end with the instruction to fix them; keep them whole so a correction
    // prompt never quotes one cut off mid-sentence.
    ...(typeof value.error === 'string' && value.error ? { error: value.error.slice(0, 1000) } : {}),
    reactants: routeSpecies(value.reactants),
    agents: routeSpecies(value.agents),
    products: routeSpecies(value.products),
    balanced: typeof value.balanced === 'boolean' ? value.balanced : null,
    chargeBalanced: typeof value.chargeBalanced === 'boolean' ? value.chargeBalanced : null,
    differences: stringArray(value.differences).map((entry) => entry.slice(0, 1000)),
    unspecifiedStereocentres: numberOr(value.unspecifiedStereocentres, 0),
    ...(stringArray(value.nameProblems).length ? { nameProblems: stringArray(value.nameProblems).map((entry) => entry.slice(0, 300)).slice(0, 24) } : {}),
    ...(value.racemic === true ? { racemic: true } : {}),
    ...(value.stereoNotRequired === true ? { stereoNotRequired: true } : {}),
    ...(typeof value.assemblyProblem === 'string' && value.assemblyProblem ? { assemblyProblem: value.assemblyProblem.slice(0, 400) } : {}),
    ...(typeof value.assemblyUnchecked === 'string' && value.assemblyUnchecked ? { assemblyUnchecked: value.assemblyUnchecked.slice(0, 300) } : {}),
    ...(typeof value.balanceUnchecked === 'string' && value.balanceUnchecked ? { balanceUnchecked: value.balanceUnchecked.slice(0, 1000) } : {}),
    ...(normalizeSkeleton(value.skeleton) ? { skeleton: normalizeSkeleton(value.skeleton)! } : {}),
    ...(normalizeBonds(value.bonds) ? { bonds: normalizeBonds(value.bonds)! } : {}),
    ...(value.rearrangement === true ? { rearrangement: true } : {}),
    ...(value.radical === true ? { radical: true } : {}),
    // Kept whole, like the checker's other messages: it ends with what to do.
    ...(typeof value.skeletonProblem === 'string' && value.skeletonProblem ? { skeletonProblem: value.skeletonProblem.slice(0, 1000) } : {}),
    ...(typeof value.refiledReactant === 'string' && value.refiledReactant ? { refiledReactant: value.refiledReactant.slice(0, 1000) } : {}),
    ...(typeof value.monatomicSpecies === 'string' && value.monatomicSpecies ? { monatomicSpecies: value.monatomicSpecies.slice(0, 1000) } : {}),
  };
}

const SKELETON_CHANGES = new Set(['none', 'formed', 'cleaved', 'formed+cleaved', 'unchecked']);

function normalizeBonds(entry: unknown): Record<string, number> | null {
  const value = asRecord(entry);
  if (!value) return null;
  const out = Object.entries(value)
    .filter((pair): pair is [string, number] => /^[A-Z][a-z]?–[A-Z][a-z]?$/.test(pair[0]) && typeof pair[1] === 'number' && Number.isFinite(pair[1]) && pair[1] !== 0)
    .slice(0, 16);
  return out.length ? Object.fromEntries(out) : null;
}

function normalizeSkeleton(entry: unknown): RouteSkeletonFacts | null {
  const value = asRecord(entry);
  if (!value || typeof value.change !== 'string' || !SKELETON_CHANGES.has(value.change)) return null;
  const count = (key: string) => Math.max(0, Math.min(99, Math.round(numberOr(value[key], 0))));
  return {
    change: value.change as RouteSkeletonFacts['change'],
    formed: count('formed'),
    cleaved: count('cleaved'),
    ringSizes: (Array.isArray(value.ringSizes) ? value.ringSizes : []).filter((size): size is number => typeof size === 'number' && size >= 3 && size <= 99).slice(0, 8),
    migration: value.migration === true,
    reorganised: value.reorganised === true,
    unactivated: count('unactivated'),
    unactivatedHetero: count('unactivatedHetero'),
    heteroElements: stringArray(value.heteroElements).filter((element) => /^[A-Z][a-z]?$/.test(element)).slice(0, 8),
    ...(typeof value.reason === 'string' && value.reason ? { reason: value.reason.slice(0, 300) } : {}),
  };
}

function normalizeRouteLink(entry: unknown, index: number): RouteLinkAudit | null {
  const value = asRecord(entry);
  if (!value) return null;
  const reason = typeof value.reason === 'string' && (ROUTE_LINK_REASONS as string[]).includes(value.reason)
    ? value.reason as RouteLinkAudit['reason'] : 'parse-failed';
  const carried = (Array.isArray(value.carried) ? value.carried : []).map((item) => {
    const record = asRecord(item);
    const canonicalSmiles = record && typeof record.canonicalSmiles === 'string' ? record.canonicalSmiles : '';
    if (!canonicalSmiles) return null;
    return { canonicalSmiles, formula: record && typeof record.formula === 'string' ? record.formula : '', heavyAtoms: record ? numberOr(record.heavyAtoms, 0) : 0 };
  }).filter((item): item is { canonicalSmiles: string; formula: string; heavyAtoms: number } => item !== null).slice(0, 24);
  const skeletonOnly = (Array.isArray(value.skeletonOnly) ? value.skeletonOnly : []).map((item) => {
    const record = asRecord(item);
    if (!record || typeof record.product !== 'string' || typeof record.reactant !== 'string') return null;
    return { product: record.product, reactant: record.reactant, skeletonSmiles: typeof record.skeletonSmiles === 'string' ? record.skeletonSmiles : '' };
  }).filter((item): item is { product: string; reactant: string; skeletonSmiles: string } => item !== null).slice(0, 24);
  const declared = asRecord(value.declaredCarrier);
  return {
    from: numberOr(value.from, index),
    to: numberOr(value.to, index + 1),
    ok: boolOr(value.ok, false),
    reason,
    carried,
    skeletonOnly,
    ...(declared ? {
      declaredCarrier: {
        input: typeof declared.input === 'string' ? declared.input : '',
        canonicalSmiles: typeof declared.canonicalSmiles === 'string' ? declared.canonicalSmiles : null,
        inProduct: boolOr(declared.inProduct, false),
        inReactant: boolOr(declared.inReactant, false),
      },
    } : {}),
  };
}

/** The most route steps the package checks (chemistry-studio MAX_STEPS): a solid-phase peptide
 *  synthesis runs to dozens. An audit cut shorter than the route it answers is refused as
 *  misaligned, so this must not be below the package's own limit. */
const MAX_ROUTE_STEPS = 96;

/** Accepts only a route audit the capability can actually have produced. */
export function normalizeRouteAudit(data: unknown): RouteAudit | null {
  const value = asRecord(data);
  if (!value || !Array.isArray(value.steps) || !value.steps.length) return null;
  const steps = value.steps.map((entry, index) => normalizeRouteStep(entry, index))
    .filter((entry): entry is RouteStepAudit => entry !== null).slice(0, MAX_ROUTE_STEPS);
  if (!steps.length) return null;
  const links = (Array.isArray(value.links) ? value.links : []).map((entry, index) => normalizeRouteLink(entry, index))
    .filter((entry): entry is RouteLinkAudit => entry !== null).slice(0, MAX_ROUTE_STEPS - 1);
  const blocked = stringArray(value.blocked).map((entry) => entry.slice(0, 300)).slice(0, 32);
  const isolated = Array.isArray(value.isolated)
    ? value.isolated.filter((entry): entry is number => Number.isInteger(entry) && entry >= 0 && entry < MAX_ROUTE_STEPS).slice(0, MAX_ROUTE_STEPS)
    : undefined;
  const target = normalizeRouteTarget(value.target);
  return { steps, links, continuous: boolOr(value.continuous, blocked.length === 0), blocked, ...(isolated ? { isolated } : {}), ...(target ? { target } : {}) };
}

const PRECEDENT_FORM = /^(?:as-written|organic-reactants|agents-as-reactants)(?:\+organic-products)?$/;

const PRECEDENT_FORM_NOTE: Record<string, string> = {
  'organic-reactants': 'counting only the organic reactants',
  'agents-as-reactants': 'counting the agents as reactants',
  'organic-products': 'counting only the organic products',
};

// ORD records and Lowe's USPTO patent records (recordAudit).
const ORD_ID = RECORD_ID;
/** A drawn recorded reaction is tens of kilobytes; anything far larger is not one. */
const MAX_PRECEDENT_SVG = 256 * 1024;

/** A reaction SMILES as the index writes it: SMILES on each side of `>`, agents optional. */
function reactionSmilesOr(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 4000) return undefined;
  const parts = value.split('>');
  if (parts.length !== 2 && parts.length !== 3) return undefined;
  const ends = [parts[0], parts[parts.length - 1]];
  const middle = parts.length === 3 ? parts[1] : '';
  return ends.every((part) => SMILES_CHARS.test(part)) && (!middle || SMILES_CHARS.test(middle)) ? value : undefined;
}

function normalizePrecedentEntry(entry: unknown, idPattern: RegExp = ORD_ID): ReactionPrecedentEntry | null {
  const value = asRecord(entry);
  if (!value || typeof value.input !== 'string' || !value.input) return null;
  const samples = Array.isArray(value.samples) ? stringArray(value.samples).filter((id) => idPattern.test(id)).slice(0, 3) : [];
  const reaction = reactionSmilesOr(value.reaction);
  return {
    input: value.input.slice(0, 4000),
    count: numberOr(value.count, 0),
    ...(Array.isArray(value.keys) ? { keys: stringArray(value.keys).slice(0, 8) } : {}),
    ...(typeof value.form === 'string' && PRECEDENT_FORM.test(value.form) ? { form: value.form } : {}),
    ...(value.unchanged === true ? { unchanged: true } : {}),
    ...(samples.length ? { samples } : {}),
    ...(reaction ? { reaction } : {}),
    ...(Array.isArray(value.classes) ? { classes: stringArray(value.classes).map((name) => name.slice(0, 120)).slice(0, 3) } : {}),
    ...withAudit(value.auditFlags),
    ...withConditions(value.conditions, idPattern),
  };
}

function withAudit(value: unknown): { auditFlags?: string[] } {
  const flags = normalizeAuditFlags(value);
  return flags.length ? { auditFlags: flags } : {};
}

function withConditions(value: unknown, idPattern: RegExp): { conditions?: ReactionConditions[] } {
  const conditions = normalizeReactionConditions(value, idPattern);
  return conditions.length ? { conditions } : {};
}

function normalizePrecedentNeighbor(item: unknown, idPattern: RegExp = ORD_ID): ReactionPrecedentNeighbor | null {
  const neighbor = asRecord(item);
  if (!neighbor || typeof neighbor.key !== 'string') return null;
  const similarity = typeof neighbor.similarity === 'number' && neighbor.similarity >= 0 && neighbor.similarity <= 1 ? neighbor.similarity : undefined;
  const reaction = reactionSmilesOr(neighbor.reaction);
  const svg = typeof neighbor.svg === 'string' && neighbor.svg.startsWith('<svg') && neighbor.svg.length <= MAX_PRECEDENT_SVG ? neighbor.svg : undefined;
  return {
    key: neighbor.key,
    distance: numberOr(neighbor.distance, 0),
    count: numberOr(neighbor.count, 0),
    ...(similarity !== undefined ? { similarity } : {}),
    ...(reaction ? { reaction } : {}),
    ...(svg && reaction ? { svg } : {}),
    ...(Array.isArray(neighbor.samples) ? { samples: stringArray(neighbor.samples).filter((id) => idPattern.test(id)).slice(0, 3) } : {}),
    ...withAudit(neighbor.auditFlags),
    ...withConditions(neighbor.conditions, idPattern),
  };
}

/** Accepts only a precedent payload the capability can actually have produced. Sample ids must
 *  be Open Reaction Database ids unless another index's pattern is given (textbook schemes: tb-…). */
export function normalizeReactionPrecedent(data: unknown, idPattern: RegExp = ORD_ID): ReactionPrecedent | null {
  const value = asRecord(data);
  if (!value) return null;
  const reactions = (Array.isArray(value.reactions) ? value.reactions : [])
    .map((entry) => normalizePrecedentEntry(entry, idPattern)).filter((entry): entry is ReactionPrecedentEntry => entry !== null).slice(0, 32);
  const products = (Array.isArray(value.products) ? value.products : [])
    .map((entry) => normalizePrecedentEntry(entry, idPattern)).filter((entry): entry is ReactionPrecedentEntry => entry !== null).slice(0, 32);
  const similar = (Array.isArray(value.similar) ? value.similar : []).map((entry) => {
    const record = asRecord(entry);
    if (!record || typeof record.input !== 'string') return null;
    const neighbors = (Array.isArray(record.neighbors) ? record.neighbors : [])
      .map((item) => normalizePrecedentNeighbor(item, idPattern)).filter((item): item is ReactionPrecedentNeighbor => item !== null).slice(0, 8);
    return { input: record.input.slice(0, 4000), neighbors, ...(record.unchanged === true ? { unchanged: true } : {}) };
  }).filter((entry): entry is ReactionPrecedentSimilar => entry !== null).slice(0, 16);
  if (!reactions.length && !products.length && !similar.length) return null;
  return { reactions, products, similar };
}

/** The drawing shown for a step: its closest known reaction, as the package drew it. An exact
 *  match is not drawn: it is the step itself, already drawn under the route drawings. */
export function precedentDrawingFor(entry: ReactionPrecedentEntry | undefined, similar: ReactionPrecedentSimilar | undefined): ReactionPrecedentNeighbor | null {
  if (entry && entry.count > 0) return null;
  return similar?.neighbors.find((neighbor) => neighbor.svg && neighbor.reaction) ?? null;
}

/** "reactant + reactant → product (agent)" from the step's names; byproducts are left out. */
function stepTitle(step: RouteSpeciesLabel[] | undefined): string {
  if (!step?.length) return '';
  const names = (role: RouteLabelRole, byproduct?: boolean) => step
    .filter((entry) => entry.role === role && (byproduct === undefined || entry.byproduct === byproduct))
    .map((entry) => entry.name || entry.smiles).filter(Boolean);
  const reactants = names('reactant');
  const products = names('product', false);
  const agents = names('agent');
  if (!reactants.length || !products.length) return '';
  return `${reactants.join(' + ')} → ${products.join(' + ')}${agents.length ? ` (${agents.join(', ')})` : ''}`;
}

/** "  - Run with: Pd-C, ethanol · 8 h · yield 92% · US05320776 (`ord-…`)", one line per recorded sample. */
function conditionLines(conditions: ReactionConditions[] | undefined, lead: string): string[] {
  // Two samples of one patent often record the same run: one line for it.
  const seen = new Set<string>();
  return (conditions ?? []).flatMap((item) => {
    const text = conditionsText(item);
    if (!text || seen.has(text)) return [];
    seen.add(text);
    return [`  - ${lead}: ${text} (\`${item.id}\`)`];
  });
}

const SIMILARITY_FOOTNOTE = '_Similarity compares which bonds and groups change in a reaction (its DRFP fingerprint, Tanimoto). 100% means the same changes, not necessarily the same molecules. It is not a confidence score: a low figure for a textbook reaction usually means this snapshot records it with different reagents or in one pot. A step not recorded here is not thereby new._';

/** The deterministic precedent section, one block per route step; the model never authors it.
 *  Without a context (an older caller) the steps are numbered in query order, untitled. */
export function formatReactionPrecedents(precedent: ReactionPrecedent, context?: PrecedentContext): string {
  const lines = ['### Known reactions (Open Reaction Database)',
    'This block is generated by the application, not by the model, from a local snapshot.', ''];
  const product = precedent.products[0];
  if (product) {
    const target = context?.target;
    const name = target?.name ? `**${target.name}** — ` : '';
    lines.push(`Target: ${name}\`${product.input}\` · ${product.count > 0 ? `${product.count} recorded route(s) to it in this local snapshot` : 'no route to it in this local snapshot (a gap in the snapshot\'s coverage, not a sign the chemistry is new)'}.`, '');
  }
  const similarByInput = new Map(precedent.similar.map((item) => [item.input, item]));
  let usedSimilarity = false;
  precedent.reactions.forEach((entry, position) => {
    const step = context?.queries[position]?.step ?? position;
    const title = stepTitle(context?.labels[step]);
    lines.push(`**Step ${step + 1}**${title ? ` — ${title}` : ''}`, `\`${entry.input}\``);
    if (entry.unchanged) {
      lines.push('- Changes no structure (a purification or salt step), so it is not looked up.', '');
      return;
    }
    if (entry.count > 0) {
      const notes = (entry.form ?? '').split('+').map((part) => PRECEDENT_FORM_NOTE[part]).filter(Boolean);
      const ids = entry.samples?.length ? `: ${entry.samples.map(recordLabel).join(', ')}` : '';
      lines.push(`- ✔ Exact match — ${entry.count} recorded precedent(s)${notes.length ? ` (${notes.join(', ')})` : ''}${ids}.`);
      if (entry.auditFlags?.length) lines.push(`  - ${auditNote(entry.auditFlags)}`);
      lines.push(...conditionLines(entry.conditions, 'Run with'));
    } else {
      const item = similarByInput.get(entry.input);
      const closest = item?.neighbors[0];
      if (!closest) {
        lines.push('- Not recorded in this snapshot, and no close known reaction in it.');
      } else if (closest.similarity !== undefined) {
        usedSimilarity = true;
        lines.push(`- Not recorded in this snapshot. Closest recorded reaction: ${Math.round(closest.similarity * 100)}% similar — ${similarityBand(closest.similarity)}.`);
        if (closest.auditFlags?.length) lines.push(`  - ${auditNote(closest.auditFlags)}`);
        lines.push(...conditionLines(closest.conditions, 'The closest reaction was run with'));
      } else {
        lines.push(`- Not recorded in this snapshot. Closest recorded reaction is ${closest.distance} fingerprint bit(s) away.`);
      }
    }
    lines.push(...stepSupportLines(entry, context?.support?.get(step)));
    const drawing = context?.drawings?.get(step);
    if (drawing) lines.push('', '_The closest known reaction, as recorded in the database (species as listed, not a balanced equation):_', '', drawing);
    lines.push('');
  });
  if (usedSimilarity) lines.push(SIMILARITY_FOOTNOTE);
  return `\n${lines.join('\n').trimEnd()}\n`;
}

const ROUTE_TARGET_REASONS: RouteTargetAudit['reason'][] = ['formed', 'stereo-mismatch', 'not-formed', 'unparsed'];

function normalizeRouteTarget(entry: unknown): RouteTargetAudit | null {
  const value = asRecord(entry);
  if (!value || typeof value.input !== 'string' || !(ROUTE_TARGET_REASONS as unknown[]).includes(value.reason)) return null;
  return {
    input: value.input.slice(0, 2000),
    canonicalSmiles: typeof value.canonicalSmiles === 'string' ? value.canonicalSmiles.slice(0, 2000) : null,
    formula: typeof value.formula === 'string' ? value.formula.slice(0, 200) : null,
    formedAt: Number.isInteger(value.formedAt) ? value.formedAt as number : null,
    reason: value.reason as RouteTargetAudit['reason'],
    ...(Array.isArray(value.openCentres) && value.openCentres.length
      ? { openCentres: (value.openCentres as unknown[]).slice(0, 24).flatMap((entry) => {
        const centre = asRecord(entry);
        return centre && Number.isInteger(centre.atom) && typeof centre.delivered === 'string'
          ? [{ atom: centre.atom as number, delivered: centre.delivered.slice(0, 8) }] : [];
      }) }
      : {}),
  };
}

/** Steps connected to nothing, from the structured field or, for an older package, from the
 *  sentence it writes into `blocked`. */
export function isolatedSteps(audit: RouteAudit): number[] {
  if (audit.isolated) return audit.isolated;
  return audit.blocked.flatMap((entry) => {
    const match = /^Step (\d+) is disconnected/.exec(entry);
    return match ? [Number(match[1]) - 1] : [];
  });
}

/** Links between steps the checker refused: a later step consumes a different stereoisomer or
 *  charge state of what an earlier one makes, or a declared intermediate is not the same structure
 *  on both sides. The package counts these against `continuous`, and the continuity rule tells the
 *  model such a route is rejected; neither step is isolated by it, so `isolatedSteps` alone never
 *  sees one. Every verdict reads this, so the header, the chips and the drawing gate agree. A link
 *  reported as carried is never broken: the package sets `ok` from that reason. */
export function brokenRouteLinks(audit: RouteAudit): RouteLinkAudit[] {
  return audit.links.filter((link) => !link.ok && link.reason !== 'carried');
}

const sideTrace = (species: RouteSpeciesSummary[], names?: Map<string, string>): string => species.map((entry) => {
  const name = names?.get(entry.input) ?? names?.get(entry.canonicalSmiles) ?? entry.name;
  const identity = entry.formula || entry.canonicalSmiles;
  const label = name ? `${name} (${identity})` : identity;
  // The solved coefficient is shown when it is not 1, so an equation that only balances at an
  // odd stoichiometry is visible rather than hidden behind a bare "+".
  return entry.coefficient && entry.coefficient > 1 ? `${entry.coefficient} ${label}` : label;
}).join(' + ');

/** Element counts of a formula written as the checker writes it ("C2H5O", "Cr2O7"); charges ignored. */
function formulaCounts(formula: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) counts.set(match[1], (counts.get(match[1]) ?? 0) + (match[2] ? Number(match[2]) : 1));
  return counts;
}

/** A formula in Hill order (C, H, then alphabetical; alphabetical without carbon). */
function hillFormula(counts: Map<string, number>): string {
  const elements = [...counts.keys()].filter((element) => (counts.get(element) ?? 0) > 0);
  const carbon = elements.includes('C');
  const order = carbon ? ['C', 'H', ...elements.filter((element) => element !== 'C' && element !== 'H').sort()] : elements.sort();
  return order.filter((element) => elements.includes(element)).map((element) => `${element}${counts.get(element)! > 1 ? counts.get(element) : ''}`).join('');
}

/** Largest salt coefficient the display search tries; the solver's own cap is 30. */
const SALT_DISPLAY_MAX = 30;

/** One side of a step as the reader should see it: each named salt whose ions are all on this
 *  side is shown whole ("sodium dichromate (Cr2Na2O7)"), with the count the ions' solved
 *  coefficients imply. The checker balances ions separately (that is how it solves salts), but
 *  "Na + Cr2O7 + … + Na" reads as a lost sodium. Ions shared between salts (sulfate in sodium and
 *  chromium(III) sulfate) are split by a small integer search; when no exact split exists the
 *  side is shown as the checker solved it. */
function groupedSideTrace(species: RouteSpeciesSummary[], labels: RouteSpeciesLabel[], names: Map<string, string>, balanced: boolean, otherSide: RouteSpeciesSummary[] = []): string {
  // An ion on both sides (sodium in a dichromate oxidation) is a spectator the solver cancels, so
  // its solved count is arbitrary (often 1:1); the salts fix it instead.
  const spectators = new Set(otherSide.map((entry) => entry.input));
  const byInput = new Map(species.map((entry) => [entry.input, entry]));
  const salts = labels
    .filter((label) => label.smiles.includes('.'))
    .map((label) => {
      const parts = label.smiles.split('.').map((part) => part.trim()).filter(Boolean);
      const multiplicity = new Map<string, number>();
      for (const part of parts) multiplicity.set(part, (multiplicity.get(part) ?? 0) + 1);
      return { label, multiplicity };
    })
    .filter((salt) => [...salt.multiplicity.keys()].every((part) => byInput.has(part)));
  if (!salts.length || salts.length > 4) return sideTrace(species, names);
  const used = new Set(salts.flatMap((salt) => [...salt.multiplicity.keys()]));
  const coefficient = (input: string) => byInput.get(input)?.coefficient ?? 1;
  // Salt counts k_s with Σ k_s · m(s, ion) = the ion's solved coefficient for every ion.
  let found: number[] | null = null;
  if (!balanced) found = salts.map(() => 1);
  else {
    const search = (index: number, counts: number[]): void => {
      if (found) return;
      if (index === salts.length) {
        const ok = [...used].every((ion) => spectators.has(ion) || salts.reduce((sum, salt, position) => sum + counts[position] * (salt.multiplicity.get(ion) ?? 0), 0) === coefficient(ion));
        if (ok) found = [...counts];
        return;
      }
      for (let k = 1; k <= SALT_DISPLAY_MAX; k++) search(index + 1, [...counts, k]);
    };
    search(0, []);
  }
  if (!found) return sideTrace(species, names);
  const counts: number[] = found;
  const saltTerms = salts.map((salt, position) => {
    const total = new Map<string, number>();
    for (const [ion, times] of salt.multiplicity) {
      for (const [element, n] of formulaCounts(byInput.get(ion)?.formula ?? '')) total.set(element, (total.get(element) ?? 0) + n * times);
    }
    const label = `${salt.label.name} (${hillFormula(total)})`;
    return balanced && counts[position] > 1 ? `${counts[position]} ${label}` : label;
  });
  const rest = species.filter((entry) => !used.has(entry.input));
  return [...(rest.length ? [sideTrace(rest, names)] : []), ...saltTerms].join(' + ');
}

/** A lookup from a declared SMILES to the IUPAC name the author wrote beside it. The
 *  authoring labels carry the name and the exact token; the audit species carries the
 *  canonical form, so both are keyed. */
export function routeLabelNames(labels: RouteSpeciesLabel[][]): Map<string, string> {
  const names = new Map<string, string>();
  for (const step of labels) for (const label of step) if (label.name) names.set(label.smiles, label.name);
  return names;
}

// ---------------------------------------------------------------- route review (model)

/** A route-plan problem a balance checker cannot see: prose that does not describe the named
 *  step, a product that is a different compound from the target, an impossible step, or a
 *  redundant one. `step` is 1-based, or 0 for a route-level problem. */
export interface RouteReviewProblem {
  step: number;
  /** `blocking` only for a named structure that is wrong for the step; everything else —
   *  feasibility, conditions, mechanism, an unusual reaction — is `advisory` and never blocks
   *  a route the deterministic checker passed. An omitted or unreadable severity is advisory. */
  severity: 'blocking' | 'advisory';
  detail: string;
}

/** The review findings that block a route: the named structure is wrong for the step. */
export function blockingReviewProblems(review: RouteReview | null): RouteReviewProblem[] {
  return review?.status === 'problems' ? review.problems.filter((problem) => problem.severity === 'blocking') : [];
}

/** The review findings that are shown but never block: a model judgement about feasibility. */
export function advisoryReviewProblems(review: RouteReview | null): RouteReviewProblem[] {
  return review?.status === 'problems' ? review.problems.filter((problem) => problem.severity === 'advisory') : [];
}

/** The outcome of the route review. A `null` return means the review could not be read, which
 *  is never treated as a problem. */
export interface RouteReview {
  status: 'ok' | 'problems';
  problems: RouteReviewProblem[];
}

export const ROUTE_REVIEW_SYSTEM = [
  'You review a proposed multi-step synthesis for problems that a balance checker cannot see. Every equation may balance and every intermediate may carry over, yet the plan can still be wrong.',
  'You are given the researcher\'s request, the requested target, each step\'s own description of its transformation, and the species its author named.',
  'Each step carries its author\'s description (a heading such as "Dehydration of citric acid to aconitic acid" and the prose under it). Use it: a named, standard reaction — dehydration, decarboxylation, hydration, esterification, hydrolysis, reduction, oxidation, condensation, Mannich, Michael addition — is a possible step. Report a step only when the species named cannot come from the transformation described, never merely because the reaction is uncommon, advanced, or not one you would have chosen.',
  'A cheminformatics toolkit has already checked that every equation balances and that every intermediate is carried over as the same structure; the request says which steps, if any, it refused. Never report a balance, stoichiometry or "cannot be written as one balanced equation" problem: that is the checker\'s job, and its findings are reported separately. A step that forms several bonds or combines bond-forming events into one balanced net equation is allowed — a one-pot cascade such as the Robinson tropinone synthesis is one step — so do not report a step merely for merging or splitting transformations, with one exception: a separate workup folded into a transformation (see "blocking" below).',
  'Every structure below is a canonical isomeric SMILES, and so is the target. Two identical SMILES strings are the same compound; two different strings are different compounds. The checker has already compared each product to the target by canonical structure and reports in the request whether the target is formed — when it says the target is formed, do not report that step\'s product as a different compound from the target.',
  'Report only a specific, confident problem from this list, and set its "severity":',
  '- "blocking" when the named structure is wrong for the step: a product that is a different compound than the requested target; a product whose formula matches the intended one but whose connectivity or regiochemistry differs — a swapped substituent, or the wrong ring or epoxide regioisomer; a step whose prose describes a different transformation than the species named; or an atom-inconsistent or impossible byproduct; or a step that folds a separate workup into a different transformation — an acidification, basification or quench that converts the transformation\'s product into another form (a Kolbe–Schmitt carboxylation and the acidification that frees the acid, written as one step), which are two operations and belong in two steps. A step folds a workup only when its species include the workup\'s acid or base alongside the transformation\'s reagents; a product written in its isolated form (an amine or its hydrochloride) is not a folded workup. These are the mistakes the balance checker cannot see, so they stop the route.',
  '- The checker derived every species\' formula and charge from its structure. Never dispute what a SMILES denotes (`Cl` is hydrogen chloride; chloride is `[Cl-]`), a formula, or whether a salt is charge-balanced, and never report a spent inorganic reagent\'s oxidation state (tin(II) or tin(IV) chloride, a chromium or manganese salt) as blocking: which one a step names is advisory when it balances.',
  '- The form a product is isolated in — a free amine or its hydrochloride, an acid or its carboxylate — is the author\'s choice when the step\'s species balance and the next step consumes exactly the species this step names. Report such a choice only as advisory, and never report both forms in turn: only a separate workup folded into a transformation (above) is blocking.',
  '- "advisory" for everything else — a step you doubt can give the named product under the stated conditions (the wrong reagent for the transformation, an unusual or advanced route, feasibility, conditions, yield or mechanism), a one-pot cascade, a named reaction you would not have chosen, or a redundant or pointless step. An advisory finding is shown to the reader but never blocks the route.',
  'Be conservative. Never invent a compound, reaction or mechanism, and never report a step that is merely unusual but chemically possible. Do not repeat an equation or continuity problem the checker already found.',
  'Return EXCLUSIVELY one JSON object: {"status":"ok"} when there is no such problem, or {"status":"problems","problems":[{"step":<1-based step number, or 0 for a route-level problem>,"severity":"blocking"|"advisory","detail":"<one sentence>"}]}. A problem with no severity is treated as advisory. Do not write anything outside the JSON.',
].join('\n');

export function buildRouteReviewRequest(question: string, labels: RouteSpeciesLabel[][], audit: RouteAudit, stepProse: string[] = []): string {
  return [
    'The researcher asked:',
    question.trim().slice(0, 4000) || '(the request text is not available)',
    '',
    `The requested target is: ${audit.target?.canonicalSmiles ?? audit.target?.input ?? 'the product described in the request'}`,
    '',
    'The proposed route, each step with its author\'s description and the species as systematic names — isomeric SMILES:',
    ...audit.steps.map((step) => {
      const prose = stepProse[step.index]?.trim();
      return [`Step ${step.index + 1}:`, ...(prose ? [`  ${prose}`] : []), labelledStepLines(labels, step)].join('\n');
    }),
    '',
    audit.blocked.length
      ? `The automatic checker already found: ${audit.blocked.join(' ')}`
      : 'The automatic checker found no equation or continuity problem.',
    '',
    'Report only the problems it cannot see. Return the JSON.',
  ].join('\n');
}

/** A finding is one sentence, so this only guards a runaway reply. Cut on a word boundary
 *  and mark the cut, so a long detail is never shown ending mid-word. */
const REVIEW_DETAIL_LIMIT = 1000;
export function clampReviewDetail(detail: string): string {
  const text = detail.trim();
  if (text.length <= REVIEW_DETAIL_LIMIT) return text;
  const cut = text.slice(0, REVIEW_DETAIL_LIMIT);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** Parse the review defensively: an unreadable or inconsistent reply means "not checked",
 *  never a fabricated problem, so it never blocks a route. */
export function parseRouteReview(raw: string, stepCount?: number): RouteReview | null {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return null;
  let value: unknown;
  try { value = JSON.parse(match[0]); } catch { return null; }
  const record = asRecord(value);
  if (!record) return null;
  if (record.status === 'ok') return { status: 'ok', problems: [] };
  if (record.status !== 'problems') return null;
  const problems = (Array.isArray(record.problems) ? record.problems : []).map((entry) => {
    const item = asRecord(entry);
    if (!item || typeof item.detail !== 'string' || !item.detail.trim()) return null;
    // Clamp to the route's own length, never a constant. A hard-coded 15 silently RELABELLED
    // every finding above step 15 as step 15 — on a 24-step route a correct finding about the
    // macrolactamisation at step 23 was reported against an Fmoc removal at step 15, which reads
    // as the review inventing a molecule and sent three fix rounds after the wrong step. Routes
    // only started exceeding 15 steps once they were asked to decompose.
    const highest = Number.isInteger(stepCount) && (stepCount as number) > 0 ? (stepCount as number) : 999;
    const step = Number.isInteger(item.step) ? Math.min(Math.max(item.step as number, 0), highest) : 0;
    // Only an explicit "blocking" stops the route; a missing or unreadable severity is advisory.
    const severity: RouteReviewProblem['severity'] = item.severity === 'blocking' ? 'blocking' : 'advisory';
    return { step, severity, detail: clampReviewDetail(item.detail) };
  }).filter((entry): entry is RouteReviewProblem => entry !== null).slice(0, 24);
  if (!problems.length) return null;
  return { status: 'problems', problems };
}

function formatRouteReview(review: RouteReview): string[] {
  const blocking = blockingReviewProblems(review);
  const advisory = advisoryReviewProblems(review);
  const lines: string[] = [];
  if (blocking.length) {
    lines.push(
      '',
      '### Route review (model)',
      '',
      'A model reviewed the route plan and prose. A finding here marks the route not verified; it is a model judgement, not an RDKit result.',
      '',
      ...blocking.map((problem) => `- ${problem.step > 0 ? `Step ${problem.step}: ` : ''}${problem.detail}`),
    );
  }
  if (advisory.length) {
    lines.push(
      '',
      '### Route review (model, advisory)',
      '',
      'A model reviewed the route plan and prose. These are its judgements, not RDKit results; they are shown for you to weigh and do not stop a route the checker passed.',
      '',
      ...advisory.map((problem) => `- ${problem.step > 0 ? `Step ${problem.step}: ` : ''}${problem.detail}`),
    );
  }
  return lines;
}

/** The deterministic appendix a reader can act on: a one-line verdict, then per step balance
 *  and stereochemistry, then whether every intermediate is carried over as the same molecule.
 *  Generated by the application, so the model cannot claim a route was verified when it was
 *  not. A model route review is folded into the verdict and shown below when it found a plan
 *  problem the checker cannot see. When the answer named the species, the IUPAC names are
 *  shown beside the structures they denote. */
/** A coefficient above this is called out as a likely wrong byproduct set. Redox steps can
 *  legitimately reach the high single digits, so this is an advisory note, never a refusal. */
const LARGE_COEFFICIENT = 6;

/** `reviewPending` is set for the interim repaint shown while the model review still runs: a
 *  route whose checks pass is then reported as passing so far, not as verified. */
/** What a species name asserts about configuration, when it says anything: an L-/D- prefix, or an
 *  explicit CIP descriptor. Only what the author wrote — no mapping is applied, because L maps to
 *  one letter in most of the series and the other when a sulfur-bearing branch outranks the
 *  carboxyl, so no mapping is applied here. */
export function statedConfiguration(name: string | undefined): string | null {
  if (!name) return null;
  if (/\(2?R\)/.test(name)) return '(R)';
  if (/\(2?S\)/.test(name)) return '(S)';
  if (/\bD-|\bD\b(?=[- ])|-D-/.test(name)) return 'D';
  if (/\bL-|\bL\b(?=[- ])|-L-/.test(name)) return 'L';
  return null;
}

/** The measured configuration of each chiral building block a step consumes, beside what its
 *  own name asserts. Reported, never a verdict: this is the one error class the deterministic checks
 *  cannot see, because the wrong enantiomer has the same formula, the same atom counts and the
 *  same canonical constitution as the right one. Where the name and the structure both state a
 *  CIP descriptor the two are compared directly, which needs no mapping; an L-/D- prefix is
 *  printed as-is for the reader to weigh. */
function alphaConfigurationLine(step: RouteStepAudit, stepLabels: RouteSpeciesLabel[]): string | null {
  const blocks = step.reactants.filter((entry) => entry.alphaConfiguration);
  if (!blocks.length) return null;
  const nameFor = (entry: RouteSpeciesSummary, index: number): string | undefined =>
    entry.name ?? stepLabels.filter((label) => label.role === 'reactant')[index]?.name;
  const parts = blocks.map((entry) => {
    const name = nameFor(entry, step.reactants.indexOf(entry));
    const measured = entry.alphaConfiguration!;
    const stated = statedConfiguration(name);
    const note = !stated ? ''
      : (stated === '(R)' || stated === '(S)')
        ? stated === measured ? ', name agrees' : `, NAME SAYS ${stated}`
        : `, name says ${stated}`;
    return `${name ?? entry.formula} ${measured}${note}`;
  });
  const counts = new Map<string, number>();
  for (const entry of blocks) counts.set(entry.alphaConfiguration!, (counts.get(entry.alphaConfiguration!) ?? 0) + 1);
  const tally = [...counts].sort().map(([key, count]) => `${count} ${key}`).join(', ');
  return `  Building blocks, alpha configuration as measured (${tally}) — a block of the wrong configuration balances exactly like the right one: ${parts.join(' · ')}`;
}

/** How the package reports a step it could not build, because a species the step names has no
 *  resolved structure. It is not a verdict on the chemistry: nothing was checked. Matched by
 *  prefix so the report can say UNBUILT and name the species instead of printing FAIL. */
export const UNBUILT_STEP_ERROR_PREFIX = 'This step could not be built';

export function formatRouteAudit(audit: RouteAudit, labels: RouteSpeciesLabel[][] = [], review: RouteReview | null = null, reviewPending = false, unresolved: UnresolvedName[] = []): string {
  const names = routeLabelNames(labels);
  const lines: string[] = [
    '### Route check (RDKit)',
    '',
    'Every step was parsed with RDKit and every equation and intermediate link was checked. This block is generated by the application, not by the model.',
    '',
  ];
  const unbuilt = (step: RouteStepAudit): boolean => !step.ok && Boolean(step.error?.startsWith(UNBUILT_STEP_ERROR_PREFIX));
  const failing = (step: RouteStepAudit): boolean => routeStepFailure(step) !== null && !unbuilt(step);
  const failedSteps = audit.steps.filter(failing).map((step) => step.index + 1);
  const unbuiltSteps = audit.steps.filter(unbuilt).map((step) => step.index + 1);
  const assembled = audit.steps.filter((step) => Boolean(step.assemblyProblem)).map((step) => step.index + 1);
  const skeletal = audit.steps.filter((step) => Boolean(step.skeletonProblem)).map((step) => step.index + 1);
  const isolated = isolatedSteps(audit);
  // A check that could not run must not look like a check that passed. The bond-edit search is
  // budgeted and gives up on a hard graph; until this was said out loud, a route whose bonds were
  // never examined read exactly like one whose bonds were fine.
  const bondUnchecked = audit.steps.filter((step) => step.skeleton?.change === 'unchecked');
  const reviewProblems = blockingReviewProblems(review);
  const reasons: string[] = [];
  if (failedSteps.length) reasons.push(`${failedSteps.length} of ${audit.steps.length} step(s) do not pass (${failedSteps.map((index) => `step ${index}`).join(', ')})`);
  // Said separately: an unbuilt step had nothing checked, so counting it as a failed check makes
  // a route look worse than it is and hides what the author actually has to fix.
  if (unbuiltSteps.length) reasons.push(`${unbuiltSteps.length} step(s) could not be built because a species they name has no resolved structure (${unbuiltSteps.map((index) => `step ${index}`).join(', ')})`);
  if (assembled.length) reasons.push(`${assembled.length === 1 ? 'a step' : 'steps'} cannot be assembled from a single substrate molecule (${assembled.map((index) => `step ${index}`).join(', ')})`);
  if (skeletal.length) reasons.push(`${skeletal.length === 1 ? 'a step makes or breaks a bond' : 'steps make or break bonds'} its reactants cannot (${skeletal.map((index) => `step ${index}`).join(', ')})`);
  if (isolated.length) reasons.push(`${isolated.length} step(s) are disconnected from the rest of the route`);
  const broken = brokenRouteLinks(audit);
  if (broken.length) reasons.push(`${broken.length} intermediate link(s) do not carry the same structure (${broken.map((link) => `step ${link.from + 1} → ${link.to + 1}`).join(', ')})`);
  if (audit.target?.reason === 'not-formed') reasons.push('no step forms the requested target');
  else if (audit.target?.reason === 'stereo-mismatch') reasons.push('the target is formed only with the wrong stereochemistry');
  if (reviewProblems.length) reasons.push(`a route review raised ${reviewProblems.length} problem(s)`);
  // Not a reason the route failed: a caveat on what was examined. Kept out of `reasons` so it
  // cannot refuse a step, and said anyway so no one reads silence as a pass.
  const packUnchecked = audit.steps.filter((step) => Boolean(step.assemblyUnchecked));
  const coverage: string[] = [];
  if (bondUnchecked.length) {
    coverage.push(`the bond-edit check could not settle ${bondUnchecked.length} of ${audit.steps.length} step(s) (${bondUnchecked.map((step) => `step ${step.index + 1}`).join(', ')})${bondUnchecked[0]?.skeleton?.reason ? ` — ${bondUnchecked[0].skeleton.reason}` : ''}`);
  }
  if (packUnchecked.length) {
    coverage.push(`the per-molecule packing search gave up on ${packUnchecked.length} step(s) (${packUnchecked.map((step) => `step ${step.index + 1}`).join(', ')}) — ${packUnchecked[0].assemblyUnchecked}`);
  }
  const bondCaveat = coverage.length
    ? `Not examined: ${coverage.join('; ')}. Those checks say nothing about those steps either way — this is a gap in coverage, not a finding about the chemistry.`
    : '';
  const verified = !reasons.length;
  lines.push(verified
    ? reviewPending
      ? `**Route checks passed** — every equation balances and every intermediate is carried over${audit.target ? ', and the target is formed' : ''}. The model review is still running.`
      : `**Route checked: balanced and connected** — every equation balances and every intermediate is carried over${audit.target ? ', and the target is formed' : ''}. This is bookkeeping only: conditions, selectivity, yields and safety are not checked.`
    : `**Route check failed** — ${reasons.join('; ')}.`);
  // Said right under the verdict, where a problem would appear, so coverage is never mistaken for
  // a clean result. It does not change the verdict: a step whose bonds could not be examined has
  // not done anything wrong.
  if (bondCaveat) lines.push(bondCaveat);
  for (const step of audit.steps) {
    const label = `Step ${step.index + 1}`;
    if (!step.ok) {
      if (unbuilt(step)) {
        const forStep = unresolved.filter((entry) => entry.step === step.index + 1);
        const named = forStep.map((entry) => `${entry.byproduct ? 'byproduct' : entry.role} "${entry.name}"`);
        // A placeholder is a different fault from a name that merely would not resolve, and it
        // needs different advice: no structure exists to give, the species have to be listed.
        const placeholder = forStep.some((entry) => isPlaceholderSpecies(entry.name));
        const advice = placeholder
          ? 'That is a placeholder, not a species: list each one by name, or write "none".'
          : 'Give that species a name a reference resolves, or its structure.';
        lines.push(`- ${label} UNBUILT — nothing was checked: ${named.length ? `no structure resolved for ${named.join(', ')}` : 'a species it names has no resolved structure'}. ${advice}`);
        continue;
      }
      lines.push(`- ${label} FAIL — ${step.error ?? 'could not be parsed'}`);
      continue;
    }
    const racemic = step.racemic === true && step.unspecifiedStereocentres > 0;
    const moot = !racemic && step.stereoNotRequired === true && step.unspecifiedStereocentres > 0;
    const nameFailure = (step.nameProblems?.length ?? 0) > 0;
    const assemblyFailure = Boolean(step.assemblyProblem);
    const skeletonFailure = Boolean(step.skeletonProblem);
    // ONE predicate for both verdicts. This line used to re-list the causes by hand, and the hand
    // list did not know about `refiledReactant` or `monatomicSpecies` — so a step failing on only
    // those printed "OK — balanced" directly under a header that counted it as not passing.
    // Measured on the 30-target small-molecule cascade: 27 of 90 failing turns contradicted
    // themselves that way, and the two targets whose only fault was a lone atom (4-bromoaniline,
    // fluorobenzene) never recovered at any rung from being told, in one report, that the step was
    // both fine and not fine. `routeStepFailure` is a strict superset of the old list, so no step
    // that used to read FAIL can now read OK.
    const verdict = routeStepFailure(step) === null ? 'OK' : 'FAIL';
    const stereo = step.unspecifiedStereocentres
      ? racemic
        ? ', declared racemic (stereochemistry not controlled)'
        : moot
          ? `, ${step.unspecifiedStereocentres} open stereocentre(s) not required (lost before the target)`
          : `, ${step.unspecifiedStereocentres} unspecified stereocentre(s) or double bond(s)`
      : '';
    const balance = step.balanced
      ? 'balanced'
      : step.balanceUnchecked ? `balance NOT checked (${step.balanceUnchecked})` : `NOT balanced (${step.differences.join('; ')})`;
    const nameNote = nameFailure ? ` name check failed: ${step.nameProblems!.join('; ')}.` : '';
    // A step can balance only by solving an odd stoichiometry (8 citric acid → 9 …); the numbers
    // are shown, and a large one is called out, because that usually means a byproduct is wrong.
    // Only the carbon compounds count: water, acids and inorganic salts reach 7 or more in an
    // ordinary metal-oxo oxidation, while 8 citric acid → 9 … means a wrong product or byproduct.
    const organic = [...step.reactants, ...step.products].filter((entry) => formulaCounts(entry.formula || '').has('C'));
    const largest = Math.max(1, ...organic.map((entry) => entry.coefficient ?? 1));
    const largeNote = step.balanced && !assemblyFailure && largest > LARGE_COEFFICIENT
      ? ` Note: the carbon compounds balance only with large coefficients (up to ${largest}); the step passes, but check that its products and byproducts are the intended ones.`
      : '';
    const assemblyNote = assemblyFailure ? ` ${sentence(step.assemblyProblem ?? '')}` : '';
    // A balanced step that only balanced because something moved off the reactant side. The
    // sentence is what makes the assumption reviewable; the verdict above now counts it as a
    // failure too, which it already did in the route header and in the per-step fix chip.
    const refiledNote = step.refiledReactant ? ` ${step.refiledReactant}` : '';
    // Not plain "balanced" beside FAIL: the equation closed only after the checker moved a species
    // the author declared consumed.
    const balanceNote = step.balanced && step.refiledReactant ? REFILED_BALANCE : balance;
    // Printed for the same reason, and it is the more urgent of the two: a lone atom of a diatomic
    // element said nothing at all in this line, so the step named no fault while failing.
    const monatomicNote = step.monatomicSpecies ? ` ${step.monatomicSpecies}` : '';
    const skeletonNote = skeletonFailure ? ` ${sentence(step.skeletonProblem ?? '')}` : skeletonFacts(step);
    const agents = step.agents.length ? ` [agents: ${sideTrace(step.agents, names)}]` : '';
    const stepLabels = labels[step.index] ?? [];
    const reactantSide = groupedSideTrace(step.reactants, stepLabels.filter((entry) => entry.role === 'reactant'), names, step.balanced === true, step.products);
    const productSide = groupedSideTrace(step.products, stepLabels.filter((entry) => entry.role === 'product'), names, step.balanced === true, step.reactants);
    lines.push(`- ${label} ${verdict} — ${balanceNote}${stereo}.${nameNote}${largeNote}${refiledNote}${monatomicNote}${assemblyNote}${skeletonNote} ${reactantSide}${agents} → ${productSide}`);
    const alpha = alphaConfigurationLine(step, stepLabels);
    if (alpha) lines.push(alpha);
  }
  if (audit.links.length) {
    lines.push('', 'Intermediate continuity:', '');
    for (const link of audit.links) {
      const label = `Step ${link.from + 1} → ${link.to + 1}`;
      if (link.ok) {
        const carried = link.carried.map((entry) => entry.formula || entry.canonicalSmiles).join(', ');
        lines.push(`- ${label} OK — carried ${carried || 'the declared intermediate'}`);
      } else if (link.reason === 'constitution-only') {
        lines.push(`- ${label} FAIL — same constitution but different stereochemistry or charge`);
      } else if (link.reason === 'no-overlap') {
        lines.push(`- ${label} FAIL — no product of the earlier step is a reactant of the later one`);
      } else if (link.reason === 'declared-mismatch') {
        lines.push(`- ${label} FAIL — the declared intermediate is not the same structure on both sides`);
      } else {
        lines.push(`- ${label} FAIL — could not be checked because a step failed to parse`);
      }
    }
  }
  const target = audit.target;
  if (target) {
    const name = target.canonicalSmiles ? `\`${target.canonicalSmiles}\`${target.formula ? ` (${target.formula})` : ''}` : `\`${target.input}\``;
    // Where the request left a centre open it accepts either configuration, so the route is not
    // refused for choosing one. Which one it chose is the author's to accept, and saying so is the
    // whole point: before this the choice was made, was correct, and was invisible.
    const chose = target.openCentres?.length
      ? ` The request left ${target.openCentres.length === 1 ? 'one centre' : `${target.openCentres.length} centres`} open and the route delivers ${target.openCentres.map((centre) => `${centre.delivered} at atom ${centre.atom}`).join(', ')} — accepted, because the request did not ask for a particular one.`
      : '';
    lines.push('', target.reason === 'formed' && target.formedAt !== null
      ? `Target ${name}: formed in step ${target.formedAt + 1}.${chose}`
      : target.reason === 'stereo-mismatch'
        ? `Target ${name}: FAIL — a step forms its constitution but not its stereochemistry.`
        : target.reason === 'not-formed'
          ? `Target ${name}: FAIL — no step forms it.`
          : `Target ${name}: not checked — the requested structure could not be read.`);
  }
  // When the capability resolved the author's names against the structures, a name that
  // denotes a different molecule is reported here. The check is deterministic (OPSIN/PubChem
  // names resolved to a graph), so a silent rename is not mistaken for agreement.
  const named = audit.steps.flatMap((step) => [
    ...step.reactants.map((entry) => ({ role: 'reactant', entry })),
    ...step.agents.map((entry) => ({ role: 'agent', entry })),
    ...step.products.map((entry) => ({ role: entry.byproduct ? 'byproduct' : 'product', entry })),
  ]).filter((item) => item.entry.name && item.entry.nameOk === false);
  if (named.length) {
    lines.push('', 'Species names that do not match their structure:', '');
    for (const { role, entry } of named) {
      const structure = `\`${entry.canonicalSmiles}\`${entry.formula ? ` (${entry.formula})` : ''}`;
      lines.push(`- ${role} "${entry.name}" denotes a different structure than ${structure}.`);
    }
  }
  if (review?.status === 'problems' && review.problems.length) lines.push(...formatRouteReview(review));
  const recap = [...audit.blocked];
  if (reviewProblems.length) recap.push(`The route review raised ${reviewProblems.length} problem(s).`);
  lines.push('', verified
    ? reviewPending ? 'Checks passed so far; the verdict waits for the model review.' : 'Balanced and connected: every intermediate is carried over as the same structure.'
    : `Check failed: ${recap.join(' ')}`.trimEnd());
  return lines.join('\n');
}

/** One click on a blocked route: the button label and the correction request it sends as the
 *  user's next message. Rendered as a `nodus-route-fix` fence. */
export interface RouteFixChip {
  label: string;
  prompt: string;
}

const routeFixFence = (chip: RouteFixChip): string =>
  `\`\`\`nodus-route-fix\n${JSON.stringify(chip)}\n\`\`\``;

/** The names the author wrote under one role of one step, never the derived SMILES. */
function namedRoleNames(labels: RouteSpeciesLabel[][], index: number, role: RouteLabelRole, byproduct?: boolean): string {
  const entries = (labels[index] ?? []).filter((entry) => entry.role === role && (byproduct === undefined || entry.byproduct === byproduct));
  return entries.map((entry) => entry.name).filter(Boolean).join('; ') || 'none';
}

/** The four labelled lines of a step, names only. */
function namedStepLines(labels: RouteSpeciesLabel[][], index: number): string {
  return [
    `  Reactants: ${namedRoleNames(labels, index, 'reactant')}`,
    `  Products: ${namedRoleNames(labels, index, 'product', false)}`,
    `  Byproducts: ${namedRoleNames(labels, index, 'product', true)}`,
    `  Agents: ${namedRoleNames(labels, index, 'agent')}`,
  ].join('\n');
}

/** The four labelled lines with the resolved structure beside each name, for the route review:
 *  it needs the connectivity to judge regiochemistry, which the names alone do not give. */
function labelledStepLines(labels: RouteSpeciesLabel[][], step: RouteStepAudit): string {
  // Show the audit's canonical isomeric SMILES, not the raw resolved writing: the reference
  // services write the same compound differently, and the target is compared canonically, so
  // handing the review the raw string makes it read identical compounds as different.
  const canonical = new Map<string, string>();
  for (const species of [...step.reactants, ...step.agents, ...step.products]) {
    if (species.input && species.canonicalSmiles) canonical.set(species.input, species.canonicalSmiles);
  }
  const shown = (entry: RouteSpeciesLabel): string => {
    if (!entry.smiles) return entry.name;
    const smiles = entry.smiles.split('.').map((part) => canonical.get(part.trim()) ?? part.trim()).join('.');
    return `${entry.name} — \`${smiles}\``;
  };
  const side = (role: RouteLabelRole, byproduct?: boolean): string => {
    const entries = (labels[step.index] ?? []).filter((entry) => entry.role === role && (byproduct === undefined || entry.byproduct === byproduct));
    return entries.map(shown).filter(Boolean).join('; ') || 'none';
  };
  return [
    `  Reactants: ${side('reactant')}`,
    `  Products: ${side('product', false)}`,
    `  Byproducts: ${side('product', true)}`,
    `  Agents: ${side('agent')}`,
  ].join('\n');
}

/** Why a step's own equation needs correcting, or null when it passes on its own terms. */
/** Why a step fails the route check, or null when it passes. The one verdict every part of the
 *  report uses — the FAIL lines, the drawings and the correction prompts — so they never disagree. */
/** A request that gives its target without stereochemistry asks for the racemate (or does not
 *  care): a step whose only unspecified stereocentres are in that target is racemic by the
 *  request, not a failure to declare it. Intermediates, and a target requested with stereo,
 *  are still held to naming their stereoisomer. Marks such steps racemic in place. */
export function implyRacemicTarget(audit: RouteAudit, requestedTarget: string | null | undefined): RouteAudit {
  const target = audit.target?.canonicalSmiles;
  if (!requestedTarget || /[@/\\]/.test(requestedTarget) || !target) return audit;
  for (const step of audit.steps) {
    if (step.racemic || !(step.unspecifiedStereocentres > 0)) continue;
    const open = (step.products ?? []).filter((product) => product.unspecifiedStereocentres > 0);
    if (open.length && open.every((product) => product.canonicalSmiles === target)) {
      step.racemic = true;
      // The checker's own sentence about this step's open centres is stale now; the route
      // review is told what the checker found, so it must not read it.
      audit.blocked = audit.blocked.filter((entry) => !entry.startsWith(`Step ${step.index + 1} leaves `));
    }
  }
  return audit;
}

/** The bonds a passing step makes and breaks, stated so a reader — and the route reviewer, who
 *  reads this block — has the checker's facts rather than its own reading of the SMILES. Empty
 *  when no bond between heavy atoms changes. */
function skeletonFacts(step: RouteStepAudit): string {
  const facts = step.skeleton;
  const bonds = step.bonds ?? {};
  const signed = (net: number) => `${net > 0 ? '+' : '−'}${Number.isInteger(Math.abs(net)) ? Math.abs(net) : Math.abs(net).toFixed(2)}`;
  const parts: string[] = [];
  // C–C from the carbon mapping (which bonds, which ring), not the ledger's net count: a step
  // that breaks one C–C and forms another nets to zero but is not "no change".
  if (facts && facts.change !== 'unchecked') {
    if (facts.formed) parts.push(`+${facts.formed} C–C${facts.ringSizes.length ? ` (closing a ${facts.ringSizes.join('-, ')}-membered ring)` : ''}`);
    if (facts.cleaved) parts.push(`−${facts.cleaved} C–C`);
  } else if (bonds['C–C']) parts.push(`${signed(bonds['C–C'])} C–C`);
  for (const [pair, net] of Object.entries(bonds)) if (pair !== 'C–C') parts.push(`${signed(net)} ${pair}`);
  if (!parts.length) return '';
  const shift = facts?.migration ? ' — a 1,2-shift' : facts?.reorganised ? ' — the skeleton is reorganised' : '';
  const declared = step.rearrangement ? '; declared a rearrangement' : step.radical ? '; declared a radical or C–H functionalisation' : '';
  return ` Bonds made (+) and broken (−): ${parts.join(', ')}${shift}${declared}.`;
}

/** The model's own drawing requests, taken out of a route answer before the chat pipeline can
 *  run them.
 *
 *  In a route answer the application decides what gets drawn and when: nothing until every step
 *  passes, then one final report with a diagram per step. A `chemistry-plan` fence bypasses that
 *  entirely — it drew whatever the model asked for, on any turn, whatever the verdict. Measured on
 *  the 30-target cascade: 58 turns, all of them fix rounds, and every one of them failed the
 *  capability's 8000-character limit on `question` and printed a raw application error into the
 *  answer the author reads (B45). So this path produced no pictures and plenty of noise.
 *
 *  Only route turns are stripped. Asking for a structure in ordinary chat still draws it — that is
 *  the capability's own feature and nothing here touches it.
 *
 *  A residual, stated rather than hidden: the package's prepare hook can also adopt a bare `json`
 *  fence that reads like a drawing intent. Stripping every `json` fence from a route answer would
 *  take prose the author wants, so that path is left alone; it was never observed firing. */
export function stripDrawingRequests(answer: string): { text: string; removed: number } {
  let removed = 0;
  const text = answer.replace(/```chemistry-plan[ \t]*\r?\n[\s\S]*?\r?\n```/g, () => {
    removed += 1;
    return '_Not drawn here: a route draws nothing until every step passes, and then the final report draws them all._';
  });
  return { text, removed };
}

/** Every step of a route as the final report shows it: the balanced equation with names,
 *  coefficients and agents, plus the bond changes. One line per step.
 *
 *  Shares `groupedSideTrace` and `skeletonFacts` with the route check block above, so the final
 *  report cannot drift from the check that let it be printed — the two said different things
 *  about the same step once already (B44) and that cost more than the duplication saved.
 *
 *  Says nothing about whether the step passed: the caller only prints this once the whole route
 *  has, so a verdict per line would be noise. */
export function routeStepSummaries(audit: RouteAudit, labels: RouteSpeciesLabel[][] = []): Array<{ index: number; summary: string }> {
  const names = routeLabelNames(labels);
  return audit.steps.map((step) => {
    const stepLabels = labels[step.index] ?? [];
    const agents = step.agents.length ? ` [agents: ${sideTrace(step.agents, names)}]` : '';
    const reactants = groupedSideTrace(step.reactants, stepLabels.filter((entry) => entry.role === 'reactant'), names, step.balanced === true, step.products);
    const products = groupedSideTrace(step.products, stepLabels.filter((entry) => entry.role === 'product'), names, step.balanced === true, step.reactants);
    return { index: step.index, summary: `${reactants}${agents} → ${products}${skeletonFacts(step)}` };
  });
}

/** A message that is already a sentence keeps its own full stop. The checker ends most of its
 *  messages with one, and appending another put ".." in front of the model on most routes. */
function sentence(text: string): string {
  return /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

/** How a step that balanced only after the checker refiled a declared reactant is described. */
const REFILED_BALANCE = 'balanced only after the checker refiled a declared reactant';

export function routeStepFailure(step: RouteStepAudit): string | null {
  if (step.nameProblems?.length) return step.nameProblems.join('; ');
  if (!step.ok) return step.error ?? 'could not be parsed';
  if (step.balanced !== true) return step.balanceUnchecked ? `balance not checked (${step.balanceUnchecked})` : `not balanced (${step.differences.join('; ')})`;
  // A balanced step can still be impossible: the packing check refuses an equation that
  // assembles a product from more than one substrate. The report already shows this, so the
  // one-click prompts must name it too, or they point at a different step than the checker did.
  if (step.assemblyProblem) return step.assemblyProblem;
  // Likewise a balanced step whose bond changes the reactants cannot make: a ring closed onto a
  // carbon nothing activates, a bromine beyond the α-carbon, an undeclared 1,2-shift.
  if (step.skeletonProblem) return step.skeletonProblem;
  // And a step that balanced only because the checker overrode the author's own declaration: a
  // species they listed as consumed takes no part, so it was filed as a condition instead.
  //
  // Reported but not corrected, it was the one fault class the model never heard about. Measured
  // on one pair of runs: five instances where the model WAS told — the solver had given a listed
  // species coefficient 0 and no refiling rescued it — were all five fixed, and the route
  // verified; the single instance where it was not told survived the correction round unchanged.
  // Same error, and the only difference was whether it reached the model.
  //
  // Which path it takes also turns on nothing chemical. One species taking no part is rescued and
  // silent; two that cannot both be moved are reported and fixed. That is an artifact of how far
  // the rescue search reaches, not a judgement about the chemistry, so the two cases are now
  // reported alike.
  if (step.refiledReactant) return `${REFILED_BALANCE}: ${step.refiledReactant}`;
  // And a species written as a lone atom of a diatomic element. Reported here rather than as a
  // balance failure because it usually sits under Agents, which take no part in the balance: the
  // equation is right and the structure is not, so calling it unbalanced would name the wrong
  // fault. Found by two independent reviewers reading the same answer, where it had printed as
  // "nitrogen (N)" and passed.
  if (step.monatomicSpecies) return step.monatomicSpecies;
  if (step.unspecifiedStereocentres > 0 && step.racemic !== true && step.stereoNotRequired !== true) {
    // Say where the open centres are, so a model that already named something knows which name.
    const open = step.products.filter((entry) => entry.unspecifiedStereocentres > 0).map((entry) => `${entry.name ? `“${entry.name}”` : `\`${entry.canonicalSmiles}\``} (${entry.unspecifiedStereocentres})`);
    return `${step.unspecifiedStereocentres} unspecified stereocentre(s) or double bond(s)${open.length ? ` in ${open.join(', ')}` : ''} — name the stereoisomer formed (descriptors in its systematic name), or state in this step's own paragraph that the outcome is racemic, that the product is meso, or that its stereochemistry is not controlled (a mixture of diastereomers)`;
  }
  return null;
}

/** Every reason to offer a per-step fix for this step: its own failure, a disconnection, and
 *  any plan problem the model route review found in it. */
function namedStepReasons(step: RouteStepAudit, isolated: Set<number>, review: string[] = [], audit?: RouteAudit): string[] {
  const reasons: string[] = [];
  const failure = routeStepFailure(step);
  if (failure) reasons.push(failure);
  if (isolated.has(step.index)) {
    // The per-step chip has to carry the duplicate note too. Without it, "Fix step N" aims the
    // author at the orphan while the step to delete is the other one — the whole point of B22.
    const duplicate = audit ? orphanedByDuplicate(audit, step.index) : '';
    reasons.push(`disconnected from the rest of the route — none of its species is made by an earlier step or used by a later one${duplicate}`);
  }
  for (const detail of review) reasons.push(`review: ${detail}`);
  return reasons;
}

const NAMES_ONLY_FORMAT = ROUTE_LABEL_LINES.map((line) => `  ${line}`);

/** The rules every correction ends with: the same species rules the first request was given,
 *  then what to do with the target drawing. */
function correctionRules(target: string | null | undefined): string[] {
  return ['Rules for every step:', ...routeSpeciesRules().map((rule) => `- ${rule}`), '', correctionTargetPlanRule(target)];
}

/** Every species a step makes for the route to carry, byproducts excluded: those are what another
 *  step could consume, and what a second step could redundantly duplicate. */
function carriedProducts(step: RouteStepAudit): RouteSpeciesSummary[] {
  return (step.products ?? []).filter((entry) => entry.byproduct !== true && entry.canonicalSmiles);
}

/** Why a step is really orphaned, when the audit can tell.
 *
 *  An isolated step is usually a SYMPTOM, not the defect. When two steps produce the same species
 *  the earlier one is left with nothing to feed, and it is the earlier one the checker reports as
 *  disconnected — while the step the author has to delete is the LATER, redundant one. Saying only
 *  "step 1 is disconnected" sent three fix rounds at the innocent step on a short route, which went
 *  nowhere: the isolation was real and the route was defective, but the message aimed at the wrong
 *  place. The duplicate producer and the unmade reactant are both already in the audit, so state
 *  the pair as facts and leave the choice of which step to drop to the author. */
function orphanedByDuplicate(audit: RouteAudit, index: number): string {
  const step = audit.steps.find((entry) => entry.index === index);
  if (!step) return '';
  const producers = new Map<string, number[]>();
  for (const other of audit.steps) {
    for (const product of carriedProducts(other)) {
      producers.set(product.canonicalSmiles, [...(producers.get(product.canonicalSmiles) ?? []), other.index]);
    }
  }
  const duplicated = carriedProducts(step).find((entry) => (producers.get(entry.canonicalSmiles) ?? []).length > 1);
  if (!duplicated) return '';
  const all = (producers.get(duplicated.canonicalSmiles) ?? []).map((entry) => entry + 1).sort((a, b) => a - b);
  const others = all.filter((number) => number !== index + 1);
  const made = duplicated.name || duplicated.canonicalSmiles;
  // The redundant step usually also consumes something nothing produces — the clearest sign that
  // it, not this one, is the step to remove. Said only when the audit actually shows it.
  const unmade = new Set<string>();
  for (const other of audit.steps) {
    if (other.index === index) continue;
    if (!others.includes(other.index + 1)) continue;
    for (const reactant of other.reactants ?? []) {
      if (!reactant.canonicalSmiles) continue;
      if (!producers.has(reactant.canonicalSmiles)) unmade.add(reactant.name || reactant.canonicalSmiles);
    }
  }
  const alsoConsumes = unmade.size
    ? `, and step ${others.join(' and ')} consumes ${[...unmade].slice(0, 2).join(' and ')}, which no step makes`
    : '';
  const every = all.length === 2 ? 'both' : 'all';
  return ` Steps ${all.join(' and ')} ${every} produce ${made}${alsoConsumes}. So this step is orphaned by a duplicate rather than by a missing step: delete the redundant one of step ${others.join(' or ')}, or let this step's product feed it instead of making it again.`;
}

/** The route-level problems: a step that connects to nothing, and a target no step forms. */
function namedRouteProblems(labels: RouteSpeciesLabel[][], audit: RouteAudit): string[] {
  const problems: string[] = [];
  for (const index of isolatedSteps(audit)) {
    const duplicate = orphanedByDuplicate(audit, index);
    problems.push(duplicate
      ? `- Step ${index + 1} is disconnected: none of its species is made by an earlier step or used by a later one.${duplicate}`
      : `- Step ${index + 1} is disconnected: none of its species is made by an earlier step or used by a later one. Insert the missing step where it belongs, or write the carried species with the same IUPAC name in both steps.`);
  }
  for (const link of brokenRouteLinks(audit)) {
    if (link.reason === 'constitution-only') problems.push(`- Step ${link.from + 1} → ${link.to + 1}: step ${link.to + 1} consumes a different stereoisomer or charge state of the intermediate step ${link.from + 1} makes. Carry it with exactly the name step ${link.from + 1} gives it, or add the step that changes its form.`);
    else if (link.reason === 'declared-mismatch') problems.push(`- The intermediate declared as entering step ${link.to + 1} is not the same structure on both sides. Name it identically in step ${link.from + 1}'s Products and step ${link.to + 1}'s Reactants.`);
    else if (link.reason === 'no-overlap') problems.push(`- Step ${link.from + 1} → ${link.to + 1}: no intermediate is carried over. Make a product of step ${link.from + 1} a reactant of step ${link.to + 1}, with the same name.`);
  }
  const target = audit.target;
  if (target && audit.steps.every((step) => step.ok)) {
    const wanted = target.canonicalSmiles ?? target.input;
    const lastProducts = (labels[labels.length - 1] ?? []).filter((entry) => entry.role === 'product').map((entry) => entry.name).join(', ');
    if (target.reason === 'not-formed') problems.push(`- No step forms the requested target${target.formula ? ` (${target.formula})` : ''}${lastProducts ? `; the last step stops at ${lastProducts}` : ''}. Add the missing step so a final step's Products line names the target.`);
    else if (target.reason === 'stereo-mismatch') problems.push(`- The route forms the target's constitution but not its stereochemistry (${wanted}). Name the target with its stereodescriptors in the step that sets them.`);
  }
  return problems;
}

/** How the correction names the requested target: the route's own name for it when the audit
 *  matched one (a product whose canonical SMILES is the target), with the canonical SMILES as the
 *  authoritative anchor so the model cannot substitute a different compound. Empty with no target.
 */
function routeTargetDescriptor(audit: RouteAudit): string {
  const target = audit.target;
  if (!target) return '';
  const smiles = target.canonicalSmiles ?? target.input;
  const named = audit.steps
    .flatMap((step) => step.products)
    .find((product) => product.name && product.nameOk !== false && product.canonicalSmiles === target.canonicalSmiles);
  // The SMILES is the application's own anchor, not something to copy into the answer (the
  // surrounding prompt forbids SMILES), so label where it comes from.
  if (named?.name && smiles) return `${named.name}, canonical SMILES \`${smiles}\``;
  if (named?.name) return named.name;
  if (smiles && target.formula) return `canonical SMILES \`${smiles}\` (${target.formula})`;
  return smiles ? `canonical SMILES \`${smiles}\`` : '';
}

/** Evidence under a rejected step in a correction: the index's other ways to make its product
 *  and a textbook passage, marked as evidence so the model weighs it and still writes names. */
function fixEvidence(support: StepSupport | undefined, indent: string): string {
  const lines: string[] = [];
  const alternatives = support?.alternatives?.proposals.slice(0, ALTERNATIVES_SHOWN) ?? [];
  if (alternatives.length) lines.push(`${indent}Evidence, not an instruction — the Open Reaction Database makes \`${support!.alternatives!.product}\` from: ${alternatives.map(alternativeLine).join(' · ')}. Write any species you take from it by name.`);
  if (support?.passage) lines.push(`${indent}Textbook, on ${support.passage.about}: ${support.passage.title}${support.passage.location ? `, ${support.passage.location}` : ''} (${support.passage.citation}).`);
  for (const clash of support?.compatibility ?? []) lines.push(`${indent}Compatibility check (evidence, not an instruction): ${clash}.`);
  return lines.length ? `\n${lines.join('\n')}` : '';
}

/** When one fault repeats across steps, say it ONCE with the list of steps.
 *
 *  Ten copies of the same sentence read as ten separate problems and invite ten local edits.
 *  Named once with its steps it reads as the single systematic mistake it is — which is what the
 *  author actually has to change. Observed: one route failed ten coupling steps for the same
 *  reason, and three correction rounds edited them one at a time without ever addressing the
 *  pattern. The arithmetic differs per step, so the numbers are stripped to key the CLASS of
 *  fault rather than its particulars. */
function repeatedFaultSummary(flagged: Array<{ step: RouteStepAudit; reasons: string[] }>): string[] {
  const groups = new Map<string, { steps: number[]; sample: string }>();
  for (const entry of flagged) {
    const failure = routeStepFailure(entry.step);
    if (!failure) continue;
    const key = failure.replace(/\d+/g, '#').replace(/\s+/g, ' ').slice(0, 200);
    const seen = groups.get(key);
    if (seen) seen.steps.push(entry.step.index + 1);
    else groups.set(key, { steps: [entry.step.index + 1], sample: failure });
  }
  const repeated = [...groups.values()].filter((group) => group.steps.length > 1);
  if (!repeated.length) return [];
  return [
    'One fault repeats below, so this is one mistake made several times, not several mistakes. Fix the pattern rather than each step on its own:',
    ...repeated.map((group) => `- step ${group.steps.join(', step ')} all fail the same way: ${sentence(group.sample.split('. ')[0])}`),
    '',
  ];
}

function namedFixPreamble(failures: string[], problems: string[], review: RouteReviewProblem[] = [], flagged: Array<{ step: RouteStepAudit; reasons: string[] }> = []): string[] {
  return [
    ROUTE_FIX_PROMPT_LEAD,
    '',
    ...repeatedFaultSummary(flagged),
    ...(failures.length ? ['The route checker rejected these steps:', ...failures, ''] : []),
    ...(problems.length ? ['The route as a whole has these problems:', ...problems, ''] : []),
    ...(review.length ? ['A model review of the route plan also reported:', ...review.map((problem) => `- ${problem.step > 0 ? `Step ${problem.step}: ` : ''}${problem.detail}`), ''] : []),
  ];
}

/** A names-first route that was refused is offered as a small set of one-click corrections:
 *  fix all failed steps, work backwards from the target, or fix one flagged step on its own
 *  (with split/combine allowed). Each shows the species as IUPAC names only — never the
 *  derived SMILES, which the model did not write. Empty when nothing needs fixing. */
/** The note under a step whose species did not resolve: the checker built the step without
 *  them, so its balance failure is a symptom, and the fix is a name the resolver knows. */
function unresolvedStepLines(names: UnresolvedName[], indent: string): string {
  if (!names.length) return '';
  const roleWord = (entry: UnresolvedName) => (entry.byproduct ? 'Byproduct' : entry.role === 'reactant' ? 'Reactant' : entry.role === 'product' ? 'Product' : 'Agent');
  return names.map((entry) => `${indent}- “${entry.name}” (${roleWord(entry)}) could not be resolved to a structure, so the checker built this step without it; any balance failure above follows from that. Give it a systematic IUPAC name for the whole species (a salt by its cation and anion), or — for a reactive intermediate such as an enolate salt, which references rarely name — its isomeric SMILES.\n`).join('');
}

export function formatNamedRouteFixPrompts(labels: RouteSpeciesLabel[][], audit: RouteAudit, review: RouteReview | null = null, support?: Map<number, StepSupport>, unresolved: UnresolvedName[] = []): string {
  const problems = namedRouteProblems(labels, audit);
  const isolated = new Set(isolatedSteps(audit));
  const reviewProblems = blockingReviewProblems(review);
  const reviewByStep = new Map<number, string[]>();
  for (const problem of reviewProblems) {
    if (problem.step <= 0) continue;
    reviewByStep.set(problem.step, [...(reviewByStep.get(problem.step) ?? []), problem.detail]);
  }
  const flagged = audit.steps
    .map((step) => ({ step, reasons: namedStepReasons(step, isolated, reviewByStep.get(step.index + 1) ?? [], audit) }))
    .filter((entry) => entry.reasons.length);
  const failures = flagged
    .filter((entry) => routeStepFailure(entry.step) !== null)
    .map((entry) => `- Step ${entry.step.index + 1}: ${routeStepFailure(entry.step)}\n${namedStepLines(labels, entry.step.index)}${unresolvedStepLines(unresolved.filter((name) => name.step === entry.step.index + 1), '  ')}${fixEvidence(support?.get(entry.step.index), '  ')}`);
  // A step whose unresolved species left it passing (or unchecked) still needs the name fixed.
  const failedSteps = new Set(flagged.filter((entry) => routeStepFailure(entry.step) !== null).map((entry) => entry.step.index + 1));
  for (const step of [...new Set(unresolved.map((name) => name.step))].filter((step) => !failedSteps.has(step)).sort((a, b) => a - b)) {
    failures.push(`- Step ${step}: a species did not resolve to a structure\n${unresolvedStepLines(unresolved.filter((name) => name.step === step), '  ')}`);
  }
  if (!flagged.length && !problems.length && !reviewProblems.length && !unresolved.length) return '';

  const target = routeTargetDescriptor(audit);
  const atTarget = target ? ` (${target})` : '';
  const quotedTarget = audit.target?.input;
  const relabel = 'Re-output the complete route, in order: each step keeps its prose and ends with the four labelled lines of systematic IUPAC names, names only (except the structure fallback in the rules):';
  const chips: RouteFixChip[] = [];
  chips.push({
    label: 'Ask the model to fix the failed steps',
    prompt: [
      ...namedFixPreamble(failures, problems, reviewProblems, flagged),
      relabel,
      ...NAMES_ONLY_FORMAT,
      `What may change: only the rejected steps above and what their failures require. You may split a rejected step, combine it with a neighbour (see the rules below), insert a missing step, or remove a step reported above as disconnected or redundant. Every other step keeps its prose and names exactly, and no step is duplicated. The route must still reach the requested target${atTarget}.`,
      ...correctionRules(quotedTarget),
    ].join('\n'),
  });
  chips.push({
    label: 'Fix from the target backwards',
    prompt: [
      ...namedFixPreamble(failures, problems, reviewProblems, flagged),
      `Work backwards from the final step. First make the last step name the requested target${atTarget} as a Product. Then move to the step before it and make its Products line name exactly the species the next step consumes as a Reactant. Continue back to step 1, so every step's product is the next step's reactant (or a permitted starting material).`,
      'What may change: this is the one correction that may rename a species in a step that already passes — only so that its Products line names exactly the species the next step consumes. Otherwise a passing step keeps its prose and names. Split, combine, insert or remove steps only where the failures above require it.',
      relabel,
      ...NAMES_ONLY_FORMAT,
      ...correctionRules(quotedTarget),
    ].join('\n'),
  });
  for (const entry of [...flagged].reverse()) {
    if (!entry.reasons.length) continue;
    const index = entry.step.index;
    const previous = index - 1;
    const next = index + 1;
    chips.push({
      label: `Fix step ${index + 1}`,
      prompt: [
        `${ROUTE_FIX_STEP_LEAD}${index + 1} of the synthesis route above.`,
        '',
        `Step ${index + 1} was rejected: ${entry.reasons.join('; ')}`,
        namedStepLines(labels, index) + unresolvedStepLines(unresolved.filter((name) => name.step === index + 1), '') + fixEvidence(support?.get(index), ''),
        '',
        'For context:',
        previous >= 0
          ? `  Step ${previous + 1} Products: ${namedRoleNames(labels, previous, 'product', false)}; Byproducts: ${namedRoleNames(labels, previous, 'product', true)}`
          : '  It is the first step.',
        next < audit.steps.length
          ? `  Step ${next + 1} Reactants: ${namedRoleNames(labels, next, 'reactant')}`
          : `  It is the last step, so its Products must include the requested target${atTarget}.`,
        '',
        relabel,
        ...NAMES_ONLY_FORMAT,
        `What may change: only step ${index + 1}. You may split step ${index + 1} into consecutive steps, or combine it with an adjacent step when together they are one net transformation that balances as a single equation (never a workup — see the rules) — the combined step replaces both, so the absorbed neighbour is the only other step that changes and its own line disappears. Every other step keeps its prose and names exactly.`,
        ...correctionRules(quotedTarget),
      ].join('\n'),
    });
  }
  return chips.map(routeFixFence).join('\n\n');
}

// ---------------------------------------------------------------- name-resolution feedback

/** A species whose name the reference services could not resolve. */
export interface UnresolvedName {
  step: number;
  role: RouteLabelRole;
  byproduct: boolean;
  name: string;
  feedback?: string;
}

/** The system prompt for the resolution feedback loop: turn each name the references could
 *  not resolve into a true systematic IUPAC name without changing the species. */
export const ROUTE_NAME_FEEDBACK_SYSTEM = [
  'You fix chemical names so a reference service can resolve them to a structure.',
  'You are given species whose names PubChem and OPSIN could not resolve. For each, return the correct systematic IUPAC name of the same species, using the step prose for context and the resolver feedback for why the current name failed.',
  'Keep the identity: do not change which compound it is, do not drop stereochemistry the prose states, and do not invent a different reagent.',
  'Prefer a name a reference service holds — for example the systematic salt name `sodium but-1-yn-1-ide` rather than `sodium but-1-ynide`.',
  'If you cannot construct a name the reference services will resolve — an exotic fused polycycle, a cage, a named literature intermediate whose systematic name you cannot derive reliably — do not guess. Give the STRUCTURE instead: its isomeric SMILES. The application checks the structure with RDKit and, when PubChem holds it, reads its name back.',
  'Return EXCLUSIVELY one JSON object. For a name: {"names":[{"from":"the name I gave you","to":"the corrected systematic IUPAC name"}]}. For a structure you cannot name: {"names":[{"from":"the name I gave you","smiles":"the isomeric SMILES"}]}.',
  'Do not invent a name or a structure you are unsure of; a wrong structure is worse than a stated limitation.',
  'If you cannot name or describe a species at all, omit it from the array.',
].join('\n');

export function buildNameFeedbackRequest(species: UnresolvedName[], prose: string): string {
  return [
    'Species whose names did not resolve:',
    JSON.stringify(species.map((entry) => ({ step: entry.step, role: entry.byproduct ? 'byproduct' : entry.role, name: entry.name, resolver_feedback: entry.feedback ?? '' }))),
    '',
    'The route prose for context:',
    prose.slice(0, 8000),
  ].join('\n');
}

/** A structure the model may hand back in place of a name: one line of isomeric SMILES, with no
 *  prose, markup or whitespace inside it. */
function isPlausibleStructure(value: string): boolean {
  return value.length >= 2 && value.length <= 2000 && /[A-Za-z]/.test(value) && !/[\s`<>{}"|]/.test(value);
}

/** One correction from the name-feedback loop: the model either fixes the name or, when it
 *  cannot name the species, supplies the structure instead. */
export interface NameFeedbackEntry {
  from: string;
  /** The corrected systematic name, or a structure (isomeric SMILES / PubChem CID). */
  to: string;
  kind: 'name' | 'structure';
}

export function parseNameFeedback(raw: string): NameFeedbackEntry[] {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) return [];
  let value: unknown;
  try { value = JSON.parse(match[0]); } catch { return []; }
  const record = asRecord(value);
  const list = Array.isArray(record?.names) ? record.names as unknown[] : [];
  return list.map((entry) => {
    const item = asRecord(entry);
    if (!item || typeof item.from !== 'string') return null;
    // As long as the parser lets a name be (MAX_SPECIES_NAME). At 200, a longer name came back as
    // its first 200 characters: `from` then matched no species, so the rename was never applied,
    // and a `to` that long was cut short, so it could never resolve.
    const from = item.from.trim().slice(0, MAX_SPECIES_NAME);
    if (!from || !isPlausibleSpeciesName(from)) return null;
    if (typeof item.smiles === 'string' && item.smiles.trim()) {
      const smiles = item.smiles.trim().slice(0, 2000);
      if (isPlausibleStructure(smiles)) return { from, to: smiles, kind: 'structure' as const };
    }
    if (typeof item.to === 'string' && item.to.trim()) {
      const to = item.to.trim().slice(0, MAX_SPECIES_NAME);
      if (to && isPlausibleSpeciesName(to)) return { from, to, kind: 'name' as const };
    }
    return null;
  }).filter((entry): entry is NameFeedbackEntry => entry !== null).slice(0, 48);
}

/** A short note naming the species the author supplied as structures because no reference
 *  would name them, so a checked route never hides that its structure came from the model. */
export function formatAuthorStructureNote(entries: string[]): string {
  const unique = [...new Set(entries.map((entry) => entry.trim()).filter(Boolean))];
  return unique.length ? `Author-supplied structures (no reference name was available): ${unique.join('; ')}` : '';
}

/** Where each species' structure came from, as one line. The author-supplied ones are named
 *  individually by formatAuthorStructureNote, because that is the category a wrong structure
 *  hides in; the rest are counted, which is what a run needs recorded to compare with the next
 *  one. Without this a run cannot say whether a protected name was resolved offline, looked up,
 *  or taken from the model. */
export function formatResolutionSourceNote(species: Array<{ status: string; source?: string }>): string {
  const label: Record<string, string> = {
    builtin: 'the built-in dictionary', pubchem: 'PubChem', opsin: 'OPSIN', declared: 'the answer itself',
  };
  const counts = new Map<string, number>();
  for (const entry of species) {
    if (entry.status === 'unresolved') continue;
    const key = entry.source ?? 'unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!counts.size) return '';
  const order = ['builtin', 'pubchem', 'opsin', 'declared', 'unknown'];
  const parts = [...counts].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([key, count]) => `${count} from ${label[key] ?? 'an unnamed resolver'}`);
  return `Structures resolved: ${parts.join(' · ')}.`;
}

/** The escalation when a name cannot be resolved to a structure even after the feedback
 *  loop: name the species and why, so the user can confirm or correct it. */
export function formatUnresolvedNameClarification(unresolved: UnresolvedName[], target?: string | null): string {
  const lines = unresolved.map((entry) => `- Step ${entry.step} ${entry.byproduct ? 'byproduct' : entry.role} "${entry.name}"${entry.feedback ? `: ${entry.feedback}` : ''}`);
  const prompt = [
    ROUTE_UNRESOLVED_LEAD,
    '',
    'Unresolved species:',
    ...lines,
    '',
    ...(unresolved.some((entry) => isPlaceholderSpecies(entry.name))
      ? ['A placeholder such as "see prose" or "as above" is not a species and has no structure: list every species of that step by name, or write "none" when a side has none.', '']
      : []),
    'Re-output the complete route, in order, with each unresolved species corrected. What may change: only those names — every step keeps its prose and every other name exactly. Each step ends with the four labelled lines of systematic IUPAC names, names only:',
    ...NAMES_ONLY_FORMAT,
    ...correctionRules(target),
  ].join('\n');
  return `\`\`\`nodus-route-fix\n${JSON.stringify({ label: 'Confirm the intended structure', prompt })}\n\`\`\``;
}

/** Offered when a route describes steps but lists no species under the four required labels, so
 *  nothing could be checked. One click asks the model to re-emit with the labelled lines. */
export function formatMissingSpeciesPrompt(target?: string | null): string {
  const prompt = [
    ROUTE_MISSING_SPECIES_LEAD,
    'Re-output the same route in the same order. What may change: nothing but the added lines — keep the prose for each step, and add exactly the four labelled lines after it:',
    ...NAMES_ONLY_FORMAT,
    ...correctionRules(target),
  ].join('\n');
  return `\`\`\`nodus-route-fix\n${JSON.stringify({ label: 'Ask the model to list the species', prompt })}\n\`\`\``;
}
