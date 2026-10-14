import type {
  DeepResearchMeta,
  DeepResearchRequest,
  DeepResearchReport,
  ModelRef,
  PromptLanguage,
  WritingWorkshopBrief,
  WritingWorkshopDraft,
  WritingWorkshopMatrixRow,
  WritingWorkshopSection,
  WritingWorkshopSnapshot,
} from '@shared/types';
import type { DeepResearchApproach } from '@shared/deepResearchApproaches';
import { normalizeDeepResearchApproach } from '@shared/deepResearchApproaches';
import { parseDeepResearchRequestVersion, type DeepResearchVersion } from '@shared/deepResearchVersions';
import { deepResearchLengthPromptPack } from '@shared/deepResearchLengthPromptPacks';
import {
  normalizeDeepResearchSectionLength,
  type DeepResearchSectionLength,
} from '@shared/deepResearchSectionLength';
import {
  assessDeepResearchReport,
  type DeepResearchQualitySource,
} from '@shared/deepResearchQuality';
import { buildHistoricalWritingWorkshopSnapshot, buildIdeaFirstWritingWorkshopSnapshot } from './writingWorkshop';
import {
  applyCitationPolicy,
  assembleMarkdown,
  buildCitationCatalog,
  buildReferences,
  buildSnapshotMaps,
  collectCitedWorkIds,
  countWords,
  deepResearchNarrativeRules,
  labels,
  resolveSectionPlan,
  type CitationCatalog,
  type DeepResearchPlanSection,
} from './deepResearchCore';
import {
  approachRules,
  deterministicApproachRetrievalPlan,
  mergeApproachSnapshots,
} from './deepResearchApproaches';
import { deepResearchClientPromptPack } from '@shared/deepResearchClientPromptPacks';

// ─────────────────────────────────────────────────────────────────────────────
// Client-driven Deep Research (Option B).
//
// Instead of Nodus's configured model writing the report, the MCP *client's* own
// model articulates and drafts it. Nodus stays the grounding authority:
//  1. buildDeepResearchBrief() prepares a self-contained "writing kit" — the
//     corpus materials with verbatim citation tokens, the target scope, and the
//     method + citation policy. The calling model then writes the report itself.
//  2. assembleClientDeepResearchReport() takes that written markdown back and
//     enforces the same citation contract as the in-app pipeline: hallucinated
//     citations are stripped, labels canonicalised, the References/bibliography
//     built from really-cited works, and the whole thing shaped into the standard
//     Writing-Workshop draft so export/save/render all work unchanged.
//
// This needs no MCP "sampling" support, so it works with any MCP client.
// ─────────────────────────────────────────────────────────────────────────────

/** The one dependency on the outside world — injected so the shaping is testable without DB/embeddings. */
export type SnapshotBuilder = (brief: WritingWorkshopBrief, extraProbes?: string[]) => Promise<WritingWorkshopSnapshot>;

/**
 * The client writer has the same compatibility contract as the in-app writer:
 * v1 is the historical idea/passage snapshot, while v2 starts from the
 * idea-first retriever (which can then enrich with full-document evidence).
 * Keeping this choice in one pure function prevents `approach` or any
 * presentation setting from accidentally selecting the engine.
 */
export type DeepResearchClientRoute = 'v1-historical' | 'v2-idea-first';

export function deepResearchClientRoute(value: unknown): DeepResearchClientRoute {
  const version = parseDeepResearchRequestVersion(value);
  return version === 'v1' ? 'v1-historical' : 'v2-idea-first';
}

function snapshotBuilderForVersion(version: DeepResearchVersion): SnapshotBuilder {
  return version === 'v1' ? buildHistoricalWritingWorkshopSnapshot : buildIdeaFirstWritingWorkshopSnapshot;
}

function briefFor(request: DeepResearchRequest): WritingWorkshopBrief {
  const deepResearchVersion = parseDeepResearchRequestVersion(request.deepResearchVersion);
  return {
    kind: 'deep_research',
    objective: request.objective,
    audience: request.audience,
    tone: 'academic',
    language: request.language ?? 'es',
    deepResearchVersion,
  };
}

