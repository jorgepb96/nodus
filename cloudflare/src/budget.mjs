import { first, HttpError } from './util.mjs';

export const DEFAULT_SYNC_BUDGET = Object.freeze({
  dailyRequests: 10000, monthlyRequests: 100000,
  dailyWork: 250000, monthlyWork: 2500000,
  dailyBytes: 1024 ** 3, monthlyBytes: 10 * 1024 ** 3,
});

function limits(env, lane) {
  const fallback = lane === 'maintenance'
    ? { dailyRequests: 100, monthlyRequests: 3100, dailyWork: 1000000, monthlyWork: 31000000, dailyBytes: 1, monthlyBytes: 1 }
    : DEFAULT_SYNC_BUDGET;
  return Object.fromEntries(Object.entries(fallback).map(([key, value]) => {
    const name = `NODUS_${lane === 'maintenance' ? 'MAINTENANCE' : 'SYNC'}_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;
    const configured = env[name] == null ? value : Number(env[name]);
    if (!Number.isSafeInteger(configured) || configured < 1) throw new HttpError(503, 'invalid_budget', `${name} must be a positive safe integer.`);
    return [key, configured];
  }));
}

// One UPSERT reserves all dimensions and both windows together. No SELECT-then-UPDATE
// race and no partial charge when one of the two windows is already full.
export async function reserveBudget(env, { requests = 0, work = 0, bytes = 0 } = {}, lane = 'sync', now = Date.now()) {
  for (const value of [requests, work, bytes]) if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid budget reservation');
  const cap = limits(env, lane);
  const day = new Date(now).toISOString().slice(0, 10); const month = day.slice(0, 7);
  const result = await first(env.DB, `INSERT INTO sync_budget
    (lane,day,month,day_requests,month_requests,day_work,month_work,day_bytes,month_bytes)
    SELECT ?1,?2,?3,?4,?4,?5,?5,?6,?6
    WHERE ?4<=?7 AND ?4<=?8 AND ?5<=?9 AND ?5<=?10 AND ?6<=?11 AND ?6<=?12
    ON CONFLICT(lane) DO UPDATE SET
      day=excluded.day,month=excluded.month,
      day_requests=(CASE WHEN day=?2 THEN day_requests ELSE 0 END)+?4,
      month_requests=(CASE WHEN month=?3 THEN month_requests ELSE 0 END)+?4,
      day_work=(CASE WHEN day=?2 THEN day_work ELSE 0 END)+?5,
      month_work=(CASE WHEN month=?3 THEN month_work ELSE 0 END)+?5,
      day_bytes=(CASE WHEN day=?2 THEN day_bytes ELSE 0 END)+?6,
      month_bytes=(CASE WHEN month=?3 THEN month_bytes ELSE 0 END)+?6
    WHERE excluded.day>=day AND excluded.month>=month
      AND (CASE WHEN day=?2 THEN day_requests ELSE 0 END)+?4<=?7
      AND (CASE WHEN month=?3 THEN month_requests ELSE 0 END)+?4<=?8
      AND (CASE WHEN day=?2 THEN day_work ELSE 0 END)+?5<=?9
      AND (CASE WHEN month=?3 THEN month_work ELSE 0 END)+?5<=?10
      AND (CASE WHEN day=?2 THEN day_bytes ELSE 0 END)+?6<=?11
      AND (CASE WHEN month=?3 THEN month_bytes ELSE 0 END)+?6<=?12
    RETURNING *`, lane, day, month, requests, work, bytes,
  cap.dailyRequests, cap.monthlyRequests, cap.dailyWork, cap.monthlyWork, cap.dailyBytes, cap.monthlyBytes);
  if (!result) throw new HttpError(429, 'sync_budget_exhausted', 'Synchronization is paused: the installation daily or monthly budget is exhausted.', { dailyOrMonthlyBudget: true });
  return result;
}

export async function admitRequest(env, request) {
  const path = new URL(request.url).pathname;
  if (['/health', '/api/health', '/source'].includes(path) || path.startsWith('/.well-known/')) return request;
  const writing = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  // Reserve a conservative per-request work allowance. Bulk publication commits
  // reserve their row-dependent cost separately, before writing anything.
  let bytes = 0;
  if (request.body) {
    const raw = request.headers.get('content-length');
    bytes = raw == null ? (/\/parts\//.test(path) ? 8 : /\/chunks\//.test(path) ? 1 : /\/objects\//.test(path) ? 128 : 8) * 1024 ** 2 : Number(raw);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 128 * 1024 ** 2) throw new HttpError(413, 'payload_too_large', 'A single request may not exceed 128 MiB; use multipart uploads.');
  }
  await reserveBudget(env, { requests: 1, work: writing ? 128 : 4, bytes });
  if (!request.body) return request;
  let received = 0;
  const stream = request.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
    received += chunk.byteLength;
    if (received > bytes) throw new HttpError(413, 'budgeted_body_exceeded', 'The body exceeds its reserved byte allowance.');
    controller.enqueue(chunk);
  } }));
  return new Request(request, { body: stream });
}
