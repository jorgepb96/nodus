import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../../shared/canonicalJson';

export type BridgeJobState = 'accepted' | 'running' | 'saved' | 'available' | 'failed' | 'interrupted' | 'cancelled';
export interface BridgeJobEvent { sequence: number; channel: string; args: unknown[] }
export interface BridgeJob {
  id: string; deviceGrant: string; vaultId: string; domains: string[]; method: string;
  args: unknown[]; idempotencyKey: string; payloadHash: string;
  state: BridgeJobState; createdAt: string; updatedAt: string;
  events: BridgeJobEvent[]; nextSequence: number; result?: unknown; error?: string;
  recoveryProtocol?: number; mayHaveStarted?: boolean;
}
type Runner = (job: BridgeJob, emit: (channel: string, ...args: unknown[]) => void, signal: AbortSignal) => Promise<unknown>;

/** Cancellation can also arrive through the shared Desktop research queue. */
export class BridgeJobCancelledError extends Error {}

/** Durable ownership and idempotency around typed operations. A restart never silently
 * repeats an operation that may have committed before its acknowledgement was lost. */
export class BridgeJobStore {
  private jobs = new Map<string, BridgeJob>();
  private controllers = new Map<string, AbortController>();
  constructor(private directory: string, private run: Runner, private cancelInterrupted?: (job: BridgeJob) => Promise<void>) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const file of readdirSync(directory).filter(file => /^[a-f0-9-]+\.json$/.test(file))) {
      const job = JSON.parse(readFileSync(path.join(directory, file), 'utf8')) as BridgeJob;
      if (!job.id || `${job.id}.json` !== file) throw new Error('invalid_bridge_job');
      const journal = this.eventFile(job.id);
      // Migrate the original snapshot format before any state snapshot omits events.
      if (!existsSync(journal)) writeFileSync(journal, job.events.map(event => `${JSON.stringify(event)}\n`).join(''), { mode: 0o600 });
      const contents = readFileSync(journal, 'utf8');
      const lines = contents.split('\n');
      job.events = [];
      for (let index = 0; index < lines.length; index++) {
        if (!lines[index]) continue;
        let event: BridgeJobEvent;
        try { event = JSON.parse(lines[index]); }
        catch (error) {
          // A crash may leave only the final append incomplete. Earlier corruption
          // must fail loudly rather than silently discard research progress.
          if (index === lines.length - 1) break;
          throw error;
        }
        if (event.sequence !== job.events.length + 1) throw new Error('invalid_bridge_job_events');
        job.events.push(event);
      }
      // Repair an interrupted final append before a recovered job writes again.
      // Also terminate a complete last record whose newline was lost in the crash.
      if (contents && !contents.endsWith('\n')) {
        const temporary = `${journal}.repair.tmp`;
        writeFileSync(temporary, job.events.map(event => `${JSON.stringify(event)}\n`).join(''), { mode: 0o600 });
        renameSync(temporary, journal);
      }
      job.nextSequence = job.events.length + 1;
      if (job.state === 'accepted' || job.state === 'running' || job.state === 'saved') {
        job.mayHaveStarted ||= job.state !== 'accepted';
        job.state = 'interrupted'; job.error = 'Mac restarted. Review the result before retrying.'; this.persist(job);
      }
      this.jobs.set(job.id, job);
    }
  }
  private eventFile(id: string): string { return path.join(this.directory, `${id}.events.jsonl`); }
  private persist(job: BridgeJob): void {
    job.updatedAt = new Date().toISOString();
    const file = path.join(this.directory, `${job.id}.json`);
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify({ ...job, events: [] }), { mode: 0o600 }); renameSync(temporary, file);
  }
  submit(input: Pick<BridgeJob, 'deviceGrant' | 'vaultId' | 'domains' | 'method' | 'args' | 'idempotencyKey'>): BridgeJob {
    if (!/^[a-zA-Z0-9-]{16,128}$/.test(input.idempotencyKey)) throw new Error('invalid_idempotency_key');
    const payloadHash = createHash('sha256').update(canonicalJson({ method: input.method, args: input.args })).digest('hex');
    const existing = [...this.jobs.values()].find(job => job.deviceGrant === input.deviceGrant && job.vaultId === input.vaultId && job.idempotencyKey === input.idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new Error('idempotency_conflict');
      // This typed lane links the original durable Bridge id to its saved queue
      // record. Recovery observes/resumes that record and never enqueues a duplicate.
      if (existing.state === 'interrupted' && existing.method === 'enqueueDeepResearchJob' && existing.recoveryProtocol === 1) {
        existing.error = undefined; existing.state = 'accepted'; this.persist(existing);
        setImmediate(() => void this.execute(existing));
      }
      return existing;
    }
    const job: BridgeJob = { ...input, id: randomUUID(), payloadHash, state: 'accepted', createdAt: new Date().toISOString(), updatedAt: '', events: [], nextSequence: 1,
      ...(input.method === 'enqueueDeepResearchJob' ? { recoveryProtocol: 1 } : {}) };
    writeFileSync(this.eventFile(job.id), '', { mode: 0o600 });
    this.persist(job); this.jobs.set(job.id, job);
    setImmediate(() => void this.execute(job));
    return job;
  }
  private async execute(job: BridgeJob): Promise<void> {
    if (job.state !== 'accepted') return;
    const controller = new AbortController(); this.controllers.set(job.id, controller);
    job.state = 'running'; this.persist(job);
    const emit = (channel: string, ...args: unknown[]) => {
      if (controller.signal.aborted) return;
      const event = { sequence: job.nextSequence, channel, args };
      // Deltas must not be discarded: a reconnecting reader can request the full
      // stream and then use a cursor. Persist each batch before acknowledging it.
      appendFileSync(this.eventFile(job.id), `${JSON.stringify(event)}\n`, { mode: 0o600 });
      job.events.push(event); job.nextSequence++;
      job.updatedAt = new Date().toISOString();
    };
    try {
      job.result = (await this.run(job, emit, controller.signal)) ?? null;
      job.state = 'saved'; this.persist(job);
      job.state = 'available'; this.persist(job);
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
      job.state = controller.signal.aborted || error instanceof BridgeJobCancelledError ? 'cancelled' : 'failed'; this.persist(job);
    } finally { this.controllers.delete(job.id); }
  }
  get(id: string, deviceGrant: string, vaultId: string): BridgeJob | undefined {
    const job = this.jobs.get(id);
    return job?.deviceGrant === deviceGrant && job.vaultId === vaultId ? job : undefined;
  }
  list(deviceGrant: string, vaultId: string): BridgeJob[] {
    return [...this.jobs.values()].filter(job => job.deviceGrant === deviceGrant && job.vaultId === vaultId);
  }
  cancel(id: string, deviceGrant: string, vaultId: string): BridgeJob | undefined {
    const job = this.get(id, deviceGrant, vaultId);
    if (!job) return;
    if (job.state === 'accepted') { job.state = 'cancelled'; this.persist(job); }
    if (job.state === 'interrupted') {
      job.state = 'cancelled'; this.persist(job);
      void this.cancelInterrupted?.(job).catch(error => { job.error = error instanceof Error ? error.message : String(error); this.persist(job); });
    }
    if (job.state === 'running') this.controllers.get(id)?.abort();
    return job;
  }
  revoke(deviceGrant: string): void {
    for (const job of this.jobs.values()) if (job.deviceGrant === deviceGrant) this.cancel(job.id, deviceGrant, job.vaultId);
  }
}
