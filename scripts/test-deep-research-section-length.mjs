// "Extensión orientativa de cada sección" — the shared words-per-section control.
//
// Three things have to hold together, and each one alone has shipped a bug in this
// area before:
//   • an absent/unknown value means 'auto', so historical requests, persisted queue
//     jobs and MCP callers that never heard of the field keep today's behaviour;
//   • the custom value is validated, not silently snapped — empty, negative, zero,
//     decimal, non-numeric and out-of-range each get their own message;
//   • a long target is produced by BOUNDED continuation passes that stop the moment
//     the evidence is exhausted, never by asking one response for 20.000 words.
//
// The pure modules are bundled with esbuild and driven directly: no provider calls,
// no database, no Electron.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const scratch = mkdtempSync(path.join(tmpdir(), 'nodus-section-length-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function load(file, name) {
  const bundle = path.join(scratch, `${name}.mjs`);
  execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
    path.join(root, file), '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`,
  ], { cwd: root, stdio: 'ignore' });
  return bundle;
}

const lib = await import(pathToFileURL(load('shared/deepResearchSectionLength.ts', 'length')).href);
const packs = await import(pathToFileURL(load('shared/deepResearchLengthPromptPacks.ts', 'packs')).href);

const LANGUAGES = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko'];
const CJK = new Set(['zh-Hans', 'zh-Hant', 'ja', 'ko']);

// ── Normalization, legacy values and clamping ────────────────────────────────

test('anything that is not a usable word count reads back as auto', () => {
  for (const value of [undefined, null, 'auto', '', 'single', 'abc', 0, -1, -2500, NaN, Infinity, {}, [], true]) {
    assert.equal(
      lib.normalizeDeepResearchSectionLength(value),
      'auto',
      `${JSON.stringify(String(value))} must be auto`,
    );
  }
  // The legacy case that matters most: a request object from before the control.
  const legacyRequest = { objective: 'X', language: 'es', sectionLimit: 4 };
  assert.equal(lib.normalizeDeepResearchSectionLength(legacyRequest.sectionLength), 'auto');
  assert.equal(lib.deepResearchSectionLengthWords(legacyRequest.sectionLength), null);
});

test('a usable number survives, and an unusable one is clamped rather than dropped', () => {
  for (const preset of lib.DEEP_RESEARCH_SECTION_LENGTH_PRESETS) {
    assert.equal(lib.normalizeDeepResearchSectionLength(preset), preset);
    assert.equal(lib.deepResearchSectionLengthWords(preset), preset);
  }
  assert.equal(lib.normalizeDeepResearchSectionLength('5000'), 5_000, 'a numeric string from a form/JSON payload');
  assert.equal(lib.normalizeDeepResearchSectionLength(4_999.4), 4_999, 'a float is rounded, not rejected');
  assert.equal(
    lib.normalizeDeepResearchSectionLength(90_000),
    lib.DEEP_RESEARCH_SECTION_LENGTH_MAX,
    'a hostile payload is clamped to the maximum, never left unbounded',
  );
  assert.equal(
    lib.normalizeDeepResearchSectionLength(10),
    lib.DEEP_RESEARCH_SECTION_LENGTH_MIN,
    'an absurdly small number degrades to the minimum, not to auto',
  );
});

test('a stored value maps back to the dropdown entry that produced it', () => {
  assert.equal(lib.deepResearchSectionLengthChoice(undefined), 'auto');
  assert.equal(lib.deepResearchSectionLengthChoice('auto'), 'auto');
  for (const preset of lib.DEEP_RESEARCH_SECTION_LENGTH_PRESETS) {
    assert.equal(lib.deepResearchSectionLengthChoice(preset), preset, 'a preset reopens on its own row');
  }
  assert.equal(lib.deepResearchSectionLengthChoice(7_300), 'custom', 'a non-preset reopens the Custom field');
  const values = lib.DEEP_RESEARCH_SECTION_LENGTH_OPTIONS.map((option) => option.value);
  assert.deepEqual(values, ['auto', 2_500, 5_000, 10_000, 15_000, 20_000, 'custom'], 'the requested option list, in order');
  assert.ok(
    lib.DEEP_RESEARCH_SECTION_LENGTH_OPTIONS.every((option) => option.label.trim().length > 0),
    'every option carries a Spanish source label for t()',
  );
});

