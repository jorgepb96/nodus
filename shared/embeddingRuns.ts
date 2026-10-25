export type EmbeddingRunReason = 'manual' | 'model_change' | 'rebuild' | 'activation' | 'resume' | 'retry' | 'automatic_retry' | 'restart' | 'new_content' | 'content_changed' | 'legacy';
export type EmbeddingItemOutcome = 'pending' | 'reused' | 'computed' | 'excluded' | 'failed';
export interface EmbeddingRunCounters {
  reviewed: number;
  reused: number;
  computed: number;
  excluded: number;
  failed: number;
  providerInputs: number;
}
export interface EmbeddingIndexRun extends EmbeddingRunCounters {
  id: string;
  indexId: string;
  generation: number;
  reason: EmbeddingRunReason;
  lastReason: EmbeddingRunReason;
  state: 'running' | 'paused' | 'cancelled' | 'error' | 'complete';
  startedAt: string;
  updatedAt: string;
  error: string | null;
}
export const EMBEDDING_RUN_REASON_LABELS: Record<EmbeddingRunReason, string> = {
  manual: 'Solicitud manual',
  model_change: 'Cambio de modelo o perfil',
  rebuild: 'Reconstrucción manual',
  activation: 'Activación sin recálculo',
  resume: 'Reanudación manual',
  retry: 'Reintento manual',
  automatic_retry: 'Reintento automático',
  restart: 'Recuperación tras cierre o reinicio',
  new_content: 'Contenido nuevo',
  content_changed: 'Contenido modificado',
  legacy: 'Origen no registrado (tarea anterior)',
};
