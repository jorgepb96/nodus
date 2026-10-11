import { createHash } from 'node:crypto';
import { getDb, withVaultDatabase } from '../db/database';
import { getVault } from '../vaults/vaultRegistry';

type Database = ReturnType<typeof getDb>;
type RecordRow = Record<string, unknown>;
type Group = { key: string; title: string; table: string; where: string };
type Plan = { domain: string; table: string; primaryKey: string; groups: Group[] };
const group = (key: string, title: string, table: string, where: string): Group => ({ key, title, table, where });
const sourceFactoids = 'r.source_id = ?';
const personFactoids = "EXISTS (SELECT 1 FROM prosop_statements s JOIN prosop_statement_entities e ON e.statement_id = s.statement_id WHERE s.factoid_id = r.factoid_id AND e.entity_kind = 'person' AND e.entity_id = ?)";
const plans: Record<string, Plan> = {
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
  const row = db.prepare(`SELECT ${projection(db, plan.table)} FROM "${plan.table}" r WHERE r."${plan.primaryKey}" = ?`).get(id) as RecordRow | undefined;
  if (!row) throw new PrivateSourceReadError(404, 'source_not_found');
  return row;
}
function query(db: Database, item: Group): string {
  const title = item.table === 'testimony_interview_participants'
    ? ', (SELECT i.title FROM testimony_interviews i WHERE i.id = r.interview_id) AS interview_title' : '';
  return `SELECT r.rowid AS _bridge_cursor, ${projection(db, item.table)}${title} FROM "${item.table}" r WHERE (${item.where})`;
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
    const title = person ? 'display_name' : kind === 'prosop-mention' ? 'literal_name' : kind === 'prosop-factoid' ? 'summary' : 'title';
    const detail = kind === 'study-recording' ? 'duration_seconds' : kind === 'prosop-source' ? 'date_display' : kind === 'prosop-mention' ? 'context' : person ? 'birth_date' : 'status';
    const state = options.state || 'active';
    if (!['active', 'archived', 'trash', 'all'].includes(state)) throw new PrivateSourceReadError(400, 'invalid_source_state');
    let where = kind === 'prosop-person' ? ' WHERE EXISTS (SELECT 1 FROM prosop_person_profiles p WHERE p.person_id = r.person_id)' : '';
    if (kind === 'testimony-participant') where = ' WHERE EXISTS (SELECT 1 FROM testimony_participant_profiles p WHERE p.person_id = r.person_id) OR EXISTS (SELECT 1 FROM testimony_interview_participants p WHERE p.person_id = r.person_id)';
    const extra: string[] = [], bindings: string[] = [];
    if (kind === 'study-recording') {
      if (state === 'active') where = ' WHERE r.archived_at IS NULL AND r.deleted_at IS NULL';
      if (state === 'archived') where = ' WHERE r.archived_at IS NOT NULL AND r.deleted_at IS NULL';
      if (state === 'trash') where = ' WHERE r.deleted_at IS NOT NULL';
      extra.push("CASE WHEN r.deleted_at IS NOT NULL THEN 'trash' WHEN r.archived_at IS NOT NULL THEN 'archived' ELSE 'active' END AS state");
      if (options.query.trim()) {
        extra.push('CASE WHEN r.file_name LIKE ? OR r.session_label LIKE ? OR EXISTS (SELECT 1 FROM study_transcripts t WHERE t.recording_id = r.id AND t.content_markdown LIKE ?) THEN 1 ELSE 0 END AS _search_match');
        bindings.push(...Array(3).fill(`%${options.query.trim()}%`));
      }
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
