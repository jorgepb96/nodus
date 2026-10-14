// The academic corpus: the library, the graph and everything derived from it,
// plus the two sections whose engine changes with the vault (search, notes).
import { lazy } from 'react';
import type { ViewContext, ViewRenderer } from '../ViewContext';
import type { NoteResearchChatSource } from '@shared/types';
import type { View } from '../../navigation';

const GlobalLibraryView = lazy(() => import('../../views/GlobalLibraryView').then((module) => ({ default: module.GlobalLibraryView })));
const GraphView = lazy(() => import('../../views/GraphView').then((module) => ({ default: module.GraphView })));
const ArgumentMapView = lazy(() => import('../../views/ArgumentMapView').then((module) => ({ default: module.ArgumentMapView })));
const IdeasView = lazy(() => import('../../views/IdeasView').then((module) => ({ default: module.IdeasView })));
const DictionaryView = lazy(() => import('../../views/DictionaryView').then((module) => ({ default: module.DictionaryView })));
const AuthorsView = lazy(() => import('../../views/AuthorsView').then((module) => ({ default: module.AuthorsView })));
const CoverageWorkspace = lazy(() => import('../../views/CoverageWorkspace').then((module) => ({ default: module.CoverageWorkspace })));
const HypothesisLabView = lazy(() => import('../../views/HypothesisLabView').then((module) => ({ default: module.HypothesisLabView })));
const ReadingPathView = lazy(() => import('../../views/ReadingPathView').then((module) => ({ default: module.ReadingPathView })));
const DeepResearchView = lazy(() => import('../../views/DeepResearchView').then((module) => ({ default: module.DeepResearchView })));
const ImmersionView = lazy(() => import('../../views/ImmersionView').then((module) => ({ default: module.ImmersionView })));
const WorkspaceView = lazy(() => import('../../views/WorkspaceView').then((module) => ({ default: module.WorkspaceView })));
const WorldSearchView = lazy(() => import('../../views/WorldSearchView').then((module) => ({ default: module.WorldSearchView })));
const SearchView = lazy(() => import('../../views/SearchView').then((module) => ({ default: module.SearchView })));
const PrimarySourcesSearchView = lazy(() => import('../../views/PrimarySourcesSearchView').then((module) => ({ default: module.PrimarySourcesSearchView })));
const PrimarySourcesNotesView = lazy(() => import('../../views/PrimarySourcesNotesView').then((module) => ({ default: module.PrimarySourcesNotesView })));
const TestimonySearchView = lazy(() => import('../../views/TestimonySearchView').then((module) => ({ default: module.TestimonySearchView })));

const openOriginConversation = (ctx: ViewContext) => (source: NoteResearchChatSource) => ctx.openResearchConversation({
  surface: source.surface,
  conversationId: source.conversationId,
  messageId: source.messageId,
  messageIndex: source.messageIndex,
});

const WORLD_REFERENCE_VIEW: Record<string, View> = {
  character: 'characters', place: 'places', group: 'factions', scene: 'scenes', article: 'encyclopedia',
  map: 'map', rule: 'rules', conflict: 'conflicts',
};

