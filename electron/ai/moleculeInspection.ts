import type { ModelRef } from '@shared/types';
import {
  annotateSpeciesSmiles,
  buildNameFeedbackRequest,
  buildRouteReviewRequest,
  buildPrecedentQueries,
  buildRouteSteps,
  classifyCoProducts,
  countRouteSteps,
  isBareSmilesName,
  isolatedSteps,
  stepDeclaresRacemic,
  stepDeclaresRearrangement,
  stepDeclaresRadical,
  findAnswerSpecies,
  findSmilesCandidates,
  findStepConditions,
  findStepNamedSpecies,
  findStepProse,
  formatNamedRouteFixPrompts,
  formatReactionPrecedents,
  collectStepEvidence,
  formatEvidenceSources,
  routeStepFailure,
  routeStepSummaries,
  formatRouteAudit,
  formatRouteCheckUnavailable,
  formatStructureAudit,
  formatUnresolvedNameClarification,
  implyRacemicTarget,
  normalizeMoleculeDossier,
  normalizeReactionPrecedent,
  normalizeRouteAudit,
  parseNameFeedback,
  parseRouteReview,
  ROUTE_NAME_FEEDBACK_SYSTEM,
  ROUTE_REVIEW_SYSTEM,
  type MoleculeDossier,
  type NamedSpecies,
  type NameFeedbackEntry,
  type PrecedentQuery,
  type ReactionPrecedent,
  type ResolvedSpecies,
  type RouteAudit,
  type RouteStepAudit,
  type RouteReview,
  type RouteSpeciesLabel,
  type StepSupport,
  type UnresolvedName,
  MAX_SPECIES_NAME,
} from '@shared/moleculeInspection';
import { routeReviewTokens } from '@shared/researchRetrievalBudget';
import { compoundAvailability, findStartingSmiles, formatStartingMaterialStock, formatTargetAvailability, relevantExcerpt, routeStartingMaterials, routeTargetSmiles, textbookQueryForClass } from '@shared/synthesisEvidence';
import { chemistryStockDirectory } from './chemistryStock';
import { textbookCitations, textbookSchemeDirectory } from './textbookSchemes';
import { formatTextbookPrecedents, TEXTBOOK_ID } from '@shared/textbookSchemes';
import { compatibilityFixLines, formatCompatibility, normalizeCompatibility, type StepCompatibility } from '@shared/stepCompatibility';
import { invokeDisconnections, synthesisEvidenceWorkIds, textbookPassages } from './synthesisEvidence';
import type { ChemistryEvidenceScope } from './chemistryEvidenceScope';
import { capabilityRegistry, pinCapabilitiesForTurn, type CapabilityProvider } from '../capabilities/registry';
import { createTrustedCapabilityRunner } from '../capabilities/runner';
import { reactionIndexService } from '../reactionIndex';
import { completeText } from './aiClient';
import type { ViewDocumentV1 } from '../../packages/capability-api/src/views';

/** The read-only inspection tool Chemistry Studio must declare. When an older package
 *  only exposes `compile`, these steps are skipped and Research Chat behaves as before. */
const CHEMISTRY_CAPABILITY = 'nodus:chemistry';
const INSPECT_TOOL = 'inspect';
const ROUTE_TOOL = 'verify-route';
const COMPILE_TOOL = 'compile';
const KNOWN_REACTIONS_TOOL = 'known-reactions';
const MAX_BATCH = 24;
/** Each step is a full validated compile, so this bounds a pathological route. The final report
 *  only runs on a route where every step passed, so this is a backstop rather than a triage rule:
 *  anything past it is listed as not drawn instead of silently missing. */
const MAX_ROUTE_DRAWINGS = 16;

interface InspectOptions {
  evidenceScope?: ChemistryEvidenceScope;
  model?: ModelRef | null;
  locale?: string;
  signal?: AbortSignal;
  enabled?: boolean;
  /** The conversation that owns stored artifacts, when the chat is saved. */
  owner?: string;
  /** The requested target as SMILES; the route check then requires the route to form it. */
  target?: string | null;
  /** The researcher's request, given to the route review as context. */
  question?: string;
  /** A runner shared across the whole post-answer phase, so the capability worker is opened
   *  once. When absent each phase opens and closes its own. */
  runner?: Runner;
  /** Called with the deterministic report and drawings as soon as they exist, before the
   *  route review lands, so the reply can show them without waiting on the reviewer. */
  onDeterministic?: (text: string) => void;
}

function inspectProvider() {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return provider && provider.tools.some((tool) => tool.id === INSPECT_TOOL) ? provider : null;
}

/** True when the enabled Chemistry Studio package exposes the read-only inspector. */
export function moleculeInspectionAvailable(): boolean {
  return inspectProvider() !== null;
}

async function inspectCandidates(candidates: string[], options: InspectOptions): Promise<MoleculeDossier[]> {
  if (!candidates.length) return [];
  const provider = inspectProvider();
  if (!provider) return [];
  const { runner, dispose } = chemistryRunner(options);
  const dossiers: MoleculeDossier[] = [];
  try {
    for (let start = 0; start < candidates.length; start += MAX_BATCH) {
      options.signal?.throwIfAborted();
      const batch = candidates.slice(start, start + MAX_BATCH);
      try {
        const result = await runner.invoke({ provider, toolId: INSPECT_TOOL, input: { smiles: batch } });
        for (const artifact of result.artifacts ?? []) {
          const data = artifact.data as Record<string, unknown> | null;
          const inputSmiles = data && typeof data.inputSmiles === 'string' ? data.inputSmiles : '';
          const dossier = normalizeMoleculeDossier(data, inputSmiles);
          if (dossier) dossiers.push(dossier);
        }
      } catch {
        /* one unparseable batch must not block the answer */
      }
    }
  } finally {
    await dispose();
  }
  return dossiers;
}

/** Verifies the SMILES in the user's question before the model answers, so the target
 *  is a checked graph rather than text the model has to re-read. */
export async function inspectResearchMolecules(
  question: string,
  options: InspectOptions = {},
): Promise<MoleculeDossier[]> {
  if (options.enabled === false) return [];
  return inspectCandidates(findSmilesCandidates(question), options);
}

/** Non-blocking post-answer check: parses every species the model proposed and appends a
 *  deterministic RDKit report. Never rewrites the answer and never asks the model again. */
export async function appendStructureAudit(
  finalAnswer: string,
  modelAnswer: string,
  options: InspectOptions = {},
): Promise<string> {
  if (options.enabled === false || !moleculeInspectionAvailable()) return finalAnswer;
  const species = findAnswerSpecies(modelAnswer);
  if (!species.length) return finalAnswer;
  const dossiers = await inspectCandidates(species, options);
  // A tool failure must not present every species as unparseable; only report when at
  // least one structure was actually verified.
  if (!dossiers.length) return finalAnswer;
  return `${finalAnswer.trimEnd()}\n\n${formatStructureAudit(species, dossiers)}\n`;
}

