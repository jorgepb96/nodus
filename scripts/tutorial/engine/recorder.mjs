// The recording engine: everything every tutorial video does the same way.
//
// A deck supplies what is particular to one video — which shots, which profile,
// which settings, which helpers. This drives the real app through Playwright,
// moves a synthetic cursor, draws the highlight ring, captures frames over CDP and
// writes a timeline that assembly turns into a film.
//
// NARRATION DECIDES THE CLOCK. Every shot is held for exactly as long as its
// narration line lasts. That single rule is what lets a line be re-voiced later
// without re-recording anything, and it is why `narrate` must run before `record`.
//
// Usage, from a deck's record.mjs:
//
//   import { record } from '../../engine/recorder.mjs';
//   import { SHOTS, nav } from './shots.mjs';
//   await record({ name: 'mydeck', shots: SHOTS, nav, helpers: (ctx) => ({ … }) });
//
// A deck module is:
//   {
//     name,                     // output goes to .tutorial-out/<name>
//     shots,                    // the shot list (see decks/_template/shots.mjs)
//     nav,                      // (view) => selector, for shots that navigate
//     masterProfile?,           // path to a profile to copy, when reusing a corpus
//     settings?,                // extra settings seeded before the first frame
//     prepare?: async (ctx),    // anything else to do before recording starts
//     helpers: (ctx) => ({ … }) // what the shots' `act(h)` functions call
//   }
//
// `ctx` carries: page, app, settle, warn, highlight, pointAndClick,
// closeAnyDialog, searchSettings, repoRoot, userData, diagDir, dryRun.

