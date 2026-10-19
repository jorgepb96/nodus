import type { BackupCategory } from '@shared/backups';

const technical = new Set(
  `vector_scan_generations settings backup_revision extraction_cache sync_log sync_row_clocks sync_snapshot_cursors sync_tombstones sync_conflicts sync_superseded server_inbox server_outbox workspace_devices workspace_share_links page_document_update_receipts page_migration_reports schema_migration_events complete_guide_chunk_cache document_index_campaigns document_index_checkpoints document_index_jobs document_vectors document_profile_state dictionary_retrieval_state dictionary_corpus_changes db_compute_jobs db_column_dependencies db_row_dependencies db_integrity_quarantine db_relation_repairs db_computed_cells db_blobs study_knowledge_jobs study_ai_usage testimony_segment_embeddings library_analysis_freshness scan_checkpoints edge_traces database_form_rate_limits primary_source_local_metrics stellar_sessions`.split(
    ' ',
  ),
);
const groups: Array<[BackupCategory, RegExp]> = [
  [
    'research',
    /^(works|work_|ideas$|idea_|evidence$|edges$|edge_feedback$|authors$|author_|saved_authors$|themes$|collections$|zotero_tags$|gaps$|external_refs$|passages$|passage_publications$|document_(sections|profile_|idea_links)|library_analysis_provenance$|synthesis_matrix_cell$|tutor_saved_routes$|immersion_sessions$)/,
  ],
  [
    'notes',
    /^(notes$|note_|pages$|page_|workspace_(actors|groups|group_members|library_links|notifications)$|projects$|project_)/,
  ],
  ['dictionary', /^dictionary_/],
  [
    'conversations',
    /^(chat_|research_|writing_|complete_guide_(artifacts|runs|units)$|saved_searches$|content_translations$|audio_clips$|decorative_images$)/,
  ],
  ['study', /^study_/],
  ['teaching', /^teaching_/],
  ['databases', /^(db_|database_|automation_)/],
  ['prosopography', /^prosop_/],
  ['testimony', /^testimony_/],
  [
    'worldbuilding',
    /^(world_|character_|place_profiles$|event_world_dates$|scene_characters$|secret_knowers$|thread_parties$|map_)/,
  ],
  [
    'archive',
    /^(archive_|primary_source_|persons$|person_|places$|events$|event_participants$|relationships$|record_evidence$|entity_resolutions$|kinship_|match_feedback$|social_|protect_copies$|acl_entries$)/,
  ],
];
export function classifyBackupTable(name: string, kind = 'table'): BackupCategory | 'technical' | null {
  if (kind !== 'table' || name.startsWith('sqlite_') || name.startsWith('embedding_index') || technical.has(name) || /_v\d+$/.test(name))
    return 'technical';
  return groups.find(([, match]) => match.test(name))?.[0] ?? null;
}
export function isBackupHistoryTable(name: string): boolean {
  return (
    /(_versions?|_revisions?|_snapshots?|_updates|_audit_log|_attempts|_attempt_answers|_runs|_steps|_reads|_receipts|_log)$/.test(
      name,
    ) ||
    [
      'page_documents',
      'study_reviews',
      'study_study_sessions',
      'study_progress',
      'study_mastery',
      'study_srs_state',
    ].includes(name)
  );
}
export const backupTableKey = (vaultId: string, table: string): string => `${vaultId}:${table}`;
export function backupRecordKey(row: Record<string, unknown>, pk: string[]): string {
  return JSON.stringify(pk.map((key) => row[key] ?? null));
}
export const quoteSqlIdentifier = (name: string): string => `"${name.replace(/"/g, '""')}"`;
export function recordTitle(row: Record<string, unknown>, table: string): string {
  const value =
    row.title ??
    row.label ??
    row.name ??
    row.preferred_name ??
    row.display_name ??
    row.term ??
    row.statement ??
    row.question ??
    row.file_name ??
    row.comment ??
    row.body ??
    row.short_id ??
    row.id ??
    row.nodus_id ??
    row.global_id ??
    table;
  return String(value).replace(/\s+/g, ' ').slice(0, 160);
}
