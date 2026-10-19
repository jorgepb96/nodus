import { useLearningOverlayBusy } from './learning/useLearningOverlayBusy';
import { AcademicLearningContext } from './learning/AcademicLearningContext';
import { useAcademicLearningController } from './learning/useAcademicLearning';
import { AcademicLearningCoach, AcademicLearningDialogs,LearningWorkspaceBar } from './learning/AcademicLearningSurface';
import { lessonForProfile } from '@shared/academicLearning';
import { learningText } from '@shared/academicLearningCopy';
import { requestLearningPrompt } from './learning/learningPrompt';
import { createPortal } from 'react-dom';
import { SHOW_FOCUS_PAGE_EVENT, openFocusLayout, openFocusTimer, toggleFocusTimer, useStudyFocusActions, useStudyFocusLayout, useStudyFocusReduced } from './components/focus/StudyFocusContext';
import { useEditorialShellFocus } from './components/workspace/editorialFocus';
import { parseEditorReference } from '@shared/editorReferences';
import { FocusExitDialog, FocusLayoutDialog, type FocusSectionOption } from './components/focus/FocusDialogs';
import { focusDefaultSectionVisible, focusLayoutVisible } from '@shared/studyFocus';
import { FocusCompletionNotice, FocusHeader } from './components/focus/FocusHeader';
import { FocusRail, type FocusRailItem } from './components/focus/FocusRail';
import { AcademicInterfaceContext } from './components/AcademicInterfaceContext';
import { AcademicInterfacePicker } from './components/AcademicInterface';
import { academicInitialView, academicNavigation, academicNavigationGroups, academicProfileLabel, academicProfilePatch } from './academicInterfaceProfiles';
import { headerActionVisible, type HeaderActionId } from '@shared/headerActions';
import type { AcademicInterfaceProfile } from '@shared/types';
import { ResearchPreparationWelcome } from './components/ResearchPreparationWelcome';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, CorpusHealthBucketId, DatabaseSummary, NodiNotification, RecoveryStatus, ServerInboxEntry, SyncLogEntry, VaultSummary } from '@shared/types';
import type { AnnouncementRefreshResult } from '@shared/announcements';
import type { CsvImportPlanData } from './views/DatabasesView';
import type { NotionImportReport } from '@shared/notionImport';
import { FeedbackModal } from './views/FeedbackModal';
import { RoadmapModal } from './views/RoadmapModal';
import { QueuePanel, useQueueActivity } from './components/QueuePanel';
import { VaultSwitcher, vaultTypeIcon, vaultTypeLabel } from './components/VaultSwitcher';
import { ServerInbox } from './components/ServerInbox';
import { unreadServerInboxGroupCount } from './serverInboxGrouping';
import { NotificationsPanel, useAnnouncements } from './components/NotificationsPanel';
import { BrowserMediaPopover, useBrowserMedia } from './components/browser/BrowserMedia';
import { DriftMiniPlayer } from './components/drift/DriftMiniPlayer';
import { useDrift } from './components/drift/DriftProvider';
import { DatabasesSidebarExplore } from './components/DatabasesSidebarExplore';
import { StudySidebar, type StudyNavigationTarget } from './components/StudySidebar';
import { TeachingSidebar } from './components/TeachingSidebar';
import { PrimarySourcesSidebar } from './components/PrimarySourcesSidebar';
import { CONTINUITY_VIEWS, ContinuityProvider } from './components/world/ContinuityBadge';
import { WorldbuildingSidebar } from './components/WorldbuildingSidebar';
import { ProsopographySidebar } from './components/ProsopographySidebar';
import { TestimonySidebar } from './components/TestimonySidebar';
import type { DossierTab } from './components/testimonies/InterviewDossier';
import type { TestimonyDeepLink } from '@shared/testimonyDeepLinks';
import { FeedbackHost } from './components/feedback';
import { PrivacyRequestHost } from './privacyNotices';
import { BrowserConnectorPairingRequestHost } from './components/BrowserConnectorPairingRequestHost';
import { Tour } from './views/Tour';
import { AdvancedTour } from './views/AdvancedTour';
import { GenealogyTour } from './views/GenealogyTour';
import { DatabasesTour } from './views/DatabasesTour';
import { TestimonyTour } from './views/TestimonyTour';
import { StudyTour } from './views/StudyTour';
import { TeachingTour } from './views/TeachingTour';
import { PrimarySourcesTour } from './views/PrimarySourcesTour';
import { ProsopographyTour } from './views/ProsopographyTour';
import { WorldbuildingTour } from './views/WorldbuildingTour';
import { FIRST_VAULT_VERSION } from './views/FirstVaultSetup';
import { hasPendingWhatsNew, WhatsNewModal } from './components/WhatsNewModal';
import { useUpdateProgress } from './useUpdateProgress';
import { pendingUpdateVersion, updateInstallBusy } from './updateStatus';
import { UpdateReadyNotice } from './components/UpdateReadyNotice';
import { AiModelRequiredModal } from './components/AiModelRequiredModal';
import { recoveryHealthAdvice, recoveryHealthHeadline } from './recoveryHealth';
import { NodiMascot } from './components/nodi/NodiMascot';
import { NodiStyleModal } from './components/NodiStyleModal';
import { Icon } from './components/ui';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { t, tx, errorText, setActiveLang } from './i18n';
import { resolveStartupGate } from './app/StartupGate';
import { VIEW_REGISTRY } from './app/viewRegistry';
import type { ViewContext } from './app/ViewContext';
import { notifyDataChanged, useDataRefresh } from './hooks';
import { setActiveVaultQueryScope } from './vaultQueryCache';
import { viewSnapshotAccess } from './app/viewSnapshots';
import type {
  PendingAssistantNavigationTarget,
  PendingAuthorNavigationTarget,
  PendingGraphNavigationTarget,
  PendingIdeaNavigationTarget,
  PendingLibraryNavigationTarget,
  SidebarNavItem,
  StudyMaterialNavigationTarget,
  View,
} from './navigation';
import { researchChatView, dedicatedVaultNavIds, groupedNav, navItemLabel, orderedNav, orderSidebarItems, pinnedToolkitSidebarItems, NAV_ITEMS, NAV_GROUPS } from './navigation';
import type { ResearchConversationNavigationTarget } from './researchNoteProvenance';
import type { ToolkitPage } from './navigation';
import { OPEN_LIBRARY_DOCUMENT_EVENT, type OpenLibraryDocumentDetail } from './evidenceJump';
import type { LibraryScope } from '@shared/libraryTypes';
import { placeHeaderBadge, type HeaderBadgePlacement } from './headerLayout';
import { registerSkillMarketplace } from './components/skillMarketplaceOpener';
import { effectiveSidebarHidden, isPreviewVaultType, isViewAllowedForVaultType, normalizeVaultType, viewsDisallowedForType } from '@shared/vaultTypes';
import { CommandPalette, type Command } from './components/CommandPalette';
import nodusLogo from './assets/nodus-logo.svg';
import nodusLogoGold from './assets/nodus-logo-gold.svg';
import nodusLogoCrimson from './assets/nodus-logo-crimson.svg';
import nodusLogoTeal from './assets/nodus-logo-teal.svg';
import nodusLogoOrange from './assets/nodus-logo-orange.svg';
import nodusLogoViolet from './assets/nodus-logo-violet.svg';
import nodusLogoCyan from './assets/nodus-logo-cyan.svg';
import { NodusHeaderLogo } from './components/NodusHeaderLogo';
import { buildDockIconDataUrl, dockColorForVaultType } from './dockIcon';
import { APP_THEME_DEFINITIONS_STORAGE_KEY, APP_THEME_STORAGE_KEY, applyAppTheme as applyRuntimeAppTheme, applyThemeMode, applyVaultAccent } from './theme/themeBoot';
import { APP_THEME_IDS } from '@shared/appThemes';
import { useBrowserNativeOverlayGuard } from './browserOverlay';

const CsvImportModal = lazy(() => import('./views/DatabasesView').then((module) => ({ default: module.CsvImportModal })));
const NotionImportReportModal = lazy(() => import('./views/DatabasesView').then((module) => ({ default: module.NotionImportReportModal })));
const CollectionsModal = lazy(() => import('./views/CollectionsModal').then((module) => ({ default: module.CollectionsModal })));
const SkillMarketplaceModal = lazy(() => import('./components/SkillMarketplaceModal').then((module) => ({ default: module.SkillMarketplaceModal })));

// Shortcut label for the command palette: ⌘K on macOS, Ctrl K elsewhere.
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
const PALETTE_HINT = IS_MAC ? '⌘K' : 'Ctrl K';
const SIDEBAR_MIN_WIDTH = 64;
const SIDEBAR_DEFAULT_WIDTH = 176;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_COMPACT_THRESHOLD = 144;
// Below this width the full wordmark would enter macOS's hiddenInset traffic-light
// area. The icon itself remains visible and centred over the compact sidebar; only
// the decorative word is hidden.
const MACOS_FULL_SIDEBAR_BRAND_MIN_WIDTH = 248;

/** Persist + apply the active colour theme (palette). Light/dark is separate — see
 *  {@link applyThemeMode}. */
function applyAppTheme(appTheme: import('@shared/types').AppTheme, customThemes: import('@shared/types').CustomAppTheme[] = []): void {
  applyRuntimeAppTheme(appTheme, customThemes);
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, appTheme);
    localStorage.setItem(APP_THEME_DEFINITIONS_STORAGE_KEY, JSON.stringify(customThemes));
  } catch { /* private mode */ }
}

/** Header action rendered as an icon with a native title tooltip. The top bar stays
 *  a stable row of actions; pass `showLabel` to keep the text pinned open (e.g. an
 *  action in progress, or an alert that must be noticed). */
function HeaderAction({
  icon,
  label,
  onClick,
  title,
  tone = '',
  spinning = false,
  showLabel = false,
  disabled = false,
  dataTour,
  kbd,
  vaultTrigger = false,
  inboxTrigger = false,
  notificationsTrigger = false,
  queueTrigger = false,
  focusKeep = false,
  pressed,
  visible = true,
  actionId,
  responsive = false,
}: {
  icon: string;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  tone?: string;
  spinning?: boolean;
  showLabel?: boolean;
  disabled?: boolean;
  dataTour?: string;
  kbd?: string;
  vaultTrigger?: boolean;
  /** Lets the Inbox panel's outside-click handler ignore its own trigger, so it toggles. */
  inboxTrigger?: boolean;
  /** Same, for the notifications panel. */
  notificationsTrigger?: boolean;
  /** Same, for the queue panel. */
  queueTrigger?: boolean;
  /** Still shown in the Study focus mode, which clears the rest of the rail. */
  focusKeep?: boolean;
  /** For a toggle: whether it is on. */
  pressed?: boolean;
  visible?: boolean;
  actionId?: HeaderActionId;
  responsive?: boolean;
}) {
  const titleText = kbd ? `${title ?? label} · ${kbd}` : title ?? label;
  return (
    <button
      data-tour={dataTour}
      data-header-action={actionId}
      hidden={!visible}
      data-vault-trigger={vaultTrigger ? '' : undefined}
      data-inbox-trigger={inboxTrigger ? '' : undefined}
      data-notifications-trigger={notificationsTrigger ? '' : undefined}
      data-queue-trigger={queueTrigger ? '' : undefined}
      data-focus-keep={focusKeep ? '' : undefined}
      aria-pressed={pressed}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={titleText}
      aria-label={label}
      className={`header-action btn justify-center px-2.5 py-0 leading-none btn-ghost h-9 min-h-9 min-w-9 ${responsive ? 'header-responsive-action' : ''} ${tone}`}
    >
      <Icon name={icon} className={spinning ? 'animate-spin' : ''} />
      {showLabel && (
        <span className="flex items-center overflow-hidden whitespace-nowrap transition-all duration-200 ml-1.5 max-w-[14rem] opacity-100">
          {label}
          {kbd && <kbd className="composer-kbd ml-1.5">{kbd}</kbd>}
        </span>
      )}
    </button>
  );
}

