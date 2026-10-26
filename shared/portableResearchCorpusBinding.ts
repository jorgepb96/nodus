import type {ModelRef} from './types';
import type {DeepResearchDeps} from '../electron/ai/deepResearchCore';
import type {ResearchCorpusRun} from '../electron/ai/researchCorpusRun';
import type {createResearchProseAuditor,findResearchConflicts} from '../electron/ai/researchClaimAudit';
import type {createResearchSectionCoverage} from '../electron/ai/researchSectionCoverage';
import {describeResearchLimitation} from './researchCorpus';
export type PreparedResearchRun=Pick<ResearchCorpusRun,'harness'|'web'|'syncWebEvidence'|'checkpoint'|'matchedDocuments'|'supervised'|'budget'|'evidence'|'limitations'|'validate'|'retrieve'|'investigate'|'snapshotFromEvidence'|'section'|'coverage'>;
export interface PreparedResearchCorpusHost {
 researchHarnessStage?<T>(name:string,input:unknown,body:()=>Promise<T>):Promise<T>;
 createResearchProseAuditor:typeof createResearchProseAuditor;
 createResearchSectionCoverage:typeof createResearchSectionCoverage;
 findResearchConflicts:typeof findResearchConflicts;
 withResearchValidationThinking<T>(model:ModelRef|null|undefined,work:()=>Promise<T>):Promise<T>;
 contextWindow(model:ModelRef):Promise<{tokens:number;known:boolean}>;
 withResearchRequestBudget<T>(tokens:number,onPartial:()=>void,work:()=>Promise<T>):Promise<T>;
}
/** Canonical scoped evidence, audit, coverage and budget binding. Repositories,
 * models and prepared-source traversal remain explicit host responsibilities. */
