import { app, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  mergeTutorialCatalogue,
  parseTutorialCatalogue,
  TUTORIAL_CATALOGUE_URL,
  TUTORIAL_VIDEOS,
  type TutorialVideo,
} from '@shared/tutorialVideos';

/**
 * The published tutorial list, so a video recorded after this release still shows up.
 *
 * Deliberately main-process only: fetching from the renderer would mean adding a
 * second remote host to the CSP, and the renderer never needs to talk to it. Fetched
 * when the user opens a grid — not at startup — and the answer is cached in userData
 * so the next launch has the list even offline.
 *
 * Failure is not an error state here: the built-in list is always a complete, working
 * answer, so a timeout, a 404 or a corrupt file just means the user sees this build's
 * three tutorials.
 */

const CACHE_FILE = 'tutorial-catalogue.json';
const FETCH_TIMEOUT_MS = 4_000;
/** One check per app run is plenty for a list that changes a few times a year. */
let inFlight: Promise<TutorialVideo[]> | null = null;

function cachePath(): string {
  return path.join(app.getPath('userData'), CACHE_FILE);
}

/** Overridable so a verification run can serve a catalogue without publishing one. */
function catalogueUrl(): string {
  return process.env.NODUS_TUTORIAL_CATALOGUE_URL || TUTORIAL_CATALOGUE_URL;
}

function readCache(): TutorialVideo[] {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    return parseTutorialCatalogue(raw).videos;
  } catch {
    return [];
  }
}

function writeCache(raw: unknown): void {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(raw), 'utf8');
  } catch (error) {
    console.warn('[tutorials] could not cache the catalogue:', error);
  }
}

async function fetchCatalogue(): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // Electron's net stack, so the app's proxy configuration applies.
    // A cache-buster in the query rather than `cache: 'no-cache'`, which Electron's
    // fetch typing does not accept; GitHub Pages caches aggressively otherwise.
    const url = `${catalogueUrl()}?t=${Math.floor(Date.now() / 60_000)}`;
    const response = await net.fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Built-in videos plus anything published since, as the renderer should render them.
 * Never rejects.
 */
export async function getTutorialCatalogue(): Promise<TutorialVideo[]> {
  if (inFlight) return inFlight;
  let fellBack = false;
  const attempt: Promise<TutorialVideo[]> = (async () => {
    try {
      const raw = await fetchCatalogue();
      const { videos, rejected } = parseTutorialCatalogue(raw);
      if (rejected > 0) console.warn(`[tutorials] ignored ${rejected} malformed catalogue entr${rejected === 1 ? 'y' : 'ies'}`);
      if (videos.length === 0) throw new Error('catalogue had no usable entries');
      writeCache(raw);
      return mergeTutorialCatalogue(videos);
    } catch (error) {
      fellBack = true;
      const cached = readCache();
      if (cached.length > 0) {
        console.log('[tutorials] using the cached catalogue:', error instanceof Error ? error.message : error);
        return mergeTutorialCatalogue(cached);
      }
      console.log('[tutorials] using the built-in list:', error instanceof Error ? error.message : error);
      return [...TUTORIAL_VIDEOS];
    }
  })();
  inFlight = attempt;
  // A failed check must not be remembered as "already done" for the whole run. The block
  // above never rejects (it falls back instead), so a rejection handler alone never fired
  // and one offline open pinned the fallback list until restart.
  void attempt.then(() => { if (fellBack && inFlight === attempt) inFlight = null; }, () => { if (inFlight === attempt) inFlight = null; });
  return attempt;
}

/** Test seam: forget this run's answer. */
export function resetTutorialCatalogueCache(): void {
  inFlight = null;
}
