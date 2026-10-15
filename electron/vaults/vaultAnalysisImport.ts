import { isManualAcademic } from '../ai/academicMode';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import type { LibraryAnalysisReuseComponent } from '@shared/libraryTypes';
import type { AppSettings, VaultAnalysisReuseKind, VaultAnalysisReuseResult, VaultAnalysisReuseWorkResult, Work } from '@shared/types';
import { getDb } from '../db/database';
import { runMigrations, SCHEMA_VERSION } from '../db/migrations';
import { migrateDatabaseSafely } from '../db/migrationSafety';
import { scheduleMigrationRecoveryRetention } from '../db/migrationRecoveryUtilityHost';
import { sleepIdeasWithoutWorks, wakeIdeasWithWorks } from '../db/ideaDormancy';
import { pruneOrphanThemesIn } from '../db/graphIntegrity';
import { getActiveVault, getVault, listVaults } from './vaultRegistry';
import { getSettings } from '../db/settingsRepo';
import { ANALYSIS_PIPELINES, analysisModelFingerprint } from '../db/libraryAnalysisProvenance';

type WorkRow = Work & {
  creators_json?: string | null;
};

interface AnalysisCounts {
  themes: number;
  ideas: number;
  ideaEmbeddings: number;
  summary: number;
  passages: number;
  relations: number;
  authors: number;
  synthesis: number;
  documentProfile: number;
}

interface SourceMatch {
  vaultId: string;
  vaultName: string;
  path: string;
  work: WorkRow;
  counts: AnalysisCounts;
  provenance: Map<LibraryAnalysisReuseComponent, SourceProvenance>;
}

interface SourceProvenance {
  component: LibraryAnalysisReuseComponent;
  documentFingerprint: string;
  libraryItemId: string | null;
  libraryRevisionFingerprint: string | null;
  pipelineVersion: string;
  modelFingerprint: string;
  outputFingerprint: string;
  updatedAt: string;
}

export interface VaultAnalysisReuseContext {
  libraryItemId: string;
  revisionFingerprints: Record<LibraryAnalysisReuseComponent, string | null>;
}

export interface VaultAnalysisReuseOptions {
  signal?: AbortSignal;
  context?: VaultAnalysisReuseContext;
  targetVaultId?: string;
}

const SOURCE_ALIAS = 'reuse_source';

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',');
}

function tableChange(db: Database.Database, tableRows: Record<string, number>, table: string): number {
  const count = (db.prepare('SELECT changes() AS count').get() as { count: number }).count;
  if (count > 0) tableRows[table] = (tableRows[table] ?? 0) + count;
  return count;
}

/**
 * Another vault, opened to look for analysis to reuse. One already on the current schema is only
 * read. One still behind (not opened since an update) is migrated exactly as opening it would:
 * through migrateDatabaseSafely, so its verified pre-migration copy and report exist. Bare
 * runMigrations here upgraded it with neither, and did a read-write open, a migration pass and a
 * checkpointing close (~11 ms on a 2.8 GB vault) for every work looked up.
 */
function openSourceDb(file: string): Database.Database | null {
  if (!fs.existsSync(file)) return null;
  const probe = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (Number(probe.pragma('user_version', { simple: true })) >= SCHEMA_VERSION) return probe;
  } catch (error) {
    probe.close();
    throw error;
  }
  probe.close();
  let db = new Database(file);
  try {
    db = migrateDatabaseSafely(db, file, SCHEMA_VERSION, runMigrations);
    scheduleMigrationRecoveryRetention(file);
    return db;
  } catch (error) {
    if (db.open) db.close();
    throw error;
  }
}

function sourceCounts(db: Database.Database, nodusId: string): AnalysisCounts {
  const row = db
    .prepare(
      /* sql */ `
        SELECT
          (SELECT COUNT(*) FROM work_themes WHERE nodus_id = @id) AS themes,
          (SELECT COUNT(*) FROM idea_occurrences WHERE nodus_id = @id) AS ideas,
          (
            SELECT COUNT(*)
              FROM idea_occurrences io JOIN ideas i ON i.global_id = io.global_id
             WHERE io.nodus_id = @id AND i.embedding IS NOT NULL
          ) + (SELECT COUNT(*) FROM passages WHERE nodus_id = @id AND embedding IS NOT NULL) AS ideaEmbeddings,
          (SELECT COUNT(*) FROM work_summaries WHERE nodus_id = @id) AS summary,
          (SELECT COUNT(*) FROM passages WHERE nodus_id = @id) AS passages,
          (SELECT COUNT(*) FROM edges WHERE source_work = @id) AS relations,
          (SELECT COUNT(*) FROM work_authors WHERE nodus_id = @id) AS authors,
          (SELECT COUNT(*) FROM work_idea_synthesis WHERE nodus_id = @id) AS synthesis
          ,(SELECT COUNT(*) FROM document_profile_state WHERE nodus_id = @id AND status='current') AS documentProfile
      `
    )
    .get({ id: nodusId }) as AnalysisCounts;
  return row;
}