// ── Custom-value validation ──────────────────────────────────────────────────

test('the custom word count rejects empty, negative, zero, decimal and unreasonable values', () => {
  const reject = (raw, error) => {
    const result = lib.validateDeepResearchSectionLength(raw);
    assert.equal(result.ok, false, `${JSON.stringify(raw)} must be rejected`);
    assert.equal(result.error, error, `${JSON.stringify(raw)} → ${error}`);
    assert.ok(result.message.trim().length > 0, 'a rejection always carries a message the UI can translate');
  };
  reject('', 'empty');
  reject('   ', 'empty');
  reject('abc', 'not-a-number');
  reject('5 000', 'not-a-number');
  reject('1e4', 'not-a-number');
  reject('2500,5', 'not-an-integer');
  reject('2500.5', 'not-an-integer');
  reject('-3000', 'too-small');
  reject('0', 'too-small');
  reject(String(lib.DEEP_RESEARCH_SECTION_LENGTH_MIN - 1), 'too-small');
  reject(String(lib.DEEP_RESEARCH_SECTION_LENGTH_MAX + 1), 'too-large');
  reject('1000000', 'too-large');
});

test('a valid custom word count is accepted verbatim', () => {
  for (const raw of ['3000', ' 7500 ', String(lib.DEEP_RESEARCH_SECTION_LENGTH_MIN), String(lib.DEEP_RESEARCH_SECTION_LENGTH_MAX)]) {
    const result = lib.validateDeepResearchSectionLength(raw);
    assert.equal(result.ok, true, `${raw} must be accepted`);
    assert.equal(result.value, Number(raw.trim()), 'the typed number reaches the pipeline unchanged');
  }
});

test('every validation message is a translatable Spanish source with intact placeholders', () => {
  const messages = lib.DEEP_RESEARCH_SECTION_LENGTH_MESSAGES;
  assert.deepEqual(
    Object.keys(messages).sort(),
    ['empty', 'not-a-number', 'not-an-integer', 'too-large', 'too-small'],
    'one message per rejection reason',
  );
  assert.match(messages['too-small'], /\{min\}/u, 'the minimum is interpolated, not baked into the key');
  assert.match(messages['too-large'], /\{max\}/u, 'the maximum is interpolated, not baked into the key');
});

// ── Bounded passes, never one oversized request ──────────────────────────────

test('auto mode plans exactly one pass and no target', () => {
  const plan = lib.planDeepResearchSectionLength('auto');
  assert.equal(plan.targetWords, null);
  assert.equal(plan.maxPasses, 1, 'auto never spends a continuation call');
  assert.equal(plan.paragraphTarget, 0);
});

test('a word target becomes bounded passes whose output budget stays provider-safe', () => {
  for (const target of [...lib.DEEP_RESEARCH_SECTION_LENGTH_PRESETS, lib.DEEP_RESEARCH_SECTION_LENGTH_MAX]) {
    const plan = lib.planDeepResearchSectionLength(target);
    assert.equal(plan.targetWords, target);
    assert.ok(plan.maxPasses >= 1 && plan.maxPasses <= lib.DEEP_RESEARCH_SECTION_MAX_PASSES, `${target}: passes bounded`);
    assert.ok(
      plan.wordsPerPass >= lib.DEEP_RESEARCH_SECTION_PASS_MIN_WORDS
        && plan.wordsPerPass <= lib.DEEP_RESEARCH_SECTION_PASS_MAX_WORDS,
      `${target}: no single call is asked for an unbounded amount of prose`,
    );
    assert.ok(plan.maxTokensPerPass <= 6_000, `${target}: maxTokens is never raised without control`);
    assert.ok(
      plan.maxPasses * plan.wordsPerPass >= target * 0.9,
      `${target}: the passes can actually reach the target`,
    );
    assert.ok(plan.paragraphTarget > 0, `${target}: the academic planner gets a paragraph budget`);
  }
  // Words are words: the target must never be read as a token budget.
  assert.ok(
    lib.planDeepResearchSectionLength(20_000).maxTokensPerPass < 20_000,
    'the word target is not passed through as maxTokens',
  );
});

