#!/usr/bin/env node
// Sequentially processes a fixed list of books — full analysis (light → deep) for the
// ones that have never been scanned at all, then a Documentary Index scan for every
// book on the list — ONE AT A TIME. Never starts a new step until the previous one
// has reached a terminal state (done or failed), so the DeepSeek API only ever sees
// one book's worth of work in flight, matching what a person would do if they clicked
// through these one by one instead of using "Process library" on all of them at once.
//
// Also avoids STARTING a new step during DeepSeek's peak pricing window (01:00-04:00
// and 06:00-10:00 UTC, Monday-Friday — https://api-docs.deepseek.com/quick_start/pricing,
// checked 2026-09-27) — off-peak is half price and is the overwhelming majority of the
// week (all weekends, Chinese holidays, and most of each weekday). Work already running
// when a peak window begins is left to finish naturally; nothing gets interrupted mid-
// flight — that's exactly the "shutdown" collateral damage investigated earlier this
// session, and this script exists partly to avoid repeating it.
//
// Keeps ONE Electron instance open for the ENTIRE run. Closing it between books would
// pause/interrupt whatever's mid-flight, the same problem found earlier — so unlike
// scripts/repair-analysis-drift.mjs (which opens briefly, does one bounded thing, and
// closes), this script launches once and stays open until every book on the list has
// reached a terminal state, using the same Playwright (`_electron`) technique for the
// same reason (real settings, real safeStorage-encrypted API key).
//
// Usage:
//   node scripts/scan-book-queue.mjs           # run the fixed BOOKS list below
//   node scripts/scan-book-queue.mjs --dry-run # print the plan, launch nothing
//
// Safe to leave running unattended for many hours. Prints one line per state
// transition; safe to tail.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-scan-book-queue')) {
  const result = spawnSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/scan-book-queue.mjs'), '--electron-scan-book-queue', ...process.argv.slice(2)],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(result.status ?? 1);
}

const args = process.argv.slice(2).filter((a) => a !== '--electron-scan-book-queue');
const dryRun = args.includes('--dry-run');
// --plan <file.json>: [{ zoteroKey | nodusId | title, title, rescan?: true, declutter?: [pdf paths] }]
// instead of the BOOKS below. `declutter` records a declutter choice for those PDFs' works
// (their text is extracted without reaction schemes); `rescan` redoes light and deep analysis
// even when done, as a book whose text changed needs.
const planAt = args.indexOf('--plan');
// --since <ISO>: resume a rescan campaign; a book whose deep scan finished after this time is
// not rescanned again (its passages and Documentary Index are still completed if needed).
const sinceAt = args.indexOf('--since');
const CAMPAIGN_SINCE = sinceAt >= 0 ? args[sinceAt + 1] : null;
const PLAN = planAt >= 0 ? JSON.parse(require('node:fs').readFileSync(args[planAt + 1], 'utf8')) : null;

// The 12 books from the checklist, plus the duplicate library entry found under
// "Macrocycles in Drug Discovery" — flagged, not silently deduped; see the printed
// plan and the final report.
// 2026-09-30: the six synthesis books added to Zotero for route planning (never scanned). Found
// by Zotero key after a catalogue-only sync. Not the McMurry solutions manual (a test set).
const BOOKS = [
  { zoteroKey: 'I6L63XQX', title: 'Organic Synthesis: The Disconnection Approach (Warren & Wyatt)', needsFullAnalysis: true },
  { zoteroKey: 'I3J54QFV', title: 'Strategic Applications of Named Reactions in Organic Synthesis (Kürti & Czakó)', needsFullAnalysis: true },
  { zoteroKey: 'Q5V62WM4', title: 'Organic Chemistry (Clayden, Greeves & Warren)', needsFullAnalysis: true },
  { zoteroKey: 'JCLAQKLK', title: "Vogel's Textbook of Practical Organic Chemistry", needsFullAnalysis: true },
  { zoteroKey: '79Q4VK95', title: "March's Advanced Organic Chemistry", needsFullAnalysis: true },
  { zoteroKey: 'SE5TPCS4', title: "Greene's Protective Groups in Organic Synthesis", needsFullAnalysis: true },
];

