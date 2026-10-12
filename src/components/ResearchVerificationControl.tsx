import { t } from '../i18n';
import { Icon } from './ui';

type ResearchAnswerVerification = 'off' | 'legacy' | 'structured';

/** Experimental answer-grounding verification for the native research chat. */
export function ResearchVerificationControl({ value, onChange, disabled }: {
  value: ResearchAnswerVerification;
  onChange: (mode: 'off' | 'structured') => void;
  disabled: boolean;
}) {
  const on = value === 'structured';
  return <button type="button" className={`research-web-toggle ${on ? 'is-on' : ''}`} aria-pressed={on}
    aria-label={t('Verificar fuentes')} title={t('La verificación experimental de respuestas añade llamadas y latencia, y no garantiza que sean correctas.')}
    data-testid="research-verification-toggle" disabled={disabled} onClick={() => onChange(on ? 'off' : 'structured')}>
    <Icon name="shield" size={18} />
    <span>{t('Verificar fuentes')}</span>
  </button>;
}
