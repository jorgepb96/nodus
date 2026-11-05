import {getDb} from './database';
import {entryProse,listWorldEntries} from './worldEncyclopediaRepo';
import {rulesReaching} from './worldRulesRepo';
import {beatsForScene} from './worldThreadsRepo';
import {runContinuity} from './worldContinuityRepo';
import {listPresences} from './worldPresenceRepo';
import {knowersAt,listSecrets,secretsForCharacter} from './worldStoryRepo';
import type {WorldEntryKind} from '@shared/types';
import type {WorldChatSource} from '@shared/worldChatFacts';

export function desktopWorldChatSource():WorldChatSource {
  return {
    entries:listWorldEntries(),prose:ref=>entryProse({kind:ref.kind as WorldEntryKind,id:ref.id}),
    scene:id=>{const row=getDb().prepare('SELECT place_id,world_day FROM world_scenes WHERE scene_id=?').get(id) as {place_id:string|null;world_day:number|null}|undefined;return row?{placeId:row.place_id,worldDay:row.world_day}:undefined;},
    rulesReaching,presences:listPresences,
    memberships:id=>getDb().prepare('SELECT g.group_id,g.name,a.from_world_day,a.to_world_day FROM character_affiliations a JOIN world_groups g ON g.group_id=a.group_id WHERE a.person_id=?').all(id) as Array<{group_id:string;name:string;from_world_day:number|null;to_world_day:number|null}>,
    secretsForCharacter,secrets:listSecrets,knowersAt,beatsForScene,findings:runContinuity,
  };
}
