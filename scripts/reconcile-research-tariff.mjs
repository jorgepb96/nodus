import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEEPSEEK_QA_TARIFF, deepseekUsageUpperBound } from './research-deepseek-tariff.mjs';
import { ResearchCostLedger } from './research-cost-ledger.mjs';

export function reconcileResearchTariff(root) {
  const canonical = fs.realpathSync(root);
  const marker = JSON.parse(fs.readFileSync(path.join(canonical, 'isolation.json')));
  assert.equal(marker.root, canonical); assert.equal(marker.format, 'nodus.isolated-research-profile/1');
  const file = path.join(canonical, 'artifacts/cost-ledger.json');
  const metricsFile = path.join(canonical, 'artifacts/provider-metrics.jsonl');
  assert(fs.realpathSync(file).startsWith(canonical + path.sep));
  assert(fs.realpathSync(metricsFile).startsWith(canonical + path.sep));
  const lock = fs.openSync(`${file}.lock`, 'wx', 0o600);
  try {
    const bytes = fs.readFileSync(file), sha256 = createHash('sha256').update(bytes).digest('hex');
    const ledger = new ResearchCostLedger(file).read();
    const metricsBytes = fs.readFileSync(metricsFile);
    const metrics = metricsBytes.toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const total = () => ledger.calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd), 0);
    const before = total(), changes = [];
    for (const call of ledger.calls) {
      if (call.provider !== 'deepseek' || call.model !== 'deepseek-flash' || call.actualUsd === null || call.accountingReconciliation) continue;
      const rows = metrics.filter(row => row.reservation === call.id && row.accounting === 'peak_price_upper_bound');
      if (rows.length !== 1) continue;
      const row = rows[0];
      assert.equal(row.accountedUsd, call.actualUsd); assert.equal(row.inputTokens, call.inputTokens); assert.equal(row.outputTokens, call.outputTokens);
      const peak = (call.inputTokens * DEEPSEEK_QA_TARIFF.peakInputPerMillion + call.outputTokens * DEEPSEEK_QA_TARIFF.peakOutputPerMillion) / 1e6;
      assert(Math.abs(call.actualUsd - peak) < 1e-12, 'only verified peak-formula settlements can be reconciled');
      const bound = deepseekUsageUpperBound(call.inputTokens, call.outputTokens, call.reservedAt, call.settledAt);
      if (bound.usd >= call.actualUsd) continue;
      changes.push({ id: call.id, previousUpperBoundUsd: call.actualUsd, verifiedUpperBoundUsd: bound.usd });
      call.accountingReconciliation = { originalAccountedUsd: call.actualUsd, previousLedgerSha256: sha256, tariff: DEEPSEEK_QA_TARIFF.version,
        method: 'cache-miss upper bound over the entire recorded request interval' };
      call.actualUsd = bound.usd;
    }
    const backup = `cost-ledger-before-tariff-${sha256}.json`;
    if (changes.length) {
      fs.writeFileSync(path.join(canonical, 'artifacts', backup), bytes, { flag: 'wx', mode: 0o600 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(ledger, null, 2), { mode: 0o600 }); fs.renameSync(temporary, file);
    }
    return { format: 'nodus.research-tariff-reconciliation/1', root: canonical, tariff: DEEPSEEK_QA_TARIFF,
      previousLedgerSha256: sha256, providerMetricsSha256: createHash('sha256').update(metricsBytes).digest('hex'),
      backup: changes.length ? backup : null, limitUsd: ledger.limitUsd, calls: ledger.calls.length,
      unknownReservationsRetained: ledger.calls.filter(call => call.actualUsd === null).length,
      committedBeforeUsd: before, committedAfterUsd: total(), changes,
      note: 'No budget increase, reset, removed call or released unknown reservation. Both settlements are conservative accounting bounds, not a billing invoice.' };
  } finally { fs.closeSync(lock); fs.unlinkSync(`${file}.lock`); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv.find(value => value.startsWith('--root='))?.slice(7);
  assert(root, 'a marked campaign --root is required');
  const report = reconcileResearchTariff(root);
  fs.writeFileSync(path.join(report.root, `artifacts/tariff-reconciliation-${report.previousLedgerSha256}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(report.root, 'artifacts/tariff-reconciliation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ calls: report.calls, reconciled: report.changes.length, unknownReservationsRetained: report.unknownReservationsRetained,
    limitUsd: report.limitUsd, committedBeforeUsd: report.committedBeforeUsd, committedAfterUsd: report.committedAfterUsd }));
}
