import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { app, safeStorage } from 'electron';
import { researchIntentCases } from './research-intent-cases.mjs';

const root = fs.realpathSync(process.env.NODUS_ISOLATED_ROOT), repo = process.env.NODUS_AB_REPO;
app.setName('Nodus');
for (const [key, relative] of Object.entries({ userData: 'profile', sessionData: 'sessions', temp: 'tmp', crashDumps: 'crashes', logs: 'logs' })) {
  fs.mkdirSync(path.join(root, relative), { recursive: true }); app.setPath(key, path.join(root, relative));
}
process.env.NODUS_QA_ROOT = root;
process.env.NODUS_QA_DATABASE_AUDIT_LOG = path.join(root, 'profile/database-access.jsonl');
app.getAppPath = () => repo;
const { installRuntimeHooks } = await import(path.join(repo, 'scripts/lib/tsRuntimeHooks.mjs'));
installRuntimeHooks(path.join(root, 'profile'), { app, safeStorage });
const require = createRequire(import.meta.url), load = file => require(path.join(repo, file));
const model = JSON.parse(process.env.NODUS_AB_CHAT_MODEL);
const file = process.env.NODUS_QUALITY_OUTPUT;
const identity = createHash('sha256').update(JSON.stringify(researchIntentCases)).digest('hex');
const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { format: 'nodus.research-turn-intent/1', commit: process.env.NODUS_AB_GIT, model, identity, startedAt: new Date().toISOString(), runs: [] };
if (report.commit !== process.env.NODUS_AB_GIT || report.identity !== identity || JSON.stringify(report.model) !== JSON.stringify(model)) throw new Error('Do not mix routing campaigns');
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 });
app.whenReady().then(async () => {
  try {
    load('electron/db/settingsRepo.ts').updateSettings({ chatModel: model, synthesisModel: model, chatReasoning: 'off', researchWebSearch: 'off', researchAnswerVerification: 'off', promptLanguage: 'es' });
    const { getActiveVault } = load('electron/vaults/vaultRegistry.ts');
    const { withResearchHarness } = load('electron/ai/researchHarnessRuntime.ts');
    const { planResearchTurn } = load('electron/ai/researchTurnPlanner.ts');
    const vaultId = getActiveVault().id;
    const scope = { id: 'synthetic-intent-scope', vaultId, notebookId: null, documents: [], changes: { added: [], removed: [] } };
    for (let attempt = 1; attempt <= 3; attempt++) for (const item of researchIntentCases) {
      if (report.runs.some(run => run.caseId === item.id && run.attempt === attempt && !run.error)) continue;
      fs.writeFileSync(path.join(root, 'artifacts/active-case.json'), JSON.stringify({ caseId: `intent-${item.id}-${attempt}`, mode: 'routing' }));
      const row = { caseId: item.id, attempt, expectedNeedsSources: item.needsSources, startedAt: new Date().toISOString() }, start = Date.now();
      try {
        const context = { mode: 'chat', vaultId, scopeId: scope.id, notebookId: null, objective: item.messages.at(-1).content, model, effort: 'off', capabilities: { ideas: true, documents: true, indexed: true, web: false, attachments: [], skills: [], restricted: true } };
        const result = await withResearchHarness({ request: { messages: item.messages }, context, scope, validate: () => {} }, async signal => ({ plan: await planResearchTurn(item.messages, model, signal) }));
        row.plan = result.plan; row.modelCalls = result.researchRun.usage.modelCalls ?? 0;
        row.pass = row.plan.needsSources === item.needsSources && (item.needsSources || row.plan.queries.length === 0 && !row.plan.exploration?.length);
      } catch (error) { row.error = error instanceof Error ? error.message : String(error); row.pass = false; }
      row.elapsedMs = Date.now() - start; report.runs.push(row); save();
      console.log(`QA: intent ${item.id} attempt ${attempt}: ${row.pass ? 'pass' : 'FAIL'}`);
      if (row.error?.includes('budget_exhausted')) throw new Error('Original routing budget exhausted; do not reset');
    }
    report.completedAt = new Date().toISOString(); save();
    app.exit(report.runs.every(row => row.pass) ? 0 : 2);
  } catch (error) { report.fatal = error instanceof Error ? error.message : String(error); save(); console.log('QA: fatal ' + report.fatal); app.exit(1); }
});