export interface DeepResearchBrief {
  mode: 'client';
  deepResearchVersion: DeepResearchVersion;
  approach: DeepResearchApproach;
  objective: string;
  language: PromptLanguage;
  audience?: string;
  /** Requested visible shape. Internal evidence planning remains unchanged. */
  structure: 'sectioned' | 'single';
  /** `maximum` is non-null exactly when the user pinned "Máx. N secciones". */
  sections: { suggested: number; mode: 'auto' | 'user'; maximum: number | null };
  /** Guideline words per section, or `'auto'`. Editorial guidance, never a quota. */
  sectionLength: DeepResearchSectionLength;
  materials: CitationCatalog;
  citationPolicy: string[];
  method: string[];
  /** The tool the writer must call with its finished draft to validate + assemble. */
  finalizeWith: string;
}

/**
 * Option B, step 1 — the writing kit for the caller's model. Ranks the corpus for
 * the objective (may use the configured embeddings for retrieval only) but never
 * writes prose. Returns every citable token the writer is allowed to use.
 */
export async function buildDeepResearchBrief(
  request: DeepResearchRequest,
  buildSnapshot?: SnapshotBuilder
): Promise<DeepResearchBrief> {
  const language = request.language ?? 'es';
  const approach = normalizeDeepResearchApproach(request.approach);
  const deepResearchVersion = parseDeepResearchRequestVersion(request.deepResearchVersion);
  const snapshotBuilder = buildSnapshot ?? snapshotBuilderForVersion(deepResearchVersion);
  const ordinary = await snapshotBuilder(briefFor({ ...request, deepResearchVersion }));
  const retrieval = deterministicApproachRetrievalPlan(approach, request.objective, language);
  const snapshot = approach === 'general'
    ? ordinary
    : mergeApproachSnapshots(ordinary, await snapshotBuilder(briefFor({ ...request, deepResearchVersion }), retrieval.probes), approach);
  const sectionPlan = resolveSectionPlan(
    snapshot,
    request.sectionLimit ?? 'auto',
    request.objective,
    request.coverageQuestions ?? [],
  );
  const specializedRules = approach === 'general' ? null : approachRules(approach, 'client', language);
  const singleNarrative = request.sectionLimit === 'single';
  const copy = deepResearchClientPromptPack(language);
  const sectionLength = normalizeDeepResearchSectionLength(request.sectionLength);
  const lengthWords = sectionLength === 'auto' ? null : sectionLength;
  return {
    mode: 'client',
    deepResearchVersion,
    approach,
    objective: request.objective,
    language,
    audience: request.audience,
    structure: singleNarrative ? 'single' : 'sectioned',
    // `mode: 'user'` means the number is a MAXIMUM the caller must not exceed, so
    // the kit names it as one instead of leaving "suggested" to be read as a target.
    sections: { suggested: sectionPlan.target, mode: sectionPlan.mode, maximum: sectionPlan.mode === 'user' ? sectionPlan.target : null },
    sectionLength,
    materials: buildCitationCatalog(snapshot),
    citationPolicy: [...copy.citationPolicy],
    method: [
      sectionPlan.mode === 'user' && !singleNarrative
        ? copy.sectionCeiling(sectionPlan.target)
        : copy.evidenceShape(sectionPlan.target),
      ...(lengthWords === null ? [] : [deepResearchLengthPromptPack(language).clientKit(lengthWords)]),
      singleNarrative ? copy.singleNarrative : copy.sectionedNarrative,
      ...deepResearchNarrativeRules(language),
      ...(specializedRules?.planner ?? []),
      ...(specializedRules?.writer ?? []),
      ...(specializedRules?.finalizer ?? []),
      copy.distributeEvidence,
      copy.catalogSemantics,
      singleNarrative ? copy.singleOutput : copy.sectionedOutput,
      copy.finalize,
    ],
    finalizeWith: 'nodus_finalize_deep_research',
  };
}

