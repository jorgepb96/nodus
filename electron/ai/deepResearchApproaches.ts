import {completeJson} from './aiClient';
import {getDb} from '../db/database';
import {academicIdeaAvailable} from '../db/manualIdeaVisibility';
import type {WritingWorkshopSnapshot} from '@shared/types';
import {planApproachRetrieval as portablePlanApproachRetrieval} from '@shared/portableDeepResearchApproaches';
export {deepResearchApproachProfile,approachRules,repairMalformedGenealogyCitations,deterministicApproachRetrievalPlan,mergeApproachSnapshots} from '@shared/portableDeepResearchApproaches';
export type {DeepResearchApproachVariant,DeepResearchApproachProfile,ApproachRetrievalPlan} from '@shared/portableDeepResearchApproaches';
export function planApproachRetrieval(input:Parameters<typeof portablePlanApproachRetrieval>[0]) {return portablePlanApproachRetrieval(input,completeJson);}
export function academicRelationshipContext(snapshot: WritingWorkshopSnapshot): Array<{
  from: string;
  relation: string;
  to: string;
  confidence: number;
}> {
  const ids = snapshot.ideas.slice(0, 100).map((idea) => idea.id);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT source.label AS from_label, e.type, target.label AS to_label, e.confidence
       FROM edges e
       JOIN ideas source ON source.global_id = e.from_id
       JOIN ideas target ON target.global_id = e.to_id
      WHERE (e.from_id IN (${placeholders}) OR e.to_id IN (${placeholders}))
        AND ${academicIdeaAvailable('e.from_id')} AND ${academicIdeaAvailable('e.to_id')}
      ORDER BY e.confidence DESC
      LIMIT 80`
  ).all(...ids, ...ids) as Array<{ from_label: string; type: string; to_label: string; confidence: number }>;
  return rows.map((row) => ({ from: row.from_label, relation: row.type, to: row.to_label, confidence: row.confidence }));
}
