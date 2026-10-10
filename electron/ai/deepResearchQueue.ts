import { documentVisualProgressLabel } from '../../shared/documentSkills';
import type {
  DeepResearchJobOrigin,
  DeepResearchJobRecord,
  DeepResearchJobStatus,
  DeepResearchProgress,
  DeepResearchReport,
  DeepResearchRequest,
  PromptLanguage,
} from '@shared/types';
import { normalizeDeepResearchApproach } from '@shared/deepResearchApproaches';
import { normalizeDeepResearchMetadataVersion, parseDeepResearchRequestVersion } from '@shared/deepResearchVersions';
import { normalizeDeepResearchSectionLength } from '@shared/deepResearchSectionLength';
import { normalizeCompleteGuideConfig } from '@shared/completeGuide/types';

export type { DeepResearchJobOrigin, DeepResearchJobRecord, DeepResearchJobStatus };

// ─────────────────────────────────────────────────────────────────────────────
// The single lane every Deep Research report goes through.
//
// Until now the app queued reports in the renderer (src/backgroundJobs.ts) while
// MCP called the pipeline straight from a tool handler. That left two independent
// lanes into the same generator: a report asked for over MCP could run alongside
// one the user started in the app, putting two multi-minute pipelines on the one
// event loop of the main process and doubling the provider spend. Both now enqueue
// here, and this module runs exactly one at a time.
//
// It also fixes what makes a *deferred* report different from an immediate one:
// a job written now may not start for an hour, and by then the user may have
// switched vault — which closes the database under it (see electron/ipc.ts). So
// every job is bound to the vault that was open when it was enqueued, checked
// again before it starts and once more before its draft is saved. A report is
// never written into a corpus it was not researched against.
//
// The module is dependency-injected (no Electron/DB/AI imports) so the real queue
// can be driven by tests with fakes — see scripts/test-deep-research-queue.mjs.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeepResearchQueueVault {
  id: string;
  name: string;
}

export interface DeepResearchJobInput {
  request: DeepResearchRequest;
  origin: DeepResearchJobOrigin;
  /** Trusted owner from the mobile adapter, never inferred from a public space id. */
  vault?: DeepResearchQueueVault;
  bridgeJobId?: string;
  requireExisting?: boolean;
  /** Store the finished report as a Nodus writing draft. */
  save: boolean;
  /** Draft title; the report's own title is used when omitted. */
  title?: string | null;
}

export interface DeepResearchQueueDeps {
  /** Private mobile requests keep their vault and execution boundary even while Desktop switches. */
  runDesktop?: (work: () => Promise<void>) => Promise<void>;
  executionVault?: () => DeepResearchQueueVault;
  runMobile?: (vault: DeepResearchQueueVault, work: () => Promise<void>) => Promise<void>;
  generate: (
    request: DeepResearchRequest,
    onProgress: (progress: DeepResearchProgress) => void,
    signal: AbortSignal,
  ) => Promise<DeepResearchReport>;
  /** Persists the finished report and returns the saved draft id. */
  saveDraft: (input: { report: DeepResearchReport; request: DeepResearchRequest; title: string | null }) => string;
  enrichSaved?: (id: string, report: DeepResearchReport, request: DeepResearchRequest, signal: AbortSignal) => Promise<unknown>;
  activeVault: () => DeepResearchQueueVault;
  /** Called on every state change, so the queue can be mirrored in the app window. */
  onChange?: (jobs: DeepResearchJobRecord[]) => void;
  /** Called once per job that reaches a terminal state. */
  onSettled?: (job: DeepResearchJobRecord) => void;
  /** Restores the durable lane written by an earlier Desktop process. */
  load?: () => DeepResearchPersistedJob[];
  /** Atomically replaces the durable lane after every state transition. */
  persist?: (jobs: DeepResearchPersistedJob[]) => void;
}

export interface DeepResearchPersistedJob {
  record: DeepResearchJobRecord;
  request: DeepResearchRequest;
  save: boolean;
  draftTitle: string | null;
}

