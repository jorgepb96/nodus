import { useEffect, useRef, useState } from 'react';
import './onboarding.css';
import { motion } from 'framer-motion';
import type { AiProvider, AppSettings, AcademicMode, ZoteroCollection, ModelRef, VaultSummary, ZoteroPingResult } from '@shared/types';
import { learningModelPatch } from '@shared/academicLearning';
import { normalizeEmbeddingModel, normalizeEmbeddingProvider } from '@shared/providers';
import { getNodusLocalModel } from '@shared/localAiModels';
import { Spinner, Icon } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { OnboardingModelStep } from '../components/OnboardingModelStep';
import { t, tx } from '../i18n';
import { zoteroConnectionHint, zoteroFailureText, zoteroPingErrorText } from '../lib/zoteroConnection';
// The two library sources are brands, not generic actions: the Nodus node mark and
// the same node mark drawn as a red Z stand in for the app itself and for Zotero.
import nodusLogo from '../assets/nodus-logo.svg';
import zoteroLogo from '../assets/nodus-logo-zotero.svg';

type OnboardingExit = 'home' | 'library' | 'settings';

export function Onboarding({
  activeVault,
  settings,
  providerKeys,
  onDone,
  onCancel,
  discardsVault,
}: {
  activeVault: VaultSummary | null;
  settings: AppSettings;
  /** Which providers already have a (globally shared) key configured. */
  providerKeys?: Partial<Record<AiProvider, boolean>>;
  onDone: (view?: OnboardingExit) => void;
  /** Cancel the wizard (discards a freshly-created vault when `discardsVault`). */
  onCancel?: () => void | Promise<unknown>;
  discardsVault?: boolean;
}) {
  const [step, setStep] = useState((activeVault?.type ?? 'academic') === 'academic' ? -1 : 0);
  const [academicMode, setAcademicMode] = useState<AcademicMode | null>(null);
  const manual = academicMode === 'manual';
  const [ping, setPing] = useState<ZoteroPingResult | null>(null);
  const [collections, setCollections] = useState<ZoteroCollection[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [librarySetup, setLibrarySetup] = useState<'nodus' | 'zotero'>('nodus');
  const [readTag, setReadTag] = useState('leído');
  // The two models the vault needs, and the wizard's whole point: they start empty so the
  // person decides. Nothing is carried over from the settings, which are shared app-wide —
  // a vault created while another one runs any model (a local one included, and Gemma is
  // both bundled and first in the listing) would otherwise open with that model already
  // chosen. A model that runs on this machine is only ever picked here by hand, and the
  // red mark beside the picker then explains what it costs.
  const [aiModel, setAiModel] = useState<ModelRef | null>(settings.academicInterfaceProfile === 'simple' ? settings.chatModel ?? settings.synthesisModel : null);
  const [embeddingModel, setEmbeddingModel] = useState<ModelRef | null>(settings.academicInterfaceProfile === 'simple' && (settings.chatModel || settings.synthesisModel) ? {provider:settings.embeddingProvider,model:settings.embeddingModel} : null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [storagePath, setStoragePath] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [downloadLabel, setDownloadLabel] = useState('');
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [cancellingDownload, setCancellingDownload] = useState(false);
  const downloadCancellationRequested = useRef(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);
  const [syncedWorks, setSyncedWorks] = useState<number | null>(null);

  const [confirmExit, setConfirmExit] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const [confirmConfigureLater, setConfirmConfigureLater] = useState(false);
  const [skippingAi, setSkippingAi] = useState(false);

  // The onboarding adapts to the active vault: only academic research starts with
  // Zotero. Dedicated workspaces use a short intro → AI → done flow.
  const vaultType = activeVault?.type ?? 'academic';
  const usesZoteroOnboarding = vaultType === 'academic';
  const simple = !usesZoteroOnboarding;
  const connectsZotero = usesZoteroOnboarding && librarySetup === 'zotero';
  const aiStep = simple ? 1 : 3; // the "AI provider" step index
  const doneStep = simple ? 2 : 4; // the final step index
  const progressRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const progress = progressRef.current;
    if (!progress) return;
    const revealCurrentStep = () => {
      const current = progress.querySelector<HTMLElement>('[aria-current="step"]');
      if (!current) return;
      const start = current.offsetLeft;
      const end = start + current.offsetWidth;
      if (start < progress.scrollLeft) progress.scrollLeft = start;
      else if (end > progress.scrollLeft + progress.clientWidth) progress.scrollLeft = end - progress.clientWidth;
    };
    revealCurrentStep();
    const observer = new ResizeObserver(revealCurrentStep);
    observer.observe(progress);
    return () => observer.disconnect();
  }, [step, connectsZotero, manual, settings.uiLanguage]);

  const exitOnboarding = async () => {
    if (!onCancel || exiting) return;
    setExiting(true);
    setExitError(null);
    try {
      await onCancel();
    } catch (error) {
      setExitError(error instanceof Error ? error.message : String(error));
    } finally {
      setExiting(false);
    }
  };

  /**
   * A reachable Zotero is not yet a readable one: a group library can refuse access,
   * and the local API can rate-limit. Swallowing those with `catch(() => [])` turned
   * a real failure into a green "Connected" followed by an empty collection list, so
   * the only symptom the user got was a step that looked finished and did nothing.
   */
  const checkZotero = async () => {
    setLibraryError(null);
    const res = await window.nodus.zoteroPing();
    setPing(res);
    if (!res.ok) return;
    try {
      const libs = await window.nodus.zoteroLibraries();
      const groups = await Promise.all(libs.map((library) => window.nodus.zoteroCollections(library)));
      setCollections(groups.flat());
    } catch (error) {
      setCollections([]);
      setLibraryError(zoteroFailureText(error));
    }
  };

  const toggleCollection = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Built-in models are chosen here but only fetched now, so the wizard stays
   *  responsive while browsing and the download runs once the choice is final. */
  const downloadLocalModels = async (refs: (ModelRef | null)[]) => {
    const ensureDownloadContinues = () => {
      if (downloadCancellationRequested.current) throw new Error(t('Descarga cancelada.'));
    };
    const definitions = [...new Set(refs.filter((ref) => ref?.provider === 'nodus').map((ref) => ref!.model))]
      .map((id) => {
        const definition = getNodusLocalModel(id);
        if (!definition) throw new Error(t('El modelo local seleccionado ya no está disponible.'));
        return definition;
      });
    if (!definitions.length) return;
    ensureDownloadContinues();
    const status = await window.nodus.getNodusLocalAiStatus();
    const needsRuntime = definitions.some((model) => model.runtime === 'llama_cpp') && !status.runtime.ready;
    const pending = definitions.filter((model) => !status.models.find((entry) => entry.id === model.id)?.downloaded);
    const total = (needsRuntime ? 1 : 0) + pending.length;
    if (!total) return;
    let done = 0;
    const onProgress = (fraction: number) => setDownloadProgress((done + fraction) / total);
    if (needsRuntime) {
      ensureDownloadContinues();
      setDownloadLabel(t('Preparando el motor local…'));
      await window.nodus.installNodusLocalRuntime(onProgress);
      ensureDownloadContinues();
      done += 1;
    }
    for (const model of pending) {
      ensureDownloadContinues();
      setDownloadLabel(tx('Descargando {model}…', { model: model.label }));
      await window.nodus.downloadNodusLocalModel(model.id, onProgress);
      ensureDownloadContinues();
      done += 1;
    }
    ensureDownloadContinues();
    setDownloadProgress(1);
    setDownloadLabel('');
  };

  const cancelLocalDownloads = async () => {
    if (!finishing || cancellingDownload) return;
    downloadCancellationRequested.current = true;
    setCancellingDownload(true);
    setDownloadNotice(null);
    try {
      await window.nodus.cancelNodusLocalDownloads();
      setDownloadNotice(t('Descarga detenida. El progreso verificado se conserva para reanudar.'));
    } catch (error) {
      setModelError(error instanceof Error ? error.message : String(error));
    } finally {
      setCancellingDownload(false);
    }
  };

  const finish = async () => {
    if (manual) {
      setFinishing(true);
      setFinishError(null);
      try {
        await window.nodus.updateSettings({
          academicMode: 'manual',
          ...(connectsZotero ? { monitoredCollections: Array.from(selected), readTag, zoteroStoragePath: storagePath } : {}),
        });
        if (connectsZotero) {
          const sync = await window.nodus.syncNow();
          setSyncSummary(sync.summary);
          setSyncedWorks((await window.nodus.listWorks()).length);
        }
        await window.nodus.updateSettings({ onboardingComplete: true, tourComplete: true, advancedTourComplete: true });
        setStep(doneStep);
      } catch (error) { setFinishError(error instanceof Error ? error.message : String(error)); }
      finally { setFinishing(false); }
      return;
    }
    if (!aiModel || !embeddingModel) {
      setModelError(t('Elige un modelo de IA y uno de embeddings para continuar.'));
      return;
    }
    setFinishing(true);
    setFinishError(null);
    setModelError(null);
    setSyncSummary(null);
    setSyncedWorks(null);
    setDownloadProgress(0);
    setDownloadNotice(null);
    downloadCancellationRequested.current = false;
    try {
      await downloadLocalModels([aiModel, embeddingModel]);
      const favorites = settings.favorites.some((model) => model.provider === aiModel.provider && model.model === aiModel.model)
        ? settings.favorites
        : [...settings.favorites, aiModel];
      const embeddingProvider = normalizeEmbeddingProvider(embeddingModel.provider);
      await window.nodus.updateSettings({
        ...(connectsZotero ? { monitoredCollections: Array.from(selected), readTag, zoteroStoragePath: storagePath } : {}),
        favorites,
        ...(settings.academicInterfaceProfile === 'simple' ? learningModelPatch(settings, 'chat', aiModel) : { synthesisModel: aiModel, modelSettingsMode: 'basic' as const }),
        embeddingProvider,
        embeddingModel: normalizeEmbeddingModel(embeddingProvider, embeddingModel.model),
        onboardingComplete: true,
      });
      setStep(doneStep);
      // Only academic vaults ingest Zotero during setup. Study can import files or
      // connect Zotero later from its own Materials section.
      if (connectsZotero) {
        const sync = await window.nodus.syncNow();
        const works = await window.nodus.listWorks();
        setSyncSummary(sync.summary);
        setSyncedWorks(works.length);
      }
    } catch (e) {
      if (downloadCancellationRequested.current) {
        setDownloadLabel('');
        setDownloadProgress(0);
        setDownloadNotice(t('Descarga detenida. El progreso verificado se conserva para reanudar.'));
      } else {
        setStep(doneStep);
        setFinishError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      downloadCancellationRequested.current = false;
      setFinishing(false);
    }
  };

  const configureAiLater = async () => {
    if (skippingAi) return;
    setConfirmConfigureLater(false);
    setSkippingAi(true);
    setModelError(null);
    try {
      await window.nodus.updateSettings({
        ...(connectsZotero ? { monitoredCollections: Array.from(selected), readTag, zoteroStoragePath: storagePath } : {}),
        onboardingComplete: true,
      });
      if (connectsZotero) await window.nodus.syncNow().catch(() => undefined);
      onDone('home');
    } catch (error) {
      setModelError(error instanceof Error ? error.message : String(error));
    } finally {
      setSkippingAi(false);
    }
  };

  // A failed check names the setting that fixes it; an HTTP failure from a Zotero that
  // did answer gets no hint (zoteroConnectionHint decides).
  const pingHint = ping && !ping.ok ? zoteroConnectionHint(ping) : null;
  const steps = simple
    ? [t('Introducción'), t('Proveedor de IA'), t('Listo')]
    : [t('Biblioteca'), connectsZotero ? t('Colecciones de Zotero') : t('Añadir contenido'), connectsZotero ? t('Lecturas de Zotero') : t('Cómo funciona'), manual ? t('Índice local') : t('Proveedor de IA'), t('Primer resultado')];
  const intro =
    vaultType === 'primary_sources'
      ? {
          subtitle: t('Investiga documentos originales sin mezclar lo que dice la fuente con tu interpretación.'),
          body: t('Importa o registra fuentes, conserva su procedencia y sus originales, y construye personas, cronologías, mapas y relaciones únicamente desde evidencias revisadas.'),
        }
      : vaultType === 'genealogy'
      ? {
          subtitle: t('Reconstruye tu historia familiar en un árbol navegable, con evidencias citadas y parentescos sugeridos por la IA. Todo es local.'),
          body: t('Añade personas y sus vínculos, documenta cada dato con su fuente y explora el árbol, la línea temporal y el archivo de evidencias. Configura un modelo de IA para las sugerencias de parentesco.'),
        }
      : vaultType === 'databases'
        ? {
            subtitle: t('Organiza tus datos en tablas tipo Notion con columnas tipadas, relaciones, rollups y análisis con IA. Todo es local.'),
            body: t('Crea bases de datos con columnas de texto, número, selección, adjuntos, relaciones y rollups; impórtalas desde CSV y analízalas o conversa con ellas. Configura un modelo de IA para las columnas y el chat.'),
          }
        : vaultType === 'estudio'
          ? {
              subtitle: t('Organiza cursos, apuntes, materiales y repasos en un espacio de aprendizaje local.'),
              body: t('Empieza creando tus cursos y asignaturas. Después podrás importar archivos o enlazar materiales de Zotero de forma opcional, grabar clases, generar preguntas y repasar con ayuda de la IA.'),
            }
        : vaultType === 'docencia'
          ? {
              subtitle: t('Organiza tu docencia: cursos, materiales, horarios y clases en un espacio local y privado.'),
              body: t('Empieza creando tus cursos y asignaturas. Después podrás importar archivos o enlazar materiales de Zotero de forma opcional, planificar horarios y calendario, y grabar tus clases.'),
            }
        : vaultType === 'testimonios'
          ? {
              subtitle: t('Conserva entrevistas, participantes y transcripciones en un archivo de historia oral local y privado.'),
              body: t('Empieza registrando una entrevista o un participante. Podrás añadir grabaciones, transcribirlas, codificar fragmentos y contrastar testimonios sin depender de una biblioteca bibliográfica externa.'),
            }
        : vaultType === 'prosopography'
          ? {
              subtitle: t('Estudia una población histórica desde sus fuentes, observaciones y criterios explícitos.'),
              body: t('Define la población y sus variables, registra las fuentes y captura observaciones trazables antes de analizar personas, cohortes y redes.'),
            }
        : vaultType === 'worldbuilding'
          ? {
              subtitle: t('Construye un mundo de ficción coherente a partir de tu propio canon.'),
              body: t('Empieza creando personajes, lugares y reglas. Después podrás desarrollar escenas, culturas, facciones, mapas y manuscritos manteniendo la continuidad del mundo.'),
            }
        : { subtitle: '', body: '' };

  return (
    <div className="onboarding-shell">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="card onboarding-card w-full max-w-2xl"
        data-testid="onboarding-card"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-2xl font-semibold mb-1">{t('Bienvenido a Nodus')}</div>
          {onCancel && (
            <button
              className="btn btn-ghost shrink-0 gap-1 text-xs text-neutral-400"
              onClick={() => (discardsVault ? setConfirmExit(true) : void onCancel())}
              title={t('Salir del asistente')}
            >
              <Icon name="x" size={14} /> {t('Salir')}
            </button>
          )}
        </div>
        <p className="text-neutral-400 text-sm mb-5">
          {simple ? intro.subtitle : t('Construye tu biblioteca dentro de Nodus o conecta Zotero. Las dos opciones terminan en el mismo grafo local.')}
        </p>

        {confirmExit && (
          <div className="mb-5 rounded-lg border border-amber-700/60 bg-amber-950/20 p-3 text-sm">
            <p className="text-amber-200">
              {tx('Si sales ahora, se descartará la bóveda «{name}» que acabas de crear. ¿Continuar?', { name: activeVault?.name ?? '' })}
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button className="btn btn-ghost text-xs" onClick={() => setConfirmExit(false)}>
                {t('Seguir configurando')}
              </button>
              <button className="btn bg-red-600 text-xs text-white hover:bg-red-500 disabled:opacity-50" disabled={exiting} onClick={() => void exitOnboarding()}>
                {exiting ? t('Saliendo…') : t('Salir y descartar')}
              </button>
            </div>
            {exitError && <p role="alert" className="mt-2 text-xs text-red-300">{exitError}</p>}
          </div>
        )}

        <ol ref={progressRef} className="onboarding-progress" data-testid="onboarding-progress" tabIndex={0}
          aria-label={tx('Paso {a} de {b}', { a: simple ? step + 1 : step + 2, b: simple ? steps.length : steps.length + 1 })}>
          {(simple ? steps : [t('Modo académico'), ...steps]).map((s, index) => { const i = simple ? index : index - 1; return (
            <li
              key={s}
              aria-current={i === step ? 'step' : undefined}
              className={`onboarding-step ${
                i === step ? 'bg-indigo-600 text-white' : i < step ? 'bg-neutral-800/70 text-neutral-300' : 'text-neutral-500'
              }`}
            >
              {s}
            </li>
          ); })}
        </ol>

        {step === -1 && !simple && (
          <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={t('Modo académico')}>
            {(['auto', 'manual'] as const).map((mode) => (
              <button key={mode} type="button" data-testid={`onboarding-mode-${mode}`} aria-pressed={academicMode === mode}
                className={`rounded-xl border p-5 text-left ${academicMode === mode ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-700 hover:border-neutral-500'}`}
                onClick={() => setAcademicMode(mode)}>
                <span className="font-semibold">{mode === 'auto' ? t('Modo Auto (con IA)') : t('Modo Manual')}</span>
                <span className="mt-2 block text-sm leading-6 text-neutral-400">{mode === 'auto'
                  ? t('La IA analiza tus materiales, extrae ideas y establece relaciones.')
                  : t('Crea tus ideas, vincula obras y añade citas y relaciones a tu ritmo. Nodus las indexa para facilitar la búsqueda.')}</span>
              </button>
            ))}
          </div>
        )}

        {step === 0 && simple && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-300">{intro.body}</p>
            <p className="text-xs text-neutral-500">{t('En el siguiente paso elegirás el modelo de IA y el de embeddings. Nodus detecta tus claves y carga los modelos disponibles por ti.')}</p>
          </div>
        )}

        {step === 0 && !simple && (
          <div className="space-y-4">
            <p className="text-sm">
              {t('Elige cómo quieres empezar. Puedes cambiar de método o combinar ambos más adelante desde Biblioteca.')}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" data-testid="onboarding-library-nodus" aria-pressed={librarySetup === 'nodus'} className={`rounded-xl border p-4 text-left ${librarySetup === 'nodus' ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-700 hover:border-neutral-500'}`} onClick={() => setLibrarySetup('nodus')}>
                <span className="flex items-center gap-2 font-semibold">
                  <img src={nodusLogo} alt="" aria-hidden="true" className="h-5 w-5 shrink-0" /> {t('Biblioteca de Nodus')}
                  {/* The standalone reference manager is still in beta; the badge says so
                      here, exactly as the Library guide does at the same fork. */}
                  <span data-testid="onboarding-library-nodus-beta" className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">BETA</span>
                </span>
                <span className="mt-2 block text-xs leading-5 text-neutral-400">{t('Añade archivos, DOI, ISBN o referencias manuales y organiza tus propias colecciones. No necesitas Zotero.')}</span>
              </button>
              <button type="button" data-testid="onboarding-library-zotero" aria-pressed={librarySetup === 'zotero'} className={`rounded-xl border p-4 text-left ${librarySetup === 'zotero' ? 'border-indigo-500 bg-indigo-500/10' : 'border-neutral-700 hover:border-neutral-500'}`} onClick={() => { setLibrarySetup('zotero'); void checkZotero(); }}>
                <span className="flex items-center gap-2 font-semibold">
                  <img src={zoteroLogo} alt="" aria-hidden="true" className="h-5 w-5 shrink-0" /> Zotero
                  <span data-testid="onboarding-library-zotero-recommended" className="rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-300">{t('Recomendado')}</span>
                </span>
                <span className="mt-2 block text-xs leading-5 text-neutral-400">{t('Conecta tu biblioteca existente en modo solo lectura y elige qué colecciones monitorizar.')}</span>
              </button>
            </div>
            {connectsZotero && <div className="rounded-xl border border-neutral-800 p-3">
              <p className="text-xs text-neutral-400">{t('Nodus usa la API local de Zotero en modo solo lectura (requiere Zotero 7 o posterior). Abre Zotero y verifica la conexión.')}</p>
              <button className="btn btn-secondary mt-3" onClick={checkZotero}>{t('Verificar conexión')}</button>
              {ping && (ping.ok && !libraryError ? (
                <div className="mt-2 text-sm text-emerald-400">{tx('Conectado (userID {id})', { id: ping.userId ?? '' })}</div>
              ) : (
                <div role="alert" data-testid="onboarding-zotero-error" className="mt-2 text-sm text-red-400">
                  {libraryError ?? zoteroPingErrorText(ping)}
                  {pingHint && <p className="mt-1 text-xs leading-5 text-amber-300">{pingHint}</p>}
                </div>
              ))}
            </div>}
            {librarySetup === 'nodus' && (
              <div className="rounded-xl border border-emerald-700/30 bg-emerald-500/5 p-3 text-xs leading-5 text-emerald-300">
                {t('Puedes importar Zotero en cualquier momento sin reemplazar tus colecciones ni tus metadatos de Nodus.')}
              </div>
            )}
          </div>
        )}

        {step === 1 && !simple && connectsZotero && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-400">
              {manual ? t('Las obras, citas y relaciones son opcionales. Puedes empezar con una idea independiente.') : t('Elige las colecciones a monitorizar. Despliega cualquier colección para elegir subcolecciones concretas si una es demasiado grande. Se incorporan metadatos; los análisis se lanzan manualmente salvo que actives automatización en Ajustes.')}
            </p>
            {selected.size > 0 && (
              <p className="text-xs text-emerald-400">{tx('{n} seleccionadas', { n: selected.size })}</p>
            )}
            <div className="max-h-64 overflow-y-auto pr-1">
              {collections.map((c) => (
                <OnboardingCollectionNode key={c.key} col={c} depth={0} selected={selected} onToggle={toggleCollection} />
              ))}
              {collections.length === 0 && <div className="text-neutral-500 text-sm">{t('No hay colecciones cargadas.')}</div>}
            </div>
          </div>
        )}

        {step === 1 && !simple && !connectsZotero && (
          <div className="space-y-3 rounded-xl border border-neutral-800 p-4">
            <h3 className="font-semibold">{t('Añade como prefieras')}</h3>
            <p className="text-sm leading-6 text-neutral-400">{t('Después del asistente podrás arrastrar PDF, EPUB y otros archivos a Biblioteca, añadir una obra por DOI o ISBN, importar referencias o crear una ficha manual.')}</p>
            <p className="text-xs text-neutral-500">{t('Nodus tratará de completar metadatos y preparar una versión limpia de lectura automáticamente.')}</p>
          </div>
        )}

        {step === 2 && !simple && connectsZotero && (
          <div className="space-y-4">
            <label className="block text-sm">
              {t('Tag de lectura')}
              <input className="input w-full mt-1" value={readTag} onChange={(e) => setReadTag(e.target.value)} />
            </label>
            <label className="block text-sm">
              {t('Ruta de la carpeta storage de Zotero (opcional, para localizar PDFs)')}
              <input
                className="input w-full mt-1"
                value={storagePath}
                placeholder="/Users/tu/Zotero/storage"
                onChange={(e) => setStoragePath(e.target.value)}
              />
            </label>
          </div>
        )}

        {step === 2 && !simple && !connectsZotero && (
          <div className="space-y-3 rounded-xl border border-neutral-800 p-4">
            <h3 className="font-semibold">{t('Biblioteca y análisis son independientes')}</h3>
            <p className="text-sm leading-6 text-neutral-400">{manual ? t('Las obras, citas y relaciones son opcionales. Puedes empezar con una idea independiente.') : t('La Biblioteca conserva referencias y archivos. Cuando añades una obra a este vault, habilitas sus análisis, ideas, pasajes, embeddings y conexiones dentro de este espacio.')}</p>
          </div>
        )}

        {step === aiStep && !manual && (
          <div className="space-y-4">
            <OnboardingModelStep
              purpose={settings.academicInterfaceProfile === 'simple' ? 'chat' : 'analysis'}
              cloudFirst={settings.academicInterfaceProfile === 'simple'}
              providerKeys={providerKeys ?? {}}
              aiModel={aiModel}
              embeddingModel={embeddingModel}
              onAiChange={(ref) => { setAiModel(ref); setModelError(null); }}
              onEmbeddingChange={(ref) => { setEmbeddingModel(ref); setModelError(null); }}
              disabled={finishing || skippingAi}
            />
            {modelError && <p role="alert" className="text-sm text-red-400">{modelError}</p>}
            {downloadNotice && <p role="status" className="text-sm text-emerald-400">{downloadNotice}</p>}
            {finishing && downloadLabel && (
              <div className="rounded-lg border border-indigo-800/60 bg-indigo-950/25 p-3" data-testid="onboarding-model-download-progress">
                <div className="flex items-center justify-between gap-3 text-xs text-indigo-200">
                  <span>{downloadLabel}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {downloadProgress > 0 && <span className="tabular-nums">{Math.round(downloadProgress * 100)}%</span>}
                    <button
                      type="button"
                      className="btn btn-ghost h-7 gap-1 px-2 text-[10px] text-indigo-100"
                      data-testid="onboarding-stop-model-download"
                      disabled={cancellingDownload}
                      onClick={() => void cancelLocalDownloads()}
                    >
                      <Icon name="stop" size={11} />
                      {cancellingDownload ? t('Deteniendo…') : t('Detener descarga')}
                    </button>
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-neutral-800">
                  <div className="h-full bg-indigo-500 transition-[width]" style={{ width: `${Math.max(3, downloadProgress * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        {step === aiStep && manual && (
          <div className="space-y-3 rounded-xl border border-neutral-800 p-4">
            <h3 className="font-semibold">{t('Índice local')}</h3>
            <p className="text-sm leading-6 text-neutral-400">{t('Tus ideas se indexan en este equipo con Multilingual E5 Small. Puedes cambiar el modelo en Ajustes. La indexación no crea ideas ni relaciones.')}</p>
            <p className="text-xs text-neutral-500">{t('El modelo se prepara en segundo plano al guardar tu primera idea. Puedes seguir escribiendo sin conexión.')}</p>
            {finishError && <p role="alert">{finishError}</p>}
          </div>
        )}
        {step === doneStep && (
          <div className="space-y-4">
            <div>
              <div className="text-lg font-semibold">{simple ? t('Listo') : t('Primer resultado')}</div>
              <p className="text-sm text-neutral-400 mt-1">
                {simple
                  ? t('Tu bóveda está lista. El panel de Inicio te guiará en los primeros pasos.')
                  : connectsZotero && finishing
                    ? t('Sincronizando Zotero para preparar el panel inicial...')
                    : finishError
                      ? t('No se pudo completar la primera sincronización, pero puedes entrar y corregirlo desde Inicio o Ajustes.')
                      : connectsZotero ? t('La biblioteca local ya está preparada. El panel de Inicio te dirá qué conviene hacer después.') : t('La Biblioteca de Nodus está lista. Añade tu primera obra desde Biblioteca cuando quieras.')}
              </p>
            </div>
            {!simple && connectsZotero && finishing && <Spinner label={t('Sincronizando metadatos...')} />}
            {finishError && (
              <div className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {finishError}
              </div>
            )}
            {!simple && connectsZotero && !finishing && !finishError && (
              <div className="grid grid-cols-2 gap-3">
                <ResultMetric label={t('Obras locales')} value={syncedWorks ?? 0} />
                <ResultMetric label={t('Colecciones')} value={selected.size} />
              </div>
            )}
            {syncSummary && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2 text-sm text-neutral-300">
                {syncSummary}
              </div>
            )}
          </div>
        )}

        {modelError && step === -1 && <p role="alert">{modelError}</p>}
        <div className="onboarding-footer flex flex-wrap items-center justify-between gap-3 mt-6">
          <button className="btn btn-ghost" onClick={() => setStep((s) => Math.max(simple ? 0 : -1, s - 1))} disabled={step === (simple ? 0 : -1) || step === doneStep || finishing}>
            {t('Atrás')}
          </button>
          {step < aiStep ? (
            <button className="btn btn-primary" disabled={step === -1 && !academicMode} onClick={async () => {
              try {
                if (step === -1 && academicMode) await window.nodus.updateSettings({ academicMode });
                setStep((s) => s + 1);
              } catch (error) { setModelError(String(error)); }
            }}>
              {t('Siguiente')}
            </button>
          ) : step === aiStep && manual ? (
            <button className="btn btn-primary" data-testid="onboarding-start" onClick={finish} disabled={finishing}>{finishing ? t('Preparando...') : t('Empezar')}</button>
          ) : step === aiStep ? (
            <div className="flex gap-2">
              <button
                className="btn btn-ghost border border-neutral-700"
                data-testid="onboarding-configure-ai-later"
                onClick={() => setConfirmConfigureLater(true)}
                disabled={finishing || skippingAi}
              >
                {skippingAi ? t('Guardando…') : t('Configurar más tarde')}
              </button>
              <button className="btn btn-primary" data-testid="onboarding-start" onClick={finish} disabled={finishing || skippingAi || !aiModel || !embeddingModel}>
                {finishing ? t('Preparando...') : t('Empezar')}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              {finishError && (
                <button className="btn btn-ghost border border-neutral-700" onClick={finish} disabled={finishing}>
                  {t('Reintentar')}
                </button>
              )}
              {!simple && (
                <button className="btn btn-ghost border border-neutral-700" onClick={() => onDone(manual || aiModel ? 'library' : 'settings')} disabled={finishing}>
                  {manual || aiModel ? t('Ir a Biblioteca') : t('Configurar IA')}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => onDone('home')} disabled={finishing}>
                {t('Abrir Inicio')}
              </button>
            </div>
          )}
        </div>
        {confirmConfigureLater && (
          <ConfirmModal
            title={t('Configurar IA más tarde')}
            message={t('Podrás explorar este vault sin IA. Las funciones que analizan, generan contenido o usan búsqueda semántica no estarán disponibles hasta que configures los modelos en Ajustes → Modelos IA.')}
            confirmLabel={t('Explorar sin IA')}
            onConfirm={() => void configureAiLater()}
            onCancel={() => setConfirmConfigureLater(false)}
          />
        )}
      </motion.div>
    </div>
  );
}

/**
 * One row of the collection tree in the wizard: a checkbox to monitor this
 * collection plus an expander that lazily loads its subcollections (via
 * zoteroChildCollections) so a user can drill into a large collection and pick a
 * specific subcollection instead. Selection is independent per node — checking a
 * parent does not auto-check its children.
 */
function OnboardingCollectionNode({
  col,
  depth,
  selected,
  onToggle,
}: {
  col: ZoteroCollection;
  depth: number;
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<ZoteroCollection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const hasChildren = (col.subCount ?? 0) > 0;

  const expand = async () => {
    if (!open && children === null && hasChildren) {
      setLoading(true);
      const loaded = await window.nodus.zoteroChildCollections(col.key).catch(() => []);
      setChildren(loaded);
      setLoading(false);
    }
    setOpen((o) => !o);
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 py-1 text-sm" style={{ paddingLeft: depth * 16 }}>
        <button
          type="button"
          className={`w-4 shrink-0 text-neutral-500 ${hasChildren ? 'hover:text-neutral-300' : 'invisible'}`}
          onClick={expand}
          aria-label={open ? t('Plegar') : t('Desplegar')}
          title={open ? t('Plegar') : t('Desplegar')}
        >
          {loading ? '…' : open ? '▾' : '▸'}
        </button>
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
          <input type="checkbox" className="shrink-0" checked={selected.has(col.key)} onChange={() => onToggle(col.key)} />
          <span className="truncate">{col.name}</span>
          {depth === 0 && <span className="shrink-0 text-[10px] text-neutral-500">{col.library.type === 'group' ? col.library.name : t('Mi biblioteca')}</span>}
          <span className="shrink-0 text-neutral-600">
            ({col.itemCount} {t('ítems')}{col.subCount ? `, ${col.subCount} ${t('subcol.')}` : ''})
          </span>
        </label>
      </div>
      {open &&
        children?.map((c) => (
          <OnboardingCollectionNode key={c.key} col={c} depth={depth + 1} selected={selected} onToggle={onToggle} />
        ))}
    </div>
  );
}

function ResultMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
