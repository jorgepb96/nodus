/** Shared deterministic calculations and verified narrative pipeline.
 * Provider completions receive approved artifacts and schema; storage and raw data
 * never become model operations. Desktop supplies its existing SQLite/worker host. */
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {
  getDatabaseDeepResearchAnalysisRequirements,
  sanitizeDatabaseResearchExternal,
  type DatabaseDeepResearchReportType,
  type DatabaseResearchModelContext,
  type DatabaseResearchProgress,
  type DatabaseResearchStepKind,
} from "@shared/databaseDeepResearch";
import type { DatabaseColumn, DatabaseRow } from "@shared/databases";
import {
  acf,
  benjaminiHochberg,
  bcaBootstrap,
  categoryValues,
  categoryValuesMulti,
  correlationMatrix,
  describe,
  effectSizes,
  frequencies,
  groupBy,
  hashSnapshot,
  linearRegression,
  logisticRegression,
  missingness,
  numericValues,
  pca,
  permutationTest,
  robustSummary,
  SeededRandom,
  trimmedMean,
  vif,
  kaplanMeier,
  logRank,
  coxPH,
  inverseProbabilityWeighting,
  detectSimpsonParadox,
  relationGraphDiagnostics,
  holmCorrection,
  welchTTest,
  mannWhitneyU,
  kruskalWallis,
  cohortComparison,
  chiSquare,
  contingencyTable,
  auditText,
  auditGeo,
  detectIndexedChangePoints,
  dateValues,
} from "@shared/stats";
import { formulaDependencies } from "@shared/databaseFormula";
import {
  normalizeDeepResearchSectionLength,
  type DeepResearchSectionLength,
} from "@shared/deepResearchSectionLength";
import { comparisonMajorityValue } from "@shared/databaseComparison";
import {
  isDatabaseDeepResearchCriticOutput,
  isDatabaseDeepResearchVerifierOutput,
  DATABASE_DEEP_RESEARCH_PROMPT_VERSION,
  DATABASE_DEEP_RESEARCH_REPORT_COPY,
  DATABASE_DEEP_RESEARCH_SECTION_LABELS,
} from "@shared/databaseDeepResearchPrompts";

export function sha256Snapshot(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
  if (canonical === undefined) throw new Error("Snapshot must be JSON serializable.");
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

export const DATABASE_RESEARCH_PHASES = [
  "snapshot",
  "semantic_profile",
  "planning",
  "calculations",
  "sensitivity",
  "adversarial_review",
  "verification",
  "assembly",
] as const;
export type DatabaseResearchPhase = (typeof DATABASE_RESEARCH_PHASES)[number];
export const DATABASE_RESEARCH_OPERATIONS = [
  "describe",
  "robustSummary",
  "trimmedMean",
  "frequencies",
  "missingness",
  "correlation",
  "linearRegression",
  "logisticRegression",
  "groupBy",
  "bootstrap",
  "permutation",
  "multipleTesting",
  "effectSizes",
  "vif",
  "pca",
  "changePoints",
  "acf",
  "temporalAudit",
  "welchT",
  "mannWhitney",
  "kruskalWallis",
  "kaplanMeier",
  "logRank",
  "coxPH",
  "ipw",
  "simpson",
  "relationGraph",
  "cohortComparison",
  "chiSquare",
  "qualityAudit",
  "textAudit",
  "geoAudit",
  "attachmentAudit",
  "formulaAudit",
  "relationIntegrity",
] as const;
export type DatabaseResearchOperation =
  (typeof DATABASE_RESEARCH_OPERATIONS)[number];
export const DATABASE_RESEARCH_OPERATION_ROLES: Record<
  DatabaseResearchOperation,
  "deterministic" | "model-prose"
> = Object.fromEntries(
  DATABASE_RESEARCH_OPERATIONS.map((operation) => [operation, "deterministic"]),
) as Record<DatabaseResearchOperation, "deterministic" | "model-prose">;
const DETERMINISTIC_SENSITIVITY_OPERATIONS = new Set<DatabaseResearchOperation>([
  "bootstrap", "permutation", "welchT", "mannWhitney", "kruskalWallis", "multipleTesting",
]);

export interface DatabaseResearchStep {
  id?: string;
  operation: DatabaseResearchOperation | string;
  columnId?: string;
  xColumnId?: string;
  yColumnId?: string;
  groupColumnId?: string;
  /** Required for temporal operations; keeps the source row lineage. */
  timeColumnId?: string;
  columns?: string[];
  options?: Record<string, unknown>;
  /** Required gate for sensitive estimands. */
  role?: "descriptive" | "associational" | "survival" | "causal" | "graph";
}
export interface DatabaseResearchPlan {
  steps: DatabaseResearchStep[];
}
export interface DatabaseResearchBudget {
  rounds?: number;
  maxRows?: number;
  maxSteps?: number;
  maxBootstrapIterations?: number;
  maxPermutationIterations?: number;
}
export interface DatabaseDeepResearchRequest {
  databaseId: string;
  objective: string;
  plan: DatabaseResearchPlan;
  filters?: { query: string; columnIds: string[] };
  seed?: number | string;
  budget?: DatabaseResearchBudget;
}
export interface DatabaseResearchSnapshot {
  databaseId: string;
  databaseName: string;
  revision: number;
  rowCount: number;
  totalRowCount: number;
  truncated: boolean;
  columns: string[];
  rows: DatabaseRow[];
  relationEdges: Array<{
    source: string;
    target: string;
    columnId: string;
    targetExists: boolean;
    targetInScope: boolean;
  }>;
  capturedAt: string;
  hash: string;
}
export interface DatabaseResearchEvidence {
  stepId: string;
  operation: DatabaseResearchOperation;
  columnIds: string[];
  value: unknown;
  n: number;
  denominator?: number;
  hash: string;
}
export interface DatabaseResearchClaim {
  id?: string;
  stepId: string;
  path: string;
  expected: number | boolean | string;
  tolerance?: number;
}
export interface DatabaseResearchClaimResult extends DatabaseResearchClaim {
  verified: boolean;
  actual: unknown;
  reason: string;
}
export interface DatabaseDeepResearchResult {
  request: DatabaseDeepResearchRequest;
  snapshot: DatabaseResearchSnapshot;
  evidence: DatabaseResearchEvidence[];
  claims: DatabaseResearchClaimResult[];
  phaseLog: Array<{
    phase: DatabaseResearchPhase;
    startedAt: string;
    finishedAt: string;
  }>;
  warnings: string[];
  hash: string;
}

export interface DatabaseDeepResearchDeps {
  now?: () => string;
  readSnapshot?: (
    databaseId: string,
    maxRows: number,
  ) => DatabaseResearchSnapshot;
  readColumns?: (databaseId: string) => DatabaseColumn[];
  /** Cooperative cancellation/yield boundary for the Electron worker lane. */
  isCancelled?: () => boolean;
  onStep?: (completed: number, total: number) => void;
  /** Host-created 0600 payload. Models and clients can never supply this path. */
  snapshotPayloadPath?: string;
}
export interface DatabaseResearchScope {
  viewId?: string | null;
  query?: string;
  columnIds?: string[];
}

function nowIso(deps?: DatabaseDeepResearchDeps): string {
  return (deps?.now ?? (() => new Date().toISOString()))();
}
function finiteOptions(
  options: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
  max: number,
): number {
  const n = Number(options?.[key] ?? fallback);
  return Number.isFinite(n)
    ? Math.max(1, Math.min(max, Math.floor(n)))
    : fallback;
}
function columnIds(step: DatabaseResearchStep): string[] {
  return [
    ...new Set(
      [
        step.columnId,
        step.xColumnId,
        step.yColumnId,
        step.groupColumnId,
        step.timeColumnId,
        ...(step.columns ?? []),
      ].filter((x): x is string => Boolean(x)),
    ),
  ];
}
function canonicalStep(
  step: DatabaseResearchStep,
  index: number,
): Required<Pick<DatabaseResearchStep, "id" | "operation">> &
  DatabaseResearchStep {
  return {
    ...step,
    id: step.id?.trim() || `step-${index + 1}`,
    operation: step.operation as DatabaseResearchOperation,
  };
}

/** Validate the DSL before reading any data. Unknown operations/columns and
 * duplicate ids are rejected rather than silently ignored. */
export function validateDatabaseResearchPlan(
  plan: DatabaseResearchPlan,
  columns: DatabaseColumn[],
  budget: DatabaseResearchBudget = {},
): DatabaseResearchStep[] {
  if (!plan || !Array.isArray(plan.steps))
    throw new Error("Database research plan must contain a steps array.");
  const maxSteps = Math.max(
    1,
    Math.min(160, Math.floor(budget.maxSteps ?? 60)),
  );
  if (plan.steps.length > maxSteps)
    throw new Error(
      `Database research plan exceeds the ${maxSteps}-step budget.`,
    );
  const known = new Set(columns.map((column) => column.id));
  const ids = new Set<string>();
  return plan.steps.map((raw, index) => {
    const step = canonicalStep(raw, index);
    if (
      !DATABASE_RESEARCH_OPERATIONS.includes(
        step.operation as DatabaseResearchOperation,
      )
    )
      throw new Error(
        `Unsupported database research operation: ${String(step.operation)}`,
      );
    if (step.operation === "multipleTesting")
      throw new Error(
        "multipleTesting is generated from the p-values of deterministic artifacts; it cannot be requested as an empty step.",
      );
    if (ids.has(step.id))
      throw new Error(`Duplicate database research step id: ${step.id}`);
    ids.add(step.id);
    for (const id of columnIds(step))
      if (!known.has(id))
        throw new Error(`Column ${id} is not part of this database.`);
    const numericColumn = (id?: string): boolean => {
      const candidate = columns.find((column) => column.id === id);
      return Boolean(candidate && ["number", "relation", "formula", "rollup", "checkbox"].includes(candidate.type));
    };
    const categoricalColumn = (id?: string): boolean => {
      const candidate = columns.find((column) => column.id === id);
      return Boolean(candidate && ["select", "status", "multi_select", "checkbox", "text", "rich_text", "title"].includes(candidate.type));
    };
    const temporalColumn = (id?: string): boolean => {
      const candidate = columns.find((column) => column.id === id);
      return Boolean(candidate && ["date", "time", "created_time", "last_edited_time"].includes(candidate.type));
    };
    const cohortTests = ["effectSizes", "permutation", "welchT", "mannWhitney"];
    if (cohortTests.includes(step.operation)) {
      if (!step.groupColumnId || !step.columnId)
        throw new Error(`${step.operation} requires groupColumnId and columnId; arbitrary numeric columns are not valid cohorts.`);
      if (!categoricalColumn(step.groupColumnId) || !numericColumn(step.columnId))
        throw new Error(`${step.operation} requires a categorical group and numeric metric.`);
    }
    if (step.operation === "cohortComparison") {
      if (!step.groupColumnId || !step.columnId || !categoricalColumn(step.groupColumnId) || !numericColumn(step.columnId))
        throw new Error("cohortComparison requires a categorical group and numeric metric.");
    }
    if (["correlation", "linearRegression", "logisticRegression"].includes(step.operation) &&
      (!step.xColumnId || !step.yColumnId || !numericColumn(step.xColumnId) || !numericColumn(step.yColumnId)))
      throw new Error(`${step.operation} requires two numeric columns.`);
    if (step.operation === "chiSquare" &&
      (!step.xColumnId || !step.yColumnId || !categoricalColumn(step.xColumnId) || !categoricalColumn(step.yColumnId)))
      throw new Error("chiSquare requires two categorical columns.");
    if (["changePoints", "acf", "temporalAudit"].includes(step.operation) && (!step.columnId || !numericColumn(step.columnId) || !step.timeColumnId || !temporalColumn(step.timeColumnId)))
      throw new Error(`${step.operation} requires a numeric metric and timeColumnId.`);
    if (
      [
        "correlation",
        "linearRegression",
        "logisticRegression",
        "kaplanMeier",
        "logRank",
        "coxPH",
        "ipw",
        "simpson",
      ].includes(step.operation) &&
      (!step.xColumnId || !step.yColumnId)
    )
      throw new Error(`${step.operation} requires xColumnId and yColumnId.`);
    if (
      ["groupBy", "kruskalWallis"].includes(step.operation) &&
      (!step.groupColumnId || !step.columnId)
    )
      throw new Error(`${step.operation} requires groupColumnId and columnId.`);
    if (["logRank", "simpson"].includes(step.operation) && !step.groupColumnId)
      throw new Error(`${step.operation} requires groupColumnId.`);
    if (["kaplanMeier", "logRank", "coxPH"].includes(step.operation)) {
      const duration = columns.find((column) => column.id === step.xColumnId);
      const event = columns.find((column) => column.id === step.yColumnId);
      if (!duration || !["number", "formula", "rollup", "date", "time", "created_time", "last_edited_time"].includes(duration.type))
        throw new Error(`${step.operation} requires a numeric or date/time duration column.`);
      if (!event || !["number", "formula", "rollup", "date", "time", "created_time", "last_edited_time", "checkbox", "select", "status", "multi_select"].includes(event.type))
        throw new Error(`${step.operation} requires a binary event column.`);
      if (!step.options || typeof step.options.durationUnit !== "string" || !Object.prototype.hasOwnProperty.call(DURATION_UNITS, step.options.durationUnit))
        throw new Error(`${step.operation} requires an explicit durationUnit.`);
      if (!["number", "formula", "rollup", "checkbox"].includes(event.type) && !roleMapping(step.options, "event"))
        throw new Error(`${step.operation} requires an explicit eventMapping for categorical events.`);
    }
    if (["ipw", "simpson"].includes(step.operation)) {
      const treatment = columns.find((column) => column.id === step.xColumnId);
      const outcome = columns.find((column) => column.id === step.yColumnId);
      if (!treatment || !["number", "formula", "rollup", "checkbox", "select", "status", "multi_select"].includes(treatment.type))
        throw new Error(`${step.operation} requires a binary treatment column.`);
      if (!outcome || !["number", "formula", "rollup", "checkbox"].includes(outcome.type))
        throw new Error(`${step.operation} requires a numeric outcome column.`);
      if (!["number", "formula", "rollup", "checkbox"].includes(treatment.type) && !roleMapping(step.options, "treatment"))
        throw new Error(`${step.operation} requires an explicit treatmentMapping for categorical treatment.`);
      if (step.operation === "ipw" && (!step.columns?.length || step.columns.some((id) => !numericColumn(id))))
        throw new Error("ipw requires numeric confounder columns aligned by row.");
    }
    if (["qualityAudit", "textAudit", "geoAudit", "attachmentAudit", "formulaAudit", "relationIntegrity"].includes(step.operation) && step.columnId && !known.has(step.columnId))
      throw new Error(`${step.operation} references an unknown column.`);
    const requiredRole =
      step.operation === "kaplanMeier" ||
      step.operation === "logRank" ||
      step.operation === "coxPH"
        ? "survival"
        : step.operation === "ipw" || step.operation === "simpson"
          ? "causal"
          : step.operation === "relationGraph"
            ? "graph"
            : null;
    if (requiredRole && step.role !== requiredRole)
      throw new Error(
        `${step.operation} requires the declared ${requiredRole} role.`,
      );
    return step;
  });
}

export function rehashDatabaseResearchSnapshot(
  snapshot: DatabaseResearchSnapshot,
): string {
  return sha256Snapshot({
    databaseId: snapshot.databaseId,
    revision: snapshot.revision,
    totalRowCount: snapshot.totalRowCount,
    truncated: snapshot.truncated,
    rows: snapshot.rows.map((row) => ({
      id: row.id,
      revision: row.revision ?? null,
      cells: row.cells,
    })),
    relationEdges: snapshot.relationEdges,
  });
}

function valuesFor(
  column: DatabaseColumn,
  rows: DatabaseRow[],
): { numeric: (number | null)[]; categories: (string | null)[] } {
  return {
    numeric: numericValues(column, rows),
    // Multi-select is flattened only for frequency counting. Any grouped or
    // pairwise analysis must keep exactly one label per source row.
    categories: categoryValues(column, rows),
  };
}
function getColumn(
  columns: DatabaseColumn[],
  id: string | undefined,
): DatabaseColumn {
  const column = columns.find((candidate) => candidate.id === id);
  if (!column) throw new Error(`Column ${id ?? "(missing)"} is not available.`);
  return column;
}
function hashEvidence(value: unknown): string {
  return sha256Snapshot(value);
}

function multiplicityArtifact(
  evidence: DatabaseResearchEvidence[],
): DatabaseResearchEvidence | null {
  const tests: Array<{ artifactId: string; path: string; pValue: number }> = [];
  const visit = (artifactId: string, value: unknown, path: string): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        visit(artifactId, item, `${path}.${index}`),
      );
      return;
    }
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const nextPath = path ? `${path}.${key}` : key;
      if (
        /^p(?:Value)?$/i.test(key) &&
        typeof item === "number" &&
        Number.isFinite(item) &&
        item >= 0 &&
        item <= 1
      )
        tests.push({ artifactId, path: nextPath, pValue: item });
      else visit(artifactId, item, nextPath);
    }
  };
  for (const item of evidence) visit(item.stepId, item.value, "");
  if (tests.length < 2) return null;
  const pValues = tests.map((test) => test.pValue);
  const bh = benjaminiHochberg(pValues, 0.05);
  const holm = holmCorrection(pValues, 0.05);
  const value = {
    tests: tests.map((test, index) => ({
      ...test,
      qValue: bh.adjusted[index],
      bhRejected: bh.rejected[index],
      holmAdjusted: holm.adjusted[index],
      holmRejected: holm.rejected[index],
    })),
    alpha: 0.05,
    familySize: tests.length,
  };
  return {
    stepId: "multiplicity-global",
    operation: "multipleTesting",
    columnIds: [],
    value,
    n: tests.length,
    hash: hashEvidence({ operation: "multipleTesting", inputs: tests.map((test) => ({ artifactId: test.artifactId, path: test.path, pValue: test.pValue })), value }),
  };
}

function temporalSeries(
  timeColumn: DatabaseColumn,
  metricColumn: DatabaseColumn,
  rows: DatabaseRow[],
): { values: (number | null)[]; sourceIndexes: number[]; timestamps: string[] } {
  const times = dateValues(timeColumn, rows);
  const metrics = numericValues(metricColumn, rows);
  return rows
    .map((_, sourceIndex) => ({
      sourceIndex,
      time: times[sourceIndex],
      value: metrics[sourceIndex],
    }))
    .filter((item) => item.time != null && Number.isFinite(Date.parse(item.time)))
    .sort((a, b) => Date.parse(a.time!) - Date.parse(b.time!) || a.sourceIndex - b.sourceIndex)
    .map((item) => ({ values: item.value, sourceIndexes: item.sourceIndex, timestamps: item.time! }))
    .reduce(
      (out, item) => {
        out.values.push(item.values);
        out.sourceIndexes.push(item.sourceIndexes);
        out.timestamps.push(item.timestamps);
        return out;
      },
      { values: [] as (number | null)[], sourceIndexes: [] as number[], timestamps: [] as string[] },
    );
}

