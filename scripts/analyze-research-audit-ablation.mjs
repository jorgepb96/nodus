// Offline analysis: confirm cached drafts verbatim against the original audit
// requests, then compare them with the saved audit outputs. No API calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../artifacts/research-harness-ab');
const pointer = JSON.parse(fs.readFileSync(path.join(folder, 'latest.json'), 'utf8'));
const raw = path.join(pointer.root, 'artifacts');
const baseline = JSON.parse(fs.readFileSync(path.join(folder, 'campaign.json'), 'utf8'));
const identity = JSON.parse(fs.readFileSync(path.join(raw, 'v1-no-audit-code-identity.json'), 'utf8'));
const { installRuntimeHooks } = await import(pathToFileURL(path.join(identity.applicationRepo, 'scripts/lib/tsRuntimeHooks.mjs')).href);
assert.equal(JSON.parse(fs.readFileSync(path.join(pointer.root, 'isolation.json'), 'utf8')).root, pointer.root);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-audit-offline-'));
installRuntimeHooks(scratch);
globalThis.fetch = () => { throw new Error('Network forbidden in offline audit replay'); };
const require = createRequire(import.meta.url);
const { researchProseSpans } = require(path.join(identity.applicationRepo, 'shared/researchClaimAudit.ts'));
const requests = fs.readFileSync(path.join(raw, 'request-map.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const byHash = new Map(requests.map(item => [item.requestHash, item]));
const destination = path.join(folder, 'v1-no-audit'); fs.mkdirSync(destination, { recursive: true });
const readMessages = run => run.providerMetrics.flatMap(metric => {
  const request = byHash.get(metric.requestHash);
  const file = request && path.join(raw, `${run.caseId}-${run.mode}-request-${request.id}.json`);
  if (!file || !fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).messages?.filter(message => message.role === 'user').flatMap(message => {
    try { return [JSON.parse(message.content)]; } catch { return []; }
  }) ?? [];
});
function emptyHeadings(markdown) {
  const lines = markdown.split('\n');
  return lines.filter((line, index) => {
    const current = line.match(/^(#{1,6})\s/); if (!current) return false;
    const next = lines.slice(index + 1).find(line => line.trim()); if (!next) return true;
    const following = next.match(/^(#{1,6})\s/);
    return !!following && following[1].length <= current[1].length;
  }).length;
}
function metrics(run) {
  const generation = run.providerMetrics.filter(m => m.provider === 'deepseek');
  return { seconds: run.elapsedMs / 1000, generationCalls: generation.length,
    inputTokens: generation.reduce((sum, m) => sum + (m.inputTokens ?? 0), 0), outputTokens: generation.reduce((sum, m) => sum + (m.outputTokens ?? 0), 0),
    usdUpperBound: run.providerMetrics.reduce((sum, m) => sum + (m.accountedUsd ?? m.maximumUsd ?? 0), 0),
    characters: run.answer.length, emptyHeadings: emptyHeadings(run.answer),
    unresolvedReferences: run.evidence.filter(e => !e.detail && !e.error).length, resolutionErrors: run.evidence.filter(e => e.error).length };
}
const causal = [];
for (const run of baseline.runs.filter(run => run.mode === 'v1')) {
  const stages = run.checkpoint.stages;
  const draft = Object.entries(stages).find(([key]) => key.startsWith('chat.draft:'))?.[1];
  const audited = Object.entries(stages).find(([key]) => key.startsWith('verify-draft:'))?.[1];
  assert.equal(audited, run.answer, 'No later pipeline stage changed the historical audited answer');
  const messages = readMessages(run);
  const writer = messages.find(message => message.contexto_modular_seleccionado);
  assert.ok(writer, `Missing original writer context: ${run.caseId}`);
  const before = draft.trim();
  const spans = researchProseSpans(before);
  const seen = new Set(messages.flatMap(message => message.sentences?.map(sentence => sentence.text) ?? []));
  assert.ok(spans.length > 0 && spans.every(span => seen.has(span.text)), `Draft is not the exact historical audit input: ${run.caseId}`);
  const record = { caseId: run.caseId, exactHistoricalAuditInputConfirmed: true, auditedOutputEqualsHistoricalFinal: true,
    historicalSubmittedSentences: [...seen],
    before: { characters: before.length, emptyHeadings: emptyHeadings(before), markdown: before },
    after: { characters: audited.length, emptyHeadings: emptyHeadings(audited), markdown: audited } };
  causal.push(record);
  fs.writeFileSync(path.join(destination, `${run.caseId}-historical-before-audit.md`), before);
  fs.writeFileSync(path.join(destination, `${run.caseId}-historical-after-audit.md`), audited);
}
fs.writeFileSync(path.join(destination, 'historical-before-after.json'), JSON.stringify(causal, null, 2));
const campaign = JSON.parse(fs.readFileSync(path.join(raw, 'v1-no-audit.json'), 'utf8'));
const gapIds = [...new Set(campaign.runs.flatMap(run => run.evidence.filter(e => e.ref.kind === 'gap' && !e.detail).map(e => e.ref.id)))];
const gapDetails = JSON.parse(execFileSync('python3', ['-c', `
import sqlite3,json,sys
from pathlib import Path
db=sqlite3.connect(Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
found={}
for id in json.load(sys.stdin):
 row=db.execute('SELECT g.id,g.statement,g.nodus_id,w.title,w.authors_json,w.year FROM gaps g JOIN works w ON w.nodus_id=g.nodus_id WHERE g.id=?',(id,)).fetchone()
 if row:found[id]=dict(row)
print(json.dumps(found))
`, path.join(pointer.root, 'profile/nodus.sqlite')], { encoding: 'utf8', input: JSON.stringify(gapIds) }));
const rows = [];
for (const run of campaign.runs) {
  if (run.error) throw new Error(run.error);
  const audited = baseline.runs.find(old => old.caseId === run.caseId && old.mode === 'v1');
  assert.deepEqual(run.context, audited.context, 'Run options differ');
  assert.equal(run.stats.researchTraversal.scopeId, audited.stats.researchTraversal.scopeId, 'Source scope differs');
  assert.ok(!run.aborted && run.answer.trim());
  assert.deepEqual(run.auditAblation, { callsBypassed: 1, finalEqualsPreAuditDraft: true });
  assert.ok(!Object.keys(run.checkpoint.stages).some(key => /^(verify-draft|repair-draft|audit-premises):/.test(key)));
  assert.equal(run.checkpoint.checkpoint.lastAudit, undefined);
  for (const entry of run.evidence) if (entry.ref.kind === 'gap' && !entry.detail && gapDetails[entry.ref.id]) {
    entry.detail = gapDetails[entry.ref.id];
    entry.measurementCorrection = 'Resolved gap metadata using read-only frozen SQLite; generated answer unchanged.';
  }
  rows.push({ caseId: run.caseId, auditOn: metrics(audited), auditOff: metrics(run) });
  fs.writeFileSync(path.join(destination, `${run.caseId}-v1-no-audit.md`), run.answer);
}
const total = key => {
  const entries = rows.map(row => row[key]);
  const sum = field => entries.reduce((sum, row) => sum + row[field], 0);
  return { count: rows.length, meanSeconds: sum('seconds') / rows.length, generationCalls: sum('generationCalls'),
    inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), usdUpperBound: sum('usdUpperBound'),
    emptyHeadings: sum('emptyHeadings'), unresolvedReferences: sum('unresolvedReferences'), resolutionErrors: sum('resolutionErrors') };
};
const summary = { baselineApplicationCommit: identity.baselineCommit, baselineSourcesVerified: true, model: campaign.model,
  complete: !!campaign.completedAt && rows.length === 10, note: 'Fresh calls can vary; the historical before/after replay uses the same original draft and confirms the audit transformation directly.',
  exactHistoricalDraftPairsConfirmed: causal.length, historicalEmptyHeadings: { beforeAudit: causal.reduce((n, row) => n + row.before.emptyHeadings, 0), afterAudit: causal.reduce((n, row) => n + row.after.emptyHeadings, 0) },
  totals: { auditOn: total('auditOn'), auditOff: total('auditOff') }, rows };
fs.writeFileSync(path.join(destination, 'measurements.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(destination, 'campaign.json'), JSON.stringify(campaign, null, 2));
fs.copyFileSync(path.join(raw, 'v1-no-audit-code-identity.json'), path.join(destination, 'code-identity.json'));
let markdown = '# V1 sin auditoría: diez consultas\n\nMisma revisión, corpus, modelo y opciones que en el A/B original. Solo se omite la auditoría del borrador. Las citas siguen pasando por la validación habitual de identificadores autorizados.\n';
for (const item of campaign.cases) {
  const run = campaign.runs.find(run => run.caseId === item.id); if (!run) continue;
  markdown += `\n## ${item.id}\n\n${item.question}\n\n${run.answer}\n`;
}
fs.writeFileSync(path.join(destination, 'answers.md'), markdown);
if (summary.complete) {
  const reviews = JSON.parse(fs.readFileSync(path.join(destination, 'manual-review.json'), 'utf8'));
  assert.equal(reviews.length, 10);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const on = summary.totals.auditOn, off = summary.totals.auditOff;
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V1 sin auditoría · Nodus</title><style>body{max-width:1050px;margin:40px auto;padding:0 24px;font:16px/1.6 system-ui;color:#222;background:#faf9f6}h1{font-size:31px;line-height:1.2}h2{margin-top:30px;font-size:23px}table{width:100%;border-collapse:collapse;background:white;font-size:14px}th,td{text-align:left;padding:12px;border-bottom:1px solid #ddd;vertical-align:top}th{background:#ebe7df}a{color:#245e77}.result{background:#e9eef0;border-left:5px solid #486e7d;padding:18px}small{color:#555}.wrap{overflow:auto}li{margin:9px 0}code{font-size:.9em}</style>
<h1>V1 sin auditoría: resultado de diez consultas</h1><p>18 de octubre de 2026 · DeepSeek Flash · misma revisión y corpus que en el A/B anterior</p>
<p class="result"><strong>Sí: la auditoría del borrador causaba el deterioro de estructura y explicación.</strong> Al omitirla, las diez respuestas terminan completas, sin encabezados vacíos, con fuentes y conclusiones desarrolladas. El tiempo medio baja un ${(100*(1-off.meanSeconds/on.meanSeconds)).toFixed(1)} %. Esto no demuestra que todos los contenidos sean correctos: siguen apareciendo inferencias excesivas y material irrelevante.</p>
<div class="wrap"><table><tr><th>Medida</th><th>V1 auditado, histórico</th><th>V1 sin auditoría, nuevo</th></tr><tr><td>Ejecuciones terminadas</td><td>10</td><td>10</td></tr><tr><td>Tiempo medio</td><td>${on.meanSeconds.toFixed(1)} s</td><td>${off.meanSeconds.toFixed(1)} s</td></tr><tr><td>Llamadas DeepSeek, total</td><td>${on.generationCalls}</td><td>${off.generationCalls}</td></tr><tr><td>Cota conservadora de consumo</td><td>$${on.usdUpperBound.toFixed(3)}</td><td>$${off.usdUpperBound.toFixed(3)}</td></tr><tr><td>Encabezados Markdown vacíos</td><td>${on.emptyHeadings}</td><td>${off.emptyHeadings}</td></tr><tr><td>Referencias sin resolver</td><td>${on.unresolvedReferences}</td><td>${off.unresolvedReferences}</td></tr></table></div><p><small>Las cotas no equivalen a facturación exacta. Las citas válidas no acreditan la inferencia ni la corrección de cada afirmación.</small></p>
<h2>La comprobación más directa</h2><p>Además de las diez llamadas nuevas, se recuperaron los diez borradores originales del A/B. Se verificó que sus fragmentos coincidían literalmente con los enviados entonces al auditor, y que la salida guardada del auditor coincidía con la respuesta final. <strong>Esos mismos borradores tenían cero encabezados vacíos antes de la auditoría y once después.</strong> Esta comparación no depende de que el modelo haya escrito hoy otra respuesta mejor.</p><p>En la consulta de la obra inventada, el borrador original decía que no estaba en el catálogo y que eso no probaba su inexistencia fuera de la biblioteca. La auditoría eliminó esa explicación. En el control de solo textos indexados, con el supervisor desactivado, también desaparecían la identificación de la fuente y las limitaciones. Ambos casos señalan directamente al posprocesado del borrador.</p>
<h2>Revisión de las diez respuestas nuevas</h2><div class="wrap"><table><tr><th>Consulta</th><th>Resultado</th><th>Problema que persiste</th></tr>${reviews.map(r => `<tr><td><a href="${escape(r.caseId)}-v1-no-audit.md">${escape(r.caseId)}</a></td><td>${escape(r.assessment)}</td><td>${escape(r.remainingIssue)}</td></tr>`).join('')}</table></div>
<h2>Qué haría a continuación</h2><p>Retiraría esta transformación destructiva del camino de salida y conservaría las comprobaciones de ámbito y de identificadores de citas. Rediseñaría la verificación para devolver observaciones al agente y revisar el argumento completo, preservando las fuentes, los hechos operativos y las interpretaciones explícitas. Después repetiría la evaluación de calidad factual.</p><p>Hay problemas propios del agente que requieren trabajo separado: en la comparación filtrada confunde citar una obra anterior con demostrar que no se la contradice; en la comprobación del catálogo convierte dos registros recuperados en toda la bibliografía del autor; en la síntesis teórica añade huecos sobre tifus y Picos de Europa que no ayudan a responder. Eliminar la auditoría recupera legibilidad, pero no resuelve esos errores.</p>
<h2>Control del experimento</h2><p>Solo se ejecutó v1, diez veces, con las mismas preguntas, DeepSeek Flash, esfuerzo Standard, web apagada, selección de contexto y presupuesto del A/B. Se restauraron las fuentes de aplicación de <code>${escape(identity.baselineCommit.slice(0,8))}</code> y se comprobaron sus hashes contra los medidos originalmente, para excluir la expansión semántica añadida después. Se reutilizó la copia consistente del corpus; las diez huellas de ámbito coinciden con sus parejas históricas.</p><p>La única intervención fue reemplazar <code>repairResearchDraft</code> por una función identidad dentro del proceso aislado de pruebas. Se comprobó una omisión por respuesta, igualdad entre el borrador previo a esa función y la respuesta publicada, y ausencia de fases de auditoría, reparación y premisas. La validación normal de citas continuó activa. La verificación experimental de main estaba apagada en ambas condiciones. La aplicación del usuario no recibe un ajuste nuevo con este experimento.</p><p>La comparación de latencia y contenido nuevo es histórica: una ejecución por consulta y generación variable. La revisión manual no fue ciega ni produce una tasa de exactitud. El contraste de borradores originales, en cambio, usa los mismos textos antes y después del auditor. Los límites anteriores del corpus se mantienen: originales PDF no copiados al entorno aislado y parte del texto procedente de revisiones indexadas anteriores.</p><p>Se completó la instrumentación de siete referencias a huecos mediante consultas de solo lectura a la copia SQLite; las respuestas no se editaron. Los fallos iniciales de preparación de dependencias del snapshot ocurrieron antes de las llamadas y quedan en el historial.</p>
<h2>Evidencias</h2><ul><li><a href="answers.md">Diez respuestas nuevas completas</a></li><li><a href="historical-before-after.json">Diez borradores originales antes y después de la auditoría</a></li><li><a href="measurements.json">Medidas por consulta y totales</a></li><li><a href="campaign.json">Respuestas, fragmentos citados, trazas y comprobaciones</a></li><li><a href="code-identity.json">Revisión y control de la intervención</a></li></ul></html>`;
  fs.writeFileSync(path.join(destination, 'report.html'), html);
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(JSON.stringify({ complete: summary.complete, exactHistoricalDraftPairsConfirmed: causal.length, historicalEmptyHeadings: summary.historicalEmptyHeadings, totals: summary.totals }, null, 2));
