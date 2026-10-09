import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui';
import { t } from '../../i18n';
import {
  PAGE_BLOCK_TYPES,
  defaultPageBlockContent,
  pageBlockNormalizedText,
  type PageAsset,
  type PageBlockDraft,
  type PageBlockType,
  type PageDocument,
} from '@shared/pages';
import { LinkedDatabaseViewBlock } from './LinkedDatabaseViewBlock';

const BLOCK_LABELS: Record<PageBlockType, string> = {
  paragraph: 'Párrafo', heading_1: 'Encabezado 1', heading_2: 'Encabezado 2', heading_3: 'Encabezado 3',
  bulleted_list: 'Lista con viñetas', numbered_list: 'Lista numerada', task: 'Tarea', toggle: 'Desplegable',
  quote: 'Cita', callout: 'Destacado', divider: 'Separador', code: 'Código', equation: 'Ecuación',
  table: 'Tabla simple', columns: 'Columnas', image: 'Imagen', file: 'Archivo', audio: 'Audio', video: 'Vídeo',
  bookmark: 'Marcador web', embed: 'Contenido incrustado', subpage: 'Subpágina', mention: 'Mención',
  synced_block: 'Bloque sincronizado', database_view: 'Vista enlazada', markdown: 'Markdown sin convertir',
};

const TEXT_TYPES = new Set<PageBlockType>([
  'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list', 'numbered_list',
  'quote', 'callout', 'equation',
]);

function makeDraft(type: PageBlockType): PageBlockDraft {
  return {
    id: `pblk_${crypto.randomUUID()}`,
    parentBlockId: null,
    type,
    content: defaultPageBlockContent(type),
  };
}

function draftSignature(value: PageBlockDraft[]): string {
  return JSON.stringify(value.map((entry) => ({
    id: entry.id, parentBlockId: entry.parentBlockId ?? null, type: entry.type, content: entry.content ?? {},
  })));
}

function MediaPreview({ block }: { block: PageBlockDraft }) {
  const hash = typeof block.content?.blobHash === 'string' ? block.content.blobHash : '';
  const mime = typeof block.content?.mimeType === 'string' ? block.content.mimeType : '';
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (!hash) { setUrl(null); return; }
    void window.nodus.getPageAsset(hash).then((bytes) => {
      if (!active || !bytes) return;
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime || 'application/octet-stream' }));
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [hash, mime]);
  if (!url) return null;
  if (block.type === 'image') return <img className="mt-2 max-h-72 max-w-full rounded-lg object-contain" src={url} alt={String(block.content?.caption ?? block.content?.name ?? '')} />;
  if (block.type === 'audio') return <audio className="mt-2 w-full" controls src={url} />;
  if (block.type === 'video') return <video className="mt-2 max-h-72 max-w-full rounded-lg" controls src={url} />;
  return null;
}

