import crypto from 'node:crypto';
import type {
  StudyImprovementLog,
  StudyStyle,
  StudyStyleAssociation,
  StudyStyleAssociationKind,
  StudyStyleConfig,
  StudyStyleExport,
  StudyStyleInput,
  StudyStyleVersion,
} from '@shared/studyImprove';
import { STUDY_IMPROVE_PRESETS, validateStudyStylePrompt } from '@shared/studyImprove';
import { createStudyShortId, normalizeStudyName } from '@shared/studyOrg';
import { getDb } from './database';

type Row = Record<string, unknown>;

const now = () => new Date().toISOString();
const bool = (value: unknown) => Number(value) === 1;

function ids(prefix: string) {
  const id = crypto.randomUUID();
  return { id, shortId: createStudyShortId(prefix, id) };
}

function configFromStyle(style: StudyStyle): StudyStyleConfig {
  return {
    name: style.name,
    icon: style.icon,
    color: style.color,
    description: style.description,
    prompt: style.prompt,
    systemPrompt: style.systemPrompt,
    category: style.category,
    language: style.language,
    level: style.level,
    length: style.length,
    modelProvider: style.modelProvider,
    modelName: style.modelName,
    temperature: style.temperature,
    maxOutputTokens: style.maxOutputTokens,
    creativity: style.creativity,
    locked: style.locked,
  };
}

