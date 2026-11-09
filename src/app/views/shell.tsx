// The two sections that are about Nodus itself rather than about a corpus.
import { lazy } from 'react';
import type { ViewRenderer } from '../ViewContext';

const NodusBrowserView = lazy(() => import('../../views/NodusBrowserView').then((module) => ({ default: module.NodusBrowserView })));
const RadarView = lazy(() => import('../../views/RadarView').then((module) => ({ default: module.RadarView })));
const CompassView = lazy(() => import('../../views/CompassView').then((module) => ({ default: module.CompassView })));
const ToolkitView = lazy(() => import('../../views/ToolkitView').then((module) => ({ default: module.ToolkitView })));
const ResearchAssistantModal = lazy(() => import('../../views/ResearchAssistantModal').then(module => ({ default: module.ResearchAssistantModal })));
const Settings = lazy(() => import('../../views/Settings').then((module) => ({ default: module.Settings })));
const StudyFocusView = lazy(() => import('../../views/StudyFocusView').then((module) => ({ default: module.StudyFocusView })));
const PodcastView = lazy(() => import('../../views/PodcastView').then((module) => ({ default: module.PodcastView })));

export const shellViews = {
  studyFocus: () => <StudyFocusView />,
  podcast: ({ settings, isAcademic, activeVault, setView }) => <PodcastView key={activeVault?.id} settings={settings} isAcademic={isAcademic} onOpenView={() => setView('podcast')} />,
  researchChat: ({ settings, assistantTarget, researchConversationTarget, openNoteFromSearch, isAcademic, isGenealogy, activeVault }) => <ResearchAssistantModal key={activeVault?.id} settings={settings} embedded isAcademic={isAcademic} initialTarget={assistantTarget} initialConversationTarget={researchConversationTarget} notesDestinationLabel="Nodus Scriptor" onOpenSavedNote={openNoteFromSearch} isGenealogy={isGenealogy} />,
  browser: () => <NodusBrowserView />,
  radar: ({ radarTarget }) => <RadarView target={radarTarget} />,
  compass: ({ snapshots }) => <CompassView snapshot={snapshots.read('compass')} onSnapshotChange={(patch) => snapshots.patch('compass', patch)} />,
  toolkit: ({ setToolkitPage, setView, settings, toolkitPage, activeVault }) => <ToolkitView page={toolkitPage} onNavigate={setToolkitPage} onOpenView={setView} settings={settings} vaultType={activeVault?.type} />,
  settings: ({ activeVault, recoveryStatus, reloadSettings, reloadVaults, setManualWhatsNewOpen, setRoadmapOpen, settings, vaults }) => (
    <Settings
      settings={settings}
      vaults={vaults}
      activeVault={activeVault}
      recoveryHealth={recoveryStatus?.health ?? null}
      onChange={reloadSettings}
      onVaultsChanged={reloadVaults}
      onOpenWhatsNew={() => setManualWhatsNewOpen(true)}
      onOpenRoadmap={() => setRoadmapOpen(true)}
    />
  ),
} satisfies Record<string, ViewRenderer>;
