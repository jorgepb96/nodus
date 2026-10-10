import { createHash } from 'node:crypto';
import type { FeatureCollection } from 'geojson';
import { assertPublicHost } from '../../../skill-capabilities/publicHost';
import { MAP_LIMITS, validateMapGeometry, validateMapQuery, type MapQuery, type MapSource } from '../../../packages/capability-api/src/maps';
import { retrieveOpenHistoricalMap } from './openHistoricalMap';

/** Reviewed open sources, not a URL proxy. Every URL is constructed here from a fixed
 *  origin/path template. Neither a Skill nor a provider response may supply a fetch URL. */
export const NATURAL_EARTH_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson';
export const OPENHISTORICALMAP_API = 'https://overpass-api.openhistoricalmap.org/api/interpreter';
/** The only two Overpass queries this adapter may issue, as the templates it builds them from:
 *  an index of the boundary relations inside the frame, and the geometry of the ones whose own
 *  dates cover the period. The URL is rebuilt from validated fields, so no caller text reaches it. */
const OHM_INDEX = /^\[out:json\]\[timeout:\d{1,3}\];relation\["boundary"="administrative"\]\["admin_level"~"\^\((?:2|4)\)\$"\]\(-?\d{1,3}(?:\.\d+)?(?:,-?\d{1,3}(?:\.\d+)?){3}\);out tags;$/;
const OHM_GEOMETRY = /^\[out:json\]\[timeout:\d{1,3}\];relation\(id:\d{1,12}(?:,\d{1,12}){0,119}\);out geom;$/;
export function assertApprovedMapUrl(url: string): void {
  if (url === NATURAL_EARTH_URL || /^https:\/\/www\.geoboundaries\.org\/api\/current\/gbOpen\/[A-Z]{3}\/ADM[012]\/$/.test(url)) return;
  if (url.startsWith(`${OPENHISTORICALMAP_API}?data=`)) {
    const data = new URL(url).searchParams.get('data') ?? '';
    if (OHM_INDEX.test(data) || OHM_GEOMETRY.test(data)) return;
    throw new Error('Map source URL is not approved.');
  }
  const match = /^https:\/\/(?:raw\.githubusercontent\.com\/|media\.githubusercontent\.com\/media\/)wmgeolab\/geoBoundaries\/[a-f0-9]{7,40}\/releaseData\/gbOpen\/([A-Z]{3})\/ADM([012])\/geoBoundaries-([A-Z]{3})-ADM([012])_simplified\.geojson$/.exec(url);
  if (!match || match[1] !== match[3] || match[2] !== match[4]) throw new Error('Map source URL is not approved.');
}
export interface MapSourceTransport { read(url: string, signal: AbortSignal, limit: number): Promise<Uint8Array> }
/** DNS and injected transports may not honor AbortSignal themselves. The service
 * still stops waiting at its deadline; late bytes cannot register a dataset. */