function temporalDiagnostics(
  series: ReturnType<typeof temporalSeries>,
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const aligned = series.values.flatMap((value, index) =>
    value != null && Number.isFinite(value) && Number.isFinite(Date.parse(series.timestamps[index] ?? ""))
      ? [{ value, timestamp: Date.parse(series.timestamps[index]), sourceIndex: series.sourceIndexes[index] }]
      : [],
  );
  if (aligned.length < 4) return { error: "Temporal diagnostics require at least four aligned observations.", observed: aligned.length };
  const origin = aligned[0].timestamp;
  const x = aligned.map((item) => (item.timestamp - origin) / 86_400_000);
  const y = aligned.map((item) => item.value);
  const trend = linearRegression(x.map((value, index) => [value, y[index]] as [number, number]));
  const differences = aligned.slice(1).map((item, index) => item.timestamp - aligned[index].timestamp).filter((value) => value > 0).sort((a, b) => a - b);
  const cadenceMedianMs = differences.length ? differences[Math.floor(differences.length / 2)] : 0;
  const cadenceMean = differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length : 0;
  const cadenceVariance = differences.length > 1 ? differences.reduce((sum, value) => sum + (value - cadenceMean) ** 2, 0) / (differences.length - 1) : 0;
  const cadenceCv = cadenceMean > 0 ? Math.sqrt(cadenceVariance) / cadenceMean : 0;
  const requestedPeriod = Math.trunc(Number(options?.seasonalPeriod));
  const inferredPeriod = cadenceMedianMs <= 2 * 86_400_000 ? 7 : cadenceMedianMs <= 10 * 86_400_000 ? 4 : cadenceMedianMs <= 40 * 86_400_000 ? 12 : 4;
  const seasonalPeriod = Math.max(2, Math.min(Math.floor(aligned.length / 2), Number.isFinite(requestedPeriod) && requestedPeriod >= 2 ? requestedPeriod : inferredPeriod));
  const fitted = x.map((value) => trend.intercept + trend.slope * value);
  const residuals = y.map((value, index) => value - fitted[index]);
  const buckets = Array.from({ length: seasonalPeriod }, () => [] as number[]);
  residuals.forEach((value, index) => buckets[index % seasonalPeriod].push(value));
  const seasonalProfile = buckets.map((bucket) => bucket.length ? bucket.reduce((sum, value) => sum + value, 0) / bucket.length : 0);
  const seasonalResiduals = residuals.map((value, index) => value - seasonalProfile[index % seasonalPeriod]);
  const variance = (values: number[]) => {
    if (values.length < 2) return 0;
    const averageValue = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + (value - averageValue) ** 2, 0) / (values.length - 1);
  };
  const residualVariance = variance(residuals);
  const seasonalityStrength = residualVariance > 0 ? Math.max(0, Math.min(1, 1 - variance(seasonalResiduals) / residualVariance)) : 0;
  const midpoint = Math.floor(y.length / 2);
  const before = y.slice(0, midpoint), after = y.slice(midpoint);
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const beforeMean = average(before), afterMean = average(after);
  const pooledScale = Math.sqrt(Math.max(0, (variance(before) + variance(after)) / 2));
  const minTraining = Math.max(3, Math.min(y.length - 1, Math.max(seasonalPeriod, Math.ceil(y.length / 2))));
  const errors: number[] = [];
  for (let index = minTraining; index < y.length; index++) {
    const rollingTrend = linearRegression(x.slice(0, index).map((value, pairIndex) => [value, y[pairIndex]] as [number, number]));
    const forecast = rollingTrend.intercept + rollingTrend.slope * x[index];
    errors.push(y[index] - forecast);
  }
  return {
    observed: y.length,
    droppedMissing: series.values.length - y.length,
    sourceIndexes: aligned.map((item) => item.sourceIndex),
    cadenceMedianMs,
    cadenceCv,
    trend: { slopePerDay: trend.slope, intercept: trend.intercept, rSquared: trend.r2 },
    seasonality: { period: seasonalPeriod, strength: seasonalityStrength, profile: seasonalProfile },
    drift: { beforeMean, afterMean, difference: afterMean - beforeMean, standardizedDifference: pooledScale > 0 ? (afterMean - beforeMean) / pooledScale : 0 },
    rollingOrigin: {
      folds: errors.length,
      mae: errors.length ? average(errors.map(Math.abs)) : null,
      rmse: errors.length ? Math.sqrt(average(errors.map((value) => value ** 2))) : null,
    },
  };
}

const DURATION_UNITS: Record<string, number> = {
  milliseconds: 1,
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
  native: 1,
};

function roleMapping(options: Record<string, unknown> | undefined, role: "event" | "treatment"): Record<string, number> | null {
  const raw = options?.[`${role}Mapping`];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const mapping: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || (numeric !== 0 && numeric !== 1)) return null;
    mapping[key.trim().toLocaleLowerCase()] = numeric;
  }
  return Object.keys(mapping).length ? mapping : null;
}

function binaryRoleValues(
  column: DatabaseColumn,
  rows: DatabaseRow[],
  options: Record<string, unknown> | undefined,
  role: "event" | "treatment",
): number[] {
  const numericTypes = ["number", "formula", "rollup", "checkbox"];
  if (numericTypes.includes(column.type)) {
    const values = numericValues(column, rows);
    if (values.some((value) => value != null && (!Number.isFinite(value) || (value !== 0 && value !== 1))))
      throw new Error(`${role} column must contain only binary 0/1 values.`);
    return values.map((value) => value == null ? NaN : value);
  }
  const mapping = roleMapping(options, role);
  if (!mapping) throw new Error(`${role} categorical columns require an explicit ${role}Mapping with values 0 and 1.`);
  const labels = categoryValues(column, rows);
  const observed = new Set<string>();
  const values = labels.map((label) => {
    if (label == null) return NaN;
    const key = label.trim().toLocaleLowerCase();
    observed.add(key);
    return mapping[key] ?? NaN;
  });
  if (observed.size > 2 || values.some((value, index) => labels[index] != null && !Number.isFinite(value)))
    throw new Error(`${role} categorical column has more than two levels or an unmapped level.`);
  return values;
}

function durationRoleValues(
  column: DatabaseColumn,
  rows: DatabaseRow[],
  options: Record<string, unknown> | undefined,
): number[] {
  const unit = typeof options?.durationUnit === "string" ? options.durationUnit : "";
  if (!Object.prototype.hasOwnProperty.call(DURATION_UNITS, unit))
    throw new Error("Survival duration requires an explicit durationUnit (or native).");
  if (["date", "time", "created_time", "last_edited_time"].includes(column.type)) {
    const parsed = dateValues(column, rows).map((value) => value == null ? NaN : Date.parse(value));
    const origin = Math.min(...parsed.filter(Number.isFinite));
    if (!Number.isFinite(origin)) return parsed.map(() => NaN);
    return parsed.map((value) => Number.isFinite(value) ? (value - origin) / DURATION_UNITS[unit] : NaN);
  }
  if (!["number", "formula", "rollup"].includes(column.type))
    throw new Error("Survival duration must be numeric or a date/time column.");
  return numericValues(column, rows).map((value) => value == null ? NaN : value);
}

function detectFormulaCycles(derived: DatabaseColumn[], columns: DatabaseColumn[]): string[][] {
  const ids = new Set(columns.map((column) => column.id));
  const graph = new Map<string, string[]>();
  for (const column of derived) {
    const deps = column.type === "formula"
      ? formulaDependencies(column.config.formula as never)
      : [column.config.rollupRelationColumnId, column.config.rollupTargetColumnId].filter((id): id is string => Boolean(id));
    graph.set(column.id, deps.filter((dep) => ids.has(dep)));
  }
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string, path: string[]) => {
    if (visiting.has(id)) { const start = path.indexOf(id); if (start >= 0) cycles.push(path.slice(start).concat(id)); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of graph.get(id) ?? []) walk(dep, [...path, id]);
    visiting.delete(id); visited.add(id);
  };
  for (const id of graph.keys()) walk(id, []);
  return cycles;
}

function evaluateArithmeticFormula(
  spec: unknown,
  row: DatabaseRow,
  columns: DatabaseColumn[],
): number | null {
  if (!spec || typeof spec !== "object" || (spec as Record<string, unknown>).kind !== "arithmetic") return null;
  const operands = Array.isArray((spec as Record<string, unknown>).operands) ? (spec as Record<string, unknown>).operands as unknown[] : [];
  const values = operands.map((operand) => {
    if (!operand || typeof operand !== "object") return NaN;
    const item = operand as Record<string, unknown>;
    if (item.kind === "number") return Number(item.value);
    if (item.kind !== "column") return NaN;
    const column = columns.find((candidate) => candidate.id === item.columnId);
    return column ? numericValues(column, [row])[0] ?? NaN : NaN;
  });
  if (!values.length || values.some((value) => !Number.isFinite(value))) return null;
  const op = String((spec as Record<string, unknown>).op ?? "");
  if (op === "add") return values.reduce((sum, value) => sum + value, 0);
  if (op === "multiply") return values.reduce((product, value) => product * value, 1);
  if (op === "subtract") return values.slice(1).reduce((result, value) => result - value, values[0]);
  if (op === "divide") return values.slice(1).reduce((result, value) => Math.abs(value) > 1e-15 ? result / value : NaN, values[0]);
  if (op === "average") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (op === "min") return Math.min(...values);
  if (op === "max") return Math.max(...values);
  return null;
}

