import { t } from '../../i18n';

/** Desktop stores media once in the vault's content-addressed asset store. */
export async function uploadEditorFile(file: File): Promise<string> {
  if (file.size > 2_000_000) throw new Error(t('El archivo supera 2 MB.'));
  if (window.nodus?.storePageAsset) {
    const asset = await window.nodus.storePageAsset({ name: file.name, mimeType: file.type || null, bytes: new Uint8Array(await file.arrayBuffer()) });
    return `nodus-blob://${asset.blobHash}`;
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(t('No se pudo cargar el archivo.')));
    reader.readAsDataURL(file);
  });
}

export async function storeEditorImage(dataUrl: string): Promise<string> {
  if (!window.nodus?.storePageAsset) return dataUrl;
  const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return dataUrl;
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const asset = await window.nodus.storePageAsset({ name: 'image', mimeType: match[1], bytes });
  return `nodus-blob://${asset.blobHash}`;
}

/** Object URLs belong to one editor instance and are revoked when it unmounts. */
export function editorAttachmentResolver() {
  const urls = new Map<string, Promise<string>>();
  const allocated = new Set<string>();
  let disposed = false;
  return {
    async resolve(url: string): Promise<string> {
      const match = /^nodus-blob:\/\/([a-f0-9]{64})$/.exec(url);
      if (!match || !window.nodus?.getPageAsset) return url;
      let pending = urls.get(url);
      if (!pending) {
        pending = window.nodus.getPageAsset(match[1]).then(bytes => {
          if (!bytes || disposed) throw new Error('Attachment unavailable');
          // Raster media can be sniffed by the browser; SVG needs an explicit MIME.
          const prefix = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart();
          const type = prefix.startsWith('<') && /<svg[\s>]/i.test(prefix) ? 'image/svg+xml' : '';
          const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
          allocated.add(objectUrl);
          return objectUrl;
        }).catch(error => { urls.delete(url); throw error; });
        urls.set(url, pending);
      }
      return pending;
    },
    activate() { disposed = false; },
    dispose() { disposed = true; for (const url of allocated) URL.revokeObjectURL(url); allocated.clear(); urls.clear(); },
  };
}
