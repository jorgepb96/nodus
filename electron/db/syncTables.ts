import type Database from 'better-sqlite3';
import type { SyncGroupKey } from '@shared/types';
import { getDb } from './database';
import { identityColumns, tableColumns } from './rowIdentity';

/**
 * Which tables travel between machines, and which deliberately do not.
 *
 * Lives apart from the sync package itself because the deletion tombstones generate
 * their triggers from this same list. Two lists would drift, and a table that syncs but
 * whose deletions do not propagate resurrects itself forever.
 */

/**
 * What travels, by group. Prefix groups pick up new tables automatically — the reason
 * study data never developed the coverage gaps the hand-written groups did.
 *
 * Everything absent from here is either derived from the Zotero corpus and rebuilt on
 * the destination, or machine-local. `describeSyncCoverage()` reports the omissions to
 * the user rather than leaving them to be discovered as missing data.
 */
const SYNC_GROUPS: { key: SyncGroupKey; prefix?: string; tables?: string[] }[] = [
  // Deletions travel as their own records, and are applied before any row is merged so
  // a tombstone can stop a resurrection rather than undo it afterwards.
  { key: 'tombstones', tables: ['sync_tombstones'] },
  // `testimony_note_links` viaja con las notas y no con lo que enlaza: la tabla esta hecha para
  // tolerar un destino ausente (la nota conserva su texto y muestra el enlace roto), asi
  // que un enlace que llega a una maquina sin la entrevista de destino degrada bien. Lo
  // contrario -- una nota que llega sin sus enlaces -- perderia trabajo del investigador
  // en silencio.
  // El Workspace escribe sobre estas mismas tablas: sus colecciones SON `note_folders` y
  // sus notas e ideas SON `notes`. Lo que se le añade -- historial, comentarios anclados y
  // enlaces con la biblioteca -- es trabajo de la persona, no un derivado del corpus, así
  // que viaja con las notas por la misma razón que ellas.
  {
    key: 'notes',
    tables: [
      'note_folders', 'notes', 'note_links', 'testimony_note_links',
      'note_versions', 'note_annotations', 'workspace_library_links',
      'pages', 'page_blocks', 'page_documents', 'page_document_updates', 'page_document_snapshots',
      'page_favorites', 'page_links', 'page_revisions', 'page_comments', 'page_comment_reactions',
      'page_comment_mentions', 'workspace_actors', 'workspace_groups', 'workspace_group_members', 'acl_entries',
    ],
  },
  {
    key: 'writing',
    tables: [
      'writing_saved_drafts',
      // Having read a report is true of the person, not of the machine, so it travels
      // beside the report it is about. Why it is a table and not a column on the row
      // above is in the migration that creates it.
      'writing_draft_reads',
      // Highlights and comments are authored reading work. Small independent rows keep
      // their newest-wins merge from rewriting the multi-page report they annotate.
      'writing_draft_annotations',
      'projects',
      'project_sections',
      'project_chapters',
      'project_chapter_versions',
      'project_chapter_chunks',
      'project_chapter_ideas',
      'project_chapter_idea_relations',
      'project_links',
      'project_insertion_suggestions',
    ],
  },
  { key: 'searches', tables: ['saved_searches'] },
  { key: 'edgeFeedback', tables: ['edge_feedback'] },
  { key: 'curation', tables: ['match_feedback'] },
  {
    key: 'databases',
    prefix: 'db_',
    tables: [
      'automation_rules', 'automation_runs', 'automation_notifications',
      'database_forms', 'database_form_fields', 'database_form_submissions',
    ],
  },
  { key: 'protect', tables: ['protect_copies'] },
  { key: 'study', prefix: 'study_' },
  { key: 'teaching', prefix: 'teaching_' },
  { key: 'prosopography', prefix: 'prosop_' },
  {
    key: 'genealogy',
    tables: [
      'persons',
      'person_names',
      'person_places',
      'person_portraits',
      'places',
      'events',
      'event_participants',
      'relationships',
      'evidence',
      'record_evidence',
      'archive_folders',
      'archive_items',
      'archive_item_folders',
      'archive_item_persons',
      'archive_item_tags',
      // Primary Sources is an additive archival layer over archive_items. Every table
      // below contains user-authored description, evidence, preservation history or
      // review decisions and therefore travels with the compatible legacy record.
      'archive_repositories',
      'archive_description_units',
      'archive_item_units',
      'archive_capture_sessions',
      'archive_item_profiles',
      'archive_item_files',
      'archive_text_versions',
      'archive_text_segments',
      'archive_excerpts',
      'archive_entity_proposals',
      'archive_proposal_decisions',
      'archive_source_analyses',
      'archive_place_mentions',
      'archive_place_resolution_decisions',
      'archive_person_mentions',
      'entity_resolutions',
      'note_links',
      'testimony_note_links',
      'primary_source_note_profiles',
      'primary_source_note_link_snapshots',
      'primary_source_policies',
      'primary_source_citation_settings',
      'primary_source_operation_runs',
      'primary_source_export_manifests',
      'primary_source_restore_reports',
      'archive_integrity_checks',
      'archive_exports',
      'archive_description_templates',
      'archive_audit_log',
      'kinship_suggestions',
      'kinship_suggestion_evidence',
      'social_contacts',
      'social_relations',
    ],
  },
  // A worldbuilding character's own layer. The person row it hangs off travels in the
  // group above (both vault types share that ontology); these two are the fiction-only
  // half, and they are authored by hand and irreplaceable, so they must travel too.
  {
    key: 'worldbuilding',
    tables: [
      'character_profiles',
      'event_world_dates',
      'character_abilities',
      // v94: one gallery table for every world entity, replacing character_images.
      'world_images',
      'world_groups',
      'character_affiliations',
      'place_profiles',
      'world_secrets',
      'secret_knowers',
      'world_scenes',
      'scene_characters',
      // The world's calendar. Its `world_day` values are derived, but they travel with the
      // eras and months that produced them, so a merged package stays self-consistent.
      // Maps. The image blobs travel with them: a map without its picture is an empty
      // frame full of correctly-placed pins, which is worse than no map at all.
      'world_maps',
      'map_images',
      'map_layers',
      'map_markers',
      'map_travel_modes',
      'world_calendar',
      'world_calendar_eras',
      'world_calendar_months',
      // The encyclopedia. `world_links` is derived from the bodies, but it travels anyway:
      // there is no cheap way to recompute it on arrival for the five entry kinds that
      // have no body column, so mergeSyncPackage reconciles it with rebuildWorldLinks()
      // once the bodies it describes have been merged.
      'world_articles',
      'world_links',
      'world_entry_proposals',
      // Analizar (v99). `world_beats` is irreplaceable authorship, not a derivative: the
      // mention comes from `world_links`, but "the law breaks here and nobody pays" is
      // something only the writer can say. The keys of `world_beats`, `thread_parties`
      // and `world_notice_mutes` are content-derived precisely so that rewriting them
      // leaves no tombstone on every save.
      'world_scene_days',
      'world_threads',
      'thread_parties',
      'world_beats',
      'world_rules',
      'world_questions',
      'world_question_options',
      'world_notice_mutes',
      // El manuscrito (v100). La prosa es autoria irreemplazable; el recuento de palabras
      // viaja con ella porque se deriva de un texto que la lista no lee, y el diario de
      // palabras es historia, no cache.
      'world_scene_text',
      'world_chapter_breaks',
      'world_word_days',
      // v101: los libros son marcas como los capitulos, y las instantaneas son autoria
      // que el autor ya ha perdido una vez si viaja sin ellas.
      'world_manuscript_starts',
      'world_scene_snapshots',
      // v102: conversation history and its explicit focus are author working context,
      // not a regenerable model cache.
      'world_chat_conversations',
      // Its history's projects, nested folders, notebooks and where each chat sits. Folders
      // and placements carry updated_at, so a move travels by newest-wins; the merge's
      // repair pass clears a chat's folder when another device deleted it.
      'world_chat_projects',
      'world_chat_project_folders',
      'world_chat_notebooks',
      'world_chat_placements',
      // v103: character roleplay chats and their generated binary attachments. Images
      // follow messages so an imported package never presents an attachment without its
      // answer, even though deletion remains explicit rather than FK-driven.
      'character_chat_conversations',
      'character_chat_messages',
      'character_chat_images',
    ],
  },
  {
    key: 'research',
    tables: [
      'research_questions',
      'research_subquestions',
      'research_coverage_links',
      'synthesis_matrix_cell',
      'tutor_saved_routes',
      'immersion_sessions',
      'dictionary_entries',
      'dictionary_evidence',
      'dictionary_versions',
      'dictionary_relations',
    ],
  },
  { key: 'chats', tables: ['chat_conversations', 'chat_messages', 'database_chat_conversations', 'research_notebooks', 'research_notebook_conversations', 'research_chat_projects', 'research_chat_project_folders', 'research_chat_placements',
    'database_chat_projects', 'database_chat_project_folders', 'database_chat_notebooks', 'database_chat_placements'] },
  { key: 'content', tables: ['content_translations', 'decorative_images', 'audio_clips', 'page_block_blobs'] },
];

