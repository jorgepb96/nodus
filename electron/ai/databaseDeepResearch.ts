/** Desktop storage/worker adapter for the shared verified database research engine. */
import { chmodSync, closeSync, existsSync, mkdtempSync, openSync, rmSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import Database from "better-sqlite3";
import {
  getColumns,
  getDatabase,
  listViews,
  queryDatabaseRows,
} from "../db/databasesRepo";
import { getDb, withDatabaseContext } from "../db/database";
import * as researchRepo from "../db/databaseDeepResearchRepo";
import type {DatabaseColumn,DatabaseRow} from '@shared/databases';
import {
  sha256Snapshot, rehashDatabaseResearchSnapshot, runDatabaseDeepResearch as runSharedResearch,
  processDatabaseResearchRun as processSharedRun, DatabaseDeepResearchQueue as SharedResearchQueue,
  type DatabaseResearchHost, type DatabaseResearchSnapshot, type DatabaseDeepResearchDeps,
  type DatabaseResearchBudget, type DatabaseResearchScope, type DatabaseDeepResearchRequest,
  type DatabaseResearchClaim, type DatabaseDeepResearchResult, type DatabaseResearchAgentDeps,
} from '@shared/databaseResearchEngine';
export * from '@shared/databaseResearchEngine';
const nowIso = (deps?:DatabaseDeepResearchDeps) => (deps?.now ?? (()=>new Date().toISOString()))();
// The worker loads one source at a time. Bound that source by bytes as well as
// rows so exceptionally wide cells cannot turn the nominal row ceiling into an
// unbounded allocation. Rows are emitted incrementally, avoiding a second full
// JSON string in the main process.
const MAX_ANALYSIS_PAYLOAD_BYTES = 256 * 1024 * 1024;

function writePrivateAnalysisPayload(
  payloadPath: string,
  snapshot: DatabaseResearchSnapshot,
  columns: DatabaseColumn[],
): void {
  const descriptor = openSync(payloadPath, "wx", 0o600);
  let bytes = 0;
  let closed = false;
  const append = (value: string) => {
    bytes += Buffer.byteLength(value, "utf8");
    if (bytes > MAX_ANALYSIS_PAYLOAD_BYTES)
      throw new Error("El snapshot analítico supera el límite privado de 256 MiB; aplica filtros o reduce el máximo de filas.");
    writeSync(descriptor, value, undefined, "utf8");
  };
  try {
    const { rows, relationEdges, ...manifest } = snapshot;
    const manifestJson = JSON.stringify(manifest);
    append(`{"snapshot":${manifestJson.slice(0, -1)},"rows":[`);
    rows.forEach((row, index) => append(`${index ? "," : ""}${JSON.stringify(row)}`));
    append(`],"relationEdges":[`);
    (relationEdges ?? []).forEach((edge, index) => append(`${index ? "," : ""}${JSON.stringify(edge)}`));
    append(`]},"columns":${JSON.stringify(columns)}}`);
    closeSync(descriptor);
    closed = true;
    chmodSync(payloadPath, 0o600);
  } catch (error) {
    if (!closed) try { closeSync(descriptor); } catch { /* best effort */ }
    try { unlinkSync(payloadPath); } catch { /* payload may not exist */ }
    throw error;
  }
}

/** Materialise a point-in-time SQLite copy with owner-only permissions. The
 * caller must keep this file in a private temp directory and invoke cleanup
 * when the run ends. VACUUM INTO reads the active database and never mutates
 * its tables, so subsequent calculations can be isolated from live edits. */
export function createReadOnlyDatabaseSnapshot(targetPath: string): {
  path: string;
  cleanup: () => void;
} {
  if (!targetPath || targetPath.includes("\0"))
    throw new Error("Snapshot path is invalid.");
  getDb().prepare("VACUUM INTO ?").run(targetPath);
  chmodSync(targetPath, 0o600);
  let removed = false;
  return {
    path: targetPath,
    cleanup: () => {
      if (removed) return;
      removed = true;
      try {
        unlinkSync(targetPath);
      } catch {
        /* best effort cleanup */
      }
    },
  };
}

/** Open/read/cleanup probe used by the durable worker. Keeping the read handle
 * open only for this bounded probe proves the 0600 copy is readable in SQLite
 * readonly mode without retaining sensitive temporary files after a run. */
function withPrivateSqliteSnapshot<T>(
  databaseIds: string[],
  work: () => T,
): { rowCounts: Record<string, number>; value: T } {
  const directory = mkdtempSync(join(tmpdir(), "nodus-db-research-"), {
    encoding: "utf8",
  });
  chmodSync(directory, 0o700);
  const target = join(directory, "snapshot.sqlite");
  const snapshot = createReadOnlyDatabaseSnapshot(target);
  try {
    const readonly = new Database(snapshot.path, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      const count = readonly.prepare(
        "SELECT COUNT(*) AS count FROM db_rows WHERE database_id = ?",
      );
      const rowCounts = Object.fromEntries(
        databaseIds.map((databaseId) => {
          const row = count.get(databaseId) as { count: number };
          return [databaseId, Number(row.count) || 0];
        }),
      );
      return { rowCounts, value: withDatabaseContext(readonly, work) };
    } finally {
      readonly.close();
    }
  } finally {
    snapshot.cleanup();
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      /* best effort cleanup */
    }
  }
}

