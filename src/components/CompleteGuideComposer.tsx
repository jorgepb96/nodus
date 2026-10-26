/**
 * Composer panel for "Guía de estudio completa": the hierarchical source tree
 * (course → subject → folder → unit → source), the guide options and the pre-flight
 * estimate. The instructions field is the composer's own text box.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ModelRef } from '@shared/types';
import type { ResearchEffort } from '@shared/researchReasoning';
import type { CompleteGuidePreview, CompleteGuideCatalog } from '@shared/completeGuide/preview';
import type { CompleteGuideEstimateWarning } from '@shared/completeGuide/estimate';
import type { CompleteGuideSelection, CompleteGuideVerification } from '@shared/completeGuide/types';
import { resolveCompleteGuideSelection } from '@shared/completeGuide/selection';
import {
  buildCompleteGuideTree,
  completeGuideNodeState,
  toggleCompleteGuideGroup,
  toggleCompleteGuideSource,
  type CompleteGuideTreeNode,
} from '@shared/completeGuide/tree';
import { Icon } from './ui';
import { t, tx } from '../i18n';

export interface CompleteGuideComposerState {
  selection: CompleteGuideSelection;
  aiExamples: boolean;
  webText: boolean;
  webImages: boolean;
  rereadAll: boolean;
  verification: CompleteGuideVerification;
}

export const EMPTY_COMPLETE_GUIDE_STATE: CompleteGuideComposerState = {
  selection: { nodes: [], excludedSourceKeys: [] },
  aiExamples: true,
  webText: false,
  webImages: false,
  rereadAll: false,
  verification: 'standard',
};

const KIND_ICON: Record<string, string> = { course: 'graduation', subject: 'book', folder: 'folder', topic: 'layers', unplaced: 'inbox' };
const SOURCE_ICON: Record<string, string> = { material: 'fileText', document: 'notebook', transcript: 'microphone' };

function useSelectedKeys(catalog: CompleteGuideCatalog | null, selection: CompleteGuideSelection): Set<string> {
  return useMemo(() => {
    if (!catalog || !selection.nodes.length) return new Set<string>();
    return new Set(resolveCompleteGuideSelection(selection, catalog.sources, catalog.organization).sources.map((source) => source.sourceKey));
  }, [catalog, selection]);
}

function Checkbox({ state, label, onToggle, disabled = false }: { state: 'checked' | 'mixed' | 'unchecked'; label: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <input
      type="checkbox"
      className="h-3.5 w-3.5 shrink-0 accent-indigo-500"
      aria-label={label}
      checked={state === 'checked'}
      disabled={disabled}
      ref={(element) => { if (element) element.indeterminate = state === 'mixed'; }}
      onChange={onToggle}
    />
  );
}

function TreeNode({ node, depth, selectedKeys, expanded, onExpand, onToggleGroup, onToggleSource, searching }: {
  node: CompleteGuideTreeNode;
  depth: number;
  selectedKeys: Set<string>;
  expanded: Set<string>;
  onExpand: (id: string) => void;
  onToggleGroup: (node: CompleteGuideTreeNode) => void;
  onToggleSource: (key: string) => void;
  searching: boolean;
}) {
  const open = searching || expanded.has(node.id);
  const state = completeGuideNodeState(node, selectedKeys);
  const pad = { paddingLeft: `${depth * 14 + 4}px` };
  return (
    <li>
      <div className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-900" style={pad}>
        <button type="button" className="text-neutral-500" onClick={() => onExpand(node.id)} aria-label={open ? t('Contraer') : t('Expandir')} aria-expanded={open}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        </button>
        <Checkbox state={state} label={node.title} onToggle={() => onToggleGroup(node)} disabled={!node.sourceKeys.length} />
        <Icon name={KIND_ICON[node.kind] ?? 'folder'} size={13} className="text-neutral-500" />
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-200" title={node.title}>{node.title}</span>
        <span className="text-[10px] text-neutral-500">{node.sourceKeys.length}</span>
      </div>
      {open && (
        <ul>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} selectedKeys={selectedKeys} expanded={expanded} onExpand={onExpand} onToggleGroup={onToggleGroup} onToggleSource={onToggleSource} searching={searching} />
          ))}
          {node.sources.map((source) => (
            <li key={`${node.id}:${source.sourceKey}`}>
              <label className={`flex items-center gap-1.5 rounded px-1 py-0.5 ${source.available ? 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900' : 'opacity-60'}`} style={{ paddingLeft: `${(depth + 1) * 14 + 20}px` }}>
                <Checkbox state={selectedKeys.has(source.sourceKey) ? 'checked' : 'unchecked'} label={source.title} onToggle={() => onToggleSource(source.sourceKey)} disabled={!source.available} />
                <Icon name={SOURCE_ICON[source.kind] ?? 'file'} size={12} className="text-neutral-500" />
                <span className="min-w-0 flex-1 truncate text-xs text-neutral-700 dark:text-neutral-300" title={source.title}>{source.title}</span>
                {!source.available && (
                  <span className="rounded border border-amber-600/50 px-1 text-[10px] text-amber-600 dark:text-amber-300">
                    {source.unavailableReason === 'excluded' ? t('Excluido de la búsqueda') : source.unavailableReason === 'not_indexed' ? t('Pendiente de indexar') : t('Sin contenido utilizable')}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function warningText(warning: CompleteGuideEstimateWarning): string {
  switch (warning.code) {
    case 'several_subjects': return tx('Has elegido {n} asignaturas. La guía será más útil si creas una por asignatura o unidad.', { n: warning.count });
    case 'large_selection': return tx('Selección grande ({pages} páginas). Tardará más y costará más: considera elegir una sola unidad.', { pages: warning.pages });
    case 'unavailable_sources': return tx('{n} fuentes seleccionadas no están disponibles.', { n: warning.count });
    case 'pages_without_text': return tx('{n} fuentes tienen páginas sin texto (posibles escaneos): esas páginas no se pueden leer.', { n: warning.sources });
    case 'unknown_price': return t('No conocemos el precio de este modelo: se muestran solo los tokens.');
  }
}

function formatTokens(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} M` : value >= 1_000 ? `${Math.round(value / 1_000)} k` : String(value);
}

export function CompleteGuideComposer({ value, onChange, model, thinkingEffort, onReadyChange, loadCatalog, loadPreview }: {
  value: CompleteGuideComposerState;
  onChange: (next: CompleteGuideComposerState) => void;
  model: ModelRef | null;
  thinkingEffort: ResearchEffort;
  onReadyChange: (ready: boolean) => void;
  loadCatalog?: () => Promise<CompleteGuideCatalog>;
  loadPreview?: (request: Parameters<Window['nodus']['previewCompleteGuide']>[0]) => Promise<CompleteGuidePreview>;
}) {
  const [catalog, setCatalog] = useState<CompleteGuideCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<CompleteGuidePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (loadCatalog ? loadCatalog() : window.nodus.listCompleteGuideCatalog())
      .then((next) => {
        if (!alive) return;
        setCatalog(next);
        // Open courses and subjects so the units (what a guide is best made of) are
        // visible immediately; folders and units stay folded.
        const tree = buildCompleteGuideTree(next.sources, next.organization, { unplacedLabel: '' });
        const open = new Set<string>();
        const walk = (node: CompleteGuideTreeNode) => {
          if (node.kind === 'course' || node.kind === 'subject') open.add(node.id);
          if (node.kind === 'root' || node.kind === 'course') node.children.forEach(walk);
        };
        walk(tree);
        setExpanded(open);
      })
      .catch((error) => alive && setLoadError(error instanceof Error ? error.message : String(error)));
    return () => { alive = false; };
  }, [loadCatalog]);

  const tree = useMemo(() => (catalog ? buildCompleteGuideTree(catalog.sources, catalog.organization, { query, unplacedLabel: t('Sin ubicación') }) : null), [catalog, query]);
  const selectedKeys = useSelectedKeys(catalog, value.selection);

  // The estimate follows the selection and the model, debounced like a search box.
  useEffect(() => {
    if (!value.selection.nodes.length || !selectedKeys.size) {
      setPreview(null);
      setPreviewError(null);
      onReadyChange(false);
      return;
    }
    let alive = true;
    setPreviewing(true);
    const timer = setTimeout(() => {
      void (loadPreview ?? window.nodus.previewCompleteGuide)({ completeGuide: { ...value, runId: 'preview-run' }, model, thinkingEffort })
        .then((next) => { if (alive) { setPreview(next); setPreviewError(null); onReadyChange(next.totals.readablePassages > 0); } })
        .catch((error) => { if (alive) { setPreviewError(error instanceof Error ? error.message : String(error)); onReadyChange(false); } })
        .finally(() => alive && setPreviewing(false));
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [value, selectedKeys.size, model?.provider, model?.model, thinkingEffort, loadPreview]);

  const toggleExpanded = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const option = (key: 'aiExamples' | 'webText' | 'webImages' | 'rereadAll', label: string, help: string) => (
    <label className="flex items-start gap-2 text-xs text-neutral-700 dark:text-neutral-300">
      <input type="checkbox" className="mt-0.5 accent-indigo-500" checked={value[key]} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} />
      <span><span className="font-medium">{label}</span><span className="block text-[11px] text-neutral-500">{help}</span></span>
    </label>
  );

  return (
    <div className="space-y-3" data-testid="complete-guide-composer">
      <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="mb-2 flex items-center gap-2">
          <Icon name="library" size={14} className="text-indigo-500 dark:text-indigo-300" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">{t('Fuentes de la guía')}</span>
          <span className="ml-auto text-[11px] text-neutral-500">{tx('{n} seleccionadas', { n: selectedKeys.size })}</span>
        </div>
        <p className="mb-2 text-[11px] text-neutral-500">{t('Elige preferiblemente una asignatura o una unidad. Se leerá todo su contenido, página a página.')}</p>
        <div className="relative mb-2">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input className="input input-with-leading-icon w-full !py-1.5 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Buscar cursos, asignaturas, unidades o materiales')} />
        </div>
        <div className="max-h-64 overflow-y-auto pr-1" data-testid="complete-guide-tree">
          {loadError && <p className="text-xs text-red-500">{loadError}</p>}
          {!catalog && !loadError && <p className="text-xs text-neutral-500">{t('Cargando…')}</p>}
          {tree && (tree.children.length ? (
            <ul>
              {tree.children.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedKeys={selectedKeys}
                  expanded={expanded}
                  onExpand={toggleExpanded}
                  onToggleGroup={(group) => onChange({ ...value, selection: toggleCompleteGuideGroup(value.selection, group, selectedKeys) })}
                  onToggleSource={(key) => onChange({ ...value, selection: toggleCompleteGuideSource(value.selection, key, selectedKeys) })}
                  searching={query.trim().length > 0}
                />
              ))}
            </ul>
          ) : <p className="text-xs text-neutral-500">{t('No hay materiales, apuntes ni transcripciones con texto.')}</p>)}
        </div>
      </section>

      <section className="grid gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        {option('aiExamples', t('Ejemplos y analogías elaborados por IA'), t('Se añaden cuando los materiales no bastan y siempre aparecen etiquetados como elaborados por IA.'))}
        {option('webText', t('Complementar con la web'), t('Busca en la web solo lo que falte; se cita como fuente web, nunca como tus materiales.'))}
        {option('webImages', t('Imágenes de la web'), t('Ilustraciones con licencia abierta y su atribución (Wikimedia Commons).'))}
        {option('rereadAll', t('Releer todo sin caché'), t('Por defecto se reutiliza lo ya leído de fuentes que no han cambiado.'))}
        <label className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
          <span className="font-medium">{t('Comprobación de afirmaciones')}</span>
          <select className="input !py-1 text-xs" value={value.verification} onChange={(event) => onChange({ ...value, verification: event.target.value === 'exhaustive' ? 'exhaustive' : 'standard' })}>
            <option value="standard">{t('Estándar (cifras dudosas)')}</option>
            <option value="exhaustive">{t('Exhaustiva (todos los bloques)')}</option>
          </select>
        </label>
      </section>

      <section className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/45" data-testid="complete-guide-estimate" aria-live="polite">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-neutral-700 dark:text-neutral-300">
          <Icon name="clock" size={13} /> {t('Estimación')}
          {previewing && <span className="font-normal text-neutral-500">· {t('calculando…')}</span>}
        </div>
        {!value.selection.nodes.length && <p className="text-neutral-500">{t('Selecciona fuentes para ver cuánto se leerá y lo que costará aproximadamente.')}</p>}
        {previewError && <p className="text-red-500">{previewError}</p>}
        {preview && (
          <>
            <p className="text-neutral-600 dark:text-neutral-400">
              {tx('{sources} fuentes · {pages} páginas o diapositivas · {tokens} tokens de texto · {units} capítulos', {
                sources: preview.totals.sources, pages: preview.totals.pages, tokens: formatTokens(preview.totals.estimatedTokens), units: preview.units,
              })}
            </p>
            <p className="text-neutral-600 dark:text-neutral-400">
              {tx('~{calls} llamadas · {minMin}–{maxMin} min', { calls: preview.estimate.calls, minMin: preview.estimate.minutes.min, maxMin: preview.estimate.minutes.max })}
              {preview.estimate.usd ? ` · ${tx('{min}–{max} USD', { min: preview.estimate.usd.min.toFixed(2), max: preview.estimate.usd.max.toFixed(2) })}` : ` · ${tx('{tokens} tokens en total', { tokens: formatTokens(preview.estimate.inputTokens + preview.estimate.outputTokens) })}`}
            </p>
            {preview.estimate.warnings.map((warning) => (
              <p key={warning.code} className="mt-1 flex items-start gap-1 text-amber-700 dark:text-amber-300"><Icon name="warning" size={12} className="mt-0.5 shrink-0" /> {warningText(warning)}</p>
            ))}
            {preview.unavailable.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-neutral-500">
                {preview.unavailable.slice(0, 6).map((entry) => <li key={entry.sourceKey}>{entry.title}</li>)}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