function computeStep(
  step: DatabaseResearchStep,
  columns: DatabaseColumn[],
  rows: DatabaseRow[],
  seed: number | string,
  budget: DatabaseResearchBudget,
  databaseId?: string,
  snapshotEdges: DatabaseResearchSnapshot["relationEdges"] = [],
): { value: unknown; columnIds: string[]; n: number } {
  const col = (id?: string) => getColumn(columns, id);
  const x = step.xColumnId ? valuesFor(col(step.xColumnId), rows) : null;
  const y = step.yColumnId ? valuesFor(col(step.yColumnId), rows) : null;
  const one = step.columnId ? valuesFor(col(step.columnId), rows) : null;
  const opts = step.options;
  const op = step.operation as DatabaseResearchOperation;
  switch (op) {
    case "describe": {
      const vals =
        one?.numeric.filter(
          (v): v is number => v != null && Number.isFinite(v),
        ) ?? [];
      return {
        value: describe(vals),
        columnIds: columnIds(step),
        n: vals.length,
      };
    }
    case "robustSummary": {
      const vals =
        one?.numeric.filter(
          (v): v is number => v != null && Number.isFinite(v),
        ) ?? [];
      return {
        value: robustSummary(vals, Number(opts?.scaleMad ?? 1)),
        columnIds: columnIds(step),
        n: vals.length,
      };
    }
    case "trimmedMean": {
      const vals =
        one?.numeric.filter(
          (v): v is number => v != null && Number.isFinite(v),
        ) ?? [];
      return {
        value: trimmedMean(vals, Number(opts?.proportion ?? 0.1)),
        columnIds: columnIds(step),
        n: vals.length,
      };
    }
    case "frequencies": {
      const vals = one
        ? col(step.columnId)?.type === "multi_select"
          ? categoryValuesMulti(col(step.columnId), rows)
          : one.categories
        : [];
      return {
        value: frequencies(vals, finiteOptions(opts, "topN", 15, 100)),
        columnIds: columnIds(step),
        n: vals.filter(Boolean).length,
      };
    }
    case "missingness": {
      const target = col(step.columnId);
      const vals = rows.map((row) => row.cells[target.id] ?? null);
      return {
        value: missingness(vals),
        columnIds: columnIds(step),
        n: vals.length,
      };
    }
    case "correlation": {
      const a = x!.numeric,
        b = y!.numeric;
      const pairs = a.length && b.length
        ? a.map((value, index) => [value, b[index]] as [number | null, number | null])
        : [];
      const complete = pairs.filter(([left, right]) => left != null && right != null && Number.isFinite(left) && Number.isFinite(right));
      return {
        value: correlationMatrix([
          { key: step.xColumnId!, label: step.xColumnId!, values: a },
          { key: step.yColumnId!, label: step.yColumnId!, values: b },
        ]),
        columnIds: columnIds(step),
        n: complete.length,
      };
    }
    case "linearRegression": {
      const pairs: [number, number][] = [];
      for (let i = 0; i < x!.numeric.length; i++) {
        const a = x!.numeric[i],
          b = y!.numeric[i];
        if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b))
          pairs.push([a, b]);
      }
      return {
        value: linearRegression(pairs),
        columnIds: columnIds(step),
        n: pairs.length,
      };
    }
    case "logisticRegression": {
      const pairs: [number, number][] = [];
      for (let i = 0; i < x!.numeric.length; i++) {
        const a = x!.numeric[i],
          b = y!.numeric[i];
        if (
          a != null &&
          b != null &&
          Number.isFinite(a) &&
          (b === 0 || b === 1)
        )
          pairs.push([a, b]);
      }
      return {
        value: logisticRegression(pairs),
        columnIds: columnIds(step),
        n: pairs.length,
      };
    }
    case "groupBy": {
      const vals = one!.numeric;
      return {
        value: groupBy(
          valuesFor(col(step.groupColumnId), rows).categories,
          vals,
        ),
        columnIds: columnIds(step),
        n: vals.filter((v) => v != null && Number.isFinite(v)).length,
      };
    }
    case "bootstrap": {
      const vals = one!.numeric.filter(
        (v): v is number => v != null && Number.isFinite(v),
      );
      const result = bcaBootstrap(vals, undefined, {
        iterations: finiteOptions(
          opts,
          "iterations",
          2000,
          budget.maxBootstrapIterations ?? 20_000,
        ),
        confidence: Number(opts?.confidence ?? 0.95),
        seed,
      });
      return {
        value: { ...result, samples: undefined, intervalMethod: "BCa" },
        columnIds: columnIds(step),
        n: vals.length,
      };
    }
    case "chiSquare": {
      const table = contingencyTable(
        valuesFor(col(step.xColumnId), rows).categories,
        valuesFor(col(step.yColumnId), rows).categories,
      );
      const result = chiSquare(table);
      return {
        value: {
          chi2: result.chi2,
          dof: result.dof,
          cramersV: result.cramersV,
          p: result.p,
          expected: result.expected,
          counts: table.counts,
          rowLevels: table.rowLabels.length,
          columnLevels: table.colLabels.length,
        },
        columnIds: columnIds(step),
        n: table.total,
      };
    }
    case "permutation": {
      const labels = valuesFor(col(step.groupColumnId), rows).categories;
      const metric = valuesFor(col(step.columnId), rows).numeric;
      const grouped = new Map<string, number[]>();
      for (let i = 0; i < rows.length; i++) {
        const label = labels[i], value = metric[i];
        if (label != null && value != null && Number.isFinite(value)) (grouped.get(label) ?? (grouped.set(label, []), grouped.get(label)!)).push(value);
      }
      const groups = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 2);
      if (groups.length < 2) return { value: { error: "At least two non-empty cohorts are required." }, columnIds: columnIds(step), n: 0 };
      const a = groups[0][1], b = groups[1][1];
      const result = permutationTest(a, b, undefined, {
        iterations: finiteOptions(
          opts,
          "iterations",
          5000,
          budget.maxPermutationIterations ?? 20_000,
        ),
        alternative:
          (opts?.alternative as "two-sided" | "greater" | "less") ??
          "two-sided",
        seed,
      });
      return {
        value: result,
        columnIds: columnIds(step),
        n: a.length + b.length,
      };
    }
    case "multipleTesting": {
      if (Array.isArray(opts?.pValues) && opts.pValues.length)
        throw new Error(
          "multipleTesting accepts only p-values produced by a prior deterministic evidence step.",
        );
      return {
        value: { bh: benjaminiHochberg([], Number(opts?.alpha ?? 0.05)) },
        columnIds: [],
        n: 0,
      };
    }
    case "effectSizes": {
      const labels = valuesFor(col(step.groupColumnId), rows).categories;
      const metric = valuesFor(col(step.columnId), rows).numeric;
      const grouped = new Map<string, number[]>();
      for (let i = 0; i < rows.length; i++) { const label = labels[i], value = metric[i]; if (label != null && value != null && Number.isFinite(value)) (grouped.get(label) ?? (grouped.set(label, []), grouped.get(label)!)).push(value); }
      const groups = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 2);
      if (groups.length < 2) return { value: { error: "At least two non-empty cohorts are required." }, columnIds: columnIds(step), n: 0 };
      const a = groups[0][1], b = groups[1][1];
      return {
        value: effectSizes(a, b),
        columnIds: columnIds(step),
        n: a.length + b.length,
      };
    }
    case "welchT": {
      const labels = valuesFor(col(step.groupColumnId), rows).categories;
      const metric = valuesFor(col(step.columnId), rows).numeric;
      const grouped = new Map<string, number[]>();
      for (let i = 0; i < rows.length; i++) { const label = labels[i], value = metric[i]; if (label != null && value != null && Number.isFinite(value)) (grouped.get(label) ?? (grouped.set(label, []), grouped.get(label)!)).push(value); }
      const groups = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 2);
      if (groups.length < 2) return { value: { error: "At least two non-empty cohorts are required." }, columnIds: columnIds(step), n: 0 };
      const a = groups[0][1], b = groups[1][1];
      return {
        value: welchTTest(a, b),
        columnIds: columnIds(step),
        n: a.length + b.length,
      };
    }
    case "mannWhitney": {
      const labels = valuesFor(col(step.groupColumnId), rows).categories;
      const metric = valuesFor(col(step.columnId), rows).numeric;
      const grouped = new Map<string, number[]>();
      for (let i = 0; i < rows.length; i++) { const label = labels[i], value = metric[i]; if (label != null && value != null && Number.isFinite(value)) (grouped.get(label) ?? (grouped.set(label, []), grouped.get(label)!)).push(value); }
      const groups = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 2);
      if (groups.length < 2) return { value: { error: "At least two non-empty cohorts are required." }, columnIds: columnIds(step), n: 0 };
      const a = groups[0][1], b = groups[1][1];
      return {
        value: mannWhitneyU(a, b),
        columnIds: columnIds(step),
        n: a.length + b.length,
      };
    }
    case "cohortComparison": {
      const labels = valuesFor(col(step.groupColumnId), rows).categories;
      const metric = valuesFor(col(step.columnId), rows).numeric;
      return {
        value: cohortComparison(labels, metric, { maxPairs: finiteOptions(opts, "maxPairs", 28, 120), alpha: Number(opts?.alpha ?? 0.05) }),
        columnIds: columnIds(step),
        n: metric.filter((value, index) => labels[index] != null && value != null && Number.isFinite(value)).length,
      };
    }
    case "kruskalWallis": {
      const labels = valuesFor(col(step.groupColumnId), rows).categories;
      const values = one!.numeric;
      const groups = new Map<string, number[]>();
      for (let i = 0; i < rows.length; i++) {
        const label = labels[i],
          value = values[i];
        if (label != null && value != null && Number.isFinite(value)) {
          const bucket = groups.get(label) ?? [];
          bucket.push(value);
          groups.set(label, bucket);
        }
      }
      const grouped = [...groups.entries()];
      return {
        value: {
          labels: grouped.map(([label]) => label),
          ...kruskalWallis(grouped.map(([, group]) => group)),
        },
        columnIds: columnIds(step),
        n: grouped.reduce((sum, [, group]) => sum + group.length, 0),
      };
    }
    case "vif": {
      const ids = step.columns ?? [];
      const matrix = rows
        .map((row) => ids.map((id) => numericValues(col(id), [row])[0] ?? NaN))
        .filter((row) => row.every(Number.isFinite));
      return {
        value: { columns: ids, vif: vif(matrix) },
        columnIds: ids,
        n: matrix.length,
      };
    }
    case "pca": {
      const ids = step.columns ?? [];
      const matrix = rows
        .map((row) => ids.map((id) => numericValues(col(id), [row])[0] ?? NaN))
        .filter((row) => row.every(Number.isFinite));
      const result = pca(
        matrix,
        finiteOptions(opts, "components", ids.length, ids.length),
      );
      return {
        value: { columns: ids, ...result, scores: undefined },
        columnIds: ids,
        n: matrix.length,
      };
    }
    case "changePoints": {
      const temporal = temporalSeries(col(step.timeColumnId), col(step.columnId), rows);
      const indexed = detectIndexedChangePoints(temporal.values, opts as { minSegmentLength?: number; threshold?: number; maxChanges?: number });
      return {
        value: { points: indexed, orderedTimestamps: temporal.timestamps },
        columnIds: columnIds(step),
        n: temporal.values.filter((value): value is number => value != null && Number.isFinite(value)).length,
      };
    }
    case "acf": {
      const temporal = temporalSeries(col(step.timeColumnId), col(step.columnId), rows);
      const vals = temporal.values.filter((value): value is number => value != null && Number.isFinite(value));
      return {
        value: {
          values: acf(vals, finiteOptions(opts, "maxLag", Math.max(0, vals.length - 1), 5000)),
          sourceIndexes: temporal.sourceIndexes.filter((_, index) => temporal.values[index] != null && Number.isFinite(temporal.values[index] as number)),
          timestamps: temporal.timestamps.filter((_, index) => temporal.values[index] != null && Number.isFinite(temporal.values[index] as number)),
          droppedMissing: temporal.values.filter((value) => value == null || !Number.isFinite(value)).length,
        },
        columnIds: columnIds(step),
        n: vals.length,
      };
    }
    case "temporalAudit": {
      const temporal = temporalSeries(col(step.timeColumnId), col(step.columnId), rows);
      return {
        value: temporalDiagnostics(temporal, opts),
        columnIds: columnIds(step),
        n: temporal.values.filter((item): item is number => item != null && Number.isFinite(item)).length,
      };
    }
    case "qualityAudit": {
      const byColumn = columns.map((column) => {
        const raw = rows.map((row) => row.cells[column.id] ?? null);
        const nonEmpty = raw.filter((value) => value != null && String(value).trim() !== "").map(String);
        const distinct = new Set(nonEmpty.map((value) => value.normalize("NFKC").trim().toLocaleLowerCase())).size;
        const numeric = numericValues(column, rows);
        const invalidNumeric = ["number", "formula", "rollup"].includes(column.type)
          ? numeric.filter((value, index) => raw[index] != null && !Number.isFinite(value as number)).length
          : 0;
        return { columnId: column.id, type: column.type, total: rows.length, missing: rows.length - nonEmpty.length, missingRate: rows.length ? (rows.length - nonEmpty.length) / rows.length : NaN, observed: nonEmpty.length, distinct, duplicateValues: Math.max(0, nonEmpty.length - distinct), invalidNumeric };
      });
      return { value: { columns: byColumn, duplicateRows: rows.length - new Set(rows.map((row) => JSON.stringify(row.cells))).size }, columnIds: columnIds(step), n: rows.length };
    }
    case "textAudit": {
      const target = col(step.columnId);
      return { value: auditText(categoryValues(target, rows), finiteOptions(opts, "topN", 20, 100)), columnIds: columnIds(step), n: rows.length };
    }
    case "geoAudit": {
      const target = col(step.columnId);
      return { value: auditGeo(rows.map((row) => row.cells[target.id] ?? null)), columnIds: columnIds(step), n: rows.length };
    }
    case "attachmentAudit": {
      const target = col(step.columnId);
      const entries = rows.flatMap((row) => {
        const metadata = row.attachments?.[target.id];
        if (metadata?.length) return metadata;
        const raw = row.cells[target.id] ?? null;
        if (!raw) return [];
        try { const parsed = JSON.parse(String(raw)); return Array.isArray(parsed) ? parsed : [parsed]; } catch { return [{ __parseError: true }]; }
      });
      const mime = new Map<string, number>(); let invalid = 0; let bytes = 0;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") { invalid++; continue; }
        const record = entry as Record<string, unknown>;
        if (record.__parseError === true) { invalid++; continue; }
        const type = typeof record.mimeType === "string" ? record.mimeType : typeof record.mime === "string" ? record.mime : "unknown";
        mime.set(type, (mime.get(type) ?? 0) + 1); const size = Number(record.size ?? record.bytes); if (Number.isFinite(size) && size >= 0) bytes += size;
      }
      const uniqueHashes = new Set(entries.map((entry) => entry && typeof entry === "object" ? String((entry as Record<string, unknown>).contentHash ?? (entry as Record<string, unknown>).hash ?? (entry as Record<string, unknown>).url ?? "") : "").filter(Boolean));
      const unavailable = entries.filter((entry) => entry && typeof entry === "object" && (entry as Record<string, unknown>).hasBlob === false).length;
      return { value: { total: entries.length, invalid, unavailable, mimeTypes: Object.fromEntries(mime), bytes, uniqueHashes: uniqueHashes.size }, columnIds: columnIds(step), n: rows.length };
    }
    case "formulaAudit": {
      const derived = columns.filter((candidate) => ["formula", "rollup", "comparison"].includes(candidate.type));
      const tolerance = Number(opts?.tolerance ?? 1e-6);
      const checks = derived.map((column) => {
        const deps = column.type === "formula"
          ? formulaDependencies(column.config.formula as never)
          : column.type === "comparison"
            ? (column.config.comparisonSourceColumnIds ?? []).filter((id): id is string => typeof id === "string")
            : [column.config.rollupRelationColumnId, column.config.rollupTargetColumnId].filter((id): id is string => Boolean(id));
        const known = deps.filter((id) => columns.some((candidate) => candidate.id === id));
        const values = rows.map((row) => row.cells[column.id] ?? row.rollups?.[column.id] ?? null);
        const errors = values.filter((value) => typeof value === "string" && /#(?:ERROR|REF|DIV\/0|VALUE)/i.test(value)).length;
        const checksWithExpected = column.type === "formula"
          ? rows.map((row, index) => ({ actual: numericValues(column, [row])[0], expected: evaluateArithmeticFormula(column.config.formula, row, columns), index })).filter((item) => item.expected != null && Number.isFinite(item.actual))
          : [];
        const comparisonChecks = column.type === "comparison"
          ? rows.map((row) => ({ actual: row.cells[column.id] ?? null, expected: comparisonMajorityValue(column, columns, row) }))
            .filter((item) => item.expected != null && item.actual != null && String(item.actual).trim().length > 0)
          : [];
        const divergent = checksWithExpected.filter((item) => Math.abs((item.actual as number) - (item.expected as number)) > Math.max(0, tolerance)).length
          + comparisonChecks.filter((item) => String(item.actual) !== String(item.expected)).length;
        const checked = checksWithExpected.length + comparisonChecks.length;
        return { columnId: column.id, type: column.type, dependencies: deps, unknownDependencies: deps.filter((id) => !known.includes(id)), errors, observed: values.filter((value) => value != null && String(value).trim()).length, reconciliation: { checked, reconciled: checked - divergent, divergent, tolerance: column.type === "comparison" ? null : tolerance } };
      });
      return { value: { columns: checks, cycles: detectFormulaCycles(derived, columns) }, columnIds: columnIds(step), n: rows.length };
    }
    case "relationIntegrity": {
      const edges = snapshotEdges.filter((edge) => !step.columnId || edge.columnId === step.columnId);
      const sourceCounts = new Map<string, number>(), targetCounts = new Map<string, number>();
      for (const edge of edges) { sourceCounts.set(edge.source, (sourceCounts.get(edge.source) ?? 0) + 1); targetCounts.set(edge.target, (targetCounts.get(edge.target) ?? 0) + 1); }
      const orphanTargets = [...new Set(edges.filter((edge) => !edge.targetExists).map((edge) => edge.target))];
      const externalTargets = [...new Set(edges.filter((edge) => edge.targetExists && !edge.targetInScope).map((edge) => edge.target))];
      const graph = relationGraphDiagnostics(edges);
      return { value: {
        nodeCount: graph.nodes.length,
        componentSizes: graph.components.map((component) => component.length).sort((a, b) => b - a),
        externalTargetCount: externalTargets.length,
        orphanTargetCount: orphanTargets.length,
        // Fingerprints preserve cross-database candidates for reconciliation
        // without exposing row identifiers to the report/model.
        externalTargetFingerprints: externalTargets.map((id) => sha256Snapshot(id)),
        orphanTargetFingerprints: orphanTargets.map((id) => sha256Snapshot(id)),
        duplicateEdges: edges.length - new Set(edges.map((edge) => `${edge.source}\u0000${edge.target}\u0000${edge.columnId}`)).size,
        manyToManySources: [...sourceCounts.values()].filter((count) => count > 1).length,
      }, columnIds: columnIds(step), n: edges.length };
    }
    case "kaplanMeier": {
      const times: number[] = [], events: number[] = [];
      const duration = durationRoleValues(col(step.xColumnId), rows, opts);
      const event = binaryRoleValues(col(step.yColumnId), rows, opts, "event");
      for (let i = 0; i < rows.length; i++) {
        const time = duration[i], eventValue = event[i];
        if (
          Number.isFinite(time) &&
          Number.isFinite(eventValue) &&
          time >= 0 &&
          (eventValue === 0 || eventValue === 1)
        ) {
          times.push(time);
          events.push(eventValue);
        }
      }
      if (!times.length) throw new Error("Survival analysis has no valid aligned duration/event rows.");
      return {
        value: kaplanMeier(times, events),
        columnIds: columnIds(step),
        n: times.length,
      };
    }
    case "logRank": {
      const times: number[] = [], events: number[] = [], labels: string[] = [];
      const duration = durationRoleValues(col(step.xColumnId), rows, opts);
      const event = binaryRoleValues(col(step.yColumnId), rows, opts, "event");
      const groups = valuesFor(col(step.groupColumnId), rows).categories;
      const groupLevels = new Set(groups.filter((label): label is string => label != null));
      if (groupLevels.size !== 2) throw new Error("Log-rank requires exactly two non-empty groups.");
      for (let i = 0; i < rows.length; i++) {
        const time = duration[i], eventValue = event[i], label = groups[i];
        if (Number.isFinite(time) && Number.isFinite(eventValue) && time >= 0 && (eventValue === 0 || eventValue === 1) && label != null) {
          times.push(time);
          events.push(eventValue);
          labels.push(String(label));
        }
      }
      if (!times.length) throw new Error("Log-rank has no valid aligned duration/event/group rows.");
      return {
        value: logRank(times, events, labels),
        columnIds: columnIds(step),
        n: times.length,
      };
    }
    case "coxPH": {
      const ids = step.columns ?? [];
      const times: number[] = [], events: number[] = [], matrix: number[][] = [];
      const duration = durationRoleValues(col(step.xColumnId), rows, opts);
      const event = binaryRoleValues(col(step.yColumnId), rows, opts, "event");
      for (let i = 0; i < rows.length; i++) {
        const time = duration[i], eventValue = event[i];
        const values = ids.map((id) => numericValues(col(id), [rows[i]])[0] ?? NaN);
        if (Number.isFinite(time) && Number.isFinite(eventValue) && time >= 0 && (eventValue === 0 || eventValue === 1) && values.every(Number.isFinite)) {
          times.push(time);
          events.push(eventValue);
          matrix.push(values);
        }
      }
      if (!times.length) throw new Error("Cox PH has no valid aligned duration/event/covariate rows.");
      return {
        value: coxPH(times, events, matrix, opts as { maxIterations?: number; tolerance?: number; phThreshold?: number }),
        columnIds: columnIds(step),
        n: times.length,
      };
    }
    case "ipw": {
      const ids = step.columns ?? [];
      const treatment: number[] = [],
        outcome: number[] = [],
        matrix: number[][] = [];
      const treatmentValues = binaryRoleValues(col(step.xColumnId), rows, opts, "treatment");
      const outcomeValues = numericValues(col(step.yColumnId), rows);
      if (!treatmentValues.some((value) => value === 0) || !treatmentValues.some((value) => value === 1))
        throw new Error("IPW requires both treatment levels 0 and 1.");
      for (let i = 0; i < rows.length; i++) {
        const a = treatmentValues[i],
          yValue = outcomeValues[i],
          values = ids.map((id) => numericValues(col(id), [rows[i]])[0] ?? NaN);
        if (
          Number.isFinite(a) &&
          (a === 0 || a === 1) &&
          yValue != null &&
          Number.isFinite(yValue) &&
          values.every(Number.isFinite)
        ) {
          treatment.push(a);
          outcome.push(yValue);
          matrix.push(values);
        }
      }
      return {
        value: inverseProbabilityWeighting(
          treatment,
          outcome,
          matrix,
          opts as { stabilized?: boolean; trim?: number },
        ),
        columnIds: columnIds(step),
        n: treatment.length,
      };
    }
    case "simpson": {
      const treatmentValues = binaryRoleValues(col(step.xColumnId), rows, opts, "treatment");
      const strataValues = valuesFor(col(step.groupColumnId), rows).categories;
      const outcomeValues = numericValues(col(step.yColumnId), rows);
      const labels: string[] = [],
        strata: string[] = [],
        outcomes: number[] = [];
      for (let i = 0; i < rows.length; i++) {
        const value = outcomeValues[i];
        if (
          value != null &&
          Number.isFinite(value) &&
          Number.isFinite(treatmentValues[i]) &&
          (treatmentValues[i] === 0 || treatmentValues[i] === 1) &&
          strataValues[i] != null
        ) {
          labels.push(String(treatmentValues[i]));
          strata.push(String(strataValues[i]));
          outcomes.push(value);
        }
      }
      if (!outcomes.length) throw new Error("Simpson audit has no valid aligned treatment/outcome/stratum rows.");
      if (!labels.includes("0") || !labels.includes("1")) throw new Error("Simpson audit requires both treatment levels 0 and 1.");
      return {
        value: detectSimpsonParadox(labels, outcomes, strata),
        columnIds: columnIds(step),
        n: outcomes.length,
      };
    }
    case "relationGraph": {
      const edges = snapshotEdges.filter(
        (edge) => !step.columnId || edge.columnId === step.columnId,
      );
      const graph = relationGraphDiagnostics(edges);
      const fingerprint = (node: string) => sha256Snapshot(`relation-node:${node}`);
      return {
        value: {
          nodes: graph.nodes.map(fingerprint),
          components: graph.components.map((component) => component.map(fingerprint)),
          degree: Object.fromEntries(Object.entries(graph.degree).map(([node, value]) => [fingerprint(node), value])),
          betweenness: Object.fromEntries(Object.entries(graph.betweenness).map(([node, value]) => [fingerprint(node), value])),
        },
        columnIds: columnIds(step),
        n: edges.length,
      };
    }
  }
}

function pathValue(value: unknown, path: string): unknown {
  return path
    .split(".")
    .filter(Boolean)
    .reduce(
      (current: unknown, key) =>
        current != null && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value,
    );
}
export function verifyDatabaseResearchClaims(
  evidence: DatabaseResearchEvidence[],
  claims: DatabaseResearchClaim[] = [],
): DatabaseResearchClaimResult[] {
  return claims.map((claim) => {
    const found = evidence.find((item) => item.stepId === claim.stepId);
    const actual = found ? pathValue(found.value, claim.path) : undefined;
    const tolerance = claim.tolerance ?? 1e-6;
    const usable = Boolean(found && evidenceIsUsable(found));
    const matches =
      typeof claim.expected === "number" && typeof actual === "number"
        ? Number.isFinite(actual) &&
          Math.abs(actual - claim.expected) <= tolerance
        : actual === claim.expected;
    const verified = usable && matches;
    return {
      ...claim,
      verified,
      actual,
      reason: !found
        ? "evidence step not found"
        : !usable
          ? "evidence artifact is empty or failed validation"
          : verified
            ? "matches deterministic evidence"
            : `expected ${String(claim.expected)} but observed ${String(actual)}`,
    };
  });
}

/** Execute all phases with bounded, deterministic evidence. No function in this
 * path mutates a row or accepts SQL/provider code. */
export function runDatabaseDeepResearch(
  request: DatabaseDeepResearchRequest,
  deps: DatabaseDeepResearchDeps = {},
  claims: DatabaseResearchClaim[] = [],
): DatabaseDeepResearchResult {
  const started: Array<{
    phase: DatabaseResearchPhase;
    startedAt: string;
    finishedAt: string;
  }> = [];
  const warnings: string[] = [];
  const mark = (phase: DatabaseResearchPhase, action: () => void) => {
    const startedAt = nowIso(deps);
    action();
    started.push({ phase, startedAt, finishedAt: nowIso(deps) });
  };
  let snapshot!: DatabaseResearchSnapshot;
  let steps!: DatabaseResearchStep[];
  const evidence: DatabaseResearchEvidence[] = [];
  mark("snapshot", () => {
    snapshot = deps.readSnapshot
      ? deps.readSnapshot(
          request.databaseId,
          Math.max(1, Math.floor(request.budget?.maxRows ?? 500_000)),
        )
      : missingResearchSource();
  });
  const columns = deps.readColumns
    ? deps.readColumns(request.databaseId)
    : missingResearchSource();
  mark("semantic_profile", () => {
    /* profile is derived below by deterministic steps */
  });
  mark("planning", () => {
    steps = validateDatabaseResearchPlan(request.plan, columns, request.budget);
  });
  mark("calculations", () => {
    for (const [index, step] of steps.entries()) {
      if (deps.isCancelled?.()) throw new Error("Database research cancelled.");
      if (step.operation === "multipleTesting") continue;
      const computed = computeStep(
        step,
        columns,
        snapshot.rows,
        request.seed ??
          hashSnapshot({
            databaseId: request.databaseId,
            revision: snapshot.revision,
          }),
        request.budget ?? {},
        request.databaseId,
        snapshot.relationEdges,
      );
      const value = JSON.parse(
        JSON.stringify(computed.value, (_key, item) =>
          typeof item === "function" ? undefined : item,
        ),
      );
      evidence.push({
        stepId: step.id!,
        operation: step.operation as DatabaseResearchOperation,
        columnIds: computed.columnIds,
        value,
        n: computed.n,
        denominator: snapshot.rowCount,
        hash: hashEvidence({
          operation: step.operation,
          step: step.id,
          inputs: {
            columnIds: computed.columnIds,
            options: step.options ?? {},
            seed: request.seed ?? hashSnapshot({ databaseId: request.databaseId, revision: snapshot.revision }),
            filters: request.filters ?? { query: "", columnIds: [] },
            snapshot: snapshot.hash,
          },
          value,
        }),
      });
      deps.onStep?.(index + 1, steps.length);
    }
    const multiplicity = multiplicityArtifact(evidence);
    if (multiplicity) evidence.push(multiplicity);
  });
  mark("sensitivity", () => {
    /* resampling is explicit in the allow-listed plan */
  });
  mark("adversarial_review", () => {
    /* no model can alter deterministic evidence */
  });
  let verified: DatabaseResearchClaimResult[] = [];
  mark("verification", () => {
    verified = verifyDatabaseResearchClaims(evidence, claims);
    if (verified.some((claim) => !claim.verified))
      warnings.push(
        "One or more requested claims did not match deterministic evidence.",
      );
  });
  mark("assembly", () => {
    /* caller assembles prose from this bounded result */
  });
  return {
    request,
    snapshot,
    evidence,
    claims: verified,
    phaseLog: started,
    warnings,
    hash: sha256Snapshot({
      snapshot: snapshot.hash,
      evidence,
      claims: verified,
    }),
  };
}

