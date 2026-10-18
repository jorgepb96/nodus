import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyResearchQualityAuthorization } from './research-quality-authorization.mjs';
const root = '/isolated-fixture';
const providers = ['deepseek', 'openrouter', 'gemini'];
const original = () => ({ root, userLimitEurPerProvider: 1, bgeExcluded: true, providerLimitsUsd: Object.fromEntries(providers.map(p => [p, .8])) });
const ledgers = Object.fromEntries(providers.map(p => [p, { limitUsd: .8, calls: [{ id: p, maximumUsd: .1, actualUsd: null, reservedAt: '2026-10-18T01:00:00.000Z' }] }]));
verifyResearchQualityAuthorization(original(), root, p => ledgers[p]);
const a = { ...original(), userLimitEurPerProvider: 2, extensions: [{ id: 'human-extension', previousUserLimitEurPerProvider: 1, userLimitEurPerProvider: 2, userInstruction: 'Increase another euro per provider if needed.', previousProviderLimitsUsd: Object.fromEntries(providers.map(p => [p, .8])), providerLimitsUsd: Object.fromEntries(providers.map(p => [p, 1.75])) }], adjustments: [] };
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

const asymmetric = structuredClone(a);
delete asymmetric.userLimitEurPerProvider;
asymmetric.userLimitsEur = { deepseek: 4, openrouter: 3, gemini: 3 };
asymmetric.extensions.push({ id: 'second-human-extension', previousUserLimitsEur: Object.fromEntries(providers.map(p => [p, 2])), userLimitsEur: asymmetric.userLimitsEur, userInstruction: 'Add EUR 2 to DeepSeek and EUR 1 to the others.', previousProviderLimitsUsd: { ...a.providerLimitsUsd }, providerLimitsUsd: { deepseek: 3.5, openrouter: 2.65, gemini: 2.65 } });
for (const p of providers) {
  asymmetric.adjustments.push({ provider: p, previousLimitUsd: 1.75, limitUsd: asymmetric.extensions[1].providerLimitsUsd[p], authorizedUserLimitEur: asymmetric.userLimitsEur[p], authorizationExtensionId: 'second-human-extension', at: '2026-10-18T04:00:00.000Z', exchangeRate: { usdPerEur: 1.1253 }, calls: 1, callsSha256: createHash('sha256').update(JSON.stringify(ledgers[p].calls)).digest('hex') });
  asymmetric.providerLimitsUsd[p] = ledgers[p].limitUsd = asymmetric.extensions[1].providerLimitsUsd[p];
}
verifyResearchQualityAuthorization(asymmetric, root, p => ledgers[p]);
for (const mutate of [x => x.extensions.pop(), x => { x.extensions[1].previousUserLimitsEur.deepseek = 1; }, x => { x.userLimitsEur.openrouter = 4; }, x => { x.extensions[1].userInstruction = ''; }, x => { x.extensions[1].id = x.extensions[0].id; }, x => { x.adjustments.at(-1).authorizationExtensionId = 'unknown'; }, x => { x.extensions[1].providerLimitsUsd.gemini = 3; x.providerLimitsUsd.gemini = 3; x.adjustments.at(-1).limitUsd = 3; }]) {
  const copy = structuredClone(asymmetric); mutate(copy); assert.throws(() => verifyResearchQualityAuthorization(copy, root, p => ledgers[p]));
}
console.log('Asymmetric cumulative provider extensions and missing/tampered authorization rejected.');
