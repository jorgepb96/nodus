import type { EditorImageRequest, EditorImageResult } from '@shared/editorAiReview';
import { IMAGE_PROVIDERS } from '@shared/providers';
import { callImageProvider, prepareGeneratedImage } from './decorativeImages';

/** Generate a preview only. The editor owns the explicit insertion decision. */
export async function generateEditorImage(request: EditorImageRequest, signal: AbortSignal, generate = callImageProvider): Promise<EditorImageResult> {
  if (!request || typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 200) throw new Error('Solicitud de imagen inválida.');
  if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 8000) throw new Error('Describe la imagen con un máximo de 8.000 caracteres.');
  if (!request.model || !IMAGE_PROVIDERS.includes(request.model.provider) || typeof request.model.model !== 'string' || !request.model.model.trim() || request.model.model.length > 200) throw new Error('Elige un modelo de imagen disponible.');
  signal.throwIfAborted();
  const generated = await generate(request.model.provider, request.model.model, request.prompt.trim(), signal);
  // Local runtimes may not support aborting the underlying computation.
  signal.throwIfAborted();
  if (generated.bytes.length > 20_000_000) throw new Error('La imagen supera 20 MB.');
  const image = prepareGeneratedImage(generated);
  return { ...request.model, dataUrl: `data:${image.mimeType};base64,${image.image.toString('base64')}`, mimeType: image.mimeType, width: image.width, height: image.height };
}
