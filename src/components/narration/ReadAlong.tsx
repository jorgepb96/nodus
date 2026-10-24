// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useOptionalAudioPlayer, type NarrationClock } from '../AudioPlayer';
import { Icon } from '../ui';
import { toast } from '../feedback';
import { registerReadAlong, type ReadAlongHandle } from '../../lib/narration/readAlong';
import { t } from '../../i18n';
import './readAlong.css';

export interface ReadAlongControls {
  pauseFollow(): void;
  resumeFollow(): void;
}

/**
 * Mount next to a reader to light the words a narration is reading in it. `matches` says which
 * narrations are this reader's text (by source key). When the reader scrolls by hand while it
 * follows the narration, a pill brings it back.
 */
export function ReadAlong({ rootRef, scrollRef, matches, onSegment, controlsRef }: {
  rootRef: RefObject<HTMLElement | null>;
  scrollRef?: RefObject<HTMLElement | null>;
  matches: (sourceKey: string) => boolean;
  onSegment?: (segmentIndex: number, label: string) => void;
  controlsRef?: MutableRefObject<ReadAlongControls | null>;
}) {
  const player = useOptionalAudioPlayer();
  const clock = player?.clock ?? null;
  const [paused, setPaused] = useState(false);
  const matchesRef = useRef(matches);
  const onSegmentRef = useRef(onSegment);
  matchesRef.current = matches;
  onSegmentRef.current = onSegment;
  const registered = useRef<{ root: HTMLElement; scroller: HTMLElement | null; clock: NarrationClock; handle: ReadAlongHandle } | null>(null);

  // Readers swap their text root (another report, another file, the editor remounting): the
  // registration follows whatever the refs hold after each render.
  useEffect(() => {
    const root = rootRef.current ?? null;
    const scroller = scrollRef?.current ?? null;
    const current = registered.current;
    if (current && current.root === root && current.scroller === scroller && current.clock === clock) return;
    current?.handle.unregister();
    registered.current = null;
    setPaused(false);
    if (!root || !clock) return;
    const handle = registerReadAlong({
      root,
      scroller,
      matches: (key) => matchesRef.current(key),
      onSegment: (index, label) => onSegmentRef.current?.(index, label),
      onFollowPaused: setPaused,
    }, clock, () => toast(t('Esa parte no está en el audio generado.'), { tone: 'info' }));
    registered.current = { root, scroller, clock, handle };
    if (controlsRef) controlsRef.current = { pauseFollow: () => handle.pauseFollow(), resumeFollow: () => handle.resumeFollow() };
  });
  useEffect(() => () => {
    registered.current?.handle.unregister();
    registered.current = null;
    if (controlsRef) controlsRef.current = null;
  }, [controlsRef]);

  return paused ? <FollowPill scrollRef={scrollRef} rootRef={rootRef} onResume={() => registered.current?.handle.resumeFollow()} /> : null;
}

/** Floats at the bottom centre of the reader's scroller, outside the text it reads. */
function FollowPill({ scrollRef, rootRef, onResume }: { scrollRef?: RefObject<HTMLElement | null>; rootRef: RefObject<HTMLElement | null>; onResume: () => void }) {
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const box = (scrollRef?.current ?? rootRef.current)?.getBoundingClientRect();
      if (!box) return;
      const bottom = Math.min(box.bottom, window.innerHeight);
      setPlace({ left: box.left + box.width / 2, top: bottom - 52 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [scrollRef, rootRef]);
  if (!place) return null;
  return createPortal(
    <button
      type="button"
      data-testid="read-along-resume"
      data-reader-ignore
      className="read-along-resume"
      style={{ left: place.left, top: place.top }}
      onClick={onResume}
    >
      <Icon name="waveform" size={12} />
      {t('Volver a la narración')}
    </button>,
    document.body,
  );
}
