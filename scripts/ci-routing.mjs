// Select jobs, never individual files from the complete Linux test inventory.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { changedPaths, moduleNames, ownerOf, touches } from './ci-modules.mjs';

export { changedPaths };

const keys = ['full', 'light', 'macos', 'windows', 'research', 'scheme', 'server', 'appimage', 'presenter'];
const documentation = file => file === 'README.md' || file === '.github/actions-budget/README.md'
  || /^docs\/.*\.md$/.test(file) || (file.startsWith('site/') && !file.startsWith('site/data/'));
const policy = file => file === '.github/workflows/ci.yml'
  || /^\.github\/workflows\/release(?:-build|-beta|-macos-intel)?\.yml$/.test(file)
  || file.startsWith('.github/actions/ci-linux/')
  || file.startsWith('.github/actions/release-inputs/')
  || /^scripts\/(?:release-linux-|test-release-linux-|verify-linux-release-formats).*\.mjs$/.test(file)
  || /^scripts\/(?:ci-|test-ci-).*\.mjs$/.test(file);
const dependencies = file => /^package(?:-lock)?\.json$/.test(file) || file === '.npmrc';
const native = file => dependencies(file) || /^(?:electron|build|runtime|shared)\//.test(file)
  || /\.(?:c|cc|cpp|h|hpp|m|mm|swift|rs|ps1|bat|cmd|plist)$/.test(file)
  || /(?:^|[\/.-])(?:macos|windows|darwin|win32)(?:[\/.-]|$)/.test(file)
  || /^(?:vite.*\.ts|tsconfig.*\.json)$/.test(file)
  || /^scripts\/.*(?:mac|windows|win32|native|update|appimage|presenter|apple-calendar|system-audio|capability|cross-repo|research|zotero-mcp|release|packag|electron)/i.test(file)
  || /^\.github\/workflows\/(?:release|research|presenter|appimage|backfill)/.test(file);
const research = file => dependencies(file) || /^runtime\/zotero-mcp\//.test(file)
  || /^scripts\/.*(?:research|zotero-mcp|documentary|searxng)/.test(file)
  || /^src\/.*(?:Research|Documentary)/.test(file)
  || file === 'electron/bootstrap.ts' || /^electron\/qa\//.test(file)
  || /^electron\/(?:ai\/.*(?:research|documentary)|db\/documentary|citations\/|workers\/(?:background|documentary))/.test(file)
  || /^shared\/research/.test(file) || /^\.github\/workflows\/research-corpus-/.test(file);

export function routeChanges(files, mode = 'pull_request') {
  assert.ok(['pull_request', 'manual', 'release', 'merge_group'].includes(mode), 'Unknown CI mode');
  assert.ok(Array.isArray(files) && files.every(file => typeof file === 'string' && file.length > 0
    && !file.startsWith('/') && !file.split('/').includes('..')), 'Invalid changed paths');
  const selected = Object.fromEntries(keys.map(key => [key, false]));
  let selectedModules = [];
  // Manual runs exercise every lane without publishing. Release builds already
  // own native packaging; their Linux gate still includes every specialist check.
  if (mode !== 'pull_request' || files.length === 0 || files.some(policy)) {
    for (const key of keys) selected[key] = key !== 'light';
    if (mode === 'release') selected.macos = selected.windows = false;
    selectedModules = moduleNames;
  } else {
    // Files a self-contained module owns select only that module's checks;
    // the application lanes follow every other non-documentation file.
    const app = files.filter(file => !documentation(file) && !ownerOf(file));
    selectedModules = files.some(dependencies) ? moduleNames
      : moduleNames.filter(name => files.some(file => touches(name, file)));
    selected.full = app.length > 0;
    selected.light = !selected.full && files.some(documentation);
    // Specialist lanes follow application files only.
    files = app;
    selected.macos = selected.windows = files.some(native);
    selected.research = files.some(research);
    selected.scheme = files.some(file => /^tools\/(?:scheme-scan|reaction-index)\//.test(file)
      || file === '.github/workflows/scheme-scan.yml');
    selected.server = files.some(file => dependencies(file) || /^(?:server|src\/serverWeb|shared|electron\/db)\//.test(file)
      || file === '.dockerignore' || /^tsconfig.*\.json$/.test(file)
      || ['LICENSE', 'SOURCE_CODE.md', 'THIRD_PARTY_NOTICES.md', 'scripts/generate-third-party-licenses.mjs'].includes(file)
      || file === 'vite.server-web.config.ts' || file === '.github/workflows/nodus-server-image.yml'
      || /^scripts\/(?:test-nodus-server|test-server-vectors|lib\/nodusServer|verify-server-container)/.test(file));
    selected.appimage = files.some(file => dependencies(file) || file.startsWith('build/')
      || /^scripts\/.*(?:appimage|release-assets)/.test(file)
      || /^\.github\/workflows\/(?:.*release|appimage-updates)\.yml$/.test(file));
    selected.presenter = files.some(file => dependencies(file) || /^electron\/toolkit\/presenter\//.test(file)
      || file === 'electron/extraction/pdfjsLoader.ts' || /^shared\/presenter/.test(file)
      || /^scripts\/(?:test|verify)-presenter-lan\./.test(file) || file === '.github/workflows/presenter-lan.yml');
  }
  // Native research runtime coverage accompanies every research change, even
  // when its only changed source is shared data or a regression fixture.
  if (selected.research) selected.macos = selected.windows = mode !== 'release';
  return { ...selected, modules: selectedModules, matrix: { include: [
    ...(selected.macos ? [{ os: 'macos-latest' }] : []),
    ...(selected.windows ? [{ os: 'windows-latest' }] : []),
  ] } };
}

export function assertJobResults(selection, jobs) {
  const expected = {
    changes: true,
    quality: selection.full,
    linux: selection.full,
    unit: selection.full,
    e2e: selection.full,
    light: selection.light,
    platform: selection.macos || selection.windows,
    scheme: selection.scheme,
    server: selection.server,
    modules: selection.modules.length > 0,
  };
  for (const [name, required] of Object.entries(expected)) {
    assert.equal(jobs[name]?.result, required ? 'success' : 'skipped',
      `${name}: expected ${required ? 'success' : 'skipped'}, received ${jobs[name]?.result}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'gate') {
    const selection = JSON.parse(process.env.CI_SELECTION);
    assertJobResults(selection, JSON.parse(process.env.CI_JOB_RESULTS));
    console.log('All selected checks passed; every unselected job was skipped.');
  } else {
    const mode = process.env.CI_MODE || 'pull_request';
    const files = mode === 'pull_request' ? changedPaths(process.env.CI_BASE, process.env.CI_HEAD) : [];
    const selection = routeChanges(files, mode);
    console.log(JSON.stringify({ files, selection }, null, 2));
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(selection)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}\n`).join('')
        + `selection=${JSON.stringify(selection)}\n`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `### Selected CI checks\n\nMode: ${mode}. Changed paths: ${files.length}.\n\n`
        + keys.map(key => `- ${key}: ${selection[key] ? 'selected' : 'not needed'}\n`).join('')
        + `- modules: ${selection.modules.join(', ') || 'not needed'}\n`);
    }
  }
}
