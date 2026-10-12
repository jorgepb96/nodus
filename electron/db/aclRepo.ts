import { createAclReadPolicy } from './aclReadPolicy';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb } from './database';
import type {
  AclEntry, AclPrincipalType, AclResourceType, AclRole, EffectiveAcl, WorkspaceGroup, WorkspaceShareLink,
} from '@shared/pages';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

function resourceExists(type: AclResourceType, id: string): boolean {
  const db = getDb();
  if (type === 'vault') return id === 'vault';
  const source: Record<Exclude<AclResourceType, 'vault'>, [string, string]> = {
    page: ['pages', 'id'], database: ['db_databases', 'id'], view: ['db_views', 'id'], row: ['db_rows', 'id'],
  };
  const [table, column] = source[type];
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`).get(id));
}

function requireResource(type: AclResourceType, id: string): void {
  if (!resourceExists(type, id)) throw new Error('El recurso no existe.');
}

function toGroup(row: Row): WorkspaceGroup {
  const id = String(row.id);
  const members = getDb().prepare('SELECT actor_id FROM workspace_group_members WHERE group_id = ? ORDER BY actor_id').all(id) as Array<{ actor_id: string }>;
  return { id, name: String(row.name), memberActorIds: members.map((item) => item.actor_id), revision: Number(row.revision),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function listWorkspaceGroups(): WorkspaceGroup[] {
  return (getDb().prepare('SELECT * FROM workspace_groups ORDER BY name COLLATE NOCASE, id').all() as Row[]).map(toGroup);
}

export function createWorkspaceGroup(nameValue: string): WorkspaceGroup {
  const name = nameValue.trim();
  if (!name || name.length > 120) throw new Error('El nombre del grupo debe tener entre 1 y 120 caracteres.');
  const id = `group_${randomUUID()}`; const timestamp = now();
  getDb().prepare('INSERT INTO workspace_groups (id, name, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)')
    .run(id, name, timestamp, timestamp);
  return toGroup(getDb().prepare('SELECT * FROM workspace_groups WHERE id = ?').get(id) as Row);
}

export function setWorkspaceGroupMembers(groupId: string, actorIds: string[], expectedRevision: number): WorkspaceGroup {
  const db = getDb(); const unique = [...new Set(actorIds)]; const timestamp = now();
  return db.transaction(() => {
    const current = db.prepare('SELECT * FROM workspace_groups WHERE id = ?').get(groupId) as Row | undefined;
    if (!current || Number(current.revision) !== expectedRevision) throw new Error('El grupo cambió o ya no existe.');
    for (const actorId of unique) if (!db.prepare('SELECT 1 FROM workspace_actors WHERE id = ?').get(actorId)) throw new Error('Una persona del grupo no existe.');
    db.prepare('DELETE FROM workspace_group_members WHERE group_id = ?').run(groupId);
    const insert = db.prepare('INSERT INTO workspace_group_members (group_id, actor_id, created_at) VALUES (?, ?, ?)');
    for (const actorId of unique) insert.run(groupId, actorId, timestamp);
    db.prepare('UPDATE workspace_groups SET revision = revision + 1, updated_at = ? WHERE id = ?').run(timestamp, groupId);
    return toGroup(db.prepare('SELECT * FROM workspace_groups WHERE id = ?').get(groupId) as Row);
  })();
}

function toEntry(row: Row): AclEntry {
  return { id: String(row.id), resourceType: String(row.resource_type) as AclResourceType, resourceId: String(row.resource_id),
    principalType: String(row.principal_type) as AclPrincipalType, principalId: String(row.principal_id),
    principalName: String(row.principal_name), role: String(row.role) as AclRole, revision: Number(row.revision),
    createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

const entryProjection = `SELECT entry.*,
  CASE entry.principal_type WHEN 'actor' THEN actor.display_name ELSE team.name END AS principal_name
  FROM acl_entries entry
  LEFT JOIN workspace_actors actor ON entry.principal_type = 'actor' AND actor.id = entry.principal_id
  LEFT JOIN workspace_groups team ON entry.principal_type = 'group' AND team.id = entry.principal_id`;

export function listAclEntries(resourceType: AclResourceType, resourceId: string): AclEntry[] {
  requireResource(resourceType, resourceId);
  return (getDb().prepare(`${entryProjection} WHERE entry.resource_type = ? AND entry.resource_id = ?
    ORDER BY CASE entry.role WHEN 'owner' THEN 0 WHEN 'full_access' THEN 1 WHEN 'edit' THEN 2 WHEN 'edit_content' THEN 3 WHEN 'comment' THEN 4 ELSE 5 END,
    principal_name COLLATE NOCASE, entry.id`).all(resourceType, resourceId) as Row[]).map(toEntry);
}

export function getEffectiveAcl(resourceType: AclResourceType, resourceId: string, actorId = 'local'): EffectiveAcl {
  requireResource(resourceType, resourceId);
  return createAclReadPolicy(getDb(),actorId)(resourceType,resourceId);
}

export type AclCapability = 'view' | 'comment' | 'edit_content' | 'edit' | 'manage_access';
export function assertAcl(resourceType: AclResourceType, resourceId: string, actorId: string, capability: AclCapability): EffectiveAcl {
  const access = getEffectiveAcl(resourceType, resourceId, actorId);
  const allowed = capability === 'view' ? access.canView : capability === 'comment' ? access.canComment
    : capability === 'edit_content' ? access.canEditContent : capability === 'edit' ? access.canEditStructure : access.canManageAccess;
  if (!allowed) throw new Error('No tienes permiso para realizar esta acción.');
  return access;
}

export function setAclEntry(input: { resourceType: AclResourceType; resourceId: string; principalType: AclPrincipalType; principalId: string; role: AclRole; actorId?: string }): AclEntry {
  const actorId = input.actorId ?? 'local'; requireResource(input.resourceType, input.resourceId);
  assertAcl(input.resourceType, input.resourceId, actorId, 'manage_access'); const db = getDb(); const timestamp = now();
  const existing = db.prepare('SELECT id FROM acl_entries WHERE resource_type = ? AND resource_id = ? AND principal_type = ? AND principal_id = ?')
    .get(input.resourceType, input.resourceId, input.principalType, input.principalId) as { id: string } | undefined;
  const id = existing?.id ?? `acl_${randomUUID()}`;
  db.prepare(`INSERT INTO acl_entries
    (id, resource_type, resource_id, principal_type, principal_id, role, revision, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(resource_type, resource_id, principal_type, principal_id) DO UPDATE SET
      role = excluded.role, revision = acl_entries.revision + 1, updated_at = excluded.updated_at`)
    .run(id, input.resourceType, input.resourceId, input.principalType, input.principalId, input.role, actorId, timestamp, timestamp);
  return toEntry(db.prepare(`${entryProjection} WHERE entry.id = ?`).get(id) as Row);
}

export function deleteAclEntry(id: string, expectedRevision: number, actorId = 'local'): void {
  const db = getDb(); const entry = db.prepare('SELECT * FROM acl_entries WHERE id = ?').get(id) as Row | undefined;
  if (!entry) throw new Error('El permiso ya no existe.');
  const resourceType = String(entry.resource_type) as AclResourceType; const resourceId = String(entry.resource_id);
  assertAcl(resourceType, resourceId, actorId, 'manage_access');
  if (resourceType === 'vault' && String(entry.role) === 'owner') {
    const owners = db.prepare("SELECT COUNT(*) AS count FROM acl_entries WHERE resource_type = 'vault' AND resource_id = 'vault' AND role = 'owner'").get() as { count: number };
    if (owners.count <= 1) throw new Error('El vault debe conservar al menos una persona propietaria.');
  }
  const result = db.prepare('DELETE FROM acl_entries WHERE id = ? AND revision = ?').run(id, expectedRevision);
  if (result.changes !== 1) throw new Error('El permiso cambió o ya no existe.');
}

function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
function passwordDigest(password: string, salt: Buffer): Buffer { return scryptSync(password, salt, 32); }
function toShareLink(row: Row, token: string | null = null): WorkspaceShareLink {
  return { id: String(row.id), resourceType: String(row.resource_type) as WorkspaceShareLink['resourceType'], resourceId: String(row.resource_id),
    token, role: String(row.role) as 'comment' | 'view', passwordProtected: row.password_hash != null,
    expiresAt: row.expires_at == null ? null : String(row.expires_at), allowIndexing: Number(row.allow_indexing) === 1,
    revision: Number(row.revision), revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function createWorkspaceShareLink(input: { resourceType: 'page' | 'database' | 'view'; resourceId: string; role: 'comment' | 'view'; password?: string | null; expiresAt?: string | null; allowIndexing?: boolean; actorId?: string }): WorkspaceShareLink {
  const actorId = input.actorId ?? 'local'; requireResource(input.resourceType, input.resourceId);
  assertAcl(input.resourceType, input.resourceId, actorId, 'manage_access');
  if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt))) throw new Error('La fecha de caducidad no es válida.');
  const password = input.password?.trim() || null;
  if (password && password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
  const token = randomBytes(32).toString('base64url'); const salt = password ? randomBytes(16) : null;
  const id = `share_${randomUUID()}`; const timestamp = now();
  getDb().prepare(`INSERT INTO workspace_share_links
    (id, resource_type, resource_id, token_hash, password_salt, password_hash, role, expires_at, allow_indexing,
     revision, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .run(id, input.resourceType, input.resourceId, tokenHash(token), salt?.toString('hex') ?? null,
      password && salt ? passwordDigest(password, salt).toString('hex') : null, input.role, input.expiresAt ?? null,
      Number(input.allowIndexing ?? false), actorId, timestamp, timestamp);
  return toShareLink(getDb().prepare('SELECT * FROM workspace_share_links WHERE id = ?').get(id) as Row, token);
}

export function listWorkspaceShareLinks(resourceType: 'page' | 'database' | 'view', resourceId: string, actorId = 'local'): WorkspaceShareLink[] {
  requireResource(resourceType, resourceId); assertAcl(resourceType, resourceId, actorId, 'manage_access');
  return (getDb().prepare('SELECT * FROM workspace_share_links WHERE resource_type = ? AND resource_id = ? ORDER BY created_at DESC, id DESC')
    .all(resourceType, resourceId) as Row[]).map((row) => toShareLink(row));
}

export function revokeWorkspaceShareLink(id: string, expectedRevision: number, actorId = 'local'): void {
  const db = getDb(); const row = db.prepare('SELECT * FROM workspace_share_links WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new Error('El enlace ya no existe.');
  assertAcl(String(row.resource_type) as AclResourceType, String(row.resource_id), actorId, 'manage_access'); const timestamp = now();
  const result = db.prepare('UPDATE workspace_share_links SET revoked_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
    .run(timestamp, timestamp, id, expectedRevision);
  if (result.changes !== 1) throw new Error('El enlace cambió o ya no existe.');
}

export function authorizeWorkspaceShareLink(token: string, password?: string | null): { resourceType: 'page' | 'database' | 'view'; resourceId: string; role: 'comment' | 'view'; allowIndexing: boolean } | null {
  if (!token || token.length > 256) return null;
  const row = getDb().prepare(`SELECT * FROM workspace_share_links WHERE token_hash = ? AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > ?)`).get(tokenHash(token), now()) as Row | undefined;
  if (!row || !resourceExists(String(row.resource_type) as AclResourceType, String(row.resource_id))) return null;
  if (row.password_hash != null) {
    if (!password || row.password_salt == null) return null;
    const expected = Buffer.from(String(row.password_hash), 'hex');
    const actual = passwordDigest(password, Buffer.from(String(row.password_salt), 'hex'));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  }
  return { resourceType: String(row.resource_type) as 'page' | 'database' | 'view', resourceId: String(row.resource_id),
    role: String(row.role) as 'comment' | 'view', allowIndexing: Number(row.allow_indexing) === 1 };
}
