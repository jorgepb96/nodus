// Offline measurements and a reviewable ten-case report. No provider requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
const repo = path.resolve(import.meta.dirname, '..');
const folder = path.join(repo, 'artifacts/research-harness-ab');
const pointer = JSON.parse(fs.readFileSync(path.join(folder, 'latest.json'), 'utf8'));
const raw = path.join(pointer.root, 'artifacts');
const validationRound = process.argv.find(arg => arg.startsWith('--validation-round='))?.slice('--validation-round='.length);
if (validationRound && !['1', '2'].includes(validationRound)) throw new Error('Validation round must be 1 or 2');
const quality = process.argv.includes('--quality');
const scenario = quality && validationRound ? `v1-quality-${process.argv.includes('--corrections')?'corrections':'round'}-${validationRound}` : validationRound ? `v1-validation-${process.argv.includes("--corrections") ? "corrections" : "round"}-${validationRound}` : process.argv.includes('--format-replay') ? 'v1-format-replay' : 'v1-coherent-review';
const campaign = JSON.parse(fs.readFileSync(path.join(raw, `${scenario}.json`), 'utf8'));
assert.ok(campaign.completedAt && campaign.runs.length === campaign.cases.length);
assert.ok(campaign.runs.every(run => !run.error && !run.aborted));
const dest = path.join(folder, ...(quality ? ['quality'] : []), scenario); fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(path.join(raw, `${scenario}.json`), path.join(dest, 'campaign.json'));
fs.copyFileSync(path.join(raw, `${scenario}-code-identity.json`), path.join(dest, 'code-identity.json'));
const headings = answer => (answer.match(/^\s*#{1,6}\s+.+$/gm) ?? []).length;
const metrics = run => {
  const calls = run.providerMetrics.filter(metric => metric.model !== 'baai/bge-m3');
  const review = run.checkpoint?.checkpoint.answerReview;
  const prose = (run.answer ?? '').replace(/\[[^\]\n]*\]\([^)]+\)/gu, '').replace(/[#*_]/gu, '');
  const selection = run.context.selection;
  return { caseId: run.caseId, seconds: run.elapsedMs / 1000, generationCalls: calls.length,
    embeddingCalls: run.providerMetrics.filter(metric => metric.model === 'baai/bge-m3').length,
    inputTokens: calls.reduce((sum, item) => sum + (item.inputTokens ?? 0), 0), outputTokens: calls.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0),
    usdUpperBound: calls.reduce((sum, item) => sum + (item.accountedUsd ?? item.maximumUsd ?? 0), 0),
    characters: (run.answer ?? '').length, unrequestedHeadings: Number(Boolean(run.presentation?.unrequestedHeadings)), markdownHeadings: headings(run.answer ?? ''),
    proseWords: prose.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)?.length ?? 0,
    disabledIdeasRespected: selection.layers?.ideas !== false || !run.references.some(ref => ref.kind === 'idea'),
    emptyCitationGroups: (run.answer?.match(/\([\s;,]+\)|;\s*;|;\s*\)/gu) ?? []).length,
    unresolvedReferences: run.evidence.filter(item => !item.detail).length,
    reviewStatus: review?.status, reviewAttempts: review?.reviews.reduce((sum, item) => sum + item.attempts.length, 0),
    unreviewedProseDeltas: run.presentation?.unreviewedProseDeltas };
};
const rows = campaign.runs.map(metrics);
const totals = { count: rows.length, meanSeconds: rows.reduce((sum, row) => sum + row.seconds, 0) / rows.length,
  verified: rows.filter(row => row.reviewStatus === 'verified').length, limited: rows.filter(row => row.reviewStatus === 'limited').length };
