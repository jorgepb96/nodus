import { storePageAsset } from './pagesRepo';

/** Keep binary media out of native JSON, Markdown projections and Yjs sidecars. */
export function externalizeEditorAttachments<T>(input: T): T {
  const stored = new Map<string, string>();
  const store = (url: string, name = 'attachment') => {
    if (stored.has(url)) return stored.get(url)!;
    const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(url);
    if (!match) return url;
    if (match[2].length > 28_000_000) throw new Error('El adjunto supera 20 MB.');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 20_000_000) throw new Error('El adjunto supera 20 MB.');
    const asset = storePageAsset({ name, mimeType: match[1], bytes });
    const reference = `nodus-blob://${asset.blobHash}`;
    stored.set(url, reference);
    return reference;
  };
  const visit = (value: unknown, key = ''): unknown => {
    if (key === 'contentMarkdown' && typeof value === 'string') {
      return value.replace(/(!?\[[^\]\n]*\]\()(data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+)(\))/g,
        (_match, before: string, url: string, after: string) => before + store(url) + after);
    }
    if (Array.isArray(value)) return value.map(item => visit(item));
    if (!value || typeof value !== 'object') return value;
    const object = value as Record<string, unknown>;
    if (['image', 'audio', 'video', 'file'].includes(String(object.type)) && object.props && typeof object.props === 'object') {
      const props = object.props as Record<string, unknown>;
      if (typeof props.url === 'string' && props.url.startsWith('data:')) {
        return { ...object, props: { ...props, url: store(props.url, String(props.name || object.type)) },
          ...(object.children ? { children: visit(object.children) } : {}) };
      }
    }
    return Object.fromEntries(Object.entries(object).map(([name, entry]) => [name, visit(entry, name)]));
  };
  return visit(input) as T;
}
