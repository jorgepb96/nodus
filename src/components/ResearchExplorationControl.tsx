import { useId } from 'react';
import type { ResearchExplorationMode } from '@shared/researchExploration';
import { t } from '../i18n';
import './researchExploration.css';

/** A two-option switch, shared by the chat toolbar and the three generation forms. */
export function ResearchExplorationControl({ value, onChange, disabled = false }: {
  value: ResearchExplorationMode; onChange: (value: ResearchExplorationMode) => void; disabled?: boolean;
}) {
  const name = useId();
  return <div className="research-exploration-control" role="radiogroup" aria-label={t('Amplitud de investigación')}
    aria-disabled={disabled} data-testid="research-exploration-control">
    <label className="research-exploration-option" title={t('Búsquedas centradas y menos lecturas, con margen para resolver dudas importantes.')}>
      <input className="sr-only" type="radio" name={name} value="fast" checked={value === 'fast'} disabled={disabled}
        onChange={() => onChange('fast')} /><span>{t('Rápido')}</span>
    </label>
    <label className="research-exploration-option" title={t('Más margen para explorar preguntas relacionadas, contrastar y conectar fuentes.')}>
      <input className="sr-only" type="radio" name={name} value="expanded" checked={value === 'expanded'} disabled={disabled}
        onChange={() => onChange('expanded')} /><span>{t('Ampliado')}</span>
    </label>
  </div>;
}
