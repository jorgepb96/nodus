// Step 5 of the tutorial pipeline: title card, end card, and the music bed.
//
// This stage never re-renders the tutorial itself. The narration and the recorded
// picture are finished work; the cards are rendered separately and concatenated
// around the existing file, and the music is mixed over the result. Re-encoding
// happens only where it must.
//
//   node scripts/tutorial/cards.mjs
//
// Output: .tutorial-out/nodus-tutorial-en-final.mp4 (+ subtitled variant)

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const run = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
/** Which deck to wrap; each has its own title card and output tree. */
const deck = process.argv.find((a) => a.startsWith('--deck='))?.slice('--deck='.length) ?? 'intro';
const OUT = path.join(repoRoot, '.tutorial-out', deck);
const CARDS = path.join(OUT, 'cards');
const NAME = `nodus-tutorial-${deck}-en`;
const SUBS_NAME = `nodus-tutorial-${deck}`;
const { TITLE: TITLE_TEXT, END_CARD } = await import(`../decks/${deck}/shots.mjs`);

const W = 1920;
const H = 1080;
/**
 * The card is designed at 1920x1080 but rendered on a smaller stage, because a
 * window taller than the display gets clamped: asking for 1080 produced a 1003px
 * viewport with a scrollbar, which would then have been stretched back to 16:9.
 * At this size the 2x pixel ratio still yields 2560x1440 to downscale from.
 */
const STAGE_W = 1280;
const STAGE_H = 720;
const STAGE_SCALE = STAGE_W / W;
const FPS = 30;
const TITLE_SECONDS = 5;
const END_SECONDS = 8;

/** Held quiet and steady, and pulled further down whenever the narrator speaks. */
/**
 * Where the background bed comes from, in order of preference:
 *   1. NODUS_TUTORIAL_MUSIC (an explicit path)
 *   2. the first audio file in scripts/tutorial/music/
 *   3. ~/Desktop/Quiet Dashboard Glow.mp3, where the first videos took it from
 *
 * The audio itself is not in the repository — see music/README.md.
 */
const musicDir = path.join(repoRoot, 'scripts', 'tutorial', 'music');
const MUSIC_FILE = process.env.NODUS_TUTORIAL_MUSIC
  ?? (existsSync(musicDir)
    ? readdirSync(musicDir).filter((f) => /\.(mp3|m4a|wav|aac)$/i.test(f)).map((f) => path.join(musicDir, f))[0]
    : undefined)
  ?? path.join(os.homedir(), 'Desktop', 'Quiet Dashboard Glow.mp3');
const MUSIC_GAIN = 0.16;

const main = path.join(OUT, `${NAME}.mp4`);
if (!existsSync(main)) throw new Error('Run assemble.mjs first — this stage wraps its output.');
await mkdir(CARDS, { recursive: true });

const logoSvg = await readFile(path.join(repoRoot, 'site', 'assets', 'nodus-logo.svg'), 'utf8');

// Google's fonts are what the site uses; if the machine is offline the cards fall
// back to system faces rather than failing to render.
const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap');
`;

const BASE = `
${FONTS}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${STAGE_W}px; height: ${STAGE_H}px; overflow: hidden; }
body {
  background: #ffffff;
  /* Lay the card out at full size, then shrink the whole stage to fit. */
  width: ${W}px; height: ${H}px;
  transform: scale(${STAGE_SCALE}); transform-origin: top left;
  display: grid; place-items: center;
  font-family: Inter, -apple-system, system-ui, sans-serif;
  color: #17132b;
  /* A whisper of the dark card's starfield, inverted for a light background. */
  background-image:
    radial-gradient(circle at 12% 18%, rgba(124,58,237,.10) 0 2px, transparent 3px),
    radial-gradient(circle at 22% 42%, rgba(124,58,237,.07) 0 2px, transparent 3px),
    radial-gradient(circle at 8% 66%, rgba(124,58,237,.06) 0 2px, transparent 3px),
    radial-gradient(circle at 88% 24%, rgba(124,58,237,.08) 0 2px, transparent 3px),
    radial-gradient(circle at 94% 58%, rgba(124,58,237,.06) 0 2px, transparent 3px),
    radial-gradient(circle at 78% 82%, rgba(124,58,237,.07) 0 2px, transparent 3px);
}
.wrap { display: flex; flex-direction: column; align-items: center; }
.mark { width: 132px; height: 132px; }
.wordmark {
  margin-top: 18px;
  font-weight: 700; font-size: 44px; letter-spacing: .34em;
  text-indent: .34em; color: #17132b;
}
`;

const titleHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
.title {
  margin-top: 54px;
  font-family: Fraunces, Georgia, serif;
  font-weight: 600; font-size: 62px; letter-spacing: -.01em; color: #2a2145;
}
.rule { margin-top: 34px; width: 96px; height: 4px; border-radius: 2px;
  background: linear-gradient(90deg, #ddd6fe, #7c3aed); }
</style></head><body>
  <div class="wrap">
    <div class="mark">${logoSvg}</div>
    <div class="wordmark">NODUS</div>
    <div class="title">${TITLE_TEXT}</div>
    <div class="rule"></div>
  </div>
</body></html>`;

