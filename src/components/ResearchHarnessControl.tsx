import { useEffect, useRef, useState } from 'react';
import type { AppSettings, ResearchWebSearchMode } from '@shared/types';
import type { ResearchRunMode } from '@shared/researchHarness';
import { resolveResearchExploration, type ResearchExplorationMode } from '@shared/researchExploration';
import { ResearchExplorationControl } from './ResearchExplorationControl';
import { t } from '../i18n';

export function useResearchHarnessOptions(settings: AppSettings, mode: ResearchRunMode = 'chat') {
  const version = 'v1' as const;
  const [web, setWeb] = useState<ResearchWebSearchMode>('off');
  const [exploration, setExploration] = useState(() => resolveResearchExploration(mode, undefined, settings.researchExplorationByMode));
  const picked = useRef(0);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let active = true;
    const revision = picked.current;
    void window.nodus.getSettings().then(fresh => {
      if (active && picked.current === revision) setExploration(resolveResearchExploration(mode, undefined, fresh.researchExplorationByMode));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [mode]);
  const chooseExploration = (next: ResearchExplorationMode) => {
    picked.current++; setExploration(next);
    writes.current = writes.current.catch(() => undefined).then(() => window.nodus.updateSettings({ researchExplorationByMode: { [mode]: next } }));
  };
  return { version, web, onWeb: setWeb, exploration, onExploration: chooseExploration };
}
export type ResearchHarnessOptions = ReturnType<typeof useResearchHarnessOptions>;
export function ResearchHarnessControl({ options, disabled = false, web = false, showExploration = true }: { options: ResearchHarnessOptions; disabled?: boolean; web?: boolean; showExploration?: boolean }) {
  return <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="research-harness-control">
    {showExploration && <ResearchExplorationControl value={options.exploration} onChange={options.onExploration} disabled={disabled} />}
    {web && <label className="flex items-center gap-1.5"><input type="checkbox" checked={options.web === 'auto'} disabled={disabled}
      onChange={event => options.onWeb(event.target.checked ? 'auto' : 'off')} />{t('Búsqueda web')}</label>}
  </div>;
}