for (const key of ['generationCalls','embeddingCalls','inputTokens','outputTokens','usdUpperBound','markdownHeadings','unrequestedHeadings','unresolvedReferences','unreviewedProseDeltas']) totals[key] = rows.reduce((sum, row) => sum + row[key], 0);
const measurements = { model: campaign.model, commit: campaign.commit, startedAt: campaign.startedAt, completedAt: campaign.completedAt,
  replay: campaign.replay, note: 'Current V1 includes semantic expansion, coherent review and prose presentation. Historical comparisons use older source revisions and fresh nondeterministic generations. A positive reviewer verdict is not an independently measured accuracy score.', totals, rows };
fs.writeFileSync(path.join(dest, 'measurements.json'), JSON.stringify(measurements, null, 2));
const stages = (run, prefix) => Object.entries(run.checkpoint.stages).filter(([key]) => key.startsWith(prefix + ':')).map(([,value]) => value);
const trace = run => ({ researchLog: run.checkpoint?.checkpoint.corpus?.researchLog, selection: run.context?.selection,
  queries: (run.stats?.researchTraversal?.queries ?? []).map(({ query, candidates, partial }) => ({ query, candidates, partial })),
  agenda: run.checkpoint.checkpoint.agenda?.questions,
  retrieved: (run.checkpoint.checkpoint.corpus?.evidence ?? []).map(([id, item]) => ({ id, title: item.label, authors: item.authors, year: item.year, page: item.pageLabel, citation: item.citation, text: item.summary })) });
