import { autonomousDictionary } from './autonomousDictionary';
import { autonomousImmersion } from './autonomousImmersion';
import { autonomousTranslation } from './autonomousTranslation';
import {autonomousWriting, cancelAutonomousWriting} from './autonomousWriting';
import {StudyGraphView} from '../views/StudyGraphView';
import {mobileModelInformation} from './structuredPrompt';
import '../index.css';
import './mobile.css';
import './phone.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StellarWorkspace } from '../stellarGraph/StellarWorkspace';
import { memorySource, type StellarGraphSource } from '../stellarGraph/source';
import { DictionaryView } from '../views/DictionaryView';
import { WorkspaceView } from '../views/WorkspaceView';
import { ArgumentMapView } from '../views/ArgumentMapView';
import { DeepResearchView } from '../views/DeepResearchView';
import { ImmersionView } from '../views/ImmersionView';
import { ResearchAssistantModal } from '../views/ResearchAssistantModal';
import { setActiveLang, t } from '../i18n';
import type { AppSettings, GraphData } from '@shared/types';
import { DEFAULT_APP_SETTINGS } from '@shared/defaultAppSettings';
import { projectStudyWorkspace, type StudyProjectionRow } from '@shared/studyOrgProjection';
import { studyKnowledgeProjection } from '@shared/studyKnowledgeProjection';
import { dictionarySnapshot } from '@shared/dictionarySnapshot';
import { localCatalogue } from './localCatalogue';
import { snapshotCitations } from '@shared/snapshotCitations';
import { snapshotSourceDetails } from '@shared/snapshotSourceDetails';
import { OPEN_LIBRARY_DOCUMENT_EVENT, requestLibraryDocumentOpen, type OpenLibraryDocumentDetail } from '../evidenceJump';
import { parsePageNumber } from '@shared/pageLocation';
import { installMobileKeyboard } from './mobileKeyboard';
import { FeedbackHost } from '../components/feedback';

