import {assertAcademicSupplement} from '@shared/academicProjection';
import {openEvidenceAtPage} from '../../evidenceJump';
import { AcademicTools, AcademicPanel, desktopAcademicSources, type AcademicToolsHandle } from './AcademicTools';
import { normalizeAcademicMetadata, type AcademicMetadata } from '@shared/academicDocument';
import { readEditorialDraft, retainEditorialDraft, clearEditorialDraft, downloadEditorialDraft } from '../workspace/editorialDrafts';
import { flushEditorialDraft } from '../workspace/flushEditorialDraft';
import { EditorialActionBar, EditorialActionMenu, type EditorialAction } from '../workspace/EditorialActions';
import { readWorkspacePreferences } from '../../app/workspacePreferences';
import { patchViewSnapshot } from '../../app/viewSnapshots';
import { EditorialHeader, EditorialTitle, EditorialInspector } from '../workspace/EditorialChrome';
import { useEditorialFocus } from '../workspace/editorialFocus';
import '../workspace/editorialWorkspace.css';
import { useStudyFocusReduced } from '../focus/StudyFocusContext';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { documentReferences, parseEditorReference } from '@shared/editorReferences';
import { EditorialReferences } from './EditorReferences';
import { BlockNoteCanvas, type BlockNoteCanvasHandle } from './BlockNoteCanvas';
import { markdownToBlockNote, nativeBlockMarkdown, type BlockNoteDocument } from '@shared/blockNoteDocument';
import TurndownService from 'turndown';
import { diffWordsWithSpace } from 'diff';
import type {
  StudyAnnotation,
  StudyBlockAnchor,
  StudyDocEditorData,
  StudyDocStyle,
  StudyDocVersion,
  StudyEditorCommand,
  StudyOutlineItem,
} from '@shared/studyEditor';
import { DEFAULT_STUDY_DOC_STYLE, studyCommandMarkdown, studyDocumentStats } from '@shared/studyEditor';
import type { StudyDocumentKind, StudyTag } from '@shared/studyOrg';
import { STUDY_DOCUMENT_KINDS } from '@shared/studyOrg';
import type { EditorDocument, EditorDocumentPort } from './documentPort';
import { studyDocumentPort } from './documentPort';
import type { StudyImproveScope, StudyStyle } from '@shared/studyImprove';
import type { StudySentenceContext, StudySynonymAlternative } from '@shared/studySynonyms';
import { studySentenceContext } from '@shared/studySynonyms';
import type { AppSettings } from '@shared/types';
import { Markdown } from '../Markdown';
import { parseTestimonyLink, type TestimonyDeepLink } from '@shared/testimonyDeepLinks';
import { ModelPicker } from '../ModelPicker';
import { Icon, Spinner } from '../ui';
import { TextInputModal } from '../TextInputModal';
import { t } from '../../i18n';
import { DocOutline } from './DocOutline';
import { StudyDictation, type StudyDictationHandle } from './StudyDictation';
import { StudyImproveDialog } from './StudyImproveDialog';
import { studyStyleDisplay } from './studyStyleLocalization';
import { ScriptorAiPanel, type AiChoice } from './ScriptorAiPanel';
import { editorReviewDiff, savedEditorImageModels, type EditorImageModel, type EditorImageResult } from '@shared/editorAiReview';
import type { StudyImproveResult } from '@shared/studyImprove';
import { AudioPanel } from '../AudioPanel';
import { ConfirmModal } from '../ConfirmModal';
import { useFeatureModel } from '../../hooks/useFeatureModel';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
const aiErrorMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');

// Match Nodi quick notes: changes feel immediate without writing once per
// keystroke, and a navigation flush below guarantees the last edit is durable.
const STUDY_AUTOSAVE_DELAY_MS = 800;

interface ImproveTarget {
  from: number;
  to: number;
  text: string;
  scope: StudyImproveScope;
  initialStyleId?: string;
  visual?: boolean;
  range?: { from: number; to: number };
}

function sameImproveTarget(previous: ImproveTarget, next: ImproveTarget) {
  // The same phrase can appear twice, so compare its positions too.
  return previous.text === next.text && previous.scope === next.scope && previous.visual === next.visual
    && previous.from === next.from && previous.to === next.to
    && previous.range?.from === next.range?.from && previous.range?.to === next.range?.to;
}

interface SynonymPanelState {
  sessionId: number;
  x: number;
  y: number;
  base: string;
  target: ImproveTarget;
  context: StudySentenceContext;
  rounds: StudySynonymAlternative[][];
  loading: boolean;
  error: string;
}

const STUDY_KIND_LABEL: Record<StudyDocumentKind, string> = {
  apunte: 'Apunte', manual: 'Manual', libro: 'Libro', articulo: 'Artículo', presentacion: 'Presentación',
  grabacion: 'Grabación', transcripcion: 'Transcripción', banco: 'Banco de preguntas', test: 'Test', examen: 'Examen',
};

interface EditorHistoryState { canUndo: boolean; canRedo: boolean }

function VersionDiff({ version, current }: { version: StudyDocVersion; current: string }) {
  const pieces = useMemo(() => diffWordsWithSpace(version.contentMarkdown, current), [version.id, current]);
  return (
    <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs leading-5">
      {pieces.map((piece, index) => (
        <span key={index} className={piece.added ? 'bg-emerald-500/20 text-emerald-200' : piece.removed ? 'bg-red-500/20 text-red-200 line-through' : 'text-neutral-500'}>
          {piece.value}
        </span>
      ))}
    </div>
  );
}

function SynonymAlternativeList({
  alternatives,
  selectedText,
  historical = false,
  onSelect,
}: {
  alternatives: StudySynonymAlternative[];
  selectedText: string;
  historical?: boolean;
  onSelect: (alternative: StudySynonymAlternative) => void;
}) {
  return <div className="space-y-1">
    {alternatives.map((alternative, index) => (
      <button
        type="button"
        key={`${alternative.from}:${alternative.to}:${alternative.replacement}:${index}`}
        data-testid={historical ? 'study-synonyms-history-option' : 'study-synonyms-option'}
        className={`study-synonym-alternative w-full rounded-lg border px-2.5 py-2 text-left transition ${historical ? 'is-historical' : ''}`}
        onClick={() => onSelect(alternative)}
      >
        <span className="block text-sm">{alternative.replacement}</span>
        {alternative.target !== selectedText && <span className="mt-0.5 block truncate text-[10px] text-neutral-500">{t('Sustituye')} «{alternative.target}»</span>}
      </button>
    ))}
  </div>;
}

/**
 * El editor de documentos de Nodus. Nació en Estudio y ahora escribe también las notas e
 * ideas del Workspace: lo que cambia entre un caso y otro es sólo la fila que se guarda,
 * y eso entra por `port` (ver documentPort.ts). Sin `port` se comporta exactamente como
 * antes, así que Estudio y Docencia no notan el cambio.
 *
 * Las propiedades propias de Estudio —tipo de material, color, etiquetas— son opcionales:
 * los controles que las editan sólo se pintan si llega su callback.
 */
