import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyResearchQaPinnedResource } from './lib/researchQaPinnedResource.mjs';

const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-resource-test-')));
function root(name) {
  const p = path.join(parent, name); fs.mkdirSync(p);
  fs.writeFileSync(path.join(p, 'isolation.json'), JSON.stringify({ format: 'nodus.isolated-research-profile/1', root: p }));
  return p;
}
try {
  const sourceRoot = root('source'), targetRoot = root('target');
  const content = Buffer.from('pinned independent OCR fixture');
  const relativePath = 'cache/tessdata/eng.traineddata';
  fs.mkdirSync(path.dirname(path.join(sourceRoot, relativePath)), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, relativePath), content);
  const input = { sourceRoot, targetRoot, relativePath, sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length };
  const result = copyResearchQaPinnedResource(input);
  assert.deepEqual(fs.readFileSync(result.targetPath), content);
  assert.deepEqual(fs.readFileSync(result.sourcePath), content);
  assert.throws(() => copyResearchQaPinnedResource(input), /EEXIST/u);
  assert.throws(() => copyResearchQaPinnedResource({ ...input, targetRoot: sourceRoot }), /Invalid/u);
  for (const relativePath of ['../outside', '/outside', 'cache/../../outside', 'cache\\..\\outside'])
    assert.throws(() => copyResearchQaPinnedResource({ ...input, relativePath }), /Invalid/u);
  const corruptTarget = root('corrupt-target');
  assert.throws(() => copyResearchQaPinnedResource({ ...input, targetRoot: corruptTarget, sha256: '0'.repeat(64) }), /SHA-256/u);
  assert.equal(fs.existsSync(path.join(corruptTarget, relativePath)), false);
  const redirectTarget = root('redirect-target'), outside = path.join(parent, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(redirectTarget, 'cache'), 'dir');
  assert.throws(() => copyResearchQaPinnedResource({ ...input, targetRoot: redirectTarget }), /redirects/u);
  assert.deepEqual(fs.readdirSync(outside), [], 'reject redirect before creating even an outside directory');
  const unmarked = path.join(parent, 'unmarked'); fs.mkdirSync(unmarked);
  assert.throws(() => copyResearchQaPinnedResource({ ...input, sourceRoot: unmarked }));
  const badSource = root('redirect-source'); fs.symlinkSync(path.join(sourceRoot, 'cache'), path.join(badSource, 'cache'), 'dir');
  assert.throws(() => copyResearchQaPinnedResource({ ...input, sourceRoot: badSource }), /path\/size/u);
  console.log('PASS independent resource pins, marked QA roots, no overwrite/fallback, corruption and source/target redirect rejection.');
} finally { fs.rmSync(parent, { recursive: true, force: true }); }
