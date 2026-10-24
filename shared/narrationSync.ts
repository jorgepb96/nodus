// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Text↔audio sync for narration, the way read-along apps do it: times in seconds of audio,
 * looked up against `audio.currentTime`. None of Nodus's engines reports word timings, so
 * they are estimated: the real silences of each fragment (found in its PCM) anchor the
 * punctuation they fall on, and the words between two anchors share that stretch in
 * proportion to their syllables. The error stays inside one clause.
 *
 * Times are in seconds of the WAV, which Nodus always synthesises at natural speed, so they
 * hold at every playback rate: `currentTime` already advances `playbackRate` times faster.
 * The rate only decides how much text is worth highlighting at once.
 *
 * Pure: no DOM and no Node, so main, renderer and `node --test` share it.
 */

/** A silent stretch of a fragment, `[start, end]` in seconds. */
export type Pause = [number, number];

/** What a fragment's sync is built from: facts about the audio, not estimated words, so a
 *  better estimator never needs the audio regenerated. */
export interface SyncFragment {
  /** Where the fragment starts inside its track (0 for a live fragment). */
  offsetS: number;
  durationS: number;
  /** The text the engine spoke. Empty when unknown (old clips). */
  text: string;
  pauses: Pause[];
}

/** Stored next to a saved clip as `<file>.sync.json`. */
export interface ClipSync {
  version: 1;
  /** Silence `concatWavFiles` put between fragments. */
  gapS: number;
  fragments: SyncFragment[];
}

export interface SpokenToken {
  text: string;
  /** Offsets in the source text. */
  start: number;
  end: number;
  /** Strength of the boundary after the word: 0 none, 1 clause, 2 sentence or paragraph. */
  break: 0 | 1 | 2;
  sentence: number;
  /** Relative speaking time, roughly syllables. */
  weight: number;
}

export interface TimedWord {
  text: string;
  start: number;
  end: number;
  charStart: number;
  charEnd: number;
  sentence: number;
  break: 0 | 1 | 2;
  /** Fragment the word belongs to, within its track. */
  fragment: number;
}

export type HighlightGranularity = 'word' | 'phrase' | 'sentence';

// ── Pauses ───────────────────────────────────────────────────────────────────

const FRAME_S = 0.01;
const MIN_PAUSE_S = 0.08;

/**
 * Silent stretches of a mono PCM16 fragment, leading and trailing silence included (they
 * tell where speech starts and ends). A frame is silent below a share of the loud frames'
 * level, so the threshold follows each voice; one or two loud frames inside a pause (a click,
 * a breath) do not split it.
 */
export function detectPauses(samples: Int16Array, sampleRate: number): Pause[] {
  if (!(sampleRate > 0) || !samples.length) return [];
  const frame = Math.max(1, Math.round(sampleRate * FRAME_S));
  const frames = Math.floor(samples.length / frame);
  if (frames < 3) return [];
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const base = f * frame;
    for (let i = 0; i < frame; i += 1) {
      const value = samples[base + i] / 32768;
      sum += value * value;
    }
    rms[f] = Math.sqrt(sum / frame);
  }
  const loud = Float32Array.from(rms).sort()[Math.floor(frames * 0.95)] ?? 0;
  if (loud <= 0) return [];
  const threshold = Math.max(loud * 0.05, 0.003);

  const runs: Array<[number, number]> = [];
  let runStart = -1;
  for (let f = 0; f <= frames; f += 1) {
    const silent = f < frames && rms[f] < threshold;
    if (silent && runStart < 0) runStart = f;
    else if (!silent && runStart >= 0) {
      const last = runs[runs.length - 1];
      // Up to two loud frames between silent runs belong to the same pause.
      if (last && runStart - last[1] <= 2) last[1] = f;
      else runs.push([runStart, f]);
      runStart = -1;
    }
  }
  const total = samples.length / sampleRate;
  const minFrames = Math.round(MIN_PAUSE_S / FRAME_S);
  const pauses: Pause[] = [];
  for (const [from, to] of runs) {
    const atEdge = from === 0 || to >= frames;
    if (to - from < (atEdge ? 2 : minFrames)) continue;
    const start = from * FRAME_S;
    const end = to >= frames ? total : to * FRAME_S;
    pauses.push([round3(start), round3(end)]);
  }
  return pauses;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

