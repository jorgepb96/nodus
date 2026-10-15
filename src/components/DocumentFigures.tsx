import { createContext, useContext, useMemo, useState } from 'react';
import type { DocumentFigure as Figure, DocumentVisualManifest, DocumentVisualTarget } from '@shared/documentSkills';
import { documentBlocks } from '@shared/documentSkills';
import { readyDocumentFigures } from '@shared/documentFigureExport';
import type { ViewNode } from '@shared/capabilities';
import { CapabilityView } from './CapabilityView';
import { t } from '../i18n';
import './documentFigures.css';

// Read-only figure rendering is shared with chat. Document mutation callbacks are
// supplied only by the document controller, keeping them out of Nodi's preload.
export const DocumentFigureContext = createContext<{ manifest: DocumentVisualManifest | null; target: DocumentVisualTarget; refresh: () => void; removeFigure: (id: string) => void } | null>(null);
export function useDocumentFigures(content: string) {
  const context = useContext(DocumentFigureContext);
  const manifest = context?.manifest;
  return useMemo(()=>{
  if (!manifest) return [];
  const canonical = documentBlocks({ text: content }).map(block => block.markdown).join('\n\n');
  const fields = [...new Set(manifest.blocks.map(block => block.field))];
  const field = fields.find(field => manifest.blocks.filter(block => block.field === field).map(block => block.markdown).join('\n\n') === canonical);
  if (!field) return [];
  const ready = readyDocumentFigures(manifest);
  return ready.filter(figure => manifest.blocks.some(block => block.id === figure.blockId && block.field === field)).map(figure => ({ figure, number: ready.indexOf(figure)+1, block: manifest.blocks.find(block => block.id === figure.blockId)! }));
  },[manifest,content]);
}

export function DocumentVisualFigures({ field }: { field: string }) {
  const context = useContext(DocumentFigureContext);
  const ready = readyDocumentFigures(context?.manifest);
  return <>{ready.filter(figure => context?.manifest?.blocks.some(block => block.id === figure.blockId && block.field === field)).map(figure => <DocumentFigure key={figure.id} figure={figure} number={ready.indexOf(figure)+1} />)}</>;
}

export function DocumentFigure({ figure, number, onSource }: { figure: Figure; number: number; onSource?: (source: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const context = useContext(DocumentFigureContext);
  const flatten = (nodes: ViewNode[]): ViewNode[] => nodes.flatMap(node => node.kind === 'details' ? flatten(node.children) : [node]);
  const originals = flatten(figure.view?.nodes ?? []).filter(node => node.kind === 'svg' || node.kind === 'model' || node.kind === 'image');
  const download = (node: ViewNode) => {
    if (node.kind === 'svg') {
      const url = URL.createObjectURL(new Blob([node.svg], { type: 'image/svg+xml' }));
      const link = document.createElement('a'); link.href = url; link.download = `figure-${number}.svg`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if ('attachmentId' in node && figure.owner) void window.nodus.downloadCapabilityFile(`nodus-capability://chat/${figure.owner}/${node.attachmentId}`);
  };
  return <figure className="document-figure" data-layout={figure.layout} data-reader-ignore="true" data-figure-id={figure.id}>
    <button type="button" className="document-figure-preview" onClick={() => setExpanded(!expanded)} aria-label={t('Ampliar imagen')} aria-expanded={expanded}>
      <img src={figure.poster} alt={figure.caption} />
    </button>
    <figcaption><strong>{t('Figura')} {number}.</strong>{figure.caption}{figure.sources.map((source, index) => <a key={source} href={source} onClick={event => { event.preventDefault(); onSource?.(source); }}> [{index + 1}]</a>)}</figcaption>
    {expanded && figure.view && <div className="document-figure-detail"><CapabilityView view={figure.view} owner={figure.owner} presentation="document" /></div>}
    {expanded && <div className="document-figure-actions"><button type="button" onClick={() => { const link = document.createElement('a'); link.href = figure.poster!; link.download = `figure-${number}.png`; link.click(); }}>{t('Descargar')} PNG</button>{originals.map((node,index) => <button key={index} type="button" onClick={() => download(node)}>{t('Descargar')} {node.kind === 'svg' ? 'SVG' : 'name' in node ? node.name : ''}</button>)}{context && <button type="button" onClick={() => context.removeFigure(figure.id)}>{t('Retirar figura')}</button>}</div>}
  </figure>;
}

