// Nodus Presenter — the library workspace (F0). Imports PDFs and converts externally
// authored presentations to the same internal PDF representation in a global Toolkit
// shelf and lets you organise them with folders, search, sort, rename, download
// and delete, with a lazy thumbnail grid for the selected deck. Presenting, notes and
// the mobile remote arrive in later phases; the model + reducers are pure
// (@shared/presenterTypes) and the thumbnail engine is memory-bounded
// (src/lib/presenter/thumbSession) so even a several-hundred-page deck stays light.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from '../components/ui';
import { ToolkitAppHero } from '../components/ToolkitAppHero';
import { FloatingMenu, RenameField } from '../components/ResearchChatHistoryMenu';
import { FittedSlideRenderer } from '../lib/presenter/renderSlide';
import { confirm } from '../components/feedback';
import { t, tx } from '../i18n';
import {
  addFolder,
  assignFolder,
  folderPath,
  noteCount,
  queryPresentations,
  removePresentation,
  updateFolder,
  renamePresentation,
  upsertPresentation,
  videoCount,
  type Presentation,
  type PresenterLibrary,
  type PresenterSortMode,
  type PresenterFolder,
  type PresenterFolderDeleteMode,
} from '@shared/presenterTypes';
import { loadPresenterPdf } from '../lib/presenter/pdf';
import { createThumbSession, type ThumbSession } from '../lib/presenter/thumbSession';
import { PRESENTER_DRAG_TYPE } from '../lib/presenter/drag';
import { PresenterNotesModal } from './ToolkitPresenterNotes';
import { PresenterVideoModal } from './ToolkitPresenterVideo';
import { PresenterFolderNavigation, PresenterFolderEditor, PresenterFolderDeleteDialog, PresenterMoveDialog } from './ToolkitPresenterFolders';
import './toolkitPresenter.css';

const SORT_OPTIONS: { value: PresenterSortMode; label: string }[] = [
  { value: 'recent-added', label: 'Añadido recientemente' },
  { value: 'recent-opened', label: 'Abierto recientemente' },
  { value: 'name-asc', label: 'Nombre (A→Z)' },
  { value: 'name-desc', label: 'Nombre (Z→A)' },
];

