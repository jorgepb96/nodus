import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { Icon } from './ui';

/** Keep the original controls mounted while only their presentation changes. */
export function AcademicSecondary({ compact, children, label = 'Más' }: { compact: boolean; children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!ref.current?.contains(target) && !target.closest('[role="dialog"], [role="menu"], dialog, [data-modal-layer]')) setOpen(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
  }, [open]);
  // Both branches keep the same DOM hierarchy, retaining child popover state.
  return <div ref={ref} className={compact ? 'academic-secondary-menu' : 'contents'}>
    {compact && <button type="button" className="btn btn-ghost border border-neutral-700 text-xs" aria-expanded={open} onClick={() => setOpen(value => !value)}><Icon name="moreVertical" size={14} />{t(label)}</button>}
    <div className={compact ? 'academic-secondary-panel' : 'contents'} hidden={compact && !open} data-browser-native-overlay={compact && open ? 'true' : undefined}>{children}</div>
  </div>;
}
