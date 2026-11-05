import type {PromptLanguage,WorldChatRequest,WorldEntry,WorldRule,WorldSecret,SecretKnower,WorldBeat,WorldFinding} from './types';
import type {Presence} from './worldPresence';
import {calculateWorldChatFacts,type WorldChatSource} from './worldChatFacts';
import {effectiveRules,toScope} from './worldRules';
import {matchFocus,composeWorldChatContext,hasWorldChatMaterial,validateCitations,ensureWorldCitations,type WorldChatRef} from './worldChatContext';
import {worldOperationSystemPrompt} from './worldOperationPrompts';
import {transformChatProse} from './chatSkills';
import {sha256Snapshot} from './databaseResearchEngine';

export const MOBILE_WORLD_CHAT_MAX_BYTES=16_000_000;
export interface MobileWorldChatSnapshot {
  entries:WorldEntry[];
  prose:Record<string,Array<{field:string;heading:string|null;text:string}>>;
  scenes:Record<string,{placeId:string|null;worldDay:number|null}>;
  rules:WorldRule[];
  placePaths:Record<string,string[]>;
  presences:Presence[];
  memberships:Record<string,ReturnType<WorldChatSource['memberships']>>;
  ruleMemberships:Record<string,Array<{group_id:string;from_world_day:number|null;to_world_day:number|null}>>;
  secrets:WorldSecret[];
  knowers:SecretKnower[];
  beats:WorldBeat[];
  findings:WorldFinding[];
}
export interface MobileWorldChatSourcePack {
  version:1;vaultId:string;capturedAt:string;id:string;entryKeys:string[];data:MobileWorldChatSnapshot;
}
export function worldChatPackPayload(pack:MobileWorldChatSourcePack){const {id:_id,...data}=pack;return data;}
export function validateMobileWorldChatSourcePack(pack:MobileWorldChatSourcePack,vaultId:string) {
  if(!pack||pack.version!==1||pack.vaultId!==vaultId||!Number.isFinite(Date.parse(pack.capturedAt))||pack.id!==sha256Snapshot(worldChatPackPayload(pack))||!Array.isArray(pack.entryKeys)||pack.entryKeys.length>100||new Set(pack.entryKeys).size!==pack.entryKeys.length||new TextEncoder().encode(JSON.stringify(pack)).length>MOBILE_WORLD_CHAT_MAX_BYTES)throw new Error('invalid_world_chat_source_pack');
  const data=pack.data;
  if(!data||!Array.isArray(data.entries)||data.entries.length!==pack.entryKeys.length||!['rules','presences','secrets','knowers','beats','findings'].every(key=>Array.isArray(data[key as keyof MobileWorldChatSnapshot]))||!['prose','scenes','placePaths','memberships','ruleMemberships'].every(key=>data[key as keyof MobileWorldChatSnapshot]&&typeof data[key as keyof MobileWorldChatSnapshot]==='object'&&!Array.isArray(data[key as keyof MobileWorldChatSnapshot])))throw new Error('invalid_world_chat_snapshot');
  for(const entry of data.entries)if(!entry||entry.key!==`${entry.kind}:${entry.id}`||!pack.entryKeys.includes(entry.key)||typeof entry.title!=='string'||!Array.isArray(entry.aliases)||!Array.isArray(data.prose[entry.key]))throw new Error('invalid_world_chat_entry');
  if(new Set(data.entries.map(entry=>entry.key)).size!==data.entries.length)throw new Error('invalid_world_chat_entry');
}
const activeAt=(row:{from_world_day:number|null;to_world_day:number|null},day:number|null)=>day==null||!((row.from_world_day!=null&&day<row.from_world_day)||(row.to_world_day!=null&&day>row.to_world_day));
export function worldChatSnapshotSource(data:MobileWorldChatSnapshot):WorldChatSource {
  return {
    entries:data.entries,prose:ref=>data.prose[`${ref.kind}:${ref.id}`]??[],scene:id=>data.scenes[id],
    rulesReaching:({personId,placeId},day)=>effectiveRules(data.rules.map(toScope),{personId,groupIds:personId?(data.ruleMemberships[personId]??[]).filter(row=>activeAt(row,day)).map(row=>row.group_id):[],placePath:placeId?data.placePaths[placeId]??[]:[]},day),
    presences:()=>data.presences,memberships:id=>data.memberships[id]??[],
    secretsForCharacter:id=>({owned:data.secrets.filter(secret=>secret.ownerPersonId===id),known:data.secrets.filter(secret=>secret.ownerPersonId!==id&&data.knowers.some(knower=>knower.secretId===secret.secretId&&knower.personId===id))}),
    secrets:()=>data.secrets,knowersAt:(id,day)=>data.knowers.filter(knower=>knower.secretId===id&&(day==null||knower.sinceWorldDay==null||day>=knower.sinceWorldDay)),
    beatsForScene:id=>data.beats.filter(beat=>beat.sceneId===id),findings:()=>data.findings,
  };
}
/** Never combines independently captured world states into contradictory facts.
 * One complete chosen pack must contain the full focus of the current question. */
export function prepareWorldChat(input:{packs:MobileWorldChatSourcePack[];request:WorldChatRequest;language:PromptLanguage;vaultId:string}) {
  const request=input.request;
  if(!request||typeof request.question!=='string'||!request.question.trim()||request.focusKeys&&(!Array.isArray(request.focusKeys)||request.focusKeys.length>100||new Set(request.focusKeys).size!==request.focusKeys.length))throw new Error('invalid_world_chat_request');
  input.packs.forEach(pack=>validateMobileWorldChatSourcePack(pack,input.vaultId));
  const entries=new Map<string,WorldEntry>();
  for(const pack of input.packs)for(const entry of pack.data.entries)if(!entries.has(entry.key))entries.set(entry.key,entry);
  const keys=request.focusKeys?.length?request.focusKeys.slice(0,6):matchFocus(request.question,[...entries.values()].map(entry=>({key:entry.key,names:[entry.title,...entry.aliases]})),6);
  const pack=input.packs.find(pack=>keys.every(key=>pack.entryKeys.includes(key)));
  if(keys.length&&!pack)throw new Error('El foco de esta pregunta no está reunido en una misma descarga. Vuelve a descargar juntos los elementos que quieras comparar.');
  const empty:MobileWorldChatSnapshot={entries:[],prose:{},scenes:{},rules:[],placePaths:{},presences:[],memberships:{},ruleMemberships:{},secrets:[],knowers:[],beats:[],findings:[]};
  const facts=calculateWorldChatFacts({...request,focusKeys:keys},worldChatSnapshotSource(pack?.data??empty),input.language);
  return {system:worldOperationSystemPrompt('worldChat',input.language)+'\n\nNew creative proposals are not established world canon. Label them accordingly.',user:composeWorldChatContext(facts,input.language),facts,focus:facts.focus,citable:facts.citable,noMaterial:!hasWorldChatMaterial(facts),temperature:0.3,maxTokens:1200};
}
export function validateMobileWorldChatAnswer(input:{text:string;citable:WorldChatRef[];language:PromptLanguage}) {
  const allowed=new Set(input.citable.map(ref=>`${ref.kind}:${ref.id}`));
  return {text:ensureWorldCitations(transformChatProse(input.text,prose=>validateCitations(prose,allowed)),input.citable,input.language)};
}