type Configuration = { device?: 'phone' | 'tablet'; surface: 'graph' | 'dictionary' | 'workspace' | 'argument' | 'deepResearch' | 'immersion' | 'chat'; live: boolean; executionMode: 'live' | 'autonomous'; theme: string; accent: string; textScale: number; vaultType: string; language: AppSettings['uiLanguage'] };
const native = window as unknown as {
  nodusMobileConfig: Configuration;
  webkit: { messageHandlers: { nodus: { postMessage(value: unknown): void } } };
  nodusMobileReply(id: string, result: unknown, error: string | { code: string; message: string } | null): void;
  nodusMobileCall(method: string, ...args: unknown[]): Promise<any>;
  nodusMobileSubscriptions: Map<string, Set<(...args: unknown[]) => void>>;
};
let localStudySnapshot: Promise<Record<string, StudyProjectionRow[]>> | undefined;
let localDictionaryTables: Promise<Record<string, StudyProjectionRow[]>> | undefined;
let localDictionary: ReturnType<typeof dictionarySnapshot> | undefined;
let localSources: Promise<ReturnType<typeof snapshotSourceDetails>> | undefined;
function sources() {
  if (!localSources) localSources = native.nodusMobileCall('sourceConsultationTables').then(snapshotSourceDetails).catch(error => { localSources = undefined; throw error; });
  return localSources;
}
function dictionaryTables() {
  if (!localDictionaryTables) localDictionaryTables = native.nodusMobileCall('dictionarySnapshotTables').catch(error => { localDictionaryTables = undefined; throw error; });
  return localDictionaryTables!;
}
function dictionary() {
  if (!localDictionary) localDictionary = dictionaryTables().then(dictionarySnapshot).catch(error => { localDictionary = undefined; throw error; });
  return localDictionary;
}
function studyTables() {
  if (!localStudySnapshot) localStudySnapshot = native.nodusMobileCall('snapshot').then(snapshot => {
    if (!snapshot || typeof snapshot.tables !== 'object' || Array.isArray(snapshot.tables)) throw new Error('La copia publicada no contiene un corpus compatible.');
    return snapshot.tables;
  }).catch(error => { localStudySnapshot = undefined; throw error; });
  return localStudySnapshot;
}
const call = async (method: string, ...args: unknown[]): Promise<any> => {
  if (method === 'getActiveVault') return native.nodusMobileCall('surfaceVaultContext');
  if (!native.nodusMobileConfig.live) {
    if (method === 'getGlobalLibraryItem' || method === 'getLibraryReaderDocument') return native.nodusMobileCall('publishedSourceDocument', String(args[0]), method);
    if (method === 'getSettings') return native.nodusMobileCall('mobileSettings', {...DEFAULT_APP_SETTINGS,
      theme:native.nodusMobileConfig.theme, uiLanguage:native.nodusMobileConfig.language, promptLanguage:native.nodusMobileConfig.language});
    if (['getWork','getWorkMeta','getWorkSummary','getWorkIdeaSynthesis','getIdeasByWork','getIdeaDetail','getIdeaEdges','getEdgeDetail','getGapDetail','getAuthorDossier'].includes(method)) {
      const source = await sources(), id = String(args[0]);
      switch (method) {
        case 'getWork': return source.work(id);
        case 'getWorkMeta': return source.workMeta(id);
        case 'getWorkSummary': return source.workSummary(id);
        case 'getWorkIdeaSynthesis': return source.workSynthesis(id);
        case 'getIdeasByWork': return source.ideasByWork(id, Number(args[1]), Number(args[2]));
        case 'getIdeaDetail': return source.ideaDetail(id);
        case 'getIdeaEdges': return source.ideaEdges(id);
        case 'getEdgeDetail': return source.edgeDetail(id);
        case 'getGapDetail': return source.gapDetail(id);
        case 'getAuthorDossier': return source.authorDossier(id);
      }
    }
    if (['verifyCitations','getCitationPreview','getPassage'].includes(method)) {
      const citations = snapshotCitations(config.surface === 'dictionary' ? await dictionaryTables() : await studyTables());
      if (method === 'getPassage') return citations.passage(String(args[0]));
      return method === 'verifyCitations' ? citations.verify(args[0] as Parameters<typeof citations.verify>[0]) : citations.preview(args[0] as Parameters<typeof citations.preview>[0]);
    }
    if (['listDictionaryEntries','listDictionaryFacets','getDictionaryEntry','listDictionaryEvidence','listDictionaryVersions'].includes(method)) {
      const projection = await dictionary();
      if (method === 'listDictionaryEntries') return projection.list(args[0] as Parameters<typeof projection.list>[0]);
      if (method === 'listDictionaryFacets') return projection.facets();
      if (method === 'getDictionaryEntry') return projection.detail(String(args[0]));
      if (method === 'listDictionaryVersions') return projection.listVersions(String(args[0]));
      return projection.listEvidence(args[0] as Parameters<typeof projection.listEvidence>[0]);
    }
    if (['listAuthors','listWorks','listZoteroTags','listCollectionFacets'].includes(method)) {
      if (args.length) throw new Error('Esta consulta local necesita filtros compatibles con el corpus descargado.');
      const catalogue = localCatalogue(config.surface === 'dictionary' ? await dictionaryTables() : await studyTables());
      if (method === 'listAuthors') return catalogue.authors();
      if (method === 'listWorks') return catalogue.workList();
      if (method === 'listZoteroTags') return catalogue.tags();
      return catalogue.collections();
    }
    if (method === 'scanChangedDictionaryEntries') return []; // A downloaded publication is immutable.
    if (method === 'listDictionaryGenerationJobs') {
      const projection = await dictionary(), entries = projection.list({offset:0,limit:Number.MAX_SAFE_INTEGER}).items;
      return (await Promise.all(entries.map(async entry => {
        const checkpoint = await native.nodusMobileCall('mobileDictionaryCheckpoint','load',entry.id);
        if (!checkpoint || checkpoint.state === 'available') return null;
        return {entryId:entry.id,mode:checkpoint.request.mode,phase:checkpoint.state === 'failed' ? 'failed' : checkpoint.state === 'running' ? 'generating' : 'retrieving',message:checkpoint.error ?? 'Solicitud guardada en este dispositivo',...(checkpoint.error ? {error:checkpoint.error} : {})};
      }))).filter(Boolean);
    }
    if (['estudio','docencia'].includes(native.nodusMobileConfig.vaultType)) {
      if (method === 'getStudyWorkspace') return projectStudyWorkspace(await studyTables(), args[0] as Parameters<typeof projectStudyWorkspace>[1]);
      if (['listStudyIdeas','getStudyIdeaDetail','getStudyKnowledgeGraph'].includes(method)) {
        const projection = studyKnowledgeProjection(await studyTables());
        if (method === 'listStudyIdeas') return projection.list(String(args[0]), args[1] as string|undefined);
        if (method === 'getStudyIdeaDetail') return projection.detail(String(args[0]));
        return projection.graph(String(args[0]));
      }
    }
  }
  return native.nodusMobileCall(method, ...args);
};
const subscriptions = native.nodusMobileSubscriptions;
const streamHandlers = new Map<string, Record<string, (...args: any[]) => void>>();
const streamMethods = new Set(['generateImmersionSession', 'researchChatStream', 'improveStudyText']);
const streamEvents: Record<string, string> = {
  'immersion:generate:progress': 'onProgress', 'study:improve:delta': 'onDelta',
  'research:chatStream:delta': 'onDelta', 'research:chatStream:reasoning': 'onReasoning',
  'research:chatStream:replace': 'onReplace', 'research:chatStream:concilium': 'onConcilium',
  'research:chatStream:activity': 'onActivity', 'mobile:export:progress': 'onProgress',
};
let activeChat: string | undefined, activeImprove: string | undefined;
(window as any).nodusMobileEvent = (event: { channel: string; args: unknown[] }) => {
  if (event.channel === 'mobile:dictionary:progress') {
    for (const listener of subscriptions.get('onDictionaryProgress') ?? []) listener(event.args[0]);
    if (['done', 'degraded'].includes((event.args[0] as { phase?: string })?.phase ?? '')) for (const listener of subscriptions.get('onDictionaryChanged') ?? []) listener(null);
    return;
  }
  const [requestId, ...payload] = event.args;
  const name = streamEvents[event.channel];
  if (name) streamHandlers.get(String(requestId))?.[name]?.(...payload);
};
window.nodus = new Proxy({}, { get: (_, method: string) => {
  // A source citation opens on this device. It must never launch Zotero on the
  // Mac or lose its page while substituting the work's metadata dossier.
  if (method === 'openEvidenceAtPage') return async (id: string, locator: string | {pageNumber?: number | null; location?: string | null; sourceRef?: string | null} | null) => {
    const page = typeof locator === 'string' ? parsePageNumber(locator) : locator?.pageNumber ?? parsePageNumber(locator?.location ?? locator?.sourceRef ?? '');
    return {ok:true,mode:'local',page,local:{itemId:id,scope:'vault'}};
  };
  if (method.startsWith('on')) return (listener: (...args: unknown[]) => void) => {
    const bucket = subscriptions.get(method) ?? new Set(); bucket.add(listener); subscriptions.set(method, bucket);
    return () => bucket.delete(listener);
  };
  if (method === 'startDictionaryGeneration' && native.nodusMobileConfig.executionMode === 'autonomous') return (request: Parameters<typeof autonomousDictionary>[2]) => autonomousDictionary(call, progress => { for (const listener of subscriptions.get('onDictionaryProgress') ?? []) listener(progress); if (['done','degraded'].includes(progress.phase)) for (const listener of subscriptions.get('onDictionaryChanged') ?? []) listener(null); }, request);
  if (method === 'generateContentTranslation' && native.nodusMobileConfig.executionMode === 'autonomous') return (request: Parameters<typeof autonomousTranslation>[1]) => autonomousTranslation(call, request, () => {for (const listener of subscriptions.get('onContentTranslationsChanged') ?? []) listener(request.entityKind,request.entityId);});
  if (method === 'scanDictionaryNewEvidence' && native.nodusMobileConfig.executionMode === 'autonomous') return async (entryId: string) => {
    const detail = await call('scanDictionaryMobileEvidence', entryId);
    for (const listener of subscriptions.get('onDictionaryChanged') ?? []) listener(entryId);
    return detail;
  };
  if (method === 'buildImmersionScope' && native.nodusMobileConfig.executionMode === 'autonomous') return async (request: unknown) => (await call('getImmersionGenerationContext', request)).scope;
  if (method === 'generateImmersionSession' && native.nodusMobileConfig.executionMode === 'autonomous') return (request: Parameters<typeof autonomousImmersion>[1], handlers: {onProgress?: Parameters<typeof autonomousImmersion>[2]} = {}) => autonomousImmersion(call, request, handlers.onProgress ?? (()=>{}));
  if (native.nodusMobileConfig.executionMode === 'autonomous' && ['listModels','getModelCatalog'].includes(method)) return async (provider: Parameters<typeof mobileModelInformation>[0]) => {
    const result=await call(method,provider);
    return Array.isArray(result)?mobileModelInformation(provider,result):{...result,models:mobileModelInformation(provider,result.models??[]),selectableModels:mobileModelInformation(provider,result.selectableModels??[])};
  };
  if (method === 'cancelResearchChat') return () => activeChat && call('cancelLiveJob', activeChat);
  if (method === 'improveStudyText' && native.nodusMobileConfig.executionMode === 'autonomous') return (request: Parameters<typeof autonomousWriting>[1], handlers: {onDelta?:(text:string)=>void} = {}) => autonomousWriting(call,request,handlers.onDelta ?? (()=>{}));
  if (method === 'cancelStudyImprove') return () => native.nodusMobileConfig.executionMode === 'autonomous' ? cancelAutonomousWriting(call) : activeImprove && call('cancelLiveJob', activeImprove);
  if (method === 'exportDeepResearchArchive') return async (request: unknown, onProgress?: (done: number, total: number) => void) => {
    const id = crypto.randomUUID(); streamHandlers.set(id, { onProgress: onProgress ?? (() => {}) });
    try { return await call(method, id, request); } finally { streamHandlers.delete(id); }
  };
  if (streamMethods.has(method)) return async (request: unknown, handlers: Record<string, (...args: any[]) => void> = {}) => {
    const id = crypto.randomUUID(); streamHandlers.set(id, handlers);
    if (method === 'researchChatStream') activeChat = id;
    if (method === 'improveStudyText') activeImprove = id;
    try { const result = await call(method, id, request); handlers.onStats?.(result?.stats); return result; }
    finally { streamHandlers.delete(id); if (activeChat === id) activeChat = undefined; if (activeImprove === id) activeImprove = undefined; }
  };
  return (...args: unknown[]) => call(method, ...args);
} }) as typeof window.nodus;
function navigate(kind: string, id: string, location?: string | null, quote?: string) {
  void call('navigate', kind, id, {location:location ?? null,quote:quote ?? null}).catch(error => window.dispatchEvent(new ErrorEvent('error', { message: String(error) })));
}
window.addEventListener(OPEN_LIBRARY_DOCUMENT_EVENT, event => {
  const detail = (event as CustomEvent<OpenLibraryDocumentDetail>).detail;
  void call('openSourceDocument', detail).catch(error => window.dispatchEvent(new ErrorEvent('error', {message:String(error)})));
});
const openLibraryWork = (itemId: string, scope: 'global' | 'vault', page: number | null = null) => requestLibraryDocumentOpen({itemId,scope,page});
const config = native.nodusMobileConfig;
setActiveLang(config.language);
document.documentElement.classList.toggle('dark', config.theme === 'dark');
document.documentElement.classList.toggle('light', config.theme !== 'dark');
document.documentElement.classList.add(config.vaultType);
document.documentElement.classList.toggle('nodus-phone', config.device === 'phone');
document.documentElement.style.setProperty('--mobile-accent', config.accent);
document.documentElement.style.setProperty('--vault-accent', config.accent);
document.documentElement.style.fontSize = `${16 * config.textScale}px`;
document.documentElement.style.setProperty('--nodus-mobile-text-scale', String(config.textScale));
installMobileKeyboard(document);

