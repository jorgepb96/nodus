import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyResearchQualityAuthorization } from './research-quality-authorization.mjs';
const root = '/isolated-fixture';
const providers = ['deepseek', 'openrouter', 'gemini'];
const original = () => ({ root, userLimitEurPerProvider: 1, bgeExcluded: true, providerLimitsUsd: Object.fromEntries(providers.map(p => [p, .8])) });
const ledgers = Object.fromEntries(providers.map(p => [p, { limitUsd: .8, calls: [{ id: p, maximumUsd: .1, actualUsd: null, reservedAt: '2026-10-18T01:00:00.000Z' }] }]));
verifyResearchQualityAuthorization(original(), root, p => ledgers[p]);
const a = { ...original(), userLimitEurPerProvider: 2, extensions: [{ id: 'human-extension', previousUserLimitEurPerProvider: 1, userLimitEurPerProvider: 2, userInstruction: 'Increase another euro per provider if needed.' }], adjustments: [] };
for (const p of providers) {
  a.adjustments.push({ provider: p, previousLimitUsd: .8, limitUsd: 1.75, authorizedUserLimitEur: 2, authorizationExtensionId: 'human-extension', at: '2026-10-18T02:00:00.000Z', exchangeRate: { usdPerEur: 1.1253 }, calls: 1, callsSha256: createHash('sha256').update(JSON.stringify(ledgers[p].calls)).digest('hex') });
  a.providerLimitsUsd[p] = ledgers[p].limitUsd = 1.75;
}
verifyResearchQualityAuthorization(a, root, p => ledgers[p]);
Object.assign(ledgers.deepseek.calls[0], { actualUsd: .04, inputTokens: 100, outputTokens: 10, settledAt: '2026-10-18T03:00:00.000Z' });
verifyResearchQualityAuthorization(a, root, p => ledgers[p]);
for (const mutate of [x => { x.extensions = []; }, x => { x.userLimitEurPerProvider = 3; }, x => { x.providerLimitsUsd.gemini = 2; }, x => { x.root = '/reset'; }]) {
  const copy = structuredClone(a); mutate(copy); assert.throws(() => verifyResearchQualityAuthorization(copy, root, p => ledgers[p]));
}
const saved = structuredClone(ledgers.openrouter.calls);
ledgers.openrouter.calls[0].maximumUsd = .01;
assert.throws(() => verifyResearchQualityAuthorization(a, root, p => ledgers[p]), /Historical spending changed/);
ledgers.openrouter.calls = []; assert.throws(() => verifyResearchQualityAuthorization(a, root, p => ledgers[p]));
ledgers.openrouter.calls = saved;
verifyResearchQualityAuthorization(a, root, p => ledgers[p]);
console.log('Quality authorization: explicit extension, cumulative bounds, immutable reservation history and legitimate later settlement passed.');
