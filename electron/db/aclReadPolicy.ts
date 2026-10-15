// Pure read policy shared by live repositories and immutable backup snapshots.
import type Database from 'better-sqlite3';
import type { AclResourceType, AclRole, EffectiveAcl } from '@shared/pages';
export const roleRank: Record<AclRole, number> = {
  view: 0,
  comment: 1,
  edit_content: 2,
  edit: 3,
  full_access: 4,
  owner: 5,
};
export function createAclReadPolicy(
  db: Database.Database,
  actorId = 'local',
): (type: AclResourceType, id: string) => EffectiveAcl {
  const groups = db
    .prepare('SELECT group_id FROM workspace_group_members WHERE actor_id=?')
    .all(actorId) as Array<{ group_id: string }>;
  const principals = [
    { type: 'actor', id: actorId },
    ...groups.map((g) => ({ type: 'group', id: g.group_id })),
  ];
  const lookup = db.prepare(
    'SELECT role FROM acl_entries WHERE resource_type=? AND resource_id=? AND principal_type=? AND principal_id=?',
  );
  const cache = new Map<string, EffectiveAcl>();
  return (resourceType, resourceId) => {
    const cacheKey = `${resourceType}:${resourceId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    let type = resourceType,
      id = resourceId;
    const seen = new Set<string>();
    let role: AclRole | null = null,
      source: [AclResourceType, string] | null = null;
    for (;;) {
      const key = `${type}:${id}`;
      if (seen.has(key)) break;
      seen.add(key);
      const roles = principals.flatMap((p) => {
        const row = lookup.get(type, id, p.type, p.id) as { role: AclRole } | undefined;
        return row ? [row.role] : [];
      });
      if (roles.length) {
        role = roles.sort((a, b) => roleRank[b] - roleRank[a])[0];
        source = [type, id];
        break;
      }
      if (type === 'vault') break;
      if (type === 'page') {
        const parent = db.prepare('SELECT parent_page_id FROM pages WHERE id=?').get(id) as
          | { parent_page_id: string | null }
          | undefined;
        if (parent?.parent_page_id) {
          id = parent.parent_page_id;
          continue;
        }
      } else if (type === 'view' || type === 'row') {
        const parent = db
          .prepare(`SELECT database_id FROM ${type === 'view' ? 'db_views' : 'db_rows'} WHERE id=?`)
          .get(id) as { database_id: string } | undefined;
        if (parent) {
          type = 'database';
          id = parent.database_id;
          continue;
        }
      }
      type = 'vault';
      id = 'vault';
    }
    const rank = role === null ? -1 : roleRank[role];
    const result: EffectiveAcl = {
      role,
      sourceResourceType: source?.[0] ?? null,
      sourceResourceId: source?.[1] ?? null,
      inherited: Boolean(source && (source[0] !== resourceType || source[1] !== resourceId)),
      canView: rank >= 0,
      canComment: rank >= roleRank.comment,
      canEditContent: rank >= roleRank.edit_content,
      canEditStructure: rank >= roleRank.edit,
      canManageAccess: rank >= roleRank.full_access,
    };
    cache.set(cacheKey, result);
    return result;
  };
}