test('continuations stop as soon as the evidence is exhausted, instead of padding', async () => {
  const plan = lib.planDeepResearchSectionLength(20_000);
  let calls = 0;
  const outcome = await lib.extendDeepResearchSection({
    plan,
    initial: 'palabra '.repeat(400),
    writeContinuation: async () => {
      calls += 1;
      // The writer says it has nothing supported left to add on the third call.
      return calls >= 3 ? '' : 'palabra '.repeat(500);
    },
  });
  assert.equal(outcome.stop, 'exhausted', 'the loop ends on an empty continuation');
  assert.equal(calls, 3, 'and stops asking, rather than burning the whole pass budget');
  assert.ok(outcome.words < 20_000, 'a corpus that runs dry produces a shorter section, not padding');
});

test('a long target is reached across many bounded passes', async () => {
  const plan = lib.planDeepResearchSectionLength(10_000);
  let calls = 0;
  const outcome = await lib.extendDeepResearchSection({
    plan,
    initial: '## Sección\n\nprimera '.repeat(1),
    writeContinuation: async (context) => {
      calls += 1;
      assert.ok(context.passWords <= plan.wordsPerPass, 'no pass asks for more than the planned slice');
      assert.ok(context.remainingWords > 0, 'a pass only runs while words are missing');
      assert.equal(context.maxPasses, plan.maxPasses);
      return 'palabra '.repeat(context.passWords);
    },
  });
  assert.equal(outcome.stop, 'target', 'the guideline length is reached');
  assert.ok(outcome.words >= 10_000 * 0.92, `got ${outcome.words}`);
  assert.ok(calls <= plan.maxPasses, 'never more calls than the plan allows');
  assert.ok(outcome.markdown.startsWith('## Sección'), 'the section heading and structure survive continuation');
});

test('cancellation aborts between passes instead of after the whole section', async () => {
  const plan = lib.planDeepResearchSectionLength(20_000);
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    lib.extendDeepResearchSection({
      plan,
      initial: 'palabra '.repeat(100),
      signal: controller.signal,
      writeContinuation: async (context) => {
        calls += 1;
        if (calls === 2) controller.abort();
        return 'palabra '.repeat(context.passWords);
      },
    }),
    (error) => error?.name === 'AbortError',
  );
  assert.equal(calls, 2, 'the abort is honoured at the next pass boundary, not ignored');
});

test('a provider failure mid-continuation keeps the prose already written', async () => {
  const plan = lib.planDeepResearchSectionLength(15_000);
  const outcome = await lib.extendDeepResearchSection({
    plan,
    initial: '## Sección\n\n' + 'palabra '.repeat(600),
    writeContinuation: async () => {
      throw new Error('provider hiccup');
    },
  });
  assert.equal(outcome.stop, 'exhausted');
  assert.ok(outcome.markdown.includes('## Sección'), 'the supported section already written is never lost');
});

test('one continuation pass runs exactly once — the control cannot fan out generations', async () => {
  const plan = lib.planDeepResearchSectionLength(2_500);
  const seen = [];
  await lib.extendDeepResearchSection({
    plan,
    initial: 'palabra '.repeat(100),
    writeContinuation: async (context) => {
      seen.push(context.pass);
      return 'palabra '.repeat(context.passWords);
    },
  });
  assert.deepEqual(seen, [...new Set(seen)], 'passes are sequential and unique, never concurrent duplicates');
  assert.deepEqual(seen, seen.slice().sort((a, b) => a - b), 'and strictly in order');
});

// ── Localized guidance ───────────────────────────────────────────────────────

test('every supported language has native length guidance, with no Spanish leaking in', () => {
  const stages = ['section', 'paragraph', 'evidencePlan', 'plan', 'continuation', 'clientKit'];
  const spanishOnly = /\b(?:palabras|orientativa|secci[oó]n|p[aá]rrafo|evidencia|rellenes)\b/iu;
  for (const language of LANGUAGES) {
    const pack = packs.deepResearchLengthPromptPack(language);
    for (const stage of stages) {
      const text = stage === 'evidencePlan'
        ? pack.evidencePlan(14, 2_500)
        : stage === 'continuation'
          ? pack.continuation(1_200, 900)
          : pack[stage](2_500);
      assert.ok(text.length > (CJK.has(language) ? 45 : 80), `${language}.${stage} is too short to be real guidance`);
      // The number must actually appear, formatted for that locale.
      assert.match(text, /\d/u, `${language}.${stage} names no number`);
      if (language !== 'es' && language !== 'pt' && language !== 'pt-BR' && language !== 'it') {
        assert.ok(!spanishOnly.test(text), `${language}.${stage} leaks Spanish: ${text.slice(0, 120)}`);
      }
    }
    assert.ok(pack.continuationStop.length > 40, `${language} has no exhausted-evidence escape hatch`);
  }
});