function toStyle(row: Row): StudyStyle {
  return {
    id: String(row.id),
    shortId: String(row.short_id),
    builtIn: false,
    name: String(row.name),
    icon: String(row.icon ?? '✦'),
    color: String(row.color ?? '#0f766e'),
    description: String(row.description ?? ''),
    prompt: String(row.prompt),
    systemPrompt: String(row.system_prompt ?? ''),
    category: String(row.category ?? 'custom') as StudyStyle['category'],
    language: String(row.language ?? 'auto'),
    level: String(row.level ?? 'moderate') as StudyStyle['level'],
    length: String(row.length_mode ?? 'similar') as StudyStyle['length'],
    modelProvider: row.model_provider ? String(row.model_provider) : null,
    modelName: row.model_name ? String(row.model_name) : null,
    temperature: Number(row.temperature ?? 0.2),
    maxOutputTokens: Number(row.max_output_tokens ?? 2400),
    creativity: Number(row.creativity ?? 0.1),
    locked: bool(row.locked),
    favorite: bool(row.favorite),
    active: bool(row.active),
    position: Number(row.position ?? 0),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizeConfig(input: StudyStyleInput, current?: StudyStyle): StudyStyleConfig {
  const fallback = current ?? STUDY_IMPROVE_PRESETS[0];
  const name = normalizeStudyName(input.name);
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('El prompt del estilo no puede estar vacío.');
  if (prompt.length > 10_000) throw new Error('El prompt del estilo supera el límite de 10.000 caracteres.');
  return {
    name,
    icon: input.icon?.trim() || fallback.icon || '✦',
    color: input.color?.trim() || fallback.color || '#0f766e',
    description: input.description?.trim() ?? fallback.description,
    prompt,
    systemPrompt: input.systemPrompt?.trim() ?? fallback.systemPrompt,
    category: input.category ?? (current?.category ?? 'custom'),
    language: input.language?.trim() || fallback.language || 'auto',
    level: input.level ?? fallback.level,
    length: input.length ?? fallback.length,
    modelProvider: input.modelProvider === undefined ? fallback.modelProvider : input.modelProvider,
    modelName: input.modelName === undefined ? fallback.modelName : input.modelName,
    temperature: Math.max(0, Math.min(2, Number(input.temperature ?? fallback.temperature))),
    maxOutputTokens: Math.max(128, Math.min(16_000, Math.round(Number(input.maxOutputTokens ?? fallback.maxOutputTokens)))),
    creativity: Math.max(0, Math.min(1, Number(input.creativity ?? fallback.creativity))),
    locked: Boolean(input.locked ?? current?.locked ?? false),
  };
}

function rowFor(id: string): Row | undefined {
  return getDb().prepare('SELECT * FROM study_styles WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined;
}

function nextPosition(): number {
  const row = getDb().prepare('SELECT COALESCE(MAX(position), -1) + 1 AS value FROM study_styles').get() as Row;
  return Number(row.value);
}

function snapshot(style: StudyStyle, reason: StudyStyleVersion['reason']): StudyStyleVersion {
  const db = getDb();
  const key = ids('STV');
  const versionNo = Number((db.prepare('SELECT COALESCE(MAX(version_no), 0) + 1 AS value FROM study_style_versions WHERE style_id = ?')
    .get(style.id) as Row).value);
  const createdAt = now();
  const config = configFromStyle(style);
  db.prepare(`INSERT INTO study_style_versions (id, short_id, style_id, version_no, config_json, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, style.id, versionNo, JSON.stringify(config), reason, createdAt);
  return { id: key.id, shortId: key.shortId, styleId: style.id, versionNo, config, reason, createdAt };
}

export function listStudyStyles(options: { includeArchived?: boolean; search?: string } = {}): StudyStyle[] {
  const custom = (getDb().prepare(`SELECT * FROM study_styles WHERE deleted_at IS NULL ${options.includeArchived ? '' : 'AND archived_at IS NULL'}
    ORDER BY active DESC, favorite DESC, position, name COLLATE NOCASE`).all() as Row[]).map(toStyle);
  const builtIns = STUDY_IMPROVE_PRESETS.filter((style) => {
    const query = options.search?.trim().toLocaleLowerCase();
    return !query || `${style.name} ${style.description} ${style.category}`.toLocaleLowerCase().includes(query);
  });
  const query = options.search?.trim().toLocaleLowerCase();
  return [...builtIns, ...custom.filter((style) => !query || `${style.name} ${style.description} ${style.category}`.toLocaleLowerCase().includes(query))];
}

export function getStudyStyle(id: string): StudyStyle | null {
  return STUDY_IMPROVE_PRESETS.find((style) => style.id === id) ?? (rowFor(id) ? toStyle(rowFor(id) as Row) : null);
}

export function createStudyStyle(input: StudyStyleInput, reason: StudyStyleVersion['reason'] = 'create'): StudyStyle {
  const config = normalizeConfig(input);
  const warnings = validateStudyStylePrompt(`${config.prompt}\n${config.systemPrompt}`);
  if (warnings.some((warning) => warning.includes('sustituir las reglas'))) throw new Error(warnings[0]);
  const db = getDb();
  const key = ids('STY');
  const timestamp = now();
  db.prepare(`INSERT INTO study_styles
    (id, short_id, name, icon, color, description, prompt, system_prompt, category, language, level, length_mode,
     model_provider, model_name, temperature, max_output_tokens, creativity, locked, favorite, active, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(key.id, key.shortId, config.name, config.icon, config.color, config.description, config.prompt, config.systemPrompt,
      config.category, config.language, config.level, config.length, config.modelProvider, config.modelName, config.temperature,
      config.maxOutputTokens, config.creativity, config.locked ? 1 : 0, input.favorite ? 1 : 0, input.active === false ? 0 : 1,
      input.position ?? nextPosition(), timestamp, timestamp);
  const style = toStyle(rowFor(key.id) as Row);
  snapshot(style, reason);
  return style;
}

export function updateStudyStyle(id: string, patch: Partial<StudyStyleInput>): StudyStyle {
  const current = getStudyStyle(id);
  if (!current) throw new Error('Estilo no encontrado.');
  if (current.builtIn) throw new Error('Los estilos predefinidos se duplican antes de editarlos.');
  const configKeys: Array<keyof StudyStyleInput> = ['name', 'prompt', 'icon', 'color', 'description', 'systemPrompt', 'category', 'language', 'level', 'length', 'modelProvider', 'modelName', 'temperature', 'maxOutputTokens', 'creativity'];
  if (current.locked && patch.locked !== false && configKeys.some((key) => patch[key] !== undefined)) {
    throw new Error('Desbloquea el estilo antes de editar su configuración.');
  }
  const config = normalizeConfig({ ...current, ...patch, name: patch.name ?? current.name, prompt: patch.prompt ?? current.prompt }, current);
  // La misma puerta que en la creación: editar no puede colar un prompt que anule las reglas.
  const warnings = validateStudyStylePrompt(`${config.prompt}\n${config.systemPrompt}`);
  if (warnings.some((warning) => warning.includes('sustituir las reglas'))) throw new Error(warnings[0]);
  const timestamp = now();
  getDb().prepare(`UPDATE study_styles SET name = ?, icon = ?, color = ?, description = ?, prompt = ?, system_prompt = ?,
    category = ?, language = ?, level = ?, length_mode = ?, model_provider = ?, model_name = ?, temperature = ?,
    max_output_tokens = ?, creativity = ?, locked = ?, favorite = ?, active = ?, position = ?, updated_at = ? WHERE id = ?`)
    .run(config.name, config.icon, config.color, config.description, config.prompt, config.systemPrompt, config.category,
      config.language, config.level, config.length, config.modelProvider, config.modelName, config.temperature,
      config.maxOutputTokens, config.creativity, config.locked ? 1 : 0, patch.favorite ?? current.favorite ? 1 : 0,
      patch.active ?? current.active ? 1 : 0, patch.position ?? current.position, timestamp, id);
  const updated = toStyle(rowFor(id) as Row);
  snapshot(updated, 'update');
  return updated;
}

export function duplicateStudyStyle(id: string): StudyStyle {
  const source = getStudyStyle(id);
  if (!source) throw new Error('Estilo no encontrado.');
  return createStudyStyle({
    ...configFromStyle(source),
    name: `${source.name} — copia`,
    prompt: source.prompt,
    locked: false,
    favorite: false,
  });
}

export function archiveStudyStyle(id: string, archived: boolean): StudyStyle {
  const current = getStudyStyle(id);
  if (!current || current.builtIn) throw new Error('Solo se pueden archivar estilos personalizados.');
  getDb().prepare('UPDATE study_styles SET archived_at = ?, updated_at = ? WHERE id = ?').run(archived ? now() : null, now(), id);
  return toStyle(rowFor(id) as Row);
}

export function deleteStudyStyle(id: string): void {
  const current = getStudyStyle(id);
  if (!current || current.builtIn) throw new Error('Solo se pueden eliminar estilos personalizados.');
  getDb().prepare('UPDATE study_styles SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
}

export function listStudyStyleVersions(styleId: string): StudyStyleVersion[] {
  return (getDb().prepare('SELECT * FROM study_style_versions WHERE style_id = ? ORDER BY version_no DESC').all(styleId) as Row[])
    .map((row) => ({
      id: String(row.id), shortId: String(row.short_id), styleId: String(row.style_id), versionNo: Number(row.version_no),
      config: JSON.parse(String(row.config_json)) as StudyStyleConfig,
      reason: String(row.reason) as StudyStyleVersion['reason'], createdAt: String(row.created_at),
    }));
}

export function restoreStudyStyleVersion(styleId: string, versionId: string): StudyStyle {
  const version = listStudyStyleVersions(styleId).find((candidate) => candidate.id === versionId);
  if (!version) throw new Error('Versión de estilo no encontrada.');
  const current = getStudyStyle(styleId);
  if (!current || current.builtIn) throw new Error('Estilo no encontrado.');
  if (current.locked) throw new Error('Desbloquea el estilo antes de restaurar una versión.');
  const restored = updateStudyStyle(styleId, { ...version.config, name: version.config.name, prompt: version.config.prompt });
  const latest = listStudyStyleVersions(styleId)[0];
  getDb().prepare("UPDATE study_style_versions SET reason = 'restore' WHERE id = ?").run(latest.id);
  return restored;
}

export function setStudyStyleAssociation(styleId: string, kind: StudyStyleAssociationKind, targetId = '', isDefault = true): StudyStyleAssociation {
  if (!getStudyStyle(styleId)) throw new Error('Estilo no encontrado.');
  const db = getDb();
  const timestamp = now();
  if (isDefault) db.prepare('UPDATE study_style_associations SET is_default = 0, updated_at = ? WHERE kind = ? AND target_id = ?').run(timestamp, kind, targetId);
  const existing = db.prepare('SELECT id FROM study_style_associations WHERE style_id = ? AND kind = ? AND target_id = ?')
    .get(styleId, kind, targetId) as Row | undefined;
  const id = existing ? String(existing.id) : crypto.randomUUID();
  db.prepare(`INSERT INTO study_style_associations (id, style_id, kind, target_id, is_default, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(style_id, kind, target_id) DO UPDATE SET is_default = excluded.is_default, updated_at = excluded.updated_at`)
    .run(id, styleId, kind, targetId, isDefault ? 1 : 0, timestamp, timestamp);
  return { id, styleId, kind, targetId, isDefault, createdAt: timestamp, updatedAt: timestamp };
}

export function listStudyStyleAssociations(): StudyStyleAssociation[] {
  return (getDb().prepare('SELECT * FROM study_style_associations ORDER BY kind, target_id, is_default DESC').all() as Row[]).map((row) => ({
    id: String(row.id), styleId: String(row.style_id), kind: String(row.kind) as StudyStyleAssociationKind,
    targetId: String(row.target_id), isDefault: bool(row.is_default), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  }));
}

export function resolveStudyStyleDefault(subjectId?: string | null, documentKind?: string | null): string {
  const db = getDb();
  const candidates: Array<[StudyStyleAssociationKind, string]> = [];
  if (subjectId) candidates.push(['subject', subjectId]);
  if (documentKind) candidates.push(['document_kind', documentKind]);
  candidates.push(['global', '']);
  for (const [kind, target] of candidates) {
    const row = db.prepare('SELECT style_id FROM study_style_associations WHERE kind = ? AND target_id = ? AND is_default = 1 ORDER BY updated_at DESC LIMIT 1')
      .get(kind, target) as Row | undefined;
    if (row && getStudyStyle(String(row.style_id))) return String(row.style_id);
  }
  return 'builtin:academic';
}

export function recordStudyImprovement(input: Omit<StudyImprovementLog, 'id' | 'createdAt'>, id: string = crypto.randomUUID()): StudyImprovementLog {
  const createdAt = now();
  getDb().prepare(`INSERT INTO study_improvement_log
    (id, document_id, note_id, style_id, scope, mode, level, length_mode, model_provider, model_name, original_hash,
     result_hash, original_chars, result_chars, warnings_json, action, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.documentId ?? null, input.noteId ?? null, input.styleId, input.scope, input.mode, input.level, input.length, input.modelProvider,
      input.modelName, input.originalHash, input.resultHash, input.originalChars, input.resultChars, JSON.stringify(input.warnings),
      input.action, createdAt);
  return { ...input, id, createdAt };
}

export function updateStudyImprovementAction(id: string, action: StudyImprovementLog['action']): void {
  getDb().prepare('UPDATE study_improvement_log SET action = ? WHERE id = ?').run(action, id);
}

/** El registro de una procedencia: un documento de estudio o una nota del Workspace. */
export function listStudyImprovementLog(documentId: string): StudyImprovementLog[] {
  return (getDb().prepare(
    'SELECT * FROM study_improvement_log WHERE document_id = ? OR note_id = ? ORDER BY created_at DESC'
  ).all(documentId, documentId) as Row[])
    .map((row) => ({
      id: String(row.id),
      documentId: row.document_id ? String(row.document_id) : null,
      noteId: row.note_id ? String(row.note_id) : null,
      styleId: String(row.style_id),
      scope: String(row.scope) as StudyImprovementLog['scope'], mode: String(row.mode) as StudyImprovementLog['mode'],
      level: String(row.level) as StudyImprovementLog['level'], length: String(row.length_mode) as StudyImprovementLog['length'],
      modelProvider: String(row.model_provider), modelName: String(row.model_name), originalHash: String(row.original_hash),
      resultHash: String(row.result_hash), originalChars: Number(row.original_chars), resultChars: Number(row.result_chars),
      warnings: JSON.parse(String(row.warnings_json || '[]')) as string[], action: String(row.action) as StudyImprovementLog['action'],
      createdAt: String(row.created_at),
    }));
}

export function exportStudyStyles(styleIds?: string[]): StudyStyleExport {
  const selected = listStudyStyles({ includeArchived: true }).filter((style) => !style.builtIn && (!styleIds?.length || styleIds.includes(style.id)));
  return {
    format: 'nodus-study-styles', version: 1, exportedAt: now(),
    styles: selected.map((style) => ({ ...configFromStyle(style), name: style.name, prompt: style.prompt, favorite: style.favorite, active: style.active, position: style.position })),
  };
}

export function importStudyStyles(payload: StudyStyleExport): StudyStyle[] {
  if (payload?.format !== 'nodus-study-styles' || payload.version !== 1 || !Array.isArray(payload.styles)) throw new Error('El fichero no contiene estilos de Nodus compatibles.');
  return getDb().transaction(() => payload.styles.map((input) => createStudyStyle(input, 'import')))();
}