function routeProvider() {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return provider && provider.tools.some((tool) => tool.id === ROUTE_TOOL) ? provider : null;
}

function compileProvider() {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return provider && provider.tools.some((tool) => tool.id === COMPILE_TOOL) ? provider : null;
}

/** True when the enabled Chemistry Studio package exposes the read-only route checker. */
export function routeVerificationAvailable(): boolean {
  return routeProvider() !== null;
}

function knownReactionsProvider() {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return provider && provider.tools.some((tool) => tool.id === KNOWN_REACTIONS_TOOL) ? provider : null;
}

/** A runner lease for one phase. A caller-supplied shared runner is reused and this lease
 *  owns nothing; otherwise it owns a fresh runner and disposing stops it. Sharing opens the
 *  capability worker once per turn, so its reference cache serves the resolve pass and the
 *  route audit instead of paying for a second worker and a second network pass. */
export function chemistryRunner(options: InspectOptions): { runner: Runner; dispose: () => Promise<void> } {
  if (options.runner) return { runner: options.runner, dispose: async () => {} };
  const runner = createTrustedCapabilityRunner({
    locale: options.locale ?? 'en',
    model: options.model ?? null,
    pins: pinCapabilitiesForTurn(),
    signal: options.signal,
    ...(options.owner ? { owner: options.owner } : {}),
    runCoreStages: async (text) => text,
  });
  return { runner, dispose: async () => { await runner.dispose?.(); } };
}

type Runner = ReturnType<typeof createTrustedCapabilityRunner>;

/** Whether the installed package declares the `labels` field, so an older package is not
 *  sent an input its schema would reject. */
function routeAcceptsLabels(provider: CapabilityProvider): boolean {
  const schema = provider.tools.find((tool) => tool.id === ROUTE_TOOL)?.inputSchema as { properties?: Record<string, unknown> } | undefined;
  return Boolean(schema?.properties && 'labels' in schema.properties);
}

/** The longest species label the installed package declares it will accept. A species given as
 *  its own structure carries that structure as its label, and cutting one corrupts the molecule
 *  it is displayed under, so follow the schema rather than a figure fixed here: an older package
 *  keeps its shorter limit, a newer one is used to the full. */
function routeLabelNameLimit(provider: CapabilityProvider): number {
  const schema = provider.tools.find((tool) => tool.id === ROUTE_TOOL)?.inputSchema as
    { properties?: { labels?: { items?: { items?: { properties?: { name?: { maxLength?: unknown } } } } } } } | undefined;
  const declared = schema?.properties?.labels?.items?.items?.properties?.name?.maxLength;
  return typeof declared === 'number' && declared > 0 ? declared : 1000;
}

function routeAccepts(provider: CapabilityProvider, property: string): boolean {
  const schema = provider.tools.find((tool) => tool.id === ROUTE_TOOL)?.inputSchema as { properties?: Record<string, unknown> } | undefined;
  return Boolean(schema?.properties && property in schema.properties);
}

/** Whether the route check may enumerate stereoisomers in the package's Python runtime: only
 *  where that runtime is already installed, which the downloaded reaction index implies, so a
 *  route check never starts an install. */
async function stereoEnumerationAvailable(provider: CapabilityProvider): Promise<boolean> {
  if (!routeAccepts(provider, 'enumerateStereo')) return false;
  try { return Boolean(await reactionIndexService().localDirectory()); } catch { return false; }
}

async function invokeRoute(runner: Runner, provider: CapabilityProvider, steps: string[], racemic?: boolean | boolean[], target?: string | null, labels?: RouteSpeciesLabel[][], declared: { rearrangement?: boolean[]; radical?: boolean[] } = {}): Promise<RouteAudit | null> {
  // A package that predates `target`/`labels` ignores them, and the audit simply has no
  // target entry or name check. The schema probe keeps a 2.3.0 package from rejecting an
  // input it never declared.
  const named = labels && labels.some((entries) => entries.length);
  const labelLimit = named ? routeLabelNameLimit(provider) : 0;
  const input = {
    steps,
    ...(racemic ? { racemic } : {}),
    // Declared rearrangements and radical steps, per step from their own prose: only to a package
    // whose route tool reads them (the skeleton check), so an older one is never sent them.
    ...(declared.rearrangement?.some(Boolean) && routeAccepts(provider, 'rearrangement') ? { rearrangement: declared.rearrangement } : {}),
    ...(declared.radical?.some(Boolean) && routeAccepts(provider, 'radical') ? { radical: declared.radical } : {}),
    ...(target ? { target } : {}),
    // A long species name is still sent, cut to whatever the installed package's schema allows:
    // one overlong name must not make the package reject the whole route, and a species given as
    // its own structure carries that structure as its name, so cutting one to a figure fixed
    // here would corrupt the label it is displayed under.
    ...(named && routeAcceptsLabels(provider) ? { labels: labels!.map((entries) => entries.map((entry) => ({ ...entry, name: entry.name.slice(0, labelLimit) }))) } : {}),
    ...(await stereoEnumerationAvailable(provider) ? { enumerateStereo: true } : {}),
  };
  const result = await runner.invoke({ provider, toolId: ROUTE_TOOL, input });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'route-audit');
  const audit = artifact ? normalizeRouteAudit(artifact.data) : null;
  // Older installed packages (including 2.5.6) drop empty steps. Updating the bootstrap
  // does not upgrade a user's active plugin, so verify the returned positions before any
  // labels, corrections or drawings are associated with them.
  if (audit && (audit.steps.length !== steps.length || audit.steps.some((step, index) => step.index !== index))) {
    throw new Error('The installed chemistry package omitted or renumbered route steps. Update Chemistry Studio before checking this route');
  }
  return audit;
}

/** Looks the route's reactions and target up in the local Open Reaction Database index, when
 *  the package exposes the tool and the index has been downloaded and verified. Best-effort:
 *  an absent index, an older package or a tool failure all return null and change nothing. */
export async function lookupReactionPrecedent(runner: Runner, steps: string[], options: InspectOptions): Promise<{ precedent: ReactionPrecedent; provider: CapabilityProvider } | null> {
  options.signal?.throwIfAborted();
  if (options.evidenceScope?.external === false) return null;
  const provider = knownReactionsProvider();
  if (!provider) return null;
  const indexDir = await reactionIndexService().localDirectory();
  options.signal?.throwIfAborted();
  if (!indexDir) return null;
  try {
    const result = await runner.invoke({
      provider,
      toolId: KNOWN_REACTIONS_TOOL,
      input: {
        indexDir,
        reactions: steps.slice(0, 32),
        products: options.target ? [options.target] : [],
        similar: steps.slice(0, 16),
      },
    });
    const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'reaction-precedent');
    const precedent = artifact ? normalizeReactionPrecedent(artifact.data) : null;
    return precedent ? { precedent, provider } : null;
  } catch {
    return null;
  }
}

/** The same lookup against the textbook-scheme index (reactions read from the user's own books),
 *  when it has been built. Best-effort like the ORD lookup: null on any absence or failure. */
