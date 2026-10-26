import type {DeepResearchRequest,ModelRef} from './types';
import type {DeepResearchDeps,SectionInput,AtomicPassageRetrieval} from '../electron/ai/deepResearchCore';
import type {portableDeepResearchAI} from './portableDeepResearchAI';
import {approachRules,mergeApproachSnapshots,type ApproachRetrievalPlan} from './portableDeepResearchApproaches';
import type {DeepResearchApproach} from './deepResearchApproaches';
import type {buildHistoricalWritingWorkshopSnapshot,buildIdeaFirstWritingWorkshopSnapshot,retrieveSectionMaterial,retrieveSectionMaterialLegacy} from '../electron/ai/writingWorkshop';
import type {prepareRelevantDocumentProfiles} from '../electron/ai/documentPreparation';
import type {academicRelationshipContext,planApproachRetrieval} from '../electron/ai/deepResearchApproaches';
export interface PortableAcademicResearchHost {
 ai:ReturnType<typeof portableDeepResearchAI>;
 buildHistoricalWritingWorkshopSnapshot:typeof buildHistoricalWritingWorkshopSnapshot;
 buildIdeaFirstWritingWorkshopSnapshot:typeof buildIdeaFirstWritingWorkshopSnapshot;
 retrieveSectionMaterial:typeof retrieveSectionMaterial;
 retrieveSectionMaterialLegacy:typeof retrieveSectionMaterialLegacy;
 prepareRelevantDocumentProfiles:typeof prepareRelevantDocumentProfiles;
 academicRelationshipContext:typeof academicRelationshipContext;
 planApproachRetrieval:typeof planApproachRetrieval;
 experimentalProse:boolean;
}
/** The four canonical academic route adapters, with source access bound by host. */
export function portableAcademicDeepResearch(host:PortableAcademicResearchHost) {
 const {buildHistoricalWritingWorkshopSnapshot,buildIdeaFirstWritingWorkshopSnapshot,retrieveSectionMaterial,retrieveSectionMaterialLegacy,prepareRelevantDocumentProfiles,academicRelationshipContext,planApproachRetrieval}=host;
 const {aiReviewReport,aiCheckCoherence,aiDecomposeObjective,aiReviseSection,aiJudgeSectionRevision,aiAuditPlanCoverage,aiPlanReport,aiAuditSectionClaims,aiPlanSectionEvidence,aiWriteSection,aiFinalize,aiAuditFinalSummary,aiVerifyCitations}=host.ai;
 const ON_DEMAND_DOCUMENT_PROFILE_LIMIT=8;
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
  const experimentalProse = host.experimentalProse;
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
  const experimentalProse = host.experimentalProse;
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
function academicObjectiveProbes(objective: string): string[] {
  const normalized = objective.replace(/\s+/gu, ' ').trim();
  if (!normalized) return [];
  const clauses = normalized
    .split(/[.;]\s+/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= 32)
    .filter((clause) => !/^(?:excluir|exclude|sin abordar|no abordar)\b/iu.test(clause));
  return [...new Set(clauses)].slice(0, 7);
}


return {legacyAcademicDeps,legacySpecializedAcademicDeps,realDeps,specializedAcademicDeps,academicObjectiveProbes};
}