// Weekday-only peak windows, in UTC hours [start, end).
const PEAK_WINDOWS_UTC = [
  [1, 4],
  [6, 10],
];

// Don't START a new step (light/deep/Documentary Index) if doing so would leave
// less than this much runway before the next peak window begins — a long step
// (a big textbook's deep scan, say) starting near the edge of a gap can easily
// run past it and finish the job at peak rates anyway. Anything ALREADY running
// when a peak window arrives is left alone regardless — see the module comment.
const PEAK_START_BUFFER_MINUTES = 60;

// Chinese public holidays are off-peak all day (DeepSeek pricing page). Dates are Beijing
// calendar days (UTC+8). NODUS_OFFPEAK_DATES="2026-10-01..2026-10-07,2027-02-16" replaces the
// built-in list, which holds only holidays confirmed from the user's DeepSeek calendar.
const HOLIDAYS_BEIJING = (process.env.NODUS_OFFPEAK_DATES ?? '2026-10-01..2026-10-07')
  .split(',').map((entry) => entry.trim()).filter(Boolean)
  .map((entry) => { const [from, to = from] = entry.split('..'); return [from, to]; });

function beijingDate(date) {
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function isPeakUtcAt(date) {
  const day = date.getUTCDay(); // 0=Sun ... 6=Sat
  if (day === 0 || day === 6) return false;
  const local = beijingDate(date);
  if (HOLIDAYS_BEIJING.some(([from, to]) => local >= from && local <= to)) return false;
  const hour = date.getUTCHours();
  return PEAK_WINDOWS_UTC.some(([start, end]) => hour >= start && hour < end);
}

function isPeakUtcNow() {
  return isPeakUtcAt(new Date());
}

// The UTC Date of the next moment a peak window begins, searching forward hour
// by hour (peak windows are only ever weekday-and-hour gated, so this always
// terminates well within a week).
function nextPeakStart(from) {
  const probe = new Date(from);
  probe.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 24 * 8; i++) {
    probe.setUTCHours(probe.getUTCHours() + 1);
    if (isPeakUtcAt(probe)) return probe;
  }
  throw new Error('nextPeakStart: no peak window found within 8 days — PEAK_WINDOWS_UTC probably misconfigured');
}

function minutesUntil(target, from) {
  return (target.getTime() - from.getTime()) / 60_000;
}

