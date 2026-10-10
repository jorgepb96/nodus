import type Database from 'better-sqlite3';

const active = new Map<string, number>();
const waits = new Map<Database.Database, number>();

/** Also protects connections opened when the user switches vaults during import. */
export function protectReplicaImportWait(connection: Database.Database): void {
  if (!connection.open || !active.has(connection.name)) return;
  let previous = waits.get(connection);
  if (previous === undefined) {
    previous = Number(connection.pragma('busy_timeout', { simple: true }));
    waits.set(connection, previous);
  }
  connection.pragma(`busy_timeout = ${Math.min(previous, 50)}`);
}

export function beginReplicaImportWait(file: string, connections: Database.Database[]): () => void {
  active.set(file, (active.get(file) ?? 0) + 1);
  for (const connection of connections) protectReplicaImportWait(connection);
  let finished = false;
  return () => {
    if (finished) return; finished = true;
    const remaining = (active.get(file) ?? 1) - 1;
    if (remaining > 0) { active.set(file, remaining); return; }
    active.delete(file);
    for (const [connection, previous] of waits) {
      if (connection.name !== file) continue;
      if (connection.open) connection.pragma(`busy_timeout = ${previous}`);
      waits.delete(connection);
    }
  };
}