// ── Tokens ───────────────────────────────────────────────────────────────────

const SENTENCE_END = /[.!?…。！？؟]|\n/u;
const CLAUSE_BREAK = /[,;:—–()、，；：]/u;
const VOWEL_GROUP = /[aeiouyàáâãäåæèéêëìíîïòóôõöøœùúûüýÿāēīōūăĕĭŏŭąęįųαεηιουωάέήίόύώаеёиоуыэюяіїєѣ]+/giu;
const SYLLABIC_SCRIPT = /[぀-ヿ㐀-鿿豈-﫿가-힯]/gu;
const FALLBACK_WORD = /[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*/gu;

interface SegmenterLike { segment(text: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }> }
const segmenters = new Map<string, SegmenterLike | null>();

function wordSegmenter(lang: string | undefined): SegmenterLike | null {
  const key = lang ?? '';
  if (segmenters.has(key)) return segmenters.get(key) ?? null;
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => SegmenterLike }).Segmenter;
  let made: SegmenterLike | null = null;
  if (typeof Segmenter === 'function') {
    try { made = new Segmenter(lang || undefined, { granularity: 'word' }); } catch {
      try { made = new Segmenter(undefined, { granularity: 'word' }); } catch { made = null; }
    }
  }
  segmenters.set(key, made);
  return made;
}

/** Words of `text` with their offsets. The DOM side tokenizes with this same function, so
 *  spoken and displayed words split the same way in every language. */