document.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.target.blur();
});

async function offlineGraph(): Promise<GraphData> {
  const snapshot = await call('snapshot');
  const tables = snapshot.tables;
  const themes = new Map((tables.themes ?? []).map((row: any) => [row.theme_id, row.name ?? row.label]));
  const works = new Map<string, Set<string>>(), labels = new Map<string, Set<string>>();
  for (const occurrence of tables.idea_occurrences ?? []) {
    const group = works.get(occurrence.global_id) ?? new Set<string>(); group.add(occurrence.nodus_id); works.set(occurrence.global_id, group);
  }
  for (const link of tables.idea_theme_links ?? []) {
    const group = labels.get(link.global_id) ?? new Set<string>(); group.add(String(themes.get(link.theme_id) ?? link.theme_id)); labels.set(link.global_id, group);
  }
  return { nodes: (tables.ideas ?? []).map((idea: any) => ({ id: idea.global_id, label: idea.label ?? idea.statement, statement: idea.statement, type: idea.type,
    workIds: [...(works.get(idea.global_id) ?? [])], workCount: works.get(idea.global_id)?.size ?? 0, themes: [...(labels.get(idea.global_id) ?? [])], read: false, years: [], authors: [], maxConfidence: Number(idea.confidence ?? 0) })),
    edges: (tables.edges ?? []).map((edge: any) => ({ id: edge.id, source: edge.from_id, target: edge.to_id, type: edge.type, basis: edge.basis, confidence: edge.confidence })) };
}
const source: StellarGraphSource = config.live ? {
  key: 'mobile-live', readOnly: true, page: request => call('stellarPage', request), themes: () => call('stellarThemes'),
  idea: id => call('getIdeaDetail', id), edge: id => call('getEdgeDetail', id),
} : { ...memorySource('mobile-local', offlineGraph), readOnly: true };

