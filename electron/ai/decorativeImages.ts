import {decorativeImageContextCall,cleanDecorativeImageContext} from '@shared/decorativeImageContext';
import type { ChatImageAspectRatio } from '@shared/chatSkills';
import { GoogleGenAI } from '@google/genai';
import type {
  CharacterImage,
  CharacterImageKind,
  WorldImageEntityKind,
  DecorativeImage,
  DecorativeImageActionRequest,
  DecorativeImageEntityKind,
  DecorativeImageOption,
  DecorativeImageStyle,
  ImageProvider,
  ModelRef,
} from '@shared/types';
import { buildDecorativeImagePrompt, DEFAULT_DECORATIVE_IMAGE_STYLE } from '@shared/imageStyles';
import { IMAGE_PROVIDERS } from '@shared/providers';
import { buildCharacterPortraitPrompt, buildWorldEntityImagePrompt, hasCharacterImageMaterial } from '@shared/characterImagePrompt';
import { vaultTypeImagePrompt } from '@shared/vaultTypes';
import { addCharacterImage, getCharacter } from '../db/charactersRepo';
import { addWorldImage } from '../db/worldImagesRepo';
import { getWorldPlace } from '../db/worldPlacesRepo';
import { getWorldGroup } from '../db/worldGroupsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { completeText, completeTextStream } from './aiClient';
import { generateImageWithChatGptSubscription } from './codexSubscription';
import { getSettings } from '../db/settingsRepo';
import { generateNodusLocalImage } from './nodusLocalImages';
import { getApiKey } from '../secrets/secretStore';
import { setPersonPortrait } from '../db/entitiesRepo';
import { prepareImageStorage, type StoredImageAssets } from '../imageStorage';
import {
  getDecorativeImage,
  markDecorativeImageNotRequested,
  markDecorativeImagePending,
  removeDecorativeImage,
  restorePreviousDecorativeImage,
  saveCustomDecorativeImageReady,
  saveDecorativeImageFailure,
  saveDecorativeImagePrompt,
  saveDecorativeImageReady,
} from '../db/decorativeImagesRepo';
import { getDb } from '../db/database';

const IMAGE_TIMEOUT_MS = 120_000;
const IMAGE_CONTEXT_TIMEOUT_MS = 45_000;
const active = new Map<string, symbol>();

interface ImageSource {
  title: string;
  content: string;
  textModel: ModelRef | null;
}

export interface GeneratedImageBytes {
  bytes: Buffer;
  mimeType: string;
}

function taskKey(kind: DecorativeImageEntityKind, id: string): string {
  return `${getActiveVault().id}:${kind}:${id}`;
}

function parseModel(value: string | null): ModelRef | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ModelRef>;
    return parsed.provider && parsed.model ? (parsed as ModelRef) : null;
  } catch {
    return null;
  }
}

function imageSource(kind: DecorativeImageEntityKind, id: string): ImageSource {
  if (kind === 'immersion') {
    const row = getDb()
      .prepare('SELECT title, topic, plan_json, model_json FROM immersion_sessions WHERE id = ?')
      .get(id) as { title: string; topic: string; plan_json: string; model_json: string | null } | undefined;
    if (!row) throw new Error('La inmersión ya no existe.');
    let plan: { overview?: string; keyTerms?: Array<{ term?: string }> } = {};
    try {
      plan = JSON.parse(row.plan_json) as typeof plan;
    } catch {
      /* the title/topic still provide a safe fallback */
    }
    return {
      title: row.title || row.topic,
      content: [row.topic, plan.overview, plan.keyTerms?.map((term) => term.term).filter(Boolean).join(', ')]
        .filter(Boolean)
        .join('\n')
        .slice(0, 2200),
      textModel: parseModel(row.model_json),
    };
  }
  const row = getDb()
    .prepare('SELECT title, draft_json, model_json FROM writing_saved_drafts WHERE id = ?')
    .get(id) as { title: string; draft_json: string; model_json: string | null } | undefined;
  if (!row) throw new Error('El informe guardado ya no existe.');
  let draft: { abstract?: string; draftMarkdown?: string; brief?: { objective?: string } } = {};
  try {
    draft = JSON.parse(row.draft_json) as typeof draft;
  } catch {
    /* the title still provides a safe fallback */
  }
  return {
    title: row.title,
    content: [draft.brief?.objective, draft.abstract, draft.draftMarkdown]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2400),
    textModel: parseModel(row.model_json),
  };
}

