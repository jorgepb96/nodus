import { createHash } from 'node:crypto';

/** One append-only authorization and ledger history across native QA phases. */
export function verifyResearchQualityAuthorization(authorization, root, readLedger) {
  const eur = authorization.userLimitEurPerProvider;
  if (authorization.root !== root || ![1, 2].includes(eur) || authorization.bgeExcluded !== true) throw new Error('Changed authorization');
  const extensions = authorization.extensions ?? [];
  const extension = extensions[0];
  if (eur === 1 && extensions.length || eur === 2 && (extensions.length !== 1 || !extension?.id
      || extension.previousUserLimitEurPerProvider !== 1 || extension.userLimitEurPerProvider !== 2
      || typeof extension.userInstruction !== 'string' || !extension.userInstruction.trim())) throw new Error('Explicit budget extension required');
  for (const provider of ['deepseek', 'openrouter', 'gemini']) {
    const limit = authorization.providerLimitsUsd[provider];
    const ledger = readLedger(provider) ?? { limitUsd: .8, calls: [] };
    const records = (authorization.adjustments ?? []).filter(row => row.provider === provider);
    let previous = .8, previousCalls = 0;
    for (const adjustment of records) {
      const ceiling = adjustment.authorizedUserLimitEur ?? 1;
      const expanded = ceiling === 2 && eur === 2 && adjustment.authorizationExtensionId === extension.id && adjustment.limitUsd === 1.75;
      if (!Number.isFinite(Date.parse(adjustment.at)) || adjustment.previousLimitUsd !== previous
          || !(expanded || ceiling === 1 && adjustment.limitUsd === (previous === .8 ? .85 : previous === .85 ? .9 : -1))
          || adjustment.exchangeRate?.usdPerEur !== 1.1253
          || adjustment.limitUsd / adjustment.exchangeRate.usdPerEur * 1.21 * 1.03 >= ceiling
          || !Number.isSafeInteger(adjustment.calls) || adjustment.calls < previousCalls || ledger.calls.length < adjustment.calls) throw new Error('Changed authorization');
      // A reservation in flight at authorization may settle normally afterward.
      // Reconstruct its original shape; never discard IDs, maxima or prior usage.
      const original = ledger.calls.slice(0, adjustment.calls).map(call => {
        if (!call.settledAt || Date.parse(call.settledAt) <= Date.parse(adjustment.at)) return call;
        const row = { ...call, actualUsd: null };
        delete row.inputTokens; delete row.outputTokens; delete row.settledAt;
        return row;
      });
      if (createHash('sha256').update(JSON.stringify(original)).digest('hex') !== adjustment.callsSha256) throw new Error('Historical spending changed');
      previous = adjustment.limitUsd; previousCalls = adjustment.calls;
    }
    if (ledger.limitUsd !== limit || previous !== limit || eur === 2 && limit !== 1.75) throw new Error('Changed authorization');
  }
}
