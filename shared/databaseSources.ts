import type { DatabaseColumn, DatabaseColumnType } from './databases';
import type { FilterNode } from './databaseQuery';

export const DATABASE_CONTAINER_PAGE_DEFAULT = 50;
export const DATABASE_CONTAINER_PAGE_MAX = 500;
export const DATABASE_CONTAINER_CURSOR_VERSION = 1 as const;

export type DatabaseContainerFilterTranslation = {kind:'true'}|{kind:'false'}|{kind:'node';node:FilterNode};
/** The Desktop SQL and selected companion copy share the same physical mapping. */
export function translateDatabaseContainerFilter(node:FilterNode|null|undefined,source:DatabaseViewDataSource,primaryInverse:Map<string,string>):DatabaseContainerFilterTranslation {
  if(!node)return {kind:'true'};
  if(node.type==='condition') {
    const canonical=source.propertyMap[node.columnId]?node.columnId:primaryInverse.get(node.columnId)??node.columnId;
    const columnId=source.propertyMap[canonical];return columnId?{kind:'node',node:{...node,columnId}}:{kind:'false'};
  }
  const children=node.children.map(child=>translateDatabaseContainerFilter(child,source,primaryInverse));
  if(node.operator==='and') {
    if(children.some(child=>child.kind==='false'))return {kind:'false'};
    const nodes=children.flatMap(child=>child.kind==='node'?[child.node]:[]);
    return nodes.length?{kind:'node',node:{type:'group',operator:'and',children:nodes}}:{kind:'true'};
  }
  if(children.some(child=>child.kind==='true'))return {kind:'true'};
  const nodes=children.flatMap(child=>child.kind==='node'?[child.node]:[]);
  return nodes.length?{kind:'node',node:{type:'group',operator:'or',children:nodes}}:{kind:'false'};
}
export function combinedDatabaseContainerFilter(view:FilterNode|null,local:FilterNode|null|undefined,source:DatabaseViewDataSource,primaryInverse:Map<string,string>):DatabaseContainerFilterTranslation {
  const translations=[translateDatabaseContainerFilter(view,source,primaryInverse),translateDatabaseContainerFilter(local,source,primaryInverse)];
  if(translations.some(entry=>entry.kind==='false'))return {kind:'false'};
  const nodes=translations.flatMap(entry=>entry.kind==='node'?[entry.node]:[]);
  return !nodes.length?{kind:'true'}:nodes.length===1?{kind:'node',node:nodes[0]}:{kind:'node',node:{type:'group',operator:'and',children:nodes}};
}

export interface DatabaseDataSource {
  id: string;
  databaseId: string;
  name: string;
  kind: 'local_database';
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseViewDataSource {
  viewId: string;
  sourceId: string;
  databaseId: string;
  sourceName: string;
  alias: string;
  position: number;
  primary: boolean;
  /** Canonical property id -> physical column id on this source. */
  propertyMap: Record<string, string>;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseContainerProperty {
  id: string;
  name: string;
  type: DatabaseColumnType;
  sources: Array<{ sourceId: string; columnId: string; columnName: string }>;
}

export interface DatabaseContainerDefinition {
  viewId: string;
  viewName: string;
  revision: number;
  sources: DatabaseViewDataSource[];
  properties: DatabaseContainerProperty[];
}

export interface DatabaseContainerRow {
  /** Stable composite identity; raw row ids may only be unique inside a source. */
  id: string;
  sourceId: string;
  databaseId: string;
  rowId: string;
  sourceName: string;
  cells: Record<string, string | null>;
  formulaErrors?: Record<string, string>;
  formulaColors?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface DatabaseContainerRowQuery {
  viewId: string;
  /** Null combines every attached source; a source id powers page-layout tabs. */
  sourceId?: string | null;
  localFilter?: FilterNode | null;
  cursor?: string | null;
  limit?: number;
}

export interface DatabaseContainerRowPage {
  rows: DatabaseContainerRow[];
  nextCursor: string | null;
  totalCount: number;
  queryHash: string;
  revision: string;
  hasMore: boolean;
  sources: DatabaseViewDataSource[];
  properties: DatabaseContainerProperty[];
}

export interface AttachDatabaseViewSourceInput {
  alias?: string;
  propertyMap?: Record<string, string>;
}

function slug(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'propiedad';
}

/**
 * Produces deterministic canonical ids. The first property of a type gets the short
 * type id (so Estado and Fase both map to `status`); repeated types retain identity by
 * adding their normalized name.
 */
export function automaticDatabaseSourcePropertyMap(columns: DatabaseColumn[]): Record<string, string> {
  const seen = new Map<DatabaseColumnType, number>();
  const result: Record<string, string> = {};
  for (const column of [...columns].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))) {
    const index = seen.get(column.type) ?? 0; seen.set(column.type, index + 1);
    const key = index === 0 ? column.type : `${column.type}:${slug(column.name)}`;
    result[key] = column.id;
  }
  return result;
}

export function clampDatabaseContainerLimit(value: number | undefined): number {
  if (value == null) return DATABASE_CONTAINER_PAGE_DEFAULT;
  if (!Number.isFinite(value)) throw new Error('El límite del contenedor debe ser un número finito.');
  return Math.max(1, Math.min(DATABASE_CONTAINER_PAGE_MAX, Math.floor(value)));
}
