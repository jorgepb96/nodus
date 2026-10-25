import { useEffect, useState } from 'react';
import { editorAttachmentResolver } from './editorAttachments';

export const renderEditorAssetImage = (src: string, alt?: string) => <EditorAssetImage src={src} alt={alt} />;

export function EditorAssetImage({ src, alt }: { src: string; alt?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const resolver = editorAttachmentResolver();
    let active = true;
    setUrl('');
    void resolver.resolve(src).then(value => { if (active) setUrl(value); }).catch(() => undefined);
    return () => { active = false; resolver.dispose(); };
  }, [src]);
  return url ? <img src={url} alt={alt} /> : null;
}
