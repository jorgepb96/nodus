import { createHash } from 'node:crypto';
import { getDb, withVaultDatabase } from '../db/database';
import { getVault } from '../vaults/vaultRegistry';
import { privateSourceMaterials, matchPrivateSource } from './privateSourceContext';

type Database = ReturnType<typeof getDb>;
type RecordRow = Record<string, unknown>;
type Group = { key: string; title: string; table: string; where: string };
type Plan = { domain: string; table: string; primaryKey: string; groups: Group[] };
const group = (key: string, title: string, table: string, where: string): Group => ({ key, title, table, where });
const sourceFactoids = 'r.source_id = ?';
const personFactoids = "EXISTS (SELECT 1 FROM prosop_statements s JOIN prosop_statement_entities e ON e.statement_id = s.statement_id WHERE s.factoid_id = r.factoid_id AND e.entity_kind = 'person' AND e.entity_id = ?)";
const interviewMedia = 'EXISTS (SELECT 1 FROM testimony_sessions s WHERE s.id = r.session_id AND s.interview_id = ?)';
const interviewTranscripts = 'EXISTS (SELECT 1 FROM testimony_media m JOIN testimony_sessions s ON s.id = m.session_id WHERE m.id = r.media_id AND s.interview_id = ?)';
const interviewSegments = 'EXISTS (SELECT 1 FROM testimony_transcripts t JOIN testimony_media m ON m.id = t.media_id JOIN testimony_sessions s ON s.id = m.session_id WHERE t.id = r.transcript_id AND s.interview_id = ?)';
const contrastAnnotations = 'EXISTS (SELECT 1 FROM testimony_contrast_items c WHERE c.annotation_id = r.id AND c.contrast_id = ?)';
const plans: Record<string, Plan> = {
  'testimony-interview': { domain: 'testimonies', table: 'testimony_interviews', primaryKey: 'id', groups: [
    group('participants', 'Participantes', 'testimony_interview_participants', 'r.interview_id = ?'),
    group('sessions', 'Sesiones', 'testimony_sessions', 'r.interview_id = ?'),
    group('media', 'Archivos', 'testimony_media', interviewMedia),
    group('transcripts', 'Transcripciones', 'testimony_transcripts', interviewTranscripts),
    group('segments', 'Fragmentos de transcripción', 'testimony_transcript_segments', interviewSegments),
    group('agreements', 'Acuerdos y versiones', 'testimony_agreements', 'r.interview_id = ?'),
    group('annotations', 'Anotaciones', 'testimony_annotations', 'r.interview_id = ?'),
    group('codes', 'Códigos utilizados', 'testimony_codes', 'EXISTS (SELECT 1 FROM testimony_annotation_codes c JOIN testimony_annotations a ON a.id = c.annotation_id WHERE c.code_id = r.id AND a.interview_id = ?)'),
    group('annotationCodes', 'Codificación de fragmentos', 'testimony_annotation_codes', 'EXISTS (SELECT 1 FROM testimony_annotations a WHERE a.id = r.annotation_id AND a.interview_id = ?)'),
    group('noteLinks', 'Notas vinculadas', 'testimony_note_links', "EXISTS (SELECT 1 FROM testimony_interviews i WHERE i.id = ? AND ((r.target_kind = 'testimony_interview' AND r.target_id = i.id) OR (r.target_kind = 'testimony_annotation' AND EXISTS (SELECT 1 FROM testimony_annotations a WHERE a.id = r.target_id AND a.interview_id = i.id))))"),
  ] },
  'testimony-transcript': { domain: 'testimonies', table: 'testimony_transcripts', primaryKey: 'id', groups: [
    group('media', 'Archivo de origen', 'testimony_media', 'EXISTS (SELECT 1 FROM testimony_transcripts t WHERE t.media_id = r.id AND t.id = ?)'),
    group('segments', 'Fragmentos de transcripción', 'testimony_transcript_segments', 'r.transcript_id = ?'),
    group('annotations', 'Anotaciones', 'testimony_annotations', 'r.transcript_id = ?'),
    group('codes', 'Códigos utilizados', 'testimony_codes', 'EXISTS (SELECT 1 FROM testimony_annotation_codes c JOIN testimony_annotations a ON a.id = c.annotation_id WHERE c.code_id = r.id AND a.transcript_id = ?)'),
    group('annotationCodes', 'Codificación de fragmentos', 'testimony_annotation_codes', 'EXISTS (SELECT 1 FROM testimony_annotations a WHERE a.id = r.annotation_id AND a.transcript_id = ?)'),
  ] },
  'testimony-contrast': { domain: 'testimonies', table: 'testimony_contrasts', primaryKey: 'id', groups: [
    group('items', 'Fragmentos fijados', 'testimony_contrast_items', 'r.contrast_id = ?'),
    group('annotations', 'Anotaciones originales', 'testimony_annotations', contrastAnnotations),
    group('transcripts', 'Transcripciones de los fragmentos', 'testimony_transcripts', 'EXISTS (SELECT 1 FROM testimony_annotations a JOIN testimony_contrast_items c ON c.annotation_id = a.id WHERE a.transcript_id = r.id AND c.contrast_id = ?)'),
    group('media', 'Archivos de los fragmentos', 'testimony_media', 'EXISTS (SELECT 1 FROM testimony_transcripts t JOIN testimony_annotations a ON a.transcript_id = t.id JOIN testimony_contrast_items c ON c.annotation_id = a.id WHERE t.media_id = r.id AND c.contrast_id = ?)'),
    group('noteLinks', 'Notas vinculadas', 'testimony_note_links', "r.target_kind = 'testimony_contrast' AND r.target_id = ?"),
  ] },
  'testimony-participant': { domain: 'testimonies', table: 'persons', primaryKey: 'person_id', groups: [
    group('profile', 'Perfil del participante', 'testimony_participant_profiles', 'r.person_id = ?'),
    group('participation', 'Participación en entrevistas', 'testimony_interview_participants', 'r.person_id = ?'),
  ] },
  'study-recording': { domain: 'study-recordings', table: 'study_recordings', primaryKey: 'id', groups: [
    group('transcripts', 'Transcripciones', 'study_transcripts', 'r.recording_id = ?'),
    group('segments', 'Segmentos', 'study_transcript_segments', 'EXISTS (SELECT 1 FROM study_transcripts t WHERE t.id = r.transcript_id AND t.recording_id = ?)'),
    group('markers', 'Marcadores', 'study_audio_markers', 'r.recording_id = ?'),
  ] },
  'prosop-person': { domain: 'prosopography-private', table: 'persons', primaryKey: 'person_id', groups: [
    group('profile', 'Identidad', 'prosop_person_profiles', 'r.person_id = ?'),
    group('mentions', 'Menciones', 'prosop_name_attestations', 'r.person_id = ?'),
    group('authorities', 'Identificadores de autoridad', 'prosop_authority_ids', "r.entity_kind = 'person' AND r.entity_id = ?"),
    group('factoids', 'Observaciones', 'prosop_factoids', personFactoids),
    group('statements', 'Afirmaciones', 'prosop_statements', "EXISTS (SELECT 1 FROM prosop_statement_entities e WHERE e.statement_id = r.statement_id AND e.entity_kind = 'person' AND e.entity_id = ?)"),
    group('membership', 'Poblaciones de estudio', 'prosop_population_memberships', 'r.person_id = ?'),
  ] },
  'prosop-source': { domain: 'prosopography-private', table: 'prosop_sources', primaryKey: 'source_id', groups: [
    group('segments', 'Extractos', 'prosop_source_segments', 'r.source_id = ?'),
    group('factoids', 'Observaciones', 'prosop_factoids', sourceFactoids),
    group('mentions', 'Menciones', 'prosop_name_attestations', sourceFactoids),
    group('assessments', 'Evaluación de la fuente', 'prosop_source_assessments', sourceFactoids),
  ] },
  'prosop-factoid': { domain: 'prosopography-private', table: 'prosop_factoids', primaryKey: 'factoid_id', groups: [
    group('source', 'Fuente', 'prosop_sources', 'EXISTS (SELECT 1 FROM prosop_factoids f WHERE f.source_id = r.source_id AND f.factoid_id = ?)'),
    group('segments', 'Extracto literal', 'prosop_source_segments', 'EXISTS (SELECT 1 FROM prosop_factoids f WHERE f.source_segment_id = r.segment_id AND f.factoid_id = ?)'),
    group('statements', 'Afirmaciones', 'prosop_statements', 'r.factoid_id = ?'),
    group('entities', 'Entidades de las afirmaciones', 'prosop_statement_entities', 'EXISTS (SELECT 1 FROM prosop_statements s WHERE s.statement_id = r.statement_id AND s.factoid_id = ?)'),
    group('mentions', 'Menciones', 'prosop_name_attestations', 'r.factoid_id = ?'),
  ] },
  'prosop-mention': { domain: 'prosopography-private', table: 'prosop_name_attestations', primaryKey: 'attestation_id', groups: [
    group('person', 'Persona', 'persons', 'EXISTS (SELECT 1 FROM prosop_name_attestations a WHERE a.person_id = r.person_id AND a.attestation_id = ?)'),
    group('source', 'Fuente', 'prosop_sources', 'EXISTS (SELECT 1 FROM prosop_name_attestations a WHERE a.source_id = r.source_id AND a.attestation_id = ?)'),
    group('segments', 'Extracto literal', 'prosop_source_segments', 'EXISTS (SELECT 1 FROM prosop_name_attestations a WHERE a.source_segment_id = r.segment_id AND a.attestation_id = ?)'),
    group('factoids', 'Observación', 'prosop_factoids', 'EXISTS (SELECT 1 FROM prosop_name_attestations a WHERE a.factoid_id = r.factoid_id AND a.attestation_id = ?)'),
  ] },
};

