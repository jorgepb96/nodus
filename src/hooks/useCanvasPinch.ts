import { useEffect, useRef, type RefObject } from 'react';
import { touchPair } from '@shared/touchCamera';

/** A two-finger gesture pans and zooms together; releasing it cannot select a node. */
export function useCanvasPinch(element: RefObject<HTMLElement | null>, onStart: () => void,
  onMove: (start: ReturnType<typeof touchPair>, next: ReturnType<typeof touchPair>) => void) {
  const callbacks = useRef({ onStart, onMove }); callbacks.current = { onStart, onMove };
  const consuming = useRef(false);
  useEffect(() => {
    const view = element.current;
    if (!view) return;
    let start: ReturnType<typeof touchPair> | null = null;
    const pair = (event: TouchEvent) => {
      const box = view.getBoundingClientRect();
      const a = event.touches[0], b = event.touches[1];
      return touchPair({ x: a.clientX - box.left, y: a.clientY - box.top }, { x: b.clientX - box.left, y: b.clientY - box.top });
    };
    const begin = (event: TouchEvent) => {
      if (event.touches.length < 2) return;
      event.preventDefault(); consuming.current = true; start = pair(event); callbacks.current.onStart();
    };
    const move = (event: TouchEvent) => {
      if (!start || event.touches.length < 2) return;
      event.preventDefault(); callbacks.current.onMove(start, pair(event));
    };
    const end = (event: TouchEvent) => {
      if (event.touches.length < 2) start = null;
      if (!event.touches.length) queueMicrotask(() => { consuming.current = false; });
    };
    view.addEventListener('touchstart', begin, { passive: false });
    view.addEventListener('touchmove', move, { passive: false });
    view.addEventListener('touchend', end); view.addEventListener('touchcancel', end);
    return () => { view.removeEventListener('touchstart', begin); view.removeEventListener('touchmove', move); view.removeEventListener('touchend', end); view.removeEventListener('touchcancel', end); };
  }, [element]);
  return consuming;
}