const endHtml = END_CARD ? `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
.title { margin-top: 48px; font-size: 52px; font-weight: 600; }
.destination { margin-top: 28px; font-size: 32px; color: #7c3aed; }
.detail { margin-top: 28px; font-size: 23px; color: #4b4266; }
</style></head><body><div class="wrap"><div class="mark">${logoSvg}</div>
<div class="wordmark">NODUS</div><div class="title">${END_CARD.title}</div>
<div class="destination">${END_CARD.destination}</div><div class="detail">${END_CARD.detail}</div>
</div></body></html>` : `<!doctype html><html><head><meta charset="utf-8"><style>${BASE}
.tagline { margin-top: 44px; text-align: center;
  font-family: Fraunces, Georgia, serif; font-weight: 700; font-size: 66px; line-height: 1.22; }
.tagline .accent { color: #7c3aed; }
.url { margin-top: 40px; font-size: 25px; font-weight: 600; color: #4b4266; letter-spacing: .01em; }
.avail { margin-top: 46px; font-size: 15px; font-weight: 700; letter-spacing: .3em;
  text-indent: .3em; color: #8b84a3; }
.badges { margin-top: 20px; display: flex; gap: 22px; }
.badge {
  display: flex; align-items: center; gap: 14px;
  padding: 20px 34px; border-radius: 18px;
  background: #f6f5fa; border: 1px solid #e3e0ec;
  font-size: 27px; font-weight: 600; color: #17132b;
}
.badge svg { width: 30px; height: 30px; fill: #17132b; }
</style></head><body>
  <div class="wrap">
    <div class="mark">${logoSvg}</div>
    <div class="wordmark">NODUS</div>
    <div class="tagline">
      <div><span class="accent">Research</span> deeper</div>
      <div><span class="accent">Teach</span> smarter</div>
      <div><span class="accent">Study</span> better</div>
    </div>
    <div class="url">https://nodusresearch.com</div>
    <div class="avail">AVAILABLE ON</div>
    <div class="badges">
      <div class="badge">
        <svg viewBox="0 0 24 24"><path d="M16.4 12.8c0-2.2 1.8-3.3 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.5 0-2.8.8-3.6 2.1-1.5 2.7-.4 6.6 1.1 8.8.7 1.1 1.6 2.2 2.7 2.2 1.1 0 1.5-.7 2.8-.7 1.3 0 1.6.7 2.8.7 1.2 0 1.9-1.1 2.6-2.1.8-1.2 1.2-2.4 1.2-2.5-.1 0-2.2-.9-2.2-3.5zM14.3 5.6c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.6-1.1 1.7-.9 2.6 1 .1 2-.5 2.6-1.2z"/></svg>
        macOS
      </div>
      <div class="badge">
        <svg viewBox="0 0 24 24"><path d="M3 5.4l7.3-1v7.1H3V5.4zm0 13.2l7.3 1v-7H3v6zM11.4 4.2L21 3v8.5h-9.6V4.2zm0 8.4H21V21l-9.6-1.3v-7.1z"/></svg>
        Windows
      </div>
      <div class="badge">
        <svg viewBox="0 0 24 24">
          <path d="M8.4 19.6c-.7 1-.1 1.9 1.1 1.7l2.5-.5-1.9-2zM15.6 19.6c.7 1 .1 1.9-1.1 1.7l-2.5-.5 1.9-2z" fill="#f0a132"/>
          <ellipse cx="12" cy="13.4" rx="6.6" ry="7.8"/>
          <ellipse cx="12" cy="14" rx="4" ry="6" fill="#ffffff"/>
          <circle cx="12" cy="5.6" r="4.1"/>
          <circle cx="10.5" cy="5.2" r=".95" fill="#ffffff"/>
          <circle cx="13.5" cy="5.2" r=".95" fill="#ffffff"/>
          <path d="M10.7 7.5h2.6L12 9.2z" fill="#f0a132"/>
        </svg>
        Linux
      </div>
    </div>
  </div>
</body></html>`;

