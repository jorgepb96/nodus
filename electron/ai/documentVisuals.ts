import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { type DocumentSkillPolicy, type DocumentVisualManifest, type DocumentVisualTarget } from '../../shared/documentSkills';
import { enrichPortableDocumentVisuals, preparePortableDocumentVisualHints } from '../../shared/portableDocumentVisuals';
import { researchVisualFields, immersionVisualFields } from '../../shared/documentVisualContent';
import type { ModelRef } from '../../shared/types';
import { getWritingWorkshopDraft } from '../db/writingDraftsRepo';
import { getImmersionSession } from '../db/immersionRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { listDocumentSkills } from '../capabilities/documentCatalog';
import { capabilityRegistry, pinCapabilitiesForTurn } from '../capabilities/registry';
import { executeSkillResources } from '../capabilities/resourceExecution';
import { readDocumentVisuals, readDocumentVisualUsage, retainPreviousVisuals, visualContentHash, writeDocumentVisuals, undoDocumentVisuals } from '../capabilities/documentStore';
import { snapshotDocumentFigure } from '../capabilities/documentSnapshot';
import { chatAssetOwner, chatAssetVersion } from '../chatAssets';
import { documentVisualModelKey, resolveDocumentVisualModel, type DocumentVisualEnrichOptions } from '../../shared/documentVisualEnrich';
import { getSettings } from '../db/settingsRepo';
import { completeJson, completeText } from './aiClient';
import { logPipelineFailure, logPipelineInfo, logPipelineWarning } from '../logging/pipelineLogCore';

const running = new Map<string, AbortController>();
const keyFor = (target: DocumentVisualTarget) => JSON.stringify([getActiveVault().id, target.kind, target.id]);
export function visualDocumentInput(target: DocumentVisualTarget) {
  if (!target || !['deep-research', 'immersion'].includes(target.kind) || typeof target.id !== 'string') throw new Error('Invalid document.');
  if (target.kind === 'deep-research') {
    const saved = getWritingWorkshopDraft(target.id); if (!saved) throw new Error('Document no longer exists.');
    return { title: saved.draft.title, language: saved.draft.brief.language || 'en', model: saved.model, fields: researchVisualFields(saved.draft) };
  }
  const saved = getImmersionSession(target.id); if (!saved) throw new Error('Document no longer exists.');
  return { title: saved.plan.title, language: saved.plan.language, model: saved.model, fields: immersionVisualFields(saved.plan) };
}
export function getDocumentVisuals(target: DocumentVisualTarget): DocumentVisualManifest | null {
  const input = visualDocumentInput(target);
  const manifest = readDocumentVisuals(getActiveVault().id, target);
  if (manifest && ['planning', 'generating'].includes(manifest.state) && !running.has(keyFor(target))) {
    manifest.state = 'cancelled';
    for (const figure of manifest.figures) if (figure.state === 'running') { figure.state = 'failed'; figure.error = 'Interrupted request; retry explicitly.'; }
    writeDocumentVisuals(manifest);
  }
  return manifest?.contentHash === visualContentHash(input.fields) ? manifest : null;
}
const notify = (target: DocumentVisualTarget) => BrowserWindow.getAllWindows().forEach(win => { if (!win.isDestroyed()) win.webContents.send('documentVisuals:changed', target); });

export function isDocumentVisualRunning(target: DocumentVisualTarget): boolean { return running.has(keyFor(target)); }
export function cancelDocumentVisuals(target: DocumentVisualTarget): void { running.get(keyFor(target))?.abort(); }
export function undoVisualEnrichment(target: DocumentVisualTarget): DocumentVisualManifest | null {
  if (running.has(keyFor(target))) throw new Error('Cancel the current visual task first.');
  visualDocumentInput(target);
  const restored = undoDocumentVisuals(getActiveVault().id, target); notify(target); return restored;
}
export function removeDocumentFigure(target: DocumentVisualTarget, figureId: string): DocumentVisualManifest | null {
  if (running.has(keyFor(target))) throw new Error('Cancel the current visual task first.');
  const manifest = getDocumentVisuals(target); if (!manifest) return null;
  retainPreviousVisuals(manifest.vaultId, target);
  manifest.figures = manifest.figures.filter(figure => figure.id !== figureId);
  manifest.revision = randomUUID(); writeDocumentVisuals(manifest); notify(target); return manifest;
}

