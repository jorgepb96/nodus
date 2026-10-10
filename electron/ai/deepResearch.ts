import { verdictEntries, isAiVerdicts, normalizeCitationVerdict, type AiVerdictsResponse } from '@shared/citationVerdicts';
import { withJobThinkingEffort } from './thinkingEffort';
import { registerNotebookRun } from './researchNotebookService';
import { bindAcademicCorpusRun } from './researchCorpusRun';
import { withDocumentVisualPlanning } from './documentVisualContext';
import { documentSkillCatalog } from '../../shared/documentSkills';
import { listDocumentSkills } from '../capabilities/documentCatalog';
import { prepareDocumentVisualHints } from './documentVisuals';
import type { DeepResearchProgress, DeepResearchReport, DeepResearchRequest, ModelRef, PromptLanguage } from '@shared/types';
import { deepResearchPlanningPromptPack } from '@shared/deepResearchPlanningPromptPacks';
import { deepResearchQualityPromptPack } from '@shared/deepResearchQualityPromptPacks';
import { deepResearchWritingPromptPack, deepResearchWritingRuntimeCopy } from '@shared/deepResearchWritingPromptPacks';
import { deepResearchLengthPromptPack, isEmptyContinuation } from '@shared/deepResearchLengthPromptPacks';
import {
  countDeepResearchWords,
  extendDeepResearchSection,
  normalizeDeepResearchSectionLength,
  planDeepResearchSectionLength,
  type DeepResearchSectionLength,
  type DeepResearchSectionLengthPlan,
} from '@shared/deepResearchSectionLength';
import type { DeepResearchApproach } from '@shared/deepResearchApproaches';
import { normalizeDeepResearchApproach } from '@shared/deepResearchApproaches';
import {
  deepResearchEnginePath as characterizeDeepResearchEngine,
  parseDeepResearchRequestVersion,
  type DeepResearchVersion,
} from '@shared/deepResearchVersions';
import { completeJson, completeText } from './aiClient';
import { assertChatGptSubscriptionConnected } from './codexSubscription';
import { getSettings } from '../db/settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { generateGenealogyDeepResearchReport } from './genealogyDeepResearch';
import { generateStudyDeepResearchReport } from './studyDeepResearch';
import { normalizeCompleteGuideConfig } from '@shared/completeGuide/types';
import { withJobOutputLanguage } from './jobOutputLanguage';
import { generateCompleteGuideReport } from './completeGuide';
import {
  buildHistoricalWritingWorkshopSnapshot,
  buildIdeaFirstWritingWorkshopSnapshot,
  retrieveSectionMaterial,
  retrieveSectionMaterialLegacy,
} from './writingWorkshop';
import { prepareRelevantDocumentProfiles } from './documentPreparation';
import {
  academicRelationshipContext,
  approachRules,
  mergeApproachSnapshots,
  planApproachRetrieval,
  type ApproachRetrievalPlan,
} from './deepResearchApproaches';
import {
  orchestrateDeepResearch,
  type DeepResearchDeps,
  type DeepResearchPlan,
  type DeepResearchPlanSection,
  type CitationClaim,
  type CitationVerdict,
  type CoherenceIssue,
  deepResearchNarrativeRules,
  type FinalizeInput,
  type FinalizeResult,
  type PlanInput,
  type PlanCoverageAuditInput,
  buildPlanInput,
  normalizePlan,
  fallbackPlan,
  resolveSectionPlan,
  sectionPlanMaximum,
  assignMissingCoverageQuestions,
  reconcileCoverageAudit,
  plannedCandidateWorkIds,
  buildSnapshotMaps,
  mergeRetrievedMaterial,
  buildCitationMenu,
  citationMenuExclusionText,
  matchesObjectiveExclusion,
  normalizeSectionClaimAudit,
  enforcePlanObjectiveExclusions,
  MAX_COVERAGE_QUESTIONS,
  MAX_SECTION_IDEAS,
  SECTION_RETRIEVAL_LIMITS,
  type ReportEditorialReview,
  type SectionInput,
  type SectionClaimAudit,
  type DeepResearchProofRole,
  type AtomicPassageRetrieval,
  type SectionEvidencePlan,
  type SectionRevisionInput,
} from './deepResearchCore';

/** A post-plan query may prepare a small high-value nucleus; the opt-in background
 * campaign owns exhaustive vault indexing. */
const ON_DEMAND_DOCUMENT_PROFILE_LIMIT = 8;

const DEEP_RESEARCH_PROOF_ROLES = new Set<DeepResearchProofRole>([
  'fact', 'actor_time', 'mechanism', 'causality', 'comparison_side',
  'agreement', 'contradiction', 'effect', 'reception', 'limit', 'method',
]);

function parseProofRole(value: unknown): DeepResearchProofRole {
  const normalized = String(value ?? '').trim().toLocaleLowerCase() as DeepResearchProofRole;
  return DEEP_RESEARCH_PROOF_ROLES.has(normalized) ? normalized : 'fact';
}

function sectionClaimsForWriting(section: DeepResearchPlanSection): string[] {
  return [...section.keyClaims, ...(section.coverageClaims ?? [])];
}

// ─────────────────────────────────────────────────────────────────────────────
// AI + DB wiring for Deep Research. The control flow (planning, coverage,
// evidence selection, citation policy, assembly) lives in the pure
// ./deepResearchCore module;
// here we only bind the injected dependencies to real provider/DB calls.
// ─────────────────────────────────────────────────────────────────────────────

export async function generateDeepResearchReport(request: DeepResearchRequest, onProgress?: (p: DeepResearchProgress) => void, signal?: AbortSignal): Promise<DeepResearchReport> {
  const settings = getSettings();
  const academic = getActiveVault().type === 'academic';
  if (request.notebookId && !academic) throw new Error('Research notebooks require an academic vault');
  if (academic) request = { ...request, studyMode: false, unitMode: false, documentSkills: undefined };
  const hints = academic ? [] : await prepareDocumentVisualHints(request.documentSkills, request.objective, request.model ?? settings.deepResearchModel ?? settings.synthesisModel, signal);
  const catalog = request.documentSkills ? documentSkillCatalog(listDocumentSkills(), request.documentSkills) : '[]';
  const controller = new AbortController();
  const release = request.notebookId ? registerNotebookRun(request.notebookId, controller) : () => undefined;
  const runSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    // The thinking level chosen in the form applies to every call the report makes to its model.
    // The language chosen in the form, when present, is the output language of every
    // call; the vault-wide setting only applies to requests that do not name one.
    return await withJobOutputLanguage(request.language, () => withJobThinkingEffort(request.thinkingEffort, request.model ?? settings.deepResearchModel ?? settings.synthesisModel,
      () => withDocumentVisualPlanning(catalog, hints, () => generateDeepResearchReportWithVisualPlan(request, onProgress, runSignal, hints)), runSignal));
  } finally { release(); }
}

async function generateDeepResearchReportWithVisualPlan(
  request: DeepResearchRequest,
  onProgress?: (p: DeepResearchProgress) => void,
  signal?: AbortSignal,
  documentVisualHints: string[] = [],
): Promise<DeepResearchReport> {
  signal?.throwIfAborted();
  const settings = getSettings();
  const model = request.model ?? settings.deepResearchModel ?? settings.synthesisModel ?? null;
  // Deep Research has useful fallbacks for an unavailable optional stage, but a
  // disconnected provider is not an optional-stage failure. Check Codex once up
  // front so we neither make dozens of doomed calls nor leave a job looking alive.
  if (model?.provider === 'codex') await assertChatGptSubscriptionConnected();
  signal?.throwIfAborted();
  const approach = normalizeDeepResearchApproach(request.approach);
  const deepResearchVersion = parseDeepResearchRequestVersion(request.deepResearchVersion);
  // Normalized once at the entry point every variant shares, so Study, Teaching,
  // Genealogy and both academic engines record the same value on their reports.
  const sectionLength = normalizeDeepResearchSectionLength(request.sectionLength);
  const versionedRequest: DeepResearchRequest = { ...request, deepResearchVersion, sectionLength };
  const finish = (result: DeepResearchReport) => { result.draft.documentSkills = request.documentSkills; result.draft.documentVisualHints = documentVisualHints; return withGenerationMetadata(result, approach, deepResearchVersion, model, sectionLength); };
  let report: DeepResearchReport;
  // A complete study guide reads exactly the selected sources. It must never fall
  // through to the retrieval-based study report, which would read the whole vault.
  if (request.completeGuide) {
    normalizeCompleteGuideConfig(request.completeGuide);
    if (getActiveVault().type !== 'estudio') throw new Error('La guía de estudio completa solo está disponible en vaults de Estudio.');
    return finish(await generateCompleteGuideReport(versionedRequest, model, onProgress, signal));
  }
  // Study and teaching share one pipeline over the local study_* corpus. Teaching adds
  // the extracted idea network and the unit prompts, selected by `unitMode`; the vault
  // type sets it for anything that reaches here without the flag (MCP, a stale queue).
  if (request.unitMode || getActiveVault().type === 'docencia') {
    const routedRequest = deepResearchVersion === 'v2'
      ? await requestWithCoverageQuestions(versionedRequest, model, signal)
      : versionedRequest;
    report = await generateStudyDeepResearchReport({ ...routedRequest, unitMode: true }, model, onProgress, signal);
    return finish(report);
  }
  if (request.studyMode || getActiveVault().type === 'estudio') {
    const routedRequest = deepResearchVersion === 'v2'
      ? await requestWithCoverageQuestions(versionedRequest, model, signal)
      : versionedRequest;
    report = await generateStudyDeepResearchReport(routedRequest, model, onProgress, signal);
    return finish(report);
  }
  // A genealogy vault has no idea graph; its Deep Research writes a family-history
  // report over the embedding-indexed archive + library instead (own pipeline).
  if (getActiveVault().type === 'genealogy') {
    const routedRequest = deepResearchVersion === 'v2'
      ? await requestWithCoverageQuestions(versionedRequest, model, signal)
      : versionedRequest;
    report = await generateGenealogyDeepResearchReport(routedRequest, onProgress, signal);
    return finish(report);
  }
  // Both academic routes are graph-first. Full-document profiles are prepared and
  // queried only after the orchestrator has frozen the argument.
  const baseDeps = deepResearchEnginePath(deepResearchVersion, approach) === 'v1-general'
      ? legacyAcademicDeps(model, signal)
    : deepResearchEnginePath(deepResearchVersion, approach) === 'v1-specialized'
      ? legacySpecializedAcademicDeps(model, approach, versionedRequest, signal)
      : deepResearchEnginePath(deepResearchVersion, approach) === 'v2-general'
      ? realDeps(model, signal)
      : specializedAcademicDeps(model, approach, versionedRequest, signal);
  report = await orchestrateDeepResearch({ ...versionedRequest, model }, bindAcademicCorpusRun(baseDeps, versionedRequest, signal), onProgress, signal);
  return finish(report);
}