const answers = [];
for (const run of campaign.runs) {
  const question = campaign.cases.find(item => item.id === run.caseId).question;
  fs.writeFileSync(path.join(dest, `${run.caseId}-answer.md`), run.answer + '\n');
  fs.writeFileSync(path.join(dest, `${run.caseId}-draft.md`), stages(run, 'chat.draft')[0] + '\n');
  const revised = Object.entries(run.checkpoint.stages).filter(([key]) => /^revise-whole-answer-v\d+:/.test(key)).map(([,value]) => value);
  if (revised.length) fs.writeFileSync(path.join(dest, `${run.caseId}-revision.md`), revised.join('\n\n') + '\n');
  fs.writeFileSync(path.join(dest, `${run.caseId}-review.json`), JSON.stringify({ question, metrics: metrics(run), review: run.checkpoint.checkpoint.answerReview, evidence: run.evidence, trace: trace(run) }, null, 2));
  answers.push(`## ${run.caseId}\n\n${question}\n\n${run.answer}`);
}
fs.writeFileSync(path.join(dest, 'answers.md'), answers.join('\n\n---\n\n') + '\n');
const maps = fs.readFileSync(path.join(raw, 'request-map.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const hashes = new Set(campaign.runs.flatMap(run => run.providerMetrics.map(metric => metric.requestHash)));
fs.writeFileSync(path.join(dest, 'request-map.jsonl'), maps.filter(row => row.at >= campaign.startedAt && row.at <= campaign.completedAt && hashes.has(row.requestHash)).map(row => JSON.stringify(row)).join('\n') + '\n');
fs.writeFileSync(path.join(dest, 'provider-metrics.jsonl'), campaign.runs.flatMap(run => run.providerMetrics).map(row => JSON.stringify(row)).join('\n') + '\n');
const manualFile = path.join(dest, 'manual-review.json');
const manual = fs.existsSync(manualFile) ? JSON.parse(fs.readFileSync(manualFile, 'utf8')) : { status: 'pending', note: 'Do not interpret automatic verdicts as factual accuracy.' };
const previousFile = path.join(folder, 'v1-no-audit/campaign.json');
const previous = fs.existsSync(previousFile) ? JSON.parse(fs.readFileSync(previousFile, 'utf8')) : { runs: [] };
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const prose = text => renderToStaticMarkup(React.createElement(ReactMarkdown, { urlTransform: () => undefined, components: { img: ({ alt }) => React.createElement('span', null, alt ?? '') } }, String(text ?? '')));
const sections = campaign.runs.map(run => {
  const row = metrics(run), old = previous.runs.find(item => item.caseId === run.caseId);
  return `<article id="${escape(run.caseId)}"><h2>${escape(run.caseId)}</h2><p class="question">${escape(campaign.cases.find(item => item.id === run.caseId).question)}</p><p class="meta">${row.seconds.toFixed(1)} s · ${row.generationCalls} llamadas de generación · $${row.usdUpperBound.toFixed(4)} (cota) · revisión ${escape(row.reviewStatus)}</p><div class="answer">${prose(run.answer)}</div><details><summary>Diagnóstico y evidencia recuperada</summary><pre>${escape(JSON.stringify({ review: run.checkpoint.checkpoint.answerReview, evidence: run.evidence, trace: trace(run) }, null, 2))}</pre></details><details><summary>Borrador anterior a la revisión</summary><div>${prose(stages(run, 'chat.draft')[0])}</div></details>${old ? `<details><summary>Respuesta histórica sin auditoría (otra revisión del código)</summary><div>${prose(old.answer)}</div></details>` : ''}</article>`;
}).join('\n');
const replayBanner = campaign.replay ? '<p class="note">Repetición de los mismos diez borradores y fuentes, reutilizando etapas terminadas. Se invalida la revisión final y toda respuesta modificada requiere una nueva comprobación. Estas latencias con caché no se comparan con las de una ejecución nueva.</p>' : '';
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nodus · revisión coherente</title><style>body{font:17px/1.7 system-ui;background:#f6f5f1;color:#202a29;margin:0}main{max-width:1000px;margin:50px auto;padding:0 24px}h1{font-size:32px}h2{font-size:22px}article{background:white;padding:30px;margin:24px 0;border-radius:16px;border:1px solid #ddd}.meta,small{color:#526864}.question{font-weight:600}.answer{border-left:3px solid #4c8072;padding-left:22px;overflow-wrap:anywhere}summary{cursor:pointer;font-weight:600;margin-top:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#eef2ef;padding:18px}nav{display:flex;flex-wrap:wrap;gap:12px}a{color:#25614e}.note{padding:18px;background:#e7eeea;border-radius:12px}</style><main><h1>Nodus Research Harness · ${totals.count} consultas</h1>${replayBanner}<p class="note">${totals.verified}/${totals.count} respuestas con revisión positiva; ${totals.limited}/${totals.count} salidas de límite de comprobación. Media ${totals.meanSeconds.toFixed(1)} s, ${totals.generationCalls} llamadas de generación, cota de coste $${totals.usdUpperBound.toFixed(4)}. ${totals.markdownHeadings} encabezados Markdown, ${totals.unresolvedReferences} referencias sin resolver y ${totals.unreviewedProseDeltas} deltas de prosa sin revisar.</p><p>Estos datos no miden una tasa de exactitud. ${validationRound ? process.argv.includes('--corrections') ? 'Repetición de preguntas de la tanda correspondiente mediante investigaciones completas nuevas; sin reutilizar borradores ni etapas terminadas.' : 'Consultas nuevas y conversaciones nuevas, con el modelo declarado y una biblioteca congelada. No hay replay de borradores.' : 'El modo actual incorpora además expansión semántica y el nuevo formato; la comparación histórica no aísla una única variable.'}</p><p class="note">${escape(manual.conclusion ?? "Revisión manual pendiente: no interpretar las aprobaciones automáticas como exactitud.")}</p><nav>${campaign.runs.map(run => `<a href="#${escape(run.caseId)}">${escape(run.caseId)}</a>`).join('')}</nav><details><summary>Revisión manual</summary><pre>${escape(JSON.stringify(manual, null, 2))}</pre></details>${sections}<small>Modelo ${escape(JSON.stringify(campaign.model))} · código ${escape(campaign.commit)} · corpus congelado ${escape(JSON.stringify(campaign.corpus))}</small></main></html>`;
fs.writeFileSync(path.join(dest, 'report.html'), html);
console.log(JSON.stringify(measurements, null, 2));
