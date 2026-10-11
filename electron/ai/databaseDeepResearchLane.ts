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
} from '@shared/deepResearchSectionLength';
import {
  processDatabaseResearchRun,
  type DatabaseResearchAgentDeps,
} from './databaseDeepResearch';
import {
  isDatabaseDeepResearchPlannerOutput,
  isDatabaseDeepResearchCriticOutput,
  isDatabaseDeepResearchVerifierOutput,
  isDatabaseDeepResearchNarrativeOutput,
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

export {researchColumnAliases,compactEvidence} from '@shared/databaseResearchCompletion';
import {databaseResearchCompletionInput} from '@shared/databaseResearchCompletion';

function agentCompletion(): NonNullable<DatabaseResearchAgentDeps['complete']> {
  return async ({ role, objective, evidence, model, reportType, language, columnTypes, modelContext, narrativeDraft, sectionLength }) => {
    if (!model) throw new Error('Selecciona un modelo para Deep Research antes de iniciar la investigación.');
    if (model.provider === 'codex') await assertChatGptSubscriptionConnected();
    const call=databaseResearchCompletionInput({role,objective,evidence,model,reportType,language,columnTypes,modelContext,narrativeDraft,sectionLength});
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
