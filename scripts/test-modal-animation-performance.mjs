import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');
const [avatar, orb, classicCss, orbCss, whatsNew, updateProgress, app, styles, main] = await Promise.all([
  read('src/components/nodi/NodiAvatar.tsx'),
  read('src/components/nodi/NodiOrb.tsx'),
  read('src/components/nodi/nodi.css'),
  read('src/components/nodi/nodiOrb.css'),
  read('src/components/WhatsNewModal.tsx'),
  read('src/useUpdateProgress.ts'),
  read('src/App.tsx'),
  read('src/index.css'),
  read('electron/main.ts'),
]);

test('cinematic modals bound the expensive Nodi SVG animation', () => {
  assert.match(avatar, /restAfterMs\?: number/);
  assert.match(avatar, /QUIESCENT\.has\(state\) \|\| restAfterMs !== undefined/);
  assert.match(avatar, /useState\(\(\) => settled && delay <= 0\)/);
  assert.match(avatar, /if \(delay <= 0\) \{\s*setAtRest\(true\)/);
  assert.match(avatar, /\[state, settled, delay\]/);
  assert.match(avatar, /export const NodiAvatar = memo\(NodiAvatarComponent\)/);
  assert.match(whatsNew, /const WhatsNewNodi = memo/);
  assert.match(whatsNew, /<NodiAvatar[\s\S]*settings=\{settings\}[\s\S]*activeVaultType=\{activeVaultType\}[\s\S]*state="celebrating"[\s\S]*restAfterMs=\{0\}/);
  assert.match(whatsNew, /restAfterMs=\{0\}[\s\S]*lightweight/);
  assert.match(orb, /!lightweight && \([\s\S]*feTurbulence/);
  assert.match(orb, /!lightweight && <g className="fx fx-celebrating">/);
  assert.match(app, /<WhatsNewModal[\s\S]*settings=\{settings\}[\s\S]*activeVaultType=\{activeVault\?\.type \?\? null\}/);
  assert.match(classicCss, /\.nodi-svg\.nodi-at-rest \* \{ animation-play-state: paused !important; \}/);
  assert.match(orbCss, /\.nodi-orb\.nodi-at-rest \* \{ animation-play-state: paused !important; \}/);
});

test('cinematic decoration finishes instead of repainting forever', () => {
  const whatsNewAurora = styles.match(/\.whats-new-aurora \{[^\n]+/u)?.[0] ?? '';
  const whatsNewConfetti = styles.match(/\.whats-new-confetti \{[^\n]+/u)?.[0] ?? '';
  assert.ok(whatsNewAurora && whatsNewConfetti);
  assert.doesNotMatch(whatsNewAurora, /infinite/);
  assert.doesNotMatch(whatsNewConfetti, /infinite/);
});

test('the update subscription cleans up and main-process progress stays throttled', () => {
  assert.match(updateProgress, /return \(\) => \{ alive = false; unsubscribe\(\); \}/);
  assert.match(main, /const UPDATE_PROGRESS_MIN_INTERVAL_MS = 500;/);
  assert.match(main, /roundedPercent === lastDownloadProgressPercent/);
  assert.match(main, /now - lastDownloadProgressEmitAt < UPDATE_PROGRESS_MIN_INTERVAL_MS/);
});

test('cinematic modals keep their look without a per-frame React animation engine', () => {
  assert.doesNotMatch(whatsNew, /from 'framer-motion'/);
  assert.match(styles, /@keyframes whats-new-modal-in/);
  assert.match(styles, /\.whats-new-cinema \{[^\n]*animation: whats-new-modal-in/s);
  assert.match(styles, /\.whats-new-backdrop \{[^\n]*backdrop-filter: blur\(10px\)/s);
});

test('release and update overlays suspend hidden duplicate work', () => {
  assert.match(whatsNew, /const STARTUP_VERSION_HISTORY_LIMIT = 12/);
  assert.match(whatsNew, /showSeenReleaseNotes\) return releaseNotesSince\(null, current\)/);
  assert.match(whatsNew, /releaseNotesSince\(null, current\)\.slice\(0, STARTUP_VERSION_HISTORY_LIMIT\)/);
  // The mascot may carry further gates before these two — Study's reduced-distraction
  // mode hides it — but the release modal must still gate the mascot.
  assert.match(app, /\{[^}]*!manualWhatsNewOpen && whatsNewSettled && <NodiMascot settings=\{settings\} \/>\}/);
});
