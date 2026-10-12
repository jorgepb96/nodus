import { assertAcademicAutomation, isManualAcademic } from '../ai/academicMode';
import type {
  DocumentIndexCampaign,
  DocumentIndexJob,
  DocumentIndexProgress,
  VaultSummary,
  Work,
} from '@shared/types';
import { getDb, withVaultDatabase } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { clearResolvedDocumentaryDeepErrors } from '../db/worksRepo';
import {
  claimNextDocumentIndexJob,
  cancelDocumentIndexJob,
  createDocumentIndexCampaign,
  documentProfileStatuses,
  enqueueDocumentIndexJob,
  listDocumentIndexCampaigns,
  listDocumentIndexJobs,
  recoverInterruptedDocumentJobs,
  requeueDocumentIndexJobForSourceChange,
  setDocumentCampaignStatus,
  setDocumentProfileState,
  updateDocumentIndexJob,
} from '../db/documentProfilesRepo';
import { getVault, listVaults } from '../vaults/vaultRegistry';
import { runDocumentProfileScan } from '../ai/documentProfile';
import { AiError } from '../ai/aiClient';
import { logPipelineFailure, logPipelineSuccess, logPipelineWarning, withPipelineLogScope } from '../logging/pipelineLogCore';
import { coalesce } from '../util/coalesce';
import { registerDocumentIndexMaintenanceController } from './documentIndexMaintenance';
import { compareDocumentIndexJobsForDisplay } from '@shared/documentIndexProgress';
import { DOCUMENT_INDEX_CONTINUOUS_AVAILABLE } from '@shared/documentIndexPolicy';
import { measurePerf } from '../perf';

type Listener = (progress: DocumentIndexProgress) => void;
const POLL_MS = 350;

function writable(vault: VaultSummary): boolean {
  return vault.type === 'academic'
    && (!vault.remote || (vault.remote.state === 'active' && vault.remote.role !== 'reader'));
}

class DocumentIndexQueue {
  private active = new Map<string, Promise<void>>();
  private controllers = new Map<string, {
    vaultId: string;
    jobId: string;
    campaignId: string | null;
    controller: AbortController;
  }>();
  private listeners = new Set<Listener>();
  private scheduled = false;
  private initialized = false;
  private stopping = false;
  private roundRobin = 0;
  private continuousTimer: ReturnType<typeof setInterval> | null = null;
  private maintenanceVaults = new Set<string>();
  private maintenancePaused = new Map<string, { campaignIds: string[]; standaloneJobIds: string[] }>();
  private maintenanceAll = false;
  /** Campaigns whose outcome has already been written to the processing log. */
  private summarizedCampaigns = new Set<string>();

  private emitter = coalesce(() => { void this.emitNow(); }, 250);

  onProgress(listener: Listener): () => void {
    this.listeners.add(listener);
    void this.snapshot().then(listener).catch(() => undefined);
    return () => this.listeners.delete(listener);
  }

  private emit(): void { this.emitter.schedule(); }

  private async emitNow(): Promise<void> {
    const progress = await this.snapshot();
    for (const listener of this.listeners) listener(progress);
  }

