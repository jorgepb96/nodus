import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadReleaseNotes, generateReleaseNotes } from './generate-release-notes.mjs';

const { RELEASE_NOTES, RELEASE_CATEGORIES, RELEASE_SECTION_LABELS, RELEASE_EMPTY_SECTION, releaseNoteSections, releaseNoteMarkdown } = await loadReleaseNotes();
const languages = ['es','en','fr','de','pt','pt-BR','it','tr','zh-CN','zh-TW','ja','ko'];
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const current = RELEASE_NOTES[0];

test('the modal covers every language available in the interface', async () => {
  const types = await readFile(new URL('../shared/types.ts', import.meta.url), 'utf8');
  const declaration = types.match(/export type AppLanguage = ([^;]+);/);
  assert.ok(declaration, 'the interface language union exists');
  const supported = [...declaration[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(languages, supported);
  assert.match(current.highlights[0].en, /Nodus Scriptor/);
  assert.ok(current.highlights.slice(1).every(highlight => !/Scriptor/.test(highlight.en)), 'Scriptor appears once with its final first-release behavior');
});

test('the current release covers the final changes in twelve languages and three sections', () => {
  assert.equal(current.version, pkg.version);
  assert.equal(current.date, pkg.releaseMetadata.dateReleased);
  assert.equal(current.version, '5.8.1');
  assert.equal(current.highlights.length, 8);
  assert.deepEqual(current.highlights.map(h => h.category), ['new','enhancement','enhancement','fix','fix','fix','fix','fix']);
  assert.deepEqual(current.highlights.map(h => h.scope), ['toolkit','ai','academic','ai','ai','academic','zotero','general']);
  for (const lang of languages) for (const highlight of current.highlights) {
    assert.ok(highlight[lang].length > 30, `${lang}: complete note`);
    if (lang !== 'en') assert.notEqual(highlight[lang], highlight.en, `${lang}: native translation`);
    assert.doesNotMatch(highlight[lang], /[;—]/, `${lang}: simple sentences`);
  }
});

test('only v5 and future releases use the three translated sections, including empty sections', () => {
  for (const lang of languages) {
    assert.deepEqual(Object.keys(RELEASE_SECTION_LABELS[lang]), RELEASE_CATEGORIES);
    for (const label of Object.values(RELEASE_SECTION_LABELS[lang])) assert.ok(label.trim());
    assert.ok(RELEASE_EMPTY_SECTION[lang].trim());
  }
  for (const note of RELEASE_NOTES) {
    const sections = releaseNoteSections(note);
    if (Number.parseInt(note.version, 10) < 5) {
      assert.equal(sections.length, 1);
      assert.equal(sections[0].category, null);
      assert.ok(note.highlights.every(highlight => highlight.category === undefined));
    } else {
      assert.deepEqual(sections.map(s => s.category), RELEASE_CATEGORIES);
      assert.equal(sections.flatMap(s => s.highlights).length, note.highlights.length);
      for (const section of sections) assert.ok(section.highlights.every(h => h.category === section.category));
    }
  }
  const fixesOnly = { version: '6.0.1', date: current.date, highlights: [current.highlights[3]] };
  assert.deepEqual(releaseNoteSections(fixesOnly).map(s => s.highlights.length), [0,0,1]);
  assert.equal(releaseNoteMarkdown(fixesOnly).split(RELEASE_EMPTY_SECTION.en).length - 1, 2);
  assert.throws(() => releaseNoteSections({ ...fixesOnly, highlights: [{ ...current.highlights[0], category: undefined }] }), /uncategorized/);
  assert.throws(() => releaseNoteMarkdown({ ...fixesOnly, highlights: [] }), /no highlights/);
});

test('scope ordering stays inside each section, with stable ties', () => {
  const a = { ...current.highlights[0], scope: 'toolkit', category: 'new' };
  const b = { ...current.highlights[1], scope: 'library', category: 'new' };
  const c = { ...current.highlights[2], scope: 'library', category: 'new' };
  const d = { ...current.highlights[3], scope: 'toolkit', category: 'enhancement' };
  const e = { ...current.highlights[4], scope: 'ai', category: 'fix' };
  const note = { ...current, highlights: [a, e, b, d, c] };
  assert.deepEqual(releaseNoteSections(note).flatMap(s => s.highlights), [b, c, a, d, e]);
});

test('the generated description is exactly the English modal text in displayed order and rejects drift', async () => {
  const expected = `# Nodus ${pkg.version}\n\n` + ['New features','Enhancements','Fixes'].map((title, i) =>
    `## ${title}\n\n` + current.highlights.slice([0,1,3][i], [1,3,8][i]).map(h => `- ${h.en}`).join('\n\n')
  ).join('\n\n') + '\n';
  assert.equal(await generateReleaseNotes(`v${pkg.version}`), expected);
  await assert.rejects(generateReleaseNotes('v99.0.0'), /does not match/);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nodus-release-description-'));
  try {
    const output = path.join(dir, 'notes.md');
    const run = (...args) => execFileSync(process.execPath, ['scripts/generate-release-notes.mjs', ...args], { encoding: 'utf8', stdio: 'pipe' });
    run(`v${pkg.version}`, output);
    assert.equal(await readFile(output, 'utf8'), expected);
    assert.match(run(`v${pkg.version}`, output, '--check'), /matches/);
    await writeFile(output, expected.replace(current.highlights[0].en, 'Unrelated notes.'));
    assert.throws(() => run(`v${pkg.version}`, output, '--check'), /differs/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('draft creation, draft reuse and stable/beta publication require generated modal notes', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release-build.yml', import.meta.url), 'utf8');
  assert.equal(workflow.split('node scripts/generate-release-notes.mjs').length - 1, 2);
  assert.match(workflow, /gh release create[\s\S]*?--notes-file "\$RUNNER_TEMP\/nodus-release-notes.md"/);
  assert.match(workflow, /gh release edit "\$RELEASE_TAG" --repo "\$GITHUB_REPOSITORY" --notes-file/);
  for (const publication of workflow.split('\n').filter(line => line.includes('--draft=false'))) {
    assert.match(publication, /--notes-file "\$RUNNER_TEMP\/nodus-release-notes.md"/);
  }
});
