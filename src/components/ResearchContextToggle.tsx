import { t } from '../i18n';
import { Icon } from './ui';

/** Temporarily turn all sources off, then restore precisely the previous selection. */
export function ResearchContextToggle({ active, canRestore, onToggle }: {
  active: boolean;
  canRestore: boolean;
  onToggle: () => void;
}) {
  return <button type="button" className={`research-web-toggle research-context-toggle ${active ? 'is-on' : 'is-paused'}`}
    aria-label={t('Contexto')} aria-pressed={active} title={t(active ? 'Desactivar todo el contexto' : 'Restaurar el contexto anterior')}
    data-testid="research-context-toggle" disabled={!active && !canRestore} onClick={onToggle}>
    <Icon name={active ? 'layers' : 'layersOff'} size={18} />
  </button>;
}
