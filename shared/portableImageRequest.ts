import {CHAT_IMAGE_ASPECT_RATIOS,skillHasCapability,type ChatImageAspectRatio} from './chatSkills';
import type {AppSettings} from './types';
import type {PortableSkillResourceExecution} from './portableResourceExecution';
export interface PortableImageRequestHost<Generated,Bytes> {
 getSettings():Pick<AppSettings,'imageProvider'|'imageModel'>;
 chatAssetVersion(owner:string):number;
 callImageProvider(provider:NonNullable<AppSettings['imageProvider']>,model:string,prompt:string,signal?:AbortSignal,aspectRatio?:ChatImageAspectRatio):Promise<Generated>;
 prepareGeneratedImage(value:Generated):{image:Bytes;mimeType:string};
 storeChatImage(owner:string,input:{bytes:Bytes;mimeType:string},metadata:Record<string,string>):string|Promise<string>;
}
/** Image Atelier's original validation, fence and asset-version protocol. */
export function portableImageRequest<Generated,Bytes>(host:PortableImageRequestHost<Generated,Bytes>) {
 const {getSettings,chatAssetVersion,callImageProvider,prepareGeneratedImage,storeChatImage}=host;
async function executeImageRequest(content: string, complete: boolean, execution: PortableSkillResourceExecution, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  try {
    if (!execution.skills.some(skill => skillHasCapability(skill, 'nodus:image'))) throw new Error('Enable Image Atelier in Skills to generate images.');
    if (!execution.owner) throw new Error('Start a saved chat in Nodi or the assistant to generate an image.');
    if (!complete) throw new Error('The image brief was interrupted. Retry the response.');
    let value: { title?: unknown; alt?: unknown; prompt?: unknown; aspectRatio?: unknown };
    try { value = JSON.parse(content); } catch { throw new Error('The model returned an invalid image brief. Retry the response.'); }
    if (typeof value.prompt !== 'string' || value.prompt.trim().length < 20 || value.prompt.length > 12000) throw new Error('The model returned an invalid image brief. Retry the response.');
    const settings = getSettings(); if (!settings.imageProvider || !settings.imageModel) throw new Error('Choose an image provider and model in Settings.');
    const title = String(value.title || 'Generated image').replace(/[[\]\n\r]/g, ' ').slice(0, 160);
    const alt = String(value.alt || title).replace(/[[\]\n\r]/g, ' ').slice(0, 500);
    const current = () => execution.isCurrent() && chatAssetVersion(execution.owner!) === execution.version;
    if (!current()) throw new DOMException('The chat was deleted or changed.', 'AbortError');
    const aspectRatio = CHAT_IMAGE_ASPECT_RATIOS.includes(value.aspectRatio as ChatImageAspectRatio) ? value.aspectRatio as ChatImageAspectRatio : undefined;
    execution.beforeInvoke?.();
    execution.beforePaidCall?.();
    const generated = await callImageProvider(settings.imageProvider, settings.imageModel, value.prompt.trim(), signal, aspectRatio);
    signal?.throwIfAborted(); if (!current()) throw new DOMException('The chat was deleted or changed.', 'AbortError');
    const prepared = prepareGeneratedImage(generated);
    const source = await storeChatImage(execution.owner, { bytes: prepared.image, mimeType: prepared.mimeType }, {
      ...(aspectRatio ? { aspectRatio } : {}), title, alt, prompt: value.prompt.trim(), provider: settings.imageProvider, model: settings.imageModel, createdAt: new Date().toISOString(),
    });
    return `\n\n![${alt}](${source})\n\n`;
  } catch (error) {
    if (signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error;
    const message = error instanceof Error ? error.message : 'Image generation failed. Please retry.';
    return `\n\n\`\`\`nodus-image-error\n${JSON.stringify({ message: message.replace(/[\r\n]+/g, ' ').slice(0, 500) })}\n\`\`\`\n\n`;
  }
}

return {executeImageRequest};
}
