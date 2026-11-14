import type {DatabaseResearchEvidence,DatabaseResearchAgentDeps} from './databaseResearchEngine';
import {buildDatabaseDeepResearchPrompt,type DatabaseDeepResearchPromptRole} from './databaseDeepResearchPrompts';
import {normalizeDeepResearchSectionLength,planDeepResearchSectionLength,type DeepResearchSectionLength} from './deepResearchSectionLength';
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


/** Provider-independent prompt/options. The host supplies credentials and executes
 * structured completion; raw values never enter the approved-artifact context. */
export function databaseResearchCompletionInput(input:Parameters<NonNullable<DatabaseResearchAgentDeps['complete']>>[0]) {
  const {role,objective,evidence,model,reportType,language,columnTypes,modelContext,narrativeDraft,sectionLength} = input;
  if (!model) throw new Error('Selecciona un modelo para Deep Research antes de iniciar la investigación.');
  const aliases=researchColumnAliases(evidence,columnTypes);
  const schema=modelContext ? JSON.stringify({schema:modelContext.schema.map(source=>({...source,columns:source.columns.map(column=>({...column,artifactAlias:aliases.get(column.id)}))})),semanticRoles:modelContext.semanticRoles,rowCounts:modelContext.rowCounts,allowedOperations:modelContext.allowedOperations,requestedOutline:modelContext.requestedOutline ?? []}) : '';
  const prompt=rolePrompt(role,reportType,language,objective,[schema ? `SCHEMA_CONTEXT\n${schema}` : '',`APPROVED_ARTIFACTS\n${compactEvidence(evidence,columnTypes)}`,role==='editor'&&narrativeDraft ? `VALIDATED_DRAFT_AST\n${JSON.stringify(narrativeDraft)}` : ''].filter(Boolean).join('\n\n'),normalizeDeepResearchSectionLength(sectionLength));
  const length=planDeepResearchSectionLength(sectionLength);
  return {system:prompt.system,user:prompt.user,temperature:role==='synthesizer'?0.2:0,maxTokens:['synthesizer','writer','editor'].includes(role)?Math.max(5200,length.targetWords===null?5200:length.maxTokensPerPass):1800,reasoning:'off' as const,plainContext:true,noRetry:true};
}
