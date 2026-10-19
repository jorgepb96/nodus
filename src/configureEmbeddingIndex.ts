import type { ModelRef } from '@shared/types';
import { normalizeEmbeddingProvider } from '@shared/providers';
import { confirm } from './components/feedback';
import { t, tx } from './i18n';

/** Onboarding and guided setup use the same preparation boundary as Settings. */
export async function configureEmbeddingIndex(model: ModelRef): Promise<boolean> {
  const vault = await window.nodus.getActiveVault();
  const selection = { provider: normalizeEmbeddingProvider(model.provider), model: model.model, vaultId: vault.id };
  const preview = await window.nodus.previewEmbeddingIndex(selection);
  if (preview.pending && !await confirm({ title: t('Preparar índice de embeddings'), confirmLabel: t('Preparar y activar'),
    message: [tx('{n} reutilizables', { n: preview.reusable }), tx('{n} pendientes', { n: preview.pending }),
      t(preview.external ? 'El texto pendiente se enviará al proveedor seleccionado y puede generar costes.' : 'Los embeddings pendientes se generarán en este equipo.'),
      t('Se conservarán los índices anteriores. El nuevo se activará cuando termine de actualizarse.')].join(' · ') })) return false;
  const id = await window.nodus.prepareEmbeddingIndex(selection);
  await new Promise<void>((resolve, reject) => {
    let checking = false, again = false, finished = false;
    let release = () => {};
    const done = (error?: Error) => { if (finished) return; finished = true; release(); if (error) reject(error); else resolve(); };
    const check = async () => {
      if (checking || finished) { again = !finished; return; }
      checking = true;
      try {
        const indexes = await window.nodus.listEmbeddingIndexes(vault.id);
        const index = indexes.find(index => index.id === id);
        if (!index) done(new Error(t('No se encontró el índice de embeddings.')));
        else if (index.active && index.preparation === 'idle') done();
        else if (index.preparation !== 'running') done(new Error(index.error || t('La preparación del índice se ha detenido.')));
      } catch (cause) { done(cause instanceof Error ? cause : new Error(String(cause))); }
      finally { checking = false; if (again && !finished) { again = false; void check(); } }
    };
    release = window.nodus.onEmbeddingIndexesChanged(() => { void check(); });
    void check();
  });
  return true;
}
