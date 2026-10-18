import { analyzeImageBytes } from './imageAnalysis';
import { embed } from './aiClient';
import { listModels } from './providers';
import { getSettings } from '../db/settingsRepo';
import { getApiKey } from '../secrets/secretStore';
import { currentEmbeddingConfig, embeddingTextHash } from '../db/ideasRepo';
import {
  getStudyMaterial,
  getStudyMaterialContent,
  markStudyMaterialIndexing,
  restoreStudyMaterialIndexedStatus,
  setStudyMaterialEmbedding,
  setStudyMaterialIndexFailure,
  updateStudyMaterialVisualAnalysis,
} from '../db/studyMaterialsRepo';
import { isVisionMime } from '@shared/imageAnalysis';
import type { ModelRef, StudyMaterialDetail, StudyMaterialIndexResult } from '@shared/types';
import { queueStudySearchIndexRefresh } from './studySearch';
import { queueStudyKnowledgeSources } from './studyKnowledge';

type IndexListener = (materialId: string) => void;

const listeners = new Set<IndexListener>();
const queued = new Set<string>();
const inFlight = new Map<string, Promise<StudyMaterialIndexResult>>();
let draining = false;
const visionCapabilityCache = new Map<string, { value: boolean; expiresAt: number }>();

function emit(materialId: string): void {
  for (const listener of listeners) listener(materialId);
}