/** Execute deterministic calculations outside Electron's main thread. Snapshot
 * capture remains authorized in the caller, while the worker receives only the
 * immutable rows, schema and allow-listed plan. Cancellation terminates the
 * worker, including in the middle of a long resampling operation. */
export interface DatabaseResearchQueueItem {
  id: string;
  request: DatabaseDeepResearchRequest;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result?: DatabaseDeepResearchResult;
  error?: string;
}
/** In-process FIFO queue for database analyses. It never overlaps snapshots and
 * can be used by an IPC adapter without sharing the broader prose-report lane. */
export class DatabaseDeepResearchQueue {
  private items: DatabaseResearchQueueItem[] = [];
  private running = false;
  private sequence = 0;
  constructor(private readonly deps: DatabaseDeepResearchDeps = {}) {}
  enqueue(
    request: DatabaseDeepResearchRequest,
    claims: DatabaseResearchClaim[] = [],
  ): DatabaseResearchQueueItem {
    const item: DatabaseResearchQueueItem = {
      id: `dbr-${++this.sequence}`,
      request,
      status: "queued",
    };
    this.items.push(item);
    void this.drain(claims);
    return { ...item };
  }
  list(): DatabaseResearchQueueItem[] {
    return this.items.map((item) => ({
      ...item,
      result: item.result
        ? {
            ...item.result,
            evidence: item.result.evidence.map((e) => ({ ...e })),
            snapshot: { ...item.result.snapshot },
          }
        : undefined,
    }));
  }
  cancel(id: string): boolean {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.status !== "queued") return false;
    item.status = "cancelled";
    return true;
  }
  private async drain(claims: DatabaseResearchClaim[]): Promise<void> {
    if (this.running) return;
    const item = this.items.find((candidate) => candidate.status === "queued");
    if (!item) return;
    this.running = true;
    item.status = "running";
    try {
      item.result = runDatabaseDeepResearch(item.request, this.deps, claims);
      item.status = "completed";
    } catch (error) {
      item.status = "failed";
      item.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.running = false;
      void this.drain(claims);
    }
  }
}

// ── durable run adapter ──────────────────────────────────────────────────────

export interface DatabaseResearchAgentDeps {
  /** Optional injected model completion. It may write prose only; all numeric
   * evidence remains the result of computeStep and is supplied as context. */
  complete?: (input: {
    role:
      | "planner"
      | "critic"
      | "verifier"
      | "synthesizer"
      | "writer"
      | "editor"
      | "judge";
    objective: string;
    evidence: DatabaseResearchEvidence[];
    model: { provider: string; model: string } | null;
    reportType?: string;
    language?: string | null;
    /** Type map used by the lane to redact sensitive aggregate labels. */
    columnTypes?: Record<string, string>;
    /** Schema-only context; never contains row values or free text. */
    modelContext?: DatabaseResearchModelContext;
    /** Already validated writer AST supplied only to the single editor pass. */
    narrativeDraft?: NarrativeAst | null;
    /**
     * Guideline words per narrative section, or `'auto'`. The AST gate and the
     * bounded call budget (maxModelCalls) mean this pipeline never runs
     * continuation passes: the steer asks the writer to EXPLAIN the computed
     * artifacts more fully, never to produce more findings or numbers.
     */
    sectionLength?: DeepResearchSectionLength;
  }) => Promise<string>;
  now?: () => string;
  onProgress?: (progress: DatabaseResearchProgress) => void;
}

function planFromOptions(
  options: Record<string, unknown>,
  columns: DatabaseColumn[],
  plannerOutput?: Record<string, unknown> | null,
): DatabaseResearchPlan {
  const candidate = options.researchPlan ?? options.plan;
  const customSteps: DatabaseResearchStep[] = (
    candidate &&
    typeof candidate === "object" &&
    Array.isArray((candidate as Record<string, unknown>).steps)
  )
    ? ((candidate as DatabaseResearchPlan).steps ?? [])
    : [];
  const budget =
    options.budget && typeof options.budget === "object"
      ? (options.budget as DatabaseResearchBudget)
      : {};
  const maxSteps = Math.max(
    1,
    Math.min(160, Math.floor(budget.maxSteps ?? 60)),
  );
  const roles =
    options.roles && typeof options.roles === "object"
      ? (options.roles as Record<string, unknown>)
      : {};
  const numeric = columns.filter((column) =>
    ["number", "checkbox", "formula", "rollup"].includes(
      column.type,
    ),
  );
  const categorical = columns.filter((column) =>
    [
      "title",
      "rich_text",
      "text",
      "select",
      "status",
      "multi_select",
      "checkbox",
      "person",
      "created_by",
      "last_edited_by",
      "url",
      "email",
      "phone",
      "unique_id",
      "comparison",
      "ai",
    ].includes(column.type),
  );
  const steps: DatabaseResearchStep[] = [];
  const prioritySteps: DatabaseResearchStep[] = [];
  const firstColumn = columns[0];
  if (firstColumn)
    prioritySteps.push({ id: `required-missing-${firstColumn.id}`, operation: "missingness", columnId: firstColumn.id, role: "descriptive" });
  const firstRequiredNumeric = columns.find((column) => ["number", "formula", "rollup"].includes(column.type));
  if (firstRequiredNumeric) {
    prioritySteps.push({ id: `required-describe-${firstRequiredNumeric.id}`, operation: "describe", columnId: firstRequiredNumeric.id, role: "descriptive" });
    prioritySteps.push({ id: `required-robust-${firstRequiredNumeric.id}`, operation: "robustSummary", columnId: firstRequiredNumeric.id, role: "descriptive" });
  }
  for (const column of columns)
    steps.push({
      id: `missing-${column.id}`,
      operation: "missingness",
      columnId: column.id,
      role: "descriptive",
    });
  for (const column of numeric) {
    steps.push(
      {
        id: `describe-${column.id}`,
        operation: "describe",
        columnId: column.id,
        role: "descriptive",
      },
      {
        id: `robust-${column.id}`,
        operation: "robustSummary",
        columnId: column.id,
        role: "descriptive",
      },
      {
        id: `trimmed-${column.id}`,
        operation: "trimmedMean",
        columnId: column.id,
        role: "descriptive",
      },
      {
        id: `bootstrap-${column.id}`,
        operation: "bootstrap",
        columnId: column.id,
        role: "associational",
        options: { iterations: budget.maxBootstrapIterations ?? 5_000 },
      },
    );
  }
  for (let i = 0; i < Math.min(numeric.length, 8); i++) {
    for (let j = i + 1; j < Math.min(numeric.length, 8); j++) {
      steps.push(
        {
          id: `correlation-${numeric[i].id}-${numeric[j].id}`,
          operation: "correlation",
          xColumnId: numeric[i].id,
          yColumnId: numeric[j].id,
          role: "associational",
        },
        {
          id: `regression-${numeric[i].id}-${numeric[j].id}`,
          operation: "linearRegression",
          xColumnId: numeric[i].id,
          yColumnId: numeric[j].id,
          role: "associational",
        },
      );
    }
  }
  const groupColumns = columns.filter((column) =>
    ["select", "status", "checkbox"].includes(column.type),
  );
  for (let i = 0; i < Math.min(groupColumns.length, 8); i++)
    for (let j = i + 1; j < Math.min(groupColumns.length, 8); j++)
      steps.push({
        id: `chi-square-${groupColumns[i].id}-${groupColumns[j].id}`,
        operation: "chiSquare",
        xColumnId: groupColumns[i].id,
        yColumnId: groupColumns[j].id,
        role: "associational",
      });
  for (const groupColumn of groupColumns.slice(0, 4))
    for (const valueColumn of numeric.slice(0, 6)) {
      steps.push({
        id: `kruskal-${groupColumn.id}-${valueColumn.id}`,
        operation: "kruskalWallis",
        groupColumnId: groupColumn.id,
        columnId: valueColumn.id,
        role: "associational",
      });
    }
  if (numeric.length >= 3) {
    const ids = numeric.slice(0, 12).map((column) => column.id);
    steps.push({
      id: "multivariate-vif",
      operation: "vif",
      columns: ids,
      role: "associational",
    });
    steps.push({
      id: "multivariate-pca",
      operation: "pca",
      columns: ids,
      role: "associational",
      options: { components: Math.min(5, ids.length) },
    });
  }
  for (const column of categorical)
    steps.push({
      id: `frequencies-${column.id}`,
      operation: "frequencies",
      columnId: column.id,
      role: "descriptive",
    });
  const duration = typeof roles.duration === "string" ? roles.duration : null;
  const event = typeof roles.event === "string" ? roles.event : null;
  const durationUnit = duration && ["date", "time", "created_time", "last_edited_time"].includes(columns.find((column) => column.id === duration)?.type ?? "") ? "days" : "native";
  const outcome = typeof roles.outcome === "string" ? roles.outcome : null;
  const treatment =
    typeof roles.treatment === "string" ? roles.treatment : null;
  const confounders = Array.isArray(roles.confounders)
    ? roles.confounders.map(String)
    : [];
  const survivalGroup = typeof roles.group === "string" && columns.find((column) => column.id === roles.group)?.type === "checkbox"
    ? roles.group
    : null;
  const reportType = String(options.reportType ?? "general");
  const addPriority = (step: DatabaseResearchStep) => {
    if (!prioritySteps.some((candidate) => candidate.id === step.id))
      prioritySteps.push(step);
  };
  if (duration && event) {
    prioritySteps.push({
      id: "survival-kaplan-meier",
      operation: "kaplanMeier",
      xColumnId: duration,
      yColumnId: event,
      role: "survival",
      options: { durationUnit },
    });
    if (survivalGroup)
      prioritySteps.push({
        id: "survival-log-rank",
        operation: "logRank",
        xColumnId: duration,
        yColumnId: event,
        groupColumnId: survivalGroup,
        role: "survival",
        options: { durationUnit },
      });
    if (confounders.length)
      prioritySteps.push({
        id: "survival-cox-ph",
        operation: "coxPH",
        xColumnId: duration,
        yColumnId: event,
        columns: confounders,
        role: "survival",
        options: { durationUnit },
      });
  }
  if (outcome && treatment && confounders.length) {
    prioritySteps.push({
      id: "causal-ipw",
      operation: "ipw",
      xColumnId: treatment,
      yColumnId: outcome,
      columns: confounders,
      role: "causal",
    });
    prioritySteps.push({
      id: "causal-simpson-audit",
      operation: "simpson",
      xColumnId: treatment,
      yColumnId: outcome,
      groupColumnId: confounders[0],
      role: "causal",
    });
  }
  const relation = columns.find((column) => column.type === "relation");
  if (relation)
    addPriority({
      id: `relation-graph-${relation.id}`,
      operation: "relationGraph",
      columnId: relation.id,
      role: "graph",
    });
  const firstNumeric = numeric[0];
  const declaredGroup = typeof roles.group === "string" ? roles.group : null;
  const declaredMetrics = Array.isArray(roles.metrics)
    ? roles.metrics.map(String)
    : [];
  const firstGroup =
    (declaredGroup && groupColumns.find((column) => column.id === declaredGroup)) ||
    groupColumns[0];
  const metricColumns = declaredMetrics.length
    ? declaredMetrics
        .map((id) => numeric.find((column) => column.id === id))
        .filter((column): column is DatabaseColumn => Boolean(column))
    : numeric;
  const selectedNumeric = metricColumns.length ? metricColumns : numeric;
  const selectedFirstNumeric = selectedNumeric[0] ?? firstNumeric;
  if (firstGroup && selectedFirstNumeric) {
    const cohortStep: DatabaseResearchStep = {
      id: `cohort-comparison-${firstGroup.id}-${selectedFirstNumeric.id}`,
      operation: "cohortComparison",
      groupColumnId: firstGroup.id,
      columnId: selectedFirstNumeric.id,
      role: "associational",
      options: { maxPairs: 28, alpha: 0.05 },
    };
    // Cohort tests are always label-vs-metric aligned. They are never
    // generated for two arbitrary numeric columns.
    addPriority(cohortStep);
  }
  if (reportType === "cohort_comparison" && firstGroup) {
    for (const metric of selectedNumeric.slice(0, 24)) {
      addPriority({
        id: `cohort-comparison-${firstGroup.id}-${metric.id}`,
        operation: "cohortComparison",
        groupColumnId: firstGroup.id,
        columnId: metric.id,
        role: "associational",
        options: { maxPairs: 28, alpha: 0.05 },
      });
      addPriority({
        id: `cohort-group-${firstGroup.id}-${metric.id}`,
        operation: "groupBy",
        groupColumnId: firstGroup.id,
        columnId: metric.id,
        role: "descriptive",
      });
    }
  }
  if (reportType === "temporal_anomalies") {
    for (const metric of selectedNumeric.slice(0, 24)) {
      const timeColumnId = typeof roles.time === "string" ? roles.time : undefined;
      addPriority({
        id: `temporal-audit-${metric.id}`,
        operation: "temporalAudit",
        columnId: metric.id,
        timeColumnId,
        role: "associational",
      });
      addPriority({
        id: `temporal-acf-${metric.id}`,
        operation: "acf",
        columnId: metric.id,
        timeColumnId,
        role: "associational",
        options: { maxLag: Math.min(60, Math.max(1, 12)) },
      });
      addPriority({
        id: `temporal-changepoints-${metric.id}`,
        operation: "changePoints",
        columnId: metric.id,
        timeColumnId,
        role: "associational",
      });
    }
  }
  if (reportType === "privacy_attachments") {
    for (const column of columns.filter((candidate) =>
      ["email", "phone", "url", "person", "location", "files", "attachment", "ai_image"].includes(candidate.type),
    ).slice(0, 24)) {
      addPriority({
        id: `privacy-missing-${column.id}`,
        operation: "missingness",
        columnId: column.id,
        role: "descriptive",
      });
      if (!["files", "attachment", "ai_image"].includes(column.type))
        addPriority({
          id: `privacy-frequency-${column.id}`,
          operation: "frequencies",
          columnId: column.id,
          role: "descriptive",
        });
      if (["files", "attachment", "ai_image"].includes(column.type))
        addPriority({ id: `attachment-audit-${column.id}`, operation: "attachmentAudit", columnId: column.id, role: "descriptive" });
    }
    for (const column of columns.filter((candidate) => ["text", "rich_text", "title", "ai"].includes(candidate.type)).slice(0, 12))
      addPriority({ id: `text-audit-${column.id}`, operation: "textAudit", columnId: column.id, role: "descriptive" });
    for (const column of columns.filter((candidate) => candidate.type === "location").slice(0, 12))
      addPriority({ id: `geo-audit-${column.id}`, operation: "geoAudit", columnId: column.id, role: "descriptive" });
    addPriority({ id: "privacy-quality-audit", operation: "qualityAudit", role: "descriptive" });
  }
  if (reportType === "data_quality") {
    addPriority({ id: "quality-audit", operation: "qualityAudit", role: "descriptive" });
    for (let i = 0; i < Math.min(groupColumns.length, 6); i++)
      for (let j = i + 1; j < Math.min(groupColumns.length, 6); j++)
        addPriority({ id: `chi-square-${groupColumns[i].id}-${groupColumns[j].id}`, operation: "chiSquare", xColumnId: groupColumns[i].id, yColumnId: groupColumns[j].id, role: "associational" });
    for (const column of columns.filter((candidate) => ["text", "rich_text", "title", "ai"].includes(candidate.type)).slice(0, 12))
      addPriority({ id: `quality-text-${column.id}`, operation: "textAudit", columnId: column.id, role: "descriptive" });
    for (const column of columns.filter((candidate) => candidate.type === "location").slice(0, 12))
      addPriority({ id: `quality-geo-${column.id}`, operation: "geoAudit", columnId: column.id, role: "descriptive" });
    for (const column of columns.filter((candidate) => ["files", "attachment", "ai_image"].includes(candidate.type)).slice(0, 12))
      addPriority({ id: `quality-attachment-${column.id}`, operation: "attachmentAudit", columnId: column.id, role: "descriptive" });
  }
  if (reportType === "formulas_reconciliation") {
    for (const column of columns.filter((candidate) =>
      ["formula", "rollup", "comparison"].includes(candidate.type),
    ).slice(0, 24))
      addPriority({
        id: `formula-describe-${column.id}`,
        operation: "describe",
        columnId: column.id,
        role: "descriptive",
      });
    if (relation) addPriority({ id: `formula-relation-${relation.id}`, operation: "relationGraph", columnId: relation.id, role: "graph" });
    addPriority({ id: "formula-audit", operation: "formulaAudit", role: "descriptive" });
  }
  if (reportType === "relationships_integrity")
    for (const relationColumn of columns.filter((column) => column.type === "relation").slice(0, 48)) {
      addPriority({ id: `integrity-relation-${relationColumn.id}`, operation: "relationIntegrity", columnId: relationColumn.id, role: "graph" });
      addPriority({ id: `integrity-graph-${relationColumn.id}`, operation: "relationGraph", columnId: relationColumn.id, role: "graph" });
    }
  // A planner may rank allow-listed operations, but never create a new one or
  // remove a mandatory role-gated operation. This keeps model contribution
  // useful and bounded by deterministic validation.
  const requestedOperations = Array.isArray(plannerOutput?.requestedOperations)
    ? plannerOutput.requestedOperations.map(String)
    : [];
  const ranked = requestedOperations.filter((operation) =>
    DATABASE_RESEARCH_OPERATIONS.includes(operation as DatabaseResearchOperation),
  );
  const allSteps = [...prioritySteps, ...steps];
  const rankedSteps = ranked.flatMap((operation) =>
    allSteps.filter((step) => step.operation === operation),
  );
  const ordered = [...prioritySteps, ...customSteps, ...rankedSteps, ...steps].filter(
    (step, index, list) => list.findIndex((candidate) => candidate.id === step.id) === index,
  );
  // Role-gated estimands and graph integrity checks must never disappear merely
  // because a wide schema consumed the descriptive budget first.
  return { steps: ordered.slice(0, maxSteps) };
}

