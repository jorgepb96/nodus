import { all, run, nowIso, randomId } from './util.mjs';

// Queue BEFORE putting bytes, then remove this job in the same D1 transaction that
// acquires the reference. Crashes anywhere in between leave a durable cleanup job.
export async function stageObject(env, prefix) {
  const key = `${prefix}/${randomId('obj_')}`;
  await queueObject(env, key, Date.now() + 86400_000);
  return key;
}
export async function queueObject(env, key, notBefore = Date.now()) {
  await run(env.DB, `INSERT OR IGNORE INTO r2_delete_queue(object_key,not_before,created_at) VALUES(?1,?2,?3)`, key, nowIso(notBefore), nowIso());
}
export async function drainObjectQueue(env, now = Date.now()) {
  const jobs = await all(env.DB, 'SELECT object_key,attempts FROM r2_delete_queue WHERE not_before<=?1 ORDER BY not_before LIMIT 10000', nowIso(now));
  if (!jobs.length) return { removed: 0 };
  const keys = jobs.map((job) => job.object_key);
  try {
    for (let offset=0;offset<keys.length;offset+=1000) await env.OBJECTS.delete(keys.slice(offset,offset+1000));
    await run(env.DB, 'DELETE FROM r2_delete_queue WHERE object_key IN (SELECT value FROM json_each(?1))', JSON.stringify(keys));
    return { removed: keys.length };
  } catch {
    // One attempt per maintenance run; no retry loop. Deleting a key twice is safe.
    const delay = Math.min(7 * 86400_000, 3600_000 * 2 ** Math.min(8, Math.max(...jobs.map((job) => Number(job.attempts)))));
    await run(env.DB, `UPDATE r2_delete_queue SET attempts=attempts+1,not_before=?1
      WHERE object_key IN (SELECT value FROM json_each(?2))`, nowIso(now + delay), JSON.stringify(keys));
    return { removed: 0, pending: keys.length };
  }
}
