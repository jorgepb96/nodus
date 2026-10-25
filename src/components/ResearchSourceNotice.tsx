import { useRef, useState, type ComponentProps } from 'react';
import { researchSourcePresentation } from '@shared/researchSourceNotices';
import { HeaderBalloon } from './HeaderBalloon';
import { Markdown } from './Markdown';
import { Icon } from './ui';
import { t } from '../i18n';

/** Optional, user-opened source coverage. Kept outside the copyable answer body. */
export function ResearchSourceNotice({ notices, onCitation }: { notices: readonly string[]; onCitation?: ComponentProps<typeof Markdown>['onCitation'] }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (!notices.length) return null;
  const title = t('Sobre las fuentes');
  return <div className="mt-2" data-testid="research-source-notice">
    <button ref={anchor} type="button" className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-amber-400 hover:bg-amber-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500" aria-label={title} title={title} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Icon name="alert" size={14} /><span>{title}</span>
    </button>
    <HeaderBalloon open={open} anchor={anchor} onClose={() => setOpen(false)} title={title} icon={<Icon name="alert" size={18} />} width={420} testId="research-source-notice-balloon">
      <div className="space-y-3 p-3 text-sm leading-6">{notices.map((notice, index) => <Markdown key={index} content={notice} onCitation={onCitation} />)}</div>
    </HeaderBalloon>
  </div>;
}

export function ResearchMarkdown({ content, ...props }: ComponentProps<typeof Markdown>) {
  const display = researchSourcePresentation(content);
  return <><Markdown {...props} content={display.content} /><ResearchSourceNotice notices={display.notices} onCitation={props.onCitation} /></>;
}
