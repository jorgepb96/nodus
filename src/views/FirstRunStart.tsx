import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, ModelRef, RecoveryStatus, VaultSummary, ZoteroCollection } from '@shared/types';
import { LEARNING_VERSION, newPractice } from '@shared/academicLearning';
import { DEFAULT_EMBEDDING_MODELS } from '@shared/providers';
import { learningText } from '@shared/academicLearningCopy';
import {
  STARTER_DOCUMENT_LIMIT,
  STARTER_INSPECTION_LIMIT,
  pickStarterDocuments,
  starterProgress,
  type StarterFailure,
  type StarterProgress,
} from '@shared/firstRunSources';
import { OnboardingModelStep } from '../components/OnboardingModelStep';
import { ZoteroConnectionNotice } from '../components/ZoteroConnectionNotice';
import { NodiAvatar } from '../components/nodi/NodiAvatar';
import { Icon } from '../components/ui';
import { useZoteroConnection } from '../hooks/useZoteroConnection';
import { saveLearningModels } from '../learning/learningModelSetup';
import { requestLearningPrompt } from '../learning/learningPrompt';
import { zoteroFailureText } from '../lib/zoteroConnection';
import type { View } from '../navigation';
import { errorText, t, tx } from '../i18n';
import zoteroLogo from '../assets/nodus-logo-zotero.svg';
import { RecoverySetupWizard } from './RecoverySetupWizard';
import '../learning/academicLearning.css';
import './firstRunStart.css';

type Source = 'zotero' | 'files' | 'example';
type Stage = 'sources' | 'recovery' | 'ai' | 'working';
type WorkStep = 'models' | 'import' | 'prepare';
interface PickedFile { path: string; name: string }

/** A failure the screen can explain; anything else is shown as the error it was. */
class FirstRunFailure extends Error {
  constructor(readonly kind: 'no-documents' | StarterFailure) { super(kind); }
}

const WORK_STEPS: readonly WorkStep[] = ['models', 'import', 'prepare'];
const POLL_MS = 1500;

/**
 * The first screen a new academic vault shows: bring some sources, pick the AI, and
 * land in the chat with a question ready to send.
 *
 * It replaces a welcome card that offered a guide and then left the newcomer in an
 * empty Library. Everything the guide's first two steps asked for one click at a time
 * (find the add button, tick one work, configure two models, accept the indexing
 * dialog, wait in the queue) happens here from three answers, and Zotero — the reason
 * most people install Nodus — is the first option instead of a submenu.
 *
 * It hands over to the existing `first-answer` practice at its third step, so the last
 * two things the user does are the ones worth doing by hand: ask, and open the citation.
 */
