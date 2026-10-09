import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A calendar event's id can arrive by server sync or a merge. The iCloud export wrote
// `${tmpdir}/nodus-${event.id}.ics`, so an id of `/../../../Users/x/Documents/plan` wrote the
// file outside the temporary folder and then opened it.

const root = path.resolve(import.meta.dirname, '..');

test('the calendar export names its temporary file from a cleaned id', async () => {
  const handler = fs.readFileSync(path.join(root, 'electron/ipc/academic.ts'), 'utf8');
  const external = handler.slice(handler.indexOf("'study:planner:event:external'"));
  const body = external.slice(0, external.indexOf("h('study:planner:goal:create'"));
  assert.doesNotMatch(body, /path\.join\(os\.tmpdir\(\), `nodus-\$\{event\.id\}/, 'the raw id is not joined into the path');
  assert.match(body, /tempFileFor\(os\.tmpdir\(\), 'nodus-', event\.id, '\.ics'\)/);
});

test('a crafted id stays inside the folder', async () => {
  const { build } = await import('esbuild');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-temp-name-'));
  try {
    const bundle = path.join(scratch, 'name.cjs');
    await build({ entryPoints: [path.join(root, 'electron/util/tempFileName.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
    const { tempFileFor } = (await import('node:module')).createRequire(import.meta.url)(bundle);
    const folder = os.tmpdir();
    for (const id of ['/../../../Users/x/Documents/plan', '..', 'EVT-a/b\\c', '']) {
      const target = tempFileFor(folder, 'nodus-', id, '.ics');
      assert.equal(path.dirname(target), folder, id);
      assert.match(path.basename(target), /^nodus-[A-Za-z0-9_-]+\.ics$/);
    }
    assert.equal(path.basename(tempFileFor(folder, 'nodus-', 'EVT-01HX', '.ics')), 'nodus-EVT-01HX.ics', 'an ordinary id is kept');
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
