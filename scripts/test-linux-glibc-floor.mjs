// The Linux build must start on the oldest still-supported Ubuntu LTS.
//
// 5.7.1's Linux build came off ubuntu-latest and compiled better-sqlite3 against
// glibc 2.39, so it needed GLIBC_2.38 and died at launch on Ubuntu 22.04 and
// Debian 12. Nothing in the repo tied the runner to the systems the app runs on;
// the AppImage catalogue found it. This file holds both halves: the job that
// builds Linux, and the check that reads what it built.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import {
  ALLOWED,
  FLOOR,
  compareVersions,
  excess,
  requiredVersions,
  verifyLinuxGlibc,
} from './verify-linux-glibc.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(path.join(repoRoot, '.github/workflows/release-build.yml'), 'utf8');

// `objdump -T` for a better_sqlite3.node compiled on 24.04: glibc 2.38+ headers
// route strtol to __isoc23_strtol, and GCC 14's libstdc++ adds newer GLIBCXX.
const BETTER_SQLITE3_ON_2404 = `
build/Release/better_sqlite3.node:     file format elf64-x86-64

DYNAMIC SYMBOL TABLE:
0000000000000000      DF *UND*\t0000000000000000 (GLIBC_2.2.5) memcpy
0000000000000000      DF *UND*\t0000000000000000 (GLIBC_2.38) __isoc23_strtol
0000000000000000      DF *UND*\t0000000000000000 (GLIBC_2.29) log
0000000000000000      DF *UND*\t0000000000000000 (GLIBCXX_3.4.32) _ZSt21__glibcxx_assert_failPKciS0_S0_
0000000000000000 g    DF .text\t0000000000000042  Base        napi_register_module_v1
`;

// The newest versions the same module needed when compiled on stock 22.04
// with clang 15, measured for this change.
const BETTER_SQLITE3_ON_2204 = `
0000000000000000      DF *UND*\t0000000000000000 (GLIBC_2.2.5) memcpy
0000000000000000      DF *UND*\t0000000000000000 (GLIBC_2.34) __libc_start_main
0000000000000000      DF *UND*\t0000000000000000 (GLIBCXX_3.4.29) _ZNSt7__cxx1112basic_stringIcSt11char_traitsIcESaIcEE10_M_replaceEmmPKcm
`;

test('versions compare numerically, not as text', () => {
  assert.equal(compareVersions('2.9', '2.35'), -1);
  assert.equal(compareVersions('2.38', '2.35'), 1);
  assert.equal(compareVersions('2.2.5', '2.35'), -1);
  assert.equal(compareVersions('3.4.30', '3.4.30'), 0);
  assert.equal(compareVersions('3.4.31', '3.4.30'), 1);
});

test('THE REGRESSION: the 5.7.1 better-sqlite3 is refused', () => {
  assert.deepEqual(requiredVersions(BETTER_SQLITE3_ON_2404), { GLIBC: '2.38', GLIBCXX: '3.4.32' });
  assert.deepEqual(excess(requiredVersions(BETTER_SQLITE3_ON_2404)), [
    'GLIBC_2.38 > GLIBC_2.35',
    'GLIBCXX_3.4.32 > GLIBCXX_3.4.30',
  ]);
});

test('the same module built on 22.04 passes', () => {
  assert.deepEqual(excess(requiredVersions(BETTER_SQLITE3_ON_2204)), []);
});

test('versions a library defines are not requirements', () => {
  const provider = '0000000000001000 g    DF .text\t0000000000000010 (GLIBC_2.40) something_it_exports\n';
  assert.deepEqual(requiredVersions(provider), {});
});

test('the floor is Ubuntu 22.04: glibc 2.35 and GCC 12 libstdc++', () => {
  assert.deepEqual(FLOOR, { GLIBC: '2.35', GLIBCXX: '3.4.30' });
});

function fakeBuild(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nodus-linux-glibc-'));
  const outputs = new Map();
  for (const [relative, output] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(12)]));
    outputs.set(full, output);
  }
  writeFileSync(path.join(root, 'resources.pak'), 'not an ELF file');
  return { root, objdump: (file) => outputs.get(file) };
}

test('a build with a too-new native module fails and names the file', () => {
  const { root, objdump } = fakeBuild({
    'nodus': BETTER_SQLITE3_ON_2204,
    'resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node': BETTER_SQLITE3_ON_2404,
  });
  try {
    const result = verifyLinuxGlibc(root, { objdump });
    assert.equal(result.scanned, 2);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /better_sqlite3\.node: GLIBC_2\.38 > GLIBC_2\.35/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('known third-party files over the floor are reported, not fatal', () => {
  const tooNew = '0 DF *UND*\t0 (GLIBC_2.39) memfd_create\n';
  const { root, objdump } = fakeBuild({
    'resources/app.asar.unpacked/node_modules/@github/copilot-linux-x64/webview/node_modules/@webviewjs/webview-linux-x64-gnu/webview.linux-x64-gnu.node': tooNew,
    'resources/app.asar.unpacked/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-resources/zsh/bin/zsh': tooNew,
  });
  try {
    const result = verifyLinuxGlibc(root, { objdump });
    assert.deepEqual(result.failures, []);
    assert.equal(result.tolerated.length, ALLOWED.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the Linux release job builds on 22.04 with clang 15 and checks its output', () => {
  const jobs = load(workflow).jobs, linux = jobs['linux-unpacked'];
  assert.equal(linux['runs-on'], 'ubuntu-22.04');
  assert.equal(jobs['linux-format']['runs-on'], 'ubuntu-22.04');
  assert.equal(linux.env.CC, 'clang-15');
  assert.equal(linux.env.CXX, 'clang++-15');
  const steps = linux.steps.map(step => step.run || '');
  assert.ok(steps.some(command => command.includes('electron-builder --linux --x64 --dir')));
  assert.ok(steps.includes('node scripts/verify-linux-glibc.mjs release/linux-unpacked'));
  assert.ok(steps.indexOf('node scripts/verify-linux-glibc.mjs release/linux-unpacked')
    < steps.indexOf('node scripts/release-linux-artifact.mjs pack'), 'every installer inherits the verified glibc floor');
});