interface QueuedJob {
  needsRecovery?: boolean;
  record: DeepResearchJobRecord;
  request: DeepResearchRequest;
  save: boolean;
  draftTitle: string | null;
  report: DeepResearchReport | null;
  /** Progress sink of the caller awaiting this job (the app's IPC stream). */
  listener: ((progress: DeepResearchProgress) => void) | null;
  resolve: ((report: DeepResearchReport) => void) | null;
  reject: ((error: Error) => void) | null;
  /** Stops provider/document waits while the lane remains occupied until the
   * pipeline has unwound, preserving strict one-at-a-time generation. */
  controller: AbortController;
}

/** Finished jobs kept for inspection before the oldest are dropped. */
const MAX_FINISHED = 20;
/** Finished jobs whose full report stays in memory — the rest keep only their metadata. */
const MAX_RETAINED_REPORTS = 5;

const jobs: QueuedJob[] = [];
let deps: DeepResearchQueueDeps | null = null;
let draining = false;
let executing: QueuedJob | null = null;
let deliver: (() => void) | null = null;
let sequence = 0;

export function configureDeepResearchQueue(next: DeepResearchQueueDeps): void {
  deps = next;
  if (jobs.length === 0 && next.load) restorePersistedJobs(next.load());
  evictFinished();
  reportQueuePositions();
  notifyChange();
  void drain();
}