/** The exact eight persisted phases in the durable run contract. `done` is a
 * terminal state, not a phase. */
/** Capture a bounded immutable row view. Query revision is checked on every
 * page; if edits occur during capture, the operation fails instead of mixing
 * temporal states. */
export function captureDatabaseResearchSnapshot(
  databaseId: string,
  budget: DatabaseResearchBudget = {},
  deps?: DatabaseDeepResearchDeps,
  scope: DatabaseResearchScope = {},
): DatabaseResearchSnapshot {
  const database = getDatabase(databaseId);
  if (!database) throw new Error("Database not found.");
  const columns = getColumns(databaseId);
  const maxRows = Math.max(
    1,
    Math.min(500_000, Math.floor(budget.maxRows ?? 500_000)),
  );
  const rows: DatabaseRow[] = [];
  const query = String(scope.query ?? "")
    .trim()
    .toLocaleLowerCase();
  const selectedColumns = new Set(
    scope.columnIds?.length
      ? scope.columnIds
      : columns.map((column) => column.id),
  );
  let cursor: string | null = null;
  let revision: number | null = null;
  let totalRowCount = 0;
  let metadataTotalCount: number | null = null;
  do {
    const page = queryDatabaseRows({
      databaseId,
      viewId: scope.viewId ?? null,
      cursor,
      limit: 500,
      rowSort: "position",
    });
    if (revision == null) revision = page.revision;
    else if (page.revision !== revision)
      throw new Error(
        "Database changed while taking the research snapshot. Retry on one revision.",
      );
    if (!query && Number.isFinite(page.totalCount)) metadataTotalCount = Number(page.totalCount);
    const matching = query
      ? page.rows.filter((row) =>
          [...selectedColumns].some((columnId) =>
            String(row.cells[columnId] ?? "")
              .toLocaleLowerCase()
              .includes(query),
          ),
        )
      : page.rows;
    if (query) totalRowCount += matching.length;
    if (rows.length < maxRows)
      rows.push(...matching.slice(0, maxRows - rows.length));
    // For an unfiltered view, queryDatabaseRows already supplies the exact
    // count from SQLite metadata. Stop immediately after filling the bounded
    // snapshot instead of paging through hundreds of thousands of rows.
    if (!query && rows.length >= maxRows) break;
    cursor = page.nextCursor;
  } while (cursor);
  if (!query) totalRowCount = metadataTotalCount ?? rows.length;
  const truncated = rows.length < totalRowCount;
  const capturedAt = nowIso(deps);
  const payload = {
    databaseId,
    revision: revision ?? 0,
    totalRowCount,
    truncated,
    rows: rows.map((row) => ({
      id: row.id,
      revision: row.revision ?? null,
      cells: row.cells,
    })),
  };
  const relationEdges = relationEdgesForRows(databaseId, rows);
  return {
    databaseId,
    databaseName: database.name,
    revision: revision ?? 0,
    rowCount: rows.length,
    totalRowCount,
    truncated,
    columns: columns.map((column) => column.id),
    rows,
    relationEdges,
    capturedAt,
    hash: sha256Snapshot({ ...payload, relationEdges }),
  };
}