function makeFolderId(): string {
  return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function ToolkitPresenterView({ onBack }: { onBack: () => void }) {
  const [library, setLibrary] = useState<PresenterLibrary>({ presentations: [], folders: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<PresenterSortMode>('recent-added');
  const [folderEditor, setFolderEditor] = useState<{ folder?: PresenterFolder; parentId: string | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Presentation | null>(null);
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<PresenterFolder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [videoSlide, setVideoSlide] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [slideSearch, setSlideSearch] = useState('');
  const [onlyNotes, setOnlyNotes] = useState(false);
  const [slideLayout, setSlideLayout] = useState<'grid' | 'list'>('grid');
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [matchingSlides, setMatchingSlides] = useState(0);
  const coverCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const coverContainerRef = useRef<HTMLDivElement | null>(null);
  const coverRendererRef = useRef<FittedSlideRenderer | null>(null);
  const coverReadyRef = useRef(false);

  // The live pdfjs doc for the selected deck (one at a time — destroyed on change).
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);
  const thumbSessionRef = useRef<ThumbSession | null>(null);

  const selected = useMemo(
    () => library.presentations.find((p) => p.id === selectedId) ?? null,
    [library.presentations, selectedId],
  );
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const filterRef = useRef({ slideSearch, onlyNotes });
  filterRef.current = { slideSearch, onlyNotes };

  const refreshThumbs = useCallback(() => {
    const presentation = selectedRef.current;
    if (!presentation || !gridRef.current) return;
    const { slideSearch: query, onlyNotes: notesOnly } = filterRef.current;
    const folded = query.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    let count = 0;
    gridRef.current.querySelectorAll<HTMLElement>('[data-page]').forEach((tile) => {
      const page = Number(tile.dataset.page);
      const note = presentation.notes?.[String(page)] ?? '';
      const hasNotes = Boolean(note.trim());
      const hasVideo = Boolean(presentation.videos?.[String(page)]);
      tile.querySelector<HTMLElement>('[data-note-badge]')!.hidden = !hasNotes;
      tile.querySelector<HTMLElement>('[data-video-badge]')!.hidden = !hasVideo;
      const matchesQuery = !folded || (/^\d+$/.test(folded) ? page === Number(folded) : note.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(folded));
      const matches = (!notesOnly || hasNotes) && matchesQuery;
      tile.style.display = matches ? '' : 'none';
      if (matches) count++;
    });
    setMatchingSlides(count);
  }, []);

  useEffect(() => { refreshThumbs(); }, [refreshThumbs, slideSearch, onlyNotes, selected?.notes, selected?.videos]);

  useEffect(() => {
    setSlideSearch('');
    setOnlyNotes(false);
    setMenuAnchor(null);
  }, [selectedId]);

  const visible = useMemo(
    () => queryPresentations(library, { folderId: currentFolderId, recursive: Boolean(search.trim()), search, sort }),
    [library, currentFolderId, search, sort],
  );
  const currentFolder = library.folders.find(f => f.id === currentFolderId);
  const selectedFolder = library.folders.find(f => f.id === selected?.folderId);
  const breadcrumbs = folderPath(library, currentFolderId);
  const movingPresentation = library.presentations.find(p => p.id === movingId);
  useEffect(() => {
    if (currentFolderId && !library.folders.some(f => f.id === currentFolderId)) setCurrentFolderId(null);
    if (!visible.some(p => p.id === selectedId)) setSelectedId(visible[0]?.id ?? null);
  }, [visible, selectedId, currentFolderId, library.folders]);

  // ── Persistence ────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    void window.nodus.getPresenterLibrary().then((lib) => {
      if (alive) {
        setLibrary(lib);
        setSelectedId(lib.presentations.find(p => !p.folderId)?.id ?? null);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const commit = useCallback((next: PresenterLibrary) => {
    setLibrary(next);
    void window.nodus.savePresenterLibrary(next);
  }, []);

  // Stable (functional-update) persist for the notes editor, so re-renders while
  // it is open never swap its onChange identity.
  const handleNotesChange = useCallback((next: Presentation) => {
    setLibrary((lib) => {
      const merged = upsertPresentation(lib, next);
      void window.nodus.savePresenterLibrary(merged);
      return merged;
    });
  }, []);

  // ── Thumbnails for the selected deck ─────────────────────────────────────────
  useEffect(() => {
    // Tear down any previous session + doc first — never keep two decks live.
    thumbSessionRef.current?.destroy();
    thumbSessionRef.current = null;
    coverReadyRef.current = false;
    const prevDoc = pdfDocRef.current;
    pdfDocRef.current = null;
    if (prevDoc) void prevDoc.destroy();

    if (!selected) return;
    let cancelled = false;

    void (async () => {
      const doc = await loadPresenterPdf(selected.id);
      if (cancelled || !doc) {
        if (doc) void doc.destroy();
        return;
      }
      pdfDocRef.current = doc;
      if (coverCanvasRef.current && coverContainerRef.current) {
        const canvas = coverCanvasRef.current;
        coverRendererRef.current = new FittedSlideRenderer(canvas, coverContainerRef.current, 1);
        await coverRendererRef.current.render(doc, 1);
        if (cancelled) return;
        coverReadyRef.current = true;
        const src = canvas.toDataURL('image/jpeg', 0.75);
        setCovers(previous => Object.fromEntries([...Object.entries(previous).filter(([id]) => id !== selected.id).slice(-9), [selected.id, src]]));
      }

      // Persist the page count the first time we learn it (drives the list meta).
      if (doc.numPages !== selected.totalPages) {
        setLibrary(current => {
          const presentation = current.presentations.find(p => p.id === selected.id);
          if (!presentation) return current;
          const next = upsertPresentation(current, { ...presentation, totalPages: doc.numPages });
          void window.nodus.savePresenterLibrary(next);
          return next;
        });
      }

      const firstPage = await doc.getPage(1);
      const vp = firstPage.getViewport({ scale: 1 });
      const aspect = vp.width / vp.height;
      firstPage.cleanup?.();
      if (cancelled || !gridRef.current) return;

      thumbSessionRef.current = createThumbSession({
        container: gridRef.current,
        scrollRoot: gridScrollRef.current,
        doc,
        pageCount: doc.numPages,
        scale: 0.5,
        fallbackAspect: aspect,
        buildItem: (pageNum) => buildThumbTile(pageNum, selected, () => setVideoSlide(pageNum)),
      });
      refreshThumbs();
    })();

    return () => {
      cancelled = true;
    };
    // Re-run when the selected deck changes; `library`/`commit` are stable enough
    // that keying on the id avoids rebuilding thumbnails on unrelated edits.
  }, [selectedId]);

  useEffect(() => {
    const container = coverContainerRef.current;
    if (!container) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (coverReadyRef.current && pdfDocRef.current) void coverRendererRef.current?.render(pdfDocRef.current, 1);
      });
    });
    observer.observe(container);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [selectedId]);

  // Destroy the live doc when the whole view unmounts.
  useEffect(
    () => () => {
      thumbSessionRef.current?.destroy();
      void pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
    },
    [],
  );

  // ── Actions ──────────────────────────────────────────────────────────────────
  const selectPresentation = useCallback(
    (id: string) => {
      setSelectedId(id);
      const p = library.presentations.find((x) => x.id === id);
      if (p) commit(upsertPresentation(library, { ...p, lastOpenedAt: new Date().toISOString() }));
    },
    [library, commit],
  );

  const importPresentation = useCallback(async () => {
    const selection = await window.nodus.pickPresenterImport();
    if (!selection) return;

    if (selection.needsConversion) {
      const proceed = await confirm({
        title: t('Convertir presentación a PDF'),
        message: t('Para ofrecer una presentación fluida y estable, Nodus convertirá este archivo a PDF antes de importarlo. Las animaciones, transiciones y otros elementos interactivos no se conservarán. El archivo original no se modificará. ¿Quieres continuar?'),
        confirmLabel: t('Convertir e importar'),
      });
      if (!proceed) return;
    }

    setImporting(true);
    try {
      const result = await window.nodus.importPresenterFile(selection.token);
      if (!result.ok) {
        if (result.code === 'no-converter') {
          setNotice({
            title: t('No hay una aplicación compatible'),
            body: t('Nodus no encontró PowerPoint, Keynote ni LibreOffice en este equipo. Instala LibreOffice o exporta la presentación a PDF desde la aplicación con la que la creaste.'),
          });
        } else if (result.code === 'unsupported-format') {
          setNotice({
            title: t('Formato no compatible'),
            body: t('Selecciona un archivo PDF, PowerPoint, OpenDocument Presentation o Keynote compatible.'),
          });
        } else {
          setNotice({
            title: t('No se pudo importar la presentación'),
            body: t('Nodus no pudo convertir este archivo. Prueba a abrirlo en la aplicación con la que lo creaste y expórtalo a PDF.'),
          });
        }
        return;
      }
      const created = result.presentation;
      const fresh = await window.nodus.getPresenterLibrary();
      const next = assignFolder(fresh, created.id, currentFolderId);
      commit(next);
      setSearch('');
      setSelectedId(created.id);
    } finally {
      setImporting(false);
    }
  }, [currentFolderId, commit]);

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    void window.nodus.deletePresenterPresentation(id);
    setLibrary((lib) => removePresentation(lib, id));
    if (selectedId === id) setSelectedId(null);
    setPendingDelete(null);
  }, [pendingDelete, selectedId]);

  const navigateFolder = (id: string | null) => { setCurrentFolderId(id); setSearch(''); setRenamingId(null); };
  const movePresentation = (id: string, folderId: string | null) => {
    const presentation = library.presentations.find(p => p.id === id);
    if (!presentation || (folderId && !library.folders.some(f => f.id === folderId))) return;
    if ((presentation.folderId || null) === folderId) return;
    commit(assignFolder(library, id, folderId));
    setMovingId(null);
    navigateFolder(folderId);
    setSelectedId(id);
  };
  const saveFolder = (draft: Pick<PresenterFolder, 'name' | 'icon' | 'color' | 'parentId'>) => {
    if (!folderEditor) return;
    commit(folderEditor.folder ? updateFolder(library, folderEditor.folder.id, draft) : addFolder(library, { ...draft, id: makeFolderId(), createdAt: new Date().toISOString() }));
    setFolderEditor(null);
  };
  const confirmDeleteFolder = async (mode: PresenterFolderDeleteMode) => {
    if (!pendingDeleteFolder || deletingFolder) return;
    setDeletingFolder(true);
    try {
      const next = await window.nodus.deletePresenterFolder(pendingDeleteFolder.id, mode);
      setLibrary(next);
      if (currentFolderId && !next.folders.some(f => f.id === currentFolderId)) navigateFolder(null);
      setPendingDeleteFolder(null);
    } catch {
      setNotice({ title: t('Error'), body: t('No se pudo eliminar la carpeta.') });
    } finally { setDeletingFolder(false); }
  };

  const downloadPdf = useCallback(async () => {
    if (!selected) return;
    setDownloading(true);
    try {
      // Cancelling the native dialog is not a failure, so only a real problem
      // raises a notice.
      const result = await window.nodus.downloadPresenterPdf(selected.id, selected.name);
      if (result === 'missing') {
        setNotice({ title: t('Error'), body: t('No se pudo descargar la presentación.') });
      }
    } catch {
      setNotice({ title: t('Error'), body: t('No se pudo descargar la presentación.') });
    } finally {
      setDownloading(false);
    }
  }, [selected]);

  const commitRename = useCallback(
    (id: string, name: string | null) => {
      setRenamingId(null);
      if (name?.trim()) commit(renamePresentation(library, id, name));
    },
    [library, commit],
  );

  const openNotes = useCallback(() => {
    if (pdfDocRef.current) setNotesOpen(true);
  }, []);

  const importNotes = useCallback(async () => {
    if (!selected) return;
    const result = await window.nodus.importPresenterPptxNotes();
    if (!result) return;
    if (result.totalSlides !== selected.totalPages) {
      setNotice({
        title: t('El número de diapositivas no coincide'),
        body: tx('El PowerPoint tiene {pptx} diapositivas y el PDF tiene {pdf}. Deben coincidir para importar las notas.', {
          pptx: result.totalSlides,
          pdf: selected.totalPages,
        }),
      });
      return;
    }
    commit(upsertPresentation(library, { ...selected, notes: result.notes }));
    setNotice({
      title: t('Notas importadas'),
      body: tx('Se importaron notas para {n} diapositivas.', { n: Object.keys(result.notes).length }),
    });
  }, [selected, library, commit]);

  const exportTxtNotes = useCallback(async () => {
    if (!selected) return;
    try {
      await window.nodus.exportPresenterNotesTxt(selected);
    } catch {
      setNotice({ title: t('Error'), body: t('No se pudieron exportar las notas a TXT.') });
    }
  }, [selected]);

  const importTxtNotes = useCallback(async () => {
    if (!selected) return;
    try {
      const result = await window.nodus.importPresenterNotesTxt();
      if (!result) return;
      if (result.totalSlides !== selected.totalPages) {
        setNotice({
          title: t('El número de diapositivas no coincide'),
          body: tx('El TXT tiene {txt} diapositivas y el PDF tiene {pdf}. Deben coincidir para importar las notas.', {
            txt: result.totalSlides,
            pdf: selected.totalPages,
          }),
        });
        return;
      }
      commit(upsertPresentation(library, { ...selected, notes: result.notes }));
      setNotice({
        title: t('Notas importadas'),
        body: tx('Se importaron notas para {n} diapositivas.', { n: Object.keys(result.notes).length }),
      });
    } catch {
      setNotice({ title: t('Error'), body: t('El archivo TXT de notas no tiene un formato válido.') });
    }
  }, [selected, library, commit]);

  return (
    <div className="presenter-workspace" data-testid="presenter-workspace">
      <ToolkitAppHero
        compact
        badge="Nodus Toolkit"
        title="Nodus Presenter"
        description={t('Organiza tus diapositivas. Comparte tus ideas.')}
        icon="presentation"
        actionLabel={importing ? t('Importando…') : t('Importar PDF o presentación')}
        actionIcon="plus"
        onAction={importPresentation}
        onBack={onBack}
        heroTestId="toolkit-presenter-hero"
        actionTestId="presenter-import"
        backTestId="presenter-back"
        actionDisabled={importing}
        actionBusy={importing}
      />

      <div className="presenter-library-layout">
        <aside className="presenter-library-rail">
          <div className="presenter-section-heading">
            <h2>{t('Biblioteca')}</h2>
            <button type="button" title={t('Nueva carpeta')} aria-label={t('Nueva carpeta')} onClick={() => setFolderEditor({ parentId: currentFolderId })} data-testid="presenter-new-folder" className="presenter-icon-button">
              <Icon name="folderPlus" size={17} />
            </button>
          </div>
          <label className="presenter-search">
            <Icon name="search" size={16} />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Buscar presentaciones…')} aria-label={t('Buscar presentaciones…')} />
          </label>
          <select value={sort} aria-label={t('Ordenar por')} onChange={(e) => setSort(e.target.value as PresenterSortMode)} className="presenter-select">
            {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
          </select>
          <PresenterFolderNavigation library={library} currentId={currentFolderId} onNavigate={navigateFolder} onCreate={parentId => setFolderEditor({ parentId })} onEdit={folder => setFolderEditor({ folder, parentId: folder.parentId })} onDelete={setPendingDeleteFolder} onMove={movePresentation} />
          <div className="presenter-library-list">
            {visible.length === 0 ? (
              <div className="presenter-empty">
                <Icon name="presentation" size={32} />
                <p>{search ? t('Sin resultados') : t('Esta carpeta está vacía')}</p>
                <span>{search ? t('Prueba con otra búsqueda') : t('Importa un PDF o una presentación para empezar')}</span>
              </div>
            ) : (
              <ul>
                {visible.map((presentation) => (
                  <li key={presentation.id}>
                    <PresentationRow presentation={presentation} coverSrc={covers[presentation.id]} active={presentation.id === selectedId} renaming={renamingId === presentation.id} location={search.trim() ? folderPath(library, presentation.folderId ?? null).map(folder => folder.name).join(' / ') || t('Biblioteca principal') : undefined} onSelect={() => selectPresentation(presentation.id)} onStartRename={() => setRenamingId(presentation.id)} onCommitRename={(name) => commitRename(presentation.id, name)} onMove={() => setMovingId(presentation.id)} onDelete={() => setPendingDelete(presentation)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <div ref={gridScrollRef} className="presenter-detail">
          <nav className="presenter-folder-breadcrumbs" aria-label={t('Ruta de carpetas')}>
            <button type="button" onClick={() => navigateFolder(null)} aria-current={currentFolderId === null ? 'page' : undefined}><Icon name="home" size={14} />{t('Biblioteca principal')}</button>
            {breadcrumbs.map(folder => <span key={folder.id}><Icon name="chevronRight" size={12} /><button type="button" onClick={() => navigateFolder(folder.id)} aria-current={folder.id === currentFolderId ? 'page' : undefined}>{folder.name}</button></span>)}
          </nav>
          {selected ? (
            <>
              <section className="presenter-feature">
                <div ref={coverContainerRef} key={selected.id} className="presenter-cover">
                  <canvas ref={coverCanvasRef} className="block max-w-none" aria-label={selected.name} />
                </div>
                <div className="presenter-feature-info">
                  <label className="presenter-deck-folder" title={t('Mover a carpeta')}>
                    <span style={{ color: selectedFolder?.color }}><Icon name={selectedFolder?.icon ?? 'folder'} size={15} /></span>
                    <select value={selected.folderId ?? ''} onChange={event => movePresentation(selected.id, event.target.value || null)} aria-label={t('Mover a carpeta')} data-testid="presenter-folder-select">
                      <option value="">{t('Biblioteca principal')}</option>
                      {library.folders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(library, folder.id).map(f => f.name).join(' / ')}</option>)}
                    </select>
                  </label>
                  <h2 className="presenter-deck-title">{selected.name}</h2>
                  <p className="presenter-deck-meta">
                    {selected.totalPages ? tx('{n} diapositivas', { n: selected.totalPages }) : t('Cargando…')}
                    {noteCount(selected) > 0 ? ` · ${tx('{n} con notas', { n: noteCount(selected) })}` : ''}
                    {videoCount(selected) > 0 ? ` · ${tx('{n} con vídeo', { n: videoCount(selected) })}` : ''}
                  </p>
                  <div className="presenter-primary-actions">
                    <button type="button" onClick={() => window.nodus.startPresenter(selected.id)} disabled={!selected.totalPages} data-testid="presenter-present" className="presenter-action presenter-action-amber">
                      <Icon name="play" size={18} /><span>{t('Presentar')}</span>
                    </button>
                    <button type="button" onClick={() => window.nodus.startPresenterMode(selected.id)} disabled={!selected.totalPages} data-testid="presenter-mode" className="presenter-action presenter-action-violet">
                      <Icon name="presentation" size={18} /><span>{t('Modo presentador')}</span>
                    </button>
                  </div>
                  <div className="presenter-secondary-actions">
                    <button type="button" onClick={downloadPdf} disabled={downloading} data-testid="presenter-download-pdf" className="presenter-action">
                      <Icon name="download" size={18} /><span>{t('Descargar PDF')}</span>
                    </button>
                    <button type="button" onClick={openNotes} disabled={!selected.totalPages} data-testid="presenter-open-notes" className="presenter-action">
                      <Icon name="edit" size={18} /><span>{t('Notas del presentador')}</span>
                    </button>
                    <button type="button" title={t('Más opciones')} aria-label={t('Más opciones')} aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)} onClick={(event) => setMenuAnchor(menuAnchor ? null : event.currentTarget.getBoundingClientRect())} className="presenter-icon-button" data-testid="presenter-more">
                      <Icon name="moreVertical" size={18} />
                    </button>
                  </div>
                </div>
              </section>

              <section className="presenter-slide-section">
                <div className="presenter-slides-heading">
                  <h3>{t('Diapositivas')}</h3>
                  <span className="presenter-result-count" aria-live="polite">{matchingSlides} / {selected.totalPages || '…'}</span>
                </div>
                <div className="presenter-slide-controls">
                  <div className="presenter-segmented">
                    <button type="button" aria-pressed={!onlyNotes} onClick={() => setOnlyNotes(false)}>{t('Todas')} <span>{selected.totalPages}</span></button>
                    <button type="button" aria-pressed={onlyNotes} onClick={() => setOnlyNotes(true)}>{t('Notas')} <span>{noteCount(selected)}</span></button>
                  </div>
                  <label className="presenter-search presenter-slide-search">
                    <Icon name="search" size={15} />
                    <input type="search" value={slideSearch} onChange={(event) => setSlideSearch(event.target.value)} placeholder={t('Buscar por número o notas…')} aria-label={t('Buscar por número o notas…')} />
                  </label>
                  <div className="presenter-view-toggle">
                    {(['grid', 'list'] as const).map((layout) => (
                      <button key={layout} type="button" title={layout === 'grid' ? t('Vista de cuadrícula') : t('Vista de lista')} aria-label={layout === 'grid' ? t('Vista de cuadrícula') : t('Vista de lista')} aria-pressed={slideLayout === layout} onClick={() => setSlideLayout(layout)} className="presenter-icon-button">
                        <Icon name={layout === 'grid' ? 'grid' : 'list'} size={17} />
                      </button>
                    ))}
                  </div>
                </div>
                <div ref={gridRef} data-testid="presenter-thumbs" className="presenter-slide-grid" data-layout={slideLayout} />
                {(slideSearch || onlyNotes) && matchingSlides === 0 && <p className="presenter-empty">{t('Sin resultados')}</p>}
              </section>
            </>
          ) : (
            <div className="presenter-empty presenter-empty-detail">
              <Icon name="presentation" size={40} />
              <p>{currentFolder?.name ?? t('Biblioteca principal')}</p>
              <span>{t('Elige una presentación de la lista para ver sus diapositivas, o importa un PDF o una presentación nueva.')}</span>
            </div>
          )}
        </div>
      </div>

      {menuAnchor && selected && (
        <FloatingMenu anchor={menuAnchor} label={t('Más opciones')} onClose={() => setMenuAnchor(null)}>
          <button type="button" role="menuitem" className="research-history-menu-item" disabled={!selected.totalPages} onClick={() => { setMenuAnchor(null); void importNotes(); }}>
            <Icon name="upload" size={16} /><span>{t('Importar notas (.pptx)')}</span>
          </button>
          <button type="button" role="menuitem" className="research-history-menu-item" data-testid="presenter-export-notes-txt" disabled={!selected.totalPages} onClick={() => { setMenuAnchor(null); void exportTxtNotes(); }}>
            <Icon name="download" size={16} /><span>{t('Exportar notas')} (.txt)</span>
          </button>
          <button type="button" role="menuitem" className="research-history-menu-item" data-testid="presenter-import-notes-txt" disabled={!selected.totalPages} onClick={() => { setMenuAnchor(null); void importTxtNotes(); }}>
            <Icon name="upload" size={16} /><span>{t('Importar notas (.txt)')}</span>
          </button>
        </FloatingMenu>
      )}

      {folderEditor && <PresenterFolderEditor library={library} folder={folderEditor.folder} parentId={folderEditor.parentId} onSave={saveFolder} onClose={() => setFolderEditor(null)} />}
      {pendingDeleteFolder && <PresenterFolderDeleteDialog folder={pendingDeleteFolder} library={library} busy={deletingFolder} onDelete={mode => void confirmDeleteFolder(mode)} onClose={() => setPendingDeleteFolder(null)} />}
      {movingPresentation && <PresenterMoveDialog key={movingPresentation.id} library={library} presentation={movingPresentation} onMove={folderId => movePresentation(movingPresentation.id, folderId)} onClose={() => setMovingId(null)} />}

      {/* Delete confirmation */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPendingDelete(null);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Eliminar presentación')}</h3>
            <p className="mt-1.5 text-sm text-neutral-500">
              {tx('¿Seguro que quieres eliminar «{name}»? Esta acción no se puede deshacer.', { name: pendingDelete.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingDelete(null)} className="btn btn-ghost h-9 min-h-9 px-3 text-sm">
                {t('Cancelar')}
              </button>
              <button type="button" onClick={confirmDelete} className="btn h-9 min-h-9 bg-red-600 px-3 text-sm text-white hover:bg-red-700">
                {t('Eliminar')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Speaker-notes editor */}
      {notesOpen && selected && pdfDocRef.current && (
        <PresenterNotesModal
          presentation={selected}
          pdfDoc={pdfDocRef.current}
          onChange={handleNotesChange}
          onClose={() => setNotesOpen(false)}
        />
      )}

      {/* Per-slide video editor */}
      {videoSlide != null && selected && pdfDocRef.current && (
        <PresenterVideoModal
          presentation={selected}
          pdfDoc={pdfDocRef.current}
          slide={videoSlide}
          onChange={handleNotesChange}
          onClose={() => setVideoSlide(null)}
        />
      )}

      {/* Import notice (mismatch / success) */}
      {notice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNotice(null);
          }}
        >
          <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{notice.title}</h3>
            <p className="mt-1.5 text-sm text-neutral-500">{notice.body}</p>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setNotice(null)} className="btn btn-accent h-9 min-h-9 px-3 text-sm">
                {t('Entendido')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PresentationRow({
  presentation,
  coverSrc,
  active,
  renaming,
  location,
  onSelect,
  onStartRename,
  onCommitRename,
  onMove,
  onDelete,
}: {
  presentation: Presentation;
  coverSrc?: string;
  active: boolean;
  renaming: boolean;
  location?: string;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: (name: string | null) => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  const meta = [
    presentation.totalPages ? tx('{n} diapositivas', { n: presentation.totalPages }) : t('Sin cargar'),
    noteCount(presentation) > 0 ? t('Notas') : null,
    videoCount(presentation) > 0 ? t('Vídeos') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div data-testid="presenter-row" data-presentation-id={presentation.id} className="presenter-library-row" data-active={active}>
      {renaming ? (
        <div className="presenter-row-select">
          <div className="presenter-row-cover">{coverSrc ? <img src={coverSrc} alt="" /> : <Icon name="file" size={22} />}</div>
          <div className="min-w-0 flex-1">
            <RenameField value={presentation.name} onDone={onCommitRename} />
            <div className="presenter-row-meta">{meta}</div>
          </div>
        </div>
      ) : (
        <button type="button" onClick={onSelect} className="presenter-row-select" aria-pressed={active} draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData(PRESENTER_DRAG_TYPE, presentation.id); event.dataTransfer.setData('text/plain', presentation.name); }}>
          <div className="presenter-row-cover">{coverSrc ? <img src={coverSrc} alt="" draggable={false} /> : <Icon name="file" size={22} />}</div>
          <div className="min-w-0 flex-1">
            <div className="presenter-row-title" title={presentation.name}>{presentation.name}</div>
            <div className="presenter-row-meta">{meta}</div>
            {location && <div className="presenter-row-location" title={location}><Icon name="folder" size={11} /><span>{location}</span></div>}
          </div>
        </button>
      )}
      <div className="presenter-row-actions">
        <button type="button" title={t('Más opciones')} aria-label={t('Más opciones')} aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)} data-testid="presenter-row-menu" onClick={event => setMenuAnchor(event.currentTarget.getBoundingClientRect())}><Icon name="moreVertical" size={15} /></button>
      </div>
      {menuAnchor && <FloatingMenu anchor={menuAnchor} label={t('Más opciones')} onClose={() => setMenuAnchor(null)}>
        <button type="button" role="menuitem" className="research-history-menu-item" data-testid="presenter-row-rename" onClick={() => { setMenuAnchor(null); onStartRename(); }}><Icon name="edit" size={16} /><span>{t('Renombrar')}</span></button>
        <button type="button" role="menuitem" className="research-history-menu-item" data-testid="presenter-row-move" onClick={() => { setMenuAnchor(null); onMove(); }}><Icon name="folder" size={16} /><span>{t('Mover a carpeta')}</span></button>
        <button type="button" role="menuitem" className="research-history-menu-item is-danger" data-testid="presenter-row-delete" onClick={() => { setMenuAnchor(null); onDelete(); }}><Icon name="trash" size={16} /><span>{t('Eliminar')}</span></button>
      </FloatingMenu>}
    </div>
  );
}

/** Each preview contains the whole PDF page; the footer keeps metadata off the slide. */
function buildThumbTile(pageNum: number, presentation: Presentation, onClick: () => void) {
  const element = document.createElement('button');
  element.type = 'button';
  element.title = `${tx('Diapositiva {n} de {total}', { n: pageNum, total: presentation.totalPages })}. ${t('Añadir o editar vídeo')}`;
  element.setAttribute('aria-label', element.title);
  element.addEventListener('click', onClick);
  element.className = 'presenter-slide-tile';

  const preview = document.createElement('div');
  preview.className = 'presenter-slide-preview';
  const canvas = document.createElement('canvas');
  preview.appendChild(canvas);

  const footer = document.createElement('div');
  footer.className = 'presenter-slide-caption';
  const label = document.createElement('span');
  label.textContent = `${t('Diapositiva')} ${pageNum}`;
  footer.appendChild(label);
  const badges = document.createElement('span');
  badges.className = 'presenter-slide-badges';
  for (const [kind, path, title] of [['note', 'M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4', t('Tiene notas')], ['video', 'm9 6 9 6-9 6z', t('Tiene vídeo')]]) {
    const badge = document.createElement('span');
    badge.className = 'presenter-slide-badge';
    badge.dataset[kind === 'note' ? 'noteBadge' : 'videoBadge'] = '';
    badge.title = title;
    badge.setAttribute('aria-label', title);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', '12');
    icon.setAttribute('height', '12');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.5');
    icon.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    icon.appendChild(shape);
    badge.appendChild(icon);
    badge.hidden = kind === 'note' ? !presentation.notes?.[String(pageNum)]?.trim() : !presentation.videos?.[String(pageNum)];
    badges.appendChild(badge);
  }
  footer.appendChild(badges);
  element.append(preview, footer);
  return { element, canvas };
}
