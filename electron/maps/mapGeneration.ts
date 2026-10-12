import { getDb } from '../db/database';
import { GoogleGenAI } from '@google/genai';
import type { ImageProvider, MapImageRole, WorldMap, WorldMapKind } from '@shared/types';
import {
  buildMapPrompt,
  needsReference,
  supportsReferenceImage,
  type MapPromptInput,
  type MapPromptMode,
  type MapStyleId,
} from '@shared/mapPrompt';
import {
  bearingOf,
} from '@shared/mapPrompt';
import {
  growthForEdge,
  normalizeFootprint,
  projectIntoChild,
  type CanvasGrowth,
  type MapEdge,
  type MapFootprint,
} from '@shared/worldMapGeometry';
import { completeText } from '../ai/aiClient';
import { callImageProvider, type GeneratedImageBytes } from '../ai/decorativeImages';
import { getApiKey } from '../secrets/secretStore';
import { getSettings } from '../db/settingsRepo';
import {
  createWorldMap,
  getMapImageBlob,
  getWorldMap,
  growMapCanvas,
  saveMapImage,
  updateWorldMap,
} from '../db/worldMapsRepo';
import { createMapMarker, listMapMarkers } from '../db/mapMarkersRepo';
import { cropMapImage, extendMapCanvas, prepareMapImage } from './mapImageStore';

/**
 * Generating and enlarging maps.
 *
 * Three separate jobs live here, and the third is the dangerous one:
 *
 *   1. **Create** — a map from a prompt.
 *   2. **Zoom** — a detail map of a boxed region. Offered in two flavours: a plain CROP
 *      with no AI at all (instant, free, offline and geographically EXACT — what an
 *      author who commissioned their map actually wants) and an AI pass over that crop.
 *      Either way the markers inside the box are reprojected into the child map.
 *   3. **Expand** — outpainting. This one moves EVERY coordinate the map holds, and the
 *      pixels and the coordinates must agree exactly, which is why both are given the
 *      SAME `CanvasGrowth` object.
 *
 * Every provider or file original is preserved byte-for-byte. Lists receive an independent
 * thumbnail; zoom, export and further map operations always use the full source.
 */

const IMAGE_TIMEOUT_MS = 180_000;
const VISION_TIMEOUT_MS = 60_000;

export interface MapGenerationRequest {
  mapId: string;
  mode: MapPromptMode;
  style?: MapStyleId;
  extra?: string | null;
  /** `zoom` only: the region of the parent, in normalized parent coordinates. */
  region?: MapFootprint;
  /** `zoom` only: the name for the new child map. */
  childName?: string;
  /** `expand` only. */
  edge?: MapEdge;
  fraction?: number;
  /** `zoom` only: skip the model entirely and just crop. */
  cropOnly?: boolean;
}

export interface MapGenerationResult {
  map: WorldMap;
  /** True when the provider could not take a reference and prose was used instead. */
  degraded: boolean;
  /** What to tell the author, when anything needs saying. */
  notice: string | null;
}

function providerKey(provider: ImageProvider): string | null {
  if (provider === 'nodus') return null;
  if (provider === 'google') return getApiKey('gemini');
  return getApiKey(provider);
}

/**
 * Generate with a reference image where the provider supports it.
 *
 * `callImageProvider` in decorativeImages.ts is text-only and stays that way — widening
 * it would drag portrait generation into a code path it has no use for. Google is the one
 * provider wired here because it is the one whose image-to-image is a first-class part of
 * the same call; everything else falls back to prose (below), which is honest and works.
 */
async function generateWithReference(
  provider: ImageProvider,
  model: string,
  prompt: string,
  reference: { bytes: Buffer; mimeType: string },
): Promise<GeneratedImageBytes> {
  if (provider !== 'google') throw new Error('reference-unsupported');
  const key = providerKey('google');
  if (!key) throw new Error('Falta la clave de Google.');
  const client = new GoogleGenAI({ apiKey: key });
  const response = await client.interactions.create(
    {
      model,
      input: [
        { type: 'input_text', text: prompt },
        { type: 'input_image', image_url: `data:${reference.mimeType};base64,${reference.bytes.toString('base64')}` },
      ] as never,
      store: false,
      // JPEG is the only mime the Interactions API accepts; PNG returns a 400.
      response_format: { type: 'image', mime_type: 'image/jpeg', image_size: '2K' },
    },
    { timeout: IMAGE_TIMEOUT_MS, maxRetries: 0 },
  );
  const data = response.output_image?.data;
  if (!data) throw new Error('Google no devolvió datos de imagen.');
  return { bytes: Buffer.from(data, 'base64'), mimeType: response.output_image?.mime_type ?? 'image/jpeg' };
}