export async function lookupTextbookPrecedent(runner: Runner, steps: string[], options: InspectOptions): Promise<ReactionPrecedent | null> {
  const provider = knownReactionsProvider();
  options.signal?.throwIfAborted();
  const indexDir = provider ? textbookSchemeDirectory(options.evidenceScope) : null;
  if (!provider || !indexDir) return null;
  try {
    const result = await runner.invoke({
      provider,
      toolId: KNOWN_REACTIONS_TOOL,
      input: {
        indexDir,
        reactions: steps.slice(0, 32),
        products: options.target ? [options.target] : [],
        similar: steps.slice(0, 16),
      },
    });
    const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'reaction-precedent');
    return artifact ? normalizeReactionPrecedent(artifact.data, TEXTBOOK_ID) : null;
  } catch {
    return null;
  }
}

async function verifyRouteSteps(steps: string[], options: InspectOptions, racemic?: boolean): Promise<RouteAudit | null> {
  if (!steps.length) return null;
  const provider = routeProvider();
  if (!provider) return null;
  const { runner, dispose } = chemistryRunner(options);
  try {
    return await invokeRoute(runner, provider, steps, racemic, options.target);
  } catch {
    return null;
  } finally {
    await dispose();
  }
}

/** Verifies a whole synthesis route: every equation balanced and every intermediate the
 *  same RDKit-canonical molecule from one step to the next. */
export async function verifySynthesisRoute(steps: string[], options: InspectOptions = {}): Promise<RouteAudit | null> {
  if (options.enabled === false) return null;
  return verifyRouteSteps(steps, options);
}

// ------------------------------------------------- name-first route (resolve names → derive)

const RESOLVE_TOOL = 'resolve-names';
/** How many times an unresolved name is sent back to the model for correction. */
const NAME_FEEDBACK_ATTEMPTS = 2;

interface SpeciesResolution {
  name: string;
  status: 'resolved' | 'ambiguous' | 'unresolved';
  smiles?: string;
  formula?: string;
  source?: 'pubchem' | 'opsin' | 'builtin';
  feedback?: string;
}

export interface RouteResolutionOutcome {
  answer: string;
  steps: string[];
  labels: RouteSpeciesLabel[][];
  consistent: boolean;
  clarification?: string;
  /** Reactant/product names that resolved to no structure, per step; the fix prompts name them. */
  unresolved?: UnresolvedName[];
  /** One line per name the resolver corrected, e.g. "old → new"; empty when nothing changed. */
  corrections: string[];
  /** Species the model supplied as structures because no name would resolve, as prose, so the
   *  caller discloses that their structure came from the model, not a reference. */
  authorStructures: string[];
  /** Every species' resolution status and source, so a run can record where each structure came
   *  from. The author-supplied ones are the category silent wrongness hides in. */
  resolutionSources: Array<{ status: string; source?: string }>;
  /** True when the installed package has no resolve-names tool, so the caller falls back to
   *  the legacy reaction-line path. */
  legacy: boolean;
  /** Set when name resolution failed outright, so the caller says the route went unchecked. */
  error?: string;
}

function resolveProvider() {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return provider && provider.tools.some((tool) => tool.id === RESOLVE_TOOL) ? provider : null;
}

/** True when the enabled Chemistry Studio package can resolve names to structures. */
export function nameResolutionAvailable(): boolean {
  return resolveProvider() !== null;
}

function normalizeSpeciesResolution(entry: unknown): SpeciesResolution | null {
  const value = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
  if (!value || typeof value.name !== 'string') return null;
  const status = value.status;
  if (status !== 'resolved' && status !== 'ambiguous' && status !== 'unresolved') return null;
  return {
    name: value.name.slice(0, MAX_SPECIES_NAME),
    status,
    ...(typeof value.smiles === 'string' && value.smiles ? { smiles: value.smiles.slice(0, 2000) } : {}),
    ...(typeof value.formula === 'string' ? { formula: value.formula.slice(0, 200) } : {}),
    ...(value.source === 'pubchem' || value.source === 'opsin' || value.source === 'builtin' ? { source: value.source } : {}),
    ...(typeof value.feedback === 'string' && value.feedback ? { feedback: value.feedback.slice(0, 400) } : {}),
  };
}

async function invokeResolveNames(runner: Runner, provider: CapabilityProvider, names: string[]): Promise<SpeciesResolution[]> {
  const result = await runner.invoke({ provider, toolId: RESOLVE_TOOL, input: { names } });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'species-resolution');
  const data = artifact?.data as { results?: unknown } | undefined;
  const list = Array.isArray(data?.results) ? data.results as unknown[] : [];
  return list.map(normalizeSpeciesResolution).filter((entry): entry is SpeciesResolution => entry !== null);
}

const STRUCTURE_TOOL = 'resolve-structure';

/** A structure named by the reference service: the reverse of a name resolution. */
interface SpeciesStructureName {
  smiles: string;
  status: 'named' | 'unnamed';
  cid?: number;
  name?: string;
  formula?: string;
  canonicalSmiles?: string;
  feedback?: string;
}

/** True when the installed package can name a structure. Older packages only resolve names, so
 *  a structure the author supplies then keeps the author's SMILES with no name read back. */
function structureNamingAvailable(): boolean {
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  return Boolean(provider && provider.tools.some((tool) => tool.id === STRUCTURE_TOOL));
}

function normalizeStructureName(entry: unknown): SpeciesStructureName | null {
  const value = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
  if (!value || typeof value.smiles !== 'string' || !value.smiles) return null;
  return {
    smiles: value.smiles.slice(0, 2000),
    status: value.status === 'named' ? 'named' : 'unnamed',
    ...(Number.isSafeInteger(value.cid) && (value.cid as number) > 0 ? { cid: value.cid as number } : {}),
    ...(typeof value.name === 'string' && value.name ? { name: value.name.slice(0, MAX_SPECIES_NAME) } : {}),
    ...(typeof value.formula === 'string' && value.formula ? { formula: value.formula.slice(0, 200) } : {}),
    ...(typeof value.canonicalSmiles === 'string' && value.canonicalSmiles ? { canonicalSmiles: value.canonicalSmiles.slice(0, 2000) } : {}),
    ...(typeof value.feedback === 'string' && value.feedback ? { feedback: value.feedback.slice(0, 400) } : {}),
  };
}

async function invokeNameStructures(runner: Runner, provider: CapabilityProvider, smiles: string[]): Promise<SpeciesStructureName[]> {
  const result = await runner.invoke({ provider, toolId: STRUCTURE_TOOL, input: { smiles } });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'structure-naming');
  const data = artifact?.data as { results?: unknown } | undefined;
  const list = Array.isArray(data?.results) ? data.results as unknown[] : [];
  return list.map(normalizeStructureName).filter((entry): entry is SpeciesStructureName => entry !== null);
}

/** Unresolved reactant/product names — the ones a step cannot be built without. An agent
 *  (catalyst or solvent) may have no resolvable name and is not chased. */