function readWithCancellation(transport: MapSourceTransport, url: string, signal: AbortSignal, limit: number): Promise<Uint8Array> {
  signal.throwIfAborted();
  return new Promise((resolve,reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(() => { signal.throwIfAborted(); return transport.read(url,signal,limit); }).then(
      value => { signal.removeEventListener('abort',abort); resolve(value); },
      error => { signal.removeEventListener('abort',abort); reject(error); },
    );
  });
}
export const mapSourceTransport: MapSourceTransport = {
  async read(url, signal, limit) {
    assertApprovedMapUrl(url);
    await assertPublicHost(new URL(url).hostname); signal.throwIfAborted();
    const response = await fetch(url, { signal, redirect:'error', credentials:'omit', headers:{Accept:'application/json, application/geo+json, text/plain', 'User-Agent':'NodusResearch/5.8.1 (https://nodusresearch.com)'} });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Map source returned HTTP ${response.status}.`); }
    if (Number(response.headers.get('content-length') ?? 0) > limit) { await response.body?.cancel(); throw new Error('Map source exceeds its byte limit.'); }
    const reader=response.body?.getReader(); if(!reader) throw new Error('Map source returned an empty response.');
    let total=0; const chunks: Uint8Array[]=[];
    try { for (;;) { signal.throwIfAborted(); const next=await reader.read(); if(next.done) break; total+=next.value.length; if(total>limit) throw new Error('Map source exceeds its byte limit.'); chunks.push(next.value); } }
    finally { await reader.cancel().catch(()=>{}); }
    return Buffer.concat(chunks);
  },
};
function sourceText(value: unknown, max=500): string { if(typeof value !== 'string' || !value.trim() || value.length>max || (/[<>]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32))) throw new Error('Invalid map source metadata.'); return value; }
const https = (value: unknown): string => { const s=sourceText(value,1500); const u=new URL(s.startsWith('https://')?s:`https://${s}`); if(u.protocol!=='https:' || u.username || u.password) throw new Error('Invalid map source link.'); return u.href; };

/** Allow known terms only. gbOpen is a catalogue, not a licence override for its
 * original sources; unfamiliar or share-alike licences wait for an adapter review. */
export function geoBoundaryLicense(meta: Record<string, unknown>): { license: string; url: string } {
  const name=sourceText(meta.boundaryLicense,200);
  if (/^(Creative Commons Attribution 4\.0 International \(CC BY 4\.0\)|Creative Commons Attribution 4\.0 \(CC BY 4\.0\)|CC BY 4\.0)$/.test(name)) return {license:'CC BY 4.0',url:'https://creativecommons.org/licenses/by/4.0/'};
  if (/^(Creative Commons Attribution 3\.0 Unported \(CC BY 3\.0\)|CC BY 3\.0)$/.test(name)) return {license:'CC BY 3.0',url:'https://creativecommons.org/licenses/by/3.0/'};
  if (name==='CC0') return {license:name,url:'https://creativecommons.org/publicdomain/zero/1.0/'};
  if (name==='Public Domain') return {license:name,url:https(meta.licenseSource)};
  if (name==='National Institute of Statistics (INE) Data License' && new URL(https(meta.licenseSource)).hostname==='www.ine.es') return {license:name,url:https(meta.licenseSource)};
  throw new Error(`The source licence has not been approved for maps: ${name}.`);
}

export async function retrieveMapSource(input: MapQuery, signal: AbortSignal, transport: MapSourceTransport = mapSourceTransport, window?: readonly [number, number, number, number]): Promise<{geojson: FeatureCollection; source: MapSource}> {
  const query=validateMapQuery(input); signal.throwIfAborted();
  if(query.period && query.provider!=='openhistoricalmap') throw new Error('This provider does not support historical date queries. No modern geometry was substituted.');
  let bytes: Uint8Array, source: Omit<MapSource,'sha256'>;
  const boundedRead = async (url: string, limit: number) => { const value=await readWithCancellation(transport,url,signal,limit); signal.throwIfAborted(); if(value.byteLength>limit) throw new Error('Map source exceeds its byte limit.'); return value; };
  if(query.provider==='openhistoricalmap') {
    return retrieveOpenHistoricalMap({query, window, signal, read: boundedRead});
  }
  if(query.provider==='natural-earth') {
    bytes=await boundedRead(NATURAL_EARTH_URL,MAP_LIMITS.responseBytes);
    source={origin:'provider',provider:query.provider,label:'Natural Earth · admin 0 · 110m',attribution:'Made with Natural Earth — naturalearthdata.com',license:'Public domain',url:'https://www.naturalearthdata.com/about/terms-of-use/',version:'5.1.2',retrievedAt:new Date().toISOString(),modifications:['Property normalization; cartographic boundaries at 1:110m.']};
  } else {
    const endpoint=`https://www.geoboundaries.org/api/current/gbOpen/${query.country}/ADM${query.level}/`;
    const meta=JSON.parse(Buffer.from(await boundedRead(endpoint,64000)).toString('utf8'));
    if(meta.boundaryISO!==query.country || meta.boundaryType!==`ADM${query.level}`) throw new Error('Map source returned different administrative boundaries.');
    const terms=geoBoundaryLicense(meta);
    const expected=new RegExp(`^https://github\\.com/wmgeolab/geoBoundaries/raw/([a-f0-9]{7,40})/releaseData/gbOpen/${query.country}/ADM${query.level}/geoBoundaries-${query.country}-ADM${query.level}_simplified\\.geojson$`);
    const revision=expected.exec(String(meta.simplifiedGeometryGeoJSON))?.[1];
    if(!revision) throw new Error('Map source returned an unapproved download location.');
    const relative=`wmgeolab/geoBoundaries/${revision}/releaseData/gbOpen/${query.country}/ADM${query.level}/geoBoundaries-${query.country}-ADM${query.level}_simplified.geojson`;
    bytes=await boundedRead(`https://raw.githubusercontent.com/${relative}`,MAP_LIMITS.responseBytes);
    const pointer=/^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)\n?$/.exec(Buffer.from(bytes).toString('utf8'));
    if(pointer) {
      if(Number(pointer[2])>MAP_LIMITS.responseBytes) throw new Error('Map source exceeds its byte limit.');
      bytes=await boundedRead(`https://media.githubusercontent.com/media/${relative}`,MAP_LIMITS.responseBytes);
      if(bytes.byteLength!==Number(pointer[2]) || createHash('sha256').update(bytes).digest('hex')!==pointer[1]) throw new Error('Map source content failed its pinned digest check.');
    }
    const year=sourceText(meta.boundaryYearRepresented,80), owner=sourceText(meta.boundarySource,160);
    source={origin:'provider',provider:query.provider,label:`geoBoundaries ${query.country} ADM${query.level}`,attribution:`geoBoundaries (geoboundaries.org), Runfola et al. (2020); adapted from ${owner}; source year ${year}`,license:`geoBoundaries CC BY 4.0; original: ${terms.license}`,url:terms.url,version:`${revision} / ${sourceText(meta.boundaryID,100)}`,retrievedAt:new Date().toISOString(),modifications:[`Simplified provider geometry; year represented: ${year}.`, `Original source: ${https(meta.boundarySourceURL)}`, `Original licence: ${https(meta.licenseSource)}`, 'This is a published snapshot, not a historical-border reconstruction.']};
    source.licenseUrls = [...new Set(['https://creativecommons.org/licenses/by/4.0/', terms.url])];
  }
  const parsed=JSON.parse(Buffer.from(bytes).toString('utf8'));
  if(parsed.type!=='FeatureCollection' || !Array.isArray(parsed.features) || parsed.features.length>MAP_LIMITS.features) throw new Error('Map source did not return bounded GeoJSON.');
  const geojson: FeatureCollection={type:'FeatureCollection',features:parsed.features.map((f: any) => {
    const p=f.properties ?? {};
    const id=query.provider==='natural-earth'?p.ADM0_A3:p.shapeID;
    return {type:'Feature',id:sourceText(String(id),160),properties:query.provider==='natural-earth'?{name:p.NAME,iso:p.ADM0_A3,continent:p.CONTINENT}:{name:p.shapeName,iso:p.shapeISO || null,id:p.shapeID},geometry:f.geometry};
  })};
  return {geojson:validateMapGeometry(geojson),source:{...source,sha256:createHash('sha256').update(bytes).digest('hex')}};
}
