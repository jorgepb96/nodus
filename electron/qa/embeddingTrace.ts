import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** Content-bearing traces are opt-in and confined to a marked disposable profile. */
export function recordEmbeddingTrace(event: Record<string, unknown>): void {
  if (process.env.NODUS_EMBEDDING_QA_TRACE !== '1' || !process.env.NODUS_ISOLATED_ROOT) return;
  const root = fs.realpathSync(process.env.NODUS_ISOLATED_ROOT);
  const marker = JSON.parse(fs.readFileSync(path.join(root, 'isolation.json'), 'utf8'));
  if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== root) throw new Error('Invalid trace isolation');
  const folder = app.getPath('userData');
  if (!folder.startsWith(root + path.sep)) throw new Error('Trace profile outside isolated root');
  fs.appendFileSync(path.join(folder, 'embedding-trace.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', { mode: 0o600 });
}
