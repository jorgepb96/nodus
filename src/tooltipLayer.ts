/**
 * One tooltip for every `title` attribute in the main window.
 *
 * The app carries well over a thousand `title` attributes, and left to Chromium they
 * all become native macOS tooltips: a long, fixed OS delay, no light/dark styling,
 * nothing at all while the window is not key, and an occasional no-show when the
 * pointer lands on an element with a single mouse event. This layer replaces them
 * without touching any call site:
 *
 * - On the first real pointer move over an element with a `title`, that title (and
 *   any titled ancestor's, which Chromium would fall back to) is blanked to `""` so the
 *   native tooltip never starts, and the text is shown in a themed popover instead.
 *   The value lives in memory and goes back when the pointer leaves, when it presses
 *   the element (tests and handlers read `title` right after a click) or on scroll.
 * - `""` rather than removing the attribute keeps every React update observable: a new
 *   value is re-stashed and shown live, a removed attribute is never restored.
 * - Keyboard focus shows the same tooltip but never blanks the title, so the
 *   accessible name of title-only icon buttons stays intact for screen readers.
 * - The popover sits in the top layer, above modal `<dialog>`s and every z-index, flips
 *   and clamps to stay inside the window, and never covers the Browser's native page
 *   view (which would hide it); when nothing fits, the native tooltip takes over.
 *
 * Opt out with `data-native-tooltip` on an element or any ancestor. Prefer a side with
 * `data-tooltip-placement="top|bottom|left|right"` on the element or an ancestor.
 */

type Placement = 'top' | 'bottom' | 'left' | 'right';
type Box = { left: number; top: number; right: number; bottom: number };
type Source = 'pointer' | 'focus';

const SHOW_DELAY_MS = 400;
/** Moving from one tooltip to the next shows it at once, like a native menu bar. */
const WARM_DELAY_MS = 30;
const WARM_WINDOW_MS = 500;
const WATCH_INTERVAL_MS = 200;
const GAP = 6;
const EDGE = 8;
/** Rows, cards and editors: anchor to the pointer instead of the far-away element box. */
const LARGE_ANCHOR = { width: 420, height: 120 };
const TITLED = '[title]:not([title=""])';
const OPT_OUT = '[data-native-tooltip], iframe, webview, option';
const PLACEMENTS: readonly Placement[] = ['top', 'bottom', 'left', 'right'];
const OPPOSITE: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function titledElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest(TITLED);
  if (!(element instanceof HTMLElement) || element.closest(OPT_OUT)) return null;
  return element;
}

function preferredPlacement(anchor: HTMLElement): Placement {
  const value = anchor.closest<HTMLElement>('[data-tooltip-placement]')?.dataset.tooltipPlacement;
  return PLACEMENTS.includes(value as Placement) ? value as Placement : 'top';
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The title only repeats text the element already shows in full: nothing to add. */
function isRedundant(anchor: HTMLElement, text: string): boolean {
  if (normalize(anchor.innerText) !== normalize(text)) return false;
  const nodes = [anchor, ...Array.from(anchor.querySelectorAll<HTMLElement>('*')).slice(0, 40)];
  return nodes.every((node) => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1);
}

function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** The Browser's native WebContentsView paints over any HTML, tooltips included. */
function nativeViewBox(): Box | null {
  const viewport = document.querySelector<HTMLElement>('[data-browser-viewport]');
  const box = viewport?.getBoundingClientRect();
  return box && box.width > 0 && box.height > 0 ? box : null;
}

/**
 * Where a `width × height` tooltip goes around `anchor`: the preferred side, then its
 * opposite, then the other axis. Null when only the native page view is in the way,
 * so the caller can hand the tooltip back to the OS.
 */
export function placeTooltip(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred: Placement,
  blocked: Box | null,
): { left: number; top: number; placement: Placement } | null {
  const { width, height } = size;
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), Math.max(EDGE, viewport.width - width - EDGE));
  const clampY = (y: number) => Math.min(Math.max(y, EDGE), Math.max(EDGE, viewport.height - height - EDGE));
  const centreX = (anchor.left + anchor.right) / 2;
  const centreY = (anchor.top + anchor.bottom) / 2;
  const order = [preferred, OPPOSITE[preferred], ...PLACEMENTS.filter((p) => p !== preferred && p !== OPPOSITE[preferred])];
  const candidates = order.map((placement) => {
    const left = placement === 'left' ? anchor.left - GAP - width
      : placement === 'right' ? anchor.right + GAP
        : clampX(centreX - width / 2);
    const top = placement === 'top' ? anchor.top - GAP - height
      : placement === 'bottom' ? anchor.bottom + GAP
        : clampY(centreY - height / 2);
    const room = placement === 'top' ? anchor.top - GAP - EDGE
      : placement === 'bottom' ? viewport.height - anchor.bottom - GAP - EDGE
        : placement === 'left' ? anchor.left - GAP - EDGE
          : viewport.width - anchor.right - GAP - EDGE;
    const fits = room >= (placement === 'top' || placement === 'bottom' ? height : width);
    const box = { left, top, right: left + width, bottom: top + height };
    return { placement, left, top, room, fits, covered: Boolean(blocked && intersects(box, blocked)) };
  });
  const best = candidates.find((c) => c.fits && !c.covered);
  if (best) return { left: best.left, top: best.top, placement: best.placement };
  if (candidates.some((c) => c.fits)) return null;
  // Nothing fits whole (a huge title in a small window): take the roomiest side and
  // keep the box on screen; the line clamp in CSS bounds the height.
  const roomiest = [...candidates].sort((a, b) => b.room - a.room)[0];
  const fallback = { left: clampX(roomiest.left), top: clampY(roomiest.top) };
  const box = { ...fallback, right: fallback.left + width, bottom: fallback.top + height };
  return blocked && intersects(box, blocked) ? null : { ...fallback, placement: roomiest.placement };
}

