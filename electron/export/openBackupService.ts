import { createAclReadPolicy } from '../db/aclReadPolicy';
import { app, utilityProcess } from 'electron';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  BackupCatalog,
  BackupCatalogQuery,
  BackupCatalogPage,
  BackupPreset,
  OpenBackupOptions,
  OpenBackupPreview,
  OpenBackupProgress,
  OpenBackupResult,
} from '@shared/backups';
import { BACKUP_CATEGORIES, defaultOpenBackupOptions } from '@shared/backups';
import { listVaults, getVault } from '../vaults/vaultRegistry';
import { LibraryDiskStore } from '../library/libraryStorage';
import { configuredLibraryRoot } from '../library/libraryPaths';
import { getSettings } from '../db/settingsRepo';
import { snapshotVaultInUtility } from './backupUtilityHost';
import { StreamingZipWriter } from './streamingZip';
import {
  backupFileStem,
  portableBackupValue,
  buildOpenBackup,
  type OpenBackupBuildInput,
} from './openBackupCore';
import {
  backupTableKey,
  backupRecordKey,
  classifyBackupTable,
  quoteSqlIdentifier,
  recordTitle,
} from './backupsRegistry';

const active = new Map<string, AbortController>();
export function validateOpenBackupOptions(input: OpenBackupOptions): OpenBackupOptions {
  if (!input || typeof input !== 'object') throw new Error('Selección de exportación no válida.');
  const defaults = defaultOpenBackupOptions('');
  if (
    !Array.isArray(input.vaultIds) ||
    (!input.vaultIds.length && !input.includeGlobalLibrary) ||
    input.vaultIds.some((id) => typeof id !== 'string' || !getVault(id))
  )
    throw new Error('La selección contiene una bóveda ausente.');
  if (
    !Array.isArray(input.categories) ||
    input.categories.some((c) => !BACKUP_CATEGORIES.some((k) => k.id === c))
  )
    throw new Error('Categorías no válidas.');
  if (
    !Array.isArray(input.formats) ||
    !input.formats.length ||
    input.formats.some((f) => !['markdown', 'csv', 'json'].includes(f))
  )
    throw new Error('Elige al menos un formato.');
  if (
    !['works', 'authors', 'ideas'].includes(input.organization) ||
    !['inline', 'separate', 'none'].includes(input.summaries) ||
    !['folder', 'zip'].includes(input.container)
  )
    throw new Error('Presentación no válida.');
  if (!input.selections || typeof input.selections !== 'object' || Array.isArray(input.selections))
    throw new Error('Selección de elementos no válida.');
  for (const [key, values] of Object.entries(input.selections))
    if (
      !(key === 'global:library_items' || input.vaultIds.some((id) => key.startsWith(id + ':'))) ||
      !Array.isArray(values) ||
      values.some((v) => typeof v !== 'string')
    )
      throw new Error('Selección de elementos no válida.');
  const result = {
    ...defaults,
    ...Object.fromEntries(Object.keys(defaults).map((key) => [key, input[key as keyof OpenBackupOptions]])),
    vaultIds: [...new Set(input.vaultIds)],
    categories: [...new Set(input.categories)],
    formats: [...new Set(input.formats)],
  };
  for (const key of Object.keys(defaults) as Array<keyof OpenBackupOptions>)
    if (typeof defaults[key] === 'boolean' && typeof result[key] !== 'boolean')
      throw new Error('Opción de contenido no válida.');
  return result;
}
function presetFile(): string {
  return path.join(app.getPath('userData'), 'backups-presets.json');
}
export function listBackupPresets(): BackupPreset[] {
  try {
    const data = JSON.parse(fs.readFileSync(presetFile(), 'utf8')) as { presets: BackupPreset[] };
    return Array.isArray(data.presets) ? data.presets : [];
  } catch {
    return [];
  }
}
export async function saveBackupPreset(preset: BackupPreset): Promise<BackupPreset[]> {
  const options = { ...validateOpenBackupOptions(preset.options), authorizePreservation: false };
  const name = String(preset.name ?? '')
    .trim()
    .slice(0, 80);
  if (!name) throw new Error('Escribe un nombre para el preset.');
  const presets = listBackupPresets().filter((p) => p.id !== preset.id);
  presets.push({ id: preset.id || randomUUID(), name, options });
  const file = presetFile();
  const tmp = file + '.tmp-' + randomUUID();
  await fs.promises.writeFile(tmp, JSON.stringify({ formatVersion: 1, presets }, null, 2), { mode: 0o600 });
  await fs.promises.rename(tmp, file);
  return presets;
}
export async function deleteBackupPreset(id: string): Promise<BackupPreset[]> {
  const presets = listBackupPresets().filter((p) => p.id !== id);
  const file = presetFile();
  const tmp = file + '.tmp-' + randomUUID();
  await fs.promises.writeFile(tmp, JSON.stringify({ formatVersion: 1, presets }, null, 2), { mode: 0o600 });
  await fs.promises.rename(tmp, file);
  return presets;
}
export function getBackupCatalog(vaultIds: string[]): BackupCatalog {
  const result: BackupCatalog = {
    vaults: listVaults().map(({ id, name, type }) => ({ id, name, type })),
    counts: {},
    tables: [],
    presets: listBackupPresets(),
  };
  for (const id of vaultIds) {
    const vault = getVault(id);
    if (!vault) throw new Error('La selección contiene una bóveda ausente.');
    const db = new Database(vault.path, { readonly: true, fileMustExist: true });
    try {
      for (const table of db.pragma('table_list') as Array<{ schema: string; name: string; type: string }>) {
        if (table.schema !== 'main') continue;
        const category = classifyBackupTable(table.name, table.type);
        if (!category) throw new Error(`Tabla sin clasificación de exportación: ${table.name}`);
        if (category === 'technical') continue;
        const { count } = db
          .prepare(`SELECT COUNT(*) AS count FROM ${quoteSqlIdentifier(table.name)}`)
          .get() as { count: number };
        if (!count) continue;
        result.tables.push({
          key: backupTableKey(id, table.name),
          name: table.name,
          category,
          count,
          vaultId: id,
        });
        result.counts[category] = (result.counts[category] ?? 0) + count;
      }
    } finally {
      db.close();
    }
  }
  const root = configuredLibraryRoot();
  if (root) {
    const count = new LibraryDiskStore(root, 'readonly')
      .scanMaterializedItems()
      .records.filter((r) => !r.deletedAt).length;
    if (count)
      result.tables.push({
        key: 'global:library_items',
        name: 'library_items',
        category: 'research',
        count,
        vaultId: 'global',
      });
  }
  return result;
}
export function getBackupCatalogRecords(query: BackupCatalogQuery): BackupCatalogPage {
  const catalog = getBackupCatalog(query.vaultIds);
  const entries: BackupCatalogPage['entries'] = [];
  const offset = Math.max(0, query.offset ?? 0),
    limit = Math.min(200, Math.max(1, query.limit ?? 60));
  const needle = (query.query ?? '').toLocaleLowerCase();
  let total = 0;
  for (const table of catalog.tables.filter(
    (t) =>
      (!query.category || t.category === query.category) && (!query.tableKey || t.key === query.tableKey),
  )) {
    if (table.vaultId === 'global') {
      const root = configuredLibraryRoot();
      const items = root
        ? new LibraryDiskStore(root, 'readonly')
            .scanMaterializedItems()
            .records.filter(
              (r) =>
                !r.deletedAt &&
                (!needle || `${r.metadata.title} ${r.id}`.toLocaleLowerCase().includes(needle)),
            )
        : [];
      const skip = Math.max(0, offset - total);
      total += items.length;
      entries.push(
        ...items
          .slice(skip, skip + limit - entries.length)
          .map((item) => ({
            key: JSON.stringify([item.id]),
            tableKey: table.key,
            table: table.name,
            category: table.category,
            vaultId: 'global',
            title: item.metadata.title,
            subtitle: 'Biblioteca global',
          })),
      );
      continue;
    }
    const vault = getVault(table.vaultId)!;
    const db = new Database(vault.path, { readonly: true, fileMustExist: true });
    try {
      const cols = db.pragma(`table_info(${quoteSqlIdentifier(table.name)})`) as Array<{
        name: string;
        type: string;
        pk: number;
      }>;
      const safeColumns = cols.filter((c) => !c.type.toUpperCase().includes('BLOB'));
      const columns = safeColumns.filter(
        (c) =>
          c.pk ||
          [
            'title',
            'label',
            'name',
            'term',
            'question',
            'file_name',
            'short_id',
            'id',
            'nodus_id',
            'global_id',
            'page_id',
            'row_id',
            'database_id',
            'note_id',
            'comment',
            'body',
            'preferred_name',
            'display_name',
            'year',
            'authors_json',
          ].includes(c.name),
      );
      if (!columns.length) columns.push(...safeColumns);
      const primary = cols
        .filter((c) => c.pk)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      const pk = primary.length ? primary : safeColumns.map((c) => c.name);
      for (const c of safeColumns) if (pk.includes(c.name) && !columns.includes(c)) columns.push(c);
      const where = needle
        ? ` WHERE ${columns.map((c) => `instr(lower(CAST(${quoteSqlIdentifier(c.name)} AS TEXT)), ?) > 0`).join(' OR ')}`
        : '';
      const params = needle ? columns.map(() => needle) : [];
      const count = (
        db.prepare(`SELECT COUNT(*) AS n FROM ${quoteSqlIdentifier(table.name)}${where}`).get(...params) as {
          n: number;
        }
      ).n;
      const skip = Math.max(0, offset - total);
      total += count;
      if (skip >= count || entries.length >= limit) continue;
      const rows = db
        .prepare(
          `SELECT ${columns.map((c) => quoteSqlIdentifier(c.name)).join(',')} FROM ${quoteSqlIdentifier(table.name)}${where} ORDER BY ${pk.map(quoteSqlIdentifier).join(',')} LIMIT ? OFFSET ?`,
        )
        .all(...params, limit - entries.length, skip) as Array<Record<string, unknown>>;
      const hasAcl = db.prepare("SELECT 1 FROM sqlite_master WHERE name='acl_entries'").get();
      const may = hasAcl ? createAclReadPolicy(db) : null;
      const rootType: Record<string, 'page' | 'database' | 'row' | 'view'> = {
        pages: 'page',
        db_databases: 'database',
        db_rows: 'row',
        db_views: 'view',
      };
      const visible = rows.filter(
        (row) =>
          !may ||
          !(rootType[table.name] || row.page_id || row.row_id || row.database_id) ||
          may(
            rootType[table.name] ?? (row.page_id ? 'page' : row.row_id ? 'row' : 'database'),
            String(
              row[
                rootType[table.name] ? 'id' : row.page_id ? 'page_id' : row.row_id ? 'row_id' : 'database_id'
              ],
            ),
          ).canView,
      );
      entries.push(
        ...visible.map((row) => ({
          key: backupRecordKey(row, pk),
          tableKey: table.key,
          table: table.name,
          category: table.category,
          vaultId: table.vaultId,
          title: recordTitle(row, table.name),
          subtitle:
            table.name === 'works'
              ? [
                  vault.name,
                  ...(Array.isArray(portableBackupValue(row.authors_json, 'authors_json'))
                    ? (portableBackupValue(row.authors_json, 'authors_json') as string[])
                    : []),
                  row.year,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : vault.name,
        })),
      );
    } finally {
      db.close();
    }
  }
  return { entries, total };
}
async function worker(
  input: OpenBackupBuildInput,
  onProgress: (p: OpenBackupProgress) => void,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof buildOpenBackup>>> {
  if (process.env.ELECTRON_RUN_AS_NODE === '1') return buildOpenBackup(input, onProgress, signal);
  const child = utilityProcess.fork(path.join(__dirname, 'openBackupWorker.js'), [], {
    serviceName: 'Nodus Backups',
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: Awaited<ReturnType<typeof buildOpenBackup>>) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      child.kill();
      if (error) reject(error);
      else resolve(result!);
    };
    const cancel = () => child.postMessage({ kind: 'cancel' });
    signal.addEventListener('abort', cancel, { once: true });
    child.on(
      'message',
      (message: {
        kind: string;
        progress?: OpenBackupProgress;
        result?: Awaited<ReturnType<typeof buildOpenBackup>>;
        error?: string;
      }) => {
        if (message.kind === 'progress') onProgress(message.progress!);
        else if (message.kind === 'done') finish(undefined, message.result);
        else finish(new Error(message.error));
      },
    );
    child.once('error', (error) => finish(new Error(String(error))));
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`El proceso de exportación terminó con código ${code}.`));
    });
    child.postMessage({ kind: 'run', input });
    if (signal.aborted) cancel();
  });
}
export function cancelOpenBackup(jobId: string): void {
  active.get(jobId)?.abort();
}
export async function runOpenBackup(
  jobId: string,
  rawOptions: OpenBackupOptions,
  outputDir: string | null,
  onProgress: (p: OpenBackupProgress) => void = () => {},
): Promise<OpenBackupResult> {
  if (typeof jobId !== 'string' || !jobId || jobId.length > 200)
    throw new Error('Identificador de exportación no válido.');
  if (active.has(jobId)) throw new Error('La exportación ya está en curso.');
  const options = validateOpenBackupOptions(rawOptions);
  const controller = new AbortController();
  active.set(jobId, controller);
  let temp: string | null = null;
  let snapshotRoot: string | null = null;
  let zip: StreamingZipWriter | null = null;
  try {
    const destination = outputDir ? path.resolve(outputDir) : app.getPath('temp');
    if (!(await fs.promises.stat(destination)).isDirectory())
      throw new Error('La carpeta de destino no está disponible.');
    temp = await fs.promises.mkdtemp(path.join(destination, '.nodus-export-'));
    snapshotRoot = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'nodus-export-snapshots-'));
    const snapshots = snapshotRoot,
      directory = path.join(temp, 'content');
    await fs.promises.mkdir(directory);
    const sources: OpenBackupBuildInput['sources'] = [];
    for (const [index, id] of options.vaultIds.entries()) {
      if (controller.signal.aborted) throw new Error('BACKUP_CANCELLED');
      const vault = getVault(id)!;
      onProgress({
        jobId,
        phase: 'snapshot',
        completed: index,
        total: options.vaultIds.length,
        message: vault.name,
      });
      const snapshotPath = path.join(snapshots, `${index}.sqlite`);
      await snapshotVaultInUtility({
        sourcePath: vault.path,
        targetPath: snapshotPath,
        cacheDir: path.join(app.getPath('userData'), '.backup-snapshot-cache'),
        vaultId: id,
      });
      sources.push({ id, name: vault.name, type: vault.type, snapshotPath });
    }
    const built = await worker(
      {
        options,
        sources,
        directory,
        libraryRoot: configuredLibraryRoot(),
        appVersion: app.getVersion(),
        jobId,
        previewOnly: outputDir === null,
        language: getSettings().uiLanguage,
      },
      onProgress,
      controller.signal,
    );
    if (controller.signal.aborted) throw new Error('BACKUP_CANCELLED');
    const { entries: _entries, ...summary } = built;
    if (!outputDir) return { ...summary, path: null, cancelled: false };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stem = `nodus-backup-${backupFileStem(sources.length === 1 ? sources[0].name : 'selection')}-${stamp}-${randomUUID().slice(0, 6)}`;
    const target = path.join(destination, stem + (options.container === 'zip' ? '.zip' : ''));
    if (options.container === 'zip') {
      const zipPath = path.join(temp, 'package.zip');
      zip = new StreamingZipWriter(zipPath);
      for (const [index, file] of built.entries.entries()) {
        if (controller.signal.aborted) throw new Error('BACKUP_CANCELLED');
        onProgress({
          jobId,
          phase: 'package',
          completed: index,
          total: built.entries.length,
          message: file.path,
        });
        await zip.addFile(file.path, path.join(directory, ...file.path.split('/')));
      }
      await zip.finalize();
      zip = null;
      await fs.promises.rename(zipPath, target);
    } else await fs.promises.rename(directory, target);
    return { ...summary, path: target, cancelled: false };
  } catch (error) {
    if (controller.signal.aborted || (error instanceof Error && error.message === 'BACKUP_CANCELLED'))
      return { path: null, cancelled: true, records: 0, files: 0, bytes: 0, sample: null, omissions: [] };
    throw error;
  } finally {
    active.delete(jobId);
    if (zip) await zip.abort();
    if (temp) await fs.promises.rm(temp, { recursive: true, force: true });
    if (snapshotRoot) await fs.promises.rm(snapshotRoot, { recursive: true, force: true });
  }
}
export async function previewOpenBackup(options: OpenBackupOptions): Promise<OpenBackupPreview> {
  return runOpenBackup(`preview-${randomUUID()}`, options, null);
}
