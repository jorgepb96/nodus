import {createHash} from 'node:crypto';
import {getDb, withVaultDatabase} from '../db/database';
import {getVault, withOwningVault} from '../vaults/vaultRegistry';
import {getImmersionSession, setImmersionProgress, emptyImmersionProgress} from '../db/immersionRepo';
import {canonicalJson} from '../../shared/canonicalJson';
import {invalidateLiveCorpus} from './liveCorpus';
import type {ImmersionPlan, ImmersionProgress, ImmersionQuizQuestion} from '../../shared/types';

export class ImmersionProgressFailure extends Error {
  constructor(readonly status: number, readonly code: string, readonly remote?: unknown) { super(code); }
}
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const string = (value: unknown) => typeof value === 'string' ? value : '';
function questions(plan: ImmersionPlan): ImmersionQuizQuestion[] {
  return [...(plan.stations ?? []).flatMap(station => station.quiz ?? []), ...(plan.exam?.questions ?? [])];
}
/** A length-prefixed UTF-8 identity shared with Swift. A reader need not retain
 * a second, unbounded copy of the plan to synchronize their own private work. */
export function immersionProgressSourceRevision(plan: ImmersionPlan): string {
  const items = questions(plan), stations = plan.stations ?? [];
  const parts = ['nodus:immersion-progress-plan:1', string(plan.topic), string(plan.title), string(plan.language),
    string(plan.generatedAt), String(plan.minutes), String(stations.length), ...stations.map(station => string(station.id)), String(items.length)];
  for (const item of items) parts.push(string(item.id), string(item.kind), string(item.question), String(item.options?.length ?? 0),
    item.correctIndex == null ? '' : String(item.correctIndex), string(item.explanation), string(item.expected), ...(item.options ?? []).map(string));
  const hash = createHash('sha256');
  for (const part of parts) hash.update(`${Buffer.byteLength(part)}:`).update(part);
  return hash.digest('hex');
}
function snapshot(sessionId: string) {
  const row = getDb().prepare('SELECT plan_json FROM immersion_sessions WHERE id=?').get(sessionId) as {plan_json: string} | undefined;
  const session = getImmersionSession(sessionId);
  if (!row || !session) throw new ImmersionProgressFailure(404, 'immersion_unavailable');
  const plan = JSON.parse(row.plan_json) as ImmersionPlan;
  return {plan, value: {version: 1, sessionId, sourceRevision: immersionProgressSourceRevision(plan),
    progressRevision: digest(session.progress), progress: session.progress}};
}
function date(value: unknown): boolean { return value === null || typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value)); }
function validatedProgress(raw: unknown, plan: ImmersionPlan, current: ImmersionProgress): ImmersionProgress {
  const input = raw as ImmersionProgress;
  const fields = ['currentStep','furthestStep','completedSteps','answers','startedAt','finishedAt'];
  const steps = (plan.stations?.length ?? 0) + 4;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))
      || !Number.isSafeInteger(input.currentStep) || input.currentStep < 0 || input.currentStep >= steps
      || !Number.isSafeInteger(input.furthestStep) || input.furthestStep < input.currentStep || input.furthestStep >= steps
      || !Array.isArray(input.completedSteps) || new Set(input.completedSteps).size !== input.completedSteps.length
      || input.completedSteps.some(step => !Number.isSafeInteger(step) || step < 0 || step >= steps)
      || !Array.isArray(input.answers) || new Set(input.answers.map(answer => answer?.questionId)).size !== input.answers.length
      || !date(input.startedAt) || !date(input.finishedAt)) throw new ImmersionProgressFailure(400, 'invalid_immersion_progress');
  const available = new Map(questions(plan).map(question => [question.id, question]));
  const answers = input.answers.map(answer => {
    const question = available.get(answer?.questionId);
    if (!question || !answer || Object.keys(answer).some(key => !['questionId','kind','answer','correct','assessment','answeredAt'].includes(key))
        || question.kind !== answer.kind || typeof answer.answer !== 'string' || answer.answer.length > 10_000
        || typeof answer.answeredAt !== 'string' || !date(answer.answeredAt)) throw new ImmersionProgressFailure(400, 'invalid_immersion_answer');
    const legacy = current.answers.find(record => record.questionId === answer.questionId);
    if (answer.assessment != null && canonicalJson(answer) !== canonicalJson(legacy)) throw new ImmersionProgressFailure(400, 'invalid_immersion_assessment');
    if (question.kind === 'choice' && (!/^\d+$/.test(answer.answer) || Number(answer.answer) >= question.options.length)) throw new ImmersionProgressFailure(400, 'invalid_immersion_option');
    return {...answer, correct: question.kind === 'choice' ? Number(answer.answer) === question.correctIndex : null, assessment: answer.assessment ?? null};
  });
  return {...input, completedSteps: [...input.completedSteps].sort((a,b) => a-b), answers};
}
export async function readImmersionMobileProgress(vaultId: string, sessionId: string): Promise<unknown> {
  if (!getVault(vaultId)) throw new ImmersionProgressFailure(404, 'vault_not_found');
  return withVaultDatabase(vaultId, () => snapshot(sessionId).value);
}
/** Progress and the receipt commit in one vault transaction. Replaying an ACK
 * lost before a Desktop edit returns the original receipt without overwriting it. */