function availableKinds(work: WorkRow, counts: AnalysisCounts): VaultAnalysisReuseKind[] {
  const kinds = new Set<VaultAnalysisReuseKind>();
  if (work.light_status === 'done' || counts.themes > 0) kinds.add('themes');
  if (work.deep_status === 'done' || counts.ideas > 0) kinds.add('ideas');
  if (counts.ideaEmbeddings > 0) kinds.add('ideaEmbeddings');
  if (work.summary_status === 'done' || counts.summary > 0) kinds.add('summary');
  if (counts.passages > 0) kinds.add('passages');
  if (counts.documentProfile > 0) kinds.add('documentProfile');
  return [...kinds];
}

function targetIdentities(target: WorkRow): string[] {
  const aliases = getDb().prepare('SELECT zotero_key FROM work_aliases WHERE nodus_id=?').all(target.nodus_id) as { zotero_key: string }[];
  return [...new Set([target.zotero_key, ...aliases.map((entry) => entry.zotero_key)].filter((value): value is string => Boolean(value?.trim())))];
}

function findSourceMatch(db: Database.Database, identities: string[]): WorkRow | null {
  if (identities.length === 0) return null;
  const candidates = db
    .prepare(
      /* sql */ `
        SELECT w.*
          FROM works w
         WHERE w.zotero_key IN (SELECT value FROM json_each(@identities))
            OR EXISTS (
              SELECT 1 FROM work_aliases a
               WHERE a.nodus_id = w.nodus_id
                 AND a.zotero_key IN (SELECT value FROM json_each(@identities))
            )
         ORDER BY
         CASE WHEN w.deep_status = 'done' THEN 1 ELSE 0 END DESC,
         CASE WHEN w.summary_status = 'done' THEN 1 ELSE 0 END DESC,
         CASE WHEN w.light_status = 'done' THEN 1 ELSE 0 END DESC,
          w.rowid DESC
         LIMIT 8
      `
    )
    .all({
      identities: JSON.stringify(identities),
    }) as WorkRow[];

  return (
    candidates.find((candidate) => candidate.zotero_key && identities.includes(candidate.zotero_key)) ??
    candidates[0] ??
    null
  );
}

function sourceProvenance(db: Database.Database, workId: string): Map<LibraryAnalysisReuseComponent, SourceProvenance> {
  const rows = db.prepare(`
    SELECT component, document_fingerprint, library_item_id, library_revision_fingerprint,
           pipeline_version, model_fingerprint, output_fingerprint, updated_at
      FROM library_analysis_provenance WHERE work_id=?
  `).all(workId) as Record<string, unknown>[];
  return new Map(rows.map((row) => [row.component as LibraryAnalysisReuseComponent, {
    component: row.component as LibraryAnalysisReuseComponent,
    documentFingerprint: String(row.document_fingerprint),
    libraryItemId: row.library_item_id ? String(row.library_item_id) : null,
    libraryRevisionFingerprint: row.library_revision_fingerprint ? String(row.library_revision_fingerprint) : null,
    pipelineVersion: String(row.pipeline_version),
    modelFingerprint: String(row.model_fingerprint), outputFingerprint: String(row.output_fingerprint),
    updatedAt: String(row.updated_at),
  }]));
}

function findSourceMatches(target: WorkRow, targetVaultId?: string): SourceMatch[] {
  const activeVault = getActiveVault();
  const identities = targetIdentities(target);
  const targetId = targetVaultId ?? activeVault.id;
  const candidates = listVaults().filter((vault) => vault.id !== targetId && fs.existsSync(vault.path));
  const matches: SourceMatch[] = [];
  for (const vault of candidates) {
    const db = openSourceDb(vault.path);
    if (!db) continue;
    try {
      const work = findSourceMatch(db, identities);
      if (!work) continue;
      const counts = sourceCounts(db, work.nodus_id);
      if (availableKinds(work, counts).length === 0) continue;
      matches.push({ vaultId: vault.id, vaultName: vault.name, path: vault.path, work, counts, provenance: sourceProvenance(db, work.nodus_id) });
    } finally {
      db.close();
    }
  }
  return matches;
}

type Compatibility = VaultAnalysisReuseWorkResult['compatibility'];

function kindComponent(kind: VaultAnalysisReuseKind): LibraryAnalysisReuseComponent {
  if (kind === 'themes') return 'light';
  if (kind === 'summary') return 'summary';
  if (kind === 'passages') return 'passages';
  if (kind === 'ideaEmbeddings') return 'embeddings';
  if (kind === 'documentProfile') return 'documentProfile';
  return 'ideas';
}

function targetDocumentFingerprint(
  targetDb: Database.Database,
  target: WorkRow,
  component: LibraryAnalysisReuseComponent,
): string | null {
  if (component === 'light') return target.light_hash;
  if (component === 'summary') return target.summary_hash;
  if (component === 'deep' || component === 'ideas') return target.deep_hash;
  if (component === 'documentProfile') return target.resolved_text_hash ?? target.deep_hash;
  const passage = targetDb.prepare('SELECT content_hash FROM passages WHERE nodus_id=? ORDER BY chunk_index LIMIT 1').get(target.nodus_id) as { content_hash: string | null } | undefined;
  return passage?.content_hash ?? target.deep_hash;
}

