// Step 3 of the tutorial pipeline: cut the frames into a finished video.
//
// Two ideas carry the whole stage.
//
// The camera is a crop, not a zoom. The master is captured at twice the output
// resolution, so pushing in on a button means cropping a smaller rectangle out of
// real pixels and scaling it up to 1080p — genuinely sharp, where an in-app zoom
// would have re-laid-out the interface instead of moving the camera.
//
// Each shot is rendered as its own clip and then concatenated. Screencast frames
// arrive only when the picture changes, so timing is rebuilt from the recorded
// arrival times via ffmpeg's concat demuxer, and each clip is trimmed to exactly
// its narration length. That is what keeps the picture locked to the voice: a shot
// can overrun during capture without dragging everything after it out of sync.
//
//   node scripts/tutorial/assemble.mjs

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** Which deck to assemble. Each writes to .tutorial-out/<deck>. */
const deck = process.argv.find((a) => a.startsWith('--deck='))?.slice('--deck='.length) ?? 'intro';
const OUT = path.join(repoRoot, '.tutorial-out', deck);
const CLIPS = path.join(OUT, 'clips');
const NAME = `nodus-tutorial-${deck}-en`;

const OUT_W = 1920;
const OUT_H = 1080;
const FPS = 30;
/**
 * How tight the camera is allowed to get, as a fraction of the master width.
 * Kept fairly loose on purpose: a hard push-in onto one control loses the context
 * that makes the shot legible, and from a 2x master there is no sharpness to gain
 * below about two thirds.
 */
const MIN_CROP = 0.66;
/**
 * How much the framing drifts back toward the middle of the screen. Centring
 * strictly on the target puts a corner element — Nodi sits bottom-right — hard
 * against the frame edge with dead space beside it; a partial pull to centre keeps
 * the subject in shot and the app recognisable around it.
 */
const CENTRE_BIAS = 0.34;
/** Seconds of easing in and out of a camera move. */
const EASE = 0.9;

const timeline = JSON.parse(await readFile(path.join(OUT, 'timeline.json'), 'utf8'));
const narration = JSON.parse(await readFile(path.join(OUT, 'narration.json'), 'utf8'));
const { frameSize, cssToFrame, frames, shots } = timeline;

if (!frames.length) throw new Error('No frames were captured — re-run record.mjs.');

await rm(CLIPS, { recursive: true, force: true });
await mkdir(CLIPS, { recursive: true });

/**
 * The 16:9 rectangle the camera holds for a shot, in master-frame pixels.
 * A wide shot is the whole frame; a focused shot is the smallest 16:9 box that
 * still contains the target with breathing room, clamped so it stays on screen.
 */
function cropFor(focus) {
  const FW = frameSize.width;
  const FH = frameSize.height;
  if (!focus) return { x: 0, y: 0, w: FW, h: FH };

  // CSS pixels to frame pixels.
  const fx = focus.x * cssToFrame;
  const fy = focus.y * cssToFrame;
  const fw = focus.width * cssToFrame;
  const fh = focus.height * cssToFrame;

  // The breathing room around the target has to scale inversely with the target.
  // A fixed generous margin is right for a button — cropping tight to one reads as
  // a glitch — but applied to a settings card that already spans the content area
  // it overflows the frame, clamps to full width, and the shot silently stops
  // zooming at all. That is why several Settings beats looked like wide shots even
  // once their target was found.
  const frac = Math.max(fw / FW, fh / FH);
  const PAD = frac > 0.6 ? 1.06 : frac > 0.3 ? 1.3 : 1.9;
  let w = Math.max(fw * PAD, (fh * PAD * FW) / FH);
  w = Math.min(FW, Math.max(FW * MIN_CROP, w));
  let h = (w * FH) / FW;
  if (h > FH) {
    h = FH;
    w = (h * FW) / FH;
  }

  // Aim at the target, drift partway back to the middle of the screen, then push
  // the box inside the frame.
  const cx = fx + fw / 2 + (FW / 2 - (fx + fw / 2)) * CENTRE_BIAS;
  const cy = fy + fh / 2 + (FH / 2 - (fy + fh / 2)) * CENTRE_BIAS;
  let x = cx - w / 2;
  let y = cy - h / 2;
  x = Math.min(Math.max(0, x), FW - w);
  y = Math.min(Math.max(0, y), FH - h);

  // Even dimensions keep the H.264 encoder happy.
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { x: even(x), y: even(y), w: even(w), h: even(h) };
}

