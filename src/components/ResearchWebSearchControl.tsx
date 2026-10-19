import type { ResearchWebSearchMode } from '@shared/types';
import { t } from '../i18n';
import { Icon } from './ui';

/** Research Chat's web step on or off. On, the agent decides when the library
 * needs the web (or searches because the user asked); off, nothing leaves the
 * machine for search engines or web pages. */
export function ResearchWebSearchControl({ value, onChange, disabled }: { value: ResearchWebSearchMode; onChange: (mode: ResearchWebSearchMode) => void; disabled: boolean }) {
  const on = value !== 'off';
  const label = on ? t('Búsqueda web automática: el agente consulta Internet cuando la biblioteca no basta o se lo pides') : t('Búsqueda web desactivada: solo la biblioteca');
  return <button type="button" className={`research-web-toggle ${on ? 'is-on' : ''}`} aria-pressed={on} aria-label={t('Búsqueda web')} title={label}
    data-testid="research-web-toggle" disabled={disabled} onClick={() => onChange(on ? 'off' : 'auto')}>
    <Icon name="globe" size={18} />
  </button>;
}
