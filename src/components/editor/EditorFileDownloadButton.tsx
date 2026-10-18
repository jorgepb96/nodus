import { useState } from 'react';
import { FileDownloadButton, useBlockNoteEditor, useComponentsContext, useDictionary, useEditorState } from '@blocknote/react';
import { Icon } from '../ui';
import { t } from '../../i18n';

/** Local attachments download as files; Electron rejects window.open(data:…). */
export function EditorFileDownloadButton() {
  const editor = useBlockNoteEditor();
  const components = useComponentsContext()!;
  const dictionary = useDictionary();
  const [error, setError] = useState(false);
  const block = useEditorState({ editor, selector: ({ editor }) => {
    const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
    return blocks.length === 1 ? blocks[0] : undefined;
  } });
  const url = block && 'url' in block.props ? block.props.url : '';
  if (typeof url !== 'string' || !url.startsWith('data:') && !/^nodus-blob:\/\/[a-f0-9]{64}$/.test(url)) return <FileDownloadButton />;
  const label = dictionary.formatting_toolbar.file_download.tooltip[block!.type] || dictionary.formatting_toolbar.file_download.tooltip.file;
  const Button = components.FormattingToolbar.Button;
  return <><Button className="bn-button" label={label} mainTooltip={label} icon={<Icon name="download" size={18} />} onClick={() => void (async () => {
    setError(false);
    try {
      // Decode locally: fetch(data:…) is blocked by Server's connect-src policy.
      const stored = /^nodus-blob:\/\/([a-f0-9]{64})$/.exec(url);
      const saved = stored ? await window.nodus.getPageAsset(stored[1]) : null;
      const comma = stored ? 0 : url.indexOf(',');
      if (comma < 0) throw new Error('Invalid data URI');
      const header = url.slice(5, comma), payload = url.slice(comma + 1);
      let bytes: Uint8Array<ArrayBuffer>;
      if (stored) {
        if (!saved) throw new Error('Missing attachment');
        bytes = new Uint8Array(saved);
      } else if (/;base64$/i.test(header)) {
        const binary = atob(payload);
        bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      } else bytes = new TextEncoder().encode(decodeURIComponent(payload));
      const blob = new Blob([bytes], { type: header.split(';')[0] || 'application/octet-stream' });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = block && 'name' in block.props && typeof block.props.name === 'string' ? block.props.name || block.type : 'attachment';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch { setError(true); }
  })()} />{error && <span role="alert">{t('No se pudo descargar el archivo.')}</span>}</>;
}