export function PageBlockEditor({
  rowId, pageId, onDocumentChange, onNavigatePage,
}: {
  rowId?: string;
  pageId?: string;
  onDocumentChange?: (document: PageDocument) => void;
  onNavigatePage?: (pageId: string) => void;
}) {
  const [document, setDocument] = useState<PageDocument | null>(null);
  const [drafts, setDrafts] = useState<PageBlockDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PageDocument | null>(null);
  const [menuAfter, setMenuAfter] = useState<number | null>(null);
  const [slashIndex, setSlashIndex] = useState<number | null>(null);
  const documentRef = useRef<PageDocument | null>(null);
  const draftsRef = useRef<PageBlockDraft[]>([]);
  const serialRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragIndex = useRef<number | null>(null);
  const undoStack = useRef<PageBlockDraft[][]>([]);
  const redoStack = useRef<PageBlockDraft[][]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = rowId
        ? await window.nodus.getPageForDatabaseRow(rowId)
        : pageId ? await window.nodus.getPageDocument(pageId) : null;
      if (!next) throw new Error(t('No se encontró la página de esta fila.'));
      const initial = next.blocks.length
        ? next.blocks.map((entry) => ({ id: entry.id, parentBlockId: entry.parentBlockId, order: entry.order, type: entry.type, content: entry.content }))
        : [makeDraft('paragraph')];
      documentRef.current = next;
      draftsRef.current = initial;
      setDocument(next);
      onDocumentChange?.(next);
      setDrafts(initial);
      undoStack.current = [];
      redoStack.current = [];
      setConflict(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [onDocumentChange, pageId, rowId]);

  useEffect(() => {
    void load();
    // Leaving the page (or switching to another row) inside the save debounce used to cancel
    // the pending save, losing the last half second of typing. It is written now, against the
    // page it was typed into, without touching the state of whatever loads next.
    return () => {
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const current = documentRef.current;
      if (!current || current.page.locked) return;
      void window.nodus.savePageDocument({ pageId: current.page.id, expectedRevision: current.revision, blocks: draftsRef.current, reason: 'editor' }).catch(() => undefined);
    };
  }, [load]);

  const persist = useCallback(async (snapshot: PageBlockDraft[], serial: number) => {
    const current = documentRef.current;
    if (!current) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const result = await window.nodus.savePageDocument({
        pageId: current.page.id,
        expectedRevision: current.revision,
        blocks: snapshot,
        reason: 'editor',
      });
      if (!result.ok) {
        setConflict(result.conflict.current);
        setSaving(false);
        return;
      }
      documentRef.current = result.document;
      setDocument(result.document);
      onDocumentChange?.(result.document);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1_500);
      if (serial !== serialRef.current) {
        void persist(draftsRef.current, serialRef.current);
      } else {
        setSaving(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  }, [onDocumentChange]);

  const commit = useCallback((next: PageBlockDraft[], options: { history?: boolean; immediate?: boolean } = {}) => {
    if (documentRef.current?.page.locked) return;
    if (options.history !== false && draftSignature(next) !== draftSignature(draftsRef.current)) {
      undoStack.current = [...undoStack.current.slice(-49), structuredClone(draftsRef.current)];
      redoStack.current = [];
    }
    draftsRef.current = next;
    setDrafts(next);
    const serial = ++serialRef.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void persist(next, serial); }, options.immediate ? 0 : 550);
  }, [persist]);

  const updateBlock = (index: number, patch: Partial<PageBlockDraft>) => {
    commit(drafts.map((entry, current) => current === index ? { ...entry, ...patch } : entry));
  };
  const updateContent = (index: number, patch: Record<string, unknown>) => {
    const entry = drafts[index];
    updateBlock(index, { content: { ...(entry.content ?? {}), ...patch } });
  };

  const addBlock = (type: PageBlockType, after = drafts.length - 1) => {
    const next = [...drafts];
    next.splice(after + 1, 0, makeDraft(type));
    commit(next, { immediate: true });
    setMenuAfter(null);
    setSlashIndex(null);
  };

  const removeBlock = (index: number) => {
    const removed = drafts[index];
    const next = drafts
      .filter((_entry, current) => current !== index)
      .map((entry) => entry.parentBlockId === removed.id ? { ...entry, parentBlockId: removed.parentBlockId ?? null } : entry);
    commit(next.length ? next : [makeDraft('paragraph')], { immediate: true });
  };

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= drafts.length || to >= drafts.length) return;
    const next = [...drafts];
    const [entry] = next.splice(from, 1);
    next.splice(to, 0, entry);
    commit(next, { immediate: true });
  };

  const undo = () => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(structuredClone(draftsRef.current));
    commit(previous, { history: false, immediate: true });
  };
  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(structuredClone(draftsRef.current));
    commit(next, { history: false, immediate: true });
  };

  const pickAsset = async (index: number, kind: 'image' | 'file' | 'audio' | 'video') => {
    const asset = await window.nodus.pickPageAsset(kind);
    if (asset) updateContent(index, { ...asset });
  };

  const appendDroppedFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset: PageAsset = await window.nodus.storePageAsset({ name: file.name, mimeType: file.type || null, bytes });
    const type: PageBlockType = file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('video/') ? 'video' : 'file';
    const draft = makeDraft(type);
    draft.content = { ...draft.content, ...asset };
    commit([...draftsRef.current, draft], { immediate: true });
  };

  const depthOf = useMemo(() => {
    const parent = new Map(drafts.map((entry) => [entry.id ?? '', entry.parentBlockId ?? null]));
    return (entry: PageBlockDraft) => {
      let depth = 0;
      let cursor = entry.parentBlockId ?? null;
      const seen = new Set<string>();
      while (cursor && depth < 6 && !seen.has(cursor)) { seen.add(cursor); depth++; cursor = parent.get(cursor) ?? null; }
      return depth;
    };
  }, [drafts]);

  if (loading) return <div className="page-editor-state py-8 text-sm text-neutral-600 dark:text-neutral-300">{t('Cargando página…')}</div>;
  if (!document) return <div role="alert" className="page-editor-state rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error ?? t('No se pudo abrir la página.')}</div>;

  return (
    <section
      className="page-block-editor mt-6 border-t border-neutral-200 pt-5 dark:border-neutral-800"
      data-testid="page-block-editor"
      aria-label={t('Contenido de la página')}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          for (const file of Array.from(event.dataTransfer.files)) void appendDroppedFile(file);
        }
      }}
      onKeyDown={(event) => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      }}
    >
      {document.page.locked && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          <Icon name="lock" size={13} /> {t('Esta página está bloqueada y se muestra en modo lectura.')}
        </div>
      )}
      <fieldset disabled={document.page.locked} className="contents">
      <div className="mb-3 flex min-h-8 flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">{t('Contenido de la página')}</h3>
        <span className="text-[11px] text-neutral-600 dark:text-neutral-400" aria-live="polite">
          {saving ? t('Guardando…') : saved ? t('Guardado') : ''}
        </span>
        <div className="ml-auto flex flex-wrap justify-end gap-1">
          <button className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-800" onClick={undo} disabled={!undoStack.current.length} title={t('Deshacer')} aria-label={t('Deshacer')}><Icon name="undo" size={14} /></button>
          <button className="rounded-md p-1.5 text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-300 dark:hover:bg-neutral-800" onClick={redo} disabled={!redoStack.current.length} title={t('Rehacer')} aria-label={t('Rehacer')}><Icon name="redo" size={14} /></button>
          <button className="btn btn-ghost h-8 px-2 text-xs" onClick={() => setMenuAfter(menuAfter === drafts.length - 1 ? null : drafts.length - 1)}><Icon name="plus" size={13} /> {t('Añadir bloque')}</button>
        </div>
      </div>

      {error && <p role="alert" className="mb-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</p>}
      {conflict && (
        <div role="alert" data-testid="page-conflict" className="mb-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
          <strong>{t('Hay cambios simultáneos en esta página.')}</strong>
          <p className="mt-1 text-xs">{t('Recarga la versión más reciente o conserva tus bloques sobre ella.')}</p>
          <div className="mt-2 flex gap-2">
            <button className="btn h-8 px-3 text-xs" onClick={() => {
              documentRef.current = conflict;
              const next = conflict.blocks.length ? conflict.blocks.map((entry) => ({ id: entry.id, parentBlockId: entry.parentBlockId, order: entry.order, type: entry.type, content: entry.content })) : [makeDraft('paragraph')];
              draftsRef.current = next; setDrafts(next); setDocument(conflict); setConflict(null);
            }}>{t('Recargar cambios')}</button>
            <button className="btn btn-primary h-8 px-3 text-xs" onClick={() => {
              documentRef.current = conflict; setConflict(null); void persist(draftsRef.current, ++serialRef.current);
            }}>{t('Conservar mi versión')}</button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {drafts.map((entry, index) => (
          <div
            key={entry.id}
            id={`page-block-anchor-${entry.id}`}
            data-testid={`page-block-${entry.id}`}
            className="group/page-block relative rounded-lg border border-transparent py-1 pl-8 pr-14 hover:border-neutral-200 hover:bg-neutral-50 focus-within:border-indigo-300 focus-within:bg-white dark:hover:border-neutral-800 dark:hover:bg-neutral-900/50 dark:focus-within:border-indigo-700 dark:focus-within:bg-neutral-950"
            style={{ marginLeft: `${depthOf(entry) * 22}px` }}
            onDragStart={() => { dragIndex.current = index; }}
            onDragEnd={() => { dragIndex.current = null; }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              if (!event.dataTransfer.files.length && dragIndex.current != null) {
                event.preventDefault(); move(dragIndex.current, index); dragIndex.current = null;
              }
            }}
          >
            <button draggable className="absolute left-1 top-1.5 flex h-6 w-6 cursor-grab items-center justify-center rounded text-neutral-400 opacity-0 hover:bg-neutral-200 group-hover/page-block:opacity-100 focus:opacity-100 dark:text-neutral-500 dark:hover:bg-neutral-800" title={t('Arrastrar bloque')} aria-label={t('Arrastrar bloque')}><Icon name="menu" size={12} /></button>
            <div className="min-w-0">
              <BlockInput
                block={entry}
                onContent={(patch) => updateContent(index, patch)}
                onSlash={() => setSlashIndex(slashIndex === index ? null : index)}
                onIndent={(outdent) => {
                  const previous = drafts[index - 1];
                  updateBlock(index, { parentBlockId: outdent ? null : previous?.id ?? null });
                }}
                onPickAsset={(kind) => void pickAsset(index, kind)}
                onNavigatePage={onNavigatePage}
              />
            </div>
            <div className="absolute right-1 top-1.5 flex opacity-0 group-hover/page-block:opacity-100 group-focus-within/page-block:opacity-100">
              <button className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100" onClick={() => setMenuAfter(menuAfter === index ? null : index)} title={t('Añadir debajo')} aria-label={t('Añadir debajo')}><Icon name="plus" size={12} /></button>
              <button className="flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-950/50 dark:hover:text-rose-300" onClick={() => removeBlock(index)} title={t('Eliminar bloque')} aria-label={t('Eliminar bloque')}><Icon name="trash" size={12} /></button>
            </div>
            {(menuAfter === index || slashIndex === index) && <BlockMenu onSelect={(type) => {
              if (slashIndex === index && String(entry.content?.text ?? '') === '/') {
                const next = [...drafts]; next[index] = { ...makeDraft(type), id: entry.id, parentBlockId: entry.parentBlockId };
                commit(next, { immediate: true }); setSlashIndex(null);
              } else addBlock(type, index);
            }} />}
          </div>
        ))}
      </div>
      {menuAfter === drafts.length - 1 && drafts.length === 0 && <BlockMenu onSelect={(type) => addBlock(type, -1)} />}
      <button className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900" onClick={() => setMenuAfter(drafts.length - 1)}><Icon name="plus" size={13} />{t('Escribe / o añade otro bloque')}</button>
      </fieldset>
    </section>
  );
}

