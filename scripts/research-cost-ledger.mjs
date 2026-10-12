import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Explicit campaign authorization may reach USD 8 (7 October 2026). Existing
 * defaults remain USD 7; each ledger's own limitUsd is still its authorization. */
export const RESEARCH_BUDGET_CEILING_USD = 8;
export const RESEARCH_DEFAULT_BUDGET_USD = 7;
const DEFAULT_APPROVED_MODELS = Object.freeze([
  Object.freeze({ provider: 'deepseek', model: 'deepseek-flash' }),
  Object.freeze({ provider: 'openrouter', model: 'baai/bge-m3' }),
]);

/** Single campaign ledger shared by every test/provider; reservations are durable
 * before network dispatch and unknown/failed usage keeps the full reservation. */
export class ResearchCostLedger {
  constructor(file, limit = RESEARCH_DEFAULT_BUDGET_USD, { approvedModels = DEFAULT_APPROVED_MODELS } = {}) {
    if (!Number.isFinite(limit) || limit <= 0 || limit > RESEARCH_BUDGET_CEILING_USD) throw new Error('Invalid research budget');
    if (!Array.isArray(approvedModels) || !approvedModels.length || approvedModels.some(item => !item
      || typeof item.provider !== 'string' || !item.provider || typeof item.model !== 'string' || !item.model)) throw new Error('Invalid approved research models');
    this.file = file; this.limit = limit;
    this.approvedModels = approvedModels.map(item => Object.freeze({ provider: item.provider, model: item.model }));
  }
  read() {
    const ledger = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { limitUsd: this.limit, calls: [] };
    if (!Number.isFinite(ledger.limitUsd) || ledger.limitUsd <= 0 || ledger.limitUsd > RESEARCH_BUDGET_CEILING_USD || !Array.isArray(ledger.calls)) throw new Error('Invalid research ledger');
    const ids = new Set();
    for (const call of ledger.calls) {
      if (typeof call.id !== 'string' || ids.has(call.id) || !Number.isFinite(call.maximumUsd) || call.maximumUsd <= 0
        || (call.actualUsd !== null && (!Number.isFinite(call.actualUsd) || call.actualUsd < 0 || call.actualUsd > call.maximumUsd))) throw new Error('Invalid research ledger');
      ids.add(call.id);
    }
    return ledger;
  }
  reserve({ provider, model, maximumUsd }) {
    if (!this.approvedModels.some(item => item.provider === provider && item.model === model)) throw new Error('Unapproved research model');
    if (!Number.isFinite(maximumUsd) || maximumUsd <= 0) throw new Error('A conservative cost bound is required');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const lock = fs.openSync(`${this.file}.lock`, 'wx', 0o600);
    try {
      const ledger = this.read();
      const committed = ledger.calls.reduce((total, call) => total + (call.actualUsd ?? call.maximumUsd), 0);
      if (committed + maximumUsd >= Math.min(this.limit, ledger.limitUsd)) throw new Error('Research cost budget would be exhausted');
      const id = randomUUID();
      ledger.calls.push({ id, provider, model, maximumUsd, reservedAt: new Date().toISOString(), actualUsd: null });
      const temporary = `${this.file}.${id}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(ledger, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
      return id;
    } finally { fs.closeSync(lock); fs.unlinkSync(`${this.file}.lock`); }
  }
  settle(id, { actualUsd, inputTokens, outputTokens }) {
    const lock = fs.openSync(`${this.file}.lock`, 'wx', 0o600);
    try {
      const ledger = this.read();
      const call = ledger.calls.find(call => call.id === id);
      if (!call || !Number.isFinite(actualUsd) || actualUsd < 0 || actualUsd > call.maximumUsd) throw new Error('Invalid cost settlement');
      if (![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid token usage');
      if (call.actualUsd !== null) {
        if (call.actualUsd !== actualUsd || call.inputTokens !== inputTokens || call.outputTokens !== outputTokens) throw new Error('Conflicting cost settlement');
        return;
      }
      Object.assign(call, { actualUsd, inputTokens, outputTokens, settledAt: new Date().toISOString() });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(ledger, null, 2), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } finally { fs.closeSync(lock); fs.unlinkSync(`${this.file}.lock`); }
  }
}