/** Exact production planning path without section writing. Used by the isolated
 * quality harness so a weak outline can be rejected before report-sized spend. */
export async function generateDeepResearchPlanPreview(request: DeepResearchRequest, options: {
  auditEvidence?: boolean;
  /** Audit harness only: exercise the production documentary stages over a plan
   * generated by another isolated actor without spending another planning call. */
  planOverride?: DeepResearchPlan;
} = {}): Promise<{
  plan: DeepResearchPlan;
  coverageQuestions: string[];
  fallbackUsed: boolean;
  snapshotStats: { ideas: number; works: number; gaps: number; contradictions: number; passages: number };
  planningIdeas: Array<{ id: string; label: string; statement: string; score: number }>;
  claimAudit: { checked: number; supported: number; partial: number; unsupported: number } | null;
  documentPreparation: import('./deepResearchCore').PlanEvidencePreparationResult | null;
}> {
  if (getActiveVault().type !== 'academic') {
    throw new Error('La previsualización idea-first solo está disponible para vaults académicos.');
  }
  const settings = getSettings();
  const model = request.model ?? settings.deepResearchModel ?? settings.synthesisModel ?? null;
  const approach = normalizeDeepResearchApproach(request.approach);
  const deepResearchVersion = parseDeepResearchRequestVersion(request.deepResearchVersion);
  const versionedRequest: DeepResearchRequest = { ...request, deepResearchVersion };
  const baseDeps = deepResearchEnginePath(deepResearchVersion, approach) === 'v1-general'
      ? legacyAcademicDeps(model)
    : deepResearchEnginePath(deepResearchVersion, approach) === 'v1-specialized'
      ? legacySpecializedAcademicDeps(model, approach, versionedRequest)
      : deepResearchEnginePath(deepResearchVersion, approach) === 'v2-general'
      ? realDeps(model)
      : specializedAcademicDeps(model, approach, versionedRequest);
  const deps = bindAcademicCorpusRun(baseDeps, versionedRequest);
  const language = request.language ?? 'es';
  const brief = {
    kind: 'deep_research' as const,
    deepResearchVersion,
    objective: request.objective,
    audience: request.audience,
    tone: 'academic' as const,
    language,
  };
  const snapshot = await deps.buildSnapshot(brief);
  let coverageQuestions = (request.coverageQuestions ?? [])
    .map((question) => question.trim())
    .filter(Boolean)
    .slice(0, MAX_COVERAGE_QUESTIONS);
  if (deepResearchVersion === 'v2' && !coverageQuestions.length && deps.decomposeObjective) {
    try {
      coverageQuestions = (await deps.decomposeObjective(request.objective, language))
        .map((question) => question.trim())
        .filter(Boolean)
        .slice(0, MAX_COVERAGE_QUESTIONS);
    } catch {
      coverageQuestions = [];
    }
  }
  const sectionPlan = resolveSectionPlan(snapshot, request.sectionLimit ?? 'auto', request.objective, coverageQuestions);
  const input = buildPlanInput(
    { ...versionedRequest, coverageQuestions },
    language,
    snapshot,
    sectionPlan,
  );
  let plan: DeepResearchPlan;
  let fallbackUsed = false;
  try {
    plan = normalizePlan(
      options.planOverride ?? await deps.planReport(input),
      snapshot,
      sectionPlanMaximum(sectionPlan, coverageQuestions),
      coverageQuestions,
    );
    if (!plan.sections.length) throw new Error('empty plan');
  } catch {
    fallbackUsed = true;
    plan = fallbackPlan(request, snapshot, sectionPlan.target);
  }
  assignMissingCoverageQuestions(plan.sections, coverageQuestions);
  if (coverageQuestions.length && deps.auditPlanCoverage) {
    try {
      const audited = await deps.auditPlanCoverage({
        objective: request.objective,
        language,
        coverageQuestions,
        plan: {
          ...plan,
          sections: plan.sections.map((section) => ({
            ...section,
            keyClaims: [...section.keyClaims],
            ideaIds: [...section.ideaIds],
            workIds: [...section.workIds],
            gapIds: [...section.gapIds],
            contradictionIds: [...section.contradictionIds],
            passageIds: [...section.passageIds],
            coverageQuestions: [...(section.coverageQuestions ?? [])],
            dependsOn: [...(section.dependsOn ?? [])],
          })),
        },
        ideas: input.ideas,
        gaps: input.gaps,
        contradictions: input.contradictions,
      });
      reconcileCoverageAudit(plan, audited, snapshot, coverageQuestions);
    } catch {
      /* preview exposes the same safe fallback as the full orchestrator */
    }
  }
  enforcePlanObjectiveExclusions(plan, snapshot, request.objective);
  assignMissingCoverageQuestions(plan.sections, coverageQuestions);
  let documentPreparation: import('./deepResearchCore').PlanEvidencePreparationResult | null = null;
  const claimAudit = { checked: 0, supported: 0, partial: 0, unsupported: 0 };
  if (options.auditEvidence && deps.auditSectionClaims) {
    if (deps.preparePlanEvidence) {
      try {
        documentPreparation = await deps.preparePlanEvidence({
          objective: request.objective,
          language,
          coverageQuestions,
          plan: {
            ...plan,
            sections: plan.sections.map((section) => ({
              ...section,
              keyClaims: [...section.keyClaims],
              ideaIds: [...section.ideaIds],
              workIds: [...section.workIds],
              gapIds: [...section.gapIds],
              contradictionIds: [...section.contradictionIds],
              passageIds: [...section.passageIds],
              coverageQuestions: [...(section.coverageQuestions ?? [])],
              dependsOn: [...(section.dependsOn ?? [])],
            })),
          },
          candidateWorkIds: plannedCandidateWorkIds(plan, snapshot),
        });
      } catch {
        documentPreparation = null;
      }
    }
    const maps = buildSnapshotMaps(snapshot);
    for (const section of plan.sections) {
      if (deps.retrieveForSection) {
        try {
          const material = await deps.retrieveForSection({
            objective: request.objective,
            sectionTitle: section.title,
            purpose: section.purpose,
            keyClaims: [...section.keyClaims],
            coverageQuestions: [...(section.coverageQuestions ?? [])],
            excludeIdeaIds: [...section.ideaIds],
            excludePassageIds: [...section.passageIds],
            limits: SECTION_RETRIEVAL_LIMITS,
          });
          const merged = mergeRetrievedMaterial(maps, material ?? {});
          section.ideaIds = [...new Set([...section.ideaIds, ...merged.ideaIds])].slice(0, MAX_SECTION_IDEAS);
          section.passageIds = [...new Set([...section.passageIds, ...merged.passageIds])];
        } catch {
          /* Existing graph evidence remains auditable. */
        }
      }
      const originalClaims = [...section.keyClaims];
      const citationMenu = buildCitationMenu(section, maps).filter((item) =>
        !matchesObjectiveExclusion(citationMenuExclusionText(item, maps), request.objective));
      try {
        const audited = normalizeSectionClaimAudit(await deps.auditSectionClaims({
          objective: request.objective,
          language,
          audience: request.audience,
          section,
          isConclusion: section.role === 'synthesis',
          citationMenu,
          priorSummary: '',
          alreadyDeveloped: [],
          reservedForOtherSections: plan.sections.filter((candidate) => candidate.id !== section.id).map((candidate) => ({
            title: candidate.title,
            responsibilities: [...candidate.keyClaims, ...(candidate.coverageQuestions ?? [])],
          })),
        }), originalClaims, new Set(citationMenu.map((item) => item.token)));
        if (audited.items.length === originalClaims.length) {
          for (const item of audited.items) claimAudit[item.status] += 1;
          claimAudit.checked += audited.items.length;
          section.keyClaims = audited.items.map((item) => item.revised);
        }
      } catch {
        /* Preview remains graph-only when an audit call fails. */
      }
    }
  }
  return {
    plan,
    coverageQuestions,
    fallbackUsed,
    snapshotStats: {
      ideas: snapshot.ideas.length,
      works: snapshot.works.length,
      gaps: snapshot.gaps.length,
      contradictions: snapshot.contradictions.length,
      passages: snapshot.passages.length,
    },
    planningIdeas: snapshot.ideas.slice(0, 70).map((idea) => ({
      id: idea.id,
      label: idea.label,
      statement: idea.statement,
      score: idea.score,
    })),
    claimAudit: claimAudit.checked > 0 ? claimAudit : null,
    documentPreparation,
  };
}

