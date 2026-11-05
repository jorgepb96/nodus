import {validateDatabaseResearchSources} from '@shared/databaseResearchSourceValidation';
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
  validateDatabaseResearchSources(input,input.databaseIds.flatMap(id=>dbMode.getDatabase(id)?[{id,columns:dbMode.getColumns(id),views:dbMode.listViews(id)}]:[]));
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
