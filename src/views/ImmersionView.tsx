import { ResearchEffortControl } from '../components/ResearchEffortControl';
import { useResearchEffort } from '../hooks/useResearchEffort';
import type { ResearchEffort } from '@shared/researchReasoning';
import { DocumentVisualScope, DocumentVisualActions, DocumentVisualFigures } from '../components/DocumentVisualScope';
import { DocumentSkillsControl, useDocumentSkills } from '../components/DocumentSkillsControl';
// Inmersión — the fully guided topic-mastery experience.
//
// Flow: home (topic + budget) → scope (the territory map, pure embeddings+graph,
// no AI) → one-time generation (every generated section is persisted) → player (panorama
// · stations with literal quotes and an embedded graph excerpt · contrast matrix
// · frontiers · final exam). Sessions resume from the saved plan; restarting a
// finished route clears learner answers without regenerating its content. No step
// ever sends a learner answer back to AI; open answers remain unscored local notes.
//
// Styling note: every color utility here either has an explicit `.light` override
// in index.css or reads correctly in both themes; the hero uses the dedicated
// `immersion-hero` class. Graph excerpts MUST live inside a `relative
// overflow-hidden` box with an explicit height — StellarExcerpt renders `absolute
// inset-0` and would otherwise escape its card.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type {
  AppSettings,
  GraphData,
  ImmersionAnswerRecord,
  ImmersionBuildProgress,
  ImmersionProgress,
  ImmersionQuizQuestion,
  ImmersionScope,
  ImmersionSession,
  ImmersionSessionSummary,
  ImmersionStation,
  DecorativeImageStyle,
  ContentTranslation,
  WritingDraftAnnotation,
  WritingDraftAnnotationColor,
  WritingDraftAnnotationInput,
} from '@shared/types';
import { DECORATIVE_IMAGE_STYLES } from '@shared/imageStyles';
import type {PromptLanguage} from '@shared/types';
import {normalizePromptLanguage, PROMPT_LANGUAGE_OPTIONS} from '@shared/promptLanguageOptions';
import { immersionAnnotationDocumentId } from '@shared/readerAnnotations';
import type { ImmersionSnapshot } from '../app/viewSnapshots';
import { useListPlacement } from '../listPlacement';
import { Badge, Icon, RestoringPane, TypeDot } from '../components/ui';
import { WorkspaceTabStrip } from '../components/library/LibraryWorkspaceTabs';
import { SectionHeader } from '../components/SectionHeader';
import { ModelPicker } from '../components/ModelPicker';
import { Markdown, type MarkdownCitation } from '../components/Markdown';
import { StudyMarkdown, StudyMarkdownInline } from '../components/StudyMarkdown';
import { SourceCitationModal, type CitationTarget, type OpenCitationLibraryWork } from '../components/SourceCitationModal';
import { SaveToNotesModal } from '../components/SaveToNotesModal';
import { TranslationModal } from '../components/TranslationModal';
import { confirm, toast } from '../components/feedback';
import { StellarExcerpt } from '../stellarGraph/StellarExcerpt';
import { GraphErrorBoundary } from './graph/GraphErrorBoundary';
import { t, tx, getActiveLang } from '../i18n';
import {
  IMMERSION_GENERATION_JOB_KEY,
  IMMERSION_DOSSIER_JOB_PREFIX,
  clearBackgroundJob,
  findLatestBackgroundJob,
  getBackgroundJob,
  immersionDossierJobKey,
  startDeepResearchGeneration,
  startImmersionGeneration,
  subscribeBackgroundJob,
  type DeepResearchGenerationJob,
  type ImmersionGenerationJob,
} from '../backgroundJobs';
import { useFeatureModel } from '../hooks/useFeatureModel';
import { DecorativeImageCard } from '../components/DecorativeImageCard';
import { AudioPanel } from '../components/AudioPanel';
import { FindInPage } from '../components/FindInPage';
import { NodiViewContextSource } from '../components/NodiViewContextSource';
import {
  ReaderHighlighterControl,
  ReaderSelectionActions,
  type ReaderSelectionActionsHandle,
} from '../components/ReaderSelectionActions';

const TIME_PRESETS: { minutes: number; label: string; hint: string }[] = [
  { minutes: 90, label: 'Exprés', hint: '~6 paradas' },
  { minutes: 150, label: 'Una tarde', hint: '~12 paradas' },
  { minutes: 240, label: 'Profunda', hint: '~20 paradas' },
];

const STEP_MINUTES = { panorama: 15, station: 28, contrasts: 15, frontiers: 8, exam: 18 } as const;

type PlayerStep =
  | { kind: 'panorama' }
  | { kind: 'station'; index: number }
  | { kind: 'contrasts' }
  | { kind: 'frontiers' }
  | { kind: 'exam' };

function playerSteps(session: ImmersionSession): PlayerStep[] {
  return [
    { kind: 'panorama' },
    ...session.plan.stations.map((_, index) => ({ kind: 'station' as const, index })),
    { kind: 'contrasts' },
    { kind: 'frontiers' },
    { kind: 'exam' },
  ];
}

function stepMeta(step: PlayerStep, session: ImmersionSession): { icon: string; title: string; minutes: number } {
  switch (step.kind) {
    case 'panorama':
      return { icon: 'eye', title: t('Panorama'), minutes: STEP_MINUTES.panorama };
    case 'station': {
      const station = session.plan.stations[step.index];
      return { icon: 'bulb', title: station?.title ?? tx('Estación {n}', { n: step.index + 1 }), minutes: STEP_MINUTES.station };
    }
    case 'contrasts':
      return { icon: 'scale', title: t('Contrastes'), minutes: STEP_MINUTES.contrasts };
    case 'frontiers':
      return { icon: 'gap', title: t('Fronteras'), minutes: STEP_MINUTES.frontiers };
    case 'exam':
      return { icon: 'graduation', title: t('Examen final'), minutes: STEP_MINUTES.exam };
  }
}

/** Rail sections: the journey reads as apertura → estaciones → cierre. */
function stepSection(step: PlayerStep): 'apertura' | 'estaciones' | 'cierre' {
  if (step.kind === 'panorama') return 'apertura';
  if (step.kind === 'station') return 'estaciones';
  return 'cierre';
}

const SECTION_LABELS: Record<ReturnType<typeof stepSection>, string> = {
  apertura: 'Apertura',
  estaciones: 'Estaciones',
  cierre: 'Cierre',
};

/** StellarExcerpt renders `absolute inset-0`, so it must be fenced in explicitly. */
function GraphBox({
  data,
  className,
  onOpenNode,
}: {
  data: GraphData;
  className: string;
  onOpenNode: (id: string) => void;
}) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <GraphErrorBoundary>
        <StellarExcerpt data={data} onOpenNode={onOpenNode} />
      </GraphErrorBoundary>
    </div>
  );
}