export function bindPreparedResearchCorpus(deps:DeepResearchDeps,run:PreparedResearchRun,model:ModelRef|null|undefined,host:PreparedResearchCorpusHost,signal?:AbortSignal):DeepResearchDeps {
 const {createResearchProseAuditor,createResearchSectionCoverage,findResearchConflicts,withResearchValidationThinking,contextWindow,withResearchRequestBudget,researchHarnessStage=(_name,_input,body)=>body()}=host;
 const settings=run.budget.settings;
  let windowPromise: ReturnType<PreparedResearchCorpusHost['contextWindow']> | undefined;
  // One auditor per report: a proposition rejected in any part stays rejected in
  // every later section, summary, limitation and next step.
  const auditor = createResearchProseAuditor(model, signal);
  const coverage = createResearchSectionCoverage(model, signal);
  const auditProse = async (markdown: string) => {
    const sources = () => [...run.evidence.values()].map(item => ({ id: item.id, text: item.summary ?? '', label: item.label, citation: item.citation }));
    const expand = run.budget.settings.autoExpand && run.budget.rounds < run.budget.settings.rounds;
    const initialSources = sources();
    let audit = await auditor.audit(markdown, initialSources, !expand);
    const missing = expand ? audit.claims.find(claim => claim.status === 'removed') : undefined;
    if (missing) {
      await run.retrieve(missing.sentence.slice(0, 1000), 1);
      const expandedSources = sources();
      // An empty retrieval does not change the judge's input. Keep its completed
      // verdicts rather than buying an identical audit that can fail or disagree.
      if (JSON.stringify(expandedSources) === JSON.stringify(initialSources)) auditor.remember(audit);
      else audit = await auditor.audit(markdown, expandedSources);
    } else if (expand) auditor.remember(audit);
    run.validate();
    return { ...audit, passages: [...run.evidence.values()] };
  };
  const bounded: DeepResearchDeps = { ...deps, repairSectionCoverage: coverage.repair, checkSectionCoverage: coverage.check, strictDocumentaryGrounding: true, auditFactualProse: markdown => withResearchValidationThinking(model, () => auditProse(markdown)),
    auditSectionClaims: deps.auditSectionClaims ? (...args) => withResearchValidationThinking(model, () => deps.auditSectionClaims!(...args)) : undefined,
    auditFinalSummary: deps.auditFinalSummary ? (...args) => withResearchValidationThinking(model, () => deps.auditFinalSummary!(...args)) : undefined,
    judgeSectionRevision: deps.judgeSectionRevision ? (...args) => withResearchValidationThinking(model, () => deps.judgeSectionRevision!(...args)) : undefined,
    verifyCitations: deps.verifyCitations ? (...args) => withResearchValidationThinking(model, () => deps.verifyCitations!(...args)) : undefined,
    checkCoherence: deps.checkCoherence ? (...args) => withResearchValidationThinking(model, () => deps.checkCoherence!(...args)) : undefined,
    auditReportConsistency: statements => withResearchValidationThinking(model, () => findResearchConflicts(statements, model, signal)), buildSnapshot: async brief => {
    if (run.harness) run.budget.phaseRoundLimit = Math.min(settings.rounds, run.budget.rounds + Math.max(1, Math.floor(settings.rounds / 3)));
    try { await run.investigate(brief.objective, model); }
    finally { run.budget.phaseRoundLimit = Infinity; }
    if (run.web) {
      await run.web.afterLibrary({ evidence: run.evidence.size, matched: run.matchedDocuments.size, supervised: run.supervised, titles: [] });
      run.syncWebEvidence();
      run.checkpoint();
    }

    const snapshot = run.snapshotFromEvidence(brief);
    if (!deps.prepareScopedSnapshot) return snapshot;
    const result = await deps.prepareScopedSnapshot(snapshot, async queries => {
      run.validate();
      const available = Math.max(0, Math.min(3, settings.rounds - run.budget.rounds - 1));
      for (const query of queries.slice(0, available)) await run.retrieve(query);
      if (queries.length > available) run.budget.partial = true;
      return run.snapshotFromEvidence(brief);
    });
    run.validate();
    return result;
  }, retrieveForSection: async input => {
    await run.investigate([input.objective, input.sectionTitle, input.purpose, ...input.keyClaims].join('\n'), model);
    return run.section(input, false);
  }, researchTraversal: async () => run.coverage(),
    // Basic searchable documents are independent from optional enriched analyses.
    preparePlanEvidence: undefined,
    finalize: input => deps.finalize({ ...input, supportConcerns: [...(input.supportConcerns ?? []),
      ...(run.budget.partial ? ['Documentary coverage is partial; do not infer absence from missing evidence.'] : []), ...[...run.limitations].map(describeResearchLimitation)] }) };
  if (run.harness) {
    bounded.continuousNarrative = true;
    // Keep deterministic citation/source guards; let the evidence-informed
    // writer own synthesis. Post-hoc entailment pruning removed antecedents and
    // qualified interpretations, breaking the report's connected argument.
    // The harness adds no mandatory model-review or automatic rewrite chain.
    bounded.verifyCitations = undefined;
    bounded.reviseSection = undefined;
    bounded.auditFactualProse = undefined;
    bounded.auditReportConsistency = undefined;
    bounded.auditSectionClaims = undefined;
    bounded.auditPlanCoverage = undefined;
    bounded.auditFinalSummary = undefined;
    bounded.judgeSectionRevision = undefined;
    bounded.reviewReport = undefined;
    bounded.checkCoherence = undefined;
    bounded.repairSectionCoverage = undefined;
    bounded.checkSectionCoverage = undefined;
  }
  return new Proxy(bounded, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== 'function') return value;
    return async (...args: unknown[]) => {
      run.validate();
      const window = await (windowPromise ??= model ? contextWindow(model) : Promise.resolve({ tokens: 32768, known: false }));
      // Reserve three quarters for instructions, planning/history, tool framing
      // and output; every actual completion checks its complete final envelope using
      // the same byte-as-token bound. No characters/token conversion applies here.
      run.budget.constrainToWindow(window.tokens, Math.ceil(window.tokens * 0.75));
      const execute = () => withResearchRequestBudget(window.tokens, () => { run.budget.partial = true; }, () => value(...args));
      const result = await (run.harness && !['researchTraversal', 'auditFactualProse', 'auditReportConsistency', 'finalDocumentReview'].includes(String(property))
        ? researchHarnessStage(`deep.${String(property)}`, args, execute) : execute());
      if (run.harness && property === 'decomposeObjective' && Array.isArray(result)) for (const question of result) if (typeof question === 'string') run.harness.agenda.addQuestion(question);
      run.validate(); return result;
    };
  } });
}
