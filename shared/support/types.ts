import type { AppLanguage } from '../types';

export const SUPPORT_PROTOCOL = 1;
export type SupportSymptom = 'startup' | 'tool' | 'data' | 'sync' | 'update' | 'other';
export type SupportAction = 'fresh-profile' | 'software-graphics' | 'copy-profile' | 'disable-plugins' | 'database-check' | 'rebuild-library' | 'restore-copy' | 'reinstall' | 'configuration-check' | 'model-check' | 'repair-local-endpoints' | 'pause-sync' | 'archive-roundtrip' | 'library-check' | 'recover-database' | 'apply-solution' | 'undo-solution' | 'prepare-runtime';
export type SupportStatus = 'created' | 'protecting' | 'protected' | 'testing' | 'awaiting-user' | 'confirmed' | 'reverted' | 'blocked' | 'interrupted' | 'conflict';
export interface SupportFinding { code: string; level: 'info' | 'warning' | 'error'; component: string; count?: number; }
export interface SupportInspection {
  profile: string; executable: string | null; version: string | null; protocol: number | null;
  language: AppLanguage; platform: string; arch: string; findings: SupportFinding[]; roots: string[];
  osVersion?:string|null;
}
export interface SupportSession {
  id: string; at: string; symptom: SupportSymptom; mode: 'guided' | 'automatic'; status: SupportStatus;
  actions: Array<{ id: string; action: SupportAction; status: string; code?: string; at: string }>;
  files: number; bytes: number; folder: string; recoveredProfiles: string[];
  trialOpened?: string | null;
  policyApplied?: string|null;
  diagnosticVersion?:string;
  recoveryInfo?:Record<string,{source:string;backupDate?:string}>;
  findings?: SupportFinding[];
  conflict?: {current:string;previous:string} | null;
}
export interface SupportLogSelection { limit: 20 | 50 | 100 | 'all'; since?: string; until?: string; }
export interface SupportReport { markdown: string; issueUrl: string; needsClipboard: boolean; errors: string[]; }
export interface SupportState { inspection: SupportInspection; sessions: SupportSession[]; storage: string; qualifiedRepairs?: string[]; }
export interface SupportApi {
  setLanguage(language: AppLanguage): Promise<void>;
  inspect(): Promise<SupportState>;
  chooseProfile(): Promise<SupportState | null>;
  chooseExecutable(): Promise<SupportState | null>;
  chooseStorage(): Promise<SupportState | null>;
  create(input: { symptom: SupportSymptom; mode: 'guided' | 'automatic' }): Promise<SupportSession>;
  protect(id: string): Promise<SupportSession>;
  test(id: string, action: SupportAction): Promise<SupportSession>;
  answer(id: string, works: boolean): Promise<SupportSession>;
  cancel(id: string): Promise<SupportSession>;
  resume(id: string): Promise<SupportSession>;
  launchRecovered(id: string, index: number): Promise<SupportSession>;
  applySolution(id: string, index: number): Promise<SupportSession>;
  undoSolution(id: string,choice?: 'check'|'keep-current'|'use-previous'): Promise<SupportSession>;
  report(id: string, selection: SupportLogSelection): Promise<SupportReport>;
  saveReport(id: string, selection: SupportLogSelection, reviewed: string): Promise<string | null>;
  exportOriginalLogs(id: string): Promise<string | null>;
  copyReport(text: string): Promise<void>;
  openIssue(id: string, selection: SupportLogSelection, reviewed: string): Promise<void>;
  reinstall(id: string,update?: boolean): Promise<SupportSession>;
  restore(id: string, password: string): Promise<SupportSession>;
  reveal(id: string): Promise<void>;
  openGuide(id:string): Promise<void>;
  onProgress(callback: (progress: { phase: string; completed: number; total: number }) => void): () => void;
}
