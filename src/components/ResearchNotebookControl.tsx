import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ResearchCorpusCollection, ResearchNotebook, ResearchPreparationInventory, ResearchSourceReference } from '@shared/researchCorpus';
import { notebookPreparationStatus } from '@shared/researchCorpus';
import { CollectionSourceIcon } from './CollectionSourceIcon';
import { Icon } from './ui';
import { t, tx } from '../i18n';

/** The vault's research notebooks (academic vaults only) and a way to refresh them. */
export function useResearchNotebooks(enabled = true) {
  const [academic, setAcademic] = useState(false);
  const [notebooks, setNotebooks] = useState<ResearchNotebook[]>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(() => window.nodus.listResearchNotebooks().then(setNotebooks).catch(reason => setError(String(reason))), []);
  useEffect(() => {
    let active = true;
    if (enabled) void window.nodus.getActiveVault().then(vault => { if (active) { setAcademic(vault.type === 'academic'); if (vault.type === 'academic') void refresh(); } });
    return () => { active = false; };
  }, [enabled, refresh]);
  return { available: enabled && academic, notebooks, refresh, error };
}

/** Notebook picker with edit and create (Deep Research's toolbar). */
export function ResearchNotebookControl({ value, onChange }: { value?: string | null; onChange: (id: string | null) => void }) {
  const { available, notebooks, refresh, error } = useResearchNotebooks();
  const [editing, setEditing] = useState<ResearchNotebook | 'new' | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!available) return null;
  const selected = notebooks.find(notebook => notebook.id === value);
  const close = () => { setEditing(null); trigger.current?.focus(); };
  return <div className="flex items-center gap-1" data-testid="research-notebooks">
    <select aria-label={t('Cuaderno de investigación')} className="input min-w-0 max-w-48 text-xs" value={value ?? ''} onChange={event => onChange(event.target.value || null)}>
      <option value="">{t('Chat general')}</option>
      {notebooks.map(notebook => <option key={notebook.id} value={notebook.id}>{notebook.name}</option>)}
    </select>
    <button ref={trigger} type="button" className="btn btn-ghost text-xs" onClick={() => setEditing(selected ?? 'new')}>{selected ? t('Editar') : t('Nuevo cuaderno')}</button>
    {selected && <button type="button" className="btn btn-ghost text-xs" aria-label={t('Nuevo cuaderno')} onClick={() => setEditing('new')}>+</button>}
    {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
    {editing && <NotebookDialog notebook={editing === 'new' ? null : editing} onClose={close} onSaved={async id => { await refresh(); onChange(id); close(); }} />}
  </div>;
}

const referenceKey = (source: ResearchSourceReference) => JSON.stringify([source.kind, source.id, source.libraryType, source.libraryId]);
const collectionKind = (kind: ResearchSourceReference['kind']) => kind === 'library-collection' || kind === 'zotero-collection';
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

interface CollectionNode { key: string; collection: ResearchCorpusCollection; origin: 'nodus' | 'zotero'; parent: string | null; children: string[]; documents: Set<string> }

/** The corpus collections as a tree: Nodus first, then Zotero, alphabetical at each level. */
export function collectionTree(collections: ResearchCorpusCollection[]): { nodes: Map<string, CollectionNode>; roots: string[] } {
  const nodes = new Map<string, CollectionNode>();
  const byIdentity = new Map<string, string>();
  const identity = (reference: ResearchSourceReference, id: string) => JSON.stringify([reference.kind, reference.libraryType, reference.libraryId, id]);
  for (const collection of collections) {
    const key = referenceKey(collection.reference);
    nodes.set(key, { key, collection, origin: collection.origin ?? (collection.reference.kind === 'zotero-collection' ? 'zotero' : 'nodus'), parent: null, children: [], documents: new Set(collection.documentIds) });
    byIdentity.set(identity(collection.reference, collection.reference.id), key);
  }
  for (const node of nodes.values()) {
    const parent = node.collection.parentId ? byIdentity.get(identity(node.collection.reference, node.collection.parentId)) : undefined;
    if (parent && parent !== node.key) { node.parent = parent; nodes.get(parent)!.children.push(node.key); }
  }
  // Documents of a folder include its subfolders', counted once.
  const gather = (key: string, seen = new Set<string>()): Set<string> => {
    const node = nodes.get(key)!;
    if (seen.has(key)) return node.documents;
    seen.add(key);
    for (const child of node.children) for (const id of gather(child, seen)) node.documents.add(id);
    return node.documents;
  };
  const order = (a: string, b: string) => {
    const left = nodes.get(a)!, right = nodes.get(b)!;
    return (left.origin === right.origin ? 0 : left.origin === 'nodus' ? -1 : 1) || left.collection.name.localeCompare(right.collection.name, undefined, { sensitivity: 'base', numeric: true });
  };
  for (const node of nodes.values()) node.children.sort(order);
  const roots = [...nodes.values()].filter(node => !node.parent).map(node => node.key).sort(order);
  for (const root of roots) gather(root);
  return { nodes, roots };
}

