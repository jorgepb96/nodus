import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { MOBILE_OPERATIONS, type MobileOperation } from '../../shared/mobileOperations';
import { withVaultDatabase, getDb } from '../db/database';
import { withOwningVault } from '../vaults/vaultRegistry';
import { invalidateLiveCorpus } from './liveCorpus';
import { withGenerationSignal } from '../ai/generationSignal';
import { withMobileOperation } from './executionBoundary';
import {runCompanionSpaceAction} from './spaceActions';
import {mobileAcademicSource,saveMobileAcademicResult,listSavedCompanionArgumentMaps,savedCompanionLiveArgumentMap,saveCompanionLiveArgumentMap} from './academicGeneration';
import {buildArgumentMap} from '../ai/argumentMap';
import {PROMPT_LANGUAGES,type PromptLanguage,type ArgumentMapRequest} from '../../shared/types';
import { MOBILE_EXPORT_METHODS, renderMobileExport } from './exports';
import { listGlobalLibraryVaultLinks } from '../library/libraryService';
import { BridgeJobCancelledError } from './jobs';
import { emptyImmersionProgress } from '../db/immersionRepo';
import {mobileDossierFiles} from './dossierFiles';
import {mobileWorldMapReadSource} from './worldMapRead';
import {mobileDatabaseRowLocation} from './databaseRowLocation';
import {mobilePageDocument} from './pageDocuments';
import {mobileSyncedBlockSource,mobileLinkedDatabaseRead} from './pageDependencies';

type Handler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown;
const allowedChannels = new Set(Object.values(MOBILE_OPERATIONS).map(([channel]) => channel));
const handlers = new Map<string, Handler>();
export function authorizeMobileOperation(domains: readonly string[], method: string): void {
  if (!Object.hasOwn(MOBILE_OPERATIONS, method)) throw new Error('operation_forbidden');
  if (!domains.includes(MOBILE_OPERATIONS[method as MobileOperation][1])) throw new Error('permission_denied');
}

/** Retain only the explicitly shared handlers; this is not a remote IPC endpoint. */
export function registerMobileOperation(channel: string, handler: Handler): void {
  if (allowedChannels.has(channel as never)) handlers.set(channel, handler);
}

function portableSettings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(portableSettings);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(token|password|secret|api.?key|encryption|privatekey)/i.test(key)).map(([key, child]) => [key, portableSettings(child)]));
}

