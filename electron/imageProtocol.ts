import { getChatImage } from './chatAssets';
import { protocol } from 'electron';
import { getPersonPortrait, getPersonPortraitThumbnail } from './db/entitiesRepo';
import { getMapImageBlob, getMapThumbnail } from './db/worldMapsRepo';
import { getWorldImageBlob, getWorldImageThumbnail } from './db/worldImagesRepo';
import { getCharacterChatImageBlob, getCharacterChatImageThumbnail } from './db/characterChatRepo';

export const NODUS_IMAGE_SCHEME = 'nodus-image';

/**
 * Chromium can only treat a custom scheme like a normal image origin when its
 * privileges are declared before Electron becomes ready.
 */
export function registerImageSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: NODUS_IMAGE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

type ImagePayload = { blob: Buffer; mime: string } | null;
const ORIGINAL_IMAGE_ROUTES = new Set(['portrait', 'world', 'map', 'character-chat', 'chat']);

function safeImageMime(mime: string): string {
  return /^image\/[a-z0-9.+-]+$/i.test(mime) ? mime : 'application/octet-stream';
}

function imageIdFromRequest(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    return id && id.length <= 512 ? id : null;
  } catch {
    return null;
  }
}

function payloadFor(host: string, id: string): ImagePayload {
  if (host === 'chat') return getChatImage(id);
  if (host === 'portrait') return getPersonPortrait(id);
  if (host === 'portrait-thumbnail') return getPersonPortraitThumbnail(id);
  if (host === 'world') return getWorldImageBlob(id);
  if (host === 'world-thumbnail') return getWorldImageThumbnail(id);
  if (host === 'character-chat') return getCharacterChatImageBlob(id);
  if (host === 'character-chat-thumbnail') return getCharacterChatImageThumbnail(id);
  if (host === 'map') {
    const payload = getMapImageBlob(id);
    return payload ? { blob: payload.blob, mime: payload.mimeType } : null;
  }
  if (host === 'map-thumbnail') {
    const payload = getMapThumbnail(id);
    return payload ? { blob: payload.blob, mime: payload.mimeType } : null;
  }
  return null;
}

/**
 * Resolve only full-resolution internal image URLs.
 *
 * Thumbnail routes and external schemes are deliberately rejected: downloads must
 * always use the untouched source and this must never become a general file reader.
 */
export function originalImagePayloadFromUrl(source: string): ImagePayload {
  try {
    const url = new URL(source);
    if (url.protocol !== `${NODUS_IMAGE_SCHEME}:` || !ORIGINAL_IMAGE_ROUTES.has(url.hostname)) return null;
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!id || id.length > 512) return null;
    return payloadFor(url.hostname, id);
  } catch {
    return null;
  }
}

/** Scoped native clients also render registered thumbnails, without changing
 * the full-resolution contract used by exports and downloads. */
export function internalImagePayloadFromUrl(source: string): ImagePayload {
  try {
    const url = new URL(source);
    if (url.protocol !== `${NODUS_IMAGE_SCHEME}:` || ![...ORIGINAL_IMAGE_ROUTES,'portrait-thumbnail','world-thumbnail','map-thumbnail','character-chat-thumbnail'].includes(url.hostname)) return null;
    const id = decodeURIComponent(url.pathname.replace(/^\/+/,''));
    return id && id.length <= 512 ? payloadFor(url.hostname,id) : null;
  } catch { return null; }
}

/**
 * Serve database-backed images through Chromium's native image pipeline.
 *
 * The previous path copied every BLOB through ipcRenderer, rebuilt it as a Blob,
 * created an object URL and then committed a second React render. A protocol URL
 * starts loading with the first render, avoids the renderer-side copy and lets
 * Chromium reuse decoded/cached resources while the versioned URL is unchanged.
 */
export function registerImageProtocol(): void {
  protocol.handle(NODUS_IMAGE_SCHEME, (request) => {
    try {
      const url = new URL(request.url);
      const id = imageIdFromRequest(request);
      if (!id) return new Response(null, { status: 400 });
      const payload = payloadFor(url.hostname, id);
      if (!payload) return new Response(null, { status: 404 });
      return new Response(Uint8Array.from(payload.blob), {
        status: 200,
        headers: {
          'Content-Type': safeImageMime(payload.mime),
          'Content-Length': String(payload.blob.byteLength),
          'Cache-Control': url.hostname === 'chat' ? 'no-store' : 'private, max-age=31536000, immutable',
        },
      });
    } catch {
      // A request racing a vault switch may briefly see the old DB close. An image
      // failing cleanly is preferable to turning that harmless race into a rejection.
      return new Response(null, { status: 503 });
    }
  });
}