function databaseCellTypeCoverage(
  columns: DatabaseColumn[],
  includeAttachmentContent: boolean,
) {
  const binary = new Set(["files", "attachment", "ai_image"]);
  const metadata = new Set([
    "created_by",
    "last_edited_by",
    "created_time",
    "last_edited_time",
    "url",
    "email",
    "phone",
    "person",
    "unique_id",
  ]);
  return columns.map((column) => {
    if (column.type === "button")
      return {
        columnId: column.id,
        name: column.name,
        type: column.type,
        status: "not_analyzable" as const,
        reason: "Buttons are actions, not observational data.",
      };
    if (binary.has(column.type))
      return {
        columnId: column.id,
        name: column.name,
        type: column.type,
        status: (includeAttachmentContent ? "analyzed" : "metadata_only") as
          "analyzed" | "metadata_only",
        reason: includeAttachmentContent
          ? "Attachment content consented explicitly."
          : "Only MIME, size, availability and duplicate metadata may be analyzed.",
      };
    if (metadata.has(column.type))
      return {
        columnId: column.id,
        name: column.name,
        type: column.type,
        status: "metadata_only" as const,
        reason: "Sensitive values are redacted in report prose.",
      };
    return {
      columnId: column.id,
      name: column.name,
      type: column.type,
      status: "analyzed" as const,
    };
  });
}

function artifactLedger(
  evidence: DatabaseResearchEvidence[],
  seed: number,
  filters: unknown,
) {
  return evidence.map((item) => {
    const warnings = artifactWarnings(item.value);
    if (!evidenceIsUsable(item))
      warnings.unshift("Artifact is empty or failed deterministic validation.");
    return {
      id: item.stepId,
      method: item.operation,
      inputs: {
        columnIds: item.columnIds,
        rowScope: "all_filtered_rows",
        rowIdsRedacted: true,
      },
      output: item.value,
      seed,
      n: item.n,
      denominator: item.denominator ?? item.n,
      filters:
        filters && typeof filters === "object"
          ? filters
          : { query: "", columnIds: [] },
      hash: item.hash,
      warnings,
    };
  });
}

function compactJson(value: unknown, limit = 2_400): string {
  const rendered = JSON.stringify(value) ?? "null";
  return rendered.length <= limit ? rendered : `${rendered.slice(0, limit)}…`;
}

function deterministicReportMarkdown(
  title: string,
  objective: string,
  snapshot: DatabaseResearchSnapshot,
  evidence: DatabaseResearchEvidence[],
  coverage: ReturnType<typeof databaseCellTypeCoverage>,
  fingerprint: string,
  language: string = "es",
  reportType: DatabaseDeepResearchReportType = "general",
): string {
  const labels = DATABASE_DEEP_RESEARCH_SECTION_LABELS[
    language as keyof typeof DATABASE_DEEP_RESEARCH_SECTION_LABELS
  ] ?? DATABASE_DEEP_RESEARCH_SECTION_LABELS.en;
  const copy = DATABASE_DEEP_RESEARCH_REPORT_COPY[
    language as keyof typeof DATABASE_DEEP_RESEARCH_REPORT_COPY
  ] ?? DATABASE_DEEP_RESEARCH_REPORT_COPY.en;
  const by = (operations: DatabaseResearchOperation[]) =>
    evidence.filter((item) => operations.includes(item.operation));
  const list = (items: DatabaseResearchEvidence[]) =>
    items.length
      ? items
          .map(
            (item) =>
              `- **${item.stepId}** · ${copy.method} \`${item.operation}\` · n=${item.n} · hash \`${item.hash}\`\n  - ${copy.result}: \`${compactJson(sanitizeDatabaseResearchExternal(item.value))}\``,
          )
          .join("\n")
      : `- ${copy.noEvidence}`;
  const formulaLineage =
    coverage
      .filter((item) => ["formula", "rollup", "relation"].includes(item.type))
      .map((item) => `- ${item.name}: ${item.type} · ${item.status}`)
      .join("\n") || `- ${copy.noFormulas}`;
  const specs: Record<DatabaseDeepResearchReportType, Array<{ key: keyof typeof labels; operations: DatabaseResearchOperation[] }>> = {
    general: [
      { key: "hidden", operations: ["correlation", "linearRegression", "logisticRegression", "simpson", "pca", "changePoints", "cohortComparison"] },
      { key: "quality", operations: ["missingness", "qualityAudit", "textAudit", "geoAudit", "attachmentAudit"] as DatabaseResearchOperation[] },
      { key: "statistics", operations: ["describe", "robustSummary", "trimmedMean", "bootstrap", "permutation", "effectSizes", "welchT", "mannWhitney", "kruskalWallis", "cohortComparison", "chiSquare", "vif", "pca", "multipleTesting"] as DatabaseResearchOperation[] },
      { key: "temporal", operations: ["temporalAudit", "changePoints", "acf"] },
      { key: "relations", operations: ["relationGraph", "relationIntegrity"] as DatabaseResearchOperation[] },
      { key: "sensitive", operations: ["kaplanMeier", "logRank", "coxPH", "ipw", "simpson"] },
      { key: "formulas", operations: [] },
      { key: "coverage", operations: [] },
      { key: "sensitivity", operations: ["bootstrap", "permutation", "multipleTesting"] },
    ],
    data_quality: [
      { key: "quality", operations: ["missingness", "qualityAudit", "textAudit", "geoAudit", "attachmentAudit"] as DatabaseResearchOperation[] },
      { key: "statistics", operations: ["describe", "robustSummary", "effectSizes", "chiSquare", "multipleTesting"] as DatabaseResearchOperation[] },
      { key: "relations", operations: ["relationGraph", "relationIntegrity"] as DatabaseResearchOperation[] },
      { key: "coverage", operations: [] },
    ],
    cohort_comparison: [
      { key: "statistics", operations: ["cohortComparison", "welchT", "mannWhitney", "kruskalWallis", "effectSizes", "chiSquare", "multipleTesting"] as DatabaseResearchOperation[] },
      { key: "hidden", operations: ["simpson", "correlation"] },
      { key: "sensitivity", operations: ["bootstrap", "permutation", "multipleTesting"] },
    ],
    temporal_anomalies: [
      { key: "temporal", operations: ["temporalAudit", "changePoints", "acf"] },
      { key: "statistics", operations: ["describe", "robustSummary", "bootstrap"] },
      { key: "quality", operations: ["missingness"] },
    ],
    relationships_integrity: [
      { key: "relations", operations: ["relationGraph", "relationIntegrity"] as DatabaseResearchOperation[] },
      { key: "formulas", operations: [] },
      { key: "quality", operations: ["missingness"] },
    ],
    causal_impact: [
      { key: "sensitive", operations: ["ipw", "simpson"] },
      { key: "statistics", operations: ["effectSizes", "multipleTesting"] },
      { key: "quality", operations: ["missingness"] },
    ],
    survival_retention: [
      { key: "sensitive", operations: ["kaplanMeier", "logRank", "coxPH"] },
      { key: "quality", operations: ["missingness"] },
      { key: "sensitivity", operations: ["bootstrap", "multipleTesting"] },
    ],
    privacy_attachments: [
      { key: "quality", operations: ["missingness", "attachmentAudit", "textAudit"] as DatabaseResearchOperation[] },
      { key: "coverage", operations: [] },
      { key: "relations", operations: ["relationGraph"] },
    ],
    formulas_reconciliation: [
      { key: "formulas", operations: ["formulaAudit"] as DatabaseResearchOperation[] },
      { key: "relations", operations: ["relationGraph", "relationIntegrity"] as DatabaseResearchOperation[] },
      { key: "quality", operations: ["missingness"] },
    ],
  };
  const sections = specs[reportType] ?? specs.general;
  const renderedSections = sections.map(({ key, operations }) => {
    const content = key === "formulas"
      ? [formulaLineage, list(by(operations))].filter(Boolean).join("\n\n")
      : key === "coverage"
        ? coverage.map((item) => `- **${item.name}** (${item.type}): ${item.status}${item.reason ? ` — ${item.reason}` : ""}`).join("\n")
        : list(by(operations));
    return `## ${labels[key]}\n\n${content || `- ${copy.noSectionEvidence}`}`;
  }).join("\n\n");
  return `# ${title}\n\n## ${labels.summary}\n\n**${copy.objective}:** ${objective}\n\n${copy.snapshot} **${snapshot.rowCount} / ${snapshot.totalRowCount}**.\n\n${renderedSections}\n\n## ${labels.reproducibility}\n\n- ${copy.fingerprint}: \`${fingerprint}\`\n- ${copy.snapshotHash}: \`${snapshot.hash}\`\n- ${copy.allFigures}\n- ${copy.model}\n`;
}

function structuredReportSections(
  markdown: string,
): Array<{ id: string; title: string; markdown: string }> {
  const sections: Array<{ id: string; title: string; markdown: string }> = [];
  const matches = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  for (let index = 0; index < matches.length; index++) {
    const title = matches[index][1].trim();
    const start = (matches[index].index ?? 0) + matches[index][0].length;
    const end = matches[index + 1]?.index ?? markdown.length;
    const id =
      title
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `section-${index + 1}`;
    sections.push({ id, title, markdown: markdown.slice(start, end).trim() });
  }
  return sections;
}

function structuredReportCharts(
  evidence: DatabaseResearchEvidence[],
  language = "es",
): Array<{ id: string; title: string; data: unknown }> {
  const labels = DATABASE_DEEP_RESEARCH_SECTION_LABELS[
    language as keyof typeof DATABASE_DEEP_RESEARCH_SECTION_LABELS
  ] ?? DATABASE_DEEP_RESEARCH_SECTION_LABELS.en;
  const missingness = evidence
    .filter((item) => item.operation === "missingness")
    .map((item) => ({
      artifactId: item.stepId,
      columnId: item.columnIds[0] ?? null,
      rate: Number((item.value as Record<string, unknown> | null)?.rate),
      value: Number((item.value as Record<string, unknown> | null)?.rate),
      n: item.n,
    }))
    .filter((item) => Number.isFinite(item.rate));
  const robust = evidence
    .filter((item) => item.operation === "robustSummary")
    .map((item) => ({
      artifactId: item.stepId,
      columnId: item.columnIds[0] ?? null,
      median: Number((item.value as Record<string, unknown> | null)?.median),
      value: Number((item.value as Record<string, unknown> | null)?.median),
      mad: Number((item.value as Record<string, unknown> | null)?.mad),
      n: item.n,
    }))
    .filter((item) => Number.isFinite(item.median));
  const cohort = evidence.flatMap((item) => item.operation !== "cohortComparison" ? [] :
    (Array.isArray((item.value as { groups?: unknown[] } | null)?.groups)
      ? ((item.value as { groups: Array<Record<string, unknown>> }).groups).map((group, index) => ({
          artifactId: item.stepId,
          label: `cohort-${index + 1}`,
          value: Number(group.mean),
          n: Number(group.count),
        })).filter((point) => Number.isFinite(point.value))
      : []));
  const autocorrelation = evidence.flatMap((item) => item.operation !== "acf" ? [] :
    (Array.isArray((item.value as { values?: unknown[] } | null)?.values)
      ? ((item.value as { values: unknown[] }).values).map((value, index) => ({ artifactId: item.stepId, label: `lag-${index}`, value: Number(value), n: item.n })).filter((point) => Number.isFinite(point.value))
      : []));
  const temporalDiagnosticsChart = evidence.flatMap((item) => {
    if (item.operation !== "temporalAudit") return [];
    const value = item.value as Record<string, unknown> | null;
    const trend = value?.trend as Record<string, unknown> | undefined;
    const seasonality = value?.seasonality as Record<string, unknown> | undefined;
    const drift = value?.drift as Record<string, unknown> | undefined;
    const rolling = value?.rollingOrigin as Record<string, unknown> | undefined;
    return [
      { artifactId: item.stepId, label: "trend slope/day", value: Number(trend?.slopePerDay), n: item.n },
      { artifactId: item.stepId, label: "seasonality strength", value: Number(seasonality?.strength), n: item.n },
      { artifactId: item.stepId, label: "standardized drift", value: Number(drift?.standardizedDifference), n: item.n },
      { artifactId: item.stepId, label: "rolling-origin RMSE", value: Number(rolling?.rmse), n: Number(rolling?.folds) },
    ].filter((point) => Number.isFinite(point.value));
  });
  const survival = evidence.flatMap((item) => item.operation !== "kaplanMeier" ? [] :
    (Array.isArray((item.value as { points?: unknown[] } | null)?.points)
      ? ((item.value as { points: Array<Record<string, unknown>> }).points).map((point) => ({ artifactId: item.stepId, label: String(point.time), value: Number(point.survival), n: Number(point.atRisk) })).filter((entry) => Number.isFinite(entry.value))
      : []));
  const integrity = evidence.flatMap((item) => {
    if (item.operation !== "relationIntegrity") return [];
    const value = item.value as Record<string, unknown> | null;
    return ["externalTargetCount", "orphanTargetCount", "duplicateEdges", "manyToManySources"].map((key) => ({ artifactId: item.stepId, label: key, value: Number(value?.[key]), n: item.n })).filter((point) => Number.isFinite(point.value));
  });
  const causal = evidence.flatMap((item) => {
    if (item.operation !== "ipw") return [];
    const value = item.value as Record<string, unknown> | null;
    const overlap = value?.overlap as Record<string, unknown> | undefined;
    return [
      { artifactId: item.stepId, label: "ATE", value: Number(value?.estimate), n: item.n },
      { artifactId: item.stepId, label: "overlap", value: Number(overlap?.fraction), n: item.n },
    ].filter((point) => Number.isFinite(point.value));
  });
  return [
    ...(missingness.length
      ? [
          {
            id: "missingness",
            title: `${labels.quality} · missingness`,
            data: missingness,
          },
        ]
      : []),
    ...(robust.length
      ? [
          {
            id: "robust-summary",
            title: `${labels.statistics} · robustSummary`,
            data: robust,
          },
        ]
      : []),
    ...(cohort.length ? [{ id: "cohort-comparison", title: `${labels.statistics} · cohortComparison`, data: cohort }] : []),
    ...(autocorrelation.length ? [{ id: "autocorrelation", title: `${labels.temporal} · ACF`, data: autocorrelation }] : []),
    ...(temporalDiagnosticsChart.length ? [{ id: "temporal-diagnostics", title: `${labels.temporal} · diagnostics`, data: temporalDiagnosticsChart }] : []),
    ...(survival.length ? [{ id: "survival", title: `${labels.sensitive} · Kaplan–Meier`, data: survival }] : []),
    ...(integrity.length ? [{ id: "relationship-integrity", title: `${labels.relations} · integrity`, data: integrity }] : []),
    ...(causal.length ? [{ id: "causal-diagnostics", title: `${labels.sensitive} · IPW`, data: causal }] : []),
  ];
}

function artifactWarnings(value: unknown, depth = 0): string[] {
  if (depth > 5 || value == null || typeof value !== "object") return [];
  const warnings: string[] = [];
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/^warnings?$/i.test(key)) {
      if (typeof item === "string" && item.trim()) warnings.push(item.trim());
      if (Array.isArray(item))
        warnings.push(
          ...item
            .filter(
              (entry): entry is string =>
                typeof entry === "string" && Boolean(entry.trim()),
            )
            .map((entry) => entry.trim()),
        );
    } else warnings.push(...artifactWarnings(item, depth + 1));
  }
  return [...new Set(warnings)];
}

function hasCalculationFailure(value: unknown, depth = 0): boolean {
  if (depth > 7) return false;
  if (typeof value === "number") return !Number.isFinite(value);
  if (value == null || typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      /^(?:error|failed|valid)$/i.test(key) &&
      (key.toLocaleLowerCase() === "valid" ? item === false : Boolean(item))
    )
      return true;
    if (hasCalculationFailure(item, depth + 1)) return true;
  }
  return false;
}

function evidenceIsUsable(
  artifact: Pick<DatabaseResearchEvidence, "n" | "value">,
): boolean {
  return (
    Number.isFinite(artifact.n) &&
    artifact.n > 0 &&
    !hasCalculationFailure(artifact.value)
  );
}

function artifactClaimStatus(
  operation: DatabaseResearchOperation,
  artifact?: Pick<DatabaseResearchEvidence, "n" | "value">,
): "verified" | "sensitive" | "exploratory" | "unverifiable" {
  if (artifact && !evidenceIsUsable(artifact)) return "unverifiable";
  const warnings = artifact ? artifactWarnings(artifact.value) : [];
  if (
    warnings.some((warning) =>
      /insufficient|not enough|failed|error|non[- ]?converg/i.test(warning),
    )
  )
    return "unverifiable";
  if (warnings.length) return "sensitive";
  if (["kaplanMeier", "logRank", "coxPH", "ipw", "simpson"].includes(operation))
    return "sensitive";
  if (
    [
      "correlation",
      "linearRegression",
      "logisticRegression",
      "pca",
      "changePoints",
      "acf",
      "relationGraph",
      "chiSquare",
    ].includes(operation)
  )
    return "exploratory";
  return "verified";
}

function modelOutputDigest(text: string): { sha256: string; length: number } {
  return {
    sha256: bytesToHex(sha256(new TextEncoder().encode(text))),
    length: text.length,
  };
}

/** Parse an agent response without ever trusting it as evidence. The parser
 * accepts fenced JSON for provider ergonomics, but callers still validate each
 * field and intersect every choice with the deterministic allow-list. */
function parseAgentJson(text: string): Record<string, unknown> | null {
  const source = String(text ?? "").trim();
  if (!source) return null;
  const unfenced = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed: unknown = JSON.parse(unfenced);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function boundedStringList(value: unknown, max = 24): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 500))
        .filter(Boolean)
        .slice(0, max)
    : [];
}

function safePlannerOutput(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  const requestedOperations =
    value.requestedOperations ?? value.operations ?? value.analyses;
  return {
    questions: boundedStringList(value.questions),
    hypotheses: boundedStringList(value.hypotheses),
    priorities: boundedStringList(value.priorities),
    risks: boundedStringList(value.risks),
    requestedOperations: Array.isArray(requestedOperations)
      ? requestedOperations.map((item) =>
          typeof item === "string"
            ? item
            : item && typeof item === "object"
              ? String((item as Record<string, unknown>).operation ?? "")
              : "",
        ).filter(Boolean).slice(0, 24)
      : [],
  };
}