function visualContextCall(source: ImageSource) {
  return {...decorativeImageContextCall(source,getSettings().promptLanguage ?? 'es'),timeoutMs:IMAGE_CONTEXT_TIMEOUT_MS};
}

/** The text model behind a scene description: the one that wrote the content, if any. */
function visualContextModel(source: ImageSource): ModelRef {
  const model = source.textModel ?? getSettings().synthesisModel ?? null;
  if (!model) throw new Error('No hay un modelo de texto configurado para crear el contexto visual.');
  return model;
}

/** Collapse to a single prompt-sized line; the stored context is never multi-paragraph. */
const cleanVisualContext = cleanDecorativeImageContext;

async function visualContextFor(source: ImageSource): Promise<string> {
  return cleanVisualContext(await completeText(visualContextCall(source), visualContextModel(source)));
}

/**
 * The same scene description the generator would have written on its own, but streamed
 * so the user can read it appear, edit it and decide whether to use it. Nothing is
 * persisted here: the description only becomes the image's context if the user then
 * generates with it (see queueDecorativeImageGeneration).
 */
export async function streamDecorativeImageContext(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  onDelta: (delta: string) => void
): Promise<string> {
  const source = imageSource(entityKind, entityId);
  const response = await completeTextStream(
    visualContextCall(source),
    (delta, kind) => {
      // The reasoning trace is not the answer, and would read as gibberish in a textarea.
      if (kind !== 'reasoning') onDelta(delta);
    },
    visualContextModel(source)
  );
  return cleanVisualContext(response);
}

function providerKey(provider: ImageProvider): string | null {
  // Nodus generates locally and Codex authenticates with the managed ChatGPT session:
  // neither has an API key to look up.
  if (provider === 'nodus' || provider === 'codex') return null;
  if (provider === 'google') return getApiKey('gemini');
  return getApiKey(provider);
}

async function generateGoogle(model: string, prompt: string, key: string, signal?: AbortSignal, aspectRatio: ChatImageAspectRatio = '16:9'): Promise<GeneratedImageBytes> {
  const client = new GoogleGenAI({ apiKey: key });
  const response = await client.interactions.create(
    {
      model,
      input: prompt,
      store: false,
      // JPEG is the ONLY mime the Interactions API accepts here — PNG is rejected with a
      // 400 before the model runs. The declared type is a fallback anyway: the stored mime
      // comes from sniffing the returned bytes.
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: aspectRatio, image_size: '1K' },
    },
    { timeout: IMAGE_TIMEOUT_MS, maxRetries: 0, signal }
  );
  const data = response.output_image?.data;
  if (!data) throw new Error('Google no devolvió datos de imagen.');
  return { bytes: Buffer.from(data, 'base64'), mimeType: response.output_image?.mime_type ?? 'image/jpeg' };
}

async function postBase64Image(url: string, body: Record<string, unknown>, key: string, signal?: AbortSignal): Promise<GeneratedImageBytes> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: Array<{ b64_json?: string; media_type?: string }>;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
    const item = payload.data?.[0];
    const encoded = item?.b64_json;
    if (!encoded) throw new Error('El proveedor no devolvió datos de imagen.');
    return { bytes: Buffer.from(encoded, 'base64'), mimeType: item?.media_type ?? 'image/jpeg' };
  } finally {
    clearTimeout(timer);
  }
}

function generateOpenAI(model: string, prompt: string, key: string, signal?: AbortSignal, aspectRatio: ChatImageAspectRatio = '16:9'): Promise<GeneratedImageBytes> {
  return postBase64Image(
    'https://api.openai.com/v1/images/generations',
    {
      model,
      prompt,
      n: 1,
      size: aspectRatio === '1:1' ? '1024x1024' : ['9:16', '3:4', '2:3'].includes(aspectRatio) ? '1024x1536' : '1536x1024',
      quality: 'high',
      output_format: 'png',
    },
    key, signal
  );
}

function generateOpenRouter(model: string, prompt: string, key: string, signal?: AbortSignal, aspectRatio: ChatImageAspectRatio = '16:9'): Promise<GeneratedImageBytes> {
  // Model endpoints expose different optional knobs. Keeping the request to the
  // documented common denominator (plus an explicit single output) prevents a
  // provider-specific parameter from making an otherwise compatible model fail.
  return postBase64Image('https://openrouter.ai/api/v1/images', { model, prompt, n: 1, aspect_ratio: aspectRatio }, key, signal);
}