function BlockMenu({ onSelect }: { onSelect: (type: PageBlockType) => void }) {
  return (
    <div role="menu" data-testid="page-block-menu" className="relative z-20 mt-1 grid max-h-64 grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-2 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 sm:grid-cols-3">
      {PAGE_BLOCK_TYPES.map((type) => (
        <button key={type} role="menuitem" className="rounded-lg px-2 py-1.5 text-left text-xs text-neutral-700 hover:bg-indigo-50 hover:text-indigo-800 dark:text-neutral-200 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-200" onClick={() => onSelect(type)}>
          {t(BLOCK_LABELS[type])}
        </button>
      ))}
    </div>
  );
}

function BlockInput({
  block, onContent, onSlash, onIndent, onPickAsset, onNavigatePage,
}: {
  block: PageBlockDraft;
  onContent: (patch: Record<string, unknown>) => void;
  onSlash: () => void;
  onIndent: (outdent: boolean) => void;
  onPickAsset: (kind: 'image' | 'file' | 'audio' | 'video') => void;
  onNavigatePage?: (pageId: string) => void;
}) {
  const content = block.content ?? {};
  const keyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Tab') { event.preventDefault(); onIndent(event.shiftKey); }
  };
  const textArea = (className = '') => (
    <textarea
      className={`block min-h-9 w-full resize-y bg-transparent px-1 py-1.5 text-sm leading-6 outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-600 ${className}`}
      value={String(content.text ?? '')}
      rows={block.type.startsWith('heading_') ? 1 : block.type === 'quote' ? 2 : 1}
      placeholder={t(block.type === 'paragraph' ? 'Escribe algo o pulsa / para insertar…' : BLOCK_LABELS[block.type])}
      aria-label={t(BLOCK_LABELS[block.type])}
      onChange={(event) => { onContent({ text: event.target.value }); if (event.target.value === '/') onSlash(); }}
      onKeyDown={keyDown}
    />
  );

  if (TEXT_TYPES.has(block.type)) {
    const style = block.type === 'heading_1' ? 'text-2xl font-semibold leading-8'
      : block.type === 'heading_2' ? 'text-xl font-semibold leading-7'
      : block.type === 'heading_3' ? 'text-lg font-semibold'
      : block.type === 'quote' ? 'border-l-4 border-neutral-300 pl-3 italic dark:border-neutral-700'
      : block.type === 'callout' ? 'rounded-lg bg-indigo-50 px-3 text-indigo-950 dark:bg-indigo-950/40 dark:text-indigo-100'
      : block.type === 'equation' ? 'font-mono text-center' : '';
    return textArea(style);
  }
  if (block.type === 'task') return <label className="flex items-start gap-2 px-1 py-1"><input className="mt-2" type="checkbox" checked={Boolean(content.checked)} onChange={(event) => onContent({ checked: event.target.checked })} />{textArea(content.checked ? 'line-through opacity-70' : '')}</label>;
  if (block.type === 'toggle') return <div><input aria-label={t('Título del desplegable')} className="input h-9 w-full text-sm font-medium" value={String(content.text ?? '')} placeholder={t('Título del desplegable')} onChange={(event) => onContent({ text: event.target.value })} onKeyDown={keyDown} /><textarea aria-label={t('Contenido ocultable')} className="mt-1 min-h-16 w-full resize-y rounded-lg border border-neutral-200 bg-transparent p-2 text-sm outline-none dark:border-neutral-800" value={String(content.body ?? '')} placeholder={t('Contenido ocultable')} onChange={(event) => onContent({ body: event.target.value })} /></div>;
  if (block.type === 'divider') return <div className="py-4"><hr className="border-neutral-300 dark:border-neutral-700" /></div>;
  if (block.type === 'code') return <div><input aria-label={t('Lenguaje')} className="mb-1 w-32 rounded bg-neutral-100 px-2 py-1 text-[11px] outline-none dark:bg-neutral-800" value={String(content.language ?? '')} placeholder={t('Lenguaje')} onChange={(event) => onContent({ language: event.target.value })} /><textarea aria-label={t('Código')} className="min-h-28 w-full resize-y rounded-lg bg-neutral-950 p-3 font-mono text-sm text-neutral-100 outline-none" value={String(content.text ?? '')} onChange={(event) => onContent({ text: event.target.value })} /></div>;
  if (block.type === 'table') {
    const rows = Array.isArray(content.rows) ? content.rows as unknown[][] : [];
    return <textarea aria-label={t('Tabla simple')} className="min-h-24 w-full resize-y rounded-lg border border-neutral-200 bg-transparent p-2 font-mono text-xs outline-none dark:border-neutral-800" value={rows.map((row) => row.map(String).join(' | ')).join('\n')} onChange={(event) => onContent({ rows: event.target.value.split('\n').map((row) => row.split('|').map((cell) => cell.trim())) })} onKeyDown={keyDown} />;
  }
  if (block.type === 'columns') {
    const columns = Array.isArray(content.columns) ? content.columns.map(String) : ['', ''];
    return <div className="grid gap-2 sm:grid-cols-2">{columns.map((column, index) => <textarea key={index} aria-label={`${t('Columnas')} ${index + 1}`} className="min-h-24 resize-y rounded-lg border border-neutral-200 bg-transparent p-2 text-sm outline-none dark:border-neutral-800" value={column} onChange={(event) => { const next = [...columns]; next[index] = event.target.value; onContent({ columns: next }); }} />)}</div>;
  }
  if (['image', 'file', 'audio', 'video'].includes(block.type)) {
    const kind = block.type as 'image' | 'file' | 'audio' | 'video';
    const name = String(content.name ?? '');
    return <div className="rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-700"><div className="flex items-center gap-2"><Icon name={kind === 'image' ? 'image' : kind === 'file' ? 'file' : kind === 'audio' ? 'audio' : 'video'} size={15} /><span className="min-w-0 flex-1 truncate text-sm">{name || t(BLOCK_LABELS[block.type])}</span><button className="btn h-8 px-2 text-xs" onClick={() => onPickAsset(kind)}>{name ? t('Reemplazar') : t('Elegir archivo')}</button></div><MediaPreview block={block} /></div>;
  }
  if (block.type === 'bookmark') return <div className="grid gap-1 sm:grid-cols-[1fr_2fr]"><input aria-label={t('Título')} className="input h-9 text-sm" value={String(content.title ?? '')} placeholder={t('Título')} onChange={(event) => onContent({ title: event.target.value })} /><input aria-label="URL" className="input h-9 text-sm" type="url" value={String(content.url ?? '')} placeholder="https://" onChange={(event) => onContent({ url: event.target.value })} /></div>;
  if (block.type === 'embed') return <textarea aria-label={t('Contenido incrustado')} className="min-h-16 w-full resize-y rounded-lg border border-neutral-200 bg-transparent p-2 font-mono text-xs outline-none dark:border-neutral-800" value={String(content.html ?? content.url ?? '')} placeholder={t('Pega una URL o código de inserción seguro')} onChange={(event) => onContent({ html: event.target.value })} />;
  if (block.type === 'subpage' || block.type === 'mention') return <div className="grid gap-1 sm:grid-cols-[1fr_1fr_auto]"><input aria-label={t('Etiqueta')} className="input h-9 text-sm" value={String(content.title ?? content.label ?? '')} placeholder={t('Etiqueta')} onChange={(event) => onContent(block.type === 'subpage' ? { title: event.target.value } : { label: event.target.value })} /><input aria-label={t('ID de página')} className="input h-9 text-sm" value={String(content.pageId ?? '')} placeholder={t('ID de página')} onChange={(event) => onContent({ pageId: event.target.value })} /><button type="button" className="btn h-9 px-3 text-xs" disabled={!content.pageId} onClick={() => onNavigatePage?.(String(content.pageId ?? ''))}>{t('Abrir')}</button></div>;
  if (block.type === 'synced_block') return <div className="space-y-2"><input aria-label={t('ID del bloque original')} className="input h-9 w-full text-sm" value={String(content.sourceBlockId ?? '')} placeholder={t('ID del bloque original')} onChange={(event) => onContent({ sourceBlockId: event.target.value })} /><SyncedBlockPreview blockId={String(content.sourceBlockId ?? '')} onNavigatePage={onNavigatePage} /></div>;
  if (block.type === 'database_view') return <LinkedDatabaseViewBlock content={content} onContent={onContent} onNavigatePage={onNavigatePage} />;
  if (block.type === 'markdown') return <textarea aria-label={t('Markdown conservado sin pérdida')} className="min-h-28 w-full resize-y rounded-lg border border-amber-300 bg-amber-50/50 p-3 font-mono text-xs outline-none dark:border-amber-900 dark:bg-amber-950/20" value={String(content.markdown ?? '')} placeholder={t('Markdown conservado sin pérdida')} onChange={(event) => onContent({ markdown: event.target.value })} />;
  return textArea();
}

function SyncedBlockPreview({ blockId, onNavigatePage }: { blockId: string; onNavigatePage?: (pageId: string) => void }) {
  const [source, setSource] = useState<Awaited<ReturnType<typeof window.nodus.getSyncedBlockSource>>>(null);
  useEffect(() => {
    let active = true;
    if (!blockId) { setSource(null); return; }
    void window.nodus.getSyncedBlockSource(blockId).then((value) => { if (active) setSource(value); });
    return () => { active = false; };
  }, [blockId]);
  if (!blockId) return null;
  if (!source) return <div role="status" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{t('El bloque original no existe.')}</div>;
  return (
    <button type="button" className="w-full rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-left dark:border-indigo-900 dark:bg-indigo-950/20" onClick={() => onNavigatePage?.(source.page.id)}>
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">{t('Sincronizado desde')} {source.page.icon ?? '📄'} {source.page.title}</span>
      <span className="mt-1 block text-sm text-neutral-800 dark:text-neutral-100">{pageBlockNormalizedText(source.block.type, source.block.content) || t('Bloque sin texto')}</span>
    </button>
  );
}
