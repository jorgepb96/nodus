import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { createAclReadPolicy } from '../db/aclReadPolicy';
import * as Y from 'yjs';
import { readPageNativeDocument, readPageAcademicMetadata } from '@shared/pageYjs';
import { academicMarkdownProjection } from '@shared/academicProjection';
import { zoteroSelectUrl } from '@shared/pageLocation';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  OpenBackupOptions,
  OpenBackupPreview,
  OpenBackupProgress,
  BackupCategory,
} from '@shared/backups';
import { pageBlocksToMarkdown } from '@shared/pages';
import { blockNoteToMarkdown } from '@shared/blockNoteDocument';
import { decidePrimarySourcePolicy } from '@shared/primarySourcesTypes';
import { evaluateAccess, pendingAccessContext, type AccessContext } from '@shared/testimonyAccess';
import {
  classifyBackupTable,
  isBackupHistoryTable,
  backupRecordKey,
  backupTableKey,
  quoteSqlIdentifier,
  recordTitle,
} from './backupsRegistry';
import { LibraryDiskStore } from '../library/libraryStorage';
import { openBackupLabels, type OpenBackupLabels } from './openBackupLabels';
import type { AppLanguage } from '@shared/types';

type Row = Record<string, unknown>;
export interface BackupSource {
  id: string;
  name: string;
  type: string;
  snapshotPath: string;
}
export interface OpenBackupBuildInput {
  options: OpenBackupOptions;
  sources: BackupSource[];
  directory: string;
  libraryRoot: string | null;
  appVersion: string;
  jobId: string;
  previewOnly?: boolean;
  /** Interface language of whoever exports: names the README, headings and omissions. */
  language?: AppLanguage;
}
interface Table {
  name: string;
  category: BackupCategory;
  pk: string[];
  rows: Row[];
  references: Array<{ column: string; table: string; target: string }>;
}
interface OutputFile {
  path: string;
  bytes: number;
  sha256: string;
}
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const text = (v: unknown): string =>
  typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const mdLabel = (v: unknown) =>
  text(v)
    .replace(/[\\`*_[\]<>#]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ');
export function backupFileStem(value: string): string {
  const clean = Buffer.from(value, 'utf8')
    .toString('utf8')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*]/g, '-');
  let stem = '';
  let characters = 0;
  for (const character of clean) {
    const next = character.codePointAt(0)! < 32 ? '-' : character;
    if (characters >= 70 || Buffer.byteLength(stem + next) > 180) break;
    stem += next;
    characters++;
  }
  stem = stem.replace(/[. ]+$/g, '') || 'sin-titulo';
  return /^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(stem) ? `_${stem}` : stem;
}
function backupAttachmentName(value: string): string {
  const leaf = value.replace(/\\/g, '/').split('/').pop() || 'archivo';
  const extension = path.posix.extname(leaf);
  return extension && extension.length <= 16
    ? `${backupFileStem(leaf.slice(0, -extension.length))}${extension.replace(/[<>:"/\\|?*]/g, '-')}`
    : backupFileStem(leaf);
}
const recordStem = (row: Row, table: Table): string =>
  `${backupFileStem(recordTitle(row, table.name))}-${hash(backupRecordKey(row, table.pk)).slice(0, 12)}`;
export function backupCsv(rows: Row[], columns: string[]): string {
  const cell = (v: unknown) =>
    `"${(typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/"/g, '""')}"`;
  return (
    '\uFEFF' +
    [columns.map(cell).join(','), ...rows.map((row) => columns.map((c) => cell(row[c])).join(','))].join(
      '\r\n',
    ) +
    '\r\n'
  );
}
export function portableBackupValue(value: unknown, key = ''): unknown {
  if (Buffer.isBuffer(value)) return undefined;
  if (typeof value === 'string' && /(?:_json|Json)$/.test(key)) {
    try {
      return portableBackupValue(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map((v) => portableBackupValue(v));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, portableBackupValue(v, k)]));
  return value;
}
function scrubConnectionCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubConnectionCredentials);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/^(providerKeys|mcpToken|apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|authorization|password|secrets|credentials|token)$/i.test(
              key,
            ),
        )
        .map(([key, item]) => [key, scrubConnectionCredentials(item)]),
    );
  return value;
}
const excludedColumn = (c: string) =>
  /^(embedding|embedding_blob|vector|vector_blob|access_token|refresh_token|api_key|mcp_token|password_hash|token_hash)$/i.test(
    c,
  );