  async snapshot(): Promise<DocumentIndexProgress> {
    const campaigns: DocumentIndexCampaign[] = [];
    const jobs: DocumentIndexJob[] = [];
    let active = 0;
    let queued = 0;
    let failed = 0;
    for (const vault of listVaults().filter((item) => writable(item) && !this.maintenanceVaults.has(item.id))) {
      await withVaultDatabase(vault.id, () => {
        const vaultCampaigns = listDocumentIndexCampaigns();
        campaigns.push(
          ...vaultCampaigns.filter((campaign) => ['queued', 'running', 'paused'].includes(campaign.status)),
          ...vaultCampaigns.filter((campaign) => !['queued', 'running', 'paused'].includes(campaign.status)).slice(0, 100),
        );
        const vaultJobs = listDocumentIndexJobs();
        active += vaultJobs.filter((job) => job.status === 'running').length;
        queued += vaultJobs.filter((job) => job.status === 'queued' || job.status === 'paused').length;
        failed += vaultJobs.filter((job) => job.status === 'failed' || job.status === 'unavailable').length;
        // Campaign counters carry the exact corpus-wide totals. The renderer only
        // needs every running job plus a bounded activity sample; shipping thousands
        // of historical rows on every 250 ms progress tick would make the progress
        // UI itself the bottleneck in large vaults.
        jobs.push(
          ...vaultJobs.filter((job) => job.status === 'running'),
          ...vaultJobs.filter((job) => job.status === 'queued' || job.status === 'paused').slice(0, 120),
          ...vaultJobs.filter((job) => !['running', 'queued', 'paused'].includes(job.status)).slice(0, 80),
        );
      }).catch(() => undefined);
    }
    return {
      campaigns: campaigns.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      jobs: jobs.sort(compareDocumentIndexJobsForDisplay),
      active,
      queued,
      failed,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    for (const vault of listVaults().filter((item) => writable(item) && !this.maintenanceVaults.has(item.id))) {
      await withVaultDatabase(vault.id, async () => {
        recoverInterruptedDocumentJobs();
        clearResolvedDocumentaryDeepErrors();
        const settings = getSettings();
        if (!isManualAcademic() && DOCUMENT_INDEX_CONTINUOUS_AVAILABLE && settings.documentIndexingEnabled) {
          await this.ensureContinuousCampaignInside(vault.id, settings.documentIndexIncludeArchived);
        } else {
          for (const campaign of listDocumentIndexCampaigns().filter((item) =>
            item.mode === 'continuous' && ['queued', 'running'].includes(item.status)
          )) setDocumentCampaignStatus(campaign.campaignId, 'paused');
        }
      }).catch((error) => console.error('[document-index] resume failed', vault.id, error));
    }
    if (DOCUMENT_INDEX_CONTINUOUS_AVAILABLE) {
      this.continuousTimer = setInterval(() => {
        void this.refreshContinuousCampaigns();
      }, 30_000);
      this.continuousTimer.unref?.();
    }
    this.schedule();
  }

  private async refreshContinuousCampaigns(): Promise<void> {
    if (this.stopping || this.maintenanceAll) return;
    for (const vault of listVaults().filter((item) => writable(item) && !this.maintenanceVaults.has(item.id))) {
      await withVaultDatabase(vault.id, async () => {
        const settings = getSettings();
        if (!isManualAcademic() && DOCUMENT_INDEX_CONTINUOUS_AVAILABLE && settings.documentIndexingEnabled) {
          await this.ensureContinuousCampaignInside(vault.id, settings.documentIndexIncludeArchived);
        }
      }).catch((error) => console.error('[document-index] continuous refresh failed', vault.id, error));
    }
    this.schedule();
    this.emit();
  }

  /** Reconcile one vault after an import/sync instead of waiting for the safety poll. */
  async refreshVault(vaultId: string): Promise<void> {
    await this.initialize();
    const vault = getVault(vaultId);
    if (!vault || !writable(vault) || this.stopping || this.maintenanceAll || this.maintenanceVaults.has(vaultId)) return;
    await withVaultDatabase(vault.id, async () => {
      const settings = getSettings();
      if (!isManualAcademic() && DOCUMENT_INDEX_CONTINUOUS_AVAILABLE && settings.documentIndexingEnabled) {
        await this.ensureContinuousCampaignInside(vault.id, settings.documentIndexIncludeArchived);
      }
    });
    this.schedule();
    this.emit();
  }

  /** Apply the Settings switch immediately and preserve resumable queued work. */
  async configureContinuous(vaultId: string, enabled: boolean): Promise<void> {
    await this.initialize();
    const vault = getVault(vaultId);
    if (!vault || !writable(vault) || this.stopping || this.maintenanceAll || this.maintenanceVaults.has(vaultId)) return;
    await withVaultDatabase(vault.id, async () => {
      const campaigns = listDocumentIndexCampaigns().filter((campaign) =>
        campaign.mode === 'continuous' && ['queued', 'running', 'paused'].includes(campaign.status)
      );
      if (!DOCUMENT_INDEX_CONTINUOUS_AVAILABLE || !enabled) {
        for (const campaign of campaigns) setDocumentCampaignStatus(campaign.campaignId, 'paused');
        return;
      }
      for (const campaign of campaigns.filter((campaign) => campaign.status === 'paused')) {
        setDocumentCampaignStatus(campaign.campaignId, 'running');
      }
      const settings = getSettings();
      await this.ensureContinuousCampaignInside(vault.id, settings.documentIndexIncludeArchived);
    });
    if (enabled) this.schedule();
    this.emit();
  }

  async startVaultCampaign(
    vaultId: string,
    options: { mode?: DocumentIndexCampaign['mode']; includeArchived?: boolean; nodusIds?: string[]; priority?: number } = {}
  ): Promise<DocumentIndexCampaign> {
    const vault = getVault(vaultId);
    if (!vault || !writable(vault)) throw new Error('Este vault no permite generar análisis documentales.');
    if (this.maintenanceAll || this.maintenanceVaults.has(vaultId)) throw new Error('El vault está en mantenimiento; el análisis se reanudará al terminar.');
    const campaign = await withVaultDatabase(vaultId, () => {
      assertAcademicAutomation();
      const mode = options.mode ?? 'manual';
      const settings = getSettings();
      const defaultGenerator = settings.documentProfileModel ?? settings.summaryModel ?? settings.synthesisModel;
      const defaultAuditor = settings.documentAuditModel ?? defaultGenerator;
      const ids = [...new Set(options.nodusIds ?? [])];
      const where = ids.length
        ? `nodus_id IN (${ids.map(() => '?').join(',')})`
        : (options.includeArchived ? '1=1' : 'archived=0');
      const works = getDb().prepare(`SELECT nodus_id FROM works WHERE ${where}`).all(...ids) as { nodus_id: string }[];
      const states = new Map(documentProfileStatuses(works.map((work) => work.nodus_id)).map((state) => [state.nodusId, state.status]));
      const enqueueScope = (
        campaignId: string,
        generatorModel: DocumentIndexJob['generatorModel'],
        auditorModel: DocumentIndexJob['auditorModel'],
      ) => {
        for (const work of works) {
          if (states.get(work.nodus_id) === 'current' && !ids.length) continue;
          enqueueDocumentIndexJob({
            vaultId, nodusId: work.nodus_id, campaignId,
            priority: options.priority ?? (mode === 'research' ? 1_000 : 0),
            reason: mode === 'research' ? 'research' : mode === 'continuous' ? 'continuous' : 'manual',
            generatorModel, auditorModel,
          });
        }
      };
      if (mode !== 'research') {
        const existing = listDocumentIndexCampaigns().find((item) =>
          item.mode === mode && ['queued', 'running', 'paused'].includes(item.status)
        );
        if (existing) {
          enqueueScope(existing.campaignId, defaultGenerator, defaultAuditor);
          if (options.includeArchived && !existing.includeArchived) {
            getDb().prepare(
              'UPDATE document_index_campaigns SET include_archived=1,updated_at=? WHERE campaign_id=?'
            ).run(new Date().toISOString(), existing.campaignId);
          }
          if (existing.status === 'paused') setDocumentCampaignStatus(existing.campaignId, 'running');
          return listDocumentIndexCampaigns().find((item) => item.campaignId === existing.campaignId) ?? existing;
        }
      }
      const created = createDocumentIndexCampaign({
        vaultId, mode, includeArchived: options.includeArchived ?? false,
        generatorModel: defaultGenerator, auditorModel: defaultAuditor,
      });
      enqueueScope(created.campaignId, defaultGenerator, defaultAuditor);
      setDocumentCampaignStatus(created.campaignId, 'running');
      return listDocumentIndexCampaigns().find((item) => item.campaignId === created.campaignId) ?? created;
    });
    this.schedule();
    this.emit();
    return campaign;
  }

  private async ensureContinuousCampaignInside(vaultId: string, includeArchived: boolean): Promise<void> {
    if (isManualAcademic()) return;
    const existing = listDocumentIndexCampaigns().find((campaign) =>
      campaign.mode === 'continuous' && ['queued', 'running', 'paused'].includes(campaign.status)
    );
    if (existing?.status === 'paused') return;
    const works = getDb().prepare(`
      SELECT w.nodus_id FROM works w LEFT JOIN document_profile_state dps ON dps.nodus_id=w.nodus_id
       WHERE (?=1 OR w.archived=0) AND COALESCE(dps.status,'missing') IN ('missing','stale')
    `).all(includeArchived ? 1 : 0) as { nodus_id: string }[];
    // Do not manufacture a permanent 0/0 campaign merely because continuous mode
    // is enabled while every work is already current (or a manual campaign owns the
    // queued work). The safety poll will create it when a genuinely missing work appears.
    if (!existing && works.length === 0) return;
    const settings = getSettings();
    const generator = settings.documentProfileModel ?? settings.summaryModel ?? settings.synthesisModel;
    const auditor = settings.documentAuditModel ?? generator;
    const campaign = existing ?? createDocumentIndexCampaign({ vaultId, mode: 'continuous', includeArchived, generatorModel: generator, auditorModel: auditor });
    for (const work of works) enqueueDocumentIndexJob({
      vaultId, nodusId: work.nodus_id, campaignId: campaign.campaignId, priority: 0,
      reason: 'continuous', generatorModel: generator, auditorModel: auditor,
    });
    if (!existing) setDocumentCampaignStatus(campaign.campaignId, 'running');
  }

  async ensureProfiles(
    vaultId: string,
    nodusIds: string[],
    reason = 'research',
    options: { allowUnavailable?: boolean; allowFailed?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    if (await withVaultDatabase(vaultId, () => isManualAcademic())) return;
    const ids = [...new Set(nodusIds)].filter(Boolean);
    if (!ids.length) return;
    options.signal?.throwIfAborted();
    if (this.maintenanceAll || this.maintenanceVaults.has(vaultId)) throw new Error('El vault está en mantenimiento; inténtalo al terminar.');
    await this.initialize();
    await withVaultDatabase(vaultId, () => {
      const settings = getSettings();
      const generator = settings.documentProfileModel ?? settings.summaryModel ?? settings.synthesisModel;
      const auditor = settings.documentAuditModel ?? generator;
      const statuses = new Map(documentProfileStatuses(ids).map((state) => [state.nodusId, state.status]));
      for (const nodusId of ids) {
        if (statuses.get(nodusId) === 'current') continue;
        enqueueDocumentIndexJob({
          vaultId, nodusId, priority: 1_000, reason,
          generatorModel: generator, auditorModel: auditor,
        });
      }
    });
    this.schedule();
    let result = await withVaultDatabase(vaultId, () => documentProfileStatuses(ids));
    while (!result.every((state) =>
      state.status === 'current'
      || (options.allowUnavailable && state.status === 'unavailable')
      || (options.allowFailed && state.status === 'failed')
    )) {
      options.signal?.throwIfAborted();
      const failed = result.filter((state) => state.status === 'failed');
      const unavailable = result.filter((state) => state.status === 'unavailable');
      const paused = result.filter((state) => state.status === 'paused');
      // A pause is stable until somebody explicitly resumes the owning campaign.
      // Polling it as if it were still active leaves Deep Research at 4% forever.
      if (paused.length) {
        throw new Error(
          `${paused.length} obra(s) quedaron en pausa durante la preparación documental. Reanuda su análisis o vuelve a intentarlo cuando la fuente esté estable.`
        );
      }
      if ((failed.length && !options.allowFailed) || (unavailable.length && !options.allowUnavailable)) {
        throw new Error(`No se pudieron preparar ${failed.length + unavailable.length} obra(s) necesarias para la investigación.`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      options.signal?.throwIfAborted();
      result = await withVaultDatabase(vaultId, () => documentProfileStatuses(ids));
    }
  }

  async setCampaignStatus(vaultId: string, campaignId: string, status: 'running' | 'paused' | 'cancelled'): Promise<void> {
    await withVaultDatabase(vaultId, () => setDocumentCampaignStatus(campaignId, status));
    if (status !== 'running') {
      for (const active of this.controllers.values()) {
        if (active.vaultId === vaultId && active.campaignId === campaignId) active.controller.abort(status);
      }
    }
    if (status === 'running') this.schedule();
    this.emit();
  }

  async enqueueWork(vaultId: string, nodusId: string, priority = 500, reason = 'manual'): Promise<DocumentIndexJob> {
    if (this.maintenanceAll || this.maintenanceVaults.has(vaultId)) throw new Error('El vault está en mantenimiento; inténtalo al terminar.');
    const result = await withVaultDatabase(vaultId, () => {
      assertAcademicAutomation();
      const settings = getSettings();
      const generator = settings.documentProfileModel ?? settings.summaryModel ?? settings.synthesisModel;
      return enqueueDocumentIndexJob({
        vaultId, nodusId, priority, reason, generatorModel: generator,
        auditorModel: settings.documentAuditModel ?? generator,
      });
    });
    this.schedule(); this.emit();
    return result;
  }

  async cancelJob(vaultId: string, jobId: string): Promise<void> {
    await withVaultDatabase(vaultId, () => { cancelDocumentIndexJob(jobId); });
    for (const active of this.controllers.values()) {
      if (active.vaultId === vaultId && active.jobId === jobId) active.controller.abort('cancelled');
    }
    this.emit();
  }

  /** Pause and fully drain one vault before its SQLite file is reset/replaced. */
  async pauseVaultAndDrain(vaultId: string): Promise<void> {
    this.maintenanceVaults.add(vaultId);
    try {
      await withVaultDatabase(vaultId, () => {
        const campaigns = listDocumentIndexCampaigns().filter((item) =>
          ['queued', 'running'].includes(item.status)
        );
        const standalone = listDocumentIndexJobs().filter((item) =>
          item.campaignId == null && ['queued', 'running'].includes(item.status)
        );
        this.maintenancePaused.set(vaultId, {
          campaignIds: campaigns.map((item) => item.campaignId),
          standaloneJobIds: standalone.map((item) => item.jobId),
        });
        for (const campaign of campaigns) setDocumentCampaignStatus(campaign.campaignId, 'paused');
        for (const job of standalone) {
          updateDocumentIndexJob(job.jobId, { status: 'paused', phase: 'paused', progress: job.progress });
          setDocumentProfileState(job.nodusId, 'paused');
        }
      });
    } catch (error) {
      this.maintenancePaused.delete(vaultId);
      this.maintenanceVaults.delete(vaultId);
      throw error;
    }
    const pending = [...this.active.entries()]
      .filter(([key]) => key.startsWith(`${vaultId}:`))
      .map(([, promise]) => promise);
    for (const active of this.controllers.values()) {
      if (active.vaultId === vaultId) active.controller.abort('vault-paused-for-maintenance');
    }
    await Promise.allSettled(pending);
    this.emit();
  }

  async resumeVaultAfterMaintenance(vaultId: string): Promise<void> {
    const paused = this.maintenancePaused.get(vaultId);
    try {
      if (paused) await withVaultDatabase(vaultId, () => {
        const campaigns = new Set(listDocumentIndexCampaigns().map((item) => item.campaignId));
        for (const campaignId of paused.campaignIds) {
          if (campaigns.has(campaignId)) setDocumentCampaignStatus(campaignId, 'running');
        }
        const jobs = new Map(listDocumentIndexJobs().map((item) => [item.jobId, item]));
        for (const jobId of paused.standaloneJobIds) {
          const job = jobs.get(jobId);
          if (!job || job.status !== 'paused') continue;
          updateDocumentIndexJob(jobId, { status: 'queued', phase: 'queued', progress: job.progress, error: null });
          setDocumentProfileState(job.nodusId, 'queued', { error: null });
        }
      });
    } finally {
      this.maintenancePaused.delete(vaultId);
      this.maintenanceVaults.delete(vaultId);
      this.schedule();
      this.emit();
    }
  }

  async pauseAllAndDrain(): Promise<string[]> {
    this.maintenanceAll = true;
    const vaultIds = listVaults().filter(writable).map((vault) => vault.id);
    try {
      for (const vaultId of vaultIds) await this.pauseVaultAndDrain(vaultId);
      return vaultIds;
    } catch (error) {
      for (const vaultId of vaultIds) await this.resumeVaultAfterMaintenance(vaultId).catch(() => undefined);
      this.maintenanceAll = false;
      throw error;
    }
  }

  async resumeAllAfterMaintenance(vaultIds: string[]): Promise<void> {
    try {
      for (const vaultId of vaultIds) await this.resumeVaultAfterMaintenance(vaultId).catch(() => undefined);
    } finally {
      this.maintenanceAll = false;
      this.schedule();
      this.emit();
    }
  }

  private schedule(): void {
    if (this.scheduled || this.stopping) return;
    this.scheduled = true;
    setImmediate(() => { this.scheduled = false; void this.drain(); });
  }

  private async concurrency(): Promise<number> {
    let configured = 0;
    for (const vault of listVaults().filter((item) => writable(item) && !this.maintenanceVaults.has(item.id))) {
      configured = Math.max(configured, await withVaultDatabase(vault.id, () => getSettings().documentIndexConcurrency).catch(() => 0));
    }
    return configured > 0 ? Math.max(1, Math.min(8, configured)) : 2;
  }

  private async drain(): Promise<void> {
    if (this.stopping || this.maintenanceAll) return;
    const limit = await this.concurrency();
    while (this.active.size < limit) {
      const claimed = await this.claimAcrossVaults();
      if (!claimed) break;
      const key = `${claimed.vault.id}:${claimed.job.jobId}`;
      const controller = new AbortController();
      this.controllers.set(key, {
        vaultId: claimed.vault.id,
        jobId: claimed.job.jobId,
        campaignId: claimed.job.campaignId,
        controller,
      });
      const running = this.run(claimed.vault, claimed.job, controller.signal).finally(() => {
        this.active.delete(key); this.controllers.delete(key); this.emit(); this.schedule();
      });
      this.active.set(key, running);
    }
    this.emit();
  }

  private async claimAcrossVaults(): Promise<{ vault: VaultSummary; job: DocumentIndexJob } | null> {
    const vaults = listVaults().filter((vault) => writable(vault) && !this.maintenanceVaults.has(vault.id));
    if (!vaults.length) return null;
    for (let offset = 0; offset < vaults.length; offset += 1) {
      const index = (this.roundRobin + offset) % vaults.length;
      const vault = vaults[index];
      const job = await withVaultDatabase(vault.id, () => isManualAcademic() ? null : claimNextDocumentIndexJob()).catch(() => null);
      if (job) { this.roundRobin = (index + 1) % vaults.length; return { vault, job }; }
    }
    return null;
  }

  private async run(vault: VaultSummary, job: DocumentIndexJob, signal: AbortSignal): Promise<void> {
    await withVaultDatabase(vault.id, async () => {
      assertAcademicAutomation();
      const work = getDb().prepare('SELECT * FROM works WHERE nodus_id=?').get(job.nodusId) as Work | undefined;
      if (!work) {
        updateDocumentIndexJob(job.jobId, { status: 'unavailable', phase: 'done', progress: 1, error: 'La obra ya no existe.' });
        return;
      }
      // Every line the profile scan records now inherits the vault, the document and the job,
      // so an AI failure deep inside it arrives in the log attributed instead of anonymous.
      await withPipelineLogScope({
        scope: 'indexing',
        vaultId: vault.id,
        vaultName: vault.name,
        nodusId: job.nodusId,
        documentTitle: work.title,
        jobId: job.jobId,
        provider: job.generatorModel?.provider ?? null,
        model: job.generatorModel?.model ?? null,
      }, async () => {
      try {
        await measurePerf('document profile', { nodusId: work.nodus_id, title: work.title }, () =>
          runDocumentProfileScan(work, {
            jobId: job.jobId, generatorModel: job.generatorModel, auditorModel: job.auditorModel,
            signal,
            onProgress: () => {
              const live = listDocumentIndexJobs().find((item) => item.jobId === job.jobId);
              if (live?.status === 'cancelled') throw new Error('DOCUMENT_INDEX_CANCELLED');
              if (live?.status === 'paused') throw new Error('DOCUMENT_INDEX_PAUSED');
              if (signal.aborted) throw new Error('DOCUMENT_INDEX_CANCELLED');
              this.emit();
            },
          }),
          { jobId: job.jobId },
        );
        const live = listDocumentIndexJobs().find((item) => item.jobId === job.jobId);
        if (live?.status === 'cancelled') return;
        updateDocumentIndexJob(job.jobId, {
          status: 'completed', phase: 'done', progress: 1, error: null,
          progressMessage: null, currentUnit: null, totalUnits: null,
        });
        // A deep scan whose Documentary Index step failed left its error on the work.
        clearResolvedDocumentaryDeepErrors(job.nodusId);
        // The document's own green line is written by the profile scan, which is the only
        // place that knows how many sections and vectors were published.
        this.logCampaignOutcome(vault, job.campaignId);
      } catch (error) {
        console.error('[document-index] job failed', {
          vaultId: vault.id,
          jobId: job.jobId,
          nodusId: job.nodusId,
          error,
        });
        const message = error instanceof Error ? error.message : String(error);
        const current = listDocumentIndexJobs().find((item) => item.jobId === job.jobId) ?? job;
        if (current.status === 'cancelled' || message === 'DOCUMENT_INDEX_CANCELLED') {
          logPipelineWarning({ subject: 'subjectIndexing', code: 'cancelled', reason: 'reasonCancelled', detail: work.title });
          return;
        }
        if (current.status === 'paused' || message === 'DOCUMENT_INDEX_PAUSED') {
          logPipelineWarning({ subject: 'subjectIndexing', code: 'queue_paused', reason: 'reasonCancelled', detail: work.title });
          return;
        }
        // A passage run that reached this work after the index prepared its passages
        // (a deep scan's chained passage step, a per-work Retry) fences the index's
        // publication. The work itself is fine and the section analyses are
        // checkpointed under this job, so retry it like a source change instead of
        // failing it for good and throwing the analysis away.
        if (message === 'DOCUMENT_SOURCE_CHANGED' || message === 'documentary_publication_superseded') {
          requeueDocumentIndexJobForSourceChange(job.jobId);
          logPipelineWarning({ subject: 'subjectIndexing', code: 'source_changed', reason: 'reasonSourceChanged', detail: work.title });
          return;
        }
        const unavailable = /sin texto|no hay texto|no contiene texto/i.test(message);
        if (unavailable) {
          updateDocumentIndexJob(job.jobId, { status: 'unavailable', phase: 'done', progress: 1, error: message });
          setDocumentProfileState(job.nodusId, 'unavailable', { error: message });
          logPipelineWarning({ subject: 'subjectIndexing', code: 'no_legible_text', reason: 'reasonNoLegibleText', detail: work.title });
        } else if (error instanceof AiError && error.config && job.campaignId) {
          updateDocumentIndexJob(job.jobId, { status: 'paused', phase: 'paused', progress: current.progress, error: message });
          setDocumentProfileState(job.nodusId, 'paused', { error: message });
          setDocumentCampaignStatus(job.campaignId, 'paused');
          logPipelineFailure({ error, code: 'queue_paused', subject: 'subjectIndexing', detail: message });
        } else if (error instanceof AiError && error.retriable && current.attempts < current.maxAttempts) {
          updateDocumentIndexJob(job.jobId, { status: 'queued', phase: 'queued', progress: current.progress, error: message });
          setDocumentProfileState(job.nodusId, 'queued', { error: message });
          logPipelineWarning({
            subject: 'subjectIndexing',
            code: 'index_failed',
            message: {
              id: 'logRetry',
              params: { subject: { id: 'subjectIndexing' }, attempt: current.attempts + 1, max: current.maxAttempts },
            },
            detail: message,
          });
        } else {
          updateDocumentIndexJob(job.jobId, { status: 'failed', phase: 'done', progress: current.progress, error: message });
          setDocumentProfileState(job.nodusId, 'failed', { error: message });
          logPipelineFailure({ error, code: 'index_failed', subject: 'subjectIndexing', detail: message });
        }
        this.logCampaignOutcome(vault, job.campaignId);
      }
      });
    });
  }

  /**
   * The line that answers "why is half the corpus missing?" — one summary per campaign once
   * its last job settles, next to the per-document lines instead of a count the reader has to
   * reconstruct. `summarizedCampaigns` keeps it to one line per campaign.
   */
  private logCampaignOutcome(vault: VaultSummary, campaignId: string | null | undefined): void {
    if (!campaignId || this.summarizedCampaigns.has(campaignId)) return;
    const campaign: DocumentIndexCampaign | undefined =
      listDocumentIndexCampaigns().find((item) => item.campaignId === campaignId);
    if (!campaign) return;
    const pending = campaign.completedJobs + campaign.failedJobs;
    if (pending < campaign.totalJobs) return;
    this.summarizedCampaigns.add(campaignId);
    logPipelineSuccess({
      context: { vaultId: vault.id, vaultName: vault.name },
      message: {
        id: 'campaignFinished',
        params: { completed: campaign.completedJobs, total: campaign.totalJobs, failed: campaign.failedJobs },
      },
      ...(campaign.failedJobs > 0 ? { level: 'warning' as const } : {}),
    });
  }

  /** Graceful app shutdown: DB state remains requeueable on next initialize(). */
  stop(): void {
    this.stopping = true;
    for (const active of this.controllers.values()) active.controller.abort('shutdown');
    this.controllers.clear();
    if (this.continuousTimer) clearInterval(this.continuousTimer);
    this.continuousTimer = null;
  }
}

export const documentIndexQueue = new DocumentIndexQueue();
registerDocumentIndexMaintenanceController(documentIndexQueue);