/** Installs the layer on `document`; returns the teardown. Safe to call once per window. */
export function installTooltipLayer(): () => void {
  const tip = document.createElement('div');
  tip.className = 'nodus-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.dataset.testid = 'app-tooltip';
  const label = document.createElement('span');
  label.className = 'nodus-tooltip-text';
  tip.append(label);
  const supportsPopover = typeof tip.showPopover === 'function';
  if (supportsPopover) tip.popover = 'manual';
  else tip.style.display = 'none';
  document.body.append(tip);

  let anchor: HTMLElement | null = null;
  let source: Source | null = null;
  /** Original titles blanked on `anchor` and its titled ancestors, nearest first. */
  const stash = new Map<HTMLElement, string>();
  /** Hidden until the pointer leaves the anchor: after a press, Escape or typing. */
  let suppressed = false;
  /** Pressed: titles are back in the DOM until the next pointer move re-blanks them. */
  let pressed = false;
  let visible = false;
  let lastHiddenAt = 0;
  let lastTarget: EventTarget | null = null;
  let lastPressAt = 0;
  let pointer = { x: 0, y: 0 };
  /** Where the pointer was when a pointer-anchored tooltip opened; it stays put there. */
  let pinned: { x: number; y: number } | null = null;
  let shownText = '';
  let shownBox = '';
  let showTimer: number | undefined;
  let watchTimer: number | undefined;

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const element = record.target as HTMLElement;
      if (!stash.has(element)) continue;
      const value = element.getAttribute('title');
      if (value === null) {
        stash.delete(element);
      } else if (value !== '') {
        stash.set(element, value);
        element.setAttribute('title', '');
      }
    }
    observer.takeRecords();
    if (visible) render();
  });

  function blankTitles(from: HTMLElement): void {
    for (let node: HTMLElement | null = from; node; node = node.parentElement) {
      const value = node.getAttribute('title');
      if (!value) continue;
      stash.set(node, value);
      node.setAttribute('title', '');
      observer.observe(node, { attributes: true, attributeFilter: ['title'] });
    }
    observer.takeRecords();
  }

  function restoreTitles(): void {
    observer.takeRecords();
    observer.disconnect();
    for (const [node, value] of stash) {
      if (node.getAttribute('title') === '') node.setAttribute('title', value);
    }
    stash.clear();
  }

  function currentText(): string {
    if (!anchor) return '';
    const value = source === 'pointer' && !pressed ? stash.get(anchor) : anchor.getAttribute('title');
    return (value ?? '').trim();
  }

  function hide(): void {
    window.clearTimeout(showTimer);
    if (visible) lastHiddenAt = performance.now();
    visible = false;
    pinned = null;
    shownText = '';
    shownBox = '';
    // Unconditional: render() opens the popover to measure it before it knows whether
    // there is anywhere to put it.
    if (supportsPopover) {
      try { tip.hidePopover(); } catch { /* already closed */ }
    } else {
      tip.style.display = 'none';
    }
  }

  function release(): void {
    hide();
    window.clearInterval(watchTimer);
    watchTimer = undefined;
    restoreTitles();
    anchor = null;
    source = null;
    suppressed = false;
    pressed = false;
  }

  /** Hands the tooltip back to Chromium for the rest of this hover. */
  function fallBackToNative(): void {
    hide();
    restoreTitles();
    suppressed = true;
    pressed = false;
  }

  function anchorBox(): Box {
    const rect = anchor!.getBoundingClientRect();
    const large = rect.width > LARGE_ANCHOR.width || rect.height > LARGE_ANCHOR.height;
    if (source === 'pointer' && large) {
      // Past the arrow cursor's tip, the way the OS does it.
      const at = pinned ?? pointer;
      return { left: at.x, right: at.x, top: at.y - 4, bottom: at.y + 16 };
    }
    return rect;
  }

  function render(): void {
    if (!anchor || suppressed) return;
    const text = currentText();
    if (!text) {
      hide();
      return;
    }
    const box = anchorBox();
    const boxKey = `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.right)},${Math.round(box.bottom)}`;
    if (visible && text === shownText && boxKey === shownBox) return;
    if (!visible) {
      if (isRedundant(anchor, text)) return;
      tip.style.display = '';
      if (supportsPopover) {
        // Re-showing moves it to the top of the top layer, above a dialog opened since.
        try { tip.hidePopover(); } catch { /* not open */ }
        tip.showPopover();
      }
    }
    label.textContent = text;
    tip.style.left = '0px';
    tip.style.top = '0px';
    const size = { width: tip.offsetWidth, height: tip.offsetHeight };
    const spot = placeTooltip(
      box,
      size,
      { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
      preferredPlacement(anchor),
      nativeViewBox(),
    );
    if (!spot) {
      if (source === 'pointer') fallBackToNative();
      else hide();
      return;
    }
    tip.style.left = `${Math.round(spot.left)}px`;
    tip.style.top = `${Math.round(spot.top)}px`;
    tip.dataset.placement = spot.placement;
    shownText = text;
    shownBox = boxKey;
    if (!visible) {
      visible = true;
      pinned = { ...pointer };
    }
  }

  function watch(): void {
    if (!anchor) return;
    if (!anchor.isConnected) {
      release();
      return;
    }
    if (visible) render();
  }

  function engage(element: HTMLElement, from: Source): void {
    anchor = element;
    source = from;
    suppressed = false;
    pressed = false;
    if (from === 'pointer') blankTitles(element);
    const warm = performance.now() - lastHiddenAt < WARM_WINDOW_MS;
    showTimer = window.setTimeout(render, warm ? WARM_DELAY_MS : SHOW_DELAY_MS);
    watchTimer = window.setInterval(watch, WATCH_INTERVAL_MS);
  }

  // Only real moves engage: a node that appears under a resting pointer keeps its
  // `title` in the DOM until the user actually moves.
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    pointer = { x: event.clientX, y: event.clientY };
    if (event.target === lastTarget && anchor) {
      if (pressed && anchor && source === 'pointer') {
        pressed = false;
        blankTitles(anchor);
      }
      return;
    }
    lastTarget = event.target;
    const target = event.target as Node;
    if (anchor && source === 'pointer' && anchor.contains(target)) {
      const inner = titledElement(target);
      if (!inner || inner === anchor || !anchor.contains(inner)) {
        if (pressed) {
          pressed = false;
          blankTitles(anchor);
        }
        return;
      }
    }
    if (anchor) release();
    const next = titledElement(target);
    if (next) engage(next, 'pointer');
  };

  const onPointerOut = (event: PointerEvent) => {
    // Out of the window, or onto the Browser's native page view.
    if (!event.relatedTarget && source === 'pointer') {
      release();
      lastTarget = null;
    }
  };

  const onPointerDown = () => {
    lastPressAt = performance.now();
    if (!anchor) return;
    hide();
    suppressed = true;
    if (source === 'pointer' && !pressed) {
      restoreTitles();
      pressed = true;
    }
  };

  const onKeyDown = () => {
    // A key switches back to keyboard navigation immediately, even just after a
    // click. The pointer-focus grace period must not swallow the next Tab's tooltip.
    lastPressAt = -Infinity;
    if (!anchor) return;
    hide();
    suppressed = true;
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    // Keyboard focus only: a click into a titled field is not a request for its tooltip.
    if (performance.now() - lastPressAt < 400) return;
    if (!(target instanceof HTMLElement) || !target.matches(':focus-visible')) return;
    // Release first: a hovered anchor's title is blanked until then.
    release();
    const next = titledElement(target);
    if (next) engage(next, 'focus');
  };

  const onFocusOut = () => {
    if (source === 'focus') release();
  };

  // Only a scroll that moves the anchor: a chat streaming in another pane must not
  // close the tooltip the user is reading.
  const onScroll = (event: Event) => {
    const scroller = event.target;
    if (!anchor || !(scroller === document || (scroller instanceof Node && scroller.contains(anchor)))) return;
    release();
    lastTarget = null;
  };

  const onWheel = () => {
    if (!anchor) return;
    release();
    lastTarget = null;
  };

  const onWindowBlur = () => {
    release();
    lastTarget = null;
  };

  const options = { capture: true, passive: true } as const;
  document.addEventListener('pointermove', onPointerMove, options);
  document.addEventListener('pointerout', onPointerOut, options);
  document.addEventListener('pointerdown', onPointerDown, options);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('scroll', onScroll, options);
  document.addEventListener('wheel', onWheel, options);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('resize', onWindowBlur);

  return () => {
    release();
    document.removeEventListener('pointermove', onPointerMove, options);
    document.removeEventListener('pointerout', onPointerOut, options);
    document.removeEventListener('pointerdown', onPointerDown, options);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('scroll', onScroll, options);
    document.removeEventListener('wheel', onWheel, options);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('resize', onWindowBlur);
    tip.remove();
  };
}