type SafeCriticOutput = {
  verdict: "accept" | "revise" | "reject";
  sensitivities: string[];
  issues: Array<{ severity: "low" | "medium" | "high"; artifactRefs: string[] }>;
};

function safeCriticOutput(
  value: Record<string, unknown> | null,
  evidence: DatabaseResearchEvidence[],
): SafeCriticOutput | null {
  if (!value || !isDatabaseDeepResearchCriticOutput(value)) return null;
  const known = new Set(evidence.flatMap((item) => [item.stepId, item.hash]));
  return {
    verdict: value.verdict,
    sensitivities: boundedStringList(value.sensitivities, 16)
      .filter((operation): operation is DatabaseResearchOperation => DETERMINISTIC_SENSITIVITY_OPERATIONS.has(operation as DatabaseResearchOperation)),
    issues: value.issues.slice(0, 64).map((issue) => ({
      severity: issue.severity,
      artifactRefs: issue.artifactRefs.filter((ref) => known.has(ref)).slice(0, 16),
    })),
  };
}

type SafeVerifierOutput = {
  accepted: boolean;
  claims: Array<{ claimId: string; status: "verified" | "sensitive" | "exploratory" | "unverifiable"; artifactRefs: string[]; reason: string }>;
};

function safeVerifierOutput(
  value: Record<string, unknown> | null,
  evidence: DatabaseResearchEvidence[],
): SafeVerifierOutput | null {
  if (!value || !isDatabaseDeepResearchVerifierOutput(value)) return null;
  const known = new Set(evidence.flatMap((item) => [item.stepId, item.hash]));
  return {
    accepted: value.accepted,
    claims: value.claims.slice(0, 500).map((claim) => ({
      claimId: claim.claimId.slice(0, 300),
      status: claim.status,
      artifactRefs: claim.artifactRefs.filter((ref) => known.has(ref)).slice(0, 16),
      reason: claim.reason.slice(0, 500),
    })),
  };
}

type NarrativeParagraph = {
  textTemplate: string;
  artifactRefs: string[];
  claimClass: "verified" | "sensitive" | "exploratory" | "unverifiable";
};
type NarrativeAst = {
  title: string;
  summary: string;
  sections: Array<{ heading: string; paragraphs: NarrativeParagraph[] }>;
};

function narrativeAstFromModel(
  value: Record<string, unknown> | null,
  evidence: DatabaseResearchEvidence[],
): NarrativeAst | null {
  if (!value || !Array.isArray(value.sections)) return null;
  const known = new Set(evidence.flatMap((item) => [item.stepId, item.hash]));
  const byRef = new Map(
    evidence.flatMap((item) => [[item.stepId, item] as const, [item.hash, item] as const]),
  );
  const validPlaceholder = (ref: string, path: string): boolean => {
    const artifact = byRef.get(ref);
    if (!artifact || !evidenceIsUsable(artifact)) return false;
    const resolved = pathValue(artifact.value, path);
    return (typeof resolved === "number" && Number.isFinite(resolved)) || typeof resolved === "boolean";
  };
  const sections: NarrativeAst["sections"] = [];
  for (const rawSection of value.sections.slice(0, 20)) {
    if (!rawSection || typeof rawSection !== "object") continue;
    const section = rawSection as Record<string, unknown>;
    const paragraphs: NarrativeParagraph[] = [];
    for (const rawParagraph of (Array.isArray(section.paragraphs) ? section.paragraphs : []).slice(0, 24)) {
      if (!rawParagraph || typeof rawParagraph !== "object") continue;
      const paragraph = rawParagraph as Record<string, unknown>;
      const textTemplate = typeof paragraph.textTemplate === "string" ? paragraph.textTemplate.trim().slice(0, 2_000) : "";
      const refs = boundedStringList(paragraph.artifactRefs, 16);
      const claimClass = paragraph.claimClass;
      if (!textTemplate || !refs.length || refs.some((ref) => !known.has(ref))) continue;
      const placeholders = [...textTemplate.matchAll(/\{\{artifact:([^:}]+):([^}]+)\}\}/g)];
      if (!placeholders.length || placeholders.some((match) => !known.has(match[1]) || !validPlaceholder(match[1], match[2]))) continue;
      const placeholderRefs = new Set(placeholders.map((match) => match[1]));
      if (refs.some((ref) => !placeholderRefs.has(ref)) || [...placeholderRefs].some((ref) => !refs.includes(ref))) continue;
      // Quantitative values must be resolved by the host from placeholders.
      // This rejects invented digits, percentages, p-values and dates while
      // retaining natural-language interpretation from the model.
      const withoutPlaceholders = textTemplate.replace(/\{\{artifact:[^}]+\}\}/g, "");
      if (/\d/.test(withoutPlaceholders)) continue;
      if (!["verified", "sensitive", "exploratory", "unverifiable"].includes(String(claimClass))) continue;
      const statuses = refs.map((ref) => {
        const artifact = byRef.get(ref)!;
        return artifactClaimStatus(artifact.operation, artifact);
      });
      const strongestAllowed = statuses.includes("unverifiable")
        ? "unverifiable"
        : statuses.includes("exploratory")
          ? "exploratory"
          : statuses.includes("sensitive")
            ? "sensitive"
            : "verified";
      const strength = { unverifiable: 0, exploratory: 1, sensitive: 2, verified: 3 } as const;
      if (strength[claimClass as keyof typeof strength] > strength[strongestAllowed]) continue;
      paragraphs.push({ textTemplate, artifactRefs: refs, claimClass: claimClass as NarrativeParagraph["claimClass"] });
    }
    const heading = typeof section.heading === "string" ? section.heading.trim().slice(0, 300) : "";
    if (heading && !/\d/.test(heading.replace(/\{\{artifact:[^}]+\}\}/g, "")) && paragraphs.length) sections.push({ heading, paragraphs });
  }
  if (!sections.length) return null;
  const title = typeof value.title === "string" ? value.title.trim().slice(0, 300) : "";
  const summary = typeof value.summary === "string" ? value.summary.trim().slice(0, 2_000) : "";
  if (/\d/.test(title.replace(/\{\{artifact:[^}]+\}\}/g, "")) || /\d/.test(summary.replace(/\{\{artifact:[^}]+\}\}/g, ""))) return null;
  const summaryPlaceholders = [...summary.matchAll(/\{\{artifact:([^:}]+):([^}]+)\}\}/g)];
  if (summary && (!summaryPlaceholders.length || summaryPlaceholders.some((match) => !validPlaceholder(match[1], match[2])))) return null;
  return {
    title,
    summary,
    sections,
  };
}

/** Public testable gate used by the quality harness. It intentionally returns
 * null for any narrative that cannot be rendered from approved artifacts. */
export function validateDatabaseResearchNarrative(
  value: unknown,
  evidence: DatabaseResearchEvidence[],
): NarrativeAst | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? narrativeAstFromModel(value as Record<string, unknown>, evidence)
    : null;
}

export function renderDatabaseResearchNarrative(
  ast: NarrativeAst,
  evidence: DatabaseResearchEvidence[],
  language = "es",
): string {
  const byRef = new Map(evidence.flatMap((item) => [[item.stepId, item], [item.hash, item]]));
  const resolve = (template: string): string => template.replace(/\{\{artifact:([^:}]+):([^}]+)\}\}/g, (_match, ref: string, path: string) => {
    const artifact = byRef.get(ref);
    if (!artifact) return "[evidencia no disponible]";
    const value = pathValue(artifact.value, path);
    return typeof value === "number" && Number.isFinite(value)
      ? new Intl.NumberFormat(language, { maximumFractionDigits: 6 }).format(value)
      : typeof value === "boolean"
        ? String(value)
        : "[dato no numérico omitido]";
  });
  const sections = ast.sections.map((section) => `## ${section.heading}\n\n${section.paragraphs.map((paragraph) => `- ${resolve(paragraph.textTemplate)}`).join("\n")}`).join("\n\n");
  return `${ast.title ? `# ${ast.title}\n\n` : ""}${ast.summary ? `${resolve(ast.summary)}\n\n` : ""}${sections}`;
}

function firstFiniteMetric(
  value: unknown,
  keys: Set<string>,
  depth = 0,
): number | null {
  if (depth > 5 || value == null || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key) && typeof item === "number" && Number.isFinite(item))
      return item;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = firstFiniteMetric(item, keys, depth + 1);
    if (found != null) return found;
  }
  return null;
}

function optionsForSource(
  options: Record<string, unknown>,
  columns: DatabaseColumn[],
  sourceIndex: number,
): Record<string, unknown> {
  const known = new Set(columns.map((column) => column.id));
  const roles =
    options.roles && typeof options.roles === "object"
      ? (options.roles as Record<string, unknown>)
      : {};
  const scopedRoles: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(roles)) {
    if (Array.isArray(value))
      scopedRoles[key] = value.map(String).filter((id) => known.has(id));
    else if (typeof value === "string" && known.has(value))
      scopedRoles[key] = value;
  }
  const candidate = options.researchPlan ?? options.plan;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !Array.isArray((candidate as Record<string, unknown>).steps)
  )
    return { ...options, roles: scopedRoles };
  const steps = (
    (candidate as Record<string, unknown>).steps as DatabaseResearchStep[]
  ).filter((step) => {
    const ids = columnIds(step);
    return ids.length ? ids.every((id) => known.has(id)) : sourceIndex === 0;
  });
  return {
    ...options,
    roles: scopedRoles,
    researchPlan: { steps },
    plan: { steps },
  };
}

function assertSensitiveRoleContracts(
  steps: DatabaseResearchStep[],
  scopedOptions: Record<string, unknown>,
): void {
  const roles =
    scopedOptions.roles && typeof scopedOptions.roles === "object"
      ? (scopedOptions.roles as Record<string, unknown>)
      : {};
  const duration = typeof roles.duration === "string" ? roles.duration : null;
  const event = typeof roles.event === "string" ? roles.event : null;
  const outcome = typeof roles.outcome === "string" ? roles.outcome : null;
  const treatment =
    typeof roles.treatment === "string" ? roles.treatment : null;
  const confounders = new Set(
    Array.isArray(roles.confounders) ? roles.confounders.map(String) : [],
  );
  const group = typeof roles.group === "string" ? roles.group : null;
  for (const step of steps) {
    if (
      ["kaplanMeier", "logRank", "coxPH"].includes(step.operation) &&
      (step.xColumnId !== duration || step.yColumnId !== event)
    ) {
      throw new Error(
        `${step.operation} requires explicit duration and event semantic roles matching its columns.`,
      );
    }
    if (
      ["ipw", "simpson"].includes(step.operation) &&
      (step.xColumnId !== treatment || step.yColumnId !== outcome)
    ) {
      throw new Error(
        `${step.operation} requires explicit treatment and outcome semantic roles matching its columns.`,
      );
    }
    if (step.operation === "coxPH" || step.operation === "ipw") {
      const covariates = step.columns ?? [];
      if (!covariates.length || covariates.some((id) => !confounders.has(id)))
        throw new Error(
          `${step.operation} requires declared confounder columns.`,
        );
    }
    if (step.operation === "logRank") {
      if (!step.groupColumnId || step.groupColumnId !== group)
        throw new Error(
          "logRank requires the explicit grouping semantic role.",
        );
    }
    if (step.operation === "simpson") {
      if (!step.groupColumnId || !confounders.has(step.groupColumnId))
        throw new Error(
          "simpson requires a declared confounder grouping column.",
        );
    }
  }
}

/** The same evidence/narrative pipeline runs on a Desktop SQLite snapshot or
 * explicitly downloaded device data. Storage and workers are supplied by the host. */