export async function saveImmersionMobileProgress(vaultId: string, grantId: string, sessionId: string, raw: unknown): Promise<unknown> {
  const value = raw as {version: number; id: string; sourceRevision: string; expectedProgressRevision: string | null; progress: ImmersionProgress};
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1
      || Object.keys(value).some(key => !['version','id','sourceRevision','expectedProgressRevision','progress'].includes(key))
      || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id)
      || !validHash(value.sourceRevision) || value.expectedProgressRevision !== null && !validHash(value.expectedProgressRevision)) throw new ImmersionProgressFailure(400, 'invalid_immersion_progress');
  if (!getVault(vaultId)) throw new ImmersionProgressFailure(404, 'vault_not_found');
  const payload = digest({sessionId, ...value});
  const result = await withOwningVault(vaultId, () => withVaultDatabase(vaultId, () => {
    const db = getDb();
    db.exec('CREATE TABLE IF NOT EXISTS desktop_immersion_progress_receipts (grant_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, result_json TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY(grant_id,request_id))');
    return db.transaction(() => {
      const receipt = db.prepare('SELECT payload_hash,result_json FROM desktop_immersion_progress_receipts WHERE grant_id=? AND request_id=?').get(grantId,value.id) as {payload_hash: string; result_json: string} | undefined;
      if (receipt) {
        if (receipt.payload_hash !== payload) throw new ImmersionProgressFailure(409,'idempotency_conflict');
        return JSON.parse(receipt.result_json);
      }
      const current = snapshot(sessionId);
      if (value.sourceRevision !== current.value.sourceRevision) throw new ImmersionProgressFailure(409,'immersion_plan_changed',current.value);
      // An offline first attempt has no baseline. It may only initialize an
      // untouched Mac route; existing private progress always requires review.
      const expected = value.expectedProgressRevision ?? digest(emptyImmersionProgress());
      if (expected !== current.value.progressRevision) throw new ImmersionProgressFailure(409,'immersion_progress_conflict',current.value);
      setImmersionProgress(sessionId,validatedProgress(value.progress,current.plan,current.value.progress));
      const committed = {id: value.id, snapshot: snapshot(sessionId).value};
      db.prepare('INSERT INTO desktop_immersion_progress_receipts VALUES(?,?,?,?,?)').run(grantId,value.id,payload,JSON.stringify(committed),new Date().toISOString());
      return committed;
    })();
  }));
  invalidateLiveCorpus(vaultId);
  return result;
}
