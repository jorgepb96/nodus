import { withJobThinkingEffort } from './thinkingEffort';
import { BrowserWindow } from 'electron';
import type {
  DatabaseDeepResearchJob,
  DatabaseDeepResearchJobInput,
  DatabaseResearchProgress,
} from '@shared/databaseDeepResearch';
import type { ModelRef } from '@shared/types';
import {
  estimateDatabaseDeepResearchCost,
  getDatabaseDeepResearchEligibility,
  normalizeDatabaseDeepResearchJobInput,
  normalizeDatabaseDeepResearchReportType,
  autoConfigureDatabaseDeepResearch,
  type DatabaseDeepResearchAutoConfiguration,
} from '@shared/databaseDeepResearch';
import { withVaultDatabase } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import * as dbMode from '../db/databasesRepo';
import * as repo from '../db/databaseDeepResearchRepo';
import { getDatabaseProfile } from './databaseAnalysis';
import { getVault } from '../vaults/vaultRegistry';
import { assertChatGptSubscriptionConnected } from './codexSubscription';
import { completeJson } from './aiClient';
import {
  normalizeDeepResearchSectionLength,
  planDeepResearchSectionLength,
  type DeepResearchSectionLength,
} from '@shared/deepResearchSectionLength';
import {
  processDatabaseResearchRun,
  type DatabaseResearchAgentDeps,
  type DatabaseResearchEvidence,
} from './databaseDeepResearch';
import {
  buildDatabaseDeepResearchPrompt,
  isDatabaseDeepResearchPlannerOutput,
  isDatabaseDeepResearchCriticOutput,
  isDatabaseDeepResearchVerifierOutput,
  isDatabaseDeepResearchNarrativeOutput,
  type DatabaseDeepResearchPromptRole,
} from '@shared/databaseDeepResearchPrompts';

/** One expensive database investigation per vault. Different vaults may proceed
 * independently, while every run in one vault is strictly FIFO. */
const drainingVaults = new Set<string>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function broadcastProgress(progress: DatabaseResearchProgress): void {
  broadcast('db:deepResearch:progress', progress);
}

const AGGREGATE_STRUCTURAL_KEYS = new Set([
  'n', 'total', 'missing', 'observed', 'rate', 'effect', 'estimate', 'statistic',
  'chi2', 'dof', 'cramersV', 'expected', 'counts', 'rowLevels', 'columnLevels',
  'p', 'pValue', 'qValue', 'confidenceInterval', 'interval', 'low', 'high',
  'mean', 'median', 'mad', 'variance', 'standardError', 'coefficient', 'coefficients',
  'min', 'max', 'sum', 'q1', 'q3', 'iqr', 'stdev', 'cv', 'skewness', 'kurtosis', 'mode', 'value', 'count', 'ci',
  'hazardRatio', 'hazardRatios', 'survival', 'time', 'atRisk', 'events', 'censored',
  'points', 'sourceIndexes', 'timestamps', 'droppedMissing', 'warnings', 'columns',
  'columnIds', 'inputs', 'output', 'seed', 'iterations', 'components', 'eigenvalues',
  'explainedVariance', 'scores', 'nodes', 'degree', 'betweenness', 'tests', 'alpha',
  'familySize', 'bhRejected', 'holmRejected', 'adjusted', 'rejected', 'groups',
  'intervalMethod',
  'nodeCount', 'componentSizes', 'externalTargetCount', 'orphanTargetCount',
  'duplicateRows', 'distinct', 'duplicateValues', 'invalidNumeric', 'missingRate',
  'invalid', 'unavailable', 'bytes', 'uniqueHashes', 'mimeTypes', 'dependencies',
  'unknownDependencies', 'errors', 'cycles', 'reconciliation', 'checked', 'reconciled',
  'divergent', 'tolerance', 'overlap', 'balanceBefore', 'balanceAfter', 'weights',
  'trend', 'seasonality', 'drift', 'rollingOrigin', 'folds', 'mae', 'rmse',
  'slopePerDay', 'intercept', 'rSquared', 'period', 'strength', 'profile',
  'beforeMean', 'afterMean', 'difference', 'standardizedDifference',
  'cadenceMedianMs', 'cadenceCv', 'changePoints', 'lags', 'acf', 'languageCounts',
  'tfidf', 'cooccurrence', 'nearDuplicates', 'distances', 'outliers',
]);

