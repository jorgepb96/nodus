// Unit tests for the citation sanitiser that backs project-suggestion generation.
// The pure helpers in electron/ai/citationSanitize.ts have no Electron/DB deps,
// so we bundle just that file with esbuild to a temp ESM module and import the
// REAL functions (not a mirror). This locks the fix for the bug where a
// hallucinated `nodus://passage/<uuid>` survived into a suggestion and rendered
// as a broken "⚠" citation.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-citation-test-'));
try {
  const outfile = path.join(tmp, 'citationSanitize.mjs');
  await build({
    entryPoints: [path.join(repoRoot, 'electron/ai/citationSanitize.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    // The module only imports a type from @shared/types, erased at compile time.
    external: ['@shared/*'],
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href);
  const { CITATION_KINDS, citationUrl, buildCitationOutputContract, dedupeRefs, normalizeRefs, extractCitationRefs, stripDisallowedCitations, supportedCitationKeys, canonicalizeCitationLinks, alignCitationKindsToAllowed } = mod;

  // ── citationUrl / extractCitationRefs round-trip ────────────────────────────
  assert.equal(citationUrl({ kind: 'idea', id: 'g-0001' }), 'nodus://idea/g-0001');
  assert.equal(citationUrl({ kind: 'work', id: 'a b' }), 'nodus://work/a%20b');
  assert.deepEqual(
    extractCitationRefs('Ver [X](nodus://idea/g-1) y [Y](nodus://work/w-2).'),
    [
      { kind: 'idea', id: 'g-1' },
      { kind: 'work', id: 'w-2' },
    ]
  );
  // Encoded ids are decoded back.
  assert.deepEqual(extractCitationRefs('[a](nodus://work/a%20b)'), [{ kind: 'work', id: 'a b' }]);
  assert.equal(buildCitationOutputContract('sin fuentes'), null);
  assert.deepEqual(
    buildCitationOutputContract('{"citation":"nodus://passage/work-1%237","again":"nodus://passage/work-1%237"}').exactTargets,
    ['[fuente](nodus://passage/work-1%237)'],
    'the tail contract exposes only canonical, de-duplicated targets copied from context',
  );
  {
    // The placeholder label and the instruction follow the answer's language: a model
    // that copies a target whole must not put a Spanish word in an English answer.
    const english = buildCitationOutputContract('{"citation":"nodus://work/w-1"}', 'en');
    assert.deepEqual(english.exactTargets, ['[source](nodus://work/w-1)']);
    assert.doesNotMatch(english.requirement, /respuesta|fuente|inválida|afirmación/i);
    assert.deepEqual(buildCitationOutputContract('{"citation":"nodus://work/w-1"}', 'de').exactTargets, ['[Quelle](nodus://work/w-1)']);
  }
  assert.deepEqual(
    extractCitationRefs('[cortada](nodus://work/a%2)'),
    [{ kind: 'work', id: 'a%2' }],
    'a provider-truncated percent escape is retained for validation instead of throwing',
  );

  // ── normalizeRefs: only real project kinds survive (no passage) ─────────────
  assert.ok(!CITATION_KINDS.includes('passage'), 'passage is not a project citation kind');
  assert.deepEqual(
    normalizeRefs([
      { kind: 'idea', id: 'g-1' },
      { kind: 'passage', id: 'x#0' },
      { kind: 'bogus', id: 'z' },
      { kind: 'idea', id: 'g-1' },
    ]),
    [{ kind: 'idea', id: 'g-1' }],
    'passage + unknown + duplicate ideas are dropped'
  );

  // ── dedupeRefs ──────────────────────────────────────────────────────────────
  assert.deepEqual(
    dedupeRefs([
      { kind: 'idea', id: 'g-1' },
      { kind: 'idea', id: 'g-1' },
      { kind: 'work', id: 'w-1' },
    ]),
    [
      { kind: 'idea', id: 'g-1' },
      { kind: 'work', id: 'w-1' },
    ]
  );

  // ── stripDisallowedCitations: the core fix ──────────────────────────────────
  const allowed = new Set(['idea:g-1', 'work:w-2']);

  // The phantom passage link (a chunk UUID) is removed; allowed links are kept.
  const phantom =
    'Las emociones articulan la experiencia [Smith, 2020](nodus://idea/g-1) ' +
    '[pasaje](nodus://passage/9b1afd69-1511-4d88-bb85-e87aa2fed62b).';
  const cleaned = stripDisallowedCitations(phantom, allowed);
  assert.ok(!cleaned.includes('passage'), 'phantom passage citation removed');
  assert.ok(!cleaned.includes('9b1afd69'), 'phantom passage id removed');
  assert.ok(cleaned.includes('nodus://idea/g-1'), 'allowed idea citation kept');
  assert.ok(!/\s\./.test(cleaned), 'no dangling space before the period');
  assert.ok(!cleaned.includes('()'), 'no empty parentheses left behind');

  // Allowed connected-idea links survive so the suggestion can link them.
  const connected =
    'A [a](nodus://idea/g-1) matiza a [b](nodus://work/w-2), frente a [c](nodus://idea/g-9).';
  const cleaned2 = stripDisallowedCitations(connected, allowed);
  assert.ok(cleaned2.includes('nodus://idea/g-1') && cleaned2.includes('nodus://work/w-2'), 'allowed kept');
  assert.ok(!cleaned2.includes('g-9'), 'disallowed idea link dropped');

  // Nothing allowed ⇒ all citations stripped, text still tidy.
  const stripped = stripDisallowedCitations('Idea [x](nodus://idea/zzz).', new Set());
  assert.equal(stripped, 'Idea.', 'all-disallowed collapses cleanly');
  assert.equal(
    stripDisallowedCitations('Idea [x](nodus://idea/a%E0%A4%A).', new Set()),
    'Idea.',
    'malformed UTF-8 in an untrusted citation is removed without aborting the answer',
  );

  // Exact reported scenario: a stray bare nodus://<uuid> in prose followed by a
  // blocked [pasaje] chip. Both must vanish, leaving clean prose.
  const reported =
    'una esencia nacional que se pretende eterna e inalterable ' +
    'nodus://9b1afd69-1511-4d88-bb85-e87aa2fed62b ' +
    '[pasaje](nodus://passage/9b1afd69-1511-4d88-bb85-e87aa2fed62b).';
  const fixed = stripDisallowedCitations(reported, new Set());
  assert.ok(!fixed.includes('nodus://'), 'no nodus:// URL of any form remains');
  assert.ok(!fixed.includes('9b1afd69'), 'the stray uuid is gone');
  assert.ok(!fixed.includes('pasaje'), 'the blocked passage chip is gone');
  assert.equal(fixed, 'una esencia nacional que se pretende eterna e inalterable.');

  // A bare malformed nodus://<uuid> (no kind) is removed even when other
  // citations are allowed, and allowed links survive intact.
  const mixed = stripDisallowedCitations(
    'A [b](nodus://idea/g-1) y nodus://9b1afd69-1511-4d88-bb85-e87aa2fed62b cierran.',
    new Set(['idea:g-1'])
  );
  assert.ok(mixed.includes('[b](nodus://idea/g-1)'), 'allowed link untouched by bare-url removal');
  assert.ok(!mixed.includes('9b1afd69'), 'bare malformed url removed');
  assert.equal(
    stripDisallowedCitations('Measured value [](nodus://passage/known).', new Set(['passage:known'])),
    'Measured value.',
    'an unresolved empty-label citation cannot leak a raw URI after empty-bracket cleanup',
  );
  assert.equal(
    stripDisallowedCitations('Measured value [Source, p. 4](nodus://passage/known).', new Set(['passage:known'])),
    'Measured value [Source, p. 4](nodus://passage/known).',
    'a labelled authorized citation remains clickable',
  );
  assert.equal(
    stripDisallowedCitations('Value [Source](nodus://passage/known) [Same page](nodus://passage/known) [Source](nodus://passage/known).', new Set(['passage:known'])),
    'Value [Source](nodus://passage/known).', 'only adjacent duplicate targets collapse',
  );
  const capturedPresentation = 'Hecho [fixture 25, p. p. 1](nodus://passage/documentary%3Afixture25%231). [fixture 25, p. 1](nodus://passage/documentary%3Afixture25%231)';
  assert.equal(stripDisallowedCitations(capturedPresentation, new Set(['passage:documentary:fixture25#1'])),
    'Hecho [fixture 25, p. p. 1](nodus://passage/documentary%3Afixture25%231).',
    'same-target audit chip after terminal punctuation collapses while punctuation remains');
  const threeChipChain = '[A](nodus://passage/known). [A](nodus://passage/known). [A](nodus://passage/known).';
  assert.equal(stripDisallowedCitations(threeChipChain, new Set(['passage:known'])), '[A](nodus://passage/known).',
    'same-target three-chip chain collapses without doubled punctuation');
  const differentPunctuation = '[A](nodus://passage/known). [A](nodus://passage/known)?';
  assert.equal(stripDisallowedCitations(differentPunctuation, new Set(['passage:known'])), differentPunctuation,
    'different punctuation prevents collapse');
  const proseSeparated = 'Fact [Source](nodus://passage/known). Another [Source](nodus://passage/known).';
  const differentKinds = '[Idea](nodus://idea/shared) [Work](nodus://work/shared).';
  assert.equal(stripDisallowedCitations(differentKinds, new Set(['idea:shared', 'work:shared'])), differentKinds,
    'identical IDs in different citation kinds are distinct targets');
  assert.equal(stripDisallowedCitations(proseSeparated, new Set(['passage:known'])), proseSeparated, 'real prose separates same-target citations');
  const lineSeparated = 'Fact [Source](nodus://passage/known).\n[Source](nodus://passage/known)';
  assert.equal(stripDisallowedCitations(lineSeparated, new Set(['passage:known'])), lineSeparated, 'paragraph/line boundary preserves same-target citation');
  const distinctClaims = 'Value [Source](nodus://passage/known). A second fact [Source](nodus://passage/known) [Other](nodus://passage/other).';
  assert.equal(stripDisallowedCitations(distinctClaims, new Set(['passage:known', 'passage:other'])), distinctClaims,
    'citations for another claim or different source survive');

  // Chat answers must pass two gates: the id resolves and the exact id was in the
  // context sent to the model. Existing-but-out-of-context references are not enough.
  const answerRefs = [
    { kind: 'idea', id: 'g-1' },
    { kind: 'work', id: 'w-2' },
    { kind: 'passage', id: 'work-1#7' },
  ];
  const supported = supportedCitationKeys(answerRefs, {
    'idea:g-1': true,
    'work:w-2': true,
    'passage:work-1#7': false,
  }, '{"id":"g-1","citation":"nodus://passage/work-1%237"}');
  assert.deepEqual([...supported], ['idea:g-1'], 'only resolvable, in-context citations survive');
  assert.equal(
    canonicalizeCitationLinks('[Autor, 2020, p. 7](nodus://passage/work-1#7)'),
    '[Autor, 2020, p. 7](nodus://passage/work-1%237)',
    'a raw passage separator cannot become a URL fragment',
  );
  assert.equal(
    canonicalizeCitationLinks('[Autor](nodus://passage/work-1%237)'),
    '[Autor](nodus://passage/work-1%237)',
    'already canonical ids are not double encoded',
  );
  assert.equal(
    canonicalizeCitationLinks('[Autor, 2020](nodus://idea/g-1, p. 207)'),
    '[Autor, 2020, p. 207](nodus://idea/g-1)',
    'a locator accidentally placed in the URL is moved to the visible label',
  );
  assert.equal(
    stripDisallowedCitations('Afirmación ([Autor](nodus://passage/uuid-truncado', new Set()),
    'Afirmación',
    'an answer cut off in the middle of a citation leaves no broken link or punctuation',
  );
  assert.equal(
    alignCitationKindsToAllowed(
      'Una obra [Fuente](nodus://idea/04702974-89d6-4f41-9d3c-76e46f364073).',
      [{ kind: 'work', id: '04702974-89d6-4f41-9d3c-76e46f364073' }],
    ),
    'Una obra [Fuente](nodus://work/04702974-89d6-4f41-9d3c-76e46f364073).',
    'a wrong kind is corrected only when the exact id has one unambiguous allowed source',
  );
  assert.equal(
    alignCitationKindsToAllowed(
      '[Fuente](nodus://idea/shared)',
      [{ kind: 'idea', id: 'shared' }, { kind: 'work', id: 'shared' }],
    ),
    '[Fuente](nodus://idea/shared)',
    'an ambiguous id is never rewritten to a different kind',
  );

  console.log('citation sanitiser test passed');
} finally {
  await rm(tmp, { recursive: true, force: true });
}
