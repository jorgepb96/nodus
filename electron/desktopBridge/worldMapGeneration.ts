import { createHash } from 'node:crypto';
import { buildMapPrompt, MAP_STYLES } from '../../shared/mapPrompt';
import type { MapGenerationRequest } from '../maps/mapGeneration';
import { getWorldMap, growMapCanvas, saveMapImage, updateWorldMap } from '../db/worldMapsRepo';
import { growthForEdge } from '../../shared/worldMapGeometry';
import { prepareMapImage } from '../maps/mapImageStore';
import { expandMapCanvas, generateMapImage, promptInputFor, mapGenerationSourceSnapshot } from '../maps/mapGeneration';
import { getDb } from '../db/database';

/** A map request is a specific existing map in the owning vault. No remotely
 * supplied model, coordinate rewrite or arbitrary image storage is accepted. */
export function worldMapGenerationRequest(raw: unknown): MapGenerationRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_map_generation_request');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !['mapId','mode','style','extra','edge','fraction'].includes(key)) ||
      typeof value.mapId !== 'string' || !value.mapId || value.mapId.length > 256 || /[\u0000-\u001f\u007f]/.test(value.mapId) ||
      !['create','restyle','variant','expand'].includes(value.mode as string) ||
      value.style != null && !MAP_STYLES.some(style => style.id === value.style) ||
      value.extra != null && (typeof value.extra !== 'string' || value.extra.length > 300) ||
      value.edge != null && !['north','south','east','west'].includes(value.edge as string) ||
      value.fraction != null && (typeof value.fraction !== 'number' || !Number.isFinite(value.fraction) || value.fraction <= 0 || value.fraction > 2) ||
      value.mode !== 'expand' && (value.edge != null || value.fraction != null) || value.mode === 'expand' && value.style != null) throw new Error('invalid_map_generation_request');
  return value as unknown as MapGenerationRequest;
}

// Scope by the actual owning vault database, never by a globally shared map id.
const active = new WeakMap<object, Set<string>>();
export async function generateMobileWorldMap(raw: unknown, progress: (phase: string) => void, signal?: AbortSignal) {
  const request = worldMapGenerationRequest(raw), db = getDb();
  let maps = active.get(db);
  if (!maps) { maps = new Set(); active.set(db, maps); }
  if (maps.has(request.mapId)) throw new Error('map_generation_busy');
  maps.add(request.mapId);
  try {
    return await (request.mode === 'expand' ? expandMapCanvas(request, {signal,progress}) : generateMapImage(request, {signal,progress}));
  } finally { maps.delete(request.mapId); }
}

const EXTRA_PLACEHOLDER = 'NODUS_MAP_EXTRA_DIRECTION_3DC849';
function sourceMaterial(mapId: string) {
  const map = getWorldMap(mapId); if (!map) throw new Error('record_not_found');
  const input = promptInputFor(map, {mapId,mode:'create'});
  const revision = createHash('sha256').update(mapGenerationSourceSnapshot(map)).digest('hex');
  return {map,input,revision};
}
export function mobileWorldMapGenerationSource(mapId: unknown) {
  if (typeof mapId !== 'string' || !mapId || mapId.length > 256) throw new Error('invalid_map_generation_request');
  return getDb().transaction(() => {
  const {map,input,revision} = sourceMaterial(mapId);
  const prompts: Record<string,string> = {};
  for (const style of MAP_STYLES) for (const mode of ['create','variant','restyle','expand'] as const) {
    const edges = mode === 'expand' ? ['north','south','east','west'] as const : [null];
    for (const edge of edges) prompts[`${mode}:${style.id}:${edge ?? ''}`] = buildMapPrompt({...input,mode,style:style.id,edge,extra:EXTRA_PLACEHOLDER});
  }
  return {version:1,mapId,name:map.name ?? 'Mapa',revision,imageSource:map.imageId ? `nodus-image://map/${encodeURIComponent(map.imageId)}` : null,
    style:map.style ?? 'parchment',placeholder:EXTRA_PLACEHOLDER,prompts};
  })();
}
/** Provider-free publication: its idempotency receipt and the geometry/image
 * mutation commit together. A changed source retains the device result. */
export async function saveMobileWorldMapImage(raw: unknown, deviceGrant: string, signal?: AbortSignal) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_map_publication');
  const value = raw as Record<string,unknown>;
  if (Object.keys(value).some(key=>!['request','requestId','revision','model','mime','bytes'].includes(key)) ||
    typeof value.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.requestId) ||
    typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision) ||
    typeof value.bytes !== 'string' || value.bytes.length > 28_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.bytes) ||
    !['image/png','image/jpeg','image/webp'].includes(value.mime as string) ||
    !value.model || typeof value.model !== 'object' || Array.isArray(value.model)) throw new Error('invalid_map_publication');
  const model=value.model as Record<string,unknown>, request=worldMapGenerationRequest(value.request);
  if (!['openai','openrouter','gemini'].includes(model.provider as string) || typeof model.model !== 'string' || !model.model || model.model.length>256 || Object.keys(model).some(key=>!['provider','model'].includes(key))) throw new Error('invalid_map_publication');
  if (['restyle','expand'].includes(request.mode) && (model.provider !== 'gemini' || /imagen/i.test(model.model))) throw new Error('map_reference_provider_required');
  const bytes=Buffer.from(value.bytes,'base64');
  if (!bytes.length || bytes.length>20_000_000 || bytes.toString('base64')!==value.bytes) throw new Error('invalid_map_publication');
  signal?.throwIfAborted();
  const db=getDb(), fingerprint=createHash('sha256').update(JSON.stringify([value.requestId,value.revision,request.mapId,request.mode,request.style??null,request.extra??null,request.edge??null,request.fraction??null,model.provider,model.model,value.mime,value.bytes])).digest('hex');
  db.exec('CREATE TABLE IF NOT EXISTS mobile_map_publications (request_id TEXT NOT NULL, device_grant TEXT NOT NULL, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY(request_id,device_grant))');
  const saved=db.prepare('SELECT fingerprint,result_json FROM mobile_map_publications WHERE request_id=? AND device_grant=?').get(value.requestId,deviceGrant) as {fingerprint:string;result_json:string}|undefined;
  if(saved){if(saved.fingerprint!==fingerprint)throw new Error('map_publication_identity_conflict');return JSON.parse(saved.result_json);}
  const baseline=sourceMaterial(request.mapId);
  if (baseline.revision !== value.revision) throw new Error('map_generation_source_conflict');
  const prepared=await prepareMapImage(bytes);
  signal?.throwIfAborted();
  return db.transaction(()=>{
    if(sourceMaterial(request.mapId).revision!==value.revision)throw new Error('map_generation_source_conflict');
    const input=promptInputFor(baseline.map,request);
    if(request.mode==='expand')growMapCanvas(request.mapId,growthForEdge(request.edge??'north',request.fraction??.5));
    saveMapImage({mapId:request.mapId,role:'base',...prepared,prompt:buildMapPrompt(input),provider:model.provider==='gemini'?'google':model.provider as 'openai'|'openrouter',model:model.model as string,style:request.mode==='expand'?baseline.map.style:request.style??baseline.map.style,generated:true});
    if(request.mode!=='expand'&&request.style)updateWorldMap(request.mapId,{style:request.style});
    const result={map:getWorldMap(request.mapId),degraded:false,notice:null};
    db.prepare('INSERT INTO mobile_map_publications VALUES (?,?,?,?)').run(value.requestId,deviceGrant,fingerprint,JSON.stringify(result));
    return result;
  })();
}