function redactAggregateValue(value: unknown, _sensitive: boolean, depth = 0): unknown {
  // Every string in an aggregate is untrusted cell-derived data. This is
  // intentionally independent of the column type: a select label, relation
  // node id, formula error or attachment name can carry prompt injection or
  // personal data just as easily as a text cell. Numeric/boolean aggregates
  // remain available to the model for interpretation.
  if (depth > 8 || value == null) return value == null ? value : '[redacted]';
  if (typeof value === 'string') return '[redacted]';
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactAggregateValue(item, false, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item], index) => [
    AGGREGATE_STRUCTURAL_KEYS.has(key) ? key : `field_${index + 1}`,
    redactAggregateValue(item, false, depth + 1),
  ]));
}

export function researchColumnAliases(evidence: DatabaseResearchEvidence[], columnTypes: Record<string, string> = {}): Map<string, string> {
  const ids = new Set([...Object.keys(columnTypes), ...evidence.flatMap(item => item.columnIds)]);
  return new Map([...ids].map((id, index) => [id, `column_${index + 1}`]));
}

export function compactEvidence(evidence: DatabaseResearchEvidence[], columnTypes: Record<string, string> = {}): string {
  const aliases = researchColumnAliases(evidence, columnTypes);
  const items = evidence.map((item, index) => ({
    // Expose only the cryptographic reference needed to cite an artifact. Step
    // and column ids can be user-controlled/cell-derived, so replace them with
    // positional aliases that cannot be used to exfiltrate source values.
    artifactId: `artifact_${index + 1}`,
    artifactRef: item.hash,
    method: item.operation,
    columns: item.columnIds.map(id => aliases.get(id)),
    n: item.n,
    hash: item.hash,
    output: redactAggregateValue(item.value, false),
  }));
  const serialized = JSON.stringify(items);
  // Provider context is bounded without ever substituting raw rows. Truncation is
  // explicit so a model cannot assume it reviewed unseen artifacts.
  return serialized.length <= 120_000
    ? serialized
    : `${serialized.slice(0, 120_000)}\n[ARTIFACT_LEDGER_TRUNCATED_FOR_MODEL]`;
}

function rolePrompt(
  role: Parameters<NonNullable<DatabaseResearchAgentDeps['complete']>>[0]['role'],
  reportType = 'general',
  language: string | null = 'es',
  objective = '',
  context = '',
  sectionLength: DeepResearchSectionLength = 'auto',
) {
  const promptRole: DatabaseDeepResearchPromptRole =
    role === 'synthesizer' ? 'writer' : role;
  return buildDatabaseDeepResearchPrompt({
    role: promptRole,
    reportType: reportType as never,
    language: (language ?? 'es') as never,
    objective,
    context,
    sectionLength,
  });
}

