// Official USD cache-miss/peak rates verified on 2026-10-07:
// https://api-docs.deepseek.com/quick_start/pricing/
// The release notice dates these rates to 2026-09-10 04:00 UTC.
// https://api-docs.deepseek.com/news/news260910/
export const DEEPSEEK_QA_TARIFF = Object.freeze({
  version: 'deepseek-flash-usd-2026-10-07',
  effectiveFrom: '2026-09-10T04:00:00.000Z',
  verifiedUntil: '2026-10-08T00:00:00.000Z',
  peakInputPerMillion: .3, peakOutputPerMillion: 1.2,
  source: 'https://api-docs.deepseek.com/quick_start/pricing/',
});

/** Conservative cost when usage is known. Count every input token as a cache
 * miss. Use peak prices if any part of the entire request interval overlaps
 * a weekday peak; Chinese holidays can only lower that price. Invalid, reversed
 * or unverified intervals keep peak accounting. Never release unknown usage. */
export function deepseekUsageUpperBound(inputTokens, outputTokens, startedAt, finishedAt) {
  if (![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid tariff usage');
  const start = Date.parse(startedAt), end = Date.parse(finishedAt);
  const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
  let peak = true;
  if (utc.test(startedAt) && utc.test(finishedAt) && Number.isFinite(start) && Number.isFinite(end) && start <= end
      && start >= Date.parse(DEEPSEEK_QA_TARIFF.effectiveFrom) && end < Date.parse(DEEPSEEK_QA_TARIFF.verifiedUntil)) {
    peak = false;
    const dayMs = 86400000, hourMs = 3600000;
    for (let day = Math.floor(start / dayMs) * dayMs; day <= end; day += dayMs) {
      if ([0, 6].includes(new Date(day).getUTCDay())) continue;
      if ([[1, 4], [6, 10]].some(([from, to]) => start < day + to * hourMs && end >= day + from * hourMs)) { peak = true; break; }
    }
  }
  const multiplier = peak ? 1 : .5;
  return { usd: (inputTokens * DEEPSEEK_QA_TARIFF.peakInputPerMillion + outputTokens * DEEPSEEK_QA_TARIFF.peakOutputPerMillion) * multiplier / 1e6,
    peak, version: DEEPSEEK_QA_TARIFF.version };
}
