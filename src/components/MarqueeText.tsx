import { useEffect, useRef } from 'react';

/**
 * A name cut short by its row: at rest it truncates like any other, and while the row
 * (the nearest `data-marquee-host`) is hovered it slides sideways, back and forth, until
 * the end has been read. A name that fits never moves. The overflow is measured when the
 * pointer arrives, so renaming or resizing needs no observer.
 */
export function MarqueeText({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const outer = ref.current;
    const host = outer?.closest<HTMLElement>('[data-marquee-host]');
    if (!outer || !host) return;
    const measure = () => {
      // Chat actions overlay the title: slide its end clear of those controls too.
      const actions = host.matches('.research-history-chat') ? host.querySelector<HTMLElement>(':scope > .research-history-row-actions') : null;
      const covered = actions ? Math.max(0, outer.getBoundingClientRect().right - actions.getBoundingClientRect().left + 8) : 0;
      const textWidth = covered ? outer.firstElementChild!.getBoundingClientRect().width : outer.scrollWidth;
      const shift = textWidth - outer.clientWidth + covered;
      const overflowing = shift > 1;
      outer.classList.toggle('is-overflowing', overflowing);
      if (!overflowing) return;
      outer.style.setProperty('--marquee-shift', `${-shift}px`);
      // About 40px a second, never so fast that it cannot be read.
      outer.style.setProperty('--marquee-duration', `${Math.max(2.5, 1.5 + shift / 40).toFixed(2)}s`);
    };
    host.addEventListener('pointerenter', measure);
    return () => host.removeEventListener('pointerenter', measure);
  }, []);
  return <span ref={ref} className={`research-marquee ${className}`}><span>{text}</span></span>;
}