/**
 * The honest fallback: a VISION model describes the reference in prose, and the prose
 * feeds a text-to-image call.
 *
 * It comes out worse — the result resembles the crop only approximately — and the caller
 * must say so in the interface rather than quietly producing something that does not
 * match. Simulating image-to-image in silence would be the single most misleading thing
 * this feature could do.
 */
async function describeReference(reference: { bytes: Buffer; mimeType: string }): Promise<string> {
  const settings = getSettings();
  const model = settings.visionModel ?? settings.synthesisModel ?? null;
  if (!model) throw new Error('No hay un modelo de visión configurado para describir el mapa.');
  const described = await completeText(
    {
      system: [
        'Describe the geography of this map fragment so another artist can redraw it.',
        'Coastlines, landmasses, rivers, mountain ranges, forests and their relative positions.',
        'Maximum 90 words. Geography only: no style, no colours, no text you can read on it.',
      ].join('\n'),
      user: 'Describe this map fragment.',
      images: [{ mediaType: reference.mimeType, base64: reference.bytes.toString('base64') }],
      temperature: 0.2,
      maxTokens: 200,
      noRetry: true,
      timeoutMs: VISION_TIMEOUT_MS,
    },
    model,
  );
  const clean = described.replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!clean) throw new Error('El modelo de visión no devolvió una descripción.');
  return clean;
}

/** The places already pinned on a map, described by name, kind and bearing. */
function placeHints(mapId: string, region?: MapFootprint) {
  return listMapMarkers(mapId)
    .filter((marker) => marker.placeName)
    .filter((marker) => !region || projectIntoChild({ x: marker.x, y: marker.y }, region) !== null)
    .map((marker) => {
      const local = region ? projectIntoChild({ x: marker.x, y: marker.y }, region)! : { x: marker.x, y: marker.y };
      return { name: marker.placeName!, kind: marker.placeKind, bearing: bearingOf(local.x, local.y) };
    });
}

/**
 * The world's visual identity: the `visual_seed` of the map this one hangs from, walking
 * up to the root.
 *
 * Deliberately NOT a new settings field. A world already has somewhere to say what it
 * looks like — the seed of its world map — and a second home for the same fact is a
 * second answer that drifts. Walking up also means a city map inherits the look of its
 * continent without the author repeating themselves.
 */
function worldVisualSeed(map: WorldMap): string | null {
  const seen = new Set<string>();
  let current: WorldMap | null = map.parentMapId ? getWorldMap(map.parentMapId) : null;
  let seed: string | null = null;
  while (current && !seen.has(current.mapId)) {
    seen.add(current.mapId);
    if (current.visualSeed) seed = current.visualSeed;
    current = current.parentMapId ? getWorldMap(current.parentMapId) : null;
  }
  return seed;
}

function extentOf(map: WorldMap): { distance: number; unit: string } | null {
  if (!map.scaleDistance || !map.scaleUnit) return null;
  return { distance: map.scaleDistance, unit: map.scaleUnit };
}

interface ResolvedModel {
  provider: ImageProvider;
  model: string;
}

function imageModel(): ResolvedModel {
  const settings = getSettings();
  const provider = settings.imageProvider;
  const model = settings.imageModel;
  if (!provider || !model) throw new Error('Configura un proveedor y modelo de imagen en Ajustes → Proveedores.');
  return { provider, model };
}

/**
 * Run a generation, degrading honestly when the provider cannot take a reference.
 *
 * Returns the bytes plus whether the reference was actually used, because the interface
 * has to be able to say "your image model cannot start from a reference; the result will
 * only roughly resemble the crop".
 */
