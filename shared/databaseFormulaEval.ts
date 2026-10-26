/**
 * Evaluating formula columns (see databaseFormula.ts for the spec and why it is a structured
 * recipe rather than an expression). Split from that module because everything here needs the
 * filter engine — matchesCondition for the `ifThen` rules, opLabel for the description —
 * while databaseFilters needs comparableType from there; keeping the two apart means neither
 * import is a cycle.
 *
 * Pure: it takes rows and columns and returns values, so every recipe is unit-tested without
 * a database.
 */

import { decodeCheckbox, decodeMultiSelect, decodeNumber, encodeNumber } from './databases';
import type { DatabaseColumn, DatabaseRow } from './databases';
import { databasePropertyPlainText } from './databaseProperties';
import { matchesCondition, opLabel } from './databaseFilters';
import {
  ARITHMETIC_OPS,
  COLUMN_STAT_FNS,
  formulaDependencies,
  formulaResultKind,
  validateFormula,
  type ColumnStatFn,
  type FormulaColorRule,
  type FormulaOperand,
  type FormulaOutput,
  type FormulaSpec,
} from './databaseFormula';
import {
  evaluateFormulaExpression,
  explainFormulaExpression,
  formulaExpressionGlobalStatDependencies,
  formulaRuntimeToRaw,
  type FormulaRuntimeValue,
} from './databaseFormulaExpression';

/** What a formula puts in a cell: a raw value (as stored/compared) plus how to paint it. */
export interface FormulaResult {
  value: string | null;
  color?: string | null;
  /** Set when the formula cannot run at all (bad config, circular reference). */
  error?: string;
}

/** One column's shape across the whole table, so per-row statistics cost one pass, not N. */
export interface ColumnStats {
  /** Every numeric value present, ascending. */
  sorted: number[];
  total: number;
  mean: number;
}

/**
 * The display text of a cell — what a condition compares against and what "Texto combinado"
 * pastes. Option columns resolve to their labels so the user compares the words they see,
 * not an internal id.
 */
export function cellDisplayValue(column: DatabaseColumn, row: DatabaseRow): string {
  const raw = row.cells[column.id] ?? null;
  if (raw == null || raw === '') return '';
  switch (column.type) {
    case 'select':
      return column.options.find((o) => o.id === raw)?.label ?? '';
    case 'multi_select':
      return decodeMultiSelect(raw)
        .map((id) => column.options.find((o) => o.id === id)?.label ?? '')
        .filter(Boolean)
        .join(', ');
    case 'checkbox':
      return decodeCheckbox(raw) ? 'Sí' : 'No';
    default:
      return databasePropertyPlainText(column.type, raw);
  }
}

/** A cell read as a number, or null when it holds nothing numeric. */
function cellNumber(column: DatabaseColumn | undefined, row: DatabaseRow): number | null {
  if (!column) return null;
  const raw = row.cells[column.id] ?? null;
  if (raw == null || raw === '') return null;
  if (column.type === 'checkbox') return decodeCheckbox(raw) ? 1 : 0;
  return decodeNumber(raw);
}

/**
 * Index of the first value >= x (how many are strictly below). Binary search rather than a
 * scan: rank and percentile run once per row against every value, so a linear probe would make
 * the column quadratic — 51M comparisons on a 7k-row table, and unusable well before 50k.
 */
