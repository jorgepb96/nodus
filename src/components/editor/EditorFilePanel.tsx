import { useState } from 'react';
import { filenameFromURL } from '@blocknote/core';
import { useBlockNoteEditor, useComponentsContext, useDictionary, type FilePanelProps } from '@blocknote/react';
import { t } from '../../i18n';
import { uploadEditorFile } from './editorAttachments';

/** Match Nodus's existing resource policy without silently inserting a broken preview. */
function canEmbed(value: string, type: string) {
  if (typeof window.nodus?.getPageAsset === 'function' && /^nodus-blob:\/\/[a-f0-9]{64}$/.test(value)) return true;
  if (/^data:/i.test(value)) return value.length < 2_800_000 && (type === 'file' || value.toLowerCase().startsWith(`data:${type}/`));
  try {
    const url = new URL(value, location.href);
    if (type === 'file') return ['https:', 'http:'].includes(url.protocol);
    if (url.origin === location.origin && ['https:', 'http:', 'file:'].includes(url.protocol)) return true;
    if (window.nodus && ['nodus-archive:', 'nodus-library:'].includes(url.protocol)) return true;
    return type === 'image' && (Boolean(window.nodus) && url.protocol === 'nodus-image:' || url.protocol === 'https:' && url.hostname.endsWith('.tile.openstreetmap.org'));
  } catch { return false; }
}

/** Public BlockNote panel components retain upload/embed behavior and native file blocks. */
export function EditorFilePanel({ blockId }: FilePanelProps) {
  const editor = useBlockNoteEditor(), components = useComponentsContext()!, dictionary = useDictionary();
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [url, setUrl] = useState('');
  const [openTab, setOpenTab] = useState(dictionary.file_panel.upload.title);
  const block = editor.getBlock(blockId);
  if (!block) return null;
  const upload = dictionary.file_panel.upload, embed = dictionary.file_panel.embed;
  const accept = editor.schema.blockSpecs[block.type].implementation.meta?.fileBlockAccept?.join(',') || '*/*';
  const tabs = [{ name: upload.title, tabPanel: <components.FilePanel.TabPanel className="bn-tab-panel">
    <components.FilePanel.FileInput className="bn-file-input" accept={accept} value={null} data-test="upload-input" placeholder={upload.file_placeholder[block.type] || upload.file_placeholder.file} onChange={file => {
      if (!file || loading) return;
      setLoading(true); setError('');
      // BlockNote 0.55's upload-start handler removes the empty placeholder but
      // does not restore it on failure. Use Nodus's shared uploader directly so
      // a rejected file can be retried without a removeChild exception.
      void uploadEditorFile(file).then(result => {
        if (!editor.getBlock(blockId)) return;
        editor.updateBlock(blockId, { props: { name: file.name, url: result } });
      }).catch(reason => setError(reason instanceof Error ? reason.message : upload.upload_error)).finally(() => setLoading(false));
    }} />{loading && <p role="status">{t('Cargando…')}</p>}{error && openTab === upload.title && <p className="bn-error-text" role="alert">{error}</p>}
  </components.FilePanel.TabPanel> }, { name: embed.title, tabPanel: <components.FilePanel.TabPanel className="bn-tab-panel">
    <components.Generic.Form.Root onSubmit={() => {
      const value = url.trim();
      if (!value || !canEmbed(value, block.type)) { setError(t('Para insertar este recurso, sube el archivo o usa una URL de Nodus.')); return; }
      setError(''); if (editor.getBlock(blockId)) editor.updateBlock(blockId, { props: { name: /^data:/i.test(value) ? block.type : filenameFromURL(value), url: value } });
    }} submitButton={<components.FilePanel.Button className="bn-button" type="submit" data-test="embed-input-button">{embed.embed_button[block.type] || embed.embed_button.file}</components.FilePanel.Button>}>
      <components.FilePanel.TextInput className="bn-text-input" data-test="embed-input" placeholder={embed.url_placeholder} value={url} onChange={event => { setUrl(event.currentTarget.value); setError(''); }} />
    </components.Generic.Form.Root>{error && openTab === embed.title && <p className="bn-error-text" role="alert">{error}</p>}
  </components.FilePanel.TabPanel> }];
  return <components.FilePanel.Root className="bn-panel" tabs={tabs} defaultOpenTab={openTab} openTab={openTab} setOpenTab={value => { setOpenTab(value); setError(''); }} loading={loading} />;
}
