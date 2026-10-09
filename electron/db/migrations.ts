import { STUDY_FOCUS_SQL, ensureStudyFocusTaskColumn } from './studyFocusSchema';
import { STUDY_NOTE_LINKS_SQL } from './studyNoteLinksSchema';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { migrateWorkspaceContent } from './workspaceMigration';
import { backfillUniversalPageDocuments, migrateUniversalPages } from './pageMigration';
import { databaseCellStorage } from '@shared/databaseCellStorage';
import { columnTypeDef } from '@shared/databases';
import { normalizeDatabaseViewConfig } from '@shared/databaseViewConfig';
import { bibliographicPlainText } from '@shared/bibliographicText';

export interface Migration {
  version: number;
  up: string;
  /** Data transform that cannot be expressed safely in SQLite (for example SHA-256). */
  after?: (db: Database.Database) => void;
}

const DATABASE_RESEARCH_REPORT_TYPES_SQL = "'general', 'data_quality', 'cohort_comparison', 'temporal_anomalies', 'relationships_integrity', 'causal_impact', 'survival_retention', 'privacy_attachments', 'formulas_reconciliation'";

/**
 * Add a column only where it is missing. The migrations from 180 on were numbered
 * differently in earlier builds of the research notebooks branch (main's attendance took
 * 179 first), so a database from one of those builds can already have a column while its
 * user_version points before the migration that now adds it. Like v168, these are
 * idempotent rather than failing the vault's opening on "duplicate column name".
 */
function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const present = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
  if (!present) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Teaching attendance (migration 179), kept as one statement set so migration 192 can
 * re-apply it verbatim; every object is IF NOT EXISTS.
 */
const TEACHING_ATTENDANCE_SQL = /* sql */ `
      CREATE TABLE IF NOT EXISTS teaching_attendance (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES teaching_students(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_teaching_attendance_key ON teaching_attendance(student_id, date);

      CREATE TABLE IF NOT EXISTS teaching_attendance_holidays (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES teaching_groups(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_teaching_attendance_holidays_key ON teaching_attendance_holidays(group_id, date);
    `;

/** v168 is deliberately idempotent: recovery tests and older prerelease builds may
 * have the column while their user_version still points before this migration. */
function ensureDatabaseResearchReportTypeColumns(db: Database.Database): void {
  const hasColumn = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
  if (!hasColumn('database_research_runs', 'report_type')) {
    db.exec(`ALTER TABLE database_research_runs ADD COLUMN report_type TEXT NOT NULL DEFAULT 'general' CHECK (report_type IN (${DATABASE_RESEARCH_REPORT_TYPES_SQL}))`);
  }
  if (!hasColumn('database_research_reports', 'report_type')) {
    db.exec(`ALTER TABLE database_research_reports ADD COLUMN report_type TEXT NOT NULL DEFAULT 'general' CHECK (report_type IN (${DATABASE_RESEARCH_REPORT_TYPES_SQL}))`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS database_research_runs_report_type_idx ON database_research_runs(report_type, updated_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS database_research_reports_report_type_idx ON database_research_reports(report_type, updated_at DESC)`);
}

/** v169 adds nullable statistical provenance fields to claims. The helper is
 * idempotent because prerelease builds may have applied part of this additive
 * migration before user_version was advanced. */
function ensureDatabaseResearchClaimMetricColumns(db: Database.Database): void {
  const hasColumn = (column: string) =>
    (db.prepare('PRAGMA table_info(database_research_claims)').all() as Array<{ name: string }>)
      .some((row) => row.name === column);
  const additions: Array<[string, string]> = [
    ['effect', 'REAL'],
    ['interval_json', 'TEXT'],
    ['p_value', 'REAL'],
    ['q_value', 'REAL'],
    ['sensitivity_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['limitations_json', "TEXT NOT NULL DEFAULT '[]'"],
  ];
  for (const [column, definition] of additions) {
    if (!hasColumn(column)) db.exec(`ALTER TABLE database_research_claims ADD COLUMN ${column} ${definition}`);
  }
}

function ensureDatabaseResearchReaderColumns(db: Database.Database): void {
  const hasColumn = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
  if (!hasColumn('database_research_reports', 'read_at')) db.exec('ALTER TABLE database_research_reports ADD COLUMN read_at TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS database_research_report_annotations (
    id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES database_research_reports(id) ON DELETE CASCADE,
    scope TEXT NOT NULL DEFAULT 'source', kind TEXT NOT NULL CHECK (kind IN ('highlight','comment','bookmark')),
    color TEXT CHECK (color IS NULL OR color IN ('yellow','rose','blue','mint','lavender','peach')),
    start_offset INTEGER NOT NULL CHECK (start_offset >= 0), end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
    selected_text TEXT NOT NULL, prefix TEXT NOT NULL DEFAULT '', suffix TEXT NOT NULL DEFAULT '', comment_text TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_database_research_report_annotations_report ON database_research_report_annotations(report_id, scope, start_offset, created_at)');
}

/** v171 is idempotent because recovery can replay additive migrations after a
 * user_version rollback while the physical column is already present. */
function ensureZoteroFingerprintColumn(db: Database.Database): void {
  const hasFingerprint = (db.prepare('PRAGMA table_info(works)').all() as Array<{ name: string }>)
    .some((row) => row.name === 'zotero_fingerprint');
  if (!hasFingerprint) db.exec('ALTER TABLE works ADD COLUMN zotero_fingerprint TEXT');
  db.exec(`
    DROP TRIGGER IF EXISTS works_document_profile_stale_deep;
    CREATE TRIGGER works_document_profile_stale_deep
    AFTER UPDATE OF deep_hash, zotero_version, zotero_fingerprint ON works
    WHEN OLD.deep_hash IS NOT NEW.deep_hash
      OR OLD.zotero_version IS NOT NEW.zotero_version
      OR (OLD.zotero_fingerprint IS NOT NULL AND OLD.zotero_fingerprint IS NOT NEW.zotero_fingerprint)
    BEGIN
      UPDATE document_profile_state
         SET status='stale', stale_reason='source_changed', error=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE nodus_id=NEW.nodus_id AND current_version_id IS NOT NULL;
    END;
  `);
}

/** Persist summary failures so a restart does not erase the actionable cause. */
function ensureSummaryErrorColumn(db: Database.Database): void {
  const hasColumn = (db.prepare('PRAGMA table_info(works)').all() as Array<{ name: string }>)
    .some((row) => row.name === 'summary_error');
  if (!hasColumn) db.exec('ALTER TABLE works ADD COLUMN summary_error TEXT');
}

/**
 * Move Zotero's rich title markup out of the plain title used by every UI,
 * search, prompt, and progress surface. The source value remains available for
 * future rich citation rendering, and the Zotero fingerprint is left untouched.
 */
function ensureZoteroTitleMarkupColumn(db: Database.Database): void {
  const hasColumn = (db.prepare('PRAGMA table_info(works)').all() as Array<{ name: string }>)
    .some((row) => row.name === 'zotero_title_markup');
  if (!hasColumn) db.exec('ALTER TABLE works ADD COLUMN zotero_title_markup TEXT');
  const rows = db.prepare('SELECT nodus_id, title, zotero_title_markup FROM works').all() as Array<{
    nodus_id: string;
    title: string | null;
    zotero_title_markup: string | null;
  }>;
  const update = db.prepare('UPDATE works SET title=?, zotero_title_markup=? WHERE nodus_id=?');
  for (const row of rows) {
    if (row.zotero_title_markup || !row.title) continue;
    const plain = bibliographicPlainText(row.title);
    if (plain !== row.title) update.run(plain || '(sin título)', row.title, row.nodus_id);
  }
}

// Versioned, append-only migrations. Never edit an existing migration's SQL once
// shipped — add a new one. The current schema version is the highest applied.
export const SCHEMA_VERSION = 200;

// What this build stamps on what it SENDS to another machine is SYNC_SCHEMA_VERSION
// (./syncSchemaVersion.ts): raise it too when a migration changes a table's columns.

export const migrations: Migration[] = [
  {
    version: 1,
    up: /* sql */ `
      CREATE TABLE works (
        nodus_id        TEXT PRIMARY KEY,
        zotero_key      TEXT UNIQUE,
        zotero_version  INTEGER,
        title           TEXT,
        authors_json    TEXT,
        year            INTEGER,
        item_type       TEXT,
        doi             TEXT,
        read_tag        INTEGER DEFAULT 0,
        manual_deep     INTEGER DEFAULT 0,
        deep_trigger    TEXT,
        source_type     TEXT,
        light_status    TEXT DEFAULT 'pending',
        light_at        TEXT,
        light_hash      TEXT,
        deep_status     TEXT DEFAULT 'none',
        deep_at         TEXT,
        deep_hash       TEXT,
        archived        INTEGER DEFAULT 0,
        notes           TEXT
      );

      CREATE TABLE work_aliases (
        nodus_id   TEXT,
        zotero_key TEXT,
        PRIMARY KEY (nodus_id, zotero_key)
      );

      CREATE TABLE themes (
        theme_id   TEXT PRIMARY KEY,
        label      TEXT UNIQUE,
        created_at TEXT
      );

      CREATE TABLE work_themes (
        nodus_id TEXT,
        theme_id TEXT,
        PRIMARY KEY (nodus_id, theme_id)
      );

      CREATE TABLE ideas (
        global_id  TEXT PRIMARY KEY,
        type       TEXT,
        label      TEXT,
        statement  TEXT,
        embedding  BLOB,
        created_at TEXT
      );

      CREATE TABLE idea_occurrences (
        global_id   TEXT,
        nodus_id    TEXT,
        role        TEXT,
        development TEXT,
        confidence  REAL,
        PRIMARY KEY (global_id, nodus_id)
      );

      CREATE TABLE evidence (
        id        TEXT PRIMARY KEY,
        global_id TEXT,
        nodus_id  TEXT,
        quote     TEXT,
        location  TEXT,
        kind      TEXT
      );

      CREATE TABLE edges (
        id          TEXT PRIMARY KEY,
        from_id     TEXT,
        to_id       TEXT,
        type        TEXT,
        basis       TEXT,
        confidence  REAL,
        source_work TEXT
      );

      CREATE TABLE authors (
        author_id   TEXT PRIMARY KEY,
        name        TEXT,
        affiliation TEXT
      );

      CREATE TABLE author_relations (
        from_author TEXT,
        to_author   TEXT,
        type        TEXT,
        weight      REAL,
        PRIMARY KEY (from_author, to_author, type)
      );

      CREATE TABLE work_authors (
        nodus_id  TEXT,
        author_id TEXT,
        PRIMARY KEY (nodus_id, author_id)
      );

      CREATE TABLE gaps (
        id          TEXT PRIMARY KEY,
        nodus_id    TEXT,
        related_idea TEXT,
        kind        TEXT,
        statement   TEXT,
        confidence  REAL,
        evidence_id TEXT
      );

      CREATE TABLE external_refs (
        id          TEXT PRIMARY KEY,
        nodus_id    TEXT,
        from_idea   TEXT,
        cited_work  TEXT,
        type        TEXT,
        basis       TEXT,
        confidence  REAL,
        evidence_id TEXT
      );

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE sync_log (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        at      TEXT,
        mode    TEXT,
        summary TEXT
      );

      CREATE INDEX idx_idea_occ_nodus ON idea_occurrences(nodus_id);
      CREATE INDEX idx_idea_occ_global ON idea_occurrences(global_id);
      CREATE INDEX idx_evidence_global ON evidence(global_id);
      CREATE INDEX idx_edges_from ON edges(from_id);
      CREATE INDEX idx_edges_to ON edges(to_id);
      CREATE INDEX idx_gaps_nodus ON gaps(nodus_id);
      CREATE INDEX idx_work_themes_theme ON work_themes(theme_id);
    `,
  },
  {
    version: 2,
    up: /* sql */ `
      UPDATE works SET light_status = 'none' WHERE light_status = 'pending';
      UPDATE works SET deep_status = 'none' WHERE deep_status = 'pending';
    `,
  },
  {
    version: 3,
    up: /* sql */ `
      CREATE TABLE extraction_cache (
        file_path      TEXT PRIMARY KEY,
        file_size      INTEGER NOT NULL,
        file_mtime_ms  REAL NOT NULL,
        ocr_enabled    INTEGER NOT NULL,
        ocr_languages  TEXT NOT NULL,
        ocr_max_pages  INTEGER NOT NULL,
        cache_version  INTEGER NOT NULL,
        source_type    TEXT NOT NULL,
        text           TEXT NOT NULL,
        notes          TEXT,
        analysis_json  TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );

      CREATE INDEX idx_extraction_cache_key
        ON extraction_cache(file_path, file_size, file_mtime_ms, ocr_enabled, ocr_languages, ocr_max_pages, cache_version);
    `,
  },
  {
    version: 4,
    up: /* sql */ `
      CREATE TABLE idea_theme_links (
        nodus_id   TEXT NOT NULL,
        global_id  TEXT NOT NULL,
        theme_id   TEXT NOT NULL,
        confidence REAL NOT NULL,
        basis      TEXT NOT NULL,
        PRIMARY KEY (nodus_id, global_id, theme_id)
      );

      CREATE INDEX idx_idea_theme_links_global ON idea_theme_links(global_id);
      CREATE INDEX idx_idea_theme_links_theme ON idea_theme_links(theme_id);
    `,
  },
  {
    version: 5,
    up: /* sql */ `
      CREATE TABLE chat_conversations (
        id             TEXT PRIMARY KEY,
        title          TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        archived       INTEGER NOT NULL DEFAULT 0,
        model_json     TEXT,
        selection_json TEXT
      );

      CREATE TABLE chat_messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        seq             INTEGER NOT NULL,
        role            TEXT NOT NULL,
        content         TEXT NOT NULL,
        selection_key   TEXT,
        stats_json      TEXT,
        error           INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL
      );

      CREATE INDEX idx_chat_messages_conv ON chat_messages(conversation_id, seq);
      CREATE INDEX idx_chat_conversations_updated ON chat_conversations(archived, updated_at DESC);
    `,
  },
  {
    version: 6,
    up: /* sql */ `
      ALTER TABLE themes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 7,
    up: /* sql */ `
      UPDATE edges
      SET basis = 'inferred'
      WHERE basis NOT IN ('explicit', 'inferred');

      UPDATE edges
      SET type = 'variant_of'
      WHERE type = 'has_variant';

      UPDATE edges
      SET type = 'extends'
      WHERE type NOT IN (
        'extends',
        'contradicts',
        'applies_to',
        'shares_method',
        'precondition_of',
        'measures_same',
        'supports',
        'refutes',
        'variant_of',
        'refines',
        'contains'
      );
    `,
  },
  {
    version: 8,
    up: /* sql */ `
      CREATE TABLE tutor_saved_routes (
        route_id          TEXT PRIMARY KEY,
        plan_id           TEXT NOT NULL,
        generated_at      TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        last_played_at    TEXT,
        mode              TEXT NOT NULL,
        prompt            TEXT NOT NULL,
        model_json        TEXT,
        overview          TEXT NOT NULL,
        total_themes      INTEGER NOT NULL DEFAULT 0,
        total_ideas       INTEGER NOT NULL DEFAULT 0,
        total_connections INTEGER NOT NULL DEFAULT 0,
        route_json        TEXT NOT NULL,
        rating            INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5))
      );

      CREATE INDEX idx_tutor_saved_routes_generated
        ON tutor_saved_routes(generated_at DESC);
      CREATE INDEX idx_tutor_saved_routes_rating
        ON tutor_saved_routes(rating DESC, updated_at DESC);
    `,
  },
  {
    version: 9,
    up: /* sql */ `
      CREATE TABLE scan_checkpoints (
        nodus_id     TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        kind         TEXT NOT NULL,
        batch_index  INTEGER NOT NULL,
        data_json    TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        PRIMARY KEY (nodus_id, content_hash, kind, batch_index)
      );
    `,
  },
  {
    version: 10,
    up: /* sql */ `
      ALTER TABLE ideas ADD COLUMN embedding_provider TEXT;
      ALTER TABLE ideas ADD COLUMN embedding_model TEXT;
      ALTER TABLE ideas ADD COLUMN embedding_dim INTEGER;
      ALTER TABLE ideas ADD COLUMN embedding_text_hash TEXT;

      CREATE INDEX idx_ideas_embedding_meta
        ON ideas(embedding_provider, embedding_model, embedding_dim, embedding_text_hash);

      CREATE TABLE edge_traces (
        edge_id            TEXT PRIMARY KEY,
        method             TEXT NOT NULL,
        model_json         TEXT,
        embedding_provider TEXT,
        embedding_model    TEXT,
        similarity         REAL,
        rationale          TEXT,
        created_at         TEXT NOT NULL
      );

      UPDATE edges
      SET
        from_id = to_id,
        to_id = from_id
      WHERE type IN ('contradicts', 'shares_method', 'measures_same', 'variant_of')
        AND from_id > to_id;

      DELETE FROM edges
      WHERE rowid IN (
        SELECT rowid
        FROM (
          SELECT
            rowid,
            ROW_NUMBER() OVER (
              PARTITION BY from_id, to_id, type
              ORDER BY confidence DESC, CASE basis WHEN 'explicit' THEN 0 ELSE 1 END, rowid ASC
            ) AS rn
          FROM edges
        )
        WHERE rn > 1
      );

      CREATE UNIQUE INDEX idx_edges_unique_pair_type
        ON edges(from_id, to_id, type);
    `,
  },
  {
    version: 11,
    up: /* sql */ `
      CREATE TABLE zotero_tags (
        tag_id           INTEGER PRIMARY KEY,
        label            TEXT NOT NULL,
        normalized_label TEXT NOT NULL UNIQUE
      );

      CREATE TABLE work_zotero_tags (
        nodus_id TEXT NOT NULL,
        tag_id   INTEGER NOT NULL,
        PRIMARY KEY (nodus_id, tag_id),
        FOREIGN KEY (nodus_id) REFERENCES works(nodus_id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES zotero_tags(tag_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_work_zotero_tags_tag ON work_zotero_tags(tag_id, nodus_id);
    `,
  },
  {
    version: 12,
    up: /* sql */ `
      ALTER TABLE works ADD COLUMN summary_status TEXT DEFAULT 'none';
      ALTER TABLE works ADD COLUMN summary_at     TEXT;
      ALTER TABLE works ADD COLUMN summary_hash   TEXT;

      CREATE TABLE work_summaries (
        nodus_id            TEXT PRIMARY KEY,
        summary             TEXT NOT NULL,
        source_level        TEXT NOT NULL,
        model_json          TEXT,
        content_hash        TEXT NOT NULL,
        embedding           BLOB,
        embedding_provider  TEXT,
        embedding_model     TEXT,
        embedding_dim       INTEGER,
        embedding_text_hash TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        FOREIGN KEY (nodus_id) REFERENCES works(nodus_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_work_summaries_embedding_meta
        ON work_summaries(embedding_provider, embedding_model, embedding_dim, embedding_text_hash);
    `,
  },
  {
    version: 13,
    up: /* sql */ `
      CREATE TABLE collections (
        collection_key TEXT PRIMARY KEY,
        name           TEXT,
        parent_key     TEXT
      );

      CREATE TABLE work_collections (
        nodus_id       TEXT NOT NULL,
        collection_key TEXT NOT NULL,
        PRIMARY KEY (nodus_id, collection_key),
        FOREIGN KEY (nodus_id) REFERENCES works(nodus_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_work_collections_coll ON work_collections(collection_key, nodus_id);
    `,
  },
  {
    version: 14,
    up: /* sql */ `
      CREATE TABLE research_questions (
        id           TEXT PRIMARY KEY,
        question     TEXT NOT NULL,
        notes        TEXT,
        model_json   TEXT,
        status       TEXT NOT NULL DEFAULT 'draft',
        corpus_ideas INTEGER NOT NULL DEFAULT 0,
        corpus_works INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        mapped_at    TEXT
      );

      CREATE TABLE research_subquestions (
        id              TEXT PRIMARY KEY,
        rq_id           TEXT NOT NULL,
        text            TEXT NOT NULL,
        rationale       TEXT,
        order_idx       INTEGER NOT NULL,
        coverage_status TEXT,
        justification   TEXT,
        created_at      TEXT NOT NULL,
        FOREIGN KEY (rq_id) REFERENCES research_questions(id) ON DELETE CASCADE
      );

      CREATE TABLE research_coverage_links (
        id         TEXT PRIMARY KEY,
        subq_id    TEXT NOT NULL,
        kind       TEXT NOT NULL,
        ref_id     TEXT NOT NULL,
        label      TEXT,
        score      REAL,
        read_state TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (subq_id) REFERENCES research_subquestions(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_research_subq_rq ON research_subquestions(rq_id, order_idx);
      CREATE INDEX idx_research_links_subq ON research_coverage_links(subq_id);
    `,
  },
  {
    version: 15,
    up: /* sql */ `
      CREATE TABLE passages (
        passage_id         TEXT PRIMARY KEY,
        nodus_id           TEXT NOT NULL,
        chunk_index        INTEGER NOT NULL,
        text               TEXT NOT NULL,
        page_label         TEXT,
        char_len           INTEGER NOT NULL,
        content_hash       TEXT NOT NULL,
        embedding          BLOB,
        embedding_provider TEXT,
        embedding_model    TEXT,
        embedding_dim      INTEGER,
        embedding_text_hash TEXT,
        created_at         TEXT NOT NULL,
        FOREIGN KEY (nodus_id) REFERENCES works(nodus_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_passages_nodus ON passages(nodus_id);
      CREATE INDEX idx_passages_embedding_meta
        ON passages(embedding_provider, embedding_model, embedding_dim, embedding_text_hash);
    `,
  },
  {
    version: 16,
    up: /* sql */ `
      CREATE TABLE writing_saved_drafts (
        id             TEXT PRIMARY KEY,
        title          TEXT NOT NULL,
        brief_json     TEXT NOT NULL,
        selection_json TEXT NOT NULL,
        model_json     TEXT,
        draft_json     TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );

      CREATE INDEX idx_writing_saved_drafts_updated
        ON writing_saved_drafts(updated_at DESC);
    `,
  },
  {
    version: 17,
    up: /* sql */ `
      CREATE TABLE note_folders (
        id         TEXT PRIMARY KEY,
        parent_id  TEXT,
        name       TEXT NOT NULL,
        order_idx  INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (parent_id) REFERENCES note_folders(id) ON DELETE CASCADE
      );

      CREATE TABLE notes (
        id          TEXT PRIMARY KEY,
        folder_id   TEXT,
        title       TEXT NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'markdown',
        content     TEXT NOT NULL DEFAULT '',
        source_json TEXT,
        order_idx   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        FOREIGN KEY (folder_id) REFERENCES note_folders(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_note_folders_parent ON note_folders(parent_id, order_idx);
      CREATE INDEX idx_notes_folder ON notes(folder_id, order_idx);
      CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
    `,
  },
  {
    version: 18,
    up: /* sql */ `
      ALTER TABLE note_folders ADD COLUMN summary TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    version: 19,
    up: /* sql */ `
      CREATE TABLE projects (
        id                   TEXT PRIMARY KEY,
        title                TEXT NOT NULL,
        kind                 TEXT NOT NULL DEFAULT 'other',
        status               TEXT NOT NULL DEFAULT 'active',
        brief                TEXT NOT NULL DEFAULT '',
        research_question_id TEXT,
        root_folder_id       TEXT,
        model_json           TEXT,
        target_words         INTEGER,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL,
        FOREIGN KEY (research_question_id) REFERENCES research_questions(id) ON DELETE SET NULL,
        FOREIGN KEY (root_folder_id) REFERENCES note_folders(id) ON DELETE SET NULL
      );

      CREATE TABLE project_sections (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL,
        folder_id    TEXT,
        title        TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'custom',
        status       TEXT NOT NULL DEFAULT 'empty',
        target_words INTEGER,
        order_idx    INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (folder_id) REFERENCES note_folders(id) ON DELETE SET NULL
      );

      CREATE TABLE project_links (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL,
        section_id  TEXT,
        kind        TEXT NOT NULL,
        ref_id      TEXT NOT NULL,
        label       TEXT NOT NULL DEFAULT '',
        role        TEXT NOT NULL DEFAULT 'context',
        created_at  TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (section_id) REFERENCES project_sections(id) ON DELETE CASCADE
      );

      CREATE TABLE project_chapters (
        id                 TEXT PRIMARY KEY,
        project_id         TEXT NOT NULL,
        section_id         TEXT,
        note_id            TEXT,
        title              TEXT NOT NULL,
        source_format      TEXT NOT NULL DEFAULT 'unknown',
        original_file_name TEXT,
        original_text_hash TEXT NOT NULL,
        original_text      TEXT NOT NULL,
        current_markdown   TEXT NOT NULL,
        word_count         INTEGER NOT NULL DEFAULT 0,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (section_id) REFERENCES project_sections(id) ON DELETE SET NULL,
        FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL
      );

      CREATE TABLE project_chapter_chunks (
        id                  TEXT PRIMARY KEY,
        chapter_id          TEXT NOT NULL,
        order_idx           INTEGER NOT NULL,
        heading_path        TEXT NOT NULL DEFAULT '',
        text                TEXT NOT NULL,
        start_offset        INTEGER NOT NULL DEFAULT 0,
        end_offset          INTEGER NOT NULL DEFAULT 0,
        word_count          INTEGER NOT NULL DEFAULT 0,
        embedding           BLOB,
        embedding_provider  TEXT,
        embedding_model     TEXT,
        embedding_dim       INTEGER,
        embedding_text_hash TEXT,
        created_at          TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES project_chapters(id) ON DELETE CASCADE
      );

      CREATE TABLE project_insertion_suggestions (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL,
        chapter_id      TEXT NOT NULL,
        target_chunk_id TEXT,
        kind            TEXT NOT NULL,
        ref_id          TEXT NOT NULL,
        ref_label       TEXT NOT NULL DEFAULT '',
        operation       TEXT NOT NULL DEFAULT 'insert_after',
        proposed_text   TEXT NOT NULL,
        citation_json   TEXT NOT NULL DEFAULT '[]',
        rationale       TEXT NOT NULL DEFAULT '',
        confidence      REAL NOT NULL DEFAULT 0.5,
        status          TEXT NOT NULL DEFAULT 'suggested',
        blocked_reason  TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES project_chapters(id) ON DELETE CASCADE,
        FOREIGN KEY (target_chunk_id) REFERENCES project_chapter_chunks(id) ON DELETE SET NULL
      );

      CREATE TABLE project_chapter_versions (
        id         TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL,
        label      TEXT NOT NULL,
        markdown   TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES project_chapters(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_projects_updated ON projects(updated_at DESC);
      CREATE INDEX idx_project_sections_project ON project_sections(project_id, order_idx);
      CREATE INDEX idx_project_links_project ON project_links(project_id, section_id, kind);
      CREATE INDEX idx_project_chapters_project ON project_chapters(project_id, updated_at DESC);
      CREATE INDEX idx_project_chunks_chapter ON project_chapter_chunks(chapter_id, order_idx);
      CREATE INDEX idx_project_suggestions_chapter ON project_insertion_suggestions(chapter_id, status, created_at DESC);
      CREATE INDEX idx_project_versions_chapter ON project_chapter_versions(chapter_id, created_at DESC);
    `,
  },
  {
    version: 20,
    up: /* sql */ `
      CREATE TABLE saved_searches (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        query      TEXT NOT NULL,
        mode       TEXT NOT NULL DEFAULT 'semantic',
        kinds_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_saved_searches_created ON saved_searches(created_at DESC);
    `,
  },
  {
    version: 21,
    up: /* sql */ `
      -- Ideas distilled from an uploaded chapter. Deliberately separate from the
      -- curated 'ideas' table and the graph: these are ephemeral working units of
      -- the manuscript, re-extracted when the chapter text changes (source_hash).
      CREATE TABLE project_chapter_ideas (
        id                  TEXT PRIMARY KEY,
        chapter_id          TEXT NOT NULL,
        project_id          TEXT NOT NULL,
        type                TEXT NOT NULL DEFAULT 'claim',
        label               TEXT NOT NULL,
        statement           TEXT NOT NULL,
        order_idx           INTEGER NOT NULL DEFAULT 0,
        source_hash         TEXT NOT NULL,
        embedding           BLOB,
        embedding_provider  TEXT,
        embedding_model     TEXT,
        embedding_dim       INTEGER,
        embedding_text_hash TEXT,
        created_at          TEXT NOT NULL,
        FOREIGN KEY (chapter_id) REFERENCES project_chapters(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_chapter_ideas_chapter ON project_chapter_ideas(chapter_id, order_idx);

      -- Typed relations between a chapter idea and a library entity (idea/note/
      -- passage/work). Discovered by cosine shortlist + optional LLM typing.
      CREATE TABLE project_chapter_idea_relations (
        id              TEXT PRIMARY KEY,
        chapter_idea_id TEXT NOT NULL,
        chapter_id      TEXT NOT NULL,
        target_kind     TEXT NOT NULL,
        target_id       TEXT NOT NULL,
        relation        TEXT NOT NULL DEFAULT 'related',
        similarity      REAL NOT NULL DEFAULT 0,
        confidence      REAL NOT NULL DEFAULT 0,
        rationale       TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL,
        FOREIGN KEY (chapter_idea_id) REFERENCES project_chapter_ideas(id) ON DELETE CASCADE,
        FOREIGN KEY (chapter_id) REFERENCES project_chapters(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_chapter_idea_relations_chapter ON project_chapter_idea_relations(chapter_id, chapter_idea_id);

      -- Notes get embeddings too, so chapter ideas can find relations with the
      -- user's own notes (not just corpus ideas/passages/work summaries).
      ALTER TABLE notes ADD COLUMN embedding BLOB;
      ALTER TABLE notes ADD COLUMN embedding_provider TEXT;
      ALTER TABLE notes ADD COLUMN embedding_model TEXT;
      ALTER TABLE notes ADD COLUMN embedding_dim INTEGER;
      ALTER TABLE notes ADD COLUMN embedding_text_hash TEXT;
    `,
  },
  {
    version: 22,
    up: /* sql */ `
      -- Cached AI synthesis for one author's dossier ("Ficha de autor"). The raw
      -- ideas/relations are always assembled live from the graph; only the
      -- narrated thesis/remember/positioning is expensive, so it is cached here.
      -- 'fingerprint' hashes the author's idea + relation set so the UI can flag
      -- the synthesis as stale when the corpus changes.
      CREATE TABLE author_dossier_synthesis (
        author_id    TEXT PRIMARY KEY,
        thesis       TEXT NOT NULL DEFAULT '',
        remember_json TEXT NOT NULL DEFAULT '[]',
        positioning  TEXT NOT NULL DEFAULT '',
        model_json   TEXT,
        fingerprint  TEXT NOT NULL DEFAULT '',
        generated_at TEXT NOT NULL,
        FOREIGN KEY (author_id) REFERENCES authors(author_id) ON DELETE CASCADE
      );

      -- Cached one-sentence stance for a single author×theme cell of the
      -- synthesis matrix. Sparse: only generated cells are stored. 'fingerprint'
      -- hashes the idea set behind the cell so it can be invalidated on change.
      CREATE TABLE synthesis_matrix_cell (
        author_id    TEXT NOT NULL,
        theme_id     TEXT NOT NULL,
        stance       TEXT NOT NULL DEFAULT '',
        model_json   TEXT,
        fingerprint  TEXT NOT NULL DEFAULT '',
        generated_at TEXT NOT NULL,
        PRIMARY KEY (author_id, theme_id),
        FOREIGN KEY (author_id) REFERENCES authors(author_id) ON DELETE CASCADE,
        FOREIGN KEY (theme_id) REFERENCES themes(theme_id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 23,
    up: /* sql */ `
      -- Make Zotero the single source of author identity. We persist the raw
      -- structured creators (with role) per work so author nodes can be built
      -- from canonical (lastName, first-initial) keys instead of free-text names,
      -- which previously fragmented one person into several nodes.
      ALTER TABLE works ADD COLUMN creators_json TEXT;

      -- Normalized identity key ("lastname::i") used to dedupe author nodes.
      ALTER TABLE authors ADD COLUMN canonical_key TEXT;
      CREATE INDEX idx_authors_canonical ON authors(canonical_key);

      -- Zotero creator role for this work↔author link: 'author' | 'editor'.
      ALTER TABLE work_authors ADD COLUMN role TEXT NOT NULL DEFAULT 'author';
    `,
  },
  {
    version: 24,
    up: /* sql */ `
      -- Progress for Modo Estudio. The guide itself is recalculated from the
      -- live graph, but the user's learning state must survive restarts.
      CREATE TABLE study_progress (
        target_kind TEXT NOT NULL,
        target_id   TEXT NOT NULL,
        status      TEXT NOT NULL,
        note        TEXT,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (target_kind, target_id)
      );
      CREATE INDEX idx_study_progress_status ON study_progress(status, updated_at);
    `,
  },
  {
    version: 25,
    up: /* sql */ `
      -- Cached narrated synthesis for one work's extracted ideas. Mirrors the
      -- author dossier synthesis shape, with a fingerprint over the work's idea
      -- set so the UI can flag stale results after re-analysis.
      CREATE TABLE work_idea_synthesis (
        nodus_id      TEXT PRIMARY KEY,
        thesis        TEXT NOT NULL DEFAULT '',
        remember_json TEXT NOT NULL DEFAULT '[]',
        positioning   TEXT NOT NULL DEFAULT '',
        model_json    TEXT,
        fingerprint   TEXT NOT NULL DEFAULT '',
        generated_at  TEXT NOT NULL,
        FOREIGN KEY (nodus_id) REFERENCES works(nodus_id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 26,
    up: /* sql */ `
      -- Inmersión sessions. plan_json stores the COMPLETE generated experience
      -- (every AI answer, literal quotes, contrasts matrix, exam, topic subgraph)
      -- so a session replays forever without new AI calls; progress_json stores
      -- the user's position, completed steps and answers (with assessments).
      -- stats_json is a small denormalized summary so listing never parses plans.
      CREATE TABLE immersion_sessions (
        id            TEXT PRIMARY KEY,
        topic         TEXT NOT NULL,
        title         TEXT NOT NULL DEFAULT '',
        language      TEXT NOT NULL DEFAULT 'es',
        minutes       INTEGER NOT NULL DEFAULT 150,
        model_json    TEXT,
        plan_json     TEXT NOT NULL,
        progress_json TEXT NOT NULL,
        stats_json    TEXT NOT NULL DEFAULT '{}',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_immersion_updated ON immersion_sessions(updated_at DESC);
    `,
  },
  {
    version: 27,
    up: /* sql */ `
      -- User audit verdicts over derived relations. Keyed by the idea pair +
      -- relation type (NOT by edges.id): scan pipelines delete and recreate
      -- edge rows, so a verdict must outlive any individual row. No foreign
      -- keys for the same reason — feedback for a temporarily-removed idea
      -- becomes active again the moment a rescan brings the pair back.
      CREATE TABLE edge_feedback (
        from_id    TEXT NOT NULL,
        to_id      TEXT NOT NULL,
        type       TEXT NOT NULL,
        verdict    TEXT NOT NULL CHECK (verdict IN ('rejected', 'confirmed')),
        note       TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        PRIMARY KEY (from_id, to_id, type)
      );
      CREATE INDEX idx_edge_feedback_reverse ON edge_feedback(to_id, from_id, type);

      -- Single source of truth for "edges the user hasn't vetoed". Every
      -- UI/AI-facing reader selects from this view; physical maintenance
      -- (dedupe, deletes, imports) keeps operating on the edges table.
      -- A rejection hides the pair in BOTH directions.
      CREATE VIEW visible_edges AS
        SELECT e.* FROM edges e
        WHERE NOT EXISTS (
          SELECT 1 FROM edge_feedback f
          WHERE f.verdict = 'rejected'
            AND f.type = e.type
            AND ((f.from_id = e.from_id AND f.to_id = e.to_id)
              OR (f.from_id = e.to_id AND f.to_id = e.from_id))
        );
    `,
  },
  {
    version: 28,
    up: /* sql */ `
      -- Stable idea identity across rescans. A deep rescan used to DELETE any
      -- idea whose only occurrence was the rescanned work; re-extraction then
      -- minted a NEW global_id, orphaning every reference (notes, routes,
      -- drafts, edge feedback). Now such ideas merely go dormant: orphaned_at
      -- is set, fusion keeps them as match candidates and revives them (same
      -- global_id) when the idea is extracted again; only long-dormant ideas
      -- are pruned.
      ALTER TABLE ideas ADD COLUMN orphaned_at TEXT;
      CREATE INDEX idx_ideas_orphaned ON ideas(orphaned_at) WHERE orphaned_at IS NOT NULL;
    `,
  },
  {
    version: 29,
    up: /* sql */ `
      -- Optional decorative images for Inmersión and Deep Research. The image
      -- and its compact thumbnail live in SQLite so full backups remain
      -- self-contained. No foreign key is used because the two owner tables
      -- intentionally have different schemas; their repositories delete the
      -- associated row explicitly.
      CREATE TABLE decorative_images (
        entity_kind    TEXT NOT NULL CHECK (entity_kind IN ('immersion', 'deep_research')),
        entity_id      TEXT NOT NULL,
        requested      INTEGER NOT NULL DEFAULT 0,
        status         TEXT NOT NULL DEFAULT 'not_requested'
                       CHECK (status IN ('not_requested', 'pending', 'ready', 'failed')),
        provider       TEXT,
        model          TEXT,
        style          TEXT NOT NULL DEFAULT 'antique_book',
        visual_context TEXT,
        prompt         TEXT,
        asset_ref      TEXT,
        mime_type      TEXT,
        image_blob     BLOB,
        thumbnail_blob BLOB,
        error          TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        PRIMARY KEY (entity_kind, entity_id)
      );
      CREATE INDEX idx_decorative_images_status ON decorative_images(status, updated_at DESC);
    `,
  },
  {
    version: 30,
    up: /* sql */ `
      -- Track how the current image was produced ('ai' | 'custom'), and keep a
      -- single-level snapshot of the previous ready image so a regeneration or a
      -- user upload can be undone. The snapshot columns mirror the live ones and
      -- live in SQLite too, so backups stay self-contained.
      ALTER TABLE decorative_images ADD COLUMN source TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_image_blob BLOB;
      ALTER TABLE decorative_images ADD COLUMN prev_thumbnail_blob BLOB;
      ALTER TABLE decorative_images ADD COLUMN prev_mime_type TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_style TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_visual_context TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_prompt TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_provider TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_model TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_source TEXT;
    `,
  },
  {
    version: 31,
    up: /* sql */ `
      -- Metadata for locally generated narration (text-to-speech) clips. The audio
      -- files themselves live on disk under the vault's audio/ directory, NOT in
      -- SQLite: they are large and fully regenerable, so they are deliberately kept
      -- out of backups and .nodussync (which carry only the database). A restored or
      -- synced database therefore keeps the metadata but the repository flags any row
      -- whose file is absent as "missing" so the UI can offer to regenerate it.
      CREATE TABLE audio_clips (
        id            TEXT PRIMARY KEY,
        entity_kind   TEXT NOT NULL CHECK (entity_kind IN ('immersion', 'deep_research')),
        entity_id     TEXT NOT NULL,
        segment_index INTEGER NOT NULL,
        segment_label TEXT NOT NULL DEFAULT '',
        provider      TEXT NOT NULL DEFAULT 'piper',
        voice         TEXT NOT NULL DEFAULT '',
        language      TEXT NOT NULL DEFAULT '',
        file_name     TEXT NOT NULL,
        bytes         INTEGER NOT NULL DEFAULT 0,
        duration_sec  REAL NOT NULL DEFAULT 0,
        sample_rate   INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_audio_clips_entity ON audio_clips(entity_kind, entity_id, segment_index);
    `,
  },
  {
    version: 32,
    up: /* sql */ `
      -- AI translations of a Deep Research report or an immersion. The translated
      -- document is stored as Markdown; one row per (entity, language) so
      -- regenerating replaces the previous copy. Unlike audio, these are small and
      -- not regenerable for free (they cost an AI call), so they live in SQLite and
      -- travel with backups / .nodussync.
      CREATE TABLE content_translations (
        id             TEXT PRIMARY KEY,
        entity_kind    TEXT NOT NULL CHECK (entity_kind IN ('immersion', 'deep_research')),
        entity_id      TEXT NOT NULL,
        language       TEXT NOT NULL,
        language_label TEXT NOT NULL DEFAULT '',
        title          TEXT NOT NULL DEFAULT '',
        markdown       TEXT NOT NULL DEFAULT '',
        model_json     TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        UNIQUE (entity_kind, entity_id, language)
      );
      CREATE INDEX idx_content_translations_entity
        ON content_translations(entity_kind, entity_id, updated_at DESC);
    `,
  },
  {
    version: 33,
    up: /* sql */ `
      -- Primary-source / genealogy entity ontology. Parallel to the argumentative
      -- ideas/themes graph: a "records" lens extracts persons, places and events
      -- from primary sources instead of ideas. Every fact is backed by evidence
      -- (record_evidence) pointing at a source passage, so the record layer keeps
      -- Nodus's citable DNA. Dates are stored twice: a human display form and a
      -- sortable ISO-ish lower/upper bound so a timeline can order fuzzy dates
      -- ("c. 1850", "antes de 1880"). Coexists with the ideas ontology and can be
      -- cross-referenced by it.

      CREATE TABLE persons (
        person_id       TEXT PRIMARY KEY,
        display_name    TEXT NOT NULL,
        sex             TEXT NOT NULL DEFAULT 'unknown',
        birth_date      TEXT,
        birth_date_sort TEXT,
        death_date      TEXT,
        death_date_sort TEXT,
        notes           TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX idx_persons_name ON persons(display_name);
      CREATE INDEX idx_persons_birth_sort ON persons(birth_date_sort);

      -- Name variants / spellings across records (a person's name changes over time).
      CREATE TABLE person_names (
        id         TEXT PRIMARY KEY,
        person_id  TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        kind       TEXT,
        UNIQUE (person_id, name)
      );
      CREATE INDEX idx_person_names_person ON person_names(person_id);

      -- Places form a hierarchy (parish → municipality → province → country).
      CREATE TABLE places (
        place_id    TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        parent_id   TEXT REFERENCES places(place_id) ON DELETE SET NULL,
        kind        TEXT,
        latitude    REAL,
        longitude   REAL,
        notes       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_places_parent ON places(parent_id);
      CREATE INDEX idx_places_name ON places(name);

      CREATE TABLE events (
        event_id      TEXT PRIMARY KEY,
        type          TEXT NOT NULL,
        label         TEXT,
        date          TEXT,
        date_sort     TEXT,
        date_end_sort TEXT,
        place_id      TEXT REFERENCES places(place_id) ON DELETE SET NULL,
        notes         TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_events_sort ON events(date_sort);
      CREATE INDEX idx_events_type ON events(type);
      CREATE INDEX idx_events_place ON events(place_id);

      -- Who took part in an event and how (principal, spouse, father, witness…).
      -- Relationships in the primary-source layer are asserted BY events/sources
      -- rather than declared abstractly; the genealogy layer (phase C) adds an
      -- explicit kinship specialisation on top.
      CREATE TABLE event_participants (
        id         TEXT PRIMARY KEY,
        event_id   TEXT NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
        person_id  TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        role       TEXT NOT NULL DEFAULT 'principal',
        UNIQUE (event_id, person_id, role)
      );
      CREATE INDEX idx_event_participants_person ON event_participants(person_id);
      CREATE INDEX idx_event_participants_event ON event_participants(event_id);

      -- Polymorphic evidence for any record entity/event/participation. nodus_id is a
      -- free pointer (a works.nodus_id, or an archive item id when source_kind =
      -- 'archive'); intentionally not a FK so the evidence archive (also phase B) can
      -- be introduced without a forward reference.
      CREATE TABLE record_evidence (
        id          TEXT PRIMARY KEY,
        target_kind TEXT NOT NULL,
        target_id   TEXT NOT NULL,
        nodus_id    TEXT,
        source_kind TEXT NOT NULL DEFAULT 'work',
        quote       TEXT,
        location    TEXT,
        confidence  REAL,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_record_evidence_target ON record_evidence(target_kind, target_id);
    `,
  },
  {
    version: 34,
    up: /* sql */ `
      -- Evidence archive: a Nodus-native store for the user's OWN files that Zotero
      -- doesn't hold or can't index (record photos, census CSV/XLSX exports, scans).
      -- The file bytes live as a BLOB in SQLite (like decorative_images) so the whole
      -- archive travels with backups and .nodussync — genealogical evidence is
      -- irreplaceable and must survive. Extracted text (OCR / CSV / XLSX) is stored
      -- alongside so items are searchable and can back record entities as evidence
      -- (record_evidence.source_kind = 'archive', nodus_id = the item_id).

      CREATE TABLE archive_folders (
        folder_id  TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        parent_id  TEXT REFERENCES archive_folders(folder_id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_archive_folders_parent ON archive_folders(parent_id);

      CREATE TABLE archive_items (
        item_id        TEXT PRIMARY KEY,
        folder_id      TEXT REFERENCES archive_folders(folder_id) ON DELETE SET NULL,
        title          TEXT NOT NULL,
        kind           TEXT NOT NULL DEFAULT 'other',
        file_name      TEXT,
        mime_type      TEXT,
        bytes          INTEGER NOT NULL DEFAULT 0,
        blob           BLOB,
        extracted_text TEXT,
        description    TEXT,
        content_hash   TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX idx_archive_items_folder ON archive_items(folder_id);
      CREATE INDEX idx_archive_items_hash ON archive_items(content_hash);

      CREATE TABLE archive_item_tags (
        item_id TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        tag     TEXT NOT NULL,
        PRIMARY KEY (item_id, tag)
      );
      CREATE INDEX idx_archive_item_tags_tag ON archive_item_tags(tag);
    `,
  },
  {
    version: 35,
    up: /* sql */ `
      -- Genealogy kinship layer: explicit relationships between persons, the
      -- specialisation the tree view is built on. In the primary-source layer
      -- relationships are only asserted by events; here the user (or a confirmed AI
      -- suggestion) states them directly. Provenance is tracked — 'user_asserted' or
      -- 'ai_confirmed', never a raw AI write — so every edge in the tree is auditable.
      --   type 'parent': from_person is the PARENT of to_person (the child).
      --   type 'spouse': symmetric; stored once, queried in both directions.
      -- Siblings are derived (persons sharing a parent), never stored.
      CREATE TABLE relationships (
        rel_id      TEXT PRIMARY KEY,
        from_person TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        to_person   TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        type        TEXT NOT NULL,
        provenance  TEXT NOT NULL DEFAULT 'user_asserted',
        notes       TEXT,
        created_at  TEXT NOT NULL,
        UNIQUE (from_person, to_person, type)
      );
      CREATE INDEX idx_relationships_from ON relationships(from_person, type);
      CREATE INDEX idx_relationships_to ON relationships(to_person, type);
    `,
  },
  {
    version: 36,
    up: /* sql */ `
      -- Person portraits: a photo the user attaches (faces on the tree matter to a
      -- genealogist). Stored in its own table so person list queries never load the
      -- blob. The focal point (focus_x/y in 0..1 + scale) is non-destructive framing
      -- metadata — the original bytes are never cropped. Travels in backups/.nodussync.
      CREATE TABLE person_portraits (
        person_id  TEXT PRIMARY KEY REFERENCES persons(person_id) ON DELETE CASCADE,
        blob       BLOB NOT NULL,
        mime       TEXT NOT NULL DEFAULT 'image/jpeg',
        focus_x    REAL NOT NULL DEFAULT 0.5,
        focus_y    REAL NOT NULL DEFAULT 0.5,
        scale      REAL NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 37,
    up: /* sql */ `
      -- Persistent verdicts over candidate identity matches ("are these two person
      -- records the same individual?"). Same pattern as edge_feedback: keyed by the
      -- normalised person pair (person_a < person_b), no foreign keys, so a "these are
      -- NOT the same person" dismissal outlives rescans and is never re-proposed. An
      -- accept is a merge (handled separately), so only dismissals are recorded here.
      CREATE TABLE match_feedback (
        person_a   TEXT NOT NULL,
        person_b   TEXT NOT NULL,
        verdict    TEXT NOT NULL DEFAULT 'dismissed',
        created_at TEXT NOT NULL,
        PRIMARY KEY (person_a, person_b)
      );
    `,
  },
  {
    version: 38,
    up: /* sql */ `
      -- Genealogical/primary-source classification for archive items, separate from
      -- the file-format kind (image/csv/pdf…). doc_type comes from the taxonomy in
      -- shared/archiveDocTypes.ts (partida de nacimiento, diario, fotografía…), and
      -- metadata_json holds the optional type-specific form the user fills in.
      -- Academic/bibliographic sources are NOT archive items — they live in the
      -- library via Zotero.
      ALTER TABLE archive_items ADD COLUMN doc_type TEXT;
      ALTER TABLE archive_items ADD COLUMN metadata_json TEXT;
    `,
  },
  {
    version: 39,
    up: /* sql */ `
      -- Kinship nuance + tree presentation.
      --   relationships.subtype: null = biological/default, 'adoptive' for adoptions
      --   (rendered distinctly on the tree; still a real parent edge for layout).
      --   persons.frame_style: per-person override of the wooden tree frame design;
      --   null = use the vault-wide default (a setting).
      ALTER TABLE relationships ADD COLUMN subtype TEXT;
      ALTER TABLE persons ADD COLUMN frame_style TEXT;
    `,
  },
  {
    version: 40,
    up: /* sql */ `
      -- Link archive documents to the tree members they concern (a birth record to
      -- one person, a marriage certificate to two). This lets a person's ficha gather
      -- every document about them and feeds the AI biography with the right sources.
      CREATE TABLE archive_item_persons (
        item_id   TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (item_id, person_id)
      );
      CREATE INDEX idx_archive_item_persons_person ON archive_item_persons(person_id);
    `,
  },
  {
    version: 41,
    up: /* sql */ `
      -- Optional AI-generated biography of a person, written only on demand from the
      -- evidence (events, kinship, linked documents). Stored so it persists and travels.
      ALTER TABLE persons ADD COLUMN biography TEXT;
      ALTER TABLE persons ADD COLUMN biography_at TEXT;
    `,
  },
  {
    version: 42,
    up: /* sql */ `
      -- Evidence-driven kinship SUGGESTIONS. The cardinal rule of AI-assisted
      -- genealogy is that the machine must never contaminate the tree: it proposes,
      -- the user disposes. So structural record roles (a baptism naming the parents,
      -- a marriage naming the spouses) and explicit textual claims ("mi padre Juan")
      -- never write to the relationships table — they accumulate here as proposals,
      -- each carrying its verbatim quote + source. A mere co-mention of two names produces
      -- NOTHING here; only real evidence does. A suggestion surfaces once its evidence
      -- crosses a threshold; the user confirms it (→ an ai_confirmed relationship) or
      -- dismisses it (persistent, like match_feedback — never re-proposed).
      CREATE TABLE kinship_suggestions (
        suggestion_id TEXT PRIMARY KEY,
        from_person   TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        to_person     TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        type          TEXT NOT NULL,                 -- 'parent' | 'spouse'
        subtype       TEXT,                          -- null | 'adoptive'
        status        TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'confirmed' | 'dismissed'
        score         REAL NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        UNIQUE (from_person, to_person, type)
      );
      CREATE INDEX idx_kinship_suggestions_status ON kinship_suggestions(status);
      CREATE INDEX idx_kinship_suggestions_from ON kinship_suggestions(from_person);
      CREATE INDEX idx_kinship_suggestions_to ON kinship_suggestions(to_person);

      -- One row per piece of evidence backing a suggestion. 'record_role' = implied by
      -- an event's participant roles (structural); 'explicit_claim' = the source text
      -- states the relationship outright. Deduplicated by (suggestion, signal, source,
      -- quote) so re-scanning the same source doesn't inflate a suggestion's score.
      CREATE TABLE kinship_suggestion_evidence (
        id            TEXT PRIMARY KEY,
        suggestion_id TEXT NOT NULL REFERENCES kinship_suggestions(suggestion_id) ON DELETE CASCADE,
        signal        TEXT NOT NULL,                 -- 'record_role' | 'explicit_claim'
        source_kind   TEXT NOT NULL DEFAULT 'work',  -- 'work' | 'archive'
        nodus_id      TEXT,
        quote         TEXT,
        location      TEXT,
        weight        REAL NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_kinship_sugg_ev_suggestion ON kinship_suggestion_evidence(suggestion_id);
      CREATE UNIQUE INDEX idx_kinship_sugg_ev_dedupe
        ON kinship_suggestion_evidence(suggestion_id, signal, COALESCE(nodus_id, ''), COALESCE(quote, ''));

      -- Semantic index for the evidence archive: embed each item's extracted text so
      -- documents can be discovered by meaning ("which documents concern this person?"),
      -- reusing the same float32-BLOB + vec_cosine machinery as ideas. Nullable: an
      -- item is simply un-indexed until an embedding provider is configured and run.
      ALTER TABLE archive_items ADD COLUMN embedding BLOB;
      ALTER TABLE archive_items ADD COLUMN embedding_model TEXT;
      ALTER TABLE archive_items ADD COLUMN embedding_dim INTEGER;
      ALTER TABLE archive_items ADD COLUMN embedding_text_hash TEXT;
    `,
  },
  {
    version: 43,
    up: /* sql */ `
      -- Social-relations network: a SECOND graph, independent from the kinship tree,
      -- for the connections a person had beyond family (patrons, friends, employers,
      -- rivals, correspondents...) — the material a social/prosopographical historian
      -- works with. A social_contact is a lightweight node for someone who is known
      -- ONLY through a relation (not themselves a tree member); 'notes' holds whatever
      -- the user knows about them, free text. Contacts never author relations — only
      -- persons in the kinship tree do (a relation is recorded from a person's ficha).
      CREATE TABLE social_contacts (
        contact_id   TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        notes        TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_social_contacts_name ON social_contacts(display_name);

      -- A directed, typed connection recorded from person_id's ficha ("who they
      -- knew"). role is free text from person_id's perspective (amigo, patrón,
      -- socio...). The target is polymorphic (mirrors record_evidence's
      -- target_kind/target_id pattern): either another tree person or a
      -- social_contact, so the two graphs can interconnect without merging their
      -- ontologies. notes is markdown, about the connection itself (distinct from a
      -- contact's own notes, which describe the person).
      CREATE TABLE social_relations (
        relation_id TEXT PRIMARY KEY,
        person_id   TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL,   -- 'contact' | 'person'
        target_id   TEXT NOT NULL,
        role        TEXT NOT NULL,
        notes       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_social_relations_person ON social_relations(person_id);
      CREATE INDEX idx_social_relations_target ON social_relations(target_kind, target_id);
    `,
  },
  {
    version: 44,
    up: /* sql */ `
      -- Places gain a gazetteer identity so the map's place picker can resolve a
      -- typed name to a real, unique populated place (GeoNames): gazetteer_id is the
      -- stable external id (e.g. 'geonames:2520118'), admin1/country are the
      -- state/province and country names for display ("municipio, estado, país"),
      -- country_code is the ISO code. All nullable — a hand-entered place with just
      -- coordinates still works. A partial unique index keeps one row per gazetteer
      -- entry so the same city links many people to a single place node.
      ALTER TABLE places ADD COLUMN gazetteer_id TEXT;
      ALTER TABLE places ADD COLUMN admin1 TEXT;
      ALTER TABLE places ADD COLUMN country TEXT;
      ALTER TABLE places ADD COLUMN country_code TEXT;
      CREATE UNIQUE INDEX idx_places_gazetteer ON places(gazetteer_id) WHERE gazetteer_id IS NOT NULL;

      -- A person's PLACE RECORD: the log of places associated with a person, which
      -- drives their individual map and (aggregated) the general map. Independent
      -- from events — a place can be logged without a full event — though the two
      -- coexist. label is the kind of association (birth, residence, death, other);
      -- date is a free-text (possibly fuzzy) date with a sortable key so the map's
      -- chronological slider and the migration path can order the stops.
      CREATE TABLE person_places (
        id         TEXT PRIMARY KEY,
        person_id  TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        place_id   TEXT NOT NULL REFERENCES places(place_id) ON DELETE CASCADE,
        label      TEXT,
        date       TEXT,
        date_sort  TEXT,
        notes      TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_person_places_person ON person_places(person_id);
      CREATE INDEX idx_person_places_place ON person_places(place_id);
    `,
  },
  {
    version: 45,
    up: /* sql */ `
      -- Archive documents gain a free-text "source" (provenance): where the
      -- document came from — the archive/repository, a citation, a URL, or how it
      -- was obtained. Central to the genealogical proof standard (cite your source),
      -- but useful for any primary-source vault. Nullable; existing rows stay null.
      ALTER TABLE archive_items ADD COLUMN source TEXT;
    `,
  },
  {
    version: 46,
    up: /* sql */ `
      -- "Databases" mode: a Notion-like structured-data manager scoped to the
      -- 'databases' vault type. A vault holds many databases; each database has a
      -- set of typed columns and a set of rows; a row's value for a column lives in
      -- the generic db_cells table (an entity-attribute-value model, so adding or
      -- retyping columns needs no DDL). Typed (de)serialization of value_text lives
      -- in shared/databases.ts. Attachment blobs and polymorphic relations arrive in
      -- later phases as their own tables. Everything is per-vault (one DB file per
      -- vault) so it travels in backups and .nodussync with no extra plumbing.
      CREATE TABLE db_databases (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,   -- autogenerated human id, e.g. DB-7QK2
        name        TEXT NOT NULL,
        icon        TEXT,
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE db_columns (
        id           TEXT PRIMARY KEY,
        database_id  TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        type         TEXT NOT NULL,         -- title|text|number|date|time|select|multi_select|checkbox|attachment|ai|relation
        position     INTEGER NOT NULL DEFAULT 0,
        config_json  TEXT,                  -- per-type config (number format, AI prompt+auto, relation target, …)
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_db_columns_database ON db_columns(database_id);

      -- Options for select / multi-select columns (controlled vocabulary). A cell
      -- stores option ids in value_text; unknown ids are dropped on read, so this is
      -- the source of truth for which options exist and their display order/colour.
      CREATE TABLE db_select_options (
        id         TEXT PRIMARY KEY,
        column_id  TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
        label      TEXT NOT NULL,
        color      TEXT,
        position   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_db_select_options_column ON db_select_options(column_id);

      CREATE TABLE db_rows (
        id           TEXT PRIMARY KEY,
        database_id  TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_db_rows_database ON db_rows(database_id);

      -- One cell = one (row, column) value, serialized to text by shared/databases.ts.
      CREATE TABLE db_cells (
        row_id     TEXT NOT NULL REFERENCES db_rows(id) ON DELETE CASCADE,
        column_id  TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
        value_text TEXT,
        PRIMARY KEY (row_id, column_id)
      );
      CREATE INDEX idx_db_cells_column ON db_cells(column_id);
    `,
  },
  {
    version: 47,
    up: /* sql */ `
      -- Databases mode phase 2: file attachments for 'attachment' columns. Each file
      -- is stored as a BLOB in SQLite (like archive_items) so it travels in backups and
      -- .nodussync; list queries never load the blob (fetch it on demand). extracted_text
      -- and description hold the searchable text / visual description of the file.
      CREATE TABLE db_attachments (
        id             TEXT PRIMARY KEY,
        row_id         TEXT NOT NULL REFERENCES db_rows(id) ON DELETE CASCADE,
        column_id      TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
        file_name      TEXT,
        mime_type      TEXT,
        bytes          INTEGER NOT NULL DEFAULT 0,
        blob           BLOB,
        content_hash   TEXT,
        extracted_text TEXT,
        description    TEXT,
        position       INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL
      );
      CREATE INDEX idx_db_attachments_cell ON db_attachments(row_id, column_id);
    `,
  },
  {
    version: 48,
    up: /* sql */ `
      -- Databases mode phase 3: relation cells. A relation links a row to another
      -- database's row OR to a Nodus entity (Zotero work, idea, author, person) — the
      -- polymorphic target_kind/target_id convention used across the app (record_evidence,
      -- social_relations). The target's display label is resolved at read time.
      CREATE TABLE db_relations (
        id          TEXT PRIMARY KEY,
        row_id      TEXT NOT NULL REFERENCES db_rows(id) ON DELETE CASCADE,
        column_id   TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL,  -- db_row | work | idea | author | person
        target_id   TEXT NOT NULL,
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_db_relations_cell ON db_relations(row_id, column_id);
    `,
  },
  {
    version: 49,
    up: /* sql */ `
      -- Databases mode phase 5: saved views. Each view is a named layout (table/gallery)
      -- plus its own filter and sort, so one database can serve many workflows (Notion-
      -- style views). filter_json/sort_json hold the pure filter/sort state.
      CREATE TABLE db_views (
        id           TEXT PRIMARY KEY,
        database_id  TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        layout       TEXT NOT NULL DEFAULT 'table',
        filter_json  TEXT,
        sort_json    TEXT,
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_db_views_database ON db_views(database_id);
    `,
  },
  {
    version: 50,
    up: /* sql */ `
      -- Databases mode: cross-vault relations. A relation target may live in ANOTHER
      -- vault (an academic idea/gap/work/author, a genealogy person, …). target_vault_id
      -- records which vault it lives in so the label can be resolved by opening that vault
      -- read-only. NULL = the current/active vault (db_row and same-vault entity links).
      ALTER TABLE db_relations ADD COLUMN target_vault_id TEXT;
    `,
  },
  {
    version: 51,
    up: /* sql */ `
      -- Provenance for AI-generated images so the UI can badge them:
      --  · person_portraits.generated — a genealogy reference portrait drawn by AI
      --    (never a real photograph) rather than a user-uploaded likeness.
      --  · db_attachments.ai_generated / ai_prompt — an attachment produced by an
      --    'ai_image' database column, keeping the exact prompt for the info panel.
      ALTER TABLE person_portraits ADD COLUMN generated INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE db_attachments ADD COLUMN ai_generated INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE db_attachments ADD COLUMN ai_prompt TEXT;
    `,
  },
  {
    version: 52,
    up: /* sql */ `
      -- The genealogy Archive drops its single-parent folder tree in favour of a
      -- database-style "Carpeta" multi-select: an item can belong to several folders.
      -- archive_folders becomes the option list; archive_item_folders holds the
      -- (item, folder) memberships. Backfill from the legacy archive_items.folder_id so
      -- no existing folder assignment is lost. The old folder_id column is kept for
      -- backward compatibility but the UI now reads/writes through this join table.
      CREATE TABLE archive_item_folders (
        item_id    TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        folder_id  TEXT NOT NULL REFERENCES archive_folders(folder_id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (item_id, folder_id)
      );
      CREATE INDEX idx_archive_item_folders_folder ON archive_item_folders(folder_id);

      INSERT OR IGNORE INTO archive_item_folders (item_id, folder_id, created_at)
        SELECT item_id, folder_id, COALESCE(created_at, datetime('now'))
        FROM archive_items
        WHERE folder_id IS NOT NULL;
    `,
  },
  {
    version: 53,
    up: /* sql */ `
      -- Study vault phase 1: local-first organization. Documents are independent
      -- entities and placements are many-to-many so one source can appear in
      -- several courses/topics without duplicating its content.
      CREATE TABLE study_courses (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT,
        icon        TEXT,
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE study_subjects (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        course_id   TEXT NOT NULL REFERENCES study_courses(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT,
        icon        TEXT,
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_study_subjects_course ON study_subjects(course_id, position);

      CREATE TABLE study_topics (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        subject_id  TEXT NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
        parent_id   TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT,
        icon        TEXT,
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_study_topics_subject ON study_topics(subject_id, parent_id, position);

      CREATE TABLE study_folders (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        parent_id   TEXT REFERENCES study_folders(id) ON DELETE SET NULL,
        course_id   TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id  TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT,
        icon        TEXT,
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_study_folders_parent ON study_folders(parent_id, position);
      CREATE INDEX idx_study_folders_scope ON study_folders(course_id, subject_id, position);

      CREATE TABLE study_docs (
        id                  TEXT PRIMARY KEY,
        short_id            TEXT NOT NULL UNIQUE,
        title               TEXT NOT NULL,
        kind                TEXT NOT NULL DEFAULT 'apunte',
        content_markdown    TEXT NOT NULL DEFAULT '',
        description         TEXT,
        color               TEXT,
        icon                TEXT,
        favorite            INTEGER NOT NULL DEFAULT 0,
        pinned              INTEGER NOT NULL DEFAULT 0,
        locked              INTEGER NOT NULL DEFAULT 0,
        position            INTEGER NOT NULL DEFAULT 0,
        embedding           BLOB,
        embedding_provider  TEXT,
        embedding_model     TEXT,
        embedding_dim       INTEGER,
        embedding_text_hash TEXT,
        archived_at         TEXT,
        deleted_at          TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX idx_study_docs_kind ON study_docs(kind, position);
      CREATE INDEX idx_study_docs_recent ON study_docs(updated_at DESC);

      CREATE TABLE study_placements (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        document_id TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        course_id   TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id  TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        topic_id    TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        folder_id   TEXT REFERENCES study_folders(id) ON DELETE SET NULL,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        CHECK (course_id IS NOT NULL OR subject_id IS NOT NULL OR topic_id IS NOT NULL OR folder_id IS NOT NULL)
      );
      CREATE INDEX idx_study_placements_doc ON study_placements(document_id, position);
      CREATE INDEX idx_study_placements_course ON study_placements(course_id, position);
      CREATE INDEX idx_study_placements_subject ON study_placements(subject_id, position);
      CREATE INDEX idx_study_placements_topic ON study_placements(topic_id, position);
      CREATE INDEX idx_study_placements_folder ON study_placements(folder_id, position);
      CREATE UNIQUE INDEX idx_study_placements_unique
        ON study_placements(document_id, IFNULL(course_id, ''), IFNULL(subject_id, ''), IFNULL(topic_id, ''), IFNULL(folder_id, ''));

      CREATE TABLE study_tags (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT,
        color       TEXT,
        icon        TEXT,
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE study_doc_tags (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        document_id TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        tag_id      TEXT NOT NULL REFERENCES study_tags(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE(document_id, tag_id)
      );
      CREATE INDEX idx_study_doc_tags_tag ON study_doc_tags(tag_id, document_id);

      CREATE TABLE study_templates (
        id           TEXT PRIMARY KEY,
        short_id     TEXT NOT NULL UNIQUE,
        kind         TEXT NOT NULL,
        name         TEXT NOT NULL,
        description  TEXT,
        content_json TEXT NOT NULL DEFAULT '{}',
        color        TEXT,
        icon         TEXT,
        favorite     INTEGER NOT NULL DEFAULT 0,
        position     INTEGER NOT NULL DEFAULT 0,
        archived_at  TEXT,
        deleted_at   TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_study_templates_kind ON study_templates(kind, position);
    `,
  },
  {
    version: 54,
    up: /* sql */ `
      -- Study vault phase 2: lossless Markdown editing, recoverable versions,
      -- anchored comments and internal links/backlinks.
      ALTER TABLE study_docs ADD COLUMN style_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE study_docs ADD COLUMN spellcheck_language TEXT NOT NULL DEFAULT 'es-ES';
      ALTER TABLE study_docs ADD COLUMN custom_dictionary_json TEXT NOT NULL DEFAULT '[]';

      CREATE TABLE study_doc_versions (
        id               TEXT PRIMARY KEY,
        short_id         TEXT NOT NULL UNIQUE,
        document_id      TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        version_no       INTEGER NOT NULL,
        title            TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        style_json       TEXT NOT NULL DEFAULT '{}',
        reason           TEXT NOT NULL DEFAULT 'manual',
        content_hash     TEXT NOT NULL,
        position         INTEGER NOT NULL DEFAULT 0,
        archived_at      TEXT,
        deleted_at       TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        UNIQUE(document_id, version_no)
      );
      CREATE INDEX idx_study_doc_versions_doc ON study_doc_versions(document_id, version_no DESC);
      CREATE INDEX idx_study_doc_versions_hash ON study_doc_versions(document_id, content_hash);

      CREATE TABLE study_annotations (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        document_id   TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        from_pos      INTEGER NOT NULL DEFAULT 0,
        to_pos        INTEGER NOT NULL DEFAULT 0,
        selected_text TEXT NOT NULL DEFAULT '',
        comment       TEXT NOT NULL DEFAULT '',
        color         TEXT,
        resolved_at   TEXT,
        locked        INTEGER NOT NULL DEFAULT 0,
        pinned        INTEGER NOT NULL DEFAULT 0,
        position      INTEGER NOT NULL DEFAULT 0,
        archived_at   TEXT,
        deleted_at    TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_study_annotations_doc ON study_annotations(document_id, resolved_at, position);

      CREATE TABLE study_doc_links (
        id                 TEXT PRIMARY KEY,
        short_id           TEXT NOT NULL UNIQUE,
        source_document_id TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        target_document_id TEXT REFERENCES study_docs(id) ON DELETE CASCADE,
        target_ref         TEXT NOT NULL,
        target_title       TEXT,
        link_text          TEXT,
        position           INTEGER NOT NULL DEFAULT 0,
        archived_at        TEXT,
        deleted_at         TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_study_doc_links_source ON study_doc_links(source_document_id, position);
      CREATE INDEX idx_study_doc_links_target ON study_doc_links(target_document_id, position);
      CREATE UNIQUE INDEX idx_study_doc_links_unique
        ON study_doc_links(source_document_id, target_ref, IFNULL(link_text, ''));
    `,
  },
  {
    version: 55,
    up: /* sql */ `
      -- Study vault phase 5 schema. The repository and UI are activated in phase 5;
      -- the table version is installed now so v57 remains append-only and ordered.
      CREATE TABLE study_materials (
        id                  TEXT PRIMARY KEY,
        short_id            TEXT NOT NULL UNIQUE,
        title               TEXT NOT NULL,
        description         TEXT,
        file_name           TEXT,
        file_path           TEXT,
        mime_type           TEXT,
        extension           TEXT,
        content_blob        BLOB,
        content_hash        TEXT NOT NULL,
        extracted_text      TEXT NOT NULL DEFAULT '',
        extraction_status   TEXT NOT NULL DEFAULT 'pending',
        metadata_json       TEXT NOT NULL DEFAULT '{}',
        bibliography_json   TEXT NOT NULL DEFAULT '{}',
        read_state          TEXT NOT NULL DEFAULT 'pending',
        page_count          INTEGER,
        duration_seconds    REAL,
        size_bytes          INTEGER NOT NULL DEFAULT 0,
        favorite            INTEGER NOT NULL DEFAULT 0,
        pinned              INTEGER NOT NULL DEFAULT 0,
        position            INTEGER NOT NULL DEFAULT 0,
        archived_at         TEXT,
        deleted_at          TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX idx_study_materials_hash ON study_materials(content_hash);
      CREATE INDEX idx_study_materials_state ON study_materials(read_state, updated_at DESC);

      CREATE TABLE study_material_placements (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
        course_id   TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id  TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        topic_id    TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        folder_id   TEXT REFERENCES study_folders(id) ON DELETE SET NULL,
        document_id TEXT REFERENCES study_docs(id) ON DELETE SET NULL,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at  TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_study_material_placements_material ON study_material_placements(material_id, position);
      CREATE INDEX idx_study_material_placements_scope ON study_material_placements(course_id, subject_id, topic_id, document_id);

      CREATE TABLE study_material_annotations (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        material_id   TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
        page_number   INTEGER,
        rect_json     TEXT,
        from_pos      INTEGER,
        to_pos        INTEGER,
        selected_text TEXT NOT NULL DEFAULT '',
        note          TEXT NOT NULL DEFAULT '',
        color         TEXT,
        position      INTEGER NOT NULL DEFAULT 0,
        archived_at   TEXT,
        deleted_at    TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_study_material_annotations_material ON study_material_annotations(material_id, page_number, position);

      CREATE TABLE study_material_fragment_links (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        material_id   TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
        annotation_id TEXT REFERENCES study_material_annotations(id) ON DELETE SET NULL,
        document_id   TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        doc_from_pos  INTEGER,
        doc_to_pos    INTEGER,
        label         TEXT,
        source_json   TEXT NOT NULL DEFAULT '{}',
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_study_material_links_document ON study_material_fragment_links(document_id, position);
      CREATE INDEX idx_study_material_links_material ON study_material_fragment_links(material_id, position);

      CREATE TABLE study_material_versions (
        id               TEXT PRIMARY KEY,
        short_id         TEXT NOT NULL UNIQUE,
        material_id      TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
        version_no       INTEGER NOT NULL,
        file_name        TEXT,
        mime_type        TEXT,
        content_blob     BLOB,
        content_hash     TEXT NOT NULL,
        extracted_text   TEXT NOT NULL DEFAULT '',
        metadata_json    TEXT NOT NULL DEFAULT '{}',
        size_bytes       INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL,
        UNIQUE(material_id, version_no)
      );
      CREATE INDEX idx_study_material_versions_material ON study_material_versions(material_id, version_no DESC);
    `,
  },
  {
    version: 56,
    up: /* sql */ `
      -- Study vault phase 6 schema, activated by its own repository/UI phase.
      CREATE TABLE study_recordings (
        id                 TEXT PRIMARY KEY,
        short_id           TEXT NOT NULL UNIQUE,
        title              TEXT NOT NULL,
        file_name          TEXT,
        file_path          TEXT,
        mime_type          TEXT,
        audio_blob         BLOB,
        content_hash       TEXT NOT NULL,
        duration_seconds   REAL NOT NULL DEFAULT 0,
        size_bytes         INTEGER NOT NULL DEFAULT 0,
        language           TEXT,
        course_id          TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id         TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        topic_id           TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        document_id        TEXT REFERENCES study_docs(id) ON DELETE SET NULL,
        material_id        TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
        session_label      TEXT,
        processing_status  TEXT NOT NULL DEFAULT 'pending',
        processing_progress REAL NOT NULL DEFAULT 0,
        favorite           INTEGER NOT NULL DEFAULT 0,
        position           INTEGER NOT NULL DEFAULT 0,
        archived_at        TEXT,
        deleted_at         TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_study_recordings_scope ON study_recordings(course_id, subject_id, topic_id, updated_at DESC);
      CREATE INDEX idx_study_recordings_hash ON study_recordings(content_hash);

      CREATE TABLE study_transcripts (
        id                  TEXT PRIMARY KEY,
        short_id            TEXT NOT NULL UNIQUE,
        recording_id        TEXT NOT NULL REFERENCES study_recordings(id) ON DELETE CASCADE,
        kind                TEXT NOT NULL DEFAULT 'literal',
        content_markdown    TEXT NOT NULL DEFAULT '',
        language            TEXT,
        model_provider      TEXT,
        model_name          TEXT,
        status              TEXT NOT NULL DEFAULT 'pending',
        progress            REAL NOT NULL DEFAULT 0,
        error_message       TEXT,
        version_no          INTEGER NOT NULL DEFAULT 1,
        source_transcript_id TEXT REFERENCES study_transcripts(id) ON DELETE SET NULL,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        UNIQUE(recording_id, kind, version_no)
      );
      CREATE INDEX idx_study_transcripts_recording ON study_transcripts(recording_id, kind, version_no DESC);

      CREATE TABLE study_transcript_segments (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        transcript_id TEXT NOT NULL REFERENCES study_transcripts(id) ON DELETE CASCADE,
        t_start       REAL NOT NULL,
        t_end         REAL NOT NULL,
        text          TEXT NOT NULL,
        speaker       TEXT,
        confidence    REAL,
        chapter       TEXT,
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_study_transcript_segments_time ON study_transcript_segments(transcript_id, t_start, position);

      CREATE TABLE study_audio_markers (
        id           TEXT PRIMARY KEY,
        short_id     TEXT NOT NULL UNIQUE,
        recording_id TEXT NOT NULL REFERENCES study_recordings(id) ON DELETE CASCADE,
        t_seconds    REAL NOT NULL,
        label        TEXT NOT NULL,
        note         TEXT,
        color        TEXT,
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_study_audio_markers_time ON study_audio_markers(recording_id, t_seconds, position);
    `,
  },
  {
    version: 57,
    up: /* sql */ `
      -- Study vault phase 4: reusable improvement styles, prompt history,
      -- scoped defaults and a provenance-only AI action log.
      CREATE TABLE study_styles (
        id                TEXT PRIMARY KEY,
        short_id          TEXT NOT NULL UNIQUE,
        name              TEXT NOT NULL,
        icon              TEXT NOT NULL DEFAULT '✦',
        color             TEXT NOT NULL DEFAULT '#0f766e',
        description       TEXT NOT NULL DEFAULT '',
        prompt            TEXT NOT NULL,
        system_prompt     TEXT NOT NULL DEFAULT '',
        category          TEXT NOT NULL DEFAULT 'custom',
        language          TEXT NOT NULL DEFAULT 'auto',
        level             TEXT NOT NULL DEFAULT 'moderate',
        length_mode       TEXT NOT NULL DEFAULT 'similar',
        model_provider    TEXT,
        model_name        TEXT,
        temperature       REAL NOT NULL DEFAULT 0.2,
        max_output_tokens INTEGER NOT NULL DEFAULT 2400,
        creativity        REAL NOT NULL DEFAULT 0.1,
        locked            INTEGER NOT NULL DEFAULT 0,
        favorite          INTEGER NOT NULL DEFAULT 0,
        active            INTEGER NOT NULL DEFAULT 1,
        position          INTEGER NOT NULL DEFAULT 0,
        archived_at       TEXT,
        deleted_at        TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX idx_study_styles_library ON study_styles(archived_at, active DESC, favorite DESC, position, name);

      CREATE TABLE study_style_versions (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        style_id    TEXT NOT NULL REFERENCES study_styles(id) ON DELETE CASCADE,
        version_no  INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        reason      TEXT NOT NULL DEFAULT 'update',
        created_at  TEXT NOT NULL,
        UNIQUE(style_id, version_no)
      );
      CREATE INDEX idx_study_style_versions_style ON study_style_versions(style_id, version_no DESC);

      CREATE TABLE study_style_associations (
        id          TEXT PRIMARY KEY,
        style_id    TEXT NOT NULL,
        kind        TEXT NOT NULL,
        target_id   TEXT NOT NULL DEFAULT '',
        is_default  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE(style_id, kind, target_id)
      );
      CREATE INDEX idx_study_style_associations_target ON study_style_associations(kind, target_id, is_default DESC);

      CREATE TABLE study_improvement_log (
        id               TEXT PRIMARY KEY,
        document_id      TEXT NOT NULL REFERENCES study_docs(id) ON DELETE CASCADE,
        style_id         TEXT NOT NULL,
        scope            TEXT NOT NULL,
        mode             TEXT NOT NULL,
        level            TEXT NOT NULL,
        length_mode      TEXT NOT NULL,
        model_provider   TEXT NOT NULL,
        model_name       TEXT NOT NULL,
        original_hash    TEXT NOT NULL,
        result_hash      TEXT NOT NULL,
        original_chars   INTEGER NOT NULL,
        result_chars     INTEGER NOT NULL,
        warnings_json    TEXT NOT NULL DEFAULT '[]',
        action           TEXT NOT NULL DEFAULT 'generated',
        created_at       TEXT NOT NULL
      );
      CREATE INDEX idx_study_improvement_log_doc ON study_improvement_log(document_id, created_at DESC);
      CREATE INDEX idx_study_improvement_log_hash ON study_improvement_log(original_hash, result_hash);
    `,
  },
  {
    version: 58,
    up: /* sql */ `
      -- Study vault phase 10a: centralized, source-grounded question bank.
      CREATE TABLE study_questions (
        id                 TEXT PRIMARY KEY,
        short_id           TEXT NOT NULL UNIQUE,
        prompt             TEXT NOT NULL,
        question_type      TEXT NOT NULL,
        difficulty         TEXT NOT NULL DEFAULT 'medium',
        cognitive_level    TEXT NOT NULL DEFAULT 'understand',
        status             TEXT NOT NULL DEFAULT 'pending',
        answer_json        TEXT NOT NULL DEFAULT '{}',
        options_json       TEXT NOT NULL DEFAULT '[]',
        explanation        TEXT NOT NULL DEFAULT '',
        rubric_json        TEXT NOT NULL DEFAULT '{}',
        competence         TEXT,
        tags_json          TEXT NOT NULL DEFAULT '[]',
        course_id          TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id         TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        topic_id           TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        document_id        TEXT REFERENCES study_docs(id) ON DELETE SET NULL,
        material_id        TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
        recording_id       TEXT REFERENCES study_recordings(id) ON DELETE SET NULL,
        transcript_id      TEXT REFERENCES study_transcripts(id) ON DELETE SET NULL,
        source_title       TEXT,
        source_excerpt     TEXT NOT NULL DEFAULT '',
        source_location_json TEXT NOT NULL DEFAULT '{}',
        model_provider     TEXT,
        model_name         TEXT,
        generation_prompt  TEXT,
        favorite           INTEGER NOT NULL DEFAULT 0,
        locked             INTEGER NOT NULL DEFAULT 0,
        usage_count        INTEGER NOT NULL DEFAULT 0,
        correct_count      INTEGER NOT NULL DEFAULT 0,
        incorrect_count    INTEGER NOT NULL DEFAULT 0,
        omitted_count      INTEGER NOT NULL DEFAULT 0,
        total_response_ms  INTEGER NOT NULL DEFAULT 0,
        position           INTEGER NOT NULL DEFAULT 0,
        archived_at        TEXT,
        deleted_at         TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_study_questions_bank ON study_questions(archived_at, status, favorite DESC, updated_at DESC);
      CREATE INDEX idx_study_questions_scope ON study_questions(course_id, subject_id, topic_id, question_type, difficulty);
      CREATE INDEX idx_study_questions_source ON study_questions(document_id, material_id, recording_id, transcript_id);

      CREATE TABLE study_question_versions (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        question_id   TEXT NOT NULL REFERENCES study_questions(id) ON DELETE CASCADE,
        version_no    INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        reason        TEXT NOT NULL DEFAULT 'update',
        created_at    TEXT NOT NULL,
        UNIQUE(question_id, version_no)
      );
      CREATE INDEX idx_study_question_versions_question ON study_question_versions(question_id, version_no DESC);

      CREATE TABLE study_question_collections (
        id          TEXT PRIMARY KEY,
        short_id    TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        color       TEXT NOT NULL DEFAULT '#0f766e',
        favorite    INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE study_question_collection_items (
        collection_id TEXT NOT NULL REFERENCES study_question_collections(id) ON DELETE CASCADE,
        question_id   TEXT NOT NULL REFERENCES study_questions(id) ON DELETE CASCADE,
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        PRIMARY KEY(collection_id, question_id)
      );
      CREATE INDEX idx_study_question_collection_items_question ON study_question_collection_items(question_id);
    `,
  },
  {
    version: 59,
    up: /* sql */ `
      -- Study vault phases 10b/10c: reusable tests/exams and durable attempts.
      CREATE TABLE study_assessments (
        id                 TEXT PRIMARY KEY,
        short_id           TEXT NOT NULL UNIQUE,
        kind               TEXT NOT NULL,
        title              TEXT NOT NULL,
        description        TEXT NOT NULL DEFAULT '',
        course_id          TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id         TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        topic_id           TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        config_json        TEXT NOT NULL DEFAULT '{}',
        rubric_id          TEXT,
        available_at       TEXT,
        duration_minutes   INTEGER,
        max_attempts       INTEGER,
        favorite           INTEGER NOT NULL DEFAULT 0,
        archived_at        TEXT,
        deleted_at         TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_study_assessments_kind ON study_assessments(kind, subject_id, updated_at DESC);

      CREATE TABLE study_assessment_items (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        assessment_id TEXT NOT NULL REFERENCES study_assessments(id) ON DELETE CASCADE,
        question_id   TEXT NOT NULL REFERENCES study_questions(id) ON DELETE RESTRICT,
        points        REAL NOT NULL DEFAULT 1,
        required      INTEGER NOT NULL DEFAULT 1,
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        UNIQUE(assessment_id, question_id)
      );
      CREATE INDEX idx_study_assessment_items_order ON study_assessment_items(assessment_id, position);

      CREATE TABLE study_attempts (
        id                TEXT PRIMARY KEY,
        short_id          TEXT NOT NULL UNIQUE,
        assessment_id     TEXT NOT NULL REFERENCES study_assessments(id) ON DELETE CASCADE,
        mode              TEXT NOT NULL DEFAULT 'practice',
        status            TEXT NOT NULL DEFAULT 'in_progress',
        score             REAL,
        max_score         REAL,
        correct_count     INTEGER NOT NULL DEFAULT 0,
        incorrect_count   INTEGER NOT NULL DEFAULT 0,
        omitted_count     INTEGER NOT NULL DEFAULT 0,
        duration_seconds  INTEGER NOT NULL DEFAULT 0,
        started_at        TEXT NOT NULL,
        submitted_at      TEXT,
        config_json       TEXT NOT NULL DEFAULT '{}',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX idx_study_attempts_assessment ON study_attempts(assessment_id, started_at DESC);

      CREATE TABLE study_attempt_answers (
        id               TEXT PRIMARY KEY,
        short_id         TEXT NOT NULL UNIQUE,
        attempt_id       TEXT NOT NULL REFERENCES study_attempts(id) ON DELETE CASCADE,
        assessment_item_id TEXT NOT NULL REFERENCES study_assessment_items(id) ON DELETE CASCADE,
        question_id      TEXT NOT NULL REFERENCES study_questions(id) ON DELETE RESTRICT,
        response_json    TEXT NOT NULL DEFAULT '{}',
        is_correct       INTEGER,
        points_awarded   REAL,
        response_ms      INTEGER NOT NULL DEFAULT 0,
        flagged          INTEGER NOT NULL DEFAULT 0,
        confidence       INTEGER,
        feedback_json    TEXT NOT NULL DEFAULT '{}',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        UNIQUE(attempt_id, assessment_item_id)
      );
      CREATE INDEX idx_study_attempt_answers_attempt ON study_attempt_answers(attempt_id, created_at);
    `,
  },
  {
    version: 60,
    up: /* sql */ `
      -- Study vault phase 10d: weighted rubrics and auditable AI grading.
      CREATE TABLE study_rubrics (
        id            TEXT PRIMARY KEY,
        short_id      TEXT NOT NULL UNIQUE,
        name          TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        criteria_json TEXT NOT NULL,
        built_in      INTEGER NOT NULL DEFAULT 0,
        favorite      INTEGER NOT NULL DEFAULT 0,
        locked        INTEGER NOT NULL DEFAULT 0,
        archived_at   TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_study_rubrics_library ON study_rubrics(archived_at, favorite DESC, name);

      CREATE TABLE study_grading_runs (
        id               TEXT PRIMARY KEY,
        short_id         TEXT NOT NULL UNIQUE,
        attempt_answer_id TEXT NOT NULL REFERENCES study_attempt_answers(id) ON DELETE CASCADE,
        rubric_id        TEXT REFERENCES study_rubrics(id) ON DELETE SET NULL,
        severity         TEXT NOT NULL DEFAULT 'balanced',
        model_provider   TEXT NOT NULL,
        model_name       TEXT NOT NULL,
        sources_json     TEXT NOT NULL DEFAULT '[]',
        result_json      TEXT NOT NULL,
        estimated_score  REAL,
        manual_score     REAL,
        manual_comment   TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX idx_study_grading_runs_answer ON study_grading_runs(attempt_answer_id, created_at DESC);

      CREATE TABLE study_grading_annotations (
        id             TEXT PRIMARY KEY,
        short_id       TEXT NOT NULL UNIQUE,
        grading_run_id TEXT NOT NULL REFERENCES study_grading_runs(id) ON DELETE CASCADE,
        from_pos       INTEGER NOT NULL DEFAULT 0,
        to_pos         INTEGER NOT NULL DEFAULT 0,
        kind           TEXT NOT NULL,
        severity       TEXT NOT NULL DEFAULT 'info',
        message        TEXT NOT NULL,
        suggestion     TEXT,
        created_at     TEXT NOT NULL
      );
      CREATE INDEX idx_study_grading_annotations_run ON study_grading_annotations(grading_run_id, from_pos);
    `,
  },
  {
    version: 61,
    up: /* sql */ `
      -- Study vault phase 11a-11c: flashcards, spaced repetition and mastery.
      CREATE TABLE study_flashcards (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, card_type TEXT NOT NULL DEFAULT 'front_back',
        front TEXT NOT NULL, back TEXT NOT NULL, hint TEXT NOT NULL DEFAULT '', media_json TEXT NOT NULL DEFAULT '{}',
        tags_json TEXT NOT NULL DEFAULT '[]', course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL, topic_id TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        document_id TEXT REFERENCES study_docs(id) ON DELETE SET NULL, material_id TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
        transcript_id TEXT REFERENCES study_transcripts(id) ON DELETE SET NULL, question_id TEXT REFERENCES study_questions(id) ON DELETE SET NULL,
        source_excerpt TEXT NOT NULL DEFAULT '', difficulty TEXT NOT NULL DEFAULT 'medium', favorite INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0, archived_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_flashcards_scope ON study_flashcards(subject_id, topic_id, archived_at, favorite DESC);

      CREATE TABLE study_srs_state (
        card_id TEXT PRIMARY KEY REFERENCES study_flashcards(id) ON DELETE CASCADE, ease_factor REAL NOT NULL DEFAULT 2.5,
        interval_days REAL NOT NULL DEFAULT 0, due_at TEXT NOT NULL, repetitions INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0, last_rating INTEGER, last_reviewed_at TEXT, confidence REAL,
        mastered INTEGER NOT NULL DEFAULT 0, excluded INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_srs_due ON study_srs_state(excluded, mastered, due_at);

      CREATE TABLE study_reviews (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, card_id TEXT NOT NULL REFERENCES study_flashcards(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL, confidence INTEGER, correct INTEGER NOT NULL, elapsed_ms INTEGER NOT NULL DEFAULT 0,
        previous_interval_days REAL NOT NULL DEFAULT 0, next_interval_days REAL NOT NULL DEFAULT 0,
        scheduled_at TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_reviews_card ON study_reviews(card_id, created_at DESC);

      CREATE TABLE study_mastery (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL,
        mastery REAL NOT NULL DEFAULT 0, confidence REAL NOT NULL DEFAULT 0, evidence_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'learning', last_activity_at TEXT, updated_at TEXT NOT NULL,
        UNIQUE(scope_kind, scope_id)
      );
      CREATE INDEX idx_study_mastery_level ON study_mastery(scope_kind, mastery, updated_at DESC);
    `,
  },
  {
    version: 62,
    up: /* sql */ `
      -- Study vault phase 11d: local academic planning and actual study time.
      CREATE TABLE study_plans (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL, subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        exam_at TEXT, available_minutes INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL DEFAULT 0, archived_at TEXT, deleted_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE study_plan_blocks (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, plan_id TEXT REFERENCES study_plans(id) ON DELETE CASCADE,
        title TEXT NOT NULL, block_type TEXT NOT NULL DEFAULT 'study', course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL, topic_id TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        starts_at TEXT NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 25, status TEXT NOT NULL DEFAULT 'planned',
        priority INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_plan_blocks_time ON study_plan_blocks(starts_at, status, subject_id);
      CREATE TABLE study_calendar_events (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, event_type TEXT NOT NULL DEFAULT 'session',
        starts_at TEXT NOT NULL, ends_at TEXT, all_day INTEGER NOT NULL DEFAULT 0,
        course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL, subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        topic_id TEXT REFERENCES study_topics(id) ON DELETE SET NULL, notes TEXT NOT NULL DEFAULT '', reminder_minutes INTEGER,
        completed INTEGER NOT NULL DEFAULT 0, archived_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_calendar_events_time ON study_calendar_events(starts_at, event_type);
      CREATE TABLE study_goals (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, period TEXT NOT NULL DEFAULT 'weekly',
        target_value REAL NOT NULL DEFAULT 1, current_value REAL NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'sesiones',
        starts_at TEXT NOT NULL, ends_at TEXT, subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        completed INTEGER NOT NULL DEFAULT 0, archived_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE study_study_sessions (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, plan_block_id TEXT REFERENCES study_plan_blocks(id) ON DELETE SET NULL,
        subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL, topic_id TEXT REFERENCES study_topics(id) ON DELETE SET NULL,
        mode TEXT NOT NULL DEFAULT 'focus', planned_minutes INTEGER NOT NULL DEFAULT 25, actual_seconds INTEGER NOT NULL DEFAULT 0,
        interruptions INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, ended_at TEXT, notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_sessions_time ON study_study_sessions(started_at, subject_id);
    `,
  },
  {
    version: 63,
    up: /* sql */ `
      -- Study vault phase 12: auditable per-task AI usage without invented pricing.
      CREATE TABLE study_ai_usage (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, task TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, input_chars INTEGER NOT NULL DEFAULT 0,
        output_chars INTEGER NOT NULL DEFAULT 0, estimated_cost_usd REAL, status TEXT NOT NULL,
        fallback_used INTEGER NOT NULL DEFAULT 0, error TEXT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL
      );
      CREATE INDEX idx_study_ai_usage_month ON study_ai_usage(started_at, task, status);
    `,
  },
  {
    version: 64,
    up: /* sql */ `
      -- Study organization browser: topics may live directly in a subject or
      -- inside one of that subject's folders.
      ALTER TABLE study_topics ADD COLUMN folder_id TEXT REFERENCES study_folders(id) ON DELETE SET NULL;
      CREATE INDEX idx_study_topics_folder ON study_topics(folder_id, parent_id, position);
    `,
  },
  {
    version: 65,
    up: /* sql */ `
      -- Rich visual metadata for the study organization browser. Images are
      -- stored as local data URLs so they remain part of the vault and work
      -- without an external file path.
      ALTER TABLE study_courses ADD COLUMN emoji TEXT;
      ALTER TABLE study_courses ADD COLUMN image_data TEXT;
      ALTER TABLE study_courses ADD COLUMN year INTEGER;
      ALTER TABLE study_subjects ADD COLUMN emoji TEXT;
      ALTER TABLE study_subjects ADD COLUMN image_data TEXT;
      ALTER TABLE study_subjects ADD COLUMN year INTEGER;
      ALTER TABLE study_topics ADD COLUMN emoji TEXT;
      ALTER TABLE study_topics ADD COLUMN image_data TEXT;
      ALTER TABLE study_topics ADD COLUMN year INTEGER;
      ALTER TABLE study_folders ADD COLUMN emoji TEXT;
      ALTER TABLE study_folders ADD COLUMN image_data TEXT;
      ALTER TABLE study_folders ADD COLUMN year INTEGER;
      ALTER TABLE study_docs ADD COLUMN emoji TEXT;
      ALTER TABLE study_docs ADD COLUMN image_data TEXT;
      ALTER TABLE study_docs ADD COLUMN year INTEGER;
    `,
  },
  {
    version: 66,
    up: /* sql */ `
      -- Semantic material index. The visual description is persisted separately so
      -- image analysis remains inspectable and can be re-embedded without another
      -- multimodal request when the embedding model changes.
      ALTER TABLE study_materials ADD COLUMN visual_description TEXT NOT NULL DEFAULT '';
      ALTER TABLE study_materials ADD COLUMN visual_analysis_status TEXT NOT NULL DEFAULT 'not_applicable';
      ALTER TABLE study_materials ADD COLUMN visual_analysis_provider TEXT;
      ALTER TABLE study_materials ADD COLUMN visual_analysis_model TEXT;
      ALTER TABLE study_materials ADD COLUMN embedding BLOB;
      ALTER TABLE study_materials ADD COLUMN embedding_provider TEXT;
      ALTER TABLE study_materials ADD COLUMN embedding_model TEXT;
      ALTER TABLE study_materials ADD COLUMN embedding_dim INTEGER;
      ALTER TABLE study_materials ADD COLUMN embedding_text_hash TEXT;
      ALTER TABLE study_materials ADD COLUMN index_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE study_materials ADD COLUMN index_error TEXT;
      ALTER TABLE study_materials ADD COLUMN indexed_at TEXT;
      CREATE INDEX idx_study_materials_index_status ON study_materials(index_status, deleted_at, archived_at);
    `,
  },
  {
    version: 67,
    up: /* sql */ `
      -- Keep generated questions attached to the complete study hierarchy.
      ALTER TABLE study_questions ADD COLUMN folder_id TEXT REFERENCES study_folders(id) ON DELETE SET NULL;
      CREATE INDEX idx_study_questions_folder ON study_questions(folder_id, created_at DESC);
    `,
  },
  {
    version: 68,
    up: /* sql */ `
      -- Translation jobs become visible and recoverable as soon as they start.
      ALTER TABLE content_translations ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
      ALTER TABLE content_translations ADD COLUMN error TEXT;
      CREATE INDEX idx_content_translations_status ON content_translations(entity_kind, entity_id, status, updated_at DESC);
    `,
  },
  {
    version: 69,
    up: /* sql */ `
      -- Surface the learner's latest written answer and AI evaluation in the bank.
      ALTER TABLE study_questions ADD COLUMN last_response TEXT NOT NULL DEFAULT '';
      ALTER TABLE study_questions ADD COLUMN last_score REAL;
      ALTER TABLE study_questions ADD COLUMN last_max_score REAL;
      ALTER TABLE study_questions ADD COLUMN last_feedback TEXT NOT NULL DEFAULT '';
      ALTER TABLE study_questions ADD COLUMN last_answered_at TEXT;
    `,
  },
  {
    version: 70,
    up: /* sql */ `
      -- Editable weekly timetable for the study organization workspace.
      CREATE TABLE study_schedule_periods (
        id TEXT PRIMARY KEY,
        section TEXT NOT NULL CHECK(section IN ('morning', 'afternoon')),
        label TEXT NOT NULL DEFAULT '',
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE study_schedule_cells (
        day TEXT NOT NULL CHECK(day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday')),
        period_id TEXT NOT NULL REFERENCES study_schedule_periods(id) ON DELETE CASCADE,
        subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        PRIMARY KEY(day, period_id)
      );
      CREATE TABLE study_schedule_day_styles (
        day TEXT PRIMARY KEY CHECK(day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday')),
        color TEXT
      );
      CREATE INDEX idx_study_schedule_cells_subject ON study_schedule_cells(subject_id);
    `,
  },
  {
    version: 71,
    up: /* sql */ `
      -- Remove objective questions left unusable by the former permissive validator.
      -- They are soft-deleted so a backup can still recover the original row.
      UPDATE study_questions
      SET deleted_at = COALESCE(deleted_at, datetime('now')),
          updated_at = datetime('now')
      WHERE deleted_at IS NULL
        AND question_type IN ('single_choice', 'multiple_choice')
        AND (
          json_valid(options_json) = 0
          OR json_array_length(CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END) < 2
          OR EXISTS (
            SELECT 1 FROM json_each(CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END) AS option
            WHERE trim(COALESCE(json_extract(
              CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END,
              '$[' || option.key || '].text'
            ), '')) = ''
          )
          OR NOT EXISTS (
            SELECT 1 FROM json_each(CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END) AS option
            WHERE json_extract(
              CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END,
              '$[' || option.key || '].correct'
            ) = 1
          )
          OR (
            question_type = 'single_choice'
            AND (SELECT COUNT(*)
              FROM json_each(CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END) AS option
              WHERE json_extract(
                CASE WHEN json_valid(options_json) THEN options_json ELSE '[]' END,
                '$[' || option.key || '].correct'
              ) = 1
            ) <> 1
          )
        );
    `,
  },
  {
    version: 72,
    up: /* sql */ `
      -- Subject-scoped knowledge graph for study vaults. Sources remain polymorphic
      -- so imported materials and editable study notes use the same pipeline.
      CREATE TABLE study_ideas (
        id                  TEXT PRIMARY KEY,
        subject_id          TEXT NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
        type                TEXT NOT NULL,
        label               TEXT NOT NULL,
        normalized_label    TEXT NOT NULL,
        statement           TEXT NOT NULL,
        embedding           BLOB,
        embedding_provider  TEXT,
        embedding_model     TEXT,
        embedding_dim       INTEGER,
        embedding_text_hash TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        UNIQUE(subject_id, type, normalized_label)
      );
      CREATE INDEX idx_study_ideas_subject ON study_ideas(subject_id, updated_at DESC);

      CREATE TABLE study_idea_occurrences (
        id           TEXT PRIMARY KEY,
        idea_id      TEXT NOT NULL REFERENCES study_ideas(id) ON DELETE CASCADE,
        source_kind  TEXT NOT NULL CHECK(source_kind IN ('material', 'document')),
        source_id    TEXT NOT NULL,
        source_title TEXT NOT NULL DEFAULT '',
        source_hash  TEXT NOT NULL DEFAULT '',
        role         TEXT NOT NULL DEFAULT 'secondary',
        confidence   REAL NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        UNIQUE(idea_id, source_kind, source_id)
      );
      CREATE INDEX idx_study_idea_occ_source ON study_idea_occurrences(source_kind, source_id);
      CREATE INDEX idx_study_idea_occ_idea ON study_idea_occurrences(idea_id);

      CREATE TABLE study_idea_evidence (
        id            TEXT PRIMARY KEY,
        occurrence_id TEXT NOT NULL REFERENCES study_idea_occurrences(id) ON DELETE CASCADE,
        quote         TEXT NOT NULL,
        location      TEXT NOT NULL DEFAULT '',
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_study_idea_evidence_occ ON study_idea_evidence(occurrence_id, position);

      CREATE TABLE study_idea_edges (
        id                 TEXT PRIMARY KEY,
        subject_id         TEXT NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
        from_id            TEXT NOT NULL REFERENCES study_ideas(id) ON DELETE CASCADE,
        to_id              TEXT NOT NULL REFERENCES study_ideas(id) ON DELETE CASCADE,
        type               TEXT NOT NULL,
        basis              TEXT NOT NULL DEFAULT '',
        confidence         REAL NOT NULL DEFAULT 0,
        source_kind        TEXT,
        source_id          TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        CHECK(from_id <> to_id),
        UNIQUE(subject_id, from_id, to_id, type)
      );
      CREATE INDEX idx_study_idea_edges_subject ON study_idea_edges(subject_id, confidence DESC);
      CREATE INDEX idx_study_idea_edges_from ON study_idea_edges(from_id);
      CREATE INDEX idx_study_idea_edges_to ON study_idea_edges(to_id);

      CREATE TABLE study_knowledge_jobs (
        subject_id    TEXT NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
        source_kind   TEXT NOT NULL CHECK(source_kind IN ('material', 'document')),
        source_id     TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        phase         TEXT NOT NULL DEFAULT 'pending',
        source_hash   TEXT NOT NULL DEFAULT '',
        model_provider TEXT,
        model_name    TEXT,
        error         TEXT,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY(subject_id, source_kind, source_id)
      );
      CREATE INDEX idx_study_knowledge_jobs_status ON study_knowledge_jobs(status, updated_at);
    `,
  },
  {
    version: 73,
    up: /* sql */ `
      ALTER TABLE study_material_annotations ADD COLUMN kind TEXT NOT NULL DEFAULT 'highlight';
      ALTER TABLE study_material_annotations ADD COLUMN rects_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE study_material_annotations ADD COLUMN path_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE study_material_annotations ADD COLUMN thickness REAL NOT NULL DEFAULT 3;
    `,
  },
  {
    version: 74,
    up: /* sql */ `
      CREATE TABLE database_chat_conversations (
        id                TEXT PRIMARY KEY,
        title             TEXT NOT NULL,
        database_ids_json TEXT NOT NULL DEFAULT '[]',
        messages_json     TEXT NOT NULL DEFAULT '[]',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX idx_database_chat_conversations_updated
        ON database_chat_conversations(updated_at DESC);
    `,
  },
  {
    version: 75,
    up: /* sql */ `
      -- Timetable cells may contain either a subject or an independent activity.
      ALTER TABLE study_schedule_cells ADD COLUMN activity_title TEXT;
    `,
  },
  {
    version: 76,
    up: /* sql */ `
      -- Full student calendar metadata and durable reminder delivery state.
      ALTER TABLE study_calendar_events ADD COLUMN icon TEXT NOT NULL DEFAULT 'calendar';
      ALTER TABLE study_calendar_events ADD COLUMN emoji TEXT NOT NULL DEFAULT '';
      ALTER TABLE study_calendar_events ADD COLUMN description TEXT NOT NULL DEFAULT '';
      ALTER TABLE study_calendar_events ADD COLUMN url TEXT NOT NULL DEFAULT '';
      ALTER TABLE study_calendar_events ADD COLUMN reminder_at TEXT;
      ALTER TABLE study_calendar_events ADD COLUMN notified_at TEXT;
      CREATE INDEX idx_study_calendar_events_reminder ON study_calendar_events(reminder_at, notified_at, deleted_at);
    `,
  },
  {
    version: 77,
    up: /* sql */ `
      -- Zotero-backed study materials can either copy an attachment into the
      -- vault or remain a lightweight link opened by the Zotero desktop app.
      ALTER TABLE study_materials ADD COLUMN origin TEXT NOT NULL DEFAULT 'file';
      ALTER TABLE study_materials ADD COLUMN zotero_library_type TEXT;
      ALTER TABLE study_materials ADD COLUMN zotero_library_id TEXT;
      ALTER TABLE study_materials ADD COLUMN zotero_item_key TEXT;
      ALTER TABLE study_materials ADD COLUMN zotero_attachment_key TEXT;
      CREATE INDEX idx_study_materials_zotero_source
        ON study_materials(zotero_library_type, zotero_library_id, zotero_item_key, zotero_attachment_key);
    `,
  },
  {
    version: 78,
    up: /* sql */ `
      -- Cover the bounded list queries used by the performance-sensitive
      -- academic views and current-model vector maintenance.
      CREATE INDEX idx_works_active_year_title
        ON works(archived, year DESC, title COLLATE NOCASE);
      CREATE INDEX idx_works_active_analysis_status
        ON works(archived, light_status, deep_status, summary_status);
      CREATE INDEX idx_ideas_current_embedding
        ON ideas(embedding_provider, embedding_model, orphaned_at)
        WHERE embedding IS NOT NULL;
      CREATE INDEX idx_idea_theme_links_work
        ON idea_theme_links(nodus_id, global_id, theme_id);
      CREATE INDEX idx_edges_type_endpoints
        ON edges(type, from_id, to_id);
      CREATE INDEX idx_gaps_kind_statement
        ON gaps(kind, statement);
    `,
  },
  {
    version: 79,
    up: /* sql */ `
      -- Optional country-issued identifier for archival disambiguation and search.
      ALTER TABLE persons ADD COLUMN national_id TEXT;
      CREATE INDEX idx_persons_national_id ON persons(national_id);
    `,
  },
  {
    version: 80,
    up: /* sql */ `
      -- A downscaled preview of an image attachment. The grid and the gallery render one
      -- thumb per visible row, and reading the original blob for that (a 5 GB photo
      -- catalogue is ~800 KB per file) moved hundreds of MB over IPC just to draw a 40px
      -- box. NULL for non-images and for attachments added before this column existed.
      ALTER TABLE db_attachments ADD COLUMN thumb BLOB;
    `,
  },
  {
    version: 81,
    up: /* sql */ `
      -- The academic year ("2024/2025") is the scope study vaults were missing: the
      -- same subject is taught again every September with new materials and a new
      -- timetable, and last year's has to stay readable rather than be overwritten.
      -- The date range is stored, not just the label, because it is what lets the
      -- app work out which year is the current one without a stored "current" flag
      -- that goes stale the September after somebody sets it.
      CREATE TABLE study_academic_years (
        id TEXT PRIMARY KEY, short_id TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
        start_date TEXT NOT NULL, end_date TEXT NOT NULL, color TEXT,
        position INTEGER NOT NULL DEFAULT 0, archived_at TEXT, deleted_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_study_academic_years_label ON study_academic_years(label);

      -- Only courses and subjects carry the year. Topics, folders and documents reach
      -- it through the subject that owns them, so there is one place to change it and
      -- no way for a topic and its subject to claim different years. Both columns are
      -- nullable because the two real shapes disagree about where the year belongs: a
      -- school course *is* one year (set it there, subjects inherit), while a degree
      -- spans several (leave the course open, set it per subject).
      ALTER TABLE study_courses ADD COLUMN academic_year_id TEXT REFERENCES study_academic_years(id) ON DELETE SET NULL;
      ALTER TABLE study_subjects ADD COLUMN academic_year_id TEXT REFERENCES study_academic_years(id) ON DELETE SET NULL;
      CREATE INDEX idx_study_courses_academic_year ON study_courses(academic_year_id, position);
      CREATE INDEX idx_study_subjects_academic_year ON study_subjects(academic_year_id, course_id, position);

      -- The weekly timetable stops being a vault-wide singleton and becomes one grid
      -- per academic year. Cells reach their year through their period, so only
      -- periods carry the column. Existing rows keep NULL and stay reachable as the
      -- "no academic year" timetable rather than being adopted into a year the user
      -- never chose.
      ALTER TABLE study_schedule_periods ADD COLUMN academic_year_id TEXT REFERENCES study_academic_years(id) ON DELETE CASCADE;
      CREATE INDEX idx_study_schedule_periods_year ON study_schedule_periods(academic_year_id, section, position);

      -- Day colours were keyed by day alone, which cannot hold one palette per year.
      -- SQLite cannot widen a primary key in place, so the table is rebuilt. The
      -- unique index goes through COALESCE because NULLs are distinct in a SQLite
      -- index, and a bare (academic_year_id, day) index would let the unscoped
      -- timetable accumulate two colours for the same Monday.
      CREATE TABLE study_schedule_day_styles_v81 (
        day TEXT NOT NULL CHECK(day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday')),
        academic_year_id TEXT REFERENCES study_academic_years(id) ON DELETE CASCADE,
        color TEXT
      );
      INSERT INTO study_schedule_day_styles_v81 (day, academic_year_id, color)
        SELECT day, NULL, color FROM study_schedule_day_styles;
      DROP TABLE study_schedule_day_styles;
      ALTER TABLE study_schedule_day_styles_v81 RENAME TO study_schedule_day_styles;
      CREATE UNIQUE INDEX idx_study_schedule_day_styles_key
        ON study_schedule_day_styles(COALESCE(academic_year_id, ''), day);
    `,
  },
  {
    version: 82,
    up: /* sql */ `
      -- Exam paper builder (teaching vault). This is deliberately NOT study_assessments:
      -- that models an interactive test taken on screen and assembled from the shared
      -- question bank, whose 0.78 similarity dedup would silently drop freshly generated
      -- items. An exam paper is a printed document, so its questions are owned by the
      -- exam (cascade delete), carry layout intent (answer lines, option/pair shape, an
      -- embedded image) and never pollute the bank.
      CREATE TABLE teaching_exams (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        language TEXT NOT NULL DEFAULT 'es',
        target_question_count INTEGER NOT NULL DEFAULT 10,
        -- Header fields and logos are a single JSON blob each: they are read and written
        -- as a whole by the builder and never queried by column.
        header_json TEXT NOT NULL DEFAULT '{}',
        logos_json TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_teaching_exams_subject ON teaching_exams(subject_id, updated_at DESC);

      CREATE TABLE teaching_exam_questions (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        exam_id TEXT NOT NULL REFERENCES teaching_exams(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        points REAL NOT NULL DEFAULT 1,
        options_json TEXT NOT NULL DEFAULT '[]',
        pairs_json TEXT NOT NULL DEFAULT '[]',
        items_json TEXT NOT NULL DEFAULT '[]',
        image_data_url TEXT,
        image_caption TEXT NOT NULL DEFAULT '',
        answer_lines INTEGER,
        solution TEXT NOT NULL DEFAULT '',
        ai_prompt TEXT NOT NULL DEFAULT '',
        generated_by TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_teaching_exam_questions_exam ON teaching_exam_questions(exam_id, position);
    `,
  },
  {
    version: 83,
    up: /* sql */ `
      -- Rubrics (teaching vault). Levels and criteria are stored as JSON rather than
      -- child tables: a rubric is always read, edited and exported as one whole grid,
      -- never queried by cell, and keeping it in one row makes the history list a plain
      -- SELECT and versioning trivial.
      CREATE TABLE teaching_rubrics (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        subject_id TEXT REFERENCES study_subjects(id) ON DELETE SET NULL,
        course_id TEXT REFERENCES study_courses(id) ON DELETE SET NULL,
        language TEXT NOT NULL DEFAULT 'es',
        scale_max REAL NOT NULL DEFAULT 5,
        weighted INTEGER NOT NULL DEFAULT 0,
        levels_json TEXT NOT NULL DEFAULT '[]',
        criteria_json TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_teaching_rubrics_subject ON teaching_rubrics(subject_id, updated_at DESC);
    `,
  },
  {
    version: 84,
    up: /* sql */ `
      -- A reusable logo library: a teacher stamps the same crest on every exam, so the
      -- image is stored once here and copied into each exam that uses it (the exam stays
      -- self-contained, and deleting a library entry never blanks an existing paper).
      CREATE TABLE teaching_logos (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        data_url TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Until the teacher picks a language for THIS exam, the document follows the
      -- interface language; once they choose, that choice is remembered per exam.
      ALTER TABLE teaching_exams ADD COLUMN language_locked INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 85,
    up: /* sql */ `
      -- Section statements: a shared text/case/image (type = 'section') that several
      -- sub-questions hang from. The sub-questions point at it through parent_id, so a
      -- standalone question can still follow a section — which a flat "everything after
      -- this header belongs to it" marker could never express.
      --
      -- ON DELETE CASCADE: removing the statement removes the questions that only made
      -- sense underneath it. The builder warns before doing so.
      ALTER TABLE teaching_exam_questions
        ADD COLUMN parent_id TEXT REFERENCES teaching_exam_questions(id) ON DELETE CASCADE;
      CREATE INDEX idx_teaching_exam_questions_parent ON teaching_exam_questions(parent_id, position);
    `,
  },
  {
    version: 86,
    up: /* sql */ `
      -- Student groups (teaching vault): the class list a teacher keeps per subject.
      --
      -- A group hangs off a SUBJECT, not a course, because the per-student comment is
      -- inherently subject-scoped — what you note about a student in History is not what
      -- you note in Geography. Modelling groups as shared rosters (group ⇄ subject
      -- many-to-many) would force splitting identity from annotation into two tables to
      -- save nothing but retyping, which the "import from another group" action below
      -- solves far more cheaply.
      --
      -- academic_year_id is carried HERE rather than inherited from the subject: a group
      -- belongs to one academic year the same way a course does, and that is exactly what
      -- makes a new year start from an empty list instead of dragging last year's
      -- students along. It is SET NULL rather than CASCADE so deleting a year archives
      -- the scoping, never the roster.
      CREATE TABLE teaching_groups (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        subject_id TEXT NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
        academic_year_id TEXT REFERENCES study_academic_years(id) ON DELETE SET NULL,
        -- The "total number of students" the teacher declares up front; used once to
        -- pre-create that many blank rows. A starting point, never a limit.
        expected_size INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_teaching_groups_subject ON teaching_groups(subject_id, academic_year_id);

      -- pseudonym_code is a STORED column, not derived from the name: it has to survive
      -- a rename, and deriving it from the name (initials, a hash) would defeat the
      -- point of showing it to an AI instead of the name. See shared/studentPseudonyms.ts.
      CREATE TABLE teaching_students (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES teaching_groups(id) ON DELETE CASCADE,
        given_names TEXT NOT NULL DEFAULT '',
        surnames TEXT NOT NULL DEFAULT '',
        comments TEXT NOT NULL DEFAULT '',
        pseudonym_code TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_teaching_students_code ON teaching_students(group_id, pseudonym_code);
      CREATE INDEX idx_teaching_students_group ON teaching_students(group_id, position);
    `,
  },
  {
    version: 87,
    up: /* sql */ `
      -- Gradebook (teaching vault).
      --
      -- The plan IS the programación didáctica / guía docente, and it is versioned on
      -- purpose: no state norm prescribes how a grade is computed, so what actually
      -- binds a teacher — and what a grade challenge is resolved against — is the
      -- document they published. Once published_at is set the plan is frozen and an
      -- edit produces a new version, so a mark can always be recomputed against the
      -- rules that were in force when it was given.
      --
      -- rules_json holds the whole PlanRules object (scale, rounding, thresholds,
      -- not-presented policy, honours quota, advisories). It is stored as one blob
      -- rather than as columns because it is always read and written whole, and
      -- because every institution needs a different subset of it.
      CREATE TABLE teaching_assessment_plans (
        id TEXT PRIMARY KEY,
        short_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        subject_id TEXT NOT NULL REFERENCES study_subjects(id) ON DELETE CASCADE,
        academic_year_id TEXT REFERENCES study_academic_years(id) ON DELETE SET NULL,
        profile TEXT NOT NULL DEFAULT 'libre',
        rules_json TEXT NOT NULL DEFAULT '{}',
        published_at TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        parent_version_id TEXT REFERENCES teaching_assessment_plans(id) ON DELETE SET NULL,
        archived_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_teaching_plans_subject ON teaching_assessment_plans(subject_id, academic_year_id);

      -- The evaluation tree. weight and weight_alt are the two columns of a guía
      -- docente's evaluation table (continuous vs non-continuous assessment) over the
      -- SAME tree — not two trees, which is how the document itself is laid out.
      --
      -- The source_* columns keep provenance: a column generated from an exam question
      -- can be traced back to it, and competency_code/criterion_code carry the LOMLOE
      -- traceability that a regional inspection asks for.
      CREATE TABLE teaching_assessment_items (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES teaching_assessment_plans(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES teaching_assessment_items(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'activity',
        position INTEGER NOT NULL DEFAULT 0,
        weight REAL NOT NULL DEFAULT 1,
        weight_alt REAL NOT NULL DEFAULT 1,
        aggregation TEXT NOT NULL DEFAULT 'weighted',
        entry_mode TEXT NOT NULL DEFAULT 'numeric',
        max_points REAL NOT NULL DEFAULT 10,
        min_to_average REAL,
        is_mandatory INTEGER NOT NULL DEFAULT 0,
        is_recoverable INTEGER NOT NULL DEFAULT 1,
        target REAL,
        best_of INTEGER,
        conditional_min REAL,
        source_exam_id TEXT REFERENCES teaching_exams(id) ON DELETE SET NULL,
        source_exam_question_id TEXT REFERENCES teaching_exam_questions(id) ON DELETE SET NULL,
        source_rubric_id TEXT REFERENCES teaching_rubrics(id) ON DELETE SET NULL,
        competency_code TEXT,
        criterion_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_teaching_items_plan ON teaching_assessment_items(plan_id, parent_id, position);

      -- THE ATOM. status is orthogonal to raw_value, which is the whole reason a blank
      -- cell need not mean zero: "sin evaluar" renormalises the weights, "no entregado"
      -- may score zero, and "exento" never counts either way.
      --
      -- convocatoria is part of the key rather than a separate table so an ordinary and
      -- an extraordinary mark for the same item coexist and can be compared.
      CREATE TABLE teaching_grade_entries (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES teaching_students(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL REFERENCES teaching_assessment_items(id) ON DELETE CASCADE,
        convocatoria TEXT NOT NULL DEFAULT 'ordinaria',
        raw_value REAL,
        status TEXT NOT NULL DEFAULT 'not_assessed',
        is_override INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_teaching_entries_key
        ON teaching_grade_entries(student_id, item_id, convocatoria);
      CREATE INDEX idx_teaching_entries_item ON teaching_grade_entries(item_id, convocatoria);

      -- Per-student rubric marks. Rubrics themselves store their grid as JSON because
      -- they are edited whole, but an EVALUATION is queried per criterion, so it gets
      -- real rows.
      CREATE TABLE teaching_rubric_evaluations (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES teaching_grade_entries(id) ON DELETE CASCADE,
        criterion_id TEXT NOT NULL,
        level_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_teaching_rubric_eval_key
        ON teaching_rubric_evaluations(entry_id, criterion_id);
    `,
  },
  {
    version: 88,
    up: /* sql */ `
      -- Every version a sync merge discarded, so "newest wins" stops destroying.
      --
      -- Merging two machines resolves conflicts by comparing wall-clock timestamps. That
      -- is fine until a clock is wrong, and it silently overwrote whatever lost. The
      -- losing version is now kept here instead: a wrong resolution becomes a decision
      -- the user can review and undo, not lost work.
      --
      -- Purely additive: nothing reads or writes it except the merge and its own view,
      -- so an older build simply ignores it.
      CREATE TABLE sync_superseded (
        id           TEXT PRIMARY KEY,
        table_name   TEXT NOT NULL,
        -- JSON array of the identity values, in the order the merge resolved them.
        row_key      TEXT NOT NULL,
        -- 'incoming-lost'     the arriving version lost and was not applied
        -- 'local-overwritten' the arriving version won and replaced local work
        -- 'restored'          a superseded version was promoted back, replacing this one
        origin       TEXT NOT NULL,
        -- The row as JSON. BLOB columns are replaced by a {__nodusOmittedBlob} marker:
        -- duplicating attachments and recordings would multiply the database size.
        row_json     TEXT NOT NULL,
        row_stamp    TEXT,
        winner_stamp TEXT,
        package_date TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_sync_superseded_created ON sync_superseded(created_at DESC);
      CREATE INDEX idx_sync_superseded_row ON sync_superseded(table_name, row_key);
    `,
  },
  {
    version: 89,
    up: /* sql */ `
      -- Deletions, so they stop coming back.
      --
      -- A sync package carries rows, not their absence. Deleting a note on one machine
      -- and importing any package built before the other heard about it re-inserted the
      -- note with its original timestamps — and did so again on every future sync, in
      -- both directions. There was no way to delete anything permanently across two
      -- computers.
      --
      -- A tombstone is the record that a row was deleted, and when. It is written by
      -- triggers generated from the synced-table registry (see db/tombstones.ts), so a
      -- table added by a later migration is covered by the same mechanism that already
      -- forces it to be classified.
      CREATE TABLE sync_tombstones (
        table_name TEXT NOT NULL,
        -- json_array() of the identity values, byte-identical to the JSON.stringify the
        -- merge produces, so SQL-written and JS-written keys compare equal.
        row_key    TEXT NOT NULL,
        deleted_at TEXT NOT NULL,
        PRIMARY KEY (table_name, row_key)
      );
      CREATE INDEX idx_sync_tombstones_deleted ON sync_tombstones(deleted_at);
    `,
  },
  {
    version: 90,
    up: /* sql */ `
      -- Nodus Protect output library. The final, already-rasterised artifact is
      -- kept as a vault BLOB so it follows full backups and portable sync. A
      -- soft-delete marker prevents an older .nodussync package from
      -- resurrecting a copy the user removed on another machine.
      CREATE TABLE protect_copies (
        id           TEXT PRIMARY KEY,
        file_name    TEXT NOT NULL,
        mime_type    TEXT NOT NULL,
        bytes        INTEGER NOT NULL DEFAULT 0,
        sha256       TEXT NOT NULL,
        blob         BLOB,
        source_kind  TEXT,
        source_label TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        deleted_at   TEXT
      );
      CREATE INDEX idx_protect_copies_updated ON protect_copies(deleted_at, updated_at DESC);
      CREATE INDEX idx_protect_copies_sha256 ON protect_copies(sha256);
    `,
  },
  {
    version: 91,
    up: /* sql */ `
      -- Worldbuilding characters. A character IS a person row — that is what lets it
      -- inherit life events, kinship, social relations, places and the portrait — so
      -- this table is a 1:1 SUPERPOSITION holding only what makes no sense outside a
      -- made-up world. A genealogy vault never has rows here, and none of its own
      -- surfaces (GEDCOM, dedupe, evidence) learn a new column.
      CREATE TABLE character_profiles (
        person_id        TEXT PRIMARY KEY REFERENCES persons(person_id) ON DELETE CASCADE,

        -- Identity, replacing persons.sex ('male'|'female'|'unknown'), which describes
        -- neither a god, nor a dragon, nor a sentient sword. persons.sex stays
        -- 'unknown' in a worldbuilding vault and is never surfaced.
        species          TEXT,
        gender           TEXT,
        pronouns         TEXT,

        -- Narrative state instead of a bare birth/death pair.
        -- unknown | alive | dead | missing | undead | immortal | unborn
        life_status      TEXT NOT NULL DEFAULT 'unknown',

        -- protagonist | antagonist | secondary | tertiary | cameo
        narrative_role   TEXT,
        -- A palette token (never a raw hex) so the card grid restyles with the theme.
        accent           TEXT,

        -- The biographical description, split in three so the image prompt is not fed
        -- the personality and the backstory as noise.
        appearance       TEXT,
        personality      TEXT,
        backstory        TEXT,

        -- The canonical appearance prompt, re-injected into EVERY image generation.
        -- It is the only thing that makes a character resemble itself across images.
        visual_seed      TEXT,

        -- In-world year. The readable date stays in persons.birth_date / death_date
        -- exactly as the author typed it ("13 de Lluvia, 1204 T.E."); these integers
        -- (negative allowed) are the ONLY thing that orders anything, because
        -- parseHistoricalDate rejects every year outside 1..3000 and silently yields a
        -- null sort key for an invented calendar.
        birth_year_sort  INTEGER,
        death_year_sort  INTEGER,

        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX idx_character_profiles_birth ON character_profiles(birth_year_sort);

      -- An event's position in an invented calendar. A side table rather than a column
      -- on "events" so this migration stays CREATE-only (and therefore replayable by
      -- the backfill path) and so the genealogy ontology gains nothing it never uses.
      CREATE TABLE event_world_dates (
        event_id    TEXT PRIMARY KEY REFERENCES events(event_id) ON DELETE CASCADE,
        world_year  INTEGER,
        -- Tie-break within the same year (season, day, chapter) without forcing the
        -- author to invent a whole calendar first.
        world_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_event_world_dates_year ON event_world_dates(world_year, world_order);
    `,
  },
  {
    version: 92,
    up: /* sql */ `
      -- Second round of the worldbuilding character sheet: an image gallery, the
      -- narrative arc, the character's voice, their abilities, secret aliases, and
      -- valence on social relations.
      --
      -- NOT create-only (it adds columns), so it is never replayed by the backfill path.

      -- Many images per character, each keeping the prompt that produced it so a
      -- generation is reproducible and can be iterated instead of re-guessed. The bytes
      -- live in the vault like every other irreplaceable authored asset.
      --
      -- The AVATAR is deliberately NOT a flag here: person_portraits stays the single
      -- source of truth for it (everything from the card grid to the kinship tree reads
      -- that table, and the non-destructive framing belongs to it), so "use as avatar"
      -- copies the bytes across. One duplicated blob beats two competing answers to
      -- "which image is this character".
      CREATE TABLE character_images (
        image_id    TEXT PRIMARY KEY,
        person_id   TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        -- portrait | full_body | expression | age | outfit | other
        kind        TEXT NOT NULL DEFAULT 'portrait',
        label       TEXT,
        mime_type   TEXT NOT NULL DEFAULT 'image/jpeg',
        bytes       INTEGER NOT NULL DEFAULT 0,
        blob        BLOB,
        prompt      TEXT,
        provider    TEXT,
        model       TEXT,
        style       TEXT,
        generated   INTEGER NOT NULL DEFAULT 0,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_character_images_person ON character_images(person_id, sort_order);

      -- Abilities with a COST and a LIMIT. Both columns exist because a power with
      -- neither is a plot solvent: the limit is what makes it dramatic.
      CREATE TABLE character_abilities (
        ability_id  TEXT PRIMARY KEY,
        person_id   TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT,
        cost        TEXT,
        limits      TEXT,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_character_abilities_person ON character_abilities(person_id, sort_order);

      -- The classic story-structure arc, and how the character sounds. Columns on the
      -- overlay rather than a table: they are exactly one optional value each, and the
      -- sheet always reads them together with the rest of the profile.
      ALTER TABLE character_profiles ADD COLUMN arc_want TEXT;
      ALTER TABLE character_profiles ADD COLUMN arc_need TEXT;
      ALTER TABLE character_profiles ADD COLUMN arc_flaw TEXT;
      ALTER TABLE character_profiles ADD COLUMN arc_lie TEXT;
      ALTER TABLE character_profiles ADD COLUMN arc_wound TEXT;
      ALTER TABLE character_profiles ADD COLUMN voice_register TEXT;
      ALTER TABLE character_profiles ADD COLUMN voice_tics TEXT;
      ALTER TABLE character_profiles ADD COLUMN voice_sample TEXT;

      -- A biography the AI was allowed to PROPOSE from, rather than one written strictly
      -- from canon. Kept separate from persons.biography so a proposal can never be
      -- mistaken for something the author accepted.
      ALTER TABLE character_profiles ADD COLUMN biography_proposed TEXT;
      ALTER TABLE character_profiles ADD COLUMN biography_proposed_at TEXT;

      -- A name can be a secret: who knows it is a plot device, not decoration.
      ALTER TABLE person_names ADD COLUMN secret INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE person_names ADD COLUMN known_by TEXT;

      -- Relations are already DIRECTIONAL, which is what lets A love B while B despises
      -- A. What was missing is the colour of the bond and the moment it changed.
      ALTER TABLE social_relations ADD COLUMN valence TEXT;
      ALTER TABLE social_relations ADD COLUMN since_event_id TEXT REFERENCES events(event_id) ON DELETE SET NULL;
    `,
  },
  {
    version: 93,
    up: /* sql */ `
      -- The world's own calendar: eras and months the author invents.
      --
      -- ONE calendar per vault, because one vault is one world — the same reasoning that
      -- makes a genealogy vault hold one family. That is what lets these be plain tables
      -- with no owner column.
      --
      -- Entirely OPTIONAL. Without a calendar the integer year in event_world_dates keeps
      -- ordering everything exactly as before; defining one buys exact ordering WITHIN a
      -- year and a real date picker instead of free text. A writer should not have to
      -- invent twelve month names before they can write their first character.
      CREATE TABLE world_calendar (
        -- Single row, enforced rather than assumed: a second calendar would silently make
        -- half the timeline sort against the wrong month lengths.
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        name       TEXT,
        notes      TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- An era names a stretch of years and says where its year 1 falls on the absolute
      -- scale, so "1204 T.E." and "340 de la Larga Noche" can be compared at all.
      CREATE TABLE world_calendar_eras (
        era_id           TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        abbreviation     TEXT,
        -- The absolute year this era's year 1 corresponds to.
        start_year       INTEGER NOT NULL DEFAULT 0,
        -- Eras that count DOWN towards their end, the way BC does.
        counts_backwards INTEGER NOT NULL DEFAULT 0,
        sort_order       INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX idx_world_eras_order ON world_calendar_eras(sort_order);

      -- Months in order, each with its own length. No leap rules: a leap year is a
      -- real-calendar accident of astronomy, and modelling it would complicate every
      -- absolute-day computation for something almost no invented calendar needs.
      CREATE TABLE world_calendar_months (
        month_id   TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        days       INTEGER NOT NULL DEFAULT 30,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_world_months_order ON world_calendar_months(sort_order);

      -- The structured half of an event's date. The readable string stays in events.date
      -- exactly as the author typed it; these are what ordering uses.
      --
      -- world_day is DERIVED (era + year + month + day → an absolute day number). It is
      -- stored rather than computed on read so the timeline can ORDER BY it, which means
      -- every calendar edit has to recompute it — see recomputeWorldDays().
      ALTER TABLE event_world_dates ADD COLUMN era_id TEXT;
      ALTER TABLE event_world_dates ADD COLUMN month_index INTEGER;
      ALTER TABLE event_world_dates ADD COLUMN day INTEGER;
      ALTER TABLE event_world_dates ADD COLUMN world_day INTEGER;
      CREATE INDEX idx_event_world_dates_day ON event_world_dates(world_day);
    `,
  },
  {
    version: 94,
    up: /* sql */ `
      -- Collections: one image table for every world entity, and one table for the groups
      -- a character can belong to.

      -- character_images generalised. Places, factions and cultures all want a gallery
      -- with the same shape, and two tables for one concept is exactly the "two sources of
      -- truth" problem the avatar rule was written to avoid. Done NOW, while the gallery
      -- holds a handful of rows: in three sections this would be a real data migration.
      --
      -- entity_id is polymorphic and therefore has NO foreign key, which means the
      -- ON DELETE CASCADE that character_images relied on is GONE. Every delete path has
      -- to remove its own images explicitly — see deleteCharacter().
      CREATE TABLE world_images (
        image_id    TEXT PRIMARY KEY,
        -- character | place | group | scene
        entity_kind TEXT NOT NULL,
        entity_id   TEXT NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'portrait',
        label       TEXT,
        mime_type   TEXT NOT NULL DEFAULT 'image/jpeg',
        bytes       INTEGER NOT NULL DEFAULT 0,
        blob        BLOB,
        prompt      TEXT,
        provider    TEXT,
        model       TEXT,
        style       TEXT,
        generated   INTEGER NOT NULL DEFAULT 0,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_world_images_entity ON world_images(entity_kind, entity_id, sort_order);

      INSERT INTO world_images
        (image_id, entity_kind, entity_id, kind, label, mime_type, bytes, blob, prompt,
         provider, model, style, generated, sort_order, created_at, updated_at)
      SELECT image_id, 'character', person_id, kind, label, mime_type, bytes, blob, prompt,
             provider, model, style, generated, sort_order, created_at, updated_at
        FROM character_images;
      DROP TABLE character_images;

      -- Factions, cultures, religions, houses and orders are ONE entity with a kind, not
      -- five tables. They share every field — name, description, image, members, period —
      -- so the sections are filtered views of this one collection, and adding "Religiones"
      -- later costs a vocabulary entry and a sidebar row.
      CREATE TABLE world_groups (
        group_id      TEXT PRIMARY KEY,
        -- faction | culture | religion | house | order | species | language
        kind          TEXT NOT NULL DEFAULT 'faction',
        name          TEXT NOT NULL,
        summary       TEXT,
        description   TEXT,
        -- Same role as a character's: the anchor that keeps generated images of one
        -- faction's emblem or one culture's dress looking like each other.
        visual_seed   TEXT,
        accent        TEXT,
        -- active | extinct | dormant
        status        TEXT,
        parent_id     TEXT REFERENCES world_groups(group_id) ON DELETE SET NULL,
        seat_place_id TEXT REFERENCES places(place_id) ON DELETE SET NULL,
        founded_year  INTEGER,
        ended_year    INTEGER,
        notes         TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_world_groups_kind ON world_groups(kind, name);

      -- Who belongs to what, with a rank and a period in world days. A character can hold
      -- several ranks in the same group over time, so the period is part of the identity.
      CREATE TABLE character_affiliations (
        affiliation_id TEXT PRIMARY KEY,
        person_id      TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        group_id       TEXT NOT NULL REFERENCES world_groups(group_id) ON DELETE CASCADE,
        rank           TEXT,
        from_world_day INTEGER,
        to_world_day   INTEGER,
        notes          TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX idx_affiliations_person ON character_affiliations(person_id);
      CREATE INDEX idx_affiliations_group ON character_affiliations(group_id);
    `,
  },
  {
    version: 95,
    up: /* sql */ `
      -- The fiction half of a place, exactly as character_profiles is the fiction half of
      -- a person. The places table is SHARED with genealogy — which writes real
      -- municipalities with gazetteer ids — so the invented fields live in an overlay
      -- as columns nobody there will ever fill.
      --
      -- The hierarchy and the classifier need no schema at all: parent_id and kind have
      -- existed on the places table since migration 33.
      CREATE TABLE place_profiles (
        place_id    TEXT PRIMARY KEY REFERENCES places(place_id) ON DELETE CASCADE,
        -- Split for the same reason the character description is: the image prompt is
        -- built from the appearance alone, and feeding it the history paints a mood
        -- instead of a place.
        appearance  TEXT,
        atmosphere  TEXT,
        history     TEXT,
        -- The anchor that keeps successive images of one city looking like one city.
        visual_seed TEXT,
        accent      TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
    `,
  },
  {
    version: 96,
    up: /* sql */ `
      -- Secrets, and who knows them. A plot device with a state, not a note.
      --
      -- The point is not storing the secret: it is being able to ask "who could possibly
      -- have said this out loud in chapter nine". So the KNOWERS carry the moment they
      -- learned it, and the secret itself carries whether it is still kept.
      CREATE TABLE world_secrets (
        secret_id          TEXT PRIMARY KEY,
        title              TEXT NOT NULL,
        content            TEXT,
        -- Whose secret it is. SET NULL rather than cascade: a secret usually outlives the
        -- character it belonged to, which is frequently the whole point of it.
        owner_person_id    TEXT REFERENCES persons(person_id) ON DELETE SET NULL,
        -- kept | revealed
        status             TEXT NOT NULL DEFAULT 'kept',
        revealed_world_day INTEGER,
        notes              TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_world_secrets_owner ON world_secrets(owner_person_id);

      CREATE TABLE secret_knowers (
        id              TEXT PRIMARY KEY,
        secret_id       TEXT NOT NULL REFERENCES world_secrets(secret_id) ON DELETE CASCADE,
        person_id       TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        -- When they learned it, on the world scale. Null = they always knew.
        since_world_day INTEGER,
        how             TEXT,
        created_at      TEXT NOT NULL,
        UNIQUE (secret_id, person_id)
      );
      CREATE INDEX idx_secret_knowers_person ON secret_knowers(person_id);

      -- Scenes: the unit a writer actually works in.
      --
      -- TWO orders, deliberately, because they are not the same thing and conflating them
      -- is what makes a flashback impossible to file. world_day is WHEN it happens in the
      -- world; narrative_order is WHERE it sits in the telling. A prologue set three
      -- centuries earlier is first in the narrative and near-last in the chronology, and
      -- both facts have to survive.
      CREATE TABLE world_scenes (
        scene_id        TEXT PRIMARY KEY,
        title           TEXT NOT NULL,
        summary         TEXT,
        place_id        TEXT REFERENCES places(place_id) ON DELETE SET NULL,
        world_year      INTEGER,
        world_day       INTEGER,
        -- outline | draft | written
        status          TEXT NOT NULL DEFAULT 'outline',
        narrative_order INTEGER NOT NULL DEFAULT 0,
        notes           TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX idx_world_scenes_order ON world_scenes(narrative_order);
      CREATE INDEX idx_world_scenes_day ON world_scenes(world_year, world_day);

      CREATE TABLE scene_characters (
        id        TEXT PRIMARY KEY,
        scene_id  TEXT NOT NULL REFERENCES world_scenes(scene_id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
        role      TEXT,
        UNIQUE (scene_id, person_id)
      );
      CREATE INDEX idx_scene_characters_person ON scene_characters(person_id);
    `,
  },
  {
    version: 97,
    up: /* sql */ `
      -- Maps of an invented world.
      --
      -- A MAP IS A CANVAS, NOT A PLACE. The relation to "places" is many-to-many: a city
      -- is a pin on the continent map, on the kingdom map and on the trade-routes map,
      -- AND has a map of its own holding its districts. Modelling a map as a property of
      -- a place would make the second half of that sentence impossible.
      --
      -- Every coordinate in these tables is NORMALIZED 0..1 against the base image, never
      -- a pixel. The image will be regenerated in another style, re-uploaded at a higher
      -- resolution and extended by an edge; in pixels each of those gestures scatters
      -- every pin the author placed. See shared/worldMapGeometry.ts, which owns the
      -- arithmetic and is the only correct way to transform any of it.
      CREATE TABLE world_maps (
        map_id        TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        -- world | continent | region | city | town | building | interior | dungeon
        -- | battle | route | schematic | other
        kind          TEXT NOT NULL DEFAULT 'region',
        -- "This map IS the map OF this place". SET NULL rather than cascade: deleting the
        -- place must not take the map with it, which may still be worth keeping as a plate.
        place_id      TEXT REFERENCES places(place_id) ON DELETE SET NULL,

        parent_map_id TEXT REFERENCES world_maps(map_id) ON DELETE SET NULL,
        -- Where this map falls inside its parent, in the PARENT's normalized coordinates.
        parent_x0 REAL, parent_y0 REAL, parent_x1 REAL, parent_y1 REAL,

        image_id      TEXT,
        width_px      INTEGER NOT NULL DEFAULT 0,
        height_px     INTEGER NOT NULL DEFAULT 0,

        -- The calibration segment. Stored as TWO POINTS, not a length, so it survives a
        -- regeneration at another resolution (still the same two points of the drawing)
        -- and survives an outpaint (it transforms with everything else).
        scale_x0 REAL, scale_y0 REAL, scale_x1 REAL, scale_y1 REAL,
        scale_distance REAL,
        scale_unit     TEXT,

        -- flat | globe. "globe" reads the image as equirectangular over a planet of the
        -- given radius and measures by great circle, because a world map measured flat
        -- gives nonsense near the poles.
        projection     TEXT NOT NULL DEFAULT 'flat',
        planet_radius  REAL,
        planet_radius_unit TEXT,

        -- A map can be of an epoch: "the Empire in year 300".
        from_world_day INTEGER,
        to_world_day   INTEGER,

        -- The anchor that keeps every map of one world looking like one atlas, exactly as
        -- character_profiles.visual_seed keeps a character looking like themselves.
        visual_seed    TEXT,
        style          TEXT,
        -- 0 = Nodus draws the labels (the default); 1 = the image model is asked to write
        -- them. Image models write illegible or misspelled text and a map is mostly text,
        -- so drawing them ourselves is what keeps the names correct, searchable,
        -- translatable and able to follow a renamed place.
        model_labels   INTEGER NOT NULL DEFAULT 0,
        notes          TEXT,
        sort_order     INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX idx_world_maps_place  ON world_maps(place_id);
      CREATE INDEX idx_world_maps_parent ON world_maps(parent_map_id);

      -- Its own table and NOT world_images: a map needs its native resolution, and the
      -- gallery path downsizes to 1280 px, which would turn every map into a blurred
      -- thumbnail. This also keeps the previous version around so a regeneration can be
      -- undone, which a gallery has no concept of.
      CREATE TABLE map_images (
        image_id   TEXT PRIMARY KEY,
        map_id     TEXT NOT NULL REFERENCES world_maps(map_id) ON DELETE CASCADE,
        -- base | previous | reference
        role       TEXT NOT NULL DEFAULT 'base',
        mime_type  TEXT NOT NULL DEFAULT 'image/webp',
        width      INTEGER NOT NULL DEFAULT 0,
        height     INTEGER NOT NULL DEFAULT 0,
        bytes      INTEGER NOT NULL DEFAULT 0,
        blob       BLOB,
        thumbnail  BLOB,
        prompt     TEXT,
        provider   TEXT,
        model      TEXT,
        style      TEXT,
        generated  INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_map_images_map ON map_images(map_id, role);

      CREATE TABLE map_layers (
        layer_id   TEXT PRIMARY KEY,
        map_id     TEXT NOT NULL REFERENCES world_maps(map_id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        -- political | physical | routes | climate | culture | battle | labels | custom
        kind       TEXT NOT NULL DEFAULT 'custom',
        color      TEXT,
        opacity    REAL NOT NULL DEFAULT 1,
        visible    INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_map_layers_map ON map_layers(map_id, sort_order);

      -- A pin, a circle of influence, a traced outline or a route. One geometry column
      -- rather than four tables, because they are one thing to the author: the shape
      -- grows out of the pin as they refine it (point → circle → polygon).
      CREATE TABLE map_markers (
        marker_id     TEXT PRIMARY KEY,
        map_id        TEXT NOT NULL REFERENCES world_maps(map_id) ON DELETE CASCADE,
        layer_id      TEXT REFERENCES map_layers(layer_id) ON DELETE SET NULL,

        -- The link to the world. NULL = decorative, or not assigned yet.
        place_id      TEXT REFERENCES places(place_id) ON DELETE SET NULL,
        -- Double-clicking descends here. Usually the map of the same place.
        child_map_id  TEXT REFERENCES world_maps(map_id) ON DELETE SET NULL,
        label         TEXT,

        -- point | circle | polygon | path
        geometry_kind TEXT NOT NULL DEFAULT 'point',
        x REAL NOT NULL,
        y REAL NOT NULL,
        -- Circles only, normalized against the X axis: one number cannot describe an
        -- ellipse, so the X axis is picked and every conversion goes through it.
        radius REAL,
        -- polygon/path: JSON [[x, y], ...].
        points TEXT,

        icon  TEXT,
        color TEXT,
        -- Temporal validity. Not only for pins: a polygon with a period IS a border, so
        -- moving the playhead expands an empire and burns a forest with the same machinery
        -- that moves the characters.
        from_world_day INTEGER,
        to_world_day   INTEGER,

        notes      TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_map_markers_map   ON map_markers(map_id, sort_order);
      CREATE INDEX idx_map_markers_place ON map_markers(place_id);

      -- How fast things move in this world. Belongs to the vault, not to a map: a horse
      -- does not change pace between the continent map and the city map.
      CREATE TABLE map_travel_modes (
        mode_id    TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        distance_per_day REAL NOT NULL,
        unit       TEXT NOT NULL DEFAULT 'km',
        icon       TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 98,
    up: /* sql */ `
      -- The encyclopedia of an invented world.
      --
      -- THERE IS NO INDEX TABLE HERE, AND THAT IS THE POINT. A character, a place, a
      -- faction, a scene and a map are already rows somewhere; projecting them into an
      -- A-Z index is a read, not a copy. A materialised index would be a second answer to
      -- "what is this thing called", and the two would disagree the first time somebody
      -- renamed a character. Same reasoning as shared/worldPresence.ts, which refused a
      -- fourth positions table because the vault already answered the question three
      -- times. What this migration adds is the half the world does NOT already hold: the
      -- articles for lore that hangs off no entity, and the link graph between everything.
      --
      -- NO STATEMENT HERE USES A CASCADING FOREIGN KEY, DELIBERATELY. isCreateOnly() below
      -- strips comments and then rejects any body containing the word DELETE -- which the
      -- clause "ON DELETE CASCADE" contains. A migration written that way loses BOTH
      -- repair paths: backfillMissingCreateOnly() will not restore its tables, and a
      -- database migrated under a differently-numbered build dies with "table already
      -- exists" instead of being replayed. Ownership is enforced by the repo's delete
      -- transactions instead, exactly as world_images already does for the polymorphic
      -- gallery.

      -- Lore that is not an entity: a magic system, a religion, a language, a species, an
      -- artifact, a technology, a concept. Everything else in the encyclopedia is a
      -- projection of a row that lives in its own section; only these are native.
      CREATE TABLE world_articles (
        article_id    TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        -- The normalised title: accents folded, lowercased, whitespace collapsed. Written
        -- by shared/worldEncyclopedia.ts and NEVER by SQLite, whose LOWER() is ASCII-only
        -- and would file "Vael" and "Vael" with a diaeresis as two different things in a
        -- genre where half the proper nouns carry one.
        title_key     TEXT NOT NULL,
        -- magic | religion | language | creature | species | artifact | technology
        -- | concept | event | organization | flora | fauna | custom | other
        category      TEXT NOT NULL DEFAULT 'other',
        -- The one line under the title in the index. Deliberately separate from the body:
        -- an index that shows the body's first sentence shows a different sentence every
        -- time the author edits the opening.
        summary       TEXT,
        -- Markdown. A resolved link is an ordinary Markdown link to nodus://world/...;
        -- an unresolved one stays as the [[Name]] the author typed. Both forms are owned
        -- by shared/worldEncyclopedia.ts, which is the only correct parser.
        body          TEXT,
        -- The model's draft, kept apart from the body exactly as
        -- character_profiles.biography_proposed is kept apart from persons.biography. A
        -- proposal that silently became canon would be indistinguishable from something
        -- the author wrote -- and here it would be the WHOLE entry, not one field.
        body_proposed    TEXT,
        body_proposed_at TEXT,
        -- Other names this entry answers to, one per line. The link resolver and the
        -- search match them. A character takes theirs from person_names; an article has
        -- no ontology row to hang them on and a second table for four words is not worth it.
        aka           TEXT,
        -- author | ai_proposal. An entry accepted from the missing-entries analysis is
        -- still the author's, but they should be able to see which ones they never wrote.
        origin        TEXT NOT NULL DEFAULT 'author',
        -- Left out of the exported world bible unless the author asks for it: exporting
        -- is handing the file to somebody else.
        spoiler       INTEGER NOT NULL DEFAULT 0,
        -- "Vor, Kaelen", for when the alphabetical position is not the title.
        sort_title    TEXT,
        notes         TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      -- NOT unique. Two entries sharing a name is a real editorial situation, and a UNIQUE
      -- constraint would turn it into a FAILED SYNC MERGE the moment the other machine's
      -- copy arrives. The repo warns on create; the resolver breaks ties by created_at.
      CREATE INDEX idx_world_articles_title_key ON world_articles(title_key);
      CREATE INDEX idx_world_articles_category  ON world_articles(category, title);

      -- The link graph. Derived from the bodies, and rebuildable from them -- but STORED,
      -- because it cannot be recomputed on demand: five of the six entry kinds have no
      -- body column at all (a character's "body" is composed from a dozen sheet fields at
      -- read time), so answering "who mentions Kaelen" by scanning would mean composing
      -- every sheet in the world on every page view.
      --
      -- THE PRIMARY KEY IS CONTENT-DERIVED, NOT A UUID, AND THAT IS LOAD-BEARING. Every
      -- synced table gets AFTER DELETE / AFTER INSERT tombstone triggers (see
      -- electron/db/tombstones.ts). Re-indexing a body clears this source's rows and
      -- re-inserts them; with random ids that would leave one permanent tombstone per link
      -- on every single save, syncing forever. With this key an unchanged link re-inserts
      -- under the same key, and the INSERT trigger clears the tombstone the DELETE trigger
      -- just wrote.
      --
      -- A (source, field, target) triple is a SET, not a list: a second mention of the
      -- same target bumps occurrences rather than adding a row, so inserting a paragraph
      -- renumbers nothing.
      --
      -- NO FOREIGN KEYS, on either end: both are polymorphic across six tables, exactly
      -- like world_images. Removing an entity therefore does NOT remove the links pointing
      -- at it -- and must not. The correct behaviour is that they DEGRADE to unresolved
      -- and show up as red links, so the author sees what they just orphaned.
      CREATE TABLE world_links (
        -- article | character | place | group | scene | map
        source_kind  TEXT NOT NULL,
        source_id    TEXT NOT NULL,
        -- Which text the link was written in: body, notes, backstory, history, summary...
        -- Kept so "mentioned in" can say WHERE, and so re-indexing one field does not wipe
        -- the links found in another.
        source_field TEXT NOT NULL,
        -- "kind:id" once resolved; "?:<normalised text>" while the author has written a
        -- [[...]] nobody has defined yet. One column rather than two nullable ones,
        -- because every query here is "the rows pointing at X" and a half-NULL compound
        -- key indexes badly.
        target_key   TEXT NOT NULL,
        -- The words the author actually wrote. Rendered verbatim: the link belongs to the
        -- prose, so renaming Kaelen Vor must never rewrite a sentence that called him
        -- "the Crow".
        label        TEXT,
        occurrences  INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        PRIMARY KEY (source_kind, source_id, source_field, target_key)
      );
      CREATE INDEX idx_world_links_target ON world_links(target_key);
      CREATE INDEX idx_world_links_source ON world_links(source_kind, source_id);

      -- What the world talks about but has never defined. Quarantined in its own table
      -- rather than written into world_articles as empty stubs: an index full of blank
      -- entries the author never asked for is worse than no analysis at all.
      CREATE TABLE world_entry_proposals (
        proposal_id  TEXT PRIMARY KEY,
        term         TEXT NOT NULL,
        -- Normalised, so a second run does not propose "Los Sin Nombre" beside "los sin
        -- nombre", and so a dismissal sticks across runs.
        term_key     TEXT NOT NULL,
        category     TEXT,
        rationale    TEXT,
        suggested_summary TEXT,
        -- JSON array of { key, title, snippet }. The author has to SEE where the term
        -- appears to judge it, and re-finding the mentions means re-scanning the world.
        evidence     TEXT,
        -- unresolved_link | frequency. An unresolved [[...]] is a FACT the author already
        -- stated; an n-gram is a guess. The UI must never present the second with the
        -- confidence of the first.
        source       TEXT NOT NULL DEFAULT 'frequency',
        confidence   REAL,
        -- pending | accepted | dismissed. Dismissed rows are KEPT, so the next run does
        -- not propose again what the author already turned down.
        status       TEXT NOT NULL DEFAULT 'pending',
        article_id   TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX idx_world_entry_proposals_status ON world_entry_proposals(status, confidence DESC);
      CREATE INDEX idx_world_entry_proposals_term   ON world_entry_proposals(term_key);
    `,
  },
  {
    version: 99,
    up: /* sql */ `
    -- Las cinco secciones de "Analizar" comparten un esqueleto, porque las cinco son
    -- lecturas de UNA sola afirmacion que el vault no podia guardar: "en esta escena,
    -- esto se mueve asi". Una regla puesta a prueba, un conflicto que avanza y un arco
    -- que gira son la misma fila con distinto vocabulario, y la prueba de ello es que las
    -- tres se rellenan desde el mismo sitio: la ficha de la escena que el autor tiene
    -- abierta. Tres tablas separadas habrian obligado a tres paneles en esa ficha, tres
    -- repos, tres modulos puros y tres respuestas distintas a "que pasa en la escena 41".
    --
    -- NINGUNA SENTENCIA DE ESTE CUERPO LLEVA CLAUSULA DE BORRADO EN CASCADA, A PROPOSITO:
    -- isCreateOnly() quita los comentarios y despues rechaza cualquier cuerpo que
    -- contenga esa palabra, y una migracion asi pierde LOS DOS caminos de reparacion
    -- (backfillMissingCreateOnly, y la reejecucion en una base migrada con otra
    -- numeracion). La propiedad la imponen las transacciones del repo, igual que ya hacen
    -- world_images y la enciclopedia.
    --
    -- Y NO HAY NINGUNA CLAVE FORANEA HACIA world_scenes NI HACIA persons, que es una
    -- decision distinta y mas importante: el pragma foreign_keys esta ON, asi que un
    -- REFERENCES sin accion declarada usa NO ACTION y ABORTA el borrado del padre. Una
    -- decision de oficio ("corta esta escena") se convertiria en un error de base de
    -- datos. El comportamiento correcto es el que world_links ya establecio: la fila
    -- degrada, y el repo la limpia en su propia transaccion.

    -- ---------------------------------------------------------------------------
    -- 1. La cadena de dias. Propiedad de Escenas, precondicion de todo lo demas.
    -- ---------------------------------------------------------------------------
    -- world_scenes.world_day es NULLABLE y en un vault real esta vacio: un novelista
    -- escribe treinta escenas antes de saber si la boda es el dia 412 o el 415. Sin ese
    -- entero, tres de las seis familias de Continuidad (presencia, viaje, secreto) no
    -- disparan JAMAS, y la seccion se abre vacia prometiendo que comprueba el mundo.
    --
    -- La solucion no es pedir el numero: es pedir la RELACION con la escena anterior, que
    -- es como piensa quien escribe. Un ancla explicita al principio de cada acto y una
    -- cadena de "mismo dia" / "+3 dias" produce world_day para todo el manuscrito con
    -- cuatro clics. Esta tabla guarda la DECLARACION; world_day sigue siendo el dato
    -- canonico y lo escribe recomputeSceneDays() en el repo.
    CREATE TABLE world_scene_days (
      scene_id      TEXT PRIMARY KEY,
      -- anchor | same | offset. 'anchor' fija un dia absoluto; los otros dos se leen
      -- respecto de la escena inmediatamente anterior en ORDEN DE RELATO.
      mode          TEXT NOT NULL DEFAULT 'offset',
      offset_days   INTEGER NOT NULL DEFAULT 0,
      -- Solo con mode='anchor'. Dia absoluto en la escala de shared/worldCalendar.ts.
      anchor_world_day INTEGER,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    -- ---------------------------------------------------------------------------
    -- 2. Los hilos: conflictos y arcos, en una tabla.  [UNIFICACION 1]
    -- ---------------------------------------------------------------------------
    -- Un conflicto es un hilo cuyas partes se oponen; un arco es un hilo con un solo
    -- sujeto. Las dos criticas del proyecto llegaron al mismo sitio por caminos
    -- distintos: la de Conflictos exigio decidir "Tramas" antes del DDL, y la de Arcos
    -- senalo que un arco con subject_kind='plot' ES una trama. La respuesta es que
    -- "Tramas" no existe, y que estas dos secciones son dos caras de una maquina.
    --
    -- LO QUE NO SE UNIFICA, Y POR QUE: world_rules se queda aparte. Una regla no tiene
    -- partes ni sujeto; tiene ambito, vigencia, precio, limite y madre. Meterla aqui
    -- habria dejado siete columnas nulas en todos los conflictos y cinco en todos los
    -- arcos, que es la forma que tiene una unificacion de ser una mentira.
    CREATE TABLE world_threads (
      thread_id   TEXT PRIMARY KEY,
      -- conflict | arc
      kind        TEXT NOT NULL DEFAULT 'conflict',
      title       TEXT NOT NULL,
      -- Normalizado por shared/worldEncyclopedia.normalizeTitle() y NUNCA por SQLite,
      -- cuyo LOWER() es solo ASCII. NO es unico, por la misma razon que world_articles
      -- no lo es: una colision de nombre es una situacion editorial, y un UNIQUE la
      -- convierte en una fusion de sincronizacion fallida en cuanto llega la copia de
      -- la otra maquina.
      title_key   TEXT NOT NULL,
      -- Una caja de prosa, no dos. El diseno pedia "want" y "object" por separado y eso
      -- es distincion de manual de guion, no de mesa de trabajo: quien teclea "La guerra
      -- por el vado" ya ha dicho el objeto. Admite enlaces [[...]], que world_links
      -- indexa como cualquier otro cuerpo -- de ahi salen "Disputado en:" en la ficha
      -- del lugar y el retroenlace del artefacto, sin un par polimorfico (kind, id).
      pitch       TEXT,
      -- Que se pierde si esto se pierde. Solo para conflictos.
      stakes      TEXT,
      -- external | background. 'background' es la presion que no es plan de nadie -- el
      -- invierno, la peste, la deuda: puede no tener parte opuesta y nunca cuenta como
      -- algo en juego de un personaje. Por defecto y NO se pregunta al crear.
      scope       TEXT NOT NULL DEFAULT 'external',
      -- open | resolved | archived. Tres valores, no cinco: 'latente' y 'escalando' se
      -- derivan de los latidos (si no hay ninguno / si hay mas subidas que bajadas), y
      -- un desplegable al que nadie vuelve dira "en marcha" hasta que se borre el vault.
      status      TEXT NOT NULL DEFAULT 'open',
      -- Como acaba, en palabras del autor. La pantalla no lo muestra hasta status
      -- 'resolved': un campo permanentemente gris es un reproche permanente.
      outcome     TEXT,
      -- author | ai. Procedencia permanente. En la v1 solo se escribe 'author'.
      origin      TEXT NOT NULL DEFAULT 'author',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX idx_world_threads_kind      ON world_threads(kind, status, title);
    CREATE INDEX idx_world_threads_title_key ON world_threads(title_key);

    -- Quien esta en un hilo.  [UNIFICACION 1b]
    -- Muchos a muchos porque una guerra de tres bandos es lo normal y un par de columnas
    -- party_a/party_b obligaria al autor a mentir en el primer conflicto interesante.
    -- Polimorfica porque una parte es tan a menudo una casa como una persona -- y por eso
    -- mismo, como world_images y world_links, sin clave foranea.
    CREATE TABLE thread_parties (
      thread_id  TEXT NOT NULL,
      -- character | group
      party_kind TEXT NOT NULL,
      party_id   TEXT NOT NULL,
      -- subject | wants | opposes | caught.
      -- 'subject' es como un ARCO declara de quien es: un arco es un hilo con una sola
      -- parte, y eso es exactamente lo que hace que las dos secciones compartan tabla.
      -- 'caught' es el que nadie pide y todos necesitan: el nino, la ciudad, el rehen --
      -- presente, perdiendo pase lo que pase, en ningun bando.
      side       TEXT NOT NULL DEFAULT 'wants',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      -- CLAVE DERIVADA DEL CONTENIDO, Y ES LOAD-BEARING. El editor de partes reescribe
      -- este conjunto vaciando e insertando; cada tabla sincronizada recibe disparadores
      -- de lapida AFTER DELETE / AFTER INSERT (electron/db/tombstones.ts), asi que con
      -- ids aleatorios cada guardado dejaria una lapida permanente por parte, para
      -- siempre. Con esta clave una parte sin cambios se reinserta identica y el
      -- disparador de INSERT limpia la lapida que el otro acaba de escribir.
      --
      -- "side" NO forma parte de la clave: una entidad en los dos bandos del mismo
      -- conflicto es una contradiccion, y que la clave la rechace es una virtud.
      PRIMARY KEY (thread_id, party_kind, party_id)
    );
    CREATE INDEX idx_thread_parties_party ON thread_parties(party_kind, party_id);

    -- ---------------------------------------------------------------------------
    -- 3. Los latidos. EL CORAZON DEL PROYECTO.  [UNIFICACION 2]
    -- ---------------------------------------------------------------------------
    -- "En esta escena, esto se mueve asi". Una fila es, a la vez:
    --   * la prueba de una regla   (thread_kind='rule',     mark: obeys|bends|breaks|establishes)
    --   * el latido de un conflicto(thread_kind='conflict', mark: raise|turn|ease|resolve)
    --   * el hito de un arco       (thread_kind='arc',      mark: step|turn)
    -- Los tres disenos pedian su propia tabla (rule_uses, conflict_scenes,
    -- world_arc_beats) con las mismas cinco columnas y semantica identica: un ancla a
    -- escena, un vocabulario de cuatro palabras, una nota, un sujeto opcional. Y los tres
    -- reconocian, en su propia critica, que la tabla NO se llena desde su seccion sino
    -- desde la ficha de la escena. Una sola tabla significa UN panel en esa ficha en vez
    -- de tres, y significa que "estas nueve escenas no mueven nada" -- el mejor
    -- diagnostico de los quince propuestos -- es un LEFT JOIN en vez de una union.
    --
    -- LO QUE NO SE DERIVA Y NUNCA SE DERIVARA es el juicio: world_links ya sabe que
    -- escenas mencionan [[Marca de sangre]], y scene_characters ya sabe quien estaba en
    -- la sala. Que la ley se rompa ahi, y que el precio no este en la pagina, solo lo
    -- puede decir quien escribe. Ese juicio es el producto entero.
    CREATE TABLE world_beats (
      -- rule | conflict | arc
      thread_kind  TEXT NOT NULL,
      -- world_rules.rule_id o world_threads.thread_id. Polimorfica, sin clave foranea.
      thread_id    TEXT NOT NULL,
      -- NOT NULL A PROPOSITO. El diseno de Arcos preveia hitos "sin anclar" en un canalon
      -- lateral con arrastre; eso obligaba a una clave uuid, a un orden autoral paralelo
      -- (beat_order) y a un diagnostico de "hito en la escena equivocada" que solo existe
      -- porque uno de los dos ordenes se queda rancio. Un plan sin escena es una pregunta
      -- abierta o una nota, no un hito. SIN clave foranea: cortar una escena no puede
      -- fallar ni borrar el juicio en silencio; deleteScene() limpia estas filas en su
      -- propia transaccion.
      scene_id     TEXT NOT NULL,
      -- El vocabulario, por tipo de hilo. Cuatro palabras que el autor elige sin pensar,
      -- nunca un numero de 0 a 10: una cifra que se inventa de nuevo cada vez no mide
      -- nada y no se puede comparar a lo largo de un manuscrito.
      mark         TEXT NOT NULL DEFAULT 'step',
      -- Que cambia, en una frase. Es el hito de un arco; en regla y conflicto, la nota.
      -- La UI solo la pide cuando mark='turn': un giro es lo unico que necesita
      -- explicacion, "sube" se explica solo.
      text         TEXT,
      -- A FAVOR DE QUIEN.  [UNIFICACION 2b]
      -- "Sube" es ambiguo: sube para quien. Para un conflicto es la parte que gana
      -- terreno; para una regla, quien la rompio; para un arco, null (el sujeto es el del
      -- hilo). Tres preguntas distintas de tres disenos, un solo par polimorfico.
      subject_kind TEXT,
      subject_id   TEXT,
      -- SOLO REGLAS: 1 = el precio esta en la pagina, 0 = no esta, NULL = el autor no lo
      -- ha mirado. NULL Y 0 TIENEN QUE SEGUIR SIENDO DISTINGUIBLES, y solo el 0 explicito
      -- genera aviso: el diseno original contaba NULL como impago, y como NULL es el
      -- estado de toda fila recien creada, la seccion habria gritado desde el minuto uno
      -- sobre reglas que el autor todavia no habia mirado. Es literalmente el fallo que
      -- la cabecera de shared/characterChecks.ts documenta.
      paid         INTEGER,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      -- Clave derivada del contenido por la razon de las lapidas, y ademas porque un
      -- hilo o mueve una escena o no la mueve: es un conjunto, no una lista.
      PRIMARY KEY (thread_kind, thread_id, scene_id)
    );
    CREATE INDEX idx_world_beats_scene   ON world_beats(scene_id);
    CREATE INDEX idx_world_beats_thread  ON world_beats(thread_kind, thread_id);
    CREATE INDEX idx_world_beats_subject ON world_beats(subject_kind, subject_id);

    -- ---------------------------------------------------------------------------
    -- 4. Las leyes duras del mundo.
    -- ---------------------------------------------------------------------------
    -- Lo unico obligatorio es el titulo. Una seccion que exige quince campos antes de
    -- ser util es una seccion abandonada en dos semanas.
    CREATE TABLE world_rules (
      rule_id       TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      title_key     TEXT NOT NULL,
      -- El texto completo, en Markdown y con [[...]] como cualquier otra prosa del vault,
      -- para que "a que facciones obliga" se conteste desde world_links sin tabla puente.
      statement     TEXT,
      -- Que cuesta romperla. Aparte del enunciado porque toda la capa de diagnostico le
      -- hace una sola pregunta: este precio, esta alguna vez en la pagina.
      cost          TEXT,
      -- Hasta donde NO llega. Sin esto un sistema de magia es un disolvente de tramas,
      -- que es la misma razon por la que character_abilities lleva "limits".
      limits        TEXT,
      -- physical | costly | social. El contrato con el lector, y el UNICO campo que
      -- cambia lo que significa una infraccion: romper una fisica es un error de
      -- continuidad, romper una con precio sin pagarlo es una trampa, romper una social
      -- es una trama. Tres valores porque un escritor elige uno honestamente; con diez
      -- elige al azar.
      hardness      TEXT NOT NULL DEFAULT 'costly',
      -- Una excepcion es una REGLA MAS ESTRECHA colgada de su madre, asi que hereda
      -- ambito, vigencia, precio, secreto y sus propias pruebas -- y puede tener su
      -- propia excepcion, que es exactamente como se comportan las leyes de una religion.
      -- Sin clausula de borrado: el repo reapadrina las huerfanas al abuelo dentro de su
      -- transaccion, porque tirar en silencio la mitad mejor escrita de la seccion no.
      parent_rule_id TEXT,
      -- El diseno pedia un "domain" de ocho valores que es, literalmente,
      -- world_articles.category otra vez (magic, religion, language, technology...). En
      -- su lugar, la regla es HIJA de un articulo: se crea desde el con "convertir en
      -- ley" y hereda su categoria. Sin esto el autor acaba con "Magia de sangre" y "La
      -- sangre paga la sangre" como dos entradas hermanas de la enciclopedia.
      article_id    TEXT,
      -- world | group | place. 'species' y 'character' eran casos raros que la prosa ya
      -- resuelve. Polimorfico y por tanto sin clave foranea: una faccion borrada deja un
      -- ambito colgante que los chequeos reportan como "ambito roto", que es el
      -- comportamiento correcto -- el autor necesita ver lo que acaba de dejar huerfano.
      scope_kind    TEXT NOT NULL DEFAULT 'world',
      scope_id      TEXT,
      -- Cuando rige, en la escala de dias absolutos del calendario inventado. Nulos los
      -- dos = siempre ha regido. Detras de un "esta ley no siempre existio" en la ficha:
      -- la columna existe, el formulario no la pide.
      from_world_day INTEGER,
      to_world_day   INTEGER,
      -- canon | tentative | retired. 'tentative' no es decoracion: los chequeos callan
      -- sobre una regla a la que el autor no se ha comprometido, y una seccion que grita
      -- sobre borradores es una seccion cuyos avisos se ignoran en bloque.
      status        TEXT NOT NULL DEFAULT 'canon',
      -- El secreto que esta regla (casi siempre una excepcion) es. Quien lo sabe y desde
      -- cuando es secret_knowers: NO hay rule_knowers, porque esa pregunta ya se contesto
      -- una vez y contestarla dos garantiza dos respuestas distintas.
      secret_id     TEXT,
      -- El borrador del modelo, en cuarentena igual que world_articles.body_proposed.
      -- Aceptarlo es una accion aparte y explicita: una propuesta que se volviera canon
      -- en silencio seria indistinguible de lo que escribio el autor, y aqui seria UNA LEY.
      proposed_text TEXT,
      proposed_at   TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX idx_world_rules_parent    ON world_rules(parent_rule_id);
    CREATE INDEX idx_world_rules_scope     ON world_rules(scope_kind, scope_id);
    CREATE INDEX idx_world_rules_title_key ON world_rules(title_key);

    -- ---------------------------------------------------------------------------
    -- 5. Las decisiones sin tomar.
    -- ---------------------------------------------------------------------------
    -- Un libro de cuentas, no una bandeja de tareas. De las siete reglas de derivacion
    -- que el diseno proponia, SEIS pertenecian a otra seccion (enlaces rojos a la
    -- Enciclopedia, huecos de arco a Arcos, contradicciones a Continuidad, escenas sin
    -- fecha a Escenas, revelaciones a Secretos), y un panel de los huecos ajenos es la
    -- categoria exacta de herramienta que se abandona en la semana tres. Quedan dos
    -- origenes: lo que el autor teclea, y los marcadores que ya escribio el mismo.
    CREATE TABLE world_questions (
      question_id  TEXT PRIMARY KEY,
      question     TEXT NOT NULL,
      -- Que espera la respuesta. Polimorfico sobre seis tablas y por tanto sin clave
      -- foranea. NULL es legitimo y comun: "la magia deja marca visible" es del mundo.
      anchor_kind  TEXT,
      anchor_id    TEXT,
      -- En que campo de la ficha va la respuesta. Se DERIVA de donde se capturo la
      -- pregunta; jamas se pregunta al autor, que es lo que convertiria la captura en un
      -- formulario de tres widgets.
      anchor_field TEXT,
      -- open | answered | parked. 'parked' significa "no me lo vuelvas a ensenar hasta
      -- que algo cambie" y absorbe lo que el diseno llamaba 'dismissed': eran dos estados
      -- negativos indistinguibles en la practica.
      status       TEXT NOT NULL DEFAULT 'open',
      -- author | placeholder
      origin       TEXT NOT NULL DEFAULT 'author',
      -- Derivada del contenido para los marcadores, p.ej. 'ph:character:prs_7:backstory'.
      -- Es lo que hace que aparcar una pregunta derivada se pegue entre recalculos. NO es
      -- unica: un duplicado llegando de otra maquina no puede ser una fusion fallida.
      origin_key   TEXT,
      -- "No puedo seguir sin esto". Un interruptor, no una escala de prioridad: una
      -- escala es un campo que el autor edita una vez y nunca mas.
      blocking     INTEGER NOT NULL DEFAULT 0,
      chosen_option_id TEXT,
      answered_at  TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX idx_world_questions_status ON world_questions(status, updated_at DESC);
    CREATE INDEX idx_world_questions_anchor ON world_questions(anchor_kind, anchor_id);
    CREATE INDEX idx_world_questions_origin ON world_questions(origin_key);

    -- Las respuestas en competencia. Tabla aparte y no una columna JSON porque cada una
    -- se elige, se aplica y se deshace por separado -- y sobre todo porque una opcion es
    -- UNA ESCRITURA PENDIENTE, y una escritura necesita destino, no una vineta.
    CREATE TABLE world_question_options (
      option_id    TEXT PRIMARY KEY,
      -- Sin clave foranea: el fusionador de sincronizacion recorre las tablas de una en
      -- una, asi que una opcion puede llegar antes que su pregunta; una referencia
      -- estricta rechazaria la fila y el mundo perderia la respuesta en vez del orden.
      question_id  TEXT NOT NULL,
      text         TEXT NOT NULL,
      -- "Lo que arrastra". Lo escribe la IA junto a la opcion; como caja vacia se rellena
      -- en las dos primeras preguntas y en ninguna mas.
      implications TEXT,
      -- author | ai. Una opcion no es canon hasta que se elige y se aplica, asi que la
      -- cuarentena aqui es ESTRUCTURAL y no una segunda columna.
      origin       TEXT NOT NULL DEFAULT 'author',
      -- none | fill_field | create_article. El destino se infiere del ancla de la
      -- pregunta; nunca se elige en un formulario. 'none' es una respuesta de primera
      -- clase: hay decisiones que se toman y simplemente se recuerdan.
      apply_mode   TEXT NOT NULL DEFAULT 'none',
      applied_at   TEXT,
      -- Lo que el campo decia ANTES. Es el deshacer. Sin el nadie pulsa un boton que
      -- sobrescribe un parrafo de su propia prosa, y un boton que nadie pulsa devuelve la
      -- seccion a ser una lista de tareas.
      replaced_text TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX idx_world_question_options_q ON world_question_options(question_id);

    -- ---------------------------------------------------------------------------
    -- 6. El silencio, para las cinco secciones.  [UNIFICACION 3]
    -- ---------------------------------------------------------------------------
    -- NO HAY TABLA DE HALLAZGOS. Un hallazgo es una funcion pura del vault y se recalcula
    -- entero al abrir la pantalla: una fila guardada seria una segunda verdad que
    -- sobrevive a su propia correccion. Lo unico que persiste es lo que el autor ha
    -- decidido callar -- y eso lo pedian CUATRO disenos por separado: los silencios de
    -- Continuidad, el conflict_hints_dismissed que la critica de Conflictos reclamo para
    -- que los candidatos JOIN no murieran de ruido, los avisos de regla ya juzgados, y la
    -- supresion de una pregunta derivada. Es un solo libro, y por tanto una sola pantalla
    -- donde revisar lo que has mandado callar.
    CREATE TABLE world_notice_mutes (
      -- LA CLAVE ES DERIVADA DEL CONTENIDO Y ES LO QUE HACE QUE EL SILENCIO FUNCIONE.
      -- Formato: "<check_id>|<kind:id[#campo]>,<kind:id>..." con los sujetos ORDENADOS.
      --   1. Idempotente entre pasadas: el mismo silencio sobrescribe su propia fila en
      --      vez de acumular filas y lapidas.
      --   2. Converge al sincronizar: callar lo mismo en dos maquinas da UNA fila.
      --   3. NO CONTIENE LAS CIFRAS. Si la huella incluyera el dia 412, cambiar la fecha
      --      a 411 haria reaparecer la excepcion ya juzgada; y peor, una contradiccion
      --      DISTINTA entre los mismos dos hechos quedaria tapada por el silencio viejo.
      --      Los sujetos son la identidad del problema; las cifras son su sintoma.
      fingerprint  TEXT PRIMARY KEY,
      check_id     TEXT NOT NULL,
      -- finding | check. 'check' apaga la comprobacion entera para este mundo. Es una
      -- FILA y no un ajuste porque tiene que viajar con el mundo.
      scope        TEXT NOT NULL DEFAULT 'finding',
      -- JSON [{kind,id,title,field?}]. Copiado, no referenciado: la pantalla de
      -- excepciones tiene que poder listarlas sin recorrer el mundo, y un sujeto que ya
      -- no existe debe seguir leyendose.
      subjects     TEXT NOT NULL DEFAULT '[]',
      -- El mensaje tal y como se leia al callarlo. Sin esto, la lista seis meses despues
      -- es una lista de huellas ilegibles.
      headline     TEXT,
      -- double | told | deliberate | unknown. Enlatado porque el gesto real del escritor
      -- es "quitalo de mi vista" a las 23:40, y una caja de texto libre se queda vacia el
      -- 90 % de las veces. Ademas son accionables: 'told' es material de articulo para la
      -- Enciclopedia y excepcion de una regla para Reglas; 'unknown' crea una pregunta
      -- abierta en vez de un silencio, que es lo que impide que esta lista se convierta
      -- en un cementerio de decisiones aplazadas.
      reason_code  TEXT NOT NULL DEFAULT 'deliberate',
      reason       TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX idx_world_notice_mutes_check ON world_notice_mutes(check_id);
  `,
  },
  {
    version: 100,
    up: /* sql */ `
    -- El manuscrito. La tesis de la seccion en una linea: NO es un documento nuevo, es la
    -- columna que le faltaba a la escena. Una novela son sus escenas en orden de relato, y
    -- este vault ya sabe cuales son, en que orden van, que dia ocurren, quien sale, que se
    -- mueve en cada una y que decisiones las bloquean. Lo unico que no sabia es que dice el
    -- texto. Escribirlo en un documento aparte habria creado una segunda verdad sobre la
    -- misma historia, que es el fallo que este vault lleva cinco secciones evitando.
    --
    -- NINGUNA SENTENCIA DE ESTE CUERPO ALTERA NADA, A PROPOSITO. isCreateOnly() quita los
    -- comentarios y rechaza cualquier cuerpo con ALTER, DROP, INSERT, UPDATE, DELETE o
    -- REPLACE, y una migracion asi pierde LOS DOS caminos de reparacion. Eso significa,
    -- literalmente, que la prosa NO PUEDE ser una columna nueva de world_scenes: tiene que
    -- ser una tabla con scene_id de clave. Y tampoco hay ninguna clave foranea, por lo de
    -- siempre: foreign_keys esta ON, un REFERENCES sin accion declarada usa NO ACTION y
    -- ABORTA el borrado del padre, asi que "corta esta escena" se convertiria en un error
    -- de base de datos. La propiedad la impone deleteScene() en su transaccion.

    -- La prosa de una escena. Tabla aparte tambien por una segunda razon, independiente de
    -- la migracion y igual de decisiva: una novela de 120 000 palabras son unos 700 KB, y
    -- listScenes() la arrastraria en CADA lectura -- la vista de escenas, el feed de
    -- preguntas, los carriles de los arcos y la cadena de dias. Misma regla que ya siguen
    -- los mapas con sus bytes: el cuerpo nunca viaja con la lista.
    CREATE TABLE world_scene_text (
      scene_id     TEXT PRIMARY KEY,
      text         TEXT,
      -- Desnormalizado a proposito: es lo unico que la espina, el objetivo y el contador
      -- del dia necesitan, y calcularlo exigiria leer el texto entero de todas las escenas
      -- para pintar una lista.
      word_count   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    -- Un capitulo es DONDE EMPIEZA un capitulo. No hay tabla de capitulos con su propio
    -- orden, y no es pereza: seria un segundo eje de ordenacion junto a narrative_order, y
    -- los dos discreparian el primer dia que alguien mueva una escena. De ese orden ya
    -- cuelgan la cadena de dias y los carriles de los arcos, que exigen que sea denso y
    -- total. Aqui el capitulo se mueve moviendo sus escenas, que es lo que un autor hace
    -- de todas formas.
    CREATE TABLE world_chapter_breaks (
      scene_id   TEXT PRIMARY KEY,
      title      TEXT,
      epigraph   TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Cuantas palabras habia al cerrar cada dia. El delta se calcula contra el dia anterior
    -- y PUEDE SER NEGATIVO: un dia de podar es un dia de trabajo, y un contador que solo
    -- sabe sumar convierte cortar en un castigo.
    CREATE TABLE world_word_days (
      day          TEXT PRIMARY KEY,
      total_words  INTEGER NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
  `,
  },
  {
    version: 101,
    up: /* sql */ `
    -- Varios libros en un mundo, e instantaneas de una escena. Las dos cosas que le
    -- faltaban al manuscrito, y ninguna de las dos necesita tocar el orden del relato.
    --
    -- CREATE-only y sin claves foraneas, por lo mismo que la 100: isCreateOnly() rechaza
    -- ALTER y DELETE, y foreign_keys esta ON, asi que un REFERENCES sin accion abortaria
    -- el borrado de la escena. La propiedad la impone deleteScene() en su transaccion.

    -- UN LIBRO ES DONDE EMPIEZA UN LIBRO. Exactamente la misma forma que
    -- world_chapter_breaks, y por exactamente la misma razon: una tabla de manuscritos con
    -- su propio orden, mas una tabla de pertenencia de la escena, serian un SEGUNDO EJE DE
    -- ORDENACION junto a narrative_order -- del que ya cuelgan la cadena de dias, los
    -- carriles de los arcos y la escena limite de las preguntas abiertas -- y los dos
    -- discreparian el primer dia que alguien moviera una escena.
    --
    -- El coste es que los libros son tramos CONTIGUOS del orden global, que es exactamente
    -- lo que es un estante. Mover un libro es mover sus escenas, igual que un capitulo.
    -- Y la cadena de dias sigue siendo global a proposito: en una trilogia de un mismo
    -- mundo el dia 4120 es el dia 4120, y un libro que abre otra era ancla su primera
    -- escena.
    CREATE TABLE world_manuscript_starts (
      scene_id     TEXT PRIMARY KEY,
      title        TEXT,
      subtitle     TEXT,
      -- Palabras a las que aspira ESTE libro. Sin objetivo no hay barra de avance, y una
      -- barra sobre el total del mundo no significa nada cuando hay tres libros.
      target_words INTEGER,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    -- Lo que la escena decia antes de una reescritura. Sin id de contenido: dos
    -- instantaneas del mismo texto en dos momentos son dos instantaneas, y colapsarlas
    -- perderia justo la que se quiere recuperar.
    CREATE TABLE world_scene_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      scene_id    TEXT NOT NULL,
      text        TEXT,
      word_count  INTEGER NOT NULL DEFAULT 0,
      -- manual | shrink. La segunda la toma el propio guardado cuando el texto encoge de
      -- golpe, que es cuando nadie se acuerda de pulsar nada.
      reason      TEXT NOT NULL DEFAULT 'manual',
      created_at  TEXT NOT NULL
    );
    CREATE INDEX idx_world_scene_snapshots_scene ON world_scene_snapshots(scene_id, created_at DESC);
    `,
  },
  {
    version: 102,
    up: /* sql */ `
      -- The world chat is authored working context: its questions, answers and explicit
      -- focus must survive reopening the vault just like study and database chats.
      CREATE TABLE world_chat_conversations (
        id             TEXT PRIMARY KEY,
        title          TEXT NOT NULL,
        selection_json TEXT NOT NULL DEFAULT '{"scope":"auto","entryKeys":[],"keepFocus":false}',
        focus_json     TEXT NOT NULL DEFAULT '[]',
        messages_json  TEXT NOT NULL DEFAULT '[]',
        model_json     TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX idx_world_chat_conversations_updated
        ON world_chat_conversations(updated_at DESC);
    `,
  },
  {
    version: 103,
    up: /* sql */ `
      -- Character conversations are normalised because generated images are binary
      -- children of one precise answer. This makes deleting a conversation (including
      -- every linked image) an explicit, testable transaction instead of JSON surgery.
      CREATE TABLE character_chat_conversations (
        id            TEXT PRIMARY KEY,
        person_id     TEXT NOT NULL,
        title         TEXT NOT NULL,
        image_enabled INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_character_chat_conversations_person
        ON character_chat_conversations(person_id, updated_at DESC);

      CREATE TABLE character_chat_messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        seq             INTEGER NOT NULL,
        role            TEXT NOT NULL CHECK (role IN ('author', 'character')),
        content         TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        UNIQUE(conversation_id, seq)
      );
      CREATE INDEX idx_character_chat_messages_conversation
        ON character_chat_messages(conversation_id, seq);

      CREATE TABLE character_chat_images (
        image_id        TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        message_id      TEXT NOT NULL UNIQUE,
        mime_type       TEXT NOT NULL,
        bytes           INTEGER NOT NULL,
        blob            BLOB NOT NULL,
        thumbnail_blob  BLOB,
        prompt          TEXT,
        provider        TEXT,
        model           TEXT,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX idx_character_chat_images_conversation
        ON character_chat_images(conversation_id);
    `,
  },
  {
    version: 104,
    up: /* sql */ `
      -- Full-resolution originals and compact derivatives have independent formats.
      -- Keeping their MIME types separate lets every viewer use the untouched source
      -- while lists decode only a small thumbnail.
      ALTER TABLE person_portraits ADD COLUMN thumbnail BLOB;
      ALTER TABLE person_portraits ADD COLUMN thumbnail_mime TEXT;

      ALTER TABLE world_images ADD COLUMN thumbnail BLOB;
      ALTER TABLE world_images ADD COLUMN thumbnail_mime_type TEXT;

      ALTER TABLE decorative_images ADD COLUMN thumbnail_mime_type TEXT;
      ALTER TABLE decorative_images ADD COLUMN prev_thumbnail_mime_type TEXT;

      ALTER TABLE map_images ADD COLUMN thumbnail_mime_type TEXT;
      ALTER TABLE character_chat_images ADD COLUMN thumbnail_mime_type TEXT;
    `,
  },
  {
    version: 105,
    up: /* sql */ `
      -- An embedding model id is not a provider identity. Two providers can expose
      -- the same name with different revisions or dimensions, so archive retrieval
      -- must pin both just like ideas, passages, notes and work summaries do.
      ALTER TABLE archive_items ADD COLUMN embedding_provider TEXT;

      -- Existing archive vectors predate provider provenance. Mark them stale rather
      -- than comparing them with a query from an unknown/new provider.
      UPDATE archive_items
         SET embedding = NULL,
             embedding_model = NULL,
             embedding_dim = NULL,
             embedding_text_hash = NULL
       WHERE embedding IS NOT NULL;
    `,
  },
  {
    version: 106,
    up: /* sql */ `
      -- Prosopography is additive and deliberately does not use db_cells. Canonical
      -- observations retain source, literal, uncertainty and review state.
      CREATE TABLE prosop_studies (
        study_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        research_question TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        unit_of_analysis TEXT NOT NULL DEFAULT 'person',
        temporal_scope TEXT NOT NULL DEFAULT '',
        date_start_sort INTEGER,
        date_end_sort INTEGER,
        geographic_scope TEXT NOT NULL DEFAULT '',
        population_definition TEXT NOT NULL DEFAULT '',
        sampling_strategy TEXT NOT NULL DEFAULT '',
        expected_population INTEGER,
        source_strategy TEXT NOT NULL DEFAULT '',
        known_biases TEXT NOT NULL DEFAULT '',
        living_people_policy TEXT NOT NULL DEFAULT 'restricted'
          CHECK (living_people_policy IN ('exclude','restricted','allow_with_consent')),
        current_methodology_version_id TEXT,
        current_questionnaire_version_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE prosop_methodology_versions (
        version_id TEXT PRIMARY KEY,
        study_id TEXT NOT NULL,
        version_no INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
        change_summary TEXT NOT NULL DEFAULT '',
        population_definition TEXT NOT NULL DEFAULT '',
        sampling_strategy TEXT NOT NULL DEFAULT '',
        source_strategy TEXT NOT NULL DEFAULT '',
        bias_notes TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published_at TEXT,
        UNIQUE(study_id, version_no)
      );
      CREATE INDEX idx_prosop_methodologies_study ON prosop_methodology_versions(study_id, status);

      CREATE TABLE prosop_population_criteria (
        criterion_id TEXT PRIMARY KEY,
        methodology_version_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('include','exclude','supporting')),
        label TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        rule_json TEXT,
        weight REAL NOT NULL DEFAULT 1,
        required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_prosop_criteria_version ON prosop_population_criteria(methodology_version_id, position);

      CREATE TABLE prosop_population_memberships (
        membership_id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL,
        methodology_version_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','included','excluded','uncertain')),
        decision TEXT NOT NULL DEFAULT '',
        rationale TEXT NOT NULL DEFAULT '',
        decided_by TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(person_id, methodology_version_id)
      );
      CREATE INDEX idx_prosop_memberships_version ON prosop_population_memberships(methodology_version_id, status);

      CREATE TABLE prosop_membership_assessments (
        assessment_id TEXT PRIMARY KEY,
        membership_id TEXT NOT NULL,
        criterion_id TEXT NOT NULL,
        result TEXT NOT NULL CHECK (result IN ('met','not_met','unknown','not_applicable')),
        factoid_id TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(membership_id, criterion_id)
      );

      CREATE TABLE prosop_questionnaire_versions (
        questionnaire_version_id TEXT PRIMARY KEY,
        study_id TEXT NOT NULL,
        version_no INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
        title TEXT NOT NULL,
        change_summary TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published_at TEXT,
        UNIQUE(study_id, version_no)
      );
      CREATE INDEX idx_prosop_questionnaires_study ON prosop_questionnaire_versions(study_id, status);

      CREATE TABLE prosop_variables (
        variable_id TEXT PRIMARY KEY,
        study_id TEXT NOT NULL,
        key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        retired_at TEXT,
        UNIQUE(study_id, key)
      );

      CREATE TABLE prosop_vocabularies (
        vocabulary_id TEXT PRIMARY KEY,
        study_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        scope_notes TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '1',
        external_uri TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE prosop_vocabulary_terms (
        term_id TEXT PRIMARY KEY,
        vocabulary_id TEXT NOT NULL,
        parent_term_id TEXT,
        code TEXT NOT NULL,
        preferred_label TEXT NOT NULL,
        definition TEXT NOT NULL DEFAULT '',
        valid_from TEXT,
        valid_to TEXT,
        external_uri TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated')),
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(vocabulary_id, code)
      );
      CREATE INDEX idx_prosop_terms_vocabulary ON prosop_vocabulary_terms(vocabulary_id, parent_term_id, position);

      CREATE TABLE prosop_term_labels (
        label_id TEXT PRIMARY KEY,
        term_id TEXT NOT NULL,
        label TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'variant',
        created_at TEXT NOT NULL
      );

      CREATE TABLE prosop_variable_revisions (
        revision_id TEXT PRIMARY KEY,
        variable_id TEXT NOT NULL,
        questionnaire_version_id TEXT NOT NULL,
        label TEXT NOT NULL,
        question TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        value_type TEXT NOT NULL CHECK (value_type IN ('text','number','boolean','date','term','person','place','organization','event')),
        cardinality TEXT NOT NULL DEFAULT 'one' CHECK (cardinality IN ('one','many')),
        unit TEXT,
        vocabulary_id TEXT,
        applicability_json TEXT,
        missing_reasons_json TEXT NOT NULL DEFAULT '[]',
        analysis_policy_json TEXT NOT NULL DEFAULT '{}',
        sensitivity TEXT NOT NULL DEFAULT 'ordinary' CHECK (sensitivity IN ('ordinary','sensitive','restricted')),
        instructions TEXT NOT NULL DEFAULT '',
        examples_json TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(variable_id, questionnaire_version_id)
      );
      CREATE INDEX idx_prosop_revisions_questionnaire ON prosop_variable_revisions(questionnaire_version_id, position);

      CREATE TABLE prosop_person_profiles (
        person_id TEXT PRIMARY KEY,
        identity_status TEXT NOT NULL DEFAULT 'provisional',
        review_status TEXT NOT NULL DEFAULT 'unreviewed',
        preferred_name_basis TEXT NOT NULL DEFAULT '',
        privacy_status TEXT NOT NULL DEFAULT 'ordinary',
        completeness_cache REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE prosop_sources (
        source_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        citation TEXT NOT NULL DEFAULT '',
        repository TEXT NOT NULL DEFAULT '',
        reference_code TEXT NOT NULL DEFAULT '',
        date_display TEXT,
        date_start_sort INTEGER,
        date_end_sort INTEGER,
        description TEXT NOT NULL DEFAULT '',
        coverage_notes TEXT NOT NULL DEFAULT '',
        reliability_notes TEXT NOT NULL DEFAULT '',
        access_status TEXT NOT NULL DEFAULT 'open' CHECK (access_status IN ('open','restricted','embargoed')),
        rights_notes TEXT NOT NULL DEFAULT '',
        target_vault_id TEXT,
        target_kind TEXT,
        target_id TEXT,
        target_label_snapshot TEXT,
        url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_prosop_sources_title ON prosop_sources(title);

      CREATE TABLE prosop_source_assessments (
        assessment_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        variable_id TEXT,
        scope_note TEXT NOT NULL DEFAULT '',
        reliability_status TEXT NOT NULL DEFAULT 'unassessed'
          CHECK (reliability_status IN ('unassessed','low','medium','high','disputed')),
        representativeness_note TEXT NOT NULL DEFAULT '',
        known_bias_note TEXT NOT NULL DEFAULT '',
        rationale TEXT NOT NULL DEFAULT '',
        assessed_by TEXT,
        assessed_at TEXT
      );

      CREATE TABLE prosop_source_segments (
        segment_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        locator_display TEXT NOT NULL,
        locator_json TEXT NOT NULL DEFAULT '{}',
        quoted_text TEXT NOT NULL DEFAULT '',
        transcription_status TEXT NOT NULL DEFAULT 'literal',
        language TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_prosop_segments_source ON prosop_source_segments(source_id);

      CREATE TABLE prosop_capture_templates (
        template_id TEXT PRIMARY KEY,
        study_id TEXT NOT NULL,
        name TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        questionnaire_version_id TEXT,
        fields_json TEXT NOT NULL DEFAULT '[]',
        mapping_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE prosop_capture_batches (
        batch_id TEXT PRIMARY KEY,
        source_id TEXT,
        template_id TEXT,
        questionnaire_version_id TEXT,
        file_name TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'staging',
        row_count INTEGER NOT NULL DEFAULT 0,
        accepted_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE prosop_capture_rows (
        capture_row_id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        row_no INTEGER NOT NULL,
        locator_display TEXT,
        raw_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error_json TEXT,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        UNIQUE(batch_id, row_no)
      );

      CREATE TABLE prosop_proposals (
        proposal_id TEXT PRIMARY KEY,
        proposal_kind TEXT NOT NULL,
        source_id TEXT,
        source_segment_id TEXT,
        capture_row_id TEXT,
        target_kind TEXT NOT NULL,
        target_id TEXT,
        payload_json TEXT NOT NULL,
        confidence REAL,
        rationale TEXT NOT NULL DEFAULT '',
        producer_kind TEXT NOT NULL,
        producer_id TEXT NOT NULL,
        questionnaire_version_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','superseded')),
        created_at TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at TEXT,
        decision_note TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_prosop_proposals_status ON prosop_proposals(status, proposal_kind, created_at);

      CREATE TABLE prosop_factoids (
        factoid_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_segment_id TEXT NOT NULL,
        capture_row_id TEXT,
        factoid_kind TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','proposed','reviewed','rejected','superseded')),
        extraction_certainty TEXT NOT NULL DEFAULT 'unknown',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_prosop_factoids_source ON prosop_factoids(source_id, source_segment_id);

      CREATE TABLE prosop_name_attestations (
        attestation_id TEXT PRIMARY KEY,
        source_id TEXT,
        source_segment_id TEXT,
        factoid_id TEXT,
        literal_name TEXT NOT NULL,
        normalized_search_name TEXT NOT NULL,
        person_id TEXT,
        context TEXT NOT NULL DEFAULT '',
        role_or_title TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT '',
        identity_status TEXT NOT NULL DEFAULT 'unresolved',
        certainty TEXT NOT NULL DEFAULT 'unknown',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_prosop_attestations_search ON prosop_name_attestations(normalized_search_name);

      CREATE TABLE prosop_identity_hypotheses (
        hypothesis_id TEXT PRIMARY KEY,
        left_kind TEXT NOT NULL,
        left_id TEXT NOT NULL,
        right_kind TEXT NOT NULL,
        right_id TEXT NOT NULL,
        relation TEXT NOT NULL CHECK (relation IN ('same_as','different_from')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','superseded')),
        score REAL,
        rationale TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at TEXT
      );

      CREATE TABLE prosop_identity_decision_evidence (
        id TEXT PRIMARY KEY,
        hypothesis_id TEXT NOT NULL,
        factoid_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('supports','contradicts','context')),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE prosop_authority_ids (
        authority_id TEXT PRIMARY KEY,
        entity_kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        scheme TEXT NOT NULL,
        external_id TEXT NOT NULL,
        uri TEXT,
        label_snapshot TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        factoid_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(entity_kind, entity_id, scheme, external_id)
      );

      CREATE TABLE prosop_organizations (
        organization_id TEXT PRIMARY KEY,
        preferred_name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT '',
        date_start TEXT,
        date_start_sort INTEGER,
        date_end TEXT,
        date_end_sort INTEGER,
        place_id TEXT,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE prosop_organization_names (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'variant',
        language TEXT NOT NULL DEFAULT '',
        valid_from TEXT,
        valid_to TEXT
      );

      CREATE TABLE prosop_statements (
        statement_id TEXT PRIMARY KEY,
        factoid_id TEXT NOT NULL,
        variable_id TEXT,
        variable_revision_id TEXT,
        statement_type TEXT NOT NULL,
        value_kind TEXT NOT NULL CHECK (value_kind IN ('text','number','boolean','date','term','person','place','organization','event')),
        literal_value TEXT NOT NULL DEFAULT '',
        value_text TEXT,
        value_number REAL,
        value_boolean INTEGER,
        value_date_display TEXT,
        value_date_start_sort INTEGER,
        value_date_end_sort INTEGER,
        value_term_id TEXT,
        value_person_id TEXT,
        value_place_id TEXT,
        value_organization_id TEXT,
        value_event_id TEXT,
        unit TEXT,
        negated INTEGER NOT NULL DEFAULT 0 CHECK (negated IN (0,1)),
        source_modality TEXT NOT NULL DEFAULT 'asserted',
        reading_certainty TEXT NOT NULL DEFAULT 'unknown',
        source_assertion_certainty TEXT NOT NULL DEFAULT 'unknown',
        interpretation_certainty TEXT NOT NULL DEFAULT 'unknown',
        temporal_precision TEXT,
        accuracy_status TEXT NOT NULL DEFAULT 'unassessed',
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','proposed','reviewed','rejected','superseded')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_prosop_statements_factoid ON prosop_statements(factoid_id);
      CREATE INDEX idx_prosop_statements_variable ON prosop_statements(variable_id, status);

      CREATE TABLE prosop_statement_entities (
        id TEXT PRIMARY KEY,
        statement_id TEXT NOT NULL,
        entity_kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        role TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_prosop_statement_entities_target ON prosop_statement_entities(entity_kind, entity_id);

      CREATE TABLE prosop_resolutions (
        resolution_id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL,
        variable_id TEXT NOT NULL,
        resolution_kind TEXT NOT NULL,
        resolved_value_json TEXT,
        rationale TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE prosop_resolution_statements (
        resolution_id TEXT NOT NULL,
        statement_id TEXT NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY(resolution_id, statement_id)
      );

      CREATE TABLE prosop_missing_values (
        missing_id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL,
        variable_id TEXT NOT NULL,
        questionnaire_version_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        source_scope_json TEXT NOT NULL DEFAULT '{}',
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(person_id, variable_id, questionnaire_version_id)
      );

      CREATE TABLE prosop_cohorts (
        cohort_id TEXT PRIMARY KEY,
        study_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL CHECK (kind IN ('dynamic','frozen')),
        filter_json TEXT NOT NULL DEFAULT '{"conjunction":"and","rules":[]}',
        methodology_version_id TEXT NOT NULL,
        questionnaire_version_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        frozen_at TEXT
      );

      CREATE TABLE prosop_cohort_members (
        cohort_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        membership_snapshot_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        PRIMARY KEY(cohort_id, person_id)
      );

      CREATE TABLE prosop_analysis_definitions (
        analysis_id TEXT PRIMARY KEY,
        study_id TEXT NOT NULL,
        title TEXT NOT NULL,
        analysis_kind TEXT NOT NULL,
        cohort_ids_json TEXT NOT NULL DEFAULT '[]',
        projection_json TEXT NOT NULL,
        filter_json TEXT NOT NULL DEFAULT '{}',
        questionnaire_version_id TEXT NOT NULL,
        source_cutoff TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE prosop_analysis_runs (
        run_id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        input_fingerprint TEXT NOT NULL,
        population_count INTEGER NOT NULL,
        included_count INTEGER NOT NULL,
        missing_summary_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_prosop_analysis_runs_definition ON prosop_analysis_runs(analysis_id, created_at);

      CREATE TABLE prosop_network_layers (
        layer_id TEXT PRIMARY KEY,
        study_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        derivation_rule_json TEXT,
        directionality TEXT NOT NULL DEFAULT 'undirected',
        weight_policy TEXT NOT NULL DEFAULT 'count',
        color TEXT NOT NULL DEFAULT '#2563eb',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE prosop_network_edges (
        edge_id TEXT PRIMARY KEY,
        layer_id TEXT NOT NULL,
        source_person_id TEXT NOT NULL,
        target_person_id TEXT NOT NULL,
        relation_term_id TEXT,
        date_display TEXT,
        date_start_sort INTEGER,
        date_end_sort INTEGER,
        weight REAL NOT NULL DEFAULT 1,
        origin TEXT NOT NULL CHECK (origin IN ('explicit','derived','hypothesis')),
        derivation_fingerprint TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_prosop_edges_layer ON prosop_network_edges(layer_id, origin, status);
      CREATE INDEX idx_prosop_edges_source ON prosop_network_edges(source_person_id);
      CREATE INDEX idx_prosop_edges_target ON prosop_network_edges(target_person_id);

      CREATE TABLE prosop_network_edge_factoids (
        edge_id TEXT NOT NULL,
        factoid_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'supports',
        PRIMARY KEY(edge_id, factoid_id)
      );

      CREATE TABLE note_links (
        link_id TEXT PRIMARY KEY,
        nodus_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_vault_id TEXT,
        relation_kind TEXT NOT NULL DEFAULT 'about',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_note_links_target ON note_links(target_kind, target_id);

      CREATE TABLE prosop_audit_log (
        audit_id TEXT PRIMARY KEY,
        entity_kind TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        reason TEXT NOT NULL DEFAULT '',
        actor TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_prosop_audit_entity ON prosop_audit_log(entity_kind, entity_id, created_at);
    `,
  },
  {
    version: 107,
    up: /* sql */ `
      -- Fuentes primarias: additive archival description, digital representations,
      -- versioned text, citable excerpts and reviewable derivations. archive_items
      -- remains the compatibility record; none of its legacy columns are removed.
      CREATE TABLE archive_repositories (
        repository_id    TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        short_name       TEXT,
        identifier       TEXT,
        address          TEXT,
        website_url      TEXT,
        catalog_url      TEXT,
        country_code     TEXT,
        contact_notes    TEXT,
        access_notes     TEXT,
        citation_template TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX idx_archive_repositories_name ON archive_repositories(name);
      CREATE INDEX idx_archive_repositories_identifier ON archive_repositories(identifier);

      CREATE TABLE archive_description_units (
        unit_id                              TEXT PRIMARY KEY,
        repository_id                       TEXT REFERENCES archive_repositories(repository_id) ON DELETE RESTRICT,
        parent_unit_id                       TEXT REFERENCES archive_description_units(unit_id) ON DELETE RESTRICT,
        level                                TEXT NOT NULL,
        local_level_label                    TEXT,
        reference_code                       TEXT,
        title                                TEXT NOT NULL,
        title_type                           TEXT NOT NULL DEFAULT 'unknown',
        date_display                         TEXT,
        date_start_sort                      TEXT,
        date_end_sort                        TEXT,
        date_certainty                       TEXT NOT NULL DEFAULT 'unknown',
        creator_display                      TEXT,
        extent_display                       TEXT,
        scope_content                        TEXT,
        arrangement                          TEXT,
        administrative_biographical_history  TEXT,
        custodial_history                    TEXT,
        acquisition_info                     TEXT,
        access_conditions                    TEXT,
        reproduction_conditions              TEXT,
        language_codes_json                  TEXT NOT NULL DEFAULT '[]',
        script_codes_json                    TEXT NOT NULL DEFAULT '[]',
        physical_characteristics             TEXT,
        finding_aids                         TEXT,
        related_units                        TEXT,
        source_catalog_url                   TEXT,
        position                             INTEGER NOT NULL DEFAULT 0,
        metadata_json                        TEXT NOT NULL DEFAULT '{}',
        created_at                           TEXT NOT NULL,
        updated_at                           TEXT NOT NULL,
        CHECK (parent_unit_id IS NULL OR parent_unit_id <> unit_id),
        CHECK (level <> 'local' OR length(trim(local_level_label)) > 0)
      );
      CREATE INDEX idx_archive_units_parent_position ON archive_description_units(parent_unit_id, position);
      CREATE INDEX idx_archive_units_repository_reference ON archive_description_units(repository_id, reference_code);
      CREATE INDEX idx_archive_units_level ON archive_description_units(level);
      CREATE INDEX idx_archive_units_dates ON archive_description_units(date_start_sort, date_end_sort);
      CREATE INDEX idx_archive_units_title ON archive_description_units(title COLLATE NOCASE);

      CREATE TABLE archive_item_units (
        item_id       TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        unit_id       TEXT NOT NULL REFERENCES archive_description_units(unit_id) ON DELETE CASCADE,
        relation_kind TEXT NOT NULL DEFAULT 'describes',
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        PRIMARY KEY (item_id, unit_id, relation_kind)
      );
      CREATE INDEX idx_archive_item_units_unit ON archive_item_units(unit_id, position);
      CREATE UNIQUE INDEX idx_archive_item_primary_unit
        ON archive_item_units(item_id) WHERE relation_kind = 'describes';

      CREATE TABLE archive_capture_sessions (
        session_id         TEXT PRIMARY KEY,
        repository_id      TEXT REFERENCES archive_repositories(repository_id) ON DELETE SET NULL,
        title              TEXT NOT NULL,
        session_kind       TEXT NOT NULL DEFAULT 'other',
        started_on         TEXT,
        ended_on           TEXT,
        researcher         TEXT,
        device             TEXT,
        fonds_scope        TEXT,
        reference_scope    TEXT,
        reproduction_terms TEXT,
        naming_pattern     TEXT,
        notes              TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE INDEX idx_archive_capture_sessions_repository ON archive_capture_sessions(repository_id, started_on);

      CREATE TABLE archive_item_profiles (
        item_id                  TEXT PRIMARY KEY REFERENCES archive_items(item_id) ON DELETE CASCADE,
        date_certainty           TEXT NOT NULL DEFAULT 'unknown',
        access_status            TEXT NOT NULL DEFAULT 'unknown',
        embargo_until            TEXT,
        rights_statement         TEXT,
        reproduction_conditions TEXT,
        sensitivity              TEXT NOT NULL DEFAULT 'normal',
        processing_status        TEXT NOT NULL DEFAULT 'imported',
        description_status       TEXT NOT NULL DEFAULT 'minimal',
        analysis_status          TEXT NOT NULL DEFAULT 'not_started',
        citation_status          TEXT NOT NULL DEFAULT 'not_ready',
        capture_session_id       TEXT REFERENCES archive_capture_sessions(session_id) ON DELETE SET NULL,
        metadata_json            TEXT NOT NULL DEFAULT '{}',
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL
      );
      CREATE INDEX idx_archive_item_profiles_attention
        ON archive_item_profiles(description_status, analysis_status, citation_status);
      CREATE INDEX idx_archive_item_profiles_access
        ON archive_item_profiles(access_status, sensitivity, embargo_until);

      CREATE TABLE archive_item_files (
        file_id               TEXT PRIMARY KEY,
        item_id               TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        parent_file_id        TEXT REFERENCES archive_item_files(file_id) ON DELETE RESTRICT,
        role                  TEXT NOT NULL,
        version_no            INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
        sequence_no           INTEGER NOT NULL DEFAULT 0,
        page_label            TEXT,
        original_file_name    TEXT,
        mime_type             TEXT,
        byte_size             INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
        content_blob          BLOB,
        external_path         TEXT,
        content_hash          TEXT,
        hash_algorithm        TEXT,
        transformation_json   TEXT,
        capture_metadata_json TEXT,
        created_by            TEXT,
        created_at            TEXT NOT NULL,
        verified_at           TEXT,
        verification_status   TEXT NOT NULL DEFAULT 'pending',
        superseded_at         TEXT,
        CHECK (content_blob IS NULL OR (content_hash IS NOT NULL AND hash_algorithm = 'sha256')),
        CHECK (role <> 'master' OR parent_file_id IS NULL),
        CHECK (role <> 'derivative' OR (parent_file_id IS NOT NULL AND transformation_json IS NOT NULL))
      );
      CREATE INDEX idx_archive_item_files_item_sequence ON archive_item_files(item_id, sequence_no, version_no);
      CREATE INDEX idx_archive_item_files_hash ON archive_item_files(content_hash);
      CREATE INDEX idx_archive_item_files_parent ON archive_item_files(parent_file_id);
      CREATE UNIQUE INDEX idx_archive_item_file_version
        ON archive_item_files(item_id, role, sequence_no, version_no);

      CREATE TABLE archive_text_versions (
        text_version_id       TEXT PRIMARY KEY,
        item_id               TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        file_id               TEXT REFERENCES archive_item_files(file_id) ON DELETE SET NULL,
        parent_version_id     TEXT REFERENCES archive_text_versions(text_version_id) ON DELETE SET NULL,
        kind                  TEXT NOT NULL,
        language_code         TEXT,
        content               TEXT NOT NULL,
        status                TEXT NOT NULL DEFAULT 'automatic',
        engine                TEXT,
        model                 TEXT,
        confidence            REAL,
        editorial_conventions TEXT,
        created_by            TEXT,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        reviewed_at           TEXT
      );
      CREATE INDEX idx_archive_text_versions_item ON archive_text_versions(item_id, kind, created_at);
      CREATE INDEX idx_archive_text_versions_file ON archive_text_versions(file_id);

      CREATE TABLE archive_text_segments (
        segment_id      TEXT PRIMARY KEY,
        text_version_id TEXT NOT NULL REFERENCES archive_text_versions(text_version_id) ON DELETE CASCADE,
        file_id         TEXT REFERENCES archive_item_files(file_id) ON DELETE SET NULL,
        sequence_no     INTEGER NOT NULL DEFAULT 0,
        page_label      TEXT,
        start_offset    INTEGER,
        end_offset      INTEGER,
        content         TEXT NOT NULL,
        bbox_json       TEXT,
        time_start_ms   INTEGER,
        time_end_ms     INTEGER,
        confidence      REAL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        CHECK (start_offset IS NULL OR (start_offset >= 0 AND end_offset > start_offset)),
        CHECK (time_start_ms IS NULL OR (time_start_ms >= 0 AND time_end_ms > time_start_ms))
      );
      CREATE INDEX idx_archive_text_segments_version ON archive_text_segments(text_version_id, sequence_no);
      CREATE INDEX idx_archive_text_segments_file ON archive_text_segments(file_id, sequence_no);

      CREATE TABLE archive_excerpts (
        excerpt_id       TEXT PRIMARY KEY,
        item_id          TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        file_id          TEXT REFERENCES archive_item_files(file_id) ON DELETE SET NULL,
        text_version_id  TEXT REFERENCES archive_text_versions(text_version_id) ON DELETE SET NULL,
        segment_id       TEXT REFERENCES archive_text_segments(segment_id) ON DELETE SET NULL,
        locator_display  TEXT NOT NULL,
        locator_json     TEXT NOT NULL DEFAULT '{}',
        quoted_text      TEXT,
        language_code    TEXT,
        description      TEXT,
        review_status    TEXT NOT NULL DEFAULT 'unreviewed',
        created_by       TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX idx_archive_excerpts_item ON archive_excerpts(item_id, created_at);
      CREATE INDEX idx_archive_excerpts_segment ON archive_excerpts(segment_id);

      CREATE TABLE archive_entity_proposals (
        proposal_id      TEXT PRIMARY KEY,
        item_id          TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        excerpt_id       TEXT REFERENCES archive_excerpts(excerpt_id) ON DELETE SET NULL,
        proposal_kind    TEXT NOT NULL,
        payload_json     TEXT NOT NULL,
        matched_target_id TEXT,
        status           TEXT NOT NULL DEFAULT 'pending',
        confidence       REAL,
        rationale        TEXT,
        source_engine    TEXT,
        source_model     TEXT,
        fingerprint      TEXT NOT NULL,
        created_at       TEXT NOT NULL,
        reviewed_at      TEXT,
        reviewed_by      TEXT,
        decision_note    TEXT
      );
      CREATE UNIQUE INDEX idx_archive_proposals_fingerprint ON archive_entity_proposals(fingerprint);
      CREATE INDEX idx_archive_proposals_queue ON archive_entity_proposals(status, proposal_kind, created_at);
      CREATE INDEX idx_archive_proposals_item ON archive_entity_proposals(item_id, status);

      CREATE TABLE archive_source_analyses (
        analysis_id         TEXT PRIMARY KEY,
        item_id             TEXT NOT NULL UNIQUE REFERENCES archive_items(item_id) ON DELETE CASCADE,
        origin_notes        TEXT,
        purpose_audience    TEXT,
        content_form        TEXT,
        perspective_bias    TEXT,
        silences_limits     TEXT,
        authenticity_notes  TEXT,
        representativeness  TEXT,
        corroboration       TEXT,
        questions           TEXT,
        status              TEXT NOT NULL DEFAULT 'not_started',
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );

      CREATE TABLE archive_place_mentions (
        mention_id     TEXT PRIMARY KEY,
        item_id        TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        excerpt_id     TEXT REFERENCES archive_excerpts(excerpt_id) ON DELETE SET NULL,
        place_id       TEXT REFERENCES places(place_id) ON DELETE SET NULL,
        original_label TEXT NOT NULL,
        role           TEXT NOT NULL,
        certainty      REAL,
        status         TEXT NOT NULL DEFAULT 'unresolved',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX idx_archive_place_mentions_item ON archive_place_mentions(item_id, status);
      CREATE INDEX idx_archive_place_mentions_place ON archive_place_mentions(place_id);

      CREATE TABLE archive_person_mentions (
        mention_id      TEXT PRIMARY KEY,
        item_id         TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        excerpt_id      TEXT REFERENCES archive_excerpts(excerpt_id) ON DELETE SET NULL,
        person_id       TEXT REFERENCES persons(person_id) ON DELETE SET NULL,
        original_label  TEXT NOT NULL,
        role            TEXT,
        certainty       REAL,
        identity_status TEXT NOT NULL DEFAULT 'unresolved_mention',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX idx_archive_person_mentions_item ON archive_person_mentions(item_id, identity_status);
      CREATE INDEX idx_archive_person_mentions_person ON archive_person_mentions(person_id);

      CREATE TABLE entity_resolutions (
        resolution_id   TEXT PRIMARY KEY,
        entity_kind     TEXT NOT NULL,
        source_entity_id TEXT NOT NULL,
        target_entity_id TEXT,
        decision        TEXT NOT NULL,
        rationale       TEXT,
        status          TEXT NOT NULL DEFAULT 'active',
        created_by      TEXT,
        created_at      TEXT NOT NULL,
        reverted_at     TEXT
      );
      CREATE INDEX idx_entity_resolutions_source ON entity_resolutions(entity_kind, source_entity_id, status);
      CREATE INDEX idx_entity_resolutions_target ON entity_resolutions(entity_kind, target_entity_id, status);

      -- Prosopography migration 106 owns the shared note_links base table.
      -- Primary Sources extends that cross-vault graph with an optional citable
      -- excerpt without replacing or narrowing the existing relation contract.
      ALTER TABLE note_links
        ADD COLUMN excerpt_id TEXT REFERENCES archive_excerpts(excerpt_id) ON DELETE SET NULL;
      CREATE UNIQUE INDEX idx_note_links_unique
        ON note_links(nodus_id, target_kind, target_id, relation_kind);
      CREATE INDEX idx_note_links_excerpt ON note_links(excerpt_id);

      CREATE TABLE archive_integrity_checks (
        check_id       TEXT PRIMARY KEY,
        file_id        TEXT NOT NULL REFERENCES archive_item_files(file_id) ON DELETE CASCADE,
        algorithm      TEXT NOT NULL DEFAULT 'sha256',
        expected_hash  TEXT,
        observed_hash  TEXT,
        status         TEXT NOT NULL,
        checked_at     TEXT NOT NULL,
        details        TEXT
      );
      CREATE INDEX idx_archive_integrity_checks_file ON archive_integrity_checks(file_id, checked_at DESC);
      CREATE INDEX idx_archive_integrity_checks_status ON archive_integrity_checks(status, checked_at DESC);

      CREATE TABLE archive_exports (
        export_id             TEXT PRIMARY KEY,
        kind                  TEXT NOT NULL,
        selection_json        TEXT NOT NULL,
        policy_snapshot_json  TEXT NOT NULL,
        included_files        INTEGER NOT NULL DEFAULT 0,
        excluded_files        INTEGER NOT NULL DEFAULT 0,
        manifest_hash         TEXT,
        created_at            TEXT NOT NULL
      );
      CREATE INDEX idx_archive_exports_created ON archive_exports(created_at DESC);
    `,
  },
  {
    version: 108,
    up: /* sql */ `
      -- Compatible enrichment of existing evidence and social/entity tables.
      ALTER TABLE record_evidence ADD COLUMN excerpt_id TEXT REFERENCES archive_excerpts(excerpt_id) ON DELETE SET NULL;
      ALTER TABLE record_evidence ADD COLUMN evidence_role TEXT NOT NULL DEFAULT 'supports';
      ALTER TABLE record_evidence ADD COLUMN certainty REAL;
      ALTER TABLE record_evidence ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unreviewed';
      ALTER TABLE record_evidence ADD COLUMN source_version_id TEXT REFERENCES archive_text_versions(text_version_id) ON DELETE SET NULL;
      ALTER TABLE record_evidence ADD COLUMN created_by TEXT;
      ALTER TABLE record_evidence ADD COLUMN updated_at TEXT;

      ALTER TABLE social_relations ADD COLUMN status TEXT NOT NULL DEFAULT 'proposal';
      ALTER TABLE social_relations ADD COLUMN certainty REAL;
      ALTER TABLE social_relations ADD COLUMN date_display TEXT;
      ALTER TABLE social_relations ADD COLUMN date_start_sort TEXT;
      ALTER TABLE social_relations ADD COLUMN date_end_sort TEXT;
      ALTER TABLE social_relations ADD COLUMN direction TEXT NOT NULL DEFAULT 'directed';

      ALTER TABLE persons ADD COLUMN identity_status TEXT NOT NULL DEFAULT 'confirmed';
      ALTER TABLE persons ADD COLUMN merged_into TEXT REFERENCES persons(person_id) ON DELETE SET NULL;

      ALTER TABLE events ADD COLUMN date_certainty TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE events ADD COLUMN review_status TEXT NOT NULL DEFAULT 'unreviewed';

      ALTER TABLE places ADD COLUMN coordinate_precision TEXT;
      ALTER TABLE places ADD COLUMN historical_context TEXT;
      ALTER TABLE places ADD COLUMN valid_from_display TEXT;
      ALTER TABLE places ADD COLUMN valid_to_display TEXT;
      ALTER TABLE places ADD COLUMN authority_json TEXT;
      ALTER TABLE places ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'normal';
    `,
  },
  {
    version: 109,
    up: /* sql */ `
      -- Backfill a provisional descriptive unit/profile for every legacy item.
      -- IDs are deterministic so the transform is safely idempotent in fixtures.
      INSERT OR IGNORE INTO archive_description_units (
        unit_id, repository_id, parent_unit_id, level, reference_code, title,
        title_type, date_display, date_start_sort, date_end_sort, date_certainty,
        creator_display, extent_display, scope_content, arrangement,
        administrative_biographical_history, custodial_history, acquisition_info,
        access_conditions, reproduction_conditions, language_codes_json,
        script_codes_json, physical_characteristics, finding_aids, related_units,
        source_catalog_url, position, metadata_json, created_at, updated_at
      )
      SELECT
        'legacy_unit_' || item_id, NULL, NULL, 'item', NULL, title,
        'supplied', NULL, NULL, NULL, 'unknown',
        NULL, NULL, description, NULL,
        NULL, NULL, NULL,
        NULL, NULL, '[]',
        '[]', NULL, NULL, NULL,
        NULL, 0, COALESCE(metadata_json, '{}'), created_at, updated_at
      FROM archive_items;

      INSERT OR IGNORE INTO archive_item_units (item_id, unit_id, relation_kind, position, created_at)
      SELECT item_id, 'legacy_unit_' || item_id, 'describes', 0, created_at
      FROM archive_items;

      INSERT OR IGNORE INTO archive_item_profiles (
        item_id, date_certainty, access_status, embargo_until, rights_statement,
        reproduction_conditions, sensitivity, processing_status, description_status,
        analysis_status, citation_status, capture_session_id, metadata_json, created_at, updated_at
      )
      SELECT item_id, 'unknown', 'unknown', NULL, NULL, NULL, 'normal',
        CASE WHEN blob IS NULL THEN 'needs_description' ELSE 'imported' END,
        'minimal', 'not_started', 'not_ready', NULL, '{}', created_at, updated_at
      FROM archive_items;

      INSERT OR IGNORE INTO archive_item_files (
        file_id, item_id, parent_file_id, role, version_no, sequence_no, page_label,
        original_file_name, mime_type, byte_size, content_blob, external_path,
        content_hash, hash_algorithm, transformation_json, capture_metadata_json,
        created_by, created_at, verified_at, verification_status, superseded_at
      )
      SELECT
        'legacy_file_' || item_id, item_id, NULL, 'master', 1, 0, NULL,
        file_name, mime_type, COALESCE(bytes, length(blob), 0), blob, NULL,
        COALESCE(content_hash, 'pending:' || item_id), 'sha256',
        NULL, NULL, 'legacy', created_at, NULL,
        CASE WHEN content_hash IS NULL THEN 'pending' ELSE 'verified' END, NULL
      FROM archive_items
      WHERE blob IS NOT NULL;

      INSERT OR IGNORE INTO archive_text_versions (
        text_version_id, item_id, file_id, parent_version_id, kind, language_code,
        content, status, engine, model, confidence, editorial_conventions, created_by,
        created_at, updated_at, reviewed_at
      )
      SELECT
        'legacy_text_' || item_id, item_id,
        CASE WHEN blob IS NULL THEN NULL ELSE 'legacy_file_' || item_id END,
        NULL, 'ocr', NULL, extracted_text, 'automatic', 'legacy', NULL, NULL, NULL,
        'legacy', created_at, updated_at, NULL
      FROM archive_items
      WHERE COALESCE(extracted_text, '') <> '';

      UPDATE record_evidence
      SET certainty = COALESCE(certainty, confidence),
          updated_at = COALESCE(updated_at, created_at);
    `,
    after: (db) => {
      const rows = db.prepare(
        `SELECT i.item_id, i.blob, i.content_hash
         FROM archive_items i
         JOIN archive_item_files f ON f.file_id = 'legacy_file_' || i.item_id
         WHERE i.blob IS NOT NULL`
      ).all() as Array<{ item_id: string; blob: Buffer; content_hash: string | null }>;
      const updateLegacy = db.prepare(
        `UPDATE archive_item_files
         SET content_hash = ?, hash_algorithm = 'sha256',
             verification_status = CASE WHEN ? IS NULL OR lower(?) = lower(?) THEN 'verified' ELSE 'mismatch' END,
             verified_at = ?
         WHERE file_id = ?`
      );
      const updateItemHash = db.prepare(
        'UPDATE archive_items SET content_hash = COALESCE(content_hash, ?) WHERE item_id = ?'
      );
      const checkedAt = new Date().toISOString();
      for (const row of rows) {
        const observed = createHash('sha256').update(row.blob).digest('hex');
        updateLegacy.run(observed, row.content_hash, row.content_hash, observed, checkedAt, `legacy_file_${row.item_id}`);
        updateItemHash.run(observed, row.item_id);
      }
    },
  },
  {
    version: 110,
    up: /* sql */ `
      -- Reusable archival description profiles. Built-ins are ordinary rows with
      -- stable ids so users can inspect them and future syncs can refer to them.
      CREATE TABLE archive_description_templates (
        template_id          TEXT PRIMARY KEY,
        name                 TEXT NOT NULL,
        document_type        TEXT,
        default_level        TEXT NOT NULL DEFAULT 'item',
        unit_defaults_json   TEXT NOT NULL DEFAULT '{}',
        profile_defaults_json TEXT NOT NULL DEFAULT '{}',
        builtin              INTEGER NOT NULL DEFAULT 0,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL
      );
      CREATE INDEX idx_archive_description_templates_type
        ON archive_description_templates(document_type, name);

      INSERT INTO archive_description_templates (
        template_id, name, document_type, default_level, unit_defaults_json,
        profile_defaults_json, builtin, created_at, updated_at
      ) VALUES
        ('builtin_letter', 'Carta o correspondencia', 'correspondence', 'item',
          '{"titleType":"supplied","extentDisplay":"1 unidad documental"}',
          '{"descriptionStatus":"minimal"}', 1,
          strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('builtin_register', 'Registro o acta', 'register', 'item',
          '{"titleType":"formal"}', '{"descriptionStatus":"minimal"}', 1,
          strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('builtin_photograph', 'Fotografía', 'photograph', 'item',
          '{"titleType":"supplied","physicalCharacteristics":"Descripción del soporte pendiente"}',
          '{"descriptionStatus":"minimal"}', 1,
          strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ('builtin_oral_history', 'Historia oral', 'oral_history', 'item',
          '{"titleType":"supplied"}', '{"descriptionStatus":"provenance_incomplete"}', 1,
          strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `,
  },
  {
    version: 111,
    up: /* sql */ `
      -- Append-only preservation history. File bytes stay in archive_item_files;
      -- this table records why a representation/version/check exists and who or
      -- what produced it without turning the mutable UI state into the audit trail.
      CREATE TABLE archive_audit_log (
        event_id       TEXT PRIMARY KEY,
        item_id        TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        file_id        TEXT REFERENCES archive_item_files(file_id) ON DELETE SET NULL,
        action         TEXT NOT NULL,
        details_json   TEXT NOT NULL DEFAULT '{}',
        created_by     TEXT,
        created_at     TEXT NOT NULL
      );
      CREATE INDEX idx_archive_audit_item
        ON archive_audit_log(item_id, created_at DESC);
      CREATE INDEX idx_archive_audit_file
        ON archive_audit_log(file_id, created_at DESC);
      CREATE INDEX idx_archive_audit_action
        ON archive_audit_log(action, created_at DESC);
    `,
  },
  {
    version: 112,
    up: /* sql */ `
      -- Text and excerpt anchors are archival records. Review state may change, but
      -- a correction is a child version and a changed quotation is a new excerpt.
      CREATE INDEX idx_archive_text_versions_parent
        ON archive_text_versions(parent_version_id, created_at);
      CREATE INDEX idx_archive_excerpts_version
        ON archive_excerpts(text_version_id, created_at);
    `,
    // Trigger bodies contain their own semicolons and therefore deliberately live
    // in `after`, where SQLite parses the whole script rather than the migration
    // recovery statement splitter.
    after: (db) => db.exec(/* sql */ `
        CREATE TRIGGER archive_text_versions_preserve_content
        BEFORE UPDATE OF
          item_id, file_id, parent_version_id, kind, language_code, content, engine,
          model, confidence, editorial_conventions, created_by, created_at
        ON archive_text_versions
        WHEN
          NEW.item_id IS NOT OLD.item_id
          OR NEW.file_id IS NOT OLD.file_id
          OR NEW.parent_version_id IS NOT OLD.parent_version_id
          OR NEW.kind IS NOT OLD.kind
          OR NEW.language_code IS NOT OLD.language_code
          OR NEW.content IS NOT OLD.content
          OR NEW.engine IS NOT OLD.engine
          OR NEW.model IS NOT OLD.model
          OR NEW.confidence IS NOT OLD.confidence
          OR NEW.editorial_conventions IS NOT OLD.editorial_conventions
          OR NEW.created_by IS NOT OLD.created_by
          OR NEW.created_at IS NOT OLD.created_at
        BEGIN
          SELECT RAISE(ABORT, 'archive text versions are immutable; create a child version');
        END;

        CREATE TRIGGER archive_excerpts_preserve_anchor
        BEFORE UPDATE OF
          item_id, file_id, text_version_id, segment_id, locator_display,
          locator_json, quoted_text, language_code, created_by, created_at
        ON archive_excerpts
        WHEN
          NEW.item_id IS NOT OLD.item_id
          OR NEW.file_id IS NOT OLD.file_id
          OR NEW.text_version_id IS NOT OLD.text_version_id
          OR NEW.segment_id IS NOT OLD.segment_id
          OR NEW.locator_display IS NOT OLD.locator_display
          OR NEW.locator_json IS NOT OLD.locator_json
          OR NEW.quoted_text IS NOT OLD.quoted_text
          OR NEW.language_code IS NOT OLD.language_code
          OR NEW.created_by IS NOT OLD.created_by
          OR NEW.created_at IS NOT OLD.created_at
        BEGIN
          SELECT RAISE(ABORT, 'archive excerpt anchors are immutable; create a new excerpt');
        END;
      `),
  },
  {
    version: 113,
    up: /* sql */ `
      -- Human review ledger for AI proposals. Proposal model output is immutable;
      -- edits and decisions are append-only, while one accepted row is the stable
      -- materialization receipt used to make retries idempotent.
      CREATE TABLE archive_proposal_decisions (
        decision_id              TEXT PRIMARY KEY,
        proposal_id              TEXT NOT NULL REFERENCES archive_entity_proposals(proposal_id) ON DELETE CASCADE,
        item_id                  TEXT NOT NULL REFERENCES archive_items(item_id) ON DELETE CASCADE,
        decision                 TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected', 'deferred')),
        original_payload_json    TEXT NOT NULL,
        decided_payload_json     TEXT NOT NULL,
        matched_target_id        TEXT,
        materialized_target_kind TEXT,
        materialized_target_id   TEXT,
        evidence_id              TEXT REFERENCES record_evidence(id) ON DELETE SET NULL,
        evidence_role            TEXT,
        reviewer                 TEXT,
        note                     TEXT,
        created_at               TEXT NOT NULL
      );
      CREATE INDEX idx_archive_proposal_decisions_proposal
        ON archive_proposal_decisions(proposal_id, created_at DESC);
      CREATE INDEX idx_archive_proposal_decisions_item
        ON archive_proposal_decisions(item_id, created_at DESC);
      CREATE UNIQUE INDEX idx_archive_proposal_one_acceptance
        ON archive_proposal_decisions(proposal_id)
        WHERE decision='accepted';
    `,
  },
  {
    version: 114,
    up: /* sql */ `
      -- A toponym is quoted exactly in archive_place_mentions. Resolving it is a
      -- separate, reversible editorial decision: this ledger records the selected
      -- authority candidate, the alternatives that were considered, and the exact
      -- previous place state needed to undo the decision without rewriting evidence.
      CREATE TABLE archive_place_resolution_decisions (
        resolution_id          TEXT PRIMARY KEY,
        place_id               TEXT NOT NULL REFERENCES places(place_id) ON DELETE CASCADE,
        mention_id             TEXT REFERENCES archive_place_mentions(mention_id) ON DELETE SET NULL,
        selected_candidate_json TEXT NOT NULL,
        alternatives_json      TEXT NOT NULL DEFAULT '[]',
        previous_place_json    TEXT NOT NULL,
        coordinate_precision   TEXT,
        historical_context     TEXT,
        valid_from_display     TEXT,
        valid_to_display       TEXT,
        rationale              TEXT,
        status                 TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'reverted')),
        created_by             TEXT,
        created_at             TEXT NOT NULL,
        reverted_at            TEXT
      );
      CREATE INDEX idx_archive_place_resolution_place
        ON archive_place_resolution_decisions(place_id, status, created_at DESC);
      CREATE INDEX idx_archive_place_resolution_mention
        ON archive_place_resolution_decisions(mention_id, created_at DESC);
      CREATE UNIQUE INDEX idx_archive_place_resolution_one_active
        ON archive_place_resolution_decisions(place_id)
        WHERE status='active';
    `,
  },
  {
    version: 115,
    up: /* sql */ `
      -- Primary-source notes reuse the shared Markdown note body while keeping
      -- documentary type, workflow state and collection as an orthogonal overlay.
      CREATE TABLE primary_source_note_profiles (
        note_id       TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
        note_type     TEXT NOT NULL DEFAULT 'observation'
          CHECK (note_type IN (
            'observation', 'question', 'hypothesis', 'comparison', 'task', 'method_memo'
          )),
        status        TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'in_review', 'stable', 'archived')),
        collection    TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_primary_source_note_profiles_filter
        ON primary_source_note_profiles(note_type, status, collection, updated_at DESC);

      -- note_links remains the generic graph. This companion stores the literal
      -- quotation and locator shown when a citation was inserted, so a later text
      -- correction can warn without destroying or silently rewriting the note.
      CREATE TABLE primary_source_note_link_snapshots (
        link_id          TEXT PRIMARY KEY REFERENCES note_links(link_id) ON DELETE CASCADE,
        quoted_text      TEXT,
        locator_display  TEXT,
        source_hash      TEXT,
        created_at       TEXT NOT NULL
      );
    `,
  },
  {
    version: 116,
    up: /* sql */ `
      -- A derived research note has its own permissions. It can be more private
      -- (or more open) than the source it discusses, so export never inherits
      -- access implicitly from a linked document.
      ALTER TABLE primary_source_note_profiles
        ADD COLUMN access_status TEXT NOT NULL DEFAULT 'private'
          CHECK (access_status IN ('open','private','restricted','embargoed','unknown'));
      ALTER TABLE primary_source_note_profiles
        ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'normal'
          CHECK (sensitivity IN ('normal','personal','sensitive','highly_sensitive'));
      CREATE INDEX idx_primary_source_note_profiles_access
        ON primary_source_note_profiles(access_status, sensitivity);

      -- One policy row is the backend source of truth for search, AI, sync and
      -- export. Renderer toggles can explain these rules but cannot bypass them.
      CREATE TABLE primary_source_policies (
        policy_id                       TEXT PRIMARY KEY,
        allow_private_search            INTEGER NOT NULL DEFAULT 0,
        allow_restricted_search         INTEGER NOT NULL DEFAULT 0,
        allow_private_sync              INTEGER NOT NULL DEFAULT 0,
        allow_restricted_sync           INTEGER NOT NULL DEFAULT 0,
        allow_restricted_local_ai       INTEGER NOT NULL DEFAULT 0,
        allow_private_external_ai       INTEGER NOT NULL DEFAULT 1,
        require_external_confirmation   INTEGER NOT NULL DEFAULT 1,
        retain_automatic_results_days   INTEGER NOT NULL DEFAULT 365,
        export_private_files            INTEGER NOT NULL DEFAULT 1,
        review_expired_embargoes         INTEGER NOT NULL DEFAULT 1,
        redact_physical_locations       INTEGER NOT NULL DEFAULT 1,
        redact_personal_metadata        INTEGER NOT NULL DEFAULT 1,
        created_at                      TEXT NOT NULL,
        updated_at                      TEXT NOT NULL
      );

      -- Citation text is editable and configurable, while its structured
      -- components and stable Nodus link remain independently recoverable.
      CREATE TABLE primary_source_citation_settings (
        settings_id             TEXT PRIMARY KEY,
        field_order_json        TEXT NOT NULL,
        repository_aliases_json TEXT NOT NULL DEFAULT '{}',
        required_fields_json    TEXT NOT NULL,
        include_accessed_date   INTEGER NOT NULL DEFAULT 0,
        updated_at              TEXT NOT NULL
      );

      -- Sanitised operational audit: hashes and counts only. No source text,
      -- person names, local paths, prompts or provider responses are logged here.
      CREATE TABLE primary_source_operation_runs (
        run_id               TEXT PRIMARY KEY,
        operation_id         TEXT NOT NULL,
        processing_location  TEXT NOT NULL CHECK (processing_location IN ('local', 'external')),
        selection_count      INTEGER NOT NULL,
        selected_ids_hash    TEXT NOT NULL,
        provider             TEXT,
        model                TEXT,
        context_hash         TEXT,
        context_bytes        INTEGER NOT NULL DEFAULT 0,
        left_device          INTEGER NOT NULL DEFAULT 0,
        policy_decision      TEXT NOT NULL,
        status               TEXT NOT NULL CHECK (status IN ('previewed', 'running', 'completed', 'blocked', 'failed')),
        result_kind          TEXT,
        created_at           TEXT NOT NULL,
        completed_at         TEXT,
        error_code           TEXT
      );
      CREATE INDEX idx_primary_source_operation_runs_created
        ON primary_source_operation_runs(created_at DESC);

      -- The full research-package manifest is preservation metadata. The generic
      -- archive_exports row remains the compact audit/index used by Inicio.
      CREATE TABLE primary_source_export_manifests (
        export_id        TEXT PRIMARY KEY REFERENCES archive_exports(export_id) ON DELETE CASCADE,
        format_version   INTEGER NOT NULL,
        profile          TEXT NOT NULL,
        schema_version   INTEGER NOT NULL,
        package_hash     TEXT NOT NULL,
        manifest_json    TEXT NOT NULL,
        verified_at      TEXT,
        created_at       TEXT NOT NULL
      );
      CREATE INDEX idx_primary_source_export_manifests_created
        ON primary_source_export_manifests(created_at DESC);

      -- Restores never retain the source path or source names in their log. A
      -- validated package is materialised as a new vault and reported by hash.
      CREATE TABLE primary_source_restore_reports (
        report_id         TEXT PRIMARY KEY,
        package_hash      TEXT NOT NULL,
        source_schema     INTEGER,
        result_vault_id   TEXT,
        status            TEXT NOT NULL CHECK (status IN ('validated', 'restored', 'rejected', 'failed')),
        missing_files     INTEGER NOT NULL DEFAULT 0,
        invalid_files     INTEGER NOT NULL DEFAULT 0,
        report_json       TEXT NOT NULL,
        created_at        TEXT NOT NULL
      );
      CREATE INDEX idx_primary_source_restore_reports_created
        ON primary_source_restore_reports(created_at DESC);
    `,
  },
  {
    version: 117,
    up: /* sql */ `
      -- Optional, strictly local beta diagnostics. Rows contain only an allow-listed
      -- operation name, coarse corpus-size bucket, elapsed time and success flag:
      -- never source ids, titles, paths, prompts, text or provider responses.
      CREATE TABLE primary_source_local_metrics (
        metric_id        TEXT PRIMARY KEY,
        event_name       TEXT NOT NULL CHECK (event_name IN (
          'archive_list', 'archive_filter', 'dossier_open', 'research_search',
          'demo_seed', 'package_export', 'package_restore'
        )),
        duration_ms      REAL NOT NULL CHECK (duration_ms >= 0),
        item_count_bucket TEXT NOT NULL CHECK (item_count_bucket IN (
          '0', '1-10', '11-100', '101-1000', '1001-10000', '10001-100000', '100000+'
        )),
        success          INTEGER NOT NULL DEFAULT 1 CHECK (success IN (0, 1)),
        created_at       TEXT NOT NULL
      );
      CREATE INDEX idx_primary_source_local_metrics_event_created
        ON primary_source_local_metrics(event_name, created_at DESC);
    `,
  },
  {
    version: 118,
    up: /* sql */ `
      -- Speaker identity is a property of a time-coded transcript segment, not a
      -- page label. Keeping it separate preserves both archival locators and the
      -- output of an explicitly selected diarization engine.
      ALTER TABLE archive_text_segments ADD COLUMN speaker_label TEXT;
    `,
  },
  {
    version: 119,
    up: /* sql */ `
      -- El vault de Testimonios: historia oral. La unidad no es la grabacion ni la
      -- transcripcion, es LA ENTREVISTA COMO CONJUNTO DOCUMENTAL -- preparacion,
      -- participantes, sesiones, archivos, transcripciones, acuerdo, codigos, fragmentos
      -- y notas. Ese es el problema que resuelve: en la practica ese conjunto vive roto
      -- entre carpetas, una grabadora, un procesador de textos y un programa de analisis,
      -- y lo primero que se pierde al romperlo es que la cita vuelva al audio.
      --
      -- POR QUE NO SE REUTILIZA study_recordings. Es la pregunta obvia: Estudio ya graba y
      -- transcribe. Pero una clase es UN archivo con UNA transcripcion, y una entrevista
      -- es varias sesiones, cada una con varios archivos, cada uno con varias VERSIONES de
      -- transcripcion cuyos hablantes se enlazan con personas y cuyo acuerdo cambia con el
      -- tiempo. Meter eso en study_recordings obligaria a ensanchar la tabla de Estudio
      -- con seis conceptos que Estudio no tiene, y su vocabulario docente ("clase",
      -- "asignatura", "apuntes") se filtraria en un archivo de historia oral. Se comparten
      -- los COMPONENTES (captura, reproduccion, whisper local, formatos); no las tablas.
      --
      -- NINGUNA CLAVE FORANEA, A PROPOSITO, igual que las migraciones 98-103. isCreateOnly()
      -- quita los comentarios y rechaza cualquier cuerpo que contenga la palabra de borrado
      -- de SQL, y la clausula de cascada la contiene. Una migracion escrita asi pierde SUS
      -- DOS caminos de reparacion: backfillMissingCreateOnly() no restaura sus tablas, y
      -- una base migrada por una rama con otra numeracion muere con "table already exists"
      -- en vez de reejecutarse. La propiedad la imponen las transacciones del repositorio,
      -- exactamente como ya hacen world_images y las escenas.

      -- La entrevista. Ni el audio ni la transcripcion son columnas suyas: una entrevista
      -- existe -- y se prepara, y se planifica -- antes de que exista un solo archivo.
      CREATE TABLE testimony_interviews (
        id                TEXT PRIMARY KEY,
        short_id          TEXT UNIQUE,
        title             TEXT NOT NULL,
        interview_kind    TEXT NOT NULL DEFAULT 'thematic',
        -- El FLUJO. Es una de las TRES dimensiones independientes de una entrevista; las
        -- otras dos (acuerdo y acceso) viven en testimony_agreements y NO se derivan de
        -- esta. Colapsarlas en un solo estado es como se pierde el rastro de que puede
        -- hacerse con un testimonio: una entrevista completada puede seguir sin acuerdo.
        workflow_status   TEXT NOT NULL DEFAULT 'preparation',
        collection_label  TEXT,
        scheduled_at      TEXT,
        conducted_at      TEXT,
        location_text     TEXT,
        interview_mode    TEXT,
        language          TEXT,
        objective         TEXT,
        context_markdown  TEXT,
        guide_markdown    TEXT,
        abstract          TEXT,
        repository_name   TEXT,
        accession_id      TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        archived_at       TEXT,
        -- Papelera logica. Un archivo de historia oral no borra: retira. Y lo que se
        -- retira tiene que poder volver mientras se decide.
        deleted_at        TEXT
      );
      CREATE INDEX idx_testimony_interviews_status ON testimony_interviews(workflow_status, updated_at);
      CREATE INDEX idx_testimony_interviews_conducted ON testimony_interviews(conducted_at);
      CREATE INDEX idx_testimony_interviews_collection ON testimony_interviews(collection_label);
      CREATE INDEX idx_testimony_interviews_bin ON testimony_interviews(archived_at, deleted_at);

      -- La capa 1:1 sobre persons. Los participantes SON personas de la ontologia
      -- compartida -- la misma que usan genealogia y worldbuilding -- porque un narrador
      -- tiene nombres y variantes como cualquier persona. Lo que esta tabla anade es lo
      -- unico que la ontologia no sabe: con que nombre puede aparecer en publico.
      --
      -- public_name NO es un apodo: es el nombre que sale en derivados, citas y
      -- exportaciones cuando el acuerdo lo exige. Separarlo del nombre de trabajo es lo
      -- que permite anonimizar sin perder de vista con quien se hablo.
      CREATE TABLE testimony_participant_profiles (
        person_id          TEXT PRIMARY KEY,
        public_name        TEXT,
        identity_mode      TEXT NOT NULL DEFAULT 'identified',
        pronunciation      TEXT,
        biographical_note  TEXT,
        attribution_note   TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );

      -- Quien participa y con que papel. La clave incluye el papel porque una misma
      -- persona puede ser narradora en una sesion y traductora en otra de la misma
      -- entrevista, y eso no es un error de datos.
      CREATE TABLE testimony_interview_participants (
        interview_id   TEXT NOT NULL,
        person_id      TEXT NOT NULL,
        role           TEXT NOT NULL DEFAULT 'narrator',
        speaker_label  TEXT,
        is_primary     INTEGER NOT NULL DEFAULT 0,
        position       INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL,
        PRIMARY KEY (interview_id, person_id, role)
      );
      CREATE INDEX idx_testimony_participants_person ON testimony_interview_participants(person_id);

      -- Una sesion. Existe porque una historia de vida no cabe en una tarde: se hacen tres
      -- sesiones en tres semanas, en sitios distintos y a veces en idiomas distintos, y
      -- todas son LA MISMA entrevista.
      CREATE TABLE testimony_sessions (
        id             TEXT PRIMARY KEY,
        short_id       TEXT UNIQUE,
        interview_id   TEXT NOT NULL,
        sequence_no    INTEGER NOT NULL DEFAULT 1,
        title          TEXT,
        status         TEXT NOT NULL DEFAULT 'planned',
        scheduled_at   TEXT,
        recorded_at    TEXT,
        location_text  TEXT,
        mode           TEXT,
        language       TEXT,
        field_notes    TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_testimony_sessions_seq ON testimony_sessions(interview_id, sequence_no);

      -- Los archivos. El maestro se guarda TAL Y COMO SE RECIBIO, sin transcodificar, y
      -- con su huella: es la fuente primaria, y cualquier proceso que lo sustituya por una
      -- version "mejor" destruye la unica copia de lo que se grabo. Los derivados apuntan
      -- a su origen con source_media_id, de modo que una copia de consulta nunca puede
      -- confundirse con el original.
      --
      -- El blob vive dentro de SQLite para que el vault siga siendo autocontenido y
      -- respaldable de una pieza. Esa decision se revisara antes de habilitar video: horas
      -- de imagen dentro de un unico archivo lo harian inviable, y el audio del MVP no
      -- debe esperar a esa evaluacion.
      CREATE TABLE testimony_media (
        id               TEXT PRIMARY KEY,
        short_id         TEXT UNIQUE,
        session_id       TEXT NOT NULL,
        media_kind       TEXT NOT NULL DEFAULT 'audio',
        role             TEXT NOT NULL DEFAULT 'master',
        file_name        TEXT,
        mime_type        TEXT,
        content_blob     BLOB,
        content_hash     TEXT,
        duration_seconds REAL,
        size_bytes       INTEGER,
        technical_json   TEXT,
        source_media_id  TEXT,
        -- El maestro se marca inmutable en la fila, no solo en la interfaz: es la bandera
        -- que consulta el repositorio antes de aceptar cualquier escritura sobre el.
        immutable        INTEGER NOT NULL DEFAULT 1,
        created_at       TEXT NOT NULL,
        deleted_at       TEXT
      );
      CREATE INDEX idx_testimony_media_session ON testimony_media(session_id, role);
      CREATE INDEX idx_testimony_media_hash ON testimony_media(content_hash);
      CREATE INDEX idx_testimony_media_source ON testimony_media(source_media_id);

      -- Las versiones de la transcripcion. La automatica literal NO se sobrescribe nunca;
      -- corregir, revisar, anonimizar o traducir CREA OTRA FILA que recuerda de cual
      -- procede. Sin ese linaje, la pregunta "que version estoy citando" no tiene
      -- respuesta seis meses despues, y es la pregunta que decide si una cita es honesta.
      CREATE TABLE testimony_transcripts (
        id                   TEXT PRIMARY KEY,
        short_id             TEXT UNIQUE,
        media_id             TEXT NOT NULL,
        kind                 TEXT NOT NULL DEFAULT 'machine_literal',
        language             TEXT,
        content_markdown     TEXT,
        status               TEXT NOT NULL DEFAULT 'pending',
        version_no           INTEGER NOT NULL DEFAULT 1,
        source_transcript_id TEXT,
        model_provider       TEXT,
        model_name           TEXT,
        approved_at          TEXT,
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_testimony_transcripts_version ON testimony_transcripts(media_id, kind, version_no);
      CREATE INDEX idx_testimony_transcripts_source ON testimony_transcripts(source_transcript_id);
      CREATE INDEX idx_testimony_transcripts_status ON testimony_transcripts(status);

      -- El segmento: un tramo de tiempo, su texto y QUIEN LO DIJO. speaker_person_id
      -- enlaza con la persona real; speaker_label guarda la etiqueta provisional
      -- ("Hablante 1") mientras nadie la ha identificado. Las dos conviven porque atribuir
      -- una voz es una decision del investigador, no una inferencia: aqui no hay
      -- biometria, y una atribucion automatica equivocada pone palabras en la boca de
      -- alguien sin dejar rastro.
      CREATE TABLE testimony_transcript_segments (
        id                TEXT PRIMARY KEY,
        short_id          TEXT UNIQUE,
        transcript_id     TEXT NOT NULL,
        source_segment_id TEXT,
        t_start           REAL NOT NULL DEFAULT 0,
        t_end             REAL NOT NULL DEFAULT 0,
        text              TEXT,
        speaker_person_id TEXT,
        speaker_label     TEXT,
        confidence        REAL,
        position          INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX idx_testimony_segments_transcript ON testimony_transcript_segments(transcript_id, t_start, position);
      CREATE INDEX idx_testimony_segments_speaker ON testimony_transcript_segments(speaker_person_id);

      -- El catalogo de codigos y temas. NO tiene seccion propia -- se crean desde la
      -- transcripcion de una entrevista -- pero se guardan A NIVEL DE VAULT, y esa es toda
      -- la diferencia: un codigo que solo existiera dentro de una entrevista convertiria
      -- Contrastes en una lista de coincidencias imposibles.
      --
      -- normalized_label es UNIQUE y es la defensa contra el gemelo: "Posguerra",
      -- "posguerra" y "post-guerra " son un solo codigo.
      CREATE TABLE testimony_codes (
        id               TEXT PRIMARY KEY,
        label            TEXT NOT NULL,
        normalized_label TEXT NOT NULL UNIQUE,
        kind             TEXT NOT NULL DEFAULT 'code',
        parent_id        TEXT,
        description      TEXT,
        color            TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX idx_testimony_codes_parent ON testimony_codes(parent_id);

      -- El fragmento codificado. quote_snapshot guarda EL TEXTO TAL CUAL ESTABA: es lo que
      -- permite que una cita sobreviva a una version nueva de la transcripcion sin moverse
      -- sola. Cuando el remapeo no puede reanclarla con seguridad, link_status pasa a
      -- 'needs_review' y aparece en Inicio -- nunca se desplaza en silencio, porque una
      -- cita movida es indistinguible de una cita correcta y falsa.
      CREATE TABLE testimony_annotations (
        id             TEXT PRIMARY KEY,
        short_id       TEXT UNIQUE,
        interview_id   TEXT NOT NULL,
        transcript_id  TEXT NOT NULL,
        segment_id     TEXT,
        kind           TEXT NOT NULL DEFAULT 'highlight',
        t_start        REAL NOT NULL DEFAULT 0,
        t_end          REAL NOT NULL DEFAULT 0,
        start_offset   INTEGER,
        end_offset     INTEGER,
        quote_snapshot TEXT,
        memo           TEXT,
        link_status    TEXT NOT NULL DEFAULT 'valid',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX idx_testimony_annotations_interview ON testimony_annotations(interview_id, t_start);
      CREATE INDEX idx_testimony_annotations_transcript ON testimony_annotations(transcript_id);
      CREATE INDEX idx_testimony_annotations_link ON testimony_annotations(link_status);

      CREATE TABLE testimony_annotation_codes (
        annotation_id TEXT NOT NULL,
        code_id       TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        PRIMARY KEY (annotation_id, code_id)
      );
      CREATE INDEX idx_testimony_annotation_codes_code ON testimony_annotation_codes(code_id);

      -- EL ACUERDO SE VERSIONA. No es una casilla: un narrador puede ampliar los usos que
      -- autoriza, pedir un embargo o retirarlo entero, y cada uno de esos cambios es un
      -- hecho fechado que hay que poder consultar despues. Guardarlo como un booleano
      -- convierte el consentimiento en un tramite y borra la agencia que sostiene todo el
      -- metodo.
      --
      -- is_current tiene indice UNICO PARCIAL: exactamente una version vigente por
      -- entrevista, impuesto por la base y no por la disciplina de quien escribe el repo.
      CREATE TABLE testimony_agreements (
        id                        TEXT PRIMARY KEY,
        interview_id              TEXT NOT NULL,
        version_no                INTEGER NOT NULL DEFAULT 1,
        is_current                INTEGER NOT NULL DEFAULT 1,
        status                    TEXT NOT NULL DEFAULT 'pending',
        documented_at             TEXT,
        access_level              TEXT NOT NULL DEFAULT 'private',
        -- NULL con nivel 'embargoed' significa embargo SIN fecha, que no vence solo.
        embargo_until             TEXT,
        attribution_mode          TEXT NOT NULL DEFAULT 'public_name',
        allowed_uses_json         TEXT NOT NULL DEFAULT '[]',
        narrator_review_required  INTEGER NOT NULL DEFAULT 0,
        narrator_review_status    TEXT NOT NULL DEFAULT 'not_started',
        narrator_review_sent_at   TEXT,
        narrator_review_notes     TEXT,
        restrictions_markdown     TEXT,
        document_media_id         TEXT,
        created_at                TEXT NOT NULL,
        updated_at                TEXT NOT NULL
      );
      CREATE INDEX idx_testimony_agreements_interview ON testimony_agreements(interview_id, version_no DESC);
      CREATE UNIQUE INDEX idx_testimony_agreements_current ON testimony_agreements(interview_id) WHERE is_current = 1;
      CREATE INDEX idx_testimony_agreements_access ON testimony_agreements(access_level, embargo_until);

      -- Un contraste guardado. Guarda la CONFIGURACION y los fragmentos fijados, nunca una
      -- sintesis generada: si una sintesis merece conservarse, se convierte en nota con
      -- sus referencias, que es donde una interpretacion puede seguir discutiendose.
      CREATE TABLE testimony_contrasts (
        id             TEXT PRIMARY KEY,
        short_id       TEXT UNIQUE,
        title          TEXT NOT NULL,
        filters_json   TEXT NOT NULL DEFAULT '{}',
        memo_markdown  TEXT,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );

      CREATE TABLE testimony_contrast_items (
        contrast_id   TEXT NOT NULL,
        annotation_id TEXT NOT NULL,
        position      INTEGER NOT NULL DEFAULT 0,
        note          TEXT,
        created_at    TEXT NOT NULL,
        PRIMARY KEY (contrast_id, annotation_id)
      );
      CREATE INDEX idx_testimony_contrast_items_annotation ON testimony_contrast_items(annotation_id);

      -- Enlaces de una nota con CUALQUIER entidad. Tabla generica a proposito: la estrena
      -- Testimonios, pero nada en ella habla de entrevistas, asi que cualquier otro vault
      -- puede colgar sus notas de sus propias entidades sin una segunda tabla igual. El
      -- destino se guarda por tipo e id y NO se comprueba contra ninguna tabla: una nota
      -- cuyo fragmento ha desaparecido debe conservar su texto y mostrar el enlace roto,
      -- no evaporarse con el.
      CREATE TABLE testimony_note_links (
        note_id     TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id   TEXT NOT NULL,
        label       TEXT,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (note_id, target_kind, target_id)
      );
      CREATE INDEX idx_testimony_note_links_target ON testimony_note_links(target_kind, target_id);
    `,
  },
  {
    version: 120,
    up: /* sql */ `
      -- El indice semantico de Testimonios.
      --
      -- Vive en su propia tabla y no en una columna de los tramos por una razon de
      -- gobierno, no de rendimiento: un embedding es un DERIVADO de la voz de alguien que
      -- puede viajar a un proveedor externo, y el acuerdo de cada entrevista decide si
      -- puede existir. Teniendolo aparte, retirar el consentimiento es borrar filas de una
      -- tabla concreta, y no reescribir la transcripcion.
      --
      -- Sin claves foraneas, como el resto del vertical: la migracion tiene que seguir
      -- siendo CREATE-only para conservar sus dos caminos de reparacion.
      CREATE TABLE testimony_segment_embeddings (
        segment_id    TEXT PRIMARY KEY,
        transcript_id TEXT NOT NULL,
        interview_id  TEXT NOT NULL,
        model         TEXT NOT NULL,
        dim           INTEGER NOT NULL,
        embedding     BLOB NOT NULL,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_testimony_embeddings_interview ON testimony_segment_embeddings(interview_id);
      CREATE INDEX idx_testimony_embeddings_transcript ON testimony_segment_embeddings(transcript_id);
    `,
  },
  {
    version: 121,
    up: /* sql */ `
      -- El lugar de procedencia es un dato descriptivo de la fuente, no una mención
      -- encontrada dentro de su texto. La separación impide que el mapa documental
      -- convierta cualquier ciudad citada en el origen del documento.
      ALTER TABLE archive_item_profiles
        ADD COLUMN provenance_place_id TEXT REFERENCES places(place_id) ON DELETE SET NULL;

      -- Conserva la intención de las importaciones anteriores: cuando había un lugar
      -- marcado explícitamente como creación, se promociona a procedencia canónica.
      UPDATE archive_item_profiles
         SET provenance_place_id = (
           SELECT mention.place_id
             FROM archive_place_mentions mention
            WHERE mention.item_id = archive_item_profiles.item_id
              AND mention.role = 'creation'
              AND mention.place_id IS NOT NULL
            ORDER BY CASE mention.status WHEN 'resolved' THEN 0 ELSE 1 END,
                     mention.created_at,
                     mention.mention_id
            LIMIT 1
         )
       WHERE provenance_place_id IS NULL;

      CREATE INDEX idx_archive_item_profiles_provenance_place
        ON archive_item_profiles(provenance_place_id);
    `,
  },
  {
    version: 122,
    up: /* sql */ `
      -- Outgoing queue for a CONNECTED vault: rows this machine has changed that still
      -- have to reach the owner's vault through Nodus Server.
      --
      -- It stores the row's IDENTITY, never a copy of its payload. Three reasons, and each
      -- one alone would justify it: a stored copy goes stale the moment the user edits
      -- again; the partial unique index below then collapses repeated edits of one row into
      -- a single pending entry instead of a pile of them; and an image's hash can only be
      -- computed when the row is actually read for sending.
      --
      -- The table exists in every vault because migrations are not conditional, but its
      -- triggers are installed only for a connected vault whose account may write. A
      -- reader's database therefore has nothing writing to it at all — see
      -- electron/serverSync/outboxTriggers.ts.
      CREATE TABLE server_outbox (
        id             TEXT PRIMARY KEY,
        seq            INTEGER NOT NULL,
        table_name     TEXT NOT NULL,
        row_key        TEXT NOT NULL,
        op             TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
        schema_version INTEGER NOT NULL,
        created_at     TEXT NOT NULL,
        state          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (state IN ('pending', 'sending', 'sent', 'rejected')),
        attempts       INTEGER NOT NULL DEFAULT 0,
        last_error     TEXT
      );

      -- One pending entry per row. A second edit updates the entry that is already queued
      -- rather than adding another, so a long editing session sends one mutation, not fifty.
      CREATE UNIQUE INDEX idx_server_outbox_pending
        ON server_outbox(table_name, row_key) WHERE state = 'pending';
      CREATE INDEX idx_server_outbox_drain ON server_outbox(state, seq);
    `,
  },
  {
    version: 123,
    up: /* sql */ `
      -- Lo que ha llegado de otro dispositivo a través del ledger, y qué se hizo con ello.
      --
      -- Existe porque applyIncomingMutations no dejaba rastro: la fila aplicada es
      -- indistinguible de una que escribiera el propietario, y el resumen en memoria se
      -- perdía al cerrar. Sin esto no hay forma de decirle a nadie que ha recibido algo.
      --
      -- Es el registro que ESTE ordenador lleva de lo que le llegó, así que no viaja:
      -- ni en las copias .nodussync (NOT_SYNCED_TABLES) ni en el snapshot publicado, y
      -- desde luego no en MUTABLE_TABLES. Publicarlo dejaría que la bandeja de una
      -- máquina sobrescribiera la de otra, que es el mismo argumento que sync_superseded.
      CREATE TABLE server_inbox (
        id             TEXT PRIMARY KEY,   -- el id de la mutación: un reintento es idempotente
        seq            INTEGER NOT NULL,
        space_id       TEXT,
        client_id      TEXT,               -- qué dispositivo, no qué persona: el servidor
                                           -- escribe userId: null siempre
        table_name     TEXT NOT NULL,
        row_key        TEXT NOT NULL,      -- JSON.stringify(mutation.key), la MISMA codificación
                                           -- que server_outbox y las lápidas
        op             TEXT NOT NULL CHECK (op IN ('upsert','delete')),
        outcome        TEXT NOT NULL CHECK (outcome IN ('applied','deleted','kept_local','refused')),
        reason         TEXT,
        title          TEXT,
        entity_kind    TEXT,               -- 'deep_research' | 'note' | … para no reparsear brief_json
        schema_version INTEGER,
        created_at     TEXT,               -- cuándo lo escribió el teléfono
        arrived_at     TEXT NOT NULL,      -- cuándo lo aplicó este escritorio
        read           INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_server_inbox_recent ON server_inbox(arrived_at DESC);
      CREATE INDEX idx_server_inbox_unread ON server_inbox(read, arrived_at DESC);
    `,
  },
  {
    version: 124,
    up: /* sql */ `
      -- Which saved reports have been read. The ROW's existence is what "read" means:
      -- there is nothing else to store, and a boolean column would need a row for every
      -- report merely to say "not yet".
      --
      -- A table of its own rather than a column on writing_saved_drafts, and that is the
      -- whole point. That table is in MUTABLE_TABLES: an UPDATE on it fires the outbox
      -- trigger, so on a connected vault every tick of a checkbox would put the entire
      -- report back on the wire for the owner to receive again. Reading is not an edit of
      -- the report.
      --
      -- It does travel in a .nodussync package, in the 'writing' group beside the reports
      -- themselves — that is one person's two machines, and having read something on the
      -- laptop is still true at the desk. Which is also why 'updated_at' carries the
      -- moment it was marked rather than a second column repeating it: the merge compares
      -- that name and no other, and unmarking is a DELETE the tombstones already carry.
      CREATE TABLE writing_draft_reads (
        draft_id   TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 125,
    up: /* sql */ `
      -- Reader-curated author bookmarks. The canonical key survives author-layer
      -- reconciliation and rescans; legacy/demo authors fall back to their local id.
      -- This remains vault-local because the derived author layer itself is not synced.
      CREATE TABLE saved_authors (
        author_key TEXT PRIMARY KEY,
        saved_at   TEXT NOT NULL
      );
      CREATE INDEX idx_saved_authors_saved_at ON saved_authors(saved_at DESC);
    `,
  },
  {
    version: 126,
    up: /* sql */ `
      -- Persistent, syncable annotations over saved Deep Research text. They live in
      -- their own small rows rather than rewriting draft_json for every highlight: a
      -- fifteen-page report must not go back over the wire because one pastel colour
      -- or one comment changed.
      --
      -- No foreign key on purpose. A connected replica can receive child and parent
      -- mutations in either order, just as writing_draft_reads can. Repository deletes
      -- still remove annotations before their report so local data never leaves orphans.
      CREATE TABLE writing_draft_annotations (
        id            TEXT PRIMARY KEY,
        draft_id      TEXT NOT NULL,
        scope         TEXT NOT NULL DEFAULT 'source',
        kind          TEXT NOT NULL CHECK (kind IN ('highlight','comment')),
        color         TEXT CHECK (color IS NULL OR color IN ('yellow','rose','blue','mint','lavender','peach')),
        start_offset  INTEGER NOT NULL CHECK (start_offset >= 0),
        end_offset    INTEGER NOT NULL CHECK (end_offset > start_offset),
        selected_text TEXT NOT NULL,
        prefix        TEXT NOT NULL DEFAULT '',
        suffix        TEXT NOT NULL DEFAULT '',
        comment_text  TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_writing_draft_annotations_draft
        ON writing_draft_annotations(draft_id, scope, start_offset, created_at);
    `,
  },
  {
    version: 127,
    up: /* sql */ `
      -- Reading bookmarks use the same anchored, syncable rows as highlights and
      -- comments. Rebuilding is required because SQLite cannot widen a CHECK in
      -- place; every column and existing annotation is copied byte for byte.
      ALTER TABLE writing_draft_annotations RENAME TO writing_draft_annotations_v126;
      CREATE TABLE writing_draft_annotations (
        id            TEXT PRIMARY KEY,
        draft_id      TEXT NOT NULL,
        scope         TEXT NOT NULL DEFAULT 'source',
        kind          TEXT NOT NULL CHECK (kind IN ('highlight','comment','bookmark')),
        color         TEXT CHECK (color IS NULL OR color IN ('yellow','rose','blue','mint','lavender','peach')),
        start_offset  INTEGER NOT NULL CHECK (start_offset >= 0),
        end_offset    INTEGER NOT NULL CHECK (end_offset > start_offset),
        selected_text TEXT NOT NULL,
        prefix        TEXT NOT NULL DEFAULT '',
        suffix        TEXT NOT NULL DEFAULT '',
        comment_text  TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      INSERT INTO writing_draft_annotations (
        id, draft_id, scope, kind, color, start_offset, end_offset, selected_text,
        prefix, suffix, comment_text, created_at, updated_at
      )
      SELECT
        id, draft_id, scope, kind, color, start_offset, end_offset, selected_text,
        prefix, suffix, comment_text, created_at, updated_at
      FROM writing_draft_annotations_v126;
      DROP TABLE writing_draft_annotations_v126;
      CREATE INDEX idx_writing_draft_annotations_draft
        ON writing_draft_annotations(draft_id, scope, start_offset, created_at);
    `,
  },
  {
    version: 128,
    up: /* sql */ `
      -- Derived library analysis is retained when its source changes, but this
      -- provenance gate prevents a retained result from being presented as current.
      CREATE TABLE library_analysis_freshness (
        work_id       TEXT NOT NULL,
        component     TEXT NOT NULL CHECK (component IN ('extraction','light','deep','passages','ideas','embeddings','summary')),
        freshness     TEXT NOT NULL CHECK (freshness IN ('none','queued','running','current','stale','failed','unavailable')),
        fingerprint   TEXT,
        reason        TEXT,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (work_id, component)
      );
      CREATE INDEX idx_library_analysis_freshness_state
        ON library_analysis_freshness(freshness, component, work_id);
    `,
  },
  {
    version: 129,
    up: /* sql */ `
      -- Exact cross-vault reuse is opt-in per derived component. A result without
      -- this complete provenance remains readable locally but is never copied.
      CREATE TABLE library_analysis_provenance (
        work_id                         TEXT NOT NULL,
        component                       TEXT NOT NULL CHECK (component IN ('light','deep','summary','ideas','passages','embeddings')),
        document_fingerprint            TEXT NOT NULL,
        library_item_id                 TEXT,
        library_revision_fingerprint    TEXT,
        pipeline_version                TEXT NOT NULL,
        model_fingerprint               TEXT NOT NULL,
        output_fingerprint              TEXT NOT NULL,
        source_vault_id                 TEXT,
        source_work_id                  TEXT,
        updated_at                      TEXT NOT NULL,
        PRIMARY KEY (work_id, component)
      );
      CREATE INDEX library_analysis_provenance_library
        ON library_analysis_provenance(library_item_id, library_revision_fingerprint, component);
    `,
  },
  {
    version: 130,
    up: /* sql */ `
      -- Workspace: Notas, Escritura y Proyectos pasan a ser UNA sección en la bóveda
      -- académica. El almacén sigue siendo el árbol de notas que ya existía — las
      -- colecciones SON note_folders y las notas e ideas SON notes — porque cambiar de
      -- tabla habría obligado a mover contenido que hoy se lee bien, y a rehacer todo lo
      -- que ya cuelga de él: búsqueda, embeddings, MCP, copias y sincronización.
      --
      -- Lo que se añade es lo que le faltaba a ese árbol para sostener el editor completo
      -- (el mismo de Estudio y Docencia) y los enlaces con la biblioteca.

      -- Ajustes de página, idioma del corrector y diccionario propio, por nota.
      ALTER TABLE notes ADD COLUMN style_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE notes ADD COLUMN spellcheck_language TEXT NOT NULL DEFAULT 'es-ES';
      ALTER TABLE notes ADD COLUMN custom_dictionary_json TEXT NOT NULL DEFAULT '[]';

      -- Procedencia de una colección migrada ('project:<id>' o 'writing'). El índice
      -- único es lo que hace IMPOSIBLE que una segunda pasada de la migración duplique
      -- una colección: la garantía la da el motor, no el cuidado del código.
      ALTER TABLE note_folders ADD COLUMN source_ref TEXT;
      CREATE UNIQUE INDEX idx_note_folders_source_ref
        ON note_folders(source_ref) WHERE source_ref IS NOT NULL;

      -- La nota que representa a un documento guardado de Escritura. Misma función que
      -- project_chapters.note_id, que ya existía: enlazar sin copiar dos veces.
      ALTER TABLE writing_saved_drafts ADD COLUMN note_id TEXT;

      -- Historial y comentarios anclados de una nota. Son gemelos de study_doc_versions
      -- y study_annotations, y no reutilizan aquellas tablas porque su clave foránea
      -- apunta a study_docs con ON DELETE CASCADE: colgar de ellas ids de notas dejaría
      -- versiones huérfanas que nadie borraría nunca.
      CREATE TABLE note_versions (
        id               TEXT PRIMARY KEY,
        note_id          TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        version_no       INTEGER NOT NULL,
        title            TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        style_json       TEXT NOT NULL DEFAULT '{}',
        reason           TEXT NOT NULL DEFAULT 'manual',
        content_hash     TEXT NOT NULL,
        created_at       TEXT NOT NULL,
        UNIQUE(note_id, version_no)
      );
      CREATE INDEX idx_note_versions_note ON note_versions(note_id, version_no DESC);
      CREATE INDEX idx_note_versions_hash ON note_versions(note_id, content_hash);

      CREATE TABLE note_annotations (
        id            TEXT PRIMARY KEY,
        note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        from_pos      INTEGER NOT NULL DEFAULT 0,
        to_pos        INTEGER NOT NULL DEFAULT 0,
        selected_text TEXT NOT NULL DEFAULT '',
        comment       TEXT NOT NULL DEFAULT '',
        color         TEXT,
        resolved_at   TEXT,
        locked        INTEGER NOT NULL DEFAULT 0,
        pinned        INTEGER NOT NULL DEFAULT 0,
        position      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX idx_note_annotations_note ON note_annotations(note_id, resolved_at, position);

      -- Enlaces entre lo que se escribe y lo que se lee: una nota, una idea o una
      -- colección pueden apuntar a varios elementos de la biblioteca.
      --
      -- SIN CLAVE FORÁNEA HACIA LA BIBLIOTECA, y es deliberado: los elementos globales
      -- viven en OTRA base de datos (nodus-library), fuera de esta bóveda. Un enlace roto
      -- se muestra como roto; nunca se lleva por delante la nota que lo hizo.
      CREATE TABLE workspace_library_links (
        owner_kind      TEXT NOT NULL CHECK (owner_kind IN ('note','collection')),
        owner_id        TEXT NOT NULL,
        library_item_id TEXT NOT NULL,
        scope           TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global','vault')),
        label           TEXT,
        created_at      TEXT NOT NULL,
        PRIMARY KEY (owner_kind, owner_id, library_item_id, scope)
      );
      CREATE INDEX idx_workspace_library_links_item
        ON workspace_library_links(library_item_id, owner_kind, owner_id);

      -- El registro de mejoras de IA es del EDITOR, no del vault de Estudio, y el editor
      -- pasa a escribirse también sobre notas. Su 'document_id' era NOT NULL contra
      -- study_docs, así que una mejora sobre una nota fallaba con un error de clave
      -- foránea. Se reconstruye con las dos procedencias posibles, cada una con su propio
      -- borrado en cascada, y con el CHECK que impide una fila sin dueño. Cada fila
      -- existente se copia columna a columna: no se pierde ni un registro.
      ALTER TABLE study_improvement_log RENAME TO study_improvement_log_v129;
      CREATE TABLE study_improvement_log (
        id               TEXT PRIMARY KEY,
        document_id      TEXT REFERENCES study_docs(id) ON DELETE CASCADE,
        note_id          TEXT REFERENCES notes(id) ON DELETE CASCADE,
        style_id         TEXT NOT NULL,
        scope            TEXT NOT NULL,
        mode             TEXT NOT NULL,
        level            TEXT NOT NULL,
        length_mode      TEXT NOT NULL,
        model_provider   TEXT NOT NULL,
        model_name       TEXT NOT NULL,
        original_hash    TEXT NOT NULL,
        result_hash      TEXT NOT NULL,
        original_chars   INTEGER NOT NULL,
        result_chars     INTEGER NOT NULL,
        warnings_json    TEXT NOT NULL DEFAULT '[]',
        action           TEXT NOT NULL DEFAULT 'generated',
        created_at       TEXT NOT NULL,
        CHECK (document_id IS NOT NULL OR note_id IS NOT NULL)
      );
      INSERT INTO study_improvement_log (
        id, document_id, note_id, style_id, scope, mode, level, length_mode, model_provider,
        model_name, original_hash, result_hash, original_chars, result_chars, warnings_json,
        action, created_at
      )
      SELECT
        id, document_id, NULL, style_id, scope, mode, level, length_mode, model_provider,
        model_name, original_hash, result_hash, original_chars, result_chars, warnings_json,
        action, created_at
      FROM study_improvement_log_v129;
      DROP TABLE study_improvement_log_v129;
      CREATE INDEX idx_study_improvement_log_doc ON study_improvement_log(document_id, created_at DESC);
      CREATE INDEX idx_study_improvement_log_note ON study_improvement_log(note_id, created_at DESC);
      CREATE INDEX idx_study_improvement_log_hash ON study_improvement_log(original_hash, result_hash);
    `,
    after: (db) => { migrateWorkspaceContent(db); },
  },
  {
    version: 131,
    up: /* sql */ `
      -- A Clean Markdown anchor is completely described by its UTF-16 offsets. An
      -- annotation over the original also needs to say which attachment and page (or
      -- reflowable chapter) those offsets belong to. JSON keeps the already-public
      -- WritingDraftAnnotationTarget union extensible without rebuilding this table for
      -- every new original-document renderer.
      ALTER TABLE writing_draft_annotations ADD COLUMN target_json TEXT;
    `,
  },
  {
    version: 132,
    up: /* sql */ `
      -- A phone may send dozens of highlights and comments for one document. Retaining
      -- the parent identity makes those durable inbox records one expandable notification
      -- instead of an unbounded flat list. The title is captured too: a deleted child can
      -- no longer be joined back to its report after the mutation has been applied.
      ALTER TABLE server_inbox ADD COLUMN parent_entity_kind TEXT;
      ALTER TABLE server_inbox ADD COLUMN parent_entity_id TEXT;
      ALTER TABLE server_inbox ADD COLUMN parent_title TEXT;

      -- Repair the existing flat Deep Research history where the annotation still exists.
      -- Deleted legacy children cannot be joined after the fact, but every live highlight,
      -- comment and bookmark becomes grouped immediately on the first v132 launch.
      UPDATE server_inbox
      SET parent_entity_kind = 'deep_research',
          parent_entity_id = (
            SELECT annotation.draft_id
            FROM writing_draft_annotations annotation
            WHERE annotation.id = json_extract(server_inbox.row_key, '$[0]')
          ),
          parent_title = (
            SELECT COALESCE(NULLIF(TRIM(report.title), ''), json_extract(report.brief_json, '$.objective'))
            FROM writing_draft_annotations annotation
            JOIN writing_saved_drafts report ON report.id = annotation.draft_id
            WHERE annotation.id = json_extract(server_inbox.row_key, '$[0]')
          ),
          entity_kind = 'deep_research_annotation',
          title = COALESCE(title, (
            SELECT CASE
              WHEN annotation.kind = 'comment' THEN COALESCE(NULLIF(TRIM(annotation.comment_text), ''), annotation.selected_text)
              ELSE annotation.selected_text
            END
            FROM writing_draft_annotations annotation
            WHERE annotation.id = json_extract(server_inbox.row_key, '$[0]')
          ))
      WHERE table_name = 'writing_draft_annotations'
        AND parent_entity_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM writing_draft_annotations annotation
          WHERE annotation.id = json_extract(server_inbox.row_key, '$[0]')
            AND annotation.draft_id NOT LIKE 'nodus-library:%'
        );
    `,
  },
  {
    version: 133,
    up: /* sql */ `
      -- El Espacio de trabajo adopta las dos invariantes de la Biblioteca global:
      -- etiquetas de usuario y borrado recuperable. JSON evita otra tabla para una lista
      -- pequeña y trashed_at conserva el instante que se muestra y sincroniza.
      ALTER TABLE notes ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE notes ADD COLUMN trashed_at TEXT;
      CREATE INDEX idx_notes_trash_updated ON notes(trashed_at, updated_at DESC);
    `,
  },
  {
    version: 134,
    up: /* sql */ `
      -- Durable content token used to reuse a previously verified vault entry. File
      -- mtimes are not safe with WAL and can change without content; mutations advance
      -- this counter transactionally through triggers installed when the vault opens.
      CREATE TABLE backup_revision (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        sequence INTEGER NOT NULL
      );
      INSERT INTO backup_revision (singleton, sequence) VALUES (1, 1);
    `,
  },
  {
    version: 135,
    up: /* sql */ `
      -- Boundary for the Notion-parity storage programme. The detailed reports and
      -- immutable pre-migration copies live beside the vault so they also survive a
      -- database-level rollback; this table is the durable in-vault index for future UI.
      CREATE TABLE schema_migration_events (
        id             TEXT PRIMARY KEY,
        from_version   INTEGER NOT NULL,
        target_version INTEGER NOT NULL,
        status         TEXT NOT NULL CHECK (status IN ('succeeded', 'failed-restored', 'failed-unrestored')),
        report_path    TEXT,
        created_at     TEXT NOT NULL
      );
      CREATE INDEX idx_schema_migration_events_created ON schema_migration_events(created_at DESC);
    `,
  },
  {
    version: 136,
    up: /* sql */ `
      -- Notion parity, loop 2: database identity becomes part of every EAV edge.
      -- The legacy value_text stays during the compatibility window, while canonical
      -- typed projections make indexed comparisons independent from JavaScript parsing.
      CREATE UNIQUE INDEX idx_db_rows_database_identity ON db_rows(database_id, id);
      CREATE UNIQUE INDEX idx_db_columns_database_identity ON db_columns(database_id, id);

      ALTER TABLE db_databases ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE db_databases ADD COLUMN created_by TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE db_databases ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE db_rows ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE db_rows ADD COLUMN created_by TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE db_rows ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'local';

      ALTER TABLE db_columns ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
      ALTER TABLE db_columns ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE db_columns ADD COLUMN created_by TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE db_columns ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'local';
      UPDATE db_columns SET updated_at = created_at WHERE updated_at = '1970-01-01T00:00:00.000Z';

      CREATE TABLE db_integrity_quarantine (
        id           TEXT PRIMARY KEY,
        source_table TEXT NOT NULL,
        source_key   TEXT NOT NULL,
        reason       TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_blob BLOB,
        created_at   TEXT NOT NULL,
        resolved_at  TEXT
      );

      INSERT INTO db_integrity_quarantine (id, source_table, source_key, reason, payload_json, created_at)
      SELECT 'cell:' || cell.row_id || ':' || cell.column_id, 'db_cells', cell.row_id || ':' || cell.column_id,
             'row-column-database-mismatch',
             json_object('row_id', cell.row_id, 'column_id', cell.column_id, 'value_text', cell.value_text,
                         'row_database_id', row.database_id, 'column_database_id', col.database_id),
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM db_cells cell
      JOIN db_rows row ON row.id = cell.row_id
      JOIN db_columns col ON col.id = cell.column_id
      WHERE row.database_id <> col.database_id;

      CREATE TABLE db_cells_v135 (
        database_id    TEXT NOT NULL,
        row_id          TEXT NOT NULL,
        column_id       TEXT NOT NULL,
        value_type      TEXT NOT NULL DEFAULT 'legacy'
                        CHECK (value_type IN ('text','number','integer','date','json','reference','legacy')),
        value_text      TEXT,
        value_number    REAL,
        value_integer   INTEGER,
        value_date      TEXT,
        value_json      TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
        value_reference TEXT,
        revision        INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by      TEXT NOT NULL DEFAULT 'local',
        updated_by      TEXT NOT NULL DEFAULT 'local',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        PRIMARY KEY (row_id, column_id),
        UNIQUE (database_id, row_id, column_id),
        FOREIGN KEY (database_id, row_id) REFERENCES db_rows(database_id, id) ON DELETE CASCADE,
        FOREIGN KEY (database_id, column_id) REFERENCES db_columns(database_id, id) ON DELETE CASCADE,
        CHECK ((value_number IS NOT NULL) + (value_integer IS NOT NULL) + (value_date IS NOT NULL) +
               (value_json IS NOT NULL) + (value_reference IS NOT NULL) <= 1)
      );
      INSERT INTO db_cells_v135
        (database_id, row_id, column_id, value_type, value_text, created_at, updated_at)
      SELECT row.database_id, cell.row_id, cell.column_id, 'legacy', cell.value_text,
             row.created_at, row.updated_at
      FROM db_cells cell
      JOIN db_rows row ON row.id = cell.row_id
      JOIN db_columns col ON col.id = cell.column_id AND col.database_id = row.database_id;
      DROP TABLE db_cells;
      ALTER TABLE db_cells_v135 RENAME TO db_cells;
      CREATE INDEX idx_db_cells_column ON db_cells(database_id, column_id);
      CREATE INDEX idx_db_cells_row ON db_cells(database_id, row_id);

      CREATE TABLE db_select_options_v135 (
        id          TEXT PRIMARY KEY,
        database_id TEXT NOT NULL,
        column_id   TEXT NOT NULL,
        label       TEXT NOT NULL,
        color       TEXT,
        position    INTEGER NOT NULL DEFAULT 0,
        revision    INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by  TEXT NOT NULL DEFAULT 'local',
        updated_by  TEXT NOT NULL DEFAULT 'local',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        FOREIGN KEY (database_id, column_id) REFERENCES db_columns(database_id, id) ON DELETE CASCADE
      );
      INSERT INTO db_select_options_v135
        (id, database_id, column_id, label, color, position, created_at, updated_at)
      SELECT option.id, col.database_id, option.column_id, option.label, option.color, option.position,
             col.created_at, col.updated_at
      FROM db_select_options option JOIN db_columns col ON col.id = option.column_id;
      DROP TABLE db_select_options;
      ALTER TABLE db_select_options_v135 RENAME TO db_select_options;
      CREATE INDEX idx_db_select_options_column ON db_select_options(database_id, column_id);

      CREATE TABLE db_blobs (
        hash        TEXT PRIMARY KEY CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
        bytes       INTEGER NOT NULL CHECK (bytes >= 0),
        mime_type   TEXT,
        data        BLOB NOT NULL,
        revision    INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by  TEXT NOT NULL DEFAULT 'local',
        updated_by  TEXT NOT NULL DEFAULT 'local',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        CHECK (length(data) = bytes)
      );

      INSERT INTO db_integrity_quarantine (id, source_table, source_key, reason, payload_json, payload_blob, created_at)
      SELECT 'attachment:' || attachment.id, 'db_attachments', attachment.id,
             'row-column-database-mismatch',
             json_object('id', attachment.id, 'row_id', attachment.row_id, 'column_id', attachment.column_id,
                         'file_name', attachment.file_name, 'mime_type', attachment.mime_type, 'bytes', attachment.bytes,
                         'content_hash', attachment.content_hash, 'extracted_text', attachment.extracted_text,
                         'description', attachment.description, 'position', attachment.position,
                         'row_database_id', row.database_id, 'column_database_id', col.database_id),
             attachment.blob, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM db_attachments attachment
      JOIN db_rows row ON row.id = attachment.row_id
      JOIN db_columns col ON col.id = attachment.column_id
      WHERE row.database_id <> col.database_id;

      CREATE TABLE db_attachments_v135 (
        id             TEXT PRIMARY KEY,
        database_id    TEXT NOT NULL,
        row_id          TEXT NOT NULL,
        column_id       TEXT NOT NULL,
        file_name      TEXT,
        mime_type      TEXT,
        bytes          INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
        blob_hash      TEXT REFERENCES db_blobs(hash) ON DELETE RESTRICT,
        blob           BLOB,
        content_hash   TEXT,
        extracted_text TEXT,
        description    TEXT,
        ai_generated   INTEGER NOT NULL DEFAULT 0 CHECK (ai_generated IN (0, 1)),
        ai_prompt      TEXT,
        thumb          BLOB,
        position       INTEGER NOT NULL DEFAULT 0,
        revision       INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by     TEXT NOT NULL DEFAULT 'local',
        updated_by     TEXT NOT NULL DEFAULT 'local',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        FOREIGN KEY (database_id, row_id) REFERENCES db_rows(database_id, id) ON DELETE CASCADE,
        FOREIGN KEY (database_id, column_id) REFERENCES db_columns(database_id, id) ON DELETE CASCADE
      );
      INSERT INTO db_attachments_v135
        (id, database_id, row_id, column_id, file_name, mime_type, bytes, blob, content_hash,
         extracted_text, description, ai_generated, ai_prompt, thumb, position, created_at, updated_at)
      SELECT attachment.id, row.database_id, attachment.row_id, attachment.column_id,
             attachment.file_name, attachment.mime_type, attachment.bytes, attachment.blob,
             attachment.content_hash, attachment.extracted_text, attachment.description,
             attachment.ai_generated, attachment.ai_prompt, attachment.thumb, attachment.position,
             attachment.created_at, attachment.created_at
      FROM db_attachments attachment
      JOIN db_rows row ON row.id = attachment.row_id
      JOIN db_columns col ON col.id = attachment.column_id AND col.database_id = row.database_id;
      DROP TABLE db_attachments;
      ALTER TABLE db_attachments_v135 RENAME TO db_attachments;
      CREATE INDEX idx_db_attachments_cell ON db_attachments(database_id, row_id, column_id);
      CREATE INDEX idx_db_attachments_blob ON db_attachments(blob_hash);

      INSERT INTO db_integrity_quarantine (id, source_table, source_key, reason, payload_json, created_at)
      SELECT 'relation:' || relation.id, 'db_relations', relation.id,
             'row-column-database-mismatch',
             json_object('id', relation.id, 'row_id', relation.row_id, 'column_id', relation.column_id,
                         'target_kind', relation.target_kind, 'target_id', relation.target_id,
                         'target_vault_id', relation.target_vault_id, 'position', relation.position,
                         'row_database_id', row.database_id, 'column_database_id', col.database_id),
             strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM db_relations relation
      JOIN db_rows row ON row.id = relation.row_id
      JOIN db_columns col ON col.id = relation.column_id
      WHERE row.database_id <> col.database_id;

      CREATE TABLE db_relations_v135 (
        id              TEXT PRIMARY KEY,
        database_id     TEXT NOT NULL,
        row_id           TEXT NOT NULL,
        column_id        TEXT NOT NULL,
        target_kind      TEXT NOT NULL,
        target_id        TEXT NOT NULL,
        target_vault_id  TEXT,
        position         INTEGER NOT NULL DEFAULT 0,
        revision         INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by       TEXT NOT NULL DEFAULT 'local',
        updated_by       TEXT NOT NULL DEFAULT 'local',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        FOREIGN KEY (database_id, row_id) REFERENCES db_rows(database_id, id) ON DELETE CASCADE,
        FOREIGN KEY (database_id, column_id) REFERENCES db_columns(database_id, id) ON DELETE CASCADE
      );
      INSERT INTO db_relations_v135
        (id, database_id, row_id, column_id, target_kind, target_id, target_vault_id,
         position, created_at, updated_at)
      SELECT relation.id, row.database_id, relation.row_id, relation.column_id,
             relation.target_kind, relation.target_id, relation.target_vault_id,
             relation.position, relation.created_at, relation.created_at
      FROM db_relations relation
      JOIN db_rows row ON row.id = relation.row_id
      JOIN db_columns col ON col.id = relation.column_id AND col.database_id = row.database_id;
      DROP TABLE db_relations;
      ALTER TABLE db_relations_v135 RENAME TO db_relations;
      CREATE INDEX idx_db_relations_cell ON db_relations(database_id, row_id, column_id);

      ALTER TABLE db_views ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z';
      ALTER TABLE db_views ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE db_views ADD COLUMN created_by TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE db_views ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'local';
      UPDATE db_views SET updated_at = created_at WHERE updated_at = '1970-01-01T00:00:00.000Z';
    `,
    after: (db) => {
      const timestamp = new Date().toISOString();

      // One and only one primary title per database. Values are not rewritten: title
      // and rich text share their lossless text representation.
      const databases = db.prepare('SELECT id FROM db_databases ORDER BY position, created_at').all() as Array<{ id: string }>;
      const insertTitle = db.prepare(
        `INSERT INTO db_columns
          (id, database_id, name, type, position, config_json, created_at, updated_at, revision, created_by, updated_by)
         VALUES (?, ?, 'Nombre', 'title', 0, '{}', ?, ?, 1, 'migration', 'migration')`,
      );
      for (const database of databases) {
        const titles = db.prepare(
          "SELECT id FROM db_columns WHERE database_id = ? AND type = 'title' ORDER BY position, created_at, id",
        ).all(database.id) as Array<{ id: string }>;
        if (titles.length === 0) {
          db.prepare('UPDATE db_columns SET position = position + 1 WHERE database_id = ?').run(database.id);
          const suffix = createHash('sha256').update(database.id).digest('hex').slice(0, 24);
          insertTitle.run(`dcol_title_${suffix}`, database.id, timestamp, timestamp);
        } else if (titles.length > 1) {
          const demote = db.prepare(
            "UPDATE db_columns SET type = 'text', revision = revision + 1, updated_at = ?, updated_by = 'migration' WHERE id = ?",
          );
          for (const title of titles.slice(1)) demote.run(timestamp, title.id);
        }
      }
      db.exec("CREATE UNIQUE INDEX idx_db_columns_one_title ON db_columns(database_id) WHERE type = 'title'");

      const cells = db.prepare(
        `SELECT cell.row_id, cell.column_id, cell.value_text, col.type
         FROM db_cells cell JOIN db_columns col ON col.id = cell.column_id AND col.database_id = cell.database_id`,
      ).all() as Array<{ row_id: string; column_id: string; value_text: string | null; type: string }>;
      const updateCell = db.prepare(
        `UPDATE db_cells SET value_type = ?, value_number = ?, value_integer = ?, value_date = ?,
          value_json = ?, value_reference = ?, updated_by = 'migration' WHERE row_id = ? AND column_id = ?`,
      );
      for (const cell of cells) {
        if (cell.value_text == null) continue;
        const storage = databaseCellStorage(columnTypeDef(cell.type).id, cell.value_text);
        updateCell.run(
          storage.value_type, storage.value_number, storage.value_integer, storage.value_date,
          storage.value_json, storage.value_reference, cell.row_id, cell.column_id,
        );
      }

      const attachments = db.prepare(
        'SELECT id, mime_type, blob, created_at FROM db_attachments WHERE blob IS NOT NULL',
      ).all() as Array<{ id: string; mime_type: string | null; blob: Buffer; created_at: string }>;
      const insertBlob = db.prepare(
        `INSERT INTO db_blobs
          (hash, bytes, mime_type, data, revision, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'migration', 'migration', ?, ?)
         ON CONFLICT(hash) DO NOTHING`,
      );
      const linkBlob = db.prepare(
        `UPDATE db_attachments SET blob_hash = ?, content_hash = ?, blob = NULL,
          updated_at = ?, updated_by = 'migration' WHERE id = ?`,
      );
      for (const attachment of attachments) {
        const hash = createHash('sha256').update(attachment.blob).digest('hex');
        insertBlob.run(hash, attachment.blob.length, attachment.mime_type, attachment.blob, attachment.created_at, timestamp);
        linkBlob.run(hash, hash, timestamp, attachment.id);
      }
    },
  },
  {
    version: 137,
    up: /* sql */ `
      -- Notion parity, loop 4: covering indexes for the canonical typed EAV
      -- projections. Partial indexes remain compact when a property uses another type.
      CREATE INDEX idx_db_cells_text_value
        ON db_cells(database_id, column_id, value_text COLLATE NOCASE, row_id)
        WHERE value_text IS NOT NULL;
      CREATE INDEX idx_db_cells_number_value
        ON db_cells(database_id, column_id, value_number, row_id)
        WHERE value_number IS NOT NULL;
      CREATE INDEX idx_db_cells_integer_value
        ON db_cells(database_id, column_id, value_integer, row_id)
        WHERE value_integer IS NOT NULL;
      CREATE INDEX idx_db_cells_date_value
        ON db_cells(database_id, column_id, value_date, row_id)
        WHERE value_date IS NOT NULL;
      CREATE INDEX idx_db_cells_reference_value
        ON db_cells(database_id, column_id, value_reference, row_id)
        WHERE value_reference IS NOT NULL;
      CREATE INDEX idx_db_relations_target
        ON db_relations(target_kind, target_id, database_id, column_id, row_id);

      -- Materialized values are derivable, but durable: opening a 250k-row vault never
      -- has to reconstruct formula and rollup objects before showing its first page.
      CREATE TABLE db_computed_cells (
        database_id  TEXT NOT NULL,
        row_id        TEXT NOT NULL,
        column_id     TEXT NOT NULL,
        computed_kind TEXT NOT NULL CHECK (computed_kind IN ('formula', 'rollup')),
        value_type    TEXT NOT NULL DEFAULT 'text'
                      CHECK (value_type IN ('text','number','integer','date','json','reference')),
        value_text    TEXT,
        value_number  REAL,
        value_integer INTEGER,
        value_date    TEXT,
        value_json    TEXT CHECK (value_json IS NULL OR json_valid(value_json)),
        color         TEXT,
        error         TEXT,
        source_revision INTEGER NOT NULL,
        revision      INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (row_id, column_id),
        FOREIGN KEY (database_id, row_id) REFERENCES db_rows(database_id, id) ON DELETE CASCADE,
        FOREIGN KEY (database_id, column_id) REFERENCES db_columns(database_id, id) ON DELETE CASCADE,
        CHECK ((value_number IS NOT NULL) + (value_integer IS NOT NULL) +
               (value_date IS NOT NULL) + (value_json IS NOT NULL) <= 1)
      );
      CREATE INDEX idx_db_computed_column
        ON db_computed_cells(database_id, column_id, row_id);
      CREATE INDEX idx_db_computed_number
        ON db_computed_cells(database_id, column_id, value_number, row_id)
        WHERE value_number IS NOT NULL;
      CREATE INDEX idx_db_computed_date
        ON db_computed_cells(database_id, column_id, value_date, row_id)
        WHERE value_date IS NOT NULL;

      CREATE TABLE db_column_dependencies (
        source_database_id    TEXT NOT NULL,
        source_column_id      TEXT NOT NULL,
        dependent_database_id TEXT NOT NULL,
        dependent_column_id   TEXT NOT NULL,
        dependency_kind       TEXT NOT NULL CHECK (dependency_kind IN ('formula','formula_global','rollup_relation','rollup_target')),
        PRIMARY KEY (source_database_id, source_column_id, dependent_database_id, dependent_column_id, dependency_kind)
      );
      CREATE INDEX idx_db_column_dependencies_source
        ON db_column_dependencies(source_database_id, source_column_id);

      CREATE TABLE db_compute_jobs (
        id          TEXT PRIMARY KEY,
        database_id TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        status      TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
        done        INTEGER NOT NULL DEFAULT 0 CHECK (done >= 0),
        total       INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
        message     TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_db_compute_jobs_database
        ON db_compute_jobs(database_id, updated_at DESC);

      -- One ranked lexical index for database cells and extracted attachment text.
      -- Page blocks join this same index when their schema lands in loop 5.
      CREATE VIRTUAL TABLE db_search_fts USING fts5(
        content,
        entity_type UNINDEXED,
        database_id UNINDEXED,
        row_id UNINDEXED,
        column_id UNINDEXED,
        entity_id UNINDEXED,
        tokenize='unicode61 remove_diacritics 2',
        prefix='2 3 4'
      );

      INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
      SELECT CASE
               WHEN col.type = 'select' THEN COALESCE(
                 (SELECT option.label FROM db_select_options option
                  WHERE option.id = COALESCE(cell.value_reference, cell.value_text)),
                 cell.value_text, '')
               WHEN col.type = 'multi_select' AND json_valid(COALESCE(cell.value_json, cell.value_text)) THEN COALESCE(
                 (SELECT group_concat(COALESCE(option.label, item.value), ' ')
                  FROM json_each(COALESCE(cell.value_json, cell.value_text)) item
                  LEFT JOIN db_select_options option ON option.id = item.value),
                 cell.value_text, '')
               ELSE COALESCE(cell.value_text, '')
             END,
             'cell', cell.database_id, cell.row_id, cell.column_id,
             cell.row_id || ':' || cell.column_id
      FROM db_cells cell
      JOIN db_columns col ON col.id = cell.column_id AND col.database_id = cell.database_id;

      INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
      SELECT trim(COALESCE(file_name, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(extracted_text, '')),
             'attachment', database_id, row_id, column_id, id
      FROM db_attachments;

      CREATE TRIGGER db_cells_search_ai AFTER INSERT ON db_cells BEGIN
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        VALUES (COALESCE(new.value_text, ''), 'cell', new.database_id, new.row_id, new.column_id,
                new.row_id || ':' || new.column_id);
      END;
      CREATE TRIGGER db_cells_search_au AFTER UPDATE ON db_cells BEGIN
        DELETE FROM db_search_fts WHERE entity_type = 'cell' AND entity_id = old.row_id || ':' || old.column_id;
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        VALUES (COALESCE(new.value_text, ''), 'cell', new.database_id, new.row_id, new.column_id,
                new.row_id || ':' || new.column_id);
      END;
      CREATE TRIGGER db_cells_search_ad AFTER DELETE ON db_cells BEGIN
        DELETE FROM db_search_fts WHERE entity_type = 'cell' AND entity_id = old.row_id || ':' || old.column_id;
      END;
      CREATE TRIGGER db_computed_cells_search_ai AFTER INSERT ON db_computed_cells BEGIN
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        VALUES (COALESCE(new.value_text, ''), 'computed', new.database_id, new.row_id, new.column_id,
                new.row_id || ':' || new.column_id);
      END;
      CREATE TRIGGER db_computed_cells_search_au AFTER UPDATE ON db_computed_cells BEGIN
        DELETE FROM db_search_fts WHERE entity_type = 'computed' AND entity_id = old.row_id || ':' || old.column_id;
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        VALUES (COALESCE(new.value_text, ''), 'computed', new.database_id, new.row_id, new.column_id,
                new.row_id || ':' || new.column_id);
      END;
      CREATE TRIGGER db_computed_cells_search_ad AFTER DELETE ON db_computed_cells BEGIN
        DELETE FROM db_search_fts WHERE entity_type = 'computed' AND entity_id = old.row_id || ':' || old.column_id;
      END;
      CREATE TRIGGER db_attachments_search_ai AFTER INSERT ON db_attachments BEGIN
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        VALUES (trim(COALESCE(new.file_name, '') || ' ' || COALESCE(new.description, '') || ' ' || COALESCE(new.extracted_text, '')),
                'attachment', new.database_id, new.row_id, new.column_id, new.id);
      END;
      CREATE TRIGGER db_attachments_search_au AFTER UPDATE ON db_attachments BEGIN
        DELETE FROM db_search_fts WHERE entity_type = 'attachment' AND entity_id = old.id;
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        VALUES (trim(COALESCE(new.file_name, '') || ' ' || COALESCE(new.description, '') || ' ' || COALESCE(new.extracted_text, '')),
                'attachment', new.database_id, new.row_id, new.column_id, new.id);
      END;
      CREATE TRIGGER db_attachments_search_ad AFTER DELETE ON db_attachments BEGIN
        DELETE FROM db_search_fts WHERE entity_type = 'attachment' AND entity_id = old.id;
      END;
    `,
  },
  {
    version: 138,
    up: /* sql */ `
      -- Notion parity, loop 5: every database row and legacy note has one universal
      -- page. Independent pages use the same table and therefore the same editor,
      -- search projection, export and future collaboration stream.
      ALTER TABLE notes ADD COLUMN page_markdown_hash TEXT;

      CREATE TABLE pages (
        id              TEXT PRIMARY KEY,
        row_id          TEXT UNIQUE REFERENCES db_rows(id) ON DELETE CASCADE,
        note_id         TEXT UNIQUE REFERENCES notes(id) ON DELETE CASCADE,
        parent_page_id  TEXT REFERENCES pages(id) ON DELETE SET NULL,
        origin          TEXT NOT NULL CHECK (origin IN ('standalone','database_row','note')),
        title           TEXT NOT NULL DEFAULT '',
        icon            TEXT,
        cover_blob_hash TEXT REFERENCES db_blobs(hash) ON DELETE SET NULL,
        state           TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','trashed')),
        locked          INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0,1)),
        full_width      INTEGER NOT NULL DEFAULT 0 CHECK (full_width IN (0,1)),
        revision        INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by      TEXT NOT NULL DEFAULT 'local',
        updated_by      TEXT NOT NULL DEFAULT 'local',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        CHECK ((origin = 'database_row' AND row_id IS NOT NULL AND note_id IS NULL) OR
               (origin = 'note' AND note_id IS NOT NULL AND row_id IS NULL) OR
               (origin = 'standalone' AND row_id IS NULL AND note_id IS NULL))
      );
      CREATE INDEX idx_pages_parent ON pages(parent_page_id, state, updated_at DESC);
      CREATE INDEX idx_pages_row ON pages(row_id) WHERE row_id IS NOT NULL;
      CREATE INDEX idx_pages_note ON pages(note_id) WHERE note_id IS NOT NULL;

      CREATE TABLE page_blocks (
        id              TEXT PRIMARY KEY,
        page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        parent_block_id TEXT,
        sort_order      REAL NOT NULL,
        type            TEXT NOT NULL CHECK (type IN (
          'paragraph','heading_1','heading_2','heading_3','bulleted_list','numbered_list',
          'task','toggle','quote','callout','divider','code','equation','table','columns',
          'image','file','audio','video','bookmark','embed','subpage','mention',
          'synced_block','database_view','markdown'
        )),
        content_json    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(content_json)),
        normalized_text TEXT NOT NULL DEFAULT '',
        revision        INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by      TEXT NOT NULL DEFAULT 'local',
        updated_by      TEXT NOT NULL DEFAULT 'local',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        trashed_at      TEXT,
        UNIQUE (page_id, id),
        FOREIGN KEY (page_id, parent_block_id) REFERENCES page_blocks(page_id, id) ON DELETE CASCADE,
        CHECK (parent_block_id IS NULL OR parent_block_id <> id)
      );
      CREATE INDEX idx_page_blocks_page_order ON page_blocks(page_id, parent_block_id, sort_order, id);
      CREATE INDEX idx_page_blocks_updated ON page_blocks(page_id, updated_at DESC);

      CREATE TABLE page_block_blobs (
        block_id  TEXT NOT NULL REFERENCES page_blocks(id) ON DELETE CASCADE,
        blob_hash TEXT NOT NULL REFERENCES db_blobs(hash) ON DELETE RESTRICT,
        role      TEXT NOT NULL DEFAULT 'content',
        created_at TEXT NOT NULL,
        PRIMARY KEY (block_id, blob_hash, role)
      );
      CREATE INDEX idx_page_block_blobs_hash ON page_block_blobs(blob_hash, block_id);

      CREATE TABLE page_documents (
        page_id              TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
        revision             INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        snapshot_sequence    INTEGER NOT NULL DEFAULT 0 CHECK (snapshot_sequence >= 0),
        next_update_sequence INTEGER NOT NULL DEFAULT 1 CHECK (next_update_sequence >= 1),
        snapshot_blob        BLOB NOT NULL,
        state_vector         BLOB NOT NULL,
        markdown_hash        TEXT NOT NULL,
        update_count         INTEGER NOT NULL DEFAULT 0 CHECK (update_count >= 0),
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL
      );

      CREATE TABLE page_document_updates (
        id          TEXT PRIMARY KEY,
        page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        sequence_no INTEGER NOT NULL CHECK (sequence_no >= 1),
        update_blob BLOB NOT NULL,
        actor_id    TEXT NOT NULL,
        client_id   TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        UNIQUE (page_id, sequence_no)
      );
      CREATE INDEX idx_page_document_updates_page ON page_document_updates(page_id, sequence_no);

      CREATE TABLE page_document_snapshots (
        id              TEXT PRIMARY KEY,
        page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        sequence_no     INTEGER NOT NULL CHECK (sequence_no >= 0),
        revision        INTEGER NOT NULL CHECK (revision >= 1),
        snapshot_blob   BLOB NOT NULL,
        state_vector    BLOB NOT NULL,
        markdown_hash   TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        UNIQUE (page_id, sequence_no)
      );
      CREATE INDEX idx_page_document_snapshots_page ON page_document_snapshots(page_id, sequence_no DESC);

      CREATE TABLE page_migration_reports (
        id                    TEXT PRIMARY KEY,
        pages_created         INTEGER NOT NULL,
        notes_converted       INTEGER NOT NULL,
        raw_markdown_blocks   INTEGER NOT NULL,
        created_at            TEXT NOT NULL
      );

      INSERT INTO pages
        (id, row_id, note_id, parent_page_id, origin, title, icon, cover_blob_hash, state,
         locked, full_width, revision, created_by, updated_by, created_at, updated_at)
      SELECT 'row:' || row.id, row.id, NULL, NULL, 'database_row',
             COALESCE((
               SELECT cell.value_text
               FROM db_columns col
               LEFT JOIN db_cells cell ON cell.database_id = row.database_id
                 AND cell.row_id = row.id AND cell.column_id = col.id
               WHERE col.database_id = row.database_id AND col.type = 'title'
               ORDER BY col.position, col.id LIMIT 1
             ), ''),
             NULL, NULL, 'active', 0, 0, row.revision, row.created_by, row.updated_by,
             row.created_at, row.updated_at
      FROM db_rows row;

      INSERT INTO pages
        (id, row_id, note_id, parent_page_id, origin, title, icon, cover_blob_hash, state,
         locked, full_width, revision, created_by, updated_by, created_at, updated_at)
      SELECT 'note:' || note.id, NULL, note.id, NULL, 'note', note.title,
             NULL, NULL, CASE WHEN note.trashed_at IS NULL THEN 'active' ELSE 'trashed' END,
             0, 0, 1, 'migration', 'migration', note.created_at, note.updated_at
      FROM notes note;

      -- Deterministic identities let every existing repository gain page semantics
      -- without being rewritten at once.
      CREATE TRIGGER pages_db_rows_ai AFTER INSERT ON db_rows BEGIN
        INSERT OR IGNORE INTO pages
          (id, row_id, origin, title, created_at, updated_at, revision, created_by, updated_by)
        VALUES ('row:' || new.id, new.id, 'database_row', '', new.created_at, new.updated_at,
                new.revision, new.created_by, new.updated_by);
      END;
      CREATE TRIGGER pages_notes_ai AFTER INSERT ON notes BEGIN
        INSERT OR IGNORE INTO pages
          (id, note_id, origin, title, state, created_at, updated_at, created_by, updated_by)
        VALUES ('note:' || new.id, new.id, 'note', new.title,
                CASE WHEN new.trashed_at IS NULL THEN 'active' ELSE 'trashed' END,
                new.created_at, new.updated_at, 'local', 'local');
      END;
      CREATE TRIGGER pages_notes_au AFTER UPDATE OF title, trashed_at ON notes BEGIN
        UPDATE pages SET title = new.title,
          state = CASE WHEN new.trashed_at IS NULL THEN 'active' ELSE 'trashed' END,
          revision = revision + 1, updated_at = new.updated_at, updated_by = 'local'
        WHERE note_id = new.id;
      END;
      CREATE TRIGGER pages_title_cell_ai AFTER INSERT ON db_cells
      WHEN EXISTS (SELECT 1 FROM db_columns col WHERE col.id = new.column_id AND col.type = 'title') BEGIN
        UPDATE pages SET title = COALESCE(new.value_text, ''), revision = revision + 1,
          updated_at = new.updated_at, updated_by = new.updated_by WHERE row_id = new.row_id;
      END;
      CREATE TRIGGER pages_title_cell_au AFTER UPDATE OF value_text ON db_cells
      WHEN EXISTS (SELECT 1 FROM db_columns col WHERE col.id = new.column_id AND col.type = 'title') BEGIN
        UPDATE pages SET title = COALESCE(new.value_text, ''), revision = revision + 1,
          updated_at = new.updated_at, updated_by = new.updated_by WHERE row_id = new.row_id;
      END;

      -- Page blocks share the ranked FTS index introduced in loop 4. Database-row pages
      -- carry database_id/row_id; independent pages and notes remain globally searchable.
      CREATE TRIGGER page_blocks_search_ai AFTER INSERT ON page_blocks BEGIN
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        SELECT new.normalized_text, 'page_block', row.database_id, page.row_id, NULL, new.id
        FROM pages page LEFT JOIN db_rows row ON row.id = page.row_id WHERE page.id = new.page_id;
      END;
      CREATE TRIGGER page_blocks_search_au AFTER UPDATE ON page_blocks BEGIN
        DELETE FROM db_search_fts WHERE entity_type = 'page_block' AND entity_id = old.id;
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        SELECT new.normalized_text, 'page_block', row.database_id, page.row_id, NULL, new.id
        FROM pages page LEFT JOIN db_rows row ON row.id = page.row_id
        WHERE page.id = new.page_id AND new.trashed_at IS NULL;
      END;
      CREATE TRIGGER page_blocks_search_ad AFTER DELETE ON page_blocks BEGIN
        DELETE FROM db_search_fts WHERE entity_type = 'page_block' AND entity_id = old.id;
      END;
    `,
    after: (db) => {
      migrateUniversalPages(db);
      const counts = db.prepare(
        `SELECT (SELECT COUNT(*) FROM pages) AS pages,
                (SELECT COUNT(*) FROM pages WHERE note_id IS NOT NULL) AS notes,
                (SELECT COUNT(*) FROM page_blocks WHERE type = 'markdown') AS raw`,
      ).get() as { pages: number; notes: number; raw: number };
      db.prepare(
        `INSERT INTO page_migration_reports
          (id, pages_created, notes_converted, raw_markdown_blocks, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(`page-migration-${Date.now()}`, counts.pages, counts.notes, counts.raw, new Date().toISOString());
    },
  },
  {
    version: 139,
    up: /* sql */ `
      -- Notion parity, loop 5: SQL-created row/note pages must receive their Yjs
      -- document and initial snapshot in the same transaction as the owning record.
      DROP TRIGGER pages_db_rows_ai;
      CREATE TRIGGER pages_db_rows_ai AFTER INSERT ON db_rows BEGIN
        INSERT OR IGNORE INTO pages
          (id, row_id, origin, title, created_at, updated_at, revision, created_by, updated_by)
        VALUES ('row:' || new.id, new.id, 'database_row', '', new.created_at, new.updated_at,
                new.revision, new.created_by, new.updated_by);
        INSERT OR IGNORE INTO page_documents
          (page_id, revision, snapshot_sequence, next_update_sequence, snapshot_blob, state_vector,
           markdown_hash, update_count, created_at, updated_at)
        VALUES ('row:' || new.id, 1, 0, 1, X'', X'',
                'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0,
                new.created_at, new.updated_at);
        INSERT OR IGNORE INTO page_document_snapshots
          (id, page_id, sequence_no, revision, snapshot_blob, state_vector, markdown_hash, created_at)
        VALUES ('initial-row:' || new.id, 'row:' || new.id, 0, 1, X'', X'',
                'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', new.created_at);
      END;

      DROP TRIGGER pages_notes_ai;
      CREATE TRIGGER pages_notes_ai AFTER INSERT ON notes BEGIN
        INSERT OR IGNORE INTO pages
          (id, note_id, origin, title, state, created_at, updated_at, created_by, updated_by)
        VALUES ('note:' || new.id, new.id, 'note', new.title,
                CASE WHEN new.trashed_at IS NULL THEN 'active' ELSE 'trashed' END,
                new.created_at, new.updated_at, 'local', 'local');
        INSERT OR IGNORE INTO page_documents
          (page_id, revision, snapshot_sequence, next_update_sequence, snapshot_blob, state_vector,
           markdown_hash, update_count, created_at, updated_at)
        VALUES ('note:' || new.id, 1, 0, 1, X'', X'',
                'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0,
                new.created_at, new.updated_at);
        INSERT OR IGNORE INTO page_document_snapshots
          (id, page_id, sequence_no, revision, snapshot_blob, state_vector, markdown_hash, created_at)
        VALUES ('initial-note:' || new.id, 'note:' || new.id, 0, 1, X'', X'',
                'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', new.created_at);
      END;
    `,
    after: (db) => backfillUniversalPageDocuments(db),
  },
  {
    version: 140,
    up: /* sql */ `
      -- Notion parity, loop 6: wiki navigation, favourites and materialized links.
      CREATE TABLE page_favorites (
        page_id    TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
        position   REAL NOT NULL DEFAULT 1024,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_page_favorites_position ON page_favorites(position, page_id);

      CREATE TABLE page_links (
        id              TEXT PRIMARY KEY,
        source_page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        source_block_id TEXT NOT NULL REFERENCES page_blocks(id) ON DELETE CASCADE,
        target_page_id  TEXT,
        target_block_id TEXT,
        kind            TEXT NOT NULL CHECK (kind IN ('subpage','mention','synced_block')),
        label           TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL
      );
      CREATE INDEX idx_page_links_target_page ON page_links(target_page_id, kind, source_page_id);
      CREATE INDEX idx_page_links_target_block ON page_links(target_block_id, kind, source_page_id);
      CREATE UNIQUE INDEX idx_page_links_source_target
        ON page_links(source_page_id, source_block_id, kind, COALESCE(target_page_id, ''), COALESCE(target_block_id, ''));

      CREATE TRIGGER pages_search_ai AFTER INSERT ON pages BEGIN
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        SELECT new.title, 'page_title', row.database_id, new.row_id, NULL, new.id
        FROM (SELECT 1) seed LEFT JOIN db_rows row ON row.id = new.row_id
        WHERE new.state = 'active';
      END;
      CREATE TRIGGER pages_search_au AFTER UPDATE OF title, state, row_id ON pages BEGIN
        DELETE FROM db_search_fts WHERE entity_type = 'page_title' AND entity_id = old.id;
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        SELECT new.title, 'page_title', row.database_id, new.row_id, NULL, new.id
        FROM (SELECT 1) seed LEFT JOIN db_rows row ON row.id = new.row_id
        WHERE new.state = 'active';
      END;
      CREATE TRIGGER pages_search_ad AFTER DELETE ON pages BEGIN
        DELETE FROM db_search_fts WHERE entity_type = 'page_title' AND entity_id = old.id;
      END;
      INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
      SELECT page.title, 'page_title', row.database_id, page.row_id, NULL, page.id
      FROM pages page LEFT JOIN db_rows row ON row.id = page.row_id WHERE page.state = 'active';
    `,
  },
  {
    version: 141,
    up: /* sql */ `
      -- Notion parity, loop 7: status lanes and immutable per-database row sequences.
      -- All structured property payloads continue travelling through typed db_cells, so
      -- legacy value_text readers remain valid and no cell rewrite is necessary.
      ALTER TABLE db_select_options ADD COLUMN group_key TEXT
        CHECK (group_key IS NULL OR group_key IN ('pending','in_progress','complete'));
      ALTER TABLE db_rows ADD COLUMN unique_sequence INTEGER NOT NULL DEFAULT 0
        CHECK (unique_sequence >= 0);
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY database_id ORDER BY position, created_at, id) AS sequence
        FROM db_rows
      )
      UPDATE db_rows SET unique_sequence = (SELECT sequence FROM ranked WHERE ranked.id = db_rows.id);
      CREATE UNIQUE INDEX idx_db_rows_unique_sequence
        ON db_rows(database_id, unique_sequence) WHERE unique_sequence > 0;
    `,
  },
  {
    version: 142,
    up: /* sql */ `
      -- Notion parity, loop 8: durable bidirectional links and assisted repair.
      ALTER TABLE db_relations ADD COLUMN inverse_relation_id TEXT;
      ALTER TABLE db_relations ADD COLUMN last_known_label TEXT;
      UPDATE db_relations SET last_known_label = target_id WHERE last_known_label IS NULL;
      CREATE UNIQUE INDEX idx_db_relations_unique_target
        ON db_relations(row_id, column_id, target_kind, target_id, COALESCE(target_vault_id, ''));
      CREATE INDEX idx_db_relations_inverse ON db_relations(inverse_relation_id);

      ALTER TABLE db_column_dependencies RENAME TO db_column_dependencies_v140;
      DROP INDEX idx_db_column_dependencies_source;
      CREATE TABLE db_column_dependencies (
        source_database_id    TEXT NOT NULL,
        source_column_id      TEXT NOT NULL,
        dependent_database_id TEXT NOT NULL,
        dependent_column_id   TEXT NOT NULL,
        dependency_kind       TEXT NOT NULL CHECK (dependency_kind IN
          ('formula','formula_global','formula_relation_target','rollup_relation','rollup_target')),
        PRIMARY KEY (source_database_id, source_column_id, dependent_database_id, dependent_column_id, dependency_kind)
      );
      INSERT INTO db_column_dependencies SELECT * FROM db_column_dependencies_v140;
      DROP TABLE db_column_dependencies_v140;
      CREATE INDEX idx_db_column_dependencies_source
        ON db_column_dependencies(source_database_id, source_column_id);

      CREATE TABLE db_relation_repairs (
        id                   TEXT PRIMARY KEY,
        relation_id          TEXT NOT NULL,
        old_target_id        TEXT NOT NULL,
        new_target_id        TEXT,
        action               TEXT NOT NULL CHECK (action IN ('repair','cleanup','cascade')),
        actor                TEXT NOT NULL DEFAULT 'local',
        created_at           TEXT NOT NULL
      );
      CREATE INDEX idx_db_relation_repairs_relation ON db_relation_repairs(relation_id, created_at);
    `,
  },
  {
    version: 143,
    up: /* sql */ `
      -- Notion parity, loop 9: one complete, versioned configuration per saved view.
      -- The legacy layout/filter/sort columns remain as round-trip adapters for old
      -- backups, MCP clients and .nodussync readers.
      ALTER TABLE db_views ADD COLUMN config_version INTEGER NOT NULL DEFAULT 2 CHECK (config_version >= 1);
      ALTER TABLE db_views ADD COLUMN config_json TEXT;
      ALTER TABLE db_views ADD COLUMN scope TEXT NOT NULL DEFAULT 'shared'
        CHECK (scope IN ('personal','shared'));
      ALTER TABLE db_views ADD COLUMN owner_actor_id TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE db_views ADD COLUMN edit_permission TEXT NOT NULL DEFAULT 'editors'
        CHECK (edit_permission IN ('owner','editors','everyone'));
      ALTER TABLE db_views ADD COLUMN source_view_id TEXT REFERENCES db_views(id) ON DELETE SET NULL;
      CREATE INDEX idx_db_views_scope_owner ON db_views(database_id, scope, owner_actor_id, position);
      CREATE INDEX idx_db_views_source ON db_views(source_view_id);

      CREATE TABLE db_view_revisions (
        id          TEXT PRIMARY KEY,
        view_id     TEXT NOT NULL REFERENCES db_views(id) ON DELETE CASCADE,
        revision    INTEGER NOT NULL CHECK (revision >= 1),
        name        TEXT NOT NULL,
        config_json TEXT NOT NULL,
        reason      TEXT NOT NULL CHECK (reason IN ('create','update','restore','reorder')),
        actor_id    TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        UNIQUE(view_id, revision)
      );
      CREATE INDEX idx_db_view_revisions_view ON db_view_revisions(view_id, revision DESC);
    `,
    after: (db) => {
      const rows = db.prepare(
        `SELECT id, name, layout, filter_json, sort_json, revision, created_by, created_at
         FROM db_views ORDER BY database_id, position, created_at`,
      ).all() as Array<{
        id: string;
        name: string;
        layout: string;
        filter_json: string | null;
        sort_json: string | null;
        revision: number;
        created_by: string;
        created_at: string;
      }>;
      const parse = <T>(json: string | null, fallback: T): T => {
        if (!json) return fallback;
        try { return JSON.parse(json) as T; } catch { return fallback; }
      };
      const update = db.prepare('UPDATE db_views SET config_json = ? WHERE id = ?');
      const insertRevision = db.prepare(
        `INSERT INTO db_view_revisions
          (id, view_id, revision, name, config_json, reason, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'create', ?, ?)`,
      );
      for (const row of rows) {
        const filter = parse(row.filter_json, { conjunction: 'and' as const, conditions: [] });
        const sorts = parse(row.sort_json, []);
        const config = normalizeDatabaseViewConfig(null, { layout: row.layout, filter, sorts });
        const json = JSON.stringify(config);
        update.run(json, row.id);
        insertRevision.run(`dviewrev_migration_${row.id}`, row.id, row.revision, row.name, json, row.created_by, row.created_at);
      }
    },
  },
  {
    version: 144,
    up: /* sql */ `
      -- Notion parity, loop 13: views are visual containers; databases remain fully
      -- compatible local data sources and may be combined without copying their rows.
      CREATE TABLE db_data_sources (
        id          TEXT PRIMARY KEY,
        database_id TEXT NOT NULL UNIQUE REFERENCES db_databases(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'local_database' CHECK (kind = 'local_database'),
        revision    INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by  TEXT NOT NULL DEFAULT 'local',
        updated_by  TEXT NOT NULL DEFAULT 'local',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX idx_db_data_sources_database ON db_data_sources(database_id);

      CREATE TABLE db_view_sources (
        view_id           TEXT NOT NULL REFERENCES db_views(id) ON DELETE CASCADE,
        source_id         TEXT NOT NULL REFERENCES db_data_sources(id) ON DELETE CASCADE,
        alias             TEXT NOT NULL,
        position          INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
        is_primary        INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
        property_map_json TEXT NOT NULL DEFAULT '{}',
        revision          INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by        TEXT NOT NULL DEFAULT 'local',
        updated_by        TEXT NOT NULL DEFAULT 'local',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        PRIMARY KEY (view_id, source_id)
      );
      CREATE UNIQUE INDEX idx_db_view_sources_position ON db_view_sources(view_id, position);
      CREATE UNIQUE INDEX idx_db_view_sources_primary ON db_view_sources(view_id) WHERE is_primary = 1;
      CREATE INDEX idx_db_view_sources_source ON db_view_sources(source_id, view_id);

      INSERT INTO db_data_sources
        (id, database_id, name, kind, revision, created_by, updated_by, created_at, updated_at)
      SELECT 'dsrc_' || id, id, name, 'local_database', revision, created_by, updated_by, created_at, updated_at
      FROM db_databases;

      INSERT INTO db_view_sources
        (view_id, source_id, alias, position, is_primary, property_map_json,
         revision, created_by, updated_by, created_at, updated_at)
      SELECT view.id, source.id, source.name, 0, 1, '{}', 1,
             view.created_by, view.updated_by, view.created_at, view.updated_at
      FROM db_views view JOIN db_data_sources source ON source.database_id = view.database_id;
    `,
  },
  {
    version: 145,
    up: /* sql */ `
      -- Notion parity, loop 14: reusable row/page templates, idempotent schedules,
      -- nested subitems, acyclic task dependencies, and first-class sprints.
      CREATE TABLE db_row_templates (
        id                     TEXT PRIMARY KEY,
        database_id            TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        name                   TEXT NOT NULL CHECK (length(trim(name)) > 0),
        icon                   TEXT,
        cover_blob_hash        TEXT REFERENCES db_blobs(hash) ON DELETE SET NULL,
        properties_json        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(properties_json) AND json_type(properties_json) = 'object'),
        blocks_json            TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(blocks_json) AND json_type(blocks_json) = 'array'),
        default_relations_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(default_relations_json) AND json_type(default_relations_json) = 'array'),
        recurrence             TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','daily','weekly','monthly','yearly')),
        time_zone              TEXT NOT NULL DEFAULT 'UTC',
        next_run_at            TEXT,
        revision               INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by             TEXT NOT NULL DEFAULT 'local',
        updated_by             TEXT NOT NULL DEFAULT 'local',
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL
      );
      CREATE INDEX idx_db_row_templates_database ON db_row_templates(database_id, name COLLATE NOCASE);
      CREATE INDEX idx_db_row_templates_due ON db_row_templates(next_run_at) WHERE recurrence <> 'none' AND next_run_at IS NOT NULL;

      CREATE TABLE db_template_runs (
        template_id   TEXT NOT NULL REFERENCES db_row_templates(id) ON DELETE CASCADE,
        occurrence_key TEXT NOT NULL,
        row_id        TEXT NOT NULL,
        scheduled_at  TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        PRIMARY KEY (template_id, occurrence_key)
      );
      CREATE INDEX idx_db_template_runs_row ON db_template_runs(row_id);

      CREATE TABLE db_row_hierarchy (
        database_id  TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        row_id       TEXT NOT NULL,
        parent_row_id TEXT,
        sort_order   REAL NOT NULL DEFAULT 1024,
        collapsed    INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0,1)),
        revision     INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        updated_by   TEXT NOT NULL DEFAULT 'local',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        PRIMARY KEY (database_id, row_id),
        FOREIGN KEY (database_id, row_id) REFERENCES db_rows(database_id, id) ON DELETE CASCADE,
        FOREIGN KEY (database_id, parent_row_id) REFERENCES db_rows(database_id, id) ON DELETE CASCADE,
        CHECK (parent_row_id IS NULL OR parent_row_id <> row_id)
      );
      CREATE INDEX idx_db_row_hierarchy_parent ON db_row_hierarchy(database_id, parent_row_id, sort_order, row_id);

      CREATE TABLE db_row_dependencies (
        id                 TEXT PRIMARY KEY,
        database_id        TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        predecessor_row_id TEXT NOT NULL,
        successor_row_id   TEXT NOT NULL,
        lag_days           INTEGER NOT NULL DEFAULT 0 CHECK (lag_days BETWEEN -3650 AND 3650),
        revision           INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by         TEXT NOT NULL DEFAULT 'local',
        updated_by         TEXT NOT NULL DEFAULT 'local',
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        UNIQUE (database_id, predecessor_row_id, successor_row_id),
        FOREIGN KEY (database_id, predecessor_row_id) REFERENCES db_rows(database_id, id) ON DELETE CASCADE,
        FOREIGN KEY (database_id, successor_row_id) REFERENCES db_rows(database_id, id) ON DELETE CASCADE,
        CHECK (predecessor_row_id <> successor_row_id)
      );
      CREATE INDEX idx_db_row_dependencies_predecessor ON db_row_dependencies(database_id, predecessor_row_id);
      CREATE INDEX idx_db_row_dependencies_successor ON db_row_dependencies(database_id, successor_row_id);

      CREATE TABLE db_task_configs (
        database_id       TEXT PRIMARY KEY REFERENCES db_databases(id) ON DELETE CASCADE,
        date_column_id    TEXT REFERENCES db_columns(id) ON DELETE SET NULL,
        status_column_id  TEXT REFERENCES db_columns(id) ON DELETE SET NULL,
        sprint_column_id  TEXT REFERENCES db_columns(id) ON DELETE SET NULL,
        subitem_view      TEXT NOT NULL DEFAULT 'nested' CHECK (subitem_view IN ('nested','flat')),
        avoid_weekends    INTEGER NOT NULL DEFAULT 0 CHECK (avoid_weekends IN (0,1)),
        shift_dependents  INTEGER NOT NULL DEFAULT 1 CHECK (shift_dependents IN (0,1)),
        revision          INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        updated_by        TEXT NOT NULL DEFAULT 'local',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );

      CREATE TABLE db_sprints (
        id          TEXT PRIMARY KEY,
        database_id TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
        start_at    TEXT NOT NULL,
        end_at      TEXT NOT NULL,
        state       TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','active','completed')),
        revision    INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by  TEXT NOT NULL DEFAULT 'local',
        updated_by  TEXT NOT NULL DEFAULT 'local',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        CHECK (start_at <= end_at)
      );
      CREATE INDEX idx_db_sprints_database ON db_sprints(database_id, start_at DESC);

      CREATE TABLE db_sprint_rows (
        sprint_id TEXT NOT NULL REFERENCES db_sprints(id) ON DELETE CASCADE,
        row_id    TEXT NOT NULL REFERENCES db_rows(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (sprint_id, row_id)
      );
      CREATE INDEX idx_db_sprint_rows_row ON db_sprint_rows(row_id, sprint_id);
    `,
  },
  {
    version: 146,
    up: /* sql */ `
      -- Notion parity, loop 15: versioned automations, idempotent execution logs,
      -- durable notifications, and transactional public/authenticated forms.
      CREATE TABLE automation_rules (
        id             TEXT PRIMARY KEY,
        database_id    TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        version        INTEGER NOT NULL DEFAULT 1 CHECK (version = 1),
        name           TEXT NOT NULL CHECK (length(trim(name)) > 0),
        enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        trigger_json   TEXT NOT NULL CHECK (json_valid(trigger_json) AND json_type(trigger_json) = 'object'),
        condition_json TEXT CHECK (condition_json IS NULL OR json_valid(condition_json)),
        actions_json   TEXT NOT NULL CHECK (json_valid(actions_json) AND json_type(actions_json) = 'array'),
        variables_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(variables_json) AND json_type(variables_json) = 'object'),
        max_depth      INTEGER NOT NULL DEFAULT 5 CHECK (max_depth BETWEEN 1 AND 20),
        max_attempts   INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
        retry_delay_ms INTEGER NOT NULL DEFAULT 250 CHECK (retry_delay_ms BETWEEN 0 AND 60000),
        revision       INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by     TEXT NOT NULL DEFAULT 'local',
        updated_by     TEXT NOT NULL DEFAULT 'local',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX idx_automation_rules_database ON automation_rules(database_id, enabled, name COLLATE NOCASE);
      CREATE INDEX idx_automation_rules_trigger ON automation_rules(database_id, enabled, json_extract(trigger_json, '$.type'));
      CREATE INDEX idx_automation_rules_schedule ON automation_rules(json_extract(trigger_json, '$.nextRunAt'))
        WHERE enabled = 1 AND json_extract(trigger_json, '$.type') = 'schedule';

      CREATE TABLE automation_runs (
        id                TEXT PRIMARY KEY,
        rule_id           TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
        database_id       TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        row_id            TEXT REFERENCES db_rows(id) ON DELETE SET NULL,
        event_key         TEXT NOT NULL,
        status            TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','skipped')),
        depth             INTEGER NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 20),
        attempt           INTEGER NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 10),
        actions_completed INTEGER NOT NULL DEFAULT 0 CHECK (actions_completed >= 0),
        output_json       TEXT NOT NULL DEFAULT 'null' CHECK (json_valid(output_json)),
        error             TEXT,
        started_at        TEXT NOT NULL,
        finished_at       TEXT,
        UNIQUE (rule_id, event_key)
      );
      CREATE INDEX idx_automation_runs_database ON automation_runs(database_id, started_at DESC);
      CREATE INDEX idx_automation_runs_rule ON automation_runs(rule_id, started_at DESC);

      CREATE TABLE automation_notifications (
        id          TEXT PRIMARY KEY,
        rule_id     TEXT REFERENCES automation_rules(id) ON DELETE SET NULL,
        run_id      TEXT REFERENCES automation_runs(id) ON DELETE SET NULL,
        database_id TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        row_id      TEXT REFERENCES db_rows(id) ON DELETE SET NULL,
        title       TEXT NOT NULL,
        body        TEXT NOT NULL DEFAULT '',
        is_read     INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_automation_notifications_unread ON automation_notifications(is_read, created_at DESC);

      CREATE TABLE database_forms (
        id                 TEXT PRIMARY KEY,
        database_id        TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        version            INTEGER NOT NULL DEFAULT 1 CHECK (version = 1),
        name               TEXT NOT NULL CHECK (length(trim(name)) > 0),
        slug               TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 64),
        title              TEXT NOT NULL,
        description        TEXT NOT NULL DEFAULT '',
        access             TEXT NOT NULL DEFAULT 'public' CHECK (access IN ('public','authenticated')),
        auth_token_hash    TEXT,
        confirmation_title TEXT NOT NULL DEFAULT 'Enviado',
        confirmation_body TEXT NOT NULL DEFAULT 'Tu respuesta se ha guardado.',
        rate_limit_count   INTEGER NOT NULL DEFAULT 10 CHECK (rate_limit_count BETWEEN 1 AND 1000),
        rate_limit_minutes INTEGER NOT NULL DEFAULT 60 CHECK (rate_limit_minutes BETWEEN 1 AND 10080),
        enabled            INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        revision           INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by         TEXT NOT NULL DEFAULT 'local',
        updated_by         TEXT NOT NULL DEFAULT 'local',
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL,
        CHECK (access = 'public' OR auth_token_hash IS NOT NULL)
      );
      CREATE INDEX idx_database_forms_database ON database_forms(database_id, name COLLATE NOCASE);

      CREATE TABLE database_form_fields (
        id          TEXT PRIMARY KEY,
        form_id     TEXT NOT NULL REFERENCES database_forms(id) ON DELETE CASCADE,
        column_id   TEXT NOT NULL REFERENCES db_columns(id) ON DELETE CASCADE,
        label       TEXT NOT NULL,
        description TEXT,
        required    INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
        position    INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
        width       TEXT NOT NULL DEFAULT 'full' CHECK (width IN ('full','half')),
        revision    INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE (form_id, column_id),
        UNIQUE (form_id, position)
      );
      CREATE INDEX idx_database_form_fields_column ON database_form_fields(column_id, form_id);

      CREATE TABLE database_form_submissions (
        id          TEXT PRIMARY KEY,
        form_id     TEXT NOT NULL REFERENCES database_forms(id) ON DELETE CASCADE,
        row_id      TEXT NOT NULL REFERENCES db_rows(id) ON DELETE CASCADE,
        status      TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','rejected')),
        source      TEXT NOT NULL DEFAULT 'local-http',
        values_json TEXT NOT NULL CHECK (json_valid(values_json) AND json_type(values_json) = 'object'),
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_database_form_submissions_form ON database_form_submissions(form_id, created_at DESC);

      CREATE TABLE database_form_rate_limits (
        form_id      TEXT NOT NULL REFERENCES database_forms(id) ON DELETE CASCADE,
        fingerprint  TEXT NOT NULL,
        window_start TEXT NOT NULL,
        submissions  INTEGER NOT NULL DEFAULT 0 CHECK (submissions >= 0),
        PRIMARY KEY (form_id, fingerprint, window_start)
      );
      CREATE INDEX idx_database_form_rate_limits_window ON database_form_rate_limits(window_start);
    `,
  },
  {
    version: 147,
    up: /* sql */ `
      -- Notion parity, loop 16A: append-only page history. Every mutation stores a
      -- compact delta and every twentieth revision stores a complete reconstruction
      -- point. History is initialized lazily so opening a vault with hundreds of
      -- thousands of row-pages does not turn the migration into an unbounded rewrite.
      CREATE TABLE page_revisions (
        id                     TEXT PRIMARY KEY,
        page_id                TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        revision               INTEGER NOT NULL CHECK (revision >= 1),
        source_page_revision   INTEGER NOT NULL CHECK (source_page_revision >= 1),
        document_revision      INTEGER NOT NULL CHECK (document_revision >= 1),
        actor_id               TEXT NOT NULL,
        reason                 TEXT NOT NULL,
        summary                TEXT NOT NULL DEFAULT '',
        delta_json             TEXT NOT NULL CHECK (json_valid(delta_json) AND json_type(delta_json) = 'object'),
        snapshot_json          TEXT CHECK (snapshot_json IS NULL OR (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object')),
        restored_from_revision INTEGER,
        created_at             TEXT NOT NULL,
        UNIQUE (page_id, revision),
        CHECK (restored_from_revision IS NULL OR restored_from_revision >= 1)
      );
      CREATE INDEX idx_page_revisions_page_cursor ON page_revisions(page_id, revision DESC);
      CREATE INDEX idx_page_revisions_created ON page_revisions(created_at DESC);
    `,
  },
  {
    version: 148,
    up: /* sql */ `
      -- Notion parity, loop 16B. Extend v146 append-only, then add actors,
      -- threaded comments, reactions, explicit mentions and a durable inbox.
      ALTER TABLE page_revisions ADD COLUMN property_changes INTEGER NOT NULL DEFAULT 0 CHECK (property_changes >= 0);
      ALTER TABLE page_revisions ADD COLUMN block_changes INTEGER NOT NULL DEFAULT 0 CHECK (block_changes >= 0);

      CREATE TABLE workspace_actors (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
        email TEXT,
        avatar TEXT,
        kind TEXT NOT NULL DEFAULT 'member' CHECK (kind IN ('member','guest','system')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_workspace_actors_email ON workspace_actors(email COLLATE NOCASE) WHERE email IS NOT NULL;
      INSERT INTO workspace_actors (id, display_name, kind, created_at, updated_at)
      VALUES ('local', 'Tú', 'member', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      INSERT INTO workspace_actors (id, display_name, kind, created_at, updated_at)
      VALUES ('migration', 'Migración', 'system', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

      CREATE TABLE page_comments (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        block_id TEXT REFERENCES page_blocks(id) ON DELETE SET NULL,
        parent_comment_id TEXT REFERENCES page_comments(id) ON DELETE CASCADE,
        body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 10000),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by TEXT NOT NULL REFERENCES workspace_actors(id),
        updated_by TEXT NOT NULL REFERENCES workspace_actors(id),
        resolved_at TEXT,
        resolved_by TEXT REFERENCES workspace_actors(id),
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_page_comments_page ON page_comments(page_id, resolved_at, created_at, id);
      CREATE INDEX idx_page_comments_parent ON page_comments(parent_comment_id, created_at, id);
      CREATE INDEX idx_page_comments_block ON page_comments(block_id, resolved_at, created_at) WHERE block_id IS NOT NULL;

      CREATE TABLE page_comment_reactions (
        comment_id TEXT NOT NULL REFERENCES page_comments(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL REFERENCES workspace_actors(id) ON DELETE CASCADE,
        emoji TEXT NOT NULL CHECK (length(emoji) BETWEEN 1 AND 32),
        created_at TEXT NOT NULL,
        PRIMARY KEY (comment_id, actor_id, emoji)
      );
      CREATE INDEX idx_page_comment_reactions_comment ON page_comment_reactions(comment_id, emoji);

      CREATE TABLE page_comment_mentions (
        comment_id TEXT NOT NULL REFERENCES page_comments(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL REFERENCES workspace_actors(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (comment_id, actor_id)
      );
      CREATE INDEX idx_page_comment_mentions_actor ON page_comment_mentions(actor_id, created_at DESC);

      CREATE TABLE workspace_notifications (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL REFERENCES workspace_actors(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('mention','comment_reply','comment_resolved','automation')),
        page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
        block_id TEXT REFERENCES page_blocks(id) ON DELETE SET NULL,
        comment_id TEXT REFERENCES page_comments(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
        created_at TEXT NOT NULL,
        UNIQUE (actor_id, kind, comment_id)
      );
      CREATE INDEX idx_workspace_notifications_inbox ON workspace_notifications(actor_id, is_read, created_at DESC);
    `,
  },
  {
    version: 149,
    up: /* sql */ `
      -- Notion parity, loop 16C: generic hierarchical ACLs, groups and
      -- revocable public links. Generic resource ids are validated in the
      -- repository because SQLite cannot express a polymorphic foreign key.
      CREATE TABLE workspace_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_workspace_groups_name ON workspace_groups(name COLLATE NOCASE);

      CREATE TABLE workspace_group_members (
        group_id TEXT NOT NULL REFERENCES workspace_groups(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL REFERENCES workspace_actors(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (group_id, actor_id)
      );
      CREATE INDEX idx_workspace_group_members_actor ON workspace_group_members(actor_id, group_id);

      CREATE TABLE acl_entries (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL CHECK (resource_type IN ('vault','page','database','view','row')),
        resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL CHECK (principal_type IN ('actor','group')),
        principal_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner','full_access','edit','edit_content','comment','view')),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by TEXT NOT NULL REFERENCES workspace_actors(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (resource_type, resource_id, principal_type, principal_id)
      );
      CREATE INDEX idx_acl_entries_resource ON acl_entries(resource_type, resource_id);
      CREATE INDEX idx_acl_entries_principal ON acl_entries(principal_type, principal_id, resource_type, resource_id);
      CREATE TRIGGER acl_entries_principal_insert BEFORE INSERT ON acl_entries BEGIN
        SELECT CASE
          WHEN NEW.principal_type = 'actor' AND NOT EXISTS (SELECT 1 FROM workspace_actors WHERE id = NEW.principal_id)
            THEN RAISE(ABORT, 'ACL actor does not exist')
          WHEN NEW.principal_type = 'group' AND NOT EXISTS (SELECT 1 FROM workspace_groups WHERE id = NEW.principal_id)
            THEN RAISE(ABORT, 'ACL group does not exist')
        END;
      END;
      CREATE TRIGGER acl_entries_principal_update BEFORE UPDATE OF principal_type, principal_id ON acl_entries BEGIN
        SELECT CASE
          WHEN NEW.principal_type = 'actor' AND NOT EXISTS (SELECT 1 FROM workspace_actors WHERE id = NEW.principal_id)
            THEN RAISE(ABORT, 'ACL actor does not exist')
          WHEN NEW.principal_type = 'group' AND NOT EXISTS (SELECT 1 FROM workspace_groups WHERE id = NEW.principal_id)
            THEN RAISE(ABORT, 'ACL group does not exist')
        END;
      END;
      INSERT INTO acl_entries
        (id, resource_type, resource_id, principal_type, principal_id, role, revision, created_by, created_at, updated_at)
      VALUES
        ('acl_vault_local_owner', 'vault', 'vault', 'actor', 'local', 'owner', 1, 'local',
         strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

      CREATE TABLE workspace_share_links (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL CHECK (resource_type IN ('page','database','view')),
        resource_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
        password_salt TEXT,
        password_hash TEXT,
        role TEXT NOT NULL CHECK (role IN ('comment','view')),
        expires_at TEXT,
        allow_indexing INTEGER NOT NULL DEFAULT 0 CHECK (allow_indexing IN (0,1)),
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_by TEXT NOT NULL REFERENCES workspace_actors(id),
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((password_salt IS NULL) = (password_hash IS NULL))
      );
      CREATE INDEX idx_workspace_share_links_resource ON workspace_share_links(resource_type, resource_id, revoked_at, expires_at);
    `,
  },
  {
    version: 150,
    up: /* sql */ `
      -- Notion parity, loop 17A: stable device identity, HLC-stamped operations,
      -- per-row convergence clocks and an inspectable conflict log.
      CREATE TABLE workspace_devices (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL REFERENCES workspace_actors(id),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        last_hlc TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO workspace_devices (id, actor_id, name, last_hlc, created_at, updated_at)
      VALUES ('local-device', 'local', 'Este dispositivo', '0000000000000-000000-local-device',
        strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

      ALTER TABLE server_outbox ADD COLUMN actor_id TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE server_outbox ADD COLUMN device_id TEXT NOT NULL DEFAULT 'local-device';
      ALTER TABLE server_outbox ADD COLUMN hlc TEXT NOT NULL DEFAULT '0000000000000-000000-local-device';
      CREATE INDEX idx_server_outbox_hlc ON server_outbox(hlc, id);

      CREATE TABLE sync_row_clocks (
        table_name TEXT NOT NULL,
        row_key TEXT NOT NULL,
        hlc TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (table_name, row_key)
      );
      CREATE INDEX idx_sync_row_clocks_hlc ON sync_row_clocks(hlc, table_name, row_key);

      CREATE TABLE sync_conflicts (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        row_key TEXT NOT NULL,
        winning_operation_id TEXT NOT NULL,
        losing_operation_id TEXT NOT NULL,
        winner_hlc TEXT NOT NULL,
        loser_hlc TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('kept_local','applied_remote')),
        losing_row_json TEXT CHECK (losing_row_json IS NULL OR json_valid(losing_row_json)),
        created_at TEXT NOT NULL,
        UNIQUE (winning_operation_id, losing_operation_id)
      );
      CREATE INDEX idx_sync_conflicts_row ON sync_conflicts(table_name, row_key, created_at DESC);

      CREATE TABLE sync_snapshot_cursors (
        stream_id TEXT PRIMARY KEY,
        cursor INTEGER NOT NULL DEFAULT 0 CHECK (cursor >= 0),
        snapshot_revision TEXT,
        hydrated_at TEXT,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 151,
    up: /* sql */ `
      -- Notion parity, loop 17B: content-address every Yjs delta so its binary bytes
      -- travel outside the JSON operation relay and can be replayed idempotently.
      ALTER TABLE page_document_updates ADD COLUMN update_hash TEXT;
      CREATE INDEX idx_page_document_updates_hash
        ON page_document_updates(page_id, update_hash) WHERE update_hash IS NOT NULL;
      CREATE TABLE page_document_update_receipts (
        update_hash TEXT PRIMARY KEY CHECK (length(update_hash) = 64),
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
      CREATE INDEX idx_page_document_update_receipts_page ON page_document_update_receipts(page_id, applied_at);
    `,
    after: (db) => {
      const rows = db.prepare('SELECT id, update_blob FROM page_document_updates WHERE update_hash IS NULL').all() as Array<{
        id: string; update_blob: Buffer;
      }>;
      const update = db.prepare('UPDATE page_document_updates SET update_hash = ? WHERE id = ?');
      for (const row of rows) update.run(createHash('sha256').update(row.update_blob).digest('hex'), row.id);
    },
  },
  {
    version: 152,
    up: /* sql */ `
      -- Notion parity, loop 19: FTS is a lexical index. Typed numbers, booleans and
      -- numeric materializations are served by their covering indexes and only made
      -- the FTS file larger. Keep exactly the user-visible textual property families.
      DELETE FROM db_search_fts
      WHERE entity_type = 'cell' AND NOT EXISTS (
        SELECT 1 FROM db_columns col
        WHERE col.id = db_search_fts.column_id AND col.database_id = db_search_fts.database_id
          AND col.type IN ('title','rich_text','text','select','status','multi_select','person','url','email','phone','location')
      );
      DELETE FROM db_search_fts WHERE entity_type = 'computed' AND entity_id IN (
        SELECT row_id || ':' || column_id FROM db_computed_cells WHERE value_type IN ('number','integer')
      );

      DROP TRIGGER IF EXISTS db_cells_search_ai;
      DROP TRIGGER IF EXISTS db_cells_search_au;
      CREATE TRIGGER db_cells_search_ai AFTER INSERT ON db_cells
      WHEN EXISTS (
        SELECT 1 FROM db_columns col WHERE col.id = new.column_id AND col.database_id = new.database_id
          AND col.type IN ('title','rich_text','text','select','status','multi_select','person','url','email','phone','location')
      ) BEGIN
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        SELECT CASE
                 WHEN col.type IN ('select','status') THEN COALESCE(
                   (SELECT option.label FROM db_select_options option
                    WHERE option.id = COALESCE(new.value_reference, new.value_text)), new.value_text, '')
                 WHEN col.type = 'multi_select' AND json_valid(COALESCE(new.value_json, new.value_text)) THEN COALESCE(
                   (SELECT group_concat(COALESCE(option.label, item.value), ' ')
                    FROM json_each(COALESCE(new.value_json, new.value_text)) item
                    LEFT JOIN db_select_options option ON option.id = item.value), new.value_text, '')
                 ELSE COALESCE(new.value_text, '')
               END,
               'cell', new.database_id, new.row_id, new.column_id, new.row_id || ':' || new.column_id
        FROM db_columns col WHERE col.id = new.column_id AND col.database_id = new.database_id;
      END;
      CREATE TRIGGER db_cells_search_au AFTER UPDATE ON db_cells BEGIN
        DELETE FROM db_search_fts WHERE entity_type = 'cell' AND entity_id = old.row_id || ':' || old.column_id;
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        SELECT CASE
                 WHEN col.type IN ('select','status') THEN COALESCE(
                   (SELECT option.label FROM db_select_options option
                    WHERE option.id = COALESCE(new.value_reference, new.value_text)), new.value_text, '')
                 WHEN col.type = 'multi_select' AND json_valid(COALESCE(new.value_json, new.value_text)) THEN COALESCE(
                   (SELECT group_concat(COALESCE(option.label, item.value), ' ')
                    FROM json_each(COALESCE(new.value_json, new.value_text)) item
                    LEFT JOIN db_select_options option ON option.id = item.value), new.value_text, '')
                 ELSE COALESCE(new.value_text, '')
               END,
               'cell', new.database_id, new.row_id, new.column_id, new.row_id || ':' || new.column_id
        FROM db_columns col
        WHERE col.id = new.column_id AND col.database_id = new.database_id
          AND col.type IN ('title','rich_text','text','select','status','multi_select','person','url','email','phone','location');
      END;

      DROP TRIGGER IF EXISTS db_computed_cells_search_ai;
      DROP TRIGGER IF EXISTS db_computed_cells_search_au;
      CREATE TRIGGER db_computed_cells_search_ai AFTER INSERT ON db_computed_cells
      WHEN new.value_type NOT IN ('number','integer') BEGIN
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        VALUES (COALESCE(new.value_text, ''), 'computed', new.database_id, new.row_id, new.column_id,
                new.row_id || ':' || new.column_id);
      END;
      CREATE TRIGGER db_computed_cells_search_au AFTER UPDATE ON db_computed_cells BEGIN
        DELETE FROM db_search_fts WHERE entity_type = 'computed' AND entity_id = old.row_id || ':' || old.column_id;
        INSERT INTO db_search_fts(content, entity_type, database_id, row_id, column_id, entity_id)
        SELECT COALESCE(new.value_text, ''), 'computed', new.database_id, new.row_id, new.column_id,
               new.row_id || ':' || new.column_id
        WHERE new.value_type NOT IN ('number','integer');
      END;
    `,
  },
  {
    version: 153,
    up: /* sql */ `
      -- Notion parity, loop 19: FTS5 UNINDEXED metadata cannot locate an entity for
      -- UPDATE/DELETE without scanning the whole virtual table. Give every projection a
      -- stable rowid derived from its source table so an ordinary cell edit stays O(1).
      DROP TRIGGER IF EXISTS db_cells_search_ai; DROP TRIGGER IF EXISTS db_cells_search_au; DROP TRIGGER IF EXISTS db_cells_search_ad;
      DROP TRIGGER IF EXISTS db_computed_cells_search_ai; DROP TRIGGER IF EXISTS db_computed_cells_search_au; DROP TRIGGER IF EXISTS db_computed_cells_search_ad;
      DROP TRIGGER IF EXISTS db_attachments_search_ai; DROP TRIGGER IF EXISTS db_attachments_search_au; DROP TRIGGER IF EXISTS db_attachments_search_ad;
      DROP TRIGGER IF EXISTS page_blocks_search_ai; DROP TRIGGER IF EXISTS page_blocks_search_au; DROP TRIGGER IF EXISTS page_blocks_search_ad;
      DROP TRIGGER IF EXISTS pages_search_ai; DROP TRIGGER IF EXISTS pages_search_au; DROP TRIGGER IF EXISTS pages_search_ad;
      DELETE FROM db_search_fts;

      INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
      SELECT cell.rowid,
             CASE
               WHEN col.type IN ('select','status') THEN COALESCE(
                 (SELECT option.label FROM db_select_options option
                  WHERE option.id = COALESCE(cell.value_reference, cell.value_text)), cell.value_text, '')
               WHEN col.type = 'multi_select' AND json_valid(COALESCE(cell.value_json, cell.value_text)) THEN COALESCE(
                 (SELECT group_concat(COALESCE(option.label, item.value), ' ')
                  FROM json_each(COALESCE(cell.value_json, cell.value_text)) item
                  LEFT JOIN db_select_options option ON option.id = item.value), cell.value_text, '')
               ELSE COALESCE(cell.value_text, '')
             END,
             'cell', cell.database_id, cell.row_id, cell.column_id, cell.row_id || ':' || cell.column_id
      FROM db_cells cell JOIN db_columns col
        ON col.id = cell.column_id AND col.database_id = cell.database_id
      WHERE col.type IN ('title','rich_text','text','select','status','multi_select','person','url','email','phone','location');
      INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
      SELECT -cell.rowid, COALESCE(cell.value_text, ''), 'computed', cell.database_id,
             cell.row_id, cell.column_id, cell.row_id || ':' || cell.column_id
      FROM db_computed_cells cell WHERE cell.value_type NOT IN ('number','integer');
      INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
      SELECT 2305843009213693952 + attachment.rowid,
             trim(COALESCE(file_name, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(extracted_text, '')),
             'attachment', database_id, row_id, column_id, id FROM db_attachments attachment;
      INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
      SELECT -2305843009213693952 + block.rowid, block.normalized_text, 'page_block', row.database_id,
             page.row_id, NULL, block.id
      FROM page_blocks block JOIN pages page ON page.id = block.page_id
      LEFT JOIN db_rows row ON row.id = page.row_id WHERE block.trashed_at IS NULL;
      INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
      SELECT 4611686018427387904 + page.rowid, page.title, 'page_title', row.database_id,
             page.row_id, NULL, page.id
      FROM pages page LEFT JOIN db_rows row ON row.id = page.row_id
      WHERE page.state = 'active' AND page.row_id IS NULL;

      CREATE TRIGGER db_cells_search_ai AFTER INSERT ON db_cells
      WHEN EXISTS (SELECT 1 FROM db_columns col WHERE col.id = new.column_id AND col.database_id = new.database_id
        AND col.type IN ('title','rich_text','text','select','status','multi_select','person','url','email','phone','location')) BEGIN
        INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
        SELECT new.rowid, CASE
          WHEN col.type IN ('select','status') THEN COALESCE((SELECT label FROM db_select_options WHERE id = COALESCE(new.value_reference,new.value_text)),new.value_text,'')
          WHEN col.type='multi_select' AND json_valid(COALESCE(new.value_json,new.value_text)) THEN COALESCE(
            (SELECT group_concat(COALESCE(option.label,item.value),' ') FROM json_each(COALESCE(new.value_json,new.value_text)) item
             LEFT JOIN db_select_options option ON option.id=item.value),new.value_text,'')
          ELSE COALESCE(new.value_text,'') END,
          'cell',new.database_id,new.row_id,new.column_id,new.row_id||':'||new.column_id
        FROM db_columns col WHERE col.id=new.column_id AND col.database_id=new.database_id;
      END;
      CREATE TRIGGER db_cells_search_au AFTER UPDATE ON db_cells BEGIN
        DELETE FROM db_search_fts WHERE rowid=old.rowid;
        INSERT INTO db_search_fts(rowid, content, entity_type, database_id, row_id, column_id, entity_id)
        SELECT new.rowid, CASE
          WHEN col.type IN ('select','status') THEN COALESCE((SELECT label FROM db_select_options WHERE id=COALESCE(new.value_reference,new.value_text)),new.value_text,'')
          WHEN col.type='multi_select' AND json_valid(COALESCE(new.value_json,new.value_text)) THEN COALESCE(
            (SELECT group_concat(COALESCE(option.label,item.value),' ') FROM json_each(COALESCE(new.value_json,new.value_text)) item
             LEFT JOIN db_select_options option ON option.id=item.value),new.value_text,'')
          ELSE COALESCE(new.value_text,'') END,
          'cell',new.database_id,new.row_id,new.column_id,new.row_id||':'||new.column_id
        FROM db_columns col WHERE col.id=new.column_id AND col.database_id=new.database_id
          AND col.type IN ('title','rich_text','text','select','status','multi_select','person','url','email','phone','location');
      END;
      CREATE TRIGGER db_cells_search_ad AFTER DELETE ON db_cells BEGIN DELETE FROM db_search_fts WHERE rowid=old.rowid; END;

      CREATE TRIGGER db_computed_cells_search_ai AFTER INSERT ON db_computed_cells WHEN new.value_type NOT IN ('number','integer') BEGIN
        INSERT INTO db_search_fts(rowid,content,entity_type,database_id,row_id,column_id,entity_id)
        VALUES(-new.rowid,COALESCE(new.value_text,''),'computed',new.database_id,new.row_id,new.column_id,new.row_id||':'||new.column_id);
      END;
      CREATE TRIGGER db_computed_cells_search_au AFTER UPDATE ON db_computed_cells BEGIN
        DELETE FROM db_search_fts WHERE rowid=-old.rowid;
        INSERT INTO db_search_fts(rowid,content,entity_type,database_id,row_id,column_id,entity_id)
        SELECT -new.rowid,COALESCE(new.value_text,''),'computed',new.database_id,new.row_id,new.column_id,new.row_id||':'||new.column_id
        WHERE new.value_type NOT IN ('number','integer');
      END;
      CREATE TRIGGER db_computed_cells_search_ad AFTER DELETE ON db_computed_cells BEGIN DELETE FROM db_search_fts WHERE rowid=-old.rowid; END;

      CREATE TRIGGER db_attachments_search_ai AFTER INSERT ON db_attachments BEGIN
        INSERT INTO db_search_fts(rowid,content,entity_type,database_id,row_id,column_id,entity_id)
        VALUES(2305843009213693952+new.rowid,trim(COALESCE(new.file_name,'')||' '||COALESCE(new.description,'')||' '||COALESCE(new.extracted_text,'')),
          'attachment',new.database_id,new.row_id,new.column_id,new.id);
      END;
      CREATE TRIGGER db_attachments_search_au AFTER UPDATE ON db_attachments BEGIN
        DELETE FROM db_search_fts WHERE rowid=2305843009213693952+old.rowid;
        INSERT INTO db_search_fts(rowid,content,entity_type,database_id,row_id,column_id,entity_id)
        VALUES(2305843009213693952+new.rowid,trim(COALESCE(new.file_name,'')||' '||COALESCE(new.description,'')||' '||COALESCE(new.extracted_text,'')),
          'attachment',new.database_id,new.row_id,new.column_id,new.id);
      END;
      CREATE TRIGGER db_attachments_search_ad AFTER DELETE ON db_attachments BEGIN DELETE FROM db_search_fts WHERE rowid=2305843009213693952+old.rowid; END;

      CREATE TRIGGER page_blocks_search_ai AFTER INSERT ON page_blocks WHEN new.trashed_at IS NULL BEGIN
        INSERT INTO db_search_fts(rowid,content,entity_type,database_id,row_id,column_id,entity_id)
        SELECT -2305843009213693952+new.rowid,new.normalized_text,'page_block',row.database_id,page.row_id,NULL,new.id
        FROM pages page LEFT JOIN db_rows row ON row.id=page.row_id WHERE page.id=new.page_id;
      END;
      CREATE TRIGGER page_blocks_search_au AFTER UPDATE ON page_blocks BEGIN
        DELETE FROM db_search_fts WHERE rowid=-2305843009213693952+old.rowid;
        INSERT INTO db_search_fts(rowid,content,entity_type,database_id,row_id,column_id,entity_id)
        SELECT -2305843009213693952+new.rowid,new.normalized_text,'page_block',row.database_id,page.row_id,NULL,new.id
        FROM pages page LEFT JOIN db_rows row ON row.id=page.row_id WHERE page.id=new.page_id AND new.trashed_at IS NULL;
      END;
      CREATE TRIGGER page_blocks_search_ad AFTER DELETE ON page_blocks BEGIN DELETE FROM db_search_fts WHERE rowid=-2305843009213693952+old.rowid; END;

      CREATE TRIGGER pages_search_ai AFTER INSERT ON pages WHEN new.state='active' AND new.row_id IS NULL BEGIN
        INSERT INTO db_search_fts(rowid,content,entity_type,database_id,row_id,column_id,entity_id)
        SELECT 4611686018427387904+new.rowid,new.title,'page_title',row.database_id,new.row_id,NULL,new.id
        FROM (SELECT 1) seed LEFT JOIN db_rows row ON row.id=new.row_id;
      END;
      CREATE TRIGGER pages_search_au AFTER UPDATE OF title,state,row_id ON pages BEGIN
        DELETE FROM db_search_fts WHERE rowid=4611686018427387904+old.rowid;
        INSERT INTO db_search_fts(rowid,content,entity_type,database_id,row_id,column_id,entity_id)
        SELECT 4611686018427387904+new.rowid,new.title,'page_title',row.database_id,new.row_id,NULL,new.id
        FROM (SELECT 1) seed LEFT JOIN db_rows row ON row.id=new.row_id
        WHERE new.state='active' AND new.row_id IS NULL;
      END;
      CREATE TRIGGER pages_search_ad AFTER DELETE ON pages BEGIN DELETE FROM db_search_fts WHERE rowid=4611686018427387904+old.rowid; END;
    `,
  },
  {
    version: 154,
    up: /* sql */ `
      -- Single source of truth for "who may be credited with this work's ideas".
      -- Normally that is its authors, and only its authors: crediting the editor of
      -- an edited volume with the chapters inside it is what this whole layer exists
      -- to prevent.
      --
      -- The one exception, and it is deliberate: a work Zotero credits to editors
      -- ONLY has no author on record, so filtering editors out would leave its ideas
      -- attributed to nobody and invisible in every author view. Until the real
      -- chapter authors can be recovered from richer metadata, those ideas are shown
      -- under the editors, marked in the interface as a provisional attribution.
      --
      -- 'basis' says which of the two cases a row is, so a reader never has to guess:
      -- 'author' is authorship, 'editor_only' is the exception.
      CREATE VIEW work_attributions AS
        SELECT wa.nodus_id,
               wa.author_id,
               wa.role,
               CASE WHEN wa.role = 'author' THEN 'author' ELSE 'editor_only' END AS basis
        FROM work_authors wa
        WHERE wa.role = 'author'
           OR NOT EXISTS (
                SELECT 1 FROM work_authors peer
                 WHERE peer.nodus_id = wa.nodus_id AND peer.role = 'author'
              );
    `,
  },
  {
    version: 155,
    up: /* sql */ `
      -- Dictionary entries are authored, durable research objects. Corpus rows are
      -- referenced by stable ids and deliberately not protected by foreign keys:
      -- connected-vault mutations may arrive before the local Zotero-derived corpus.
      CREATE TABLE dictionary_entries (
        id                       TEXT PRIMARY KEY,
        name                     TEXT NOT NULL,
        normalized_name          TEXT NOT NULL,
        aliases_json             TEXT NOT NULL DEFAULT '[]',
        focus_prompt             TEXT NOT NULL DEFAULT '',
        scope_kind               TEXT NOT NULL CHECK (scope_kind IN ('vault','authors','works','tags_collections')),
        scope_json               TEXT NOT NULL,
        output_language          TEXT NOT NULL DEFAULT 'es',
        detail_level             TEXT NOT NULL DEFAULT 'standard' CHECK (detail_level IN ('concise','standard','detailed')),
        tags_json                TEXT NOT NULL DEFAULT '[]',
        content_markdown         TEXT NOT NULL DEFAULT '',
        notes                    TEXT NOT NULL DEFAULT '',
        status                   TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
        current_version_id       TEXT,
        proposed_version_id      TEXT,
        insufficient_evidence    INTEGER NOT NULL DEFAULT 0,
        new_evidence_count       INTEGER NOT NULL DEFAULT 0,
        last_evidence_scan_at    TEXT,
        last_change_seq          INTEGER NOT NULL DEFAULT 0,
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL
      );
      CREATE INDEX dictionary_entries_name_idx ON dictionary_entries(normalized_name, updated_at);
      CREATE INDEX dictionary_entries_status_idx ON dictionary_entries(status, updated_at);
      CREATE INDEX dictionary_entries_fresh_idx ON dictionary_entries(new_evidence_count, updated_at);

      CREATE TABLE dictionary_evidence (
        entry_id                 TEXT NOT NULL,
        kind                     TEXT NOT NULL CHECK (kind IN ('idea','passage')),
        ref_id                   TEXT NOT NULL,
        decision                 TEXT NOT NULL CHECK (decision IN ('included','unused','excluded')),
        score                    REAL NOT NULL DEFAULT 0,
        reason                   TEXT NOT NULL DEFAULT '',
        label                    TEXT NOT NULL DEFAULT '',
        evidence_text            TEXT NOT NULL DEFAULT '',
        work_id                  TEXT NOT NULL DEFAULT '',
        work_title               TEXT NOT NULL DEFAULT '',
        zotero_key               TEXT,
        works_json               TEXT NOT NULL DEFAULT '[]',
        page_label               TEXT,
        authors_json             TEXT NOT NULL DEFAULT '[]',
        tags_json                TEXT NOT NULL DEFAULT '[]',
        source_revision          TEXT,
        is_new                   INTEGER NOT NULL DEFAULT 0,
        first_seen_at            TEXT NOT NULL,
        updated_at               TEXT NOT NULL,
        PRIMARY KEY (entry_id, kind, ref_id)
      );
      CREATE INDEX dictionary_evidence_entry_decision_idx ON dictionary_evidence(entry_id, decision, is_new, score DESC);
      CREATE INDEX dictionary_evidence_ref_idx ON dictionary_evidence(kind, ref_id);
      CREATE INDEX dictionary_evidence_work_idx ON dictionary_evidence(entry_id, work_id);

      CREATE TABLE dictionary_versions (
        id                       TEXT PRIMARY KEY,
        entry_id                 TEXT NOT NULL,
        content_markdown         TEXT NOT NULL,
        evidence_json            TEXT NOT NULL DEFAULT '[]',
        evidence_snapshot_json   TEXT NOT NULL DEFAULT '[]',
        citations_json           TEXT NOT NULL DEFAULT '[]',
        author_summaries_json    TEXT NOT NULL DEFAULT '[]',
        focus_prompt             TEXT NOT NULL,
        scope_json               TEXT NOT NULL,
        output_language          TEXT NOT NULL,
        detail_level             TEXT NOT NULL,
        model_json               TEXT,
        generated_at             TEXT NOT NULL,
        trigger                  TEXT NOT NULL CHECK (trigger IN ('creation','update','regeneration','manual_edit','restore')),
        state                    TEXT NOT NULL CHECK (state IN ('applied','proposed')),
        insufficient_evidence    INTEGER NOT NULL DEFAULT 0,
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL
      );
      CREATE INDEX dictionary_versions_entry_idx ON dictionary_versions(entry_id, generated_at DESC);
      CREATE INDEX dictionary_versions_proposed_idx ON dictionary_versions(entry_id, state, generated_at DESC);

      CREATE TABLE dictionary_relations (
        id                       TEXT PRIMARY KEY,
        from_entry_id            TEXT NOT NULL,
        to_entry_id              TEXT NOT NULL,
        type                     TEXT NOT NULL CHECK (type IN ('related','broader','narrower','synonym','opposing','historically_related','frequently_co_occurring')),
        origin                   TEXT NOT NULL CHECK (origin IN ('manual','ai')),
        status                   TEXT NOT NULL CHECK (status IN ('suggested','confirmed','dismissed')),
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL,
        UNIQUE (from_entry_id, to_entry_id, type)
      );
      CREATE INDEX dictionary_relations_from_idx ON dictionary_relations(from_entry_id, status);
      CREATE INDEX dictionary_relations_to_idx ON dictionary_relations(to_entry_id, status);

      -- Machine-local, derived state used to avoid a full retrieval on entry open.
      CREATE TABLE dictionary_retrieval_state (
        entry_id                 TEXT PRIMARY KEY,
        query_hash               TEXT NOT NULL,
        query_embedding          BLOB,
        embedding_provider       TEXT,
        embedding_model          TEXT,
        embedding_dim            INTEGER,
        idea_floor               REAL,
        passage_floor            REAL,
        last_change_seq          INTEGER NOT NULL DEFAULT 0,
        needs_full_scan          INTEGER NOT NULL DEFAULT 1,
        updated_at               TEXT NOT NULL
      );

      CREATE TABLE dictionary_corpus_changes (
        seq                      INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_kind              TEXT NOT NULL CHECK (entity_kind IN ('idea','passage','work')),
        ref_id                   TEXT NOT NULL,
        work_id                  TEXT,
        change_kind              TEXT NOT NULL CHECK (change_kind IN ('insert','update','delete','scope')),
        changed_at               TEXT NOT NULL
      );
      CREATE INDEX dictionary_corpus_changes_seq_idx ON dictionary_corpus_changes(seq, entity_kind);
      CREATE INDEX dictionary_corpus_changes_ref_idx ON dictionary_corpus_changes(entity_kind, ref_id, seq);
    `,
  },
  {
    version: 156,
    up: /* sql */ `
      CREATE TRIGGER dictionary_change_ideas_insert AFTER INSERT ON ideas BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, change_kind, changed_at)
        VALUES ('idea', NEW.global_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_ideas_update AFTER UPDATE ON ideas BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, change_kind, changed_at)
        VALUES ('idea', NEW.global_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_ideas_delete AFTER DELETE ON ideas BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, change_kind, changed_at)
        VALUES ('idea', OLD.global_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;

      CREATE TRIGGER dictionary_change_occurrences_insert AFTER INSERT ON idea_occurrences BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('idea', NEW.global_id, NEW.nodus_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_occurrences_update AFTER UPDATE ON idea_occurrences BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('idea', NEW.global_id, NEW.nodus_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_occurrences_delete AFTER DELETE ON idea_occurrences BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('idea', OLD.global_id, OLD.nodus_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;

      CREATE TRIGGER dictionary_change_evidence_insert AFTER INSERT ON evidence BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('idea', NEW.global_id, NEW.nodus_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_evidence_update AFTER UPDATE ON evidence BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('idea', NEW.global_id, NEW.nodus_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_evidence_delete AFTER DELETE ON evidence BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('idea', OLD.global_id, OLD.nodus_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;

      CREATE TRIGGER dictionary_change_idea_tags_insert AFTER INSERT ON idea_theme_links BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('idea', NEW.global_id, NEW.nodus_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_idea_tags_delete AFTER DELETE ON idea_theme_links BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('idea', OLD.global_id, OLD.nodus_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;

      CREATE TRIGGER dictionary_change_passages_insert AFTER INSERT ON passages BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('passage', NEW.passage_id, NEW.nodus_id, 'insert', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_passages_update AFTER UPDATE ON passages BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('passage', NEW.passage_id, NEW.nodus_id, 'update', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_passages_delete AFTER DELETE ON passages BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('passage', OLD.passage_id, OLD.nodus_id, 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;

      CREATE TRIGGER dictionary_change_work_authors_insert AFTER INSERT ON work_authors BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('work', NEW.nodus_id, NEW.nodus_id, 'scope', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_work_authors_delete AFTER DELETE ON work_authors BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('work', OLD.nodus_id, OLD.nodus_id, 'scope', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_work_tags_insert AFTER INSERT ON work_zotero_tags BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('work', NEW.nodus_id, NEW.nodus_id, 'scope', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_work_tags_delete AFTER DELETE ON work_zotero_tags BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('work', OLD.nodus_id, OLD.nodus_id, 'scope', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_work_collections_insert AFTER INSERT ON work_collections BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('work', NEW.nodus_id, NEW.nodus_id, 'scope', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
      CREATE TRIGGER dictionary_change_work_collections_delete AFTER DELETE ON work_collections BEGIN
        INSERT INTO dictionary_corpus_changes(entity_kind, ref_id, work_id, change_kind, changed_at)
        VALUES ('work', OLD.nodus_id, OLD.nodus_id, 'scope', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
      END;
    `,
  },
  {
    version: 157,
    up: /* sql */ `
      CREATE TABLE document_profile_state (
        nodus_id TEXT PRIMARY KEY REFERENCES works(nodus_id) ON DELETE CASCADE,
        current_version_id TEXT,
        status TEXT NOT NULL DEFAULT 'missing' CHECK (status IN (
          'missing','queued','waiting_source','structuring','analyzing','synthesizing',
          'auditing','embedding','aligning','current','stale','failed','paused','unavailable'
        )),
        source_fingerprint TEXT,
        profile_fingerprint TEXT,
        pipeline_version TEXT,
        stale_reason TEXT,
        error TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX document_profile_state_status ON document_profile_state(status, updated_at);

      CREATE TABLE document_profile_versions (
        version_id TEXT PRIMARY KEY,
        nodus_id TEXT NOT NULL REFERENCES works(nodus_id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK (state IN ('candidate','current','superseded','rejected')),
        source_fingerprint TEXT NOT NULL,
        pipeline_version TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        source_language TEXT,
        presentation_language TEXT NOT NULL,
        overview TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        generator_model_json TEXT,
        auditor_model_json TEXT,
        prompt_hash TEXT NOT NULL,
        audit_json TEXT,
        quality_score REAL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL,
        created_at TEXT NOT NULL,
        published_at TEXT
      );
      CREATE INDEX document_profile_versions_work ON document_profile_versions(nodus_id, created_at DESC);

      CREATE TABLE document_profile_fields (
        field_id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES document_profile_versions(version_id) ON DELETE CASCADE,
        nodus_id TEXT NOT NULL REFERENCES works(nodus_id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        ordinal INTEGER NOT NULL DEFAULT 0,
        text TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0,
        centrality REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX document_profile_fields_work ON document_profile_fields(nodus_id, kind, ordinal);
      CREATE INDEX document_profile_fields_version ON document_profile_fields(version_id, kind, ordinal);

      CREATE TABLE document_sections (
        section_id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES document_profile_versions(version_id) ON DELETE CASCADE,
        nodus_id TEXT NOT NULL REFERENCES works(nodus_id) ON DELETE CASCADE,
        parent_section_id TEXT,
        level INTEGER NOT NULL,
        ordinal INTEGER NOT NULL,
        title TEXT NOT NULL,
        role TEXT,
        summary TEXT NOT NULL,
        concepts_json TEXT NOT NULL DEFAULT '[]',
        claims_json TEXT NOT NULL DEFAULT '[]',
        page_start TEXT,
        page_end TEXT,
        char_start INTEGER,
        char_end INTEGER,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX document_sections_work ON document_sections(nodus_id, ordinal);
      CREATE INDEX document_sections_version ON document_sections(version_id, ordinal);

      CREATE TABLE document_profile_support (
        support_id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL REFERENCES document_profile_versions(version_id) ON DELETE CASCADE,
        nodus_id TEXT NOT NULL REFERENCES works(nodus_id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('field','section')),
        target_id TEXT NOT NULL,
        section_id TEXT,
        passage_id TEXT,
        page_start TEXT,
        page_end TEXT,
        char_start INTEGER,
        char_end INTEGER,
        quote TEXT NOT NULL,
        quote_hash TEXT NOT NULL,
        support_kind TEXT NOT NULL DEFAULT 'direct',
        confidence REAL NOT NULL DEFAULT 0,
        validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending','valid','invalid')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX document_profile_support_target ON document_profile_support(target_kind, target_id);
      CREATE INDEX document_profile_support_work ON document_profile_support(nodus_id, version_id);

      CREATE TABLE document_vectors (
        vector_id TEXT PRIMARY KEY,
        nodus_id TEXT NOT NULL REFERENCES works(nodus_id) ON DELETE CASCADE,
        version_id TEXT NOT NULL REFERENCES document_profile_versions(version_id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        source_id TEXT,
        text TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1,
        embedding BLOB,
        embedding_provider TEXT,
        embedding_model TEXT,
        embedding_dim INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX document_vectors_work ON document_vectors(nodus_id, version_id, kind);
      CREATE INDEX document_vectors_embedding ON document_vectors(embedding_provider, embedding_model, embedding_dim);

      CREATE TABLE document_idea_links (
        version_id TEXT NOT NULL REFERENCES document_profile_versions(version_id) ON DELETE CASCADE,
        nodus_id TEXT NOT NULL REFERENCES works(nodus_id) ON DELETE CASCADE,
        global_id TEXT NOT NULL REFERENCES ideas(global_id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('field','section')),
        target_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('principal','supporting','development','contrast','tangential')),
        score REAL NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(version_id, global_id, target_kind, target_id)
      );
      CREATE INDEX document_idea_links_work ON document_idea_links(nodus_id, score DESC);

      CREATE TABLE document_profile_overrides (
        override_id TEXT PRIMARY KEY,
        nodus_id TEXT NOT NULL REFERENCES works(nodus_id) ON DELETE CASCADE,
        field_path TEXT NOT NULL,
        base_version_id TEXT,
        generated_value_json TEXT,
        value_json TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        conflict INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(nodus_id, field_path)
      );

      CREATE TABLE document_index_campaigns (
        campaign_id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('continuous','manual','research')),
        status TEXT NOT NULL CHECK (status IN ('queued','running','paused','completed','cancelled','failed')),
        include_archived INTEGER NOT NULL DEFAULT 0,
        generator_model_json TEXT,
        auditor_model_json TEXT,
        total_jobs INTEGER NOT NULL DEFAULT 0,
        completed_jobs INTEGER NOT NULL DEFAULT 0,
        failed_jobs INTEGER NOT NULL DEFAULT 0,
        estimated_units INTEGER NOT NULL DEFAULT 0,
        completed_units INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX document_index_campaigns_status ON document_index_campaigns(status, updated_at);

      CREATE TABLE document_index_jobs (
        job_id TEXT PRIMARY KEY,
        campaign_id TEXT REFERENCES document_index_campaigns(campaign_id) ON DELETE SET NULL,
        vault_id TEXT NOT NULL,
        nodus_id TEXT NOT NULL REFERENCES works(nodus_id) ON DELETE CASCADE,
        priority INTEGER NOT NULL DEFAULT 0,
        reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued','running','paused','completed','cancelled','failed','unavailable')),
        phase TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        source_fingerprint TEXT,
        generator_model_json TEXT,
        auditor_model_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX document_index_jobs_active ON document_index_jobs(vault_id, nodus_id)
        WHERE status IN ('queued','running','paused');
      CREATE INDEX document_index_jobs_queue ON document_index_jobs(status, priority DESC, created_at);

      CREATE TABLE document_index_checkpoints (
        job_id TEXT NOT NULL REFERENCES document_index_jobs(job_id) ON DELETE CASCADE,
        checkpoint_key TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(job_id, checkpoint_key)
      );

      CREATE VIRTUAL TABLE document_profiles_fts USING fts5(
        nodus_id UNINDEXED, version_id UNINDEXED, title, overview, fields,
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE VIRTUAL TABLE document_sections_fts USING fts5(
        section_id UNINDEXED, nodus_id UNINDEXED, title, summary, concepts,
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE VIRTUAL TABLE passages_fts USING fts5(
        passage_id UNINDEXED, nodus_id UNINDEXED, text,
        tokenize='unicode61 remove_diacritics 2'
      );
      INSERT INTO passages_fts(passage_id, nodus_id, text)
        SELECT passage_id, nodus_id, text FROM passages;
      CREATE TRIGGER passages_document_fts_ai AFTER INSERT ON passages BEGIN
        INSERT INTO passages_fts(passage_id, nodus_id, text) VALUES (new.passage_id, new.nodus_id, new.text);
      END;
      CREATE TRIGGER passages_document_fts_au AFTER UPDATE OF text, nodus_id ON passages BEGIN
        DELETE FROM passages_fts WHERE passage_id=old.passage_id;
        INSERT INTO passages_fts(passage_id, nodus_id, text) VALUES (new.passage_id, new.nodus_id, new.text);
      END;
      CREATE TRIGGER passages_document_fts_ad AFTER DELETE ON passages BEGIN
        DELETE FROM passages_fts WHERE passage_id=old.passage_id;
      END;
    `,
  },
  {
    version: 158,
    up: /* sql */ `
      -- Document profiles are reusable derived analysis. SQLite CHECK constraints
      -- cannot be widened in place, so preserve every row while rebuilding both
      -- provenance tables with the new component in their closed vocabularies.
      ALTER TABLE library_analysis_provenance RENAME TO library_analysis_provenance_v157;
      CREATE TABLE library_analysis_provenance (
        work_id                         TEXT NOT NULL,
        component                       TEXT NOT NULL CHECK (component IN ('light','deep','summary','ideas','passages','embeddings','documentProfile')),
        document_fingerprint            TEXT NOT NULL,
        library_item_id                 TEXT,
        library_revision_fingerprint    TEXT,
        pipeline_version                TEXT NOT NULL,
        model_fingerprint               TEXT NOT NULL,
        output_fingerprint              TEXT NOT NULL,
        source_vault_id                 TEXT,
        source_work_id                  TEXT,
        updated_at                      TEXT NOT NULL,
        PRIMARY KEY (work_id, component)
      );
      INSERT INTO library_analysis_provenance SELECT * FROM library_analysis_provenance_v157;
      DROP TABLE library_analysis_provenance_v157;
      CREATE INDEX library_analysis_provenance_library
        ON library_analysis_provenance(library_item_id, library_revision_fingerprint, component);

      ALTER TABLE library_analysis_freshness RENAME TO library_analysis_freshness_v157;
      CREATE TABLE library_analysis_freshness (
        work_id       TEXT NOT NULL,
        component     TEXT NOT NULL CHECK (component IN ('extraction','light','deep','passages','ideas','embeddings','summary','documentProfile')),
        freshness     TEXT NOT NULL CHECK (freshness IN ('none','queued','running','current','stale','failed','unavailable')),
        fingerprint   TEXT,
        reason        TEXT,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (work_id, component)
      );
      INSERT INTO library_analysis_freshness SELECT * FROM library_analysis_freshness_v157;
      DROP TABLE library_analysis_freshness_v157;
      CREATE INDEX idx_library_analysis_freshness_state
        ON library_analysis_freshness(freshness, component, work_id);

      -- A changed Zotero revision or a newly-extracted deep source invalidates the
      -- macro representation. Keep the last accepted profile readable while the
      -- continuous queue prepares its replacement.
      CREATE TRIGGER works_document_profile_stale_deep
      AFTER UPDATE OF deep_hash, zotero_version ON works
      WHEN OLD.deep_hash IS NOT NEW.deep_hash OR OLD.zotero_version IS NOT NEW.zotero_version
      BEGIN
        UPDATE document_profile_state
           SET status='stale', stale_reason='source_changed', error=NULL,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE nodus_id=NEW.nodus_id AND current_version_id IS NOT NULL;
      END;

      -- Titles remain mutable bibliographic metadata and therefore update the
      -- document-level lexical route without forcing an expensive rescan.
      CREATE TRIGGER works_document_profile_title_fts
      AFTER UPDATE OF title ON works
      WHEN OLD.title IS NOT NEW.title
      BEGIN
        UPDATE document_profiles_fts SET title=NEW.title WHERE nodus_id=NEW.nodus_id;
      END;
    `,
  },
  {
    version: 159,
    up: /* sql */ `
      -- Campaign refresh and pause/cancel operations are frequent while the global
      -- progress bar is visible. Keep them indexed even after years of history.
      CREATE INDEX document_index_jobs_campaign_status
        ON document_index_jobs(campaign_id, status, updated_at);
    `,
  },
  {
    version: 160,
    up: /* sql */ `
      -- Current text availability is independent from the source used by the last
      -- successfully committed deep analysis.
      ALTER TABLE works ADD COLUMN resolved_source_type TEXT;
      ALTER TABLE works ADD COLUMN resolved_text_hash TEXT;
      ALTER TABLE works ADD COLUMN resolved_text_chars INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE works ADD COLUMN resolved_text_source_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE works ADD COLUMN resolved_has_page_markers INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE works ADD COLUMN text_block_reason TEXT;
      ALTER TABLE works ADD COLUMN text_resolved_at TEXT;
      ALTER TABLE works ADD COLUMN resolved_text_notes TEXT;
      ALTER TABLE works ADD COLUMN deep_error TEXT;

      ALTER TABLE evidence ADD COLUMN source_ref TEXT;
      ALTER TABLE evidence ADD COLUMN page_number INTEGER;
      ALTER TABLE passages ADD COLUMN source_ref TEXT;
      ALTER TABLE passages ADD COLUMN page_number INTEGER;

      UPDATE works SET deep_error=notes WHERE deep_status='failed' AND notes IS NOT NULL;
    `,
  },
  {
    version: 161,
    up: /* sql */ `
      -- Profile citations need the same durable source identity as evidence and
      -- passages; display labels alone are ambiguous for multi-attachment works.
      ALTER TABLE document_sections ADD COLUMN source_ref TEXT;
      ALTER TABLE document_sections ADD COLUMN page_start_number INTEGER;
      ALTER TABLE document_sections ADD COLUMN page_end_number INTEGER;
      ALTER TABLE document_profile_support ADD COLUMN source_ref TEXT;
      ALTER TABLE document_profile_support ADD COLUMN page_start_number INTEGER;
      ALTER TABLE document_profile_support ADD COLUMN page_end_number INTEGER;
    `,
  },
  {
    version: 162,
    // The per-attachment text inventory lives in its own body so isCreateOnly() accepts
    // it: only a CREATE-only migration can be replayed to backfill a table missing from
    // a database built by a differently-numbered build. NO FOREIGN KEY, for the same
    // reason as migrations 98-103 — `ON DELETE CASCADE` contains a DELETE keyword and
    // would disqualify the body. Duplicate merges drop these rows explicitly (dedupe.ts),
    // and the inventory is rebuilt from local files on the next resolution anyway.
    //
    // Two populations exist and both are correct: a database built before this table was
    // moved out of 160 keeps the older shape, WITH the cascading key, because 162 is
    // skipped there as already applied. Every deletion path removes these rows itself, so
    // the end state matches — but do not write code that assumes either shape.
    up: /* sql */ `
      CREATE TABLE work_text_sources (
        nodus_id            TEXT NOT NULL,
        source_ref          TEXT NOT NULL,
        origin              TEXT NOT NULL,
        source_type         TEXT NOT NULL,
        zotero_library_id   TEXT,
        attachment_key      TEXT,
        display_name        TEXT,
        content_hash        TEXT NOT NULL,
        char_count          INTEGER NOT NULL,
        page_count          INTEGER,
        has_page_markers    INTEGER NOT NULL DEFAULT 0,
        ordinal             INTEGER NOT NULL,
        active              INTEGER NOT NULL DEFAULT 1,
        resolved_at         TEXT NOT NULL,
        PRIMARY KEY (nodus_id, source_ref)
      );
      CREATE INDEX idx_work_text_sources_attachment
        ON work_text_sources(zotero_library_id, attachment_key);
    `,
  },
  {
    version: 163,
    up: /* sql */ `
      -- A queued rescan of an already-analysed work must survive a restart without
      -- overwriting deep_status, which describes the last COMMITTED result. This is a
      -- migration of its own, not an extra line in 160: 160 has already run on every
      -- database built from this branch, and runMigrations only executes bodies above
      -- user_version, so an edit there would never reach them (and the CREATE-only
      -- backfill cannot rescue an ALTER).
      ALTER TABLE works ADD COLUMN deep_queued INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 164,
    up: /* sql */ `
      -- Document profiles created immediately after the provenance upgrade compared
      -- the resolver's new source-marked text with legacy deep hashes. Stable PDFs
      -- consequently exhausted all five retries and remained paused forever. Give
      -- only those standalone Deep Research jobs one clean retry under the corrected
      -- comparison; user-paused campaigns and unrelated pauses remain untouched.
      UPDATE document_profile_state
         SET status='queued', stale_reason='legacy_text_fingerprint_recovered',
             error=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE status='paused'
         AND stale_reason='source_changed_during_analysis'
         AND EXISTS (
           SELECT 1 FROM document_index_jobs job
            WHERE job.nodus_id=document_profile_state.nodus_id
              AND job.campaign_id IS NULL
              AND job.reason='deep-research'
              AND job.status='paused'
              AND job.error LIKE 'La fuente cambió repetidamente durante el análisis.%'
         );

      UPDATE document_index_jobs
         SET status='queued', phase='queued', progress=0, attempts=0,
             source_fingerprint=NULL, error=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE campaign_id IS NULL
         AND reason='deep-research'
         AND status='paused'
         AND error LIKE 'La fuente cambió repetidamente durante el análisis.%';
    `,
  },
  {
    version: 165,
    up: /* sql */ `
      -- Keep exact campaign counters even when the renderer receives only a bounded
      -- queue sample, and retain the section/chunk currently being analysed.
      ALTER TABLE document_index_campaigns ADD COLUMN running_jobs INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE document_index_campaigns ADD COLUMN queued_jobs INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE document_index_campaigns ADD COLUMN paused_jobs INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE document_index_jobs ADD COLUMN progress_message TEXT;
      ALTER TABLE document_index_jobs ADD COLUMN current_unit INTEGER;
      ALTER TABLE document_index_jobs ADD COLUMN total_units INTEGER;

      UPDATE document_index_campaigns SET
        running_jobs=(SELECT COUNT(*) FROM document_index_jobs j WHERE j.campaign_id=document_index_campaigns.campaign_id AND j.status='running'),
        queued_jobs=(SELECT COUNT(*) FROM document_index_jobs j WHERE j.campaign_id=document_index_campaigns.campaign_id AND j.status='queued'),
        paused_jobs=(SELECT COUNT(*) FROM document_index_jobs j WHERE j.campaign_id=document_index_campaigns.campaign_id AND j.status='paused');
    `,
  },
  {
    version: 166,
    up: /* sql */ `
      -- A traceable extractive fallback is useful diagnostic material, but it is
      -- not a Dictionary synthesis and must never silently become the current
      -- definition. Rebuild the versions table so degradation is a first-class
      -- state with a persisted cause and retry count.
      ALTER TABLE dictionary_versions RENAME TO dictionary_versions_v165;
      DROP INDEX dictionary_versions_entry_idx;
      DROP INDEX dictionary_versions_proposed_idx;

      CREATE TABLE dictionary_versions (
        id                       TEXT PRIMARY KEY,
        entry_id                 TEXT NOT NULL,
        content_markdown         TEXT NOT NULL,
        evidence_json            TEXT NOT NULL DEFAULT '[]',
        evidence_snapshot_json   TEXT NOT NULL DEFAULT '[]',
        citations_json           TEXT NOT NULL DEFAULT '[]',
        author_summaries_json    TEXT NOT NULL DEFAULT '[]',
        focus_prompt             TEXT NOT NULL,
        scope_json               TEXT NOT NULL,
        output_language          TEXT NOT NULL,
        detail_level             TEXT NOT NULL,
        model_json               TEXT,
        generated_at             TEXT NOT NULL,
        trigger                  TEXT NOT NULL CHECK (trigger IN ('creation','update','regeneration','manual_edit','restore')),
        state                    TEXT NOT NULL CHECK (state IN ('applied','proposed','degraded')),
        outcome                  TEXT NOT NULL DEFAULT 'synthesis' CHECK (outcome IN ('synthesis','insufficient','degraded')),
        degradation_reason       TEXT CHECK (degradation_reason IN ('output_truncated','malformed_output','schema_error','invalid_evidence_refs','missing_citations','semantic_rejection','grounding_failure','legacy_extractive_fallback')),
        generation_attempts      INTEGER NOT NULL DEFAULT 1 CHECK (generation_attempts >= 1),
        generation_problems_json TEXT NOT NULL DEFAULT '[]',
        insufficient_evidence    INTEGER NOT NULL DEFAULT 0,
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL
      );

      INSERT INTO dictionary_versions (
        id,entry_id,content_markdown,evidence_json,evidence_snapshot_json,citations_json,author_summaries_json,
        focus_prompt,scope_json,output_language,detail_level,model_json,generated_at,trigger,state,outcome,
        degradation_reason,generation_attempts,generation_problems_json,insufficient_evidence,created_at,updated_at
      )
      SELECT
        id,entry_id,content_markdown,evidence_json,evidence_snapshot_json,citations_json,author_summaries_json,
        focus_prompt,scope_json,output_language,detail_level,model_json,generated_at,trigger,
        CASE
          WHEN content_markdown LIKE '## Evidencia verificable%'
            AND trigger IN ('creation','update','regeneration') THEN 'degraded'
          ELSE state
        END,
        CASE
          WHEN content_markdown LIKE '## Evidencia verificable%'
            AND trigger IN ('creation','update','regeneration') THEN 'degraded'
          WHEN insufficient_evidence=1 THEN 'insufficient'
          ELSE 'synthesis'
        END,
        CASE
          WHEN content_markdown LIKE '## Evidencia verificable%'
            AND trigger IN ('creation','update','regeneration') THEN 'legacy_extractive_fallback'
          ELSE NULL
        END,
        1,
        CASE
          WHEN content_markdown LIKE '## Evidencia verificable%'
            AND trigger IN ('creation','update','regeneration')
            THEN '["La versión fue creada por el fallback extractivo legado."]'
          ELSE '[]'
        END,
        insufficient_evidence,created_at,updated_at
      FROM dictionary_versions_v165;

      CREATE INDEX dictionary_versions_entry_idx ON dictionary_versions(entry_id, generated_at DESC);
      CREATE INDEX dictionary_versions_proposed_idx ON dictionary_versions(entry_id, state, generated_at DESC);

      -- If a degraded fallback had replaced a good definition, restore the latest
      -- earlier applied synthesis. A first-generation fallback returns the entry to
      -- draft and leaves its extractive evidence only in Versions/Evidence.
      UPDATE dictionary_entries
         SET current_version_id=(
               SELECT v.id FROM dictionary_versions v
                WHERE v.entry_id=dictionary_entries.id
                  AND v.state='applied' AND v.outcome<>'degraded'
                ORDER BY v.generated_at DESC, v.rowid DESC LIMIT 1
             ),
             content_markdown=COALESCE((
               SELECT v.content_markdown FROM dictionary_versions v
                WHERE v.entry_id=dictionary_entries.id
                  AND v.state='applied' AND v.outcome<>'degraded'
                ORDER BY v.generated_at DESC, v.rowid DESC LIMIT 1
             ), ''),
             insufficient_evidence=COALESCE((
               SELECT v.insufficient_evidence FROM dictionary_versions v
                WHERE v.entry_id=dictionary_entries.id
                  AND v.state='applied' AND v.outcome<>'degraded'
                ORDER BY v.generated_at DESC, v.rowid DESC LIMIT 1
             ), 0),
             status=CASE WHEN EXISTS(
               SELECT 1 FROM dictionary_versions v
                WHERE v.entry_id=dictionary_entries.id
                  AND v.state='applied' AND v.outcome<>'degraded'
             ) THEN status ELSE 'draft' END
       WHERE current_version_id IN (
         SELECT id FROM dictionary_versions WHERE outcome='degraded'
       );

      UPDATE dictionary_entries
         SET proposed_version_id=NULL
       WHERE proposed_version_id IN (
         SELECT id FROM dictionary_versions WHERE outcome='degraded'
       );

      DROP TABLE dictionary_versions_v165;
    `,
  },
  {
    version: 167,
    up: /* sql */ `
      -- Durable Deep Research for structured databases. Runs are scoped to one
      -- database; all subordinate material is disposable with its run.
      CREATE TABLE IF NOT EXISTS database_research_runs (
        id            TEXT PRIMARY KEY,
        database_id   TEXT NOT NULL REFERENCES db_databases(id) ON DELETE CASCADE,
        objective     TEXT NOT NULL,
        title         TEXT,
        language      TEXT,
        model_json    TEXT,
        options_json  TEXT NOT NULL DEFAULT '{}',
        request_json  TEXT NOT NULL DEFAULT '{}',
        plan_json     TEXT NOT NULL DEFAULT '{}',
        snapshot_manifest_json TEXT NOT NULL DEFAULT '{}',
        snapshot_fingerprint TEXT,
        provider      TEXT,
        budget_json   TEXT NOT NULL DEFAULT '{}',
        revisions_json TEXT NOT NULL DEFAULT '[]',
        phase         TEXT CHECK (phase IS NULL OR phase IN ('snapshot','semantic_profile','planning','calculations','sensitivity','adversarial_review','verification','assembly','done')),
        progress_json TEXT NOT NULL DEFAULT '{}',
        revision      INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
        status        TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','completed','partial','failed','stale','cancelling','cancelled')),
        progress      REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
        current_step  TEXT CHECK (current_step IS NULL OR current_step IN ('snapshot','semantic_profile','planning','calculations','sensitivity','adversarial_review','verification','assembly')),
        error         TEXT,
        report_id     TEXT,
        created_at    TEXT NOT NULL,
        started_at    TEXT,
        completed_at  TEXT,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS database_research_runs_database_idx
        ON database_research_runs(database_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS database_research_runs_status_idx
        ON database_research_runs(status, created_at ASC);
      CREATE INDEX IF NOT EXISTS database_research_runs_phase_idx
        ON database_research_runs(current_step, updated_at DESC);

      CREATE TABLE IF NOT EXISTS database_research_steps (
        id            TEXT PRIMARY KEY,
        run_id        TEXT NOT NULL REFERENCES database_research_runs(id) ON DELETE CASCADE,
        kind          TEXT NOT NULL CHECK (kind IN ('snapshot','semantic_profile','planning','calculations','sensitivity','adversarial_review','verification','assembly')),
        ordinal       INTEGER NOT NULL CHECK (ordinal >= 0),
        task          TEXT,
        agent         TEXT,
        params_json   TEXT NOT NULL DEFAULT '{}',
        result_json   TEXT NOT NULL DEFAULT '{}',
        result_hash   TEXT,
        seed          INTEGER,
        duration_ms   INTEGER,
        status        TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','completed','failed','cancelled')),
        progress      REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
        message       TEXT,
        input_json    TEXT NOT NULL DEFAULT '{}',
        output_json   TEXT NOT NULL DEFAULT '{}',
        error         TEXT,
        started_at    TEXT,
        completed_at  TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        UNIQUE(run_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS database_research_steps_run_idx
        ON database_research_steps(run_id, ordinal ASC);
      CREATE INDEX IF NOT EXISTS database_research_steps_status_idx
        ON database_research_steps(status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS database_research_claims (
        id              TEXT PRIMARY KEY,
        run_id          TEXT NOT NULL REFERENCES database_research_runs(id) ON DELETE CASCADE,
        text            TEXT NOT NULL,
        claim_type      TEXT,
        claim_status    TEXT NOT NULL DEFAULT 'exploratory'
                      CHECK (claim_status IN ('verified','sensitive','exploratory','unverifiable')),
        confidence      REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        source_row_ids_json TEXT NOT NULL DEFAULT '[]',
        evidence_json   TEXT NOT NULL DEFAULT '{}',
        artifact_refs_json TEXT NOT NULL DEFAULT '[]',
        ordinal         INTEGER NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
        created_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS database_research_claims_run_idx
        ON database_research_claims(run_id, ordinal ASC);
      CREATE INDEX IF NOT EXISTS database_research_claims_status_idx
        ON database_research_claims(run_id, claim_status);

      CREATE TABLE IF NOT EXISTS database_research_reports (
        id              TEXT PRIMARY KEY,
        run_id          TEXT NOT NULL UNIQUE REFERENCES database_research_runs(id) ON DELETE CASCADE,
        title           TEXT NOT NULL,
        markdown        TEXT NOT NULL,
        summary         TEXT,
        bibliography_json TEXT NOT NULL DEFAULT '[]',
        metadata_json   TEXT NOT NULL DEFAULT '{}',
        structured_json TEXT NOT NULL DEFAULT '{}',
        quality_json   TEXT NOT NULL DEFAULT '{}',
        provenance_json TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS database_research_reports_updated_idx
        ON database_research_reports(updated_at DESC);
    `,
  },
  {
    version: 168,
    // The body is a harmless marker; after performs conditional ALTERs so replaying
    // v168 after a user_version repair cannot produce duplicate-column errors.
    up: /* sql */ `SELECT 1;`,
    after: ensureDatabaseResearchReportTypeColumns,
  },
  {
    version: 169,
    up: /* sql */ `SELECT 1;`,
    after: ensureDatabaseResearchClaimMetricColumns,
  },
  {
    version: 170,
    up: /* sql */ `SELECT 1;`,
    after: ensureDatabaseResearchReaderColumns,
  },
  {
    version: 171,
    up: /* sql */ `SELECT 1;`,
    after: ensureZoteroFingerprintColumn,
  },
  {
    version: 172,
    up: /* sql */ `SELECT 1;`,
    after: ensureSummaryErrorColumn,
  },
  {
    version: 173,
    up: /* sql */ `SELECT 1;`,
    after: ensureZoteroTitleMarkupColumn,
  },
  {
    version: 174,
    up: /* sql */ `
      DROP VIEW IF EXISTS visible_edges;
      CREATE VIEW visible_edges AS
        SELECT e.* FROM edges e
        JOIN ideas source_idea ON source_idea.global_id = e.from_id AND source_idea.orphaned_at IS NULL
        JOIN ideas target_idea ON target_idea.global_id = e.to_id AND target_idea.orphaned_at IS NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM edge_feedback f
          WHERE f.verdict = 'rejected'
            AND f.type = e.type
            AND ((f.from_id = e.from_id AND f.to_id = e.to_id)
              OR (f.from_id = e.to_id AND f.to_id = e.from_id))
        );
    `,
  },
  { version: 175, up: `CREATE TABLE IF NOT EXISTS stellar_sessions (context TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL);` },
  { version: 176, up: `ALTER TABLE chat_messages ADD COLUMN attachments_json TEXT;` },
  // Whether a profile field's confidence was reported by the provider or is the
  // deterministic direct-support floor standing in for a missing measurement.
  // Rows written before this column read as 'model', which is what they were.
  { version: 177, up: `ALTER TABLE document_profile_fields ADD COLUMN confidence_source TEXT;` },
  { version: 178, up: `ALTER TABLE chat_messages ADD COLUMN concilium_json TEXT;` },
  {
    // Attendance (teaching vault). One row per student per LOCAL day; an empty cell
    // has no row, so "not recorded" can never be mistaken for "present". The group is
    // reached through the student, not stored twice. Holidays belong to a group — the
    // interface offers to copy one to the teacher's other groups, but each group keeps
    // its own calendar. A holiday hides the marks under it rather than deleting them.
    // IF NOT EXISTS: a vault that already has the tables (a differently numbered build,
    // a replayed upgrade) must reach head instead of failing on "already exists".
    version: 179,
    up: TEACHING_ATTENDANCE_SQL,
  },
  { version: 180, up: `
    CREATE TABLE IF NOT EXISTS research_notebooks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 1, mode TEXT NOT NULL CHECK(mode IN ('fixed','linked')),
      sources_json TEXT NOT NULL, exclusions_json TEXT NOT NULL, resolved_ids_json TEXT NOT NULL,
      settings_json TEXT, notes_json TEXT NOT NULL DEFAULT '[]', conversation_settings_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS research_notebook_conversations (
      conversation_id TEXT PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
      notebook_id TEXT NOT NULL REFERENCES research_notebooks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS research_notebook_conversations_notebook ON research_notebook_conversations(notebook_id);
    CREATE TABLE IF NOT EXISTS research_run_scopes (
      id TEXT PRIMARY KEY, notebook_id TEXT, scope_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
  ` },
  { version: 181, up: `
    CREATE TABLE IF NOT EXISTS research_conversation_provenance (
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      scope_id TEXT NOT NULL REFERENCES research_run_scopes(id),
      role TEXT NOT NULL CHECK(role IN ('user','assistant')), content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(conversation_id,scope_id,role,content_hash)
    );
  ` },
  { version: 182, up: `
    CREATE TABLE IF NOT EXISTS passage_publications (
      nodus_id TEXT PRIMARY KEY REFERENCES works(nodus_id) ON DELETE CASCADE,
      token TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL
    );
  ` },
  // Research chat projects, their folder trees, and where each conversation sits (a project,
  // a folder in it, pinned). Projects stay flat; folders nest inside one project. The
  // folders' keys do the structural work: a project takes its folders with it, a folder
  // its subfolders, and a deleted folder leaves its chats in the project, unfiled. The
  // repo's transactions still release a project's chats and drop a conversation's
  // placement, since placements carry no key to chat_conversations.
  { version: 183, up: `
    CREATE TABLE IF NOT EXISTS research_chat_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS research_chat_project_folders (
      folder_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES research_chat_projects(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES research_chat_project_folders(folder_id) ON DELETE CASCADE,
      name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS research_chat_project_folders_project ON research_chat_project_folders(project_id);
    CREATE INDEX IF NOT EXISTS research_chat_project_folders_parent ON research_chat_project_folders(parent_id);
    CREATE TABLE IF NOT EXISTS research_chat_placements (
      conversation_id TEXT PRIMARY KEY, project_id TEXT, pinned_at TEXT,
      folder_id TEXT REFERENCES research_chat_project_folders(folder_id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS research_chat_placements_project ON research_chat_placements(project_id);
    CREATE INDEX IF NOT EXISTS research_chat_placements_folder ON research_chat_placements(folder_id);
  ` },
  { version: 184, up: /* sql */ `SELECT 1;`, after: (db) => addColumnIfMissing(db, 'chat_messages', 'skills_json', 'TEXT') },
  // A notebook shows in the chat history like a project: its own icon and colour.
  { version: 185, up: /* sql */ `SELECT 1;`, after: (db) => addColumnIfMissing(db, 'research_notebooks', 'icon', 'TEXT') },
  { version: 186, up: /* sql */ `SELECT 1;`, after: (db) => addColumnIfMissing(db, 'research_notebooks', 'color', 'TEXT') },
  // Research Chat web evidence: the exact passage Nodus read, where and when, so a
  // web citation stays verifiable after the page changes or disappears.
  { version: 187, up: `
    CREATE TABLE IF NOT EXISTS research_web_passages (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      final_url TEXT NOT NULL,
      title TEXT NOT NULL,
      site_name TEXT,
      domain TEXT NOT NULL,
      byline TEXT,
      published_at TEXT,
      doi TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('html', 'pdf')),
      page_number INTEGER,
      heading TEXT,
      text TEXT NOT NULL,
      retrieved_at TEXT NOT NULL
    );
  ` },
  // Research chat folders and placements carry their own updated_at, so a folder renamed or
  // moved, or a chat filed, travels by newest-wins like every other synced row. Without a
  // stamp the merge keeps whatever the receiving device already had, and a chat moved on
  // one machine never moved on the other.
  {
    version: 188,
    up: /* sql */ `SELECT 1;`,
    after: (db) => {
      addColumnIfMissing(db, 'research_chat_project_folders', 'updated_at', 'TEXT');
      addColumnIfMissing(db, 'research_chat_placements', 'updated_at', 'TEXT');
      db.exec(`
        UPDATE research_chat_project_folders SET updated_at = created_at WHERE updated_at IS NULL;
        UPDATE research_chat_placements SET updated_at = COALESCE(
          (SELECT c.updated_at FROM chat_conversations c WHERE c.id = research_chat_placements.conversation_id),
          pinned_at, '1970-01-01T00:00:00.000Z') WHERE updated_at IS NULL;
      `);
    },
  },
  // The Databases and Worldbuilding chat histories get what Research Chat has: projects,
  // folders nested inside them, pins and notebooks, each surface in tables of its own so
  // no history can read or write another's. The same shape and keys as migration 183
  // plus 188's stamps; a notebook is the named set of sources its chats read, kept as the
  // surface's own selection JSON. Placements carry no key to their conversation; the
  // repository drops a chat's placement with it and the repair pass catches the rest.
  { version: 189, up: `
    CREATE TABLE IF NOT EXISTS database_chat_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS database_chat_project_folders (
      folder_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES database_chat_projects(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES database_chat_project_folders(folder_id) ON DELETE CASCADE,
      name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS database_chat_project_folders_project ON database_chat_project_folders(project_id);
    CREATE INDEX IF NOT EXISTS database_chat_project_folders_parent ON database_chat_project_folders(parent_id);
    CREATE TABLE IF NOT EXISTS database_chat_notebooks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT, selection_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS database_chat_placements (
      conversation_id TEXT PRIMARY KEY, project_id TEXT, pinned_at TEXT,
      folder_id TEXT REFERENCES database_chat_project_folders(folder_id) ON DELETE SET NULL,
      notebook_id TEXT REFERENCES database_chat_notebooks(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS database_chat_placements_project ON database_chat_placements(project_id);
    CREATE INDEX IF NOT EXISTS database_chat_placements_folder ON database_chat_placements(folder_id);
    CREATE INDEX IF NOT EXISTS database_chat_placements_notebook ON database_chat_placements(notebook_id);
    CREATE TABLE IF NOT EXISTS world_chat_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS world_chat_project_folders (
      folder_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES world_chat_projects(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES world_chat_project_folders(folder_id) ON DELETE CASCADE,
      name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS world_chat_project_folders_project ON world_chat_project_folders(project_id);
    CREATE INDEX IF NOT EXISTS world_chat_project_folders_parent ON world_chat_project_folders(parent_id);
    CREATE TABLE IF NOT EXISTS world_chat_notebooks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT, selection_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS world_chat_placements (
      conversation_id TEXT PRIMARY KEY, project_id TEXT, pinned_at TEXT,
      folder_id TEXT REFERENCES world_chat_project_folders(folder_id) ON DELETE SET NULL,
      notebook_id TEXT REFERENCES world_chat_notebooks(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS world_chat_placements_project ON world_chat_placements(project_id);
    CREATE INDEX IF NOT EXISTS world_chat_placements_folder ON world_chat_placements(folder_id);
    CREATE INDEX IF NOT EXISTS world_chat_placements_notebook ON world_chat_placements(notebook_id);
  ` },
  // Archiving, as in Research Chat: an archived chat leaves the normal history.
  { version: 190, up: /* sql */ `SELECT 1;`, after: (db) => addColumnIfMissing(db, 'database_chat_conversations', 'archived', 'INTEGER NOT NULL DEFAULT 0') },
  { version: 191, up: /* sql */ `SELECT 1;`, after: (db) => addColumnIfMissing(db, 'world_chat_conversations', 'archived', 'INTEGER NOT NULL DEFAULT 0') },
  // A database from an earlier build of the research notebooks branch passed 179 under
  // that branch's own numbering and never created main's attendance tables. The body
  // names ON DELETE CASCADE, so the create-only backfill will not replay it; this does,
  // and is a no-op wherever the tables exist.
  { version: 192, up: TEACHING_ATTENDANCE_SQL },
  { version: 193, up: 'SELECT 1;', after: (db) => {
    for (const table of ['research_chat_projects', 'database_chat_projects', 'world_chat_projects']) {
      addColumnIfMissing(db, table, 'instructions', "TEXT NOT NULL DEFAULT ''");
    }
  } },
  { version: 194, up: STUDY_FOCUS_SQL },
  { version: 195, up: 'SELECT 1;', after: ensureStudyFocusTaskColumn },
  // Workspace notes linked to courses, subjects, folders, topics and materials.
  { version: 196, up: STUDY_NOTE_LINKS_SQL },
  // Complete study guide (Study Deep Research mode). Machine-local working state:
  // the frozen reading snapshot and per-pass checkpoints of a run (so a re-queued job
  // resumes), a content-addressed cache of reading passes (so "another version" does
  // not re-read unchanged sources), and each saved guide's evidence sidecar. The
  // saved Markdown is self-sufficient; none of these rows is synced.
  { version: 197, up: /* sql */ `
    CREATE TABLE IF NOT EXISTS complete_guide_runs (
      run_id       TEXT PRIMARY KEY,
      stage        TEXT NOT NULL DEFAULT 'snapshot',
      request_json TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS complete_guide_units (
      run_id      TEXT NOT NULL,
      stage       TEXT NOT NULL,
      unit_key    TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      PRIMARY KEY (run_id, stage, unit_key)
    );
    CREATE TABLE IF NOT EXISTS complete_guide_chunk_cache (
      cache_key    TEXT PRIMARY KEY,
      stage        TEXT NOT NULL,
      result_json  TEXT NOT NULL,
      bytes        INTEGER NOT NULL,
      last_used_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_complete_guide_cache_used ON complete_guide_chunk_cache(last_used_at);
    CREATE TABLE IF NOT EXISTS complete_guide_artifacts (
      draft_id     TEXT PRIMARY KEY,
      run_id       TEXT NOT NULL,
      artifacts_json TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
  ` },
  { version: 198, up: 'SELECT 1;', after: (db) => {
    // Earlier branch builds can have all or part of these additive columns under
    // a different version. Complete the schema without replacing saved documents.
    for (const table of ['study_docs', 'study_doc_versions', 'note_versions']) {
      addColumnIfMissing(db, table, 'native_document_json', 'TEXT');
      addColumnIfMissing(db, table, 'native_schema_version', 'INTEGER NOT NULL DEFAULT 1');
    }
    addColumnIfMissing(db, 'study_docs', 'editor_revision', 'INTEGER NOT NULL DEFAULT 0');
    for (const table of ['study_annotations', 'note_annotations']) addColumnIfMissing(db, table, 'anchor_json', 'TEXT');
  } },
  { version: 199, up: 'SELECT 1;', after: (db) => {
    for (const table of ['study_docs', 'study_doc_versions', 'note_versions']) addColumnIfMissing(db, table, 'academic_metadata_json', 'TEXT');
  } },
  // Citation receipts of a research scope, one row each, instead of a map inside that scope's
  // `scope_json`. A scope row also carries a manifest of every authorized document — some 8.6 MB
  // on a 14,000-work library — so appending a 2 KB receipt there rewrote the whole row, and the
  // count needed to police it parsed the whole row. That cost is why the store had a hard
  // lifetime limit, and reaching it refused every passage found afterwards, silently, starving
  // later runs of corpus evidence (2026-10-04). A row per receipt costs the receipt, so the limit
  // is gone. Receipts written before this keep resolving from `scope_json`; nothing is moved,
  // which keeps this body pure-CREATE and therefore safe to replay.
  { version: 200, up: /* sql */ `
    CREATE TABLE IF NOT EXISTS research_scope_receipts (
      scope_id     TEXT NOT NULL,
      key          TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      PRIMARY KEY (scope_id, key)
    );
  ` },
];

/**
 * A SQLite error that means the statement's object or column is ALREADY THERE. This is
 * how a database built by a differently-numbered build announces itself: an object a
 * migration wants to create already exists, or a column it wants to add is already
 * present. It is never a reason to fail — the intent (that object should exist) is met —
 * but it must be distinguished from a genuine migration error, which is not swallowed.
 */
function isAlreadyAppliedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|duplicate column name/i.test(message);
}

/**
 * A migration body that only CREATEs objects — no ALTER, DROP, RENAME or data change.
 * Only such a body is safe to replay to backfill a missing object: replaying one that
 * transforms data or rebuilds a table (e.g. copy-into-new-then-drop-old) could destroy
 * data on a database where it already ran. Comments are stripped first so prose that
 * happens to mention "delete" or "update" does not disqualify a pure-CREATE migration.
 *
 * String literals are stripped for exactly the same reason, and it is not hypothetical:
 * `CHECK (op IN ('upsert', 'delete'))` is a pure CREATE TABLE whose only "DELETE" is a
 * value the column may hold. Both server_outbox and server_inbox declare their operation
 * that way, and without this they would be excluded from the recovery path that exists
 * precisely for additive tables like them. Stripping literals can only ever ADD bodies to
 * the create-only set, and only ones whose sole destructive keyword was never a statement.
 */
function isCreateOnly(sql: string): boolean {
  const bare = stripSqlComments(sql).replace(/'(?:[^']|'')*'/g, "''");
  return /\bCREATE\b/i.test(bare) && !/\b(ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/i.test(bare);
}

function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** The table/index/view/trigger names a CREATE-only body brings into being. */
function objectNamesCreatedBy(sql: string): string[] {
  const re = /CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?/gi;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  const bare = stripSqlComments(sql);
  while ((match = re.exec(bare)) !== null) names.push(match[1]);
  return names;
}

/**
 * Split a migration body into top-level statements. Besides quoted values and comments,
 * this understands SQLite's `CREATE TRIGGER ... BEGIN ... END;` grammar: semicolons in a
 * trigger body belong to the trigger, while the semicolon following its terminal END
 * closes the top-level statement. CASE...END expressions are tracked independently so
 * an END inside a trigger UPDATE/INSERT cannot terminate the trigger early.
 *
 * Kept exported because the renumber-recovery test exercises the real splitter against
 * every trigger-bearing migration. It is not part of the application API.
 */
export function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let word = '';
  let prefixTokens: string[] = [];
  let inTrigger = false;
  let triggerBeginDepth = 0;
  let triggerCaseDepth = 0;
  let triggerEnded = false;

  const consumeWord = () => {
    if (!word) return;
    const token = word.toUpperCase();
    word = '';
    if (!inTrigger) {
      prefixTokens.push(token);
      if (prefixTokens.length > 4) prefixTokens = prefixTokens.slice(-4);
      const normalized = prefixTokens.join(' ');
      if (/^CREATE (?:TEMP |TEMPORARY )?TRIGGER$/.test(normalized)) inTrigger = true;
      return;
    }
    if (token === 'CASE') {
      triggerCaseDepth += 1;
    } else if (token === 'BEGIN' && triggerCaseDepth === 0) {
      triggerBeginDepth += 1;
    } else if (token === 'END') {
      if (triggerCaseDepth > 0) triggerCaseDepth -= 1;
      else if (triggerBeginDepth > 0) {
        triggerBeginDepth -= 1;
        triggerEnded = triggerBeginDepth === 0;
      }
    }
  };

  const resetStatementState = () => {
    word = '';
    prefixTokens = [];
    inTrigger = false;
    triggerBeginDepth = 0;
    triggerCaseDepth = 0;
    triggerEnded = false;
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      consumeWord();
      while (i < sql.length && sql[i] !== '\n') { current += sql[i]; i++; }
      continue;
    }
    if (ch === '/' && next === '*') {
      consumeWord();
      current += '/*'; i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) { current += sql[i]; i++; }
      current += '*/'; i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      consumeWord();
      const quote = ch;
      current += ch; i++;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) { current += sql[i + 1]; i += 2; continue; }
          i++; break;
        }
        i++;
      }
      continue;
    }
    if (ch === '[') {
      consumeWord();
      current += ch; i++;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === ']') { i++; break; }
        i++;
      }
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) word += ch;
    else consumeWord();
    if (ch === ';') {
      if (!inTrigger || triggerEnded) {
        if (current.trim()) statements.push(current.trim());
        current = '';
        resetStatementState();
      } else {
        current += ch;
      }
      i++;
      continue;
    }
    current += ch; i++;
  }
  consumeWord();
  if (current.trim()) statements.push(current.trim());
  return statements.filter((s) => s.length > 0);
}

/** Run a body statement by statement, skipping only statements whose object/column is
 *  already there. Any other error still aborts, so a real failure is never masked. */
function execSkippingApplied(db: Database.Database, sql: string): void {
  for (const statement of splitMigrationStatements(sql)) {
    try {
      db.exec(statement);
    } catch (error) {
      if (!isAlreadyAppliedError(error)) throw error;
    }
  }
}

/**
 * Create any purely-additive table or index a database is MISSING even though its
 * user_version is already at or past the migration that introduced it. This happens when
 * a database was migrated by a build whose migration numbering differed (a pre-release,
 * or a feature branch that was later reordered): that build's user_version can sit above
 * an object it never created here, so the normal `version > current` loop skips the
 * migration forever and the table is silently absent. Restricted to CREATE-only
 * migrations and to those the database claims as applied, so a fresh database (nothing
 * applied yet) and data-transforming rebuilds are both left untouched.
 */
function backfillMissingCreateOnly(db: Database.Database, current: number): void {
  const existing = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index','view','trigger')").all() as { name: string }[])
      .map((row) => row.name)
  );
  const applied = migrations.filter((m) => m.version <= current && isCreateOnly(m.up) && !m.after);
  const tx = db.transaction(() => {
    for (const m of applied) {
      const names = objectNamesCreatedBy(m.up);
      if (names.length > 0 && names.every((name) => existing.has(name))) continue;
      execSkippingApplied(db, m.up);
      for (const name of names) existing.add(name);
    }
  });
  tx();
}

export function runMigrations(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const current = db.pragma('user_version', { simple: true }) as number;
  // Repair databases that a differently-numbered build left with a purely-additive table
  // missing below the version line, then migrate forward. Both defend against the same
  // cause: a user_version that does not match the objects actually present.
  backfillMissingCreateOnly(db, current);
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    try {
      const tx = db.transaction(() => {
        db.exec(m.up);
        m.after?.(db);
        db.pragma(`user_version = ${m.version}`);
      });
      tx();
    } catch (error) {
      // A CREATE-only migration whose objects already exist was applied under another
      // build's number. Re-apply only what is missing and record the version, instead of
      // failing the vault switch with "table ... already exists". Anything else — or any
      // migration that transforms data — is re-thrown rather than risked.
      if (!isAlreadyAppliedError(error) || !isCreateOnly(m.up) || m.after) throw error;
      const tx = db.transaction(() => {
        execSkippingApplied(db, m.up);
        db.pragma(`user_version = ${m.version}`);
      });
      tx();
    }
  }
}
