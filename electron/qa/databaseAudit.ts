import fs from 'node:fs';
import path from 'node:path';

export type QaDatabaseAccess = 'initialize' | 'read-write' | 'read-only' | 'import' | 'snapshot';

function canonicalizeWithMissingTail(input: string): string {
  let cursor = path.resolve(input);
  const missing: string[] = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  return path.join(fs.realpathSync.native(cursor), ...missing);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(canonicalizeWithMissingTail(root), canonicalizeWithMissingTail(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Records every SQLite file opened by a notion-parity run.
 *
 * This is deliberately inert outside QA. When QA is enabled it is also a fail-closed
 * guard: a bad profile, audit log, or database path aborts before the test can keep using
 * a real user vault. The runner independently applies the same containment rule before
 * launching Electron, so a regression on either side is caught by the other.
 */
export function auditQaDatabaseOpen(databasePath: string, access: QaDatabaseAccess): void {
  const qaRoot = process.env.NODUS_QA_ROOT;
  const auditFile = process.env.NODUS_QA_DATABASE_AUDIT_LOG;
  if (!qaRoot && !auditFile) return;
  if (!qaRoot || !auditFile) throw new Error('QA de bases de datos incompleto: faltan NODUS_QA_ROOT o NODUS_QA_DATABASE_AUDIT_LOG.');

  const profile = process.env.NODUS_USERDATA;
  if (!profile || !isInside(qaRoot, profile)) {
    throw new Error(`QA abortado: el perfil no está dentro del directorio autorizado (${qaRoot}).`);
  }
  if (!isInside(profile, databasePath)) {
    throw new Error(`QA abortado: se intentó abrir una base fuera del perfil aislado (${databasePath}).`);
  }
  if (!isInside(profile, auditFile)) {
    throw new Error(`QA abortado: el registro de bases no está dentro del perfil aislado (${auditFile}).`);
  }
  if (process.env.NODUS_SUPPORT_INTERACTIVE === '1' || process.env.NODUS_SUPPORT_PROBE === '1') {
    for (const file of [databasePath,`${databasePath}-wal`,`${databasePath}-shm`]) {
      if (fs.existsSync(file) && (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).nlink > 1)) throw new Error('Support databases must be independent copies');
    }
  }

  fs.mkdirSync(path.dirname(auditFile), { recursive: true });
  fs.appendFileSync(
    auditFile,
    `${JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      access,
      path: canonicalizeWithMissingTail(databasePath),
    })}\n`,
    'utf8',
  );
}
