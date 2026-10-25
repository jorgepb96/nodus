import { clearActiveEmbeddingFamilies } from './embeddingIndexesRepo';
import fs from 'node:fs';
import { dbPath, getDb, SCHEMA_VERSION } from './database';
import type { StudyDataMaintenanceResult, StudyDataOverview } from '@shared/types';

type CountRow = { value: number | null };

function scalar(sql: string): number {
  return Number((getDb().prepare(sql).get() as CountRow | undefined)?.value ?? 0);
}

function fileSize(file: string): number {
  try { return fs.statSync(file).size; } catch { return 0; }
}

function studyTablesWith(column: string): string[] {
  const db = getDb();
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'study\\_%' ESCAPE '\\'").all() as { name: string }[])
    .map((row) => row.name).filter((name) => /^study_[A-Za-z0-9_]+$/.test(name));
  return tables.filter((table) => (db.pragma(`table_info("${table}")`) as { name: string }[]).some((info) => info.name === column));
}

export function getStudyDataOverview(): StudyDataOverview {
  const db = getDb();
  const file = dbPath();
  const quick = db.pragma('quick_check') as { quick_check: string }[];
  const foreignKeys = db.pragma('foreign_key_check') as Array<{ table: string; rowid: number; parent: string; fkid: number }>;
  const tables = studyTablesWith('id');
  const rows = tables.reduce((sum, table) => sum + scalar(`SELECT COUNT(*) AS value FROM "${table}"`), 0);
  const trashRows = studyTablesWith('deleted_at').reduce((sum, table) => sum + scalar(`SELECT COUNT(*) AS value FROM "${table}" WHERE deleted_at IS NOT NULL`), 0);
  return {
    schemaVersion: Number(db.pragma('user_version', { simple: true })),
    expectedSchemaVersion: SCHEMA_VERSION,
    databaseBytes: fileSize(file) + fileSize(`${file}-wal`) + fileSize(`${file}-shm`),
    materialBytes: scalar('SELECT COALESCE(SUM(length(content_blob)), 0) AS value FROM study_materials'),
    recordingBytes: scalar('SELECT COALESCE(SUM(length(audio_blob)), 0) AS value FROM study_recordings'),
    embeddingBytes: scalar('SELECT COALESCE(SUM(length(embedding)), 0) AS value FROM embedding_read_study_docs AS study_docs')
      + scalar('SELECT COALESCE(SUM(length(embedding)), 0) AS value FROM embedding_read_study_materials AS study_materials')
      + scalar('SELECT COALESCE(SUM(length(embedding)), 0) AS value FROM embedding_read_study_ideas AS study_ideas'),
    studyRows: rows,
    trashRows,
    integrityOk: quick.length === 1 && quick[0]?.quick_check === 'ok',
    integrityMessages: quick.map((row) => row.quick_check),
    foreignKeyErrors: foreignKeys.map((row) => `${row.table}#${row.rowid} → ${row.parent} (${row.fkid})`),
    journalMode: String(db.pragma('journal_mode', { simple: true })),
    lastCheckedAt: new Date().toISOString(),
  };
}

export function rebuildStudyIndexes(): StudyDataMaintenanceResult {
  const db = getDb();
  db.exec('REINDEX; ANALYZE;');
  db.pragma('optimize');
  return { ok: true, changedRows: 0, message: 'Índices reconstruidos y planificador SQLite optimizado.' };
}

export function clearStudyEmbeddingCache(): StudyDataMaintenanceResult {
  const db = getDb();
  const changedRows = clearActiveEmbeddingFamilies(db, ['study_docs', 'study_materials', 'study_ideas', 'study_search']);
  return { ok: true, changedRows, message: `${changedRows} embeddings locales eliminados. Se regenerarán cuando vuelvas a indexar.` };
}

export function emptyStudyTrash(): StudyDataMaintenanceResult {
  const db = getDb();
  const tables = studyTablesWith('deleted_at');
  let changedRows = 0;
  const tx = db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    // Children first reduces cascading work; deferred checks protect every
    // remaining cross-reference until the atomic operation completes.
    for (const table of [...tables].reverse()) changedRows += db.prepare(`DELETE FROM "${table}" WHERE deleted_at IS NOT NULL`).run().changes;
  });
  tx();
  db.pragma('wal_checkpoint(TRUNCATE)');
  return { ok: true, changedRows, message: changedRows ? `${changedRows} elementos eliminados definitivamente.` : 'La papelera ya estaba vacía.' };
}

export function repairStudyData(): StudyDataMaintenanceResult {
  const before = getStudyDataOverview();
  if (!before.integrityOk) {
    return { ok: false, changedRows: 0, message: `SQLite detectó daños: ${before.integrityMessages.join('; ')}. Exporta una copia y restaura desde el último backup válido.` };
  }
  if (before.foreignKeyErrors.length) {
    return { ok: false, changedRows: 0, message: `Hay ${before.foreignKeyErrors.length} referencias huérfanas. No se modifican automáticamente para evitar pérdida de datos.` };
  }
  return rebuildStudyIndexes();
}

export function buildStudyDiagnostic(): Record<string, unknown> {
  const overview = getStudyDataOverview();
  return {
    format: 'nodus-study-diagnostic', version: 1, generatedAt: new Date().toISOString(),
    overview,
    tables: (getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'study\\_%' ESCAPE '\\' ORDER BY name").all() as { name: string }[])
      .map(({ name }) => ({ name, rows: scalar(`SELECT COUNT(*) AS value FROM "${name}"`) })),
  };
}