async function runGeneration(
  input: MapPromptInput,
  reference: { bytes: Buffer; mimeType: string } | null,
): Promise<{ generated: GeneratedImageBytes; degraded: boolean; prompt: string; provider: ImageProvider; model: string }> {
  const { provider, model } = imageModel();
  const wantsReference = needsReference(input.mode) && !!reference;
  const capable = wantsReference && supportsReferenceImage(provider, model);

  if (capable) {
    try {
      const prompt = buildMapPrompt(input);
      return { generated: await generateWithReference(provider, model, prompt, reference!), degraded: false, prompt, provider, model };
    } catch (error) {
      // A provider we believed capable and that refused is still a degradation, not a
      // failure: the author gets a map plus an honest notice instead of an error.
      if (!(error instanceof Error) || error.message !== 'reference-unsupported') throw error;
    }
  }

  let prompt = buildMapPrompt(input);
  let degraded = false;
  if (wantsReference) {
    const described = await describeReference(reference!);
    prompt = buildMapPrompt({ ...input, extra: `${input.extra ?? ''} The geography to reproduce: ${described}`.trim() });
    degraded = true;
  }
  return { generated: await callImageProvider(provider, model, prompt), degraded, prompt, provider, model };
}

function noticeFor(degraded: boolean): string | null {
  return degraded
    ? 'Tu modelo de imagen no puede partir de una referencia, así que Nodus le ha descrito el mapa con palabras. El resultado se parecerá solo aproximadamente al original.'
    : null;
}

async function baseImageOf(map: WorldMap): Promise<{ bytes: Buffer; mimeType: string }> {
  if (!map.imageId) throw new Error('Este mapa no tiene imagen todavía.');
  const blob = getMapImageBlob(map.imageId);
  if (!blob) throw new Error('No se encontró la imagen de este mapa.');
  return { bytes: blob.blob, mimeType: blob.mimeType };
}

export function promptInputFor(map: WorldMap, request: MapGenerationRequest, region?: MapFootprint): MapPromptInput {
  return {
    mode: request.mode,
    kind: map.kind as WorldMapKind,
    style: (request.style ?? map.style ?? 'parchment') as MapStyleId,
    worldSeed: worldVisualSeed(map),
    mapSeed: map.visualSeed,
    places: placeHints(map.mapId, region),
    extent: extentOf(map),
    modelLabels: map.modelLabels,
    extra: request.extra ?? null,
    edge: request.edge ?? null,
  };
}

/** Create or regenerate a map's own image. */
export interface MapGenerationLifecycle { signal?: AbortSignal; progress?: (phase: string) => void }
function checkpoint(lifecycle: MapGenerationLifecycle, phase: string) { lifecycle.signal?.throwIfAborted(); lifecycle.progress?.(phase); }
export function mapGenerationSourceSnapshot(map: WorldMap): string { return JSON.stringify({map,input:promptInputFor(map,{mapId:map.mapId,mode:'create'}),markers:listMapMarkers(map.mapId)}); }
function unchangedMap(map: WorldMap, snapshot: string) { if (JSON.stringify(getWorldMap(map.mapId)) !== JSON.stringify(map) || mapGenerationSourceSnapshot(map) !== snapshot) throw new Error('map_generation_source_conflict'); }

export async function generateMapImage(request: MapGenerationRequest, lifecycle: MapGenerationLifecycle = {}): Promise<MapGenerationResult> {
  checkpoint(lifecycle, 'context');
  const map = getWorldMap(request.mapId);
  if (!map) throw new Error('Mapa no encontrado.');
  const snapshot = mapGenerationSourceSnapshot(map);
  const reference = request.mode === 'restyle' || request.mode === 'variant' ? await baseImageOf(map).catch(() => null) : null;
  checkpoint(lifecycle, 'generating');
  const { generated, degraded, prompt, provider, model } = await runGeneration(promptInputFor(map, request), reference);
  const prepared = await prepareMapImage(generated.bytes);
  checkpoint(lifecycle, 'saving');
  unchangedMap(map, snapshot);
  getDb().transaction(() => {
  saveMapImage({
    mapId: map.mapId,
    role: 'base' as MapImageRole,
    ...prepared,
    prompt,
    provider,
    model,
    style: request.style ?? map.style ?? null,
    generated: true,
  });
  if (request.style) updateWorldMap(map.mapId, { style: request.style });
  })();
  return { map: getWorldMap(map.mapId)!, degraded, notice: noticeFor(degraded) };
}