export async function callImageProvider(provider: ImageProvider, model: string, prompt: string, signal?: AbortSignal, aspectRatio?: ChatImageAspectRatio): Promise<GeneratedImageBytes> {
  signal?.throwIfAborted();
  if (aspectRatio) prompt = `${prompt}\nOutput aspect ratio: ${aspectRatio}.`;
  if (provider === 'nodus') return generateNodusLocalImage(model, prompt, getSettings().imageQuality, aspectRatio);
  // Billed to the user's ChatGPT plan, and the only provider whose size and format are
  // the agent's decision rather than a request parameter.
  if (provider === 'codex') return generateImageWithChatGptSubscription({ model, prompt, signal });
  const key = providerKey(provider);
  // One fixed sentence per provider instead of one interpolated sentence: a stored
  // failure reason has to survive into every interface language, and an interpolated
  // string has no translation key.
  if (!key) {
    throw new Error(
      provider === 'google' ? 'Falta la clave de Google.'
        : provider === 'openai' ? 'Falta la clave de OpenAI.'
          : 'Falta la clave de OpenRouter.'
    );
  }
  switch (provider) {
    case 'google':
      return generateGoogle(model, prompt, key, signal, aspectRatio);
    case 'openai':
      return generateOpenAI(model, prompt, key, signal, aspectRatio);
    case 'openrouter':
      return generateOpenRouter(model, prompt, key, signal, aspectRatio);
  }
}

export function prepareGeneratedImage(generated: GeneratedImageBytes): StoredImageAssets {
  return prepareImageStorage(generated.bytes, generated.mimeType);
}

async function runGeneration(
  request: DecorativeImageActionRequest,
  token: symbol,
  onChanged?: (image: DecorativeImage) => void
): Promise<void> {
  const key = taskKey(request.entityKind, request.entityId);
  try {
    if (active.get(key) !== token) return;
    const pending = getDecorativeImage(request.entityKind, request.entityId);
    if (!pending?.provider || !pending.model) throw new Error('No hay proveedor o modelo de imagen seleccionado.');
    let prompt = pending.prompt;
    if (!prompt) {
      const context = pending.visualContext || await visualContextFor(imageSource(request.entityKind, request.entityId));
      if (active.get(key) !== token) return;
      prompt = buildDecorativeImagePrompt(pending.style, context, vaultTypeImagePrompt(getActiveVault().type));
      saveDecorativeImagePrompt(request.entityKind, request.entityId, context, prompt);
    }
    if (active.get(key) !== token) return;
    const generated = await callImageProvider(pending.provider, pending.model, prompt);
    const stored = prepareGeneratedImage(generated);
    // A delete or a newer attempt invalidates this task. The provider call may
    // already have completed, but stale work must never restore or overwrite an
    // image the user removed/regenerated in the meantime.
    if (active.get(key) !== token) return;
    onChanged?.(
      saveDecorativeImageReady(
        request.entityKind,
        request.entityId,
        stored.image,
        stored.mimeType,
        stored.thumbnail,
        stored.thumbnailMimeType
      )
    );
  } catch (error) {
    if (active.get(key) !== token) return;
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'La generación superó el tiempo máximo. Puedes reintentarlo manualmente.'
      : error instanceof Error
        ? error.message
        : String(error);
    onChanged?.(saveDecorativeImageFailure(request.entityKind, request.entityId, message));
  } finally {
    if (active.get(key) === token) active.delete(key);
  }
}

/** Awaited mobile report lane: keeps the canonical models, prompt and image storage,
 * but ties progress and cancellation to a durable Bridge job instead of a detached task. */