/**
 * Corpus-derived or machine-local tables, listed explicitly so `describeSyncCoverage`
 * can tell the user what a package does NOT carry. Anything in neither list is reported
 * as unclassified, which is how a future migration announces itself instead of being
 * quietly dropped.
 */
const NOT_SYNCED_TABLES = new Set([
  // Canvas positions and playback history are local navigation state, not corpus records.
  'stellar_sessions',
  'works', 'work_aliases', 'work_authors', 'work_collections', 'work_idea_synthesis', 'work_summaries',
  'work_themes', 'work_zotero_tags', 'authors', 'author_relations', 'author_dossier_synthesis',
  'saved_authors',
  'ideas', 'idea_occurrences', 'idea_theme_links', 'themes', 'edges', 'edge_traces', 'gaps',
  'passages', 'collections', 'zotero_tags', 'external_refs', 'extraction_cache', 'scan_checkpoints',
  // Scope receipts authorize evidence against THIS profile's revisions and
  // permissions. Importing them would incorrectly trust another device's history.
  // Publication fencing likewise belongs to the local passage writer.
  'research_run_scopes', 'research_scope_receipts', 'research_conversation_provenance', 'passage_publications',
  // Web receipts are what THIS machine read; another device verifies its own.
  'research_web_passages',
  // Complete study guide working state and evidence sidecars: run checkpoints and the
  // reading cache describe THIS machine's model calls; the saved guide's Markdown
  // travels with writing_saved_drafts and does not need them.
  'complete_guide_runs', 'complete_guide_units', 'complete_guide_chunk_cache', 'complete_guide_artifacts',
  // Source-resolution provenance is rebuilt from this machine's Zotero/library files.
  // Shipping it would create attachment locators that may not exist on the receiver.
  'work_text_sources',
  'dictionary_retrieval_state', 'dictionary_corpus_changes',
  // Audited document understanding is derived from the local source corpus. It
  // can be rebuilt or copied only through the exact-provenance reuse path; row
  // sync would otherwise publish a profile without its source and model contract.
  'document_profile_state', 'document_profile_versions', 'document_profile_fields',
  'document_sections', 'document_profile_support', 'document_vectors', 'document_idea_links',
  'document_profile_overrides', 'document_index_campaigns', 'document_index_jobs',
  'document_index_checkpoints',
  // FTS projections and every SQLite-managed shadow table are local indexes.
  'document_profiles_fts', 'document_profiles_fts_data', 'document_profiles_fts_idx',
  'document_profiles_fts_content', 'document_profiles_fts_docsize', 'document_profiles_fts_config',
  'document_sections_fts', 'document_sections_fts_data', 'document_sections_fts_idx',
  'document_sections_fts_content', 'document_sections_fts_docsize', 'document_sections_fts_config',
  'passages_fts', 'passages_fts_data', 'passages_fts_idx', 'passages_fts_content',
  'passages_fts_docsize', 'passages_fts_config',
  // Rebuilt from canonical Library manifests for this vault. Syncing transient
  // freshness would let one machine incorrectly mark another machine's output current.
  'library_analysis_freshness',
  'library_analysis_provenance',
  'sync_log', 'settings',
  // A single machine-local counter used only to decide whether its next automatic
  // backup can reuse a verified snapshot. Moving it to another machine would neither
  // carry user data nor describe the receiver's SQLite file.
  'backup_revision',
  // Write counters the vector-scan worker keys its cache on (vectorScanGenerations.ts):
  // they describe this SQLite file's writes, not anything a receiver could use.
  'vector_scan_generations',
  // Explicitly local, opt-in and content-free beta performance observations.
  'primary_source_local_metrics',
  // Deliberately machine-local: it is THIS computer's record of what its own merges
  // discarded. Shipping it would let one machine's audit trail overwrite the other's,
  // and restoring an entry there would write a row that never lost anything here.
  'sync_superseded',
  // Local recovery audit: the immutable snapshot itself lives beside this machine's
  // SQLite file and cannot travel in a row package. Syncing its event would advertise a
  // recovery point that does not exist on the receiving device.
  'schema_migration_events',
  // Counts from the one-time local conversion are recovery evidence for this machine;
  // they are not authored page content and another client must not overwrite them.
  'page_migration_reports',
  // Content-addressed update receipts only prevent this replica from applying the same
  // Yjs payload twice. Sending them elsewhere could suppress an update the destination
  // has not actually applied, so each device rebuilds its own receipt set.
  'page_document_update_receipts',
  // Same reasoning: THIS machine's queue of changes still owed to a Nodus Server space.
  // Carrying it in a .nodussync package would make the receiving machine re-send work it
  // never did, and the sender would then see its own edits arrive back as someone else's.
  'server_outbox',
  // Y su reverso: THIS machine's record of what arrived from another device and what
  // was done with it. An entry belongs to the vault it landed in, on the computer that
  // applied it — carrying it would tell a second machine it had received work it never
  // received, and its read/unread state is one person's, on one screen.
  'server_inbox',
  // Per-device clocks, conflict diagnostics and cursors are local transport state. The
  // authored rows they describe travel; these records must not recursively sync themselves.
  'workspace_devices', 'sync_row_clocks', 'sync_conflicts', 'sync_snapshot_cursors',
  // A public-link token is a credential. Links are recreated/managed by the destination
  // server in loop 18 and their hashes never enter a replica snapshot.
  'workspace_share_links',
  // Inbox read state belongs to one actor/device and is rebuilt from collaborative events.
  'workspace_notifications',
  // Rate-limit buckets describe requests observed by this local HTTP listener. They
  // expire by time window, contain no authored response, and must not let one device's
  // traffic throttle a different device after sync.
  'database_form_rate_limits',
  // Loop 4 projections and execution state are rebuilt from canonical database rows,
  // columns, relations and attachments. FTS5's shadow tables must never receive sync or
  // tombstone triggers (SQLite rejects triggers on shadow tables).
  'db_computed_cells',
  'db_column_dependencies',
  'db_compute_jobs',
  'db_search_fts',
  'db_search_fts_data',
  'db_search_fts_idx',
  'db_search_fts_content',
  'db_search_fts_docsize',
  'db_search_fts_config',
  // Database Deep Research is deliberately desktop-local in schema v167. Runs and
  // steps describe a machine-local queue; claims and reports are bound to an immutable
  // local SQLite fingerprint. Syncing any subset would detach evidence from the exact
  // snapshot that was verified. A future remote format needs an atomic provenance
  // contract rather than inheriting generic row sync accidentally.
  'database_research_runs',
  'database_research_steps',
  'database_research_claims',
  'database_research_reports',
  'database_research_report_annotations',
  // TESTIMONIOS NO SE SINCRONIZA, y es una decision, no una omision (decision 18 del
  // plan). Antes de activarlo hay que demostrar que TODAS estas tablas viajan, que los
  // blobs de los maestros tienen una politica explicita, y sobre todo que las
  // restricciones y el acuerdo viajan DE FORMA ATOMICA con su entrevista. Una entrevista
  // que llegue a otra maquina sin su acuerdo llega como material sin condiciones de
  // acceso, que es exactamente la exposicion que este vault existe para evitar. Hasta
  // entonces se presenta como local y respaldable, y `describeSyncCoverage` lo dice.
  'testimony_segment_embeddings',
  'testimony_interviews',
  'testimony_participant_profiles',
  'testimony_interview_participants',
  'testimony_sessions',
  'testimony_media',
  'testimony_transcripts',
  'testimony_transcript_segments',
  'testimony_codes',
  'testimony_annotations',
  'testimony_annotation_codes',
  'testimony_agreements',
  'testimony_contrasts',
  'testimony_contrast_items',
]);

