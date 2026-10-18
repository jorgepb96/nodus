import { readFile } from 'node:fs/promises';
import { compareResearchHarness } from './lib/researchHarnessEvaluation.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/compare-research-harness.mjs <paired-review.json>');
console.log(JSON.stringify({ cases: compareResearchHarness(JSON.parse(await readFile(file, 'utf8'))),
  decision: 'Review each mode, cost/latency deltas and blind preferences before rollout. Offline counts alone do not authorize a default change.' }, null, 2));