import { mkdtemp, mkdir, rm, readFile, writeFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { CURSOR_CSS, installCursor } from './cursor.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const appVersion = require(path.join(repoRoot, 'package.json')).version;

/** 1600×900 filmed at 2× so the camera can push in without going soft. */
const WIN = { width: 1600, height: 900 };
const SCALE = 2;
const DRY_SHOT_SECONDS = 4.5;

/** Available to every deck: add `nodus-blur` to any element to hide it. */
export const PRIVACY_CSS = `
.nodus-blur { filter: blur(6px) !important; }
`;

/**
 * Settings every deck needs, whatever it films.
 *
 * These are not cosmetic. Each one silences something that otherwise covers the
 * app and eats the clicks — every one of them cost a wasted take before it was
 * added. See PITFALLS.md.
 */
export const BASE_SETTINGS = {
  uiLanguage: 'en',
  // A SEPARATE setting from uiLanguage, defaulting to Spanish. Leaving it alone
  // makes the AI extract every idea in Spanish under an English interface.
  promptLanguage: 'en',
  basicsTutorialVersion: 9999,   // suppresses the cinematic onboarding deck
  recoverySetupVersion: 9999,    // ...and the recovery wizard that 9999 would open
  onboardingComplete: true,
  mascotStyleChosen: true,       // suppresses the "choose your Nodi" modal
  tourComplete: true,
  advancedTourComplete: true,
  genealogyTourComplete: true,
  databasesTourComplete: true,
  studyTourComplete: true,
  docenciaTourComplete: true,
};

export async function record(deck) {
  const dryRun = process.argv.includes('--dry');
  const OUT = path.join(repoRoot, '.tutorial-out', deck.name);
  const FRAMES = path.join(OUT, 'frames');
  const DIAG = path.join(OUT, 'diagnostics');
  const tag = `[${deck.name}]`;
  const nav = deck.nav ?? ((view) => `[data-tour="nav-${view}"]`);

  if (!existsSync(path.join(repoRoot, 'dist-electron/main.js'))) {
    throw new Error('Run `npm run build` first — the recorder drives the built app.');
  }

  const narrationFile = path.join(OUT, 'narration.json');
  if (!dryRun && !existsSync(narrationFile)) {
    throw new Error(`Run "node scripts/tutorial/engine/narrate.mjs --deck=${deck.name}" first — shot lengths come from it (or pass --dry).`);
  }
  const narration = existsSync(narrationFile) ? JSON.parse(await readFile(narrationFile, 'utf8')) : { cues: [] };
  const cueById = new Map(narration.cues.map((c) => [c.id, c]));

  await rm(FRAMES, { recursive: true, force: true });
  await mkdir(FRAMES, { recursive: true });
  await rm(DIAG, { recursive: true, force: true });
  await mkdir(DIAG, { recursive: true });

  // ── the profile ──────────────────────────────────────────────────────────
  // Always a throwaway copy. The installed Nodus is never touched.
  // A continuation can reopen an owned recording profile. Keeping its source
  // paths and timestamps also keeps previously issued citation revisions valid.
  if(deck.existingProfile&&(!path.resolve(deck.existingProfile).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(deck.existingProfile).startsWith('nodus-learning-')))throw new Error('Continuation requires an owned temporary learning profile');
  const userData = deck.existingProfile ?? await mkdtemp(path.join(os.tmpdir(), `nodus-${deck.name}-`));
  if (deck.masterProfile&&!deck.existingProfile) {
    await rm(userData, { recursive: true, force: true });
    await cp(deck.masterProfile, userData, { recursive: true, preserveTimestamps:true });
    // vaults.json stores an ABSOLUTE path to the vault database, so copying the
    // profile alone leaves every run reading and writing the SAME vault — the
    // isolation is an illusion and state leaks between takes. Copy the vault too
    // and repoint the registry.
    const registryFile = path.join(userData, 'vaults.json');
    if (existsSync(registryFile)) {
      const registry = JSON.parse(await readFile(registryFile, 'utf8'));
      for (const vault of registry.vaults ?? []) {
        const local = path.join(userData, `vault-${vault.id}.sqlite`);
        await cp(vault.path, local).catch(() => {});
        for (const suffix of ['-wal', '-shm']) await cp(vault.path + suffix, local + suffix).catch(() => {});
        vault.path = local;
      }
      await writeFile(registryFile, JSON.stringify(registry, null, 2), 'utf8');
    }
  }

  const env = {
    ...process.env,
    NODUS_USERDATA: userData,
    NODUS_DISABLE_AUTO_UPDATE: '1',
    NODUS_E2E_UPDATE_STATUS: 'not-available',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const warnings = [];
  const warn = (msg) => {
    warnings.push(msg);
    console.warn(`${tag} ⚠ ${msg}`);
  };

  const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
  // The scan queue prints the real reason it paused to the main process log, while
  // the UI only shows "This message could not be translated". Mirror it here, or a
  // missing API key looks like a translation bug for an hour.
  app.process().stderr.on('data', (d) => {
    const line = String(d);
    if (/scanQueue|AiError|paused|no key|model/i.test(line)) process.stdout.write(`[main] ${line}`);
  });

  const frames = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(20_000);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });

    await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Nodus') ?? BrowserWindow.getAllWindows()[0];
      win.setContentSize(size.width, size.height);
      win.center();
    }, WIN);

    // The what's-new modal opens whenever the stored version differs from the
    // running one, and it swallows every click behind it. Stamping the real
    // version is what keeps it shut.
    await page.addInitScript((v) => {
      localStorage.setItem('nodus.lastSeenVersion', v);
      sessionStorage.setItem('nodus.startupUpdateChecked', '1');
      for (const key of ['nodus.mobileTeaserSeen.3.2.4', 'nodus.platformHighlightsSeen.2026-07', 'nodus.tutorialVideosAnnouncementSeen.2026-07', 'nodus.pdfPresenterTutorialSeen.e2js_u-05OA', 'nodus.toolkitBetaGuideSeen.2.4.0']) localStorage.setItem(key, '1');
    }, appVersion);
    await page.evaluate((settings) => window.nodus.updateSettings(settings), { ...BASE_SETTINGS, ...(deck.settings ?? {}) });
    await page.reload();
    await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length), { timeout: 30_000 });
    await page.waitForTimeout(2500);

    // Refuse to film behind something. A covered app records 20 shots of a modal
    // backdrop and still reports success.
    const blocker = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="dialog"], .whats-new-backdrop, [aria-modal="true"]')]
        .find((d) => d.getBoundingClientRect().height > 200);
      return el ? (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) : null;
    });
    if (blocker) throw new Error(`Something covers the app before filming: ${blocker}`);

    await page.locator('.backup-health-dismiss').first().click({ timeout: 2000 }).catch(() => {});

    const settle = (ms) => page.waitForTimeout(ms);

    await page.evaluate((css) => { window.__TUTORIAL_CURSOR_CSS__ = css; }, CURSOR_CSS + PRIVACY_CSS);
    await page.evaluate(installCursor);

    /**
     * Close whatever dialog is open, and confirm it actually closed.
     *
     * Coordinates are the wrong tool: clicking (24, 24) to "hit the backdrop" lands
     * on the macOS window controls, and hunting for a "✕" finds unrelated chips.
     * This finds the topmost full-screen fixed overlay and prefers its own close
     * control, located by SHAPE — a small button near the panel's top — because the
     * glyph is often an SVG with empty textContent, which `:has-text("✕")` misses
     * while reporting success.
     */
    const closeAnyDialog = async () => {
      const overlayProbe = () => [...document.querySelectorAll('div')].filter((d) => {
        const cs = getComputedStyle(d);
        if (cs.position !== 'fixed') return false;
        const r = d.getBoundingClientRect();
        return r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9
          && Number(cs.zIndex || 0) >= 40;
      }).at(-1);

      for (let attempt = 0; attempt < 4; attempt++) {
        const present = await page.evaluate((probeSrc) => {
          const findOverlay = new Function(`return (${probeSrc})()`);
          const overlay = findOverlay();
          if (!overlay) return false;
          const box = overlay.getBoundingClientRect();
          const closer = [...overlay.querySelectorAll('button')].find((b) => {
            const r = b.getBoundingClientRect();
            return r.width > 8 && r.width < 60 && r.height < 60 && r.y < box.y + 140;
          });
          if (closer) { closer.click(); return true; }
          const cancel = [...overlay.querySelectorAll('button')]
            .find((b) => /^(cancel|close|cerrar)$/i.test((b.textContent ?? '').trim()));
          if (cancel) { cancel.click(); return true; }
          overlay.click();
          return true;
        }, overlayProbe.toString()).catch(() => false);

        if (!present) return true;
        await settle(600);
        const stillOpen = await page.evaluate((probeSrc) => {
          const findOverlay = new Function(`return (${probeSrc})()`);
          return Boolean(findOverlay());
        }, overlayProbe.toString()).catch(() => false);
        if (!stillOpen) return true;
        await page.keyboard.press('Escape').catch(() => {});
        await settle(500);
      }
      warn('a dialog would not close — later clicks may land on its backdrop');
      return false;
    };

    /** Move the synthetic cursor to an element, pulse, then click it. */
    const pointAndClick = async (selector, { required = true, timeout = 6000 } = {}) => {
      const el = page.locator(selector).first();
      let box = null;
      try {
        await el.waitFor({ state: 'visible', timeout });
        box = await el.boundingBox();
      } catch { /* handled below */ }
      if (!box) {
        if (required) warn(`selector not found: ${selector}`);
        return false;
      }
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.evaluate((p) => window.__tutorialCursor?.moveTo(p.x, p.y), centre);
      await settle(620);
      await page.evaluate(() => window.__tutorialCursor?.pulse());
      let ok = true;
      await el.click({ timeout: 6000 }).catch(async () => {
        // Name what is in the way. A bare "click failed" turns every interception
        // into a guessing game about which layer is on top.
        const blocked = await page.evaluate(({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          if (!hit) return 'nothing at that point';
          const name = (n) => `${n.tagName.toLowerCase()}.${(n.className?.toString() ?? '').split(/\s+/).slice(0, 2).join('.')}`;
          const chain = [];
          for (let n = hit, i = 0; n && i < 3; n = n.parentElement, i++) chain.push(name(n));
          const cs = getComputedStyle(hit);
          return `${chain.join(' < ')} [z=${cs.zIndex} pe=${cs.pointerEvents} vis=${cs.visibility} op=${cs.opacity}]`;
        }, centre).catch(() => 'unknown');
        warn(`click failed: ${selector} — blocked by ${blocked}`);
        ok = false;
      });
      return ok;
    };

    /** Draw the ring. Accepts a list of candidates and uses the first that exists. */
    const highlight = async (selector) => {
      // In-situ guides already identify their real control. A second, static ring
      // around an entire workspace distracts from that control and can go stale.
      if (await page.locator('[data-learning-guide="true"]').isVisible().catch(()=>false)) return true;
      const candidates = Array.isArray(selector) ? selector : [selector];
      for (const c of candidates) {
        const target=page.locator(c).first();
        if (await target.isVisible().catch(()=>false)) {
          await target.evaluate(element=>window.__tutorialCursor?.highlightElement(element));
          return true;
        }
      }
      warn(`highlight target not found: ${candidates.join(' | ')}`);
      return false;
    };
    const clearHighlights = () => page.evaluate(() => window.__tutorialCursor?.clearHighlights());

    /** Type into the settings search, and verify it took. */
    const searchSettings = async (text) => {
      const input = page.locator('main input[placeholder*="ettings"]').first();
      if (!(await input.isVisible().catch(() => false))) return void warn('no settings search input');
      await input.fill('');
      await input.pressSequentially(text, { delay: 45 });
      await settle(900);
      // Assert the field's value, never the page's text length: the page is always
      // long, so a length check passes even when nothing was typed.
      const value = await input.inputValue().catch(() => '');
      if (value !== text) warn(`settings search did not take: "${text}" → "${value}"`);
    };

    const ctx = {
      page, app, settle, warn, highlight, pointAndClick, closeAnyDialog, searchSettings,
      repoRoot, userData, diagDir: DIAG, dryRun, deckName: deck.name,
      /** Screenshot plus a summary of what IS on screen, for when something is not. */
      diagnose: async (label) => {
        await page.screenshot({ path: path.join(DIAG, `${label}.png`) }).catch(() => {});
        const seen = await page.evaluate(() => ({
          sections: [...document.querySelectorAll('section.card h2')].map((h) => h.textContent?.trim()).slice(0, 8),
          inputs: [...document.querySelectorAll('input')].map((i) => i.placeholder).filter(Boolean).slice(0, 8),
          dialog: Boolean(document.querySelector('[role="dialog"], .modal')),
        })).catch(() => null);
        warn(`${label}: ${JSON.stringify(seen)}`);
      },
    };

    await deck.prepare?.(ctx);
    const helpers = { ...ctx, ...(deck.helpers?.(ctx) ?? {}) };

    // ── screencast ─────────────────────────────────────────────────────────
    const cdp = await app.context().newCDPSession(page);
    const t0 = Date.now();
    let index = 0;
    cdp.on('Page.screencastFrame', async (frame) => {
      const file = path.join(FRAMES, `f${String(index++).padStart(6, '0')}.jpg`);
      frames.push({ t: (Date.now() - t0) / 1000, file });
      await writeFile(file, Buffer.from(frame.data, 'base64')).catch(() => {});
      await cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: 88,
      maxWidth: WIN.width * SCALE, maxHeight: WIN.height * SCALE, everyNthFrame: 1,
    });

    // ── shoot ──────────────────────────────────────────────────────────────
    const timeline = [];
    for (const shot of deck.shots) {
      const cue = cueById.get(shot.id) ?? (dryRun ? { duration: DRY_SHOT_SECONDS } : null);
      if (!cue) { warn(`no narration cue for ${shot.id} — skipped`); continue; }

      await clearHighlights();
      // Nothing may be left covering the app between shots: a dialog left open
      // turns every later click into a silent no-op while the run still reports
      // success. Shots whose subject IS an open dialog opt out with `keepOverlay`.
      if (!shot.keepOverlay) await closeAnyDialog();

      const started = (Date.now() - t0) / 1000;

      if (shot.nav) {
        const ok = await pointAndClick(nav(shot.nav), { required: false });
        if (!ok) await page.screenshot({ path: path.join(DIAG, `${shot.id}-nav.png`) }).catch(() => {});
      }
      await settle(shot.settleBefore ?? 500);

      const measureFocus = async () => {
        if (!shot.focus) return null;
        const handle = await page.$(shot.focus);
        if (!handle || !(await handle.isVisible().catch(() => false))) {
          warn(`focus target missing: ${shot.focus} (${shot.id})`);
          return null;
        }
        // boundingBox() happily returns coordinates for elements below the fold,
        // and the camera then pushes in on empty space.
        await handle.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await settle(500);
        return handle.boundingBox().catch(() => null);
      };

      const holdUntil = started + cue.duration;
      let focusRect = null;
      if (shot.act && shot.focus && !shot.focusBeforeAct) {
        await shot.act(helpers).catch((e) => { warn(`act failed in ${shot.id}: ${e.message}`); if (deck.failFast) throw e; });
        focusRect = await measureFocus();
      } else {
        focusRect = await measureFocus();
        if (shot.act) await shot.act(helpers).catch((e) => { warn(`act failed in ${shot.id}: ${e.message}`); if (deck.failFast) throw e; });
      }

      if (shot.highlight) await highlight(shot.highlight);

      if (shot.timelapse && !dryRun) {
        // A timelapse shot runs as long as the work takes; assembly compresses the
        // captured span back into the narration line.
        if (typeof helpers.waitForWork !== 'function') {
          warn(`${shot.id} is a timelapse but the deck has no waitForWork helper`);
        } else {
          await helpers.waitForWork(shot.maxWaitMinutes ?? 45);
        }
      } else {
        const remaining = holdUntil - (Date.now() - t0) / 1000;
        if (remaining > 0) await settle(Math.round(remaining * 1000));
      }

      const ended = (Date.now() - t0) / 1000;
      timeline.push({
        id: shot.id, start: started, end: ended,
        narration: cue.duration, focus: focusRect, timelapse: Boolean(shot.timelapse), say: shot.say,
      });
      await writeFile(path.join(OUT, 'progress.json'), JSON.stringify({
        window: WIN, frameSize: { width: WIN.width * SCALE, height: WIN.height * SCALE },
        cssToFrame: SCALE, duration: frames.length ? frames.at(-1).t : 0,
        shots: timeline, frames, warnings,
      }, null, 2), 'utf8');
      console.log(`${tag} ${shot.id.padEnd(22)} ${(ended - started).toFixed(2)}s${focusRect ? ' · zoom' : ''}${shot.timelapse ? ' · timelapse' : ''}`);
    }

    await cdp.send('Page.stopScreencast').catch(() => {});
    await settle(400);

    await writeFile(path.join(OUT, 'timeline.json'), JSON.stringify({
      window: WIN, frameSize: { width: WIN.width * SCALE, height: WIN.height * SCALE },
      cssToFrame: SCALE, duration: frames.length ? frames.at(-1).t : 0,
      shots: timeline, frames, warnings,
    }, null, 2), 'utf8');
    console.log(`\n${tag} ${frames.length} frames · ${timeline.length}/${deck.shots.length} shots · ${warnings.length} warnings`);
    if (warnings.length) console.log(`${tag} review the warnings before assembling — a take with warnings usually shows them on screen`);
  } finally {
    await app.close().catch(() => {});
    if (deck.existingProfile||process.argv.includes('--keep-profile')) {
      console.log(`${tag} profile kept at ${userData}`);
    } else {
      await rm(userData, { recursive: true, force: true }).catch(() => {});
    }
  }
}