export class PrivateSourceReadError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

function planFor(domain: string, kind: string, id: string): Plan {
  const plan = Object.hasOwn(plans, kind) ? plans[kind] : undefined;
  if (!plan || plan.domain !== domain) throw new PrivateSourceReadError(403, 'source_forbidden');
  if (!id || id.length > 256 || id === '.' || id === '..' || /[\u0000-\u001f\u007f]/.test(id)) {
    throw new PrivateSourceReadError(400, 'invalid_source');
  }
  return plan;
}

// Project known schema columns before reading. A recording dossier must never
// materialise its audio_blob, nor turn one source query into a file download.
function projection(db: Database, table: string): string {
  const fields = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; type: string }[];
  if (!fields.length) throw new PrivateSourceReadError(409, 'source_schema_unavailable');
  const columns = fields.filter(field => !/BLOB/i.test(field.type) && !/_blob$/.test(field.name));
  return columns.map(field => `r."${field.name.replaceAll('"', '""')}"`).join(', ');
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function root(db: Database, plan: Plan, id: string): RecordRow {
  const row = db.prepare(`SELECT ${projection(db, plan.table)}${sourceLabels(plan.table)} FROM "${plan.table}" r WHERE r."${plan.primaryKey}" = ?`).get(id) as RecordRow | undefined;
  if (!row) throw new PrivateSourceReadError(404, 'source_not_found');
  return row;
}
function query(db: Database, item: Group): string {
  return `SELECT r.rowid AS _bridge_cursor, ${projection(db, item.table)}${sourceLabels(item.table)} FROM "${item.table}" r WHERE (${item.where})`;
}
function sourceLabels(table: string): string {
  if (table === 'testimony_interview_participants') return ', (SELECT i.title FROM testimony_interviews i WHERE i.id = r.interview_id) AS interview_title, (SELECT p.display_name FROM persons p WHERE p.person_id = r.person_id) AS display_name';
  if (table === 'testimony_transcripts') return ', (SELECT s.interview_id FROM testimony_media m JOIN testimony_sessions s ON s.id = m.session_id WHERE m.id = r.media_id) AS interview_id, (SELECT m.file_name FROM testimony_media m WHERE m.id = r.media_id) AS file_name, (SELECT m.session_id FROM testimony_media m WHERE m.id = r.media_id) AS session_id';
  if (table === 'testimony_annotations') return ', (SELECT i.title FROM testimony_interviews i WHERE i.id = r.interview_id) AS interview_title';
  if (table === 'testimony_contrast_items') return ', (SELECT a.quote_snapshot FROM testimony_annotations a WHERE a.id = r.annotation_id) AS quote_snapshot, (SELECT a.interview_id FROM testimony_annotations a WHERE a.id = r.annotation_id) AS interview_id, (SELECT a.transcript_id FROM testimony_annotations a WHERE a.id = r.annotation_id) AS transcript_id, (SELECT a.t_start FROM testimony_annotations a WHERE a.id = r.annotation_id) AS t_start';
  return '';
}
function metadata(db: Database, item: Group, id: string) {
  const hash = createHash('sha256'); let total = 0;
  // Hash the complete source group without accumulating large transcripts or
  // unrelated tables. Every page carries this revision and can detect an edit.
  for (const row of db.prepare(`${query(db, item)} ORDER BY r.rowid`).iterate(id)) {
    hash.update(JSON.stringify(row)).update('\n'); total++;
  }
  return { key: item.key, title: item.title, total, revision: hash.digest('hex') };
}

