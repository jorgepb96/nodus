import { useState } from 'react';
import type { AppSettings, ResearchWebSearchMode } from '@shared/types';
import type { ResearchHarnessVersion } from '@shared/researchHarness';
import { t } from '../i18n';

export function useResearchHarnessOptions(settings: AppSettings) {
  const [version, setVersion] = useState<ResearchHarnessVersion>(settings.researchHarnessVersion ?? 'legacy');
  const [web, setWeb] = useState<ResearchWebSearchMode>('off');
  const choose = (next: ResearchHarnessVersion) => {
    setVersion(next);
    void window.nodus.updateSettings({ researchHarnessVersion: next });
  };
  return { version, onVersion: choose, web, onWeb: setWeb };
}
export type ResearchHarnessOptions = ReturnType<typeof useResearchHarnessOptions>;
export function ResearchHarnessControl({ options, disabled = false, web = false }: { options: ResearchHarnessOptions; disabled?: boolean; web?: boolean }) {
  return <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="research-harness-control">
    <label className="flex items-center gap-1.5"><input type="checkbox" checked={options.version === 'v1'} disabled={disabled}
      onChange={event => options.onVersion(event.target.checked ? 'v1' : 'legacy')} />Nodus Research Harness · {t('Vista previa')}</label>
    {web && options.version === 'v1' && <label className="flex items-center gap-1.5"><input type="checkbox" checked={options.web === 'auto'} disabled={disabled}
      onChange={event => options.onWeb(event.target.checked ? 'auto' : 'off')} />{t('Búsqueda web')}</label>}
  </div>;
}
