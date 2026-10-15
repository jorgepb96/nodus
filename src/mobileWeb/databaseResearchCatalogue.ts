import type {DatabaseResearchReportSummary} from '../views/DatabaseDeepResearchView';
import {isDatabaseDeepResearchReportType} from '@shared/databaseDeepResearch';

export async function loadMobileDatabaseResearchReports(call: (method:string,...args:unknown[])=>Promise<unknown>): Promise<DatabaseResearchReportSummary[]> {
  const items: DatabaseResearchReportSummary[] = [], seen = new Set<string>();
  let revision: string | undefined, total: number | undefined;
  let hasMore = true;
  while (hasMore) {
    const value = await call('listMobileDatabaseDeepResearchReports',{limit:100,offset:items.length}) as {
      version:number;revision:string;total:number;offset:number;hasMore:boolean;items:DatabaseResearchReportSummary[];
    };
    if (!value || value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.revision) || !Number.isSafeInteger(value.total) ||
        value.total < items.length || value.offset !== items.length || !Array.isArray(value.items) || value.items.length > 100 ||
        revision !== undefined && revision !== value.revision || total !== undefined && total !== value.total ||
        typeof value.hasMore !== 'boolean' || value.hasMore && value.items.length === 0) throw new Error('El catálogo de informes de datos cambió durante la carga. Vuelve a intentarlo.');
    revision = value.revision; total = value.total;
    for (const item of value.items) {
      if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id) || typeof item.title !== 'string' ||
          typeof item.runId !== 'string' || typeof item.summary !== 'string' || typeof item.createdAt !== 'string' || !isDatabaseDeepResearchReportType(item.reportType)) throw new Error('El catálogo de informes de datos no tiene un formato válido.');
      seen.add(item.id); items.push(item);
    }
    if (items.length > total) throw new Error('El catálogo de informes de datos está incompleto.');
    hasMore = value.hasMore;
    if (!hasMore && items.length !== total) throw new Error('El catálogo de informes de datos está incompleto.');
  }
  return items;
}