/** Domain-granted context is built transiently from private SQLite, never
 * appended to the published snapshot or retained in the public snapshot cache. */
export async function readPrivateSourceContext(vaultId: string, domains: readonly string[], queryText: string, budget: number): Promise<{items: RecordRow[]; used: number; matched: number; truncated: boolean}> {
  return withVaultDatabase(vaultId, () => {
    const db = getDb();
    return db.transaction(() => {
      const items: RecordRow[] = [], seen = new Set<string>();
      let used = 0, matched = 0, truncated = false;
      for (const [kind, plan] of Object.entries(plans)) {
        if (!domains.includes(plan.domain)) continue;
        const where = kind === 'prosop-person' ? ' WHERE EXISTS (SELECT 1 FROM prosop_person_profiles p WHERE p.person_id = r.person_id)'
          : kind === 'testimony-participant' ? ' WHERE EXISTS (SELECT 1 FROM testimony_participant_profiles p WHERE p.person_id = r.person_id) OR EXISTS (SELECT 1 FROM testimony_interview_participants p WHERE p.person_id = r.person_id)'
          : kind === 'testimony-transcript' ? ' WHERE EXISTS (SELECT 1 FROM testimony_media m JOIN testimony_sessions s ON s.id = m.session_id JOIN testimony_interviews i ON i.id = s.interview_id WHERE m.id = r.media_id AND i.deleted_at IS NULL AND i.archived_at IS NULL)' : '';
        for (const candidate of db.prepare(`SELECT ${projection(db,plan.table)}${sourceLabels(plan.table)} FROM "${plan.table}" r${where} ORDER BY r.rowid`).iterate() as Iterable<RecordRow>) {
          if (['study-recording','testimony-interview'].includes(kind) && (candidate.deleted_at || candidate.archived_at)) continue;
          const id = String(candidate[plan.primaryKey]);
          // Transcript queries join the actual owning recording/interview.
          if (kind === 'testimony-transcript' && !candidate.interview_id) continue;
          const groups: Record<string,RecordRow[]> = {};
          for (const item of plan.groups) {
            if (!['segments','transcripts','statements','items'].includes(item.key)) continue;
            groups[item.key] = db.prepare(`${query(db,item)} ORDER BY r.rowid`).all(id) as RecordRow[];
          }
          for (const row of privateSourceMaterials(kind,id,candidate,groups)) {
            const token = String(row.citation);
            if (seen.has(token) || !matchPrivateSource(row,queryText)) continue;
            seen.add(token); matched++;
            const cost = JSON.stringify(row).length;
            if (used + cost > budget) { truncated = true; continue; }
            used += cost; items.push(row);
          }
        }
      }
      return {items,used,matched,truncated};
    })();
  });
}

