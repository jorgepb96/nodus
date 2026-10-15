import {createHash} from 'node:crypto';
import {getDb} from '../db/database';
import {normalizeDatabaseDeepResearchReportType} from '../../shared/databaseDeepResearch';

/** Metadata only. Opening the gallery must not copy report Markdown, complete
 * evidence ledgers or saved dataset snapshots for every report. */
export function mobileDatabaseResearchCatalogue(input: {limit?:number;offset?:number} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key=>!['limit','offset'].includes(key))) throw new Error('invalid_database_research_catalogue');
  const limit = input.limit ?? 100, offset = input.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid_database_research_catalogue');
  const db = getDb();
  return db.transaction(()=> {
    const rows = db.prepare(`SELECT report.id,report.run_id,report.title,report.summary,report.created_at,report.updated_at,report.read_at,report.report_type,
      json_valid(report.metadata_json) AS metadata_valid,json_valid(report.quality_json) AS quality_valid,
      json_extract(report.metadata_json,'$.costUsd') AS cost,json_extract(report.metadata_json,'$.estimatedCostUsd') AS estimated_cost,
      json_extract(report.quality_json,'$.status') AS quality_status
      FROM database_research_reports report JOIN database_research_runs run ON run.id=report.run_id
      WHERE run.status IN ('completed','partial') ORDER BY report.updated_at DESC,report.id`).all() as Record<string,unknown>[];
    const items = rows.map(row=> {
      if (row.metadata_valid !== 1 || row.quality_valid !== 1) throw new Error('invalid_database_research_report');
      const cost = row.cost ?? row.estimated_cost;
      return {id:String(row.id),runId:String(row.run_id),title:String(row.title),summary:String(row.summary ?? ''),createdAt:String(row.created_at),updatedAt:String(row.updated_at),
        readAt:row.read_at == null ? null : String(row.read_at),reportType:normalizeDatabaseDeepResearchReportType(row.report_type),
        ...(typeof cost === 'number' ? {costUsd:cost} : {}),...(typeof row.quality_status === 'string' ? {qualityStatus:row.quality_status} : {})};
    });
    const revision = createHash('sha256').update(JSON.stringify(items)).digest('hex');
    return {version:1,revision,total:items.length,limit,offset,hasMore:offset+limit < items.length,items:items.slice(offset,offset+limit)};
  })();
}