function requireDeps(): DeepResearchQueueDeps {
  if (!deps) throw new Error('The Deep Research queue is not configured.');
  return deps;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface QueueCopy {
  untitled: string;
  recovered: string;
  queued: (ahead: number) => string;
  vaultChanged: (requested: string, current: string) => string;
  generationCancelled: string;
  reportCancelled: string;
}

const QUEUE_COPY: Record<PromptLanguage, QueueCopy> = {
  es: { untitled: 'Informe sin título', recovered: 'Recuperado tras reiniciar Nodus…', queued: (ahead) => `En cola · ${ahead} informe(s) por delante…`, vaultChanged: (requested, current) => `El informe se pidió sobre la bóveda «${requested}», pero ahora la activa es «${current}». No se ha generado sobre otro corpus.`, generationCancelled: 'Generación cancelada por el usuario.', reportCancelled: 'Informe cancelado antes de empezar.' },
  en: { untitled: 'Untitled report', recovered: 'Recovered after restarting Nodus…', queued: (ahead) => `Queued · ${ahead} report(s) ahead…`, vaultChanged: (requested, current) => `This report was requested against the "${requested}" vault, but "${current}" is now active. It was not generated against a different corpus.`, generationCancelled: 'Generation cancelled by the user.', reportCancelled: 'Report cancelled before it started.' },
  fr: { untitled: 'Rapport sans titre', recovered: 'Récupéré après le redémarrage de Nodus…', queued: (ahead) => `En attente · ${ahead} rapport(s) devant…`, vaultChanged: (requested, current) => `Ce rapport a été demandé pour le vault « ${requested} », mais « ${current} » est maintenant actif. Il n’a pas été généré à partir d’un autre corpus.`, generationCancelled: 'Génération annulée par l’utilisateur.', reportCancelled: 'Rapport annulé avant son démarrage.' },
  de: { untitled: 'Bericht ohne Titel', recovered: 'Nach dem Neustart von Nodus wiederhergestellt…', queued: (ahead) => `Warteschlange · ${ahead} Bericht(e) davor…`, vaultChanged: (requested, current) => `Dieser Bericht wurde für den Vault „${requested}“ angefordert, aber jetzt ist „${current}“ aktiv. Er wurde nicht mit einem anderen Korpus erzeugt.`, generationCancelled: 'Erstellung durch den Benutzer abgebrochen.', reportCancelled: 'Bericht vor dem Start abgebrochen.' },
  pt: { untitled: 'Relatório sem título', recovered: 'Recuperado após reiniciar o Nodus…', queued: (ahead) => `Em fila · ${ahead} relatório(s) à frente…`, vaultChanged: (requested, current) => `Este relatório foi pedido para o vault «${requested}», mas «${current}» está agora ativo. Não foi gerado com outro corpus.`, generationCancelled: 'Geração cancelada pelo utilizador.', reportCancelled: 'Relatório cancelado antes de começar.' },
  'pt-BR': { untitled: 'Relatório sem título', recovered: 'Recuperado após reiniciar o Nodus…', queued: (ahead) => `Na fila · ${ahead} relatório(s) à frente…`, vaultChanged: (requested, current) => `Este relatório foi solicitado para o vault “${requested}”, mas “${current}” está ativo agora. Ele não foi gerado com outro corpus.`, generationCancelled: 'Geração cancelada pelo usuário.', reportCancelled: 'Relatório cancelado antes de começar.' },
  it: { untitled: 'Rapporto senza titolo', recovered: 'Ripristinato dopo il riavvio di Nodus…', queued: (ahead) => `In coda · ${ahead} rapporto/i davanti…`, vaultChanged: (requested, current) => `Questo rapporto è stato richiesto per il vault «${requested}», ma ora è attivo «${current}». Non è stato generato con un corpus diverso.`, generationCancelled: 'Generazione annullata dall’utente.', reportCancelled: 'Rapporto annullato prima dell’avvio.' },
  tr: { untitled: 'Başlıksız rapor', recovered: 'Nodus yeniden başlatıldıktan sonra kurtarıldı…', queued: (ahead) => `Kuyrukta · önde ${ahead} rapor var…`, vaultChanged: (requested, current) => `Bu rapor “${requested}” kasası için istendi, ancak şu anda “${current}” etkin. Farklı bir derlem üzerinde oluşturulmadı.`, generationCancelled: 'Oluşturma kullanıcı tarafından iptal edildi.', reportCancelled: 'Rapor başlamadan önce iptal edildi.' },
  'zh-Hans': { untitled: '无标题报告', recovered: 'Nodus 重启后已恢复…', queued: (ahead) => `排队中 · 前方还有 ${ahead} 份报告…`, vaultChanged: (requested, current) => `此报告是针对「${requested}」知识库请求的，但当前活动的是「${current}」。它并未在其他语料库上生成。`, generationCancelled: '用户已取消生成。', reportCancelled: '报告在开始前已取消。' },
  'zh-Hant': { untitled: '無標題報告', recovered: 'Nodus 重新啟動後已恢復…', queued: (ahead) => `排隊中 · 前方還有 ${ahead} 份報告…`, vaultChanged: (requested, current) => `此報告是針對「${requested}」知識庫請求的，但目前啟用的是「${current}」。它並未在其他語料庫上生成。`, generationCancelled: '使用者已取消生成。', reportCancelled: '報告在開始前已取消。' },
  vi: { untitled: 'Báo cáo chưa có tiêu đề', recovered: 'Đã khôi phục sau khi khởi động lại Nodus…', queued: (ahead) => `Đang chờ · còn ${ahead} báo cáo phía trước…`, vaultChanged: (requested, current) => `Báo cáo này được yêu cầu cho vault “${requested}”, nhưng hiện tại “${current}” đang hoạt động. Nó không được tạo trên một ngữ liệu khác.`, generationCancelled: 'Người dùng đã hủy tạo.', reportCancelled: 'Báo cáo đã bị hủy trước khi bắt đầu.' },
  ja: { untitled: '無題のレポート', recovered: 'Nodus の再起動後に復元されました…', queued: (ahead) => `待機中 · 前に ${ahead} 件のレポート…`, vaultChanged: (requested, current) => `このレポートは「${requested}」保管庫に対して要求されましたが、現在は「${current}」が有効です。別のコーパスに対して生成されたものではありません。`, generationCancelled: 'ユーザーによって生成がキャンセルされました。', reportCancelled: 'レポートは開始前にキャンセルされました。' },
  ru: { untitled: 'Отчёт без названия', recovered: 'Восстановлено после перезапуска Nodus…', queued: (ahead) => `В очереди · впереди ещё ${ahead} отчёт(ов)…`, vaultChanged: (requested, current) => `Этот отчёт был запрошен для хранилища «${requested}», но сейчас активно «${current}». Он не был сгенерирован по другому корпусу.`, generationCancelled: 'Генерация отменена пользователем.', reportCancelled: 'Отчёт отменён до начала.' },
  uk: { untitled: 'Звіт без назви', recovered: 'Відновлено після перезапуску Nodus…', queued: (ahead) => `У черзі · попереду ще ${ahead} звіт(ів)…`, vaultChanged: (requested, current) => `Цей звіт було запитано для сховища «${requested}», але зараз активне «${current}». Його не було згенеровано за іншим корпусом.`, generationCancelled: 'Генерацію скасовано користувачем.', reportCancelled: 'Звіт скасовано до початку.' },
  ko: { untitled: '제목 없는 보고서', recovered: 'Nodus 재시작 후 복구되었습니다…', queued: (ahead) => `대기 중 · 앞에 보고서 ${ahead}개…`, vaultChanged: (requested, current) => `이 보고서는 “${requested}” 보관소를 대상으로 요청되었지만, 현재는 “${current}”가 활성 상태입니다. 다른 코퍼스를 대상으로 생성되지 않았습니다.`, generationCancelled: '사용자가 생성을 취소했습니다.', reportCancelled: '보고서가 시작되기 전에 취소되었습니다.' },
};

function queueCopy(language: PromptLanguage | undefined): QueueCopy {
  return QUEUE_COPY[language ?? 'es'] ?? QUEUE_COPY.es;
}

function objectivePreview(objective: string, language?: PromptLanguage): string {
  const clean = objective.replace(/\s+/g, ' ').trim();
  if (!clean) return queueCopy(language).untitled;
  return clean.length > 100 ? `${clean.slice(0, 100)}…` : clean;
}

function terminal(status: DeepResearchJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/** How many reports are still ahead of `index` in the lane. */
function aheadOf(index: number): number {
  let ahead = 0;
  for (let i = 0; i < index; i++) {
    if (jobs[i].record.vaultId !== jobs[index].record.vaultId) continue;
    if (jobs[i].record.status === 'queued' || jobs[i].record.status === 'running') ahead += 1;
  }
  return ahead;
}

function snapshot(): DeepResearchJobRecord[] {
  return jobs.map((job, index) => ({
    ...job.record,
    ahead: job.record.status === 'queued' ? aheadOf(index) : null,
  }));
}

export function listDeepResearchJobs(): DeepResearchJobRecord[] {
  return snapshot();
}

/** True while a report is being generated — the lane cannot survive its database closing. */
export function isDeepResearchLaneBusy(): boolean {
  return draining;
}

export function getDeepResearchJob(id: string): { job: DeepResearchJobRecord; report: DeepResearchReport | null } | null {
  const index = jobs.findIndex((job) => job.record.id === id);
  if (index === -1) return null;
  return { job: { ...jobs[index].record, ahead: jobs[index].record.status === 'queued' ? aheadOf(index) : null }, report: jobs[index].report };
}

function notifyChange(): void {
  try {
    deps?.persist?.(jobs.map((job) => ({
      record: { ...job.record, ahead: null },
      request: { ...job.request, model: job.request.model ? { ...job.request.model } : job.request.model },
      save: job.save,
      draftTitle: job.draftTitle,
    })));
  } catch {
    // The lane remains usable when a checkpoint cannot be written. The next state
    // transition retries the atomic replacement and the report itself is still saved.
  }
  deps?.onChange?.(snapshot());
}

function restorePersistedJobs(persisted: DeepResearchPersistedJob[]): void {
  for (const stored of persisted) {
    if (!stored?.record?.id || !stored.request?.objective) continue;
    const wasRunning = stored.record.status === 'running';
    jobs.push({
      needsRecovery: stored.record.origin === 'mobile' && stored.record.status === 'queued',
      record: {
        ...stored.record,
        status: wasRunning && stored.record.origin === 'mobile' ? 'failed' : wasRunning ? 'queued' : stored.record.status,
        error: wasRunning && stored.record.origin === 'mobile' ? 'Mac restarted. Review saved reports before starting this request again.' : stored.record.error,
        progress: wasRunning
          ? {
              phase: 'queued',
              message: queueCopy(stored.request.language).recovered,
            }
          : stored.record.progress,
        startedAt: wasRunning ? null : stored.record.startedAt,
        finishedAt: wasRunning ? null : stored.record.finishedAt,
        ahead: null,
      },
      request: {
        ...stored.request,
        approach: normalizeDeepResearchApproach(stored.request.approach),
        model: stored.request.model ? { ...stored.request.model } : stored.request.model,
      },
      save: stored.save,
      draftTitle: stored.draftTitle ?? null,
      report: null,
      listener: null,
      resolve: null,
      reject: null,
      controller: new AbortController(),
    });
  }
  sequence = Math.max(sequence, jobs.length);
}

/**
 * Tell everyone still waiting where they now stand — positions move on every finish.
 * Only a real wait is announced: a report that goes straight into generation should
 * not first report itself as queued, or every caller would see a phantom phase.
 */
function reportQueuePositions(): void {
  jobs.forEach((job, index) => {
    if (job.record.status !== 'queued') return;
    const ahead = aheadOf(index);
    if (ahead === 0) return;
    const progress: DeepResearchProgress = {
      phase: 'queued',
      message: queueCopy(job.request.language).queued(ahead),
    };
    job.record.progress = progress;
    job.listener?.(progress);
  });
}

function settle(job: QueuedJob, outcome: { report: DeepResearchReport } | { error: string }): void {
  job.record.finishedAt = new Date().toISOString();
  const resolve = job.resolve, reject = job.reject;
  const complete = () => { if ('report' in outcome) resolve?.(outcome.report); else reject?.(new Error(outcome.error)); };
  if (executing === job) deliver = complete; else complete();
  if ('report' in outcome) {
    job.record.status = 'completed';
    job.report = outcome.report;
  } else {
    if (job.record.status !== 'cancelled') job.record.status = 'failed';
    job.record.error = outcome.error;
  }
  job.resolve = null;
  job.reject = null;
  job.listener = null;
  evictFinished();
  notifyChange();
  deps?.onSettled?.({ ...job.record, ahead: null });
}

/** Keep the finished tail bounded: metadata for the last few, full reports for fewer still. */
function evictFinished(): void {
  const finished = jobs.filter((job) => terminal(job.record.status));
  for (const job of finished.slice(0, Math.max(0, finished.length - MAX_RETAINED_REPORTS))) job.report = null;
  for (const job of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED))) {
    const index = jobs.indexOf(job);
    if (index !== -1) jobs.splice(index, 1);
  }
}

