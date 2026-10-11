import {getDb} from '../db/database';
import {indexEntryLinks,entryProse,promoteWorldLinks} from '../db/worldEncyclopediaRepo';
import {getSceneText,saveSceneText} from '../db/worldManuscriptRepo';
import {normalizeTitle} from '../../shared/worldEncyclopedia';
import type {WorldEntryRef} from '../../shared/types';
import {RULE_MARKS,CONFLICT_MARKS,ARC_MARKS} from '../../shared/worldThreads';

export class MobileWorldMutationError extends Error {
  get description(){return this.message==='world_scene_text_conflict'
    ? 'El texto de esta escena cambió en Nodus. Tu borrador se conserva en el móvil. Compara ambas versiones antes de volver a guardarlo.'
    : 'Nodus no pudo aplicar este cambio del mundo. Se conserva en la cola de este dispositivo para su revisión.';}
}
function fail(code:string):never {throw new MobileWorldMutationError(code);}

/** Only the closed, family-scoped content registry can reach this adapter. */
export function prepareMobileWorldMutation(raw:{table:string;kind:string;key:string[];row?:Record<string,unknown>}) {
  const db=getDb(),row=raw.row;
  if(raw.kind!=='upsert'||!row)return undefined;
  const merged=(table:string,fields:string[])=>({
    ...(db.prepare(`SELECT * FROM ${table} WHERE ${fields.map(field=>`${field}=?`).join(' AND ')}`).get(...raw.key) as Record<string,unknown>|undefined),...row
  });
  if(['world_articles','world_rules','world_threads','world_scenes'].includes(raw.table)) {
    const id=raw.table==='world_articles'?'article_id':raw.table==='world_rules'?'rule_id':raw.table==='world_threads'?'thread_id':'scene_id';
    if(raw.key.length!==1||row[id]!==raw.key[0])fail('invalid_world_identity');
    const value=merged(raw.table,[id]);
    if(typeof value.title!=='string'||!value.title.trim())fail('world_title_required');
  }
  if(raw.table==='world_scene_text') {
    if(raw.key.length!==1||row.scene_id!==raw.key[0]||!db.prepare('SELECT 1 FROM world_scenes WHERE scene_id=?').get(raw.key[0]))fail('world_scene_unavailable');
    if(row.text!=null&&typeof row.text!=='string')fail('invalid_world_scene_text');
    const before=getSceneText(raw.key[0]);
    if(Object.prototype.hasOwnProperty.call(row,'_mobileExpectedText')){
      if(typeof row._mobileExpectedText!=='string')fail('invalid_world_scene_baseline');
      const ref={kind:'scene' as const,id:raw.key[0]},expected=promoteWorldLinks(row._mobileExpectedText,ref).text??'',next=promoteWorldLinks(typeof row.text==='string'?row.text:'',ref).text??'';
      if((before.text??'')!==expected&&(before.text??'')!==next)fail('world_scene_text_conflict');
    }
    return before;
  }
  if(raw.table==='world_beats') {
    if(raw.key.length!==3||row.thread_kind!==raw.key[0]||row.thread_id!==raw.key[1]||row.scene_id!==raw.key[2])fail('invalid_world_beat_identity');
    const value=merged('world_beats',['thread_kind','thread_id','scene_id']),kind=raw.key[0];
    if(!db.prepare('SELECT 1 FROM world_scenes WHERE scene_id=?').get(raw.key[2]))fail('world_scene_unavailable');
    if(kind==='rule') { if(!db.prepare('SELECT 1 FROM world_rules WHERE rule_id=?').get(raw.key[1]))fail('world_rule_unavailable'); }
    else if(!['conflict','arc'].includes(kind)||!db.prepare('SELECT 1 FROM world_threads WHERE thread_id=? AND kind=?').get(raw.key[1],kind))fail('world_thread_unavailable');
    const marks:readonly string[]=kind==='rule'?RULE_MARKS:kind==='conflict'?CONFLICT_MARKS:ARC_MARKS;
    if(typeof value.mark!=='string'||!marks.includes(value.mark))fail('invalid_world_beat_mark');
    if(value.paid!=null&&value.paid!==0&&value.paid!==1&&value.paid!==false&&value.paid!==true)fail('invalid_world_beat_paid');
  }
  return undefined;
}

/** Preserve repository-derived authored links/counts within the same receipt transaction. */
export function finishMobileWorldMutation(raw:{table:string;kind:string;key:string[]}, before:ReturnType<typeof prepareMobileWorldMutation>) {
  if(raw.kind!=='upsert')return;
  const db=getDb();
  const entries:Record<string,[WorldEntryRef['kind'],string]>={world_articles:['article','article_id'],world_rules:['rule','rule_id'],
    world_threads:['conflict','thread_id'],persons:['character','person_id'],character_profiles:['character','person_id'],
    places:['place','place_id'],place_profiles:['place','place_id'],world_groups:['group','group_id'],world_scenes:['scene','scene_id'],world_maps:['map','map_id']};
  if(raw.table==='world_scene_text') {
    const current=getSceneText(raw.key[0]);
    saveSceneText(raw.key[0],current.text,before);return;
  }
  const entry=entries[raw.table];if(!entry)return;
  if(['world_articles','world_rules','world_threads'].includes(raw.table)) {
    const current=db.prepare(`SELECT title FROM ${raw.table} WHERE ${entry[1]}=?`).get(raw.key[0]) as {title:string};
    db.prepare(`UPDATE ${raw.table} SET title=?,title_key=? WHERE ${entry[1]}=?`).run(current.title.trim(),normalizeTitle(current.title),raw.key[0]);
  }
  if(raw.table==='world_threads'&&(db.prepare('SELECT kind FROM world_threads WHERE thread_id=?').get(raw.key[0]) as {kind:string})?.kind==='arc')return;
  const ref={kind:entry[0],id:raw.key[0]};
  const columns=new Set((db.prepare(`PRAGMA table_info(${raw.table})`).all() as {name:string}[]).map(column=>column.name));
  for(const block of entryProse(ref)) {
    if(!columns.has(block.field)||!/^[a-z_]+$/.test(block.field))continue;
    const promoted=promoteWorldLinks(block.text,ref).text;
    if(promoted!==block.text)db.prepare(`UPDATE ${raw.table} SET ${block.field}=? WHERE ${entry[1]}=?`).run(promoted,raw.key[0]);
  }
  indexEntryLinks(ref);
}
