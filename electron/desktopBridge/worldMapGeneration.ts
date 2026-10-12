import { MAP_STYLES } from '../../shared/mapPrompt';
import type { MapGenerationRequest } from '../maps/mapGeneration';
import { expandMapCanvas, generateMapImage } from '../maps/mapGeneration';
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
      value.mode !== 'expand' && (value.edge != null || value.fraction != null)) throw new Error('invalid_map_generation_request');
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
