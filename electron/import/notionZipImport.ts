import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';

import type { DatabaseColumnType } from '@shared/databases';
import { buildCsvImportPlan } from '@shared/databaseCsv';
import type { NotionImportNotice, NotionImportReport } from '@shared/notionImport';
import { markdownToPageBlocks } from '@shared/pages';
import { parseCsv, detectDelimiter } from '../extraction/tabular';
import { getDb } from '../db/database';
import { createDatabaseFromCsv, listRows } from '../db/databasesRepo';
import {
  createPage,
  getPageDocumentForRow,
  replacePageFromMarkdown,
  storePageAsset,
} from '../db/pagesRepo';

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 100_000;
const MAX_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024;
const NOTION_ID_SUFFIX = /(?:\s+|_)[0-9a-f]{32}$/i;
const SAFE_URL = /^(?:https?:|mailto:|tel:|nodus:|nodus-blob:|#)/i;

interface Entry {
  name: string;
  bytes: Buffer;
}

function cleanEntryName(value: string): string {
  const replaced = value.replace(/\\/g, '/').normalize('NFC');
  if (!replaced || replaced.includes('\0') || replaced.startsWith('/') || /^[a-z]:\//i.test(replaced)) {
    throw new Error('El ZIP contiene una ruta absoluta no permitida.');
  }
  const normalized = path.posix.normalize(replaced);
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('El ZIP intenta salir de su directorio.');
  return normalized.replace(/^\.\//, '');
}

function titleOf(name: string): string {
  const base = path.posix.basename(name, path.posix.extname(name));
  return base.replace(NOTION_ID_SUFFIX, '').trim() || 'Página sin título';
}

function comparable(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

function mimeFor(name: string): string | null {
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
    '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[path.posix.extname(name).toLowerCase()] ?? null;
}

function decodeLink(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function loadEntries(zipPath: string): Map<string, Entry> {
  const stat = fs.statSync(zipPath);
  if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES) throw new Error('El ZIP de Notion no es válido o supera 2 GB.');
  const archive = new AdmZip(zipPath);
  const source = archive.getEntries();
  if (source.length > MAX_ENTRIES) throw new Error('El ZIP contiene demasiados archivos.');
  let total = 0;
  const entries = new Map<string, Entry>();
  for (const item of source) {
    if (item.isDirectory) continue;
    const name = cleanEntryName(item.entryName);
    const size = Number(item.header.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('El ZIP contiene un tamaño no válido.');
    total += size;
    if (total > MAX_UNCOMPRESSED_BYTES) throw new Error('El ZIP supera 8 GB descomprimido.');
    if (entries.has(name)) throw new Error(`El ZIP repite la ruta «${name}».`);
    entries.set(name, { name, bytes: item.getData() });
  }
  return entries;
}

function addNotice(notices: NotionImportNotice[], kind: NotionImportNotice['kind'], source: string, detail: string, count = 1): void {
  const existing = notices.find((item) => item.kind === kind && item.source === source && item.detail === detail);
  if (existing) existing.count += count;
  else notices.push({ kind, source, detail, count });
}

function databaseFolder(csvName: string): string {
  const directory = path.posix.dirname(csvName);
  const stem = path.posix.basename(csvName, path.posix.extname(csvName));
  return directory === '.' ? stem : `${directory}/${stem}`;
}

function rowMarkdownCandidates(csvName: string, markdown: Entry[]): Entry[] {
  const folder = databaseFolder(csvName);
  return markdown.filter((entry) => entry.name.startsWith(`${folder}/`));
}

function rewriteAssets(
  markdown: string,
  markdownName: string,
  entries: Map<string, Entry>,
  seenHashes: Set<string>,
  metrics: { assets: number; deduplicated: number },
  notices: NotionImportNotice[],
): string {
  const directory = path.posix.dirname(markdownName);
  const replace = (_whole: string, prefix: string, rawTarget: string, suffix: string) => {
    if (SAFE_URL.test(rawTarget)) return `${prefix}${rawTarget}${suffix}`;
    const withoutAnchor = rawTarget.split('#')[0].split('?')[0];
    // A link that resolves outside the export (root-relative, or `..` above the ZIP root) is
    // just a link that is not in this ZIP. cleanEntryName throws for those, and that throw
    // used to roll back the whole import over a single dead link in one page.
    let resolved: string;
    try {
      resolved = cleanEntryName(path.posix.join(directory === '.' ? '' : directory, decodeLink(withoutAnchor)));
    } catch {
      addNotice(notices, 'omitted', markdownName, `No se encontró el archivo enlazado «${rawTarget}».`);
      return `${prefix}${rawTarget}${suffix}`;
    }
    const asset = entries.get(resolved);
    if (!asset) {
      addNotice(notices, 'omitted', markdownName, `No se encontró el archivo enlazado «${rawTarget}».`);
      return `${prefix}${rawTarget}${suffix}`;
    }
    const stored = storePageAsset({ name: path.posix.basename(resolved), mimeType: mimeFor(resolved), bytes: asset.bytes });
    metrics.assets++;
    if (seenHashes.has(stored.blobHash)) metrics.deduplicated++;
    seenHashes.add(stored.blobHash);
    return `${prefix}nodus-blob://${stored.blobHash}${suffix}`;
  };
  // Notion emits ordinary Markdown images/files. Keep labels and optional titles intact.
  return markdown
    .replace(/(!?\[[^\]]*\]\()([^)\s]+)([^)]*\))/g, replace)
    .replace(/(<(?:img|audio|video)\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/gi, replace);
}

function notionPropertyTypes(headers: string[], suggested: DatabaseColumnType[]): DatabaseColumnType[] {
  const types = suggested.map((type, index): DatabaseColumnType => {
    const header = headers[index].normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    if (/^(status|estado|statut|stato)$/.test(header)) return 'status';
    if (/^(tags?|etiquetas?|labels?|categorias?|categories)$/.test(header)) return 'multi_select';
    if (/^(persona|person|people|assignee|responsable|owner)$/.test(header)) return 'person';
    if (/^(email|correo|e-mail)$/.test(header)) return 'email';
    if (/^(url|link|enlace|website|web)$/.test(header)) return 'url';
    if (/^(files?|archivos?|attachments?|adjuntos?)$/.test(header)) return 'files';
    return type;
  });
  return ensureTitleType(types);
}

function ensureTitleType(types: DatabaseColumnType[]): DatabaseColumnType[] {
  const copy = [...types];
  const firstTitle = copy.indexOf('title');
  if (firstTitle === -1 && copy.length) copy[0] = 'title';
  for (let index = 0; index < copy.length; index++) if (copy[index] === 'title' && index !== (firstTitle < 0 ? 0 : firstTitle)) copy[index] = 'rich_text';
  return copy;
}

/** Import one standard Notion Markdown/CSV export without ever extracting it to disk. */
export function importNotionZip(zipPath: string): NotionImportReport {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const entries = loadEntries(zipPath);
  const csvEntries = [...entries.values()].filter((entry) => entry.name.toLowerCase().endsWith('.csv'));
  const markdownEntries = [...entries.values()].filter((entry) => entry.name.toLowerCase().endsWith('.md'));
  const notices: NotionImportNotice[] = [];
  const usedMarkdown = new Set<string>();
  const seenHashes = new Set<string>();
  const metrics = { databases: 0, rows: 0, pages: 0, rowPages: 0, assets: 0, deduplicated: 0 };
  const createdDatabaseIds: string[] = [];
  const createdPageIds: string[] = [];

  const run = getDb().transaction(() => {
    for (const csv of csvEntries) {
      const parsed = parseCsv(csv.bytes.toString('utf8'), detectDelimiter(csv.bytes.toString('utf8')));
      const plan = buildCsvImportPlan(parsed);
      if (!plan.headers.length) {
        addNotice(notices, 'omitted', csv.name, 'El CSV no contiene cabeceras.');
        continue;
      }
      const types = notionPropertyTypes(plan.headers, plan.suggestedTypes);
      const database = createDatabaseFromCsv(titleOf(csv.name), plan.headers, plan.rows, types);
      createdDatabaseIds.push(database.id);
      metrics.databases++;
      metrics.rows += plan.rows.length;
      addNotice(notices, 'transformed', csv.name, `${plan.headers.length} propiedades convertidas a tipos de Nodus.`, plan.headers.length);

      const candidates = rowMarkdownCandidates(csv.name, markdownEntries);
      const byTitle = new Map<string, Entry[]>();
      for (const entry of candidates) {
        const key = comparable(titleOf(entry.name));
        const list = byTitle.get(key) ?? [];
        list.push(entry);
        byTitle.set(key, list);
      }
      const rows = listRows(database.id, { sort: 'position', limit: plan.rows.length });
      for (let index = 0; index < rows.length; index++) {
        const rawTitle = plan.rows[index]?.[0] ?? '';
        const candidate = byTitle.get(comparable(rawTitle))?.find((entry) => !usedMarkdown.has(entry.name));
        if (!candidate) continue;
        usedMarkdown.add(candidate.name);
        const rewritten = rewriteAssets(candidate.bytes.toString('utf8'), candidate.name, entries, seenHashes, metrics, notices);
        const document = getPageDocumentForRow(rows[index].id);
        if (!document) throw new Error('No se pudo crear la página universal de una fila importada.');
        const result = replacePageFromMarkdown(document.page.id, rewritten, document.revision, 'notion-import');
        if (!result.ok) throw new Error('La página de una fila cambió durante la importación.');
        metrics.rowPages++;
      }
    }

    // Markdown not consumed as database-row content becomes a standalone page tree.
    const standalone = markdownEntries.filter((entry) => !usedMarkdown.has(entry.name))
      .sort((left, right) => left.name.split('/').length - right.name.split('/').length || left.name.localeCompare(right.name));
    const pageByStem = new Map<string, string>();
    for (const entry of standalone) {
      const stem = entry.name.slice(0, -path.posix.extname(entry.name).length);
      let parentPageId: string | null = null;
      let ancestor = path.posix.dirname(stem);
      while (ancestor !== '.' && ancestor !== '/') {
        if (pageByStem.has(ancestor)) { parentPageId = pageByStem.get(ancestor)!; break; }
        ancestor = path.posix.dirname(ancestor);
      }
      const rewritten = rewriteAssets(entry.bytes.toString('utf8'), entry.name, entries, seenHashes, metrics, notices);
      const document = createPage({
        title: titleOf(entry.name),
        parentPageId,
        blocks: markdownToPageBlocks(rewritten),
        actorId: 'notion-import',
      });
      pageByStem.set(stem, document.page.id);
      // A Notion child directory has the same stem as its parent Markdown file.
      pageByStem.set(`${path.posix.dirname(stem) === '.' ? '' : `${path.posix.dirname(stem)}/`}${path.posix.basename(stem)}`, document.page.id);
      createdPageIds.push(document.page.id);
      metrics.pages++;
    }
  });
  run();

  addNotice(notices, 'unavailable', 'Notion export', 'Los permisos, comentarios, historial y automatizaciones no forman parte del ZIP estándar.');
  const finished = Date.now();
  return {
    format: 'nodus.notion-import-report', formatVersion: 1, sourceFile: path.basename(zipPath),
    startedAt, finishedAt: new Date(finished).toISOString(), durationMs: finished - started,
    databases: metrics.databases, rows: metrics.rows, pages: metrics.pages, rowPages: metrics.rowPages,
    assets: metrics.assets, deduplicatedAssets: metrics.deduplicated,
    createdDatabaseIds, createdPageIds, notices,
  };
}