async function requestWithCoverageQuestions(
  request: DeepResearchRequest,
  model: ModelRef | null,
  signal?: AbortSignal,
): Promise<DeepResearchRequest> {
  signal?.throwIfAborted();
  if (request.coverageQuestions?.length) {
    return { ...request, coverageQuestions: request.coverageQuestions.slice(0, MAX_COVERAGE_QUESTIONS) };
  }
  const coverageQuestions = await aiDecomposeObjective(request.objective, request.language, model);
  signal?.throwIfAborted();
  return {
    ...request,
    coverageQuestions,
  };
}

/** Pure characterization seam used by CI to lock old/undefined requests to General. */
export function deepResearchApproachPath(value: unknown): 'general' | 'specialized' {
  return normalizeDeepResearchApproach(value) === 'general' ? 'general' : 'specialized';
}

/** Pure router seam. Version and research approach remain orthogonal metadata. */
export function deepResearchEnginePath(
  versionValue: unknown,
  approachValue: unknown,
): 'v1-general' | 'v1-specialized' | 'v2-general' | 'v2-specialized' {
  const version = parseDeepResearchRequestVersion(versionValue);
  return characterizeDeepResearchEngine(version, deepResearchApproachPath(approachValue) === 'specialized');
}

/**
 * The one seam every variant returns through — academic v1/v2, the specialized
 * approaches, Study, Teaching and Genealogy — so generation-time provenance is
 * recorded once instead of five times. The requested section length belongs here
 * for the same reason: reusing a prompt has to restore it whichever pipeline wrote
 * the report, and a report written before the control reads back as `'auto'`.
 */
function withGenerationMetadata(
  report: DeepResearchReport,
  approach: DeepResearchApproach,
  deepResearchVersion: DeepResearchVersion,
  model: ModelRef | null,
  sectionLength: DeepResearchSectionLength = 'auto',
): DeepResearchReport {
  return {
    ...report,
    draft: {
      ...report.draft,
      brief: { ...report.draft.brief, deepResearchApproach: approach, deepResearchVersion },
      deepResearchApproach: approach,
      deepResearchVersion,
      deepResearchSectionLength: report.draft.deepResearchSectionLength ?? sectionLength,
      generationModel: model ? { ...model } : null,
    },
    meta: { ...report.meta, deepResearchVersion, sectionLength: report.meta.sectionLength ?? sectionLength },
  };
}

/** Reproducible compatibility engine. It preserves the historical idea/passage
 * retrieval architecture while sharing the current evidence-driven (length-free)
 * writing and citation safety contract. */
function legacyAcademicDeps(model: ModelRef | null, signal?: AbortSignal): DeepResearchDeps {
  return {
    buildSnapshot: (brief) => buildHistoricalWritingWorkshopSnapshot(brief),
    planReport: (input) => aiPlanReport(input, model),
    writeSection: (input) => aiWriteSection(input, model, undefined, signal),
    finalize: (input) => aiFinalize(input, model),
    retrieveForSection: (input) => retrieveSectionMaterialLegacy(input),
    verifyCitations: (claims, language) => aiVerifyCitations(claims, model, language),
    checkCoherence: (sections, language) => aiCheckCoherence(sections, model, language),
  };
}

function legacySpecializedAcademicDeps(
  model: ModelRef | null,
  approach: DeepResearchApproach,
  request: DeepResearchRequest,
  signal?: AbortSignal,
): DeepResearchDeps {
  let context: AcademicApproachContext = {
    approach,
    rules: approachRules(approach, 'academic'),
    retrieval: { probes: [], comparands: [], axes: [], phases: [] },
    relationships: [],
  };
  return {
    prepareScopedSnapshot: async (ordinary, extend) => {
      const retrieval = await planApproachRetrieval({ approach, variant: 'academic', objective: request.objective,
        language: request.language ?? 'es', model, corpusPreview: {
          themes: ordinary.themes.slice(0, 16).map(item => item.label),
          works: ordinary.works.slice(0, 24).map(item => ({ title: item.title, authors: item.authors, year: item.year })),
          contradictions: ordinary.contradictions.slice(0, 16).map(item => item.summary),
          gaps: ordinary.gaps.slice(0, 16).map(item => item.summary),
        } });
      const supplemental = await extend(retrieval.probes);
      const merged = mergeApproachSnapshots(ordinary, supplemental, approach);
      context = { ...context, retrieval, relationships: academicRelationshipContext(merged) };
      return merged;
    },
    buildSnapshot: async (brief) => {
      const ordinary = await buildHistoricalWritingWorkshopSnapshot(brief);
      const retrieval = await planApproachRetrieval({
        approach,
        variant: 'academic',
        objective: request.objective,
        language: request.language ?? 'es',
        model,
        corpusPreview: {
          themes: ordinary.themes.slice(0, 16).map((item) => item.label),
          works: ordinary.works.slice(0, 24).map((item) => ({ title: item.title, authors: item.authors, year: item.year })),
          contradictions: ordinary.contradictions.slice(0, 16).map((item) => item.summary),
          gaps: ordinary.gaps.slice(0, 16).map((item) => item.summary),
        },
      });
      const supplemental = await buildHistoricalWritingWorkshopSnapshot(brief, retrieval.probes);
      const merged = mergeApproachSnapshots(ordinary, supplemental, approach);
      context = { ...context, retrieval, relationships: academicRelationshipContext(merged) };
      return merged;
    },
    planReport: (input) => aiPlanReport(input, model, context),
    writeSection: (input) => aiWriteSection(input, model, context, signal),
    finalize: (input) => aiFinalize(input, model, context),
    retrieveForSection: (input) => retrieveSectionMaterialLegacy(input),
    verifyCitations: (claims, language) => aiVerifyCitations(claims, model, language),
    checkCoherence: (sections, language) => aiCheckCoherence(sections, model, language),
  };
}

function realDeps(model: ModelRef | null, signal?: AbortSignal): DeepResearchDeps {
  const experimentalProse = process.env.NODUS_EXPERIMENTAL_DEEP_RESEARCH_PROSE === '1';
  let relationships: ReturnType<typeof academicRelationshipContext> = [];
  return {
    prepareScopedSnapshot: async (ordinary, extend) => {
      const snapshot = await extend(academicObjectiveProbes(ordinary.brief.objective));
      relationships = academicRelationshipContext(snapshot);
      return snapshot;
    },
    buildSnapshot: async (brief) => {
      const snapshot = await buildIdeaFirstWritingWorkshopSnapshot(brief, academicObjectiveProbes(brief.objective));
      relationships = academicRelationshipContext(snapshot);
      return snapshot;
    },
    planReport: (input) => aiPlanReport({ ...input, relationships }, model),
    writeSection: (input) => aiWriteSection(input, model, undefined, signal),
    finalize: (input) => aiFinalize(input, model),
    auditFinalSummary: (input, draft) => aiAuditFinalSummary(input, draft, model),
    decomposeObjective: (objective, language) => aiDecomposeObjective(objective, language, model),
    auditPlanCoverage: (input) => aiAuditPlanCoverage(input, model, relationships),
    preparePlanEvidence: (input) => prepareRelevantDocumentProfiles(
      input.candidateWorkIds,
      'deep-research',
      ON_DEMAND_DOCUMENT_PROFILE_LIMIT,
      signal,
    ),
    retrieveForSection: (input) => retrieveSectionMaterial(input),
    auditSectionClaims: (input) => aiAuditSectionClaims(input, model),
    reviseSection: (input) => aiReviseSection(input, model),
    verifyCitations: (claims, language) => aiVerifyCitations(claims, model, language),
    checkCoherence: (sections, language) => aiCheckCoherence(sections, model, language),
    // The evidence-planned/paragraph writer raised deterministic proxy scores but
    // repeatedly lost full-text blind comparisons against existing Nodus reports.
    // Keep it available for explicit research runs, never as the production default.
    ...(experimentalProse ? {
      planSectionEvidence: (input: SectionInput) => aiPlanSectionEvidence(input, model),
      judgeSectionRevision: (input: SectionInput, original: string, revised: string) => aiJudgeSectionRevision(input, original, revised, model),
      reviewReport: (input: Parameters<NonNullable<DeepResearchDeps['reviewReport']>>[0]) => aiReviewReport(input, model),
    } : {}),
  };
}

