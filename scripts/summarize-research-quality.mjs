// Offline report: native output, actual retrieval trace, non-blind source inspection and durable spending.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
const repo = path.resolve(import.meta.dirname, '..');
const out = path.join(repo, 'artifacts/research-harness-ab/quality');
const authorization = JSON.parse(fs.readFileSync(path.join(out, 'authorization.json')));
const root = authorization.root, raw = path.join(root, 'artifacts');
const read = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : undefined;
const campaigns = fs.readdirSync(raw).filter(name => /^v1-quality-(?:round-[12]|corrections-[12](?:-attempt-[2-9])?)\.json$/.test(name))
  .map(name => read(path.join(raw, name))).filter(Boolean);
const selected = new Map();
for (const campaign of campaigns) for (const run of campaign.runs) {
  const old = selected.get(run.caseId);
  if (!old || old.run.startedAt < run.startedAt) selected.set(run.caseId, { campaign, run });
}
if (selected.size !== 25 || campaigns.some(c => !c.completedAt)) throw new Error('Finish all 25 native cases before reporting');
const adjudication = read(path.join(out, 'manual-review.json')) ?? { status: 'pending', cases: [] };
const audits = ['gemini', 'openrouter'].map(provider => read(path.join(raw, `quality-audit-${provider}.json`))).filter(Boolean);
const auditInputs = read(path.join(raw, 'quality-audit-inputs.json')) ?? [];
const trace = fs.readFileSync(path.join(root, 'profile/embedding-trace.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const words = text => (text.replace(/\[[^\]\n]*\]\([^)]+\)/gu, '').match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) ?? []).length;
const rows = [...selected.values()].sort((a, b) => a.run.caseId.localeCompare(b.run.caseId)).map(({ campaign, run }) => {
  const checkpoint = run.checkpoint?.checkpoint, agenda = checkpoint?.agenda;
  const question = campaign.cases.find(c => c.id === run.caseId).question;
  const start = Date.parse(run.startedAt), end = start + run.elapsedMs;
  const retrieval = trace.filter(t => t.type === 'documentary-retrieval' && Date.parse(t.at) >= start && Date.parse(t.at) <= end);
  const generation = run.providerMetrics.filter(m => m.model !== 'baai/bge-m3');
  const input = auditInputs.find(i => i.caseId === run.caseId);
  const independent = audits.map(audit => {
    const matches = audit.runs.filter(r => r.caseId === run.caseId);
    const last = matches.at(-1);
    return { provider: audit.provider, ...last, inputMatches: Boolean(last && input && last.sourceCommit === campaign.commit && input.answer === run.answer
      && last.inputHash === createHash('sha256').update(JSON.stringify(input)).digest('hex')) };
  }).filter(a => a.caseId);
  return { caseId: run.caseId, question, answer: run.answer, model: campaign.model, commit: campaign.commit,
    startedAt: run.startedAt, seconds: run.elapsedMs / 1000, status: checkpoint?.answerReview?.status,
    error: run.error, aborted: run.aborted, words: words(run.answer), presentation: run.presentation,
    pendingTasks: (agenda?.tasks ?? []).filter(t => ['pending', 'running'].includes(t.status)).length,
    pendingQuestions: (agenda?.questions ?? []).filter(q => q.status === 'pending').length,
    rootQuestions: (agenda?.questions ?? []).filter(q => q.question === question).length,
    questionStates: agenda?.questions, tasks: agenda?.tasks, stopReason: run.researchRun?.stopReason,
    retrieval: { queries: retrieval.length, withVectors: retrieval.filter(t => t.vectorKeys?.length).length,
      withSemanticResults: retrieval.filter(t => t.retrieval?.semantic?.length).length,
      lexicalOnly: retrieval.filter(t => t.limitations?.lexicalOnly).length },
    generationCalls: generation.length, generationUsdUpper: generation.reduce((s, m) => s + (m.accountedUsd ?? m.maximumUsd ?? 0), 0),
    unresolvedReferences: run.evidence.filter(e => !e.detail).length,
    manual: adjudication.cases.find(c => c.caseId === run.caseId), independent,
    sources: (checkpoint?.corpus?.evidence ?? []).map(([id, e]) => ({ id, title: e.label, page: e.pageLabel, citation: e.citation, text: e.summary })),
    researchLog: checkpoint?.corpus?.researchLog, selection: run.context.selection,
  };
});
const budgets = Object.fromEntries(['deepseek', 'openrouter', 'gemini'].map(provider => {
  const ledger = read(path.join(raw, `cost-ledger-${provider}.json`));
  return [provider, { limitUsd: ledger?.limitUsd ?? authorization.providerLimitsUsd[provider],
    committedUsd: (ledger?.calls ?? []).reduce((s, c) => s + (c.actualUsd ?? c.maximumUsd), 0),
    calls: ledger?.calls?.length ?? 0, reservedUnknownCalls: (ledger?.calls ?? []).filter(c => c.actualUsd == null).length }];
}));
const checks = {
  nativeComplete: rows.every(r => !r.error && !r.aborted && r.status === 'verified'),
  noTechnicalStop: rows.every(r => r.stopReason !== 'technical'),
  closedAgenda: rows.every(r => r.pendingTasks === 0 && r.pendingQuestions === 0 && r.rootQuestions === 1),
  referencesResolved: rows.every(r => r.unresolvedReferences === 0),
  reviewedPresentation: rows.every(r => !r.presentation?.unrequestedHeadings && r.presentation?.unreviewedProseDeltas === 0),
  semanticRetrievalMeasured: rows.some(r => r.retrieval.withVectors > 0 && r.retrieval.withSemanticResults > 0),
  budgetsRespected: Object.entries(budgets).every(([provider,b]) => b.committedUsd <= b.limitUsd && b.limitUsd <= authorization.providerLimitsUsd[provider] && b.limitUsd <= .85),
  independentCoverage: rows.every(r => r.independent.some(a => a.inputMatches && !a.error && a.result)),
  manualComplete: adjudication.status === 'complete' && rows.every(r => r.manual?.status === 'pass' && r.manual.runStartedAt === r.startedAt),
};
const report = { format: 'nodus.research-quality-report/1', generatedAt: new Date().toISOString(), authorization, budgets,
  bgeExcluded: true, checks, adjudication, note: 'A native verifier or independent critic approving an answer is not a measured accuracy rate. This is a source-grounded review of the latest attempts for 25 predeclared cases across the recorded code revisions, not universal perfection or a paired provider comparison.', rows };
fs.writeFileSync(path.join(out, 'final-report.json'), JSON.stringify(report, null, 2));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const prose = value => renderToStaticMarkup(React.createElement(ReactMarkdown, { urlTransform: url => /^(?:nodus:\/\/(?:work|passage|idea)\/|https?:\/\/)/u.test(url) ? url : undefined }, value));
const sections = rows.map(row => `<article id="${esc(row.caseId)}"><h2>${esc(row.caseId)}</h2><p class="question">${esc(row.question)}</p><p class="meta">${esc(row.model.provider)} · ${esc(row.model.model)} · ${esc(row.commit.slice(0, 8))} · ${row.seconds.toFixed(1)} s · ${row.words} palabras · ${row.generationCalls} llamadas · $${row.generationUsdUpper.toFixed(4)} · ${esc(row.status)}</p><div class="answer">${prose(row.answer)}</div><p>Agenda: ${row.pendingTasks} tareas pendientes; ${row.pendingQuestions} preguntas pendientes. Recuperación: ${row.retrieval.withVectors}/${row.retrieval.queries} consultas con vectores compatibles.</p><p>${esc(row.manual?.conclusion ?? 'Revisión manual pendiente.')}</p><details><summary>Revisores independientes y adjudicación</summary><pre>${esc(JSON.stringify({ independent: row.independent, manual: row.manual }, null, 2))}</pre></details><details><summary>Pasajes y operaciones reales</summary><pre>${esc(JSON.stringify({ sources: row.sources, researchLog: row.researchLog }, null, 2))}</pre></details><details><summary>Preguntas, tareas y opciones de contexto</summary><pre>${esc(JSON.stringify({ questions: row.questionStates, tasks: row.tasks, selection: row.selection }, null, 2))}</pre></details></article>`).join('');
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nodus Research Harness · validación final</title><style>body{margin:0;background:#f4f5f1;color:#24312b;font:16px/1.65 system-ui}main{max-width:1050px;margin:40px auto;padding:0 24px}article{background:white;border:1px solid #d4ded7;border-radius:16px;padding:28px;margin:24px 0}.question{font-weight:600}.meta{color:#51655b;font-size:14px}.answer{border-left:3px solid #3d7960;padding-left:20px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#edf2ed;padding:16px}summary{cursor:pointer;font-weight:600;margin-top:20px}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:#28694b}.notice{background:#e3ede4;padding:20px;border-radius:12px}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #cdd9d0;padding:8px}</style><main><h1>Nodus Research Harness · 25 consultas</h1><p class="notice">${esc(adjudication.conclusion ?? 'Revisión manual pendiente.')} Las aprobaciones automáticas no miden exactitud universal. Las tandas y repeticiones usan las rutas, modelos y revisiones indicados; esta campaña no aísla una variable ni es un A/B causal entre proveedores.</p><p>Dos tandas de 15 y 10 consultas con DeepSeek directo y a través de OpenRouter, más las repeticiones declaradas, sobre la misma biblioteca congelada y con las restricciones de cada pregunta. Cada respuesta identifica su modelo y revisión del código. Los intentos anteriores y sus fallos se conservan por separado. BGE queda excluido del presupuesto solicitado.</p><table><tr><th>API</th><th>Consumo o reserva USD, todos los intentos</th><th>Techo USD</th></tr>${Object.entries(budgets).map(([p, b]) => `<tr><td>${esc(p)}</td><td>$${b.committedUsd.toFixed(6)}</td><td>$${b.limitUsd.toFixed(2)}</td></tr>`).join('')}</table><details><summary>Comprobaciones y alcance</summary><pre>${esc(JSON.stringify(checks, null, 2))}</pre></details><nav>${rows.map(r => `<a href="#${esc(r.caseId)}">${esc(r.caseId)}</a>`).join('')}</nav>${sections}</main></html>`;
fs.writeFileSync(path.join(out, 'final-report.html'), html);
console.log(JSON.stringify({ checks, budgets, count: rows.length, meanSeconds: rows.reduce((s, r) => s + r.seconds, 0) / rows.length }, null, 2));
