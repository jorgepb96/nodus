import {portableAcademicDeepResearch} from '@shared/portableAcademicDeepResearch';
import {prepareDeepResearchVariantRequest} from '@shared/prepareDeepResearchVariantRequest';
import {hasMobileCompletionReplay} from './mobileCompletionReplay';
import {portableDeepResearchAI} from '@shared/portableDeepResearchAI';
import { withJobThinkingEffort } from './thinkingEffort';
import { registerNotebookRun } from './researchNotebookService';
import { bindAcademicCorpusRun, resolveAcademicRunScope } from './researchCorpusRun';
import { researchScopeAuthorization } from './researchCorpusScope';
import { currentResearchHarness, researchHarnessEnabled, withResearchHarness } from './researchHarnessRuntime';
import { researchHarnessContext } from './researchHarnessContext';
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
  planApproachRetrieval,
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
} from './deepResearchCore';

/** A post-plan query may prepare a small high-value nucleus; the opt-in background
 * campaign owns exhaustive vault indexing. */


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
  if (!companion && getActiveVault().type === 'academic' && researchHarnessEnabled(request) && !currentResearchHarness()) {
    const scope = resolveAcademicRunScope(request.notebookId);
    const context = researchHarnessContext('deep-research', request, scope);
    let latest: DeepResearchProgress = { phase: 'discovery', message: context.objective };
    return withResearchHarness({ request, context, scope, signal,
      validate: () => { if (getActiveVault().id !== scope.vaultId || researchScopeAuthorization(resolveAcademicRunScope(request.notebookId)) !== researchScopeAuthorization(scope)) throw new Error('research_scope_changed'); },
      onUpdate: researchRun => onProgress?.({ ...latest, researchRun }),
    }, runSignal => generateDeepResearchReport({ ...request, model: context.model }, progress => { latest = progress; onProgress?.({ ...progress, researchRun: currentResearchHarness()?.summary() }); }, runSignal));
  }
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

async function requestWithCoverageQuestions(request:DeepResearchRequest,model:ModelRef|null,signal?:AbortSignal):Promise<DeepResearchRequest> {
  return prepareDeepResearchVariantRequest(request,model,aiDecomposeObjective,signal);
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
const canonicalAcademicAI = portableDeepResearchAI({currentResearchHarness,get documentaryEvidence() { return getActiveVault().type === "academic"; }, completeJson, completeText});
const {aiDecomposeObjective} = canonicalAcademicAI;
export const aiVerifyCitations = canonicalAcademicAI.aiVerifyCitations;
export const __decomposeObjectiveForTesting = aiDecomposeObjective;
export const __verifyCitationsForTesting = aiVerifyCitations;

const {legacyAcademicDeps,legacySpecializedAcademicDeps,realDeps,specializedAcademicDeps,academicObjectiveProbes}=portableAcademicDeepResearch({ai:canonicalAcademicAI,buildHistoricalWritingWorkshopSnapshot,buildIdeaFirstWritingWorkshopSnapshot,retrieveSectionMaterial,retrieveSectionMaterialLegacy,prepareRelevantDocumentProfiles,academicRelationshipContext,planApproachRetrieval,get experimentalProse(){return process.env.NODUS_EXPERIMENTAL_DEEP_RESEARCH_PROSE === '1';}});
export {academicObjectiveProbes};