export function relationEdgesForRows(
  databaseId: string,
  rows: DatabaseRow[],
  columnId?: string,
  allowedTargetIds?: ReadonlySet<string>,
): DatabaseResearchSnapshot["relationEdges"] {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const allowed = allowedTargetIds ?? new Set(ids);
  const records: Array<{
    source: string;
    target: string;
    columnId: string;
    targetExists: number;
  }> = [];
  for (let offset = 0; offset < ids.length; offset += 400) {
    const chunk = ids.slice(offset, offset + 400);
    const placeholders = chunk.map(() => "?").join(",");
    const params: unknown[] = [databaseId, ...chunk];
    const clause = columnId ? " AND relation.column_id = ?" : "";
    if (columnId) params.push(columnId);
    records.push(
      ...(getDb()
        .prepare(
          `SELECT relation.row_id AS source, relation.target_id AS target, relation.column_id AS columnId,
              CASE WHEN target_row.id IS NULL THEN 0 ELSE 1 END AS targetExists
      FROM db_relations relation JOIN db_rows source_row ON source_row.id = relation.row_id
      LEFT JOIN db_rows target_row ON target_row.id = relation.target_id
      WHERE source_row.database_id = ? AND relation.target_kind = 'db_row'
        AND relation.row_id IN (${placeholders})${clause} ORDER BY relation.row_id, relation.position, relation.id`,
        )
        .all(...params) as Array<{
        source: string;
        target: string;
        columnId: string;
        targetExists: number;
      }>),
    );
  }
  // Keep targets outside the source snapshot. Cross-database relation audits
  // need to surface orphan and external nodes instead of silently dropping
  // every edge whose target belongs to another database.
  return records.map((edge) => ({
    ...edge,
    targetExists: Boolean(edge.targetExists),
    targetInScope: allowed.has(edge.target),
  }));
}

export async function runDatabaseDeepResearchAsync(
  request: DatabaseDeepResearchRequest,
  deps: DatabaseDeepResearchDeps = {},
  claims: DatabaseResearchClaim[] = [],
): Promise<DatabaseDeepResearchResult> {
  if (deps.isCancelled?.()) throw new Error("Database research cancelled.");
  const snapshot = deps.snapshotPayloadPath ? null : deps.readSnapshot
    ? deps.readSnapshot(request.databaseId, Math.max(1, Math.floor(request.budget?.maxRows ?? 500_000)))
    : captureDatabaseResearchSnapshot(request.databaseId, request.budget, deps);
  const columns = deps.snapshotPayloadPath ? null : deps.readColumns ? deps.readColumns(request.databaseId) : getColumns(request.databaseId);
  const file = process.env.NODUS_DATABASE_DEEP_RESEARCH_WORKER_FILE
    || join(__dirname, "databaseDeepResearchWorker.cjs");
  if (!existsSync(file)) throw new Error(`Database Deep Research worker not found: ${file}`);
  return new Promise<DatabaseDeepResearchResult>((resolve, reject) => {
    const worker = new Worker(file, {
      workerData: deps.snapshotPayloadPath
        ? { request, snapshotPayloadPath: deps.snapshotPayloadPath, claims }
        : { request, snapshot, columns, claims },
    });
    worker.unref();
    let settled = false;
    const cancelTimer = setInterval(() => {
      if (!deps.isCancelled?.()) return;
      void worker.terminate();
      finish(new Error("Database research cancelled."));
    }, 100);
    cancelTimer.unref();
    const finish = (error?: Error, result?: DatabaseDeepResearchResult) => {
      if (settled) return;
      settled = true;
      clearInterval(cancelTimer);
      if (error) reject(error);
      else resolve(result!);
    };
    worker.on("message", (message: { type?: string; completed?: number; total?: number; result?: DatabaseDeepResearchResult; error?: string }) => {
      if (message.type === "progress") deps.onStep?.(message.completed ?? 0, message.total ?? 0);
      else if (message.type === "complete" && message.result) finish(undefined, message.result);
      else if (message.type === "error") finish(new Error(message.error || "Database research worker failed."));
    });
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) finish(new Error(`Database research worker exited with code ${code}.`));
    });
  });
}