function vaultChangedMessage(job: QueuedJob, current: DeepResearchQueueVault): string {
  return queueCopy(job.request.language).vaultChanged(job.record.vaultName, current.name);
}

function enqueueJob(input: DeepResearchJobInput, waiter: Pick<QueuedJob, 'listener' | 'resolve' | 'reject'>): QueuedJob {
  const vault = input.vault ?? requireDeps().activeVault();
  const deepResearchVersion = parseDeepResearchRequestVersion(input.request.deepResearchVersion);
  // A complete study guide is validated before it waits in the lane (an empty
  // selection fails now, not minutes later) and gets its run id here, so a job
  // re-queued after a restart resumes the same run instead of starting over.
  const completeGuide = input.request.completeGuide ? normalizeCompleteGuideConfig(input.request.completeGuide) : undefined;
  const job: QueuedJob = {
    record: {
      id: `drj-${Date.now()}-${++sequence}`,
      origin: input.origin,
      ...(input.origin === 'mobile' && input.bridgeJobId ? { bridgeJobId: input.bridgeJobId } : {}),
      vaultId: vault.id,
      vaultName: vault.name,
      objective: input.request.objective,
      title: objectivePreview(input.request.objective, input.request.language),
      deepResearchApproach: normalizeDeepResearchApproach(input.request.approach),
      deepResearchVersion,
      structure: input.request.sectionLimit === 'single' ? 'single' : 'sectioned',
      ...(completeGuide ? { studyReportMode: 'complete_guide' as const } : {}),
      // Normalized at the queue boundary so a persisted job, an MCP payload and a
      // job queued before the control existed all resolve the same way on drain.
      sectionLength: normalizeDeepResearchSectionLength(input.request.sectionLength),
      model: input.request.model ? { ...input.request.model } : null,
      status: 'queued',
      progress: null,
      error: null,
      savedDraftId: null,
      saveError: null,
      ahead: null,
      enqueuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    },
    request: {
      ...input.request,
      approach: normalizeDeepResearchApproach(input.request.approach),
      deepResearchVersion,
      sectionLength: normalizeDeepResearchSectionLength(input.request.sectionLength),
      model: input.request.model ? { ...input.request.model } : input.request.model,
      ...(completeGuide ? { completeGuide } : {}),
    },
    save: input.save,
    draftTitle: input.title ?? null,
    report: null,
    controller: new AbortController(),
    ...waiter,
  };
  jobs.push(job);
  reportQueuePositions();
  notifyChange();
  void drain();
  return job;
}