interface AcademicApproachContext {
  approach: DeepResearchApproach;
  rules: ReturnType<typeof approachRules>;
  retrieval: ApproachRetrievalPlan;
  relationships: ReturnType<typeof academicRelationshipContext>;
}

/** Specialized Academic adapter. It is intentionally unreachable from General. */
function specializedAcademicDeps(
  model: ModelRef | null,
  approach: DeepResearchApproach,
  request: DeepResearchRequest,
  signal?: AbortSignal,
): DeepResearchDeps {
  const experimentalProse = process.env.NODUS_EXPERIMENTAL_DEEP_RESEARCH_PROSE === '1';
  let context: AcademicApproachContext = {
    approach,
    rules: approachRules(approach, 'academic'),
    retrieval: { probes: [], comparands: [], axes: [], phases: [] },
    relationships: [],
  };
  return {
    prepareScopedSnapshot: async (ordinary, extend) => {
      const retrieval = await planApproachRetrieval({ approach, variant: 'academic', objective: request.objective,
        language: request.language ?? 'es', model, corpusPreview: {
          themes: ordinary.themes.slice(0, 16).map(item => item.label),
          works: ordinary.works.slice(0, 24).map(item => ({ title: item.title, authors: item.authors, year: item.year })),
          contradictions: ordinary.contradictions.slice(0, 16).map(item => item.summary),
          gaps: ordinary.gaps.slice(0, 16).map(item => item.summary),
        } });
      const supplemental = await extend(retrieval.probes);
      const merged = mergeApproachSnapshots(ordinary, supplemental, approach);
      context = { ...context, retrieval, relationships: academicRelationshipContext(merged) };
      return merged;
    },
    buildSnapshot: async (brief) => {
      // Specialized probes may broaden the IDEA graph before planning. Document
      // profiles and passages remain excluded until the resulting plan is fixed.
      const ordinary = await buildIdeaFirstWritingWorkshopSnapshot(brief, academicObjectiveProbes(brief.objective));
      const retrieval = await planApproachRetrieval({
        approach,
        variant: 'academic',
        objective: request.objective,
        language: request.language ?? 'es',
        model,
        corpusPreview: {
          themes: ordinary.themes.slice(0, 16).map((item) => item.label),
          works: ordinary.works.slice(0, 24).map((item) => ({ title: item.title, authors: item.authors, year: item.year })),
          contradictions: ordinary.contradictions.slice(0, 16).map((item) => item.summary),
          gaps: ordinary.gaps.slice(0, 16).map((item) => item.summary),
        },
      });
      const supplemental = await buildIdeaFirstWritingWorkshopSnapshot(brief, retrieval.probes);
      const merged = mergeApproachSnapshots(ordinary, supplemental, approach);
      context = { ...context, retrieval, relationships: academicRelationshipContext(merged) };
      return merged;
    },
    planReport: (input) => aiPlanReport(input, model, context),
    writeSection: (input) => aiWriteSection(input, model, context, signal),
    finalize: (input) => aiFinalize(input, model, context),
    auditFinalSummary: (input, draft) => aiAuditFinalSummary(input, draft, model, context),
    decomposeObjective: (objective, language) => aiDecomposeObjective(objective, language, model),
    auditPlanCoverage: (input) => aiAuditPlanCoverage(input, model, context.relationships),
    preparePlanEvidence: (input) => prepareRelevantDocumentProfiles(
      input.candidateWorkIds,
      'deep-research',
      ON_DEMAND_DOCUMENT_PROFILE_LIMIT,
      signal,
    ),
    retrieveForSection: async (input) => {
      const ordinary = await retrieveSectionMaterial(input);
      const facets = [...context.retrieval.axes, ...context.retrieval.phases, ...context.retrieval.comparands]
        .slice(0, 3);
      if (!facets.length) return ordinary;
      const supplemental = await retrieveSectionMaterial({
        ...input,
        purpose: `${input.purpose}. ${facets.join('. ')}`,
        keyClaims: [...input.keyClaims, ...facets],
        limits: { ideas: input.limits.ideas * 2, passages: input.limits.passages * 2 },
      });
      return {
        ideas: [...ordinary.ideas, ...supplemental.ideas].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index),
        passages: [...ordinary.passages, ...supplemental.passages].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index),
        evidencePacks: [...ordinary.evidencePacks, ...supplemental.evidencePacks].reduce<Array<{
          question: string;
          passageIds: string[];
          candidates: AtomicPassageRetrieval[];
        }>>((packs, pack) => {
          const existing = packs.find((candidate) => candidate.question === pack.question);
          if (existing) {
            existing.passageIds = [...new Set([...existing.passageIds, ...pack.passageIds])];
            existing.candidates = [...existing.candidates, ...(pack.candidates ?? [])]
              .filter((item, index, all) => all.findIndex((candidate) => candidate.passageId === item.passageId) === index);
          } else {
            packs.push({ question: pack.question, passageIds: [...pack.passageIds], candidates: [...(pack.candidates ?? [])] });
          }
          return packs;
        }, []),
      };
    },
    auditSectionClaims: (input) => aiAuditSectionClaims(input, model, context),
    reviseSection: (input) => aiReviseSection(input, model, context),
    verifyCitations: (claims, language) => aiVerifyCitations(claims, model, language),
    checkCoherence: (sections, language) => aiCheckCoherence(sections, model, language),
    ...(experimentalProse ? {
      planSectionEvidence: (input: SectionInput) => aiPlanSectionEvidence(input, model, context),
      judgeSectionRevision: (input: SectionInput, original: string, revised: string) => aiJudgeSectionRevision(input, original, revised, model),
      reviewReport: (input: Parameters<NonNullable<DeepResearchDeps['reviewReport']>>[0]) => aiReviewReport(input, model),
    } : {}),
  };
}

/** Explicit clauses broaden graph recall without turning coverage into an outline.
 * Unlike the old AI decomposition, these probes add no concepts and carry no
 * exclusive section mandate; they are merely alternative searches over the same
 * user-authored objective. */
export function academicObjectiveProbes(objective: string): string[] {
  const normalized = objective.replace(/\s+/gu, ' ').trim();
  if (!normalized) return [];
  const clauses = normalized
    .split(/[.;]\s+/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= 32)
    .filter((clause) => !/^(?:excluir|exclude|sin abordar|no abordar)\b/iu.test(clause));
  return [...new Set(clauses)].slice(0, 7);
}

interface AiCoherence {
  tensiones?: { seccion_a?: string; cita_a?: string; seccion_b?: string; cita_b?: string; problema?: string }[];
}

interface AiReportReview {
  diagnostico_global?: string;
  secciones?: Array<{
    titulo?: string;
    diagnostico?: string;
    eliminar?: string[];
    profundizar?: string[];
    cautelas?: string[];
    transicion?: string;
  }>;
}
function isAiReportReview(value: unknown): value is AiReportReview {
  return typeof value === 'object' && value !== null && Array.isArray((value as AiReportReview).secciones);
}

async function aiReviewReport(
  input: {
    objective: string;
    language: PromptLanguage;
    sections: Array<{ title: string; purpose: string; responsibilities: string[]; markdown: string }>;
  },
  model: ModelRef | null,
): Promise<ReportEditorialReview> {
  const system = deepResearchQualityPromptPack(input.language).editorialReview;
  const user = JSON.stringify({
    objetivo: input.objective,
    secciones: input.sections.map((section) => ({
      titulo: section.title,
      proposito: section.purpose,
      responsabilidades: section.responsibilities,
      texto: section.markdown.replace(/\[([^\]]*)\]\((nodus:\/\/[^)]*)\)/g, '$1'),
    })),
  }, null, 2);
  const result = await completeJson<AiReportReview>({ system, user, temperature: 0, maxTokens: 4200 }, isAiReportReview, model);
  return {
    overall: String(result.diagnostico_global ?? '').trim(),
    directives: (result.secciones ?? []).map((section) => ({
      sectionTitle: String(section.titulo ?? '').trim(),
      diagnosis: String(section.diagnostico ?? '').trim(),
      remove: (section.eliminar ?? []).filter((item): item is string => typeof item === 'string').slice(0, 8),
      deepen: (section.profundizar ?? []).filter((item): item is string => typeof item === 'string').slice(0, 8),
      cautions: (section.cautelas ?? []).filter((item): item is string => typeof item === 'string').slice(0, 8),
      transition: String(section.transicion ?? '').trim(),
    })).filter((section) => section.sectionTitle),
  };
}
function isAiCoherence(v: unknown): v is AiCoherence {
  return typeof v === 'object' && v !== null;
}

