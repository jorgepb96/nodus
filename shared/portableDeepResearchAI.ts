import type {ModelRef,PromptLanguage} from './types';
import {verdictEntries,isAiVerdicts,normalizeCitationVerdict,type AiVerdictsResponse} from './citationVerdicts';
import {deepResearchPlanningPromptPack} from './deepResearchPlanningPromptPacks';
import {deepResearchQualityPromptPack} from './deepResearchQualityPromptPacks';
import {deepResearchWritingPromptPack,deepResearchWritingRuntimeCopy} from './deepResearchWritingPromptPacks';
import {deepResearchLengthPromptPack,isEmptyContinuation} from './deepResearchLengthPromptPacks';
import {countDeepResearchWords,extendDeepResearchSection,planDeepResearchSectionLength,type DeepResearchSectionLengthPlan} from './deepResearchSectionLength';
import { deepResearchNarrativeRules, MAX_COVERAGE_QUESTIONS, type DeepResearchPlan, type DeepResearchPlanSection, type CitationClaim, type CitationVerdict, type CoherenceIssue, type FinalizeInput, type FinalizeResult, type PlanInput, type PlanCoverageAuditInput, type ReportEditorialReview, type SectionInput, type SectionClaimAudit, type DeepResearchProofRole, type SectionEvidencePlan, type SectionRevisionInput } from '../electron/ai/deepResearchCore';
import type {DeepResearchApproach} from './deepResearchApproaches';
import type {CallOpts} from '../electron/ai/aiClient';
export interface AcademicApproachContext {
 approach:DeepResearchApproach;
 rules:{planner:string[];writer:string[];finalizer:string[]};
 retrieval:{probes:string[];comparands:string[];axes:string[];phases:string[]};
 relationships:Array<{from:string;relation:string;to:string;confidence:number}>;
}
export interface DeepResearchCompletionHost {
 currentResearchHarness?:()=>unknown;
 documentaryEvidence:boolean;
 completeJson<T>(opts:CallOpts,guard:(v:unknown)=>v is T,model?:ModelRef|null):Promise<T>;
 completeText(opts:CallOpts,model?:ModelRef|null):Promise<string>;
}
/** Canonical provider-independent academic stages. Desktop and mobile run the
 * same prompts, response guards, citation judge and bounded continuations. */
export function portableDeepResearchAI(host:DeepResearchCompletionHost) {
const {completeJson,completeText}=host;
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


/** How many claims are judged per call. Small enough that the judge reads each one. */
const VERIFY_BATCH = 12;

/**
 * Exposed for `scripts/verify-citation-judge.mjs`, which feeds the judge deliberately
 * false citations to check it rejects them. A verifier nobody audits can quietly
 * approve everything and still look like it is working.
 */


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
async function aiVerifyCitations(
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
    documentaryEvidence: host.documentaryEvidence,
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
  relationships: AcademicApproachContext["relationships"],
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
  // The harness owns research supervision and its final source-bound review.
  if (host.currentResearchHarness?.()) return draft;
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
    documentaryEvidence: host.documentaryEvidence,
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
    documentaryEvidence: host.documentaryEvidence,
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
    documentaryEvidence: host.documentaryEvidence,
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
    documentaryEvidence: host.documentaryEvidence,
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
    documentaryEvidence: host.documentaryEvidence,
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

return {aiReviewReport,aiCheckCoherence,aiDecomposeObjective,aiVerifyCitations,aiReviseSection,aiJudgeSectionRevision,aiAuditPlanCoverage,aiPlanReport,aiAuditSectionClaims,aiPlanSectionEvidence,aiWriteSection,aiFinalize,aiAuditFinalSummary};
}