export interface ClientFinalizeInput {
  objective: string;
  approach?: DeepResearchApproach;
  language?: PromptLanguage;
  audience?: string;
  /** Must match the brief so the assembler can preserve a continuous body. */
  sectionLimit?: DeepResearchRequest['sectionLimit'];
  /** Recorded on the assembled report so a client-written report is inspectable too. */
  sectionLength?: DeepResearchRequest['sectionLength'];
  /** The body the caller wrote; headed sections normally, plain prose for `single`. */
  sectionsMarkdown: string;
  title?: string;
  abstract?: string;
  limitations?: string[];
  nextSteps?: string[];
  /** Optional provenance supplied by the MCP client that actually wrote the prose. */
  generationModel?: ModelRef | null;
  deepResearchVersion?: DeepResearchVersion;
}

function outlineFromMarkdown(markdown: string): WritingWorkshopSection[] {
  const sections: WritingWorkshopSection[] = [];
  const re = /^##\s+(.+?)\s*$/gm;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(markdown)) !== null) {
    index += 1;
    sections.push({ id: `s${index}`, title: match[1].trim(), purpose: '', keyClaims: [], sources: [] });
  }
  return sections;
}

/**
 * Option B, step 2 — take the caller-written markdown and enforce Nodus's citation
 * contract, then assemble the same report shape the in-app pipeline produces. No
 * provider/writing model is used here beyond rebuilding the retrieval snapshot.
 */
export async function assembleClientDeepResearchReport(
  input: ClientFinalizeInput,
  buildSnapshot?: SnapshotBuilder
): Promise<DeepResearchReport> {
  const language = input.language ?? 'es';
  const approach = normalizeDeepResearchApproach(input.approach);
  const deepResearchVersion = parseDeepResearchRequestVersion(input.deepResearchVersion);
  const request: DeepResearchRequest = {
    objective: input.objective,
    language,
    audience: input.audience,
    approach,
    deepResearchVersion,
    sectionLimit: input.sectionLimit,
    sectionLength: normalizeDeepResearchSectionLength(input.sectionLength),
  };
  const brief = briefFor(request);
  const snapshotBuilder = buildSnapshot ?? snapshotBuilderForVersion(deepResearchVersion);
  const ordinary = await snapshotBuilder(brief);
  const retrieval = deterministicApproachRetrievalPlan(approach, input.objective, language);
  const snapshot = approach === 'general'
    ? ordinary
    : mergeApproachSnapshots(ordinary, await snapshotBuilder(brief, retrieval.probes), approach);
  const maps = buildSnapshotMaps(snapshot);

  // Enforce the citation contract on the caller's prose.
  const { markdown: cleanedBody, cited } = applyCitationPolicy(input.sectionsMarkdown ?? '', maps);
  const citedWorkIds = collectCitedWorkIds(cited, maps);
  const references = buildReferences(citedWorkIds, maps);

  const limitations = (input.limitations ?? []).map((s) => s.trim()).filter(Boolean);
  const nextSteps = (input.nextSteps ?? []).map((s) => s.trim()).filter(Boolean);
  const abstract = (input.abstract ?? '').trim();
  const title = (input.title ?? '').trim() || input.objective;
  const singleNarrative = input.sectionLimit === 'single';

  const syntheticSection: DeepResearchPlanSection = {
    id: 's-client',
    title,
    purpose: '',
    keyClaims: [],
    ideaIds: [],
    workIds: [],
    gapIds: [],
    contradictionIds: [],
    passageIds: [],
  };
  const draftMarkdown = assembleMarkdown(
    [{ section: syntheticSection, markdown: cleanedBody }],
    references,
    { title, abstract, limitations, nextSteps },
    language,
    input.sectionLimit,
  );

  const L = labels(language);
  const matrix: WritingWorkshopMatrixRow[] = [...cited.ideas]
    .map((id) => maps.ideaById.get(id))
    .filter((idea): idea is NonNullable<typeof idea> => !!idea)
    .slice(0, 60)
    .map((idea) => ({
      claim: (idea.statement || idea.label).slice(0, 240),
      role: idea.type === 'method' ? 'method' : 'support',
      sourceLabel: idea.works[0]?.authors[0] ?? L.corpusSource,
      citation: `nodus://idea/${encodeURIComponent(idea.id)}`,
      evidence: idea.evidenceCount > 0 ? L.anchoredEvidence(idea.evidenceCount) : L.derivedIdea,
      notes: idea.workCount > 1 ? L.supportedBy(idea.workCount) : L.singleSupport,
    }));

  const words = countWords(cleanedBody);
  // Pages are descriptive telemetry only; they never constrain generation.
  const pages = Math.max(1, Math.round(words / 450));
  const qualitySources = clientQualitySources(cleanedBody, maps);
  const qualitySections = splitClientSections(cleanedBody, title);
  const qualityAssessment = assessDeepResearchReport({
    mode: 'client',
    objective: input.objective,
    sections: qualitySections.map((section) => ({ ...section, sources: qualitySources })),
  });

  const draft: WritingWorkshopDraft = {
    generatedAt: new Date().toISOString(),
    brief,
    selection: {
      ideaIds: [...cited.ideas],
      themeIds: [],
      gapIds: [...cited.gaps],
      contradictionIds: [...cited.contradictions],
      workIds: [...citedWorkIds],
      passageIds: [...cited.passages],
      tutorRouteIds: [],
    },
    title,
    abstract,
    outline: singleNarrative ? [] : outlineFromMarkdown(cleanedBody),
    draftMarkdown,
    matrix,
    bibliography: references,
    nextSteps,
    limitations,
    deepResearchApproach: approach,
    deepResearchVersion,
    deepResearchStructure: singleNarrative ? 'single' : 'sectioned',
    deepResearchSectionLength: request.sectionLength,
    generationModel: input.generationModel ? { ...input.generationModel } : null,
    qualityAssessment,
    stats: {
      selectedIdeas: cited.ideas.size,
      selectedThemes: 0,
      selectedGaps: cited.gaps.size,
      selectedContradictions: cited.contradictions.size,
      selectedWorks: citedWorkIds.size,
      selectedPassages: cited.passages.size,
      selectedTutorRoutes: 0,
      contextChars: draftMarkdown.length,
      truncated: false,
    },
  };
  draft.brief = { ...draft.brief, deepResearchApproach: approach, deepResearchVersion };

  const meta: DeepResearchMeta = {
    sections: singleNarrative ? 1 : draft.outline.length,
    words,
    pages,
    ideasCovered: cited.ideas.size,
    ideasConsidered: snapshot.ideas.length,
    worksCited: citedWorkIds.size,
    deepResearchVersion,
    structure: singleNarrative ? 'single' : 'sectioned',
    sectionLength: request.sectionLength,
    stoppedReason: null,
  };

  return { draft, meta };
}