export async function generateReportImageAndWait(
  entityId: string, style: DecorativeImageStyle, visualContext: string | undefined,
  onProgress: (phase: string) => void, signal?: AbortSignal
): Promise<DecorativeImage> {
  const entityKind = 'deep_research', key = taskKey(entityKind, entityId);
  if (active.has(key)) throw new Error('report_image_generation_busy');
  const source = imageSource(entityKind, entityId); // Require the real saved report before any mutation.
  const settings = getSettings();
  if (!settings.imageProvider || !settings.imageModel) throw new Error('mac_image_model_missing');
  signal?.throwIfAborted();
  const token = Symbol(key), previous = getDecorativeImage(entityKind, entityId);
  active.set(key, token);
  try {
    markDecorativeImagePending({ entityKind, entityId, provider: settings.imageProvider,
      model: settings.imageModel, style, preserveContext: false, preservePrompt: false });
    onProgress('context');
    const context = visualContext?.replace(/\s+/g, ' ').trim().slice(0, 260) || await visualContextFor(source);
    signal?.throwIfAborted();
    if (active.get(key) !== token) throw new Error('report_image_generation_superseded');
    const prompt = buildDecorativeImagePrompt(style, context, vaultTypeImagePrompt(getActiveVault().type));
    saveDecorativeImagePrompt(entityKind, entityId, context, prompt);
    onProgress('generating');
    const generated = await callImageProvider(settings.imageProvider, settings.imageModel, prompt, signal);
    signal?.throwIfAborted();
    if (active.get(key) !== token) throw new Error('report_image_generation_superseded');
    const stored = prepareGeneratedImage(generated);
    onProgress('saving');
    return saveDecorativeImageReady(entityKind, entityId, stored.image, stored.mimeType, stored.thumbnail, stored.thumbnailMimeType);
  } catch (error) {
    if (active.get(key) === token) {
      saveDecorativeImageFailure(entityKind, entityId, error instanceof Error ? error.message : String(error));
      // The durable job retains the failure; the existing report illustration survives.
      if (previous?.status === 'ready') restorePreviousDecorativeImage(entityKind, entityId);
    }
    throw error;
  } finally { if (active.get(key) === token) active.delete(key); }
}

/** Persist pending immediately, then run entirely outside the owner workflow. */
export function queueDecorativeImageGeneration(
  request: DecorativeImageActionRequest,
  onChanged?: (image: DecorativeImage) => void
): DecorativeImage {
  const key = taskKey(request.entityKind, request.entityId);
  const current = getDecorativeImage(request.entityKind, request.entityId);
  if (active.has(key) && current) return current;
  if (request.action === 'generate' && current?.status === 'ready') return current;
  if (request.action === 'retry' && current?.status !== 'failed') return current ?? markNotRequested(request.entityKind, request.entityId);

  const settings = getSettings();
  // The engine is what the user picked for this image in the design modal, or the
  // default from Ajustes. A retry used to repeat the FAILED provider and model, which
  // made the one reaction a failure invites — switch to another image provider — look
  // like it did nothing: the report stayed pinned to the engine that had just refused
  // it, and every retry reproduced the same error. What a retry repeats is the request
  // (its prompt and its style), never the engine.
  const chosen = request.provider && request.model && IMAGE_PROVIDERS.includes(request.provider)
    ? { provider: request.provider, model: request.model }
    : null;
  const provider = chosen?.provider ?? settings.imageProvider;
  const model = chosen?.model ?? settings.imageModel;
  // A retry repeats the exact failed request. Changing style is a regeneration,
  // which the UI confirms as a new cost.
  const style = request.action === 'retry' && current?.style
    ? current.style
    : request.style ?? current?.style ?? settings.imageStyle ?? DEFAULT_DECORATIVE_IMAGE_STYLE;
  // A user-edited scene description overrides the stored context; the prompt is
  // rebuilt for the chosen style so the "no text" guardrails always survive.
  const editedContext = request.action !== 'retry' ? request.visualContext?.replace(/\s+/g, ' ').trim() : undefined;
  const pending = markDecorativeImagePending({
    entityKind: request.entityKind,
    entityId: request.entityId,
    provider,
    model,
    style,
    preserveContext: !editedContext && (request.action === 'retry' || request.action === 'regenerate'),
    preservePrompt: request.action === 'retry',
  });
  if (editedContext) {
    const context = editedContext.slice(0, 260);
    saveDecorativeImagePrompt(request.entityKind, request.entityId, context, buildDecorativeImagePrompt(style, context));
  }
  const token = Symbol(key);
  active.set(key, token);
  setTimeout(() => void runGeneration(request, token, onChanged), 0);
  return editedContext ? getDecorativeImage(request.entityKind, request.entityId) ?? pending : pending;
}

export function markNotRequested(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  style: DecorativeImageStyle = getSettings().imageStyle
): DecorativeImage {
  return markDecorativeImageNotRequested(entityKind, entityId, style);
}

export function applyDecorativeImageOption(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  option: DecorativeImageOption | undefined,
  onChanged?: (image: DecorativeImage) => void
): DecorativeImage {
  if (!option?.enabled) return markNotRequested(entityKind, entityId, option?.style);
  return queueDecorativeImageGeneration(
    { entityKind, entityId, action: 'generate', style: option.style },
    onChanged
  );
}