/**
 * A notebook is a name and the collections it reads: Nodus or Zotero folders, each with
 * everything below it. What they hold and is not indexed yet is queued on saving; how the
 * assistant answers (prompt, effort) is chosen in each conversation, like any other chat.
 */
export function NotebookDialog({ notebook, onClose, onSaved }: { notebook: ResearchNotebook | null; onClose: () => void; onSaved: (id: string | null) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(notebook?.name ?? '');
  const [selected, setSelected] = useState<Set<string>>(() => new Set((notebook?.sources ?? []).filter(source => collectionKind(source.kind)).map(referenceKey)));
  const [collections, setCollections] = useState<ResearchCorpusCollection[] | null>(null);
  const [inventory, setInventory] = useState<ResearchPreparationInventory | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accent, setAccent] = useState('var(--a-500)');
  const looseSources = (notebook?.sources ?? []).some(source => !collectionKind(source.kind));
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    nameRef.current?.focus();
    const surface = document.querySelector('.research-chat-surface');
    if (surface) setAccent(getComputedStyle(surface).getPropertyValue('--vault-accent').trim() || 'var(--a-500)');
    return () => element?.close();
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([window.nodus.getResearchCorpusSources(), window.nodus.getResearchPreparationInventory()]).then(([sources, preparation]) => {
      if (active) { setCollections(sources.collections); setInventory(preparation); }
    }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);
  const tree = useMemo(() => collectionTree(collections ?? []), [collections]);
  const ancestors = (key: string) => { const out: string[] = []; let current = tree.nodes.get(key)?.parent ?? null; while (current) { out.push(current); current = tree.nodes.get(current)?.parent ?? null; } return out; };
  const includedBy = (key: string) => ancestors(key).find(parent => selected.has(parent)) ?? null;
  const toggle = (key: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(key)) { next.delete(key); return next; }
    // A folder brings everything below it: its own choices underneath become implied.
    const stack = [...(tree.nodes.get(key)?.children ?? [])];
    while (stack.length) { const child = stack.pop()!; next.delete(child); stack.push(...(tree.nodes.get(child)?.children ?? [])); }
    next.add(key);
    return next;
  });
  const chosen = [...selected].filter(key => tree.nodes.has(key));
  const documentIds = new Set(chosen.flatMap(key => [...tree.nodes.get(key)!.documents]));
  const indexed = inventory ? notebookPreparationStatus([...documentIds], inventory.documents, inventory.embeddingsExpected ?? false).ready : 0;
  const needle = fold(query.trim());
  const visible = useMemo(() => {
    if (!needle) return null;
    const keep = new Set<string>();
    for (const node of tree.nodes.values()) if (fold(node.collection.name).includes(needle)) { keep.add(node.key); for (const parent of ancestors(node.key)) keep.add(parent); }
    return keep;
  }, [needle, tree]);
  const save = async () => {
    setBusy(true); setError('');
    try {
      const sources = chosen.map(key => ({ ...tree.nodes.get(key)!.collection.reference, includeDescendants: true }));
      const saved = await window.nodus.saveResearchNotebook({ id: notebook?.id, name, description: '', mode: 'linked', sources, exclusions: [],
        ...(notebook?.settings ? { settings: notebook.settings } : {}), icon: notebook?.icon ?? 'notebook', color: notebook?.color ?? null });
      await onSaved(saved.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false); }
  };
  const renderNode = (key: string, depth: number): ReactNode => {
    const node = tree.nodes.get(key)!;
    if (visible && !visible.has(key)) return null;
    const parent = includedBy(key);
    const checked = selected.has(key) || !!parent;
    const open = !!visible || expanded.has(key);
    return <div key={key} role="treeitem" aria-expanded={node.children.length ? open : undefined} aria-selected={checked}>
      <div className={`research-notebook-row ${checked ? 'is-checked' : ''} ${parent ? 'is-implied' : ''}`} style={{ paddingLeft: 6 + depth * 18 }} data-testid={`notebook-collection-${node.collection.reference.id}`}>
        <button type="button" className={`research-notebook-twisty ${node.children.length ? '' : 'invisible'}`} aria-label={open ? t('Plegar') : t('Desplegar')}
          onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; })}>
          <Icon name="chevronRight" size={12} className={open ? 'rotate-90' : ''} />
        </button>
        <label className="research-notebook-pick" title={parent ? tx('Incluida en «{name}»', { name: tree.nodes.get(parent)!.collection.name }) : node.collection.name}>
          <input type="checkbox" checked={checked} disabled={!!parent || busy} onChange={() => toggle(key)} />
          <CollectionSourceIcon origin={node.origin} size={18} />
          <span className="research-notebook-name">{node.collection.name}</span>
          <span className="research-notebook-count">{node.documents.size}</span>
        </label>
      </div>
      {open && node.children.length > 0 && <div role="group">{node.children.map(child => renderNode(child, depth + 1))}</div>}
    </div>;
  };
  const title = notebook ? t('Editar cuaderno') : t('Nuevo cuaderno');
  return createPortal(<dialog ref={dialog} className="research-system-prompt-dialog research-prompt-edit-modal research-notebook-modal" aria-label={title} data-testid="research-notebook-dialog"
    style={{ '--vault-accent': accent } as CSSProperties}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="research-prompt-edit-head"><Icon name="notebook" size={18} /><div><h2 id="research-notebook-title">{title}</h2><p>{t('Elige las colecciones que leerá. Cada una incluye sus subcolecciones.')}</p></div></header>
    <form className="research-prompt-edit-body" id="research-notebook-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="research-prompt-field">{t('Nombre')}<input ref={nameRef} className="input" required maxLength={160} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder={t('Por ejemplo: Tesis, capítulo 2')} /></label>
      {looseSources && <p role="status" className="research-notebook-note">{t('Este cuaderno tenía documentos sueltos. Al guardar se conservarán solo sus colecciones.')}</p>}
      <div className="research-notebook-collections">
        <div className="research-notebook-collections-head"><span>{t('Colecciones')}</span>
          <label className="header-balloon-search"><Icon name="search" size={14} /><input type="search" aria-label={t('Buscar colecciones')} placeholder={t('Buscar colecciones')} value={query} onChange={event => setQuery(event.target.value)} /></label></div>
        {/* A tree holds tree items only; loading and empty states sit in its frame instead. */}
        {collections === null && !error && <p role="status" className="research-notebook-tree research-notebook-empty">{t('Cargando...')}</p>}
        {collections && !tree.roots.length && <p className="research-notebook-tree research-notebook-empty">{t('Aún no hay colecciones. Crea una en la Biblioteca o sincroniza las de Zotero.')}</p>}
        {visible && !visible.size && <p className="research-notebook-tree research-notebook-empty">{t('Ninguna colección coincide.')}</p>}
        {tree.roots.length > 0 && (!visible || visible.size > 0) && <div className="research-notebook-tree" role="tree" aria-label={t('Colecciones')} aria-multiselectable="true">
          {tree.roots.map(root => renderNode(root, 0))}
        </div>}
      </div>
      <p role="status" className="research-notebook-summary" data-testid="research-notebook-summary">{chosen.length
        ? tx('{n} documentos · {m} ya indexados; el resto se indexará al guardar.', { n: documentIds.size, m: indexed })
        : t('Elige al menos una colección.')}</p>
      {error && <p className="research-prompt-error" role="alert">{error}</p>}
    </form>
    <footer className="research-prompt-footer research-prompt-edit-foot">
      <span />
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('Cancelar')}</button>
      <button type="submit" form="research-notebook-form" className="btn btn-primary" disabled={busy || !name.trim() || !chosen.length}>{busy ? t('Guardando…') : notebook ? t('Guardar') : t('Crear cuaderno')}</button>
    </footer>
  </dialog>, document.body);
}