/**
 * Look for places where the report argues against itself.
 *
 * Read-only by design. Both sides must be quoted verbatim so the orchestrator can
 * confirm the sentences exist before believing the finding — a model asked to find
 * contradictions will happily invent one, and an invented tension printed in the
 * limitations of an academic report is worse than no check at all.
 */
async function aiCheckCoherence(
  sections: { title: string; text: string }[],
  model: ModelRef | null,
  language: PromptLanguage = 'es',
): Promise<CoherenceIssue[]> {
  const system = deepResearchQualityPromptPack(language).coherenceCheck;
  const user = JSON.stringify(
    { secciones: sections.map((s) => ({ titulo: s.title, texto: s.text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') })) },
    null,
    2
  );
  try {
    const ai = await completeJson<AiCoherence>({ system, user, temperature: 0, maxTokens: 1400 }, isAiCoherence, model);
    return (ai.tensiones ?? [])
      .filter((t) => t && typeof t.cita_a === 'string' && typeof t.cita_b === 'string')
      .slice(0, 5)
      .map((t) => ({
        sectionA: String(t.seccion_a ?? ''),
        quoteA: String(t.cita_a ?? ''),
        sectionB: String(t.seccion_b ?? ''),
        quoteB: String(t.cita_b ?? ''),
        issue: String(t.problema ?? '').trim() || 'Afirmaciones incompatibles entre secciones.',
      }));
  } catch {
    return [];
  }
}

interface AiProbes {
  subpreguntas?: string[];
}
function isAiProbes(v: unknown): v is AiProbes {
  return typeof v === 'object' && v !== null;
}

/**
 * Break the objective into the questions a researcher would actually go looking for.
 *
 * The corpus is searched by semantic similarity, so a single probe reaches only what
 * resembles the objective *as a whole sentence*. An objective spanning several axes
 * retrieves the intersection and misses what each axis would surface on its own —
 * with ~10,000 ideas indexed, a report was being built on the neighbourhood of one
 * query. Each sub-question becomes an independent probe. Failure is harmless: the
 * objective alone still works exactly as before.
 */
async function aiDecomposeObjective(objective: string, language: string | undefined, model: ModelRef | null): Promise<string[]> {
  const system = deepResearchPlanningPromptPack(
    (language ?? 'es') as PromptLanguage,
    { maxCoverageQuestions: MAX_COVERAGE_QUESTIONS },
  ).decomposeObjective;
  try {
    const ai = await completeJson<AiProbes>(
      { system, user: JSON.stringify({ objetivo: objective, idioma: language ?? 'es' }), temperature: 0.2, maxTokens: 700 },
      isAiProbes,
      model
    );
    return (ai.subpreguntas ?? [])
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 12)
      .slice(0, MAX_COVERAGE_QUESTIONS);
  } catch {
    return [];
  }
}

/** Exposed for `scripts/measure-retrieval-breadth.mjs`. */
export const __decomposeObjectiveForTesting = aiDecomposeObjective;

/** How many claims are judged per call. Small enough that the judge reads each one. */
const VERIFY_BATCH = 12;

/**
 * Exposed for `scripts/verify-citation-judge.mjs`, which feeds the judge deliberately
 * false citations to check it rejects them. A verifier nobody audits can quietly
 * approve everything and still look like it is working.
 */
export const __verifyCitationsForTesting = aiVerifyCitations;

/**
 * Judge whether each cited source really supports the sentence it was attached to.
 *
 * The citation policy already proves the source exists in the corpus; this is the
 * only thing standing between "the report cites something real" and "the report
 * cites something that says what the report claims it says". A claim whose judgement
 * cannot be obtained aborts the batch and is recorded as unverified by the
 * orchestrator. It never deletes a citation on the strength of a failed API call,
 * but it also never presents an unavailable judgement as a successful check.
 */
export async function aiVerifyCitations(
  claims: CitationClaim[],
  model: ModelRef | null,
  language: PromptLanguage = 'es',
): Promise<CitationVerdict[]> {
  const verdicts: Array<CitationVerdict | null> = new Array(claims.length).fill(null);
  const system = deepResearchQualityPromptPack(language).citationVerifier;

  for (let start = 0; start < claims.length; start += VERIFY_BATCH) {
    const batch = claims.slice(start, start + VERIFY_BATCH);
    const user = JSON.stringify(
      {
        pares: batch.map((claim, offset) => ({
          i: offset,
          afirmacion: claim.sentence,
          tipo_de_fuente: claim.kind,
          contenido_de_la_fuente: claim.content,
        })),
      },
      null,
      2
    );
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        // This verifier owns the complete three-attempt budget. Letting completeJson
        // retry internally as well multiplies a persistent schema mismatch into nine
        // identical billed calls before the batch can fail closed.
        const ai = await completeJson<AiVerdictsResponse>(
          { system, user, temperature: 0, maxTokens: 1800, noRetry: true },
          isAiVerdicts,
          model,
        );
        for (const entry of verdictEntries(ai)) {
          const index = typeof entry.i === 'number' ? entry.i : entry.index;
          const at = start + (typeof index === 'number' ? index : -1);
          if (at < start || at >= start + batch.length) continue;
          const verdict = normalizeCitationVerdict(entry.veredicto ?? entry.verdict);
          if (verdict) verdicts[at] = verdict;
        }
        if (verdicts.slice(start, start + batch.length).every((verdict) => verdict != null)) break;
        lastError = new Error('El verificador omitió uno o más veredictos.');
      } catch (error) {
        lastError = error;
      }
    }
    if (verdicts.slice(start, start + batch.length).some((verdict) => verdict == null)) {
      throw new Error(`No se pudo verificar el lote de citas ${start + 1}-${start + batch.length}.`, { cause: lastError });
    }
  }
  return verdicts as CitationVerdict[];
}

/**
 * Repair argument quality without widening the evidence boundary. The orchestrator
 * still decides whether to keep this rewrite using deterministic before/after
 * metrics, so the editor cannot improve its own grade by assertion.
 */
async function aiReviseSection(
  input: SectionRevisionInput,
  model: ModelRef | null,
  approach?: AcademicApproachContext,
): Promise<string> {
  const system = deepResearchWritingPromptPack(input.language, {
    documentaryEvidence: getActiveVault().type === 'academic',
    approachRules: approach?.rules.writer ?? [],
    narrativeRules: deepResearchNarrativeRules(input.language),
  }).sectionEditor;
  const user = JSON.stringify({
    objetivo: input.objective,
    tipo_de_pase: (input.verificationConcerns?.length ?? 0) > 0 ? 'reparacion_probatoria' : 'edicion_academica_final',
    seccion: {
      titulo: input.section.title,
      proposito: input.section.purpose,
      proposiciones_a_contrastar: sectionClaimsForWriting(input.section),
      preguntas_de_cobertura: input.section.coverageQuestions ?? [],
    },
    problemas_detectados: input.quality.issues,
    directiva_del_editor_global: input.editorialDirective ?? null,
    frases_con_respaldo_parcial_o_retirado: input.verificationConcerns ?? [],
    metricas_antes: input.quality.metrics,
    borrador: input.draft,
    menu_de_citas: input.citationMenu,
    afirmaciones_ya_desarrolladas: input.alreadyDeveloped,
    responsabilidades_reservadas_a_otras_secciones: input.reservedForOtherSections ?? [],
    plan_probatorio: input.evidencePlan ?? null,
    auditoria_epistemologica: input.claimAudit ?? null,
  }, null, 2);
  return completeText({ system, user, temperature: 0, maxTokens: 5600 }, model);
}

interface AiSectionChoice { ganador?: number; motivo?: string }
function isAiSectionChoice(value: unknown): value is AiSectionChoice {
  return typeof value === 'object' && value !== null && typeof (value as AiSectionChoice).ganador === 'number';
}

/**
 * Prevent a stylistic rewrite from being accepted just because easy-to-game
 * counters stayed green. The same pair is judged in both orders and the revision
 * wins only on agreement; any order bias or uncertainty keeps the verified draft.
 */
async function aiJudgeSectionRevision(
  input: SectionInput,
  original: string,
  revised: string,
  model: ModelRef | null,
): Promise<boolean> {
  const system = deepResearchQualityPromptPack(input.language).candidateJudge;
  const ask = async (first: string, second: string): Promise<number> => {
    const user = JSON.stringify({
      objetivo: input.objective,
      seccion: {
        titulo: input.section.title,
        proposito: input.section.purpose,
        preguntas_de_cobertura: input.section.coverageQuestions ?? [],
      },
      exclusiones_y_plan_probatorio: input.evidencePlan ?? null,
      responsabilidades_reservadas_a_otras_secciones: input.reservedForOtherSections ?? [],
      secciones_previas: input.priorSummary,
      version_1: first.replace(/\[([^\]]*)\]\((nodus:\/\/[^)]*)\)/g, '$1'),
      version_2: second.replace(/\[([^\]]*)\]\((nodus:\/\/[^)]*)\)/g, '$1'),
    }, null, 2);
    try {
      const result = await completeJson<AiSectionChoice>({ system, user, temperature: 0, maxTokens: 500 }, isAiSectionChoice, model);
      return result.ganador === 1 || result.ganador === 2 ? result.ganador : 0;
    } catch {
      return 0;
    }
  };
  const forward = await ask(original, revised);
  const reverse = await ask(revised, original);
  return forward === 2 && reverse === 1;
}