function agentCompletion(): NonNullable<DatabaseResearchAgentDeps['complete']> {
  return async ({ role, objective, evidence, model, reportType, language, columnTypes, modelContext, narrativeDraft, sectionLength }) => {
    if (!model) throw new Error('Selecciona un modelo para Deep Research antes de iniciar la investigación.');
    if (model.provider === 'codex') await assertChatGptSubscriptionConnected();
    const columnAliases = researchColumnAliases(evidence, columnTypes);
    const schemaContext = modelContext ? JSON.stringify({
      schema: modelContext.schema.map(source => ({ ...source,
        columns: source.columns.map(column => ({ ...column, artifactAlias: columnAliases.get(column.id) })),
      })),
      semanticRoles: modelContext.semanticRoles,
      rowCounts: modelContext.rowCounts,
      allowedOperations: modelContext.allowedOperations,
      requestedOutline: modelContext.requestedOutline ?? [],
    }) : '';
    const prompt = rolePrompt(
      role,
      reportType,
      language,
      objective,
      [
        schemaContext ? `SCHEMA_CONTEXT\n${schemaContext}` : '',
        `APPROVED_ARTIFACTS\n${compactEvidence(evidence, columnTypes)}`,
        role === 'editor' && narrativeDraft ? `VALIDATED_DRAFT_AST\n${JSON.stringify(narrativeDraft)}` : '',
      ].filter(Boolean).join('\n\n'),
      normalizeDeepResearchSectionLength(sectionLength),
    );
    const lengthPlan = planDeepResearchSectionLength(sectionLength);
    const call = {
      system: prompt.system,
      user: prompt.user,
      temperature: role === 'synthesizer' ? 0.2 : 0,
      // The prose roles may need a wider window for a longer narrative AST, but
      // stay inside the shared per-pass cap the cost reservation is computed from.
      maxTokens: role === 'synthesizer' || role === 'writer' || role === 'editor'
        ? Math.max(5_200, lengthPlan.targetWords === null ? 5_200 : lengthPlan.maxTokensPerPass)
        : 1_800,
      reasoning: 'off' as const,
      plainContext: true,
      noRetry: true,
    };
    // Keep each type predicate in its own branch: TypeScript cannot safely
    // infer a union of predicates as one completeJson<T> guard.
    const structured = role === 'planner'
      ? await completeJson(call, isDatabaseDeepResearchPlannerOutput, model as ModelRef)
      : role === 'critic'
        ? await completeJson(call, isDatabaseDeepResearchCriticOutput, model as ModelRef)
        : role === 'verifier'
          ? await completeJson(call, isDatabaseDeepResearchVerifierOutput, model as ModelRef)
          : await completeJson(call, isDatabaseDeepResearchNarrativeOutput, model as ModelRef);
    return JSON.stringify(structured);
  };
}

function validateSources(input: DatabaseDeepResearchJobInput): void {
  const allColumns = new Set<string>();
  const columnSources = new Map<string, string>();
  const columnTypes = new Map<string, string>();
  const allViews = new Set<string>();
  const selectedViewsPerDatabase = new Map<string, number>();
  for (const databaseId of input.databaseIds) {
    if (!dbMode.getDatabase(databaseId)) throw new Error(`Base de datos no encontrada: ${databaseId}`);
    for (const column of dbMode.getColumns(databaseId)) { allColumns.add(column.id); columnSources.set(column.id, databaseId); columnTypes.set(column.id, String(column.type ?? '')); }
    for (const view of dbMode.listViews(databaseId)) {
      allViews.add(view.id);
      if (input.viewIds.includes(view.id)) selectedViewsPerDatabase.set(databaseId, (selectedViewsPerDatabase.get(databaseId) ?? 0) + 1);
    }
  }
  for (const [databaseId, count] of selectedViewsPerDatabase) if (count > 1) throw new Error(`Selecciona como máximo una vista por base de datos (${databaseId}).`);
  for (const viewId of input.viewIds) if (!allViews.has(viewId)) throw new Error(`La vista ${viewId} no pertenece a las bases seleccionadas.`);
  for (const columnId of input.filters.columnIds) if (!allColumns.has(columnId)) throw new Error(`La columna de filtro ${columnId} no pertenece a las bases seleccionadas.`);
  for (const [role, ids] of Object.entries(input.roles)) {
    for (const columnId of Array.isArray(ids) ? ids : ids ? [ids] : []) {
      if (!allColumns.has(columnId)) throw new Error(`La columna ${columnId} del rol ${role} no pertenece a las bases seleccionadas.`);
    }
  }
  const sameSource = (label: string, ids: Array<string | undefined>) => {
    const sources = new Set(ids.filter((id): id is string => Boolean(id)).map((id) => columnSources.get(id)));
    if (sources.size > 1) throw new Error(`Los roles de ${label} deben pertenecer a la misma base de datos.`);
  };
  if (input.reportType === 'survival_retention')
    sameSource('supervivencia', [input.roles.duration, input.roles.event, input.roles.group, ...(input.roles.confounders ?? [])]);
  if (input.reportType === 'causal_impact')
    sameSource('causalidad', [input.roles.treatment, input.roles.outcome, ...(input.roles.confounders ?? [])]);
  if (input.reportType === 'temporal_anomalies')
    sameSource('tiempo', [input.roles.time, input.roles.outcome]);

  const eligibility = getDatabaseDeepResearchEligibility(input.reportType, {
    columns: [...columnTypes.entries()].map(([id, type]) => ({ id, type })),
    roles: input.roles,
    databaseCount: input.databaseIds.length,
  });
  if (!eligibility.applicable) {
    throw new Error(`El tipo de informe ${eligibility.reportType} no es aplicable: ${eligibility.reasons.join(' ')}`);
  }
  const typeOf = (id: string | undefined) => id ? columnTypes.get(id) ?? '' : '';
  const numeric = new Set(['number', 'formula', 'rollup']);
  const binary = new Set(['number', 'formula', 'rollup', 'checkbox']);
  const categorical = new Set(['select', 'status', 'multi_select', 'checkbox', 'person', 'created_by', 'last_edited_by']);
  const temporal = new Set(['date', 'time', 'created_time', 'last_edited_time']);
  const requireColumnType = (id: string | undefined, allowed: Set<string>, label: string) => {
    if (!id || !allowed.has(typeOf(id))) throw new Error(`El rol ${label} debe apuntar a una columna compatible.`);
  };
  switch (input.reportType ?? 'general') {
    case 'cohort_comparison':
      requireColumnType(input.roles.group, categorical, 'grupo');
      for (const id of input.roles.metrics ?? []) requireColumnType(id, numeric, 'métrica');
      break;
    case 'temporal_anomalies':
      requireColumnType(input.roles.time, temporal, 'temporal');
      for (const id of input.roles.metrics ?? []) requireColumnType(id, numeric, 'métrica');
      break;
    case 'causal_impact':
      requireColumnType(input.roles.outcome, numeric, 'resultado');
      requireColumnType(input.roles.treatment, binary, 'tratamiento binario');
      for (const id of input.roles.confounders ?? []) requireColumnType(id, numeric, 'confusor');
      break;
    case 'survival_retention':
      requireColumnType(input.roles.duration, new Set(['number', 'formula', 'rollup', 'date', 'time', 'created_time', 'last_edited_time']), 'duración');
      requireColumnType(input.roles.event, binary, 'evento binario');
      if (input.roles.group) requireColumnType(input.roles.group, new Set(['checkbox']), 'grupo binario de log-rank');
      break;
    default:
      break;
  }
}