// True when it's unsafe to START a new step right now: either we're already
// inside a peak window, or the next one starts too soon to trust a step to
// clear it before pricing changes underneath it.
function shouldHoldOffStarting(now = new Date()) {
  if (isPeakUtcAt(now)) return true;
  return minutesUntil(nextPeakStart(now), now) <= PEAK_START_BUFFER_MINUTES;
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Progress for a side panel (NODUS_QUEUE_PROGRESS=<file.json>): one job, four steps per book
// (light, deep, passages, Documentary Index). Other jobs in the file are left alone.
const PROGRESS_FILE = process.env.NODUS_QUEUE_PROGRESS;
const PROGRESS_TITLE = process.env.NODUS_QUEUE_TITLE || 'Book scans';
const STEPS = ['light scan', 'deep scan (ideas)', 'passages', 'Documentary Index'];
const progressState = { book: 0, step: 0, title: '', state: 'running', note: '' };
function report(changes = {}) {
  Object.assign(progressState, changes);
  if (!PROGRESS_FILE) return;
  const fs = require('node:fs');
  const total = BOOKS.length * STEPS.length;
  const done = Math.min(total, progressState.book * STEPS.length + progressState.step);
  const detail = progressState.state === 'done' ? `finished · ${progressState.note}`
    : `book ${Math.min(progressState.book + 1, BOOKS.length)}/${BOOKS.length} · ${progressState.title} · ${STEPS[progressState.step] ?? ''}${progressState.note ? ` · ${progressState.note}` : ''}`;
  let jobs = [];
  try { jobs = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')).jobs ?? []; } catch { /* new file */ }
  jobs = jobs.filter((job) => job.title !== PROGRESS_TITLE);
  jobs.push({ title: PROGRESS_TITLE, done, total, detail, state: progressState.state, updated: new Date().toISOString() });
  const tmp = `${PROGRESS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ jobs }, null, 2));
  fs.renameSync(tmp, PROGRESS_FILE);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOffPeak() {
  if (!shouldHoldOffStarting()) return;
  const reason = isPeakUtcNow()
    ? 'inside a DeepSeek peak-pricing window (weekday 01:00-04:00 or 06:00-10:00 UTC)'
    : `within ${PEAK_START_BUFFER_MINUTES}m of the next peak window starting`;
  log(`${reason} — holding off starting anything new until it safely passes...`);
  report({ state: 'waiting', note: 'DeepSeek peak hours: waiting for off-peak' });
  while (shouldHoldOffStarting()) {
    await sleep(5 * 60_000);
  }
  log('clear of the peak window (and its lead-in buffer) — resuming.');
  report({ state: 'running', note: '' });
}

function resolveNodusId(db, book) {
  if (book.nodusId) return book.nodusId;
  if (book.zoteroKey) {
    const byKey = db.prepare('SELECT nodus_id FROM works WHERE zotero_key = ? AND archived = 0').get(book.zoteroKey);
    if (!byKey) throw new Error(`work not found by Zotero key ${book.zoteroKey}: ${book.title}`);
    return byKey.nodus_id;
  }
  const row = db.prepare('SELECT nodus_id FROM works WHERE title = ?').get(book.title);
  if (!row) throw new Error(`work not found by exact title: ${book.title}`);
  return row.nodus_id;
}

function statusOf(db, nodusId) {
  const w = db.prepare('SELECT light_status, deep_status FROM works WHERE nodus_id = ?').get(nodusId);
  const p = db.prepare("SELECT status FROM document_profile_state WHERE nodus_id = ?").get(nodusId);
  return { light: w?.light_status, deep: w?.deep_status, profile: p?.status ?? 'never scanned' };
}

// Polls a status accessor until it returns a terminal value or the timeout elapses.
// terminalValues are checked with strict equality; returns the terminal value seen,
// or throws on timeout.
async function pollUntil(db, label, get, terminalValues, { pollMs = 60_000, timeoutMs = 6 * 60 * 60_000 } = {}) {
  const start = Date.now();
  let lastLogged = null;
  for (;;) {
    const value = get(db);
    if (value !== lastLogged) {
      log(`  ${label}: ${value}`);
      lastLogged = value;
    }
    if (terminalValues.includes(value)) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`${label} did not reach a terminal state within ${(timeoutMs / 3_600_000).toFixed(1)}h (stuck at "${value}")`);
    }
    await sleep(pollMs);
  }
}

/** A scan's status once it finished after `since` (a rescan starts from "done"). */
function finishedSince(db, nodusId, kind, since) {
  const row = db.prepare(`SELECT ${kind}_status AS status, ${kind}_at AS at FROM works WHERE nodus_id=?`).get(nodusId);
  if (row.status === 'done' && !(row.at && row.at > since)) return 'queued';
  return row.status;
}

async function passageStatus(page, nodusId) {
  const [work] = await page.evaluate((id) => window.nodus.getWorkPassageStatuses([id]), nodusId);
  return work?.status ?? 'unknown';
}

async function ensurePassages(page, nodusId) {
  // Let a passage run the deep scan started finish first.
  for (let i = 0; i < 360 && (await page.evaluate(() => window.nodus.getPassageStatus())).running; i++) await sleep(10_000);
  if ((await passageStatus(page, nodusId)) === 'complete') { log('  passages: complete'); return; }
  log('  building passages (local embeddings)...');
  await page.evaluate((id) => window.nodus.startPassageEmbedding([id]), nodusId);
  for (let i = 0; i < 360 && (await page.evaluate(() => window.nodus.getPassageStatus())).running; i++) await sleep(10_000);
  const status = await passageStatus(page, nodusId);
  log(`  passages: ${status}`);
  if (status !== 'complete') throw new Error(`passages did not complete (${status})`);
}

function recordDeclutterChoices(books) {
  const fs = require('node:fs');
  const os = require('node:os');
  const { createHash } = require('node:crypto');
  const Database = require('better-sqlite3');
  const planned = books.flatMap((book) => (book.declutter ?? []).map((file) => ({ book, file: path.resolve(file) })));
  if (!planned.length) return;
  for (const { file } of planned) if (!fs.existsSync(file)) throw new Error(`declutter file not found: ${file}`);
  // The choice extraction reads (schemeDeclutter.ts): one per work and attachment, keyed by
  // sha256([nodus_id, source_ref]). A rescanned book gets new text and new analysis, so it takes
  // the current classifier ('declutter'), replacing any earlier choice.
  const dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'Nodus', 'nodus.sqlite');
  const db = new Database(dbPath, { readonly: dryRun, fileMustExist: true });
  try {
    for (const { book, file } of planned) {
      const itemKey = path.basename(path.dirname(file)); // Zotero storage: <storage>/<itemKey>/<file>
      const work = db.prepare('SELECT nodus_id FROM works WHERE zotero_key = ? OR nodus_id = ?').get(book.zoteroKey ?? '', book.nodusId ?? '')
        ?? db.prepare('SELECT nodus_id FROM work_text_sources WHERE source_ref LIKE ?').get(`zotero:%:%:${itemKey}`);
      if (!work) throw new Error(`no work found for declutter file: ${file}`);
      const sourceRef = db.prepare('SELECT source_ref FROM work_text_sources WHERE nodus_id = ? AND source_ref LIKE ?').get(work.nodus_id, `zotero:%:%:${itemKey}`)?.source_ref
        ?? `zotero:user:0:${itemKey}`;
      const key = `pdf_declutter:${createHash('sha256').update(JSON.stringify([work.nodus_id, sourceRef])).digest('hex')}`;
      if (!dryRun) db.prepare("INSERT INTO settings (key, value) VALUES (?, 'declutter') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key);
      log(`declutter${dryRun ? ' (dry run, not written)' : ''}: ${path.basename(file)} -> ${sourceRef}`);
    }
  } finally {
    db.close();
  }
}

async function main() {
  const Database = require('better-sqlite3');
  const os = require('node:os');
  const dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'Nodus', 'nodus.sqlite');

  if (PLAN) BOOKS.splice(0, BOOKS.length, ...PLAN);
  console.log('=== Plan ===');
  recordDeclutterChoices(BOOKS);
  for (const book of BOOKS) {
    console.log(`  ${book.rescan ? '[RESCAN light+deep+passages+DocIndex]' : book.needsFullAnalysis ? '[light+deep+DocIndex]' : '[DocIndex only]'} ${book.title}${book.declutter ? ' [declutter]' : ''}${book.note ? `  (${book.note})` : ''}`);
  }
  if (dryRun) {
    console.log('\n--dry-run: not launching anything.');
    return;
  }

  const { _electron: electron } = require(path.join(repoRoot, 'node_modules/playwright-core/index.js'));
  const env = { ...process.env, NODUS_DISABLE_AUTO_UPDATE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  log('launching Nodus (one instance, kept open for the whole run)...');
  const electronApp = await electron.launch({
    executablePath: require(path.join(repoRoot, 'node_modules/electron')),
    args: [repoRoot],
    cwd: repoRoot,
    env,
    timeout: 10 * 60_000,
  });
  const results = [];
  try {
    const page = await electronApp.firstWindow({ timeout: 10 * 60_000 });
    page.on('console', (msg) => console.log(`  [renderer:${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => console.log('  [renderer:pageerror]', err.message));
    page.setDefaultTimeout(30 * 60_000);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Escape').catch(() => {});
      const closeButton = page.locator('button[aria-label="Close" i], button[aria-label="Cerrar" i], [role="dialog"] button:has-text("×")').first();
      if (await closeButton.isVisible().catch(() => false)) await closeButton.click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // New books must be in the library first: a catalogue-only sync imports them without
    // starting any analysis (this queue runs the analysis, one book at a time).
    if (BOOKS.some((book) => book.zoteroKey)) {
      log('syncing the Zotero catalogue (no analysis)...');
      const entry = await page.evaluate(() => window.nodus.syncNow({ catalogOnly: true }));
      log(`  sync: ${JSON.stringify(entry).slice(0, 300)}`);
    }
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    for (const book of BOOKS) log(`  ${book.title} → ${resolveNodusId(db, book)}`);
    try {
      for (const book of BOOKS) {
        const nodusId = resolveNodusId(db, book);
        log(`=== ${book.title} ===`);
        report({ book: BOOKS.indexOf(book), step: 0, title: book.title.slice(0, 60), state: 'running', note: '' });
        const before = statusOf(db, nodusId);
        log(`  starting state: light=${before.light} deep=${before.deep} profile=${before.profile}`);

        let since = '';
        const deepAt = db.prepare('SELECT deep_at FROM works WHERE nodus_id=?').get(nodusId)?.deep_at ?? '';
        const redo = book.rescan && !(CAMPAIGN_SINCE && deepAt >= CAMPAIGN_SINCE);
        if (book.rescan && !redo) log(`  already rescanned in this campaign (deep ${deepAt}) — not redoing light/deep`);
        if (book.needsFullAnalysis || redo) {
          if (before.light !== 'done' || redo) {
            await waitForOffPeak();
            log('  enqueueing light scan...');
            since = new Date().toISOString();
            await page.evaluate((id) => window.nodus.rescan(id, 'light', null), nodusId);
            await pollUntil(db, 'light_status', (d) => finishedSince(d, nodusId, 'light', since), ['done', 'failed']);
          }
          report({ step: 1 });
          if (before.deep !== 'done' || redo) {
            await waitForOffPeak();
            log('  enqueueing deep (ideas) scan...');
            since = new Date().toISOString();
            await page.evaluate((id) => window.nodus.rescan(id, 'deep', null), nodusId);
            await pollUntil(db, 'deep_status', (d) => finishedSince(d, nodusId, 'deep', since), ['done', 'failed']);
          }
          report({ step: 2 });
        }

        const midState = statusOf(db, nodusId);
        if (midState.deep === 'failed' || (book.needsFullAnalysis && midState.light === 'failed')) {
          log('  full analysis failed — skipping Documentary Index for this book, moving on.');
          results.push({ ...book, outcome: 'analysis_failed' });
          continue;
        }

        if (before.profile === 'current' && !redo) {
          // Already current as of the start-of-loop snapshot — a restart re-entering
          // this book (e.g. after a crash) must not re-run a finished Documentary
          // Index pass. Re-check live rather than trust the snapshot, since light/deep
          // may have just been (re)done above and could have flipped profile stale.
          const liveProfile = statusOf(db, nodusId).profile;
          if (liveProfile === 'current') {
            log('  Documentary Index already current — skipping.');
            results.push({ ...book, outcome: 'current' });
            continue;
          }
        }

        // The deep scan starts the book's passage embedding in the background. The Documentary
        // Index prepares the same document, so starting it before the passages are complete
        // makes the two supersede each other (2026-09-30: all six books failed that way, with
        // no passages saved). Build the passages first, alone, and wait for them.
        report({ step: 2 });
        await ensurePassages(page, nodusId);
        report({ step: 3 });

        await waitForOffPeak();
        log('  enqueueing Documentary Index scan...');
        await page.evaluate((id) => window.nodus.enqueueDocumentProfile(id), nodusId);
        const finalProfileStatus = await pollUntil(
          db,
          'document_profile_state',
          (d) => (d.prepare('SELECT status FROM document_profile_state WHERE nodus_id=?').get(nodusId) ?? { status: 'unknown' }).status,
          ['current', 'failed']
        );
        results.push({ ...book, outcome: finalProfileStatus });
        log(`  done: ${finalProfileStatus}`);
        report({ step: 4, note: finalProfileStatus === 'current' ? '' : `last: ${finalProfileStatus}` });
      }
    } finally {
      db.close();
    }
  } finally {
    log('closing Nodus...');
    await electronApp.close();
  }

  console.log('\n=== Final report ===');
  for (const r of results) console.log(`  ${r.outcome === 'current' ? 'OK' : 'FAILED'.padEnd(2)}  ${r.title}`);
  const failed = results.filter((r) => r.outcome !== 'current').length;
  report({ book: BOOKS.length, step: 0, state: failed ? 'failed' : 'done', note: `${results.length - failed} OK, ${failed} failed` });
}

main().catch((error) => {
  console.error(error);
  try { report({ state: 'failed', note: String(error?.message ?? error).slice(0, 120) }); } catch { /* ignore */ }
  process.exit(1);
});