/** Early opportunities are optional, cheap and do not execute a skill. */
export async function prepareDocumentVisualHints(policy: DocumentSkillPolicy | undefined, objective: string, model?: ModelRef | null, signal?: AbortSignal): Promise<string[]> {
  return preparePortableDocumentVisualHints({ catalog: listDocumentSkills, completeJson, flushPersist: async () => {} }, policy, objective, model, signal);
}

/** Trusted invocation-local journaling; never accepted from IPC request data. */
export interface DocumentVisualRuntime {
  completion?: <T>(kind:'text'|'json'|'resources', input: {options:Omit<import('./aiClient').CallOpts,'signal'>;model?:ModelRef|null}, invoke:()=>Promise<T>)=>Promise<T>;
}
export async function enrichDocumentVisuals(target: DocumentVisualTarget, policy: DocumentSkillPolicy, request: DocumentVisualEnrichOptions & { hints?: string[]; signal?: AbortSignal } = {}, runtime:DocumentVisualRuntime = {}): Promise<DocumentVisualManifest> {
  const key = keyFor(target);
  if (running.has(key)) throw new Error('This document already has a visual task.');
  const input = visualDocumentInput(target), vaultId = getActiveVault().id;
  // Resolved once, before any call: every planning and figure call in a run must run on
  // the same engine, and the reader must be able to see which one from the log if it fails.
  const settings = getSettings();
  const model = resolveDocumentVisualModel({
    requested: request.model,
    configured: settings[documentVisualModelKey(target.kind)],
    general: settings.synthesisModel,
    stored: input.model,
  });
  const previous = getDocumentVisuals(target);
  const controller = new AbortController();
  const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
  running.set(key, controller);
  try {
    return await enrichPortableDocumentVisuals(target, policy, {
      input, vaultId, model, catalog: listDocumentSkills, previous, usage: readDocumentVisualUsage(vaultId, target),
      registryPins: () => ({ registry: capabilityRegistry(), pins: pinCapabilitiesForTurn() }),
      contentHash: visualContentHash,
      current: manifest => {
        if (getActiveVault().id !== vaultId) return false;
        try { return visualContentHash(visualDocumentInput(target).fields) === manifest.contentHash && readDocumentVisuals(vaultId, target)?.revision === manifest.revision; } catch { return false; }
      },
      persist: writeDocumentVisuals, flushPersist: async () => {},
      retainPrevious: () => retainPreviousVisuals(vaultId, target), notify,
      completeJson: (options, guard, chosen) => {
        const {signal: _signal, ...safe} = options;
        return runtime.completion ? runtime.completion('json',{options:safe,model:chosen},()=>completeJson(options,guard,chosen)) : completeJson(options,guard,chosen);
      },
      completeText: (options, chosen) => {
        const {signal: _signal, ...safe} = options;
        return runtime.completion ? runtime.completion('text',{options:safe,model:chosen},()=>completeText(options,chosen)) : completeText(options,chosen);
      }, executeResources: (answer,execution,signal) => runtime.completion
        ? runtime.completion('resources',{options:{system:'Canonical document resource execution',user:JSON.stringify({answer,owner:execution.owner,version:execution.version,question:execution.question,locale:execution.locale}),maxTokens:0},model},()=>executeSkillResources(answer,execution,signal))
        : executeSkillResources(answer,execution,signal), snapshot: snapshotDocumentFigure,
      owner: chatAssetOwner, assetVersion: chatAssetVersion,
      clock: () => new Date().toISOString(), id: randomUUID,
      logPipelineInfo, logPipelineWarning, logPipelineFailure,
    }, { ...request, signal });
  } finally { running.delete(key); }
}
