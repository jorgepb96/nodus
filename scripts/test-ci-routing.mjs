import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { routeChanges, changedPaths, assertJobResults } from './ci-routing.mjs';

test('only a bounded documentation/site allowlist avoids the complete Linux suite', () => {
  for (const files of [['README.md'], ['docs/guide.md', 'site/app/index.html'], ['.github/actions-budget/README.md']]) {
    const route = routeChanges(files);
    assert.equal(route.light, true);
    assert.equal(route.full, false);
    assert.equal(route.macos || route.windows || route.research || route.server || route.scheme, false);
  }
  for (const file of ['src/views/Editor.tsx', 'new-tool.cjs', 'PRIVACY.md', 'CLA.md', 'docs/template.ts',
    'site/data/announcements.json', 'site/data/research-atlas.json', '.github/actions-budget/restore.py']) {
    assert.equal(routeChanges([file]).full, true, file);
  }
  assert.equal(routeChanges(['README.md', 'src/new-file.ts']).full, true);
});

test('dependencies, Electron and packaging changes exercise both supported native hosts', () => {
  for (const file of ['package.json', 'package-lock.json', 'electron/main.ts', 'electron/toolkit/presenter/windows.ts',
    'build/afterPack.cjs', 'scripts/test-mac-bundle-name.mjs', 'scripts/verify-presenter-lan.cjs',
    'scripts/ci-test-shards.mjs', '.github/workflows/release-build.yml']) {
    const route = routeChanges([file]);
    assert.ok(route.full && route.macos && route.windows, file);
    assert.deepEqual(route.matrix.include.map(row => row.os), ['macos-latest', 'windows-latest']);
  }
  assert.equal(routeChanges(['src/views/Editor.tsx']).macos, false);
  assert.equal(routeChanges(['src/views/Editor.tsx']).windows, false);
});

test('every specialist follows its real source, fixtures and workflow definitions', () => {
  const cases = {
    research: ['runtime/zotero-mcp/python.lock.json', 'electron/ai/documentaryCoordinator.ts',
      'shared/research.ts', 'scripts/test-documentary-store.mjs', '.github/workflows/research-corpus-native.yml'],
    scheme: ['tools/scheme-scan/pipeline.py', 'tools/reaction-index/requirements.txt', '.github/workflows/scheme-scan.yml'],
    server: ['server/Dockerfile', 'server/package-lock.json', 'src/serverWeb/App.tsx',
      'scripts/lib/nodusServerHarness.mjs', '.github/workflows/nodus-server-image.yml',
      'electron/db/schema.ts', 'shared/serverProfilePreferences.mjs', '.dockerignore'],
    appimage: ['scripts/finalize-linux-appimage.mjs', 'scripts/upload-release-assets.mjs', 'build/beforePack.cjs'],
    presenter: ['shared/presenterState.ts', 'electron/toolkit/presenter/lan.ts', 'scripts/test-presenter-lan.mjs'],
  };
  for (const [lane, files] of Object.entries(cases)) for (const file of files) {
    const route = routeChanges([file]);
    assert.equal(route[lane], true, `${lane}: ${file}`);
    assert.equal(route.full, true, file);
    if (lane === 'research') assert.ok(route.macos && route.windows);
  }
});

test('manual, empty, merge-queue and policy changes cannot silently omit coverage', () => {
  for (const [files, mode] of [[[], 'pull_request'], [[], 'manual'], [[], 'merge_group'],
    [['.github/workflows/ci.yml'], 'pull_request'], [['.github/actions/ci-linux/action.yml'], 'pull_request'],
    [['scripts/ci-routing.mjs'], 'pull_request']]) {
    const route = routeChanges(files, mode);
    for (const lane of ['full', 'macos', 'windows', 'research', 'scheme', 'server', 'appimage', 'presenter']) assert.equal(route[lane], true, lane);
    assert.equal(route.light, false);
  }
  const release = routeChanges([], 'release');
  assert.ok(release.full && release.research && release.scheme && release.server && release.appimage);
  assert.equal(release.macos || release.windows, false, 'release packaging already owns native host checks');
  assert.throws(() => routeChanges(['../escape']), /Invalid/);
  assert.throws(() => routeChanges(['/root/file']), /Invalid/);
  assert.throws(() => routeChanges([], 'typo'), /Unknown/);
});

test('the final gate rejects failed, cancelled, missing and unexpected skipped jobs', () => {
  const route = routeChanges(['src/views/Editor.tsx']);
  const jobs = { changes: { result: 'success' }, linux: { result: 'success' },
    unit: { result: 'success' }, e2e: { result: 'success' },
    light: { result: 'skipped' }, platform: { result: 'skipped' }, scheme: { result: 'skipped' }, server: { result: 'skipped' } };
  assertJobResults(route, jobs);
  for (const lane of ['linux', 'unit', 'e2e']) for (const value of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() => assertJobResults(route, { ...jobs, [lane]: { result: value } }));
  }
  assert.throws(() => assertJobResults(route, { ...jobs, changes: { result: 'failure' } }));
  assert.throws(() => assertJobResults(route, { ...jobs, platform: { result: 'success' } }));
  const docs = routeChanges(['README.md']);
  const skipped = { result: 'skipped' };
  assertJobResults(docs, { ...jobs, linux: skipped, unit: skipped, e2e: skipped, light: { result: 'success' } });
  assert.throws(() => assertJobResults(docs, { ...jobs, linux: { result: 'skipped' } }));
});

test('a real Git diff includes renamed/deleted paths and more than 300 files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-routing-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const commit = () => { git('add', '-A'); git('-c', 'user.name=CI Fixture', '-c', 'user.email=ci@example.invalid', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  try {
    git('init', '-q');
    fs.mkdirSync(path.join(root, 'electron'));
    fs.writeFileSync(path.join(root, 'electron/main.ts'), 'native API');
    const base = commit();
    fs.mkdirSync(path.join(root, 'docs'));
    fs.renameSync(path.join(root, 'electron/main.ts'), path.join(root, 'docs/native.md'));
    for (let i = 0; i < 350; i++) fs.writeFileSync(path.join(root, 'docs', `${i}.md`), 'documentation');
    fs.writeFileSync(path.join(root, 'docs/line\nbreak.md'), 'NUL-delimited diff');
    const head = commit();
    const files = changedPaths(base, head, root);
    assert.equal(files.length, 353);
    assert.ok(files.includes('electron/main.ts') && files.includes('docs/native.md') && files.includes('docs/line\nbreak.md'));
    assert.ok(routeChanges(files).macos);
    assert.throws(() => changedPaths('main; echo unsafe', head, root), /immutable/);
    assert.throws(() => changedPaths(base, '0'.repeat(40), root));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CI uses an unconditional aggregate, exact refs, read-only PR permissions and no workflow path filters', () => {
  const source = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(source, /merge_group:/);
  assert.doesNotMatch(source.split('permissions:')[0], /paths(?:-ignore)?:/);
  assert.match(source, /contents: read/);
  assert.doesNotMatch(source, /(?:contents|packages|pull-requests): write/);
  assert.match(source, /test:\n\s+needs: \[changes, linux, unit, e2e, light, platform, scheme, server\]\n\s+if: always\(\)/);
  assert.match(source, /CI_JOB_RESULTS: \$\{\{ toJSON\(needs\) \}\}/);
  assert.match(source, /ref: \$\{\{ inputs\.ref \|\| github\.ref \}\}/);
  assert.match(source, /node scripts\/ci-native-checks\.mjs platform/);
  assert.match(source, /node scripts\/ci-native-checks\.mjs research --no-synthetic/);
});