test('the guidance always says words, never tokens, and never a quota', () => {
  const word = {
    es: /palabras/iu, en: /words/iu, fr: /mots/iu, de: /W[oö]rter/iu,
    pt: /palavras/iu, 'pt-BR': /palavras/iu, it: /parole/iu, tr: /kelime/iu,
    'zh-Hans': /字/iu, 'zh-Hant': /字/iu, vi: /từ/iu, ja: /字/iu,
    ru: /слов/iu, uk: /слів/iu, ko: /단어/iu,
  };
  const notAQuota = {
    es: /no una cuota/iu, en: /not a quota/iu, fr: /pas un quota/iu, de: /keine Quote/iu,
    pt: /não uma quota/iu, 'pt-BR': /não uma cota/iu, it: /non una quota/iu, tr: /kota değildir/iu,
    'zh-Hans': /不是配额/iu, 'zh-Hant': /不是配額/iu, vi: /không phải hạn ngạch/iu,
    ja: /ノルマではありません/iu, ru: /не квота/iu, uk: /не квота/iu, ko: /할당량이 아닙니다/iu,
  };
  for (const language of LANGUAGES) {
    const section = packs.deepResearchLengthPromptPack(language).section(5_000);
    assert.match(section, word[language], `${language} must name words`);
    assert.ok(!/\btokens?\b/iu.test(section), `${language} must never say tokens`);
    assert.match(section, notAQuota[language], `${language} must say the target is not a quota`);
  }
});

test('an "I have nothing left to add" answer is recognised in every language', () => {
  for (const language of LANGUAGES) {
    const pack = packs.deepResearchLengthPromptPack(language);
    const sentinel = packs.EMPTY_CONTINUATION_TOKENS.find((token) => pack.continuationStop.includes(token));
    assert.ok(sentinel, `${language} names no sentinel token`);
    assert.ok(packs.isEmptyContinuation(sentinel), `${language}: bare "${sentinel}" counts as exhausted`);
    assert.ok(packs.isEmptyContinuation(`  ${sentinel}.  `), `${language}: padded sentinel still counts as exhausted`);
  }
  assert.ok(!packs.isEmptyContinuation('Una continuación real con contenido sustantivo.'));
  assert.ok(packs.isEmptyContinuation(''));
});

// ── The control travels intact ───────────────────────────────────────────────

test('every variant records the requested length through the one metadata seam', () => {
  const source = readFileSync(path.join(root, 'electron/ai/deepResearch.ts'), 'utf8');
  // Academic v1/v2, the specialized approaches, Study, Teaching (unitMode) and
  // Genealogy all return through withGenerationMetadata, so recording the length
  // there is what makes "reuse this prompt" restore it whichever pipeline wrote it.
  assert.match(source, /const sectionLength = normalizeDeepResearchSectionLength\(request\.sectionLength\);/u);
  assert.match(source, /versionedRequest: DeepResearchRequest = \{ \.\.\.request, deepResearchVersion, sectionLength \}/u);
  // The shared finish step now also records the visual policy before metadata.
  assert.match(source, /const finish = \(result: DeepResearchReport\) => \{[^}]*return withGenerationMetadata\(result, approach, deepResearchVersion, model, sectionLength\); \}/u);
  const returns = [...source.matchAll(/return finish\(report\);/gu)];
  assert.ok(returns.length >= 4, `expected every variant to return through the shared finish step (found ${returns.length})`);
  assert.match(
    source,
    /deepResearchSectionLength: report\.draft\.deepResearchSectionLength \?\? sectionLength/u,
    'a pipeline that already recorded its own value keeps it',
  );
  assert.match(source, /sectionLength: report\.meta\.sectionLength \?\? sectionLength/u);
});

