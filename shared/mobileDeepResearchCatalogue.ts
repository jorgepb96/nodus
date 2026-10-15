import type {WritingWorkshopSavedDraft} from './types';

/** A publication acknowledges one canonical record, not a second report. Keep the
 * device copy when the Mac catalogue is unavailable; when present use its latest
 * read state, cover and content. Never merge merely because titles match. */
export type MobileDeepResearchCatalogueRow = WritingWorkshopSavedDraft & {mobilePublicationId?:string};
export function mergeMobileDeepResearchReports(local:MobileDeepResearchCatalogueRow[],remote:WritingWorkshopSavedDraft[]):WritingWorkshopSavedDraft[] {
 const published=new Map(remote.map(row=>[row.id,row]));
 const consumed=new Set<string>();
 const rows=local.map(row=>{
  const match=row.mobilePublicationId?published.get(row.mobilePublicationId):undefined;
  if(!match)return row;
  consumed.add(match.id);return match;
 });
 const ids=new Set(rows.map(row=>row.id));
 for(const row of remote)if(!consumed.has(row.id)&&!ids.has(row.id)){rows.push(row);ids.add(row.id);}
 return rows;
}