/** Queue a report and return immediately. Used by MCP, where the caller polls. */
export function enqueueDeepResearchJob(input: DeepResearchJobInput): DeepResearchJobRecord {
  if (input.origin === 'mobile' && input.bridgeJobId) {
    const existing = jobs.find(job => job.record.bridgeJobId === input.bridgeJobId && job.record.vaultId === input.vault?.id);
    if (existing) {
      existing.needsRecovery = false;
      void drain();
      return { ...existing.record };
    }
    if (input.requireExisting) throw new Error('The original research job is unavailable. Review saved reports before starting a new request.');
  }
  const job = enqueueJob(input, { listener: null, resolve: null, reject: null });
  const index = jobs.indexOf(job);
  return { ...job.record, ahead: job.record.status === 'queued' ? aheadOf(index) : null };
}

/**
 * Queue a report and wait for it. Used by the app window, so a report started from
 * the UI takes its turn in the same lane instead of running beside an MCP one.
 */
export function runDeepResearchJob(
  input: DeepResearchJobInput,
  onProgress?: (progress: DeepResearchProgress) => void
): Promise<DeepResearchReport> {
  return new Promise<DeepResearchReport>((resolve, reject) => {
    enqueueJob(input, { listener: onProgress ?? null, resolve, reject });
  });
}