/**
 * Zoom into a region: a NEW child map, with the parent's markers reprojected into it.
 *
 * The reprojection is what makes this feel like magic rather than like work: enlarge the
 * north-west and the three cities you had already pinned turn up in the right places on
 * the new map, untouched by hand.
 *
 * `cropOnly` skips the model entirely. That path is offered FIRST in the interface: it is
 * instant, free, works offline and is geographically exact.
 */
export async function zoomIntoRegion(request: MapGenerationRequest): Promise<MapGenerationResult> {
  const parent = getWorldMap(request.mapId);
  if (!parent) throw new Error('Mapa no encontrado.');
  if (!request.region) throw new Error('Falta la región a ampliar.');
  const region = normalizeFootprint(request.region);
  const source = await baseImageOf(parent);

  const child = createWorldMap({
    name: request.childName?.trim() || `${parent.name} · detalle`,
    kind: parent.kind,
    parentMapId: parent.mapId,
    parentX0: region.x0,
    parentY0: region.y0,
    parentX1: region.x1,
    parentY1: region.y1,
    style: request.style ?? parent.style ?? null,
    visualSeed: parent.visualSeed,
    projection: 'flat',
  });

  const cropped = await cropMapImage(source.bytes, region);
  let prepared = cropped;
  let degraded = false;
  let prompt: string | null = null;

  if (!request.cropOnly) {
    const result = await runGeneration(
      promptInputFor({ ...parent, mapId: child.mapId, visualSeed: parent.visualSeed }, { ...request, mode: 'zoom' }, region),
      { bytes: cropped.blob, mimeType: cropped.mimeType },
    );
    prepared = await prepareMapImage(result.generated.bytes);
    degraded = result.degraded;
    prompt = result.prompt;
  }

  const models = request.cropOnly ? null : imageModel();
  saveMapImage({
    mapId: child.mapId,
    role: 'base',
    ...prepared,
    prompt,
    provider: models?.provider ?? null,
    model: models?.model ?? null,
    style: request.style ?? parent.style ?? null,
    generated: !request.cropOnly,
  });

  // The parent's scale flows down, so the child is measurable without calibrating it.
  const inherited = inheritedScaleFor(parent, region);
  if (inherited) updateWorldMap(child.mapId, inherited);

  // …and the markers inside the box land in the right places on the new map.
  for (const marker of listMapMarkers(parent.mapId)) {
    const local = projectIntoChild({ x: marker.x, y: marker.y }, region);
    if (!local) continue;
    createMapMarker({
      mapId: child.mapId,
      placeId: marker.placeId,
      label: marker.label,
      geometryKind: 'point',
      x: local.x,
      y: local.y,
      icon: marker.icon,
      color: marker.color,
      fromWorldDay: marker.fromWorldDay,
      toWorldDay: marker.toWorldDay,
    });
  }

  return { map: getWorldMap(child.mapId)!, degraded, notice: noticeFor(degraded) };
}

function inheritedScaleFor(parent: WorldMap, region: MapFootprint) {
  if (!parent.scaleDistance || !parent.scaleUnit || parent.widthPx <= 0) return null;
  // The parent's own calibration, scaled to the width of the box.
  const parentAcross = parent.scaleDistance / segmentFraction(parent);
  const width = parentAcross * (region.x1 - region.x0);
  if (!(width > 0)) return null;
  return {
    scaleX0: 0, scaleY0: 0.5, scaleX1: 1, scaleY1: 0.5,
    scaleDistance: width, scaleUnit: parent.scaleUnit,
  };
}

/** What fraction of the parent's WIDTH its calibration segment spans. */
function segmentFraction(map: WorldMap): number {
  if (map.scaleX0 == null || map.scaleY0 == null || map.scaleX1 == null || map.scaleY1 == null) return 1;
  const dx = (map.scaleX1 - map.scaleX0) * map.widthPx;
  const dy = (map.scaleY1 - map.scaleY0) * map.heightPx;
  const length = Math.hypot(dx, dy);
  return length > 0 ? length / map.widthPx : 1;
}

/**
 * Grow the canvas by one edge.
 *
 * THE most dangerous operation in the feature: the pixels and the coordinates must agree
 * exactly, so both are driven by the SAME `CanvasGrowth`. `growMapCanvas` moves every
 * marker, every vertex and both ends of the calibration in one transaction; if the image
 * were computed from a different growth the map would be silently, permanently wrong.
 */