export async function executeMobileOperation(vaultId: string, domains: readonly string[], method: string, args: unknown[], events?: (channel: string, ...args: unknown[]) => void, signal?: AbortSignal, bridgeJobId?: string, mayHaveStarted?: boolean,jobIdentity?:{deviceGrant:string;idempotencyKey:string}): Promise<unknown> {
  authorizeMobileOperation(domains, method);
  const [channel, permission] = MOBILE_OPERATIONS[method as MobileOperation];
  if (!domains.includes(permission)) throw new Error('permission_denied');
  if (!Array.isArray(args) || args.length > 12) throw new Error('invalid_arguments');
  if(method==='buildArgumentMap'&&bridgeJobId&&domains.includes('writing')){
    if(args.length!==1||!args[0]||typeof args[0]!=='object')throw new Error('invalid_argument_source');
    const request=args[0] as ArgumentMapRequest;
    const invoke=async()=>withMobileOperation(async()=>{
      signal?.throwIfAborted();
      if(request.mode!=='auto'){const saved=savedCompanionLiveArgumentMap(bridgeJobId);if(saved)return saved;}
      const map=await buildArgumentMap(request,request.model);signal?.throwIfAborted();
      return request.mode==='auto'?map:saveCompanionLiveArgumentMap(bridgeJobId,args,map);
    },domains);
    return withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>signal?withGenerationSignal(signal,invoke):invoke()));
  }
  if(method==='getMobileStructuralArgumentMap'){
    const value=args[0] as {seedIdeaId?:string;language?:PromptLanguage}|undefined;
    if(args.length!==1||!value||Object.keys(value).some(key=>!['seedIdeaId','language'].includes(key))||typeof value.seedIdeaId!=='string'||!value.seedIdeaId||value.seedIdeaId.length>256||value.language!=null&&!(PROMPT_LANGUAGES as readonly unknown[]).includes(value.language))throw new Error('invalid_argument_source');
    return withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>withMobileOperation(()=>buildArgumentMap({seedIdeaId:value.seedIdeaId!,language:value.language,mode:'auto'}),domains)));
  }
  if(method==='listSavedCompanionArgumentMaps'){
    if(args.length>2)throw new Error('invalid_arguments');
    return withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>withMobileOperation(()=>listSavedCompanionArgumentMaps(args[0] as string|null|undefined,args[1] as number|undefined),domains)));
  }
  if(method==='getMobileAcademicSource'||method==='saveMobileAcademicResult'){
    if(args.length!==1)throw new Error('invalid_arguments');
    if(method==='saveMobileAcademicResult'&&(!bridgeJobId||!jobIdentity))throw new Error('job_required');
    const invoke=()=>{signal?.throwIfAborted();return withMobileOperation(()=>method==='getMobileAcademicSource'?mobileAcademicSource(args[0]):saveMobileAcademicResult(args[0]),domains);};
    const result=await withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>signal?withGenerationSignal(signal,invoke):invoke()));
    if(method==='saveMobileAcademicResult')invalidateLiveCorpus(vaultId);return result;
  }
  if(method==='runMobileSpaceAction'){
    if(args.length!==1||!bridgeJobId||!jobIdentity)throw new Error('job_required');
    return runCompanionSpaceAction(vaultId,domains,args[0],bridgeJobId,signal);
  }
  if (method === 'getMobileDossierFiles') {
    if (args.length !== 1) throw new Error('invalid_arguments');
    return withOwningVault(vaultId, () => withVaultDatabase(vaultId, () => mobileDossierFiles(vaultId, domains, args[0])));
  }
  if (method === 'getMobileWorldMapReadSource') {
    if (args.length !== 1) throw new Error('invalid_arguments');
    return withOwningVault(vaultId, () => withVaultDatabase(vaultId, () => mobileWorldMapReadSource(vaultId, args[0])));
  }
  if (method === 'getMobileDatabaseRowLocation') {
    if (args.length !== 1) throw new Error('invalid_arguments');
    return withOwningVault(vaultId, () => withVaultDatabase(vaultId, () => mobileDatabaseRowLocation(vaultId, args[0])));
  }
  if (method === 'getMobilePageDocument') {
    if (args.length !== 1) throw new Error('invalid_arguments');
    return withOwningVault(vaultId, () => withVaultDatabase(vaultId, () => mobilePageDocument(vaultId, args[0])));
  }
  if (['getMobileSyncedBlockSource','getMobileLinkedDatabaseRead'].includes(method)) {
    if(args.length!==1)throw new Error('invalid_arguments');
    return withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>method==='getMobileSyncedBlockSource'?mobileSyncedBlockSource(vaultId,args[0]):mobileLinkedDatabaseRead(vaultId,args[0])));
  }
  if (method === 'updateStudyEntity' && args[0] !== 'folder') throw new Error('operation_forbidden');
  if (['getContentTranslationOfflineSource', 'getContentTranslationGenerationContext', 'generateContentTranslation',
    'beginContentTranslationOnMobile', 'saveContentTranslationFromMobile', 'failContentTranslationOnMobile'].includes(method)) {
    const first = args[0] as {entityKind?: unknown; request?: {entityKind?: unknown}} | undefined;
    const kind = method === 'saveContentTranslationFromMobile' ? first?.request?.entityKind : first?.entityKind;
    if (kind === 'study_transcript' && !domains.includes('study-recordings')) throw new Error('permission_denied');
  }
  if (method === 'listAudioClips') {
    const kinds = ['deep_research', 'immersion', 'study_document', 'study_transcript', 'study_assistant', 'study_subject', 'study_question'];
    if (args.length !== 2 || !kinds.includes(String(args[0])) || typeof args[1] !== 'string' || !args[1] || args[1].length > 1024) throw new Error('invalid_arguments');
    if (args[0] === 'study_transcript' && !domains.includes('study-recordings')) throw new Error('permission_denied');
  }
  if (MOBILE_EXPORT_METHODS.has(method)) return withOwningVault(vaultId, () => withVaultDatabase(vaultId, () => withMobileOperation(() => renderMobileExport(vaultId, method, args, events))));
  const handler = handlers.get(channel);
  if (!handler) throw new Error('operation_unavailable');
  if (method === 'updateSettings') {
    const patch = args[0];
    const permitted = new Set(['modelSettingsMode', 'dictionaryModel', 'deepResearchModel', 'chatModel', 'argumentMapModel', 'synthesisModel', 'studyModel', 'improveModel', 'immersionModel', 'writingModel', 'researchThinkingEffort', 'researchEffortByModel', 'researchWebSearch']);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !permitted.has(key))) throw new Error('settings_forbidden');
    if ('modelSettingsMode' in patch && !['basic', 'advanced'].includes(String(patch.modelSettingsMode))) throw new Error('settings_forbidden');
  }
  if (method === 'cancelDeepResearchJob') {
    const listing = handlers.get('research:deep:queue:list');
    const jobs = await listing?.({} as IpcMainInvokeEvent) as Array<{ id: string; vaultId: string }>;
    if (!jobs?.some(job => job.id === args[0] && job.vaultId === vaultId)) throw new Error('permission_denied');
  }
  // The native renderer-specific helpers are deliberately unavailable here. Streaming
  // engines may emit progress, but never receive another renderer's identity or capabilities.
  const event = { mobileBridgeJobId: bridgeJobId, mobileBridgeRecovery: mayHaveStarted, mobileBridgeDeviceGrant:jobIdentity?.deviceGrant,mobileBridgeIdempotencyKey:jobIdentity?.idempotencyKey, sender: { id: -1, isDestroyed: () => false, send: (channel: string, ...args: unknown[]) => events?.(channel, ...args) } } as unknown as IpcMainInvokeEvent;
  const result = await withOwningVault(vaultId, () => withVaultDatabase(vaultId, async () => {
    if (method === 'listGlobalLibraryItems') {
      const query = args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] as Record<string, unknown> : {};
      const { vaultIds: _untrustedVaultIds, ...filters } = query;
      args = [{ ...filters, vaultId }];
    }
    if (method === 'getGlobalLibraryItem' || method === 'getLibraryReaderDocument') {
      const id = String(args[0] ?? '');
      const work = getDb().prepare('SELECT 1 FROM works WHERE nodus_id=?').get(id);
      if (!work && !listGlobalLibraryVaultLinks(id).some(link => link.vaultId === vaultId)) throw new Error('permission_denied');
    }
    const invoke = () => withMobileOperation(() => handler(event, ...args), domains);
    let value = await (signal ? withGenerationSignal(signal, invoke) : invoke());
    if (method === 'getImmersionSession' && !domains.includes('writing') && value && typeof value === 'object') {
      value = {...value, progress: emptyImmersionProgress()};
    }
    if (method === 'listAudioClips' && Array.isArray(value)) {
      value = value.map(clip => ({...clip, fileName: path.basename(String(clip.fileName ?? ''))}));
    }
    if (method === 'enqueueDeepResearchJob' && value && typeof value === 'object') {
      const id = (value as { id?: string }).id;
      if (!id) throw new Error('invalid_research_job');
      const list = handlers.get('research:deep:queue:list')!, cancel = handlers.get('research:deep:queue:cancel')!;
      let revision = '';
      const abort = () => { void cancel(event, id); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        for (;;) {
          if (signal?.aborted) abort();
          const records = await list(event) as Array<{ id: string; vaultId: string; status: string; savedDraftId: string | null; error: string | null; saveError: string | null }>;
          const record = records.find(item => item.id === id && item.vaultId === vaultId);
          if (!record) throw new Error('research_job_unavailable');
          const next = JSON.stringify(record);
          if (next !== revision) { events?.('mobile:deepResearch:progress', record); revision = next; }
          if (record.status === 'cancelled') throw new BridgeJobCancelledError(record.error ?? record.status);
          if (record.status === 'failed') throw new Error(record.error ?? record.status);
          if (record.status === 'completed') {
            if (!record.savedDraftId) throw new Error(record.saveError ?? 'research_result_not_saved');
            value = record; break;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } finally { signal?.removeEventListener('abort', abort); }
    }
    if (method === 'listDeepResearchJobs' && Array.isArray(value)) return value.filter(job => job.vaultId === vaultId);
    if(method==='enqueueDatabaseDeepResearch'&&value&&typeof value==='object') {
      const id=(value as {id?:string}).id;if(!id) throw new Error('invalid_database_research_job');
      const get=handlers.get('db:deepResearch:job:get')!,cancel=handlers.get('db:deepResearch:job:cancel')!,report=handlers.get('db:deepResearch:report:get')!;
      let revision='',cancelling:Promise<unknown>|undefined;
      const abort=()=>{
        cancelling ??= Promise.resolve().then(()=>withOwningVault(vaultId,()=>withVaultDatabase(vaultId,()=>cancel(event,id))));
        void cancelling.catch(()=>{});
      };
      signal?.addEventListener('abort',abort,{once:true});
      try {
        for(;;) {
          if(signal?.aborted) {abort();await cancelling;}
          const job=await get(event,id) as {id:string;status:string;error?:string|null};
          if(!job||job.id!==id) throw new Error('database_research_job_unavailable');
          const next=JSON.stringify(job);if(next!==revision) {events?.('mobile:databaseResearch:progress',job);revision=next;}
          if(job.status==='cancelled') throw new BridgeJobCancelledError(job.error??job.status);
          if(['failed','stale'].includes(job.status)) throw new Error(job.error??job.status);
          if(['completed','partial'].includes(job.status)) {
            const saved=await report(event,id) as {id:string;runId:string}|null;
            if(!saved||saved.runId!==id||!saved.id) throw new Error('database_research_result_not_saved');
            value={...job,reportId:saved.id};break;
          }
          await new Promise(resolve=>setTimeout(resolve,500));
        }
      } finally {signal?.removeEventListener('abort',abort);}
    }
    if (method === 'listDictionaryGenerationJobs' && Array.isArray(value)) return value.filter(job => getDb().prepare('SELECT 1 FROM dictionary_entries WHERE id=?').get(job.entryId));
    return value;
  }));
  if (permission !== 'corpus') invalidateLiveCorpus(vaultId);
  return method === 'getSettings' ? portableSettings(result) : result;
}