/** Remove a queued report or request cancellation of the one currently running. */
export function cancelDeepResearchJob(id: string): boolean {
  const job = jobs.find((entry) => entry.record.id === id);
  if (!job || (job.record.status !== 'queued' && job.record.status !== 'running')) return false;
  const wasRunning = job.record.status === 'running';
  const copy = queueCopy(job.request.language);
  const message = wasRunning ? copy.generationCancelled : copy.reportCancelled;
  job.record.status = 'cancelled';
  job.record.error = message;
  if (wasRunning) {
    // The UI can remove the row now, but `draining` stays true until generate()
    // acknowledges this signal. A following report can never overlap the unwind.
    job.controller.abort(new Error(message));
    notifyChange();
  } else {
    settle(job, { error: message });
  }
  reportQueuePositions();
  notifyChange();
  return true;
}

/** Forget the finished tail (completed, failed and cancelled alike). */
export function clearFinishedDeepResearchJobs(vaultId?: string): number {
  let removed = 0;
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (!terminal(jobs[i].record.status) || (vaultId && jobs[i].record.vaultId !== vaultId)) continue;
    jobs.splice(i, 1);
    removed += 1;
  }
  if (removed > 0) notifyChange();
  return removed;
}

/**
 * Legacy switch hook. Queued work now survives a vault switch and remains bound to
 * its original corpus. Returning to that vault lets the durable lane resume it.
 */