function lowerBound(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first value > x (how many are <= x). */
function upperBound(sorted: number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Strip binary-floating-point noise (0.1 + 0.2 → 0.30000000000000004) while keeping every
 * digit that means anything. Deliberately not the user's display precision: rounding on the
 * way *in* silently destroys data — at 7k rows a "% of total" rounded to 2 places stores
 * 0.01 per row and the column adds up to 70 instead of 100. Precision is a rendering choice,
 * so the cell keeps the true number and the view shows as many decimals as the user asked for.
 */
const FLOAT_NOISE_DECIMALS = 10;
function clean(n: number): number {
  const f = 10 ** FLOAT_NOISE_DECIMALS;
  return Math.round(n * f) / f;
}

/**
 * Aggregate one column over every row. `rows` must be the whole table: a "% of total" that
 * changed when the user filtered would make the same row read differently depending on what
 * else is on screen, and would export differently every time.
 */
export function computeColumnStats(column: DatabaseColumn, rows: DatabaseRow[]): ColumnStats {
  const values: number[] = [];
  for (const r of rows) {
    const n = cellNumber(column, r);
    if (n != null) values.push(n);
  }
  values.sort((a, b) => a - b);
  const total = values.reduce((a, b) => a + b, 0);
  return { sorted: values, total, mean: values.length ? total / values.length : 0 };
}

function evalArithmetic(spec: Extract<FormulaSpec, { kind: 'arithmetic' }>, columns: Map<string, DatabaseColumn>, row: DatabaseRow): number | null {
  const value = (o: FormulaOperand): number | null =>
    o.kind === 'number' ? o.value : cellNumber(columns.get(o.columnId), row);
  const raw = spec.operands.map(value);

  if (spec.op === 'countFilled') return raw.filter((n) => n != null).length;

  // add/multiply/average/min/max/median ignore blanks — a blank means "no value", not zero,
  // and treating it as zero would quietly drag an average down. subtract/divide are
  // positional, so a blank operand leaves the whole result undefined instead of guessing.
  if (spec.op === 'subtract' || spec.op === 'divide') {
    if (raw.length === 0 || raw.some((n) => n == null)) return null;
    let acc = raw[0] as number;
    for (const n of raw.slice(1) as number[]) {
      if (spec.op === 'divide') {
        if (n === 0) return null; // dividing by nothing has no answer to show
        acc /= n;
      } else acc -= n;
    }
    return acc;
  }

  const nums = raw.filter((n): n is number => n != null);
  if (nums.length === 0) return null;
  switch (spec.op) {
    case 'add':
      return nums.reduce((a, b) => a + b, 0);
    case 'multiply':
      return nums.reduce((a, b) => a * b, 1);
    case 'average':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
    case 'median':
      return median([...nums].sort((a, b) => a - b));
    default:
      return null;
  }
}

function evalColumnStat(fn: ColumnStatFn, stats: ColumnStats, self: number | null): number | null {
  switch (fn) {
    case 'columnTotal':
      return stats.total;
    case 'columnMean':
      return stats.sorted.length ? stats.mean : null;
    case 'percentOfTotal':
      if (self == null || stats.total === 0) return null;
      return (self / stats.total) * 100;
    case 'diffFromMean':
      return self == null || stats.sorted.length === 0 ? null : self - stats.mean;
    case 'rank': {
      if (self == null || stats.sorted.length === 0) return null;
      // 1 = highest. Ties share the best rank, as a reader expects of a leaderboard.
      return stats.sorted.length - upperBound(stats.sorted, self) + 1;
    }
    case 'percentile': {
      if (self == null || stats.sorted.length === 0) return null;
      return (lowerBound(stats.sorted, self) / stats.sorted.length) * 100;
    }
  }
}

function outputValue(o: FormulaOutput, columns: Map<string, DatabaseColumn>, row: DatabaseRow): string | null {
  switch (o.kind) {
    case 'text':
      return o.value === '' ? null : o.value;
    case 'number':
      return encodeNumber(o.value);
    case 'column': {
      const col = columns.get(o.columnId);
      if (!col) return null;
      const v = cellDisplayValue(col, row);
      return v === '' ? null : v;
    }
    case 'empty':
      return null;
  }
}

export interface EvalContext {
  columns: Map<string, DatabaseColumn>;
  /** columnId → stats over the whole table, for columnStat recipes. */
  stats: Map<string, ColumnStats>;
  /** Values reached through a db-row relation. Supplied by the SQLite repository; pure
   * callers can inject a deterministic resolver. */
  relatedValues?: (rowId: string, relationColumnId: string, targetColumnId: string) => FormulaRuntimeValue[];
}

/** Run one formula for one row. */
export function evaluateFormula(spec: FormulaSpec, row: DatabaseRow, ctx: EvalContext): FormulaResult {
  const numeric = (n: number | null): string | null => (n == null ? null : encodeNumber(clean(n)));
  switch (spec.kind) {
    case 'arithmetic':
      return { value: numeric(evalArithmetic(spec, ctx.columns, row)) };
    case 'columnStat': {
      const col = ctx.columns.get(spec.columnId);
      const stats = ctx.stats.get(spec.columnId);
      if (!col || !stats) return { value: null };
      return { value: numeric(evalColumnStat(spec.fn, stats, cellNumber(col, row))) };
    }
    case 'ifThen': {
      for (const rule of spec.rules) {
        const conds = rule.conditions.filter((c) => ctx.columns.has(c.columnId));
        if (conds.length === 0) continue;
        const results = conds.map((c) => matchesCondition(ctx.columns.get(c.columnId)!, row, c));
        const hit = rule.conjunction === 'or' ? results.some(Boolean) : results.every(Boolean);
        if (hit) return { value: outputValue(rule.output, ctx.columns, row), color: rule.color ?? null };
      }
      return { value: outputValue(spec.otherwise, ctx.columns, row), color: spec.otherwiseColor ?? null };
    }
    case 'concat': {
      const text = spec.parts
        .map((p) => {
          if (p.kind === 'text') return p.value;
          const col = ctx.columns.get(p.columnId);
          return col ? cellDisplayValue(col, row) : '';
        })
        .join('');
      return { value: text.trim() === '' ? null : text };
    }
    case 'expression':
      try {
        return {
          value: formulaRuntimeToRaw(evaluateFormulaExpression(spec.ast, {
            columns: ctx.columns,
            row,
          relatedValues: (relationColumnId, targetColumnId) =>
              ctx.relatedValues?.(row.id, relationColumnId, targetColumnId) ?? [],
            columnStats: ctx.stats,
          })),
        };
      } catch (error) {
        return { value: null, error: error instanceof Error ? error.message : String(error) };
      }
  }
}

/**
 * Paint a result with the first matching colour rule. Only consulted when the formula itself
 * did not already choose a colour (an `ifThen` rule's own colour is more specific).
 */
export function applyColorRules(value: string | null, kind: 'number' | 'text', rules: FormulaColorRule[]): string | null {
  const empty = value == null || value === '';
  for (const r of rules) {
    const target = r.value ?? '';
    let hit = false;
    if (r.op === 'isEmpty') hit = empty;
    else if (r.op === 'notEmpty') hit = !empty;
    else if (empty) hit = false;
    else if (kind === 'number') {
      const a = decodeNumber(value);
      const b = decodeNumber(String(target));
      if (a == null || b == null) hit = false;
      else if (r.op === 'gt') hit = a > b;
      else if (r.op === 'gte') hit = a >= b;
      else if (r.op === 'lt') hit = a < b;
      else if (r.op === 'lte') hit = a <= b;
      else if (r.op === 'equals') hit = a === b;
      else if (r.op === 'notEquals') hit = a !== b;
    } else {
      const a = String(value).toLowerCase();
      const b = String(target).toLowerCase();
      if (r.op === 'equals') hit = a === b;
      else if (r.op === 'notEquals') hit = a !== b;
      else if (r.op === 'contains') hit = a.includes(b);
      else if (r.op === 'notContains') hit = !a.includes(b);
    }
    if (hit) return r.color;
  }
  return null;
}

/**
 * Order the formula columns so each is computed after the ones it reads, and name the ones
 * caught in a circular reference. A formula may legitimately build on another (a total, then
 * that total's % of the table), so evaluation order is not the column order.
 */
export function orderFormulaColumns(columns: DatabaseColumn[]): { ordered: DatabaseColumn[]; circular: Set<string> } {
  const formulaCols = columns.filter((c) => c.type === 'formula');
  const byId = new Map(formulaCols.map((c) => [c.id, c]));
  const ordered: DatabaseColumn[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const circular = new Set<string>();

  const visit = (col: DatabaseColumn): void => {
    if (done.has(col.id) || circular.has(col.id)) return;
    if (visiting.has(col.id)) {
      circular.add(col.id);
      return;
    }
    visiting.add(col.id);
    for (const depId of formulaDependencies(col.config.formula as FormulaSpec | undefined)) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
      if (circular.has(depId)) circular.add(col.id);
    }
    visiting.delete(col.id);
    if (!circular.has(col.id)) {
      done.add(col.id);
      ordered.push(col);
    }
  };
  for (const c of formulaCols) visit(c);
  return { ordered, circular };
}

/**
 * Compute every formula column for every row, writing each result into `row.cells` so that
 * filtering, sorting, search and export treat a formula exactly like a stored column, and the
 * colours into `row.formulaColors`.
 *
 * `statRows` is the whole table; it is the same array as `rows` unless the caller asked for a
 * page, in which case the statistics still have to see everything.
 */
export function computeFormulas(rows: DatabaseRow[], columns: DatabaseColumn[], statRows: DatabaseRow[] = rows,
  options:{relatedValues?:EvalContext['relatedValues'];columnIds?:ReadonlySet<string>} = {}): void {
  const { ordered, circular } = orderFormulaColumns(columns);
  if (ordered.length === 0 && circular.size === 0) return;
  const byId = new Map(columns.map((c) => [c.id, c]));
  // Evaluate over the table-wide set: statistics need every row, and one formula feeding
  // another needs its dependency filled in first. Normally this is the same array as `rows`.
  const evalRows = statRows;
  const formulaIds = [...ordered.map((column) => column.id), ...circular]
    .filter((id) => !options.columnIds || options.columnIds.has(id));
  // A local recalculation starts from a captured materialized row. Its former
  // error or colour must not survive a successful/differently coloured result.
  for (const row of evalRows) for (const id of formulaIds) {
    if (row.formulaErrors) delete row.formulaErrors[id];
    if (row.formulaColors) delete row.formulaColors[id];
  }

  for (const col of ordered) {
    if(options.columnIds&&!options.columnIds.has(col.id))continue;
    const spec = col.config.formula as FormulaSpec | undefined;
    const problem = validateFormula(spec, columns);
    if (problem || !spec) {
      for (const row of evalRows) {
        row.cells[col.id] = null;
        setError(row, col.id, problem ?? 'Esta columna todavía no tiene fórmula.');
      }
      continue;
    }
    const colorRules = (col.config.formulaColors as FormulaColorRule[] | undefined) ?? [];
    const kind = formulaResultKind(spec);

    const stats = new Map<string, ColumnStats>();
    const statisticIds = spec.kind === 'columnStat' ? [spec.columnId]
      : spec.kind === 'expression' ? formulaExpressionGlobalStatDependencies(spec.ast) : [];
    for (const statisticId of statisticIds) {
      const src = byId.get(statisticId);
      if (src) stats.set(statisticId, computeColumnStats(src, evalRows));
    }
    const ctx: EvalContext = { columns: byId, stats, relatedValues: options.relatedValues };

    for (const row of evalRows) {
      const res = evaluateFormula(spec, row, ctx);
      row.cells[col.id] = res.value;
      if (res.error) setError(row, col.id, res.error);
      const color = res.color ?? applyColorRules(res.value, kind, colorRules);
      if (color) {
        row.formulaColors = row.formulaColors ?? {};
        row.formulaColors[col.id] = color;
      }
    }
  }

  for (const colId of circular) {
    if(options.columnIds&&!options.columnIds.has(colId))continue;
    for (const row of evalRows) {
      row.cells[colId] = null;
      setError(row, colId, 'Referencia circular: la fórmula se usa a sí misma.');
    }
  }

  // When the caller passed a separate table-wide set (a page, or a single row being
  // re-read), the results live on those objects: copy them onto the rows actually returned.
  if (evalRows !== rows) {
    const source = new Map(evalRows.map((r) => [r.id, r]));
    for (const row of rows) {
      const src = source.get(row.id);
      if (!src) continue;
      for (const id of formulaIds) {
        row.cells[id] = src.cells[id] ?? null;
        if (row.formulaColors) delete row.formulaColors[id];
        if (row.formulaErrors) delete row.formulaErrors[id];
        if (src.formulaColors?.[id]) (row.formulaColors ??= {})[id] = src.formulaColors[id];
        if (src.formulaErrors?.[id]) (row.formulaErrors ??= {})[id] = src.formulaErrors[id];
      }
    }
  }
}

function setError(row: DatabaseRow, columnId: string, message: string): void {
  row.formulaErrors = row.formulaErrors ?? {};
  row.formulaErrors[columnId] = message;
}

/**
 * The formula in one plain sentence. Shown under the editor and on the column header, so a
 * formula always carries its own explanation — the same "shown query" idea the charts use.
 *
 * The sentence is stitched together from words, so it cannot be one translatable key: the
 * caller injects its `t` and every connective, operator and recipe label goes through it.
 * Defaults to the Spanish source, which keeps this module usable from a test or the main
 * process without dragging the renderer's i18n along.
 */
export function describeFormula(
  spec: FormulaSpec | undefined | null,
  columns: DatabaseColumn[],
  t: (s: string) => string = (s) => s
): string {
  if (!spec) return '';
  const name = (id: string) => columns.find((c) => c.id === id)?.name ?? '?';
  const operand = (o: FormulaOperand) => (o.kind === 'column' ? name(o.columnId) : String(o.value));
  const output = (o: FormulaOutput) => {
    if (o.kind === 'text') return `«${o.value}»`;
    if (o.kind === 'number') return String(o.value);
    if (o.kind === 'column') return name(o.columnId);
    return t('nada');
  };
  switch (spec.kind) {
    case 'arithmetic': {
      const def = ARITHMETIC_OPS.find((o) => o.id === spec.op)!;
      const parts = spec.operands.map(operand);
      if (parts.length === 0) return t(def.label);
      return def.symbol ? parts.join(` ${def.symbol} `) : `${t(def.label)} ${t('de')} ${parts.join(', ')}`;
    }
    case 'columnStat':
      return `${t(COLUMN_STAT_FNS.find((f) => f.id === spec.fn)!.label)} ${t('de')} ${name(spec.columnId)}`;
    case 'ifThen': {
      const rules = spec.rules.map((r) => {
        const conds = r.conditions
          .map((c) => {
            const col = columns.find((x) => x.id === c.columnId);
            const val = Array.isArray(c.value)
              ? c.value.map((id) => col?.options.find((o) => o.id === id)?.label ?? id).join(' / ')
              : (c.value ?? '');
            return `${name(c.columnId)} ${t(opLabel(c.op))}${val !== '' ? ` ${val}` : ''}`;
          })
          .join(r.conjunction === 'or' ? ` ${t('o')} ` : ` ${t('y')} `);
        return `${t('si')} ${conds} → ${output(r.output)}`;
      });
      return [...rules, `${t('si no')} → ${output(spec.otherwise)}`].join('; ');
    }
    case 'concat':
      return spec.parts.map((p) => (p.kind === 'column' ? name(p.columnId) : `«${p.value}»`)).join(' + ');
    case 'expression':
      return explainFormulaExpression(spec.ast, columns);
  }
}