export function deleteDecorativeImage(entityKind: DecorativeImageEntityKind, entityId: string): DecorativeImage {
  invalidateDecorativeImageGeneration(entityKind, entityId);
  return removeDecorativeImage(entityKind, entityId);
}

/** Persist a user-supplied image byte-for-byte and derive a separate thumbnail. */
export async function saveCustomDecorativeImage(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  bytes: Buffer,
  mimeType?: string,
  style?: DecorativeImageStyle
): Promise<DecorativeImage> {
  // Any in-flight generation must not overwrite the image the user just chose.
  invalidateDecorativeImageGeneration(entityKind, entityId);
  if (!bytes.length) throw new Error('El archivo de imagen está vacío.');
  const stored = prepareImageStorage(bytes, mimeType);
  return saveCustomDecorativeImageReady(
    entityKind,
    entityId,
    stored.image,
    stored.mimeType,
    stored.thumbnail,
    stored.thumbnailMimeType,
    style ?? getDecorativeImage(entityKind, entityId)?.style ?? getSettings().imageStyle
  );
}

/** Restore the image that preceded the last regeneration or upload. */
export function revertDecorativeImage(entityKind: DecorativeImageEntityKind, entityId: string): DecorativeImage {
  // Discard any pending generation so it cannot clobber the restored image.
  invalidateDecorativeImageGeneration(entityKind, entityId);
  return restorePreviousDecorativeImage(entityKind, entityId);
}

export function invalidateDecorativeImageGeneration(
  entityKind: DecorativeImageEntityKind,
  entityId: string
): void {
  active.delete(taskKey(entityKind, entityId));
}

/**
 * Genealogy only: generate an ILLUSTRATIVE reference portrait for a person from a
 * text description of their features, when no real photograph survives. Explicitly
 * non-photorealistic in the prompt — a generated face must never be mistaken for a
 * real likeness or documentary evidence. Exceptional and not the recommended path
 * (real photographs stay the default); reuses the same multi-provider image
 * pipeline as decorative images, synchronously (no pending/queue state), since a
 * portrait is a single small on-demand action a user explicitly triggers.
 */
export async function generatePersonPortraitFromDescription(personId: string, description: string): Promise<void> {
  const trimmed = description.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new Error('Describe los rasgos de la persona antes de generar el retrato.');
  const settings = getSettings();
  if (!settings.imageProvider || !settings.imageModel) {
    throw new Error('Configura un proveedor y modelo de imagen en Ajustes → Proveedores.');
  }
  const prompt = buildReferencePortraitPrompt(trimmed);
  const generated = await callImageProvider(settings.imageProvider, settings.imageModel, prompt);
  setPersonPortrait(personId, generated.bytes, generated.mimeType, { focusX: 0.5, focusY: 0.42, scale: 1 }, true);
}

function buildReferencePortraitPrompt(description: string): string {
  return [
    `An illustrative, hand-drawn reference portrait suggesting a person with these features: ${description}.`,
    'Painterly or engraved-illustration style, clearly NOT a photograph — it must read as an artistic impression, never as a documentary likeness of a real person.',
    'Head-and-shoulders composition, calm neutral expression, plain muted backdrop, restrained sepia and warm heritage tones.',
    'A single person only. No text, no words, no letters, no caption, no signature, no border and no decorative frame.',
  ].join(' ');
}

/**
 * Generate a worldbuilding character's portrait from their sheet.
 *
 * Separate from `generatePersonPortraitFromDescription` on purpose: that one is a
 * reluctant last resort for genealogy and hardcodes a "clearly not a photograph,
 * sepia heritage tones" instruction, which is exactly wrong for a made-up world. Here
 * the author picks the style, and the character's visual seed leads the prompt so
 * successive generations keep the same face.
 */
export async function generateCharacterPortrait(
  personId: string,
  style: DecorativeImageStyle = DEFAULT_DECORATIVE_IMAGE_STYLE,
  extra?: string | null
): Promise<void> {
  const character = getCharacter(personId);
  if (!character) throw new Error('Personaje no encontrado.');
  const sources = {
    visualSeed: character.profile.visualSeed,
    appearance: character.profile.appearance,
    extra: extra ?? null,
  };
  if (!hasCharacterImageMaterial(sources)) {
    throw new Error('Escribe la apariencia del personaje (o una semilla visual) antes de generar el retrato.');
  }
  const settings = getSettings();
  if (!settings.imageProvider || !settings.imageModel) {
    throw new Error('Configura un proveedor y modelo de imagen en Ajustes → Proveedores.');
  }
  const prompt = buildCharacterPortraitPrompt(style, sources);
  const generated = await callImageProvider(settings.imageProvider, settings.imageModel, prompt);
  // focusY sits above centre because a portrait crop should hold the face, not the chest.
  setPersonPortrait(personId, generated.bytes, generated.mimeType, { focusX: 0.5, focusY: 0.42, scale: 1 }, true);
}