test('the study, teaching and genealogy writers all receive localized length guidance', () => {
  const desktop = readFileSync(path.join(root, 'electron/ai/deepResearch.ts'), 'utf8');
  assert.match(desktop, /import \{portableDeepResearchAI\} from '@shared\/portableDeepResearchAI'/u);
  assert.match(desktop, /aiWriteSection[^}]*\} = canonicalAcademicAI/u);
  for (const file of ['electron/ai/studyDeepResearch.ts', 'electron/ai/genealogyDeepResearch.ts', 'shared/portableDeepResearchAI.ts']) {
    const source = readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /deepResearchLengthPromptPack\(/u, `${file}: no localized length pack`);
    assert.match(source, /lengthPack\.section\(/u, `${file}: the section writer gets no length steer`);
    assert.match(source, /extendDeepResearchSection\(/u, `${file}: a long target is not produced by bounded continuations`);
    assert.match(source, /isEmptyContinuation\(/u, `${file}: an exhausted-evidence answer is not recognised`);
    // Cancellation has to survive a long continuation, not only the first pass.
    assert.match(source, /signal,/u, `${file}: continuations are not cancellable`);
  }
  // Database Deep Research is AST-gated with a hard model-call budget, so it takes
  // the steer as prompt guidance for its prose roles only — never a continuation loop.
  const database = readFileSync(path.join(root, 'shared/databaseDeepResearchPrompts.ts'), 'utf8');
  assert.match(database, /input\.role === 'writer' \|\| input\.role === 'editor'/u, 'only the prose roles receive the steer');
  assert.doesNotMatch(database, /extendDeepResearchSection/u, 'the AST-gated pipeline runs no continuation loop');
});

test('every language Nodus can write in is offered by the Deep Research pickers', () => {
  // The engine has always supported eight prompt languages and the MCP schema
  // enumerates all of them, but the composers spelled the list out by hand and the
  // Deep Research picker was missing Italian: an Italian report was reachable over
  // MCP and unreachable from the app. One shared list, derived from the union.
  const options = readFileSync(path.join(root, 'shared/promptLanguageOptions.ts'), 'utf8');
  const types = readFileSync(path.join(root, 'shared/types.ts'), 'utf8');
  const union = [...types.match(/export const PROMPT_LANGUAGES = \[([^\]]*)\]/u)[1].matchAll(/'([^']+)'/gu)].map((m) => m[1]);
  assert.deepEqual([...union].sort(), [...LANGUAGES].sort(), 'the supported set is the one this suite checks');
  for (const language of union) {
    // `pt-BR` is quoted in the Record; the others are bare keys.
    assert.ok(
      options.includes(`\n  ${language}: '`) || options.includes(`\n  '${language}': '`),
      `${language} has no endonym label`,
    );
  }
  for (const file of ['src/views/DeepResearchView.tsx', 'src/views/DatabaseDeepResearchView.tsx']) {
    const view = readFileSync(path.join(root, file), 'utf8');
    assert.match(view, /PROMPT_LANGUAGE_OPTIONS/u, `${file} still hand-writes its language list`);
    assert.doesNotMatch(view, /<option value="pt-BR">/u, `${file} still has a hand-written option list`);
  }
});

test('the shared control is the single source of truth for every Deep Research surface', () => {
  const reads = (file) => readFileSync(path.join(root, file), 'utf8');
  const surfaces = [
    'electron/ai/deepResearch.ts',
    'electron/ai/studyDeepResearch.ts',
    'electron/ai/genealogyDeepResearch.ts',
    'electron/ai/deepResearchClient.ts',
    'electron/ai/deepResearchCore.ts',
    'electron/ai/deepResearchQueue.ts',
    'electron/mcp/tools.ts',
    'shared/databaseDeepResearchPrompts.ts',
    'src/views/DeepResearchView.tsx',
    'src/views/DatabaseDeepResearchView.tsx',
    'src/serverWeb/DatabaseDeepResearchServerView.tsx',
  ];
  for (const file of surfaces) {
    assert.match(
      reads(file),
      /deepResearchSectionLength|deepResearchLengthPromptPacks|DeepResearchSectionLengthField|sectionLength/u,
      `${file} does not carry the section-length control`,
    );
  }
});