export function wordSpans(text: string, lang?: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  if (!text) return out;
  const segmenter = wordSegmenter(lang);
  if (segmenter) {
    for (const part of segmenter.segment(text)) {
      if (part.isWordLike) out.push({ text: part.segment, start: part.index, end: part.index + part.segment.length });
    }
    return out;
  }
  for (const match of text.matchAll(FALLBACK_WORD)) {
    out.push({ text: match[0], start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return out;
}

/** Rough syllable count: vowel groups in alphabets, characters in syllabic scripts, digits
 *  as long (numbers are spoken as several words). */
export function syllableWeight(word: string): number {
  const syllabic = word.match(SYLLABIC_SCRIPT)?.length ?? 0;
  if (syllabic) return syllabic;
  const digits = word.match(/\p{Nd}/gu)?.length ?? 0;
  const letters = word.replace(/\p{Nd}/gu, '');
  const groups = letters.match(VOWEL_GROUP)?.length ?? 0;
  // Abjads and other scripts without vowel letters: about one syllable per 2.5 letters.
  const base = groups || (letters ? letters.length / 2.5 : 0);
  return Math.max(1, base + digits * 1.6);
}

export function tokenizeSpoken(text: string, lang?: string): SpokenToken[] {
  const spans = wordSpans(text, lang);
  const tokens: SpokenToken[] = [];
  let sentence = 0;
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    const between = text.slice(span.end, spans[i + 1]?.start ?? text.length);
    const strength: 0 | 1 | 2 = i === spans.length - 1 || SENTENCE_END.test(between) ? 2 : CLAUSE_BREAK.test(between) ? 1 : 0;
    tokens.push({ ...span, break: strength, sentence, weight: syllableWeight(span.text) + 0.25 });
    if (strength === 2) sentence += 1;
  }
  return tokens;
}

// ── Word timings ─────────────────────────────────────────────────────────────

const EDGE_S = 0.005;

function cleanPauses(pauses: readonly Pause[] | undefined, duration: number): Pause[] {
  if (!pauses?.length) return [];
  return pauses
    .filter((pause) => Array.isArray(pause) && Number.isFinite(pause[0]) && Number.isFinite(pause[1]))
    .map(([start, end]): Pause => [Math.max(0, Math.min(start, duration)), Math.max(0, Math.min(end, duration))])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
}

/** How much a pause looks like it belongs after a word with this boundary. */
function pauseBonus(strength: 0 | 1 | 2, length: number): number {
  if (strength === 2) return 1;
  if (strength === 1) return 0.85;
  return length >= 0.18 ? 0.45 : 0.2;
}
const DISTANCE_COST = 4;

/**
 * Pairs pauses with word boundaries, in order, maximising how well each pair fits: a
 * sentence end beats a comma, a comma beats a plain gap, and both lose to distance from
 * where the syllable count expects the boundary. A pause may stay unpaired (a breath, a
 * stop consonant) and so may a boundary (a comma read without a pause).
 */
function pairPauses(pausePos: number[], pauseLen: number[], slotPos: number[], slotBreak: Array<0 | 1 | 2>): Array<[number, number]> {
  const m = pausePos.length;
  const n = slotPos.length;
  if (!m || !n) return [];
  const width = n + 1;
  const dp = new Float64Array((m + 1) * width);
  const score = (p: number, s: number) => pauseBonus(slotBreak[s], pauseLen[p]) - DISTANCE_COST * Math.abs(pausePos[p] - slotPos[s]);
  for (let p = 1; p <= m; p += 1) {
    for (let s = 1; s <= n; s += 1) {
      const pair = score(p - 1, s - 1);
      dp[p * width + s] = Math.max(
        dp[(p - 1) * width + s],
        dp[p * width + s - 1],
        pair > 0 ? dp[(p - 1) * width + s - 1] + pair : -Infinity,
      );
    }
  }
  const pairs: Array<[number, number]> = [];
  let p = m;
  let s = n;
  while (p > 0 && s > 0) {
    const here = dp[p * width + s];
    if (here === dp[(p - 1) * width + s]) { p -= 1; continue; }
    if (here === dp[p * width + s - 1]) { s -= 1; continue; }
    pairs.push([p - 1, s - 1]);
    p -= 1;
    s -= 1;
  }
  return pairs.reverse();
}

export interface FragmentTimingInput {
  text: string;
  durationS: number;
  pauses?: readonly Pause[];
  lang?: string;
}

/** Start and end of every spoken word of one fragment, in seconds of that fragment. */
export function estimateWordTimings(input: FragmentTimingInput, fragment = 0): TimedWord[] {
  const tokens = tokenizeSpoken(input.text, input.lang);
  const duration = input.durationS;
  if (!tokens.length || !(duration > 0)) return [];
  const pauses = cleanPauses(input.pauses, duration);

  let speechStart = 0;
  let speechEnd = duration;
  const first = pauses[0];
  const last = pauses[pauses.length - 1];
  if (first && first[0] <= EDGE_S) speechStart = first[1];
  if (last && last[1] >= duration - EDGE_S && !(last === first && speechStart > 0)) speechEnd = last[0];
  if (speechEnd - speechStart < 0.05) { speechStart = 0; speechEnd = duration; }
  const inner = pauses.filter(([start, end]) => start > speechStart + 1e-3 && end < speechEnd - 1e-3);
  const silent = inner.reduce((sum, [start, end]) => sum + end - start, 0);
  const speech = speechEnd - speechStart - silent;

  const totalWeight = tokens.reduce((sum, token) => sum + token.weight, 0);
  let pairs: Array<[number, number]> = [];
  if (inner.length && speech > 0 && tokens.length > 1) {
    let removed = 0;
    const pausePos = inner.map(([start, end]) => {
      const position = (start - speechStart - removed) / speech;
      removed += end - start;
      return Math.max(0, Math.min(1, position));
    });
    const slotPos: number[] = [];
    let cumulative = 0;
    for (let i = 0; i < tokens.length - 1; i += 1) {
      cumulative += tokens[i].weight;
      slotPos.push(cumulative / totalWeight);
    }
    pairs = pairPauses(pausePos, inner.map(([start, end]) => end - start), slotPos, tokens.slice(0, -1).map((token) => token.break));
  }

  const words: TimedWord[] = [];
  const spread = (from: number, to: number, startTime: number, endTime: number) => {
    let weight = 0;
    for (let i = from; i <= to; i += 1) weight += tokens[i].weight;
    const perWeight = weight > 0 ? Math.max(0, endTime - startTime) / weight : 0;
    let time = startTime;
    for (let i = from; i <= to; i += 1) {
      const token = tokens[i];
      const end = time + token.weight * perWeight;
      words.push({ text: token.text, start: round3(time), end: round3(end), charStart: token.start, charEnd: token.end, sentence: token.sentence, break: token.break, fragment });
      time = end;
    }
  };
  let nextWord = 0;
  let segmentStart = speechStart;
  for (const [pauseIndex, slot] of pairs) {
    const [pauseStart, pauseEnd] = inner[pauseIndex];
    spread(nextWord, slot, segmentStart, pauseStart);
    nextWord = slot + 1;
    segmentStart = pauseEnd;
  }
  spread(nextWord, tokens.length - 1, segmentStart, speechEnd);
  return words;
}

/** Word timings of a whole track (a live fragment, or a saved clip of several), in track time. */
export function trackWordTimings(fragments: readonly SyncFragment[], lang?: string): TimedWord[] {
  const words: TimedWord[] = [];
  let sentenceBase = 0;
  fragments.forEach((fragment, index) => {
    const timed = estimateWordTimings({ text: fragment.text, durationS: fragment.durationS, pauses: fragment.pauses, lang }, index);
    for (const word of timed) {
      words.push({ ...word, start: round3(word.start + fragment.offsetS), end: round3(word.end + fragment.offsetS), sentence: word.sentence + sentenceBase });
    }
    if (timed.length) sentenceBase += timed[timed.length - 1].sentence + 1;
  });
  return words;
}

/** Offsets of fragments joined with `gapS` of silence between them (`concatWavFiles`). */
export function fragmentOffsets(durations: readonly number[], gapS: number): number[] {
  const offsets: number[] = [];
  let time = 0;
  durations.forEach((duration, index) => {
    if (index) time += gapS;
    offsets.push(round3(time));
    time += duration;
  });
  return offsets;
}

/** Index of the word being spoken at `time`: the last that has started, so the word stays lit
 *  through the pause after it. -1 before the first word. */
export function wordAt(words: readonly TimedWord[], time: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= time) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

// ── Speed ────────────────────────────────────────────────────────────────────

const WORD_MAX_WPS = 5;
const PHRASE_MAX_WPS = 9;
const HYSTERESIS_WPS = 0.4;
const MIN_PHRASE_WALL_S = 0.32;

/** Words spoken per second of audio over a track's words. */
export function wordsPerSecond(words: readonly TimedWord[]): number {
  if (words.length < 2) return 0;
  const span = words[words.length - 1].end - words[0].start;
  return span > 0 ? words.length / span : 0;
}

/**
 * How much text to light at once. What matters is words per second of the listener's clock
 * (audio rate × playback rate): past about five a second a word-by-word highlight flickers
 * faster than it can be read, so it lights short phrases, and past about nine whole
 * sentences. The previous choice gets a margin so a track does not flap between two.
 */
export function granularityFor(rate: number, mediaWordsPerSecond: number, previous?: HighlightGranularity): HighlightGranularity {
  const wall = mediaWordsPerSecond * Math.max(0.1, rate);
  const margin = (level: HighlightGranularity) => (previous === level ? HYSTERESIS_WPS : previous ? -HYSTERESIS_WPS : 0);
  if (wall <= WORD_MAX_WPS + margin('word')) return 'word';
  if (previous === 'sentence' && wall > PHRASE_MAX_WPS - HYSTERESIS_WPS) return 'sentence';
  if (wall <= PHRASE_MAX_WPS + margin('phrase')) return 'phrase';
  return 'sentence';
}

/** Light the word this much audio time early: about 50 ms of the listener's clock, so the
 *  highlight never feels late. */
export function leadS(rate: number): number {
  return 0.05 * Math.max(0.1, rate);
}

export interface WordSpan { first: number; last: number }

/** Groups of words lit together at `rate`: each stays visible at least ~0.3 s of the
 *  listener's clock, preferably ending at a comma, never crossing a sentence. */
export function phraseGroups(words: readonly TimedWord[], rate: number): WordSpan[] {
  const groups: WordSpan[] = [];
  const scale = 1 / Math.max(0.1, rate);
  let first = 0;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = words[i + 1];
    const wall = (word.end - words[first].start) * scale;
    const ends = !next || next.sentence !== word.sentence || next.fragment !== word.fragment
      || wall >= MIN_PHRASE_WALL_S || (word.break >= 1 && wall >= MIN_PHRASE_WALL_S * 0.55);
    if (ends) { groups.push({ first, last: i }); first = i + 1; }
  }
  return groups;
}

export function sentenceSpan(words: readonly TimedWord[], index: number): WordSpan {
  const sentence = words[index]?.sentence;
  let first = index;
  let last = index;
  while (first > 0 && words[first - 1].sentence === sentence) first -= 1;
  while (last < words.length - 1 && words[last + 1].sentence === sentence) last += 1;
  return { first, last };
}

/** The unit containing word `index` at `granularity`. */
export function unitSpan(words: readonly TimedWord[], index: number, granularity: HighlightGranularity, groups?: readonly WordSpan[]): WordSpan {
  if (granularity === 'word') return { first: index, last: index };
  if (granularity === 'sentence') return sentenceSpan(words, index);
  const list = groups ?? phraseGroups(words, 1);
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].last < index) lo = mid + 1;
    else if (list[mid].first > index) hi = mid - 1;
    else return list[mid];
  }
  return { first: index, last: index };
}

