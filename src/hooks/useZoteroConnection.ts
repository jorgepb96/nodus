import { useCallback, useEffect, useRef, useState } from 'react';
import type { ZoteroPingResult } from '@shared/types';

/** How often a screen that is waiting for Zotero asks again. */
export const ZOTERO_RETRY_INTERVAL_MS = 3000;
/**
 * How long it keeps asking on its own. Long enough to open Zotero and tick one box in
 * its settings; short enough that a screen left open overnight is not a polling loop.
 */
export const ZOTERO_RETRY_WINDOW_MS = 120_000;

export interface ZoteroConnection {
  /** `null` until the first check has answered. */
  status: ZoteroPingResult | null;
  /** A check is in flight right now. */
  checking: boolean;
  /** Not connected yet, and still re-checking without being asked. */
  watching: boolean;
  /** Check now, and start a fresh window of automatic re-checks if it still fails. */
  retry: () => void;
}

async function pingZotero(): Promise<ZoteroPingResult> {
  try {
    return await window.nodus.zoteroPing();
  } catch (cause) {
    // The bridge itself failed; to the person in front of the screen that is the same
    // thing as a Zotero that did not answer, and it gets the same instructions.
    return { ok: false, reason: 'unreachable', message: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * The state of the link to Zotero's local API, for any screen that needs Zotero.
 *
 * A screen that only checked once left the user to find a "Retry" button after fixing
 * the cause in another application. This one notices by itself: while disconnected it
 * re-checks every few seconds for a bounded window, so ticking the box in Zotero turns
 * the screen green without coming back to press anything. Once connected it stops —
 * the ping is one local request, but nothing needs it repeated.
 */
export function useZoteroConnection(enabled = true): ZoteroConnection {
  const [status, setStatus] = useState<ZoteroPingResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [watchUntil, setWatchUntil] = useState(0);
  const alive = useRef(true);
  const inFlight = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    const next = await pingZotero();
    inFlight.current = false;
    if (!alive.current) return;
    setStatus(next);
    setChecking(false);
    if (next.ok) setWatchUntil(0);
  }, []);

  const retry = useCallback(() => {
    setWatchUntil(Date.now() + ZOTERO_RETRY_WINDOW_MS);
    void check();
  }, [check]);

  useEffect(() => {
    if (enabled) retry();
  }, [enabled, retry]);

  const connected = status?.ok === true;
  useEffect(() => {
    if (!enabled || connected || watchUntil === 0) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= watchUntil) {
        setWatchUntil(0);
        return;
      }
      void check();
    }, ZOTERO_RETRY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, connected, watchUntil, check]);

  return { status, checking, watching: !connected && watchUntil > 0, retry };
}
