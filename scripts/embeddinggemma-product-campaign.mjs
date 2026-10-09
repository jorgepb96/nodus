import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createResearchTestRoot } from './research-isolation.mjs';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const profiles = ['multilingual-e5-small-int8', 'gte-multilingual-base-int8', 'bge-m3-q8_0', 'embeddinggemma-2-text-q8-512-v1', 'embeddinggemma-2-text-q8-256-v1'];
const campaignRoot = argument('campaign-root') ?? createResearchTestRoot(), corpusRoot = argument('corpus-root') ?? createResearchTestRoot();
for (const root of [campaignRoot, corpusRoot]) {
  const canonical = fs.realpathSync(root), marker = JSON.parse(fs.readFileSync(path.join(canonical, 'isolation.json'), 'utf8'));
  if (marker.root !== canonical || marker.format !== 'nodus.isolated-research-profile/1') throw new Error('Campaign and corpus must be marked disposable roots');
}
const selected = argument('profiles')?.split(',') ?? profiles;
if (selected.some(id => !profiles.includes(id))) throw new Error('Unknown product profile');
const report = { format: 'nodus.embedding-product-campaign/1', campaignRoot, corpusRoot, budgetUsd: 5, chatModel: 'deepseek-flash', profiles: [], startedAt: new Date().toISOString(), validated: [] };
const file = path.join(campaignRoot, 'artifacts/product-campaign.json');
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2));
for (const profile of selected) {
  const log = path.join(campaignRoot, 'artifacts', `${profile}.product.log`), output = fs.openSync(log, 'a');
  const child = spawn(process.execPath, ['scripts/e2e-embeddinggemma.mjs', `--profile=${profile}`, `--campaign-root=${campaignRoot}`, `--corpus-root=${corpusRoot}`, ...(process.argv.includes('--no-chat') ? ['--no-chat'] : [])], { stdio: ['ignore', output, output] });
  let exit;
  try { exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); }); }
  finally { fs.closeSync(output); }
  const reportPath = [...fs.readFileSync(log, 'utf8').matchAll(/Product report: (.+\/product-report\.json)/g)].at(-1)?.[1];
  const product = reportPath ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
  report.profiles.push({ profile, exit, reportPath, status: product?.completed ? 'executed' : product?.budgetExhausted ? 'budget-pending' : 'failed', failure: product?.failure }); save();
}
report.finishedAt = new Date().toISOString();
const ledger = path.join(campaignRoot, 'artifacts/cost-ledger.json');
if (fs.existsSync(ledger)) { const cost = JSON.parse(fs.readFileSync(ledger, 'utf8')); report.cost = { limitUsd: Math.min(5, cost.limitUsd), calls: cost.calls.length, committedUsd: cost.calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd), 0) }; }
report.pending = ['Cross-platform native/package evidence', 'Twenty source-grounded answer reviews and every grounding failure', 'Evaluate all quality, performance and scope gates before validating any profile'];
save(); console.log(`Product campaign: ${file}`);
if (report.profiles.some(row => row.status === 'failed')) process.exitCode = 1;
