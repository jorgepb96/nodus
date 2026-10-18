import {getDatabaseDeepResearchEligibility,type DatabaseDeepResearchJobInput} from './databaseDeepResearch';

export function validateDatabaseResearchSources(input: DatabaseDeepResearchJobInput, sources: Array<{id:string;columns:Array<{id:string;type:string}>;views:Array<{id:string}>}>): void {
  const allColumns = new Set<string>();
  const columnSources = new Map<string, string>();
  const columnTypes = new Map<string, string>();
  const allViews = new Set<string>();
  const selectedViewsPerDatabase = new Map<string, number>();
  for (const databaseId of input.databaseIds) {
    const source = sources.find(item => item.id === databaseId);
    if (!source) throw new Error(`Base de datos no encontrada: ${databaseId}`);
    for (const column of source.columns) { allColumns.add(column.id); columnSources.set(column.id, databaseId); columnTypes.set(column.id, String(column.type ?? '')); }
    for (const view of source.views) {
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

