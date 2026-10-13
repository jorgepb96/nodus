import { diffWordsWithSpace } from 'diff';
import type { ImageModelInfo, ImageProvider } from './types';

export interface EditorImageModel { provider: ImageProvider; model: string }
export interface EditorImageRequest { requestId: string; prompt: string; model: EditorImageModel }
export interface EditorImageResult extends EditorImageModel { dataUrl: string; mimeType: string; width: number; height: number }
export interface ReviewPiece { value: string; kind: 'same' | 'removed' | 'added' }

/** Partial output is a provisional replacement, never a final deletion diff. */
export function editorReviewDiff(original: string, proposed: string, complete: boolean): ReviewPiece[] {
  if (!complete) return [{ value: original, kind: 'removed' }, { value: proposed, kind: 'added' }];
  const pieces = diffWordsWithSpace(original, proposed, { timeout: 80 });
  return pieces?.map(piece => ({ value: piece.value, kind: piece.added ? 'added' : piece.removed ? 'removed' : 'same' }))
    ?? [{ value: original, kind: 'removed' }, { value: proposed, kind: 'added' }];
}

export function normalizeImageFavorites(value: unknown): EditorImageModel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter(entry => {
    if (!entry || !['google', 'openai', 'openrouter', 'nodus', 'codex'].includes(entry.provider) || typeof entry.model !== 'string' || !entry.model.trim()) return false;
    const key = `${entry.provider}:${entry.model.trim()}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(entry => ({ provider: entry.provider, model: entry.model.trim() }));
}

export function savedEditorImageModels(catalog: ImageModelInfo[], favorites: EditorImageModel[], configuredImageModel: EditorImageModel): ImageModelInfo[] {
  return catalog.filter(entry => [configuredImageModel, ...favorites].some(saved => saved.provider === entry.provider && saved.model === entry.id));
}