async function drainVault(vaultId: string): Promise<void> {
  if (drainingVaults.has(vaultId)) return;
  drainingVaults.add(vaultId);
  try {
    await withVaultDatabase(vaultId, async () => {
      // A previous process may have died while a run was marked running. The
      // processor verifies its snapshot provenance before continuing.
      const candidates = [
        ...repo.listDatabaseResearchRuns({ status: 'running', limit: 500 }),
        ...repo.listDatabaseResearchRuns({ status: 'queued', limit: 500 }),
        ...repo.listDatabaseResearchRuns({
          status: 'stale',
          limit: 500,
        }).filter((run) => !/fuentes cambiaron desde el snapshot persistido/i.test(run.error ?? '')),
      ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const run of candidates) {
        const current = repo.getDatabaseResearchRun(run.id);
        if (!current || current.status === 'cancelled' || current.status === 'completed') continue;
        try {
          const progress = repo.startDatabaseResearchRun(run.id);
          broadcastProgress(progress);
          // The thinking level chosen in the form applies to every call the run makes to its model.
          await withJobThinkingEffort(current.options.thinkingEffort, current.model as ModelRef | null, () => processDatabaseResearchRun(run.id, {
            complete: agentCompletion(),
            onProgress: broadcastProgress,
          }));
        } catch {
          // processDatabaseResearchRun persists the failure. A failed run never
          // prevents later queued work from draining.
        }
        const detail = repo.getDatabaseResearchRunDetail(run.id);
        if (detail) {
          broadcastProgress({
            runId: run.id,
            status: detail.run.status,
            progress: detail.run.progress,
            step: detail.run.currentStep,
            phase: detail.run.phase,
            message: detail.run.error,
            error: detail.run.error,
          });
        }
      }
    });
  } finally {
    drainingVaults.delete(vaultId);
  }
}