export function onStudyMaterialIndexChanged(listener: IndexListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable, inspectable text contract for material embeddings. Visual descriptions are
 * deliberately placed before extracted text so image semantics survive the 8k clip. */
export function studyMaterialEmbeddingText(material: StudyMaterialDetail): string {
  return [
    `título: ${material.title}`,
    material.description ? `descripción: ${material.description}` : '',
    material.visualDescription ? `descripción visual: ${material.visualDescription}` : '',
    material.metadata.tags?.length ? `etiquetas: ${material.metadata.tags.join(', ')}` : '',
    material.bibliography.citation ? `referencia: ${material.bibliography.citation}` : '',
    material.extractedText ? `contenido:\n${material.extractedText}` : '',
  ].filter(Boolean).join('\n');
}

function knownVisionFallback(model: ModelRef): boolean {
  const id = model.model.toLocaleLowerCase();
  if (/embed|whisper|tts|audio|moderation/.test(id)) return false;
  if (model.provider === 'anthropic') return /claude-(?:3|4)/.test(id);
  if (model.provider === 'gemini') return true;
  if (model.provider === 'openai') return /gpt-(?:4|5)|o[134]/.test(id);
  if (model.provider === 'ollama' || model.provider === 'lmstudio') return /vision|vlm|llava|bakllava|qwen[^/]*vl|gemma[^/]*3/.test(id);
  return false;
}

/** Prefer live provider metadata when it declares modalities; fall back to conservative
 * known families when providers do not publish a vision flag in their model endpoint. */
async function supportsVision(model: ModelRef): Promise<boolean> {
  const key = `${model.provider}:${model.model}`;
  const cached = visionCapabilityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let value = knownVisionFallback(model);
  try {
    const info = (await listModels(model.provider, getApiKey(model.provider))).find((candidate) => candidate.id === model.model);
    if (typeof info?.vision === 'boolean') value = info.vision;
  } catch {
    // Capability discovery must never block normal material extraction/indexing.
  }
  visionCapabilityCache.set(key, { value, expiresAt: Date.now() + 5 * 60_000 });
  return value;
}

async function performIndex(materialId: string, force: boolean): Promise<StudyMaterialIndexResult> {
  let visualDescriptionGenerated = false;
  let visualAnalysisChanged = false;
  try {
    let material = getStudyMaterial(materialId);
    const priorIndex = {
      status: material.indexStatus,
      provider: material.embeddingProvider,
      model: material.embeddingModel,
      textHash: material.embeddingTextHash,
    };
    markStudyMaterialIndexing(materialId);
    emit(materialId);
    if (material.previewKind === 'image' && (force || material.visualAnalysisStatus !== 'ready' || !material.visualDescription)) {
      visualAnalysisChanged = true;
      const settings = getSettings();
      const model = settings.visionModel;
      const content = getStudyMaterialContent(materialId);
      if (!model) {
        updateStudyMaterialVisualAnalysis(materialId, { description: material.visualDescription, status: 'unsupported' });
      } else if (!isVisionMime(content.mimeType) || !(await supportsVision(model))) {
        updateStudyMaterialVisualAnalysis(materialId, { description: material.visualDescription, status: 'unsupported', provider: model.provider, model: model.model });
      } else {
        try {
          const analysis = await analyzeImageBytes(Buffer.from(content.bytes), content.mimeType, model);
          if (analysis?.description) {
            updateStudyMaterialVisualAnalysis(materialId, {
              description: analysis.description,
              extractedText: analysis.text || material.extractedText,
              status: 'ready',
              provider: model.provider,
              model: model.model,
            });
            visualDescriptionGenerated = true;
          } else {
            updateStudyMaterialVisualAnalysis(materialId, { description: material.visualDescription, status: 'error', provider: model.provider, model: model.model });
          }
        } catch {
          // A vision-provider failure must not prevent indexing any locally extracted
          // OCR/title/metadata that is still available for the image.
          updateStudyMaterialVisualAnalysis(materialId, { description: material.visualDescription, status: 'error', provider: model.provider, model: model.model });
        }
      }
      material = getStudyMaterial(materialId);
    }

    const text = studyMaterialEmbeddingText(material).trim();
    if (!text) {
      const error = 'El material no contiene texto indexable.';
      setStudyMaterialIndexFailure(materialId, 'unavailable', error); emit(materialId);
      return { materialId, status: 'unavailable', indexed: false, visualDescriptionGenerated, error };
    }
    const config = currentEmbeddingConfig();
    const textHash = embeddingTextHash(text);
    if (!force && !visualAnalysisChanged && priorIndex.status === 'indexed' && priorIndex.provider === config.provider && priorIndex.model === config.model && priorIndex.textHash === textHash) {
      restoreStudyMaterialIndexedStatus(materialId);
      emit(materialId);
      return { materialId, status: 'indexed', indexed: true, visualDescriptionGenerated, error: null };
    }
    const vector = await embed(text, undefined, { role: 'document', title: material.title });
    if (!vector) {
      const error = 'No hay un modelo de embeddings disponible o la indexación no pudo completarse.';
      setStudyMaterialIndexFailure(materialId, 'unavailable', error); emit(materialId);
      return { materialId, status: 'unavailable', indexed: false, visualDescriptionGenerated, error };
    }
    setStudyMaterialEmbedding(materialId, vector, { provider: config.provider, model: config.model, textHash });
    queueStudySearchIndexRefresh();
    queueStudyKnowledgeSources('material', [materialId]);
    emit(materialId);
    return { materialId, status: 'indexed', indexed: true, visualDescriptionGenerated, error: null };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    setStudyMaterialIndexFailure(materialId, 'error', error); emit(materialId);
    return { materialId, status: 'error', indexed: false, visualDescriptionGenerated, error };
  }
}

function runIndex(materialId: string, force: boolean): Promise<StudyMaterialIndexResult> {
  const current = inFlight.get(materialId);
  if (current) return force ? current.then(() => runIndex(materialId, true)) : current;
  const task = performIndex(materialId, force).finally(() => inFlight.delete(materialId));
  inFlight.set(materialId, task);
  return task;
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queued.size) {
      const materialId = queued.values().next().value as string;
      queued.delete(materialId);
      await runIndex(materialId, false);
    }
  } finally {
    draining = false;
    if (queued.size) void drainQueue();
  }
}

/** Non-blocking, de-duplicated background queue used after imports and metadata edits. */
export function queueStudyMaterialIndex(materialIds: string[]): void {
  for (const materialId of materialIds) if (materialId) queued.add(materialId);
  void drainQueue();
}

/** Explicit per-material refresh. It waits for an automatic pass already in flight and
 * then forces fresh visual analysis plus a new embedding. */
export async function reindexStudyMaterial(materialId: string): Promise<StudyMaterialIndexResult> {
  queued.delete(materialId);
  return runIndex(materialId, true);
}
