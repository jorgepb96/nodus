import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { MOBILE_OPERATIONS, type MobileOperation } from '../../shared/mobileOperations';
import { withVaultDatabase, getDb } from '../db/database';
import { withOwningVault } from '../vaults/vaultRegistry';
import { invalidateLiveCorpus } from './liveCorpus';
import { withGenerationSignal } from '../ai/generationSignal';
import { withMobileOperation } from './executionBoundary';
import { MOBILE_EXPORT_METHODS, renderMobileExport } from './exports';
import { listGlobalLibraryVaultLinks } from '../library/libraryService';
import { BridgeJobCancelledError } from './jobs';

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

export async function executeMobileOperation(vaultId: string, domains: readonly string[], method: string, args: unknown[], events?: (channel: string, ...args: unknown[]) => void, signal?: AbortSignal, bridgeJobId?: string, mayHaveStarted?: boolean): Promise<unknown> {
  authorizeMobileOperation(domains, method);
  const [channel, permission] = MOBILE_OPERATIONS[method as MobileOperation];
  if (!domains.includes(permission)) throw new Error('permission_denied');
  if (!Array.isArray(args) || args.length > 12) throw new Error('invalid_arguments');
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
  const event = { mobileBridgeJobId: bridgeJobId, mobileBridgeRecovery: mayHaveStarted, sender: { id: -1, isDestroyed: () => false, send: (channel: string, ...args: unknown[]) => events?.(channel, ...args) } } as unknown as IpcMainInvokeEvent;
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
    const invoke = () => withMobileOperation(() => handler(event, ...args));
    let value = await (signal ? withGenerationSignal(signal, invoke) : invoke());
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
    if (method === 'listDictionaryGenerationJobs' && Array.isArray(value)) return value.filter(job => getDb().prepare('SELECT 1 FROM dictionary_entries WHERE id=?').get(job.entryId));
    return value;
  }));
  if (permission !== 'corpus') invalidateLiveCorpus(vaultId);
  return method === 'getSettings' ? portableSettings(result) : result;
}