function unresolvedNames(speciesByStep: NamedSpecies[][], resolutions: Map<string, SpeciesResolution>): UnresolvedName[] {
  const out: UnresolvedName[] = [];
  speciesByStep.forEach((step, index) => {
    for (const entry of step) {
      if (entry.role === 'agent') continue;
      if (entry.declaredSmiles) continue; // the model already supplied a structure
      if (resolutions.get(entry.name)?.status === 'resolved') continue;
      const resolution = resolutions.get(entry.name);
      out.push({ step: index + 1, role: entry.role, byproduct: entry.byproduct, name: entry.name, ...(resolution?.feedback ? { feedback: resolution.feedback } : {}) });
    }
  });
  return out.slice(0, 24);
}

async function requestCorrectedNames(prose: string, unresolved: UnresolvedName[], options: InspectOptions): Promise<NameFeedbackEntry[]> {
  // One corrected name per unresolved species, so the budget follows the count rather than a flat
  // figure that happened to fit the routes it was written against.
  const budget = Math.min(8_000, Math.max(1_600, 400 + 220 * Math.max(1, unresolved.length)));
  try {
    const raw = await completeText({
      system: ROUTE_NAME_FEEDBACK_SYSTEM,
      user: buildNameFeedbackRequest(unresolved, prose),
      temperature: 0,
      maxTokens: budget,
      reasoning: 'off',
    }, options.model ?? null);
    const parsed = parseNameFeedback(raw);
    if (!parsed.length) {
      console.warn(`[routeNames] no corrections parsed from ${raw.trim().length} chars`
        + ` (budget ${budget} tokens, ${unresolved.length} unresolved)`);
    }
    return parsed;
  } catch (error) {
    console.warn(`[routeNames] call failed (budget ${budget} tokens, ${unresolved.length} unresolved): ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** One model review of the route plan: the problems a balance and continuity check cannot
 *  see. Defensive — an unreadable reply yields no review, so it never blocks a route. */
/** The per-step evidence summary: the ORD lookup and the answer's own citations, library
 *  passages named by title and page. Best-effort: a failure leaves the answer without it. */
async function evidenceSources(modelAnswer: string, stepCount: number, precedentPromise: ReturnType<typeof lookupReactionPrecedent>, queries: PrecedentQuery[], support: Map<number, StepSupport>): Promise<string> {
  try {
    const result = await precedentPromise.catch(() => null);
    const evidence = collectStepEvidence(modelAnswer, stepCount, result?.precedent ?? null, queries, support);
    const { getPassageDetail } = await import('../db/passagesRepo');
    const sourceFor = (passageId: string): string | null => {
      if (passageId.startsWith('scoped:')) return null;
      const detail = getPassageDetail(passageId);
      if (!detail) return null;
      const page = detail.page_label ?? (detail.page_number != null ? String(detail.page_number) : null);
      return page ? `${detail.work.title}, ${/^\d/.test(page) ? `p. ${page}` : page}` : detail.work.title;
    };
    return formatEvidenceSources(evidence, sourceFor);
  } catch {
    return '';
  }
}

async function requestRouteReview(question: string, labels: RouteSpeciesLabel[][], audit: RouteAudit, options: InspectOptions, stepProse: string[] = []): Promise<RouteReview | null> {
  const budget = routeReviewTokens(audit.steps.length);
  const started = Date.now();
  let raw = '';
  try {
    raw = await completeText({
      system: ROUTE_REVIEW_SYSTEM,
      user: buildRouteReviewRequest(question, labels, audit, stepProse),
      temperature: 0,
      maxTokens: budget,
      // Explicit, so this call does not inherit whatever reasoning the profile happens to carry:
      // the budget above is for the review, and a model that spends it thinking returns nothing.
      reasoning: 'off',
      ...(options.signal ? { signal: options.signal } : {}),
    }, options.model ?? null);
    const review = parseRouteReview(raw, audit.steps.length);
    // A review that produced nothing readable is indistinguishable, in the report, from a review
    // that found nothing wrong — and that is how a dead check looked healthy for two sessions.
    // Say it out loud instead.
    if (!review) {
      console.warn(`[routeReview] no review parsed: ${raw.trim().length} chars from ${options.model?.model ?? 'the configured model'}`
        + ` after ${((Date.now() - started) / 1000).toFixed(1)}s, budget ${budget} tokens, ${audit.steps.length} steps`
        + (raw.trim() ? `; reply began ${JSON.stringify(raw.trim().slice(0, 120))}` : '; the reply was empty'));
    }
    return review;
  } catch (error) {
    console.warn(`[routeReview] call failed after ${((Date.now() - started) / 1000).toFixed(1)}s`
      + ` (budget ${budget} tokens, ${audit.steps.length} steps): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** The names-only route: resolve every species name to a structure (PubChem first, OPSIN
 *  fallback), send unresolved reactant/product names back to the model for correction up to
 *  `NAME_FEEDBACK_ATTEMPTS` times, derive the `reactants>agents>products` lines from the
 *  resolved structures, and attach the derived SMILES to the answer in place. A model-authored
 *  SMILES is used only when a name cannot be resolved. */
export async function resolveNamedRoute(
  finalAnswer: string,
  modelAnswer: string,
  options: InspectOptions = {},
): Promise<RouteResolutionOutcome> {
  const legacy: RouteResolutionOutcome = { answer: finalAnswer, steps: [], labels: [], consistent: true, corrections: [], resolutionSources: [], authorStructures: [], legacy: true };
  if (options.enabled === false) return legacy;
  const provider = resolveProvider();
  if (!provider) return legacy;
  const stepCount = countRouteSteps(modelAnswer);
  if (!stepCount) return legacy;
  let speciesByStep = findStepNamedSpecies(modelAnswer, stepCount);
  if (!speciesByStep.some((step) => step.length)) return legacy;

  const { runner, dispose } = chemistryRunner(options);
  try {
    const resolutions = new Map<string, SpeciesResolution>();
    const corrections: string[] = [];
    // The plugin resolves at most 48 names per call; chunk so a long route is fully resolved
    // instead of leaving the tail silently unresolved.
    const resolveAll = async (names: string[]): Promise<void> => {
      const missing = [...new Set(names)].filter((name) => name && !resolutions.has(name));
      for (let start = 0; start < missing.length; start += 48) {
        options.signal?.throwIfAborted();
        const results = await invokeResolveNames(runner, provider, missing.slice(start, start + 48));
        for (const entry of results) resolutions.set(entry.name, entry);
      }
      for (const name of missing) if (!resolutions.has(name)) resolutions.set(name, { name, status: 'unresolved', feedback: 'No resolution was returned.' });
    };
    await resolveAll(speciesByStep.flatMap((step) => step.map((entry) => entry.name)));

    for (let attempt = 0; attempt < NAME_FEEDBACK_ATTEMPTS; attempt += 1) {
      const unresolved = unresolvedNames(speciesByStep, resolutions);
      if (!unresolved.length) break;
      options.signal?.throwIfAborted();
      const corrected = await requestCorrectedNames(modelAnswer, unresolved, options);
      if (!corrected.length) break;
      const renamed = new Map<string, string>();
      for (const entry of corrected) {
        if (entry.kind === 'structure') {
          // The model answered with a structure instead of a name — an exotic cage or a named
          // literature intermediate it cannot name. Keep the name as written and attach the
          // structure; the naming pass below reads a name back from PubChem when it can.
          speciesByStep = speciesByStep.map((step) => step.map((item) => item.name === entry.from ? { ...item, declaredSmiles: entry.to } : item));
          continue;
        }
        if (entry.from !== entry.to) corrections.push(`${entry.from} → ${entry.to}`);
        renamed.set(entry.from, entry.to);
      }
      if (renamed.size) {
        speciesByStep = speciesByStep.map((step) => step.map((entry) => renamed.has(entry.name) ? { ...entry, name: renamed.get(entry.name)! } : entry));
        await resolveAll([...renamed.values()]);
      }
    }

    // A species written as a bare SMILES where a name belongs — the contract asks for a name, or
    // a name with the structure in backticks, and under load the model gives the structure alone.
    // The reference services then report "no exact match for this name" for a molecule that is
    // perfectly well defined, and the whole step is discarded over the formatting. The structure
    // is what the route is checked against, so take it: only for a name that has already failed
    // to resolve (a real systematic name resolves and never reaches here), and through the same
    // declared-structure path, so it is named back from PubChem below where possible and
    // disclosed as author-supplied where not. Some species have no resolvable name at all — a
    // protected intermediate, or one on a solid support — so this is a normal case, not an edge one.
    speciesByStep = speciesByStep.map((step) => step.map((entry) => (!entry.declaredSmiles
      && resolutions.get(entry.name)?.status !== 'resolved' && isBareSmilesName(entry.name)
      ? { ...entry, declaredSmiles: entry.name.trim() } : entry)));

    // A species the model could only give as a structure: try to read a name back from PubChem,
    // so the route uses a real name where one exists. An unnamed structure keeps the author's
    // SMILES and is disclosed as author-supplied.
    const declaredSmiles = [...new Set(speciesByStep.flat().map((entry) => entry.declaredSmiles).filter((value): value is string => Boolean(value)))];
    const nameByStructure = new Map<string, SpeciesStructureName>();
    if (declaredSmiles.length && structureNamingAvailable()) {
      try {
        for (let start = 0; start < declaredSmiles.length; start += 48) {
          options.signal?.throwIfAborted();
          const named = await invokeNameStructures(runner, provider, declaredSmiles.slice(start, start + 48));
          for (const entry of named) nameByStructure.set(entry.smiles, entry);
        }
      } catch { /* naming is best effort; the declared structure stands */ }
    }

    const resolvedByStep: ResolvedSpecies[][] = speciesByStep.map((step) => classifyCoProducts(step.map((entry): ResolvedSpecies => {
      const resolution = resolutions.get(entry.name);
      if (resolution?.status === 'resolved' && resolution.smiles) {
        // The name is authoritative in the names-first path, and the resolver now returns the
        // canonical isomeric SMILES, so a model-declared writing is not compared here: an
        // equivalent SMILES written differently would otherwise look like a correction.
        return { ...entry, status: 'resolved' as const, smiles: resolution.smiles, source: resolution.source ?? 'pubchem', ...(resolution.formula ? { formula: resolution.formula } : {}) };
      }
      if (entry.declaredSmiles) {
        const named = nameByStructure.get(entry.declaredSmiles);
        const smiles = named?.canonicalSmiles ?? entry.declaredSmiles;
        return { ...entry, status: 'fallback' as const, smiles, source: 'declared' as const, ...(named?.status === 'named' && named.name ? { name: named.name } : {}), ...(named?.formula ? { formula: named.formula } : {}) };
      }
      return { ...entry, status: 'unresolved' as const, ...(resolution?.feedback ? { feedback: resolution.feedback } : {}) };
    })));

    const critical: UnresolvedName[] = [];
    resolvedByStep.forEach((step, index) => {
      for (const entry of step) {
        if (entry.role === 'agent' || entry.smiles) continue;
        critical.push({ step: index + 1, role: entry.role, byproduct: entry.byproduct, name: entry.name, ...(entry.feedback ? { feedback: entry.feedback } : {}) });
      }
    });

    const steps = buildRouteSteps(resolvedByStep);
    const labels: RouteSpeciesLabel[][] = resolvedByStep.map((step) => step.filter((entry) => entry.smiles).map((entry) => ({ role: entry.role, byproduct: entry.byproduct, name: entry.name, smiles: entry.smiles! })));
    const authorStructures = resolvedByStep.flat().filter((entry) => entry.status === 'fallback' && entry.smiles).map((entry) => `${entry.name} — \`${entry.smiles}\``);
    const resolutionSources = resolvedByStep.flat().map((entry) => ({ status: entry.status, ...(entry.source ? { source: entry.source } : {}) }));
    const annotated = `${annotateSpeciesSmiles(finalAnswer, resolvedByStep).trimEnd()}\n`;
    return {
      answer: annotated,
      steps,
      labels,
      consistent: critical.length === 0,
      corrections,
      authorStructures,
      resolutionSources,
      ...(critical.length ? { clarification: formatUnresolvedNameClarification(critical, options.target), unresolved: critical } : {}),
      legacy: false,
    };
  } catch (error) {
    if (options.signal?.aborted) return legacy;
    return { ...legacy, error: error instanceof Error ? error.message : 'name resolution failed' };
  } finally {
    await dispose();
  }
}

/** How many step drawings compile at once. Each compile forks its own RDKit subworker, so a
 *  small pool hides the RDKit load without thrashing the machine. */
const DRAW_CONCURRENCY = 2;

/** One reaction scheme from the compile tool, rendered for the answer, or null when the tool
 *  produced no view. A stored reference and its inline view would each render the same
 *  drawing, so only the view is kept. */
async function drawReaction(runner: Runner, provider: CapabilityProvider, reactionSmiles: string, extra: { conditions?: string; racemic?: boolean } = {}): Promise<string | null> {
  const plan = JSON.stringify({ version: 2, kind: 'reaction', depiction: 'skeletal', reactionSmiles, openStereo: true, ...extra });
  const result = await runner.invoke({ provider, toolId: COMPILE_TOOL, input: { plan, question: reactionSmiles } });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'chemistry-document');
  return artifact?.view ? runner.renderView({ provider, view: artifact.view as ViewDocumentV1 }) : null;
}

/** Steps whose product is worth other ways to make: a step the checker refused, or one with no
 *  recorded precedent. At most this many, so the lookup stays one short call. */
const MAX_ALTERNATIVE_STEPS = 6;
const EXCERPT_CHARS = 220;

/** Textbook support for each step's reaction class, and ORD alternatives for each step that
 *  failed or has no precedent. Best-effort: each half returns nothing on failure. */
async function buildStepSupport(
  runner: Runner,
  precedent: ReactionPrecedent,
  queries: PrecedentQuery[],
  labels: RouteSpeciesLabel[][],
  audit: RouteAudit,
  options: InspectOptions,
): Promise<Map<number, StepSupport>> {
  const support = new Map<number, StepSupport>();
  const entryFor = new Map(precedent.reactions.map((entry, position) => [queries[position]?.step ?? position, entry]));

  const byClass = new Map<string, number[]>();
  for (const [step, entry] of entryFor) {
    const name = entry.classes?.find((item) => textbookQueryForClass(item));
    if (name) byClass.set(name, [...(byClass.get(name) ?? []), step]);
  }
  const passagesPromise = (async () => {
    if (!byClass.size) return;
    const names = [...byClass.keys()];
    const found = await textbookPassages(names.map((name) => textbookQueryForClass(name)!), synthesisEvidenceWorkIds(options.evidenceScope), options.signal, 1);
    for (const passage of found) {
      const name = names.find((item) => textbookQueryForClass(item) === passage.retrievedFor);
      if (!name) continue;
      const excerpt = relevantExcerpt(name, passage.text, EXCERPT_CHARS);
      for (const step of byClass.get(name) ?? []) {
        support.set(step, { ...support.get(step), passage: { title: passage.work.title, location: passage.location, citation: passage.citation, excerpt, about: name, ...(passage.scanned ? { scanned: true } : {}) } });
      }
    }
  })().catch((error) => { console.warn('[route] textbook support unavailable:', error instanceof Error ? error.message : String(error)); });

  const alternativesPromise = (async () => {
    const products = new Map<number, string>();
    for (const step of audit.steps) {
      const entry = entryFor.get(step.index);
      const needs = routeStepFailure(step) !== null || (entry ? entry.count === 0 && !entry.unchanged : false);
      const product = (labels[step.index] ?? []).find((label) => label.role === 'product' && !label.byproduct && /[Cc]/.test(label.smiles))?.smiles;
      if (needs && product && products.size < MAX_ALTERNATIVE_STEPS) products.set(step.index, product);
    }
    if (!products.size) return;
    const starting = findStartingSmiles(options.question ?? '', options.target);
    const briefs = await invokeDisconnections(runner, [...new Set(products.values())], starting, 4, options);
    if (!briefs) return;
    for (const [step, product] of products) {
      const brief = briefs.find((item) => item.input === product);
      const reactants = new Set((labels[step] ?? []).filter((label) => label.role === 'reactant').map((label) => label.smiles));
      const proposals = (brief?.proposals ?? [])
        .filter((proposal) => proposal.recorded > 0 || proposal.classes.length)
        .filter((proposal) => !proposal.precursors.split('.').every((molecule) => reactants.has(molecule)))
        .map(({ precursors, classes, recorded }) => ({ precursors, classes, recorded }));
      if (proposals.length) support.set(step, { ...support.get(step), alternatives: { product: brief!.target, proposals } });
    }
  })().catch((error) => { console.warn('[route] ORD alternatives unavailable:', error instanceof Error ? error.message : String(error)); });

  await Promise.all([passagesPromise, alternativesPromise]);
  return support;
}

/** The target's name from the route labels: the main product of the step that formed it, or a
 *  product labelled with exactly the target SMILES. */
function targetName(labels: RouteSpeciesLabel[][], audit: RouteAudit, target: string | null | undefined): string | undefined {
  const formedAt = audit.target?.formedAt;
  if (formedAt !== null && formedAt !== undefined) {
    const main = (labels[formedAt] ?? []).filter((entry) => entry.role === 'product' && !entry.byproduct && entry.name);
    if (main.length === 1) return main[0].name;
  }
  return target ? labels.flat().find((entry) => entry.role === 'product' && entry.smiles === target && entry.name)?.name : undefined;
}

/** Does the whole synthesis pass? Every step passes, nothing is disconnected, and the target is
 *  formed with the stereochemistry that was asked for.
 *
 *  Deliberately deterministic: it does not consult the model route review, so the final report
 *  does not wait on a model call to decide whether to draw. A review problem is advice about a
 *  route that balances, and it is printed in the check block either way. */
function routePasses(audit: RouteAudit): boolean {
  return audit.steps.length > 0
    && audit.steps.every((step) => !routeStepFailure(step))
    && !isolatedSteps(audit).length
    && audit.target?.reason !== 'not-formed'
    && audit.target?.reason !== 'stereo-mismatch';
}

/** THE ONLY PLACE A ROUTE IS DRAWN. One block, printed once, when the whole synthesis passes:
 *  a summary of every step and the reaction diagram for every step.
 *
 *  Nothing else in the route lane draws. Before this, three paths could each put a picture in a
 *  route answer — these step diagrams, the recorded-reaction pictures beside the ORD precedent,
 *  and whatever the model asked for in its own `chemistry-plan` fence — and the last of those ran
 *  on every fix round whatever the verdict, which is how a route with a failing step still came
 *  back with structures drawn. Drawing is also the most expensive thing the report does, so doing
 *  it only on a route that passed is both the clearer answer and the cheaper one.
 *
 *  The gate is deterministic and does not wait for the model review: every step passes, no step is
 *  disconnected, and the target is formed with the stereochemistry asked for. */
async function printFinalReport(
  runner: Runner,
  provider: CapabilityProvider,
  steps: string[],
  conditions: string[],
  audit: RouteAudit,
  labels: RouteSpeciesLabel[][],
  options: InspectOptions,
): Promise<string> {
  // Checked here as well as at the call site, because this function's contract is the gate: it
  // must be impossible to get a drawing out of it for a route that did not pass.
  if (!routePasses(audit)) return '';
  const drawable: RouteStepAudit[] = [];
  const skipped: string[] = [];
  const passing: RouteStepAudit[] = [];
  for (const step of audit.steps) {
    // The same verdict as the route report, so a step the report marks FAIL (an assembly
    // problem included) is never drawn.
    const reason = routeStepFailure(step) ?? '';
    if (reason) { skipped.push(`- Step ${step.index + 1} — ${reason}`); continue; }
    passing.push(step);
  }
  // Every step gets a diagram: the gate above means every step passed, so there is no partial
  // route to triage here. The ceiling stays only to bound a pathological route; a real one that
  // passes end to end is a handful of steps, and the longest in the 30-target suite was 14.
  for (const step of passing) {
    if (drawable.length < MAX_ROUTE_DRAWINGS) drawable.push(step);
    else skipped.push(`- Step ${step.index + 1} — not drawn (at most ${MAX_ROUTE_DRAWINGS} diagrams per report)`);
  }
  const figures: Array<{ index: number; view: string } | null> = new Array(drawable.length).fill(null);
  let cursor = 0;
  const run = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= drawable.length) return;
      const step = drawable[index];
      options.signal?.throwIfAborted();
      const reactionSmiles = steps[step.index];
      try {
        // The step's "Reagents and conditions:" prose is the only source for temperature,
        // time and workup; the plugin sanitizes it to arrow text and drops it rather than
        // fail the drawing. Empty when the model wrote no such line.
        const condition = conditions[step.index] ?? '';
        // The route checker already accepted this step, so draw its open centres as
        // unspecified rather than refusing — a step whose only open centre is on a reactant
        // (a purchased input) must still render. A declared-racemic product keeps its flag.
        const view = await drawReaction(runner, provider, reactionSmiles, { ...(condition ? { conditions: condition } : {}), ...(step.racemic ? { racemic: true } : {}) });
        if (!view) { skipped.push(`- Step ${step.index + 1} — the verified drawing could not be produced`); continue; }
        figures[index] = { index: step.index, view };
      } catch (error) {
        skipped.push(`- Step ${step.index + 1} — ${error instanceof Error ? error.message : 'could not be drawn'}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DRAW_CONCURRENCY, drawable.length) }, run));
  const ordered = figures.filter((figure): figure is { index: number; view: string } => figure !== null);
  // Nothing drawable is not a report. The route check block above already stands on its own.
  if (!ordered.length) return '';
  // Each step reads as its own entry: the equation the checker accepted, then the picture of it.
  // The summary comes from the same helpers as the route check block, so the two cannot disagree.
  const summaries = new Map(routeStepSummaries(audit, labels).map((entry) => [entry.index, entry.summary]));
  const lines = [
    '### Final report',
    '',
    `Every step of this route passed the check, so the route is drawn. ${ordered.length} step(s), one diagram each. This is still bookkeeping: conditions, selectivity, yields and safety are not checked.`,
    '',
    ...ordered.flatMap((figure) => [
      `**Step ${figure.index + 1}** — ${summaries.get(figure.index) ?? ''}`,
      '',
      figure.view,
      '',
    ]),
  ];
  if (skipped.length) lines.push('Not drawn:', ...skipped);
  return `\n${lines.join('\n')}\n`;
}

const STOCK_TOOL = 'check-stock';

/** The stock lines for a route: whether the target itself can be bought, then its starting
 *  materials; '' without stock lists, with stock switched off, or without the tool. */
async function startingMaterialStockLine(runner: Runner, labels: RouteSpeciesLabel[][]): Promise<string> {
  const stockDir = chemistryStockDirectory();
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  if (!stockDir || !provider?.tools.some((tool) => tool.id === STOCK_TOOL)) return '';
  const starting = routeStartingMaterials(labels);
  const target = routeTargetSmiles(labels);
  const molecules = [...new Set([...(target ? [target.smiles] : []), ...starting.map((entry) => entry.smiles)])].slice(0, 64);
  if (!molecules.length) return '';
  const result = await runner.invoke({ provider, toolId: STOCK_TOOL, input: { stockDir, molecules } });
  const data = (result.artifacts ?? []).find((entry) => entry.artifactType === 'stock-availability')?.data as
    ({ stock?: Record<string, string[]>; lists?: string[]; orderable?: Record<string, string[]>; orderLists?: string[] } & Parameters<typeof compoundAvailability>[1]) | undefined;
  if (!data) return '';
  const targetLine = target ? formatTargetAvailability(target.name, compoundAvailability(target.smiles, data)) : '';
  const startingLine = starting.length ? formatStartingMaterialStock(starting, data.stock ?? {}, data.lists ?? [], data.orderable ?? {}, data.orderLists ?? []) : '';
  return [targetLine && `**Target:** ${targetLine}`, startingLine].filter(Boolean).join('\n\n');
}

const COMPATIBILITY_TOOL = 'check-compatibility';

/** Functional-group compatibility of each step: its reactants and products from the resolved
 *  labels, its reagents from the step's conditions line and its named agents. Empty when the
 *  package has no such tool; textbook examples of protecting groups when the textbook index is
 *  there. */
async function checkStepCompatibility(runner: Runner, labels: RouteSpeciesLabel[][], conditions: string[], options: InspectOptions): Promise<StepCompatibility[]> {
  options.signal?.throwIfAborted();
  const provider = capabilityRegistry().providers.get(CHEMISTRY_CAPABILITY);
  if (!provider?.tools.some((tool) => tool.id === COMPATIBILITY_TOOL)) return [];
  const steps = labels.map((entries, index) => {
    const smiles = (role: RouteSpeciesLabel['role'], keepByproducts: boolean) => entries
      .filter((entry) => entry.role === role && (keepByproducts || !entry.byproduct) && entry.smiles)
      .map((entry) => entry.smiles).slice(0, 12);
    const agents = entries.filter((entry) => entry.role === 'agent' && entry.name).map((entry) => entry.name);
    return { reactants: smiles('reactant', true), products: smiles('product', false), reagents: [conditions[index] ?? '', ...agents].filter(Boolean).join('; ').slice(0, 2000) };
  });
  if (!steps.some((step) => step.reactants.length && step.products.length && step.reagents)) return [];
  const textbookDir = textbookSchemeDirectory(options.evidenceScope);
  const result = await runner.invoke({ provider, toolId: COMPATIBILITY_TOOL, input: { steps: steps.slice(0, 24), ...(textbookDir ? { textbookDir } : {}) } });
  const artifact = (result.artifacts ?? []).find((entry) => entry.artifactType === 'step-compatibility');
  return artifact ? normalizeCompatibility(artifact.data) : [];
}

/** The post-answer route check, then one drawing per verified step. Neither rewrites the
 *  answer nor asks the model again; a step the checker refused is reported, not drawn. */
export async function appendRouteReportAndDrawings(
  finalAnswer: string,
  modelAnswer: string,
  options: InspectOptions = {},
  overrides: { steps?: string[]; labels?: RouteSpeciesLabel[][]; unresolved?: UnresolvedName[] } = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  if (options.enabled === false || !routeVerificationAvailable()) return finalAnswer;
  // The names-first path derives the equations from the resolved names and passes them in.
  const steps = overrides.steps ?? [];
  const labels = overrides.labels ?? [];
  if (!steps.length || !labels.some((entries) => entries.length)) return finalAnswer;
  const conditions = findStepConditions(modelAnswer, steps.length);
  const stepProse = findStepProse(modelAnswer, steps.length);
  // Racemic is decided per step, from that step's own prose, as the rules ask: a sentence
  // elsewhere ("benzocaine is achiral", a note on the target) no longer excuses every step.
  const racemic = stepDeclaresRacemic(modelAnswer, steps.length);
  // A step that names a rearrangement or a radical step is reported, not refused, when its bond
  // changes need one; read the same way, from the step's own section.
  const declared = { rearrangement: stepDeclaresRearrangement(modelAnswer, steps.length), radical: stepDeclaresRadical(modelAnswer, steps.length) };
  const provider = routeProvider();
  if (!provider) return finalAnswer;
  const compile = compileProvider();
  const { runner, dispose } = chemistryRunner(options);
  // How long each part of the report takes, one line per answer (route reports run several
  // chemistry tools; this says which one an answer waited on).
  const started = Date.now();
  const timings: string[] = [];
  const timed = <T,>(label: string, promise: Promise<T>): Promise<T> => {
    const t0 = Date.now();
    return promise.finally(() => timings.push(`${label} ${((Date.now() - t0) / 1000).toFixed(1)}s`));
  };
  try {
    const checked = await timed('audit', invokeRoute(runner, provider, steps, racemic, options.target, labels, declared));
    const audit = checked ? implyRacemicTarget(checked, options.target) : checked;
    if (!audit) return `${finalAnswer.trimEnd()}\n\n${formatRouteCheckUnavailable('the chemistry package returned no route audit')}\n`;
    // The index lookup runs alongside the review and the drawings; it is skipped entirely
    // when the package has no such tool or the index has not been downloaded.
    const queries = buildPrecedentQueries(labels);
    const precedentPromise = timed('ORD precedent', lookupReactionPrecedent(runner, queries.map((query) => query.query), options));
    // One model review looks for plan problems the checker cannot see (prose vs names, a
    // product that is a different compound, a step that cannot work, a redundant step). It is
    // blocking: a finding marks the route not verified. An unreadable reply never blocks. It
    // runs while the drawings compile, so the reviewer and the drawings overlap.
    const reviewPromise = timed('review', requestRouteReview(options.question ?? '', labels, audit, options, stepProse));
    // The step support needs the precedent lookup's classes and nothing else — in particular not
    // the drawings. It used to be started after the drawings were awaited, which put the two
    // largest costs in the report end to end. Measured on one route: drawings 52.9s then step
    // support 41.0s inside a 96.7s report, where the lookup they both wait on took 6.4s. Started
    // here it overlaps the drawings instead, and the report's floor becomes the larger of the two
    // rather than their sum. Concurrent invokes are safe on one worker: the handle keys pending
    // calls by callId, which is what lets the evidence gather run three tools at once already.
    const supportPromise = timed('step support', precedentPromise
      .then((result) => (result ? buildStepSupport(runner, result.precedent, queries, labels, audit, options) : new Map<number, StepSupport>()))
      .catch(() => new Map<number, StepSupport>()));
    // Nothing is drawn until every step passes. A route with a failing step is about to be
    // rewritten and each picture made for it is discarded with it: measured on one long route,
    // ~200,000 characters of SVG per turn, three turns running, none of it ever read, while the
    // package's runtime budget was being exhausted elsewhere in the same turn. The report, the
    // precedent text and the review are unaffected — those are what a correction is written
    // from, and they cost nothing to render.
    // Nothing is drawn while any step still fails, and the report says so rather than leaving a
    // gap: a route with a failing step is about to be rewritten, and every picture made for it is
    // discarded with it. Route-level refusals count too — a route whose steps do not join up is
    // equally about to change.
    const routeIsRight = routePasses(audit);
    const drawings = !compile ? ''
      : routeIsRight ? await timed('final report', printFinalReport(runner, compile, steps, conditions, audit, labels, options))
      : 'Not drawn: the route has a step that does not pass yet. Every step is summarised and drawn in one final report, once the whole route passes.';
    // Paint the deterministic report and drawings before the reviewer returns. The transport
    // replaces the provisional stream with this returned answer, so the route only waits on
    // the reviewer when the reviewer is the last thing outstanding.
    if (options.onDeterministic) options.onDeterministic(`${finalAnswer.trimEnd()}\n\n${formatRouteAudit(audit, labels, null, true, overrides.unresolved ?? [])}\n${drawings}`);
    // The lookup already carries its drawings; this only formats. Best-effort throughout. The
    // step support (textbook passage per reaction class, ORD alternatives for a failed or
    // unprecedented step) was started above, beside the review and the drawings.
    // Pictures of the recorded reactions wait for the same gate: they are the largest of the lot.
    const precedentSection = Promise.all([precedentPromise, supportPromise]).then(([result, support]) => {
      if (!result) return '';
      const target = options.target ? { smiles: options.target, name: targetName(labels, audit, options.target) } : null;
      // No pictures here any more. The recorded reaction is cited by id and similarity, which is
      // what makes it evidence; drawing it put a second set of structures in the answer that was
      // easily read as this route's own. Every diagram now comes from the final report.
      const drawings = undefined;
      return formatReactionPrecedents(result.precedent, { queries, labels, target, drawings, support });
    }).catch(() => '');
    // The same steps in the reaction schemes of the user's own textbooks, cited by book and page.
    const textbookSection = timed('textbook precedent', lookupTextbookPrecedent(runner, queries.map((query) => query.query), options).then((precedent) => {
      if (!precedent) return '';
      const target = options.target ? { smiles: options.target, name: targetName(labels, audit, options.target) } : null;
      return formatTextbookPrecedents(precedent, (ids) => textbookCitations(ids, undefined, options.evidenceScope), { queries, target });
    }).catch(() => ''));
    // Groups a step's reagents would attack (an ester through LiAlH4, a free OH beside a Grignard).
    const compatibilityPromise = timed('compatibility', checkStepCompatibility(runner, labels, conditions, options).catch(() => [] as StepCompatibility[]));
    // Which starting materials the user's vendor stock lists hold (no lists: nothing is said).
    const stockPromise = timed('stock', options.evidenceScope?.external === false ? Promise.resolve('') : startingMaterialStockLine(runner, labels).catch(() => ''));
    const review = await reviewPromise;
    const report = formatRouteAudit(audit, labels, review, false, overrides.unresolved ?? []);
    const precedentText = await precedentSection;
    const support = await supportPromise;
    // A step's high-severity clashes ride along in its fix prompt, as evidence.
    const compatibility = await compatibilityPromise;
    for (const step of compatibility) {
      const clashes = compatibilityFixLines(step);
      if (clashes.length) support.set(step.step - 1, { ...(support.get(step.step - 1) ?? {}), compatibility: clashes });
    }
    const compatibilityText = formatCompatibility(compatibility, (ids) => textbookCitations(ids, undefined, options.evidenceScope));
    // A refusal the checker can name and the app cannot fix is offered back to the model as one
    // click: names and roles only — the model never authored the derived SMILES. The index's
    // alternatives and a textbook passage ride along as evidence.
    const fix = formatNamedRouteFixPrompts(labels, audit, review, support, overrides.unresolved ?? []);
    const sources = await evidenceSources(modelAnswer, steps.length, precedentPromise, queries, support);
    const stockLine = await stockPromise;
    const textbookText = await textbookSection;
    console.info(`${new Date().toISOString()} [routeReport] ${((Date.now() - started) / 1000).toFixed(1)}s · ${timings.join(' · ')}`);
    return `${finalAnswer.trimEnd()}\n\n${report}\n${stockLine ? `${stockLine}\n\n` : ''}${drawings}${precedentText}${textbookText}${compatibilityText}${sources}${fix ? `\n${fix}\n` : ''}`;
  } catch (error) {
    if (options.signal?.aborted) return finalAnswer;
    return `${finalAnswer.trimEnd()}\n\n${formatRouteCheckUnavailable(error instanceof Error ? error.message : 'the route check failed')}\n`;
  } finally {
    await dispose();
  }
}
