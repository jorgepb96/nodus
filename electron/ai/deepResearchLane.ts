import { enrichDocumentVisuals } from './documentVisuals';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { nodiText } from '@shared/nodiNotifications';
import { openDbPath, scopedDbPath, withVaultDatabase, withoutDatabaseContext } from '../db/database';
import { withMobileOperation, withDesktopOperation } from '../desktopBridge/executionBoundary';
import { saveWritingWorkshopDraft } from '../db/writingDraftsRepo';
import { deleteCompleteGuideRun, saveCompleteGuideArtifacts } from '../db/completeGuideRepo';
import { seedCompleteGuideFigures } from './completeGuide/figures';
import { applyDecorativeImageOption } from './decorativeImages';
import { localizedForUi } from '../ipc/context';
import { addNotification } from '../notifications';
import { getActiveVault, listVaults, withOwningVault, withoutOwningVault } from '../vaults/vaultRegistry';
import { generateDeepResearchReport } from './deepResearch';
import {
  configureDeepResearchQueue,
  type DeepResearchPersistedJob,
  type DeepResearchJobRecord,
  type DeepResearchQueueVault,
} from './deepResearchQueue';

// ─────────────────────────────────────────────────────────────────────────────
// Binds the pure queue in ./deepResearchQueue to the real generator, database and
// app window. Kept apart from the queue itself so the lane's logic stays testable
// without Electron, and separate from both callers (IPC and MCP) so neither owns
// the wiring — whichever runs first sets it up.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The vault a job is bound to is the corpus that is really open, not whatever the
 * registry lists as active: a second Nodus instance can switch the registry while
 * this process still holds the previous database, and a job bound to the registry
 * would then be cancelled for a change that never happened here.
 */
function servingVault(): DeepResearchQueueVault {
  const registryActive = getActiveVault();
  const open = scopedDbPath() ?? openDbPath();
  if (!open) return { id: registryActive.id, name: registryActive.name };
  const match = listVaults().find((vault) => path.resolve(vault.path) === path.resolve(open));
  return match ? { id: match.id, name: match.name } : { id: registryActive.id, name: registryActive.name };
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function queueFile(): string {
  return path.join(app.getPath('userData'), 'deep-research-queue.v1.json');
}

function loadDurableQueue(): DeepResearchPersistedJob[] {
  try {
    const decoded: unknown = JSON.parse(fs.readFileSync(queueFile(), 'utf8'));
    return Array.isArray(decoded) ? decoded as DeepResearchPersistedJob[] : [];
  } catch {
    return [];
  }
}

function persistDurableQueue(jobs: DeepResearchPersistedJob[]): void {
  const file = queueFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(jobs), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

/**
 * A report asked for over MCP finishes with nobody watching: the client that queued
 * it may have disconnected (MCP sessions expire), and the window may be on another
 * view entirely. The notification centre is what stops it being invisible work that
 * quietly spent tokens.
 */
function announce(job: DeepResearchJobRecord): void {
  if (job.origin !== 'mcp') return;
  if (job.status === 'completed') {
    addNotification({
      title: nodiText('deepResearchMcpDoneTitle'),
      body: nodiText('deepResearchMcpDoneBody', { title: job.title }),
      kind: 'success',
      dedupeKey: `deep-research-mcp:${job.id}`,
    });
  } else if (job.status === 'failed') {
    addNotification({
      title: nodiText('deepResearchMcpFailedTitle'),
      body: nodiText('deepResearchMcpFailedBody', { title: job.title }),
      kind: 'warning',
      dedupeKey: `deep-research-mcp:${job.id}`,
    });
  }
}

let configured = false;

/** Idempotently wires the queue. Called by every entry point before it enqueues. */
export function ensureDeepResearchLane(): void {
  if (configured) return;
  configured = true;
  configureDeepResearchQueue({
    runDesktop: work => withDesktopOperation(() => withoutDatabaseContext(() => withoutOwningVault(work))),
    executionVault: servingVault,
    runMobile: (vault, work) => withoutDatabaseContext(() => withOwningVault(vault.id, () => withVaultDatabase(vault.id, () => withMobileOperation(work)))),
    generate: (request, onProgress, signal) => generateDeepResearchReport(request, onProgress, signal),
    saveDraft: ({ report, request, title }) => {
      const saved = saveWritingWorkshopDraft({
        draft: report.draft,
        model: report.draft.generationModel ?? request.model ?? null,
        title: title ?? undefined,
        decorativeImage: request.decorativeImage,
      });
      // The durable report lands before optional image generation starts. Every
      // window can refresh the gallery immediately and receives the later image.
      broadcast('writing:saved:changed', null);
      // A complete study guide's evidence sidecar stays on this machine; once it is
      // stored, the run's checkpoints are no longer needed (the reading cache stays).
      if (report.completeGuideArtifacts && report.draft.completeGuide) {
        try {
          saveCompleteGuideArtifacts(saved.id, report.draft.completeGuide.runId, report.completeGuideArtifacts);
          deleteCompleteGuideRun(report.draft.completeGuide.runId);
          // Kept out of the in-memory job (and MCP job payloads) once it is on disk.
          delete report.completeGuideArtifacts;
          if (report.completeGuideFigures) {
            const { figures, siblings } = report.completeGuideFigures;
            if (seedCompleteGuideFigures(saved.id, figures, (itemId) => siblings[itemId] ?? [])) broadcast('documentVisuals:changed', { kind: 'deep-research', id: saved.id });
            delete report.completeGuideFigures;
          }
        } catch (error) {
          console.warn('[complete guide] evidence sidecar not stored', error);
        }
      }
      const image = applyDecorativeImageOption('deep_research', saved.id, request.decorativeImage, (next) => {
        broadcast('images:changed', localizedForUi(next));
      });
      if (image) broadcast('images:changed', localizedForUi(image));
      return saved.id;
    },
    enrichSaved: (id, report, request, signal) => enrichDocumentVisuals({ kind: 'deep-research', id }, request.documentSkills!, { hints: report.draft.documentVisualHints, model: report.draft.generationModel, signal }),
    activeVault: () => withoutDatabaseContext(() => withoutOwningVault(servingVault)),
    load: loadDurableQueue,
    persist: persistDurableQueue,
    onChange: (all) => broadcast('research:deep:queue', all),
    onSettled: announce,
  });
}

/** Test-only teardown so a suite can rewire the lane. Never called in production. */
export function __resetDeepResearchLaneForTest(): void {
  configured = false;
}