/** Only an addressed source and its owned relations; no arbitrary SQL/table selection. */
export async function readPrivateSource(vaultId: string, domain: string, kind: string, id: string,
  page?: { group: string; cursor: number; limit: number; revision: string }): Promise<unknown> {
  const plan = planFor(domain, kind, id);
  if (!getVault(vaultId)) throw new PrivateSourceReadError(404, 'vault_not_found');
  return withVaultDatabase(vaultId, () => {
    const db = getDb();
    return db.transaction(() => {
      const source = root(db, plan, id);
      if (!page) {
        const groups = plan.groups.map(item => metadata(db, item, id));
        return { version: 1, kind, id, root: source, groups, revision: digest({ source, groups }) };
      }
      const item = plan.groups.find(candidate => candidate.key === page.group);
      if (!item) throw new PrivateSourceReadError(403, 'source_group_forbidden');
      if (!Number.isSafeInteger(page.cursor) || page.cursor < 0 || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 100) {
        throw new PrivateSourceReadError(400, 'invalid_source_page');
      }
      const info = metadata(db, item, id);
      if (page.revision !== info.revision) throw new PrivateSourceReadError(409, 'source_changed');
      const rows = db.prepare(`${query(db, item)} AND r.rowid > ? ORDER BY r.rowid LIMIT ?`).all(id, page.cursor, page.limit + 1) as RecordRow[];
      const result = rows.slice(0, page.limit);
      return { rows: result, cursor: Number(result.at(-1)?._bridge_cursor ?? page.cursor), hasMore: rows.length > page.limit,
        total: info.total, revision: info.revision };
    })();
  });
}