export async function expandMapCanvas(request: MapGenerationRequest, lifecycle: MapGenerationLifecycle = {}): Promise<MapGenerationResult> {
  checkpoint(lifecycle, 'context');
  const map = getWorldMap(request.mapId);
  if (!map) throw new Error('Mapa no encontrado.');
  const snapshot = mapGenerationSourceSnapshot(map);
  const edge = request.edge ?? 'north';
  const fraction = request.fraction && request.fraction > 0 ? Math.min(2, request.fraction) : 0.5;
  const growth: CanvasGrowth = growthForEdge(edge, fraction);
  const source = await baseImageOf(map);

  // The canvas the model is asked to continue: the old image in its new position, the
  // rest neutral. Same growth object as the coordinates below — that is the invariant.
  const canvas = await extendMapCanvas(source.bytes, growth);
  checkpoint(lifecycle, 'generating');
  const { generated, degraded, prompt, provider, model } = await runGeneration(
    promptInputFor(map, { ...request, mode: 'expand', edge }),
    { bytes: canvas.blob, mimeType: canvas.mimeType },
  );
  const prepared = await prepareMapImage(generated.bytes);

  // Coordinates first: if this throws, the map keeps its old image AND its old
  // coordinates, which is a consistent state. The reverse order would not be.
  checkpoint(lifecycle, 'saving');
  unchangedMap(map, snapshot);
  getDb().transaction(() => {
  growMapCanvas(map.mapId, growth);
  saveMapImage({
    mapId: map.mapId,
    role: 'base',
    ...prepared,
    prompt,
    provider,
    model,
    style: map.style,
    generated: true,
  });
  })();
  return { map: getWorldMap(map.mapId)!, degraded, notice: noticeFor(degraded) };
}

// ── annotating an uploaded map with vision ──────────────────────────────────────

export interface SuggestedMarker {
  name: string;
  kind: string | null;
  x: number;
  y: number;
}

/**
 * Look at a map and propose pins.
 *
 * The shortcut from "I have a PNG" to "I have a living map", and the reason it lands in
 * M3 rather than with the rest of the AI work: it needs markers to exist, not image
 * generation. It uses `aiClient`'s vision support — a capability already paid for and
 * proven — and every suggestion is accepted one at a time, so the cost of a wrong one is
 * a single click.
 */
export async function suggestMapMarkers(mapId: string): Promise<SuggestedMarker[]> {
  const map = getWorldMap(mapId);
  if (!map) throw new Error('Mapa no encontrado.');
  const image = await baseImageOf(map);
  const settings = getSettings();
  const model = settings.visionModel ?? settings.synthesisModel ?? null;
  if (!model) throw new Error('No hay un modelo de visión configurado.');

  const response = await completeText(
    {
      system: [
        'You are looking at a map. List the labelled or obviously distinct places on it.',
        'Answer with JSON only: {"places":[{"name":"…","kind":"city|town|forest|mountain|river|lake|sea|region|other","x":0.0,"y":0.0}]}',
        'x and y are fractions of the image width and height, 0..1, with 0,0 at the TOP-LEFT.',
        'At most 30 places. If you cannot read a name, omit that place rather than inventing one.',
      ].join('\n'),
      user: 'List the places on this map.',
      images: [{ mediaType: image.mimeType, base64: image.bytes.toString('base64') }],
      temperature: 0.1,
      maxTokens: 1600,
      timeoutMs: VISION_TIMEOUT_MS,
    },
    model,
  );

  return parseSuggestions(response);
}

/**
 * Parse what the model returned. Everything here is untrusted: a name that is not a
 * string, a coordinate outside the image or a hallucinated array are all normal answers
 * from a vision model, and none of them may reach the map.
 */
export function parseSuggestions(raw: string): SuggestedMarker[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { places?: unknown })?.places;
  if (!Array.isArray(list)) return [];
  const suggestions: SuggestedMarker[] = [];
  for (const entry of list.slice(0, 30)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    const x = Number(row.x);
    const y = Number(row.y);
    if (!name) continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || x > 1 || y < 0 || y > 1) continue;
    suggestions.push({ name, kind: typeof row.kind === 'string' ? row.kind.slice(0, 30) : null, x, y });
  }
  return suggestions;
}