export function localTableNames(db: Database.Database = getDb()): Set<string> {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
      .map((row) => row.name)
      .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
  );
}

/** The tables this build syncs, in group order, restricted to what actually exists. */
export function syncedTablesByGroup(db: Database.Database = getDb()): { key: SyncGroupKey; tables: string[] }[] {
  const present = localTableNames(db);
  return SYNC_GROUPS.map((group) => ({
    key: group.key,
    tables: [...present]
      .filter((name) => !NOT_SYNCED_TABLES.has(name))
      .filter((name) => Boolean((group.prefix && name.startsWith(group.prefix)) || group.tables?.includes(name)))
      .sort(),
  }));
}

export function syncedTableNames(db: Database.Database = getDb()): string[] {
  return syncedTablesByGroup(db).flatMap((group) => group.tables);
}

export function groupOfTable(): Map<string, SyncGroupKey> {
  const map = new Map<string, SyncGroupKey>();
  for (const group of syncedTablesByGroup()) {
    for (const table of group.tables) map.set(table, group.key);
  }
  return map;
}

/**
 * What a package carries and what it deliberately leaves behind, for the UI. Users were
 * previously given a success count with no way to tell that whole modules had not
 * travelled at all.
 */
export function describeSyncCoverage(): {
  included: Record<string, string[]>;
  excluded: string[];
  unclassified: string[];
  unmergeable: string[];
} {
  const included: Record<string, string[]> = {};
  for (const group of syncedTablesByGroup()) {
    if (group.tables.length > 0) included[group.key] = group.tables;
  }
  const covered = [...new Set(Object.values(included).flat())];
  const present = [...localTableNames()].sort();
  return {
    included,
    excluded: present.filter((name) => !covered.includes(name) && NOT_SYNCED_TABLES.has(name)),
    unclassified: present.filter((name) => !covered.includes(name) && !NOT_SYNCED_TABLES.has(name)),
    // Synced tables whose rows cannot be matched at all. Must stay empty: a table here
    // would travel on a first sync and then conflict forever after.
    unmergeable: covered.filter((name) => identityColumns(name, tableColumns(name)).length === 0).sort(),
  };
}