/** Paged metadata only. Audio and transcript bodies are not catalogue columns. */
export async function listPrivateSources(vaultId: string, domain: string, kind: string,
  options: { offset: number; limit: number; query: string; state?: string }): Promise<unknown> {
  const plan = planFor(domain, kind, 'catalogue');
  if (!Number.isSafeInteger(options.offset) || options.offset < 0 || !Number.isSafeInteger(options.limit)
      || options.limit < 1 || options.limit > 100 || options.query.length > 256) throw new PrivateSourceReadError(400, 'invalid_source_page');
  if (!getVault(vaultId)) throw new PrivateSourceReadError(404, 'vault_not_found');
  return withVaultDatabase(vaultId, () => {
    const db = getDb();
    const person = ['prosop-person', 'testimony-participant'].includes(kind);
    const title = person ? 'display_name' : kind === 'prosop-mention' ? 'literal_name' : kind === 'prosop-factoid' ? 'summary' : kind === 'testimony-transcript' ? 'short_id' : 'title';
    const detail = kind === 'study-recording' ? 'duration_seconds' : kind === 'prosop-source' ? 'date_display' : kind === 'prosop-mention' ? 'context' : person ? 'birth_date' : kind === 'testimony-interview' ? 'workflow_status' : kind === 'testimony-contrast' ? 'short_id' : 'status';
    const state = options.state || 'active';
    if (!['active', 'archived', 'trash', 'all'].includes(state)) throw new PrivateSourceReadError(400, 'invalid_source_state');
    let where = kind === 'prosop-person' ? ' WHERE EXISTS (SELECT 1 FROM prosop_person_profiles p WHERE p.person_id = r.person_id)' : '';
    if (kind === 'testimony-participant') where = ' WHERE EXISTS (SELECT 1 FROM testimony_participant_profiles p WHERE p.person_id = r.person_id) OR EXISTS (SELECT 1 FROM testimony_interview_participants p WHERE p.person_id = r.person_id)';
    const extra: string[] = [], bindings: string[] = [];
    if (kind === 'study-recording' || kind === 'testimony-interview') {
      if (state === 'active') where = ' WHERE r.archived_at IS NULL AND r.deleted_at IS NULL';
      if (state === 'archived') where = ' WHERE r.archived_at IS NOT NULL AND r.deleted_at IS NULL';
      if (state === 'trash') where = ' WHERE r.deleted_at IS NOT NULL';
      extra.push("CASE WHEN r.deleted_at IS NOT NULL THEN 'trash' WHEN r.archived_at IS NOT NULL THEN 'archived' ELSE 'active' END AS state");
      if (options.query.trim() && kind === 'study-recording') {
        extra.push('CASE WHEN r.file_name LIKE ? OR r.session_label LIKE ? OR EXISTS (SELECT 1 FROM study_transcripts t WHERE t.recording_id = r.id AND t.content_markdown LIKE ?) THEN 1 ELSE 0 END AS _search_match');
        bindings.push(...Array(3).fill(`%${options.query.trim()}%`));
      }
      if (options.query.trim() && kind === 'testimony-interview') {
        extra.push(`CASE WHEN r.abstract LIKE ? OR r.context_markdown LIKE ? OR EXISTS (SELECT 1 FROM testimony_transcripts t JOIN testimony_media m ON m.id = t.media_id JOIN testimony_sessions s ON s.id = m.session_id WHERE s.interview_id = r.id AND t.content_markdown LIKE ?) THEN 1 ELSE 0 END AS _search_match`);
        bindings.push(...Array(3).fill(`%${options.query.trim()}%`));
      }
    }
    if (kind === 'testimony-transcript' && options.query.trim()) {
      extra.push('CASE WHEN r.content_markdown LIKE ? THEN 1 ELSE 0 END AS _search_match');
      bindings.push(`%${options.query.trim()}%`);
    }
    const extras = extra.length ? ', ' + extra.join(', ') : '';
    const all = db.prepare(`SELECT r."${plan.primaryKey}" AS id, r."${title}" AS title, r."${detail}" AS detail, r.updated_at AS updatedAt${extras} FROM "${plan.table}" r${where}`).all(...bindings) as RecordRow[];
    const fold = (value: unknown) => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const query = fold(options.query).trim();
    const items = all.filter(row => !query || row._search_match === 1 || fold(`${row.title} ${row.detail ?? ''}`).includes(query)).sort((a, b) => {
      const time = String(b.updatedAt).localeCompare(String(a.updatedAt));
      return time || String(a.id).localeCompare(String(b.id));
    }).map(({ _search_match, ...row }) => ({ ...row, detail: String(row.detail ?? '') }));
    return { items: items.slice(options.offset, options.offset + options.limit), total: items.length,
      offset: options.offset, limit: options.limit, hasMore: options.offset + options.limit < items.length, revision: digest(items) };
  });
}