/**
 * Generate one image INTO a character's gallery, keeping the prompt, provider, model and
 * style beside the bytes so the author can iterate on a result instead of re-guessing
 * what produced it. The avatar is untouched: promoting an image is a separate, explicit
 * action.
 */
export async function generateCharacterGalleryImage(
  personId: string,
  kind: CharacterImageKind,
  style: DecorativeImageStyle = DEFAULT_DECORATIVE_IMAGE_STYLE,
  extra?: string | null
): Promise<CharacterImage> {
  const character = getCharacter(personId);
  if (!character) throw new Error('Personaje no encontrado.');
  const sources = {
    visualSeed: character.profile.visualSeed,
    appearance: character.profile.appearance,
    extra: extra ?? null,
  };
  if (!hasCharacterImageMaterial(sources)) {
    throw new Error('Escribe la apariencia del personaje (o una semilla visual) antes de generar imágenes.');
  }
  const settings = getSettings();
  if (!settings.imageProvider || !settings.imageModel) {
    throw new Error('Configura un proveedor y modelo de imagen en Ajustes → Proveedores.');
  }
  const prompt = buildCharacterPortraitPrompt(style, sources, kind);
  const generated = await callImageProvider(settings.imageProvider, settings.imageModel, prompt);
  return addCharacterImage({
    personId,
    blob: generated.bytes,
    mimeType: generated.mimeType,
    kind,
    prompt,
    provider: settings.imageProvider,
    model: settings.imageModel,
    style,
    generated: true,
  });
}

/**
 * Generate an image into ANY world entity's gallery.
 *
 * The appearance and the visual seed are read from whichever overlay the entity has —
 * characters and places carry the same two fields for the same reason, so one function
 * serves both instead of one per section.
 */
export async function generateWorldEntityImage(
  entityKind: WorldImageEntityKind,
  entityId: string,
  kind: CharacterImageKind,
  style: DecorativeImageStyle = DEFAULT_DECORATIVE_IMAGE_STYLE
): Promise<CharacterImage> {
  if (entityKind === 'character') return generateCharacterGalleryImage(entityId, kind, style);
  const place = entityKind === 'place' ? getWorldPlace(entityId) : null;
  const group = entityKind === 'group' ? getWorldGroup(entityId) : null;
  const sources = {
    visualSeed: place?.profile.visualSeed ?? group?.visualSeed ?? null,
    appearance: place?.profile.appearance ?? group?.description ?? null,
    extra: null,
  };
  if (!hasCharacterImageMaterial(sources)) {
    throw new Error('Escribe la apariencia (o una semilla visual) antes de generar imágenes.');
  }
  const settings = getSettings();
  if (!settings.imageProvider || !settings.imageModel) {
    throw new Error('Configura un proveedor y modelo de imagen en Ajustes → Proveedores.');
  }
  const prompt = buildWorldEntityImagePrompt(style, sources, entityKind, kind);
  const generated = await callImageProvider(settings.imageProvider, settings.imageModel, prompt);
  return addWorldImage({
    entityKind,
    entityId,
    blob: generated.bytes,
    mimeType: generated.mimeType,
    kind,
    prompt,
    provider: settings.imageProvider,
    model: settings.imageModel,
    style,
    generated: true,
  });
}

/** End process-local tasks before a vault switch/reset or app shutdown. */
export function interruptDecorativeImageGenerations(
  reason = 'La generación se interrumpió al cambiar de bóveda o cerrar la aplicación. Puedes reintentarlo manualmente.'
): void {
  for (const key of active.keys()) {
    const separator = key.indexOf(':');
    const entityKind = key.slice(0, separator) as DecorativeImageEntityKind;
    const entityId = key.slice(separator + 1);
    const current = getDecorativeImage(entityKind, entityId);
    if (current?.status === 'pending') saveDecorativeImageFailure(entityKind, entityId, reason);
  }
  active.clear();
}
