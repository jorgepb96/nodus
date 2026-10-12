import fs from 'node:fs';
import path from 'node:path';

let sequence = 0;

/** Diagnostic, off unless NODUS_ROUTE_DUMP_DIR is set: the exact input of a chemistry tool call, one
 *  JSON file per call, so a slow or failing check can be replayed outside the app — no model, no key,
 *  no network — on the real route that produced it. Best effort: a failed write never affects the run. */
export function dumpToolInput(tool: string, input: unknown): void {
  const dir = process.env.NODUS_ROUTE_DUMP_DIR;
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    sequence += 1;
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(sequence).padStart(4, '0')}-${tool}.json`;
    fs.writeFileSync(path.join(dir, name), JSON.stringify({ tool, input }, null, 1));
  } catch { /* diagnostic only */ }
}
