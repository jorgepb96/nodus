import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { ResearchPreparationAction, ResearchPreparationPolicy } from '@shared/researchCorpus';
import { DocumentaryRequests } from './documentaryRequests';
import type { EmbeddingRunReason, EmbeddingItemOutcome, EmbeddingRunCounters } from '@shared/embeddingRuns';

export interface PreparationPolicyRecord extends ResearchPreparationPolicy {
  automaticVersion?: number;
  futureAdditionsSetByUser?: boolean;
  known: string[];
  authorized: Record<string, string>;
}
export interface PreparationCampaignRow {
  id: string; vault_id: string; vault_name: string; state: 'active' | 'paused' | 'cancelled';
  configuration_json: string; created_at: number; updated_at: number;
}
/** Campaigns are authorization/interests in the existing queue, not a second executor. */
export class DocumentaryCampaigns {
  readonly requests: DocumentaryRequests;
  constructor(readonly db: Database.Database) {
    this.requests = new DocumentaryRequests(db);
    db.exec(`CREATE TABLE IF NOT EXISTS documentary_preparation_policies(vault_id TEXT PRIMARY KEY, policy_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documentary_preparation_previews(id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS documentary_campaigns(id TEXT PRIMARY KEY, vault_id TEXT NOT NULL, vault_name TEXT NOT NULL,
        state TEXT NOT NULL, configuration_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS documentary_campaign_members(campaign_id TEXT NOT NULL, job_id TEXT NOT NULL,
        document_id TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(campaign_id,job_id));
      CREATE INDEX IF NOT EXISTS documentary_campaign_interests ON documentary_campaign_members(job_id,state);
      CREATE TABLE IF NOT EXISTS documentary_campaign_audit(campaign_id TEXT PRIMARY KEY,reason TEXT NOT NULL,last_reason TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documentary_campaign_outcomes(campaign_id TEXT NOT NULL,job_id TEXT NOT NULL,outcome TEXT NOT NULL,
        provider_inputs INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(campaign_id,job_id))`);
  }
  policy(vaultId: string): PreparationPolicyRecord {
    const row = this.db.prepare('SELECT policy_json FROM documentary_preparation_policies WHERE vault_id=?').get(vaultId) as { policy_json: string } | undefined;
    return row ? JSON.parse(row.policy_json) : { vaultId, welcomeVersion: 0, decision: 'pending', futureAdditions: true, automaticVersion: 1, known: [], authorized: {} };
  }
  savePolicy(policy: PreparationPolicyRecord): void {
    this.db.prepare('INSERT INTO documentary_preparation_policies VALUES(?,?) ON CONFLICT(vault_id) DO UPDATE SET policy_json=excluded.policy_json').run(policy.vaultId, JSON.stringify(policy));
  }
  create(vaultId: string, vaultName: string, documents: Array<{ id: string; title: string; revision: string }>, configuration: unknown, reason: EmbeddingRunReason = 'manual'): string {
    return this.db.transaction(() => {
      const id = randomUUID(), now = Date.now();
      this.db.prepare("INSERT INTO documentary_campaigns VALUES(?,?,?,'active',?,?,?)").run(id, vaultId, vaultName, JSON.stringify(configuration), now, now);
      this.db.prepare('INSERT INTO documentary_campaign_audit VALUES(?,?,?)').run(id, reason, reason);
      for (const document of documents) {
        const key = `prepare:${createHash('sha256').update(JSON.stringify([document.id, document.revision, configuration])).digest('hex')}`;
        this.db.prepare("INSERT INTO documentary_campaign_members VALUES(?,?,?,?,'active')").run(id, key, document.id, document.title);
        const existing = this.db.prepare('SELECT state FROM documentary_requests WHERE document_id=?').get(key) as { state: string } | undefined;
        if (existing?.state === 'complete') this.note(key, 'reused');
        if (!existing || ['cancelled', 'failed', 'paused', 'blocked'].includes(existing.state)) {
          this.requests.enqueue(key, document.revision, vaultId, now, 0, configuration);
          this.db.prepare('UPDATE documentary_requests SET source_id=? WHERE document_id=?').run(document.id, key);
        }
      }
      const policy = this.policy(vaultId);
      for (const document of documents) policy.authorized[document.id] = document.revision;
      this.savePolicy(policy);
      return id;
    }).immediate();
  }
  list(): PreparationCampaignRow[] {
    return this.db.prepare('SELECT * FROM documentary_campaigns ORDER BY created_at DESC,id').all() as PreparationCampaignRow[];
  }
  note(jobId: string, outcome: EmbeddingItemOutcome, providerInputs = 0): void {
    this.db.prepare(`INSERT INTO documentary_campaign_outcomes(campaign_id,job_id,outcome,provider_inputs)
      SELECT m.campaign_id,m.job_id,?,? FROM documentary_campaign_members m JOIN documentary_campaigns c ON c.id=m.campaign_id
      WHERE m.job_id=? AND m.state='active' AND c.state='active'
      ON CONFLICT(campaign_id,job_id) DO UPDATE SET outcome=CASE WHEN excluded.outcome='pending' AND documentary_campaign_outcomes.outcome IN ('computed','reused')
        THEN documentary_campaign_outcomes.outcome ELSE excluded.outcome END,provider_inputs=documentary_campaign_outcomes.provider_inputs+excluded.provider_inputs`)
      .run(outcome, providerInputs, jobId);
  }
  audit(campaignId: string): EmbeddingRunCounters & { reason: EmbeddingRunReason; lastReason: EmbeddingRunReason } {
    const row = this.db.prepare('SELECT reason,last_reason FROM documentary_campaign_audit WHERE campaign_id=?').get(campaignId) as { reason: EmbeddingRunReason; last_reason: EmbeddingRunReason } | undefined;
    const counts = { reviewed: 0, reused: 0, computed: 0, excluded: 0, failed: 0, providerInputs: 0 };
    for (const entry of this.db.prepare('SELECT outcome,COUNT(*) n,SUM(provider_inputs) inputs FROM documentary_campaign_outcomes WHERE campaign_id=? GROUP BY outcome').all(campaignId) as Array<{ outcome: EmbeddingItemOutcome; n: number; inputs: number }>) {
      counts.reviewed += entry.n; counts.providerInputs += entry.inputs;
      if (entry.outcome !== 'pending') counts[entry.outcome] += entry.n;
    }
    return { ...counts, reason: row?.reason ?? 'legacy', lastReason: row?.last_reason ?? 'legacy' };
  }
  recovered(): void {
    this.db.prepare(`UPDATE documentary_campaign_audit SET last_reason='restart' WHERE campaign_id IN
      (SELECT c.id FROM documentary_campaigns c JOIN documentary_campaign_members m ON c.id=m.campaign_id
       JOIN documentary_requests r ON r.document_id=m.job_id WHERE c.state='active' AND r.state IN ('running','queued'))`).run();
  }
  retried(jobId: string): void {
    this.db.prepare("UPDATE documentary_campaign_audit SET last_reason='automatic_retry' WHERE campaign_id IN (SELECT campaign_id FROM documentary_campaign_members WHERE job_id=?)").run(jobId);
  }
  /** Reconcile aggregate interests without changing completed publications. */
  control(campaignId: string, action: ResearchPreparationAction, documentId?: string): void {
    this.db.transaction(() => {
      const campaign = this.db.prepare('SELECT * FROM documentary_campaigns WHERE id=?').get(campaignId) as PreparationCampaignRow | undefined;
      if (!campaign) throw new Error('research_campaign_not_found');
      if (action === 'resume' || action === 'retry') this.db.prepare("INSERT INTO documentary_campaign_audit VALUES(?,'legacy',?) ON CONFLICT(campaign_id) DO UPDATE SET last_reason=excluded.last_reason").run(campaignId, action);
      const state = action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'active';
      if (!documentId) this.db.prepare('UPDATE documentary_campaigns SET state=?,updated_at=? WHERE id=?').run(state, Date.now(), campaignId);
      else if (action === 'resume' || action === 'retry') this.db.prepare("UPDATE documentary_campaigns SET state='active',updated_at=? WHERE id=?").run(Date.now(), campaignId);
      else this.db.prepare('UPDATE documentary_campaigns SET updated_at=? WHERE id=?').run(Date.now(), campaignId);
      // A campaign pause is an independent interest gate. It must not erase a
      // document's explicit pause/cancellation when the campaign resumes.
      if (documentId) this.db.prepare('UPDATE documentary_campaign_members SET state=? WHERE campaign_id=? AND document_id=?').run(state, campaignId, documentId);
      else if (action === 'retry') this.db.prepare("UPDATE documentary_campaign_members SET state='active' WHERE campaign_id=? AND state IN ('blocked','cancelled')").run(campaignId);
      const members = this.db.prepare('SELECT job_id,document_id FROM documentary_campaign_members WHERE campaign_id=? AND (? IS NULL OR document_id=?)').all(campaignId, documentId ?? null, documentId ?? null) as { job_id: string; document_id: string }[];
      if (documentId && !members.length) throw new Error('research_source_not_authorized');
      for (const member of members) {
        const owner = this.activeOwner(member.job_id);
        if (owner && action === 'retry') {
          const prefix = `embedding:${member.document_id}:`;
          this.db.prepare("UPDATE documentary_requests SET state='queued',attempts=0,error=NULL,available_at=? WHERE substr(document_id,1,?)=? AND state IN ('failed','cancelled')").run(Date.now(), prefix.length, prefix);
          this.db.prepare("UPDATE documentary_jobs SET state='queued',attempts=0,error=NULL,available_at=? WHERE document_id=? AND state IN ('failed','cancelled')").run(Date.now(), member.document_id);
        }
        if (owner) {
          this.db.prepare(`UPDATE documentary_requests SET state='queued',vault_id=?,attempts=0,error=NULL,available_at=?
            WHERE document_id=? AND state IN ('paused','cancelled','blocked'${action === 'retry' ? ",'failed'" : ''})`).run(owner, Date.now(), member.job_id);
        } else {
          this.db.prepare(`UPDATE documentary_requests SET state=?,lease_token=NULL,lease_until=NULL,
            attempts=MAX(0,attempts-CASE WHEN state='running' THEN 1 ELSE 0 END),updated_at=? WHERE document_id=? AND state<>'complete'`).run(state === 'cancelled' ? 'cancelled' : 'paused', Date.now(), member.job_id);
        }
      }
    }).immediate();
  }
  blockOwner(jobId: string, vaultId: string): void {
    this.db.prepare(`UPDATE documentary_campaign_members SET state='blocked' WHERE state='active' AND job_id=? AND campaign_id IN
      (SELECT id FROM documentary_campaigns WHERE vault_id=?)`).run(jobId, vaultId);
  }
  synchronizeOwners(vaultIds: string[]): void {
    const allowed = new Set(vaultIds);
    // Missing local resources or credentials require an explicit retry. Only
    // ownership blocks can be recovered by discovering another active interest.
    for (const job of this.db.prepare("SELECT document_id FROM documentary_requests WHERE source_id IS NOT NULL AND (state='queued' OR (state='blocked' AND error='research_source_not_authorized'))").all() as { document_id: string }[]) {
      const candidates = this.db.prepare(`SELECT c.vault_id FROM documentary_campaign_members m JOIN documentary_campaigns c ON c.id=m.campaign_id
        WHERE m.job_id=? AND m.state='active' AND c.state='active' ORDER BY c.created_at,c.id`).all(job.document_id) as { vault_id: string }[];
      const owner = candidates.find(candidate => allowed.has(candidate.vault_id));
      if (owner) this.db.prepare("UPDATE documentary_requests SET vault_id=?,state='queued' WHERE document_id=?").run(owner.vault_id, job.document_id);
      else this.db.prepare("UPDATE documentary_requests SET state='blocked',error='research_source_not_authorized' WHERE document_id=?").run(job.document_id);
    }
  }
  activeOwner(jobId: string): string | null {
    const row = this.db.prepare(`SELECT c.vault_id FROM documentary_campaign_members m JOIN documentary_campaigns c ON c.id=m.campaign_id
      WHERE m.job_id=? AND m.state='active' AND c.state='active' ORDER BY c.created_at,c.id LIMIT 1`).get(jobId) as { vault_id: string } | undefined;
    return row?.vault_id ?? null;
  }
}