export function readBackupTables(db: Database.Database): Table[] {
  const tables = db.pragma('table_list') as Array<{ schema: string; name: string; type: string }>;
  return tables
    .filter((t) => t.schema === 'main')
    .flatMap((t) => {
      const category = classifyBackupTable(t.name, t.type);
      if (!category) throw new Error(`Tabla sin clasificación de exportación: ${t.name}`);
      if (category === 'technical') return [];
      const cols = db.pragma(`table_info(${quoteSqlIdentifier(t.name)})`) as Array<{
        name: string;
        pk: number;
        type: string;
      }>;
      const pk = cols
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      const columns = cols.filter((c) => !excludedColumn(c.name)).map((c) => c.name);
      const fields = columns.flatMap((c) => {
        const q = quoteSqlIdentifier(c);
        return [
          `CASE WHEN typeof(${q})='blob' THEN NULL ELSE ${q} END AS ${q}`,
          `CASE WHEN typeof(${q})='blob' THEN length(${q}) ELSE NULL END AS ${quoteSqlIdentifier('__blob_' + c)}`,
        ];
      });
      const rows: Row[] = [];
      for (const row of db
        .prepare(`SELECT ${fields.join(',')} FROM ${quoteSqlIdentifier(t.name)}`)
        .iterate() as Iterable<Row>) {
        for (const c of columns) {
          const size = row['__blob_' + c];
          delete row['__blob_' + c];
          if (typeof size === 'number') row[c] = { __backupBlob: c, size };
        }
        if (typeof row.blob_hash === 'string' && tables.some((t) => t.name === 'db_blobs')) {
          const blob = db.prepare('SELECT bytes FROM db_blobs WHERE hash = ?').get(row.blob_hash) as
            | { bytes: number }
            | undefined;
          if (blob)
            row.blob = {
              __backupBlob: 'data',
              size: blob.bytes,
              table: 'db_blobs',
              keys: ['hash'],
              values: [row.blob_hash],
            };
        }
        rows.push(row);
      }
      const foreign = db.pragma(`foreign_key_list(${quoteSqlIdentifier(t.name)})`) as Array<{
        from: string;
        table: string;
        to: string;
      }>;
      return [
        {
          name: t.name,
          category,
          pk: pk.length
            ? pk
            : cols
                .filter((c) => !c.type.toUpperCase().includes('BLOB') && !excludedColumn(c.name))
                .map((c) => c.name),
          rows,
          references: foreign.map((f) => ({ column: f.from, table: f.table, target: f.to })),
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
function tableEnabled(t: Table, o: OpenBackupOptions): boolean {
  if (!o.categories.includes(t.category) || (!o.includeHistory && isBackupHistoryTable(t.name))) return false;
  if (o.summaries === 'none' && t.name === 'work_summaries') return false;
  if (
    !o.includeIdeas &&
    /^(ideas|idea_occurrences|idea_theme_links|document_idea_links|work_idea_synthesis)$/.test(t.name)
  )
    return false;
  if (
    !o.includeEvidence &&
    /^(evidence|passages|passage_publications|document_profile_support)$/.test(t.name)
  )
    return false;
  if (!o.includeThemes && /^(themes|work_themes|idea_theme_links)$/.test(t.name)) return false;
  if (!o.includeRelations && /^(edges|author_relations|edge_feedback|external_refs)$/.test(t.name))
    return false;
  if (
    !o.includeSyntheses &&
    /^(author_dossier_synthesis|work_idea_synthesis|synthesis_matrix_cell)$/.test(t.name)
  )
    return false;
  return true;
}
function enforcePolicies(
  tables: Table[],
  omissions: string[],
  options: OpenBackupOptions,
  previewOnly: boolean,
  L: OpenBackupLabels,
): boolean {
  let required = false;
  const by = new Map(tables.map((t) => [t.name, t]));
  const blocked = new Set<string>();
  for (const row of by.get('archive_item_profiles')?.rows ?? []) {
    const decision = decidePrimarySourcePolicy({
      accessStatus: row.access_status as 'open',
      sensitivity: row.sensitivity as 'normal',
      action: 'export_file',
      embargoUntil: text(row.embargo_until) || null,
    });
    const inScope =
      (options.categories.includes('archive') &&
        (by.get('archive_items')?.rows ?? []).some((r) => r.item_id === row.item_id)) ||
      (options.categories.includes('research') &&
        (by.get('works')?.rows ?? []).some((r) => r.nodus_id === row.item_id));
    if (decision.decision === 'confirm' && !options.authorizePreservation && inScope) {
      required = true;
      if (!previewOnly) throw new Error('Confirma la exportación de los materiales seleccionados.');
    }
    if (
      decision.decision !== 'allow' &&
      !(decision.decision === 'confirm' && options.authorizePreservation)
    ) {
      blocked.add(text(row.item_id));
      if (inScope) omissions.push(L.fileOmitted(text(row.item_id), decision.reason));
    }
  }
  const blockedNotes = new Set<string>();
  for (const row of by.get('primary_source_note_profiles')?.rows ?? []) {
    const decision = decidePrimarySourcePolicy({
      accessStatus: row.access_status as 'open',
      sensitivity: row.sensitivity as 'normal',
      action: 'export_file',
    });
    const inScope =
      options.categories.includes('notes') && (by.get('notes')?.rows ?? []).some((r) => r.id === row.note_id);
    if (decision.decision === 'confirm' && !options.authorizePreservation && inScope) {
      required = true;
      if (!previewOnly) throw new Error('Confirma la exportación de los materiales seleccionados.');
    }
    if (
      decision.decision !== 'allow' &&
      !(decision.decision === 'confirm' && options.authorizePreservation)
    ) {
      blockedNotes.add(text(row.note_id));
      if (inScope) omissions.push(L.noteRestricted(text(row.note_id)));
    }
  }
  for (const table of tables)
    if (table.category === 'notes')
      table.rows = table.rows.filter(
        (row) => !blockedNotes.has(text(row.note_id ?? (table.name === 'notes' ? row.id : ''))),
      );
  for (const table of tables)
    if (table.category === 'archive')
      table.rows = table.rows.filter(
        (row) =>
          !blocked.has(text(row.item_id ?? row.nodus_id ?? (table.name === 'archive_items' ? row.id : ''))),
      );
  const interviews = by.get('testimony_interviews');
  const agreements = by.get('testimony_agreements')?.rows ?? [];
  const withdrawn = new Set<string>();
  for (const row of interviews?.rows ?? []) {
    const agreement = agreements
      .filter((a) => a.interview_id === row.id && a.is_current === 1)
      .sort((a, b) => text(b.created_at).localeCompare(text(a.created_at)))[0];
    const context: AccessContext = agreement
      ? {
          agreementStatus: agreement.status as AccessContext['agreementStatus'],
          accessLevel: agreement.access_level as AccessContext['accessLevel'],
          attributionMode: agreement.attribution_mode as AccessContext['attributionMode'],
          documentedUses: array(
            portableBackupValue(agreement.allowed_uses_json, 'allowed_uses_json'),
          ) as AccessContext['documentedUses'],
          embargoUntil:
            agreement.access_level === 'embargoed' ? text(agreement.embargo_until) || null : undefined,
        }
      : pendingAccessContext();
    const access = evaluateAccess(context, 'preservationExport');
    if (
      options.categories.includes('testimony') &&
      access.allowed &&
      access.requiresConfirmation &&
      !options.authorizePreservation
    ) {
      required = true;
      if (!previewOnly)
        throw new Error('Confirma la exportación del paquete de preservación de testimonios.');
      withdrawn.add(text(row.id));
      omissions.push(L.interviewPending(text(row.id)));
    }
    if (!access.allowed) {
      withdrawn.add(text(row.id));
      omissions.push(L.interviewWithdrawn(text(row.id)));
    }
  }
  for (const table of tables)
    if (table.category === 'testimony')
      table.rows = table.rows.filter(
        (row) =>
          !withdrawn.has(text(row.interview_id ?? (table.name === 'testimony_interviews' ? row.id : ''))),
      );
  for (const table of tables)
    if (table.category === 'research')
      table.rows = table.rows.filter((row) => !blocked.has(text(row.nodus_id)));
  return required;
}
function filterBackupAcl(db: Database.Database, tables: Table[], omissions: string[], L: OpenBackupLabels): void {
  if (!tables.some((t) => t.name === 'acl_entries')) return;
  const may = createAclReadPolicy(db);
  const by = new Map(tables.map((t) => [t.name, t]));
  const deniedNotes = new Set<unknown>();
  for (const [table, type] of [
    ['pages', 'page'],
    ['db_databases', 'database'],
    ['db_rows', 'row'],
    ['db_views', 'view'],
  ] as const) {
    const records = by.get(table);
    if (!records) continue;
    records.rows = records.rows.filter((row) => {
      if (may(type, text(row.id)).canView) return true;
      omissions.push(L.noReadPermission(`${table}/${text(row.id)}`));
      if (table === 'pages' && row.note_id) deniedNotes.add(row.note_id);
      return false;
    });
  }
  const notes = by.get('notes');
  if (notes) notes.rows = notes.rows.filter((r) => !deniedNotes.has(r.id));
}
export function selectBackupTables(
  tables: Table[],
  sourceId: string,
  o: OpenBackupOptions,
  omissions: string[],
  previewOnly = false,
  confirmation = { required: false },
  L: OpenBackupLabels = openBackupLabels('es'),
): Table[] {
  const by = new Map(tables.map((t) => [t.name, t]));
  const originalIdeas = [...(by.get('ideas')?.rows ?? [])];
  const explicitlyFiltered = new Set<string>();
  for (const t of tables) {
    const selected = o.selections[backupTableKey(sourceId, t.name)];
    if (selected !== undefined) {
      explicitlyFiltered.add(t.name);
      const keys = new Set(selected);
      const existing = new Set(t.rows.map((r) => backupRecordKey(r, t.pk)));
      for (const key of keys)
        if (!existing.has(key)) omissions.push(L.missingItem(`${sourceId}/${t.name}`, key));
      t.rows = t.rows.filter((r) => keys.has(backupRecordKey(r, t.pk)));
    }
  }
  // Research projections use occurrences, never a global evidence bag.
  const workFilter = explicitlyFiltered.has('works') || explicitlyFiltered.has('authors');
  if (explicitlyFiltered.has('authors')) {
    const authors = new Set((by.get('authors')?.rows ?? []).map((r) => r.author_id));
    const works = new Set(
      (by.get('work_authors')?.rows ?? []).filter((r) => authors.has(r.author_id)).map((r) => r.nodus_id),
    );
    if (by.has('works')) by.get('works')!.rows = by.get('works')!.rows.filter((r) => works.has(r.nodus_id));
  }
  const works = new Set((by.get('works')?.rows ?? []).map((r) => r.nodus_id));
  const ideas = new Set((by.get('ideas')?.rows ?? []).map((r) => r.global_id));
  if (workFilter || explicitlyFiltered.has('ideas')) {
    for (const t of tables)
      if (t.category === 'research')
        t.rows = t.rows.filter(
          (r) =>
            (!workFilter || r.nodus_id == null || works.has(r.nodus_id)) &&
            (!explicitlyFiltered.has('ideas') || r.global_id == null || ideas.has(r.global_id)),
        );
    const occurrences = by.get('idea_occurrences')?.rows ?? [];
    if (workFilter && !explicitlyFiltered.has('ideas') && by.has('ideas')) {
      const ids = new Set(occurrences.map((r) => r.global_id));
      by.get('ideas')!.rows = by.get('ideas')!.rows.filter((r) => ids.has(r.global_id));
    }
    if (explicitlyFiltered.has('ideas') && !workFilter && by.has('works')) {
      const ids = new Set(occurrences.map((r) => r.nodus_id));
      by.get('works')!.rows = by.get('works')!.rows.filter((r) => ids.has(r.nodus_id));
      for (const t of tables)
        if (t.category === 'research' && t.name !== 'works')
          t.rows = t.rows.filter((r) => r.nodus_id == null || ids.has(r.nodus_id));
    }
    const authorIds = new Set((by.get('work_authors')?.rows ?? []).map((r) => r.author_id));
    if (by.has('authors'))
      by.get('authors')!.rows = by.get('authors')!.rows.filter((r) => authorIds.has(r.author_id));
  }
  confirmation.required = enforcePolicies(tables, omissions, o, previewOnly, L);
  // Filter child rows using declared FKs and legacy Nodus references.
  const legacy: Record<string, Array<[string, string, string]>> = {
    note_versions: [['note_id', 'notes', 'id']],
    note_annotations: [['note_id', 'notes', 'id']],
    note_links: [['note_id', 'notes', 'id']],
    work_summaries: [['nodus_id', 'works', 'nodus_id']],
    idea_occurrences: [
      ['nodus_id', 'works', 'nodus_id'],
      ['global_id', 'ideas', 'global_id'],
    ],
    evidence: [
      ['nodus_id', 'works', 'nodus_id'],
      ['global_id', 'ideas', 'global_id'],
    ],
    work_authors: [
      ['nodus_id', 'works', 'nodus_id'],
      ['author_id', 'authors', 'author_id'],
    ],
    author_dossier_synthesis: [['author_id', 'authors', 'author_id']],
    work_themes: [['nodus_id', 'works', 'nodus_id']],
    idea_theme_links: [['global_id', 'ideas', 'global_id']],
    chat_messages: [['conversation_id', 'chat_conversations', 'id']],
    project_chapters: [['project_id', 'projects', 'id']],
  };
  const semantic: Partial<Record<BackupCategory, Array<[string, string, string]>>> = {
    notes: [
      ['note_id', 'notes', 'id'],
      ['page_id', 'pages', 'id'],
      ['project_id', 'projects', 'id'],
      ['chapter_id', 'project_chapters', 'id'],
    ],
    study: [
      ['course_id', 'study_courses', 'id'],
      ['subject_id', 'study_subjects', 'id'],
      ['document_id', 'study_docs', 'id'],
      ['material_id', 'study_materials', 'id'],
      ['recording_id', 'study_recordings', 'id'],
      ['question_id', 'study_questions', 'id'],
    ],
    teaching: [
      ['group_id', 'teaching_groups', 'id'],
      ['student_id', 'teaching_students', 'id'],
      ['exam_id', 'teaching_exams', 'id'],
      ['subject_id', 'study_subjects', 'id'],
    ],
    testimony: [
      ['interview_id', 'testimony_interviews', 'id'],
      ['session_id', 'testimony_sessions', 'id'],
      ['transcript_id', 'testimony_transcripts', 'id'],
    ],
    archive: [
      ['item_id', 'archive_items', 'item_id'],
      ['person_id', 'persons', 'person_id'],
    ],
    prosopography: [
      ['study_id', 'prosop_studies', 'study_id'],
      ['source_id', 'prosop_sources', 'source_id'],
    ],
    databases: [
      ['database_id', 'db_databases', 'id'],
      ['row_id', 'db_rows', 'id'],
      ['column_id', 'db_columns', 'id'],
    ],
    conversations: [['conversation_id', 'chat_conversations', 'id']],
  };
  const constrained = new Set([
    'notes',
    'pages',
    'db_databases',
    'db_rows',
    'db_views',
    ...explicitlyFiltered,
    ...(workFilter || explicitlyFiltered.has('ideas') ? ['works', 'ideas', 'authors'] : []),
    'testimony_interviews',
    'archive_items',
  ]);
  for (let pass = 0; pass < tables.length; pass++) {
    let changed = false;
    for (const t of tables) {
      const refs = [
        ...t.references,
        ...[...(legacy[t.name] ?? []), ...(semantic[t.category] ?? [])].map(([column, table, target]) => ({
          column,
          table,
          target,
        })),
      ];
      for (const ref of refs) {
        if (ref.table === t.name) continue;
        const parent = by.get(ref.table);
        if (!parent || !constrained.has(ref.table)) continue;
        const ids = new Set(parent.rows.map((r) => r[ref.target]));
        const before = t.rows.length;
        t.rows = t.rows.filter((r) => r[ref.column] == null || ids.has(r[ref.column]));
        if (before !== t.rows.length) {
          constrained.add(t.name);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  if (workFilter || explicitlyFiltered.has('ideas')) {
    const selected = new Set((by.get('ideas')?.rows ?? []).map((r) => r.global_id));
    const edges = by.get('edges');
    if (edges)
      edges.rows = edges.rows
        .filter((r) => selected.has(r.from_id) || selected.has(r.to_id))
        .map((r) => ({
          ...r,
          from_external: !selected.has(r.from_id),
          to_external: !selected.has(r.to_id),
          from_label: originalIdeas.find((i) => i.global_id === r.from_id)?.label ?? null,
          to_label: originalIdeas.find((i) => i.global_id === r.to_id)?.label ?? null,
        }));
  }
  return tables.filter((t) => tableEnabled(t, o));
}
function headingContent(value: string, depth: number): string {
  if (!/^ {0,3}(?:#{1,6}(?:\s|$)|[=-]+\s*$)/m.test(value)) return value;
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const visit = (node: {
    type: string;
    depth?: number;
    children?: unknown[];
    position?: { start: { offset?: number }; end: { offset?: number } };
  }): void => {
    if (
      node.type === 'heading' &&
      node.depth &&
      node.position?.start.offset !== undefined &&
      node.position.end.offset !== undefined
    ) {
      const start = node.position.start.offset,
        end = node.position.end.offset,
        span = value.slice(start, end),
        match = /^#{1,6}/.exec(span);
      const marks = '#'.repeat(Math.min(6, depth + node.depth - 1));
      edits.push(
        match
          ? { start, end: start + match[0].length, replacement: marks }
          : { start, end, replacement: marks + ' ' + span.replace(/\n[=-]+\s*$/, '') },
      );
    }
    for (const child of node.children ?? []) visit(child as Parameters<typeof visit>[0]);
  };
  visit(unified().use(remarkParse).parse(value));
  for (const edit of edits.sort((a, b) => b.start - a.start))
    value = value.slice(0, edit.start) + edit.replacement + value.slice(edit.end);
  return value;
}
function bodyMarkdown(row: Row): string {
  const native = row.content_json ?? row.document_json;
  if (Array.isArray(native)) {
    try {
      return blockNoteToMarkdown(native as Parameters<typeof blockNoteToMarkdown>[0]);
    } catch {
      /* retain the stored text below */
    }
  }
  const body =
    row.content_markdown ??
    row.contentMarkdown ??
    row.body_markdown ??
    row.current_markdown ??
    row.markdown ??
    row.content ??
    row.body ??
    row.text ??
    row.statement;
  if (typeof body === 'string') return body;
  const doc = row.content_json ?? row.document_json;
  if (doc && typeof doc === 'object') {
    try {
      return blockNoteToMarkdown(doc as Parameters<typeof blockNoteToMarkdown>[0]);
    } catch {
      return JSON.stringify(doc, null, 2);
    }
  }
  return '';
}
function objectMarkdown(row: Row, depth = 2, currentFile = ''): string {
  const out: string[] = [];
  const body = bodyMarkdown(row);
  if (body) out.push(headingContent(body, depth), '');
  for (const [key, value] of Object.entries(row)) {
    if (
      value == null ||
      /^(content_markdown|contentMarkdown|body_markdown|current_markdown|markdown|content|body|text|statement|__rowid|native_document|academic_metadata)$/.test(
        key,
      )
    )
      continue;
    if (
      value &&
      typeof value === 'object' &&
      'file' in value &&
      typeof value.file === 'string' &&
      currentFile
    ) {
      out.push(
        `- **${mdLabel(key)}:** [${mdLabel(path.posix.basename(value.file))}](${relativeBackupUrl(path.posix.relative(path.posix.dirname(currentFile), value.file))})`,
      );
      continue;
    }
    if (typeof value === 'object')
      out.push(
        `${'#'.repeat(depth)} ${mdLabel(key)}`,
        '',
        '```json',
        JSON.stringify(value, null, 2),
        '```',
        '',
      );
    else out.push(`- **${mdLabel(key)}:** ${mdLabel(value)}`);
  }
  return out.join('\n');
}
function naturalBackupFolders(table: Table, row: Row, by: Map<string, Table>): string[] {
  const names: string[] = [];
  const folders =
    by.get(
      table.category === 'study'
        ? 'study_folders'
        : table.category === 'archive'
          ? 'archive_folders'
          : 'note_folders',
    )?.rows ?? [];
  let folderId = row.folder_id;
  const seen = new Set<unknown>();
  while (folderId != null && !seen.has(folderId)) {
    seen.add(folderId);
    const folder = folders.find((f) => (f.id ?? f.folder_id) === folderId);
    if (!folder) break;
    names.unshift(text(folder.name ?? folder.title));
    folderId = folder.parent_id ?? folder.parent_folder_id;
  }
  if (table.category === 'study') {
    const placement = (by.get('study_placements')?.rows ?? []).find((p) => p.document_id === row.id);
    const subject = (by.get('study_subjects')?.rows ?? []).find(
      (s) => s.id === (row.subject_id ?? placement?.subject_id),
    );
    const course = (by.get('study_courses')?.rows ?? []).find(
      (c) => c.id === (row.course_id ?? placement?.course_id ?? subject?.course_id),
    );
    if (subject) names.unshift(text(subject.name));
    if (course) names.unshift(text(course.name));
  }
  if (row.project_id) {
    const project = (by.get('projects')?.rows ?? []).find((p) => p.id === row.project_id);
    if (project) names.unshift(text(project.title));
  }
  if (row.database_id) {
    const database = (by.get('db_databases')?.rows ?? []).find((p) => p.id === row.database_id);
    if (database) names.unshift(text(database.name));
  }
  return names.filter(Boolean).map(backupFileStem);
}
const relativeBackupUrl = (value: string): string =>
  value
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()),
    )
    .join('/');
interface BackupMarkdownNode {
  type: string;
  url?: string;
  alt?: string | null;
  children?: BackupMarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
function portableMarkdownLinks(
  source: string,
  currentFile: string,
  links: Map<string, string>,
  omissions: string[],
  vaultId: string,
  L: OpenBackupLabels,
): string {
  if (!/nodus(?:-blob)?:\/\//.test(source)) return source;
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const visit = (node: BackupMarkdownNode): void => {
    if (
      (node.type === 'link' || node.type === 'image' || node.type === 'definition') &&
      node.url &&
      /^nodus(?:-blob)?:\/\//.test(node.url) &&
      node.position?.start.offset !== undefined &&
      node.position.end.offset !== undefined
    ) {
      const start = node.position.start.offset,
        end = node.position.end.offset,
        span = source.slice(start, end);
      const boundary = span.lastIndexOf('](');
      let ids: string[] = [];
      let scope = vaultId;
      try {
        const url = new URL(node.url);
        ids =
          url.protocol === 'nodus-blob:'
            ? [url.hostname]
            : url.pathname.split('/').filter(Boolean).map(decodeURIComponent).reverse();
        if (url.hostname === 'vault') {
          const parts = url.pathname.split('/').filter(Boolean);
          scope = decodeURIComponent(parts[0] ?? vaultId);
        }
      } catch {
        /* keep the visible label and record the unresolved reference */
      }
      const id = scope === vaultId ? ids.find((id) => links.has(id)) : undefined;
      const location = span.lastIndexOf(node.url);
      if (id && location >= 0) {
        edits.push({
          start: start + location,
          end: start + location + node.url.length,
          replacement: relativeBackupUrl(
            path.posix.relative(path.posix.dirname(currentFile), links.get(id)!),
          ),
        });
      } else {
        const warning = L.externalReference(ids[0] ?? node.url);
        if (!omissions.includes(warning)) omissions.push(warning);
        const label =
          boundary >= 0
            ? span.slice(node.type === 'image' ? 2 : 1, boundary)
            : mdLabel(node.alt ?? ids[0] ?? '');
        edits.push({ start, end, replacement: `${label} (${mdLabel(ids[0] ?? node.url)})` });
        return;
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(unified().use(remarkParse).parse(source));
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
  return source;
}
export async function buildOpenBackup(
  input: OpenBackupBuildInput,
  onProgress: (p: OpenBackupProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<OpenBackupPreview & { entries: OutputFile[] }> {
  const { options: o, sources, directory } = input;
  const L = openBackupLabels(input.language);
  const entries: OutputFile[] = [];
  const writtenPaths = new Set<string>();
  const omissions: string[] = [];
  let records = 0;
  let requiresConfirmation = false;
  let sample: OpenBackupPreview['sample'] = null;
  let links = new Map<string, string>();
  let currentVaultId = '';
  const check = () => {
    if (signal?.aborted) throw new Error('BACKUP_CANCELLED');
  };
  const write = async (name: string, data: string | Buffer): Promise<void> => {
    check();
    if (writtenPaths.has(name)) throw new Error(`Ruta duplicada: ${name}`);
    writtenPaths.add(name);
    const target = path.join(directory, ...name.split('/'));
    if (!input.previewOnly) await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const bytes = Buffer.isBuffer(data)
      ? data
      : Buffer.from(
          name.endsWith('.md') ? portableMarkdownLinks(data, name, links, omissions, currentVaultId, L) : data,
        );
    if (!input.previewOnly) await fs.promises.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
    entries.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
    if (!sample && name.endsWith('.md'))
      sample = { path: name, content: bytes.toString('utf8').slice(0, 16000) };
  };
  const copyDiskFile = async (name: string, sourcePath: string): Promise<void> => {
    check();
    if (writtenPaths.has(name)) throw new Error(`Ruta duplicada: ${name}`);
    writtenPaths.add(name);
    const stat = await fs.promises.stat(sourcePath);
    if (input.previewOnly) {
      entries.push({ path: name, bytes: stat.size, sha256: 'pending' });
      return;
    }
    const target = path.join(directory, ...name.split('/'));
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const digest = createHash('sha256');
    let copied = 0;
    const out = await fs.promises.open(target, 'wx', 0o600);
    try {
      for await (const chunk of fs.createReadStream(sourcePath, { highWaterMark: 1024 * 1024, signal })) {
        check();
        const bytes = chunk as Buffer;
        copied += bytes.length;
        digest.update(bytes);
        await out.write(bytes);
      }
    } finally {
      await out.close();
    }
    const after = await fs.promises.stat(sourcePath);
    if (
      after.size !== stat.size ||
      after.ino !== stat.ino ||
      after.mtimeMs !== stat.mtimeMs ||
      copied !== stat.size
    )
      throw new Error('Un archivo cambió durante la exportación. Vuelve a intentarlo.');
    entries.push({ path: name, bytes: copied, sha256: digest.digest('hex') });
  };
  const linkedWorkIds = new Map<string, Set<string>>();
  const linkedZoteroKeys = new Set<string>();
  for (const [index, source] of sources.entries()) {
    check();
    currentVaultId = source.id;
    onProgress({
      jobId: input.jobId,
      phase: 'export',
      completed: index,
      total: sources.length,
      message: source.name,
    });
    const db = new Database(source.snapshotPath, { readonly: true, fileMustExist: true });
    let tables: Table[];
    try {
      const confirmation = { required: false };
      const loaded = readBackupTables(db);
      filterBackupAcl(db, loaded, omissions, L);
      tables = selectBackupTables(loaded, source.id, o, omissions, input.previewOnly === true, confirmation, L);
      requiresConfirmation ||= confirmation.required;
    } finally {
      db.close();
    }
    const base = `vaults/${backupFileStem(source.name)}-${hash(source.id).slice(0, 8)}`;
    const by = new Map(tables.map((t) => [t.name, t]));
    const rows = (name: string) => by.get(name)?.rows ?? [];
    linkedWorkIds.set(source.id, new Set(rows('works').map((r) => text(r.nodus_id))));
    for (const work of rows('works')) if (work.zotero_key) linkedZoteroKeys.add(text(work.zotero_key));
    if (rows('pages').length) {
      const pageDb = new Database(source.snapshotPath, { readonly: true, fileMustExist: true });
      try {
        for (const page of rows('pages')) {
          const blockRows = rows('page_blocks').filter((b) => b.page_id === page.id && b.trashed_at == null);
          const blocks = blockRows.map((b) => ({
            id: text(b.id),
            type: b.type,
            content: portableBackupValue(b.content_json, 'content_json'),
            parentBlockId: b.parent_block_id,
            order: Number(b.sort_order),
          })) as Parameters<typeof pageBlocksToMarkdown>[0];
          page.content_markdown = pageBlocksToMarkdown(blocks);
          const hasDocuments = pageDb
            .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='page_documents'")
            .get();
          if (hasDocuments) {
            const state = pageDb
              .prepare('SELECT snapshot_blob,snapshot_sequence FROM page_documents WHERE page_id=?')
              .get(page.id) as { snapshot_blob: Buffer; snapshot_sequence: number } | undefined;
            if (state) {
              const doc = new Y.Doc();
              try {
                if (state.snapshot_blob.length) Y.applyUpdate(doc, new Uint8Array(state.snapshot_blob));
                for (const update of pageDb
                  .prepare(
                    'SELECT update_blob FROM page_document_updates WHERE page_id=? AND sequence_no>? ORDER BY sequence_no',
                  )
                  .iterate(page.id, state.snapshot_sequence) as Iterable<{ update_blob: Buffer }>)
                  Y.applyUpdate(doc, new Uint8Array(update.update_blob));
                const native = readPageNativeDocument(doc);
                if (native) {
                  page.native_document = native;
                  page.academic_metadata = readPageAcademicMetadata(doc);
                  if (doc.getMap('editor').has('academicMetadata'))
                    page.content_markdown = academicMarkdownProjection(native, page.academic_metadata);
                }
              } finally {
                doc.destroy();
              }
            }
          }
        }
      } finally {
        pageDb.close();
      }
    }
    for (const table of tables) {
      for (const row of table.rows) {
        check();
        const originalPk = table.pk.map((k) => row[k]);
        for (const [key, value] of Object.entries(row)) {
          if (excludedColumn(key)) {
            delete row[key];
            continue;
          }
          if (value && typeof value === 'object' && '__backupBlob' in value) {
            if (!o.includeAttachments) {
              delete row[key];
              continue;
            }
            const declaredName = text(
              row.file_name ?? row.original_file_name ?? row.filename ?? row.original_name,
            );
            const ext =
              text(row.extension) ||
              ({
                'audio/wav': '.wav',
                'audio/mpeg': '.mp3',
                'image/png': '.png',
                'image/jpeg': '.jpg',
                'application/pdf': '.pdf',
              }[text(row.mime_type)] ??
                '.bin');
            const name = `${base}/attachments/${table.name}/${recordStem(row, table)}/${backupFileStem(key)}-${hash(backupRecordKey(row, table.pk) + key).slice(0, 12)}/${backupAttachmentName(declaredName || `${key}${ext.startsWith('.') ? ext : '.' + ext}`)}`;
            if (writtenPaths.has(name)) throw new Error(`Ruta duplicada: ${name}`);
            writtenPaths.add(name);
            if (input.previewOnly) {
              const size = Number((value as unknown as { size: number }).size);
              entries.push({ path: name, bytes: size, sha256: text(row.content_hash) || 'pending' });
              row[key] = { file: name, bytes: size, sha256: text(row.content_hash) || null };
              continue;
            }
            const blob = value as {
              __backupBlob: string;
              size: number;
              table?: string;
              keys?: string[];
              values?: unknown[];
            };
            const blobDb = new Database(source.snapshotPath, { readonly: true, fileMustExist: true });
            const target = path.join(directory, ...name.split('/'));
            await fs.promises.mkdir(path.dirname(target), { recursive: true });
            const handle = await fs.promises.open(target, 'wx', 0o600);
            const digest = createHash('sha256');
            try {
              const query = blobDb.prepare(
                `SELECT substr(${quoteSqlIdentifier(blob.__backupBlob)},?,?) AS chunk FROM ${quoteSqlIdentifier(blob.table ?? table.name)} WHERE ${(blob.keys ?? table.pk).map((k) => `${quoteSqlIdentifier(k)} IS ?`).join(' AND ')}`,
              );
              for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
                check();
                const result = query.get(offset + 1, 1024 * 1024, ...(blob.values ?? originalPk)) as
                  | { chunk: Buffer }
                  | undefined;
                if (!result) throw new Error('Adjunto ausente en la instantánea.');
                digest.update(result.chunk);
                await handle.write(result.chunk);
              }
            } finally {
              await handle.close();
              blobDb.close();
            }
            const sha256 = digest.digest('hex');
            entries.push({ path: name, bytes: blob.size, sha256 });
            row[key] = { file: name, bytes: blob.size, sha256 };
          } else {
            const portable = portableBackupValue(value, key);
            row[key] =
              table.name === 'db_data_sources' && key === 'config_json'
                ? scrubConnectionCredentials(portable)
                : portable;
          }
        }
      }
      if (o.includeAttachments && table.name === 'archive_item_files')
        for (const row of table.rows)
          if (!row.content_blob && (row.external_path || Number(row.byte_size) > 0))
            omissions.push(L.fileContentMissing(text(row.file_id), text(row.external_path)));
      records += table.rows.length;
      if (!table.rows.length) continue;
      if (o.formats.includes('json'))
        await write(
          `${base}/json/${table.category}/${table.name}.json`,
          JSON.stringify(
            {
              format: 'nodus.open-backup-table',
              formatVersion: 1,
              vaultId: source.id,
              table: table.name,
              primaryKey: table.pk,
              records: table.rows,
            },
            null,
            2,
          ) + '\n',
        );
      if (o.formats.includes('csv'))
        await write(
          `${base}/csv/${table.category}/${table.name}.csv`,
          backupCsv(table.rows, [...new Set(table.rows.flatMap((r) => Object.keys(r)))].sort()),
        );
    }
    if (o.formats.includes('csv'))
      for (const database of rows('db_databases')) {
        const columns = rows('db_columns')
          .filter((c) => c.database_id === database.id)
          .sort((a, b) => Number(a.position) - Number(b.position));
        const names = columns.map((c) => text(c.name));
        const columnNames = names.map((name, i) =>
          names.filter((n) => n === name).length > 1 || name === '_nodus_row_id'
            ? `${name} (${text(columns[i].id)})`
            : name,
        );
        const data = rows('db_rows')
          .filter((r) => r.database_id === database.id)
          .map((row) => {
            const out: Row = { _nodus_row_id: row.id };
            for (const [index, column] of columns.entries()) {
              const cell = rows('db_cells').find((c) => c.row_id === row.id && c.column_id === column.id);
              const attached = rows('db_attachments').filter(
                (a) => a.row_id === row.id && a.column_id === column.id,
              );
              out[columnNames[index]] = attached.length
                ? attached.map((a) => ({
                    name: a.file_name,
                    file:
                      typeof a.blob === 'object' && a.blob !== null && 'file' in a.blob ? a.blob.file : null,
                  }))
                : cell
                  ? (cell.value_json ??
                    cell.value_number ??
                    cell.value_integer ??
                    cell.value_date ??
                    cell.value_text ??
                    cell.value_reference)
                  : null;
            }
            return out;
          });
        if (data.length)
          await write(
            `${base}/csv/tables/${backupFileStem(text(database.name))}-${hash(text(database.id)).slice(0, 12)}.csv`,
            backupCsv(data, ['_nodus_row_id', ...columnNames]),
          );
      }
    if (o.formats.includes('markdown')) {
      links = new Map<string, string>();
      for (const table of tables)
        for (const row of table.rows)
          for (const value of Object.values(row))
            if (value && typeof value === 'object' && 'file' in value && typeof value.file === 'string') {
              if (row.blob_hash) links.set(text(row.blob_hash), value.file);
              if ('sha256' in value && typeof value.sha256 === 'string') links.set(value.sha256, value.file);
            }
      for (const table of tables)
        for (const row of table.rows) {
          const name = `${base}/markdown/${table.category}/${table.name}/${[...naturalBackupFolders(table, row, by), recordStem(row, table)].join('/')}.md`;
          if (
            table.rows.some(
              (r) =>
                typeof (
                  r.title ??
                  r.name ??
                  r.label ??
                  r.term ??
                  r.content_markdown ??
                  r.content ??
                  r.body
                ) === 'string',
            )
          ) {
            for (const key of table.pk) if (typeof row[key] === 'string') links.set(text(row[key]), name);
          }
        }
      const researchFiles = new Map<string, string>();
      const represented: Record<string, Set<string>> = Object.fromEntries(
        ['works', 'ideas', 'authors', 'work_summaries', 'idea_occurrences', 'evidence'].map((name) => [
          name,
          new Set<string>(),
        ]),
      );
      const worksTable = by.get('works');
      const ideasTable = by.get('ideas');
      const authorsTable = by.get('authors');
      const primary =
        o.organization === 'authors' ? authorsTable : o.organization === 'ideas' ? ideasTable : worksTable;
      if (primary)
        for (const row of primary.rows) {
          const id = text(
            row[
              o.organization === 'works'
                ? 'nodus_id'
                : o.organization === 'authors'
                  ? 'author_id'
                  : 'global_id'
            ],
          );
          researchFiles.set(id, `${base}/markdown/${o.organization}/${recordStem(row, primary)}.md`);
          links.set(id, researchFiles.get(id)!);
        }
      if (o.organization !== 'works')
        for (const work of rows('works')) {
          const target =
            o.organization === 'authors'
              ? rows('work_authors')
                  .filter((r) => r.nodus_id === work.nodus_id)
                  .map((r) => researchFiles.get(text(r.author_id)))
                  .find(Boolean)
              : rows('idea_occurrences')
                  .filter((r) => r.nodus_id === work.nodus_id)
                  .map((r) => researchFiles.get(text(r.global_id)))
                  .find(Boolean);
          if (target) links.set(text(work.nodus_id), target);
        }
      if (o.organization !== 'ideas')
        for (const idea of rows('ideas')) {
          const target = rows('idea_occurrences')
            .filter((r) => r.global_id === idea.global_id)
            .map((r) => links.get(text(r.nodus_id)))
            .find(Boolean);
          if (target) links.set(text(idea.global_id), target);
        }
      if (o.organization !== 'authors')
        for (const author of rows('authors')) {
          const target = rows('work_authors')
            .filter((r) => r.author_id === author.author_id)
            .map((r) => links.get(text(r.nodus_id)))
            .find(Boolean);
          if (target) links.set(text(author.author_id), target);
        }
      const bibliography = (work: Row): string[] => {
        represented.works.add(text(work.nodus_id));
        for (const link of rows('work_authors').filter((r) => r.nodus_id === work.nodus_id))
          represented.authors.add(text(link.author_id));
        const out = [
          `- **${L.title}:** ${mdLabel(work.title)}`,
          `- **${L.authors}:** ${array(work.authors_json).map(mdLabel).join('; ')}`,
        ];
        if (work.year != null) out.push(`- **${L.year}:** ${mdLabel(work.year)}`);
        if (work.doi) out.push(`- **DOI:** ${mdLabel(work.doi)}`);
        if (work.zotero_key) {
          const key = text(work.zotero_key);
          out.push(
            `- **Zotero:** ${/^(?:groups:[^:]+:)?[A-Z0-9]{8}$/i.test(key) ? `[${mdLabel(key)}](${zoteroSelectUrl(key)})` : mdLabel(key)}`,
          );
        }
        out.push(`- **ID:** ${mdLabel(work.nodus_id)}`);
        return out;
      };
      const summary = (work: Row, depth: number) => {
        const s = rows('work_summaries').find((r) => r.nodus_id === work.nodus_id);
        if (o.summaries === 'none' || !s) return [];
        represented.work_summaries.add(text(s.nodus_id));
        if (o.summaries === 'separate') {
          const st = by.get('work_summaries')!;
          const target = `${base}/markdown/summaries/${recordStem(s, st)}.md`;
          return [
            `${'#'.repeat(depth)} ${L.summary}`,
            '',
            `[${L.readSummary}](${relativeBackupUrl(path.posix.relative(path.posix.dirname(currentFile), target))})`,
            '',
          ];
        }
        return [
          `${'#'.repeat(depth)} ${L.summary}`,
          '',
          `_${L.summaryNote}_`,
          '',
          headingContent(text(s.summary), depth + 1),
          '',
        ];
      };
      const occurrence = (idea: Row, work: Row, depth: number): string[] => {
        represented.ideas.add(text(idea.global_id));
        represented.idea_occurrences.add(JSON.stringify([idea.global_id, work.nodus_id]));
        const occ = rows('idea_occurrences').find(
          (r) => r.global_id === idea.global_id && r.nodus_id === work.nodus_id,
        );
        const out = [
          `${'#'.repeat(depth)} ${mdLabel(idea.label)}`,
          '',
          headingContent(text(idea.statement), depth + 1),
          '',
          `${L.type}: ${mdLabel(idea.type)} · ID: ${mdLabel(idea.global_id)}`,
          '',
        ];
        if (occ && (occ.role != null || occ.confidence != null))
          out.push(
            [
              occ.role != null ? `${L.role}: ${mdLabel(occ.role)}` : null,
              occ.confidence != null ? `${L.confidence}: ${mdLabel(occ.confidence)}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            '',
          );
        if (occ?.development)
          out.push(
            `${'#'.repeat(depth + 1)} ${L.developmentInWork}`,
            '',
            headingContent(text(occ.development), depth + 2),
            '',
          );
        const themes = rows('idea_theme_links')
          .filter((r) => r.global_id === idea.global_id)
          .map((r) => rows('themes').find((t) => t.theme_id === r.theme_id)?.label)
          .filter(Boolean);
        if (themes.length) out.push(`${L.themes}: ${themes.map(mdLabel).join('; ')}`, '');
        for (const e of rows('evidence').filter(
          (r) => r.global_id === idea.global_id && r.nodus_id === work.nodus_id,
        )) {
          represented.evidence.add(text(e.id));
          out.push(
            `${'#'.repeat(depth + 1)} ${e.kind === 'paraphrase' ? L.paraphrase : L.evidence}`,
            '',
            ...text(e.quote)
              .split('\n')
              .map((l) => `> ${mdLabel(l)}`),
            '',
            `${L.source}: ${mdLabel(work.title)}${e.location ? ' · ' + mdLabel(e.location) : ''}${e.page_number ? ' · p. ' + mdLabel(e.page_number) : ''}`,
            '',
          );
        }
        return out;
      };
      let currentFile = '';
      if (primary)
        for (const root of primary.rows) {
          check();
          const id = text(
            root[
              o.organization === 'works'
                ? 'nodus_id'
                : o.organization === 'authors'
                  ? 'author_id'
                  : 'global_id'
            ],
          );
          currentFile = researchFiles.get(id)!;
          const out = [
            `# ${mdLabel(recordTitle(root, primary.name))}`,
            '',
            `Nodus · ${mdLabel(source.name)}`,
            '',
          ];
          if (o.organization === 'ideas') {
            represented.ideas.add(text(root.global_id));
            out.push(
              headingContent(text(root.statement), 2),
              '',
              `${L.type}: ${mdLabel(root.type)} · ID: ${mdLabel(root.global_id)}`,
              '',
            );
            const themes = rows('idea_theme_links')
              .filter((r) => r.global_id === root.global_id)
              .map((r) => rows('themes').find((t) => t.theme_id === r.theme_id)?.label)
              .filter(Boolean);
            if (themes.length) out.push(`## ${L.themes}`, '', ...themes.map((t) => `- ${mdLabel(t)}`), '');
            out.push(`## ${L.authorsAndWorks}`, '');
            for (const occ of rows('idea_occurrences').filter((r) => r.global_id === root.global_id)) {
              const work = rows('works').find((r) => r.nodus_id === occ.nodus_id);
              if (!work) continue;
              out.push(
                `### ${mdLabel(work.title)}`,
                '',
                ...bibliography(work),
                '',
                ...summary(work, 4),
                ...occurrence(root, work, 4),
              );
            }
          } else {
            let selectedWorks = rows('works');
            if (o.organization === 'authors') {
              represented.authors.add(text(root.author_id));
              out.push(
                `ID: ${mdLabel(root.author_id)}`,
                root.affiliation ? `${L.affiliation}: ${mdLabel(root.affiliation)}` : '',
                '',
              );
              const s = rows('author_dossier_synthesis').find((r) => r.author_id === root.author_id);
              if (s)
                out.push(
                  `## ${L.authorSynthesis}`,
                  '',
                  headingContent(text(s.thesis), 3),
                  '',
                  ...array(s.remember_json).map((v) => `- ${text(v)}`),
                  '',
                  headingContent(text(s.positioning), 3),
                  '',
                );
              const ids = new Set(
                rows('work_authors')
                  .filter((r) => r.author_id === root.author_id)
                  .map((r) => r.nodus_id),
              );
              selectedWorks = selectedWorks.filter((r) => ids.has(r.nodus_id));
            } else selectedWorks = selectedWorks.filter((r) => r.nodus_id === root.nodus_id);
            for (const work of selectedWorks) {
              const depth = o.organization === 'authors' ? 3 : 2;
              if (o.organization === 'authors') out.push(`## ${mdLabel(work.title)}`, '');
              out.push(...bibliography(work), '', ...summary(work, depth));
              const occIds = new Set(
                rows('idea_occurrences')
                  .filter((r) => r.nodus_id === work.nodus_id)
                  .map((r) => r.global_id),
              );
              if (o.includeIdeas && occIds.size)
                out.push(
                  `${'#'.repeat(depth)} ${L.ideas}`,
                  '',
                  ...rows('ideas')
                    .filter((r) => occIds.has(r.global_id))
                    .flatMap((i) => occurrence(i, work, depth + 1)),
                );
            }
          }
          if (o.includeRelations && o.organization === 'ideas') {
            const edges = rows('edges').filter(
              (r) => r.from_id === root.global_id || r.to_id === root.global_id,
            );
            if (edges.length)
              out.push(
                `## ${L.relations}`,
                '',
                ...edges.map((e) => {
                  const otherId = text(e.from_id === root.global_id ? e.to_id : e.from_id);
                  const other = rows('ideas').find((i) => i.global_id === otherId);
                  const target = researchFiles.get(otherId);
                  return `- ${mdLabel(e.type)}: ${target ? `[${mdLabel(other?.label ?? otherId)}](${relativeBackupUrl(path.posix.relative(path.posix.dirname(currentFile), target))})` : mdLabel(other?.label ?? otherId)}`;
                }),
                '',
              );
          }
          await write(currentFile, out.join('\n').trim() + '\n');
        }
      if (o.summaries === 'separate')
        for (const s of rows('work_summaries')) {
          const work = rows('works').find((w) => w.nodus_id === s.nodus_id);
          const st = by.get('work_summaries')!;
          await write(
            `${base}/markdown/summaries/${recordStem(s, st)}.md`,
            [
              `# ${L.summary}: ${mdLabel(work?.title ?? s.nodus_id)}`,
              '',
              ...(work ? bibliography(work) : []),
              '',
              `_${L.summaryNote}_`,
              '',
              headingContent(text(s.summary), 2),
              '',
            ].join('\n'),
          );
        }
      // Remaining domain records keep complete fields; relation tables are grouped,
      // so exporting a graph does not create a file for every join row.
      const rendered = new Set(
        primary?.rows.length
          ? [
              'works',
              'ideas',
              'authors',
              'work_summaries',
              'idea_occurrences',
              'evidence',
              'author_dossier_synthesis',
            ]
          : [],
      );
      if (!o.includeIdeas) {
        rendered.delete('ideas');
        rendered.delete('idea_occurrences');
        rendered.delete('evidence');
      }
      if (o.organization !== 'authors') rendered.delete('author_dossier_synthesis');
      for (const table of tables) {
        const idFields: Record<string, string> = {
          works: 'nodus_id',
          ideas: 'global_id',
          authors: 'author_id',
          work_summaries: 'nodus_id',
          evidence: 'id',
        };
        const remaining =
          rendered.has(table.name) && represented[table.name]
            ? table.rows.filter(
                (r) =>
                  !represented[table.name].has(
                    table.name === 'idea_occurrences'
                      ? JSON.stringify([r.global_id, r.nodus_id])
                      : text(r[idFields[table.name]]),
                  ),
              )
            : rendered.has(table.name)
              ? []
              : table.rows;
        if (!remaining.length) continue;
        const meaningful = remaining.some(
          (r) =>
            typeof (r.title ?? r.name ?? r.label ?? r.term ?? r.content_markdown ?? r.content ?? r.body) ===
            'string',
        );
        for (const row of meaningful ? remaining : [null]) {
          const name = `${base}/markdown/${table.category}/${table.name}/${row ? [...naturalBackupFolders(table, row, by), recordStem(row, table)].join('/') : 'index'}.md`;
          const parts = [
            `# ${mdLabel(row ? recordTitle(row, table.name) : table.name)}`,
            '',
            `Nodus · ${mdLabel(source.name)}`,
            '',
          ];
          if (row && table.name === 'pages' && !row.content_markdown) {
            const blocks = rows('page_blocks').filter((b) => b.page_id === row.id);
            if (blocks.length)
              parts.push(
                headingContent(
                  pageBlocksToMarkdown(
                    blocks.map((b) => ({
                      id: text(b.id),
                      type: b.type,
                      content: b.content_json,
                      parentBlockId: b.parent_block_id,
                      order: Number(b.sort_order),
                    })) as Parameters<typeof pageBlocksToMarkdown>[0],
                  ),
                  2,
                ),
                '',
              );
          }
          for (const record of row ? [row] : remaining) {
            if (!row) parts.push(`## ${mdLabel(backupRecordKey(record, table.pk))}`, '');
            parts.push(objectMarkdown(record, row ? 2 : 3, name), '');
          }
          await write(name, parts.join('\n').trim() + '\n');
        }
      }
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (input.libraryRoot && (o.categories.includes('research') || o.includeGlobalLibrary)) {
    const store = new LibraryDiskStore(input.libraryRoot, 'open-backup-readonly');
    const { records: libraryItems, invalid } = store.scanMaterializedItems();
    if (invalid) omissions.push(L.libraryInvalid(invalid));
    const librarySelection = o.selections['global:library_items'];
    if (librarySelection)
      for (const key of librarySelection)
        if (!libraryItems.some((item) => JSON.stringify([item.id]) === key))
          omissions.push(L.globalLibraryMissing(key));
    for (const item of libraryItems) {
      check();
      if (librarySelection && !librarySelection.includes(JSON.stringify([item.id]))) continue;
      if (item.deletedAt) continue;
      const linked =
        [...linkedWorkIds].some(
          ([vaultId, ids]) => item.vaultWorkIds?.[vaultId] && ids.has(item.vaultWorkIds[vaultId]),
        ) ||
        (item.sourceKey && linkedZoteroKeys.has(item.sourceKey));
      if (!o.includeGlobalLibrary && !linked) continue;
      const root = `library/${backupFileStem(item.metadata.title)}-${hash(item.id).slice(0, 12)}`;
      const portable = portableBackupValue(item) as Row;
      portable.source_format = { format: item.format, formatVersion: item.formatVersion };
      portable.format = 'nodus.open-backup-library-record';
      portable.formatVersion = 1;
      if (!o.includeHistory) {
        delete portable.provenance;
      }
      if (!o.includeRelations) delete portable.relations;
      if (!o.categories.includes('notes')) delete portable.notes;
      const excludedLibraryFiles = new Set<string>();
      for (const [kind, file] of Object.entries(item.files ?? {}))
        if (
          (!o.includeHistory && ['orphanedAnnotations'].includes(kind)) ||
          (!o.categories.includes('conversations') && kind === 'chat') ||
          (!o.includeEvidence && ['annotations', 'orphanedAnnotations'].includes(kind))
        ) {
          excludedLibraryFiles.add(file.replace(/\\/g, '/'));
          if (portable.files && typeof portable.files === 'object') delete (portable.files as Row)[kind];
        }
      if (!o.includeAttachments) {
        delete portable.files;
      }
      if (o.formats.includes('json'))
        await write(
          `${root}/record.json`,
          JSON.stringify(
            { format: 'nodus.open-backup-library-item', formatVersion: 1, record: portable },
            null,
            2,
          ) + '\n',
        );
      if (o.formats.includes('csv'))
        await write(`${root}/record.csv`, backupCsv([portable], Object.keys(portable).sort()));
      const libraryFiles: string[] = [];
      if (o.includeAttachments) {
        const folder = store.itemFolder(item.storageId);
        const walk = async (directoryPath: string, relative = ''): Promise<void> => {
          for (const entry of await fs.promises.readdir(directoryPath, { withFileTypes: true })) {
            check();
            if (entry.name === 'metadata.json') continue;
            if (entry.isSymbolicLink()) {
              omissions.push(L.librarySymlink(item.id, entry.name));
              continue;
            }
            if (!o.includeHistory && /^(orphanedAnnotations|history)/i.test(entry.name)) continue;
            const file = path.join(directoryPath, entry.name);
            const rel = relative ? `${relative}/${entry.name}` : entry.name;
            if (excludedLibraryFiles.has(rel)) continue;
            if (entry.isDirectory()) await walk(file, rel);
            else if (entry.isFile()) {
              await copyDiskFile(`${root}/files/${rel}`, file);
              libraryFiles.push(rel);
            }
          }
        };
        try {
          await walk(folder);
          for (const expected of Object.values(item.files ?? {}))
            if (
              typeof expected === 'string' &&
              !excludedLibraryFiles.has(expected.replace(/\\/g, '/')) &&
              !libraryFiles.includes(expected.replace(/\\/g, '/'))
            )
              omissions.push(L.libraryFileMissing(item.id, expected));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            omissions.push(L.libraryFilesMissing(item.id));
          else throw error;
        }
      }
      if (o.formats.includes('markdown'))
        await write(
          `${root}/index.md`,
          [
            `# ${mdLabel(item.metadata.title)}`,
            '',
            objectMarkdown(item.metadata as unknown as Row),
            '',
            ...(libraryFiles.length
              ? [
                  `## ${L.files}`,
                  '',
                  ...libraryFiles.map(
                    (file) => `- [${mdLabel(file)}](${relativeBackupUrl('files/' + file)})`,
                  ),
                ]
              : []),
            '',
          ].join('\n'),
        );
      records++;
    }
  }

  const index = [
    '# Nodus · Backups',
    '',
    `${L.version}: ${input.appVersion}`,
    `${L.items}: ${records}`,
    '',
    `## ${L.contents}`,
    '',
    ...entries
      .filter((e) => /\.(md|csv|json)$/.test(e.path))
      .map((e) => `- [${mdLabel(e.path)}](${relativeBackupUrl(e.path)})`),
    '',
    `## ${L.omissions}`,
    '',
    ...(omissions.length ? omissions.map((m) => `- ${mdLabel(m)}`) : [L.none]),
    '',
    L.reuseNote,
    '',
  ];
  await write('README.md', index.join('\n'));
  await write(
    'manifest.json',
    JSON.stringify(
      {
        format: 'nodus.open-backup',
        formatVersion: 1,
        appVersion: input.appVersion,
        createdAt: new Date().toISOString(),
        vaults: sources.map(({ id, name, type }) => ({ id, name, type })),
        options: o,
        records,
        files: entries.map((e) => ({ ...e })),
        omissions,
      },
      null,
      2,
    ) + '\n',
  );
  return {
    records,
    files: entries.length,
    bytes: entries.reduce((n, e) => n + e.bytes, 0),
    sample,
    omissions,
    requiresConfirmation,
    entries,
  };
}
