import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'src/components/NodeDetailPanel.tsx'), 'utf8');

assert.match(
  source,
  /page === null && !sourceRef && !onOpen/,
  'an exact attachment remains actionable even when it has no PDF page',
);
assert.match(
  source,
  /onOpen\(sourceRef \?\? nodusId, location, quote\)/,
  'custom evidence navigators receive the exact source rather than the work id',
);
assert.match(
  source,
  /openEvidenceAtPage\(nodusId, \{ location, sourceRef, pageNumber: page \}\)/,
  'academic navigation transports the structured attachment locator without requiring a page',
);

console.log('test-evidence-location-ui: OK');
