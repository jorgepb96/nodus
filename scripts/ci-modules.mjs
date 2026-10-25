// Self-contained modules that ship beside the application. A pull request that
// changes only these files runs each module's own checks instead of the
// complete application suite; anything else still selects complete coverage.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitAt, discoverTests, executeShard } from './ci-test-shards.mjs';

const any = (...patterns) => file => patterns.some(pattern => typeof pattern === 'string'
  ? file === pattern || (pattern.endsWith('/') && file.startsWith(pattern))
  : pattern.test(file));

// owns: files only this module consumes. The application imports nothing it
// owns, so a change confined to them cannot reach the app build.
// references: a change under one of these paths also runs the module, and any
// test that names one of them runs with it.
// tests: the module's own suites, even when they never name its directory.
// commands: build and packaging steps run after the tests.
// Skill capabilities are not a module: the app imports them at startup.
export const modules = {
  zotero: {
    title: 'Zotero plugin',
    owns: any('zotero-plugin/', 'scripts/fixtures/zotero-embeddings/', 'scripts/prepare-zotero-harrier-onnx.py',
      'scripts/zotero-local-embedding-worker.mjs', '.github/workflows/zotero-plugin.yml',
      /^scripts\/(?:test-zotero-(?:plugin|harrier-graph|memory-lifecycle)|build-zotero-xpi|smoke-zotero-xpi)\.mjs$/),
    references: ['zotero-plugin/'],
    tests: /^scripts\/test-zotero-(?:plugin|harrier-graph|memory-lifecycle)\.mjs$/,
    commands: [['npm', 'run', 'zotero:xpi']],
  },
  office: {
    title: 'Word and LibreOffice copilot',
    owns: any('word-addin/', 'scripts/nodus_copilot.py',
      /^scripts\/(?:test-copilot-addin|test-libreoffice-copilot|test-office-references|e2e-office-references|build-word-addin-icons)\.mjs$/),
    references: ['word-addin', 'nodus_copilot'],
    tests: /^scripts\/test-(?:copilot-addin|libreoffice-copilot|office-references)\.mjs$/,
    commands: [['python3', '-c', 'import ast, sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])', 'scripts/nodus_copilot.py']],
  },
  support: {
    title: 'Nodus Support',
    // The application imports core/ and the trusted keys at startup, and its
    // packaging imports the evidence helper; those remain application changes.
    owns: file => !/^apps\/nodus-support\/(?:core\/|trusted-release-keys\.json$)/.test(file)
      && file !== 'scripts/lib/supportEvidence.mjs' && any('apps/nodus-support/',
      'scripts/configure-support-signing.mjs', 'scripts/generate-support-icons.mjs', 'scripts/prepare-support-recovery.mjs',
      /^scripts\/(?:[^/]*nodus-support[^/]*|support-[^/]+|lib\/support[^/]*)$/,
      /^\.github\/workflows\/(?:nodus-support|release-support|support-signed-qualification)\.yml$/)(file),
    references: ['apps/nodus-support'],
    tests: /^scripts\/test-nodus-support-[^/]+\.mjs$/,
    commands: [['npm', 'run', 'support:typecheck'], ['npm', 'run', 'support:build']],
  },
  extension: {
    title: 'Browser extension',
    // The in-app browser imports lib/ and the icons; those remain application changes.
    owns: file => !/^browser-extension\/(?:lib|icons)\//.test(file) && any('browser-extension/',
      'scripts/build-browser-extension.mjs', /^scripts\/test-browser-extension-[^/]+\.mjs$/)(file),
    references: ['browser-extension'],
    tests: /^scripts\/test-browser-extension-[^/]+\.mjs$/,
    commands: [['npm', 'run', 'browser:zip']],
  },
};
export const moduleNames = Object.keys(modules);
export const ownerOf = file => moduleNames.find(name => modules[name].owns(file));
export const touches = (name, file) => modules[name].owns(file)
  || modules[name].references.some(reference => file.startsWith(reference));

export function changedPaths(base, head, cwd = process.cwd()) {
  const valid = value => typeof value === 'string' && /^[a-f\d]{40}$/i.test(value);
  assert.ok(valid(base) && valid(head), 'CI diff requires immutable commit SHAs');
  const ancestor = execFileSync('git', ['merge-base', base, head], { cwd, encoding: 'utf8' }).trim();
  // --no-renames includes BOTH paths of moves, so moving platform code into a
  // documentation directory cannot hide its deletion from the native checks.
  return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', ancestor, head], { cwd, encoding: 'utf8' })
    .split('\0').filter(Boolean);
}

// A changed test or helper that another suite imports pulls that suite in too.
const mentions = file => [file, ...(file.startsWith('scripts/') ? [`./${file.slice('scripts/'.length)}`] : [])];

export function moduleTests(name, root = process.cwd(), changed = []) {
  const module = modules[name];
  assert.ok(module, `Unknown module ${name}`);
  const needles = [...module.references, ...changed.filter(module.owns).flatMap(mentions)];
  return discoverTests(root).filter(file => module.tests.test(file) || (source =>
    needles.some(needle => source.includes(needle)))(fs.readFileSync(path.join(root, file), 'utf8')));
}

export async function runModule(name, root = process.cwd(), changed = []) {
  const files = moduleTests(name, root, changed);
  assert.ok(files.length > 0, `${name}: no tests selected`);
  const plan = { schemaVersion: 1, commit: commitAt(root), files, shards: [{ index: 1, files }] };
  const report = await executeShard(plan, 1, root, path.join(root, `.ci/reports/module-${name}.json`));
  assert.ok(report.success, `${name}: a selected test failed or was skipped without an allowance`);
  for (const [command, ...args] of modules[name].commands) {
    console.log(`\n$ ${[command, ...args].join(' ')}`);
    execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name] = process.argv.slice(2);
  // Manual, merge-queue and release runs have no diff: references and the
  // module's own suites still select every test that covers it.
  const changed = process.env.CI_BASE && process.env.CI_HEAD ? changedPaths(process.env.CI_BASE, process.env.CI_HEAD) : [];
  const report = await runModule(name, process.cwd(), changed);
  const summary = `### ${modules[name].title}\n\n${report.completed.length} test files passed; `
    + `${modules[name].commands.length} build and packaging checks passed.\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