// ------------------------------------------------------------------ render
const titleFile = path.join(CARDS, 'title.html');
const endFile = path.join(CARDS, 'end.html');
await writeFile(titleFile, titleHtml, 'utf8');
await writeFile(endFile, endHtml, 'utf8');

const titlePng = path.join(CARDS, 'title.png');
const endPng = path.join(CARDS, 'end.png');

{
  // A blank Electron window is used purely as a renderer here: it gives the same
  // engine the app is drawn with, so the cards match the product visually.
  const userData = path.join(CARDS, 'profile');
  await rm(userData, { recursive: true, force: true });
  const env = { ...process.env, NODUS_USERDATA: userData, NODUS_DISABLE_AUTO_UPDATE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require('electron'), args: [repoRoot], env });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setContentSize(size.w, size.h);
    }, { w: STAGE_W, h: STAGE_H });
    for (const [file, png] of [[titleFile, titlePng], [endFile, endPng]]) {
      await page.goto(`file://${file}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1200); // let the web fonts settle
      await page.screenshot({ path: png, clip: { x: 0, y: 0, width: STAGE_W, height: STAGE_H } });
      console.log(`[cards] rendered ${path.basename(png)}`);
    }
  } finally {
    await app.close().catch(() => {});
    await rm(userData, { recursive: true, force: true }).catch(() => {});
  }
}

// ------------------------------------------------------------------- clips
const still = async (png, seconds, dest, fadeIn, fadeOut) => {
  const filters = [`scale=${W}:${H}`, 'format=yuv420p'];
  if (fadeIn) filters.unshift(`fade=t=in:st=0:d=0.7`);
  if (fadeOut) filters.push(`fade=t=out:st=${(seconds - 0.8).toFixed(2)}:d=0.8`);
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-loop', '1', '-t', String(seconds), '-i', png,
    '-vf', filters.join(','),
    '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    dest,
  ]);
};

const titleClip = path.join(CARDS, 'title.mp4');
const endClip = path.join(CARDS, 'end.mp4');
await still(titlePng, TITLE_SECONDS, titleClip, true, true);
await still(endPng, END_SECONDS, endClip, true, true);

// The cards carry no sound of their own; silence keeps the concat streams uniform.
const withSilence = async (clip, dest) => {
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', clip, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', dest,
  ]);
};
const titleAV = path.join(CARDS, 'title-av.mp4');
const endAV = path.join(CARDS, 'end-av.mp4');
await withSilence(titleClip, titleAV);
await withSilence(endClip, endAV);

// ------------------------------------------------------------------ concat
// Re-encoding the whole thing once here is what lets the cards keep the exact
// codec parameters of the tutorial; the tutorial's own frames are untouched work.
const listFile = path.join(CARDS, 'sequence.txt');
await writeFile(listFile, [titleAV, main, endAV].map((f) => `file '${f}'`).join('\n'), 'utf8');
const joined = path.join(CARDS, 'joined.mp4');
await run('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
  '-c', 'copy',
  joined,
]);

const durationOf = async (f) => {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]);
  return Number.parseFloat(stdout.trim());
};
const total = await durationOf(joined);
console.log(`[cards] joined: ${total.toFixed(2)}s (title ${TITLE_SECONDS}s + tutorial + end ${END_SECONDS}s)`);

// ------------------------------------------------------------------- music
const finalFile = path.join(OUT, `${NAME}-final.mp4`);
if (!existsSync(MUSIC_FILE)) {
  console.warn(`[cards] music not found at ${MUSIC_FILE} — writing the cut without a bed`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', joined, '-c', 'copy', '-movflags', '+faststart', finalFile]);
} else {
  /**
   * The bed sits under the voice and is never allowed to compete with it.
   *
   * A fixed low volume is not enough on its own: quiet passages of the music still
   * bloom under a soft line of narration. `sidechaincompress` keyed on the voice
   * pulls the music down whenever the narrator speaks and lets it return in the
   * gaps, which is how this is done properly rather than by guessing a level.
   */
  // The bed is built by crossfading copies of the track into each other rather than
  // looping it. `aloop` would butt the end against the beginning at 3:24 — right in
  // the middle of the tutorial — and that seam is audible as a lurch, which is
  // exactly the kind of change a background bed must never make.
  const musicDuration = await durationOf(MUSIC_FILE);
  const copies = Math.max(2, Math.ceil(total / Math.max(1, musicDuration - 4)) + 1);
  const XF = 4;

  const chain = [];
  let prev = '[1:a]';
  for (let i = 2; i <= copies; i++) {
    const label = i === copies ? '[looped]' : `[m${i}]`;
    chain.push(`${prev}[${i}:a]acrossfade=d=${XF}:c1=tri:c2=tri${label}`);
    prev = label;
  }

  const filter = [
    ...chain,
    `[looped]atrim=0:${total.toFixed(3)},asetpts=N/SR/TB,volume=${MUSIC_GAIN},` +
      `afade=t=in:st=0:d=2.5,afade=t=out:st=${(total - 3).toFixed(3)}:d=3[bed]`,
    // Keep a clean copy of the voice to key the compressor with.
    `[0:a]asplit=2[voice][key]`,
    `[bed][key]sidechaincompress=threshold=0.02:ratio=12:attack=15:release=500:makeup=1[ducked]`,
    `[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]`,
  ].join(';');

  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', joined,
    ...Array.from({ length: copies }, () => ['-i', MUSIC_FILE]).flat(),
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[mix]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    finalFile,
  ]);
  console.log(`[cards] music bed mixed (gain ${MUSIC_GAIN}, ducked under the voice)`);
}

// --------------------------------------------------------------- subtitles
// Every cue now starts TITLE_SECONDS later than it did.
// Embed every subtitle track this deck has, as switchable `mov_text` streams.
//
// Not burnt in: burning needs ffmpeg's `subtitles` filter, which exists only in
// builds linked against libass — Homebrew's is not — so a burn-in step would fail
// on an ordinary machine. Text tracks need no extra library and let the viewer
// choose. The files come from subtitles.mjs, already shifted by the title card, so
// the offset lives in exactly one place instead of being reapplied here.
const { LANGUAGES } = await import(`../decks/${deck}/captions.mjs`);
const ISO = { en: 'eng', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', 'pt-PT': 'por', 'pt-BR': 'por', tr: 'tur', ru: 'rus', uk: 'ukr', ja: 'jpn', 'zh-Hans': 'zho' };

const langs = LANGUAGES
  .map((l) => ({ ...l, file: path.join(OUT, 'subtitles', 'youtube', `${SUBS_NAME}.${l.youtube}.vtt`) }))
  .filter((l) => existsSync(l.file));

if (langs.length) {
  const subbed = path.join(OUT, `${NAME}-final-subtitled.mp4`);
  const args = ['-y', '-loglevel', 'error', '-i', finalFile];
  for (const l of langs) args.push('-i', l.file);
  args.push('-map', '0:v', '-map', '0:a');
  langs.forEach((_, i) => args.push('-map', String(i + 1)));
  args.push('-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text');
  langs.forEach((l, i) => {
    args.push(`-metadata:s:s:${i}`, `language=${ISO[l.youtube] ?? 'und'}`);
    args.push(`-metadata:s:s:${i}`, `title=${l.label}`);
  });
  args.push('-movflags', '+faststart', subbed);
  await run('ffmpeg', args);
  console.log(`[cards] ${path.relative(repoRoot, subbed)} — tracks: ${langs.map((l) => l.label).join(', ')}`);
} else {
  console.log('[cards] no subtitle files found — run subtitles.mjs first');
}

console.log(`[cards] ${path.relative(repoRoot, finalFile)} · ${(await durationOf(finalFile)).toFixed(2)}s`);
