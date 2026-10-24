// Text↔audio sync for narration (shared/narrationSync.ts): silences found in real PCM, word
// timings anchored on them, the highlight granularity each playback rate gets, and the
// alignment of what the engine spoke with what the reader shows. The module is pure, so it is
// bundled with esbuild and its REAL functions are imported, together with the narration text
// pipeline (electron/audio/speakable.ts) whose output it has to align.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-narration-sync-test-'));
const bundle = async (entry, name) => {
  const outfile = path.join(tmp, name);
  await build({ entryPoints: [path.join(repoRoot, entry)], outfile, bundle: true, format: 'esm', platform: 'node', external: ['@shared/*'], logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
};
const sync = await bundle('shared/narrationSync.ts', 'narrationSync.mjs');
const speakable = await bundle('electron/audio/speakable.ts', 'speakable.mjs');
// The main-process side resolves `@shared/*` like the app does.
const sharedAlias = { name: 'shared-alias', setup(b) { b.onResolve({ filter: /^@shared\// }, (args) => ({ path: path.join(repoRoot, 'shared', `${args.path.slice('@shared/'.length)}.ts`) })); } };
const mainSync = await (async () => {
  const outfile = path.join(tmp, 'fragmentSync.mjs');
  await build({ entryPoints: [path.join(repoRoot, 'electron/tts/fragmentSync.ts')], outfile, bundle: true, format: 'esm', platform: 'node', plugins: [sharedAlias], logLevel: 'silent' });
  return import(pathToFileURL(outfile).href);
})();
const wav = await bundle('electron/tts/wavConcat.ts', 'wavConcat.mjs');
test.after(() => rm(tmp, { recursive: true, force: true }));

const RATE = 24000;
/** PCM16 made of `[seconds, loud]` pieces: a 220 Hz tone for speech, zeros for silence. */
function pcm(pieces, noise = 0) {
  const total = pieces.reduce((sum, [seconds]) => sum + Math.round(seconds * RATE), 0);
  const samples = new Int16Array(total);
  let at = 0;
  let seed = 7;
  for (const [seconds, loud] of pieces) {
    const count = Math.round(seconds * RATE);
    for (let i = 0; i < count; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const hiss = noise ? ((seed / 0x7fffffff) * 2 - 1) * noise : 0;
      samples[at + i] = Math.round((loud ? Math.sin((2 * Math.PI * 220 * (at + i)) / RATE) * 9000 : 0) + hiss);
    }
    at += count;
  }
  return samples;
}

test('detectPauses finds inner and edge silences and ignores stop-consonant gaps', () => {
  const samples = pcm([[0.15, false], [1.2, true], [0.03, false], [0.8, true], [0.3, false], [1.0, true], [0.25, false]], 40);
  const pauses = sync.detectPauses(samples, RATE);
  assert.equal(pauses.length, 3, JSON.stringify(pauses));
  const [lead, inner, tail] = pauses;
  assert.ok(lead[0] === 0 && Math.abs(lead[1] - 0.15) <= 0.02, `leading silence ${lead}`);
  assert.ok(Math.abs(inner[0] - 2.18) <= 0.02 && Math.abs(inner[1] - 2.48) <= 0.02, `inner pause ${inner}`);
  assert.ok(Math.abs(tail[0] - 3.48) <= 0.02 && Math.abs(tail[1] - 3.73) <= 0.001, `trailing silence ${tail}`);
});

test('detectPauses keeps a pause whole across a click', () => {
  const samples = pcm([[1, true], [0.2, false], [0.01, true], [0.2, false], [1, true]]);
  const pauses = sync.detectPauses(samples, RATE);
  assert.equal(pauses.length, 1, JSON.stringify(pauses));
  assert.ok(pauses[0][1] - pauses[0][0] >= 0.39, `merged pause ${pauses[0]}`);
});

test('tokenizeSpoken splits words in Spanish, English and Japanese with boundary strength', () => {
  const es = sync.tokenizeSpoken('El régimen, según García, cambió. Después llegó 1936.', 'es');
  assert.deepEqual(es.map((token) => token.text), ['El', 'régimen', 'según', 'García', 'cambió', 'Después', 'llegó', '1936']);
  assert.deepEqual(es.map((token) => token.break), [0, 1, 0, 1, 2, 0, 0, 2]);
  assert.deepEqual(es.map((token) => token.sentence), [0, 0, 0, 0, 0, 1, 1, 1]);
  assert.ok(es[7].weight > es[0].weight, 'a number weighs more than a short word');
  const en = sync.tokenizeSpoken("It's the reader's choice.", 'en');
  assert.deepEqual(en.map((token) => token.text), ["It's", 'the', "reader's", 'choice']);
  const ja = sync.tokenizeSpoken('今日は良い天気です。散歩しましょう。', 'ja');
  assert.ok(ja.length >= 4, `Japanese words: ${ja.map((token) => token.text).join('|')}`);
  assert.equal(ja[ja.length - 1].sentence, 1);
});

test('estimateWordTimings is monotonic, inside the speech and anchored on real pauses', () => {
  const text = 'Primera frase con varias palabras. Segunda frase, con una coma y más palabras al final.';
  const pauses = [[0, 0.1], [2.0, 2.35], [3.4, 3.55], [6.0, 6.3]];
  const words = sync.estimateWordTimings({ text, durationS: 6.3, pauses, lang: 'es' });
  assert.equal(words.length, 15);
  for (let i = 0; i < words.length; i += 1) {
    assert.ok(words[i].end >= words[i].start, `word ${i} has a non-negative length`);
    if (i) assert.ok(words[i].start >= words[i - 1].end - 1e-6, `word ${i} starts after the previous one ends`);
  }
  assert.equal(words[0].start, 0.1, 'speech starts after the leading silence');
  assert.equal(words[words.length - 1].end, 6, 'speech ends before the trailing silence');
  const segunda = words.findIndex((word) => word.text === 'Segunda');
  assert.equal(words[segunda - 1].end, 2, 'the sentence end lands on the long pause');
  assert.equal(words[segunda].start, 2.35);
  const con = words.findIndex((word, index) => index > segunda && word.text === 'con');
  assert.equal(words[con - 1].end, 3.4, 'the comma lands on the short pause');
  assert.equal(words[con].start, 3.55);
});

test('estimateWordTimings without pauses spreads by syllables over the whole fragment', () => {
  const words = sync.estimateWordTimings({ text: 'uno extraordinariamente dos', durationS: 3 });
  assert.equal(words[0].start, 0);
  assert.equal(words[2].end, 3);
  assert.ok(words[1].end - words[1].start > 3 * (words[0].end - words[0].start), 'a long word takes longer');
  assert.deepEqual(sync.estimateWordTimings({ text: '', durationS: 3 }), []);
  assert.deepEqual(sync.estimateWordTimings({ text: 'hola', durationS: 0 }), []);
});

test('estimateWordTimings leaves breaths unpaired and survives bogus pauses', () => {
  const text = 'Una frase bastante larga sin comas que se dice de corrido hasta el punto final.';
  const words = sync.estimateWordTimings({ text, durationS: 5, pauses: [[2.5, 2.58], [9, 10], [3, 2]] });
  assert.equal(words.length, 15);
  assert.ok(words.every((word) => word.end <= 5 && word.start >= 0));
});

test('trackWordTimings and fragmentOffsets follow the layout of a saved clip', () => {
  const offsets = sync.fragmentOffsets([2, 3, 1.5], 0.12);
  assert.deepEqual(offsets, [0, 2.12, 5.24]);
  const fragments = [
    { offsetS: offsets[0], durationS: 2, text: 'Hola mundo.', pauses: [] },
    { offsetS: offsets[1], durationS: 3, text: 'Segunda parte del clip.', pauses: [] },
  ];
  const words = sync.trackWordTimings(fragments, 'es');
  assert.equal(words.length, 6);
  assert.equal(words[2].start, 2.12);
  assert.equal(words[2].fragment, 1);
  assert.equal(words[2].sentence, 1, 'sentence numbers continue across fragments');
  assert.equal(sync.wordAt(words, 2.05), 1, 'the gap keeps the previous word lit');
  assert.equal(sync.wordAt(words, 2.2), 2);
  assert.equal(sync.wordAt(words, -1), -1);
});

test('granularity adapts to the playback rate with hysteresis', () => {
  const wps = 2.8;
  assert.equal(sync.granularityFor(0.5, wps), 'word');
  assert.equal(sync.granularityFor(1, wps), 'word');
  assert.equal(sync.granularityFor(1.5, wps), 'word');
  assert.equal(sync.granularityFor(2, wps), 'phrase');
  assert.equal(sync.granularityFor(2, 5), 'sentence');
  assert.equal(sync.granularityFor(1.85, wps, 'word'), 'word', 'stays on words just past the threshold');
  assert.equal(sync.granularityFor(1.85, wps, 'phrase'), 'phrase', 'stays on phrases just under it');
  assert.ok(sync.leadS(2) > sync.leadS(1), 'the lead is constant on the listener clock');
});

test('phrase groups last long enough at the current rate and never cross a sentence', () => {
  const words = sync.estimateWordTimings({ text: 'Uno dos tres cuatro cinco seis. Siete ocho nueve diez once doce.', durationS: 4 });
  const slow = sync.phraseGroups(words, 1);
  const fast = sync.phraseGroups(words, 2);
  assert.ok(fast.length < slow.length, 'faster playback lights longer phrases');
  for (const group of fast) assert.equal(words[group.first].sentence, words[group.last].sentence);
  const unit = sync.unitSpan(words, 7, 'phrase', fast);
  assert.ok(unit.first <= 7 && unit.last >= 7);
  assert.deepEqual(sync.unitSpan(words, 7, 'sentence'), { first: 6, last: 11 });
  assert.deepEqual(sync.unitSpan(words, 7, 'word'), { first: 7, last: 7 });
});

const displayedWords = (text) => new sync.DisplayedWords(sync.wordSpans(text).map((span) => span.text));

test('alignSpoken matches what markdownToSpeech reads against what the reader shows', () => {
  const markdown = [
    '## El turismo como propaganda',
    '',
    'El turismo fue propaganda [(García, 2019)](nodus://idea/g-12) del régimen, y la fórmula $a/b$ lo resume.',
    '',
    '- Primer punto de la lista',
    '- Segundo punto',
  ].join('\n');
  const spoken = speakable.markdownToSpeech(markdown);
  // What the reader renders: the citation button keeps its label, the formula renders as text.
  const shown = 'El turismo como propaganda El turismo fue propaganda (García, 2019) del régimen, y la fórmula a/b lo resume. Primer punto de la lista Segundo punto';
  const displayed = displayedWords(shown);
  const spokenWords = sync.wordSpans(spoken).map((span) => span.text);
  const alignment = sync.alignSpoken(spokenWords, displayed, 0);
  const prose = spokenWords.filter((word) => !/dividido|entre|^a$|^b$/i.test(word)).length;
  assert.ok(alignment.matched / prose >= 0.9, `matched ${alignment.matched} of ${prose} prose words (${spoken})`);
  const regimen = spokenWords.findIndex((word) => word === 'régimen');
  assert.equal(displayed.words[alignment.map[regimen]], 'regimen');
  const garcia = displayed.words.indexOf('garcia');
  assert.ok(!Array.from(alignment.map).includes(garcia), 'the citation label is never matched');
});

test('alignSpoken relocates a passage far from the cursor and refuses text that is not shown', () => {
  const filler = Array.from({ length: 400 }, (_, i) => `palabra${i}`).join(' ');
  const shown = `${filler} El viajero llegó al puerto al amanecer y miró el mar. ${filler}`;
  const displayed = displayedWords(shown);
  const spoken = sync.wordSpans('El viajero llegó al puerto al amanecer y miró el mar.').map((span) => span.text);
  const found = sync.alignSpoken(spoken, displayed, 0);
  assert.equal(found.ratio, 1);
  assert.equal(found.map[0], 400);
  assert.equal(found.next, 400 + spoken.length);
  const sequel = sync.alignSpoken(spoken, displayed, found.next - spoken.length);
  assert.equal(sequel.map[0], 400, 'a cursor right before it aligns without relocating');
  const translated = sync.alignSpoken(sync.wordSpans('The traveller reached the harbour at dawn.').map((span) => span.text), displayed, 0);
  assert.ok(translated.ratio < sync.MIN_SENTENCE_MATCH, 'a translation of the shown text is not highlighted');
});

test('displayedSpan covers the matched words of a unit', () => {
  const displayed = displayedWords('uno dos tres cuatro');
  const alignment = sync.alignSpoken(['uno', 'dos', 'xx', 'cuatro'], displayed, 0);
  assert.deepEqual(sync.displayedSpan(alignment, 0, 3), { first: 0, last: 3 });
  assert.equal(sync.displayedSpan(alignment, 2, 2), null);
});

test('an open-ended narration waits once it is far enough ahead of the listener', () => {
  assert.equal(sync.shouldWaitForListener(100, 0), false);
  assert.equal(sync.shouldWaitForListener(200, 0), true);
  assert.equal(sync.shouldWaitForListener(200, 30), false);
  assert.equal(sync.shouldWaitForListener(50, 0, 30), true);
});

test('main reads the silences of real WAV fragments and of the clip they are joined into', async () => {
  const toWav = (samples) => wav.wavFromPcm(RATE, 1, 16, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  const first = toWav(pcm([[1, true], [0.3, false], [1, true]]));
  const second = toWav(pcm([[1.5, true]]));
  const inner = mainSync.pausesOfWav(first);
  assert.equal(inner.length, 1);
  assert.ok(Math.abs(inner[0][0] - 1) <= 0.02 && Math.abs(inner[0][1] - 1.3) <= 0.02, `fragment pause ${inner[0]}`);
  assert.deepEqual(mainSync.pausesOfWav(Buffer.from('RIFF')), [], 'a broken file has no pauses instead of failing');
  // An odd byte offset (a pooled Buffer) must not throw on the Int16Array view.
  const shifted = Buffer.concat([Buffer.alloc(1), first]).subarray(1);
  assert.equal(mainSync.pausesOfWav(shifted).length, 1);

  const firstPath = path.join(tmp, 'f000.wav');
  const secondPath = path.join(tmp, 'f001.wav');
  await writeFile(firstPath, first);
  await writeFile(secondPath, second);
  const clip = await wav.concatWavFiles([firstPath, secondPath]);
  const map = mainSync.clipSyncFor([
    { durationS: 2.3, text: 'Primera parte, con pausa.', pauses: inner },
    { durationS: 1.5, text: 'Segunda parte.', pauses: [] },
  ]);
  assert.equal(map.gapS, wav.CLIP_FRAGMENT_GAP_MS / 1000);
  assert.deepEqual(map.fragments.map((fragment) => fragment.offsetS), [0, 2.42]);
  const clipPauses = mainSync.pausesOfWav(clip);
  const gap = clipPauses.find(([start]) => Math.abs(start - 2.3) <= 0.02);
  assert.ok(gap && Math.abs(gap[1] - map.fragments[1].offsetS) <= 0.02, `the joining silence ends where the map says the second fragment starts (${JSON.stringify(clipPauses)})`);
  const words = sync.trackWordTimings(map.fragments, 'es');
  assert.equal(words.find((word) => word.text === 'Segunda').start, 2.42);
});