function SurfaceIssue({issue,title}: {issue: string; title?: string}) {
  const denied = /permission_denied|operation_forbidden|does not grant access/i.test(issue);
  return <div role="alert" className="mobile-error"><div>{title && <strong>{title}</strong>}<p>{denied ? t('La conexión actual no permite acceder a este vault. Renueva la vinculación en Ajustes.') : issue}</p>
    {denied && <details><summary>{t('Detalles')}</summary><p>{issue}</p></details>}</div><button onClick={() => location.reload()}>{t('Reintentar')}</button></div>;
}

function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState('');
  const [jobError, setJobError] = useState('');
  useEffect(() => {
    if (config.surface !== 'graph' || ['estudio','docencia'].includes(config.vaultType)) void call('getSettings').then(setSettings).catch(error => setError(String(error)));
    const listener = (event: ErrorEvent) => setError(event.message);
    window.addEventListener('error', listener); return () => window.removeEventListener('error', listener);
  }, []);
  useEffect(() => {
    if (!config.live || config.executionMode !== 'live' || !['dictionary', 'deepResearch'].includes(config.surface)) return;
    let active = true;
    let revision: string | undefined;
    let polling = false;
    const method = config.surface === 'dictionary' ? 'listDictionaryGenerationJobs' : 'listDeepResearchJobs';
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void call(method).then(jobs => {
      if (!active) return;
      setJobError('');
      const nextRevision = JSON.stringify(jobs);
      if (revision === nextRevision) return;
      revision = nextRevision;
      if (config.surface === 'dictionary') {
        for (const job of jobs) for (const listener of subscriptions.get('onDictionaryProgress') ?? []) listener(job);
        for (const listener of subscriptions.get('onDictionaryChanged') ?? []) listener(null);
      } else {
        for (const listener of subscriptions.get('onDeepResearchQueue') ?? []) listener(jobs);
        for (const listener of subscriptions.get('onWritingDraftsChanged') ?? []) listener(null);
      }
    }).catch(error => { if (active) setJobError(String(error)); }).finally(() => { polling = false; }); }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <main className="mobile-surface" data-surface={config.surface}>
    {error && <SurfaceIssue issue={error} />}
    {jobError && <SurfaceIssue issue={jobError} title={t('Estado de los trabajos')} />}
    {config.surface === 'graph' && ['estudio','docencia'].includes(config.vaultType)
      ? !settings ? <div role="status" className="mobile-loading">Cargando Nodus…</div>
        : <StudyGraphView mobile settings={settings} onSettingsChange={()=>{void call('getSettings').then(setSettings);}}
            onFullscreenChange={enabled=>call('surfaceFullscreen',enabled)}
            onOpenMaterial={id=>navigate('studyMaterial',id)} onOpenDocument={id=>navigate('studyDocument',id)}
            onOpenEvidence={(kind,id,location,quote)=>navigate(kind==='material'?'studyMaterial':'studyDocument',id,location,quote)}/>
      : config.surface === 'graph' ? <StellarWorkspace source={source} title="Grafo" onFullscreenChange={enabled => call('surfaceFullscreen', enabled)} onOpenIdea={id => navigate('idea', id)} openEvidence={(id) => navigate('work', id)}/>
      : !settings ? <div role="status" className="mobile-loading">Cargando Nodus…</div>
      : config.surface === 'dictionary' ? <DictionaryView mobile settings={settings} onOpenIdea={id => navigate('idea', id)} onOpenAuthor={id => navigate('author', id)} onOpenLibraryWork={openLibraryWork}/>
      : config.surface === 'workspace' ? <WorkspaceView settings={settings}/>
      : config.surface === 'deepResearch' ? <DeepResearchView mobile settings={settings} onFullscreenChange={enabled => call('surfaceFullscreen', enabled)} isGenealogy={config.vaultType === 'genealogy'} isStudy={config.vaultType === 'estudio'} isTeaching={config.vaultType === 'docencia'} onOpenLibraryWork={openLibraryWork}/>
      : config.surface === 'immersion' ? <ImmersionView settings={settings} onOpenLibraryWork={openLibraryWork}/>
      : config.surface === 'chat' ? <ResearchAssistantModal settings={settings} embedded isAcademic={config.vaultType === 'academic'} isGenealogy={config.vaultType === 'genealogy'}/>
      : <ArgumentMapView settings={settings}/>}
    <FeedbackHost/>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
