import { getDb, withVaultDatabase, withoutDatabaseContext } from '../db/database';
import { getVaultByPath } from '../vaults/vaultRegistry';
import { currentEmbeddingConfig, embeddingTextForIdea, ideaNeedsEmbedding, updateIdeaEmbedding } from '../db/ideasRepo';
import { embedManyStrict } from './aiClient';
import { isManualAcademic } from './academicMode';
import { isMobileOperation } from '../desktopBridge/executionBoundary';

export interface ManualIndexStatus { state: 'idle' | 'queued' | 'preparing' | 'indexing' | 'ready' | 'error'; error: string | null; }
type ManualIndexRow = Parameters<typeof ideaNeedsEmbedding>[0] & Parameters<typeof embeddingTextForIdea>[0] & { global_id: string };
const jobs = new Map<string, { status: ManualIndexStatus; timer?: ReturnType<typeof setTimeout>; running: boolean; again: boolean; failures: number }>();
function currentVaultId(): string | undefined { return getVaultByPath(getDb().name)?.id; }
function jobFor(id: string) {
  let job = jobs.get(id);
  if (!job) { job = { status: { state: 'idle', error: null }, running: false, again: false, failures: 0 }; jobs.set(id, job); }
  return job;
}
// A deferred job must not retain a temporary database connection after its owner closes it.
function deferRun(id: string, delay: number): void {
  const job = jobFor(id);
  job.timer = withoutDatabaseContext(() => setTimeout(() => {
    job.timer = undefined;
    void runManualIndex(id);
  }, delay));
  job.timer.unref?.();
}
export function manualIndexStatus(): ManualIndexStatus {
  const id = currentVaultId();
  return id ? { ...jobFor(id).status } : { state: 'idle', error: null };
}
/** Debounced, vault-scoped and independent from the generative scan queue. */
export function scheduleManualIndex(retry = false): void {
  if (isMobileOperation()) return;
  if (!isManualAcademic()) return;
  const id = currentVaultId();
  if (!id) return;
  const job = jobFor(id);
  if (retry) job.failures = 0;
  if (job.running) { job.again = true; return; }
  if (job.timer) clearTimeout(job.timer);
  job.status = { state: 'queued', error: null };
  deferRun(id, 800);
}
export async function runManualIndex(id: string): Promise<void> {
  const job = jobFor(id);
  if (job.running) { job.again = true; return; }
  if (job.timer) { clearTimeout(job.timer); job.timer = undefined; }
  job.running = true;
  try {
    await withVaultDatabase(id, async () => {
      if (!isManualAcademic()) return;
      const rows = getDb().prepare(`SELECT i.* FROM ideas i WHERE i.orphaned_at IS NULL AND EXISTS (
        SELECT 1 FROM notes n WHERE json_valid(n.source_json) AND json_extract(n.source_json,'$.note')='manual-idea'
        AND json_extract(n.source_json,'$.ref')=i.global_id AND n.trashed_at IS NULL
      )`).all() as ManualIndexRow[];
      const pending = rows.filter(row => ideaNeedsEmbedding(row, embeddingTextForIdea(row)));
      if (process.env.NODUS_MANUAL_INDEX_TRACE === '1') console.info('[manual-index]', id, JSON.stringify({ rows: rows.length, pending: pending.length }));
      if (!pending.length) return;
      const config = currentEmbeddingConfig();
      if (config.provider === 'nodus') {
        job.status = { state: 'preparing', error: null };
        const { downloadNodusLocalModel } = await import('./nodusLocalAi');
        await downloadNodusLocalModel(config.model);
      }
      job.status = { state: 'indexing', error: null };
      for (const row of pending) {
        const text = embeddingTextForIdea(row);
        const [vector] = await embedManyStrict([text]);
        const current = getDb().prepare('SELECT * FROM ideas WHERE global_id=?').get(row.global_id) as typeof row | undefined;
        const now = currentEmbeddingConfig();
        const owner = getDb().prepare("SELECT 1 FROM notes WHERE json_valid(source_json) AND json_extract(source_json,'$.ref')=? AND trashed_at IS NULL").get(row.global_id);
        if (!current || !owner) continue;
        if (embeddingTextForIdea(current) !== text || config.provider !== now.provider || config.model !== now.model) {
          job.again = true; continue;
        }
        updateIdeaEmbedding(row.global_id, text, vector);
      }
    });
    job.status = { state: job.again ? 'queued' : 'ready', error: null };
    job.failures = 0;
  } catch (error) {
    job.status = { state: 'error', error: error instanceof Error ? error.message : String(error) };
    job.failures++;
    if (job.failures < 3) {
      deferRun(id, 10_000 * job.failures);
    }
  } finally {
    job.running = false;
    if (job.again) { job.again = false; if (!job.timer) deferRun(id, 800); }
  }
}
