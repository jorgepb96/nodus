import {hasMobileCompletionReplay} from './mobileCompletionReplay';
import {portableDeepResearchAI} from '@shared/portableDeepResearchAI';
import { withJobThinkingEffort } from './thinkingEffort';
import { registerNotebookRun } from './researchNotebookService';
import { bindAcademicCorpusRun } from './researchCorpusRun';
import { withDocumentVisualPlanning } from './documentVisualContext';
import { documentSkillCatalog } from '../../shared/documentSkills';
import { listDocumentSkills } from '../capabilities/documentCatalog';
import { prepareDocumentVisualHints } from './documentVisuals';
import type { DeepResearchProgress, DeepResearchReport, DeepResearchRequest, ModelRef } from '@shared/types';
import { normalizeDeepResearchSectionLength, type DeepResearchSectionLength } from '@shared/deepResearchSectionLength';
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
  type SectionInput,
  type AtomicPassageRetrieval,
} from './deepResearchCore';

/** A post-plan query may prepare a small high-value nucleus; the opt-in background
 * campaign owns exhaustive vault indexing. */
const ON_DEMAND_DOCUMENT_PROFILE_LIMIT = 8;

// ─────────────────────────────────────────────────────────────────────────────
// AI + DB wiring for Deep Research. The control flow (planning, coverage,
// evidence selection, citation policy, assembly) lives in the pure
// ./deepResearchCore module;
// here we only bind the injected dependencies to real provider/DB calls.
// ─────────────────────────────────────────────────────────────────────────────

export interface CompanionDeepResearchRun {
 sourceOnly:true;
 onSources:(sources:unknown[],knowledge:unknown)=>void;
 onWorkText?:(id:string,text:string)=>void;
}
export async function generateDeepResearchReport(request: DeepResearchRequest, onProgress?: (p: DeepResearchProgress) => void, signal?: AbortSignal, companion?:CompanionDeepResearchRun): Promise<DeepResearchReport> {
  if(companion&&(!hasMobileCompletionReplay()||!request.model))throw new Error("mobile_completion_scope_required");
  if(companion&&request.completeGuide)throw new Error("mobile_complete_guide_binding_pending");
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
      () => withDocumentVisualPlanning(catalog, hints, () => generateDeepResearchReportWithVisualPlan(request, onProgress, runSignal, hints, companion)), runSignal));
  } finally { release(); }
}

async function generateDeepResearchReportWithVisualPlan(
  request: DeepResearchRequest,
  onProgress?: (p: DeepResearchProgress) => void,
  signal?: AbortSignal,
  documentVisualHints: string[] = [],
  companion?:CompanionDeepResearchRun,
): Promise<DeepResearchReport> {
  signal?.throwIfAborted();
  const settings = getSettings();
  const model = request.model ?? settings.deepResearchModel ?? settings.synthesisModel ?? null;
  // Deep Research has useful fallbacks for an unavailable optional stage, but a
  // disconnected provider is not an optional-stage failure. Check Codex once up
  // front so we neither make dozens of doomed calls nor leave a job looking alive.
  if (model?.provider === 'codex' && !hasMobileCompletionReplay()) await assertChatGptSubscriptionConnected();
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
    report = await generateStudyDeepResearchReport({ ...routedRequest, unitMode: true }, model, onProgress, signal, companion);
    return finish(report);
  }
  if (request.studyMode || getActiveVault().type === 'estudio') {
    const routedRequest = deepResearchVersion === 'v2'
      ? await requestWithCoverageQuestions(versionedRequest, model, signal)
      : versionedRequest;
    report = await generateStudyDeepResearchReport(routedRequest, model, onProgress, signal, companion);
    return finish(report);
  }
  // A genealogy vault has no idea graph; its Deep Research writes a family-history
  // report over the embedding-indexed archive + library instead (own pipeline).
  if (getActiveVault().type === 'genealogy') {
    const routedRequest = deepResearchVersion === 'v2'
      ? await requestWithCoverageQuestions(versionedRequest, model, signal)
      : versionedRequest;
    report = await generateGenealogyDeepResearchReport(routedRequest, onProgress, signal, companion);
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

/** Authorized companion source stages reuse the same notebook/retrieval binding
 * and factual audits. Model requests are fulfilled by the scoped mobile replay
 * host; no Desktop provider fallback is permitted. */
export function companionCanonicalDeepResearchDeps(request:DeepResearchRequest,signal?:AbortSignal):DeepResearchDeps {
  if(getActiveVault().type!=='academic'||request.completeGuide)throw new Error('mobile_deep_research_variant_pending');
  request = {...request, studyMode:false, unitMode:false, documentSkills:undefined};
  const approach=normalizeDeepResearchApproach(request.approach),version=parseDeepResearchRequestVersion(request.deepResearchVersion),model=request.model??null;
  if(!model)throw new Error('mobile_deep_research_model_missing');
  const base=deepResearchEnginePath(version,approach)==='v1-general'?legacyAcademicDeps(model,signal):deepResearchEnginePath(version,approach)==='v1-specialized'?legacySpecializedAcademicDeps(model,approach,request,signal):deepResearchEnginePath(version,approach)==='v2-general'?realDeps(model,signal):specializedAcademicDeps(model,approach,request,signal);
  return bindAcademicCorpusRun(base,request,signal,{sourceOnly:true});
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

const canonicalAcademicAI = portableDeepResearchAI({get documentaryEvidence() { return getActiveVault().type === "academic"; }, completeJson, completeText});
const {aiReviewReport,aiCheckCoherence,aiDecomposeObjective,aiReviseSection,aiJudgeSectionRevision,aiAuditPlanCoverage,aiPlanReport,aiAuditSectionClaims,aiPlanSectionEvidence,aiWriteSection,aiFinalize,aiAuditFinalSummary} = canonicalAcademicAI;
export const aiVerifyCitations = canonicalAcademicAI.aiVerifyCitations;
export const __decomposeObjectiveForTesting = aiDecomposeObjective;
export const __verifyCitationsForTesting = aiVerifyCitations;