const sourceDeps = (deps:DatabaseDeepResearchDeps):DatabaseDeepResearchDeps => ({
  ...deps,readSnapshot:deps.readSnapshot ?? ((id,maxRows)=>captureDatabaseResearchSnapshot(id,{maxRows},deps)),readColumns:deps.readColumns ?? getColumns,
});
export function runDatabaseDeepResearch(request:DatabaseDeepResearchRequest,deps:DatabaseDeepResearchDeps={},claims:DatabaseResearchClaim[]=[]):DatabaseDeepResearchResult {
  return runSharedResearch(request,sourceDeps(deps),claims);
}
export class DatabaseDeepResearchQueue extends SharedResearchQueue {
  constructor(deps:DatabaseDeepResearchDeps={}) { super(sourceDeps(deps)); }
}
/** One immutable, complete source pack. The transport bounds bytes before it
 * signs or returns it; wide or truncated databases fail explicitly. */
export function captureMobileDatabaseResearchSources(databaseIds:string[],readProfiles:(id:string)=>Record<string,{filled?:number;fillRate?:number;distinct?:number;valueType?:string}>=()=>({})) {
  return withPrivateSqliteSnapshot(databaseIds,()=>{
    const sources=databaseIds.map(id=>{
      const views=listViews(id);
      const viewRows=Object.fromEntries(views.map(view=>{
        const selected=captureDatabaseResearchSnapshot(id,{},undefined,{viewId:view.id});
        if(selected.truncated)throw new Error('database_source_view_incomplete');
        return [view.id,selected.rows.map(row=>row.id)];
      }));
      return {database:getDatabase(id)!,snapshot:captureDatabaseResearchSnapshot(id),columns:getColumns(id),views,viewRows,profiles:readProfiles(id),viewId:null,viewRevision:null};
    });
    const targets=new Set(sources.flatMap(source=>source.snapshot.rows.map(row=>row.id)));
    for(const source of sources) {
      if(source.snapshot.truncated)throw new Error('database_source_pack_incomplete');
      source.snapshot.relationEdges=relationEdgesForRows(source.snapshot.databaseId,source.snapshot.rows,undefined,targets);
      source.snapshot.hash=rehashDatabaseResearchSnapshot(source.snapshot);
    }
    return sources;
  }).value;
}
export async function processDatabaseResearchRun(runId:string,agents:DatabaseResearchAgentDeps={}) {
  const host:DatabaseResearchHost={repository:researchRepo,probeKind:'sqlite',readColumns:getColumns,listViews,
    captureSnapshot:captureDatabaseResearchSnapshot,relationEdges:relationEdgesForRows,immutable:withPrivateSqliteSnapshot,
    analyze:runDatabaseDeepResearchAsync,prepareAnalysis:sources=>{
      const directory=mkdtempSync(join(tmpdir(),'nodus-db-research-payload-'),{encoding:'utf8'});chmodSync(directory,0o700);
      try {
        const paths=sources.map((source,index)=>{
          const file=join(directory,`source-${index}.json`);writePrivateAnalysisPayload(file,source.snapshot,source.columns);
          source.snapshot.rows=[];source.snapshot.relationEdges=[];return file;
        });
        return {input:index=>({snapshotPayloadPath:paths[index]}),close:()=>{try {rmSync(directory,{recursive:true,force:true});} catch { /* private cleanup */ }}};
      } catch(error) {rmSync(directory,{recursive:true,force:true});throw error;}
    }};
  return processSharedRun(runId,agents,host);
}

/** Drain durable queued work after process start. The caller owns the
 * single invocation guard; this function itself never runs two runs in
 * parallel. Stale runs deliberately require an explicit regeneration because
 * their persisted fingerprint no longer describes current data. */
export async function drainPersistedDatabaseResearchQueue(
  agents: DatabaseResearchAgentDeps = {},
): Promise<string[]> {
  const queued = [
    ...researchRepo.listDatabaseResearchRuns({ status: "running", limit: 500 }),
    ...researchRepo.listDatabaseResearchRuns({ status: "queued", limit: 500 }),
    ...researchRepo.listDatabaseResearchRuns({ status: "stale", limit: 500 })
      .filter((run) => !/fuentes cambiaron desde el snapshot persistido/i.test(run.error ?? "")),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const completed: string[] = [];
  for (const run of queued) {
    const current = researchRepo.getDatabaseResearchRun(run.id);
    if (
      !current ||
      current.status === "cancelled" ||
      current.status === "completed"
    )
      continue;
    researchRepo.startDatabaseResearchRun(run.id);
    await processDatabaseResearchRun(run.id, agents);
    completed.push(run.id);
  }
  return completed;
}

type DatabaseResearchRunDetailLike = NonNullable<
  ReturnType<typeof researchRepo.getDatabaseResearchRunDetail>
>;