export function cancelDeepResearchJobsForOtherVaults(activeVaultId: string): number {
  void activeVaultId;
  reportQueuePositions();
  notifyChange();
  void drain();
  return 0;
}

async function drain(): Promise<void> {
  if (draining) return;
  const active = requireDeps().activeVault();
  const job = jobs.find((entry) => !entry.needsRecovery && entry.record.status === 'queued' && (entry.record.vaultId === active.id || (entry.record.origin === 'mobile' && requireDeps().runMobile)));
  if (!job) return;
  draining = true; executing = job;

  try {
    const run = async () => {
    const executionVault = () => job.record.origin === 'mobile' && requireDeps().executionVault ? requireDeps().executionVault!() : requireDeps().activeVault();
    const active = executionVault();
    // The vault may have changed while this job waited its turn. Running it now would
    // research a corpus nobody asked about, so it is cancelled instead.
    if (active.id !== job.record.vaultId) {
      job.record.status = 'cancelled';
      settle(job, { error: vaultChangedMessage(job, active) });
      return;
    }

    job.record.status = 'running';
    job.record.startedAt = new Date().toISOString();
    notifyChange();

    try {
      const report = await requireDeps().generate(job.request, (progress) => {
        if (job.record.status !== 'running') return;
        job.record.progress = progress;
        job.listener?.(progress);
        notifyChange();
      }, job.controller.signal);
      if (job.controller.signal.aborted) {
        settle(job, {
          error: job.record.error
            ?? queueCopy(job.request.language).generationCancelled,
        });
        return;
      }
      job.record.deepResearchApproach = normalizeDeepResearchApproach(report.draft.deepResearchApproach ?? job.request.approach);
      job.record.deepResearchVersion = normalizeDeepResearchMetadataVersion(
        report.draft.deepResearchVersion ?? report.meta?.deepResearchVersion ?? job.request.deepResearchVersion,
      );
      job.record.model = report.draft.generationModel ? { ...report.draft.generationModel } : job.record.model ?? null;

      // Checked again on the way out: a switch mid-generation would otherwise save
      // this report as a draft of the vault that is open *now*.
      const afterwards = executionVault();
      if (afterwards.id !== job.record.vaultId) {
        settle(job, { error: vaultChangedMessage(job, afterwards) });
        return;
      }

      if (job.save) {
        try {
          job.record.savedDraftId = requireDeps().saveDraft({ report, request: job.request, title: job.draftTitle });
        } catch (error) {
          // A report that cannot be filed is still a report. Keep it on the job and
          // say why it was not stored, rather than throwing the generation away.
          job.record.saveError = messageFromError(error);
        }
      }
      if (job.record.savedDraftId && job.request.documentSkills?.enabled && requireDeps().enrichSaved) {
        job.record.progress = { phase: 'assembling', message: documentVisualProgressLabel(job.request.language) }; notifyChange();
        try { await requireDeps().enrichSaved!(job.record.savedDraftId, report, job.request, job.controller.signal); } catch { /* The verified report is already saved. */ }
      }
      settle(job, { report });
    } catch (error) {
      settle(job, {
        error: job.controller.signal.aborted
          ? job.record.error
            ?? queueCopy(job.request.language).generationCancelled
          : messageFromError(error),
      });
    }
    };
    if (job.record.origin === 'mobile' && requireDeps().runMobile) await requireDeps().runMobile!({ id: job.record.vaultId, name: job.record.vaultName }, run);
    else if (requireDeps().runDesktop) await requireDeps().runDesktop!(run);
    else await run();
  } finally {
    draining = false;
    const complete = deliver; deliver = null; executing = null;
    reportQueuePositions();
    notifyChange();
    complete?.();
    void drain();
  }
}

/** Test-only reset of the module-scope lane. Never called in production. */
export function __resetDeepResearchQueueForTest(): void {
  jobs.length = 0;
  deps = null;
  draining = false; executing = null; deliver = null;
  sequence = 0;
}
