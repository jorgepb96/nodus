// SPDX-License-Identifier: AGPL-3.0-only
import { ttsRetentionDays, type TtsRetentionSettings, type TtsSurface } from '@shared/ttsModels';
import type { AudioEntityKind } from '@shared/types';
import { yieldToEventLoop } from '../util/async';

/**
 * Automatic deletion of narration clips. Each surface removes its unpinned clips once they are
 * older than its rule (global by default: 7 days). The sweep works in small batches with an
 * event-loop yield between them, so even thousands of expired clips never stall the window.
 * Study narration is not swept: those clips are study material the user generated on purpose.
 */
export const SURFACE_KINDS: Readonly<Record<TtsSurface, AudioEntityKind>> = {
  research_chat: 'chat_message',
  dictionary: 'dictionary_entry',
  deep_research: 'deep_research',
  immersion: 'immersion',
};

export interface RetentionStore {
  listExpired(kind: AudioEntityKind, cutoffIso: string, limit: number): { id: string }[];
  remove(id: string): Promise<void> | void;
}

export async function sweepNarrationClips(settings: TtsRetentionSettings, store: RetentionStore, now = Date.now(), batch = 100): Promise<number> {
  let removed = 0;
  for (const [surface, kind] of Object.entries(SURFACE_KINDS) as [TtsSurface, AudioEntityKind][]) {
    const days = ttsRetentionDays(settings, surface);
    if (days == null) continue;
    const cutoff = new Date(now - days * 86_400_000).toISOString();
    for (;;) {
      const expired = store.listExpired(kind, cutoff, batch);
      if (!expired.length) break;
      for (const clip of expired) { await store.remove(clip.id); removed += 1; }
      await yieldToEventLoop();
      if (expired.length < batch) break;
    }
  }
  return removed;
}

/** Runs the sweep at start-up and every six hours, one at a time; timers never keep the app alive. */
export function scheduleNarrationRetention(run: () => Promise<unknown>, intervalMs = 6 * 3_600_000): () => void {
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void run().catch(() => { /* retried on the next tick */ }).finally(() => { running = false; });
  };
  const first = setTimeout(tick, 60_000);
  first.unref?.();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => { clearTimeout(first); clearInterval(timer); };
}
