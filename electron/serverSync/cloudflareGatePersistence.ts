import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { configureCloudflareGatePersistence, type CloudflareGateState } from './cloudflareSyncSafety';

export function initializeCloudflareGatePersistence(): void {
  const file = path.join(app.getPath('userData'), 'cloudflare-sync-gates.json');
  let state: Record<string, CloudflareGateState> = {};
  let corrupted = false;
  try {
    if (fs.existsSync(file)) state = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, CloudflareGateState>;
    if (!state || typeof state !== 'object' || Array.isArray(state)) { state = {}; corrupted = true; }
  }
  catch { state = {}; corrupted = true; }
  const keyHash = (key: string) => createHash('sha256').update(key).digest('hex');
  configureCloudflareGatePersistence({
    read(key) {
      const saved = state?.[keyHash(key)];
      if (corrupted || (saved && (!Number.isSafeInteger(saved.failures) || saved.failures < 0 || !Number.isFinite(saved.nextAttemptAt) || typeof saved.stopped !== 'boolean'))) return { failures: 5, nextAttemptAt: 0, stopped: true };
      return saved;
    },
    write(key, value) {
      state[keyHash(key)] = value;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
      corrupted = false;
    },
  });
}
