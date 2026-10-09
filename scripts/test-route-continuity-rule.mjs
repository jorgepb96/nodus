// ROUTE_CONTINUITY_SYSTEM_RULE told the model that if a carried structure changes between steps it
// should "say so explicitly and justify it; otherwise the route is rejected". The check reads no
// prose: a carried intermediate that differs (a `constitution-only` link) is refused whatever the
// step says, and the correction asks for the same name or an added step. The rule promised an
// escape the checker does not offer.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(os.tmpdir(), 'route-continuity-rule-'));
await build({ entryPoints: ['shared/moleculeInspection.ts'], outfile: path.join(dir, 'inspection.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { ROUTE_CONTINUITY_SYSTEM_RULE, normalizeRouteAudit, brokenRouteLinks } = await import(pathToFileURL(path.join(dir, 'inspection.mjs')));
test.after(() => rm(dir, { recursive: true, force: true }));

test('the continuity rule offers no justification escape, because the check reads no prose', () => {
  const step = (index) => ({ index, reaction: 'a>>b', ok: true, balanced: true, chargeBalanced: true, differences: [], unspecifiedStereocentres: 0, reactants: [], agents: [], products: [] });
  const audit = normalizeRouteAudit({ continuous: false, blocked: [], steps: [step(0), step(1)],
    links: [{ from: 0, to: 1, ok: false, reason: 'constitution-only', carried: [], skeletonOnly: [{ product: 'C[C@H](O)CC', reactant: 'C[C@@H](O)CC', skeletonSmiles: 'CC(O)CC' }] }] });
  // brokenRouteLinks takes the audit alone: nothing a step says can lift the refusal.
  assert.equal(brokenRouteLinks(audit).length, 1);
  assert.doesNotMatch(ROUTE_CONTINUITY_SYSTEM_RULE, /justify it/);
  assert.match(ROUTE_CONTINUITY_SYSTEM_RULE, /that change is a step of its own/);
});