export type DatabaseResearchRepository = Pick<typeof import('../electron/db/databaseDeepResearchRepo'),
"getDatabaseResearchRun" | "getDatabaseResearchRunDetail" | "finalizeDatabaseResearchCancellation" | "updateDatabaseResearchProgress" | "markDatabaseResearchRunStale" | "updateDatabaseResearchRun" | "upsertDatabaseResearchStep" | "saveDatabaseResearchClaim" | "saveDatabaseResearchReport" | "failDatabaseResearchRun">;
export interface DatabaseResearchSource {
  snapshot: DatabaseResearchSnapshot; columns: DatabaseColumn[]; viewId: string | null; viewRevision: number | null;
}
export interface DatabaseResearchHost {
  repository: DatabaseResearchRepository;
  probeKind: 'sqlite' | 'device-downloads';
  readColumns: (databaseId:string)=>DatabaseColumn[];
  listViews: (databaseId:string)=>import('./databases').DatabaseSavedView[];
  captureSnapshot: (databaseId:string,budget:DatabaseResearchBudget,deps:DatabaseDeepResearchDeps|undefined,scope:DatabaseResearchScope)=>DatabaseResearchSnapshot;
  relationEdges: (databaseId:string,rows:DatabaseRow[],columnId?:string,allowedTargets?:ReadonlySet<string>)=>DatabaseResearchSnapshot['relationEdges'];
  immutable: <T>(databaseIds:string[],capture:()=>T)=>{rowCounts:Record<string,number>;value:T};
  prepareAnalysis: (sources:DatabaseResearchSource[])=>{input:(index:number)=>DatabaseDeepResearchDeps;close:()=>void};
  analyze: (request:DatabaseDeepResearchRequest,deps:DatabaseDeepResearchDeps,claims:DatabaseResearchClaim[])=>Promise<DatabaseDeepResearchResult>;
}
function missingResearchSource(): never { throw new Error('A complete immutable research source must be supplied by the host.'); }
export async function processDatabaseResearchRun(
  runId: string,
  agents: DatabaseResearchAgentDeps,
  host: DatabaseResearchHost,
): Promise<DatabaseResearchRunDetailLike> {
  const researchRepo = host.repository;
  const {readColumns:getColumns,listViews,captureSnapshot:captureDatabaseResearchSnapshot,relationEdges:relationEdgesForRows} = host;
  const run = researchRepo.getDatabaseResearchRun(runId);
  if (!run) throw new Error("Database research run not found.");
  if (run.status === "cancelled" || run.status === "completed")
    return researchRepo.getDatabaseResearchRunDetail(
      runId,
    ) as DatabaseResearchRunDetailLike;
  const previousDetail = researchRepo.getDatabaseResearchRunDetail(runId);
  const previousCompleted = (kind: DatabaseResearchStepKind) =>
    previousDetail?.steps.find(
      (step) => step.kind === kind && step.status === "completed",
    ) ?? null;
  const options = run.options ?? {};
  // Persisted with the run, so resuming a job written before the control existed
  // reads back as 'auto' instead of throwing or silently changing length.
  const requestedSectionLength = normalizeDeepResearchSectionLength(options.sectionLength);
  const budget = (
    options.budget && typeof options.budget === "object" ? options.budget : {}
  ) as DatabaseResearchBudget;
  // `rounds` is an internal specialization/evaluation budget. Production has
  // one planner, critic, verifier and writer; exhaustive runs may spend one
  // bounded editor revision, never an open-ended loop.
  let modelCalls = 0;
  const maxModelCalls = 5;
  const maxCostUsd = Number((budget as Record<string, unknown>).maxCostUsd);
  const estimatedCostUsd = Number((budget as Record<string, unknown>).estimatedCostUsd);
  // Enforce the persisted conservative estimate before any provider call. It
  // is deliberately presented as an estimate because not every provider
  // exposes authoritative usage/pricing to Nodus.
  if (Number.isFinite(maxCostUsd)) {
    if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0)
      throw new Error("No se puede verificar el límite de coste de esta ejecución; vuelve a encolarla para reservar el presupuesto.");
    if (estimatedCostUsd > maxCostUsd)
      throw new Error(`La reserva conservadora ($${estimatedCostUsd.toFixed(2)}) supera el límite configurado ($${maxCostUsd.toFixed(2)}).`);
  }
  let reservedModelCostUsd = 0;
  const completeBounded = async (
    input: Parameters<NonNullable<DatabaseResearchAgentDeps["complete"]>>[0],
  ): Promise<string | null> => {
    if (!agents.complete || modelCalls >= maxModelCalls) return null;
    if (Number.isFinite(maxCostUsd)) {
      const maxTokens = input.role === "synthesizer" || input.role === "writer" || input.role === "editor" ? 5_200 : 1_800;
      // completeJson may make one bounded retry. Reserve both attempts at the
      // same conservative rate used by the queue estimate before starting the
      // call; no provider fallback or silent overrun is possible.
      const reservation = (maxTokens * 2 * 3.2) / 1_000_000;
      if (reservedModelCostUsd + reservation > maxCostUsd)
        throw new Error(`La reserva del siguiente agente ($${reservation.toFixed(4)}) supera el presupuesto restante.`);
      reservedModelCostUsd += reservation;
    }
    modelCalls += 1;
    return agents.complete(input);
  };
  const requestedDatabaseIds = [
    ...new Set(
      Array.isArray(options.databaseIds)
        ? options.databaseIds.map(String)
        : [run.databaseId],
    ),
  ];
  if (!requestedDatabaseIds.includes(run.databaseId))
    throw new Error(
      "The durable anchor database must be included in databaseIds.",
    );
  const seed = String(
    (budget as Record<string, unknown>).seed ?? options.seed ?? run.id,
  );
  let prepared: ReturnType<DatabaseResearchHost["prepareAnalysis"]> | undefined;
  const ensureNotCancelled = () => {
    const status = researchRepo.getDatabaseResearchRun(runId)?.status;
    if (status === "cancelling")
      researchRepo.finalizeDatabaseResearchCancellation(runId);
    if (status === "cancelled" || status === "cancelling")
      throw new Error("Database research run cancelled.");
  };
  const phaseProgress = (
    phase: DatabaseResearchStepKind,
    progress: number,
    message: string,
  ) => {
    ensureNotCancelled();
    const next = researchRepo.updateDatabaseResearchProgress(runId, {
      status: "running",
      step: phase,
      phase,
      progress,
      message,
    });
    agents.onProgress?.(next);
    return next;
  };
  try {
    phaseProgress("snapshot", 0.04, "Taking an immutable database snapshot.");
    const selectedViews = new Set(
      Array.isArray(options.viewIds) ? options.viewIds.map(String) : [],
    );
    const filters =
      options.filters && typeof options.filters === "object"
        ? (options.filters as { query?: unknown; columnIds?: unknown })
        : {};
    const immutable = host.immutable(requestedDatabaseIds, () => {
      const captured = requestedDatabaseIds.map((databaseId) => {
        const columns = getColumns(databaseId);
        const knownColumns = new Set(columns.map((column) => column.id));
        const selectedView = listViews(databaseId).find((view) =>
          selectedViews.has(view.id),
        );
        const viewId = selectedView?.id ?? null;
        const filterColumns = Array.isArray(filters.columnIds)
          ? filters.columnIds.map(String).filter((id) => knownColumns.has(id))
          : [];
        return {
          snapshot: captureDatabaseResearchSnapshot(
            databaseId,
            budget,
            undefined,
            {
              viewId,
              query: String(filters.query ?? ""),
              columnIds: filterColumns,
            },
          ),
          columns,
          viewId,
          viewRevision: selectedView?.revision ?? null,
        };
      });
      // Relations may point to rows in another selected database. Rebuild the
      // edge set only after every source row id is known, while the immutable
      // SQLite copy is still the active read context.
      if (captured.length > 1) {
        const allowedTargets = new Set(
          captured.flatMap(({ snapshot }) =>
            snapshot.rows.map((row) => row.id),
          ),
        );
        for (const source of captured) {
          source.snapshot.relationEdges = relationEdgesForRows(
            source.snapshot.databaseId,
            source.snapshot.rows,
            undefined,
            allowedTargets,
          );
          source.snapshot.hash = rehashDatabaseResearchSnapshot(
            source.snapshot,
          );
        }
      }
      return captured;
    });
    const sources = immutable.value;
    const snapshotFingerprint =
      sources.length === 1
        ? sources[0].snapshot.hash
        : sha256Snapshot(
            sources.map(({ snapshot }) => ({
              databaseId: snapshot.databaseId,
              hash: snapshot.hash,
            })),
          );
    if (
      run.snapshotFingerprint &&
      run.snapshotFingerprint !== snapshotFingerprint
    ) {
      researchRepo.markDatabaseResearchRunStale(
        runId,
        "Las fuentes cambiaron desde el snapshot persistido. Crea una regeneración para no mezclar revisiones.",
      );
      const stale = researchRepo.getDatabaseResearchRun(runId)!;
      agents.onProgress?.({
        runId,
        status: "stale",
        progress: stale.progress,
        step: stale.currentStep,
        phase: stale.phase,
        message: stale.error,
        error: stale.error,
      });
      return researchRepo.getDatabaseResearchRunDetail(
        runId,
      ) as DatabaseResearchRunDetailLike;
    }
    const canResume = Boolean(
      run.snapshotFingerprint &&
      run.snapshotFingerprint === snapshotFingerprint,
    );
    prepared = host.prepareAnalysis(sources);
    const snapshot: DatabaseResearchSnapshot = {
      ...sources[0].snapshot,
      databaseName: sources
        .map(({ snapshot: item }) => item.databaseName)
        .join(" + "),
      rowCount: sources.reduce(
        (sum, source) => sum + source.snapshot.rowCount,
        0,
      ),
      totalRowCount: sources.reduce(
        (sum, source) => sum + source.snapshot.totalRowCount,
        0,
      ),
      truncated: sources.some((source) => source.snapshot.truncated),
      columns: sources.flatMap((source) => source.snapshot.columns),
      rows: [],
      hash: snapshotFingerprint,
    };
    const cellTypeCoverage = sources.flatMap(
      ({ snapshot: sourceSnapshot, columns }) =>
        databaseCellTypeCoverage(
          columns,
          options.includeAttachmentContent === true,
        ).map((item) => ({
          ...item,
          databaseId: sourceSnapshot.databaseId,
          databaseName: sourceSnapshot.databaseName,
        })),
    );
    const sourceCoverage = sources.map(
      ({ snapshot: item, viewId, viewRevision }) => ({
        databaseId: item.databaseId,
        databaseName: item.databaseName,
        viewId,
        viewRevision,
        revision: item.revision,
        rowCount: item.rowCount,
        totalRowCount: item.totalRowCount,
        truncated: item.truncated,
        hash: item.hash,
      }),
    );
    const modelColumnTypes = Object.fromEntries(
      sources.flatMap(({ columns }) => columns.map((column) => [column.id, column.type])),
    );
    const modelContext: DatabaseResearchModelContext = {
      schema: sources.map(({ snapshot: item, columns }) => ({
        databaseId: item.databaseId,
        columns: columns.map((column) => ({ id: column.id, type: column.type })),
      })),
      semanticRoles: (options.roles && typeof options.roles === "object" ? options.roles : {}) as DatabaseResearchModelContext["semanticRoles"],
      rowCounts: Object.fromEntries(sources.map(({ snapshot: item }) => [item.databaseId, { captured: item.rowCount, total: item.totalRowCount, truncated: item.truncated }])),
      allowedOperations: [...DATABASE_RESEARCH_OPERATIONS],
      requestedOutline: Array.isArray(options.planSections)
        ? (options.planSections as Array<Record<string, unknown>>).slice(0, 50).map((section) => ({
            title: String(section.title ?? "").slice(0, 300),
            focus: String(section.focus ?? "").slice(0, 2_000),
          }))
        : [],
    };
    researchRepo.updateDatabaseResearchRun(runId, {
      snapshotManifest: {
        databaseIds: requestedDatabaseIds,
        rowCount: snapshot.rowCount,
        totalRowCount: snapshot.totalRowCount,
        truncated: snapshot.truncated,
        coverage: sourceCoverage,
        capturedAt: snapshot.capturedAt,
        readOnly: true,
        ...(host.probeKind === "sqlite"
          ? { sqliteReadonlyProbe: {rowCounts:immutable.rowCounts,verified:true} }
          : { downloadedSourceProbe: {rowCounts:immutable.rowCounts,verified:true} }),
      },
      snapshotFingerprint,
      budget: budget as Record<string, unknown>,
    });
    researchRepo.upsertDatabaseResearchStep({
      runId,
      kind: "snapshot",
      ordinal: 0,
      status: "completed",
      progress: 1,
      message: "Snapshot captured read-only.",
      output: { coverage: sourceCoverage, fingerprint: snapshotFingerprint },
      resultHash: snapshotFingerprint,
      seed: new SeededRandom(seed).seed,
    });
    phaseProgress(
      "semantic_profile",
      0.16,
      "Building deterministic semantic profile.",
    );
    const semanticSources = sources.map(({ snapshot: item, columns }) => ({
      databaseId: item.databaseId,
      databaseName: item.databaseName,
      columns: columns.map((column) => ({
        id: column.id,
        name: column.name,
        type: column.type,
      })),
    }));
    researchRepo.upsertDatabaseResearchStep({
      runId,
      kind: "semantic_profile",
      ordinal: 1,
      status: "completed",
      progress: 1,
      output: { sources: semanticSources, cellTypeCoverage },
      resultHash: sha256Snapshot({
        sources: semanticSources,
        cellTypeCoverage,
      }),
    });
    phaseProgress("planning", 0.25, "Validating the allow-listed plan.");
    const previousPlanning = canResume ? previousCompleted("planning") : null;
    const reportType = String(options.reportType ?? "general");
    let plannerSelection: Record<string, unknown> | null = null;
    let plannerOutput =
      previousPlanning?.output.plannerOutput &&
      typeof previousPlanning.output.plannerOutput === "object"
        ? previousPlanning.output.plannerOutput
        : null;
    if (previousPlanning?.output.plannerSelection && typeof previousPlanning.output.plannerSelection === "object")
      plannerSelection = previousPlanning.output.plannerSelection as Record<string, unknown>;
    if (!previousPlanning && agents.complete) {
      const rawPlanner = await completeBounded({
          role: "planner",
          objective: run.objective,
          evidence: [],
          model: run.model,
          reportType,
          language: run.language,
          columnTypes: modelColumnTypes,
          modelContext,
        });
      if (rawPlanner) {
        plannerSelection = safePlannerOutput(parseAgentJson(rawPlanner));
        plannerOutput = modelOutputDigest(rawPlanner);
      }
    }
    const requests = sources.map(
      ({ snapshot: item, columns }, index): DatabaseDeepResearchRequest => {
        const scopedOptions = optionsForSource(options, columns, index);
        const sourceBudget = {
          ...budget,
          maxSteps: Math.max(
            1,
            Math.floor((budget.maxSteps ?? 60) / sources.length),
          ),
        };
        return {
          databaseId: item.databaseId,
          objective: run.objective,
          filters: {
            query: String(filters.query ?? ""),
            columnIds: Array.isArray(filters.columnIds) ? filters.columnIds.map(String) : [],
          },
          plan: planFromOptions(
            { ...scopedOptions, budget: sourceBudget, reportType },
            columns,
            plannerSelection,
          ),
          seed: `${seed}:${item.databaseId}`,
          budget: sourceBudget,
        };
      },
    );
    const sourcePlans = requests.map((request, index) => {
      const steps = validateDatabaseResearchPlan(
        request.plan,
        sources[index].columns,
        request.budget,
      );
      assertSensitiveRoleContracts(
        steps,
        optionsForSource(options, sources[index].columns, index),
      );
      return { databaseId: request.databaseId, steps };
    });
    const plannedOperations = new Set(sourcePlans.flatMap((source) => source.steps.map((step) => String(step.operation))));
    const hasNumericSource = sources.some(({ columns }) => columns.some((column) => ["number", "formula", "rollup"].includes(column.type)));
    const requiredAnalyses = getDatabaseDeepResearchAnalysisRequirements(reportType).required.filter((operation) =>
      operation !== "multipleTesting" && (hasNumericSource || !["describe", "robustSummary"].includes(operation)),
    );
    const missingRequiredAnalyses = requiredAnalyses.filter((operation) => !plannedOperations.has(operation));
    if (missingRequiredAnalyses.length)
      throw new Error(`El plan validado no contiene análisis obligatorios: ${missingRequiredAnalyses.join(", ")}.`);
    researchRepo.updateDatabaseResearchRun(runId, {
      plan: { sources: sourcePlans },
      request: {
        objective: run.objective,
        databaseIds: requestedDatabaseIds,
        filters: options.filters ?? {},
        roles: options.roles ?? {},
        model: run.model,
        budget,
      },
    });
    researchRepo.upsertDatabaseResearchStep({
      runId,
      kind: "planning",
      ordinal: 2,
      status: "completed",
      progress: 1,
      output: {
        sources: sourcePlans,
        plannerOutput,
        plannerSelection,
        plannerCannotAlterAllowList: true,
        requiredAnalyses,
        optionalAnalyses: getDatabaseDeepResearchAnalysisRequirements(reportType).optional,
      },
      resultHash: sha256Snapshot({ sourcePlans, plannerOutput, plannerSelection }),
    });
    phaseProgress("calculations", 0.45, "Computing deterministic evidence.");
    const previousCalculations = canResume
      ? previousCompleted("calculations")
      : null;
    const persistedEvidence = Array.isArray(
      previousCalculations?.output.evidence,
    )
      ? (previousCalculations.output.evidence as DatabaseResearchEvidence[])
      : null;
    const validPersistedEvidence =
      persistedEvidence &&
      previousCalculations?.resultHash === sha256Snapshot(persistedEvidence)
        ? persistedEvidence
        : null;
    const computed: DatabaseResearchEvidence[] = validPersistedEvidence ? [...validPersistedEvidence] : [];
    if (!validPersistedEvidence) {
      for (const [index, request] of requests.entries()) {
        const evidence = (await host.analyze(
          request,
          {
            ...prepared.input(index),
            isCancelled: () => {
              const status = researchRepo.getDatabaseResearchRun(runId)?.status;
              return status === "cancelled" || status === "cancelling";
            },
          },
          [],
        )).evidence;
        computed.push(...(sources.length === 1 ? evidence : evidence.map((item) => ({
            ...item,
            stepId: `${request.databaseId}:${item.stepId}`,
            hash: sha256Snapshot({ databaseId: request.databaseId, artifact: item }),
          }))));
      }
    }
    if (!validPersistedEvidence) {
      const globalMultiplicity = multiplicityArtifact(
        computed.filter(
          (item) =>
            item.stepId !== "multiplicity-global" &&
            !item.stepId.endsWith(":multiplicity-global"),
        ),
      );
      if (globalMultiplicity) computed.push(globalMultiplicity);
    }
    researchRepo.upsertDatabaseResearchStep({
      runId,
      kind: "calculations",
      ordinal: 3,
      status: "completed",
      progress: 1,
      output: { evidence: computed },
      resultHash: sha256Snapshot(computed),
      seed: new SeededRandom(seed).seed,
    });
    phaseProgress("sensitivity", 0.62, "Recording sensitivity outputs.");
    researchRepo.upsertDatabaseResearchStep({
      runId,
      kind: "sensitivity",
      ordinal: 4,
      status: "completed",
      progress: 1,
      output: {
        seeded: true,
        resamplingSteps: computed
          .filter(
            (e) => e.operation === "bootstrap" || e.operation === "permutation",
          )
          .map((e) => e.stepId),
      },
      resultHash: sha256Snapshot(
        computed.filter(
          (e) => e.operation === "bootstrap" || e.operation === "permutation",
        ),
      ),
    });
    phaseProgress("adversarial_review", 0.72, "Checking evidence boundaries.");
    const reviewWarnings: string[] = [];
    const previousCritic = canResume
      ? previousCompleted("adversarial_review")
      : null;
    let criticOutput =
      previousCritic?.output.criticOutput &&
      typeof previousCritic.output.criticOutput === "object"
        ? previousCritic.output.criticOutput
        : null;
    if (!previousCritic && agents.complete)
      {
      const rawCritic = await completeBounded({
          role: "critic",
          objective: run.objective,
          evidence: computed,
          model: run.model,
          reportType,
          language: run.language,
          columnTypes: modelColumnTypes,
          modelContext,
        });
      const parsedCritic = parseAgentJson(rawCritic ?? "");
      const parsedSensitivityOperations = parsedCritic
        ? boundedStringList(parsedCritic.sensitivities, 16)
        : [];
      const discardedSensitivityCount = parsedSensitivityOperations.filter((operation) =>
        !DETERMINISTIC_SENSITIVITY_OPERATIONS.has(operation as DatabaseResearchOperation),
      ).length;
      if (discardedSensitivityCount > 0)
        reviewWarnings.push(`critic:discarded_non_allowlisted_sensitivities:${discardedSensitivityCount}`);
      const structuredCritic = safeCriticOutput(parsedCritic, computed);
      criticOutput = {
        ...(rawCritic ? modelOutputDigest(rawCritic) : { sha256: "", length: 0 }),
        structured: structuredCritic,
      };
      if (!structuredCritic) reviewWarnings.push("critic:invalid_output");
      else {
        if (structuredCritic.verdict !== "accept") reviewWarnings.push(`critic:${structuredCritic.verdict}`);
        if (structuredCritic.issues.some((issue) => issue.severity === "high")) reviewWarnings.push("critic:high_risk_issue");
      }
      }
    else if (criticOutput && (criticOutput as Record<string, unknown>).structured != null && typeof (criticOutput as Record<string, unknown>).structured === "object") {
      const structuredCritic = (criticOutput as Record<string, unknown>).structured as Record<string, unknown>;
      if (structuredCritic.verdict === "reject" || structuredCritic.verdict === "revise") reviewWarnings.push(`critic:${structuredCritic.verdict}`);
      if (Array.isArray(structuredCritic.issues) && structuredCritic.issues.some((issue) => issue && typeof issue === "object" && (issue as Record<string, unknown>).severity === "high")) reviewWarnings.push("critic:high_risk_issue");
    }
    researchRepo.upsertDatabaseResearchStep({
      runId,
      kind: "adversarial_review",
      ordinal: 5,
      status: "completed",
      progress: 1,
      output: {
        rawRowsExposedToModel: false,
        externalCalls: false,
        allowListed: true,
        criticOutput,
      },
      resultHash: sha256Snapshot({
        rawRowsExposedToModel: false,
        criticOutput,
      }),
    });
    // A critic can request sensitivity analyses, but it cannot execute an
    // arbitrary operation. Resolve every request against the already validated
    // per-source plan, then run only deterministic allow-listed steps under a
    // small task cap. The model receives only the resulting artifact digests.
    const criticStructuredForScheduling =
      criticOutput &&
      typeof (criticOutput as Record<string, unknown>).structured === "object"
        ? safeCriticOutput(
            (criticOutput as Record<string, unknown>).structured as Record<string, unknown>,
            computed,
          )
        : null;
    const requestedSensitivityOperations = [
      ...new Set(criticStructuredForScheduling?.sensitivities ?? []),
    ].filter((operation): operation is DatabaseResearchOperation =>
      DETERMINISTIC_SENSITIVITY_OPERATIONS.has(operation as DatabaseResearchOperation),
    );
    const priorSensitivity = canResume
      ? previousCompleted("sensitivity")
      : null;
    const sensitivityAlreadyScheduled =
      computed.some((item) => item.stepId.includes(":sensitivity:")) ||
      Boolean(
        priorSensitivity?.output.scheduledArtifacts &&
          Array.isArray(priorSensitivity.output.scheduledArtifacts) &&
          priorSensitivity.output.scheduledArtifacts.length,
      );
    const rounds = Number.isFinite(Number(budget.rounds))
      ? Math.max(1, Math.floor(Number(budget.rounds)))
      : 1;
    const sensitivityTaskCap = Math.min(
      24,
      Math.max(1, Math.floor(budget.maxSteps ?? 60)),
      rounds * 2,
    );
    const sensitivityTasks: Array<{
      sourceIndex: number;
      operation: DatabaseResearchOperation;
      step: DatabaseResearchStep;
    }> = [];
    if (!sensitivityAlreadyScheduled) {
      for (const operation of requestedSensitivityOperations) {
        for (const [sourceIndex, sourcePlan] of sourcePlans.entries()) {
          const candidate = sourcePlan.steps.find(
            (step) => step.operation === operation,
          );
          if (!candidate || operation === "multipleTesting") continue;
          sensitivityTasks.push({ sourceIndex, operation, step: candidate });
          if (sensitivityTasks.length >= sensitivityTaskCap) break;
        }
        if (sensitivityTasks.length >= sensitivityTaskCap) break;
      }
    }
    const scheduledSensitivityArtifacts: string[] = sensitivityAlreadyScheduled
      ? (Array.isArray(priorSensitivity?.output.scheduledArtifacts)
          ? priorSensitivity.output.scheduledArtifacts.filter(
              (item): item is string => typeof item === "string",
            )
          : computed
              .filter((item) => item.stepId.includes(":sensitivity:"))
              .map((item) => item.stepId))
      : [];
    if (!sensitivityAlreadyScheduled) {
      for (const [taskIndex, task] of sensitivityTasks.entries()) {
        ensureNotCancelled();
        const request = requests[task.sourceIndex];
        const sensitivityStep: DatabaseResearchStep = {
          ...task.step,
          id: `${request.databaseId}:sensitivity:${task.operation}:${taskIndex}`,
          options: { ...(task.step.options ?? {}) },
        };
        const result = await host.analyze(
          {
            databaseId: request.databaseId,
            objective: run.objective,
            plan: { steps: [sensitivityStep] },
            seed: `${seed}:sensitivity:${request.databaseId}:${task.operation}:${taskIndex}`,
            budget: request.budget,
          },
          {
            ...prepared.input(task.sourceIndex),
            isCancelled: () => {
              ensureNotCancelled();
              return false;
            },
          },
          [],
        );
        const artifacts = result.evidence
          .filter((item) => item.operation !== "multipleTesting")
          .map((item) => ({
            ...item,
            hash: sha256Snapshot({
              databaseId: request.databaseId,
              sensitivity: true,
              artifact: item,
            }),
          }));
        computed.push(...artifacts);
        scheduledSensitivityArtifacts.push(...artifacts.map((item) => item.stepId));
      }
      if (
        requestedSensitivityOperations.includes("multipleTesting") &&
        (sensitivityTasks.length > 0 || computed.length > 0)
      ) {
        const withoutMultiplicity = computed.filter(
          (item) =>
            item.stepId !== "multiplicity-global" &&
            !item.stepId.endsWith(":multiplicity-global"),
        );
        const refreshedMultiplicity = multiplicityArtifact(withoutMultiplicity);
        if (refreshedMultiplicity) {
          computed.splice(0, computed.length, ...withoutMultiplicity);
          computed.push(refreshedMultiplicity);
          scheduledSensitivityArtifacts.push(refreshedMultiplicity.stepId);
        }
      }
    }
    // Sensitivity artifacts are part of the same calculation ledger and hash;
    // persisting both steps makes resume and audit independent of process state.
    if (scheduledSensitivityArtifacts.length) {
      researchRepo.upsertDatabaseResearchStep({
        runId,
        kind: "calculations",
        ordinal: 3,
        status: "completed",
        progress: 1,
        output: { evidence: computed },
        resultHash: sha256Snapshot(computed),
        seed: new SeededRandom(seed).seed,
      });
    }
    researchRepo.upsertDatabaseResearchStep({
      runId,
      kind: "sensitivity",
      ordinal: 4,
      status: "completed",
      progress: 1,
      output: {
        seeded: true,
        requestedOperations: requestedSensitivityOperations,
        scheduledArtifacts: scheduledSensitivityArtifacts,
        resamplingSteps: computed
          .filter(
            (e) => e.operation === "bootstrap" || e.operation === "permutation",
          )
          .map((e) => e.stepId),
      },
      resultHash: sha256Snapshot({
        requestedOperations: requestedSensitivityOperations,
        scheduledArtifacts: scheduledSensitivityArtifacts,
        evidence: computed,
      }),
    });
    phaseProgress(
      "verification",
      0.84,
      "Verifying claims against computed evidence.",
    );
    const proposedClaims = Array.isArray(options.claims)
      ? (options.claims as DatabaseResearchClaim[])
      : [];
    let claims = verifyDatabaseResearchClaims(
      computed,
      proposedClaims as unknown as DatabaseResearchClaim[],
    );
    for (const [ordinal, claim] of claims.entries()) {
      const artifact = computed.find((item) => item.stepId === claim.stepId);
      const status =
        claim.verified && artifact
          ? artifactClaimStatus(artifact.operation, artifact)
          : "unverifiable";
      const verificationHash = sha256Snapshot({
        runId,
        claim,
        artifactHash: artifact?.hash ?? null,
      });
      researchRepo.saveDatabaseResearchClaim({
        id: claim.id ?? `claim-${runId}-${ordinal}`,
        runId,
        text: `${claim.stepId}.${claim.path}`,
        claimType: artifact?.operation ?? "requested",
        status,
        confidence:
          status === "verified"
            ? 1
            : status === "sensitive"
              ? 0.65
              : status === "exploratory"
                ? 0.5
                : 0,
        sourceRowIds: [],
        evidence: {
          expected: claim.expected,
          actual: claim.actual,
          reason: claim.reason,
          verificationHash,
          artifactHash: artifact?.hash ?? null,
        },
        artifactRefs: artifact ? [artifact.hash] : [],
        ordinal,
      });
    }
    const ledger = artifactLedger(
      computed,
      new SeededRandom(seed).seed,
      options.filters,
    );
    for (const [index, artifact] of ledger.entries()) {
      const evidence = computed.find((item) => item.stepId === artifact.id);
      const status = artifactClaimStatus(
        artifact.method as DatabaseResearchOperation,
        evidence,
      );
      researchRepo.saveDatabaseResearchClaim({
        id: `artifact-claim-${runId}-${index}`,
        runId,
        text: `${artifact.method}: artefacto ${artifact.id} recalculado sobre n=${artifact.n}.`,
        claimType: "artifact",
        status,
        confidence:
          status === "verified"
            ? 1
            : status === "sensitive"
              ? 0.65
              : status === "exploratory"
                ? 0.5
                : 0,
        sourceRowIds: [],
        evidence: {
          method: artifact.method,
          n: artifact.n,
          denominator: artifact.denominator,
          columnIds: artifact.inputs.columnIds,
          filters: artifact.filters,
          hash: artifact.hash,
          warnings: artifact.warnings,
        },
        artifactRefs: [artifact.hash],
        ordinal: proposedClaims.length + index,
        effect: firstFiniteMetric(
          artifact.output,
          new Set(["effect", "estimate", "coefficient", "marginalDifference"]),
        ),
        pValue: firstFiniteMetric(artifact.output, new Set(["p", "pValue"])),
        qValue: firstFiniteMetric(artifact.output, new Set(["qValue"])),
        sensitivity:
          status === "sensitive" ? { assumptionSensitive: true } : {},
        limitations:
          status === "sensitive"
            ? ["El estimando depende de los roles y supuestos declarados."]
            : status === "exploratory"
              ? ["Hallazgo exploratorio; no implica causalidad."]
              : status === "unverifiable"
                ? ["Artefacto vacío o fallido; no se usa como conclusión."]
                : [],
      });
    }
    const previousVerification = canResume
      ? previousCompleted("verification")
      : null;
    let verifierOutput =
      previousVerification?.output.verifierOutput &&
      typeof previousVerification.output.verifierOutput === "object"
        ? previousVerification.output.verifierOutput
        : null;
    if (!previousVerification && agents.complete)
      {
      const rawVerifier = await completeBounded({
          role: "verifier",
          objective: run.objective,
          evidence: computed,
          model: run.model,
          reportType,
          language: run.language,
          columnTypes: modelColumnTypes,
          modelContext,
        });
      const parsedVerifier = parseAgentJson(rawVerifier ?? "");
      const structuredVerifier = safeVerifierOutput(parsedVerifier, computed);
      verifierOutput = {
        ...(rawVerifier ? modelOutputDigest(rawVerifier) : { sha256: "", length: 0 }),
        structured: structuredVerifier,
      };
      if (!structuredVerifier) reviewWarnings.push("verifier:invalid_output");
      else if (!structuredVerifier.accepted) reviewWarnings.push("verifier:reject");
      }
    else if (verifierOutput && (verifierOutput as Record<string, unknown>).structured != null && typeof (verifierOutput as Record<string, unknown>).structured === "object") {
      const structuredVerifier = (verifierOutput as Record<string, unknown>).structured as Record<string, unknown>;
      if (structuredVerifier.accepted === false) reviewWarnings.push("verifier:reject");
    }
    const verifierRecord = verifierOutput as Record<string, unknown> | null;
    const verifier = verifierRecord && verifierRecord.structured != null && typeof verifierRecord.structured === "object" &&
      Array.isArray((verifierRecord.structured as Record<string, unknown>).claims) &&
      typeof (verifierRecord.structured as Record<string, unknown>).accepted === "boolean"
      ? verifierRecord.structured as SafeVerifierOutput
      : null;
    // A missing/invalid verifier response is also a failed gate when a model
    // was requested. Never leave an automatically persisted artifact claim as
    // verified after a verifier rejection or unverifiable review status.
    const verifierGateFailed = Boolean(agents.complete && !verifier);
    const claimMatchesReview = (claim: { id?: string; artifactRefs?: string[]; stepId?: string; path?: string }) => {
      const references = new Set([
        claim.id,
        claim.stepId,
        ...(claim.artifactRefs ?? []),
        claim.stepId && claim.path ? `${claim.stepId}.${claim.path}` : undefined,
      ].filter((item): item is string => Boolean(item)));
      return verifier?.claims.find(
        (item) => references.has(item.claimId) || item.artifactRefs.some((ref) => references.has(ref)),
      );
    };
    const claimsBeforeVerifierGate = researchRepo.getDatabaseResearchRunDetail(runId)?.claims ?? [];
    const verifierCoverageIncomplete = Boolean(
      agents.complete && verifier && claimsBeforeVerifierGate.some((claim) => !claimMatchesReview(claim)),
    );
    if (verifierCoverageIncomplete) reviewWarnings.push("verifier:incomplete_claim_coverage");
    const verifierBlocksClaims =
      verifierGateFailed ||
      verifierCoverageIncomplete ||
      Boolean(
        verifier &&
          (!verifier.accepted ||
            verifier.claims.some((item) => item.status === "unverifiable")),
      );
    if (verifierBlocksClaims) {
      claims = claims.map((claim) => {
        const review = claimMatchesReview(claim);
        if (verifierGateFailed || !verifier?.accepted || !review || review.status === "unverifiable") {
          return { ...claim, verified: false, reason: review?.reason || "Verifier rejected the claim." };
        }
        return claim;
      });
      // Keep durable claim rows aligned with the bounded verifier gate.
      for (const [ordinal, claim] of claims.entries()) {
        const artifact = computed.find((item) => item.stepId === claim.stepId);
        const status = claim.verified && artifact ? artifactClaimStatus(artifact.operation, artifact) : "unverifiable";
        researchRepo.saveDatabaseResearchClaim({
          id: claim.id ?? `claim-${runId}-${ordinal}`, runId,
          text: `${claim.stepId}.${claim.path}`, claimType: artifact?.operation ?? "requested", status,
          confidence: status === "verified" ? 1 : status === "sensitive" ? 0.65 : status === "exploratory" ? 0.5 : 0,
          sourceRowIds: [], evidence: { expected: claim.expected, actual: claim.actual, reason: claim.reason, artifactHash: artifact?.hash ?? null },
          artifactRefs: artifact ? [artifact.hash] : [], ordinal,
        });
      }
    }
    // Re-save every row, including automatic artifact claims. The verifier is
    // not allowed to reject the report while stale verified rows remain in the
    // durable claims table. A conservative invalid-response gate is preferable
    // to silently presenting an unreviewed claim as verified.
    if (verifierBlocksClaims) {
      const persistedClaims = researchRepo.getDatabaseResearchRunDetail(runId)?.claims ?? [];
      for (const persistedClaim of persistedClaims) {
        const review = claimMatchesReview(persistedClaim);
        if (!verifierGateFailed && verifier?.accepted && review && review.status !== "unverifiable") continue;
        researchRepo.saveDatabaseResearchClaim({
          id: persistedClaim.id,
          runId,
          text: persistedClaim.text,
          claimType: persistedClaim.claimType,
          status: "unverifiable",
          confidence: 0,
          sourceRowIds: persistedClaim.sourceRowIds,
          evidence: persistedClaim.evidence,
          artifactRefs: persistedClaim.artifactRefs,
          ordinal: persistedClaim.ordinal,
          effect: persistedClaim.effect,
          pValue: persistedClaim.pValue,
          qValue: persistedClaim.qValue,
          interval: persistedClaim.interval,
          sensitivity: persistedClaim.sensitivity,
          limitations: [
            ...(persistedClaim.limitations ?? []),
            review?.reason ?? "Verifier rejected or could not verify this claim.",
          ].slice(0, 32),
        });
      }
    }
    researchRepo.upsertDatabaseResearchStep({
      runId,
      kind: "verification",
      ordinal: 6,
      status: "completed",
      progress: 1,
      output: { claims, verifierOutput, verifierGateFailed, verifierBlocksClaims },
      resultHash: sha256Snapshot({ claims, verifierOutput }),
    });
    phaseProgress("assembly", 0.94, "Assembling a bounded report.");
    const previousAssembly = canResume ? previousCompleted("assembly") : null;
    if (Array.isArray(previousAssembly?.output.reviewWarnings))
      reviewWarnings.push(...previousAssembly.output.reviewWarnings.filter((item): item is string => typeof item === "string").slice(0, 16));
    let narrativeAst: NarrativeAst | null =
      previousAssembly?.output.narrativeAst &&
      typeof previousAssembly.output.narrativeAst === "object"
        ? narrativeAstFromModel(
            previousAssembly.output.narrativeAst as Record<string, unknown>,
            computed,
          )
        : null;
    let synthesizerOutput =
      previousAssembly?.output.synthesizerOutput &&
      typeof previousAssembly.output.synthesizerOutput === "object"
        ? previousAssembly.output.synthesizerOutput
        : null;
    if (!previousAssembly && agents.complete) {
      const rawWriter = await completeBounded({
          role: "synthesizer",
          objective: run.objective,
          evidence: computed,
          model: run.model,
          reportType,
          language: run.language,
          columnTypes: modelColumnTypes,
          modelContext,
          sectionLength: requestedSectionLength,
        });
      if (rawWriter) {
        synthesizerOutput = modelOutputDigest(rawWriter);
        narrativeAst = narrativeAstFromModel(parseAgentJson(rawWriter), computed);
      }
    }
    // One bounded production revision: editor output is accepted only after
    // the same strict AST gate. A hostile/free-form response therefore falls
    // through to the deterministic report and is never persisted as prose.
    let editorOutput: { sha256: string; length: number } | null = null;
    if (agents.complete) {
      const writerDraft = narrativeAst;
      const rawEditor = await completeBounded({
        role: "editor",
        objective: run.objective,
        evidence: computed,
        model: run.model,
        reportType,
        language: run.language,
        columnTypes: modelColumnTypes,
        modelContext,
        narrativeDraft: writerDraft,
        sectionLength: requestedSectionLength,
      });
      if (rawEditor) {
        editorOutput = modelOutputDigest(rawEditor);
        narrativeAst = narrativeAstFromModel(parseAgentJson(rawEditor), computed) ?? writerDraft;
      }
    }
    // No unvalidated model prose is persisted. A digest proves which output
    // was reviewed; only the gated AST may contribute narrative text.
    const deterministicMarkdown = deterministicReportMarkdown(
      run.title ?? run.objective,
      run.objective,
      snapshot,
      computed,
      cellTypeCoverage,
      snapshotFingerprint,
      run.language ?? "es",
      reportType as DatabaseDeepResearchReportType,
    );
    const markdown = narrativeAst
      ? `${renderDatabaseResearchNarrative(narrativeAst, computed, run.language ?? "es")}\n\n---\n\n${deterministicMarkdown}`
      : deterministicMarkdown;
    const sections = structuredReportSections(markdown);
    const charts = structuredReportCharts(computed, run.language ?? "es");
    const reviewBlocksCompletion = reviewWarnings.some((warning) =>
      /(?:reject|high_risk|invalid_output)/i.test(warning),
    );
    const autoConfiguration = options.autoConfiguration && typeof options.autoConfiguration === "object"
      ? options.autoConfiguration as { partial?: boolean; warnings?: unknown; limitations?: unknown; requestedReportType?: unknown }
      : null;
    const discrepancy =
      snapshot.truncated ||
      verifierBlocksClaims ||
      claims.some((claim) => !claim.verified) ||
      reviewBlocksCompletion ||
      autoConfiguration?.partial === true;
    const finalStatus = discrepancy ? "partial" : "completed";
    // Record the fully gated assembly before publishing the report. If the
    // process dies between these operations, resume can reuse the persisted
    // narrative AST and must not call the model again.
    researchRepo.upsertDatabaseResearchStep({
      runId,
      kind: "assembly",
      ordinal: 7,
      status: "completed",
      progress: 1,
      output: { reportId: `dbr_report_${runId}`, synthesizerOutput, editorOutput, narrativeAst, reviewWarnings },
      resultHash: sha256Snapshot({ synthesizerOutput, editorOutput, narrativeAst, reviewWarnings }),
    });
    researchRepo.saveDatabaseResearchReport({
      id: `dbr_report_${runId}`,
      runId,
      finalStatus,
      title: run.title ?? "Database Deep Research",
      markdown,
      summary: run.objective,
      bibliography: [],
      metadata: {
        deterministic: true,
        language: run.language ?? "es",
        requestedReportType: autoConfiguration?.requestedReportType ?? reportType,
        autoConfigurationWarnings: Array.isArray(autoConfiguration?.warnings) ? autoConfiguration.warnings : [],
        autoConfigurationLimitations: Array.isArray(autoConfiguration?.limitations) ? autoConfiguration.limitations : [],
        estimatedCostUsd: Number(
          (budget as Record<string, unknown>).estimatedCostUsd ?? 0,
        ),
        requestedOutline: options.planSections ?? [],
        synthesizerOutput,
        editorOutput,
        narrativeMode: narrativeAst ? "validated_model_ast" : "deterministic_fallback",
        reviewWarnings,
        discrepancy,
      },
      structured: {
        sections,
        charts,
        evidence: computed,
        evidenceLedger: ledger,
        cellTypeCoverage,
        sourceCoverage,
        methodology: {
          deterministic: true,
          fdr: computed.some((item) => item.operation === "multipleTesting"),
          rawRowsExposedToModel: false,
          modelProsePersisted: false,
          narrativeMode: narrativeAst ? "validated_model_ast" : "deterministic_fallback",
          resumed: Boolean(validPersistedEvidence),
          requestedOutline: options.planSections ?? [],
          reviewWarnings,
        },
        claims,
      },
      quality: {
        verifiedClaims: verifierBlocksClaims
          ? 0
          : computed.filter(
              (artifact) =>
                artifactClaimStatus(artifact.operation, artifact) === "verified",
            ).length +
            claims.filter((claim) => {
              const artifact = computed.find(
                (item) => item.stepId === claim.stepId,
              );
              return (
                claim.verified &&
                artifact != null &&
                artifactClaimStatus(artifact.operation, artifact) === "verified"
              );
            }).length,
        artifactCount: ledger.length,
        coverage: snapshot.totalRowCount
          ? snapshot.rowCount / snapshot.totalRowCount
          : 1,
        status: discrepancy ? "partial" : "complete",
        warnings: reviewWarnings,
      },
      provenance: {
        snapshotFingerprint,
        sha256: sha256Snapshot({
          snapshots: sourceCoverage.map((item) => item.hash),
          evidence: computed,
          promptVersion: DATABASE_DEEP_RESEARCH_PROMPT_VERSION,
        }),
        model: run.model,
        seed: new SeededRandom(seed).seed,
        promptVersion: DATABASE_DEEP_RESEARCH_PROMPT_VERSION,
      },
    });
    const settled = researchRepo.getDatabaseResearchRun(runId);
    if (settled)
      agents.onProgress?.({
        runId,
        status: settled.status,
        progress: settled.progress,
        step: settled.currentStep,
        phase: settled.phase,
        message: discrepancy
          ? snapshot.truncated
            ? "Report is partial because the snapshot was truncated."
            : "Report is partial because one or more claims were not verified."
          : "Report verified and complete.",
      });
    return researchRepo.getDatabaseResearchRunDetail(
      runId,
    ) as DatabaseResearchRunDetailLike;
  } catch (error) {
    researchRepo.failDatabaseResearchRun(
      runId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    prepared?.close();
  }
}

type DatabaseResearchRunDetailLike = NonNullable<ReturnType<DatabaseResearchRepository['getDatabaseResearchRunDetail']>>;