/** An ffconcat list reproducing the real frame timing inside one shot. */
async function concatListFor(start, end, dest, maxFrames = Infinity) {
  const inRange = frames.filter((f) => f.t >= start && f.t < end);
  // A completely static shot emits no new frames; hold the last one before it.
  const before = [...frames].reverse().find((f) => f.t <= start) ?? frames[0];
  let seq = inRange.length ? [before, ...inRange] : [before];
  // Time-compressed waits only need the frames that can reach the output.
  // Sample before decoding, retaining both boundaries and real frame timestamps.
  if(seq.length>maxFrames){
    const sampled=[seq[0]];let cursor=0;
    for(let tick=1;tick<maxFrames-1;tick++){
      const at=start+(end-start)*tick/(maxFrames-1);
      while(cursor+1<seq.length&&seq[cursor+1].t<=at)cursor++;
      if(sampled.at(-1)!==seq[cursor])sampled.push(seq[cursor]);
    }
    if(sampled.at(-1)!==seq.at(-1))sampled.push(seq.at(-1));
    console.log(`[assemble] compressed wait: ${seq.length} real frames sampled to ${sampled.length}`);
    seq=sampled;
  }

  const lines = ['ffconcat version 1.0'];
  // Hold the final frame so the list always spans the full window asked for. If the
  // recorded shot came up short, the clip would otherwise be briefer than its
  // narration and every later beat would slip — which is what makes it safe to
  // re-synthesise one line without re-recording.
  for (let i = 0; i < seq.length; i++) {
    const from = Math.max(seq[i].t, start);
    const to = i + 1 < seq.length ? Math.max(seq[i + 1].t, start) : end;
    // No frame-length floor here. Rounding every gap up to 1/fps looks harmless but
    // the screencast delivers bursts at ~50fps, so each 0.02s gap became 0.033s and
    // the reconstructed clip ran ~50% long — then `-t` cut the tail off, which is
    // why typing and menus appeared late or never arrived within a shot.
    const dur = Math.max(0.001, to - from);
    lines.push(`file '${seq[i].file.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${dur.toFixed(5)}`);
  }
  // The concat demuxer drops the final entry's duration unless the file is repeated.
  lines.push(`file '${seq.at(-1).file.replace(/'/g, "'\\''")}'`);
  await writeFile(dest, lines.join('\n'), 'utf8');
  return seq.length;
}