interface AiPlan {
  title?: string;
  abstract?: string;
  sections?: Array<Partial<DeepResearchPlanSection>>;
}

function isAiPlan(v: unknown): v is AiPlan {
  return typeof v === 'object' && v !== null && Array.isArray((v as AiPlan).sections);
}

async function aiAuditPlanCoverage(
  input: PlanCoverageAuditInput,
  model: ModelRef | null,
  relationships: ReturnType<typeof academicRelationshipContext>,
): Promise<DeepResearchPlan> {
  const system = deepResearchPlanningPromptPack(input.language).auditPlanCoverage;
  const user = JSON.stringify({
    objetivo: input.objective,
    preguntas_de_cobertura: input.coverageQuestions,
    plan_aprobado: input.plan,
    ideas_disponibles: input.ideas,
    huecos: input.gaps,
    contradicciones: input.contradictions,
    relaciones_del_grafo: relationships,
  }, null, 2);
  return planFromAi(await completeJson<AiPlan>(
    { system, user, temperature: 0.05, maxTokens: 6000 },
    isAiPlan,
    model,
  ));
}

async function aiPlanReport(input: PlanInput, model: ModelRef | null, approach?: AcademicApproachContext): Promise<DeepResearchPlan> {
  const promptPack = deepResearchPlanningPromptPack(input.language, {
    documentaryEvidence: input.passages.length > 0,
    sectionCount: input.sectionCount,
    sectionMode: input.sectionMode,
    approachRules: approach?.rules.planner ?? [],
  });
  // The length steer reaches the planner in the report's own language, so a section
  // mandate is designed wide enough for the development the user asked for.
  const lengthPack = deepResearchLengthPromptPack(input.language);
  const lengthWords = input.sectionLength?.targetWords ?? null;
  const system = lengthWords === null
    ? promptPack.planReport
    : `${promptPack.planReport}\n${lengthPack.plan(lengthWords)}`;
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      idioma: input.language,
      audiencia: input.audience ?? null,
      // The same number means different things in the two modes, so it is named
      // for what it is: a ceiling the user chose, or an evidence-derived target.
      ...(input.sectionMode === 'user'
        ? { secciones_maximas: input.sectionCount, arquitectura_sugerida: 'maximo_fijado_por_el_usuario' }
        : { secciones_objetivo: input.sectionCount, arquitectura_sugerida: 'derivada_de_la_evidencia' }),
      ...(lengthWords === null ? {} : { palabras_orientativas_por_seccion: lengthWords }),
      preguntas_de_cobertura_obligatoria: input.coverageQuestions,
      ideas: input.ideas,
      temas: input.themes,
      huecos: input.gaps,
      contradicciones: input.contradictions,
      obras: input.works,
      pasajes_documentales: input.passages,
      relaciones_del_grafo: approach?.relationships?.length ? approach.relationships : (input.relationships ?? []),
      ...(approach ? {
        enfoque_de_investigacion: approach.approach,
        plan_de_recuperacion: approach.retrieval,
      } : {}),
    },
    null,
    2
  );
  const ai = await completeJson<AiPlan>({ system, user, temperature: 0.2, maxTokens: 6000 }, isAiPlan, model);
  const draft = planFromAi(ai);
  let candidate = draft;
  try {
    const reviewSystem = promptPack.reviewPlan;
    const reviewUser = JSON.stringify({
      objetivo: input.objective,
      audiencia: input.audience ?? null,
      objetivo_con_exclusiones_vinculantes: input.objective,
      preguntas_de_cobertura_obligatoria: input.coverageQuestions,
      ideas: input.ideas.slice(0, 70),
      huecos: input.gaps.slice(0, 16),
      contradicciones: input.contradictions.slice(0, 16),
      pasajes_documentales: input.passages,
      relaciones_del_grafo: approach?.relationships?.length ? approach.relationships : (input.relationships ?? []),
      plan_candidato: draft,
    }, null, 2);
    const reviewed = await completeJson<AiPlan>(
      { system: reviewSystem, user: reviewUser, temperature: 0.08, maxTokens: 6000 },
      isAiPlan,
      model,
    );
    const refined = planFromAi(reviewed);
    candidate = refined.sections.length === draft.sections.length ? refined : draft;
  } catch {
    candidate = draft;
  }

  // A director can still be persuaded by the vocabulary of the user's hypothesis.
  // Run a separate adversarial pass whose only job is to bound propositions by the
  // graph evidence already assigned to each section. Documentary retrieval remains
  // later, so this pass must turn unsupported conclusions into questions rather than
  // imagining the proof that a future document might contain.
  try {
    const redTeamSystem = promptPack.adversarialReview;
    const ideaById = new Map(input.ideas.map((item) => [item.id, item]));
    const gapById = new Map(input.gaps.map((item) => [item.id, item]));
    const contradictionById = new Map(input.contradictions.map((item) => [item.id, item]));
    const passageById = new Map(input.passages.map((item) => [item.id, item]));
    const redTeamUser = JSON.stringify({
      objetivo_con_exclusiones_vinculantes: input.objective,
      preguntas_de_cobertura_obligatoria: input.coverageQuestions,
      plan_candidato: candidate,
      evidencia_asignada_por_seccion: candidate.sections.map((section) => ({
        sectionId: section.id,
        ideas: section.ideaIds.map((id) => ideaById.get(id)).filter(Boolean),
        huecos: section.gapIds.map((id) => gapById.get(id)).filter(Boolean),
        contradicciones: section.contradictionIds.map((id) => contradictionById.get(id)).filter(Boolean),
        pasajes_documentales: section.passageIds.map((id) => passageById.get(id)).filter(Boolean),
      })),
    }, null, 2);
    const redTeamed = planFromAi(await completeJson<AiPlan>(
      { system: redTeamSystem, user: redTeamUser, temperature: 0, maxTokens: 6000 },
      isAiPlan,
      model,
    ));
    if (redTeamed.sections.length !== candidate.sections.length) return candidate;
    // Assignments are a deterministic trust boundary even if the reviewer ignored
    // the preservation instruction. Only its epistemic wording is accepted.
    return {
      title: redTeamed.title,
      abstract: redTeamed.abstract,
      sections: candidate.sections.map((section, index) => ({
        ...section,
        title: redTeamed.sections[index]?.title || section.title,
        purpose: redTeamed.sections[index]?.purpose || section.purpose,
        keyClaims: redTeamed.sections[index]?.keyClaims?.length
          ? redTeamed.sections[index].keyClaims
          : section.keyClaims,
      })),
    };
  } catch {
    return candidate;
  }
}

function planFromAi(ai: AiPlan): DeepResearchPlan {
  return {
    title: ai.title ?? '',
    abstract: ai.abstract ?? '',
    sections: (ai.sections ?? []).map((s, i) => ({
      id: s.id ?? `s${i + 1}`,
      title: s.title ?? `Sección ${i + 1}`,
      purpose: s.purpose ?? '',
      keyClaims: Array.isArray(s.keyClaims) ? s.keyClaims : [],
      ideaIds: Array.isArray(s.ideaIds) ? s.ideaIds : [],
      workIds: Array.isArray(s.workIds) ? s.workIds : [],
      gapIds: Array.isArray(s.gapIds) ? s.gapIds : [],
      contradictionIds: Array.isArray(s.contradictionIds) ? s.contradictionIds : [],
      passageIds: Array.isArray(s.passageIds) ? s.passageIds : [],
      coverageQuestions: Array.isArray(s.coverageQuestions) ? s.coverageQuestions : [],
      role: s.role,
      dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
    })),
  };
}

interface AiSectionEvidencePlan {
  tesis?: string;
  vinculos_objetivo?: string[];
  exclusiones?: string[];
  parrafos?: Array<{
    funcion?: string;
    rol_probatorio?: string;
    afirmacion?: string;
    evidencias?: string[];
    relacion?: string;
    lados_relacion?: Array<{ etiqueta?: string; afirmacion?: string; evidencias?: string[] }>;
    cautela?: string;
    transicion?: string;
  }>;
}

interface AiSectionClaimAudit {
  claims?: Array<{
    i?: number;
    status?: string;
    reformulacion?: string;
    evidencias?: Array<{
      token?: string;
      rol?: string;
      motivo?: string;
    }>;
    requisitos?: Array<{
      texto?: string;
      rol?: string;
      probado?: boolean;
      evidencias?: string[];
    }>;
    motivo?: string;
  }>;
}

function isAiSectionClaimAudit(value: unknown): value is AiSectionClaimAudit {
  return typeof value === 'object' && value !== null && Array.isArray((value as AiSectionClaimAudit).claims);
}

