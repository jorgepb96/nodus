/** The sources the header's media popover can show. */
export type MediaSourceTab = 'browser' | 'drift' | 'narration';

/**
 * The tab a freshly opened popover starts on: Browser if that is all there is, Drift if that
 * is all there is, and the last one chosen when both exist (Browser the very first time).
 * Narration, when it is playing or being generated, is the first tab: it wins unless the user
 * last chose another source that is still there.
 * Choosing a tab never changes what is playing; this only decides which controls are shown.
 */
export function defaultMediaTab(hasBrowser: boolean, hasDrift: boolean, last: MediaSourceTab | null, hasNarration = false): MediaSourceTab {
  if (hasNarration) {
    if (last === 'browser' && hasBrowser) return 'browser';
    if (last === 'drift' && hasDrift) return 'drift';
    return 'narration';
  }
  if (hasBrowser && hasDrift) return last === 'drift' ? 'drift' : 'browser';
  return hasDrift ? 'drift' : 'browser';
}