export function FirstRunStart({
  settings,
  vault,
  onDone,
  reloadRecoveryStatus,
}: {
  settings: AppSettings;
  vault: VaultSummary;
  /** Leave the startup sequence; with a view, open the app there. */
  onDone: (view?: View) => Promise<unknown>;
  reloadRecoveryStatus: () => Promise<unknown>;
}) {
  const language = settings.uiLanguage;
  const [stage, setStage] = useState<Stage>('sources');
  const [source, setSource] = useState<Source | null>(null);
  const [workMode, setWorkMode] = useState<'auto' | 'manual'>(settings.academicMode ?? 'auto');
  const manual = workMode === 'manual';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // ── Zotero ────────────────────────────────────────────────────────────────
  const zotero = useZoteroConnection();
  const zoteroReady = zotero.status?.ok === true;
  const [collections, setCollections] = useState<ZoteroCollection[] | null>(null);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set());
  const [collectionsReload, setCollectionsReload] = useState(0);
  useEffect(() => {
    if (!zoteroReady) return;
    let cancelled = false;
    setCollectionsError(null);
    (async () => {
      const libraries = await window.nodus.zoteroLibraries();
      const groups = await Promise.all(libraries.map((library) => window.nodus.zoteroCollections(library)));
      if (!cancelled) setCollections(groups.flat());
    })().catch((cause) => { if (!cancelled) { setCollections([]); setCollectionsError(zoteroFailureText(cause)); } });
    return () => { cancelled = true; };
  }, [zoteroReady, collectionsReload]);
  // A Zotero that answers is the likeliest reason this person is here: offer it first.
  // Only while nothing has been chosen — never over a decision already made.
  useEffect(() => {
    if (zoteroReady) setSource((current) => current ?? 'zotero');
  }, [zoteroReady]);

  // ── Files ─────────────────────────────────────────────────────────────────
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list)
      .map((file) => ({ path: window.nodus.getPathForDroppedFile(file), name: file.name }))
      .filter((file): file is PickedFile => !!file.path);
    setSource('files');
    setFiles((current) => {
      const known = new Set(current.map((file) => file.path));
      return [...current, ...picked.filter((file) => !known.has(file.path))];
    });
  };

  // ── AI ────────────────────────────────────────────────────────────────────
  const [model, setModel] = useState<ModelRef | null>(settings.chatModel ?? settings.synthesisModel);
  const [embedding, setEmbedding] = useState<ModelRef | null>(null);

  // ── Work ──────────────────────────────────────────────────────────────────
  const [workStep, setWorkStep] = useState<WorkStep>('models');
  const [download, setDownload] = useState('');
  const [starterIds, setStarterIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<StarterProgress | null>(null);
  const [failure, setFailure] = useState<{ step: WorkStep; message: string } | null>(null);
  const [importedCount, setImportedCount] = useState(0);
  const handedOver = useRef(false);

  /** Everything the old welcome wrote when it let the user through. */
  const completeWelcome = useCallback(() => window.nodus.updateSettings({
    academicMode: workMode,
    onboardingComplete: true,
    tourComplete: true,
    advancedTourComplete: true,
    academicInterfaceProfile: 'simple',
    academicLearningProgress: {
      version: LEARNING_VERSION,
      invitationsEligible: true,
      welcomeComplete: true,
      freshIntroductionPending: false,
      lessons: settings.academicLearningProgress?.lessons ?? {},
    },
    autoLightScan: false,
    autoDeepScanOnReadTag: false,
  }), [workMode, settings.academicLearningProgress?.lessons]);

  /**
   * Manual mode indexes the ideas a person writes on this computer (Multilingual E5), as
   * the old wizard promised. Choosing Manual does not change the embedding model by
   * itself — on purpose: an index someone already uses is never replaced silently — so
   * the first run chooses it explicitly, while the vault is still empty and the switch
   * is allowed. If it cannot happen, the vault still works and Settings can fix it.
   */
  const prepareManualIndex = async () => {
    if (!manual) return;
    await window.nodus.updateSettings({ embeddingProvider: 'nodus', embeddingModel: DEFAULT_EMBEDDING_MODELS.nodus }).catch(() => null);
  };

  const guarded = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };

  /** "Not now": into the app with nothing set up, invitations left on. */
  // The session flags are written BEFORE the settings: saving them is broadcast to the
  // shell, which re-reads its settings at once, and a flag set afterwards arrives too
  // late to stop the invitation it was meant to stop.
  // It opens on the Library: an empty chat is a dead end for someone with no sources,
  // while the empty Library says what to do and has the two buttons that do it.
  const skip = () => guarded(async () => {
    sessionStorage.setItem('nodus.learning.skip-first', '1');
    await prepareManualIndex();
    await completeWelcome();
    await onDone('library');
  });
  /** The step-by-step guide, for those who would rather be walked through the app. */
  const openGuide = () => guarded(async () => {
    sessionStorage.setItem('nodus.learning.open', JSON.stringify({ vaultId: vault.id, lessonId: 'first-answer', mode: 'guide' }));
    await prepareManualIndex();
    await completeWelcome();
    await onDone();
  });
  /** The example lives in an isolated practice, so the user's vault stays their own. */
  const openExample = () => guarded(async () => {
    sessionStorage.setItem('nodus.learning.skip-first', '1');
    await completeWelcome();
    await onDone();
    await window.nodus.openAcademicLearningWorkspace('first-answer');
  });

  const sourcesReady = source === 'example'
    || (source === 'files' && files.length > 0)
    || (source === 'zotero' && zoteroReady && selectedCollections.size > 0);

  // The Library is stored in the recovery folder. A first run prepares one without
  // asking; if that could not happen (an earlier Nodus folder is already there, or the
  // disk refused), this is the moment the wizard is genuinely needed.
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null);
  const continueFromSources = () => source === 'example' ? openExample() : guarded(async () => {
    const status = await window.nodus.getRecoveryStatus();
    setRecoveryStatus(status);
    setStage(status.needsSetup ? 'recovery' : 'ai');
  });

  /** Bring the chosen sources into the vault; returns their research document ids. */
  const importSources = async (): Promise<string[]> => {
    if (source === 'files') {
      const report = await window.nodus.importDroppedFilesIntoVault(files.map((file) => file.path), vault.id);
      const itemIds = new Set([...report.itemIds, ...(report.existingItemIds ?? [])]);
      window.dispatchEvent(new Event('nodus:data-changed'));
      const { documents } = await window.nodus.getResearchCorpusSources();
      const found = documents.filter((document) => itemIds.has(document.libraryItemId ?? '') || itemIds.has(document.workId ?? '') || itemIds.has(document.id));
      if (!found.length && report.warnings.length) throw new Error(report.warnings[0]);
      return found.map((document) => document.id);
    }
    // Zotero: the chosen collections become the ones this vault follows, and one
    // catalogue pass brings their references in. No analysis is started.
    await window.nodus.updateSettings({ monitoredCollections: [...selectedCollections] });
    await window.nodus.syncNow({ catalogOnly: true });
    window.dispatchEvent(new Event('nodus:data-changed'));
    // A synced reference is a work of this vault that carries its Zotero key; the
    // research layer lists it like any other document, so the key is what identifies it.
    const [{ documents }, works] = await Promise.all([window.nodus.getResearchCorpusSources(), window.nodus.listWorks()]);
    const fromZotero = new Set(works.filter((work) => work.zotero_key).map((work) => work.nodus_id));
    return documents.filter((document) => document.workId && fromZotero.has(document.workId) && !document.noteId).map((document) => document.id);
  };

  const run = async (from: WorkStep = 'models') => {
    if (!model || (!manual && !embedding)) return;
    setStage('working'); setFailure(null);
    let step: WorkStep = from;
    try {
      if (from === 'models') {
        step = 'models'; setWorkStep(step);
        await prepareManualIndex();
        const saved = await saveLearningModels({ purpose: 'chat', model, embedding: manual ? null : embedding, onDownload: setDownload, runtimeLabel: t('Motor de IA local') });
        if (!saved) { setStage('ai'); return; }
      }
      step = 'import'; setWorkStep(step);
      const documentIds = await importSources();
      setImportedCount(documentIds.length);
      if (!documentIds.length) throw new FirstRunFailure('no-documents');

      step = 'prepare'; setWorkStep(step);
      // A handful of files is prepared whole. A Zotero collection can hold hundreds of
      // works, so its files are inspected first and only the readable ones start.
      const inspected = source === 'zotero' ? documentIds.slice(0, STARTER_INSPECTION_LIMIT) : documentIds;
      const preview = await window.nodus.previewResearchPreparation({ scope: 'selection', documentIds: inspected, inspect: source === 'zotero' });
      if (preview.block === 'no_model' && !manual) throw new FirstRunFailure('no-model');
      const starter = source === 'zotero'
        ? pickStarterDocuments(preview.documents, preview.preflight ?? [], STARTER_DOCUMENT_LIMIT)
        : preview.documents;
      if (!starter.length) throw new FirstRunFailure('no-documents');
      const ids = starter.map((document) => document.id);
      await window.nodus.startResearchPreparationCampaign({ previewId: preview.id, mode: manual ? 'text' : 'embeddings', documentIds: ids });
      await window.nodus.setResearchPreparationPolicy({ welcomeVersion: 1, decision: 'accepted' });
      setProgress(null);
      setStarterIds(ids);
    } catch (cause) {
      setFailure({ step, message: cause instanceof FirstRunFailure ? failureText(cause.kind) : errorText(cause) });
    }
  };

  /** Into the chat, with the practice already past "choose" and "prepare". */
  const handOver = useCallback(async (ready: NonNullable<StarterProgress['ready']>) => {
    if (handedOver.current) return;
    handedOver.current = true;
    const documentId = ready.workId ?? ready.id;
    const session = { ...newPractice(vault.id, 'first-answer', crypto.randomUUID()), step: 2, documentId, documentRevision: ready.revision };
    // The practice is already under way; an invitation to start it would only cover it.
    sessionStorage.setItem('nodus.learning.skip-first', '1');
    await window.nodus.updateAcademicLearning(vault.id, { academicPracticeSession: session });
    await completeWelcome();
    requestLearningPrompt({ vaultId: vault.id, sessionId: session.id, documentId, prompt: learningText('suggestedQuestion', language) });
    await onDone('researchChat');
  }, [completeWelcome, language, onDone, vault.id]);

  // Watch the starter set. One searchable document is enough to move on; the others
  // keep preparing in the background and join the chat's reach as they finish.
  useEffect(() => {
    if (stage !== 'working' || !starterIds.length || failure) return;
    let cancelled = false;
    const read = async () => {
      try {
        const inventory = await window.nodus.getResearchPreparationInventory();
        if (cancelled) return;
        const next = starterProgress(inventory.documents, starterIds, manual);
        setProgress(next);
        if (next.ready) await handOver(next.ready);
        else if (next.failure) setFailure({ step: 'prepare', message: failureText(next.failure) });
      } catch (cause) {
        if (!cancelled) setFailure({ step: 'prepare', message: errorText(cause) });
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), POLL_MS);
    const stop = window.nodus.onResearchPreparationProgress(() => void read());
    return () => { cancelled = true; window.clearInterval(timer); stop(); };
  }, [stage, starterIds, failure, manual, handOver]);

  /** Stop waiting: the app opens on the Library and the guide carries on from there. */
  const continueInBackground = () => guarded(async () => {
    handedOver.current = true;
    sessionStorage.setItem('nodus.learning.skip-first', '1');
    const first = progress?.active;
    if (first) {
      const session = { ...newPractice(vault.id, 'first-answer', crypto.randomUUID()), step: 1, documentId: first.workId ?? first.id };
      await window.nodus.updateAcademicLearning(vault.id, { academicPracticeSession: session });
    }
    await completeWelcome();
    await onDone('library');
  });

  const selectedCount = selectedCollections.size;
  const toggleCollection = (key: string, checked: boolean) => setSelectedCollections((current) => {
    const next = new Set(current);
    if (checked) next.add(key); else next.delete(key);
    return next;
  });

  if (stage === 'recovery' && recoveryStatus) {
    return (
      <RecoverySetupWizard
        status={recoveryStatus}
        language={language}
        onComplete={async () => { await reloadRecoveryStatus(); setStage('ai'); }}
      />
    );
  }

  return (
    <div className="first-run h-full overflow-auto" data-testid="academic-learning-welcome" data-stage={stage}>
      <main className="first-run-card card">
        <header className="first-run-head">
          <NodiAvatar state={stage === 'working' ? 'thinking' : 'waving'} height={84} />
          <div>
            <span className="learning-eyebrow">Nodus · {vault.name} · {tx('Paso {n} de {total}', { n: stage === 'sources' ? 1 : stage === 'ai' ? 2 : 3, total: 3 })}</span>
            <h1 className="first-run-title">
              {stage === 'sources' && t('¿Con qué fuentes quieres empezar?')}
              {stage === 'ai' && t('Elige la IA que responderá')}
              {stage === 'working' && (failure ? t('Algo no ha salido bien') : t('Preparando tu primera respuesta'))}
            </h1>
            <p className="first-run-lead">
              {stage === 'sources' && t('Trae unas pocas fuentes. En un par de minutos podrás hacerles preguntas y ver de qué pasaje sale cada respuesta.')}
              {stage === 'ai' && t('Nodus usa la IA de tu proveedor: conecta tu clave y elige un modelo. El uso lo factura tu proveedor, no Nodus.')}
              {stage === 'working' && !failure && t('No tienes que hacer nada: en cuanto la primera fuente esté lista se abrirá el chat con una pregunta preparada.')}
            </p>
          </div>
        </header>

        {stage === 'sources' && (
          <>
            <div className="first-run-sources" role="radiogroup" aria-label={t('¿Con qué fuentes quieres empezar?')}>
              <SourceCard
                id="zotero"
                selected={source === 'zotero'}
                onSelect={() => setSource('zotero')}
                icon={<img src={zoteroLogo} alt="" aria-hidden="true" className="h-6 w-6" />}
                title={t('Mi biblioteca de Zotero')}
                body={t('Elige colecciones y Nodus las lee tal como están. No cambia nada en Zotero.')}
                badge={zotero.status === null
                  ? { tone: 'neutral', label: t('Buscando Zotero…') }
                  : zoteroReady ? { tone: 'ok', label: t('Zotero detectado') } : { tone: 'warn', label: t('Zotero no detectado') }}
              />
              <SourceCard
                id="files"
                selected={source === 'files'}
                onSelect={() => setSource('files')}
                icon={<Icon name="file" size={22} />}
                title={t('Archivos de mi ordenador')}
                body={t('PDF, EPUB, Word o texto. Puedes arrastrarlos aquí.')}
                badge={files.length ? { tone: 'ok', label: tx('{n} archivo(s)', { n: files.length }) } : undefined}
              />
              <SourceCard
                id="example"
                selected={source === 'example'}
                onSelect={() => setSource('example')}
                icon={<Icon name="play" size={22} />}
                title={t('Un documento de ejemplo')}
                body={t('Para ver cómo funciona antes de traer nada tuyo.')}
              />
            </div>

            <section className="first-run-detail" data-testid="first-run-detail" aria-live="polite">
              {source === null && <p className="first-run-hint">{t('Elige una opción para continuar. Podrás añadir más fuentes de cualquier tipo cuando quieras.')}</p>}

              {source === 'zotero' && !zoteroReady && <ZoteroConnectionNotice connection={zotero} compact testId="first-run-zotero-notice" />}
              {source === 'zotero' && zoteroReady && (
                collectionsError ? <ZoteroConnectionNotice connection={zotero} loadError={collectionsError} onRetry={() => { setCollections(null); setCollectionsReload((value) => value + 1); }} compact testId="first-run-zotero-notice" />
                : collections === null ? <p className="first-run-hint" role="status"><Icon name="sync" size={13} className="animate-spin" /> {t('Leyendo tus colecciones…')}</p>
                : collections.length === 0 ? <p className="first-run-hint" data-testid="first-run-zotero-empty">{t('Tu Zotero no tiene colecciones todavía. Crea una en Zotero con unas cuantas obras y aparecerá aquí, o empieza con archivos de tu ordenador.')}</p>
                : (
                  <>
                    <p className="first-run-hint">{t('Marca una o varias colecciones. Para empezar basta con una pequeña: el resto de tu biblioteca podrás añadirlo después.')}</p>
                    <ul className="first-run-collections" data-testid="first-run-collections">
                      {collections.map((collection) => (
                        <CollectionRow key={collection.key} collection={collection} depth={0} selected={selectedCollections} onToggle={toggleCollection} />
                      ))}
                    </ul>
                    {selectedCount > 0 && <p className="first-run-hint" data-testid="first-run-zotero-summary">{tx('{collections} colección(es) seleccionada(s), con sus subcolecciones. Nodus prepara primero unas pocas obras para que puedas probarlo ya.', { collections: selectedCount })}</p>}
                  </>
                )
              )}

              {source === 'files' && (
                <div
                  className={`first-run-drop${dropping ? ' is-dropping' : ''}`}
                  data-testid="first-run-drop"
                  onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDropping(true); } }}
                  onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
                  onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}
                  onDrop={(event) => { event.preventDefault(); setDropping(false); addFiles(event.dataTransfer.files); }}
                >
                  <input ref={fileInput} type="file" multiple hidden data-testid="first-run-file-input" accept=".pdf,.epub,.docx,.doc,.odt,.rtf,.txt,.md,.markdown,.html,.htm" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
                  {files.length === 0 ? (
                    <p className="first-run-hint">{t('Arrastra aquí tus documentos o elígelos. Dos o tres bastan para la primera prueba.')}</p>
                  ) : (
                    <ul className="first-run-files" data-testid="first-run-files">
                      {files.map((file) => (
                        <li key={file.path}>
                          <Icon name="file" size={13} /><span title={file.path}>{file.name}</span>
                          <button type="button" className="btn btn-ghost !p-1" aria-label={tx('Quitar {name}', { name: file.name })} onClick={() => setFiles((current) => current.filter((entry) => entry.path !== file.path))}><Icon name="x" size={12} /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button type="button" className="btn btn-secondary" data-testid="first-run-choose-files" onClick={() => fileInput.current?.click()}><Icon name="plus" size={14} /> {files.length ? t('Añadir más') : t('Elegir archivos')}</button>
                </div>
              )}

              {source === 'example' && <p className="first-run-hint" data-testid="first-run-example-note">{learningText('sampleIsolation', language)}</p>}
            </section>

            {error && <p role="alert" className="first-run-error">{error}</p>}
            <footer className="first-run-foot">
              <div className="first-run-secondary">
                <button type="button" className="btn btn-ghost" data-testid="welcome-later" disabled={busy} onClick={skip}>{t('Ahora no')}</button>
                <button type="button" className="btn btn-ghost" data-testid="welcome-guide" disabled={busy} onClick={openGuide}>{t('Prefiero una guía paso a paso')}</button>
              </div>
              <button type="button" className="btn btn-primary" data-testid="first-run-continue" disabled={busy || !sourcesReady} onClick={continueFromSources}>
                {source === 'example' ? t('Abrir el ejemplo') : t('Continuar')} <Icon name="chevronRight" size={15} />
              </button>
            </footer>
            <details className="first-run-advanced">
              <summary>{t('Opciones avanzadas')}</summary>
              <p>{t('Modo académico')}</p>
              <div className="flex gap-4">
                <label><input type="radio" name="learning-work-mode" checked={workMode === 'auto'} onChange={() => setWorkMode('auto')} /> {t('Automático')}</label>
                <label><input type="radio" name="learning-work-mode" checked={workMode === 'manual'} onChange={() => setWorkMode('manual')} /> {t('Manual')}</label>
              </div>
            </details>
          </>
        )}

        {stage === 'ai' && (
          <>
            <div className="first-run-ai">
              <OnboardingModelStep
                purpose="chat"
                cloudFirst
                embeddingChoice
                firstRun
                showEmbeddings={!manual}
                providerKeys={settings.providerKeys}
                aiModel={model}
                embeddingModel={embedding}
                onAiChange={setModel}
                onEmbeddingChange={setEmbedding}
                disabled={busy}
              />
            </div>
            <footer className="first-run-foot">
              <button type="button" className="btn btn-ghost" data-testid="first-run-back" disabled={busy} onClick={() => setStage('sources')}><Icon name="chevronLeft" size={15} /> {t('Atrás')}</button>
              <button type="button" className="btn btn-primary" data-testid="first-run-start" disabled={busy || !model || (!manual && !embedding)} onClick={() => void run('models')}>
                {t('Empezar')} <Icon name="chevronRight" size={15} />
              </button>
            </footer>
          </>
        )}

        {stage === 'working' && (
          <>
            <ol className="first-run-steps" data-testid="first-run-steps">
              {WORK_STEPS.map((step) => {
                const index = WORK_STEPS.indexOf(step), current = WORK_STEPS.indexOf(workStep);
                const state = failure?.step === step ? 'failed' : index < current ? 'done' : index === current ? 'active' : 'pending';
                return (
                  <li key={step} data-step={step} data-state={state}>
                    <span className="first-run-step-mark"><Icon name={state === 'done' ? 'check' : state === 'failed' ? 'alert' : state === 'active' ? 'sync' : 'clock'} size={14} className={state === 'active' ? 'animate-spin' : ''} /></span>
                    <span>
                      <b>{step === 'models' ? t('Dejar lista la IA') : step === 'import' ? t('Traer tus fuentes') : t('Leerlas y prepararlas para buscar')}</b>
                      {state === 'active' && <small role="status">{workStepDetail(step, { download, importedCount, progress, source })}</small>}
                      {state === 'done' && step === 'import' && <small>{tx('{n} fuente(s) en tu bóveda.', { n: importedCount })}</small>}
                    </span>
                  </li>
                );
              })}
            </ol>
            {failure ? (
              <div role="alert" className="first-run-failure" data-testid="first-run-failure">
                <p>{failure.message}</p>
                <div className="first-run-foot">
                  <button type="button" className="btn btn-ghost" data-testid="first-run-enter-anyway" disabled={busy} onClick={skip}>{t('Entrar en Nodus igualmente')}</button>
                  <div className="first-run-secondary">
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setFailure(null); setStarterIds([]); setStage(failure.step === 'models' ? 'ai' : 'sources'); }}>{failure.step === 'models' ? t('Cambiar la IA') : t('Cambiar las fuentes')}</button>
                    <button type="button" className="btn btn-primary" data-testid="first-run-retry" disabled={busy} onClick={() => { setStarterIds([]); void run(failure.step === 'models' ? 'models' : 'import'); }}>{t('Reintentar')}</button>
                  </div>
                </div>
              </div>
            ) : workStep === 'prepare' && starterIds.length > 0 && (
              <footer className="first-run-foot">
                <p className="first-run-hint">{t('Un documento largo puede tardar unos minutos, sobre todo con un modelo en este equipo.')}</p>
                <button type="button" className="btn btn-ghost" data-testid="first-run-background" disabled={busy} onClick={continueInBackground}>{t('Seguir en segundo plano y entrar ya')}</button>
              </footer>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/**
 * One collection, and its subcollections on demand.
 *
 * Real libraries keep their works in subcollections: a «Thesis» folder with 15 chapters
 * holds no item of its own, and listing it as "0 works" made it look empty. So a parent
 * says how many subcollections it has, can be opened to pick one of them, and picking
 * the parent itself takes everything under it (the sync follows descendants).
 */
function CollectionRow({ collection, depth, selected, onToggle }: {
  collection: ZoteroCollection; depth: number; selected: Set<string>; onToggle: (key: string, checked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<ZoteroCollection[] | null>(null);
  const [failed, setFailed] = useState(false);
  const expand = () => {
    setOpen((value) => !value);
    if (children !== null) return;
    window.nodus.zoteroChildCollections(collection.key, collection.library)
      .then(setChildren, () => { setChildren([]); setFailed(true); });
  };
  const count = collection.itemCount > 0 && collection.subCount > 0
    ? tx('{n} obra(s) · {m} subcolección(es)', { n: collection.itemCount, m: collection.subCount })
    : collection.subCount > 0 ? tx('{m} subcolección(es)', { m: collection.subCount })
    : tx('{n} obra(s)', { n: collection.itemCount });
  return (
    <li>
      <div className="first-run-collection-row" style={{ paddingLeft: `${0.4 + depth * 1.1}rem` }}>
        {collection.subCount > 0
          ? <button type="button" className="first-run-collection-toggle" aria-expanded={open} aria-label={tx('Ver subcolecciones de {name}', { name: collection.name })} data-testid={`first-run-collection-expand-${collection.key}`} onClick={expand}><Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} /></button>
          : <span className="first-run-collection-toggle" aria-hidden="true" />}
        <label>
          <input
            type="checkbox"
            data-testid={`first-run-collection-${collection.key}`}
            checked={selected.has(collection.key)}
            onChange={(event) => onToggle(collection.key, event.target.checked)}
          />
          <span className="first-run-collection-name">{depth === 0 && collection.library.type === 'group' ? `${collection.library.name} · ` : ''}{collection.name}</span>
          <span className="first-run-collection-count">{count}</span>
        </label>
      </div>
      {open && (
        children === null
          ? <p className="first-run-hint" style={{ paddingLeft: `${2 + depth * 1.1}rem` }} role="status"><Icon name="sync" size={12} className="animate-spin" /> {t('Leyendo tus colecciones…')}</p>
          : failed ? <p className="first-run-hint" style={{ paddingLeft: `${2 + depth * 1.1}rem` }}>{t('No se pudieron leer las subcolecciones. Puedes marcar la colección completa.')}</p>
          : <ul>{children.map((child) => <CollectionRow key={child.key} collection={child} depth={depth + 1} selected={selected} onToggle={onToggle} />)}</ul>
      )}
    </li>
  );
}

function SourceCard({ id, selected, onSelect, icon, title, body, badge }: {
  id: Source; selected: boolean; onSelect: () => void; icon: React.ReactNode; title: string; body: string;
  badge?: { tone: 'ok' | 'warn' | 'neutral'; label: string };
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} data-testid={`first-run-source-${id}`} className={`first-run-source${selected ? ' is-selected' : ''}`} onClick={onSelect}>
      <span className="first-run-source-icon">{icon}</span>
      <span className="first-run-source-title">{title}</span>
      <span className="first-run-source-body">{body}</span>
      {badge && <span className={`first-run-badge is-${badge.tone}`} data-testid={`first-run-source-${id}-badge`}>{badge.label}</span>}
    </button>
  );
}

function workStepDetail(step: WorkStep, state: { download: string; importedCount: number; progress: StarterProgress | null; source: Source | null }): string {
  if (step === 'models') return state.download ? tx('Descargando {name}. Solo ocurre la primera vez.', { name: state.download }) : t('Guardando tu elección…');
  if (step === 'import') return state.source === 'zotero' ? t('Leyendo tus colecciones de Zotero…') : t('Copiando tus archivos a la biblioteca…');
  const progress = state.progress;
  if (!progress || progress.total === 0) return t('Comprobando qué documentos tienen texto…');
  const active = progress.active;
  if (active && active.preparation.passages > 0) {
    return tx('«{title}»: {done} de {total} pasajes.', { title: active.title, done: active.preparation.embedded, total: active.preparation.passages });
  }
  return active ? tx('Leyendo «{title}»…', { title: active.title }) : t('Comprobando qué documentos tienen texto…');
}

function failureText(kind: 'no-documents' | StarterFailure): string {
  switch (kind) {
    case 'no-documents': return t('No se ha encontrado ningún documento en lo que has elegido. Prueba con otra colección o con archivos de tu ordenador.');
    case 'no-file': return t('Estas referencias no tienen un PDF u otro archivo con texto, así que no hay nada que leer. Elige obras que tengan su archivo adjunto.');
    case 'unreadable': return t('Nodus no ha podido leer el texto de estos archivos. Suele pasar con PDF escaneados sin capa de texto. Prueba con otros documentos.');
    case 'no-model': return t('Falta el modelo que prepara la búsqueda. Vuelve al paso anterior y elige dónde calcularla.');
    case 'provider': return t('El servicio de IA ha rechazado la petición. Comprueba la clave y el modelo elegidos y vuelve a intentarlo.');
    default: return t('No se han podido preparar estas fuentes. Puedes reintentarlo o entrar en Nodus y prepararlas desde la Biblioteca.');
  }
}