/**
 * Claims leave planning as propositions, not facts. Only after section-specific
 * retrieval (including literal passages from whole-document indexing) does this
 * audit decide what the available evidence can actually sustain.
 */
async function aiAuditSectionClaims(
  input: SectionInput,
  model: ModelRef | null,
  approach?: AcademicApproachContext,
): Promise<SectionClaimAudit> {
  const targets = [...input.section.keyClaims, ...(input.section.coverageQuestions ?? [])];
  const system = deepResearchQualityPromptPack(input.language, approach?.rules.writer ?? []).claimsAudit;
  const user = JSON.stringify({
    objetivo: input.objective,
    seccion: {
      titulo: input.section.title,
      proposito: input.section.purpose,
      objetivos_a_contrastar_en_este_orden: targets.map((text, index) => ({
        i: index,
        tipo: index < input.section.keyClaims.length ? 'proposicion_del_plan' : 'pregunta_de_cobertura',
        text,
      })),
    },
    menu_de_evidencias: input.citationMenu,
    paquetes_atomicos: input.atomicEvidencePacks ?? [],
  }, null, 2);
  const ai = await completeJson<AiSectionClaimAudit>(
    { system, user, temperature: 0, maxTokens: 5200 },
    isAiSectionClaimAudit,
    model,
  );
  const allowed = new Set(input.citationMenu.map((item) => item.token));
  const packAllowed = new Map((input.atomicEvidencePacks ?? []).map((pack) => [
    pack.question,
    new Set(pack.candidates.map((candidate) => candidate.token)),
  ]));
  const byIndex = new Map((ai.claims ?? []).map((item) => [Number(item.i), item]));
  return {
    items: targets.map((original, index) => {
      const item = byIndex.get(index);
      const coverageQuestion = input.section.coverageQuestions?.[index - input.section.keyClaims.length];
      const scopedAllowed = coverageQuestion && (packAllowed.get(coverageQuestion)?.size ?? 0) > 0
        ? packAllowed.get(coverageQuestion)!
        : allowed;
      const rawStatus = String(item?.status ?? '').toLowerCase();
      const status = rawStatus === 'supported' || rawStatus === 'partial' ? rawStatus : 'unsupported';
      return {
        original,
        status,
        revised: String(item?.reformulacion ?? '').trim(),
        evidenceTokens: (item?.evidencias ?? [])
          .filter((entry) => entry?.rol === 'direct' || entry?.rol === 'context')
          .map((entry) => String(entry?.token ?? ''))
          .filter((token) => scopedAllowed.has(token)),
        reason: String(item?.motivo ?? '').trim(),
        evidencePack: (item?.evidencias ?? []).map((entry) => ({
          token: String(entry?.token ?? ''),
          role: (entry?.rol === 'direct' || entry?.rol === 'context' ? entry.rol : 'irrelevant') as 'direct' | 'context' | 'irrelevant',
          reason: String(entry?.motivo ?? '').trim(),
        })).filter((entry) => scopedAllowed.has(entry.token)),
        requirements: (item?.requisitos ?? []).map((requirement) => ({
          text: String(requirement?.texto ?? '').trim(),
          proofRole: parseProofRole(requirement?.rol),
          supported: requirement?.probado === true,
          evidenceTokens: (requirement?.evidencias ?? []).filter((token): token is string =>
            typeof token === 'string' && scopedAllowed.has(token)),
        })).filter((requirement) => requirement.text.length > 0),
      };
    }),
  };
}

function isAiSectionEvidencePlan(value: unknown): value is AiSectionEvidencePlan {
  return typeof value === 'object' && value !== null && Array.isArray((value as AiSectionEvidencePlan).parrafos);
}

/**
 * Plan claims against exact evidence before writing prose. A lightweight model is
 * much more reliable when it first has to state which source supports which claim:
 * the subsequent writer follows an explicit argument instead of attaching citations
 * after it has already improvised the paragraph.
 */
async function aiPlanSectionEvidence(
  input: SectionInput,
  model: ModelRef | null,
  approach?: AcademicApproachContext,
): Promise<SectionEvidencePlan> {
  const copy = deepResearchWritingRuntimeCopy(input.language);
  const lengthPlan = sectionLengthPlanOf(input);
  const base = deepResearchWritingPromptPack(input.language, {
    documentaryEvidence: getActiveVault().type === 'academic',
    approachRules: approach?.rules.writer ?? [],
  }).evidencePlan;
  // A longer section is planned as MORE distinct evidence-bearing paragraphs, not
  // as longer ones: the paragraph writer below then produces each in its own
  // bounded call, so structure, citations and context survive the extra length.
  const system = lengthPlan.targetWords === null
    ? base
    : `${base}\n${deepResearchLengthPromptPack(input.language).evidencePlan(lengthPlan.paragraphTarget, lengthPlan.targetWords)}`;
  const user = JSON.stringify({
    objetivo: input.objective,
    seccion: {
      titulo: input.section.title,
      proposito: input.section.purpose,
      proposiciones_a_contrastar: sectionClaimsForWriting(input.section),
      preguntas_de_cobertura: input.section.coverageQuestions ?? [],
    },
    menu_de_citas: input.citationMenu,
    recorrido_previo: input.priorSummary || copy.firstSection,
    afirmaciones_ya_desarrolladas: input.alreadyDeveloped,
    responsabilidades_reservadas_a_otras_secciones: input.reservedForOtherSections ?? [],
    auditoria_epistemologica: input.claimAudit ?? null,
  }, null, 2);
  const ai = await completeJson<AiSectionEvidencePlan>(
    { system, user, temperature: 0, maxTokens: 4500 },
    isAiSectionEvidencePlan,
    model,
  );
  const allowed = new Set(input.citationMenu.map((item) => item.token));
  const auditedDirect = new Set((input.claimAudit?.items ?? []).flatMap((claim) =>
    (claim.evidencePack ?? []).filter((entry) => entry.role === 'direct').map((entry) => entry.token)));
  const paragraphs = (ai.parrafos ?? []).map((item) => {
    const proofRole = parseProofRole(item.rol_probatorio);
    const relationshipSides = (item.lados_relacion ?? []).map((side) => ({
      label: String(side.etiqueta ?? '').trim(),
      claim: String(side.afirmacion ?? '').trim(),
      evidenceTokens: (side.evidencias ?? []).filter((token): token is string =>
        typeof token === 'string'
        && allowed.has(token)
        && (auditedDirect.size === 0 || auditedDirect.has(token))),
    })).filter((side) => side.label && side.claim && side.evidenceTokens.length > 0).slice(0, 4);
    const evidenceTokens = [...new Set([
      ...(item.evidencias ?? []).filter((token): token is string => typeof token === 'string' && allowed.has(token)),
      ...relationshipSides.flatMap((side) => side.evidenceTokens),
    ])].slice(0, 5);
    return {
      function: String(item.funcion ?? '').trim(),
      proofRole,
      claim: String(item.afirmacion ?? '').trim(),
      evidenceTokens,
      relationship: String(item.relacion ?? '').trim(),
      relationshipSides,
      caveat: String(item.cautela ?? '').trim(),
      transition: String(item.transicion ?? '').trim(),
    };
  }).filter((item) => item.claim && item.evidenceTokens.length > 0);
  if (paragraphs.length < 1) throw new Error(copy.emptyEvidencePlan);
  if (paragraphs.some((paragraph) =>
    (paragraph.proofRole === 'agreement' || paragraph.proofRole === 'contradiction')
    && (paragraph.relationshipSides?.length ?? 0) < 2)) {
    throw new Error(copy.incompleteBilateralEvidence);
  }
  return {
    thesis: String(ai.tesis ?? '').trim(),
    objectiveLinks: (ai.vinculos_objetivo ?? []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 8),
    exclusions: (ai.exclusiones ?? []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 8),
    paragraphs,
  };
}

/** The length plan for one section, defaulting to auto for pre-control callers. */
function sectionLengthPlanOf(input: SectionInput): DeepResearchSectionLengthPlan {
  return input.sectionLength ?? planDeepResearchSectionLength('auto');
}