export function App() {
  const focusReduced = useStudyFocusReduced();
  const focusActions = useStudyFocusActions();
  const focusLayout = useStudyFocusLayout();
  // In focus mode the header keeps only what the student chose; elsewhere nothing changes.
  const focusKeeps = (id: string) => focusLayoutVisible(focusLayout.layout, id);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [interfacePickerOpen, setInterfacePickerOpen] = useState(false);
  const [headerMoreOpen, setHeaderMoreOpen] = useState(false);
  const [headerVisibilityBusy, setHeaderVisibilityBusy] = useState(false);
  const [headerVisibilityError, setHeaderVisibilityError] = useState('');
  const headerMoreRef = useRef<HTMLDivElement>(null);
  const [headerLeftEl, setHeaderLeftEl] = useState<HTMLDivElement | null>(null);
  const [interfaceTrigger, setInterfaceTrigger] = useState<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!headerMoreOpen) return;
    const dismiss = (e: PointerEvent) => { if (!headerMoreRef.current?.contains(e.target as Node) && !(e.target as Element).closest('.academic-header-more-panel, [role="dialog"], dialog')) setHeaderMoreOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setHeaderMoreOpen(false); headerMoreRef.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [headerMoreOpen]);
  const [vaults, setVaults] = useState<VaultSummary[]>([]);
  const [activeVault, setActiveVault] = useState<VaultSummary | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null);
  const [backupWarningDismissed, setBackupWarningDismissed] = useState(false);
  const [whatsNewSettled, setWhatsNewSettled] = useState(() => !hasPendingWhatsNew());
  const [manualWhatsNewOpen, setManualWhatsNewOpen] = useState(false);
  const [aiModelRequiredOpen, setAiModelRequiredOpen] = useState(false);
  // Startup progress is non-blocking; later checks stay silent until ready to install.
  const [updateProgress, setUpdateProgress, showStartupProgress] = useUpdateProgress({ checkOnStartup: true });
  const [deferredUpdate, setDeferredUpdate] = useState<string | null>(null);
  const readyVersion = pendingUpdateVersion(updateProgress);
  const updateNoticeKey = readyVersion ? `${readyVersion}${updateProgress?.errorCode ?? ''}` : null;
  // Whether this RUN began before the essential guide had ever been completed — i.e.
  // whether the person at the keyboard is meeting Nodus for the first time. Captured
  // from the first settings read and never recomputed, because both flags the
  // first-vault chooser depends on flip while the app is running: reading them live
  // would shut the chooser the instant the guide set `basicsTutorialVersion`.
  const newInstallRef = useRef<boolean | null>(null);
  const [newInstall, setNewInstall] = useState(false);
  useEffect(() => setActiveVaultQueryScope(activeVault?.id ?? null), [activeVault?.id]);
  // Where each section was when it was last left. It lives above the single render
  // point because that is what survives the unmount, and outside React state
  // because it is read only when a section mounts: as state, every keystroke in a
  // search box would re-render the whole shell. The active vault is bound in once,
  // here, so no section can read another vault's cut.
  const snapshots = useMemo(() => viewSnapshotAccess(activeVault?.id ?? null), [activeVault?.id]);
  // Resolved light/dark (accounts for 'system'); drives the macOS dock icon.
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const [view, setViewRaw] = useState<View>('home');
  const viewRef = useRef<View>('home');
  useEffect(() => { viewRef.current = view; }, [view]);
  const setView = useCallback((next: View) => {
    // Escritura and Proyectos were consolidated into one workspace. Keep their
    // historical ids as input aliases only so old deep links and notifications do
    // not resurrect removed sections in the shell.
    const requestedNext = next === 'home' && normalizeVaultType(activeVault?.type) === 'academic' && settings?.academicInterfaceProfile === 'simple' ? 'researchChat' : next;
    const canonicalNext: View = requestedNext === 'writing' || requestedNext === 'projects'
      ? (normalizeVaultType(activeVault?.type) === 'academic' ? 'workspace' : 'notes')
      : requestedNext;
    const cur = viewRef.current;
    // Leaving Browser: hide the native WebContentsView BEFORE mounting the next
    // section. The previous `invoke` left one frame where Settings header was
    // painted but the atlas page (native or internal) still covered its content
    // (see screenshot). Awaiting the hide ensures no overlap; the extra ~5ms
    // keeps Browser visible a fraction longer instead of flashing atlas over
    // Settings. Entering Browser is handled by NodusBrowserView's mount effect.
    if (cur === 'browser' && canonicalNext !== 'browser') {
      void window.nodus.setBrowserSectionVisible(false).then(() => setViewRaw(canonicalNext)).catch(() => setViewRaw(canonicalNext));
      return;
    }
    setViewRaw(canonicalNext);
  }, [activeVault?.type, settings?.academicInterfaceProfile]);
  useBrowserNativeOverlayGuard(view === 'browser');
  useEffect(() => window.nodus.onAiModelRequired(() => setAiModelRequiredOpen(true)), []);
  // Página activa dentro de Herramientas. Vive aquí (y no en ToolkitView) porque
  // el sidebar navega directamente a una herramienta, y porque así salir de la
  // sección y volver no pierde el sitio aunque la vista se desmonte.
  const [toolkitPage, setToolkitPage] = useState<ToolkitPage>('home');
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('nodus.navCollapsed') === '1');
  const editorialFocus = useEditorialShellFocus();
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const savedWidth = localStorage.getItem('nodus.sidebarWidth');
    const stored = savedWidth === null ? NaN : Number(savedWidth);
    return Number.isFinite(stored)
      ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, stored))
      : SIDEBAR_DEFAULT_WIDTH;
  });
  const sidebarCompact = sidebarWidth <= SIDEBAR_COMPACT_THRESHOLD;
  // Per-group collapse state for the sidebar (Explorar · Analizar · Escribir),
  // persisted so a user's folded groups survive restarts.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('nodus.collapsedGroups') || '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  // Skills: the catalogue and the installed library, for the whole application rather
  // than for one chat. The per-chat popover opens this one through the registry below,
  // so there is a single modal however you got here.
  const [skillsTab, setSkillsTab] = useState<'library' | 'marketplace' | null>(null);
  // The main window is the one that has the Skills modal, so it is the one that says
  // so. Registering an opener rather than listening for an event is what lets the
  // popover in the standalone Nodi overlay — a different renderer, where nothing
  // registers — hide the entry instead of offering a dead button.
  useEffect(() => registerSkillMarketplace(() => setSkillsTab('library')), []);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // Planned teaching section whose feedback thread is open, if any.
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  // The trigger element that opened the vault panel (the centre badge or the
  // right-rail vaults icon), or null when closed. The panel anchors under it.
  const [vaultAnchor, setVaultAnchor] = useState<HTMLElement | null>(null);
  // What has arrived from other devices. Loaded once and then PUSHED: unlike the Settings
  // overview, which polls every three seconds, there is nothing here worth asking about
  // when nothing has happened — the poller tells the window when something has.
  const [inboxAnchor, setInboxAnchor] = useState<HTMLElement | null>(null);
  const [inbox, setInbox] = useState<ServerInboxEntry[]>([]);
  // The notification centre. Same two lists Nodi shows, reachable without Nodi.
  const [notificationsAnchor, setNotificationsAnchor] = useState<HTMLElement | null>(null);
  // Queue and task progress, relocated from the bottom strip into its own dropdown.
  const [queueAnchor, setQueueAnchor] = useState<HTMLElement | null>(null);
  const queueActivity = useQueueActivity();
  const queueLive = queueActivity.live;
  const [notifications, setNotifications] = useState<NodiNotification[]>([]);
  const [refreshingNotifications, setRefreshingNotifications] = useState(false);
  const {
    announcements,
    unread: unreadAnnouncements,
    markRead: markAnnouncementRead,
    refresh: refreshNotificationSources,
  } = useAnnouncements();
  // Live placement of the centred vault badge. Both rails around it change width
  // (the logo tracks the sidebar; the action rail grows when a button pins or
  // reveals its label), so the badge is measured rather than pinned at 50% — see
  // headerLayout.ts.
  //
  // These are callback refs held in state, not useRef: the header renders only past
  // the loading/tutorial/onboarding returns below, and the measurement has to start
  // the moment those four boxes attach. A plain ref cannot say when that happened,
  // so the effect would have to guess from unrelated deps — and a wrong guess leaves
  // the badge unmeasured and invisible until some later state change happens to
  // re-run it. Storing the nodes makes attachment itself the trigger.
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
  const [headerLogoEl, setHeaderLogoEl] = useState<HTMLElement | null>(null);
  const [headerActionsEl, setHeaderActionsEl] = useState<HTMLElement | null>(null);
  const [vaultBadgeEl, setVaultBadgeEl] = useState<HTMLElement | null>(null);
  const [vaultBadgePlacement, setVaultBadgePlacement] = useState<HeaderBadgePlacement | null>(null);
  const toggleVaults = useCallback((el: HTMLElement) => {
    if(activeVault?.learningWorkspace)return;
    setInterfacePickerOpen(false); setHeaderMoreOpen(false);
    setVaultAnchor(cur => cur === el ? null : el);
  }, [activeVault?.learningWorkspace]);
  const toggleInbox = useCallback(
    (el: HTMLElement) => setInboxAnchor((cur) => (cur === el ? null : el)),
    []
  );
  const toggleQueue = useCallback(
    (el: HTMLElement) => setQueueAnchor((cur) => (cur === el ? null : el)),
    []
  );
  // Opening the panel clears the ACTIVITY feed only — "I have seen these" is all that
  // list ever means. An announcement stays unread until it is read one at a time.
  const toggleNotifications = useCallback((el: HTMLElement) => {
    setNotificationsAnchor((cur) => {
      if (cur === el) return null;
      if (notifications.some((notification) => !notification.read)) {
        void window.nodus.markNotificationsRead().then(setNotifications).catch(() => {});
      }
      return el;
    });
  }, [notifications]);
  const refreshNotificationCenter = useCallback(async (): Promise<AnnouncementRefreshResult> => {
    if (refreshingNotifications) return { status: 'not-modified', checkedAt: Date.now() };
    setRefreshingNotifications(true);
    try {
      const snapshot = await refreshNotificationSources();
      setNotifications(snapshot.notifications);
      return snapshot.refresh;
    } catch {
      // The notification centre deliberately keeps the last good lists when the public
      // announcements file is unreachable. The panel renders this status inline.
      return { status: 'error', checkedAt: Date.now() };
    } finally {
      setRefreshingNotifications(false);
    }
  }, [refreshNotificationSources, refreshingNotifications]);
  const captureNotificationsBrowserSnapshot = useCallback(
    () => window.nodus.captureBrowserOverlaySnapshot(),
    [],
  );
  const setNotificationsBrowserOverlayVisible = useCallback(
    (visible: boolean) => window.nodus.setBrowserOverlayVisible(visible),
    [],
  );
  const [graphTarget, setGraphTarget] = useState<PendingGraphNavigationTarget & { nonce: number } | null>(null);
  const [ideaTarget, setIdeaTarget] = useState<PendingIdeaNavigationTarget & { nonce: number } | null>(null);
  const [authorTarget, setAuthorTarget] = useState<PendingAuthorNavigationTarget & { nonce: number } | null>(null);
  const [libraryTarget, setLibraryTarget] = useState<PendingLibraryNavigationTarget & { nonce: number } | null>(null);
  const [assistantTarget, setAssistantTarget] = useState<PendingAssistantNavigationTarget & { nonce: number } | null>(null);
  const [researchConversationTarget, setResearchConversationTarget] = useState<ResearchConversationNavigationTarget | null>(null);
  // A note the user opened from global search; the nonce re-triggers even if the
  // same note is chosen twice.
  const [noteTarget, setNoteTarget] = useState<{ id: string; nonce: number } | null>(null);
  // A person opened from global search, to preselect in the Personas view.
  const [personsTarget, setPersonsTarget] = useState<{ id: string; nonce: number } | null>(null);
  const [studyTarget, setStudyTarget] = useState<StudyNavigationTarget | null>(null);
  const [studyMaterialTarget, setStudyMaterialTarget] = useState<StudyMaterialNavigationTarget | null>(null);
  const [studyRecordingTarget, setStudyRecordingTarget] = useState<{ id: string; timestamp?: number | null } | null>(null);
  const [studyGraphTarget, setStudyGraphTarget] = useState<PendingGraphNavigationTarget & { nonce: number } | null>(null);
  const [studyChatTarget, setStudyChatTarget] = useState<{ prompt: string; nonce: number } | null>(null);
  const [completeGuideTarget, setCompleteGuideTarget] = useState<{ sourceKeys: string[]; nonce: number } | null>(null);
  const [radarTarget, setRadarTarget] = useState<{ updateId?: string; nonce: number } | null>(null);
  const [primarySourceTarget, setPrimarySourceTarget] = useState<{
    itemId: string;
    excerptId?: string | null;
    textVersionId?: string | null;
    startOffset?: number | null;
    endOffset?: number | null;
    nonce: number;
  } | null>(null);
  const openPrimarySourceTarget = useCallback((target: {
    itemId: string;
    excerptId?: string | null;
    textVersionId?: string | null;
    startOffset?: number | null;
    endOffset?: number | null;
  }) => {
    setPrimarySourceTarget({ ...target, nonce: Date.now() });
    setView('archive');
  }, []);
  useEffect(() => {
    const openPrimarySource = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail as
        | { itemId?: unknown; excerptId?: unknown }
        | null;
      if (typeof detail?.itemId !== 'string' || typeof detail.excerptId !== 'string') return;
      setPrimarySourceTarget({
        itemId: detail.itemId,
        excerptId: detail.excerptId,
        nonce: Date.now(),
      });
      setView('archive');
    };
    window.addEventListener('nodus:navigate-primary-source', openPrimarySource);
    return () => window.removeEventListener('nodus:navigate-primary-source', openPrimarySource);
  }, []);
  // A citation whose exact page has to be shown in the in-app reader (no Zotero
  // PDF attachment, or a study/global library copy). The page travels with the
  // target so the reader opens at the cited point instead of at page 1.
  useEffect(() => {
    const openLibraryDocument = (event: Event) => {
      const detail = (event as CustomEvent<OpenLibraryDocumentDetail | null>).detail;
      if (typeof detail?.itemId !== 'string') return;
      if (detail.scope !== 'global' && detail.scope !== 'vault') return;
      setLibraryTarget({
        scope: detail.scope,
        readerItemId: detail.itemId,
        readerPage: typeof detail.page === 'number' && detail.page > 0 ? detail.page : null,
        readerAttachmentId: typeof detail.attachmentId === 'string' ? detail.attachmentId : null,
        nonce: Date.now(),
      });
      setView('library');
    };
    window.addEventListener(OPEN_LIBRARY_DOCUMENT_EVENT, openLibraryDocument);
    return () => window.removeEventListener(OPEN_LIBRARY_DOCUMENT_EVENT, openLibraryDocument);
  }, []);
  useEffect(() => { if (view !== 'studyGraph') setStudyGraphTarget(null); }, [view]);
  useEffect(() => { if (view !== 'researchChat') setAssistantTarget(null); }, [view]);
  useEffect(() => { if (view !== 'studyChat') setStudyChatTarget(null); }, [view]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncLogEntry | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null while unknown; true when the DB holds any real or demo content.
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const beginSidebarResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.focus();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    document.body.classList.add('is-resizing-sidebar');
    const move = (pointerEvent: PointerEvent) => setSidebarWidth(Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, startWidth + pointerEvent.clientX - startX)));
    const finish = (pointerEvent: PointerEvent) => {
      const width = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, startWidth + pointerEvent.clientX - startX));
      setSidebarWidth(width);
      localStorage.setItem('nodus.sidebarWidth', String(width));
      document.body.classList.remove('is-resizing-sidebar');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const resizeSidebarWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const requestedWidth = event.key === 'Home'
      ? SIDEBAR_MIN_WIDTH
      : event.key === 'End'
        ? SIDEBAR_MAX_WIDTH
        : event.key === 'ArrowLeft'
          ? sidebarWidth - 8
          : event.key === 'ArrowRight'
            ? sidebarWidth + 8
            : null;
    if (requestedWidth === null) return;
    event.preventDefault();
    const width = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, requestedWidth));
    setSidebarWidth(width);
    localStorage.setItem('nodus.sidebarWidth', String(width));
  };

  const unreadInbox = useMemo(() => unreadServerInboxGroupCount(inbox), [inbox]);
  // One count for one button: an unread announcement and an unread activity line both
  // mean "there is something here you have not seen".
  const unreadNotifications = useMemo(
    () => unreadAnnouncements + notifications.reduce((n, x) => n + (x.read ? 0 : 1), 0),
    [unreadAnnouncements, notifications]
  );

  // Load the inbox once and then let the main process push it. The poller broadcasts after
  // any batch that produced entries, and the mutators return the fresh list themselves, so
  // nothing here has to ask on a timer.
  useEffect(() => {
    void window.nodus.listServerInbox().then(setInbox).catch(() => undefined);
    return window.nodus.onServerInboxChanged(setInbox);
  }, [activeVault?.id]);

  // Same pattern for the activity feed, which the main process pushes whenever a job
  // finishes. Nodi subscribes to the very same channel, so both stay in step.
  useEffect(() => {
    void window.nodus.listNotifications().then(setNotifications).catch(() => undefined);
    return window.nodus.onNotificationsChanged(setNotifications);
  }, []);

  // Sidebar sections grouped for rendering (Explorar · Analizar · Escribir),
  // each group in the user's chosen order, minus any hidden sections. Home is
  // pinned first and Settings last, both outside every group and never hidden.
  const activeSidebarHidden = useMemo(
    () => effectiveSidebarHidden(
      settings?.sidebarHidden ?? [],
      settings?.sidebarCustomized ?? false,
      activeVault?.type
    ),
    [settings?.sidebarHidden, settings?.sidebarCustomized, activeVault?.type],
  );

  const navGroups = useMemo(() => {
    // Views scoped to other vault types are removed outright (not user-toggleable here).
    const disallowed = viewsDisallowedForType(
      NAV_ITEMS.map((n) => n.id),
      activeVault?.type
    );
    const dedicatedIds = dedicatedVaultNavIds(activeVault?.type);
    const outsideDedicatedWorkspace = dedicatedIds
      ? NAV_ITEMS.filter((item) => item.id !== 'home' && item.id !== 'settings' && !dedicatedIds.includes(item.id)).map((item) => item.id)
      : [];
    return groupedNav(
      settings?.academicInterfaceProfile === 'advanced' && normalizeVaultType(activeVault?.type) === 'academic' ? [] : settings?.sidebarOrder ?? [],
      ['library', ...(settings?.academicInterfaceProfile === 'advanced' && normalizeVaultType(activeVault?.type) === 'academic' ? ['notes'] : activeSidebarHidden), ...disallowed, ...outsideDedicatedWorkspace],
      settings?.toolkitPinnedPages ?? [],
    );
  }, [settings?.sidebarOrder, settings?.academicInterfaceProfile, settings?.toolkitPinnedPages, activeSidebarHidden, activeVault?.type]);

  // If the active vault type doesn't allow the current view (e.g. switching from a
  // primary-source vault to an academic one while on Personas), fall back to Home.
  useEffect(() => {
    if (activeVault && !isViewAllowedForVaultType(view, activeVault.type)) setView('home');
  }, [activeVault?.type, view]);

  // Publish a bounded snapshot of the visible main view for Nodi's opt-in
  // "Vista actual" context. Document readers instead expose a hidden,
  // explicit source containing the complete report/immersion instead. It remains
  // in memory only and is never added to chat history unless the user sends with
  // that context enabled. Quoting enables Nodi first, which mounts this publisher
  // and captures the document synchronously before the user can send the question.
  useEffect(() => {
    if (!settings?.mascotEnabled) return;
    // The website is a separate native WebContentsView, not a descendant of
    // this <main>. NodusBrowserView publishes its real document text instead;
    // publishing `main.innerText` here would overwrite it with browser chrome.
    if (view === 'browser') return;
    let timer: number | null = null;
    let idleId: number | null = null;
    let observer: MutationObserver | null = null;
    let lastText = '';
    const publish = () => {
      timer = null;
      idleId = null;
      const main = document.querySelector<HTMLElement>('main[data-nodi-view]');
      if (!main) return;
      const explicit = main.querySelector<HTMLElement>('[data-nodi-context-source="document"]');
      const complete = Boolean(explicit);
      const text = complete ? (explicit?.textContent || '') : (main.innerText || '').slice(0, 12_000);
      const explicitTitle = explicit?.dataset.nodiContextTitle?.trim();
      if (text === lastText) return;
      lastText = text;
      const item = NAV_ITEMS.find((candidate) => candidate.id === view);
      void window.nodus.setNodiViewContext({
        viewId: view,
        title: explicitTitle || (item ? t(item.label) : view),
        text,
        capturedAt: Date.now(),
        ...(complete ? { complete: true } : {}),
      });
    };
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      if (idleId !== null && window.cancelIdleCallback) window.cancelIdleCallback(idleId);
      timer = window.setTimeout(() => {
        timer = null;
        if (window.requestIdleCallback) idleId = window.requestIdleCallback(publish, { timeout: 1_000 });
        else publish();
      }, 500);
    };
    const attach = () => {
      const main = document.querySelector<HTMLElement>('main[data-nodi-view]');
      if (!main) { schedule(); return; }
      observer = new MutationObserver(schedule);
      observer.observe(main, { subtree: true, childList: true, characterData: true });
      schedule();
    };
    const attachTimer = window.setTimeout(attach, 0);
    return () => {
      window.clearTimeout(attachTimer);
      if (timer !== null) window.clearTimeout(timer);
      if (idleId !== null && window.cancelIdleCallback) window.cancelIdleCallback(idleId);
      observer?.disconnect();
    };
  }, [settings?.mascotEnabled, view]);

  useEffect(() => window.nodus.onNodiNavigate((target) => {
    if (target === 'settings') {
      localStorage.setItem('nodus.settingsTarget', 'nodi');
      setView('settings');
    } else if (target.view === 'radar') {
      setRadarTarget({ ...(target.updateId ? { updateId: target.updateId } : {}), nonce: Date.now() });
      setView('radar');
    } else {
      setView(target.view);
    }
  }), []);

  // Floating UI shares the active vault's canonical accent with the app shell.
  useEffect(() => applyVaultAccent(activeVault?.type), [activeVault?.type]);
  // Genealogy vaults wear a golden accent + logo instead of the indigo default.
  const isGenealogy = activeVault?.type === 'genealogy';
  useEffect(() => {
    document.documentElement.classList.toggle('genealogy', isGenealogy);
  }, [isGenealogy]);
  const isPrimarySources = activeVault?.type === 'primary_sources';
  useEffect(() => {
    document.documentElement.classList.toggle('primary-sources', isPrimarySources);
  }, [isPrimarySources]);
  // Databases vaults wear the Nodus crimson (#B30333) accent.
  const isDatabases = activeVault?.type === 'databases';
  useEffect(() => {
    document.documentElement.classList.toggle('databases', isDatabases);
  }, [isDatabases]);
  // Study vaults use a calm teal accent and expose only their local learning tools.
  const isEstudio = activeVault?.type === 'estudio';
  const isPreviewVault = isPreviewVaultType(activeVault?.type);
  useEffect(() => {
    document.documentElement.classList.toggle('estudio', isEstudio);
  }, [isEstudio]);
  // Teaching vaults wear an orange accent and reuse the study organisation surfaces.
  const isDocencia = activeVault?.type === 'docencia';
  useEffect(() => {
    document.documentElement.classList.toggle('docencia', isDocencia);
  }, [isDocencia]);
  // Worldbuilding vaults wear a violet accent and render their own sidebar; the
  // character section is built on the shared person ontology.
  const isWorldbuilding = activeVault?.type === 'worldbuilding';
  useEffect(() => {
    document.documentElement.classList.toggle('worldbuilding', isWorldbuilding);
  }, [isWorldbuilding]);
  // Prosopography is an evidence-first blue workspace with a strict dedicated shell.
  const isProsopography = activeVault?.type === 'prosopography';
  // 'academic' es también el tipo al que resuelve cualquier bóveda anterior a los tipos,
  // así que se pregunta por lo que NO es en vez de por lo que es.
  const isAcademic = normalizeVaultType(activeVault?.type) === 'academic' && !isPreviewVault;
  const profile = isAcademic ? settings?.academicInterfaceProfile : undefined;
  const academicItems = useMemo(() => isAcademic && settings ? academicNavigation(settings) : null, [isAcademic, settings]);
  const academicGroups = useMemo(() => isAcademic && settings ? academicNavigationGroups(settings) : [], [isAcademic, settings]);
  const headerVisible = (id: HeaderActionId) => headerActionVisible(id, settings?.headerActionVisibility, profile);
  const toggleHeaderVisibility = async (id: HeaderActionId) => {
    setHeaderVisibilityBusy(true); setHeaderVisibilityError('');
    try {
      const latest = await window.nodus.getSettings();
      const updated = await window.nodus.updateSettings({ headerActionVisibility: { ...latest.headerActionVisibility, [id]: !headerActionVisible(id, latest.headerActionVisibility, profile) } });
      setSettings(updated);
    } catch (cause) { setHeaderVisibilityError(errorText(cause)); }
    finally { setHeaderVisibilityBusy(false); }
  };
  const openInterfaceSettings = () => { localStorage.setItem('nodus.settingsTarget', 'sidebar'); window.dispatchEvent(new Event('nodus:settings-target')); setView('settings'); };
  const openInterfacePreferences = (target: 'appearance' | 'nodi') => {
    setInterfacePickerOpen(false);
    localStorage.setItem('nodus.settingsTarget', target);
    window.dispatchEvent(new Event('nodus:settings-target')); setView('settings');
  };
  const chooseInterface = async (next: AcademicInterfaceProfile) => {
    if (!settings) return;
    const updated = await window.nodus.updateSettings(academicProfilePatch(settings, next));
    setSettings(updated); setInterfacePickerOpen(false);
    if (next === 'custom') { learning.pause(); openInterfaceSettings(); }
    else if (!academicNavigation(updated).some(item => item.id === view) && !['toolkit', 'workspace', 'browser', 'radar', 'compass', 'studyFocus'].includes(view)) setView(academicInitialView(next));
  };
  useEffect(() => { setInterfacePickerOpen(false); setHeaderMoreOpen(false); }, [activeVault?.id]);
  const profileEntryVault = useRef<string | null>(null);
  useEffect(() => {
    if (!settings?.onboardingComplete || !activeVault) return;
    if (profileEntryVault.current === activeVault.id) return;
    profileEntryVault.current = activeVault.id;
    if (isAcademic && settings.academicInterfaceProfile && viewRef.current === 'home') setView(academicInitialView(settings.academicInterfaceProfile));
  }, [activeVault?.id, settings?.onboardingComplete, isAcademic, setView, settings?.academicInterfaceProfile]);
  useEffect(() => {
    document.documentElement.classList.toggle('prosopography', isProsopography);
  }, [isProsopography]);
  // Testimonios: acento cian y sidebar propio de cinco entradas. Reutiliza la ontología
  // de personas para los participantes y Notas para los memos del investigador.
  const isTestimonios = activeVault?.type === 'testimonios';
  // Apertura profunda de una entrevista (desde Inicio, Buscar, Contrastes o un enlace
  // `nodus://testimonios/...`). El nonce fuerza la reapertura aunque sea la misma.
  const [testimonyTarget, setTestimonyTarget] = useState<{ interviewId: string; tab?: DossierTab; nonce: number } | null>(null);
  const openTestimonyInterview = useCallback((interviewId: string, tab?: DossierTab) => {
    setTestimonyTarget({ interviewId, tab, nonce: Date.now() });
    setView('testimonyInterviews');
  }, []);
  /**
   * Abrir un enlace `nodus://testimonios/...`.
   *
   * Un fragmento abre la pestaña de Análisis, que es donde se ve la cita con su código y
   * su tramo; una entrevista sin más abre el Resumen. Los enlaces de otra bóveda no
   * llevan a ninguna parte a propósito: el destino tiene que pertenecer a la bóveda
   * activa, y abrir «algo parecido» sería peor que no abrir nada.
   */
  const openTestimonyLink = useCallback((link: TestimonyDeepLink) => {
    if (link.target === 'interview') {
      setTestimonyTarget({
        interviewId: link.id,
        tab: link.annotationId ? 'analysis' : link.transcriptId || link.sessionId ? 'sessions' : 'overview',
        nonce: Date.now(),
      });
      setView('testimonyInterviews');
      return;
    }
    if (link.target === 'participant') {
      setView('testimonyParticipants');
      return;
    }
    setView('testimonyContrasts');
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('testimonios', isTestimonios);
  }, [isTestimonios]);

  // Accessibility preferences are applied at the document root so dialogs,
  // floating panels and every vault inherit them consistently.
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const scale = Math.max(0.85, Math.min(1.3, settings.interfaceScale || 1));
    root.style.setProperty('--interface-scale', String(scale));
    root.style.setProperty('--animation-speed', String(Math.max(0, Math.min(1, settings.animationSpeed))));
    root.classList.toggle('accessible-font', settings.accessibleFont);
    root.classList.toggle('high-contrast', settings.highContrast);
    root.classList.toggle('reduce-motion', settings.reduceMotion);
    root.classList.toggle('reading-focus', Boolean(isEstudio && settings.readingFocusMode));
  }, [settings, isEstudio]);

  // The user's databases (sidebar list) + the one currently open in the workspace.
  const [databases, setDatabases] = useState<DatabaseSummary[]>([]);
  const [activeDatabaseId, setActiveDatabaseId] = useState<string | null>(null);
  // A row to open in the record modal after navigating to its database (from search).
  const [pendingRecordId, setPendingRecordId] = useState<string | null>(null);
  const reloadDatabases = useCallback(async () => {
    if (!window.nodus) return [];
    const list = await window.nodus.listDatabases();
    setDatabases(list);
    return list;
  }, []);
  useEffect(() => {
    if (isDatabases) void reloadDatabases();
    else {
      setDatabases([]);
      setActiveDatabaseId(null);
    }
  }, [isDatabases, activeVault?.id, reloadDatabases]);
  // Keep a valid database selected: default to the first, and recover if the open
  // one was deleted.
  useEffect(() => {
    if (!isDatabases) return;
    if (databases.length === 0) {
      if (activeDatabaseId !== null) setActiveDatabaseId(null);
      return;
    }
    if (!activeDatabaseId || !databases.some((d) => d.id === activeDatabaseId)) {
      setActiveDatabaseId(databases[0].id);
    }
  }, [isDatabases, databases, activeDatabaseId]);
  const createDatabase = useCallback(async () => {
    if (!window.nodus) return;
    const created = await window.nodus.createDatabase(t('Base de datos nueva'), null);
    // Seed a starter title column so the table is usable immediately.
    await window.nodus.createDatabaseColumn(created.id, t('Nombre'), 'title');
    await reloadDatabases();
    setActiveDatabaseId(created.id);
    setView('databases');
  }, [reloadDatabases]);
  const [csvPlan, setCsvPlan] = useState<CsvImportPlanData | null>(null);
  const [notionImportReport, setNotionImportReport] = useState<NotionImportReport | null>(null);
  const importCsv = useCallback(async () => {
    if (!window.nodus) return;
    const plan = await window.nodus.parseCsvForImport();
    if (plan) setCsvPlan(plan);
  }, []);
  const importNotion = useCallback(async () => {
    if (!window.nodus) return;
    const report = await window.nodus.importNotionZip();
    if (!report) return;
    setNotionImportReport(report);
    await reloadDatabases();
    if (report.createdDatabaseIds[0]) setActiveDatabaseId(report.createdDatabaseIds[0]);
  }, [reloadDatabases]);

  const homeItem = NAV_ITEMS.find((n) => n.id === 'home')!;
  const libraryItem = NAV_ITEMS.find((n) => n.id === 'library')!;
  const settingsItem = NAV_ITEMS.find((n) => n.id === 'settings')!;
  const pagesItem = NAV_ITEMS.find((n) => n.id === 'pages')!;
  const dbSearchItem = NAV_ITEMS.find((n) => n.id === 'dbSearch')!;
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Focus mode offers the active vault's sections in their saved order.
  const openStudySection = useCallback((target: View) => {
    setStudyTarget(null);
    if (target !== 'studyLibrary') setStudyMaterialTarget(null);
    if (target !== 'studyRecordings') setStudyRecordingTarget(null);
    setStudyGraphTarget(null);
    setView(target);
  }, [setView]);
  // Focus keeps a separate choice of visible sections for each vault.
  const focusSections = useMemo<Array<FocusSectionOption & { item?: SidebarNavItem; databaseId?: string; open?: () => void }>>(() => {
    const dedicated = dedicatedVaultNavIds(activeVault?.type);
    const items: SidebarNavItem[] = [...orderedNav(settings?.sidebarOrder ?? []), ...pinnedToolkitSidebarItems(settings?.toolkitPinnedPages)];
    const sections: Array<FocusSectionOption & { item?: SidebarNavItem; databaseId?: string; open?: () => void }> = orderSidebarItems(items, settings?.sidebarOrder ?? [])
      .filter(n => 'toolkitPage' in n || n.id === 'library' || ((!dedicated || dedicated.includes(n.id)) && isViewAllowedForVaultType(n.id, activeVault?.type)))
      .map(n => ({ key: n.id, label: 'toolkitPage' in n ? t(n.label) : t(navItemLabel(n, activeVault?.type)), icon: n.icon, item: n,
        defaultVisible: focusDefaultSectionVisible(activeVault?.type, n.id) }));
    if (isDatabases) {
      sections.push({ key: 'database:new', label: t('Nueva base de datos'), icon: 'plus', defaultVisible: true, open: () => void createDatabase() });
      sections.push(...databases.map(database => ({ key: `database:${database.id}`, label: database.name, icon: 'table', databaseId: database.id, defaultVisible: true })));
    }
    return sections;
  }, [isDatabases, databases, activeVault?.type, settings?.sidebarOrder, settings?.toolkitPinnedPages, settings?.uiLanguage, createDatabase]);
  const focusRailItems = useMemo<FocusRailItem[]>(() => {
    if (!focusReduced) return [];
    return focusSections
      .filter(section => focusLayoutVisible(focusLayout.layout, `nav:${section.key}`, section.defaultVisible))
      .map(({ key, label, icon, item, databaseId, open }): FocusRailItem => ({
        key, label, icon,
        active: databaseId ? view === 'databases' && activeDatabaseId === databaseId : item && ('toolkitPage' in item ? view === 'toolkit' && toolkitPage === item.toolkitPage : view === item.id && (item.id !== 'toolkit' || toolkitPage === 'home')) || false,
        open: () => {
          if (open) { open(); return; }
          if (databaseId) { setActiveDatabaseId(databaseId); setView('databases'); return; }
          if (!item) return;
          if ('toolkitPage' in item) { setToolkitPage(item.toolkitPage); setView('toolkit'); return; }
          if (item.id === 'toolkit') setToolkitPage('home');
          openStudySection(item.id);
        },
      }));
  }, [focusReduced, focusSections, focusLayout, view, toolkitPage, openStudySection, activeDatabaseId, setView]);
  // Leaving the mode lands on the Concentración page, where the paused block is.
  useEffect(() => {
    const show = () => openStudySection('studyFocus');
    window.addEventListener(SHOW_FOCUS_PAGE_EVENT, show);
    return () => window.removeEventListener(SHOW_FOCUS_PAGE_EVENT, show);
  }, [openStudySection]);
  const openFocusSubject = useCallback((id: string) => { setStudyTarget({ kind: 'subject', id }); setView('studyCourses'); }, [setView]);
  const openFocusDocument = useCallback((id: string) => { setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }, [setView]);
  const openFocusMaterial = useCallback((id: string) => { setStudyMaterialTarget({ id, pageNumber: null, slideNumber: null }); setView('studyLibrary'); }, [setView]);
  const openFocusLibrary = useCallback(() => openStudySection('studyLibrary'), [openStudySection]);

  const reloadSettings = useCallback(async () => {
    if (!window.nodus) {
      setLoadError(t('El puente de Nodus (preload) no está disponible. La app no puede comunicarse con su backend.'));
      return undefined;
    }
    try {
      const s = await window.nodus.getSettings();
      setSettings(s);
      setActiveLang(s.uiLanguage);
      document.documentElement.lang = s.uiLanguage;
      setIsDark(applyThemeMode(s.theme));
      applyAppTheme(s.appTheme, s.customThemes);
      return s;
    } catch (e) {
      setLoadError(tx('No se pudieron cargar los ajustes: {msg}', { msg: (e as Error).message }));
      return undefined;
    }
  }, []);

  const toggleTheme = useCallback(async () => {
    const nextTheme = isDark ? 'light' : 'dark';
    setIsDark(applyThemeMode(nextTheme));
    try {
      await window.nodus.updateSettings({ theme: nextTheme });
      await reloadSettings();
    } catch (error) {
      setIsDark(applyThemeMode(isDark ? 'dark' : 'light'));
      throw error;
    }
  }, [isDark, reloadSettings]);

  useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);

  // Decide once, from the first settings this run sees, whether this is a first meeting.
  // The same pass stamps `firstVaultVersion` on any install that already completed the
  // guide: without it, an existing user who replays the guide from Settings and then
  // restarts would look brand new and have their vault renamed under them.
  useEffect(() => {
    if (!settings || newInstallRef.current !== null) return;
    const fresh = settings.basicsTutorialVersion === 0 && settings.firstVaultVersion === 0 || Boolean(settings.academicLearningProgress && !settings.academicLearningProgress.welcomeComplete && !settings.onboardingComplete);
    newInstallRef.current = fresh;
    setNewInstall(fresh);
    if (!fresh && settings.firstVaultVersion === 0) {
      void window.nodus.updateSettings({ firstVaultVersion: FIRST_VAULT_VERSION });
    }
  }, [settings]);

  useEffect(() => window.nodus?.onApiKeysRecovered(() => { void reloadSettings(); }), [reloadSettings]);
  // Settings may also change outside this React tree (notably from the floating
  // Nodi window). Keep visibility, theme and every settings-backed control in sync.
  useEffect(() => window.nodus?.onSettingsChanged(() => { void reloadSettings(); }), [reloadSettings]);
  useEffect(() => window.nodus?.onActiveEmbeddingIndexChanged(() => { void reloadSettings(); }), [reloadSettings]);
  // A vault switch changes which settings apply, and the palette is per vault by
  // default. The switcher reloads them itself, but it is not the only caller — the
  // Server inbox and vault creation both switch directly — so re-read here as well
  // and never depend on who initiated it.
  useEffect(() => window.nodus?.onVaultChanged(() => { void reloadSettings(); }), [reloadSettings]);

  // In "system" theme mode, follow the OS light/dark preference as it changes.
  useEffect(() => {
    if (settings?.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setIsDark(applyThemeMode('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings?.theme]);

  // Repaint the macOS dock icon whenever the theme or the active vault changes:
  // white/near-black plate for light/dark, "N" tinted with the vault accent.
  // No-op on non-mac (main guards app.dock too).
  useEffect(() => {
    if (!IS_MAC || !window.nodus?.setDockIcon) return;
    let cancelled = false;
    void buildDockIconDataUrl(dockColorForVaultType(activeVault?.type), isDark).then((url) => {
      if (!cancelled && url) void window.nodus.setDockIcon(url);
    });
    return () => {
      cancelled = true;
    };
  }, [activeVault?.type, isDark]);

  const reloadVaults = useCallback(async () => {
    if (!window.nodus) return [];
    const next = await window.nodus.listVaults();
    setVaults(next);
    setActiveVault(await window.nodus.getActiveVault());
    return next;
  }, []);

  useEffect(() => {
    void reloadVaults();
    return window.nodus?.onVaultChanged(() => { void reloadVaults(); });
  }, [reloadVaults]);

  const reloadRecoveryStatus = useCallback(async () => {
    if (!window.nodus) return null;
    const next = await window.nodus.getRecoveryStatus();
    setRecoveryStatus(next);
    return next;
  }, []);

  useEffect(() => {
    if (!settings || settings.basicsTutorialVersion === 0) return;
    void reloadRecoveryStatus();
  }, [reloadRecoveryStatus, settings?.basicsTutorialVersion, settings?.recoverySetupVersion, vaults.length]);

  const refreshHasData = useCallback(async () => {
    if (!window.nodus) return;
    try {
      setHasData(await window.nodus.hasAnyData());
    } catch {
      /* leave previous value */
    }
  }, []);

  useEffect(() => {
    void refreshHasData();
  }, [refreshHasData]);
  useDataRefresh(refreshHasData);

  const loadDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      await window.nodus.seedDemoData();
      await reloadSettings();
      await refreshHasData();
      notifyDataChanged();
      setView('home');
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, refreshHasData]);

  const loadGenealogyDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      await window.nodus.seedGenealogyDemoData();
      await reloadSettings();
      await reloadVaults();
      await refreshHasData();
      notifyDataChanged();
      setView('tree');
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, reloadVaults, refreshHasData]);

  const loadDatabasesDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      await window.nodus.seedDatabasesDemoData();
      await reloadSettings();
      await reloadVaults();
      await reloadDatabases();
      await refreshHasData();
      notifyDataChanged();
      setView('home');
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, reloadVaults, reloadDatabases, refreshHasData]);

  const loadStudyDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      const seeded = await window.nodus.seedStudyDemoData();
      if (seeded) {
        await reloadSettings();
        await refreshHasData();
        notifyDataChanged();
        setView('home');
      }
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, refreshHasData]);

  const loadTeachingDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      const seeded = await window.nodus.seedTeachingDemoData();
      if (seeded) {
        await reloadSettings();
        await refreshHasData();
        notifyDataChanged();
        setView('home');
      }
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, refreshHasData]);

  const loadPrimarySourcesDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      const seeded = await window.nodus.seedPrimarySourcesDemoData();
      if (seeded) {
        await reloadSettings();
        await refreshHasData();
        notifyDataChanged();
        setView('home');
      }
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, refreshHasData]);

  const loadTestimonyDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      const seeded = await window.nodus.seedTestimonyDemoData();
      if (seeded) {
        await reloadSettings();
        await refreshHasData();
        notifyDataChanged();
        setView('home');
      }
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, refreshHasData]);

  const loadWorldbuildingDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      const seeded = await window.nodus.seedWorldbuildingDemoData();
      if (seeded) {
        await reloadSettings();
        await refreshHasData();
        notifyDataChanged();
        setView('home');
      }
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, refreshHasData]);

  // Cancel the onboarding wizard. If it is running for a freshly-created (non-main)
  // vault, discard that vault and fall back to another one; for the first-run main
  // vault there is nothing to discard, so just skip the wizard.
  const onboardingDiscardsVault = Boolean(activeVault && !activeVault.legacy && vaults.length > 1);
  const cancelOnboarding = useCallback(async () => {
    const other = vaults.find((v) => v.id !== activeVault?.id);
    if (activeVault && !activeVault.legacy && other) {
      const discardedVaultId = activeVault.id;
      const switched = await window.nodus.switchVault(other.id);
      if (!switched.ok) throw new Error(switched.message);
      await window.nodus.deleteVault(discardedVaultId, true);
      await reloadVaults();
    } else {
      await window.nodus.updateSettings({ onboardingComplete: true });
    }
    await reloadSettings();
    setView('home');
  }, [vaults, activeVault, reloadVaults, reloadSettings]);

  const exitDemo = useCallback(async () => {
    setDemoBusy(true);
    try {
      await window.nodus.clearDemoData();
      await reloadSettings();
      await reloadVaults();
      await refreshHasData();
      notifyDataChanged();
      setView('home');
    } finally {
      setDemoBusy(false);
    }
  }, [reloadSettings, reloadVaults, refreshHasData]);

  const toggleNav = () => {
    setNavCollapsed((v) => {
      localStorage.setItem('nodus.navCollapsed', v ? '0' : '1');
      return !v;
    });
  };

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('nodus.collapsedGroups', JSON.stringify([...next]));
      return next;
    });
  };

  // Keep the vault badge centred without letting either rail reach it. Both rails
  // resize for reasons React never re-renders for — the action rail animates open
  // on hover, the logo follows a pointer-driven sidebar drag — so the measurement
  // is driven by a ResizeObserver over the boxes themselves rather than by the
  // render cycle. The badge is absolutely positioned, so moving it cannot resize
  // the rails back: no feedback loop.
  useLayoutEffect(() => {
    if (!headerEl || !headerLogoEl || !headerActionsEl) {
      setVaultBadgePlacement(null);
      return undefined;
    }
    const measure = () => {
      const badge = vaultBadgeEl
        ? placeHeaderBadge({
            headerWidth: headerEl.clientWidth,
            logoWidth: headerLeftEl?.offsetWidth ?? headerLogoEl.offsetWidth,
            actionsWidth: headerActionsEl.offsetWidth,
            badgeWidth: vaultBadgeEl.offsetWidth,
          })
        : null;
      setVaultBadgePlacement((previous) => {
        if (!badge) return null;
        // Bail out when nothing moved: the observer fires on every frame of the
        // rail's open/close animation and each state write would re-render the app.
        if (previous && previous.fits === badge.fits && Math.abs(previous.left - badge.left) < 0.5) return previous;
        return badge;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const box of [headerEl, headerLogoEl, headerLeftEl, headerActionsEl, vaultBadgeEl]) if (box) observer.observe(box);
    return () => observer.disconnect();
  }, [headerEl, headerLogoEl, headerLeftEl, headerActionsEl, vaultBadgeEl]);

  // Global command palette: ⌘K / Ctrl+K toggles it from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onSync = async () => {
    setSyncing(true);
    try {
      const result = await window.nodus.syncNow({ catalogOnly: true });
      setLastSync(result);
      notifyDataChanged();
    } finally {
      setSyncing(false);
    }
  };

  const navigate = useCallback((nextView: View, graph?: PendingGraphNavigationTarget) => {
    if (graph) setGraphTarget({ ...graph, nonce: Date.now() });
    setView(nextView);
  }, []);

  const openLibraryBucket = useCallback((healthBucket: CorpusHealthBucketId) => {
    setLibraryTarget({ scope: 'vault', healthBucket, nonce: Date.now() });
    setView('library');
  }, []);

  const openLibraryItem = useCallback((itemId: string, scope: LibraryScope, page?: number | null) => {
    setLibraryTarget({ scope, readerItemId: itemId, readerPage: page ?? null, nonce: Date.now() });
    setView('library');
  }, []);

  const openIdea = useCallback((ideaId: string) => {
    setIdeaTarget({ ideaId, nonce: Date.now() });
    setView('ideas');
  }, []);

  const openAuthor = useCallback((authorId: string, name: string) => {
    setAuthorTarget({ authorId, name, nonce: Date.now() });
    setView('authors');
  }, []);

  useEffect(() => {
    if (!window.nodus?.onCopilotOpenIdea) return undefined;
    return window.nodus.onCopilotOpenIdea((target) => {
      if (target.destination === 'library-citation-styles') {
        setLibraryTarget({ scope: 'global', citationStyles: true, nonce: Date.now() });
        setView('library');
        return;
      }
      if (target.destination === 'ideas') {
        setIdeaTarget({ ideaId: target.ideaId, nonce: Date.now() });
        setView('ideas');
        return;
      }
      navigate('graph', {
        preset: 'overview',
        nodeId: target.ideaId,
        label: target.label ? `${t('Idea:')} ${target.label}` : t('Idea de Nodus'),
      });
    });
  }, [navigate]);

  useEffect(() => {
    if (!window.nodus?.onZoteroPluginOpen) return undefined;
    return window.nodus.onZoteroPluginOpen((target) => {
      if (target.kind !== 'library-reader' || !target.id) return;
      setLibraryTarget({ scope: 'global', readerItemId: target.id, nonce: Date.now() });
      setView('library');
    });
  }, []);

  // Trusted Browser chrome uses the same Library navigation target as the
  // external Connector. The event originates in Nodus' renderer; arbitrary web
  // pages live in another WebContents and cannot dispatch into this document.
  useEffect(() => {
    const openBrowserCapture = (event: Event) => {
      const itemId = (event as CustomEvent<{ itemId?: unknown }>).detail?.itemId;
      if (typeof itemId !== 'string' || !itemId || itemId.length > 200) return;
      setLibraryTarget({ scope: 'global', readerItemId: itemId, nonce: Date.now() });
      setView('library');
    };
    window.addEventListener('nodus:open-library-item', openBrowserCapture);
    return () => window.removeEventListener('nodus:open-library-item', openBrowserCapture);
  }, []);

  // Research Chat opens a cited web page as a NEW tab of Nodus' Browser. The event
  // comes from this renderer (web pages live in other WebContents and cannot reach
  // it); the URL is checked again here and by the Browser's own navigation policy.
  useEffect(() => {
    const openWebSource = (event: Event) => {
      const url = (event as CustomEvent<{ url?: unknown }>).detail?.url;
      if (typeof url !== 'string' || url.length > 4000 || !/^https?:\/\//i.test(url)) return;
      void window.nodus.openBrowserTab(url).then(tabId => {
        if (tabId) setView('browser');
        else void window.nodus.openExternal(url);
      }).catch(() => void window.nodus.openExternal(url));
    };
    window.addEventListener('nodus:open-browser-url', openWebSource);
    return () => window.removeEventListener('nodus:open-browser-url', openWebSource);
  }, [setView]);

  // Una nota se abre con la misma experiencia de catálogo y pestañas, bajo el nombre
  // Espacio de trabajo en la académica y Notas en las demás bóvedas.
  const openNoteFromSearch = useCallback((id: string) => {
    setNoteTarget({ id, nonce: Date.now() });
    setView(isAcademic ? 'workspace' : 'notes');
  }, [isAcademic]);
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<unknown>).detail;
      if (typeof id === 'string') openNoteFromSearch(id);
    };
    window.addEventListener('nodus:open-research-note', open);
    return () => window.removeEventListener('nodus:open-research-note', open);
  }, [openNoteFromSearch]);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ href?: unknown; label?: unknown }>).detail;
      if (typeof detail?.href !== 'string') return;
      const reference = parseEditorReference(detail.href);
      if (!reference) return;
      const { kind, id } = reference;
      if (kind === 'idea') openIdea(id);
      else if (kind === 'passage') {void window.nodus.getPassage(id).then(passage=>{if(passage)void import('./evidenceJump').then(({openEvidenceAtPage})=>openEvidenceAtPage(passage.nodus_id,{location:passage.page_label,sourceRef:passage.source_ref,pageNumber:passage.page_number}));});}
      else if (kind === 'work') navigate('graph', { workId: id });
      else if (kind === 'author') openAuthor(id, typeof detail.label === 'string' ? detail.label : '');
      else if (kind === 'note') openNoteFromSearch(id);
      else if (kind === 'studyDocument') { setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }
      else if (kind === 'studyMaterial') { setStudyMaterialTarget({ id }); setView('studyLibrary'); }
    };
    window.addEventListener('nodus:open-editor-reference', open);
    return () => window.removeEventListener('nodus:open-editor-reference', open);
  }, [navigate, openIdea, openAuthor, openNoteFromSearch, setView]);

  const openResearchConversation = useCallback((target: Omit<ResearchConversationNavigationTarget, 'nonce'>) => {
    setResearchConversationTarget({ ...target, nonce: Date.now() });
    setView(target.surface === 'database'
      ? 'dbChat'
      : target.surface === 'study'
        ? 'studyChat'
        : target.surface === 'world'
          ? 'worldChat'
          : 'researchChat');
  }, []);

  const openAssistant = useCallback(
    (target?: PendingAssistantNavigationTarget) => {
      if (!((isEstudio || isDocencia ? settings?.studyModel : null) ?? settings?.chatModel ?? settings?.synthesisModel)) {
        setAiModelRequiredOpen(true);
        return;
      }
      setAssistantTarget(target ? { ...target, nonce: Date.now() } : null);
      if ((isEstudio || isDocencia) && target?.prompt) setStudyChatTarget({ prompt: target.prompt, nonce: Date.now() });
      setView(researchChatView(activeVault?.type));
    },
    [activeVault?.type, isEstudio, isDocencia, settings?.studyModel, settings?.chatModel, settings?.synthesisModel]
  );

  const handleActiveVaultChanged = useCallback(async () => {
    setCollectionsOpen(false);
    setGraphTarget(null);
    setIdeaTarget(null);
    setAuthorTarget(null);
    setStudyGraphTarget(null);
    setStudyChatTarget(null);
    setAssistantTarget(null);
    setResearchConversationTarget(null);
    setNoteTarget(null);
    setLastSync(null);
    setView('home');
    await reloadVaults();
    await reloadSettings();
    await refreshHasData();
    notifyDataChanged();
  }, [refreshHasData, reloadSettings, reloadVaults]);

  // Command palette entries: every navigation destination (grouped like the
  // sidebar) plus the header's global actions. Rebuilt when the language changes
  // so labels stay translated.
  const paletteCommands = useMemo<Command[]>(() => {
    const groupLabel = new Map(NAV_GROUPS.map((g) => [g.id, t(g.label)] as const));
    const dedicatedIds = dedicatedVaultNavIds(activeVault?.type);
    const bySection = [
      ...NAV_ITEMS.filter((n) => !n.group),
      ...NAV_GROUPS.flatMap((g) => NAV_ITEMS.filter((n) => n.group === g.id)),
    ].filter((n) =>
      isViewAllowedForVaultType(n.id, activeVault?.type)
      && (!dedicatedIds || n.id === 'home' || n.id === 'settings' || dedicatedIds.includes(n.id))
    );
    const navCommands: Command[] = bySection.map((n) => ({
      id: `nav:${n.id}`,
      label: t(navItemLabel(n, activeVault?.type)),
      section: n.group ? groupLabel.get(n.group)! : t('General'),
      icon: n.icon,
      run: () => setView(n.id),
    }));
    const actions: Command[] = [
      ...(isAcademic ? [
        { id: 'act:interface', label: t('Cambiar interfaz'), section: t('Acciones'), icon: 'layers', run: () => setInterfacePickerOpen(true) },
      ] : []),
      // The last resort for the vault panel: the badge that opens it is placed by
      // measurement and can, in a window narrow enough, have nowhere to go.
      { id: 'act:vaults', label: t('Bóvedas'), section: t('Acciones'), icon: 'archive', keywords: 'vaults bovedas boveda cambiar crear renombrar duplicar eliminar', run: () => { const badge = document.querySelector<HTMLElement>('[data-testid="header-vault-badge"]'); if (badge) toggleVaults(badge); } },
      { id: 'act:assistant', label: 'Research chat', section: t('Acciones'), icon: 'chat', keywords: 'assistant chat', run: () => openAssistant() },
      { id: 'act:skills', label: t('Mis skills'), section: t('Acciones'), icon: 'sparkles', keywords: 'skills habilidades biblioteca instalar activar', run: () => setSkillsTab('library') },
      { id: 'act:marketplace', label: 'Marketplace', section: t('Acciones'), icon: 'basket', keywords: 'marketplace tienda skills plugins instalar descargar catalogo catálogo', run: () => setSkillsTab('marketplace') },
      { id: 'act:presenter', label: 'Nodus Presenter', section: t('Acciones'), icon: 'presentation', keywords: 'presentar diapositivas slides pdf presenter proyector herramientas toolkit', run: () => { setToolkitPage('presenter'); setView('toolkit'); } },
      { id: 'act:feedback', label: t('Sugerir función o reportar error'), section: t('Acciones'), icon: 'gitPr', keywords: 'feedback github pr bug feature sugerencia error', run: () => setFeedbackOpen(true) },
      { id: 'act:roadmap', label: t('Roadmap'), section: t('Acciones'), icon: 'route', keywords: 'roadmap hoja ruta futuro próximos pasos', run: () => setRoadmapOpen(true) },
      { id: 'act:theme', label: isDark ? t('Usar tema claro') : t('Usar tema oscuro'), section: t('Acciones'), icon: 'palette', keywords: 'tema theme claro oscuro', run: () => void toggleTheme() },
      { id: 'act:motion', label: settings?.reduceMotion ? t('Activar animaciones') : t('Reducir animaciones'), section: t('Acciones'), icon: 'settings', keywords: 'accesibilidad movimiento animaciones motion', run: () => void window.nodus.updateSettings({ reduceMotion: !settings?.reduceMotion }).then(reloadSettings) },
      { id: 'act:apptheme', label: t('Cambiar paleta de tema'), section: t('Acciones'), icon: 'palette', keywords: 'tema theme paleta palette color colores', run: () => {
        const ids = [...APP_THEME_IDS, ...(settings?.customThemes ?? []).map((theme) => theme.id)];
        const next = ids[(Math.max(0, ids.indexOf(settings?.appTheme ?? 'default')) + 1) % ids.length];
        void window.nodus.updateSettings({ appTheme: next }).then(reloadSettings);
      } },
    ];
    if (focusActions) {
      actions.unshift(
        { id: 'act:focus-mode', label: focusReduced ? t('Salir del modo concentración') : t('Entrar en modo concentración'), section: t('Acciones'), icon: 'focus', keywords: 'concentración concentracion focus pomodoro distracciones estudio', run: () => { if (focusReduced) void focusActions.exitFocusMode(); else focusActions.setReduced(true); } },
        { id: 'act:focus-layout', label: t('Personalizar el modo concentración'), section: t('Acciones'), icon: 'eye', keywords: 'concentración concentracion focus personalizar visibles ocultar secciones', run: openFocusLayout },
        { id: 'act:focus-timer', label: t('Temporizador de concentración'), section: t('Acciones'), icon: 'focus', keywords: 'pomodoro temporizador timer bloque descanso concentración', run: openFocusTimer },
      );
    }
    if (isEstudio) {
      actions.unshift({ id: 'act:reading-focus', label: settings?.readingFocusMode ? t('Salir del modo lectura') : t('Entrar en modo lectura'), section: t('Acciones'), icon: 'book', keywords: 'lectura enfoque focus estudio', run: () => void window.nodus.updateSettings({ readingFocusMode: !settings?.readingFocusMode }).then(reloadSettings) });
    }
    if (!isPrimarySources && !isGenealogy && !isDatabases && !isEstudio && !isDocencia && !isWorldbuilding && !isProsopography && !isTestimonios) {
      actions.unshift(
        { id: 'act:sync', label: t('Actualizar (sincronizar Zotero)'), section: t('Acciones'), icon: 'sync', keywords: 'sync sincronizar', run: () => void onSync() },
        { id: 'act:collections', label: t('Colecciones de Zotero'), section: t('Acciones'), icon: 'folder', keywords: 'collections zotero', run: () => setCollectionsOpen(true) },
      );
    }
    return [...navCommands, ...actions];
  }, [settings?.uiLanguage, settings?.reduceMotion, settings?.readingFocusMode, focusReduced, focusActions, activeVault?.type, isAcademic, isPrimarySources, isGenealogy, isDatabases, isEstudio, isDocencia, isWorldbuilding, isProsopography, isTestimonios, isDark, onSync, openAssistant, reloadSettings, toggleVaults]);

  // The startup sequence, as an ordered list of guards rather than a run of early
  // returns. It also sets this render's authoritative language, which is why it is
  // called before anything below reads `settings`.
  const learningOverlayBusy = useLearningOverlayBusy(settings?.academicPracticeSession && !settings.academicPracticeSession.paused ? settings.academicPracticeSession.lessonId : undefined);
  const learningSuspended = !settings?.onboardingComplete || !recoveryStatus || (!activeVault?.learningWorkspace && Boolean(recoveryStatus.needsSetup) && (!settings?.academicLearningProgress?.invitationsEligible || Boolean(settings.academicLearningProgress.realSetupStarted))) || paletteOpen || collectionsOpen || feedbackOpen || manualWhatsNewOpen;
  const learningBlocked = learningOverlayBusy || learningSuspended || interfacePickerOpen;
  const learning = useAcademicLearningController({ settings, vault: activeVault, enabled: isAcademic, blocked: learningBlocked, progress: queueActivity.preparation, queue: queueActivity.queue, workWaiting:view==='deepResearch'&&queueActivity.research.some(job=>job.vaultId===activeVault?.id&&['queued','running'].includes(job.status))||view==='dictionary'&&queueActivity.dictionary.some(job=>!['done','degraded','failed'].includes(job.phase)),extractionVersion: JSON.stringify(queueActivity.extraction.map(job=>[job.id,job.status])), view, onSettings: setSettings, navigate: setView });
  useEffect(() => {
    const open = () => { setVaultAnchor(null); setInterfacePickerOpen(true); };
    window.addEventListener('nodus:interface-tab', open);
    return () => window.removeEventListener('nodus:interface-tab', open);
  }, []);
  useEffect(() => {
    if (!isAcademic || !settings?.academicLearningProgress?.invitationsEligible) return;
    setWhatsNewSettled(true);
  }, [isAcademic, settings?.academicLearningProgress?.invitationsEligible]);

  const startupGate = resolveStartupGate({
    loadError,
    settings,
    activeVault,
    recoveryStatus,
    isPreviewVault,
    newInstall,
    whatsNewSettled,
    onboardingDiscardsVault,
    clearLoadError: () => setLoadError(null),
    reloadSettings,
    reloadVaults,
    reloadRecoveryStatus,
    cancelOnboarding,
    setView,
  });
  if (startupGate) return startupGate;
  if (!settings) return null; // unreachable: the settings guard above owns this case

  // Everything the sections need from the shell, assembled once. Built after the
  // startup gate so `settings` is known to be there, which is what lets a renderer
  // read `ctx.settings` without a null check of its own.
  const viewContext: ViewContext = {
    settings,
    activeVault,
    vaults,
    recoveryStatus,
    isAcademic,
    isGenealogy,
    isPrimarySources,
    isDatabases,
    isEstudio,
    isDocencia,
    isWorldbuilding,
    isTestimonios,
    isProsopography,
    isPreviewVault,
    snapshots,
    hasData,
    demoBusy,
    lastSync,
    syncing,
    databases,
    activeDatabaseId,
    pendingRecordId,
    toolkitPage,
    graphTarget,
    ideaTarget,
    authorTarget,
    libraryTarget,
    noteTarget,
    personsTarget,
    testimonyTarget,
    primarySourceTarget,
    studyTarget,
    studyMaterialTarget,
    studyRecordingTarget,
    studyGraphTarget,
    studyChatTarget,
    completeGuideTarget,
    assistantTarget,
    researchConversationTarget,
    radarTarget,
    setView,
    navigate,
    setToolkitPage,
    reloadSettings,
    reloadVaults,
    reloadDatabases,
    openAssistant,
    openLibraryBucket,
    openLibraryItem,
    openIdea,
    openAuthor,
    openNoteFromSearch,
    openResearchConversation,
    openPrimarySourceTarget,
    openTestimonyInterview,
    openTestimonyLink,
    onSync,
    setNoteTarget,
    setLibraryTarget,
    setPersonsTarget,
    setPrimarySourceTarget,
    setStudyTarget,
    setStudyMaterialTarget,
    setStudyRecordingTarget,
    setStudyGraphTarget,
    setStudyChatTarget,
    setCompleteGuideTarget,
    setActiveDatabaseId,
    setPendingRecordId,
    setCollectionsOpen,
    setManualWhatsNewOpen,
    setRoadmapOpen,
    createDatabase,
    importCsv,
    importNotion,
    loadDemo,
    loadGenealogyDemo,
    loadDatabasesDemo,
    loadPrimarySourcesDemo,
    loadStudyDemo,
    loadTeachingDemo,
    loadWorldbuildingDemo,
    loadTestimonyDemo,
  };

  return (
    <AcademicInterfaceContext.Provider value={isAcademic ? profile ?? null : null}><AcademicLearningContext.Provider value={learning.context}>
    <div
      className="h-full flex flex-col"
      style={{ '--vault-accent': dockColorForVaultType(activeVault?.type) } as React.CSSProperties}
      data-testid="app-shell"
      data-editorial-focus={editorialFocus.active ? 'true' : undefined}
      data-vault-type={activeVault?.type}
      data-academic-profile={isAcademic ? profile ?? 'legacy' : undefined}
      data-focus-reduced={focusReduced}
      data-interface-scale={settings.interfaceScale}
      data-high-contrast={settings.highContrast ? 'true' : 'false'}
      data-reduce-motion={settings.reduceMotion ? 'true' : 'false'}
      data-reading-focus={isEstudio && settings.readingFocusMode ? 'true' : 'false'}
    >
      {/* Top bar. `app-titlebar` makes the empty header area a drag region so the
          window can be moved (its interactive children are auto-marked no-drag in
          index.css). On macOS the traffic lights sit at the very top-left. */}
      <header
        ref={setHeaderEl}
        className="app-titlebar relative flex h-11 items-center border-b border-neutral-800"
        data-platform={IS_MAC ? 'macos' : 'other'}
        data-selector-open={interfacePickerOpen || Boolean(vaultAnchor) ? 'true' : undefined}
        onPointerDownCapture={event => {
          const target = event.target as Element;
          // Portalled selector contents are React children of the header too.
          if (!event.currentTarget.contains(target)) return;
          if (!target.closest('[data-testid="academic-interface-trigger"]')) setInterfacePickerOpen(false);
          if (!target.closest('[data-vault-trigger]')) setVaultAnchor(null);
        }}
      >
        <div ref={setHeaderLeftEl} className="flex shrink-0 items-center" data-testid="header-left-rail">
        <button
          ref={setHeaderLogoEl}
          data-testid="sidebar-header-toggle"
          className="relative flex h-full shrink-0 items-center justify-center px-2 font-semibold text-lg tracking-tight transition-colors hover:bg-neutral-900/70 focus-visible:bg-neutral-900/70"
          style={{ width: sidebarWidth }}
          onClick={toggleNav}
          title={navCollapsed ? t('Mostrar el menú lateral') : t('Ocultar el menú lateral (más espacio para el grafo)')}
          aria-label={navCollapsed ? t('Mostrar el menú lateral') : t('Ocultar el menú lateral (más espacio para el grafo)')}
        >
          <span data-testid="sidebar-header-brand" className="flex items-center justify-center gap-2" style={{ transform: sidebarCompact && IS_MAC ? 'translateY(0.5625rem)' : undefined }}>
            <NodusHeaderLogo
              data-testid="nodus-logo"
              data-vault-logo={isPrimarySources ? 'primary_sources' : isGenealogy ? 'genealogy' : isDatabases ? 'databases' : isEstudio ? 'estudio' : isDocencia ? 'docencia' : isWorldbuilding ? 'worldbuilding' : isTestimonios ? 'testimonios' : isProsopography ? 'prosopography' : 'academic'}
              src={isGenealogy ? nodusLogoGold : isDatabases ? nodusLogoCrimson : isEstudio ? nodusLogoTeal : isDocencia ? nodusLogoOrange : isWorldbuilding ? nodusLogoViolet : isTestimonios ? nodusLogoCyan : nodusLogo}
              className={sidebarCompact && IS_MAC
                ? 'h-[18px] w-[18px]'
                : sidebarCompact || (IS_MAC && sidebarWidth < MACOS_FULL_SIDEBAR_BRAND_MIN_WIDTH)
                  ? 'h-6 w-6'
                  : 'h-7 w-7'}
            />
            <span className={sidebarCompact || (IS_MAC && sidebarWidth < MACOS_FULL_SIDEBAR_BRAND_MIN_WIDTH) ? 'sr-only' : undefined}>Nodus Research</span>
          </span>
          {!sidebarCompact && (
            <Icon
              name={navCollapsed ? 'chevronRight' : 'chevronLeft'}
              size={14}
              className="absolute right-2 text-neutral-600"
            />
          )}
        </button>

        {isAcademic && <button ref={setInterfaceTrigger} className="academic-interface-trigger" data-testid="academic-interface-trigger" aria-haspopup="dialog" aria-expanded={interfacePickerOpen} aria-label={`${t('Cambiar interfaz')}: ${t(academicProfileLabel(profile))}`} title={`${t('Cambiar interfaz')}: ${t(academicProfileLabel(profile))}`} onClick={() => { setVaultAnchor(null); setHeaderMoreOpen(false); setInterfacePickerOpen(current => !current); }}>
          <Icon name="monitor" size={14} /><span className="academic-interface-name"><span className="academic-interface-prefix">{t('Interfaz')} · </span>{t(academicProfileLabel(profile))}</span><Icon name="chevronDown" size={12} className={`transition-transform ${interfacePickerOpen ? 'rotate-180' : ''}`} />
        </button>}
        {isAcademic && <FocusHeader onProgress={() => setView('studyFocus')} />}
        </div>

        {/* Vault mode, centred, in the vault's accent colour (gold in genealogy /
            crimson in databases via the accent-utility remaps). Clicking it opens
            the vault panel right under the badge (see VaultSwitcher).
            Its `left` is measured, not pinned at 50%: the rails on either side
            change width and must never reach it (see headerLayout.ts). Until the
            first measurement lands it stays invisible rather than flashing at a
            position it is about to leave. */}
        {activeVault && (
          <button
            ref={setVaultBadgeEl}
            data-vault-trigger
            data-tour="vault-badge"
            data-testid="header-vault-badge"
            data-badge-fits={vaultBadgePlacement ? String(vaultBadgePlacement.fits) : undefined}
            aria-expanded={Boolean(vaultAnchor)}
            style={{
              left: vaultBadgePlacement ? `${vaultBadgePlacement.left}px` : '50%',
              visibility: vaultBadgePlacement?.fits ? 'visible' : 'hidden',
            }}
            className="header-vault-badge absolute top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 rounded-full border border-indigo-700/60 bg-indigo-950/30 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-200 transition-colors hover:border-indigo-500 hover:bg-indigo-900/40"
            title={activeVault.learningWorkspace?learningText('workspace',settings.uiLanguage):t('Bóveda activa')}
            onClick={(e) => {if(!activeVault.learningWorkspace)toggleVaults(e.currentTarget);}}
          >
            <Icon name={vaultTypeIcon(activeVault.type)} size={13} />
            {/* The badge is now the only permanent way into the vault panel, so it is
                shown at every width — the LABEL is what gives way on a narrow window,
                not the button. Dropping the word leaves an icon-and-chevron chip that
                fits in a band where the full badge would not. */}
            <span className="hidden xl:inline">{activeVault.learningWorkspace?learningText('workspace',settings.uiLanguage):vaultTypeLabel(activeVault.type)}</span>
            {!activeVault.learningWorkspace&&<Icon name="chevronDown" size={12} className={`transition-transform ${vaultAnchor ? 'rotate-180' : ''}`} />}
          </button>
        )}

        {/* The focus counter takes the left half of the header (between the logo and the
            centred badge), centred in it; the right rail only ever has the focus icon. */}
        {!isAcademic && <FocusHeader onProgress={() => setView('studyFocus')} />}
        <div className="flex-1" />
        {/* Right-side action rail: icon-only by default, with native title labels so
            the header stays a stable row of icons. */}
        <div ref={setHeaderActionsEl} data-testid="header-actions" className="header-action-rail flex min-w-0 items-center justify-end gap-0.5 overflow-hidden pr-4">
          {/* No Bóvedas button: the centred badge is the way in, and it is now shown at
              every width for exactly that reason (see the badge above). */}
          <HeaderAction
            actionId="commands" visible={headerVisible('commands')}
            icon="search"
            label={t('Comandos')}
            title={t('Paleta de comandos')}
            kbd={PALETTE_HINT}
            tone="text-neutral-400"
            onClick={() => setPaletteOpen(true)}
            focusKeep={focusKeeps('header:commands')}
          />
          <HeaderAction actionId="researchChat" visible={headerVisible('researchChat')} responsive
            icon="chat"
            label="Research chat"
            title={((isEstudio || isDocencia ? settings.studyModel : null) ?? settings.chatModel ?? settings.synthesisModel) ? 'Research chat' : t('Configura un modelo de IA')}
            onClick={() => openAssistant()}
          />
          <HeaderAction actionId="toolkit" visible={headerVisible('toolkit')} responsive
            dataTour="toolkit"
            icon="tools"
            label={t('Herramientas')}
            title={t('Abrir Nodus Toolkit')}
            onClick={() => { setToolkitPage('home'); setView('toolkit'); }}
          />
          {/* Skills had no way in that was not a chat: the catalogue lived inside the
              activation popover, so installing one meant opening a conversation first.
              It sits next to the Toolkit because it answers the same question — what
              this application can do — for capabilities rather than for tools. */}
          <HeaderAction actionId="skills" visible={headerVisible('skills')} responsive
            dataTour="skills"
            icon="basket"
            label={t('Skills')}
            title={t('Skills y Marketplace')}
            onClick={() => setSkillsTab('library')}
          />
          {/* Colecciones ya no vive aquí: sigue a un comando de distancia («Colecciones»
              en la paleta) y su sitio natural es la configuración de Zotero. */}
          {/* Inside the measured actions box on purpose: the ResizeObserver above feeds
              placeHeaderBadge, which keeps this rail from ever reaching the centred vault
              badge. A badge positioned outside this box is exactly what that geometry
              cannot see. The wrapper is what the count hangs off — the action's
              optional shortcut sits inside its label span when that label is pinned.

              Only shown once something has actually arrived: the inbox is per vault and
              only means anything for a connected one, so on a local install it was a
              permanently empty icon sitting next to a bell that is never empty. */}
          {inbox.length > 0 && (
            <span className="relative inline-flex">
              <HeaderAction
                icon="inbox"
                label={t('Bandeja')}
                title={t('Lo que ha llegado de otros dispositivos')}
                inboxTrigger
                onClick={(e) => toggleInbox(e.currentTarget)}
              />
              {unreadInbox > 0 && (
                <span className="header-action-badge">{unreadInbox > 9 ? '9+' : unreadInbox}</span>
              )}
            </span>
          )}
          <BrowserMediaHeaderAction focusKeep={focusKeeps('header:media')} onOpenTab={(tabId) => {
            setView('browser');
            void window.nodus.activateBrowserTab(tabId);
          }} onOpenDrift={() => {
            // The real navigation state, like the Tools button: no router, no window.
            setToolkitPage('drift');
            setView('toolkit');
          }} />
          <HeaderAction actionId="feedback" visible={headerVisible('feedback')} responsive
            icon="gitPr"
            label={t('Sugerir / Reportar')}
            title={t('Enviar una propuesta o reporte a GitHub')}
            onClick={() => setFeedbackOpen(true)}
          />
          {/* Actualizar depende de Zotero igual que Colecciones dependía, así que la
              condición es ahora la misma: fuentes primarias no sincroniza con Zotero y
              antes mostraba este botón por una asimetría entre el comentario y el código. */}
          {!isPrimarySources && !isGenealogy && !isDatabases && !isEstudio && !isDocencia && !isWorldbuilding && !isProsopography && !isTestimonios && (
            <HeaderAction actionId="sync" visible={headerVisible('sync') || syncing} responsive={!syncing}
              dataTour="sync"
              icon="refresh"
              label={syncing ? t('Actualizando…') : t('Actualizar (sincronizar Zotero)')}
              spinning={syncing}
              showLabel={syncing}
              disabled={syncing}
              onClick={onSync}
            />
          )}
          <HeaderAction actionId="theme" visible={headerVisible('theme')}
            icon={isDark ? 'sun' : 'moon'}
            label={isDark ? t('Usar tema claro') : t('Usar tema oscuro')}
            title={isDark ? t('Cambiar a modo claro') : t('Cambiar a modo oscuro')}
            onClick={() => void toggleTheme()}
            dataTour="theme-toggle"
            focusKeep={focusKeeps('header:theme')}
          />
          {focusActions && (
            // The same panel as the timer chip: the mode toggle and its settings live inside.
            <span className="focus-quick" data-testid="focus-quick-access" data-focus-timer-trigger="" hidden={!headerVisible('focus')}>
              <HeaderAction actionId="focus" visible={headerVisible('focus')} responsive
                icon="focus"
                label={t('Modo concentración')}
                pressed={focusReduced}
                dataTour="focus-mode"
                onClick={toggleFocusTimer}
                focusKeep
              />
            </span>
          )}
          {/* Queue and task progress, moved here from the bottom strip: same dropdown
              treatment as the notification centre, with a live-work badge. */}
          <span className="relative inline-flex" hidden={!headerVisible('queue') && !queueLive && !queueActivity.attention}>
            <HeaderAction
              actionId="queue" visible={headerVisible('queue') || queueLive > 0 || queueActivity.attention}
              dataTour="queue"
              icon="clock"
              label={t('Cola y tareas')}
              title={queueActivity.attention ? `${t('Cola y tareas')} · ${t('Error')}` : t('Cola y tareas')}
              queueTrigger
              onClick={(e) => toggleQueue(e.currentTarget)}
              focusKeep={focusKeeps('header:queue')}
            />
            {(queueLive > 0 || queueActivity.attention) && (
              <span className={`header-action-badge ${queueActivity.attention ? '!bg-red-600 !text-white' : ''}`}>{queueActivity.attention && queueLive === 0 ? '!' : queueLive > 9 ? '9+' : queueLive}</span>
            )}
          </span>
          {/* The notification centre, reachable whether or not Nodi is enabled — turning
              the mascot off used to take the only way to read these with it. */}
          <span className="relative inline-flex" hidden={!headerVisible('notifications') && !unreadNotifications}>
            <HeaderAction
              actionId="notifications" visible={headerVisible('notifications') || unreadNotifications > 0}
              dataTour="notifications"
              icon="bell"
              label={t('Notificaciones')}
              title={t('Avisos de Nodus y actividad reciente')}
              notificationsTrigger
              onClick={(e) => toggleNotifications(e.currentTarget)}
            />
            {unreadNotifications > 0 && (
              <span className="header-action-badge">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>
            )}
          </span>
          <div ref={headerMoreRef} className="academic-header-more" data-modal-layer="">
            <HeaderAction icon="moreVertical" label={t('Más')} pressed={headerMoreOpen} focusKeep onClick={() => setHeaderMoreOpen(open => !open)} />
            {headerMoreOpen && createPortal(<div className="academic-header-more-panel" data-testid="header-more-panel" data-browser-native-overlay="true" aria-label={t('Más')} style={{ position: 'fixed', top: (headerMoreRef.current?.getBoundingClientRect().bottom ?? 44) + 6, right: Math.max(8, window.innerWidth - (headerMoreRef.current?.getBoundingClientRect().right ?? window.innerWidth)) }}>
              <p className="px-2 py-1 text-xs text-neutral-500">{t('Botones de la cabecera')}</p>
              {[
                { id: 'commands', label: t('Comandos'), icon: 'search', run: () => setPaletteOpen(true) },
                { id: 'researchChat', label: 'Research chat', icon: 'chat', run: () => openAssistant() },
                { id: 'toolkit', label: 'Nodus Tools', icon: 'tools', run: () => { setToolkitPage('home'); setView('toolkit'); } },
                { id: 'skills', label: t('Skills y Marketplace'), icon: 'basket', run: () => setSkillsTab('library') },
                { id: 'sync', label: t('Actualizar (sincronizar Zotero)'), icon: 'refresh', run: () => void onSync(), disabled: syncing, available: isAcademic },
                { id: 'feedback', label: t('Sugerir / Reportar'), icon: 'gitPr', run: () => setFeedbackOpen(true) },
                { id: 'theme', label: isDark ? t('Usar tema claro') : t('Usar tema oscuro'), icon: isDark ? 'sun' : 'moon', run: () => void toggleTheme() },
                { id: 'focus', label: t('Modo concentración'), icon: 'focus', run: toggleFocusTimer, available: Boolean(focusActions) },
                { id: 'queue', label: t('Cola y tareas'), icon: 'clock', run: () => { const anchor = headerMoreRef.current?.querySelector('button'); if (anchor) toggleQueue(anchor); } },
                { id: 'notifications', label: t('Notificaciones'), icon: 'bell', run: () => { const anchor = headerMoreRef.current?.querySelector('button'); if (anchor) toggleNotifications(anchor); } },
                { id: 'settings', label: t('Ajustes'), icon: 'settings', run: () => setView('settings') },
              ].filter(action => action.available !== false).map(action => <div key={action.id} className="header-more-row" data-header-menu-action={action.id}>
                <button className="header-more-run" disabled={action.disabled} onClick={() => { setHeaderMoreOpen(false); action.run(); }}><Icon name={action.icon} size={15} /><span>{action.label}</span></button>
                <button className="header-more-visibility" data-testid={`header-visibility-${action.id}`} disabled={headerVisibilityBusy} aria-pressed={headerVisible(action.id as HeaderActionId)}
                  aria-label={tx(headerVisible(action.id as HeaderActionId) ? 'Ocultar {action} de la cabecera' : 'Mostrar {action} en la cabecera', { action: action.label })}
                  title={headerVisible(action.id as HeaderActionId) ? t('Ocultar de la cabecera') : t('Mostrar en la cabecera')}
                  onClick={() => void toggleHeaderVisibility(action.id as HeaderActionId)}><Icon name={headerVisible(action.id as HeaderActionId) ? 'eye' : 'eyeOff'} size={15} /></button>
              </div>)}
              {headerVisibilityError && <p className="px-2 py-1 text-xs text-red-500" role="alert">{headerVisibilityError}</p>}
            </div>, document.querySelector('[data-testid="app-shell"]') ?? document.body)}
          </div>
          <HeaderAction
            actionId="settings" visible={headerVisible('settings')}
            icon="settings"
            label={t('Ajustes')}
            title={t('Ajustes de la bóveda actual')}
            onClick={() => setView('settings')}
          />
        </div>

        <VaultSwitcher
          anchorEl={vaultAnchor}
          onClose={() => setVaultAnchor(null)}
          vaults={vaults}
          onVaultsChanged={reloadVaults}
          onActiveVaultChanged={handleActiveVaultChanged}
        />

        <ServerInbox
          anchorEl={inboxAnchor}
          onClose={() => setInboxAnchor(null)}
          entries={inbox}
          onMarkRead={(id) => void window.nodus.markServerInboxRead(id).then(setInbox)}
          onClearOne={async (id) => { setInbox(await window.nodus.clearServerInbox(id)); }}
          onClearAll={() => void window.nodus.clearServerInbox().then(setInbox)}
          onOpenEntry={(entry) => {
            // Reading is per entry, so opening one is what marks that one — never the lot,
            // and never merely opening the panel.
            void window.nodus.markServerInboxRead(entry.id).then(setInbox);
            if (entry.entityKind === 'deep_research' && entry.outcome === 'applied') {
              setView('deepResearch');
              setInboxAnchor(null);
            }
          }}
        />

        <NotificationsPanel
          anchorEl={notificationsAnchor}
          onClose={() => setNotificationsAnchor(null)}
          notifications={notifications}
          announcements={announcements}
          needsAiModel={!settings.synthesisModel}
          onConfigureAiModel={() => {
            localStorage.setItem('nodus.settingsTarget', 'models');
            setNotificationsAnchor(null);
            setView('settings');
          }}
          language={settings.uiLanguage}
          onMarkAnnouncementRead={markAnnouncementRead}
          onRefresh={refreshNotificationCenter}
          refreshing={refreshingNotifications}
          onClearAll={() => void window.nodus.clearNotifications().then(setNotifications).catch(() => {})}
          captureBrowserOverlaySnapshot={captureNotificationsBrowserSnapshot}
          setBrowserOverlayVisible={setNotificationsBrowserOverlayVisible}
        />

        <QueuePanel
          activity={queueActivity}
          anchorEl={queueAnchor}
          onClose={() => setQueueAnchor(null)}
          captureBrowserOverlaySnapshot={captureNotificationsBrowserSnapshot}
          setBrowserOverlayVisible={setNotificationsBrowserOverlayVisible}
        />
      </header>

      {isEstudio && <FocusCompletionNotice />}
      {!(isAcademic && settings.academicLearningProgress?.invitationsEligible && !settings.academicLearningProgress.lessons['first-answer']?.practiceCompleted) && updateProgress && (updateInstallBusy(updateProgress) || showStartupProgress || (updateNoticeKey && deferredUpdate !== updateNoticeKey)) && <UpdateReadyNotice
        update={updateProgress}
        onUpdate={setUpdateProgress}
        onLater={() => setDeferredUpdate(updateNoticeKey)}
        onRecovery={() => { void window.nodus.updateSettings({ recoverySetupVersion: 0 }).then(setSettings); }}
      />}

      {settings.demoMode && (
        <div className="flex items-center gap-3 px-4 py-1.5 bg-amber-100 border-b border-amber-300 text-amber-800 text-xs dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-300">
          <Icon name="alert" size={14} />
          <span className="flex-1">
            {isPrimarySources
              ? t('Modo demostración: estás viendo un corpus ficticio de aprendizaje. Sal del modo demo para empezar con tus propias fuentes.')
              : t('Modo demostración: estás viendo un corpus de ejemplo. Sal del modo demo para empezar con tu propia biblioteca.')}
          </span>
          <button className="btn btn-ghost border border-amber-400/60 text-amber-800 py-0.5 dark:border-amber-500/40 dark:text-amber-200" onClick={() => void exitDemo()} disabled={demoBusy}>
            {demoBusy ? t('Saliendo…') : t('Salir del modo demo')}
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Sidebar (collapsible via the Nodus logo). Home is pinned first,
            Settings last; the rest render grouped (Explorar · Analizar · Escribir). */}
        {focusReduced && (
          <FocusRail
            items={focusRailItems}
            onOpenSubject={openFocusSubject}
            onOpenDocument={openFocusDocument}
            onOpenMaterial={openFocusMaterial}
            onOpenLibrary={openFocusLibrary}
          />
        )}
        {(editorialFocus.active ? editorialFocus.navigationOpen : !navCollapsed && !focusReduced) && (
          <nav
            data-testid="resizable-sidebar"
            data-sidebar-compact={sidebarCompact ? 'true' : 'false'}
            className="relative shrink-0 overflow-hidden border-r border-neutral-800"
            style={{ width: sidebarWidth }}
          >
            <div data-testid="sidebar-scroll-region" className="vault-sidebar-scroll mr-[6px] flex h-full min-h-0 flex-col gap-1 overflow-y-auto p-2">
              {(() => {
              const navLabel = (n: SidebarNavItem) => 'toolkitPage' in n ? t(n.label) : t(navItemLabel(n, activeVault?.type));
              const navButton = (n: SidebarNavItem, disabled = false) => (
                <button
                  key={n.id}
                  data-tour={`nav-${n.id}`}
                  disabled={disabled}
                  aria-disabled={disabled}
                  aria-label={sidebarCompact ? navLabel(n) : undefined}
                  title={disabled ? `${navLabel(n)} · ${t('Próximamente')}` : sidebarCompact ? navLabel(n) : undefined}
                  onClick={() => {
                    if (disabled) return;
                    if ('toolkitPage' in n) {
                      setToolkitPage(n.toolkitPage);
                      setView('toolkit');
                      return;
                    }
                    // La sección Herramientas siempre entra por el catálogo.
                    if (n.id === 'toolkit') setToolkitPage('home');
                    setView(n.id);
                  }}
                  className={`flex items-center rounded-lg py-2 text-sm text-left transition-colors ${sidebarCompact ? 'justify-center px-2' : 'gap-2 px-3'} ${
                    disabled
                      ? 'cursor-not-allowed text-neutral-700 opacity-65'
                      : ('toolkitPage' in n
                          ? view === 'toolkit' && toolkitPage === n.toolkitPage
                          : view === n.id && (n.id !== 'toolkit' || toolkitPage === 'home'))
                        ? 'bg-indigo-600 text-white'
                        : 'text-neutral-400 hover:bg-neutral-900'
                  }`}
                >
                  <Icon name={n.icon} className="shrink-0 opacity-70" />
                  <span className={sidebarCompact ? 'sr-only' : undefined}>{navLabel(n)}</span>
                  {disabled && !sidebarCompact && <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide">{t('Próximamente')}</span>}
                </button>
              );
              // A collapsible group header (chevron + label), optionally with a control
              // on the right (e.g. the "new database" +).
              const groupHeaderButton = (groupId: string, label: string, collapsed: boolean, hasActive: boolean) => (
                <button
                  onClick={() => toggleGroup(groupId)}
                  aria-expanded={!collapsed}
                  title={collapsed ? t('Mostrar grupo') : t('Plegar grupo')}
                  className={`flex items-center gap-1 flex-1 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-left transition-colors ${
                    collapsed && hasActive ? 'text-indigo-400' : 'text-neutral-600 hover:text-neutral-400'
                  }`}
                >
                  <Icon
                    name="chevronRight"
                    size={11}
                    className={`transition-transform duration-200 ${collapsed ? 'rotate-0' : 'rotate-90'}`}
                  />
                  {t(label)}
                </button>
              );
              const renderGroup = (group: (typeof navGroups)[number]) => {
                const collapsed = !sidebarCompact && collapsedGroups.has(group.id);
                const hasActive = group.items.some((n) => 'toolkitPage' in n
                  ? view === 'toolkit' && toolkitPage === n.toolkitPage
                  : n.id === view);
                return (
                  <div key={group.id} className={`${sidebarCompact ? 'mt-1 border-t border-neutral-800/70 pt-1' : 'mt-2'} flex flex-col gap-1`}>
                    {!sidebarCompact && <div className="flex items-center px-3">{groupHeaderButton(group.id, group.label, collapsed, hasActive)}</div>}
                    {!collapsed && group.items.map((n) => navButton(n))}
                  </div>
                );
              };
              if (isAcademic && academicItems) return <>
                {academicItems.filter(item => item.id === 'home' || item.id === 'library').map(item => navButton(item))}
                {academicGroups.map(group => renderGroup(group))}
                <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
              </>;
              if (isWorldbuilding) {
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <WorldbuildingSidebar
                      compact={sidebarCompact}
                      activeView={view}
                      onNavigate={(targetView) => setView(targetView)}
                      sidebarOrder={settings?.sidebarOrder}
                      sidebarHidden={activeSidebarHidden}
                    />
                    {/* Only the tools group: Explorar/Analizar/Crear are already covered
                        by WorldbuildingSidebar, so rendering them would duplicate. */}
                    {navGroups.filter((group) => group.id === 'tools').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              if (isProsopography) {
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <ProsopographySidebar
                      compact={sidebarCompact}
                      activeView={view}
                      onNavigate={(targetView) => setView(targetView)}
                      sidebarOrder={settings?.sidebarOrder}
                      sidebarHidden={activeSidebarHidden}
                    />
                    {navGroups.filter((group) => group.id === 'tools').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              if (isTestimonios) {
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <TestimonySidebar
                      compact={sidebarCompact}
                      activeView={view}
                      onNavigate={(targetView) => setView(targetView)}
                      sidebarOrder={settings?.sidebarOrder}
                      sidebarHidden={activeSidebarHidden}
                    />
                    {/* Solo el grupo de herramientas: Explorar/Analizar/Registrar ya los
                        cubre TestimonySidebar, y repetirlos duplicaría el menú. */}
                    {navGroups.filter((group) => group.id === 'tools').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              if (isPrimarySources) {
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <PrimarySourcesSidebar
                      compact={sidebarCompact}
                      activeView={view}
                      onNavigate={(targetView) => setView(targetView)}
                      sidebarOrder={settings?.sidebarOrder}
                      sidebarHidden={activeSidebarHidden}
                    />
                    {/* Toolkit is universal. Reuse its canonical group instead of
                        maintaining a primary-source fork. */}
                    {navGroups.filter((group) => group.id === 'tools').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              if (isDatabases) {
                // A databases vault keeps the same Explorar · Analizar · Escribir
                // structure as every other vault: the user's databases are the
                // Explorar content (rendered dynamically), then the Analysis + Chat
                // (Analizar) and Notes (Escribir) groups come through groupedNav.
                const exploreCollapsed = !sidebarCompact && collapsedGroups.has('explore');
                const exploreLabel = NAV_GROUPS.find((g) => g.id === 'explore')?.label ?? 'Explorar';
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <div className={`${sidebarCompact ? 'mt-1 border-t border-neutral-800/70 pt-1' : 'mt-2'} flex flex-col gap-1`} data-tour="db-list">
                      <div className="flex items-center px-3">
                        {!sidebarCompact && groupHeaderButton('explore', exploreLabel, exploreCollapsed, ['databases', 'pages', 'dbSearch'].includes(view))}
                        <button
                          onClick={() => void createDatabase()}
                          title={t('Nueva base de datos')}
                          aria-label={t('Nueva base de datos')}
                          className={`${sidebarCompact ? 'flex w-full justify-center py-2' : ''} text-neutral-500 hover:text-neutral-300`}
                        >
                          <Icon name="plus" size={14} />
                        </button>
                      </div>
                      {!exploreCollapsed && navButton(pagesItem)}
                      {!exploreCollapsed && navButton(dbSearchItem)}
                      {!exploreCollapsed && (
                        <DatabasesSidebarExplore
                          compact={sidebarCompact}
                          databases={databases}
                          activeId={activeDatabaseId}
                          isActiveView={view === 'databases'}
                          onOpen={(id) => {
                            setActiveDatabaseId(id);
                            setView('databases');
                          }}
                        />
                      )}
                    </div>
                    {navGroups.filter((group) => group.id !== 'explore').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              if (isEstudio) {
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <StudySidebar
                      compact={sidebarCompact}
                      activeView={view}
                      onNavigate={(targetView) => { setStudyTarget(null); if (targetView !== 'studyLibrary') setStudyMaterialTarget(null); if (targetView !== 'studyRecordings') setStudyRecordingTarget(null); setStudyGraphTarget(null); setView(targetView); }}
                      sidebarOrder={settings?.sidebarOrder}
                      sidebarHidden={activeSidebarHidden}
                    />
                    {navGroups.filter((group) => group.id !== 'explore').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              if (isDocencia) {
                return (
                  <>
                    {navButton(homeItem)}
                    {navButton(libraryItem)}
                    <TeachingSidebar
                      compact={sidebarCompact}
                      activeView={view}
                      onNavigate={(targetView) => { setStudyTarget(null); if (targetView !== 'studyLibrary') setStudyMaterialTarget(null); if (targetView !== 'studyRecordings') setStudyRecordingTarget(null); setStudyGraphTarget(null); setView(targetView); }}
                      sidebarOrder={settings?.sidebarOrder}
                      sidebarHidden={activeSidebarHidden}
                    />
                    {/* Only the tools group: Explorar/Analizar/Escribir are already
                        covered by TeachingSidebar, so rendering them would duplicate. */}
                    {navGroups.filter((group) => group.id === 'tools').map((group) => renderGroup(group))}
                    <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                  </>
                );
              }
              return (
                <>
                  {navButton(homeItem)}
                  {navButton(libraryItem)}
                  {navGroups.map((group) => renderGroup(group))}
                  <div className="mt-2 flex flex-col gap-1">{navButton(settingsItem)}</div>
                </>
              );
              })()}
            </div>
            <button
              data-testid="sidebar-resize-handle"
              type="button"
              className="sidebar-resize-handle"
              aria-label={t('Cambiar el ancho del menú lateral')}
              title={t('Arrastra para cambiar el ancho. Haz doble clic para restablecerlo.')}
              onPointerDown={beginSidebarResize}
              onClick={(event) => event.currentTarget.focus()}
              onKeyDown={resizeSidebarWithKeyboard}
              onDoubleClick={() => { setSidebarWidth(SIDEBAR_DEFAULT_WIDTH); localStorage.setItem('nodus.sidebarWidth', String(SIDEBAR_DEFAULT_WIDTH)); }}
            />
          </nav>
        )}

        {/* Main view */}
        {/* One continuity snapshot for the whole worldbuilding vault. Every sheet's badge
            filters the same array with `findingsFor()`, so a contradiction costs one set of
            queries rather than one per open sheet. */}
        <ContinuityProvider enabled={isWorldbuilding} revision={CONTINUITY_VIEWS.has(view) ? view : undefined}>
        <main className="flex flex-1 min-w-0 flex-col overflow-hidden" data-nodi-view={view}>
          {/* A backup system that fails quietly is worse than none: until now the only
              trace of a broken schedule was a grey line inside a collapsed Settings
              section, so a user could go months believing they were protected. Only
              genuinely blocking states appear here, and only once per session. */}
          {!activeVault?.learningWorkspace && !isPreviewVault && recoveryStatus?.health.level === 'critical' && !recoveryStatus.needsSetup && !backupWarningDismissed && (
            <div data-testid="backup-health-banner" className="backup-health-banner">
              <Icon name="alert" size={16} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <b>{recoveryHealthHeadline(recoveryStatus.health)}</b>
                {recoveryHealthAdvice(recoveryStatus.health) && (
                  <span className="ml-2 opacity-80">{recoveryHealthAdvice(recoveryStatus.health)}</span>
                )}
              </span>
              <button className="btn btn-ghost shrink-0 text-xs" onClick={() => setView('settings')}>
                {t('Revisar copias')}
              </button>
              <button
                className="backup-health-dismiss"
                aria-label={t('Ocultar aviso')}
                title={t('Ocultar aviso')}
                onClick={() => setBackupWarningDismissed(true)}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          )}
          {isAcademic && <LearningWorkspaceBar controller={learning} settings={settings}/>}
          {isAcademic && <AcademicLearningCoach controller={learning} settings={settings} blocked={learningSuspended || learningOverlayBusy} navigate={setView} openIdea={openIdea} openGraph={id => navigate('graph', { preset: 'overview', nodeId: id })} prepareQuestion={documentId => {
            requestLearningPrompt({ vaultId: activeVault!.id, sessionId: learning.session!.id, documentId, prompt: learningText('suggestedQuestion', settings.uiLanguage) }); setView('researchChat');
          }} />}
          <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="grid h-full place-items-center text-sm text-neutral-500"><span className="flex items-center gap-2"><Icon name="sync" className="animate-spin" /> {t('Cargando...')}</span></div>}>
          {/* Per-view crash isolation: a render error in one section shows a
              recovery card here instead of blanking the whole window. key={view}
              clears the error automatically when the user switches sections. */}
          <AppErrorBoundary key={view}>
          {VIEW_REGISTRY[view](viewContext)}
          </AppErrorBoundary>
          </Suspense>
          </div>
        </main>
        </ContinuityProvider>
      </div>

      {isAcademic && activeVault && settings.onboardingComplete && <ResearchPreparationWelcome key={activeVault.id} vaultId={activeVault.id}
        allowAutomatic={false}
        onConfigure={() => setView('settings')} />}
      {isAcademic && <AcademicInterfacePicker open={interfacePickerOpen} anchorEl={interfaceTrigger} settings={settings} onUpdate={async patch => { await window.nodus.updateSettings(patch); await reloadSettings(); }} onSettings={openInterfacePreferences} profile={profile} onSelect={chooseInterface} onClose={() => setInterfacePickerOpen(false)} onGuide={() => { setInterfacePickerOpen(false); learning.open(lessonForProfile(profile), 'invite'); }} />}
      {isAcademic && <AcademicLearningDialogs controller={learning} settings={settings} blocked={learningBlocked} onActivateIntermediate={() => chooseInterface('intermediate')} onSettings={setSettings}/>}
      <FeedbackHost />
      <PrivacyRequestHost />
      <BrowserConnectorPairingRequestHost />

      {paletteOpen && <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} />}
      <FocusLayoutDialog sections={focusSections} />
      <FocusExitDialog />

      <Suspense fallback={null}>
      {collectionsOpen && (
        <CollectionsModal
          settings={settings}
          onSettingsChange={reloadSettings}
          onClose={() => setCollectionsOpen(false)}
        />
      )}
      {skillsTab && (
        <SkillMarketplaceModal
          initialTab={skillsTab}
          onClose={() => setSkillsTab(null)}
        />
      )}
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
      {roadmapOpen && <RoadmapModal onClose={() => setRoadmapOpen(false)} />}

      {!isPreviewVault && settings.onboardingComplete && settings.basicsTutorialVersion > 0 && !settings.tourComplete && localStorage.getItem(`nodus.academicTourReplay:${activeVault?.id}`) === '1' && !isAcademic && !isPrimarySources && !isGenealogy && !isDatabases && !isEstudio && !isDocencia && !isWorldbuilding && !isProsopography && !isTestimonios && (
        <Tour
          onNavigate={setView}
          onClose={async () => {
            localStorage.removeItem(`nodus.academicTourReplay:${activeVault?.id}`);
            await window.nodus.updateSettings({ tourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isProsopography && !settings.tourComplete && (
        <ProsopographyTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ tourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isWorldbuilding && !settings.tourComplete && (
        <WorldbuildingTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ tourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isPrimarySources && !settings.primarySourcesTourComplete && (
        <PrimarySourcesTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ primarySourcesTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isGenealogy && !settings.genealogyTourComplete && (
        <GenealogyTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ genealogyTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isDatabases && !settings.databasesTourComplete && (
        <DatabasesTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ databasesTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isTestimonios && !settings.testimonyTourComplete && (
        <TestimonyTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ testimonyTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isEstudio && !settings.studyTourComplete && (
        <StudyTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ studyTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {settings.onboardingComplete && settings.basicsTutorialVersion > 0 && isDocencia && !settings.docenciaTourComplete && (
        <TeachingTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ docenciaTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {csvPlan && (
        <CsvImportModal
          plan={csvPlan}
          onClose={() => {
            // Let the main process drop the parsed rows it is holding for this import.
            void window.nodus.releaseCsvImport(csvPlan.token);
            setCsvPlan(null);
          }}
          onImported={(id) => {
            setCsvPlan(null);
            void reloadDatabases();
            setActiveDatabaseId(id);
            setView('databases');
          }}
        />
      )}
      {notionImportReport && (
        <NotionImportReportModal report={notionImportReport} onClose={() => setNotionImportReport(null)} />
      )}
      </Suspense>

      {!isPreviewVault && settings.onboardingComplete && settings.basicsTutorialVersion > 0 && settings.tourComplete && !settings.advancedTourComplete && !isAcademic && (
        <AdvancedTour
          onNavigate={setView}
          onClose={async () => {
            await window.nodus.updateSettings({ advancedTourComplete: true });
            void reloadSettings();
          }}
        />
      )}

      {!activeVault?.learningWorkspace && !isPreviewVault && settings.onboardingComplete && !settings.academicLearningProgress?.invitationsEligible &&
        settings.basicsTutorialVersion > 0 &&
        !recoveryStatus?.needsSetup &&
        (isPrimarySources || isGenealogy || isDatabases || isTestimonios || isEstudio || isDocencia || settings.tourComplete) &&
        settings.advancedTourComplete &&
        (!isPrimarySources || settings.primarySourcesTourComplete) &&
        (!isGenealogy || settings.genealogyTourComplete) &&
        (!isDatabases || settings.databasesTourComplete) &&
        (!isTestimonios || settings.testimonyTourComplete) &&
        (!isEstudio || settings.studyTourComplete) &&
        (!isDocencia || settings.docenciaTourComplete) && (
          <WhatsNewModal
            settings={settings}
            activeVaultType={activeVault?.type ?? null}
            uiLanguage={settings.uiLanguage}
            onSettled={() => setWhatsNewSettled(true)}
          />
        )}

      {aiModelRequiredOpen && (
        <AiModelRequiredModal
          onClose={() => setAiModelRequiredOpen(false)}
          onOpenSettings={() => {
            localStorage.setItem('nodus.settingsTarget', 'models');
            setAiModelRequiredOpen(false);
            setView('settings');
          }}
        />
      )}

      {!activeVault?.learningWorkspace && !settings.academicLearningProgress?.invitationsEligible && !isPreviewVault && recoveryStatus?.needsSetup && recoveryStatus.previousInstallation && !whatsNewSettled && (
        <WhatsNewModal
          settings={settings}
          activeVaultType={activeVault?.type ?? null}
          uiLanguage={settings.uiLanguage}
          onSettled={() => setWhatsNewSettled(true)}
        />
      )}

      {manualWhatsNewOpen && (
        <WhatsNewModal
          settings={settings}
          activeVaultType={activeVault?.type ?? null}
          uiLanguage={settings.uiLanguage}
          showSeenReleaseNotes
          onSettled={() => setManualWhatsNewOpen(false)}
        />
      )}

      {/* Users who already saw the cinematic tutorial were never offered the choice of
          Nodi, so it is made here instead — once, after release notes. New users
          pick inside the tutorial and reach this already chosen. */}
      {whatsNewSettled && !manualWhatsNewOpen && !isPreviewVault &&
        settings.onboardingComplete &&
        settings.basicsTutorialVersion > 0 &&
        !recoveryStatus?.needsSetup &&
        settings.mascotEnabled &&
        !settings.mascotStyleChosen && !settings.academicLearningProgress?.invitationsEligible && (
          <NodiStyleModal onChosen={async () => { await reloadSettings(); }} />
        )}

      {!focusReduced && !manualWhatsNewOpen && whatsNewSettled && <NodiMascot settings={settings} />}
    </div>
    </AcademicLearningContext.Provider></AcademicInterfaceContext.Provider>
  );
}

/**
 * The header's media button.
 *
 * Rendered when a browser tab holds a media session OR Nodus Drift has a selection —
 * and "holds a session" is not "is making noise". A paused lecture keeps its controls,
 * and so does a paused mix, because taking them away at the exact moment someone pauses
 * is how a user loses the Play button they were reaching for. With neither source the
 * button is gone; Drift is then reached from Nodus Tools.
 *
 * The two sources stay separate: Drift is not dressed up as a Browser media session, the
 * popover offers a Browser | Drift selector inside the one existing popover (one backdrop),
 * and choosing a tab never changes what is playing.
 */
function BrowserMediaHeaderAction({ onOpenTab, onOpenDrift, focusKeep = true }: { onOpenTab: (tabId: string) => void; onOpenDrift: () => void; focusKeep?: boolean }) {
  const states = useBrowserMedia();
  const drift = useDrift();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const hasBrowser = states.length > 0;
  const hasDrift = drift.selection.length > 0;
  if (!hasBrowser && !hasDrift) return null;
  const browserPlaying = states.some((state) => state.playing);
  const title = browserPlaying && drift.playing ? t('Reproduciéndose en Nodus Browser y Nodus Drift')
    : browserPlaying ? t('Reproduciéndose en Nodus Browser')
      : drift.playing ? t('Reproduciéndose en Nodus Drift')
        : hasBrowser && hasDrift ? t('Medios en pausa en Nodus Browser y Nodus Drift')
          : hasBrowser ? t('Medios en pausa en Nodus Browser')
            : t('Nodus Drift en pausa');
  const sources = states.length + (hasDrift ? 1 : 0);
  return (
    <span data-testid="browser-media-header-action" className="relative inline-flex">
      <HeaderAction
        icon="volume"
        focusKeep={focusKeep}
        label={t('Medios')}
        title={title}
        onClick={(event) => {
          const button = event.currentTarget;
          setAnchor((current) => (current ? null : button));
        }}
      />
      {sources > 1 && <span className="header-action-badge">{sources}</span>}
      <BrowserMediaPopover
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        onOpenTab={(tabId) => { setAnchor(null); onOpenTab(tabId); }}
        drift={{
          hasSelection: hasDrift,
          lastTab: drift.mediaTab,
          onTab: drift.setMediaTab,
          panel: <DriftMiniPlayer onOpenDrift={() => { setAnchor(null); onOpenDrift(); }} />,
        }}
      />
    </span>
  );
}