function decideCompatibility(
  targetDb: Database.Database,
  target: WorkRow,
  match: SourceMatch,
  options: VaultAnalysisReuseOptions,
  settings: AppSettings,
): { imported: VaultAnalysisReuseKind[]; compatibility: Compatibility } {
  const available = new Set(availableKinds(match.work, match.counts));
  const imported: VaultAnalysisReuseKind[] = [];
  const compatibility: Compatibility = {};
  const kinds: VaultAnalysisReuseKind[] = ['themes', 'ideas', 'ideaEmbeddings', 'summary', 'passages', 'documentProfile'];
  const targetCount = (table: string, predicate = 'nodus_id=?'): number => Number((targetDb.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${predicate}`).get(target.nodus_id) as { n: number }).n);
  const targetHasLocalOutput = (kind: VaultAnalysisReuseKind): boolean => {
    if (kind === 'themes') return target.light_status === 'done' || targetCount('work_themes') > 0;
    if (kind === 'ideas') return target.deep_status === 'done' || targetCount('idea_occurrences') > 0;
    if (kind === 'ideaEmbeddings') return targetCount('idea_occurrences io JOIN ideas i ON i.global_id=io.global_id', 'io.nodus_id=? AND i.embedding IS NOT NULL') > 0
      || targetCount('passages', 'nodus_id=? AND embedding IS NOT NULL') > 0;
    if (kind === 'summary') return target.summary_status === 'done' || targetCount('work_summaries') > 0;
    if (kind === 'passages') return targetCount('passages') > 0;
    if (kind === 'documentProfile') return targetCount('document_profile_state', "nodus_id=? AND status='current'") > 0;
    return false;
  };
  for (const kind of kinds) {
    const component = kindComponent(kind);
    if (!available.has(kind)) {
      compatibility[kind] = { state: 'unavailable', reason: `The source vault has no ${kind} output.` };
      continue;
    }
    if (targetHasLocalOutput(kind)) {
      compatibility[kind] = { state: 'pending', reason: `The target has local ${kind} data; automatic reuse will not overwrite a manual decision.` };
      continue;
    }
    const provenance = match.provenance.get(component);
    if (!provenance) {
      compatibility[kind] = { state: 'pending', reason: `The source ${kind} output predates verifiable provenance.` };
      continue;
    }
    if (provenance.pipelineVersion !== ANALYSIS_PIPELINES[component]) {
      compatibility[kind] = { state: 'incompatible', reason: `The ${kind} pipeline version differs.` };
      continue;
    }
    if (provenance.modelFingerprint !== analysisModelFingerprint(component, settings)) {
      compatibility[kind] = { state: 'incompatible', reason: `The ${kind} model configuration differs.` };
      continue;
    }
    if (options.context) {
      const expected = options.context.revisionFingerprints[component];
      if (!expected || provenance.libraryItemId !== options.context.libraryItemId || provenance.libraryRevisionFingerprint !== expected) {
        compatibility[kind] = { state: 'incompatible', reason: `The ${kind} output belongs to another Library revision.` };
        continue;
      }
    } else {
      const expected = targetDocumentFingerprint(targetDb, target, component);
      if (!expected) {
        compatibility[kind] = { state: 'pending', reason: `The target ${kind} input has no verifiable fingerprint.` };
        continue;
      }
      if (provenance.documentFingerprint !== expected) {
        compatibility[kind] = { state: 'incompatible', reason: `The ${kind} document fingerprint differs.` };
        continue;
      }
    }
    imported.push(kind);
    compatibility[kind] = { state: 'reused', reason: `Exact document, pipeline and model fingerprints match.` };
  }
  return { imported, compatibility };
}

function copyThemes(db: Database.Database, sourceId: string, targetId: string, tableRows: Record<string, number>): void {
  const themes = db
    .prepare(
      /* sql */ `
        SELECT t.theme_id, t.label, t.created_at
          FROM ${SOURCE_ALIAS}.work_themes wt
          JOIN ${SOURCE_ALIAS}.themes t ON t.theme_id = wt.theme_id
         WHERE wt.nodus_id = ?
      `
    )
    .all(sourceId) as { theme_id: string; label: string; created_at: string }[];
  if (themes.length === 0) return;
  db.prepare('DELETE FROM work_themes WHERE nodus_id = ?').run(targetId);
  tableChange(db, tableRows, 'work_themes');
  const findTheme = db.prepare('SELECT theme_id FROM themes WHERE label = ?');
  const insertTheme = db.prepare('INSERT OR IGNORE INTO themes (theme_id, label, created_at, pinned) VALUES (?, ?, ?, ?)');
  const linkTheme = db.prepare('INSERT OR IGNORE INTO work_themes (nodus_id, theme_id) VALUES (?, ?)');
  for (const theme of themes) {
    const existing = findTheme.get(theme.label) as { theme_id: string } | undefined;
    const themeId = existing?.theme_id ?? theme.theme_id;
    if (!existing) {
      // Pinned state is a manual vault decision and never travels with derived themes.
      insertTheme.run(theme.theme_id, theme.label, theme.created_at, 0);
      tableChange(db, tableRows, 'themes');
    }
    linkTheme.run(targetId, themeId);
    tableChange(db, tableRows, 'work_themes');
  }
}

function copyIdeaThemeLinks(db: Database.Database, sourceId: string, targetId: string, tableRows: Record<string, number>): void {
  const links = db
    .prepare(
      /* sql */ `
        SELECT it.global_id, it.confidence, it.basis, t.label
          FROM ${SOURCE_ALIAS}.idea_theme_links it
          JOIN ${SOURCE_ALIAS}.themes t ON t.theme_id = it.theme_id
         WHERE it.nodus_id = ?
      `
    )
    .all(sourceId) as { global_id: string; confidence: number; basis: string; label: string }[];
  const findTheme = db.prepare('SELECT theme_id FROM themes WHERE label = ?');
  const insertLink = db.prepare(
    'INSERT OR REPLACE INTO idea_theme_links (nodus_id, global_id, theme_id, confidence, basis) VALUES (?, ?, ?, ?, ?)'
  );
  for (const link of links) {
    const theme = findTheme.get(link.label) as { theme_id: string } | undefined;
    if (!theme) continue;
    insertLink.run(targetId, link.global_id, theme.theme_id, link.confidence, link.basis);
    tableChange(db, tableRows, 'idea_theme_links');
  }
}

function copyDeepAnalysis(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  tableRows: Record<string, number>,
  includeEmbeddings: boolean,
): void {
  db.prepare(
    /* sql */ `
      INSERT OR IGNORE INTO ideas (
        global_id, type, label, statement, embedding, created_at,
        embedding_provider, embedding_model, embedding_dim, embedding_text_hash
      )
      SELECT global_id, type, label, statement,
             CASE WHEN @includeEmbeddings THEN embedding ELSE NULL END, created_at,
             CASE WHEN @includeEmbeddings THEN embedding_provider ELSE NULL END,
             CASE WHEN @includeEmbeddings THEN embedding_model ELSE NULL END,
             CASE WHEN @includeEmbeddings THEN embedding_dim ELSE NULL END,
             CASE WHEN @includeEmbeddings THEN embedding_text_hash ELSE NULL END
        FROM ${SOURCE_ALIAS}.ideas
       WHERE global_id IN (
         SELECT global_id FROM ${SOURCE_ALIAS}.idea_occurrences WHERE nodus_id = @sourceId
       )
    `
  ).run({ sourceId, includeEmbeddings: includeEmbeddings ? 1 : 0 });
  tableChange(db, tableRows, 'ideas');

  db.prepare(
    /* sql */ `
      INSERT OR REPLACE INTO idea_occurrences (global_id, nodus_id, role, development, confidence)
      SELECT global_id, @targetId, role, development, confidence
        FROM ${SOURCE_ALIAS}.idea_occurrences
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'idea_occurrences');

  db.prepare(
    /* sql */ `
      INSERT OR IGNORE INTO evidence (id, global_id, nodus_id, quote, location, kind, source_ref, page_number)
      SELECT id, global_id, @targetId, quote, location, kind, source_ref, page_number
        FROM ${SOURCE_ALIAS}.evidence
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'evidence');

  copyIdeaThemeLinks(db, sourceId, targetId, tableRows);

  db.prepare(
    /* sql */ `
      INSERT OR IGNORE INTO gaps (id, nodus_id, related_idea, kind, statement, confidence, evidence_id)
      SELECT id, @targetId, related_idea, kind, statement, confidence, evidence_id
        FROM ${SOURCE_ALIAS}.gaps
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'gaps');

  db.prepare(
    /* sql */ `
      INSERT OR IGNORE INTO external_refs (id, nodus_id, from_idea, cited_work, type, basis, confidence, evidence_id)
      SELECT id, @targetId, from_idea, cited_work, type, basis, confidence, evidence_id
        FROM ${SOURCE_ALIAS}.external_refs
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'external_refs');

}

function copyIdeaEmbeddings(db: Database.Database, sourceId: string, targetId: string, tableRows: Record<string, number>): void {
  db.prepare(`
    UPDATE ideas
       SET embedding = (SELECT source.embedding FROM ${SOURCE_ALIAS}.ideas source WHERE source.global_id=ideas.global_id),
           embedding_provider = (SELECT source.embedding_provider FROM ${SOURCE_ALIAS}.ideas source WHERE source.global_id=ideas.global_id),
           embedding_model = (SELECT source.embedding_model FROM ${SOURCE_ALIAS}.ideas source WHERE source.global_id=ideas.global_id),
           embedding_dim = (SELECT source.embedding_dim FROM ${SOURCE_ALIAS}.ideas source WHERE source.global_id=ideas.global_id),
           embedding_text_hash = (SELECT source.embedding_text_hash FROM ${SOURCE_ALIAS}.ideas source WHERE source.global_id=ideas.global_id)
     WHERE global_id IN (SELECT global_id FROM ${SOURCE_ALIAS}.idea_occurrences WHERE nodus_id=@sourceId)
       AND global_id IN (SELECT global_id FROM idea_occurrences WHERE nodus_id=@targetId)
       AND EXISTS (SELECT 1 FROM ${SOURCE_ALIAS}.ideas source WHERE source.global_id=ideas.global_id AND source.embedding IS NOT NULL)
  `).run({ sourceId, targetId });
  tableChange(db, tableRows, 'ideas');
}

function copySummary(db: Database.Database, sourceId: string, targetId: string, tableRows: Record<string, number>): void {
  db.prepare(
    /* sql */ `
      INSERT OR REPLACE INTO work_summaries (
        nodus_id, summary, source_level, model_json, content_hash, embedding,
        embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at, updated_at
      )
      SELECT @targetId, summary, source_level, model_json, content_hash, embedding,
             embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at, updated_at
        FROM ${SOURCE_ALIAS}.work_summaries
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'work_summaries');
}

function copyPassages(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  tableRows: Record<string, number>,
  includeEmbeddings: boolean,
): void {
  db.prepare('DELETE FROM passages WHERE nodus_id = ?').run(targetId);
  tableChange(db, tableRows, 'passages');
  db.prepare(
    /* sql */ `
      INSERT OR REPLACE INTO passages (
        passage_id, nodus_id, chunk_index, text, page_label, source_ref, page_number, char_len, content_hash,
        embedding, embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at
      )
      SELECT @targetId || '#' || chunk_index, @targetId, chunk_index, text, page_label, source_ref, page_number, char_len, content_hash,
             CASE WHEN @includeEmbeddings THEN embedding ELSE NULL END,
             CASE WHEN @includeEmbeddings THEN embedding_provider ELSE NULL END,
             CASE WHEN @includeEmbeddings THEN embedding_model ELSE NULL END,
             CASE WHEN @includeEmbeddings THEN embedding_dim ELSE NULL END,
             CASE WHEN @includeEmbeddings THEN embedding_text_hash ELSE NULL END, created_at
        FROM ${SOURCE_ALIAS}.passages
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId, includeEmbeddings: includeEmbeddings ? 1 : 0 });
  tableChange(db, tableRows, 'passages');
}

function copiedComponents(imported: VaultAnalysisReuseKind[]): LibraryAnalysisReuseComponent[] {
  const components = new Set<LibraryAnalysisReuseComponent>();
  for (const kind of imported) components.add(kindComponent(kind));
  if (imported.includes('ideas')) components.add('deep');
  return [...components];
}

function copyDocumentProfile(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  tableRows: Record<string, number>,
): void {
  const state = db.prepare(
    `SELECT current_version_id FROM ${SOURCE_ALIAS}.document_profile_state WHERE nodus_id=? AND status='current'`
  ).get(sourceId) as { current_version_id: string } | undefined;
  if (!state?.current_version_id) return;
  const sourceVersion = state.current_version_id;
  const versionId = `${targetId}:doc:${sourceVersion}`;
  db.prepare('DELETE FROM document_profile_state WHERE nodus_id=?').run(targetId);
  db.prepare('DELETE FROM document_profile_versions WHERE nodus_id=?').run(targetId);
  for (const table of ['document_profile_state', 'document_profile_versions']) tableChange(db, tableRows, table);
  db.prepare(`
    INSERT INTO document_profile_versions (
      version_id,nodus_id,state,source_fingerprint,pipeline_version,schema_version,source_language,
      presentation_language,overview,profile_json,generator_model_json,auditor_model_json,prompt_hash,
      audit_json,quality_score,input_tokens,output_tokens,estimated_cost_usd,created_at,published_at
    ) SELECT @versionId,@targetId,'current',source_fingerprint,pipeline_version,schema_version,source_language,
             presentation_language,overview,profile_json,generator_model_json,auditor_model_json,prompt_hash,
             audit_json,quality_score,input_tokens,output_tokens,estimated_cost_usd,created_at,published_at
        FROM ${SOURCE_ALIAS}.document_profile_versions WHERE version_id=@sourceVersion
  `).run({ versionId, targetId, sourceVersion });
  tableChange(db, tableRows, 'document_profile_versions');
  db.prepare(`
    INSERT INTO document_profile_fields(field_id,version_id,nodus_id,kind,ordinal,text,confidence,centrality,confidence_source,created_at)
    SELECT @targetId||':field:'||field_id,@versionId,@targetId,kind,ordinal,text,confidence,centrality,confidence_source,created_at
      FROM ${SOURCE_ALIAS}.document_profile_fields WHERE version_id=@sourceVersion
  `).run({ targetId, versionId, sourceVersion });
  tableChange(db, tableRows, 'document_profile_fields');
  db.prepare(`
    INSERT INTO document_sections(section_id,version_id,nodus_id,parent_section_id,level,ordinal,title,role,summary,
      concepts_json,claims_json,page_start,page_end,source_ref,page_start_number,page_end_number,
      char_start,char_end,content_hash,created_at)
    SELECT @targetId||':section:'||section_id,@versionId,@targetId,
      CASE WHEN parent_section_id IS NULL THEN NULL ELSE @targetId||':section:'||parent_section_id END,
      level,ordinal,title,role,summary,concepts_json,claims_json,page_start,page_end,source_ref,
      page_start_number,page_end_number,char_start,char_end,content_hash,created_at
      FROM ${SOURCE_ALIAS}.document_sections WHERE version_id=@sourceVersion
  `).run({ targetId, versionId, sourceVersion });
  tableChange(db, tableRows, 'document_sections');
  db.prepare(`
    INSERT INTO document_profile_support(support_id,version_id,nodus_id,target_kind,target_id,section_id,passage_id,
      page_start,page_end,source_ref,page_start_number,page_end_number,char_start,char_end,quote,quote_hash,
      support_kind,confidence,validation_status,created_at)
    SELECT @targetId||':support:'||support_id,@versionId,@targetId,target_kind,
      CASE WHEN target_kind='field' THEN @targetId||':field:'||target_id ELSE @targetId||':section:'||target_id END,
      CASE WHEN section_id IS NULL THEN NULL ELSE @targetId||':section:'||section_id END,
      CASE WHEN passage_id IS NULL THEN NULL ELSE @targetId||substr(passage_id,length(@sourceId)+1) END,
      page_start,page_end,source_ref,page_start_number,page_end_number,char_start,char_end,quote,quote_hash,
      support_kind,confidence,validation_status,created_at
      FROM ${SOURCE_ALIAS}.document_profile_support WHERE version_id=@sourceVersion
  `).run({ targetId, sourceId, versionId, sourceVersion });
  tableChange(db, tableRows, 'document_profile_support');
  db.prepare(`
    INSERT INTO document_vectors(vector_id,nodus_id,version_id,kind,source_id,text,text_hash,weight,embedding,
      embedding_provider,embedding_model,embedding_dim,created_at)
    SELECT @targetId||':vector:'||vector_id,@targetId,@versionId,kind,
      CASE WHEN kind='section' THEN @targetId||':section:'||source_id
           WHEN kind='overview' THEN source_id ELSE @targetId||':field:'||source_id END,
      text,text_hash,weight,embedding,embedding_provider,embedding_model,embedding_dim,created_at
      FROM ${SOURCE_ALIAS}.document_vectors WHERE version_id=@sourceVersion
  `).run({ targetId, versionId, sourceVersion });
  tableChange(db, tableRows, 'document_vectors');
  db.prepare(`
    INSERT INTO document_idea_links(version_id,nodus_id,global_id,target_kind,target_id,role,score,created_at)
    SELECT @versionId,@targetId,link.global_id,link.target_kind,
      CASE WHEN link.target_kind='field' THEN @targetId||':field:'||link.target_id ELSE @targetId||':section:'||link.target_id END,
      link.role,link.score,link.created_at
      FROM ${SOURCE_ALIAS}.document_idea_links link JOIN ideas i ON i.global_id=link.global_id
     WHERE link.version_id=@sourceVersion
  `).run({ targetId, versionId, sourceVersion });
  tableChange(db, tableRows, 'document_idea_links');
  db.prepare(`
    INSERT INTO document_profile_overrides(override_id,nodus_id,field_path,base_version_id,generated_value_json,value_json,
      verified,conflict,created_at,updated_at)
    SELECT @targetId||':override:'||override_id,@targetId,field_path,@versionId,generated_value_json,value_json,
      verified,conflict,created_at,updated_at FROM ${SOURCE_ALIAS}.document_profile_overrides WHERE nodus_id=@sourceId
  `).run({ targetId, sourceId, versionId });
  tableChange(db, tableRows, 'document_profile_overrides');
  const sourceState = db.prepare(`SELECT * FROM ${SOURCE_ALIAS}.document_profile_state WHERE nodus_id=?`).get(sourceId) as Record<string, unknown>;
  db.prepare(`INSERT INTO document_profile_state(nodus_id,current_version_id,status,source_fingerprint,profile_fingerprint,
    pipeline_version,stale_reason,error,updated_at) VALUES(?,?,'current',?,?,?,?,?,?)`).run(
      targetId, versionId, sourceState.source_fingerprint, sourceState.profile_fingerprint,
      sourceState.pipeline_version, null, null, sourceState.updated_at,
    );
  tableChange(db, tableRows, 'document_profile_state');
  const title = (db.prepare('SELECT title FROM works WHERE nodus_id=?').get(targetId) as { title: string }).title;
  const overview = (db.prepare('SELECT overview FROM document_profile_versions WHERE version_id=?').get(versionId) as { overview: string }).overview;
  const fields = (db.prepare('SELECT text FROM document_profile_fields WHERE version_id=? ORDER BY kind,ordinal').all(versionId) as Array<{ text: string }>).map((row) => row.text).join('\n');
  db.prepare('DELETE FROM document_profiles_fts WHERE nodus_id=?').run(targetId);
  db.prepare('INSERT INTO document_profiles_fts(nodus_id,version_id,title,overview,fields) VALUES(?,?,?,?,?)').run(targetId, versionId, title, overview, fields);
  db.prepare('DELETE FROM document_sections_fts WHERE nodus_id=?').run(targetId);
  db.prepare(`INSERT INTO document_sections_fts(section_id,nodus_id,title,summary,concepts)
    SELECT section_id,nodus_id,title,summary,concepts_json FROM document_sections WHERE version_id=?`).run(versionId);
}

function copyProvenance(
  db: Database.Database,
  sourceId: string,
  targetId: string,
  sourceVaultId: string,
  imported: VaultAnalysisReuseKind[],
  tableRows: Record<string, number>,
): void {
  const components = copiedComponents(imported);
  if (components.length === 0) return;
  db.prepare(`
    INSERT OR REPLACE INTO library_analysis_provenance (
      work_id, component, document_fingerprint, library_item_id, library_revision_fingerprint,
      pipeline_version, model_fingerprint, output_fingerprint, source_vault_id, source_work_id, updated_at
    )
    SELECT @targetId, component, document_fingerprint, library_item_id, library_revision_fingerprint,
           pipeline_version, model_fingerprint, output_fingerprint, @sourceVaultId, @sourceId, @now
      FROM ${SOURCE_ALIAS}.library_analysis_provenance
     WHERE work_id=@sourceId AND component IN (SELECT value FROM json_each(@components))
  `).run({ targetId, sourceId, sourceVaultId, now: new Date().toISOString(), components: JSON.stringify(components) });
  tableChange(db, tableRows, 'library_analysis_provenance');
  const freshness = db.prepare(`
    INSERT INTO library_analysis_freshness (work_id, component, freshness, fingerprint, reason, updated_at)
    SELECT @targetId, component, 'current', output_fingerprint, @reason, @now
      FROM library_analysis_provenance
     WHERE work_id=@targetId AND component IN (SELECT value FROM json_each(@components))
    ON CONFLICT(work_id, component) DO UPDATE SET
      freshness='current', fingerprint=excluded.fingerprint, reason=excluded.reason, updated_at=excluded.updated_at
  `);
  freshness.run({
    targetId,
    components: JSON.stringify(components),
    reason: `Reused from ${sourceVaultId} after exact provenance match.`,
    now: new Date().toISOString(),
  });
  tableChange(db, tableRows, 'library_analysis_freshness');
}

function clearReusableTargetRows(db: Database.Database, targetId: string, imported: VaultAnalysisReuseKind[]): void {
  if (!imported.includes('ideas')) return;
  // Clear only the machine-derived idea payload being replaced. Relations,
  // authors, notes and manual work flags are deliberately outside this set.
  for (const table of ['idea_occurrences', 'evidence', 'idea_theme_links', 'gaps', 'external_refs']) {
    db.prepare(`DELETE FROM ${table} WHERE nodus_id=?`).run(targetId);
  }
}

function updateWorkStatus(
  db: Database.Database,
  source: WorkRow,
  targetId: string,
  kinds: VaultAnalysisReuseKind[]
): void {
  const lightImported = kinds.includes('themes');
  const deepImported = kinds.includes('ideas');
  const summaryImported = kinds.includes('summary');
  db.prepare(
    /* sql */ `
      UPDATE works
         SET light_status = CASE WHEN @lightImported THEN @lightStatus ELSE light_status END,
             light_at     = CASE WHEN @lightImported THEN @lightAt     ELSE light_at     END,
             light_hash   = CASE WHEN @lightImported THEN @lightHash   ELSE light_hash   END,
             deep_status  = CASE WHEN @deepImported THEN @deepStatus ELSE deep_status END,
             deep_at      = CASE WHEN @deepImported THEN @deepAt     ELSE deep_at     END,
             deep_hash    = CASE WHEN @deepImported THEN @deepHash   ELSE deep_hash   END,
             summary_status = CASE WHEN @summaryImported THEN @summaryStatus ELSE summary_status END,
             summary_at     = CASE WHEN @summaryImported THEN @summaryAt     ELSE summary_at     END,
             summary_hash   = CASE WHEN @summaryImported THEN @summaryHash   ELSE summary_hash   END,
             summary_error  = CASE WHEN @summaryImported THEN NULL           ELSE summary_error  END,
             source_type    = COALESCE(source_type, @sourceType),
             creators_json  = COALESCE(creators_json, @creatorsJson)
       WHERE nodus_id = @targetId
    `
  ).run({
    targetId,
    lightImported: lightImported ? 1 : 0,
    lightStatus: source.light_status,
    lightAt: source.light_at,
    lightHash: source.light_hash,
    deepImported: deepImported ? 1 : 0,
    deepStatus: source.deep_status,
    deepAt: source.deep_at,
    deepHash: source.deep_hash,
    summaryImported: summaryImported ? 1 : 0,
    summaryStatus: source.summary_status,
    summaryAt: source.summary_at,
    summaryHash: source.summary_hash,
    sourceType: source.source_type,
    creatorsJson: source.creators_json ?? null,
  });
}

function importMatch(
  targetDb: Database.Database,
  target: WorkRow,
  match: SourceMatch,
  options: VaultAnalysisReuseOptions,
  settings: AppSettings,
): VaultAnalysisReuseWorkResult {
  const { imported, compatibility } = decideCompatibility(targetDb, target, match, options, settings);
  const tableRows: Record<string, number> = {};
  if (imported.length === 0) {
    return {
      nodusId: target.nodus_id,
      matchedVaultId: match.vaultId,
      matchedVaultName: match.vaultName,
      matchedSourceNodusId: match.work.nodus_id,
      imported,
      importedRows: 0,
      tableRows,
      compatibility,
    };
  }

  if (options.signal?.aborted) {
    for (const kind of imported) compatibility[kind] = { state: 'canceled', reason: 'Reuse was canceled before the transaction started.' };
    return {
      nodusId: target.nodus_id, matchedVaultId: match.vaultId, matchedVaultName: match.vaultName,
      matchedSourceNodusId: match.work.nodus_id, imported: [], importedRows: 0, tableRows, compatibility,
    };
  }

  targetDb.prepare(`ATTACH DATABASE ? AS ${SOURCE_ALIAS}`).run(match.path);
  try {
    targetDb.pragma('foreign_keys = OFF');
    const tx = targetDb.transaction(() => {
      if (options.signal?.aborted) throw new Error('LIBRARY_REUSE_CANCELED');
      clearReusableTargetRows(targetDb, target.nodus_id, imported);
      if (imported.includes('themes')) copyThemes(targetDb, match.work.nodus_id, target.nodus_id, tableRows);
      if (imported.includes('ideas')) {
        copyDeepAnalysis(targetDb, match.work.nodus_id, target.nodus_id, tableRows, imported.includes('ideaEmbeddings'));
        // The same rule a rescan applies: an idea this work now holds is awake. It may
        // already have existed here asleep, and INSERT OR IGNORE left that row as it was.
        // The sleep pass only matters if the target ever held ideas of its own, which
        // reuse refuses today; it keeps the invariant if that rule ever loosens.
        const now = new Date().toISOString();
        const importedIdeas = (targetDb.prepare('SELECT global_id FROM idea_occurrences WHERE nodus_id = ?').all(target.nodus_id) as Array<{ global_id: string }>)
          .map((row) => row.global_id);
        wakeIdeasWithWorks(targetDb, importedIdeas);
        sleepIdeasWithoutWorks(targetDb, now);
      } else if (imported.includes('ideaEmbeddings')) copyIdeaEmbeddings(targetDb, match.work.nodus_id, target.nodus_id, tableRows);
      if (imported.includes('summary')) copySummary(targetDb, match.work.nodus_id, target.nodus_id, tableRows);
      if (imported.includes('passages')) copyPassages(targetDb, match.work.nodus_id, target.nodus_id, tableRows, imported.includes('ideaEmbeddings'));
      if (imported.includes('documentProfile')) copyDocumentProfile(targetDb, match.work.nodus_id, target.nodus_id, tableRows);
      if (imported.includes('themes') || imported.includes('ideas')) pruneOrphanThemesIn(targetDb);
      // Checkpoints describe an in-flight operation, not a reusable result.
      updateWorkStatus(targetDb, match.work, target.nodus_id, imported);
      copyProvenance(targetDb, match.work.nodus_id, target.nodus_id, match.vaultId, imported, tableRows);
    });
    tx();
  } finally {
    targetDb.pragma('foreign_keys = ON');
    try {
      targetDb.prepare(`DETACH DATABASE ${SOURCE_ALIAS}`).run();
    } catch {
      /* ignore failed detach after an interrupted attach */
    }
  }

  const importedRows = Object.values(tableRows).reduce((sum, count) => sum + count, 0);
  return {
    nodusId: target.nodus_id,
    matchedVaultId: match.vaultId,
    matchedVaultName: match.vaultName,
    matchedSourceNodusId: match.work.nodus_id,
    imported,
    importedRows,
    tableRows,
    compatibility,
  };
}

export async function reuseVaultAnalysisForWorks(nodusIds: string[], options: VaultAnalysisReuseOptions = {}): Promise<VaultAnalysisReuseResult> {
  const targetVault = options.targetVaultId ? getVault(options.targetVaultId) : getActiveVault();
  if (!targetVault) throw new Error('The target vault no longer exists.');
  if (targetVault.origin === 'connected' && (targetVault.remote?.role === 'reader' || targetVault.remote?.state !== 'active')) {
    throw new Error('This connected vault is read-only or inactive.');
  }
  const ids = [...new Set(nodusIds.map((id) => id.trim()).filter(Boolean))];
  const targetDb = getDb();
  const works: VaultAnalysisReuseWorkResult[] = [];
  if (isManualAcademic() || ids.length === 0) return { requested: 0, matched: 0, imported: 0, canceled: false, works };

  const rows = targetDb
    .prepare(`SELECT * FROM works WHERE nodus_id IN (${placeholders(ids)})`)
    .all(...ids) as WorkRow[];
  const targetsById = new Map(rows.map((row) => [row.nodus_id, row]));

  for (const id of ids) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (options.signal?.aborted) break;
    const target = targetsById.get(id);
    if (!target) {
      works.push({
        nodusId: id,
        matchedVaultId: null,
        matchedVaultName: null,
        matchedSourceNodusId: null,
        imported: [],
        importedRows: 0,
        tableRows: {},
        compatibility: {},
      });
      continue;
    }
    const matches = findSourceMatches(target, options.targetVaultId);
    if (matches.length === 0) {
      works.push({
        nodusId: id,
        matchedVaultId: null,
        matchedVaultName: null,
        matchedSourceNodusId: null,
        imported: [],
        importedRows: 0,
        tableRows: {},
        compatibility: {},
      });
      continue;
    }
    const settings = getSettings();
    const match = matches
      .map((candidate) => ({ candidate, score: decideCompatibility(targetDb, target, candidate, options, settings).imported.length }))
      .sort((left, right) => right.score - left.score || left.candidate.vaultName.localeCompare(right.candidate.vaultName))[0].candidate;
    works.push(importMatch(targetDb, target, match, options, settings));
  }

  return {
    requested: ids.length,
    matched: works.filter((work) => work.matchedVaultId !== null).length,
    imported: works.filter((work) => work.imported.length > 0).length,
    canceled: Boolean(options.signal?.aborted),
    works,
  };
}