export const corpusViews = {
  // `snapshot` is the same shape as `target` and `initialTab`: a starting value the
  // shell hands down, read once at mount. `onSnapshotChange` is the return path, so
  // the cut survives the unmount that leaving the section causes.
  library: ({ activeVault, isPrimarySources, libraryTarget, navigate, openAssistant, reloadSettings, setCollectionsOpen, setLibraryTarget, settings, setView, snapshots }) => (
    <GlobalLibraryView
      target={libraryTarget}
      onTargetConsumed={() => setLibraryTarget(null)}
      snapshot={snapshots.read('library')}
      onSnapshotChange={(patch) => snapshots.patch('library', patch)}
      settings={settings}
      vaultId={activeVault?.id ?? null}
      vaultType={activeVault?.type}
      onSettingsChange={reloadSettings}
      onOpenSettings={() => setView('settings')}
      onOpenCollections={() => setCollectionsOpen(true)}
      onOpenGraph={(target) => navigate('graph', target)}
      onOpenAssistant={openAssistant}
      onOpenArchive={isPrimarySources ? () => setView('archive') : undefined}
    />
  ),
  graph: ({ graphTarget, reloadSettings, settings, snapshots, openIdea, activeVault }) => <GraphView key={activeVault?.id} onEditManualIdea={openIdea} settings={settings} onSettingsChange={reloadSettings} target={graphTarget}
    snapshot={snapshots.read('graph')} onSnapshotChange={snapshot => snapshots.patch('graph', snapshot)} />,
  argument: ({ settings, snapshots }) => (
    <ArgumentMapView
      settings={settings}
      snapshot={snapshots.read('argument')}
      onSnapshotChange={(patch) => snapshots.patch('argument', patch)}
    />
  ),
  ideas: ({ activeVault, ideaTarget, navigate, openAssistant, snapshots, settings }) => (
    <IdeasView
      manual={settings.academicMode === 'manual'}
      vaultId={activeVault?.id ?? null}
      target={ideaTarget}
      snapshot={snapshots.read('ideas')}
      onSnapshotChange={(patch) => snapshots.patch('ideas', patch)}
      onOpenGraph={(target) => navigate('graph', target)}
      onOpenAssistant={openAssistant}
    />
  ),
  dictionary: ({ openAuthor, openIdea, openLibraryItem, settings, snapshots }) => (
    <DictionaryView
      settings={settings}
      snapshot={snapshots.read('dictionary')}
      onSnapshotChange={(patch) => snapshots.patch('dictionary', patch)}
      onOpenIdea={openIdea}
      onOpenAuthor={openAuthor}
      onOpenLibraryWork={openLibraryItem}
    />
  ),
  authors: ({ activeVault, authorTarget, navigate, settings, snapshots }) => (
    <AuthorsView
      vaultId={activeVault?.id ?? null}
      settings={settings}
      snapshot={snapshots.read('authors')}
      onSnapshotChange={(patch) => snapshots.patch('authors', patch)}
      onOpenGraph={(target) => navigate('graph', target)}
      target={authorTarget}
    />
  ),
  immersion: ({ openLibraryItem, settings, snapshots }) => (
    <ImmersionView
      settings={settings}
      snapshot={snapshots.read('immersion')}
      onSnapshotChange={(patch) => snapshots.patch('immersion', patch)}
      onOpenLibraryWork={openLibraryItem}
    />
  ),
  // Cobertura y Huecos son el mismo espacio con dos pestañas. 'gaps' ya no tiene
  // entrada en la barra lateral, pero sigue siendo una vista enrutable —Inicio,
  // Buscar y el tour avanzado navegan a ella— y entra por la pestaña de huecos.
  gaps: ({ activeVault, navigate, openAssistant }) => (
    <CoverageWorkspace
      vaultId={activeVault?.id ?? null}
      initialTab="gaps"
      onOpenGraph={(target) => navigate('graph', target)}
      onOpenAssistant={openAssistant}
    />
  ),
  debate: ({ activeVault, navigate, openAssistant }) => (
    <CoverageWorkspace
      vaultId={activeVault?.id ?? null}
      initialTab="debate"
      onOpenGraph={(target) => navigate('graph', target)}
      onOpenAssistant={openAssistant}
    />
  ),
  research: ({ activeVault, navigate, openAssistant }) => (
    <CoverageWorkspace
      vaultId={activeVault?.id ?? null}
      initialTab="map"
      onOpenGraph={(target) => navigate('graph', target)}
      onOpenAssistant={openAssistant}
    />
  ),
  hypothesis: ({ navigate, openAssistant, settings }) => (
    <HypothesisLabView
      settings={settings}
      onOpenGraph={(target) => navigate('graph', target)}
      onOpenAssistant={openAssistant}
    />
  ),
  reading: ({ navigate, openAssistant }) => (
    <ReadingPathView onOpenGraph={(target) => navigate('graph', target)} onOpenAssistant={openAssistant} />
  ),
  // Compatibility aliases for bookmarks and commands created before Escritura and
  // Proyectos were folded into the single Workspace. They deliberately render the
  // exact same component instead of keeping two hidden product surfaces alive.
  writing: ({ navigate, noteTarget, settings, snapshots }) => (
    <WorkspaceView
      settings={settings}
      focusNote={noteTarget}
      snapshot={snapshots.read('workspace')}
      onSnapshotChange={(patch) => snapshots.patch('workspace', patch)}
      onOpenGraph={(target) => navigate('graph', target)}
    />
  ),
  deepResearch: ({ isGenealogy, openLibraryItem, settings, snapshots }) => (
    <DeepResearchView
      settings={settings}
      isGenealogy={isGenealogy}
      snapshot={snapshots.read('deepResearch')}
      onSnapshotChange={(patch) => snapshots.patch('deepResearch', patch)}
      onOpenLibraryWork={openLibraryItem}
    />
  ),
  projects: ({ navigate, noteTarget, settings, snapshots }) => (
    <WorkspaceView
      settings={settings}
      focusNote={noteTarget}
      snapshot={snapshots.read('workspace')}
      onSnapshotChange={(patch) => snapshots.patch('workspace', patch)}
      onOpenGraph={(target) => navigate('graph', target)}
    />
  ),

  // Searching a testimonies vault is NOT searching a Zotero corpus: what has to be
  // found are passages with their speaker, their minute and their access condition.
  // Same sidebar section, different engine behind it.
  search: ({ activeVault, isPrimarySources, isTestimonios, navigate, openNoteFromSearch, openPrimarySourceTarget, openTestimonyInterview, setNoteTarget, setPersonsTarget, setView }) => {
    if (activeVault?.type === 'worldbuilding') return <WorldSearchView onNavigate={setView} />;
    if (isTestimonios) {
      return (
        <TestimonySearchView
          onOpenInterview={openTestimonyInterview}
          onNavigate={(target) => setView(target)}
        />
      );
    }
    if (isPrimarySources) {
      return (
        <PrimarySourcesSearchView
          onOpenSource={openPrimarySourceTarget}
          onOpenNote={(id) => {
            setNoteTarget({ id, nonce: Date.now() });
            setView('notes');
          }}
          onNavigate={setView}
        />
      );
    }
    return (
      <SearchView
        vaultType={activeVault?.type}
        onOpenGraph={(target) => navigate('graph', target)}
        onOpenNote={openNoteFromSearch}
        onOpenGaps={() => setView('gaps')}
        onOpenPerson={(id) => {
          setPersonsTarget({ id, nonce: Date.now() });
          setView('persons');
        }}
        onOpenTimeline={() => setView('timeline')}
        onOpenArchive={() => setView('archive')}
      />
    );
  },

  // Notas, ideas y colecciones con una única experiencia visual. La ruta académica
  // mantiene las rutas antiguas bajo el nombre Nodus Scriptor en Nodus Tools.
  workspace: ({ navigate, noteTarget, settings, snapshots, openResearchConversation }) => (
    <WorkspaceView
      settings={settings}
      focusNote={noteTarget}
      snapshot={snapshots.read('workspace')}
      onSnapshotChange={(patch) => snapshots.patch('workspace', patch)}
      onOpenGraph={(target) => navigate('graph', target)}
      onOpenResearchConversation={(source) => openResearchConversation({ surface: source.surface, conversationId: source.conversationId, messageId: source.messageId, messageIndex: source.messageIndex })}
    />
  ),

  notes: (ctx) => (ctx.isPrimarySources
    ? <PrimarySourcesNotesView focusNote={ctx.noteTarget} onOpenSource={ctx.openPrimarySourceTarget} onOpenResearchConversation={openOriginConversation(ctx)} />
    : (
      <WorkspaceView
        settings={ctx.settings}
        title="Nodus Scriptor"
        snapshot={ctx.snapshots.read('notes')}
        onSnapshotChange={(patch) => ctx.snapshots.patch('notes', patch)}
        onOpenGraph={(target) => ctx.navigate('graph', target)}
        focusNote={ctx.noteTarget}
        onTestimonyLink={ctx.isTestimonios ? ctx.openTestimonyLink : undefined}
        onOpenResearchConversation={openOriginConversation(ctx)}
        onOpenStudyDocument={(id) => { ctx.setStudyTarget({ kind: 'document', id }); ctx.setView('studyCourses'); }}
        onOpenStudyMaterial={(id) => { ctx.setStudyMaterialTarget({ id }); ctx.setView('studyLibrary'); }}
        onOpenStudyRecording={(id, timestamp) => { ctx.setStudyRecordingTarget({ id, timestamp }); ctx.setView('studyRecordings'); }}
        onOpenWorldEntry={(kind) => { const target = WORLD_REFERENCE_VIEW[kind]; if (target) ctx.setView(target); }}
        studyLinks={ctx.isEstudio || ctx.isDocencia ? {
          onOpenLocation: (target) => { ctx.setStudyTarget(target); ctx.setView('studyCourses'); },
          onOpenMaterial: (id) => { ctx.setStudyMaterialTarget({ id }); ctx.setView('studyLibrary'); },
        } : undefined}
      />
    )),
} satisfies Record<string, ViewRenderer>;
