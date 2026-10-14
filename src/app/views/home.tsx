import { academicNavigation } from '../../academicInterfaceProfiles';
import { Icon } from '../../components/ui';
import { ManualIndexStatus } from '../../components/ManualIndexStatus';
import { t } from '../../i18n';
// «Inicio» is one section of the sidebar and nine different screens.
//
// It is the one view whose implementation is chosen by vault type rather than by
// id, so it gets its own file instead of being split across the domain ones: what
// a reader needs here is the whole dispatch in view, in order.
import { lazy } from 'react';
import { HomeView, GenealogyHome, DatabasesHome } from '../../views/HomeView';
import type { ViewRenderer } from '../ViewContext';

const StudyHome = lazy(() => import('../../views/StudyHome').then((module) => ({ default: module.StudyHome })));
const TeachingHome = lazy(() => import('../../views/TeachingHome').then((module) => ({ default: module.TeachingHome })));
const WorldbuildingHome = lazy(() => import('../../views/WorldbuildingHome').then((module) => ({ default: module.WorldbuildingHome })));
const ProsopographyHome = lazy(() => import('../../views/ProsopographyHome').then((module) => ({ default: module.ProsopographyHome })));
const PrimarySourcesHomeView = lazy(() => import('../../views/PrimarySourcesHomeView').then((module) => ({ default: module.PrimarySourcesHomeView })));
const TestimonyHome = lazy(() => import('../../views/TestimonyHome').then((module) => ({ default: module.TestimonyHome })));

