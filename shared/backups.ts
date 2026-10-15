import type { VaultType } from './vaultTypes';

export const BACKUP_CATEGORIES = [
  { id: 'research', label: 'Investigación' },
  { id: 'notes', label: 'Notas y Scriptor' },
  { id: 'dictionary', label: 'Diccionario' },
  { id: 'conversations', label: 'Chats e informes' },
  { id: 'study', label: 'Estudio' },
  { id: 'teaching', label: 'Docencia' },
  { id: 'databases', label: 'Bases de datos' },
  { id: 'archive', label: 'Archivo y genealogía' },
  { id: 'prosopography', label: 'Prosopografía' },
  { id: 'testimony', label: 'Testimonios' },
  { id: 'worldbuilding', label: 'Worldbuilding' },
] as const;
export type BackupCategory = (typeof BACKUP_CATEGORIES)[number]['id'];
export type OpenBackupFormat = 'markdown' | 'csv' | 'json';
export interface OpenBackupOptions {
  vaultIds: string[];
  categories: BackupCategory[];
  /** table key -> record keys; absent means all, [] means none. */
  selections: Record<string, string[]>;
  formats: OpenBackupFormat[];
  organization: 'works' | 'authors' | 'ideas';
  summaries: 'inline' | 'separate' | 'none';
  includeIdeas: boolean;
  includeEvidence: boolean;
  includeThemes: boolean;
  includeRelations: boolean;
  includeSyntheses: boolean;
  includeAttachments: boolean;
  includeHistory: boolean;
  includeGlobalLibrary: boolean;
  /** Per-export acknowledgement required by source and testimony export policies. */
  authorizePreservation: boolean;
  container: 'folder' | 'zip';
}
export interface BackupPreset {
  id: string;
  name: string;
  options: OpenBackupOptions;
}
export interface BackupCatalogEntry {
  key: string;
  tableKey: string;
  table: string;
  category: BackupCategory;
  vaultId: string;
  title: string;
  subtitle: string;
}
export interface BackupCatalog {
  vaults: Array<{ id: string; name: string; type: VaultType }>;
  counts: Partial<Record<BackupCategory, number>>;
  tables: Array<{ key: string; name: string; category: BackupCategory; count: number; vaultId: string }>;
  presets: BackupPreset[];
}
export interface BackupCatalogQuery {
  vaultIds: string[];
  category?: BackupCategory;
  tableKey?: string;
  query?: string;
  offset?: number;
  limit?: number;
}
export interface BackupCatalogPage {
  entries: BackupCatalogEntry[];
  total: number;
}
export interface OpenBackupProgress {
  jobId: string;
  phase: 'snapshot' | 'export' | 'package';
  completed: number;
  total: number;
  message: string;
}
export interface OpenBackupPreview {
  records: number;
  files: number;
  bytes: number;
  sample: { path: string; content: string } | null;
  omissions: string[];
  requiresConfirmation?: boolean;
}
export interface OpenBackupResult extends OpenBackupPreview {
  path: string | null;
  cancelled: boolean;
}
export function defaultOpenBackupOptions(vaultId: string): OpenBackupOptions {
  return {
    vaultIds: [vaultId],
    categories: BACKUP_CATEGORIES.map((c) => c.id),
    selections: {},
    formats: ['markdown'],
    organization: 'works',
    summaries: 'inline',
    includeIdeas: true,
    includeEvidence: true,
    includeThemes: true,
    includeRelations: true,
    includeSyntheses: true,
    includeAttachments: true,
    includeHistory: true,
    includeGlobalLibrary: false,
    authorizePreservation: false,
    container: 'zip',
  };
}
