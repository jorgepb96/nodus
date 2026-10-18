import { createHash } from 'node:crypto';

const providers = ['deepseek', 'openrouter', 'gemini'];
const uniform = value => Object.fromEntries(providers.map(provider => [provider, value]));
const same = (left, right) => providers.every(provider => left?.[provider] === right?.[provider]);
const euroLimits = value => providers.every(provider => Number.isSafeInteger(value?.[provider]) && value[provider] > 0);

/** One append-only authorization and ledger history across native QA phases.
 * Explicit extensions may differ by provider; no spending or reservations reset. */
export function verifyResearchQualityAuthorization(authorization, root, readLedger) {
  if (authorization.root !== root || authorization.bgeExcluded !== true) throw new Error('Changed authorization');
  const declaredEuros = authorization.userLimitsEur ?? uniform(authorization.userLimitEurPerProvider);
  let ceilings = uniform(1);
  const extensions = new Map();
  for (const extension of authorization.extensions ?? []) {
    const before = extension.previousUserLimitsEur ?? uniform(extension.previousUserLimitEurPerProvider);
    const after = extension.userLimitsEur ?? uniform(extension.userLimitEurPerProvider);
    if (!extension.id || extensions.has(extension.id) || !same(before, ceilings) || !euroLimits(after)
        || !providers.every(provider => after[provider] >= before[provider]) || same(after, before)
        || typeof extension.userInstruction !== 'string' || !extension.userInstruction.trim()
        || !providers.every(provider => Number.isFinite(extension.previousProviderLimitsUsd?.[provider])
          && Number.isFinite(extension.providerLimitsUsd?.[provider])
          && extension.providerLimitsUsd[provider] >= extension.previousProviderLimitsUsd[provider])) throw new Error('Explicit budget extension required');
    extensions.set(extension.id, { ...extension, ceilings: after });
    ceilings = after;
  }
  if (!euroLimits(declaredEuros) || !same(declaredEuros, ceilings)
      || authorization.userLimitsEur && authorization.userLimitEurPerProvider !== undefined
        && !same(declaredEuros, uniform(authorization.userLimitEurPerProvider))) throw new Error('Explicit budget extension required');
  for (const provider of providers) {
    const limit = authorization.providerLimitsUsd[provider];
    const ledger = readLedger(provider) ?? { limitUsd: .8, calls: [] };
    const records = (authorization.adjustments ?? []).filter(row => row.provider === provider);
    let previous = .8, previousCalls = 0;
    const applied = new Set();
    let previousCeiling = 1;
    for (const adjustment of records) {
      const ceiling = adjustment.authorizedUserLimitEur ?? 1;
      const extension = extensions.get(adjustment.authorizationExtensionId);
      const expanded = extension && !applied.has(extension.id) && ceiling === extension.ceilings[provider]
        && extension.previousProviderLimitsUsd[provider] === previous && extension.providerLimitsUsd[provider] === adjustment.limitUsd;
      if (!Number.isFinite(Date.parse(adjustment.at)) || adjustment.previousLimitUsd !== previous
          || ceiling < previousCeiling
          || !(expanded || !adjustment.authorizationExtensionId && ceiling === 1 && adjustment.limitUsd === (previous === .8 ? .85 : previous === .85 ? .9 : -1))
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
      if (expanded) applied.add(extension.id);
      previous = adjustment.limitUsd; previousCalls = adjustment.calls; previousCeiling = ceiling;
    }
    const finalExtension = [...extensions.values()].at(-1);
    if (ledger.limitUsd !== limit || previous !== limit || finalExtension && (limit !== finalExtension.providerLimitsUsd[provider]
        || [...extensions.keys()].some(id => !applied.has(id)))) throw new Error('Changed authorization');
  }
}