export const renderHome: ViewRenderer = (ctx) => {
  const {
    settings, activeVault, hasData, demoBusy, lastSync, syncing,
    databases, setView, navigate, openAssistant, onSync, openLibraryBucket,
    openPrimarySourceTarget, openTestimonyInterview, setNoteTarget,
    setActiveDatabaseId, createDatabase, importCsv, importNotion,
  } = ctx;
  const showDemoOffer = hasData === false && !settings.demoMode;
  if (ctx.isAcademic && settings.academicInterfaceProfile === 'intermediate') return <div className="h-full overflow-auto p-6" data-testid="academic-intermediate-home">
    <h1 className="text-xl font-semibold mb-4">{t('Inicio')}</h1>
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">{academicNavigation(settings).filter(item => item.id !== 'home' && item.id !== 'settings').map(item => <button key={item.id} className="card p-5 text-left flex items-center gap-3 hover:border-indigo-400" onClick={() => setView(item.id as import('../../navigation').View)}><Icon name={item.icon} /><span>{t(item.label)}</span></button>)}</div>
  </div>;


  if (ctx.isGenealogy) {
    return (
      <GenealogyHome
        settings={settings}
        onNavigate={(target) => navigate(target)}
        onOpenAssistant={() => openAssistant()}
        showDemoOffer={showDemoOffer}
        demoBusy={demoBusy}
        onLoadDemo={ctx.loadDemo}
        onLoadGenealogyDemo={ctx.loadGenealogyDemo}
        onLoadDatabasesDemo={ctx.loadDatabasesDemo}
      />
    );
  }
  if (ctx.isPrimarySources) {
    return (
      <PrimarySourcesHomeView
        vault={activeVault}
        onNavigate={setView}
        onOpenSource={openPrimarySourceTarget}
        onOpenNote={(id) => {
          setNoteTarget({ id, nonce: Date.now() });
          setView('notes');
        }}
        showDemoOffer={showDemoOffer}
        demoBusy={demoBusy}
        onLoadDemo={() => void ctx.loadPrimarySourcesDemo()}
      />
    );
  }
  if (ctx.isDatabases) {
    return (
      <DatabasesHome
        databases={databases}
        onOpenDatabase={(id) => {
          setActiveDatabaseId(id);
          setView('databases');
        }}
        onNewDatabase={() => void createDatabase()}
        onImportCsv={() => void importCsv()}
        onImportNotion={() => void importNotion()}
        onOpenAnalysis={() => setView('dbAnalysis')}
        onOpenChat={() => setView('dbChat')}
        onOpenDeepResearch={() => setView('dbDeepResearch')}
        demoBusy={demoBusy}
        onLoadDatabasesDemo={ctx.loadDatabasesDemo}
      />
    );
  }
  if (ctx.isEstudio) {
    return (
      <StudyHome
        onNavigate={setView}
        onOpenDocument={(id) => { ctx.setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }}
        // The study demo is offered on the strength of the flag alone: an empty
        // study vault is the normal state of one that is being set up.
        showDemoOffer={!settings.demoMode}
        demoBusy={demoBusy}
        onLoadDemo={ctx.loadStudyDemo}
      />
    );
  }
  if (ctx.isDocencia) {
    return (
      <TeachingHome
        onNavigate={setView}
        onOpenDocument={(id) => { ctx.setStudyTarget({ kind: 'document', id }); setView('studyCourses'); }}
        showDemoOffer={showDemoOffer}
        demoBusy={demoBusy}
        onLoadDemo={ctx.loadTeachingDemo}
      />
    );
  }
  if (ctx.isWorldbuilding) {
    return (
      <WorldbuildingHome
        onNavigate={setView}
        showDemoOffer={showDemoOffer}
        demoBusy={demoBusy}
        onLoadDemo={ctx.loadWorldbuildingDemo}
      />
    );
  }
  if (ctx.isTestimonios) {
    return (
      <TestimonyHome
        onNavigate={setView}
        onOpenInterview={openTestimonyInterview}
        showDemoOffer={showDemoOffer}
        demoBusy={demoBusy}
        onLoadDemo={ctx.loadTestimonyDemo}
      />
    );
  }
  if (ctx.isProsopography) return <ProsopographyHome onNavigate={setView} />;
  // A preview vault renders no home at all: it is someone else's corpus, opened
  // read-only, and the academic home offers actions that would write to it.
  if (!ctx.isPreviewVault && settings.academicMode === 'manual') return (
    <div className="home-dashboard h-full overflow-y-auto p-6" data-testid="manual-academic-home">
      <div className="mx-auto max-w-4xl space-y-6">
        <div><p className="text-xs uppercase tracking-wide text-indigo-500">{t('Vault académico')} · {t('Modo Manual')}</p>
          <h1 className="mt-2 text-2xl font-semibold">{t('Tu espacio de investigación')}</h1>
          <p className="mt-3 text-sm text-neutral-500">{t('Crea tus ideas, vincula obras y añade citas y relaciones a tu ritmo. Nodus las indexa para facilitar la búsqueda.')}</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button className="card p-5 text-left" onClick={async () => { const { globalId } = await window.nodus.createManualIdea({ folderId: null }); ctx.openIdea(globalId); }}><b>{t('Crear idea')}</b><p className="mt-2 text-xs text-neutral-500">{t('Las obras, citas y relaciones son opcionales. Puedes empezar con una idea independiente.')}</p></button>
          <button className="card p-5 text-left" onClick={() => setView('library')}><b>{t('Biblioteca')}</b><p className="mt-2 text-xs text-neutral-500">Nodus · Zotero</p></button>
          <button className="card p-5 text-left" onClick={() => setView('ideas')}><b>{t('Ideas')}</b></button>
          <button className="card p-5 text-left" onClick={() => setView('graph')}><b>{t('Grafo')}</b></button>
        </div>
        <ManualIndexStatus />
      </div>
    </div>
  );
  if (ctx.isPreviewVault) return null;
  return (
    <HomeView
      vaultId={activeVault?.id ?? null}
      settings={settings}
      lastSync={lastSync}
      syncing={syncing}
      onSync={onSync}
      onNavigate={(target) => navigate(target)}
      onOpenLibraryBucket={openLibraryBucket}
      onOpenAssistant={() => openAssistant()}
      showDemoOffer={showDemoOffer}
      demoBusy={demoBusy}
      onLoadDemo={ctx.loadDemo}
      onLoadGenealogyDemo={ctx.loadGenealogyDemo}
      onLoadDatabasesDemo={ctx.loadDatabasesDemo}
    />
  );
};