export function StudyEditor({
  settings,
  documents,
  tags = [],
  activeTagIds = [],
  subjectId,
  activeId,
  port: portProp,
  showTabs = true,
  documentIcon = 'notebook',
  onActivate,
  onClose,
  onSaved,
  onUpdateMetadata,
  onSetTags,
  onCreateTag,
  onDuplicate,
  onTrash,
  onOpenLinkedDocument,
  onOpenRecording,
  onTestimonyLink, onNavigateLink,
  contextSources, contextDetails, headerContent, navigatorContent, location, pinnedActionIds: pinnedActionIdsProp, onPinnedActionsChange, contextOpen: contextOpenProp, onContextOpenChange, focusMode: focusModeProp, onFocusModeChange, onRegisterFlush,
}: {
  pinnedActionIds?: string[];
  onPinnedActionsChange?: (ids: string[]) => void;
  contextSources?: ReactNode;
  contextDetails?: ReactNode;
  headerContent?: ReactNode;
  navigatorContent?: ReactNode;
  location?: string;
  contextOpen?: boolean;
  onContextOpenChange?: (open: boolean) => void;
  focusMode?: boolean;
  onFocusModeChange?: (focus: boolean) => void;
  onRegisterFlush?: (flush: () => Promise<boolean>) => void;
  settings: AppSettings;
  documents: EditorDocument[];
  tags?: StudyTag[];
  activeTagIds?: string[];
  subjectId?: string | null;
  activeId: string;
  /** Dónde vive lo que se edita. Por defecto, los documentos de estudio. */
  port?: EditorDocumentPort;
  /** El Workspace pone sus pestañas arriba del todo, así que apaga las del editor. */
  showTabs?: boolean;
  documentIcon?: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onSaved: (document: EditorDocument) => void;
  onUpdateMetadata?: (patch: { kind?: string; color?: string; favorite?: boolean }) => Promise<void>;
  onSetTags?: (tagIds: string[]) => Promise<void>;
  onCreateTag?: (name: string) => Promise<void>;
  onDuplicate: () => Promise<void>;
  onTrash: () => Promise<void>;
  onOpenLinkedDocument: (id: string) => void;
  onOpenRecording: (id: string, timestamp?: number | null) => void;
  onTestimonyLink?: (link: TestimonyDeepLink) => void;
  onNavigateLink?: (href: string) => boolean;
}) {
  const port = portProp ?? (studyDocumentPort as EditorDocumentPort);
  const active = documents.find((document) => document.id === activeId) ?? documents[0];
  const [data, setData] = useState<StudyDocEditorData | null>(null);
  const [title, setTitle] = useState(active?.title ?? '');
  const [draft, setDraftState] = useState(active?.contentMarkdown ?? '');
  const [nativeDocument, setNativeDocument] = useState<BlockNoteDocument | null>(null);
  const [academicMetadata,setAcademicMetadata] = useState<AcademicMetadata>(()=>normalizeAcademicMetadata(null));
  const academicRef = useRef(academicMetadata);academicRef.current=academicMetadata;
  const academicTools=useRef<AcademicToolsHandle>(null);
  const nativeRef = useRef<BlockNoteDocument | null>(null);
  const revisionRef = useRef(new Map<string, number>());
  const [saveError, setSaveError] = useState('');
  const [recoveredDraft, setRecoveredDraft] = useState(false);
  const hydratedIdRef = useRef('');
  const draftScope = port.dragType;
  const rawHistory = useRef<{ undo: Array<{ before: string; after: string; beforeNative?: BlockNoteDocument | null; afterNative?: BlockNoteDocument | null; group?: string; time: number }>; redo: Array<{ before: string; after: string; beforeNative?: BlockNoteDocument | null; afterNative?: BlockNoteDocument | null; group?: string; time: number }> }>({ undo: [], redo: [] });
  const setDraft = (value: Parameters<typeof setDraftState>[0], group?: string) => {
    let recorded = false;
    setDraftState(current => {
    const next = typeof value === 'function' ? value(current) : value;
    const beforeNative = nativeRef.current;
    let native:BlockNoteDocument;try{assertAcademicSupplement(current,next);native=markdownToBlockNote(next,beforeNative);
      if (group?.startsWith('ai:') && beforeNative) {
        // Empty native paragraphs have no unambiguous Markdown projection. A
        // selected AI replacement must preserve these unrelated anchors.
        beforeNative.forEach((block, index) => {
          if (block.type !== 'paragraph' || nativeBlockMarkdown(block).trim() || block.children?.length || native.some(item => item.id === block.id)) return;
          const nextId = beforeNative.slice(index + 1).find(item => native.some(candidate => candidate.id === item.id))?.id;
          const at = nextId ? native.findIndex(item => item.id === nextId) : native.length;
          native.splice(at, 0, block);
        });
      }
    }catch(error){setSaveError(error instanceof Error?error.message:String(error));return current;}
    if (!recorded && rawRef.current && current !== next && group !== 'history') {
      recorded = true;
      const history = rawHistory.current, previous = history.undo.at(-1), time = Date.now();
      if (group && previous?.group === group && previous.after === current && (group.startsWith('dictation:') || time - previous.time < 600)) { previous.after = next; previous.afterNative = native; previous.time = time; }
      else history.undo.push({ before: current, after: next, beforeNative, afterNative: native, group, time });
      if (history.undo.length > 200) history.undo.shift();
      history.redo = [];
    }
    nativeRef.current = native; setNativeDocument(native); return next;
    });
  };
  const [style, setStyle] = useState<StudyDocStyle>(DEFAULT_STUDY_DOC_STYLE);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [raw, setRaw] = useState(false);
  const [split, setSplit] = useState(false);
  const [localFocus, setLocalFocus] = useState(false);
  const focusMode = focusModeProp ?? localFocus;
  const setFocusMode = (focus: boolean) => { if (focus) setContextOpen(false); setLocalFocus(focus); onFocusModeChange?.(focus); };
  const [localContextOpen, setLocalContextOpen] = useState(false);
  const contextOpen = contextOpenProp ?? localContextOpen;
  const setContextOpen = (open: boolean) => { setLocalContextOpen(open); onContextOpenChange?.(open); };
  const editorialFocus = useEditorialFocus(focusMode, setFocusMode);
  const [contextTab, setContextTab] = useState<'sources' | 'comments' | 'details' | 'outline' | 'history' | 'assistant' | 'checks' | 'structure'>('sources');
  const globalFocus = useStudyFocusReduced();
  const [showSearch, setShowSearch] = useState(false);
  const [showStyle, setShowStyle] = useState(false);
  const [showDictation, setShowDictation] = useState(false);
  const [dictationActive, setDictationActive] = useState(false);
  const dictationRef = useRef<StudyDictationHandle>(null);
  useEffect(() => { setShowDictation(false); setDictationActive(false); }, [active?.id]);
  const [showAudio, setShowAudio] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);
  const [audioSelection, setAudioSelection] = useState('');
  const [audioCursor, setAudioCursor] = useState(0);
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [dictionaryWord, setDictionaryWord] = useState('');
  const [textDialog, setTextDialog] = useState<{ kind: 'comment' | 'tag'; selectedText?: string; from?: number; anchor?: StudyBlockAnchor } | null>(null);
  const [showImprovePrompts, setShowImprovePrompts] = useState(false);
  const [quickImproveStyles, setQuickImproveStyles] = useState<StudyStyle[]>([]);
  const [selectionImprove, setSelectionImprove] = useState<{ x: number; y: number; target: ImproveTarget } | null>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<HTMLElement | null>(null);
  const [synonymPanel, setSynonymPanel] = useState<SynonymPanelState | null>(null);
  const [improveStreamingStyleId, setImproveStreamingStyleId] = useState<string | null>(null);
  const [improveStreamError, setImproveStreamError] = useState('');
  const [improvePreview, setImprovePreview] = useState('');
  const [lastImprovement, setLastImprovement] = useState<string | null>(null);
  const improveCancelled = useRef(false);
  const improvementRunning = useRef(false);
  const improveTargetRef = useRef<ImproveTarget | null>(null);
  const [aiPanel, setAiPanel] = useState<'polish' | 'image' | null>(null);
  const [allImproveStyles, setAllImproveStyles] = useState<StudyStyle[]>([]);
  const [aiStyleId, setAiStyleId] = useState(settings.studyImproveLastStyleId ?? 'builtin:clear');
  const [aiInstructions, setAiInstructions] = useState('');
  const [aiResult, setAiResult] = useState<StudyImproveResult | null>(null);
  const resultRef = useRef<StudyImproveResult | null>(null);
  const aiGeneration = useRef(0);
  const closeAiRef = useRef<() => void>(() => {});
  const aiSource = useRef<{ id: string; base: string; native: string; target: ImproveTarget } | null>(null);
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageModel, setImageModel] = useState<EditorImageModel>({ provider: settings.imageProvider, model: settings.imageModel });
  const [imageChoices, setImageChoices] = useState<AiChoice[]>([]);
  const [imageResult, setImageResult] = useState<EditorImageResult | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const imageRequest = useRef<string | null>(null);
  const imageSource = useRef<{ id: string; anchor?: string; raw?: { base: string; at: number } } | null>(null);
  const imageNeedsCursor = useRef(false);
  useEffect(() => () => {
    if (improvementRunning.current) { improveCancelled.current = true; void window.nodus.cancelStudyImprove(); }
  }, []);
  const [historyState, setHistoryState] = useState<EditorHistoryState>({ canUndo: false, canRedo: false });
  const [selectedVersion, setSelectedVersion] = useState<StudyDocVersion | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [aiModel, setAiModel] = useFeatureModel(settings, 'improveModel');
  const baselineRef = useRef('');
  const activeIdRef = useRef(active?.id ?? '');
  const latestSignatureRef = useRef('');
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const savedSignaturesRef = useRef(new Map<string,string>());
  const saveLatestRef = useRef<(reason: 'autosave' | 'manual' | 'command') => Promise<boolean>>(async () => true);
  const rawRef = useRef(raw);
  useEffect(() => { rawHistory.current = { undo: [], redo: [] }; }, [raw, active?.id]);
  const canvasRef = useRef<BlockNoteCanvasHandle>(null);
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
  const rawSelection = useRef<{ id: string; content: string; from: number; to: number } | null>(null);
  const rawDictation = useRef<{ id: string; from: number; to: number; text: string; prefix: string; suffix: string; document: string } | null>(null);
  const [localPins, setLocalPins] = useState<string[]>([]);
  const preferenceVault = useRef<string | null>(null);
  useEffect(() => {
    if (pinnedActionIdsProp) return;
    let alive = true;
    void window.nodus.getActiveVault().then(vault => { if (alive && vault) { preferenceVault.current = vault.id; setLocalPins(readWorkspacePreferences(vault.id).pinnedActionIds ?? []); } });
    return () => { alive = false; };
  }, [pinnedActionIdsProp]);
  const pinnedActionIds = pinnedActionIdsProp ?? localPins;
  const setPinnedActionIds = (ids: string[]) => {
    setLocalPins(ids); onPinnedActionsChange?.(ids);
    if (!onPinnedActionsChange && preferenceVault.current) patchViewSnapshot(preferenceVault.current, 'workspace', { pinnedActionIds: ids });
  };
  const preserveSelection = () => {
    if (raw && rawTextareaRef.current) rawSelection.current = { id: active.id, content: draft, from: rawTextareaRef.current.selectionStart, to: rawTextareaRef.current.selectionEnd };
    else canvasRef.current?.preserveSelection();
  };
  const restoreSelection = () => {
    const checkpoint = rawSelection.current;
    if (raw && checkpoint?.id === active.id && checkpoint.content === draft) {
      rawTextareaRef.current?.focus(); rawTextareaRef.current?.setSelectionRange(checkpoint.from, checkpoint.to);
    } else if (!raw) canvasRef.current?.restoreSelection();
  };
  const focusRawAt = (id: string, at: number) => requestAnimationFrame(() => {
    if (activeIdRef.current !== id || !rawRef.current) return;
    rawTextareaRef.current?.focus({ preventScroll: true }); rawTextareaRef.current?.setSelectionRange(at, at);
  });
  const synonymPanelRef = useRef<HTMLDivElement>(null);
  const synonymSessionRef = useRef(0);
  const turndown = useMemo(() => new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' }), []);

  const loadData = useCallback(async (documentId: string, adoptRevision = false) => {
    const next = await port.loadEditorData(documentId);
    // Refreshing comments or links must not bless a newer document revision
    // while the canvas still contains the older text.
    if (adoptRevision || !revisionRef.current.has(documentId)) revisionRef.current.set(documentId, next.revision ?? 0);
    if (documentId === activeIdRef.current) setData(next);
    return next;
  }, [port]);

  const loadQuickImproveStyles = useCallback(async () => {
    const [settings, styles] = await Promise.all([window.nodus.getSettings(), window.nodus.listStudyStyles()]);
    const byId = new Map(styles.filter((item) => item.active && !item.archivedAt).map((item) => [item.id, item]));
    setQuickImproveStyles(settings.studyImproveToolbarStyleIds.slice(0, 4).map((id) => byId.get(id)).filter((item): item is StudyStyle => Boolean(item)));
    setAllImproveStyles([...byId.values()]);
    setAiStyleId(byId.has(settings.studyImproveLastStyleId ?? '') ? settings.studyImproveLastStyleId! : 'builtin:clear');
  }, []);

  useEffect(() => { void loadQuickImproveStyles(); }, [active?.id, loadQuickImproveStyles]);

  useEffect(() => {
    if (!active) return;
    setTitle(active.title);
    setDraftState(active.contentMarkdown);
    setNativeDocument(null); nativeRef.current = null; hydratedIdRef.current = ''; setSaveError(''); setRecoveredDraft(false);
    baselineRef.current = JSON.stringify({ title: active.title, content: active.contentMarkdown, style: DEFAULT_STUDY_DOC_STYLE, language: 'es-ES', dictionary: [] });
    setSaveState('saved');
    setEditingTitle(false);
    setSelectedVersion(null);
    setHistoryState({ canUndo: false, canRedo: false });
    setEditorRevision((value) => value + 1);
    void loadData(active.id,true).then((next) => {
      if (active.id !== activeIdRef.current) return;
      const loadedTitle = next.documentTitle ?? active.title;
      const loadedContent = next.contentMarkdown ?? active.contentMarkdown;
      const native = next.nativeDocument ?? markdownToBlockNote(loadedContent);
      setAcademicMetadata(normalizeAcademicMetadata(next.academicMetadata));
      setTitle(loadedTitle); setDraftState(loadedContent); setStyle(next.style); setNativeDocument(native); nativeRef.current = native;
      baselineRef.current = JSON.stringify({ title: loadedTitle, content: loadedContent, nativeDocument: native, academicMetadata:normalizeAcademicMetadata(next.academicMetadata), style: next.style, language: next.spellcheckLanguage, dictionary: next.customDictionary });
      savedSignaturesRef.current.set(active.id,baselineRef.current);
      const recovered = readEditorialDraft(draftScope,active.id);
      if (recovered) {
        if(recovered.academicMetadata)setAcademicMetadata(normalizeAcademicMetadata(recovered.academicMetadata));
        setTitle(recovered.title); setDraftState(recovered.contentMarkdown); nativeRef.current = recovered.nativeDocument ?? markdownToBlockNote(recovered.contentMarkdown); setNativeDocument(nativeRef.current);
        if (recovered.style) setStyle(recovered.style as StudyDocStyle);
        revisionRef.current.set(active.id,recovered.revision); setRecoveredDraft(true); setSaveState('dirty');
        if (recovered.revision !== next.revision) { setSaveState('error'); setSaveError(t('La versión guardada ha cambiado. Recupera el borrador o carga la versión actual.')); }
      }
      hydratedIdRef.current = active.id;
    });
  }, [active?.id, loadData]);

  const resolveImproveSelection = (allowFallback: boolean): ImproveTarget | null => {
    const textarea = rawTextareaRef.current;
    if (raw && textarea) {
      let from = textarea.selectionStart;
      let to = textarea.selectionEnd;
      if (from !== to) return { from, to, text: draft.slice(from, to), scope: 'selection' };
      if (!allowFallback) return null;
      from = draft.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
      const nextLine = draft.indexOf('\n', to);
      to = nextLine === -1 ? draft.length : nextLine;
      if (draft.slice(from, to).trim()) return { from, to, text: draft.slice(from, to), scope: 'paragraph' };
    }
    const snapshot = raw ? undefined : canvasRef.current?.selectionSnapshot();
    const selection = snapshot?.text ?? '';
    if (selection.trim()) {
      let from = -1;
      let cursor = 0;
      for (let occurrence = 0; occurrence <= (snapshot?.occurrence ?? 0); occurrence += 1) {
        from = draft.indexOf(selection, cursor);
        if (from < 0) break;
        cursor = from + selection.length;
      }
      if (from < 0) from = draft.indexOf(selection);
      if (from >= 0 || (!raw && snapshot)) return { from: Math.max(0, from), to: Math.max(0, from) + selection.length, text: selection, scope: 'selection', visual: !raw, range: snapshot?.range };
    }
    if (!allowFallback) return null;
    return null;
  };

  const showSelectionImproveShortcuts = (event?: { clientX?: number; clientY?: number; target?: EventTarget | null }) => {
    const editorSelection = event?.target instanceof Element && Boolean(event.target.closest('.bn-editor, [data-testid="study-markdown-editor"]'));
    window.setTimeout(() => {
      if (active.id !== activeIdRef.current) return;
      const target = resolveImproveSelection(false);
      const source = aiSource.current;
      if (editorSelection && aiPanel === 'polish' && source?.id === activeIdRef.current && target) {
        const changed = source.base !== draft || source.native !== JSON.stringify(nativeRef.current)
          || !sameImproveTarget(source.target, target);
        if (changed) {
          cancelAi(); discardProposal(); capturePolishSource(target);
        }
      }
      if (improvementRunning.current || resultRef.current) return;
      if (!target) { setSelectionImprove(null); return; }
      const selection = window.getSelection();
      const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
      const fallback = rawTextareaRef.current?.getBoundingClientRect();
      const pointerX = event?.clientX && event.clientX > 0 ? event.clientX : undefined;
      const pointerY = event?.clientY && event.clientY > 0 ? event.clientY : undefined;
      const rawLine = rawTextareaRef.current ? rawTextareaRef.current.value.slice(0, rawTextareaRef.current.selectionStart).split('\n').length - 1 : 0;
      const x = raw && fallback ? fallback.left + 28 : rect?.width ? rect.left + rect.width / 2 : pointerX ?? (fallback ? fallback.right - 120 : window.innerWidth / 2);
      const y = raw && fallback ? Math.min(window.innerHeight - 48, fallback.top + 8 + rawLine * 24 - (rawTextareaRef.current?.scrollTop ?? 0)) : rect?.height ? rect.top - 12 : pointerY ?? (fallback ? fallback.top + 16 : 80);
      setSelectionImprove({ x: Math.max(110, Math.min(window.innerWidth - 110, x)), y: Math.max(54, y), target });
      setImproveStreamError('');
    });
  };

  const replaceImprovedSelection = (base: string, target: ImproveTarget, text: string, commitToHistory = false) => {
    if (target.visual && target.range && commitToHistory) {
      canvasRef.current?.replaceSelectionMarkdown(target.range, text);
      setSaveState('dirty');
      return;
    }
    const next = `${base.slice(0, target.from)}${text}${base.slice(target.to)}`;
    if (raw && commitToHistory) { assertAcademicSupplement(base, next); markdownToBlockNote(next, nativeRef.current); }
    setDraft(next, commitToHistory ? `ai:${crypto.randomUUID()}` : undefined);
    if (!raw) canvasRef.current?.replaceAllMarkdown(next, { addToHistory: commitToHistory, closeHistory: commitToHistory });
    setSaveState('dirty');
  };

  const chooseAiStyle = (id: string) => { setAiStyleId(id); void window.nodus.updateSettings({ studyImproveLastStyleId: id }).catch(cause => setImproveStreamError(aiErrorMessage(cause))); };
  const discardProposal = () => {
    if (resultRef.current) void window.nodus.updateStudyImprovementAction(resultRef.current.logId, 'rejected').catch(() => undefined);
    resultRef.current = null; setAiResult(null); setImprovePreview(''); setImageResult(null);
  };
  const cancelAi = () => {
    aiGeneration.current++; improveCancelled.current = true;
    if (improvementRunning.current) void window.nodus.cancelStudyImprove();
    if (imageRequest.current) void window.nodus.cancelEditorImage(imageRequest.current);
    improvementRunning.current = false; imageRequest.current = null;
    setImproveStreamingStyleId(null); setImageBusy(false); setImprovePreview('');
  };
  const capturePolishSource = (target: ImproveTarget) => {
    const source = { id: active.id, base: draft, native: JSON.stringify(nativeRef.current), target };
    aiSource.current = source;
    preserveSelection(); setLastImprovement(null); setImproveStreamError('');
    return source;
  };
  const closeAiPanel = () => { cancelAi(); discardProposal(); setAiPanel(null); setSelectionImprove(null); setImproveStreamError(''); aiSource.current = null; imageSource.current = null; requestAnimationFrame(restoreSelection); };
  closeAiRef.current = closeAiPanel;
  useEffect(() => { closeAiPanel(); return () => { aiGeneration.current++; if (imageRequest.current) void window.nodus.cancelEditorImage(imageRequest.current); if (improvementRunning.current) { improveCancelled.current = true; void window.nodus.cancelStudyImprove(); } if (resultRef.current) void window.nodus.updateStudyImprovementAction(resultRef.current.logId, 'rejected').catch(() => undefined); }; }, [active?.id]);

  const openPolish = async (target = resolveImproveSelection(false), style?: StudyStyle) => {
    if (!target || !active || improvementRunning.current || aiResult) { if (!target) setImproveStreamError(t('Selecciona texto para mejorarlo.')); return; }
    const originalNative = JSON.stringify(nativeRef.current);
    try { await dictationRef.current?.stop(); } catch (cause) { setImproveStreamError(aiErrorMessage(cause)); return; }
    if (active.id !== activeIdRef.current || originalNative !== JSON.stringify(nativeRef.current)) { setImproveStreamError(t('El texto ha cambiado. Selecciónalo de nuevo para pulirlo.')); return; }
    setShowSearch(false); closeSynonymPanel();
    cancelAi(); setImageResult(null);
    capturePolishSource(target); setSelectionImprove(null); setAiPanel('polish');
    const generation = aiGeneration.current;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation === aiGeneration.current && target.range && originalNative === JSON.stringify(nativeRef.current)) canvasRef.current?.revealAiSelection(target.range);
    }));
    if (style) chooseAiStyle(style.id);
  };
  const runQuickImprovement = (style: StudyStyle, target = selectionImprove?.target ?? resolveImproveSelection(false)) => openPolish(target, style);
  const runPolish = async () => {
    let source = aiSource.current;
    const style = allImproveStyles.find(item => item.id === aiStyleId);
    if (!source || !style || !active || !data || improvementRunning.current) return;
    if (source.id !== active.id || active.id !== activeIdRef.current) { setImproveStreamError(t('El texto ha cambiado. Selecciónalo de nuevo para pulirlo.')); return; }
    // Native menus or a mouseup outside the editor may not reach its handlers.
    const selected = resolveImproveSelection(false);
    if (selected && !sameImproveTarget(source.target, selected)) {
      cancelAi(); discardProposal(); source = capturePolishSource(selected);
    }
    if (source.base !== draft || source.native !== JSON.stringify(nativeRef.current)) { setImproveStreamError(t('El texto ha cambiado. Selecciónalo de nuevo para pulirlo.')); return; }
    const target = source.target;
    try {
      if (target.visual && target.range) canvasRef.current?.validateAiSelection(target.range);
      else { const withoutSelection = `${source.base.slice(0, target.from)}${source.base.slice(target.to)}`; assertAcademicSupplement(source.base, withoutSelection); markdownToBlockNote(withoutSelection, nativeRef.current); }
    }
    catch (cause) { setImproveStreamError(aiErrorMessage(cause)); return; }
    discardProposal(); const generation = ++aiGeneration.current;
    let streamed = '';
    let frame = 0;
    const flush = () => { frame = 0; if (generation === aiGeneration.current) setImprovePreview(streamed); };
    improveCancelled.current = false;
    improvementRunning.current = true;
    setImproveStreamingStyleId(style.id); setImprovePreview(''); setLastImprovement(null); setImproveStreamError(''); setSelectionImprove(null);
    try {
      const result = await window.nodus.improveStudyText({
        ...port.improveTarget(active.id), subjectId, text: target.text, styleId: style.id, scope: target.scope,
        additionalInstructions: aiInstructions,
        level: style.level, length: style.length, mode: 'preserve',
        promptLanguage: settings.promptLanguage,
        variables: { language: style.language, documentType: active.kind ?? 'nota', selectedText: target.text },
        protectedTerms: [active.title, ...data.customDictionary], model: aiModel,
      }, { onDelta: (delta) => {
        if (generation !== aiGeneration.current) return;
        streamed += delta;
        if (!frame) frame = window.requestAnimationFrame(flush);
      } });
      if (frame) window.cancelAnimationFrame(frame);
      if (generation !== aiGeneration.current || improveCancelled.current || source.id !== activeIdRef.current) { void window.nodus.updateStudyImprovementAction(result.logId, 'rejected').catch(() => undefined); return; }
      if (!result.text.trim()) throw new Error(t('La IA no devolvió texto. El original no se ha modificado.'));
      resultRef.current = result; setAiResult(result); setImprovePreview(result.text);
    } catch (cause) {
      if (frame) window.cancelAnimationFrame(frame);
      if (generation === aiGeneration.current && !improveCancelled.current) { setImproveStreamError(aiErrorMessage(cause)); setImprovePreview(''); }
    } finally { if (generation === aiGeneration.current) { improvementRunning.current = false; setImproveStreamingStyleId(null); } }
  };

  const acceptProposal = () => {
    const source = aiSource.current, result = resultRef.current;
    if (!source || !result || source.id !== activeIdRef.current || source.base !== draft || source.native !== JSON.stringify(nativeRef.current)) { setImproveStreamError(t('El texto ha cambiado. Selecciónalo de nuevo para pulirlo.')); return; }
    try {
      replaceImprovedSelection(source.base, source.target, result.text, true);
      resultRef.current = null; setAiResult(null); setImprovePreview(''); setAiPanel(null);
      if (raw) focusRawAt(source.id, source.target.from + result.text.length);
      const style = allImproveStyles.find(style => style.id === result.styleId);
      setLastImprovement(style ? studyStyleDisplay(style).name : t('Pulir'));
      void window.nodus.updateStudyImprovementAction(result.logId, 'replace').catch(cause => setImproveStreamError(aiErrorMessage(cause)));
    } catch (cause) { setImproveStreamError(aiErrorMessage(cause)); }
  };
  useEffect(() => { if (raw && (improveStreamingStyleId || aiResult)) document.querySelector('[data-testid="scriptor-ai-raw-target"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [raw, improveStreamingStyleId, aiResult]);

  const openImagePanel = () => {
    if (!active || improvementRunning.current || aiResult) return;
    cancelAi();
    preserveSelection(); imageSource.current = { id: active.id, anchor: raw ? undefined : canvasRef.current?.imageAnchor(), raw: raw ? { base: draft, at: rawTextareaRef.current?.selectionEnd ?? draft.length } : undefined };
    imageNeedsCursor.current = false;
    setLastImprovement(null); setAiPanel('image'); setImageChoices([]); setImageResult(null); setSelectionImprove(null); setImproveStreamError('');
    const generation = aiGeneration.current;
    void Promise.all([window.nodus.getSettings(), window.nodus.listImageModels(), window.nodus.getNodusLocalImageStatus()]).then(([fresh, catalog, local]) => {
      if (generation !== aiGeneration.current) return;
      const configuredImageModel = { provider: fresh.imageProvider, model: fresh.imageModel }; setImageModel(configuredImageModel);
      const choices = savedEditorImageModels(catalog, fresh.imageFavorites ?? [], configuredImageModel).map(entry => ({ id: `${entry.provider}:${entry.id}`, label: `${entry.provider === 'google' ? 'Google' : entry.provider} · ${entry.name}`, disabled: entry.provider === 'nodus' ? !(local.runtime.ready && local.model.downloaded) : entry.provider === 'codex' ? false : !fresh.providerKeys[entry.provider === 'google' ? 'gemini' : entry.provider] }));
      if (!choices.some(choice => choice.id === `${configuredImageModel.provider}:${configuredImageModel.model}`)) choices.unshift({ id: `${configuredImageModel.provider}:${configuredImageModel.model}`, label: `${configuredImageModel.provider} · ${configuredImageModel.model}`, disabled: true });
      setImageChoices(choices);
    }).catch(cause => { if (generation === aiGeneration.current) setImproveStreamError(aiErrorMessage(cause)); });
  };
  const runImage = async () => {
    if (!imagePrompt.trim() || imageBusy || !imageSource.current || !imageChoices.some(choice => choice.id === `${imageModel.provider}:${imageModel.model}` && !choice.disabled)) return;
    const generation = ++aiGeneration.current, requestId = crypto.randomUUID(); imageRequest.current = requestId;
    setImageBusy(true); setImageResult(null); setImproveStreamError('');
    try { const result = await window.nodus.generateEditorImage({ requestId, prompt: imagePrompt, model: imageModel }); if (generation === aiGeneration.current && imageSource.current?.id === activeIdRef.current) setImageResult(result); }
    catch (cause) { if (generation === aiGeneration.current) setImproveStreamError(aiErrorMessage(cause)); }
    finally { if (generation === aiGeneration.current) { setImageBusy(false); imageRequest.current = null; } }
  };
  const insertImage = () => {
    const source = imageSource.current; if (!source || !imageResult || source.id !== activeIdRef.current) return;
    let rawCursor: number | undefined;
    if (imageNeedsCursor.current) { setImproveStreamError(t('Sitúa el cursor donde deseas insertar la imagen.')); return; }
    if (raw && source.raw) {
      if (source.raw.base !== draft) { setImproveStreamError(t('Sitúa el cursor donde deseas insertar la imagen.')); imageNeedsCursor.current = true; return; }
      const at = source.raw.at, snippet = `\n\n![${imagePrompt.replace(/[\]\n[]/g, ' ')}](${imageResult.dataUrl})\n\n`; setDraft(`${draft.slice(0, at)}${snippet}${draft.slice(at)}`); rawCursor = at + snippet.length;
    } else if (!source.anchor || !canvasRef.current?.insertGeneratedImage(source.anchor, imageResult.dataUrl, imagePrompt)) { setImproveStreamError(t('Sitúa el cursor donde deseas insertar la imagen.')); imageNeedsCursor.current = true; return; }
    setSaveState('dirty'); closeAiPanel();
    if (rawCursor !== undefined) focusRawAt(source.id, rawCursor);
  };
  const captureImageCursor = () => {
    if (aiPanel !== 'image' || !imageNeedsCursor.current || imageSource.current?.id !== activeIdRef.current) return;
    imageSource.current = { id: activeIdRef.current, anchor: raw ? undefined : canvasRef.current?.imageAnchor(), raw: raw ? { base: draft, at: rawTextareaRef.current?.selectionEnd ?? draft.length } : undefined };
    imageNeedsCursor.current = false; setImproveStreamError('');
  };

  const openImprovePrompts = (target = resolveImproveSelection(false)) => {
    improveTargetRef.current = target;
    setShowImprovePrompts(true);
  };

  const closeSynonymPanel = () => {
    synonymSessionRef.current += 1;
    setSynonymPanel(null);
  };

  const loadSynonymRound = async (panel: SynonymPanelState, previousAlternatives: string[]) => {
    if (!active) return;
    setSynonymPanel((current) => current?.sessionId === panel.sessionId ? { ...current, loading: true, error: '' } : current);
    try {
      const result = await window.nodus.suggestStudySynonyms({
        documentId: active.id,
        subjectId,
        sentence: panel.context.sentence,
        selectedText: panel.target.text,
        selectionFrom: panel.context.selectionFrom,
        selectionTo: panel.context.selectionTo,
        previousAlternatives,
        model: aiModel,
      });
      if (synonymSessionRef.current !== panel.sessionId) return;
      setSynonymPanel((current) => current?.sessionId === panel.sessionId
        ? { ...current, rounds: [...current.rounds, result.alternatives], loading: false, error: '' }
        : current);
    } catch (cause) {
      if (synonymSessionRef.current !== panel.sessionId) return;
      setSynonymPanel((current) => current?.sessionId === panel.sessionId
        ? { ...current, loading: false, error: cause instanceof Error ? cause.message : String(cause) }
        : current);
    }
  };

  const openSynonymPanel = (button: HTMLElement, target: ImproveTarget) => {
    const context = studySentenceContext(draft, target.from, target.to);
    const rect = button.getBoundingClientRect();
    const width = Math.min(368, window.innerWidth - 24);
    const x = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    const y = window.innerHeight - rect.bottom >= 380 ? rect.bottom + 8 : Math.max(12, rect.top - 372);
    const panel: SynonymPanelState = {
      sessionId: synonymSessionRef.current + 1,
      x,
      y,
      base: draft,
      target,
      context,
      rounds: [],
      loading: true,
      error: '',
    };
    synonymSessionRef.current = panel.sessionId;
    setSynonymPanel(panel);
    void loadSynonymRound(panel, []);
  };

  const regenerateSynonyms = () => {
    if (!synonymPanel || synonymPanel.loading) return;
    const previous = synonymPanel.rounds.flat().map((alternative) => alternative.replacement);
    void loadSynonymRound(synonymPanel, previous);
  };

  const applySynonymAlternative = (alternative: StudySynonymAlternative) => {
    if (!synonymPanel) return;
    const from = synonymPanel.context.sentenceFrom + alternative.from;
    const to = synonymPanel.context.sentenceFrom + alternative.to;
    replaceImprovedSelection(synonymPanel.base, {
      from,
      to,
      text: synonymPanel.base.slice(from, to),
      scope: 'selection',
      visual: synonymPanel.target.visual,
    }, alternative.replacement, true);
    setSelectionImprove(null);
    closeSynonymPanel();
  };

  useEffect(() => {
    if (!synonymPanel) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!synonymPanelRef.current?.contains(event.target as Node)) closeSynonymPanel();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // The BlockNote formatting popover consumes Escape before it bubbles.
      // Dismiss the foreground synonyms panel first, retaining the selection.
      event.preventDefault();
      event.stopPropagation();
      closeSynonymPanel();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [synonymPanel?.sessionId]);

  // The request and its ephemeral history belong to this exact document
  // snapshot. Any edit invalidates the source ranges, so close instead of ever
  // applying an alternative to stale text.
  useEffect(() => { closeSynonymPanel(); }, [active?.id, draft]);

  const currentSignature = JSON.stringify({ title, content: draft, nativeDocument, academicMetadata, style, language: data?.spellcheckLanguage, dictionary: data?.customDictionary });
  activeIdRef.current = active?.id ?? '';
  latestSignatureRef.current = currentSignature;
  rawRef.current = raw;
  useEffect(() => {
    if (!active || !data || hydratedIdRef.current !== active.id || improveStreamingStyleId) return;
    if (currentSignature === baselineRef.current) {
      // Undo can return to the persisted document without making another save.
      // Clear its previous dirty status and recovery draft, keeping real conflicts.
      if (!saveError) { setSaveState('saved'); setRecoveredDraft(false); clearEditorialDraft(draftScope,active.id); }
      return;
    }
    retainEditorialDraft(draftScope,active.id,{title,contentMarkdown:draft,nativeDocument:nativeRef.current,academicMetadata:academicRef.current,revision:revisionRef.current.get(active.id) ?? 0,style});
    if (saveError) return;
    setSaveState('dirty');
    const timer = window.setTimeout(() => void save('autosave'), STUDY_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [currentSignature, active?.id, data?.revision, improveStreamingStyleId, saveError]);

  const save = async (reason: 'autosave' | 'manual' | 'command') => {
    if (improvementRunning.current) return false;
    // Never persist a partial AI stream. Its complete result marks the editor
    // dirty and enters this same autosave path when streaming finishes.
    if (!active || !data || hydratedIdRef.current !== active.id || currentSignature === baselineRef.current) return true;

    const snapshot = {
      id: active.id,
      signature: currentSignature,
      title,
      contentMarkdown: draft,
      nativeDocument: nativeRef.current,
      academicMetadata:academicRef.current,
      style,
      spellcheckLanguage: data?.spellcheckLanguage,
      customDictionary: data?.customDictionary,
      reason,
    };
    const operation = saveQueueRef.current.catch(() => undefined).then(async () => {
      if (savedSignaturesRef.current.get(snapshot.id) === snapshot.signature) return true;
      if (snapshot.id === activeIdRef.current) setSaveState('saving');
      try {
        const updated = await port.save(snapshot.id, {
          title: snapshot.title,
          contentMarkdown: snapshot.contentMarkdown,
          nativeDocument: snapshot.nativeDocument,
          expectedRevision: revisionRef.current.get(snapshot.id),
          schemaVersion: 2,
          academicMetadata:snapshot.academicMetadata,
          style: snapshot.style,
          spellcheckLanguage: snapshot.spellcheckLanguage,
          customDictionary: snapshot.customDictionary,
          reason: snapshot.reason,
        });
        const next = await port.loadEditorData(snapshot.id);
        revisionRef.current.set(snapshot.id, updated.editorRevision ?? next.revision ?? 0);
        savedSignaturesRef.current.set(snapshot.id,snapshot.signature);
        onSaved(updated);
        if (snapshot.id === activeIdRef.current) {
          baselineRef.current = snapshot.signature;
          setData(next);
          if (snapshot.signature === latestSignatureRef.current) { setSaveState('saved'); setSaveError(''); setRecoveredDraft(false); clearEditorialDraft(draftScope,snapshot.id); }
        }
        return true;
      } catch (error) {
        if (snapshot.id === activeIdRef.current) { setSaveState('error'); setSaveError(error instanceof Error ? error.message : String(error)); }
        return false;
      }
    });
    saveQueueRef.current = operation;
    return await operation;
  };
  saveLatestRef.current = save;
  const flushLatest = useCallback(async () => {
    if (improvementRunning.current || resultRef.current || imageSource.current) closeAiRef.current();
    await dictationRef.current?.stop();
    return flushEditorialDraft(() => saveLatestRef.current('autosave'), () => !hydratedIdRef.current || latestSignatureRef.current === baselineRef.current);
  }, []);
  useEffect(() => { onRegisterFlush?.(flushLatest); }, [onRegisterFlush,flushLatest]);
  useEffect(() => window.nodus.onBeforeEditorLeave(flushLatest), [flushLatest]);

  // The debounce cleanup cancels its timer when this editor disappears. Flush
  // the live render snapshot so leaving the vault cannot discard the last edit.
  useEffect(() => () => { void saveLatestRef.current('autosave'); }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save('manual'); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && !improvementRunning.current && !resultRef.current) { event.preventDefault(); setShowSearch(true); }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'i') { event.preventDefault(); openImprovePrompts(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  if (!active || !data) return <div className="editorial-editor flex h-full min-h-0 flex-col">
      <EditorialHeader title={active?.title ?? ''} location={location} status={t('Cargando editor…')} contextOpen={contextOpen} focus={focusMode} onContext={() => setContextOpen(!contextOpen)} onFocus={() => void editorialFocus.toggleFocus()} leading={headerContent} /><div className="flex flex-1 items-center justify-center"><Spinner label={t('Cargando editor…')} /></div></div>;

  const stats = studyDocumentStats(draft);
  const styleVars = {
    '--study-editor-font': style.fontFamily === 'serif' ? 'Georgia, Cambria, serif' : style.fontFamily === 'mono' ? 'ui-monospace, monospace' : 'Inter, system-ui, sans-serif',
    '--study-editor-size': `${style.fontSize}px`,
    '--study-editor-line': String(style.lineHeight),
    '--study-editor-width': `${style.pageWidth}px`,
    '--study-editor-margin': `${style.marginX}px`,
    '--study-editor-spacing': `${style.paragraphSpacing}em`,
    '--study-editor-indent': `${style.firstLineIndent}px`,
    '--study-editor-align': style.alignment,
  } as CSSProperties;

  const insertMarkdown = (markdown: string) => {
    const snippet = `${markdown.replace(/^\n+|\n+$/g, '')}\n`;
    if (!raw) {
      canvasRef.current?.insertMarkdown(snippet);
      return;
    }
    const textarea = rawTextareaRef.current;
    const from = textarea?.selectionStart ?? draft.length;
    const to = textarea?.selectionEnd ?? from;
    const prefix = from > 0 && !draft.slice(0, from).endsWith('\n') ? '\n\n' : '';
    const next = `${draft.slice(0, from)}${prefix}${snippet}${draft.slice(to)}`;
    setDraft(next);
    setSaveState('dirty');
    window.setTimeout(() => {
      const cursor = from + prefix.length + snippet.length;
      rawTextareaRef.current?.setSelectionRange(cursor, cursor);
      rawTextareaRef.current?.focus();
    });
  };
  const runEditorHistory = (direction: 'undo' | 'redo') => {
    if (improvementRunning.current || resultRef.current) return;
    setLastImprovement(null); setImproveStreamError('');
    if (!raw) {
      canvasRef.current?.[direction]();
      return;
    }
    const textarea = rawTextareaRef.current;
    if (!textarea) return;
    textarea.focus();
    const history = rawHistory.current;
    const entry = (direction === 'undo' ? history.undo : history.redo).pop();
    if (!entry) return;
    (direction === 'undo' ? history.redo : history.undo).push(entry);
    const value = direction === 'undo' ? entry.before : entry.after;
    textarea.value = value;
    const native = direction === 'undo' ? entry.beforeNative : entry.afterNative;
    if (native !== undefined) { setDraftState(value); nativeRef.current = native; setNativeDocument(native); }
    else setDraft(value, 'history');
  };
  const insertCommand = (command: StudyEditorCommand) => insertMarkdown(studyCommandMarkdown(command));
  const insertHeading = (level: number) => insertMarkdown(`${'#'.repeat(level)} ${t('Título')}`);
  const insertTable = () => {
    const rows = Number.isFinite(tableRows) ? Math.min(20, Math.max(1, Math.trunc(tableRows))) : 3;
    const columns = Number.isFinite(tableColumns) ? Math.min(12, Math.max(1, Math.trunc(tableColumns))) : 3;
    const header = `| ${Array.from({ length: columns }, (_, index) => `${t('Columna')} ${index + 1}`).join(' | ')} |`;
    const separator = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
    const body = Array.from({ length: rows }, () => `| ${Array.from({ length: columns }, () => t('Contenido')).join(' | ')} |`);
    insertMarkdown([header, separator, ...body].join('\n'));
    setTableDialogOpen(false);
  };
  const activateDocument = async (documentId: string) => {
    if (documentId === active.id) return;
    closeAiPanel();
    if (!await flushLatest()) return;
    onActivate(documentId);
  };
  const openLinkedDocument = async (documentId: string) => {
    closeAiPanel();
    if (!await flushLatest()) return;
    onOpenLinkedDocument(documentId);
  };
  const navigateReference = async (href: string,evidence?:import('@shared/academicDocument').AcademicEvidence) => {
    if (!await flushLatest()) return;
    if(href.startsWith('nodus://passage/')) {
      const passage=await window.nodus.getPassage(decodeURIComponent(href.slice('nodus://passage/'.length))).catch(()=>null);
      if(passage){await openEvidenceAtPage(passage.nodus_id,{location:evidence?.pageLabel??passage.page_label,sourceRef:passage.source_ref,pageNumber:evidence?.physicalPage??passage.page_number});return;}
      setSaveError(t('La evidencia ya no está disponible.'));return;
    }
    if(evidence&&href.startsWith('nodus://work/')){await openEvidenceAtPage(decodeURIComponent(href.slice('nodus://work/'.length)),{location:evidence.pageLabel??null,sourceRef:null,pageNumber:evidence.physicalPage??null});return;}
    if (onNavigateLink?.(href)) return;
    const testimony = parseTestimonyLink(href);
    if (testimony && onTestimonyLink) { onTestimonyLink(testimony); return; }
    const reference = parseEditorReference(href);
    if (reference && reference.kind === (port.referenceKind ?? 'studyDocument')) {
      onOpenLinkedDocument(reference.id); return;
    }
    if (reference) {
      const label = documentReferences(nativeRef.current).find(item => item.href === href)?.title ?? '';
      window.dispatchEvent(new CustomEvent('nodus:open-editor-reference', { detail: { href, label } }));
    } else if (/^https?:\/\//i.test(href)) void window.nodus.openExternal(href);
    else if(href.startsWith('nodus://library/')){if(!await flushLatest())return;window.dispatchEvent(new CustomEvent('nodus:open-library-item',{detail:{itemId:decodeURIComponent(href.slice('nodus://library/'.length))}}));}
    else if (href.startsWith('nodus://')) { setContextOpen(true); setContextTab('sources'); }
  };
  const requestClose = (documentId: string) => setPendingCloseId(documentId);
  const confirmClose = async () => {
    const documentId = pendingCloseId;
    if (!documentId) return;
    // `save` is signature-based, so calling it unconditionally also covers the
    // tiny interval before the dirty-state effect has painted.
    if (documentId === active.id && !await flushLatest()) return;
    setPendingCloseId(null);
    onClose(documentId);
  };
  const jumpToHeading = (_item: StudyOutlineItem, index: number) => {
    const heading = document.querySelectorAll('.nodus-blocknote .ProseMirror h1, .nodus-blocknote .ProseMirror h2, .nodus-blocknote .ProseMirror h3, .nodus-blocknote .ProseMirror h4, .nodus-blocknote .ProseMirror h5, .nodus-blocknote .ProseMirror h6')[index];
    heading?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const openCommentDialog = () => {
    const selection = raw ? undefined : canvasRef.current?.selectionSnapshot();
    const target = resolveImproveSelection(false);
    setTextDialog({ kind: 'comment', selectedText: target?.text ?? '', from: target?.from ?? 0, anchor: selection?.text ? selection.anchor : undefined });
  };
  const submitTextDialog = async (value: string) => {
    if (textDialog?.kind === 'tag') {
      await onCreateTag?.(value);
      setTextDialog(null);
      return;
    }
    const selectedText = textDialog?.selectedText ?? '';
    const from = textDialog?.from ?? 0;
    await port.createAnnotation(active.id, { from, to: from + selectedText.length, selectedText, comment: value, anchor: textDialog?.anchor });
    await loadData(active.id);
    setTextDialog(null);
  };
  const restoreVersion = async (version: StudyDocVersion) => {
    if (!window.confirm(t('¿Restaurar esta versión? El estado actual seguirá disponible en el historial.'))) return;
    if (!await flushLatest()) return;
    const restored = await port.restoreVersion(active.id, version.id);
    setTitle(restored.title); setDraft(restored.contentMarkdown); onSaved(restored);
    const next = await loadData(active.id,true);
    const native = next.nativeDocument ?? markdownToBlockNote(restored.contentMarkdown);
    setAcademicMetadata(normalizeAcademicMetadata(next.academicMetadata));
    nativeRef.current = native; setNativeDocument(native); setStyle(next.style); setEditorRevision(value=>value+1);
    baselineRef.current = JSON.stringify({ title: restored.title, content: restored.contentMarkdown, nativeDocument: native, academicMetadata:normalizeAcademicMetadata(next.academicMetadata), style: next.style, language: next.spellcheckLanguage, dictionary: next.customDictionary });
    savedSignaturesRef.current.set(active.id,baselineRef.current);
    setSaveState('saved');
  };
  const updateAnnotation = async (annotation: StudyAnnotation, patch: Parameters<EditorDocumentPort['updateAnnotation']>[1]) => {
    await port.updateAnnotation(annotation.id, patch); await loadData(active.id);
  };
  const searchCount = search ? draft.toLocaleLowerCase().split(search.toLocaleLowerCase()).length - 1 : 0;
  const handleEditorDrop = async (event: DragEvent<HTMLDivElement>) => {
    const documentId = event.dataTransfer.getData(port.dragType);
    const uri = event.dataTransfer.getData('text/uri-list');
    if (improvementRunning.current || resultRef.current || (!documentId && !uri)) return;
    event.preventDefault();
    let snippet = '';
    if (documentId) {
      const targets = await port.listLinkTargets();
      const target = targets.find((candidate) => candidate.id === documentId);
      if (target && target.id !== active.id) snippet = `[${target.title}](${port.linkHref(target.id)})`;
    } else if (uri) {
      snippet = /\.(png|jpe?g|gif|webp|svg)(?:\?.*)?$/i.test(uri) ? `![${t('Imagen')}](${uri})` : `[${uri}](${uri})`;
    }
    if (snippet) {
      if (raw) setDraft((current) => `${current}${current.endsWith('\n') || !current ? '' : '\n\n'}${snippet}\n`);
      else canvasRef.current?.insertMarkdown(snippet);
    }
  };

  const locked = Boolean(improveStreamingStyleId || aiResult);
  const actions: EditorialAction[] = [
    { id: 'undo', label: t('Deshacer'), icon: 'undo', group: t('Edición'), essential: true, testId: 'study-editor-undo', disabled: locked || (!raw && !historyState.canUndo), shortcut: 'Ctrl/⌘+Z', keyShortcuts: 'Control+Z Meta+Z', onSelect: () => runEditorHistory('undo') },
    { id: 'redo', label: t('Rehacer'), icon: 'redo', group: t('Edición'), essential: true, testId: 'study-editor-redo', disabled: locked || (!raw && !historyState.canRedo), shortcut: 'Ctrl+Y / Ctrl/⌘+Shift+Z', keyShortcuts: 'Control+Y Control+Shift+Z Meta+Shift+Z', onSelect: () => runEditorHistory('redo') },
    { id: 'link', label: t('Enlazar con Nodus'), icon: 'link', group: t('Fuentes'), essential: true, testId: 'editor-reference-insert', disabled: raw || locked, shortcut: '[[', onSelect: () => canvasRef.current?.openReferenceMenu() },
    { id: 'cite', label: t('Citar fuente'), icon: 'quote', group: t('Fuentes'), essential: true, testId: 'academic-cite', disabled: raw || locked, onSelect: () => academicTools.current?.open('cite') },
    { id: 'improve', label: t('Prompts de mejora'), icon: 'sparkles', group: t('Revisión'), essential: true, testId: 'study-improve-toggle', disabled: locked, shortcut: 'Ctrl/⌘+Shift+I', keyShortcuts: 'Control+Shift+I Meta+Shift+I', pressed: showImprovePrompts, onSelect: () => openImprovePrompts() },
    { id: 'comment', label: t('Añadir comentario'), icon: 'chat', group: t('Revisión'), essential: true, onSelect: openCommentDialog },
    { id: 'find', label: t('Buscar y reemplazar'), icon: 'search', group: t('Búsqueda'), essential: true, pressed: showSearch, shortcut: 'Ctrl/⌘+F', keyShortcuts: 'Control+F Meta+F', onSelect: () => setShowSearch(!showSearch) },
    { id: 'save', label: t('Guardar'), icon: 'save', group: t('Documento'), shortcut: 'Ctrl/⌘+S', keyShortcuts: 'Control+S Meta+S', onSelect: () => void save('manual') },
    ...(onUpdateMetadata ? [{ id: 'favorite', label: t('Favorito'), icon: 'star', group: t('Documento'), testId: 'study-doc-favorite', pressed: active.favorite, onSelect: () => void onUpdateMetadata({ favorite: !active.favorite }) }] : []),
    { id: 'close', label: t('Cerrar editor'), icon: 'arrowLeft', group: t('Documento'), pinnable: false, onSelect: () => requestClose(active.id) },
    { id: 'crossref', label: t('Referencia cruzada'), icon: 'link', group: t('Escritura académica'), testId: 'academic-crossref', disabled: raw || locked, onSelect: () => academicTools.current?.open('crossref') },
    { id: 'note', label: t('Nota al pie'), icon: 'notebook', group: t('Escritura académica'), disabled: raw || locked, onSelect: () => academicTools.current?.open('note') },
    { id: 'evidence', label: t('Vincular evidencia'), icon: 'link', group: t('Escritura académica'), disabled: raw || locked, onSelect: () => academicTools.current?.open('evidence') },
    { id: 'manuscript', label: t('Manuscrito y citas'), icon: 'settings', group: t('Escritura académica'), onSelect: () => academicTools.current?.open('settings') },
    { id: 'delivery', label: t('Preparar entrega'), icon: 'external', group: t('Escritura académica'), testId: 'academic-delivery', onSelect: () => academicTools.current?.open('delivery') },
    { id: 'dictation', label: t(dictationActive ? 'Detener dictado' : 'Dictado por voz'), icon: 'microphone', group: t('Voz'), essential: true, testId: 'study-dictation-toggle', disabled: locked && !dictationActive, pressed: dictationActive, onSelect: () => { if (dictationActive) void dictationRef.current?.stop(); else if (showDictation) void dictationRef.current?.start(); else setShowDictation(true); } },
    { id: 'read', label: t('Lectura por voz'), icon: 'play', group: t('Voz'), testId: 'study-audio-toggle', pressed: showAudio, onSelect: () => { const target = resolveImproveSelection(false); setAudioSelection(target?.text ?? ''); setAudioCursor(rawTextareaRef.current?.selectionStart ?? target?.from ?? 0); setShowAudio(value => !value); } },
    { id: 'markdown', label: t('Markdown crudo'), icon: 'code', group: t('Vistas'), pressed: raw, onSelect: () => void (async () => { closeAiPanel(); await dictationRef.current?.stop(); if (raw) setEditorRevision(value => value + 1); setRaw(!raw); })() },
    { id: 'split', label: t('Dividir vista'), icon: 'columns', group: t('Vistas'), pressed: split, onSelect: () => setSplit(!split) },
    { id: 'style', label: t('Apariencia y metadatos'), icon: 'palette', group: t('Vistas'), testId: 'study-doc-style', pressed: showStyle, onSelect: () => { setShowStyle(!showStyle); setContextOpen(true); setContextTab('details'); } },
    { id: 'history', label: t('Historial de versiones'), icon: 'clock', group: t('Vistas'), onSelect: () => { setContextOpen(true); setContextTab('history'); } },
    { id: 'table', label: t('Insertar tabla'), icon: 'table', group: t('Inserción'), onSelect: () => setTableDialogOpen(true) },
    { id: 'quote', label: t('Insertar cita'), icon: 'quote', group: t('Inserción'), onSelect: () => insertCommand('cita') },
    { id: 'ai-image', label: t('Crear imagen con IA'), icon: 'image', group: t('Inserción'), disabled: locked, onSelect: openImagePanel },
    { id: 'polish', label: t('Pulir'), icon: 'aiPolish', group: t('Revisión'), disabled: locked || !selectionImprove, onSelect: () => openPolish() },
    { id: 'image', label: t('Insertar imagen'), icon: 'image', group: t('Inserción'), onSelect: () => insertCommand('imagen') },
    { id: 'audio', label: t('Insertar bloque de audio'), icon: 'play', group: t('Inserción'), onSelect: () => insertCommand('audio') },
    { id: 'quiz', label: t('Insertar pregunta de test'), icon: 'help', group: t('Inserción'), onSelect: () => insertCommand('test') },
    { id: 'code', label: t('Código en línea'), icon: 'code', group: t('Inserción'), testId: 'study-inline-code', disabled: raw || locked, onSelect: () => canvasRef.current?.runInlineCommand('code') },
    { id: 'formula', label: t('Fórmula en línea'), icon: 'sigma', group: t('Inserción'), testId: 'study-inline-formula', disabled: raw || locked, onSelect: () => canvasRef.current?.runInlineCommand('formula') },
    { id: 'print', label: t('Vista previa de impresión'), icon: 'external', group: t('Gestión'), onSelect: () => window.print() },
    { id: 'duplicate', label: t('Duplicar'), icon: 'copy', group: t('Gestión'), onSelect: () => void onDuplicate() },
    { id: 'trash', label: t('Mover a la papelera'), icon: 'trash', group: t('Gestión'), pinnable: false, onSelect: () => void onTrash() },
  ];
  if (locked) for (const action of actions) if (!['close', 'save', 'read'].includes(action.id)) action.disabled = true;

  return (
    <div style={styleVars} className={`study-editor-shell editorial-editor flex h-full min-h-0 flex-col bg-stone-100 text-stone-900 dark:bg-neutral-950 dark:text-neutral-100 ${focusMode ? 'editorial-focus' : ''} study-theme-${style.theme}`}>
{nativeDocument&&<AcademicTools ref={academicTools} id={active.id} title={title} document={nativeDocument} metadata={academicMetadata} onChange={setAcademicMetadata} canvas={canvasRef} unresolvedComments={data?.annotations.filter(a=>!a.resolvedAt).length??0} adapter={{inspect:()=>window.nodus.inspectAcademicDocument({documentId:active.id,kind:port.referenceKind==='note'?'note':'study',expectedRevision:revisionRef.current.get(active.id)}),searchSources:desktopAcademicSources,rootKind:port.referenceKind==='note'?'note':'study',loadChapter:async(id,kind)=>{const data=kind==='note'?await window.nodus.getWorkspaceNoteEditorData(id):await studyDocumentPort.loadEditorData(id);return data.nativeDocument??markdownToBlockNote(data.contentMarkdown??'');},searchEvidence:async query=>(await window.nodus.listEditorReferences({includePassages:true,search:query})).filter(ref=>['idea','work','passage'].includes(ref.kind)&&ref.title.toLowerCase().includes(query.toLowerCase())).slice(0,50).map(ref=>({href:ref.href,title:ref.title,pageLabel:ref.pageLabel,physicalPage:ref.physicalPage})),listChapters:async()=>{const [notes,study]=await Promise.all([window.nodus.getNotesTree(),window.nodus.getStudyWorkspace()]);return [...notes.notes.filter(note=>!note.trashedAt).map(note=>({documentId:note.id,title:note.title,kind:'note' as const})),...study.documents.map(doc=>({documentId:doc.id,title:doc.title,kind:'study' as const}))];},flush:()=>flushLatest(),export:(format,acceptWarnings)=>window.nodus.exportAcademicDocument({documentId:active.id,kind:port.referenceKind==='note'?'note':'study',expectedRevision:revisionRef.current.get(active.id),format,acceptWarnings})}} />}
      <EditorialHeader title={title} location={location} status={t(saveState === 'saved' ? 'Guardado' : saveState === 'saving' ? 'Guardando…' : saveState === 'dirty' ? 'Sin guardar' : 'Error al guardar')} contextOpen={contextOpen} focus={focusMode} onContext={() => setContextOpen(!contextOpen)} onFocus={() => void editorialFocus.toggleFocus()} navigationOpen={editorialFocus.navigationOpen} onNavigation={editorialFocus.toggleNavigation} leading={<>
        {headerContent}
      {showTabs ? (
        <div className="study-editor-tabs flex min-h-10 items-end gap-1 overflow-x-auto border-b border-stone-200 bg-stone-50 px-2 pt-1 dark:border-neutral-800 dark:bg-neutral-950">
          {documents.map((document) => (
            <div key={document.id} role="tab" tabIndex={0} aria-selected={document.id === active.id} onClick={() => void activateDocument(document.id)}
              onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) void activateDocument(document.id); }}
              className={`group flex max-w-64 items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-2 text-xs ${document.id === active.id ? 'border-stone-300 bg-white text-stone-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200' : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-neutral-600 dark:hover:text-neutral-300'}`}>
              <Icon name={documentIcon} size={12} />
              {document.id === active.id && editingTitle ? (
                <input autoFocus aria-label={t('Título del apunte')} disabled={locked} className="min-w-24 max-w-44 bg-transparent font-semibold outline-none ring-0" value={title}
                  onClick={(event) => event.stopPropagation()} onChange={(event) => setTitle(event.target.value)}
                  onBlur={() => setEditingTitle(false)} onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); setEditingTitle(false); void save('manual'); }
                    if (event.key === 'Escape') { event.preventDefault(); setTitle(active.title); setEditingTitle(false); }
                  }} />
              ) : <span className="min-w-0 flex-1 truncate">{document.id === active.id ? title : document.title}</span>}
              {document.id === active.id && !editingTitle && <button type="button" title={t('Renombrar apunte')} aria-label={t('Renombrar apunte')}
                onClick={(event) => { event.stopPropagation(); setEditingTitle(true); }} className="rounded p-0.5 text-neutral-600 hover:bg-neutral-800 hover:text-neutral-200"><Icon name="edit" size={11} /></button>}
              <button type="button" title={t('Cerrar apunte')} aria-label={t('Cerrar apunte')}
                onClick={(event) => { event.stopPropagation(); requestClose(document.id); }} className="rounded p-0.5 text-neutral-700 group-hover:text-neutral-400 hover:bg-neutral-800 hover:!text-red-300"><Icon name="x" size={11} /></button>
            </div>
          ))}
        </div>
      ) : null}
</>} onPreserveSelection={preserveSelection} options={<>
        <EditorialActionMenu actions={actions} pins={pinnedActionIds} onPinsChange={setPinnedActionIds} beforeAction={restoreSelection} />
        <div className="study-insert-toolbar" data-testid="study-insert-toolbar">
          <label htmlFor="study-heading-level">{t('Nivel de título')}</label>
          <select id="study-heading-level" data-testid="study-heading-level" className="input" defaultValue="" title={t('Insertar título')}
            onChange={event => { restoreSelection(); if (event.target.value) insertHeading(Number(event.target.value)); event.target.value = ''; }}>
            <option value="" disabled>H</option>{[1, 2, 3, 4, 5, 6].map(level => <option key={level} value={level}>H{level}</option>)}
          </select>
        </div>
      </>} />
      <EditorialActionBar actions={actions} pins={pinnedActionIds} beforeAction={restoreSelection} onPreserveSelection={preserveSelection} status={`${stats.words} ${t('palabras')} · ${stats.readingMinutes} min`} />
      {(saveError || recoveredDraft) && <div className={`editorial-save-error${saveError ? '' : ' editorial-draft-recovered'}`} role={saveError ? 'alert' : 'status'}><span>{saveError || t('Se ha recuperado tu borrador local.')}</span><button onClick={() => void save('manual')}>{t(saveError ? 'Reintentar' : 'Guardar')}</button><button onClick={() => downloadEditorialDraft({ title, contentMarkdown: draft, nativeDocument: nativeRef.current, academicMetadata, style })}>{t('Recuperar borrador')}</button><button onClick={() => void (async () => {
        const next = await loadData(active.id,true); const native = next.nativeDocument ?? markdownToBlockNote(next.contentMarkdown ?? active.contentMarkdown);
        setAcademicMetadata(normalizeAcademicMetadata(next.academicMetadata));
        const nextTitle = next.documentTitle ?? active.title; const nextContent = next.contentMarkdown ?? active.contentMarkdown;
        setTitle(nextTitle); setDraftState(nextContent); setStyle(next.style); nativeRef.current = native; setNativeDocument(native);
        baselineRef.current = JSON.stringify({ title: nextTitle, content: nextContent, nativeDocument: native, academicMetadata:normalizeAcademicMetadata(next.academicMetadata), style: next.style, language: next.spellcheckLanguage, dictionary: next.customDictionary });
        savedSignaturesRef.current.set(active.id,baselineRef.current);
        clearEditorialDraft(draftScope,active.id); setRecoveredDraft(false); setSaveError(''); setSaveState('saved'); setEditorRevision(value => value+1);
      })()}>{t('Cargar versión actual')}</button></div>}
      {improveStreamError && !aiPanel && <div data-testid="study-improve-stream-error" className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><Icon name="alert" size={13} /><span className="min-w-0 flex-1">{improveStreamError}</span><span>{t('El original permanece intacto.')}</span><button onClick={() => setImproveStreamError('')} aria-label={t('Cerrar')}><Icon name="x" size={12} /></button></div>}


      {showSearch && (
        <div className="study-search-toolbar editorial-searchbar flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900/50">
          <input autoFocus className="input h-8 flex-1" aria-label={t('Buscar en el documento')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Buscar en el documento')} />
          <span className="w-20 text-center text-xs text-neutral-600">{searchCount} {t('coincidencias')}</span>
          <input className="input h-8 flex-1" aria-label={t('Reemplazar por')} value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder={t('Reemplazar por')} />
          <button disabled={!search} className="btn btn-ghost h-8" onClick={() => { setDraft(draft.split(search).join(replacement)); if (!raw) setEditorRevision((value) => value + 1); }}>{t('Reemplazar todo')}</button><button className="editorial-header-action" aria-label={t('Cerrar búsqueda')} onClick={()=>setShowSearch(false)}><Icon name="x" size={14} /></button>
        </div>
      )}
      {showDictation && <StudyDictation
        key={active.id}
        ref={dictationRef}
        documentId={active.id}
        settings={settings}
        language={data.spellcheckLanguage}
        vocabulary={[active.title, ...documents.map((document) => document.title), ...draft.match(/\b[A-ZÁÉÍÓÚÑ][\p{L}-]{3,}\b/gu) ?? []]}
        customDictionary={data.customDictionary}
        onStateChange={setDictationActive}
        onClose={() => void (async () => { await dictationRef.current?.stop(); setShowDictation(false); })()}
        onEnd={() => { canvasRef.current?.endDictation(); rawDictation.current = null; }}
        onUpdate={(text, id, final, scope) => {
          if (!raw) {
            canvasRef.current?.updateDictation(text, id, final, scope === 'selection');
            return;
          }
          const textarea = rawTextareaRef.current;
          const current = textarea?.value ?? draft;
          let range = rawDictation.current;
          if (range?.id === id && range.document !== current) {
            // Follow edits outside the dictated range, but never overwrite a
            // writer's correction inside it.
            let start = 0, end = 0;
            while (start < current.length && start < range.document.length && current[start] === range.document[start]) start++;
            while (end < current.length - start && end < range.document.length - start && current[current.length - end - 1] === range.document[range.document.length - end - 1]) end++;
            const oldEnd = range.document.length - end;
            if (oldEnd <= range.from) { const delta = current.length - range.document.length; range.from += delta; range.to += delta; }
            else if (start < range.to) { if (final) rawDictation.current = null; return; }
          }
          if (!text && range?.id !== id) return;
          const cursor = textarea?.selectionStart ?? current.length;
          let from = range?.id === id ? range.from : cursor;
          let to = range?.id === id ? range.to : cursor;
          if (range?.id !== id && scope === 'selection') {
            from = textarea?.selectionStart ?? cursor;
            to = textarea?.selectionEnd ?? cursor;
            if (from === to) {
              from = current.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
              const nextLine = current.indexOf('\n', cursor);
              to = nextLine === -1 ? current.length : nextLine;
            }
          }
          if (!range || range.id !== id) {
            range = { id, from, to, text: '', document: current, prefix: from > 0 && !/\s/.test(current[from - 1]) && !/^[,.;:!?\s]/.test(text) ? ' ' : '', suffix: to < current.length && !/[\s,.;:!?]/.test(current[to]) ? ' ' : '' };
            rawDictation.current = range;
          }
          const next = text ? `${range.prefix}${text}${range.suffix}` : '';
          let common = 0;
          while (common < range.text.length && common < next.length && range.text[common] === next[common]) common++;
          from += common;
          // Explicit history is needed for unfocused textarea updates:
          // setRangeText does not enter the browser's native undo stack.
          if (textarea) {
            const focused = document.activeElement === textarea;
            const selection = [textarea.selectionStart, textarea.selectionEnd];
            if (focused) textarea.setSelectionRange(from, to);
            textarea.setRangeText(next.slice(common), from, to, focused ? 'end' : 'preserve');
            if (focused && selection[0] < range.from) textarea.setSelectionRange(selection[0], selection[1]);
            setDraft(textarea.value, `dictation:${id}`);
          } else setDraft(`${current.slice(0, from)}${next.slice(common)}${current.slice(to)}`, `dictation:${id}`);
          range.to = range.from + next.length; range.text = next; range.document = textarea?.value ?? `${current.slice(0, from)}${next.slice(common)}${current.slice(to)}`;
          if (final) rawDictation.current = null;
        }}
      />}
      {showAudio && <div className="border-b border-neutral-800 bg-neutral-900/30 p-3" data-testid="study-audio-panel"><AudioPanel
        entityKind="study_document"
        entityId={active.id}
        sourceMarkdown={draft}
        selectionText={audioSelection}
        cursorOffset={audioCursor}
        title={title}
        subjectId={subjectId}
        localOnly
        compact
      /></div>}

      <div className="editorial-editor-body flex min-h-0 flex-1" onKeyDownCapture={event => { if (locked && (event.target as Element).closest('.nodus-blocknote') && (event.metaKey || event.ctrlKey) && !['a', 'c'].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); } }} onInputCapture={() => setLastImprovement(null)} onMouseUp={(event) => { if (!(event.target as Element).closest('.scriptor-ai-panel')) { if ((event.target as Element).closest('.editorial-document-scroll')) captureImageCursor(); showSelectionImproveShortcuts(event); } }} onKeyUp={event => { if (!(event.target as Element).closest('.scriptor-ai-panel')) { if ((event.target as Element).closest('.editorial-document-scroll')) captureImageCursor(); showSelectionImproveShortcuts(event); } }} onDragOver={(event) => {
        if (event.dataTransfer.types.includes(port.dragType) || event.dataTransfer.types.includes('text/uri-list')) event.preventDefault();
      }} onDrop={(event) => void handleEditorDrop(event)}>

        {navigatorContent}
        <div className={`editorial-writing-column relative min-w-0 flex-1 overflow-hidden ${split ? 'grid grid-cols-2 divide-x divide-neutral-800' : ''}`}>
          <div className="editorial-improvement-feedback">
      {lastImprovement && !aiPanel && <div data-testid="study-improve-complete" className="editorial-improvement-complete"><Icon name="sparkles" size={14} /><span>{lastImprovement}</span><button data-testid="study-improve-undo" onClick={() => { runEditorHistory('undo'); setLastImprovement(null); }}>{t('Deshacer')}</button><button onClick={() => setLastImprovement(null)} aria-label={t('Cerrar')}><Icon name="x" size={12} /></button></div>}
          </div>
          <div className="editorial-document-scroll h-full min-h-0 overflow-y-auto">
            <EditorialTitle testId="editor-title" value={title} onChange={setTitle} readOnly={locked} />
            {raw && (improveStreamingStyleId || aiResult) && aiSource.current ? (
              <div className="scriptor-ai-raw-review" data-testid="scriptor-ai-raw-review">{aiSource.current.base.slice(0,aiSource.current.target.from)}<span data-testid="scriptor-ai-raw-target">{editorReviewDiff(aiSource.current.target.text, improvePreview, Boolean(aiResult)).map((piece,index) => <span key={index} className={piece.kind === 'same' ? undefined : `scriptor-ai-${piece.kind}`}>{piece.value}</span>)}</span>{aiSource.current.base.slice(aiSource.current.target.to)}</div>
            ) : raw ? (
              <textarea ref={rawTextareaRef} data-testid="study-markdown-editor" aria-label={t('Editor Markdown')} disabled={locked} className="h-full min-h-[560px] w-full resize-none bg-white p-6 font-mono text-sm leading-6 text-stone-800 outline-none dark:bg-neutral-950 dark:text-neutral-300"
                spellCheck lang={data.spellcheckLanguage} value={draft} onChange={(event) => setDraft(event.target.value, 'typing')}
                onKeyDown={event => {
                  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
                  const key = event.key.toLowerCase();
                  if (key === 'z' || key === 'y') { event.preventDefault(); runEditorHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo'); }
                }}
                onPaste={(event) => {
                  const html = event.clipboardData.getData('text/html');
                  if (!html) return;
                  event.preventDefault();
                  const markdown = turndown.turndown(html);
                  const start = event.currentTarget.selectionStart; const end = event.currentTarget.selectionEnd;
                  setDraft(`${draft.slice(0, start)}${markdown}${draft.slice(end)}`);
                }} />
            ) : (
              nativeDocument && <BlockNoteCanvas ref={canvasRef} key={`${active.id}-${editorRevision}`} documentId={`${active.id}-${editorRevision}`} value={draft} nativeDocument={nativeDocument} academicMetadata={academicMetadata} onAcademicAction={(action,payload)=>academicTools.current?.open(action,payload)} editable={!locked} onCreateImage={openImagePanel} aiReview={!raw && aiSource.current?.target.range && (improveStreamingStyleId || aiResult) ? { range: aiSource.current.target.range, original: aiSource.current.target.text, proposed: improvePreview, complete: Boolean(aiResult) } : null}
                spellcheck language={data.spellcheckLanguage} onChange={(value, native) => { if (!rawRef.current) { setDraftState(value); nativeRef.current = native; setNativeDocument(native); } }} onHistoryChange={setHistoryState} onOpenRecording={onOpenRecording} listReferences={port.listReferences} onNavigateLink={href => void navigateReference(href)} onWikiLink={reference => void port.listLinkTargets().then(targets => { const target=targets.find(item=>item.id===reference || item.title===reference); if(target) void openLinkedDocument(target.id); })} onToolbarElement={setSelectionToolbar} />
            )}
          </div>
          {split && <div className="min-h-full overflow-y-auto bg-stone-50 p-8 text-stone-900 dark:bg-neutral-900/20 dark:text-neutral-100"><Markdown content={draft} verify={false} onStudyDocument={(documentId) => void openLinkedDocument(documentId)} onStudyRecording={onOpenRecording} onTestimonyLink={onTestimonyLink} /></div>}
          {aiPanel && <ScriptorAiPanel mode={aiPanel} settings={settings} model={aiModel} onModelChange={setAiModel} styles={allImproveStyles} quickStyles={quickImproveStyles} styleId={aiStyleId} onStyleChange={chooseAiStyle} instructions={aiInstructions} onInstructionsChange={setAiInstructions} imagePrompt={imagePrompt} onImagePromptChange={setImagePrompt} imageModel={imageModel} imageChoices={imageChoices} onImageModelChange={setImageModel} status={improveStreamingStyleId ? 'streaming' : aiResult ? 'review' : imageBusy ? 'generating' : imageResult ? 'image-ready' : 'compose'} error={improveStreamError} warnings={aiResult?.warnings ?? []} image={imageResult} onSubmit={() => void (aiPanel === 'image' ? runImage() : runPolish())} onCancel={cancelAi} onAccept={acceptProposal} onReject={() => { discardProposal(); setImproveStreamError(''); }} onImage={openImagePanel} onPolish={() => openPolish(resolveImproveSelection(false))} onInsert={insertImage} onClose={closeAiPanel} onLayout={() => { if (aiPanel !== 'polish') return; const range = aiSource.current?.target.range; if (range && !raw) canvasRef.current?.revealAiSelection(range); else if (raw) document.querySelector('[data-testid="scriptor-ai-raw-target"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }} />}

        </div>

        {!globalFocus && contextOpen && (
          <EditorialInspector activeTab={contextTab} tabs={(['sources','comments','details'] as const).map(id=>({id,label:t(id==='sources'?'Fuentes':id==='comments'?'Comentarios':'Detalles')}))} onTabChange={id=>setContextTab(id as typeof contextTab)} onClose={()=>setContextOpen(false)}>
            <div className="editorial-context-views"><button aria-pressed={contextTab === 'structure'} onClick={() => setContextTab('structure')}>{t('Estructura')}</button><button aria-pressed={contextTab === 'checks'} onClick={() => setContextTab('checks')}>{t('Comprobaciones')}</button><button aria-pressed={contextTab === 'outline'} onClick={() => setContextTab('outline')}>{t('Esquema')}</button><button aria-pressed={contextTab === 'history'} onClick={() => { setContextTab('history'); }}>{t('Historial')}</button><button aria-pressed={contextTab === 'assistant'} onClick={() => setContextTab('assistant')}>{t('Asistente')}</button></div>
            {contextTab === 'sources' && <><AcademicPanel document={nativeDocument??[]} metadata={academicMetadata} onChange={setAcademicMetadata} canvas={canvasRef.current} view="sources" onOpenSource={(href,evidence)=>void navigateReference(href,evidence)} onSettings={()=>academicTools.current?.open('settings')} /><EditorialReferences items={documentReferences(nativeDocument)} onOpen={href => void navigateReference(href)} />{contextSources}</>}
            {(contextTab==='checks'||contextTab==='structure')&&<AcademicPanel document={nativeDocument??[]} metadata={academicMetadata} onChange={setAcademicMetadata} canvas={canvasRef.current} view={contextTab} unresolvedComments={data.annotations.filter(a=>!a.resolvedAt).length} onOpenSource={(href,evidence)=>void navigateReference(href,evidence)} onSettings={()=>academicTools.current?.open('settings')} />}
            {contextTab === 'details' && contextDetails}
            {contextTab === 'outline' && <DocOutline markdown={draft} onJump={jumpToHeading} />}
            {contextTab === 'assistant' && <div className="p-4"><div data-testid="study-editor-model-picker"><ModelPicker settings={settings} value={aiModel} onChange={setAiModel} compact menu allowEmpty={false} triggerModelOnly /></div><button className="btn mt-3" onClick={() => openImprovePrompts()}>{t('Prompts de mejora')}</button>{quickImproveStyles.map(prompt => <button data-testid={`study-toolbar-quick-improve-${prompt.id.replace(':', '-')}`} className="btn w-full mt-2" key={prompt.id} onClick={() => void runQuickImprovement(prompt)}>{studyStyleDisplay(prompt).name}</button>)}</div>}
      {contextTab === 'details' && (
        <div className="grid grid-cols-2 gap-3 p-4">
          {onUpdateMetadata && <label className="text-[10px] text-neutral-500">{t('Tipo de material')}<select data-testid="study-doc-kind" className="input mt-1 w-full" value={active.kind} onChange={(event) => void onUpdateMetadata({ kind: event.target.value as StudyDocumentKind })}>{STUDY_DOCUMENT_KINDS.map((kind) => <option key={kind} value={kind}>{t(STUDY_KIND_LABEL[kind])}</option>)}</select></label>}
          {onUpdateMetadata && <label className="text-[10px] text-neutral-500">{t('Color')}<input data-testid="study-doc-color" type="color" className="input mt-1 h-9 w-full p-1" value={active.color || '#0f766e'} onChange={(event) => void onUpdateMetadata({ color: event.target.value })} /></label>}
          <label className="text-[10px] text-neutral-500">{t('Tipografía')}<select className="input mt-1 w-full" value={style.fontFamily} onChange={(event) => setStyle({ ...style, fontFamily: event.target.value as StudyDocStyle['fontFamily'] })}><option value="serif">Serif</option><option value="sans">Sans</option><option value="mono">Mono</option></select></label>
          <label className="text-[10px] text-neutral-500">{t('Tamaño')}<input type="number" min="12" max="32" className="input mt-1 w-full" value={style.fontSize} onChange={(event) => setStyle({ ...style, fontSize: Number(event.target.value) })} /></label>
          <label className="text-[10px] text-neutral-500">{t('Interlineado')}<input type="number" step="0.1" min="1.1" max="2.5" className="input mt-1 w-full" value={style.lineHeight} onChange={(event) => setStyle({ ...style, lineHeight: Number(event.target.value) })} /></label>
          <label className="text-[10px] text-neutral-500">{t('Ancho de página')}<input type="number" min="520" max="1400" className="input mt-1 w-full" value={style.pageWidth} onChange={(event) => setStyle({ ...style, pageWidth: Number(event.target.value) })} /></label>
          <label className="text-[10px] text-neutral-500">{t('Márgenes')}<input type="number" min="16" max="160" className="input mt-1 w-full" value={style.marginX} onChange={(event) => setStyle({ ...style, marginX: Number(event.target.value) })} /></label>
          <label className="text-[10px] text-neutral-500">{t('Sangría')}<input type="number" min="0" max="80" className="input mt-1 w-full" value={style.firstLineIndent} onChange={(event) => setStyle({ ...style, firstLineIndent: Number(event.target.value) })} /></label>
          <label className="text-[10px] text-neutral-500">{t('Alineación')}<select className="input mt-1 w-full" value={style.alignment} onChange={(event) => setStyle({ ...style, alignment: event.target.value as StudyDocStyle['alignment'] })}><option value="justify">{t('Justificada')}</option><option value="left">{t('Izquierda')}</option><option value="center">{t('Centro')}</option><option value="right">{t('Derecha')}</option></select></label>
          <label className="text-[10px] text-neutral-500">{t('Tema visual')}<select className="input mt-1 w-full" value={style.theme} onChange={(event) => setStyle({ ...style, theme: event.target.value as StudyDocStyle['theme'] })}><option value="paper">{t('Papel')}</option><option value="soft">{t('Suave')}</option><option value="contrast">{t('Contraste')}</option></select></label>
          <label className="text-[10px] text-neutral-500">{t('Corrector')}<select className="input mt-1 w-full" value={data.spellcheckLanguage} onChange={(event) => setData({ ...data, spellcheckLanguage: event.target.value })}><option value="es-ES">Español</option><option value="en-US">English</option><option value="fr-FR">Français</option><option value="pt-PT">Português</option></select></label>
          <label className="col-span-2 text-[10px] text-neutral-500">{t('Diccionario personal')}
            <span className="mt-1 flex gap-1"><input className="input min-w-0 flex-1" value={dictionaryWord} onChange={(event) => setDictionaryWord(event.target.value)} placeholder={data.customDictionary.join(', ') || t('Añadir término')} />
              <button className="btn btn-ghost px-2" onClick={() => {
                const word = dictionaryWord.trim();
                if (!word || data.customDictionary.some((item) => item.toLocaleLowerCase() === word.toLocaleLowerCase())) return;
                setData({ ...data, customDictionary: [...data.customDictionary, word] }); setDictionaryWord('');
              }}><Icon name="plus" size={12} /></button></span>
          </label>
          {onSetTags && <div className="col-span-2 text-[10px] text-neutral-500 sm:col-span-4 lg:col-span-6">
            <span>{t('Etiquetas')}</span>
            <div className="mt-1 flex min-h-9 flex-wrap items-center gap-1.5">
              {tags.map((tag) => {
                const selected = activeTagIds.includes(tag.id);
                return <button key={tag.id} type="button" className={`rounded-full border px-2 py-1 text-[10px] ${selected ? 'border-indigo-700 bg-indigo-900/40 text-indigo-300' : 'border-neutral-800 text-neutral-600 hover:text-neutral-300'}`}
                  onClick={() => void onSetTags(selected ? activeTagIds.filter((id) => id !== tag.id) : [...activeTagIds, tag.id])}>{tag.name}</button>;
              })}
              <button type="button" className="rounded-full border border-dashed border-neutral-700 px-2 py-1 text-[10px] text-neutral-500 hover:border-indigo-700 hover:text-indigo-300" onClick={() => setTextDialog({ kind: 'tag' })}>+ {t('Etiqueta')}</button>
            </div>
          </div>}
        </div>
      )}

            {contextTab === 'comments' && data.annotations.length === 0 && <div className="editorial-empty"><p>{t('No hay comentarios en este documento.')}</p><button className="editorial-header-action mt-3" onClick={()=>setTextDialog({kind:'comment'})}><Icon name="chat" size={13} />{t('Añadir comentario')}</button></div>}
            {contextTab === 'comments' && data.annotations.length > 0 && (
              <section className="mb-5">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Comentarios y fragmentos')}</h3>
                <div className="space-y-2">{data.annotations.map((annotation) => (
                  <div key={annotation.id} className={`rounded-lg border p-2.5 ${annotation.resolvedAt ? 'border-neutral-900 opacity-50' : 'border-neutral-800'}`}>
                    {annotation.anchorStatus && annotation.anchorStatus !== 'attached' && <p className="text-xs text-amber-600">{t(annotation.anchorStatus === 'ambiguous' ? 'Anclaje ambiguo' : 'Bloque original no localizado')}</p>}{annotation.selectedText && <p className="mb-1 line-clamp-2 border-l-2 border-indigo-600 pl-2 text-[10px] italic text-neutral-500">{annotation.selectedText}</p>}
                    <p className="text-xs leading-5 text-neutral-300">{annotation.comment}</p>
                    <div className="editorial-comment-actions mt-2 flex flex-wrap gap-1">
                      <button className="text-[10px] text-neutral-600 hover:text-indigo-300" onClick={() => void updateAnnotation(annotation, { pinned: !annotation.pinned })}>{annotation.pinned ? t('Desfijar') : t('Fijar')}</button>
                      <button className="text-[10px] text-neutral-600 hover:text-indigo-300" onClick={() => void updateAnnotation(annotation, { locked: !annotation.locked })}>{annotation.locked ? t('Desbloquear') : t('Bloquear')}</button>
                      <button className="ml-auto text-[10px] text-neutral-600 hover:text-emerald-300" onClick={() => void updateAnnotation(annotation, { resolved: !annotation.resolvedAt })}>{annotation.resolvedAt ? t('Reabrir') : t('Resolver')}</button>
                    </div>
                  </div>
                ))}</div>
              </section>
            )}
            {contextTab === 'sources' && data.backlinks.length > 0 && (
              <section className="mb-5">
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Backlinks')}</h3>
                {data.backlinks.map((link) => {
                  const source = documents.find((document) => document.id === link.sourceDocumentId);
                  return <button key={link.id} className="mb-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-neutral-500 hover:bg-neutral-900 hover:text-indigo-300" onClick={() => void openLinkedDocument(link.sourceDocumentId)}><Icon name="link" size={11} /><span className="truncate">{source?.title ?? link.sourceDocumentId}</span></button>;
                })}
              </section>
            )}
            {contextTab === 'history' && (
              <section>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">{t('Historial de versiones')}</h3>
                {data.versions.length === 0 ? <p className="text-xs text-neutral-600">{t('El historial aparecerá después del primer cambio guardado.')}</p> : data.versions.map((version) => (
                  <div key={version.id} className="mb-2 rounded-lg border border-neutral-800 p-2">
                    <button className="w-full text-left" onClick={() => setSelectedVersion(selectedVersion?.id === version.id ? null : version)}>
                      <span className="block text-xs text-neutral-300">v{version.versionNo} · {t(version.reason)}</span>
                      <span className="text-[10px] text-neutral-600">{new Date(version.createdAt).toLocaleString()}</span>
                    </button>
                    {selectedVersion?.id === version.id && <><div className="mt-2"><VersionDiff version={version} current={draft} /></div><button className="btn btn-ghost mt-2 w-full text-xs" onClick={() => void restoreVersion(version)}>{t('Restaurar esta versión')}</button></>}
                  </div>
                ))}
              </section>
            )}
          </EditorialInspector>
        )}
        {selectionImprove && selectionToolbar && !locked && createPortal(<><div className="divider" data-testid="study-selection-tools-divider" /><button type="button" data-testid="study-selection-improve" className="toolbar-item study-selection-tool" aria-label={t('Pulir')} onPointerDown={event => { event.preventDefault(); openPolish(selectionImprove.target); }}><Icon name="aiPolish" size={16} />{t('Pulir')}</button>{settings.academicMode !== 'manual' && <button type="button" data-testid="study-synonyms-toggle" className="toolbar-item study-selection-tool study-synonyms-trigger" title={t('Sinónimos con IA')} aria-label={t('Sinónimos con IA')} disabled={locked} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); openSynonymPanel(event.currentTarget, selectionImprove.target); }}><Icon name="aiSynonyms" size={16} /></button>}<label className="toolbar-item study-selection-color" title={t('Color del texto')} aria-label={t('Color del texto')}><Icon name="palette" size={16} /><input data-testid="study-selection-text-color" aria-label={t('Color del texto')} type="color" defaultValue="#0f766e" onInput={(event) => canvasRef.current?.setTextColor((event.target as HTMLInputElement).value)} /></label><span title={t('Nivel de título')}><select data-testid="study-selection-heading" className="study-selection-heading" defaultValue="" aria-label={t('Nivel de título')} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => { canvasRef.current?.setHeading(Number(event.target.value)); event.target.value = ''; }}><option value="" disabled>H</option><option value="0">{t('Párrafo')}</option>{[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>H{level}</option>)}</select></span></>, selectionToolbar)}
      </div>
      {raw && selectionImprove && !locked && createPortal(<button type="button" className="scriptor-raw-polish" data-testid="study-selection-improve" onPointerDown={event => { event.preventDefault(); openPolish(selectionImprove.target); }} style={{ position:'fixed',left:selectionImprove.x,top:selectionImprove.y,zIndex:40 }}><Icon name="aiPolish" size={15} />{t('Pulir')}</button>, document.body)}
      {synonymPanel && createPortal(
        <div ref={synonymPanelRef} data-testid="study-synonyms-panel" role="dialog" aria-label={t('Alternativas de sinónimos')} className="study-synonyms-panel" style={{ left: synonymPanel.x, top: synonymPanel.y }}>
          <div className="study-synonyms-header">
            <span className="flex min-w-0 items-center gap-2"><Icon name="aiSynonyms" size={16} className="scriptor-accent-text" /><span className="truncate font-semibold">{t('Sinónimos y reformulaciones')}</span></span>
            <button type="button" className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100" onClick={closeSynonymPanel} aria-label={t('Cerrar')}><Icon name="x" size={13} /></button>
          </div>
          <p className="px-3 pb-2 text-[11px] leading-4 text-neutral-500">{t('Cinco alternativas en el idioma original, elegidas con el contexto de la frase.')}</p>
          {synonymPanel.loading && synonymPanel.rounds.length === 0 && <div className="flex items-center gap-2 px-3 py-6 text-xs text-neutral-500" data-testid="study-synonyms-loading"><Spinner label={t('Buscando alternativas…')} /></div>}
          {synonymPanel.rounds.length > 0 && <div className="max-h-72 overflow-y-auto px-2 pb-2">
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Alternativas actuales')}</div>
            <SynonymAlternativeList alternatives={synonymPanel.rounds.at(-1) ?? []} selectedText={synonymPanel.target.text} onSelect={applySynonymAlternative} />
            {synonymPanel.rounds.length > 1 && <details className="mt-2 border-t border-stone-200 pt-2 dark:border-neutral-800" open>
              <summary className="cursor-pointer px-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">{t('Historial de esta apertura')}</summary>
              <div className="mt-1 space-y-2">{synonymPanel.rounds.slice(0, -1).reverse().map((round, index) => <div key={`${synonymPanel.sessionId}-${index}`}><SynonymAlternativeList alternatives={round} selectedText={synonymPanel.target.text} onSelect={applySynonymAlternative} historical /></div>)}</div>
            </details>}
          </div>}
          {synonymPanel.error && <div data-testid="study-synonyms-error" className="mx-3 mb-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{synonymPanel.error}</div>}
          <div className="flex items-center justify-between border-t border-stone-200 px-3 py-2 dark:border-neutral-800">
            <span className="text-[10px] text-neutral-500">{synonymPanel.rounds.length > 1 ? `${synonymPanel.rounds.length * 5} ${t('alternativas en memoria')}` : ''}</span>
            <button type="button" data-testid="study-synonyms-regenerate" className="btn btn-ghost scriptor-accent-text h-8 gap-1.5 px-2 text-xs" disabled={synonymPanel.loading} onClick={regenerateSynonyms}><Icon name="refresh" size={13} className={synonymPanel.loading ? 'animate-spin' : ''} />{t('Regenerar alternativas')}</button>
          </div>
        </div>,
        document.body,
      )}
      {pendingCloseId && <ConfirmModal
        title={t('Cerrar apunte')}
        message={pendingCloseId === active.id && saveState !== 'saved'
          ? t('Se guardarán los cambios pendientes antes de cerrar la pestaña. El apunte seguirá disponible en su ubicación.')
          : t('La pestaña se cerrará, pero el apunte seguirá guardado y disponible en su ubicación.')}
        confirmLabel={t('Cerrar pestaña')}
        onCancel={() => setPendingCloseId(null)}
        onConfirm={() => void confirmClose()}
      />}
      {tableDialogOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-6" onClick={() => setTableDialogOpen(false)}>
          <div className="card w-full max-w-sm p-5" role="dialog" aria-modal="true" aria-labelledby="study-table-dialog-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="study-table-dialog-title" className="mb-1 font-semibold">{t('Insertar tabla')}</h2>
            <p className="mb-5 text-sm text-neutral-500">{t('Elige el tamaño inicial. Después podrás editar cada celda.')}</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-neutral-500">{t('Filas')}
                <input autoFocus className="input mt-1 w-full" type="number" min="1" max="20" value={tableRows} onChange={(event) => setTableRows(Number(event.target.value))} />
              </label>
              <label className="text-xs text-neutral-500">{t('Columnas')}
                <input className="input mt-1 w-full" type="number" min="1" max="12" value={tableColumns} onChange={(event) => setTableColumns(Number(event.target.value))} />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setTableDialogOpen(false)}>{t('Cancelar')}</button>
              <button className="btn btn-primary" onClick={insertTable}><Icon name="table" size={13} /> {t('Insertar')}</button>
            </div>
          </div>
        </div>
      )}
      {textDialog && (
        <TextInputModal
          testId={`study-${textDialog.kind}-dialog`}
          title={textDialog.kind === 'tag'
            ? t('Nueva etiqueta')
            : textDialog.selectedText ? t('Comentario sobre la selección') : t('Comentario del documento')}
          label={textDialog.kind === 'tag' ? t('Nombre de la etiqueta') : t('Comentario')}
          multiline={textDialog.kind === 'comment'}
          onSubmit={submitTextDialog}
          onCancel={() => setTextDialog(null)}
        />
      )}
      {showImprovePrompts && createPortal(<StudyImproveDialog onClose={() => { setShowImprovePrompts(false); void loadQuickImproveStyles(); }} onToolbarChanged={setQuickImproveStyles} onApply={prompt => { setShowImprovePrompts(false); setAllImproveStyles(current => current.some(style => style.id === prompt.id) ? current.map(style => style.id === prompt.id ? prompt : style) : [...current, prompt]); const target = improveTargetRef.current ?? resolveImproveSelection(false); openPolish(target, prompt); }} />, document.body)}
    </div>
  );
}