function splitClientSections(markdown: string, fallbackTitle: string): { title: string; markdown: string }[] {
  const blocks = markdown.split(/^##\s+/gmu).slice(1).map((block) => {
    const newline = block.indexOf('\n');
    return { title: block.slice(0, newline).trim(), markdown: `## ${block}`.trim() };
  });
  return blocks.length ? blocks : [{ title: fallbackTitle, markdown }];
}

function clientQualitySources(
  markdown: string,
  maps: ReturnType<typeof buildSnapshotMaps>,
): DeepResearchQualitySource[] {
  const links = [...markdown.matchAll(/\[[^\]\n]*\]\((nodus:\/\/(idea|work|passage|gap|contradiction)\/([^)\s]+))\)/giu)];
  const sources = new Map<string, DeepResearchQualitySource>();
  for (const match of links) {
    const citation = match[1];
    const kind = match[2].toLocaleLowerCase();
    let id = match[3];
    try { id = decodeURIComponent(id); } catch { /* retain raw */ }
    const sourceId = kind === 'idea'
      ? maps.ideaById.get(id)?.works[0]?.nodus_id ?? citation
      : kind === 'passage'
        ? maps.passageWorkId.get(id) ?? citation
        : kind === 'work'
          ? id
          : citation;
    sources.set(citation, {
      citation,
      sourceId,
      evidence: kind === 'passage' ? 'literal' : 'synthesis',
    });
  }
  return [...sources.values()];
}