export async function enqueueDatabaseDeepResearch(
  vaultId: string,
  rawInput: DatabaseDeepResearchJobInput,
  mobile: {bridgeJobId?:string;requireExisting?:boolean} = {},
): Promise<DatabaseDeepResearchJob> {
  const vault = getVault(vaultId);
  if (!vault || vault.type !== 'databases') throw new Error('Deep Research de datos sólo está disponible en un vault de bases de datos.');
  const run = await withVaultDatabase(vaultId, () => {
    if(mobile.bridgeJobId) {
      const existing=repo.findMobileDatabaseResearchRun(mobile.bridgeJobId);if(existing) return existing;
      if(mobile.requireExisting) throw new Error('mobile_database_research_run_unavailable');
    }
    const normalized = normalizeDatabaseDeepResearchJobInput(rawInput);
    const schemaColumns = normalized.databaseIds.flatMap((databaseId) => {
      const profile = getDatabaseProfile(databaseId)?.profile;
      const profiles = new Map((profile?.columns ?? []).map((item) => [item.columnId, item]));
      return dbMode.getColumns(databaseId).map((column) => ({ databaseId, id: column.id, type: column.type, name: column.name, config: column.config, profile: profiles.get(column.id) }));
    });
    const requested = normalized.requestedReportType ?? normalized.reportType ?? 'general';
    const autoConfiguration: DatabaseDeepResearchAutoConfiguration = normalized.autoConfigure
      ? autoConfigureDatabaseDeepResearch(requested, { columns: schemaColumns, roles: normalized.roles, databaseCount: normalized.databaseIds.length, objective: normalized.objective }, normalized.roles)
      : { requestedReportType: requested, reportType: normalizeDatabaseDeepResearchReportType(normalized.reportType), roles: normalized.roles, confidence: 1, warnings: [], limitations: [], partial: false };
    const configured = { ...normalized, reportType: autoConfiguration.reportType, roles: autoConfiguration.roles, autoConfiguration };
    validateSources(configured);
    const selectedModel = configured.model ?? getSettings().deepResearchModel ?? null;
    if (!selectedModel) throw new Error('Selecciona un modelo para Deep Research antes de iniciar la investigación.');
    const input = { ...configured, model: selectedModel };
    const rowCount = input.databaseIds.reduce((sum, databaseId) => sum + (dbMode.getDatabase(databaseId)?.rowCount ?? 0), 0);
    const estimate = estimateDatabaseDeepResearchCost(rowCount, input.databaseIds.length, input.depth);
    const maxCostUsd = input.budget?.maxCostUsd;
    if (maxCostUsd != null && estimate.estimatedCostUsd > maxCostUsd) {
      throw new Error(`El coste estimado ($${estimate.estimatedCostUsd.toFixed(2)}) supera el límite configurado ($${maxCostUsd.toFixed(2)}).`);
    }
    const create = () => {
      const run = repo.createDatabaseResearchRun({
        databaseId: input.databaseIds[0],
        objective: input.objective,
        title: input.objective.slice(0, 120),
        language: input.language,
        model: selectedModel,
        options: {
          ...input,
          // Normalized at the durable boundary: whatever the renderer, MCP or the
          // Server sent, the stored run carries a value the writer can trust.
          sectionLength: normalizeDeepResearchSectionLength(input.sectionLength),
          budget: {
            maxRows: input.budget?.maxRows,
            maxSteps: input.budget?.maxTasks,
            maxBootstrapIterations: input.budget?.resamples,
            maxPermutationIterations: input.budget?.resamples,
            rounds: input.budget?.rounds,
            depth: input.depth,
            seed: input.budget?.seed,
            maxCostUsd,
            estimatedCostUsd: estimate.estimatedCostUsd,
          },
        },
      });
      if(mobile.bridgeJobId) repo.rememberMobileDatabaseResearchRun(mobile.bridgeJobId,run.id);
      return run;
    };
    return mobile.bridgeJobId ? repo.mobileDatabaseResearchTransaction(create) : create();
  });
  void drainVault(vaultId);
  return repo.databaseResearchJob(run);
}

/** Resume persisted work on first access/startup without blocking IPC or MCP. */
export function ensureDatabaseDeepResearchLane(vaultId: string): void {
  void drainVault(vaultId);
}

export function __resetDatabaseDeepResearchLaneForTest(): void {
  drainingVaults.clear();
}