async function aiWriteSection(
  input: SectionInput,
  model: ModelRef | null,
  approach?: AcademicApproachContext,
  signal?: AbortSignal,
): Promise<string> {
  const copy = deepResearchWritingRuntimeCopy(input.language);
  if ((input.evidencePlan?.paragraphs.length ?? 0) >= 1) {
    try {
      return await aiWriteSectionParagraphByParagraph(input, model, approach, signal);
    } catch {
      /* one bounded monolithic fallback keeps provider hiccups non-fatal */
    }
  }
  const lengthPlan = sectionLengthPlanOf(input);
  const lengthPack = deepResearchLengthPromptPack(input.language);
  const base = deepResearchWritingPromptPack(input.language, {
    documentaryEvidence: getActiveVault().type === 'academic',
    approachRules: approach?.rules.writer ?? [],
    narrativeRules: deepResearchNarrativeRules(input.language),
    isConclusion: input.isConclusion,
  }).sectionWriter;
  const system = lengthPlan.targetWords === null
    ? base
    : `${base}\n${lengthPack.section(lengthPlan.targetWords)}`;
  const payload = {
    objetivo: input.objective,
    idioma: input.language,
    seccion: { titulo: input.section.title, proposito: input.section.purpose, proposiciones_a_contrastar: sectionClaimsForWriting(input.section), preguntas_de_cobertura: input.section.coverageQuestions ?? [] },
    menu_de_citas: input.citationMenu,
    recorrido_secciones_previas: input.priorSummary || copy.firstSectionPath,
    afirmaciones_ya_desarrolladas: input.alreadyDeveloped,
    responsabilidades_reservadas_a_otras_secciones: input.reservedForOtherSections ?? [],
    plan_probatorio: input.evidencePlan ?? null,
    auditoria_epistemologica: input.claimAudit ?? null,
    ...(approach ? {
      enfoque_de_investigacion: approach.approach,
      comparandos: approach.retrieval.comparands,
      ejes: approach.retrieval.axes,
      fases: approach.retrieval.phases,
      relaciones_del_grafo: approach.relationships.slice(0, 40),
    } : {}),
  };
  const user = JSON.stringify(payload, null, 2);
  // The first pass keeps its historical budget so an auto-length report is byte-for
  // byte unchanged; only a chosen length raises it, and only within the shared cap.
  const firstPassTokens = lengthPlan.targetWords === null ? 5200 : Math.max(5200, lengthPlan.maxTokensPerPass);
  const first = await completeText({ system, user, temperature: 0.3, maxTokens: firstPassTokens }, model);
  if (lengthPlan.targetWords === null) return first;
  // A long section is produced by BOUNDED CONTINUATIONS, never by asking one
  // response for 20.000 words: every provider — and every local runtime — answers
  // a ~1.000-word request reliably, and each pass is its own cancellation point.
  const outcome = await extendDeepResearchSection({
    plan: lengthPlan,
    initial: first,
    signal,
    countWords: countDeepResearchWords,
    writeContinuation: async (context) => {
      const continuationUser = JSON.stringify({
        ...payload,
        seccion_escrita_hasta_ahora: context.produced.slice(-4_000),
        palabras_escritas: context.wordsSoFar,
        palabras_restantes: context.remainingWords,
      }, null, 2);
      const raw = await completeText({
        system: `${system}\n${lengthPack.continuation(context.remainingWords, context.passWords)}\n${lengthPack.continuationStop}`,
        user: continuationUser,
        temperature: 0.3,
        maxTokens: lengthPlan.maxTokensPerPass,
      }, model);
      // The model saying "nothing supported left to add" is a SUCCESSFUL stop, not
      // a failure: returning '' ends the loop instead of padding the report.
      if (isEmptyContinuation(raw)) return '';
      return raw
        .replace(/^```(?:markdown)?\s*/iu, '')
        .replace(/\s*```$/u, '')
        .replace(/^#{1,6}\s+[^\n]+\n+/u, '')
        .trim();
    },
  });
  return outcome.markdown;
}

async function aiWriteSectionParagraphByParagraph(
  input: SectionInput,
  model: ModelRef | null,
  approach?: AcademicApproachContext,
  signal?: AbortSignal,
): Promise<string> {
  const copy = deepResearchWritingRuntimeCopy(input.language);
  const plan = input.evidencePlan!;
  const lengthPlan = sectionLengthPlanOf(input);
  // Words per paragraph, derived from the section target and the paragraphs the
  // evidence actually sustained. Evidence decides how many; the target only
  // decides how fully each one is developed.
  const paragraphWords = lengthPlan.targetWords === null
    ? null
    : Math.max(120, Math.min(600, Math.round(lengthPlan.targetWords / Math.max(1, plan.paragraphs.length))));
  const menuByToken = new Map(input.citationMenu.map((item) => [item.token, item]));
  const written: string[] = [];
  for (let index = 0; index < plan.paragraphs.length; index += 1) {
    signal?.throwIfAborted();
    const paragraph = plan.paragraphs[index];
    const evidence = paragraph.evidenceTokens
      .map((token) => menuByToken.get(token))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!evidence.length) continue;
    const paragraphBase = deepResearchWritingPromptPack(input.language, {
    documentaryEvidence: getActiveVault().type === 'academic',
      approachRules: approach?.rules.writer ?? [],
      narrativeRules: deepResearchNarrativeRules(input.language),
    }).paragraphWriter;
    const system = paragraphWords === null
      ? paragraphBase
      : `${paragraphBase}\n${deepResearchLengthPromptPack(input.language).paragraph(paragraphWords)}`;
    const user = JSON.stringify({
      objetivo: input.objective,
      seccion: {
        titulo: input.section.title,
        proposito: input.section.purpose,
        preguntas_de_cobertura: input.section.coverageQuestions ?? [],
        tesis: plan.thesis,
        exclusiones: plan.exclusions,
      },
      numero_de_parrafo: index + 1,
      total_de_parrafos: plan.paragraphs.length,
      plan_del_parrafo: paragraph,
      minimenu_de_evidencias: evidence,
      auditoria_epistemologica: input.claimAudit ?? null,
      recorrido_de_secciones_previas: input.priorSummary,
      responsabilidades_reservadas_a_otras_secciones: input.reservedForOtherSections ?? [],
      cierre_del_parrafo_anterior: written.length ? written[written.length - 1].slice(-900) : copy.sectionStart,
    }, null, 2);
    const raw = await completeText({
      system,
      user,
      temperature: 0.12,
      maxTokens: paragraphWords === null ? 1500 : Math.max(1500, Math.round(paragraphWords * 2.4) + 400),
    }, model);
    const cleaned = raw
      .replace(/^```(?:markdown)?\s*/iu, '')
      .replace(/\s*```$/u, '')
      .replace(/^#{1,6}\s+[^\n]+\n+/u, '')
      .trim();
    if (!/nodus:\/\//u.test(cleaned) || !/[.!?](?:\s|$)/u.test(cleaned)) throw new Error(copy.incompleteEvidenceParagraph);
    written.push(cleaned);
  }
  if (written.length < 1) throw new Error(copy.emptyEvidenceDraft);
  return `## ${input.section.title}\n\n${written.join('\n\n')}`;
}

interface AiFinal {
  title?: string;
  abstract?: string;
  limitations?: string[];
  nextSteps?: string[];
}
function isAiFinal(v: unknown): v is AiFinal {
  return typeof v === 'object' && v !== null;
}

async function aiFinalize(input: FinalizeInput, model: ModelRef | null, approach?: AcademicApproachContext): Promise<FinalizeResult> {
  const system = deepResearchWritingPromptPack(input.language, {
    documentaryEvidence: getActiveVault().type === 'academic',
    approachRules: approach?.rules.finalizer ?? [],
  }).finalizer;
  const user = JSON.stringify(
    {
      objetivo: input.objective,
      idioma: input.language,
      titulo_provisional: input.planTitle,
      secciones: input.sectionTitles,
      ideas_cubiertas: input.ideasCovered,
      ideas_consideradas: input.ideasConsidered,
      ideas_sin_cubrir_ejemplos: input.uncoveredSamples,
      hallazgos_verificados_por_seccion: input.sectionFindings ?? [],
      afirmaciones_con_respaldo_retirado_o_parcial: input.supportConcerns ?? [],
      ...(approach ? { enfoque_de_investigacion: approach.approach, plan_de_recuperacion: approach.retrieval } : {}),
    },
    null,
    2
  );
  const ai = await completeJson<AiFinal>({ system, user, temperature: 0.2, maxTokens: 2000 }, isAiFinal, model);
  return {
    title: ai.title ?? input.planTitle,
    abstract: ai.abstract ?? '',
    limitations: Array.isArray(ai.limitations) ? ai.limitations : [],
    nextSteps: Array.isArray(ai.nextSteps) ? ai.nextSteps : [],
  };
}

/** A second, colder pass prevents a fluent abstract from restoring a hypothesis or
 * causal claim that section verification narrowed or removed. */
async function aiAuditFinalSummary(
  input: FinalizeInput,
  draft: FinalizeResult,
  model: ModelRef | null,
  approach?: AcademicApproachContext,
): Promise<FinalizeResult> {
  const system = deepResearchWritingPromptPack(input.language, {
    documentaryEvidence: getActiveVault().type === 'academic',
    approachRules: approach?.rules.finalizer ?? [],
  }).finalAudit;
  const user = JSON.stringify({
    objetivo: input.objective,
    borrador_de_cierre: draft,
    hallazgos_verificados_por_seccion: input.sectionFindings ?? [],
    preocupaciones_de_respaldo: input.supportConcerns ?? [],
  }, null, 2);
  const ai = await completeJson<AiFinal>({ system, user, temperature: 0, maxTokens: 2200 }, isAiFinal, model);
  return {
    title: ai.title ?? draft.title,
    abstract: ai.abstract ?? draft.abstract,
    limitations: Array.isArray(ai.limitations) ? ai.limitations : draft.limitations,
    nextSteps: Array.isArray(ai.nextSteps) ? ai.nextSteps : draft.nextSteps,
  };
}
