import {getDb} from './database';
import {getActiveVault} from '../vaults/vaultRegistry';
import {desktopWorldChatSource} from './worldChatSource';
import {listWorldRules} from './worldRulesRepo';
import {listKnowers} from './worldStoryRepo';
import {matchFocus} from '@shared/worldChatContext';
import {findingsFor} from '@shared/worldFindings';
import {sha256Snapshot} from '@shared/databaseResearchEngine';
import {MOBILE_WORLD_CHAT_MAX_BYTES,worldChatPackPayload,type MobileWorldChatSourcePack,type MobileWorldChatSnapshot} from '@shared/mobileWorldChat';

/** One read transaction captures selected sheets and the temporal constraints
 * their questions use. No model, extraction, indexing or whole-workspace copy. */
export function getMobileWorldChatSourcePack(raw:unknown):MobileWorldChatSourcePack {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_world_chat_source_request');
  const input=raw as {entryKeys?:string[];question?:string};
  if(Object.keys(input).some(key=>!['entryKeys','question'].includes(key))||input.entryKeys!==undefined&&(!Array.isArray(input.entryKeys)||input.entryKeys.length>100||new Set(input.entryKeys).size!==input.entryKeys.length||input.entryKeys.some(key=>typeof key!=='string'||key.length>512))||input.question!==undefined&&typeof input.question!=='string')throw new Error('invalid_world_chat_source_request');
  const vault=getActiveVault();if(vault.type!=='worldbuilding')throw new Error('world_chat_vault_required');
  return getDb().transaction(()=>{
    const source=desktopWorldChatSource(),keys=input.entryKeys?.length?input.entryKeys:matchFocus(input.question??'',source.entries.map(entry=>({key:entry.key,names:[entry.title,...entry.aliases]})),6);
    const selected=new Set(keys),entries=source.entries.filter(entry=>selected.has(entry.key));
    if(entries.length!==keys.length)throw new Error('world_chat_source_unavailable');
    const data:MobileWorldChatSnapshot={entries,prose:{},scenes:{},rules:[],placePaths:{},presences:[],memberships:{},ruleMemberships:{},secrets:[],knowers:[],beats:[],findings:[]};
    const finish=()=>{const pack:MobileWorldChatSourcePack={version:1,vaultId:vault.id,capturedAt:new Date().toISOString(),id:'',entryKeys:keys,data};pack.id=sha256Snapshot(worldChatPackPayload(pack));if(Buffer.byteLength(JSON.stringify(pack),'utf8')>MOBILE_WORLD_CHAT_MAX_BYTES)throw new Error('El contexto seleccionado supera 16 MB. Reduce los elementos que llevas juntos.');return pack;};
    if(!entries.length)return finish();
    const characters=entries.filter(entry=>entry.kind==='character'),scenes=entries.filter(entry=>entry.kind==='scene');
    for(const entry of entries)data.prose[entry.key]=source.prose(entry);
    const places=new Set(entries.filter(entry=>entry.kind==='place').map(entry=>entry.id));
    for(const scene of scenes){const row=source.scene(scene.id);if(row){data.scenes[scene.id]=row;if(row.placeId)places.add(row.placeId);}}
    for(const place of places){
      const path:string[]=[],seen=new Set<string>();let id:string|null=place;
      while(id&&!seen.has(id)){seen.add(id);path.push(id);const row=getDb().prepare('SELECT parent_id FROM places WHERE place_id=?').get(id) as {parent_id:string|null}|undefined;id=row?.parent_id??null;}
      data.placePaths[place]=path;
    }
    const secretIds=new Set<string>(),groupIds=new Set<string>(),characterIds=new Set(characters.map(entry=>entry.id));
    for(const entry of characters){
      data.memberships[entry.id]=source.memberships(entry.id);
      data.ruleMemberships[entry.id]=getDb().prepare('SELECT group_id,from_world_day,to_world_day FROM character_affiliations WHERE person_id=?').all(entry.id) as MobileWorldChatSnapshot['ruleMemberships'][string];
      data.ruleMemberships[entry.id].forEach(row=>groupIds.add(row.group_id));
      const secrets=source.secretsForCharacter(entry.id);[...secrets.owned,...secrets.known].forEach(secret=>secretIds.add(secret.secretId));
    }
    const placeIds=new Set(Object.values(data.placePaths).flat());
    data.rules=listWorldRules().filter(rule=>rule.scopeKind==='world'||rule.scopeKind==='group'&&rule.scopeId&&groupIds.has(rule.scopeId)||rule.scopeKind==='place'&&rule.scopeId&&placeIds.has(rule.scopeId));
    data.presences=source.presences().filter(presence=>characterIds.has(presence.personId));
    data.secrets=source.secrets().filter(secret=>secretIds.has(secret.secretId));
    data.knowers=data.secrets.flatMap(secret=>listKnowers(secret.secretId));
    data.beats=scenes.flatMap(scene=>source.beatsForScene(scene.id));
    const all=source.findings(),relevant=new Set(entries.flatMap(entry=>findingsFor(entry,all)).map(finding=>finding.fingerprint));data.findings=all.filter(finding=>relevant.has(finding.fingerprint));
    return finish();
  })();
}
