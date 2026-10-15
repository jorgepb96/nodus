// A suite that imports node:test and re-runs itself under Electron-as-Node must not hand the child
// the runner's private NODE_TEST_CONTEXT. Inherited, the child writes its results as binary events
// into ordinary stdout, and a failure there cannot be read (see lib/tsRuntimeHooks.mjs). The shared
// re-run is requireElectronRuntime; a suite that spawns Electron itself must strip the variable.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = path.dirname(fileURLToPath(import.meta.url));

test('no node:test suite re-runs itself under Electron with the runner context', () => {
  const offenders = fs.readdirSync(scripts)
    .filter((name) => /^test-.*\.mjs$/.test(name))
    .filter((name) => {
      const source = fs.readFileSync(path.join(scripts, name), 'utf8');
      if (!/from ['"]node:test['"]/.test(source)) return false;
      // The self re-run: a guard on the script's own flag that launches Electron as Node.
      const rerun = /if \(!process\.argv\.includes\(['"]--[^'"]+['"]\)\) \{[\s\S]{0,600}?electron[\s\S]{0,400}?ELECTRON_RUN_AS_NODE/.exec(source);
      return Boolean(rerun) && !/NODE_TEST_CONTEXT/.test(source);
    });
  assert.deepEqual(offenders, [], 'use requireElectronRuntime from scripts/lib/tsRuntimeHooks.mjs');
});