// ── Spoken ↔ displayed ───────────────────────────────────────────────────────

/** Comparison form of a word: compatibility-folded, without accents, case or apostrophes. */
export function normalizeWord(word: string): string {
  return word.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/['’`´]/g, '');
}

/** The words on screen, normalized, with a lazy position index for relocating a passage. */
export class DisplayedWords {
  readonly words: string[];
  private positions: Map<string, number[]> | null = null;

  constructor(words: readonly string[]) {
    this.words = words.map(normalizeWord);
  }

  get length(): number { return this.words.length; }

  occurrences(word: string): number[] {
    if (!this.positions) {
      this.positions = new Map();
      this.words.forEach((value, index) => {
        const list = this.positions!.get(value);
        if (list) list.push(index); else this.positions!.set(value, [index]);
      });
    }
    return this.positions.get(word) ?? [];
  }
}

export interface Alignment {
  /** Displayed index of each spoken word, or -1. */
  map: Int32Array;
  matched: number;
  ratio: number;
  /** Displayed index after the last match: where the next passage should start. */
  next: number;
}

function alignWindow(spoken: readonly string[], displayed: DisplayedWords, from: number): Alignment {
  const s = spoken.length;
  const lo = Math.max(0, from);
  const hi = Math.min(displayed.length, lo + s * 3 + 24);
  const w = hi - lo;
  const map = new Int32Array(s).fill(-1);
  if (!s || w <= 0) return { map, matched: 0, ratio: 0, next: from };
  // LCS table filled from the end, so walking it forwards prefers the earliest matches.
  const width = w + 1;
  const table = new Uint16Array((s + 1) * width);
  for (let i = s - 1; i >= 0; i -= 1) {
    for (let j = w - 1; j >= 0; j -= 1) {
      table[i * width + j] = spoken[i] === displayed.words[lo + j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  let matched = 0;
  let next = from;
  while (i < s && j < w) {
    if (spoken[i] === displayed.words[lo + j] && table[i * width + j] === table[(i + 1) * width + j + 1] + 1) {
      map[i] = lo + j;
      matched += 1;
      next = lo + j + 1;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i += 1;
    else j += 1;
  }
  return { map, matched, ratio: matched / s, next };
}

/** Where the passage most likely starts: every rare-enough spoken word votes for the
 *  diagonals its displayed occurrences fall on; the busiest one, nearest `hint`, wins. */
function locate(spoken: readonly string[], displayed: DisplayedWords, hint: number): number | null {
  const BUCKET = 16;
  const votes = new Map<number, number>();
  for (let i = 0; i < spoken.length; i += 1) {
    const at = displayed.occurrences(spoken[i]);
    if (!at.length || at.length > 64) continue;
    for (const position of at) {
      const bucket = Math.floor((position - i) / BUCKET);
      votes.set(bucket, (votes.get(bucket) ?? 0) + 1);
    }
  }
  let best: number | null = null;
  let bestVotes = 0;
  for (const [bucket, count] of votes) {
    const merged = count + (votes.get(bucket - 1) ?? 0) * 0.5 + (votes.get(bucket + 1) ?? 0) * 0.5;
    const closer = best != null && Math.abs(bucket * BUCKET - hint) < Math.abs(best * BUCKET - hint);
    if (merged > bestVotes || (merged === bestVotes && closer)) { best = bucket; bestVotes = merged; }
  }
  return best == null || bestVotes < Math.min(3, spoken.length) ? null : Math.max(0, best * BUCKET - BUCKET);
}

/**
 * Maps the words the engine spoke onto the words on screen. Narration does not read exactly
 * what is shown (citations are dropped, headings gain a period, formulas are read out, study
 * pronunciations replace words), so this is a monotonic best match: first near `cursor`
 * (where the previous passage ended), and over the whole text when that fails (a seek, a
 * jump, the first passage).
 */
export function alignSpoken(spokenWords: readonly string[], displayed: DisplayedWords, cursor: number): Alignment {
  const spoken = spokenWords.map(normalizeWord);
  const near = alignWindow(spoken, displayed, Math.max(0, cursor - 8));
  if (near.ratio >= 0.6 || !spoken.length) return near;
  const start = locate(spoken, displayed, cursor);
  if (start == null) return near;
  const found = alignWindow(spoken, displayed, start);
  return found.matched > near.matched ? found : near;
}

/** Displayed span covered by spoken words `first..last`, or null when none of them matched. */
export function displayedSpan(alignment: Alignment, first: number, last: number): WordSpan | null {
  let lo = -1;
  let hi = -1;
  for (let i = first; i <= last; i += 1) {
    const at = alignment.map[i];
    if (at < 0) continue;
    if (lo < 0 || at < lo) lo = at;
    if (at > hi) hi = at;
  }
  return lo < 0 ? null : { first: lo, last: hi };
}

/** Thresholds under which a passage is not highlighted: the screen does not show what is
 *  being read (a translated report narrated from its original, an edited draft). */
export const MIN_WORD_MATCH = 0.5;
export const MIN_SENTENCE_MATCH = 0.3;

// ── Generation ahead of the listener ─────────────────────────────────────────

/** Seconds of audio an open-ended narration (a library book) may generate ahead of what has
 *  been heard, so opening a book does not synthesise all of it. */
export const LISTENER_LOOKAHEAD_S = 180;

export function shouldWaitForListener(generatedS: number, playedS: number, aheadS = LISTENER_LOOKAHEAD_S): boolean {
  return generatedS - playedS > aheadS;
}
