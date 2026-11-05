import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { t } from '../i18n';
import './mobileSheet.css';

const sheets = new Set<HTMLElement>();
let previousInert = false;

/** A phone detail never resizes its canvas. The mounted view keeps its state behind the sheet. */
export function MobileSheet({ open = true, title, onClose, children, className = '' }: {
  open?: boolean; title: string; onClose: () => void; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const swipe = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const sheet = ref.current;
    if (!open || !sheet) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById('root');
    if (!sheets.size) previousInert = root?.inert ?? false;
    sheets.add(sheet);
    if (root) root.inert = true;
    sheet.querySelector<HTMLButtonElement>('[data-sheet-close]')?.focus({ preventScroll: true });
    const keyboard = (event: KeyboardEvent) => {
      if ([...sheets].at(-1) !== sheet || event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      // Popovers portal outside the sheet, so let their own keyboard handlers work.
      if (event.key !== 'Tab' || !sheet.contains(document.activeElement)) return;
      const items = [...sheet.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,select,a[href],[tabindex="0"]')]
        .filter(item => !item.closest('[hidden]') && item.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      document.removeEventListener('keydown', keyboard); sheets.delete(sheet);
      if (!sheets.size && root) root.inert = previousInert;
      if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
    };
  }, [open]);
  return createPortal(<div className="nodus-mobile-sheet-layer" hidden={!open}>
    <button className="nodus-mobile-sheet-backdrop" tabIndex={-1} aria-label={t('Cerrar')} onClick={onClose} />
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`nodus-mobile-sheet ${className}`}>
      <header className="nodus-mobile-sheet-header"
        onPointerDown={event => { swipe.current = { x: event.clientX, y: event.clientY }; }}
        onPointerUp={event => { const start = swipe.current; swipe.current = null; if (start && event.clientY - start.y > 65 && Math.abs(event.clientX - start.x) < 50) onClose(); }}>
        <span className="nodus-mobile-sheet-handle" aria-hidden="true" />
        <strong>{title}</strong>
        <button data-sheet-close aria-label={t('Cerrar')} onClick={onClose}><Icon name="x" size={20} /></button>
      </header>
      <div className="nodus-mobile-sheet-content">{children}</div>
    </div>
  </div>, document.body);
}