const clipFiles = [];
let index = 0;
for (const shot of shots) {
  const cue = narration.cues.find((c) => c.id === shot.id);
  if (!cue) continue;
  const listFile = path.join(CLIPS, `${shot.id}.ffconcat`);
  const clip = path.join(CLIPS, `${String(index).padStart(3, '0')}-${shot.id}.mp4`);

  // Normally we film the narration length out of the captured span and drop the
  // overrun. A timelapse shot inverts that: the whole span is kept and squeezed
  // into the narration, because the point of the shot is that the work really took
  // that long. The voice says as much, so speeding it up is honest rather than a
  // sleight of hand.
  const span = shot.end - shot.start;
  const useFor = shot.timelapse ? span : Math.min(cue.duration, span);
  const speedUp = shot.timelapse ? span / cue.duration : 1;
  const frameCount = await concatListFor(shot.start, shot.start + useFor, listFile,shot.timelapse&&speedUp>2?Math.ceil(cue.duration*FPS*2)+2:Infinity);
  if (shot.timelapse) {
    console.log(`[assemble] ${shot.id}: ${span.toFixed(0)}s of real work → ${cue.duration.toFixed(1)}s (${speedUp.toFixed(1)}× faster)`);
  }

  const prev = cropFor(index > 0 ? shots[index - 1].focus : null);
  const now = cropFor(shot.focus);
  const moved = prev.x !== now.x || prev.y !== now.y || prev.w !== now.w;

  // The camera eases from where the previous shot left the frame to this shot's
  // target; a held shot is a constant framing.
  //
  // This has to be `zoompan`, not `crop`. The crop filter evaluates its width and
  // height once when the filter graph is configured — only x and y are per-frame —
  // so a crop-based "zoom" silently renders at a fixed size and nothing moves.
  // zoompan re-evaluates z, x and y for every frame and emits a fixed output size,
  // which is exactly a camera. Its zoom is expressed relative to the input, so a
  // crop width of w means z = frameWidth / w.
  const zOf = (rect) => frameSize.width / rect.w;
  const p = `min(1,(on/${(EASE * FPS).toFixed(2)}))`;
  const ease = `(${p}*${p}*(3-2*${p}))`; // smoothstep: no visible start/stop jolt
  const lerp = (a, b) => (moved ? `(${a.toFixed(4)}+(${b.toFixed(4)}-${a.toFixed(4)})*${ease})` : b.toFixed(4));
  const filter = [
    // setpts first: compressing the timeline before resampling to a constant frame
    // rate is what turns a half-hour scan into a few seconds of watchable motion.
    ...(shot.timelapse ? [`setpts=PTS/${speedUp.toFixed(4)}`] : []),
    `fps=${FPS}`,
    `zoompan=z='${lerp(zOf(prev), zOf(now))}':x='${lerp(prev.x, now.x)}':y='${lerp(prev.y, now.y)}'` +
      `:d=1:s=${OUT_W}x${OUT_H}:fps=${FPS}`,
    'format=yuv420p',
  ].join(',');

  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', filter,
    '-t', cue.duration.toFixed(3),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
    '-r', String(FPS), '-pix_fmt', 'yuv420p',
    clip,
  ]);
  clipFiles.push(clip);
  console.log(
    `[assemble] ${shot.id.padEnd(20)} ${useFor.toFixed(2)}s · ${frameCount} src frames · ` +
    `${shot.focus ? `zoom ${(now.w / frameSize.width).toFixed(2)}x` : 'wide'}${moved ? ' (move)' : ''}`
  );
  index++;
}

const concatFile = path.join(CLIPS, 'all.txt');
await writeFile(concatFile, clipFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');

const silent = path.join(OUT, 'picture.mp4');
await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', silent]);

const finalFile = path.join(OUT, `${NAME}.mp4`);
const track = path.join(OUT, 'narration.wav');
if (!existsSync(track)) throw new Error('narration.wav is missing — run narrate.mjs.');
await run('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-i', silent, '-i', track,
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
  '-shortest', '-movflags', '+faststart',
  finalFile,
]);

const { stdout } = await run('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=noprint_wrappers=1', finalFile,
]);
console.log(`\n[assemble] ${clipFiles.length} clips joined`);
console.log(stdout.trim());
console.log(`[assemble] ${path.relative(repoRoot, finalFile)}`);

// A second copy carrying the subtitles as a real, switchable text track.
//
// Not burnt in: burning needs ffmpeg's `subtitles` filter, which only exists in
// builds linked against libass — Homebrew's is not, so a burn-in step would fail
// on a perfectly normal machine. A `mov_text` track needs no extra library, stays
// toggleable, and is how the remaining eleven languages will ship: one track each,
// in this same file.
const vtt = path.join(OUT, 'subtitles', `${deck === 'intro' ? 'nodus-tutorial' : `nodus-tutorial-${deck}`}.en.vtt`);
if (existsSync(vtt)) {
  const subbedFile = path.join(OUT, `${NAME}-subtitled.mp4`);
  await run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', finalFile, '-i', vtt,
    '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text',
    '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English',
    '-movflags', '+faststart',
    subbedFile,
  ]);
  console.log(`[assemble] ${path.relative(repoRoot, subbedFile)} (switchable English subtitle track)`);
} else {
  console.log('[assemble] no English .vtt yet — run subtitles.mjs for a subtitled copy');
}