export function ImmersionView({
  settings,
  snapshot,
  onSnapshotChange,
  onOpenLibraryWork,
}: {
  settings: AppSettings;
  /** Where this section was last left. Read once, at mount, and never again. */
  snapshot?: ImmersionSnapshot;
  onSnapshotChange?: (patch: Partial<ImmersionSnapshot>) => void;
  onOpenLibraryWork?: OpenCitationLibraryWork;
}) {
  /**
   * The session this mount is walking back into, decided here rather than in an
   * effect: the section has to know on its very first frame that it is going to the
   * player, or it paints the gallery on the way there and the return looks like the
   * app opening the list and clicking the session by itself.
   *
   * A dossier still being written wins over the session that was merely left open:
   * it is the more recent thing, and it is the same section either way.
   */
  const [resumeTarget] = useState<string | null>(() => {
    const dossier = findLatestBackgroundJob<unknown, unknown, unknown>(IMMERSION_DOSSIER_JOB_PREFIX);
    const fromDossier = dossier ? dossier.key.slice(IMMERSION_DOSSIER_JOB_PREFIX.length) : '';
    return fromDossier || snapshot?.openSession?.id || null;
  });
  const [mode, setMode] = useState<'home' | 'scope' | 'player'>(() => (resumeTarget ? 'player' : 'home'));
  const [openIds, setOpenIds] = useState<string[]>(() => snapshot?.openIds ?? (resumeTarget ? [resumeTarget] : []));
  const sessionCache = useRef(new Map<string, ImmersionSession>());
  const openingRequest = useRef(0);
  const [sessions, setSessions] = useState<ImmersionSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsRead, setSessionsRead] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  const [topic, setTopic] = useState('');
  const [minutes, setMinutes] = useState(150);
  const [includeQuiz, setIncludeQuiz] = useState(true);
  const [includeImage, setIncludeImage] = useState(false);
  const documentSkills = useDocumentSkills();
  const [imageStyle, setImageStyle] = useState<DecorativeImageStyle>(settings.imageStyle);
  const [language, setLanguage] = useState<PromptLanguage>(normalizePromptLanguage(settings.promptLanguage ?? settings.uiLanguage));
  const [model, setModel] = useFeatureModel(settings, 'immersionModel');
  // The thinking level for that model, shared with the Research chat's memory.
  const [thinkingEffort, setThinkingEffort] = useResearchEffort(settings, model ?? null);

  const [scope, setScope] = useState<ImmersionScope | null>(null);
  const [scoping, setScoping] = useState(false);
  const [generationJob, setGenerationJob] = useState<ImmersionGenerationJob | null>(() =>
    getBackgroundJob(IMMERSION_GENERATION_JOB_KEY)
  );
  const appliedGenerationRef = useRef<string | null>(null);

  const [session, setSession] = useState<ImmersionSession | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [citation, setCitation] = useState<CitationTarget>(null);
  const [savingToNotes, setSavingToNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasModel = !!model;
  const generating = generationJob?.status === 'running';
  const genProgress = generationJob?.progress ?? null;

  useEffect(
    () => subscribeBackgroundJob(IMMERSION_GENERATION_JOB_KEY, setGenerationJob),
    []
  );

  const refreshSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      setSessions(await window.nodus.listImmersionSessions());
      setSessionsRead(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!sessionsRead) return;
    const available = new Set(sessions.map((item) => item.id));
    setOpenIds((ids) => {
      const remaining = ids.filter((id) => available.has(id));
      return remaining.length === ids.length ? ids : remaining;
    });
    for (const id of sessionCache.current.keys()) {
      if (!available.has(id)) sessionCache.current.delete(id);
    }
  }, [sessions, sessionsRead]);

  useEffect(() => {
    if (!generationJob) {
      appliedGenerationRef.current = null;
      return;
    }
    if (appliedGenerationRef.current !== generationJob.id) {
      const { request, scope: savedScope } = generationJob.request;
      appliedGenerationRef.current = generationJob.id;
      setScope(savedScope);
      setTopic(request.topic);
      setMinutes(request.minutes);
      setIncludeQuiz(request.includeQuiz);
      setIncludeImage(request.decorativeImage?.enabled ?? false);
      setImageStyle(request.decorativeImage?.style ?? settings.imageStyle);
      setLanguage(request.language ?? 'es');
      setModel(request.model ?? null);
    }
    if (generationJob.status === 'running') {
      setError(null);
      setMode('scope');
      return;
    }
    if (generationJob.status === 'failed') {
      setError(generationJob.error ?? t('No se pudo generar la inmersión.'));
      setMode('scope');
      return;
    }
    if (generationJob.result) {
      setError(null);
      sessionCache.current.set(generationJob.result.id, generationJob.result);
      setOpenIds((ids) => ids.includes(generationJob.result!.id) ? ids : [...ids, generationJob.result!.id]);
      setSession(generationJob.result);
      setMode('player');
      void refreshSessions();
    }
  }, [generationJob, refreshSessions]);

  const exploreScope = async () => {
    if (!documentSkills.valid) { setError(t('Corregir límites de skills')); return; }
    if (!topic.trim()) return;
    setError(null);
    setScoping(true);
    setScope(null);
    try {
      const result = await window.nodus.buildImmersionScope({ topic: topic.trim(), minutes });
      setScope(result);
      setComposerOpen(false);
      setMode('scope');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScoping(false);
    }
  };

  const startImmersion = () => {
    if (!scope) return;
    setError(null);
    startImmersionGeneration({
      scope,
      request: {
        topic: scope.topic,
        documentSkills: documentSkills.policy,
        language,
        minutes,
        includeQuiz,
        model,
        thinkingEffort,
        decorativeImage: { enabled: includeImage, style: imageStyle },
      },
    });
  };

  const openSession = async (id: string, restart = false): Promise<ImmersionSession | null> => {
    setError(null);
    setOpeningId(id);
    const request = ++openingRequest.current;
    try {
      const loaded = restart
        ? await window.nodus.restartImmersionSession(id)
        : sessionCache.current.get(id) ?? await window.nodus.getImmersionSession(id);
      if (request !== openingRequest.current) return null;
      if (loaded) {
        sessionCache.current.set(id, loaded);
        setOpenIds((ids) => ids.includes(id) ? ids : [...ids, id]);
        setSession(loaded);
        setMode('player');
      } else {
        setOpenIds((ids) => ids.filter((key) => key !== id));
      }
      return loaded ?? null;
    } catch (e) {
      if (request === openingRequest.current) setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      if (request === openingRequest.current) setOpeningId(null);
    }
  };

  // The registry builds `onSnapshotChange` inline, so its identity changes on every
  // render of the shell; a ref keeps that out of the effects' dependencies.
  const report = useRef(onSnapshotChange);
  report.current = onSnapshotChange;
  /** The session being reopened. Silences the report until it has landed. */
  const resuming = useRef<string | null>(resumeTarget);
  useEffect(() => {
    if (resuming.current) return;
    report.current?.({ openIds, openSession: mode === 'player' && session ? { id: session.id, label: session.plan.title } : null });
  }, [session, mode, openIds]);

  useEffect(() => {
    const resume = resuming.current;
    if (!resume) return;
    // Reconnect only when this view is mounted. The session itself persists its
    // current player step, so opening it returns directly to the step it was left on.
    // Reporting here rather than in the effect above, because the report has to say
    // what actually loaded: a session deleted elsewhere leaves the section at home —
    // which is also the only way out of the waiting pane the mount opened on.
    void openSession(resume).then((opened) => {
      resuming.current = null;
      if (!opened) setMode('home');
      report.current?.({ openSession: opened ? { id: opened.id, label: opened.plan.title } : null });
    });
  }, []);

  const deleteSession = async (summary: ImmersionSessionSummary) => {
    const ok = await confirm({
      title: t('Eliminar inmersión'),
      message: t('¿Eliminar esta inmersión y todo su progreso? Esta acción no se puede deshacer.'),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.deleteImmersionSession(summary.id);
    closeSession(summary.id);
    void refreshSessions();
  };

  const deleteSessions = async (ids: string[]): Promise<boolean> => {
    if (ids.length === 0) return false;
    const ok = await confirm({
      title: t('Eliminar inmersiones'),
      message: tx('¿Eliminar {n} inmersiones y todo su progreso? Esta acción no se puede deshacer.', { n: ids.length }),
      confirmLabel: t('Eliminar'),
      danger: true,
    });
    if (!ok) return false;
    await Promise.all(ids.map((id) => window.nodus.deleteImmersionSession(id)));
    ids.forEach((id) => sessionCache.current.delete(id));
    setOpenIds((current) => current.filter((id) => !ids.includes(id)));
    if (session && ids.includes(session.id)) exitPlayer();
    void refreshSessions();
    return true;
  };

  const exitPlayer = () => {
    openingRequest.current++;
    setOpeningId(null);
    if (generationJob?.status !== 'running') clearBackgroundJob(IMMERSION_GENERATION_JOB_KEY, generationJob?.id);
    if (session) clearBackgroundJob(immersionDossierJobKey(session.id));
    setSession(null);
    setMode('home');
    void refreshSessions();
  };

  const closeSession = (id: string) => {
    if (openingId === id) {
      openingRequest.current++;
      setOpeningId(null);
    }
    const remaining = openIds.filter((key) => key !== id);
    setOpenIds(remaining);
    sessionCache.current.delete(id);
    if (session?.id === id && mode === 'player') {
      const next = remaining[Math.min(openIds.indexOf(id), remaining.length - 1)];
      if (next) void openSession(next);
      else exitPlayer();
    }
  };

  return (
    <div className="theme-workspace-surface h-full flex flex-col min-h-0">
      {mode !== 'scope' && <WorkspaceTabStrip
        homeLabel={t('Inmersión')}
        homeIcon="target"
        homeTestId="immersion-tab-home"
        tabTestId={(tab) => `immersion-tab-${tab.key}`}
        closeTestId={(tab) => `immersion-close-${tab.key}`}
        tabs={openIds.flatMap((id) => {
          const title = sessionCache.current.get(id)?.plan.title ?? sessions.find((item) => item.id === id)?.title;
          return title ? [{ key: id, title, icon: 'target' }] : [];
        })}
        activeKey={mode === 'player' ? session?.id ?? null : null}
        onActivateHome={exitPlayer}
        onActivateTab={(id) => { void openSession(id); }}
        onCloseTab={closeSession}
      />}
      <div className={mode === 'home' ? 'flex-1 min-h-0' : 'hidden'}>
          <ImmersionHome
            settings={settings}
            sessions={sessions}
            loadingSessions={loadingSessions}
            openingId={openingId}
            error={error}
            snapshot={snapshot}
            onSnapshotChange={onSnapshotChange}
            onNew={() => {
              setError(null);
              setComposerOpen(true);
            }}
            onOpenSession={(id, restart) => void openSession(id, restart)}
            onDeleteSession={(s) => void deleteSession(s)}
            onDeleteSessions={deleteSessions}
          />
          {mode === 'home' && composerOpen && (
            <ImmersionComposerModal
              documentSkills={documentSkills}
              settings={settings}
              topic={topic}
              minutes={minutes}
              includeQuiz={includeQuiz}
              includeImage={includeImage}
              imageStyle={imageStyle}
              language={language}
              model={model}
              thinkingEffort={thinkingEffort}
              onThinkingEffort={setThinkingEffort}
              hasModel={hasModel}
              scoping={scoping}
              error={error}
              onTopic={setTopic}
              onMinutes={setMinutes}
              onIncludeQuiz={setIncludeQuiz}
              onIncludeImage={setIncludeImage}
              onImageStyle={setImageStyle}
              onLanguage={setLanguage}
              onModel={setModel}
              onExplore={() => void exploreScope()}
              onClose={() => setComposerOpen(false)}
            />
          )}
      </div>

      {mode === 'scope' && scope && (
        <ImmersionScopeScreen
          scope={scope}
          includeQuiz={includeQuiz}
          generating={generating}
          genProgress={genProgress}
          error={error}
          hasModel={hasModel}
          onBack={() => {
            if (!generating) {
              if (generationJob) clearBackgroundJob(IMMERSION_GENERATION_JOB_KEY, generationJob.id);
              setMode('home');
            }
          }}
          onStart={() => void startImmersion()}
          onCitation={setCitation}
        />
      )}

      {/* The session is on its way back; the gallery is not what was asked for. */}
      {mode === 'player' && !session && <RestoringPane />}

      {mode === 'player' && session && (
        <DocumentVisualScope target={{ kind: 'immersion', id: session.id }}>
        <ImmersionPlayer
          key={session.id}
          session={session}
          onSession={(next) => {
            sessionCache.current.set(next.id, next);
            setSession((current) => current?.id === next.id ? next : current);
          }}
          onExit={exitPlayer}
          onCitation={setCitation}
          onSaveToNotes={() => setSavingToNotes(true)}
        />
        </DocumentVisualScope>
      )}

      {citation && (
        <SourceCitationModal
          target={citation}
          onClose={() => setCitation(null)}
          onOpenLibraryWork={onOpenLibraryWork}
        />
      )}

      {savingToNotes && session && (
        <SaveToNotesModal
          content={sessionMarkdown(session)}
          defaultTitle={session.plan.title}
          kind="writing"
          source={{ origin: 'writing', model: session.model, ref: 'immersion' }}
          allowProjectLink
          onClose={() => setSavingToNotes(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Home — hero launcher + saved sessions
// ─────────────────────────────────────────────────────────────────────────────

// Exported because the section's snapshot stores it; the union stays declared here,
// next to the select that produces it.
export type ImmersionSortKey = 'recent' | 'oldest' | 'title';

function formatImmersionDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(getActiveLang(), { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function ImmersionHome({
  settings,
  sessions,
  loadingSessions,
  openingId,
  error,
  snapshot,
  onSnapshotChange,
  onNew,
  onOpenSession,
  onDeleteSession,
  onDeleteSessions,
}: {
  settings: AppSettings;
  sessions: ImmersionSessionSummary[];
  loadingSessions: boolean;
  openingId: string | null;
  error: string | null;
  snapshot?: ImmersionSnapshot;
  onSnapshotChange?: (patch: Partial<ImmersionSnapshot>) => void;
  onNew: () => void;
  onOpenSession: (id: string, restart: boolean) => void;
  onDeleteSession: (s: ImmersionSessionSummary) => void;
  onDeleteSessions: (ids: string[]) => Promise<boolean>;
}) {
  // Restored as initial values only, never as a reactive prop.
  const [search, setSearch] = useState(() => snapshot?.search ?? '');
  const [sortKey, setSortKey] = useState<ImmersionSortKey>(() => snapshot?.sortKey ?? 'recent');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => snapshot?.viewMode ?? 'grid');
  const [anchorId, setAnchorId] = useState<string | null>(() => snapshot?.placement?.anchorId ?? null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // The gallery reports its own half of the snapshot; the section above reports the
  // session that was open.
  const report = useRef(onSnapshotChange);
  report.current = onSnapshotChange;
  useEffect(() => {
    report.current?.({ search, sortKey, viewMode });
  }, [search, sortKey, viewMode]);

  // Changing the cut throws the place away with it, skipping its own first run so a
  // restored filter does not drop the restored place a frame later.
  const cutChanged = useRef(false);
  useEffect(() => {
    if (!cutChanged.current) {
      cutChanged.current = true;
      return;
    }
    setAnchorId(null);
    report.current?.({ placement: null });
  }, [search, sortKey]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? sessions.filter((s) => (s.title ?? '').toLowerCase().includes(q)) : sessions;
    const sorted = [...filtered];
    if (sortKey === 'title') sorted.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
    else if (sortKey === 'oldest') sorted.sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? ''));
    else sorted.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return sorted;
  }, [sessions, search, sortKey]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  // Back to the card that was under the top edge, once the list holding it is on
  // screen. If that session is gone, the gallery starts from the top instead.
  const scrollerRef = useListPlacement<HTMLDivElement>({
    restoreAnchorId: anchorId,
    revision: visible,
    onRestoreMissed: () => {
      setAnchorId(null);
      report.current?.({ placement: null });
    },
    onCapture: (topId) => report.current?.({ placement: topId ? { anchorId: topId } : null }),
  });

  const allVisibleSelected = visible.length > 0 && visible.every((s) => selected.has(s.id));
  const toggleAll = () =>
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((s) => s.id)));

  const bulkDelete = async () => {
    const ok = await onDeleteSessions([...selected]);
    if (ok) exitSelection();
  };

  return (
    <div className="theme-workspace-surface h-full flex flex-col min-h-0">
      <SectionHeader
        icon="target"
        title={t('Inmersión')}
        subtitle={t('Domina un tema de tu corpus: el contenido y el progreso se guardan para retomarlos; tus respuestas se borran al reiniciar.')}
        actions={(
          <button className="btn btn-primary gap-1.5" onClick={onNew}>
            <Icon name="plus" /> {t('Nueva inmersión')}
          </button>
        )}
      />

      {error && <div className="border-b border-red-900/60 bg-red-950/40 px-4 py-2 text-xs text-red-300">{error}</div>}

      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2.5">
        <div className="relative min-w-[14rem] flex-1 max-w-md">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            className="input input-with-leading-icon w-full !py-1.5 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Buscar entre tus inmersiones…')}
          />
        </div>
        <select className="input !py-1.5 text-xs" value={sortKey} onChange={(e) => setSortKey(e.target.value as ImmersionSortKey)}>
          <option value="recent">{t('Más recientes')}</option>
          <option value="oldest">{t('Más antiguos')}</option>
          <option value="title">{t('Por título (A–Z)')}</option>
        </select>
        <div className="flex overflow-hidden rounded-lg border border-neutral-700">
          <button
            className={`px-2.5 py-1.5 text-xs ${viewMode === 'grid' ? 'bg-indigo-900/40 text-indigo-200' : 'text-neutral-400 hover:bg-neutral-900'}`}
            onClick={() => setViewMode('grid')}
            title={t('Vista mosaico')}
          >
            <Icon name="grid" size={14} />
          </button>
          <button
            className={`px-2.5 py-1.5 text-xs ${viewMode === 'list' ? 'bg-indigo-900/40 text-indigo-200' : 'text-neutral-400 hover:bg-neutral-900'}`}
            onClick={() => setViewMode('list')}
            title={t('Vista lista')}
          >
            <Icon name="list" size={14} />
          </button>
        </div>
        {sessions.length > 0 && (
          <button
            className={`btn btn-ghost !py-1.5 gap-1.5 border text-xs ${selecting ? 'border-indigo-700/60 text-indigo-200' : 'border-neutral-700'}`}
            onClick={() => (selecting ? exitSelection() : setSelecting(true))}
          >
            <Icon name="check" size={13} /> {selecting ? t('Cancelar') : t('Seleccionar')}
          </button>
        )}
      </div>

      {selecting && (
        <div className="flex flex-wrap items-center gap-2 border-b border-indigo-900/40 bg-indigo-950/20 px-4 py-2 text-xs">
          <button className="text-indigo-300 hover:underline" onClick={toggleAll}>
            {allVisibleSelected ? t('Deseleccionar todo') : t('Seleccionar todo')}
          </button>
          <span className="text-neutral-500">{tx('{n} seleccionadas', { n: selected.size })}</span>
          <div className="flex-1" />
          <button
            className="btn btn-ghost !py-1 gap-1 text-xs text-red-400 disabled:text-neutral-600"
            onClick={() => void bulkDelete()}
            disabled={selected.size === 0}
          >
            <Icon name="trash" size={13} /> {t('Eliminar seleccionadas')}
          </button>
        </div>
      )}

      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Icon name="target" size={28} className="text-neutral-600" />
            <div className="max-w-md text-sm text-neutral-500">
              {loadingSessions
                ? t('Cargando inmersiones…')
                : search.trim()
                  ? t('Ninguna inmersión coincide con tu búsqueda.')
                  : t('Aún no hay inmersiones. Crea la primera y quedará aquí, con su progreso, lista para retomarla.')}
            </div>
            {!search.trim() && !loadingSessions && (
              <button className="btn btn-primary gap-1.5" onClick={onNew}>
                <Icon name="plus" /> {t('Nueva inmersión')}
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-3 gap-4 max-2xl:grid-cols-2 max-lg:grid-cols-1">
            {visible.map((s) => (
              <SessionGridCard
                key={s.id}
                session={s}
                settings={settings}
                selecting={selecting}
                selected={selected.has(s.id)}
                opening={openingId === s.id}
                onToggle={() => toggle(s.id)}
                onOpen={() => onOpenSession(s.id, s.finished)}
                onDelete={() => onDeleteSession(s)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((s) => (
              <SessionListRow
                key={s.id}
                session={s}
                settings={settings}
                selecting={selecting}
                selected={selected.has(s.id)}
                opening={openingId === s.id}
                onToggle={() => toggle(s.id)}
                onOpen={() => onOpenSession(s.id, s.finished)}
                onDelete={() => onDeleteSession(s)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Checkbox shown on gallery cards while in selection mode. */
function SelectCheck({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
        checked ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-neutral-500 bg-neutral-900/70'
      }`}
    >
      {checked && <Icon name="check" size={12} />}
    </span>
  );
}

function SessionGridCard({
  session: s,
  settings,
  selecting,
  selected,
  opening,
  onToggle,
  onOpen,
  onDelete,
}: {
  session: ImmersionSessionSummary;
  settings: AppSettings;
  selecting: boolean;
  selected: boolean;
  opening: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const primary = selecting ? onToggle : onOpen;
  return (
    <div
      data-anchor-id={s.id}
      className={`card group relative flex flex-col gap-3 p-3 transition-colors ${
        selected ? 'border-indigo-600/70 ring-1 ring-indigo-600/40' : 'hover:border-indigo-700/60'
      }`}
    >
      {selecting && (
        <button className="absolute left-4 top-4 z-10" onClick={onToggle} aria-label={t('Seleccionar')}>
          <SelectCheck checked={selected} />
        </button>
      )}
      <button className="block w-full text-left" onClick={primary}>
        <DecorativeImageCard entityKind="immersion" entityId={s.id} image={s.image} defaultStyle={settings.imageStyle} thumbnail />
      </button>
      <div className="mt-auto flex w-full items-end gap-4">
        <ProgressRing pct={s.progressPct} finished={s.finished} />
        <button className="min-w-0 flex-1 text-left" onClick={primary}>
          <div className="truncate text-sm font-medium text-neutral-200" title={s.title}>{s.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
            <span>{tx('{n} estaciones', { n: s.stats.stations })}</span>
            <span>·</span>
            <span>{tx('{n} obras', { n: s.stats.works })}</span>
            <span>·</span>
            <span>{tx('{n} autores', { n: s.stats.authors })}</span>
          </div>
          <div className="mt-1 text-[11px] text-neutral-600">{formatImmersionDate(s.updatedAt)}</div>
        </button>
        {!selecting && (
          <div className="flex flex-col gap-1.5">
            <button className="btn btn-primary !py-1 text-xs gap-1" onClick={onOpen} disabled={opening} title={s.finished ? t('Reiniciar borra las respuestas anteriores y comienza el recorrido desde el principio.') : undefined}>
              <Icon name={opening ? 'sync' : 'play'} size={12} className={opening ? 'animate-spin' : ''} />
              {s.finished ? t('Reiniciar') : s.progressPct > 0 ? t('Continuar') : t('Empezar')}
            </button>
            <button className="btn btn-ghost !py-1 text-xs text-neutral-500 hover:text-red-400" onClick={onDelete}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionListRow({
  session: s,
  settings,
  selecting,
  selected,
  opening,
  onToggle,
  onOpen,
  onDelete,
}: {
  session: ImmersionSessionSummary;
  settings: AppSettings;
  selecting: boolean;
  selected: boolean;
  opening: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const primary = selecting ? onToggle : onOpen;
  return (
    <div
      data-anchor-id={s.id}
      className={`card flex items-center gap-3 p-2.5 transition-colors ${
        selected ? 'border-indigo-600/70 ring-1 ring-indigo-600/40' : 'hover:border-indigo-700/60'
      }`}
    >
      {selecting && (
        <button onClick={onToggle} aria-label={t('Seleccionar')}>
          <SelectCheck checked={selected} />
        </button>
      )}
      <button
        className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-indigo-950/30 to-neutral-900"
        onClick={primary}
      >
        <DecorativeImageCard
          entityKind="immersion"
          entityId={s.id}
          image={s.image}
          defaultStyle={settings.imageStyle}
          thumbnail
          className="absolute inset-0 !h-full !rounded-md"
        />
      </button>
      <ProgressRing pct={s.progressPct} finished={s.finished} size={38} />
      <button className="min-w-0 flex-1 text-left" onClick={primary}>
        <div className="truncate text-sm font-medium text-neutral-200" title={s.title}>{s.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
          <span>{tx('{n} estaciones', { n: s.stats.stations })}</span>
          <span>·</span>
          <span>{tx('{n} obras', { n: s.stats.works })}</span>
          <span>·</span>
          <span>{formatImmersionDate(s.updatedAt)}</span>
        </div>
      </button>
      {!selecting && (
        <>
          <button className="btn btn-primary !py-1 text-xs gap-1" onClick={onOpen} disabled={opening} title={s.finished ? t('Reiniciar borra las respuestas anteriores y comienza el recorrido desde el principio.') : undefined}>
            <Icon name={opening ? 'sync' : 'play'} size={12} className={opening ? 'animate-spin' : ''} />
            {s.finished ? t('Reiniciar') : s.progressPct > 0 ? t('Continuar') : t('Empezar')}
          </button>
          <button className="btn btn-ghost !py-1 text-xs text-neutral-500 hover:text-red-400" onClick={onDelete}>
            <Icon name="trash" size={12} />
          </button>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composer — the new-immersion form (modal). Mirrors Deep Research: a "+" button
// opens this; its primary action explores the territory (no AI), which advances to
// the scope screen where the immersion is actually generated.
// ─────────────────────────────────────────────────────────────────────────────

export function ImmersionComposerModal({
  documentSkills,
  settings,
  topic,
  minutes,
  includeQuiz,
  includeImage,
  imageStyle,
  language,
  model,
  thinkingEffort,
  onThinkingEffort,
  hasModel,
  scoping,
  error,
  onTopic,
  onMinutes,
  onIncludeQuiz,
  onIncludeImage,
  onImageStyle,
  onLanguage,
  onModel,
  onExplore,
  onClose,
}: {
  documentSkills: ReturnType<typeof useDocumentSkills>;
  settings: AppSettings;
  topic: string;
  minutes: number;
  includeQuiz: boolean;
  includeImage: boolean;
  imageStyle: DecorativeImageStyle;
  language: PromptLanguage;
  model: AppSettings['immersionModel'];
  thinkingEffort: ResearchEffort;
  onThinkingEffort: (effort: ResearchEffort) => void;
  hasModel: boolean;
  scoping: boolean;
  error: string | null;
  onTopic: (v: string) => void;
  onMinutes: (v: number) => void;
  onIncludeQuiz: (v: boolean) => void;
  onIncludeImage: (v: boolean) => void;
  onImageStyle: (v: DecorativeImageStyle) => void;
  onLanguage: (v: PromptLanguage) => void;
  onModel: (m: AppSettings['immersionModel']) => void;
  onExplore: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !scoping) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, scoping]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => !scoping && onClose()}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t('Nueva inmersión')}
        className="immersion-composer-modal theme-workspace-surface flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-neutral-700 bg-white shadow-2xl dark:bg-neutral-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <Icon name="target" className="text-indigo-500 dark:text-indigo-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{t('Nueva inmersión')}</h2>
            <p className="text-xs text-neutral-500">{t('Elige el tema y el alcance. Antes de generar verás qué sabe tu corpus (sin IA).')}</p>
          </div>
          <button className="btn btn-ghost px-2" onClick={onClose} aria-label={t('Cerrar')} disabled={scoping}>
            <Icon name="x" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <input
            className="input w-full !py-3 text-base"
            value={topic}
            autoFocus
            onChange={(e) => onTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && topic.trim() && hasModel && !scoping) onExplore();
            }}
            placeholder={t('¿De qué quieres hacerte experto? P. ej.: uso franquista de las fiestas y tradiciones')}
          />

          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">{t('Duración')}</div>
            <div className="flex flex-wrap items-center gap-2">
              {TIME_PRESETS.map((preset) => (
                <button
                  key={preset.minutes}
                  onClick={() => onMinutes(preset.minutes)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                    minutes === preset.minutes
                      ? 'border-indigo-700/60 bg-indigo-900/40 text-indigo-200'
                      : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'
                  }`}
                >
                  <span className="font-medium">{t(preset.label)}</span>
                  <span className="ml-1.5 opacity-70">{t(preset.hint)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onIncludeQuiz(!includeQuiz)}
              aria-pressed={includeQuiz}
              className={`theme-toggle-button rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                includeQuiz
                  ? 'border-emerald-700/60 bg-emerald-900/20 text-emerald-300'
                  : 'border-neutral-700 text-neutral-500 hover:border-neutral-500'
              }`}
              title={t('Las preguntas siempre se pueden saltar durante la sesión')}
            >
              <Icon name={includeQuiz ? 'check' : 'minus'} size={12} className="mr-1" />
              {t('Preguntas de repaso')}
            </button>
            <button
              onClick={() => onIncludeImage(!includeImage)}
              aria-pressed={includeImage}
              className={`theme-toggle-button rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                includeImage
                  ? 'border-indigo-700/60 bg-indigo-900/30 text-indigo-200'
                  : 'border-neutral-700 text-neutral-500 hover:border-neutral-500'
              }`}
              title={t('Se genera una sola vez después de guardar la inmersión')}
            >
              <Icon name={includeImage ? 'check' : 'minus'} size={12} className="mr-1" />
              {t('Imagen decorativa')}
            </button>
            {includeImage && (
              <select className="input !py-1.5 text-xs" value={imageStyle} onChange={(event) => onImageStyle(event.target.value as DecorativeImageStyle)}>
                {DECORATIVE_IMAGE_STYLES.map((style) => <option key={style.id} value={style.id}>{t(style.label)}</option>)}
              </select>
            )}
            <select aria-label={t('Idioma')} className="input !py-1.5 text-xs" value={language} onChange={(e) => onLanguage(normalizePromptLanguage(e.target.value))}>
              {PROMPT_LANGUAGE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <div className="flex w-full min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1"><ModelPicker settings={settings} value={model} onChange={onModel} compact menu /></div>
              <ResearchEffortControl variant="field" className="shrink-0 !py-1.5 text-xs" testId="immersion-thinking" model={model ?? null} value={thinkingEffort} onChange={onThinkingEffort} disabled={!model || scoping} />
            </div>
          </div>

          <DocumentSkillsControl value={documentSkills.policy} onChange={documentSkills.setPolicy} onValidityChange={documentSkills.setValid} />

          {error && (
            <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <button className="btn btn-ghost border border-neutral-300 dark:border-neutral-700" onClick={onClose} disabled={scoping}>
            {t('Cancelar')}
          </button>
          <button
            className="btn btn-primary gap-2 !px-5"
            onClick={onExplore}
            disabled={!topic.trim() || scoping || !hasModel || !documentSkills.valid}
            title={!hasModel ? t('Configura un modelo de síntesis') : undefined}
          >
            <Icon name={scoping ? 'sync' : 'search'} className={scoping ? 'animate-spin' : ''} />
            {scoping ? t('Cartografiando…') : t('Explorar el territorio')}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ProgressRing({ pct, finished, size = 48 }: { pct: number; finished: boolean; size?: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" className="-rotate-90" style={{ width: size, height: size }}>
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" className="stroke-neutral-800" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          className={finished ? 'stroke-emerald-400' : 'stroke-indigo-400'}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-neutral-300">
        {finished ? <Icon name="check" size={Math.round(size / 3.4)} className="text-emerald-300" /> : `${pct}%`}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope — the territory map (phase 0, no AI) + generation overlay
// ─────────────────────────────────────────────────────────────────────────────

const GEN_PHASES: ImmersionBuildProgress['phase'][] = ['discovery', 'document_preparation', 'material', 'curriculum', 'panorama', 'station', 'contrasts', 'frontiers', 'exam', 'assembling'];

const GEN_PHASE_LABELS: Record<ImmersionBuildProgress['phase'], string> = {
  discovery: 'Localizando las mejores obras',
  document_preparation: 'Comprendiendo documentos completos',
  material: 'Cartografiando el territorio',
  curriculum: 'Diseñando la ruta',
  panorama: 'Redactando el panorama',
  station: 'Redactando estaciones',
  contrasts: 'Matriz de contrastes',
  frontiers: 'Fronteras del corpus',
  exam: 'Examen final',
  assembling: 'Ensamblando',
  done: 'Inmersión lista',
};

function ImmersionScopeScreen({
  scope,
  includeQuiz,
  generating,
  genProgress,
  error,
  hasModel,
  onBack,
  onStart,
  onCitation,
}: {
  scope: ImmersionScope;
  includeQuiz: boolean;
  generating: boolean;
  genProgress: ImmersionBuildProgress | null;
  error: string | null;
  hasModel: boolean;
  onBack: () => void;
  onStart: () => void;
  onCitation: (c: CitationTarget) => void;
}) {
  const topAuthors = scope.authors.slice(0, 10);
  const enough = scope.ideas.length >= 4;
  return (
    <div className="h-full flex flex-col min-h-0">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
        <button className="btn btn-ghost gap-1.5" onClick={onBack} disabled={generating}>
          <Icon name="chevronLeft" /> {t('Volver')}
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold flex items-center gap-2 text-neutral-100">
            <Icon name="target" className="text-indigo-300" /> {scope.topic}
          </h1>
          <p className="text-xs text-neutral-500">{t('Esto es lo que tu corpus sabe del tema. Sin IA todavía: solo embeddings y grafo.')}</p>
        </div>
        <div className="flex-1" />
      </header>

      {error && <div className="border-b border-red-900/60 bg-red-950/40 px-4 py-2 text-xs text-red-300">{error}</div>}

      <div className="flex-1 min-h-0 grid grid-cols-[24rem_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="min-h-0 overflow-y-auto border-r border-neutral-800 p-4 max-lg:border-r-0 max-lg:border-b">
          <div className="grid grid-cols-3 gap-2">
            <ScopeStat value={scope.ideas.length} label={t('ideas')} accent="text-indigo-300" />
            <ScopeStat value={scope.works.length} label={t('obras')} accent="text-cyan-300" />
            <ScopeStat value={scope.authors.length} label={t('autores')} accent="text-emerald-300" />
            <ScopeStat value={scope.debateCount} label={t('debates')} accent="text-amber-300" />
            <ScopeStat value={scope.gapCount} label={t('huecos')} accent="text-violet-300" />
            <ScopeStat value={scope.passageCount} label={t('pasajes')} accent="text-neutral-300" />
          </div>

          <div className="mt-4 rounded-lg border border-indigo-800/60 bg-indigo-950/25 p-3 text-xs text-indigo-200">
            {tx('Ruta de ~{n} estaciones guiadas: panorama, contrastes, fronteras y examen final{quiz}. La IA ajusta el número según lo que el tema pida.', {
              n: scope.estimatedStations,
              quiz: includeQuiz ? '' : ` ${t('(sin preguntas)')}`,
            })}
          </div>

          {scope.warnings.map((w, i) => (
            <div key={i} className="mt-2 rounded-md border border-amber-700/60 bg-amber-950/50 px-3 py-2 text-xs text-amber-300">
              {w}
            </div>
          ))}

          {topAuthors.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Voces principales')}</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {topAuthors.map((a) => (
                  <Badge key={a.name} color="indigo" title={tx('{n} ideas relevantes', { n: a.ideaCount })}>
                    {a.name} <span className="opacity-60">×{a.ideaCount}</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {scope.themes.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Temas que toca')}</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {scope.themes.slice(0, 12).map((theme) => (
                  <Badge key={theme}>{theme}</Badge>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Ideas más fuertes')}</h3>
            <ul className="mt-2 space-y-1.5">
              {scope.ideas.slice(0, 8).map((idea) => (
                <li key={idea.id}>
                  <button
                    className="w-full rounded-md border border-neutral-800 px-2.5 py-1.5 text-left text-xs text-neutral-300 transition-colors hover:border-indigo-700/60"
                    onClick={() => onCitation({ kind: 'idea', id: idea.id })}
                    title={idea.statement}
                  >
                    <span className="mr-1.5 align-middle"><TypeDot type={idea.type} /></span>
                    {idea.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <main className="relative min-h-[20rem] min-h-0 overflow-hidden">
          {scope.graph.nodes.length > 1 ? (
            <GraphBox data={scope.graph} className="absolute inset-0" onOpenNode={(id) => onCitation({ kind: 'idea', id })} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-600">
              {t('No hay suficientes ideas conectadas para dibujar el territorio.')}
            </div>
          )}

          {!generating && (
            <div className="absolute inset-x-0 bottom-8 z-10 flex flex-col items-center gap-2">
              <button
                className="btn btn-primary gap-2 !px-8 !py-3 text-base shadow-lg"
                onClick={onStart}
                disabled={!enough || !hasModel || !scope.aiKeyAvailable}
              >
                <Icon name="play" />
                {t('Generar inmersión')}
              </button>
              {(!enough || !hasModel || !scope.aiKeyAvailable) && (
                <div className="rounded-md border border-amber-700/60 bg-amber-950/80 px-3 py-1.5 text-xs text-amber-300 backdrop-blur-sm">
                  {!enough
                    ? t('No hay material suficiente para una inmersión')
                    : !scope.aiKeyAvailable
                      ? t('Falta la clave del proveedor de IA: configúrala en Ajustes')
                      : t('Configura un modelo de síntesis')}
                </div>
              )}
            </div>
          )}

          {generating && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-950/70 backdrop-blur-sm">
              <div className="card w-full max-w-md border border-neutral-700 p-6">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-200">
                  <Icon name="sync" className="animate-spin text-indigo-300" /> {t('Generando tu inmersión…')}
                </h3>
                <p className="mt-1 text-xs text-neutral-500">
                  {t('Cada parte generada por la IA se guarda: podrás retomar el recorrido sin regenerarlo. Las respuestas de test y texto se limpian al reiniciar.')}
                </p>
                <p className="mt-2 text-xs text-indigo-300">
                  {t('Puedes cambiar de sección: la generación seguirá en segundo plano y este progreso reaparecerá cuando vuelvas.')}
                </p>
                <ol className="mt-4 space-y-1.5">
                  {GEN_PHASES.map((phase) => {
                    const currentIndex = genProgress ? GEN_PHASES.indexOf(genProgress.phase === 'done' ? 'assembling' : genProgress.phase) : -1;
                    const index = GEN_PHASES.indexOf(phase);
                    const state = currentIndex > index || genProgress?.phase === 'done' ? 'done' : currentIndex === index ? 'active' : 'todo';
                    return (
                      <li key={phase} className="flex items-center gap-2 text-xs">
                        <Icon
                          name={state === 'done' ? 'check' : state === 'active' ? 'sync' : 'minus'}
                          size={13}
                          className={state === 'done' ? 'text-emerald-400' : state === 'active' ? 'animate-spin text-indigo-300' : 'text-neutral-600'}
                        />
                        <span className={state === 'todo' ? 'text-neutral-600' : 'text-neutral-300'}>{t(GEN_PHASE_LABELS[phase])}</span>
                        {phase === 'station' && genProgress?.phase === 'station' && genProgress.stationIndex != null && (
                          <span className="text-neutral-500">
                            {genProgress.stationIndex}/{genProgress.stationTotal} · {genProgress.stationTitle}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function ScopeStat({ value, label, accent }: { value: number; label: string; accent: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-2.5 text-center">
      <div className={`text-xl font-semibold ${accent}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Player — the guided experience
// ─────────────────────────────────────────────────────────────────────────────

function ImmersionPlayer({
  session,
  onSession,
  onExit,
  onCitation,
  onSaveToNotes,
}: {
  session: ImmersionSession;
  onSession: (s: ImmersionSession) => void;
  onExit: () => void;
  onCitation: (c: CitationTarget) => void;
  onSaveToNotes: () => void;
}) {
  const steps = useMemo(() => playerSteps(session), [session]);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [appliedTranslation, setAppliedTranslation] = useState<ContentTranslation | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [annotations, setAnnotations] = useState<WritingDraftAnnotation[]>([]);
  const [highlighterColor, setHighlighterColor] = useState<WritingDraftAnnotationColor | null>(null);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const [hasReaderMark, setHasReaderMark] = useState(false);
  // Honest total study time from the actual route, not the requested budget:
  // a deep route can hold far more stations than a single afternoon.
  const totalMinutes = useMemo(() => steps.reduce((acc, s) => acc + stepMeta(s, session).minutes, 0), [steps, session]);
  const progress = session.progress;
  const current = Math.min(progress.currentStep, steps.length - 1);
  const [direction, setDirection] = useState(1);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const markActionsRef = useRef<ReaderSelectionActionsHandle | null>(null);
  const annotationDocumentId = immersionAnnotationDocumentId(session.id);

  const refreshAnnotations = useCallback(async () => {
    try {
      setAnnotations(await window.nodus.listWritingDraftAnnotations(annotationDocumentId));
      setAnnotationError(null);
    } catch (cause) {
      setAnnotationError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [annotationDocumentId]);

  useEffect(() => {
    void refreshAnnotations();
    return window.nodus.onWritingDraftAnnotationsChanged((documentId) => {
      if (documentId === null || documentId === annotationDocumentId) void refreshAnnotations();
    });
  }, [annotationDocumentId, refreshAnnotations]);

  const exportPdf = async () => {
    setExportingPdf(true);
    try {
      const result = await window.nodus.exportImmersionSessionPdf(session.id);
      if (result) toast(tx('Exportado a {path}', { path: result.path }));
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), { tone: 'error' });
    } finally {
      setExportingPdf(false);
    }
  };

  const persist = useCallback(
    (next: ImmersionProgress) => {
      onSession({ ...session, progress: next });
      void window.nodus.setImmersionProgress(session.id, next);
    },
    [session, onSession]
  );

  const goTo = useCallback(
    (index: number, markDone = false) => {
      const clamped = Math.max(0, Math.min(steps.length - 1, index));
      if (clamped === current && !markDone) return;
      setDirection(clamped >= current ? 1 : -1);
      const completed = new Set(progress.completedSteps);
      if (markDone) completed.add(current);
      persist({
        ...progress,
        currentStep: clamped,
        furthestStep: Math.max(progress.furthestStep, clamped),
        completedSteps: [...completed].sort((a, b) => a - b),
      });
      mainRef.current?.scrollTo({ top: 0 });
    },
    [current, steps.length, progress, persist]
  );

  const finish = useCallback(() => {
    const completed = new Set(progress.completedSteps);
    completed.add(current);
    persist({
      ...progress,
      completedSteps: [...completed].sort((a, b) => a - b),
      finishedAt: progress.finishedAt ?? new Date().toISOString(),
    });
  }, [current, progress, persist]);

  // ← / → navigate between steps (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!progress.startedAt || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="tablist"], [role="dialog"]')) return;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'ArrowRight') goTo(current + 1, true);
      if (e.key === 'ArrowLeft') goTo(current - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, goTo, progress.startedAt]);

  const onAnswered = useCallback(
    (record: ImmersionAnswerRecord) => {
      const answers = progress.answers.filter((a) => a.questionId !== record.questionId);
      answers.push(record);
      onSession({ ...session, progress: { ...progress, answers } });
    },
    [session, progress, onSession]
  );

  const step = steps[current];
  const annotationScope = `step:${current}:${appliedTranslation ? `translation:${appliedTranslation.id}` : 'source'}`;
  // Keep the original source key so bookmarks made before annotations became
  // persistent are discovered and migrated by ReaderSelectionActions.
  const readerContextId = appliedTranslation
    ? `${annotationDocumentId}:${annotationScope}`
    : `${annotationDocumentId}:step:${current}`;
  const visibleAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.scope === annotationScope),
    [annotationScope, annotations],
  );
  const createAnnotation = async (input: Omit<WritingDraftAnnotationInput, 'draftId' | 'scope'>) => {
    const created = await window.nodus.createWritingDraftAnnotation({
      ...input,
      draftId: annotationDocumentId,
      scope: annotationScope,
    });
    setAnnotations((currentAnnotations) => [...currentAnnotations.filter((item) => item.id !== created.id), created]);
    setAnnotationError(null);
  };
  const updateComment = async (id: string, comment: string) => {
    const updated = await window.nodus.updateWritingDraftComment(id, comment);
    if (!updated) {
      await refreshAnnotations();
      return;
    }
    setAnnotations((currentAnnotations) => currentAnnotations.map((item) => (item.id === updated.id ? updated : item)));
    setAnnotationError(null);
  };
  const deleteAnnotation = async (id: string) => {
    await window.nodus.deleteWritingDraftAnnotation(id);
    setAnnotations((currentAnnotations) => currentAnnotations.filter((item) => item.id !== id));
    setAnnotationError(null);
  };
  const completedSet = new Set(progress.completedSteps);
  const overallPct = progress.finishedAt
    ? 100
    : Math.min(99, Math.round((progress.completedSteps.length / steps.length) * 100));
  const remainingMinutes = steps.reduce(
    (acc, s, i) => (completedSet.has(i) ? acc : acc + stepMeta(s, session).minutes),
    0
  );
  const nextMeta = current < steps.length - 1 ? stepMeta(steps[current + 1], session) : null;
  const contextTitle = appliedTranslation?.title ?? session.plan.title;
  const contextMarkdown = appliedTranslation?.markdown ?? sessionMarkdown(session);

  // Rail entries grouped as apertura → estaciones → cierre.
  const railGroups = useMemo(() => {
    const groups: { section: ReturnType<typeof stepSection>; items: { step: PlayerStep; index: number }[] }[] = [];
    steps.forEach((s, index) => {
      const section = stepSection(s);
      const last = groups[groups.length - 1];
      if (!last || last.section !== section) groups.push({ section, items: [{ step: s, index }] });
      else last.items.push({ step: s, index });
    });
    return groups;
  }, [steps]);

  if (!progress.startedAt) {
    return (
      <div className="h-full flex flex-col min-h-0">
        <NodiViewContextSource title={contextTitle} text={contextMarkdown} />
        <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
          <button className="btn btn-ghost gap-1.5" onClick={onExit}>
            <Icon name="chevronLeft" /> {t('Volver')}
          </button>
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
            <Icon name="target" className="text-indigo-300" /> {t('Inmersión')}
          </div>
          <div className="flex-1" />
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 py-10">
            <div className="text-center">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-500 dark:text-indigo-300">{t('Tu inmersión está lista')}</div>
              <h1 className="mt-2 text-3xl font-semibold text-neutral-900 dark:text-neutral-100">{session.plan.title}</h1>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
                {tx('{s} estaciones · {i} ideas · {w} obras · ~{m} minutos', {
                  s: session.plan.stats.stations,
                  i: session.plan.stats.ideas,
                  w: session.plan.stats.works,
                  m: totalMinutes,
                })}
              </p>
            </div>
            <div className="mt-7">
              <DecorativeImageCard
                entityKind="immersion"
                entityId={session.id}
                image={session.image}
                defaultStyle={session.image?.style ?? 'antique_book'}
                interactive
                onChange={(image) => onSession({ ...session, image })}
              />
            </div>
            <div className="mt-5">
              <AudioPanel entityKind="immersion" entityId={session.id} />
            </div>
            <div className="mt-7 flex flex-col items-center">
              <button
                className="btn btn-primary gap-2 !px-8 !py-3 text-base"
                onClick={() => persist({ ...progress, startedAt: new Date().toISOString() })}
              >
                <Icon name="play" /> {t('Comenzar inmersión')}
              </button>
              {session.image?.status === 'pending' && (
                <p className="mt-2 text-center text-xs text-neutral-500">{t('Puedes empezar ya: la imagen nunca bloquea el contenido.')}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <NodiViewContextSource title={contextTitle} text={contextMarkdown} />
      {/* Top bar */}
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <button className="btn btn-ghost gap-1.5" onClick={onExit} title={t('El progreso se guarda automáticamente')}>
          <Icon name="chevronLeft" /> {t('Salir')}
        </button>
        <ProgressRing pct={overallPct} finished={progress.finishedAt != null} size={38} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-neutral-100">{appliedTranslation?.title ?? session.plan.title}</div>
          <div className="text-[11px] text-neutral-500">
            {tx('Paso {a} de {b}', { a: current + 1, b: steps.length })}
            {!progress.finishedAt && <> · {tx('~{n} min restantes', { n: remainingMinutes })}</>}
            {session.plan.stoppedReason && (
              <span className="ml-2 text-amber-300" title={session.plan.stoppedReason}>
                <Icon name="alert" size={11} className="mr-0.5" />
                {t('generación degradada en algún paso')}
              </span>
            )}
          </div>
        </div>
        <div className="flex-1" />
        <DocumentVisualActions />
        <button className="btn btn-ghost gap-1.5 border border-neutral-700 text-xs" disabled={exportingPdf} onClick={() => void exportPdf()}>
          <Icon name={exportingPdf ? 'sync' : 'download'} size={13} className={exportingPdf ? 'animate-spin' : ''} />
          {exportingPdf ? t('Exportando…') : `${t('Exportar')} PDF`}
        </button>
        <button className="btn btn-ghost gap-1.5 border border-neutral-700 text-xs" onClick={() => setTranslationOpen(true)}>
          <Icon name="languages" size={13} /> {t('Traducir')}
        </button>
        <button className="btn btn-ghost gap-1.5 text-xs border border-neutral-700" onClick={onSaveToNotes}>
          <Icon name="save" size={13} /> {t('Guardar en notas')}
        </button>
        <ReaderHighlighterControl value={highlighterColor} onChange={setHighlighterColor} />
        <button
          type="button"
          className={`btn btn-ghost h-9 min-h-9 border ${hasReaderMark ? 'border-amber-700/60 text-amber-300' : 'border-neutral-700 text-neutral-500'}`}
          title={t('Ir al marcador de lectura')}
          aria-label={t('Ir al marcador de lectura')}
          disabled={!hasReaderMark}
          onClick={() => markActionsRef.current?.goToMark()}
        >
          <Icon name={hasReaderMark ? 'bookmarkFill' : 'bookmark'} size={15} />
        </button>
      </header>

      {annotationError && (
        <div className="border-b border-red-900 bg-red-950/30 px-4 py-2 text-xs text-red-200">
          {annotationError}
        </div>
      )}

      {/* Segmented progress bar */}
      <div className="flex gap-1 border-b border-neutral-800 px-4 py-2">
        {steps.map((s, i) => (
          <button
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              completedSet.has(i) ? 'bg-emerald-500' : i === current ? 'bg-indigo-400' : 'bg-neutral-800 hover:bg-neutral-700'
            }`}
            title={stepMeta(s, session).title}
            onClick={() => goTo(i)}
          />
        ))}
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Step rail */}
        <nav className="w-64 shrink-0 overflow-y-auto border-r border-neutral-800 p-2 max-lg:hidden">
          {railGroups.map((group) => (
            <div key={group.section} className="mb-2">
              <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-600">
                {t(SECTION_LABELS[group.section])}
              </div>
              {group.items.map(({ step: s, index: i }) => {
                const meta = stepMeta(s, session);
                const done = completedSet.has(i);
                const active = i === current;
                return (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    className={`mb-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                      active
                        ? 'border-indigo-700/60 bg-indigo-900/40 text-indigo-200'
                        : 'border-transparent text-neutral-400 hover:bg-neutral-900'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                        done ? 'bg-emerald-900/50 text-emerald-300' : active ? 'bg-indigo-900/50 text-indigo-200' : 'bg-neutral-800 text-neutral-500'
                      }`}
                    >
                      {done ? <Icon name="check" size={11} /> : s.kind === 'station' ? s.index + 1 : <Icon name={meta.icon} size={11} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={meta.title}>
                      {meta.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-neutral-600">{meta.minutes}′</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Step content + context rail (the wide right side works for the reader, not against them) */}
        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto" data-testid="immersion-reader-document">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={current}
              custom={direction}
              initial={{ opacity: 0, x: 32 * direction }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 * direction }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="flex justify-center gap-6 px-8 py-6 max-md:px-4"
            >
              <div className="min-w-0 max-w-[56rem] flex-1">
                {appliedTranslation ? <Markdown content={appliedTranslation.markdown} className="text-[15px] leading-7" onCitation={onCitation} /> : <>{step.kind === 'panorama' && (
                  <PanoramaStep session={session} onCitation={onCitation} onJump={(i) => goTo(i)} onSession={onSession} />
                )}
                {step.kind === 'station' && (
                  <StationStep
                    session={session}
                    station={session.plan.stations[step.index]}
                    index={step.index}
                    onCitation={onCitation}
                    onAnswered={onAnswered}
                  />
                )}
                {step.kind === 'contrasts' && <ContrastsStep session={session} onCitation={onCitation} />}
                {step.kind === 'frontiers' && <FrontiersStep session={session} />}
                {step.kind === 'exam' && (
                  <ExamStep session={session} onAnswered={onAnswered} onFinish={finish} onSaveToNotes={onSaveToNotes} onExit={onExit} />
                )}</>}
              </div>
              <ContextRail step={step} session={session} onCitation={onCitation} />
            </motion.div>
          </AnimatePresence>
        </main>
        <ReaderSelectionActions
          key={annotationScope}
          ref={markActionsRef}
          targetRef={mainRef}
          contextId={readerContextId}
          annotations={visibleAnnotations}
          highlighterColor={highlighterColor}
          onCreateAnnotation={createAnnotation}
          onUpdateComment={updateComment}
          onDeleteAnnotation={deleteAnnotation}
          onAnnotationError={setAnnotationError}
          onMarkChange={setHasReaderMark}
        />
      </div>

      {/* Compact footer navigation */}
      <footer className="flex items-center gap-2 border-t border-neutral-800 px-3 py-1.5">
        <button
          className="btn btn-ghost !py-1 gap-1 border border-neutral-700 text-xs"
          onClick={() => goTo(current - 1)}
          disabled={current === 0}
        >
          <Icon name="chevronLeft" size={12} /> {t('Anterior')}
        </button>
        <div className="flex-1 text-center text-[10px] text-neutral-600">{t('← → · progreso guardado')}</div>
        {nextMeta ? (
          <button className="btn btn-primary !py-1 gap-1 text-xs" onClick={() => goTo(current + 1, true)}>
            {t('Siguiente:')} <span className="max-w-[14rem] truncate">{nextMeta.title}</span> <Icon name="chevronRight" size={12} />
          </button>
        ) : (
          <div className="w-20" />
        )}
      </footer>
      <FindInPage targetRef={mainRef} />
      {translationOpen && (
        <TranslationModal
          entityKind="immersion"
          entityId={session.id}
          sourceTitle={session.plan.title}
          sourceMarkdown={sessionMarkdown(session)}
          model={session.model}
          activeTranslationId={appliedTranslation?.id ?? null}
          onApply={setAppliedTranslation}
          onClose={() => setTranslationOpen(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Context rail — persistent study companion on wide screens
// ─────────────────────────────────────────────────────────────────────────────

function ContextRail({
  step,
  session,
  onCitation,
}: {
  step: PlayerStep;
  session: ImmersionSession;
  onCitation: (c: CitationTarget) => void;
}) {
  const plan = session.plan;

  const station = step.kind === 'station' ? plan.stations[step.index] : null;
  const stationGraph = useMemo<GraphData>(() => {
    if (!station) return { nodes: [], edges: [] };
    const ids = new Set(station.ideaIds);
    const nodes = plan.graph.nodes.filter((n) => ids.has(n.id));
    const nodeIds = new Set(nodes.map((n) => n.id));
    return { nodes, edges: plan.graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)) };
  }, [plan.graph, station]);

  const stationWorks = useMemo(() => {
    if (!station) return [] as { title: string; detail: string }[];
    const seen = new Map<string, { title: string; detail: string }>();
    for (const c of station.citations) {
      const detail = [c.authors.slice(0, 2).join(', '), c.year ?? ''].filter(Boolean).join(' · ');
      seen.set(c.workId, { title: c.workTitle, detail });
    }
    for (const ref of plan.ideaIndex.filter((r) => station.ideaIds.includes(r.id))) {
      for (const title of ref.workTitles) {
        if (![...seen.values()].some((w) => w.title === title)) seen.set(title, { title, detail: ref.authors.slice(0, 2).join(', ') });
      }
    }
    return [...seen.values()].slice(0, 8);
  }, [plan.ideaIndex, station]);

  return (
    <aside className="hidden w-80 shrink-0 2xl:block">
      <div className="sticky top-0 space-y-3">
        {step.kind === 'station' && station ? (
          <>
            {stationGraph.nodes.length > 1 && (
              <div className="overflow-hidden rounded-lg border border-neutral-800">
                <div className="flex items-center gap-1.5 border-b border-neutral-800 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  <Icon name="network" size={11} className="text-cyan-300" />
                  {tx('Este rincón del grafo · {n} ideas', { n: stationGraph.nodes.length })}
                </div>
                <GraphBox data={stationGraph} className="h-64" onOpenNode={(id) => onCitation({ kind: 'idea', id })} />
              </div>
            )}
            {station.positions.length > 0 && (
              <RailCard title={t('Voces de esta estación')} icon="graduation">
                <div className="flex flex-wrap gap-1.5">
                  {station.positions.map((p) => (
                    <Badge key={p.name} color="green">{p.name}</Badge>
                  ))}
                </div>
              </RailCard>
            )}
            {stationWorks.length > 0 && (
              <RailCard title={t('Obras sobre la mesa')} icon="book">
                <ul className="space-y-1.5">
                  {stationWorks.map((w) => (
                    <li key={w.title} className="text-xs leading-5">
                      <span className="text-neutral-300">{w.title}</span>
                      {w.detail && <span className="text-neutral-600"> — {w.detail}</span>}
                    </li>
                  ))}
                </ul>
              </RailCard>
            )}
          </>
        ) : (
          <>
            <RailCard title={t('Esta inmersión')} icon="target">
              <div className="grid grid-cols-2 gap-2">
                <RailStat value={plan.stats.stations} label={t('estaciones')} />
                <RailStat value={plan.stats.ideas} label={t('ideas')} />
                <RailStat value={plan.stats.works} label={t('obras')} />
                <RailStat value={plan.stats.authors} label={t('autores')} />
                <RailStat value={plan.stats.citations} label={t('citas')} />
                <RailStat value={plan.stats.quizQuestions} label={t('preguntas')} />
              </div>
            </RailCard>
            {plan.graph.nodes.length > 1 && (
              <div className="overflow-hidden rounded-lg border border-neutral-800">
                <div className="flex items-center gap-1.5 border-b border-neutral-800 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  <Icon name="network" size={11} className="text-cyan-300" />
                  {t('El territorio completo')}
                </div>
                <GraphBox data={plan.graph} className="h-64" onOpenNode={(id) => onCitation({ kind: 'idea', id })} />
              </div>
            )}
            {plan.contrasts.authors.length > 0 && (
              <RailCard title={t('Voces principales')} icon="graduation">
                <div className="flex flex-wrap gap-1.5">
                  {plan.contrasts.authors.map((a) => (
                    <Badge key={a} color="indigo">{a}</Badge>
                  ))}
                </div>
              </RailCard>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function RailCard({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        <Icon name={icon} size={11} /> {title}
      </div>
      {children}
    </div>
  );
}

function RailStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-md border border-neutral-800 px-2 py-1.5 text-center">
      <div className="text-sm font-semibold text-indigo-300">{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-neutral-600">{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step renderers
// ─────────────────────────────────────────────────────────────────────────────

function StepHeading({ kicker, title, subtitle }: { kicker: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-400">{kicker}</div>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-100">{title}</h2>
      {subtitle && <p className="mt-1.5 text-sm leading-6 text-neutral-400">{subtitle}</p>}
    </div>
  );
}

function PanoramaStep({
  session,
  onCitation,
  onJump,
  onSession,
}: {
  session: ImmersionSession;
  onCitation: (c: CitationTarget) => void;
  onJump: (stepIndex: number) => void;
  onSession: (s: ImmersionSession) => void;
}) {
  const plan = session.plan;
  return (
    <div>
      {(session.image?.status === 'ready' || session.image?.status === 'pending') && (
        <div className="mb-6">
          <DecorativeImageCard
            entityKind="immersion"
            entityId={session.id}
            image={session.image}
            defaultStyle={session.image?.style ?? 'antique_book'}
            interactive
            onChange={(image) => onSession({ ...session, image })}
          />
        </div>
      )}
      <StepHeading
        kicker={t('Panorama')}
        title={plan.title}
        subtitle={t('El mapa mental antes de bajar al detalle: posiciones, autores y cómo se conecta la ruta.')}
      />
      <Markdown content={plan.overview} className="text-[15px] leading-7" onCitation={(c: MarkdownCitation) => onCitation(c)} />

      {plan.keyTerms.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('Vocabulario del campo')}</h3>
          <div className="mt-2 grid grid-cols-2 gap-2 max-md:grid-cols-1">
            {plan.keyTerms.map((kt) => (
              <div key={kt.term} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                <div className="text-sm font-medium text-indigo-300">{kt.term}</div>
                <div className="mt-0.5 text-xs leading-5 text-neutral-400">{kt.definition}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The journey map: every station, clickable, so the route feels owned. */}
      <div className="mt-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('La ruta de hoy')}</h3>
        <div className="mt-2 space-y-1.5">
          {plan.stations.map((station, i) => (
            <button
              key={station.id}
              onClick={() => onJump(1 + i)}
              className="flex w-full items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-left transition-colors hover:border-indigo-700/60"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-900/50 text-[11px] font-semibold text-indigo-200">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-neutral-200">{station.title}</span>
                <span className="block truncate text-[11px] text-neutral-500">{station.question}</span>
              </span>
              <span className="shrink-0 text-[10px] text-neutral-600">
                {tx('{n} ideas', { n: station.ideaIds.length })}
                {station.citations.length > 0 && <> · {tx('{n} citas', { n: station.citations.length })}</>}
              </span>
              <Icon name="chevronRight" size={12} className="shrink-0 text-neutral-600" />
            </button>
          ))}
          <div className="flex items-center gap-2 px-3 pt-1 text-[11px] text-neutral-600">
            <Icon name="scale" size={11} /> {t('Contrastes')} · <Icon name="gap" size={11} /> {t('Fronteras')} ·{' '}
            <Icon name="graduation" size={11} /> {t('Examen final')}
          </div>
        </div>
      </div>
    </div>
  );
}

function StationStep({
  session,
  station,
  index,
  onCitation,
  onAnswered,
}: {
  session: ImmersionSession;
  station: ImmersionStation;
  index: number;
  onCitation: (c: CitationTarget) => void;
  onAnswered: (r: ImmersionAnswerRecord) => void;
}) {
  const [graphOpen, setGraphOpen] = useState(false);

  const stationGraph = useMemo<GraphData>(() => {
    const ids = new Set(station.ideaIds);
    const nodes = session.plan.graph.nodes.filter((n) => ids.has(n.id));
    const nodeIds = new Set(nodes.map((n) => n.id));
    return { nodes, edges: session.plan.graph.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)) };
  }, [session.plan.graph, station.ideaIds]);

  if (!station) return null;
  return (
    <div>
      <StepHeading
        kicker={tx('Estación {n} de {m}', { n: index + 1, m: session.plan.stations.length })}
        title={station.title}
        subtitle={station.question}
      />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <Badge color="indigo">{tx('{n} ideas', { n: station.ideaIds.length })}</Badge>
        {station.citations.length > 0 && <Badge color="amber">{tx('{n} citas literales', { n: station.citations.length })}</Badge>}
        {station.positions.length > 0 && <Badge color="green">{tx('{n} voces', { n: station.positions.length })}</Badge>}
        <Badge>{tx('~{n} min', { n: station.minutes })}</Badge>
      </div>

      {/* 1 · Framing: what is at stake in this sub-question */}
      {station.context && (
        <div className="mb-5 rounded-lg border border-indigo-800/60 bg-indigo-950/25 p-4">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
            <Icon name="info" size={11} /> {t('Por qué importa')}
          </div>
          <Markdown content={station.context} className="text-sm leading-6" onCitation={(c: MarkdownCitation) => onCitation(c)} />
        </div>
      )}

      {/* 2 · The lesson */}
      <SectionTitle icon="book" label={t('La lección')} />
      <Markdown content={station.synthesis} className="mt-2 text-[15px] leading-7" onCitation={(c: MarkdownCitation) => onCitation(c)} />

      {/* 3 · Guided close reading of the literal quotes */}
      {station.citations.length > 0 && (
        <div className="mt-7">
          <SectionTitle icon="quote" label={t('Lectura guiada: citas que un experto conoce de memoria')} />
          <div className="mt-2 space-y-2.5">
            {station.citations.map((c) => (
              <QuoteCard key={c.passageId} citation={c} onOpen={() => onCitation({ kind: 'passage', id: c.passageId })} />
            ))}
          </div>
        </div>
      )}

      {/* 4 · Who holds what */}
      {station.positions.length > 0 && (
        <div className="mt-7">
          <SectionTitle icon="graduation" label={t('Quién sostiene qué')} />
          <div className="mt-2 grid grid-cols-2 gap-2 max-md:grid-cols-1">
            {station.positions.map((p) => (
              <div key={p.name} className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                <div className="text-sm font-medium text-emerald-300">{p.name}</div>
                <div className="mt-1 text-xs leading-5 text-neutral-300">{p.position}</div>
                {p.ideaIds.length > 0 && (
                  <button
                    className="mt-1.5 text-[11px] text-indigo-400 hover:underline"
                    onClick={() => onCitation({ kind: 'idea', id: p.ideaIds[0] })}
                  >
                    {t('Ver idea de origen')} →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Graph excerpt inline only on narrower screens (the rail shows it on 2xl+) */}
      {stationGraph.nodes.length > 1 && (
        <div className="mt-7 overflow-hidden rounded-lg border border-neutral-800 2xl:hidden">
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-neutral-400 hover:bg-neutral-900/80"
            onClick={() => setGraphOpen((v) => !v)}
          >
            <Icon name={graphOpen ? 'chevronDown' : 'chevronRight'} size={12} />
            <Icon name="network" size={12} className="text-cyan-300" />
            {tx('Este rincón del grafo · {n} ideas', { n: stationGraph.nodes.length })}
          </button>
          {graphOpen && (
            <GraphBox
              data={stationGraph}
              className="h-72 border-t border-neutral-800"
              onOpenNode={(id) => onCitation({ kind: 'idea', id })}
            />
          )}
        </div>
      )}

      {/* 5 · What to retain */}
      {station.takeaways.length > 0 && (
        <div className="mt-7 rounded-lg border border-emerald-700/60 bg-emerald-900/20 p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
            <Icon name="check" size={11} /> {t('Para retener')}
          </div>
          <ul className="space-y-1.5">
            {station.takeaways.map((tk, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-6 text-neutral-200">
                <Icon name="check" size={13} className="mt-1 shrink-0 text-emerald-300" />
                {tk}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 6 · Retrieval check */}
      {station.quiz.length > 0 && (
        <div className="mt-7">
          <SectionTitle icon="help" label={t('Comprueba que lo dominas')} hint={t('opcional, puedes saltarlo')} />
          <div className="mt-2 space-y-3">
            {station.quiz.map((q) => (
              <QuizCard key={q.id} sessionId={session.id} question={q} answers={session.progress.answers} onAnswered={onAnswered} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ icon, label, hint }: { icon: string; label: string; hint?: string }) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-500">
      <Icon name={icon} size={12} /> {label}
      {hint && <span className="normal-case tracking-normal text-neutral-600">· {hint}</span>}
    </h3>
  );
}

function QuoteCard({ citation, onOpen }: { citation: ImmersionStation['citations'][number]; onOpen: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const long = citation.text.length > 420;
  const shown = expanded || !long ? citation.text : `${citation.text.slice(0, 420).trim()}…`;
  return (
    <figure className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <blockquote className="border-l-2 border-indigo-400 pl-3 text-sm italic leading-6 text-neutral-200">“{shown}”</blockquote>
      {long && (
        <button className="mt-1.5 text-[11px] text-indigo-400 hover:underline" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('Ver menos') : t('Leer el pasaje completo')}
        </button>
      )}
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-500">
        <button className="font-medium text-neutral-300 hover:text-indigo-300 hover:underline" onClick={onOpen}>
          {citation.workTitle}
        </button>
        {citation.authors.length > 0 && <span>· {citation.authors.slice(0, 3).join(', ')}</span>}
        {citation.year != null && <span>({citation.year})</span>}
        {citation.pageLabel && <span>· {tx('p. {p}', { p: citation.pageLabel })}</span>}
      </figcaption>
      {citation.whyItMatters && (
        <div className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-amber-300">
          <Icon name="star" size={12} className="mt-0.5 shrink-0" />
          {citation.whyItMatters}
        </div>
      )}
      {citation.commentary && (
        <div className="mt-2.5 rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            <Icon name="eye" size={11} /> {t('Cómo leer este pasaje')}
          </div>
          <p className="text-xs leading-5 text-neutral-300">{citation.commentary}</p>
        </div>
      )}
    </figure>
  );
}

function ContrastsStep({ session, onCitation }: { session: ImmersionSession; onCitation: (c: CitationTarget) => void }) {
  const { authors, rows } = session.plan.contrasts;
  return (
    <div>
      <StepHeading
        kicker={t('Contrastes')}
        title={t('Quién dice qué, frente a frente')}
        subtitle={t('La matriz que distingue a un experto: cada autor frente a cada sub-pregunta. Las celdas vacías también informan — ese autor no se pronuncia ahí.')}
      />
      {authors.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('No hay suficientes autores con posiciones diferenciadas en este tema.')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-800">
          <table className="w-full min-w-[40rem] border-collapse text-xs">
            <thead>
              <tr className="bg-neutral-900/80">
                <th className="sticky left-0 z-10 bg-neutral-900/95 px-3 py-2 text-left font-semibold text-neutral-400">{t('Sub-pregunta')}</th>
                {authors.map((a) => (
                  <th key={a} className="px-3 py-2 text-left font-semibold text-emerald-300">
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.stationId} className="border-t border-neutral-800 align-top">
                  <td className="sticky left-0 z-10 max-w-[14rem] bg-neutral-950/95 px-3 py-2 font-medium text-neutral-300">{row.question}</td>
                  {row.cells.map((cell) => (
                    <td key={cell.author} className="max-w-[16rem] px-3 py-2 leading-5 text-neutral-400">
                      {cell.stance ? (
                        <>
                          {cell.stance}
                          {cell.ideaIds.length > 0 && (
                            <button
                              className="ml-1 align-middle text-indigo-400 hover:underline"
                              title={t('Ver idea de origen')}
                              onClick={() => onCitation({ kind: 'idea', id: cell.ideaIds[0] })}
                            >
                              →
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-neutral-600">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DocumentVisualFigures field="contrasts" />
    </div>
  );
}

function FrontiersStep({ session }: { session: ImmersionSession }) {
  const frontiers = session.plan.frontiers;
  return (
    <div>
      <StepHeading
        kicker={t('Fronteras')}
        title={t('Lo que tu corpus no sabe (todavía)')}
        subtitle={t('Conocer los límites es parte de la maestría: aquí terminan tus fuentes y empieza el trabajo futuro.')}
      />
      {frontiers.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('No se detectaron huecos relevantes para este tema. Buen síntoma.')}</p>
      ) : (
        <div className="space-y-2.5">
          {frontiers.map((f, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3.5">
              <Icon name={f.kind === 'gap' ? 'gap' : 'alert'} size={16} className={f.kind === 'gap' ? 'mt-0.5 text-violet-300' : 'mt-0.5 text-amber-300'} />
              <div className="min-w-0">
                <div className="text-sm leading-6 text-neutral-200">{f.statement}</div>
                {f.detail && <div className="mt-0.5 text-xs leading-5 text-neutral-500">{f.detail}</div>}
                {f.workTitle && <div className="mt-1 text-[11px] text-neutral-600">{f.workTitle}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExamStep({
  session,
  onAnswered,
  onFinish,
  onSaveToNotes,
  onExit,
}: {
  session: ImmersionSession;
  onAnswered: (r: ImmersionAnswerRecord) => void;
  onFinish: () => void;
  onSaveToNotes: () => void;
  onExit: () => void;
}) {
  const exam = session.plan.exam;
  const finished = session.progress.finishedAt != null;
  const summary = useMemo(() => examSummary(session), [session]);

  // Deepen after mastering: hand the topic to the Deep Research engine and keep
  // the resulting multi-page cited report among the saved Deep Research drafts.
  const dossierKey = immersionDossierJobKey(session.id);
  const [dossierJob, setDossierJob] = useState<DeepResearchGenerationJob | null>(() => getBackgroundJob(dossierKey));
  useEffect(() => subscribeBackgroundJob(dossierKey, setDossierJob), [dossierKey]);
  const dossierBusy = dossierJob?.status === 'running';
  const dossierDone = dossierJob?.status === 'completed' && !!dossierJob.result?.savedDraft;
  let dossierMsg: string | null = null;
  if (dossierJob?.status === 'running') dossierMsg = dossierJob.progress?.message ?? t('Generando informe…');
  if (dossierJob?.status === 'failed') dossierMsg = dossierJob.error;
  if (dossierJob?.status === 'completed' && dossierJob.result) {
    const { report, saveError } = dossierJob.result;
    dossierMsg = saveError
      ? tx('Informe generado, pero no se pudo guardar automáticamente: {error}', { error: saveError })
      : tx('Dossier guardado: «{t}» · {s} secciones · ~{p} páginas. Lo tienes en Deep Research → informes guardados.', {
          t: report.draft.title,
          s: report.meta.sections,
          p: report.meta.pages,
        });
  }
  const generateDossier = () => {
    startDeepResearchGeneration(dossierKey, {
      objective: session.plan.topic,
      language: session.plan.language,
      deepResearchVersion: 'v1',
      sectionLimit: 'auto',
      model: session.model,
      decorativeImage: {
        enabled: session.image?.requested ?? false,
        style: session.image?.style ?? 'antique_book',
      },
    });
  };

  return (
    <div>
      <StepHeading
        kicker={t('Examen final')}
        title={finished ? t('Inmersión completada') : t('Demuestra que eres experto')}
        subtitle={
              exam.questions.length
            ? t('Cubre todas las estaciones. Las respuestas abiertas se guardan como reflexiones privadas y nunca se envían a una IA.')
            : t('Sesión sin preguntas: cierra con la explicación final y da la inmersión por completada.')
        }
      />

      {finished && (
        <div className="mb-5 rounded-xl border border-emerald-700/60 bg-emerald-900/20 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900/50">
              <Icon name="check" size={22} className="text-emerald-300" />
            </div>
            <div>
              <div className="text-base font-semibold text-emerald-300">{t('Inmersión completada')}</div>
              <div className="mt-0.5 text-xs text-emerald-300">
                {tx('{s} estaciones · {q} respuestas guardadas localmente', {
                  s: session.plan.stations.length,
                  q: summary.answered,
                })}
              </div>
            </div>
            <div className="flex-1" />
            <button className="btn btn-ghost border border-emerald-700/60 text-emerald-300 gap-1.5 text-xs" onClick={onSaveToNotes}>
              <Icon name="save" size={13} /> {t('Guardar dossier en notas')}
            </button>
            <button className="btn btn-primary gap-1.5 text-xs" onClick={onExit}>
              <Icon name="home" size={13} /> {t('Volver al inicio')}
            </button>
          </div>
        </div>
      )}

      {finished && (
        <div className="mb-5 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-start gap-3">
            <Icon name="compass" size={18} className="mt-0.5 shrink-0 text-indigo-300" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-neutral-200">{t('Profundiza: informe Deep Research del tema')}</div>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                {t('Ahora que dominas el tema, genera el informe académico de varias páginas con todas las fuentes citadas. Se guarda en Deep Research y podrás exportarlo o citarlo en tu escritura.')}
              </p>
              {dossierBusy && (
                <p className="mt-1 text-xs text-indigo-300">
                  {t('Puedes cambiar de sección: el informe seguirá generándose y mostrará el progreso al volver.')}
                </p>
              )}
              {dossierMsg && (
                <div className={`mt-2 rounded-md border px-3 py-2 text-xs ${dossierDone ? 'border-emerald-700/60 bg-emerald-900/20 text-emerald-300' : 'border-neutral-800 bg-neutral-950/60 text-neutral-400'}`}>
                  {dossierMsg}
                </div>
              )}
            </div>
            <button className="btn btn-primary gap-1.5 text-xs shrink-0" onClick={() => void generateDossier()} disabled={dossierBusy}>
              <Icon name={dossierBusy ? 'sync' : 'compass'} size={13} className={dossierBusy ? 'animate-spin' : ''} />
              {dossierBusy ? t('Generando informe…') : dossierDone ? t('Generar de nuevo') : t('Generar informe')}
            </button>
          </div>
        </div>
      )}

      {exam.questions.length > 0 && (
        <div className="space-y-3">
          {exam.questions.map((q) => (
            <QuizCard key={q.id} sessionId={session.id} question={q} answers={session.progress.answers} onAnswered={onAnswered} />
          ))}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-indigo-800/60 bg-indigo-950/25 p-4">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-300">
          <Icon name="wand" size={12} /> {t('El cierre Feynman')}
        </h3>
        <p className="mt-1.5 text-sm leading-6 text-neutral-300">{exam.feynman}</p>
        <p className="mt-2 text-[11px] text-neutral-500">
          {t('Hazlo en voz alta o por escrito. Si te atascas en un punto, vuelve a su estación — para eso están las flechas.')}
        </p>
      </div>

      {!finished && (
        <div className="mt-6 flex justify-center">
          <button className="btn btn-primary gap-2 !px-8 !py-2.5" onClick={onFinish}>
            <Icon name="check" /> {t('Terminar inmersión')}
          </button>
        </div>
      )}
    </div>
  );
}

function examSummary(session: ImmersionSession): { answered: number } {
  const examIds = new Set(session.plan.exam.questions.map((q) => q.id));
  const stationIds = new Set(session.plan.stations.flatMap((s) => s.quiz.map((q) => q.id)));
  const relevant = session.progress.answers.filter((a) => examIds.has(a.questionId) || stationIds.has(a.questionId));
  return { answered: relevant.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quiz cards (choice → exact local check; open → unscored local reflection).
// ─────────────────────────────────────────────────────────────────────────────

function QuizCard({
  sessionId,
  question,
  answers,
  onAnswered,
}: {
  sessionId: string;
  question: ImmersionQuizQuestion;
  answers: ImmersionAnswerRecord[];
  onAnswered: (r: ImmersionAnswerRecord) => void;
}) {
  const saved = answers.find((a) => a.questionId === question.id) ?? null;
  const [draft, setDraft] = useState(saved?.kind === 'open' ? saved.answer : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (answer: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await window.nodus.answerImmersionQuestion({ sessionId, questionId: question.id, answer });
      onAnswered(result.record);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-start gap-2">
        <Icon name="help" size={14} className="mt-1 shrink-0 text-indigo-300" />
        <div className="min-w-0 flex-1 text-sm leading-6 text-neutral-200"><StudyMarkdown content={question.question} /></div>
      </div>

      {question.kind === 'choice' && (
        <div className="mt-3 space-y-1.5">
          {question.options.map((option, i) => {
            const chosen = saved?.kind === 'choice' ? Number(saved.answer) : null;
            const revealed = chosen != null;
            const isCorrect = i === question.correctIndex;
            const isChosen = chosen === i;
            let cls = 'border-neutral-700 text-neutral-300 hover:border-indigo-700/60';
            if (revealed && isCorrect) cls = 'border-emerald-700/60 bg-emerald-900/20 text-emerald-300';
            else if (revealed && isChosen && !isCorrect) cls = 'border-red-900/60 bg-red-950/40 text-red-300';
            else if (revealed) cls = 'border-neutral-800 text-neutral-500';
            return (
              <button
                key={i}
                disabled={revealed || busy}
                onClick={() => void submit(String(i))}
                className={`block w-full rounded-md border px-3 py-2 text-left text-xs leading-5 transition-colors ${cls}`}
              >
                <span className="mr-2 font-semibold">{String.fromCharCode(65 + i)}.</span>
                <StudyMarkdownInline content={option} />
                {revealed && isCorrect && <Icon name="check" size={12} className="ml-1.5 text-emerald-300" />}
              </button>
            );
          })}
          {saved?.kind === 'choice' && question.explanation && (
            <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs leading-5 text-neutral-400">
              <Icon name="info" size={12} className="mr-1.5 text-indigo-300" />
              <StudyMarkdownInline content={question.explanation} />
            </div>
          )}
        </div>
      )}

      {question.kind === 'open' && (
        <div className="mt-3">
          <textarea
            className="input w-full min-h-20 resize-y text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('Responde con tus palabras: tesis, autores y evidencia…')}
            disabled={busy}
          />
          <div className="mt-2 flex items-center gap-2">
            <button className="btn btn-primary !py-1 text-xs gap-1.5" onClick={() => void submit(draft)} disabled={busy || !draft.trim()}>
              <Icon name={busy ? 'sync' : 'save'} size={12} className={busy ? 'animate-spin' : ''} />
              {busy ? t('Guardando…') : t('Guardar reflexión local')}
            </button>
            <span className="text-[11px] text-neutral-600">{t('Opcional: puedes seguir sin responder.')}</span>
          </div>
          {saved?.kind === 'open' && (
            <div className="mt-2 rounded-md border border-indigo-800/60 bg-indigo-950/20 px-3 py-2 text-xs leading-5 text-neutral-300">
              <p>{t('Reflexión guardada localmente. Nodus no la envía a una IA ni la puntúa.')}</p>
              {question.expected && (
                <details className="mt-2 text-neutral-400">
                  <summary className="cursor-pointer font-medium text-indigo-300">{t('Ver orientación para contrastarla por tu cuenta')}</summary>
                  <div className="mt-1"><StudyMarkdown content={question.expected} /></div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export — assemble the whole immersion as one markdown dossier
// ─────────────────────────────────────────────────────────────────────────────

function sessionMarkdown(session: ImmersionSession): string {
  const plan = session.plan;
  const lines: string[] = [`# ${plan.title}`, '', plan.overview, ''];
  if (plan.keyTerms.length) {
    lines.push(`## ${t('Vocabulario')}`, '');
    for (const kt of plan.keyTerms) lines.push(`- **${kt.term}**: ${kt.definition}`);
    lines.push('');
  }
  plan.stations.forEach((station, i) => {
    lines.push(`## ${i + 1}. ${station.title}`, '', `> ${station.question}`, '');
    if (station.context) lines.push(station.context, '');
    lines.push(station.synthesis, '');
    if (station.citations.length) {
      lines.push(`### ${t('Lectura guiada')}`, '');
      for (const c of station.citations) {
        const src = [c.workTitle, c.authors.slice(0, 3).join(', '), c.year ?? '', c.pageLabel ? `p. ${c.pageLabel}` : '']
          .filter(Boolean)
          .join(' · ');
        lines.push(`> “${c.text.trim()}”`, `> — ${src}`, '');
        if (c.whyItMatters) lines.push(`*${c.whyItMatters}*`, '');
        if (c.commentary) lines.push(c.commentary, '');
      }
    }
    if (station.positions.length) {
      lines.push(`### ${t('Posiciones')}`, '');
      for (const p of station.positions) lines.push(`- **${p.name}**: ${p.position}`);
      lines.push('');
    }
    if (station.takeaways.length) {
      lines.push(`### ${t('Para retener')}`, '');
      for (const tk of station.takeaways) lines.push(`- ${tk}`);
      lines.push('');
    }
  });
  if (plan.contrasts.rows.length && plan.contrasts.authors.length) {
    lines.push(`## ${t('Matriz de contrastes')}`, '');
    lines.push(`| ${t('Sub-pregunta')} | ${plan.contrasts.authors.join(' | ')} |`);
    lines.push(`|${'---|'.repeat(plan.contrasts.authors.length + 1)}`);
    for (const row of plan.contrasts.rows) {
      lines.push(`| ${row.question} | ${row.cells.map((c) => c.stance || '—').join(' | ')} |`);
    }
    lines.push('');
  }
  if (plan.frontiers.length) {
    lines.push(`## ${t('Fronteras del corpus')}`, '');
    for (const f of plan.frontiers) lines.push(`- ${f.statement}${f.workTitle ? ` (${f.workTitle})` : ''}`);
    lines.push('');
  }
  lines.push(`## ${t('Cierre Feynman')}`, '', plan.exam.feynman, '');
  return lines.join('\n');
}
