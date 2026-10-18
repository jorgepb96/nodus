// Offline measurements only. Quality preferences require reading the paired
// answers against their actual cited excerpts; source counts are not accuracy.
import fs from 'node:fs';
import path from 'node:path';
const pointer = JSON.parse(fs.readFileSync('artifacts/research-harness-ab/latest.json', 'utf8'));
const root = process.argv[2] ?? pointer.artifacts;
const campaign = JSON.parse(fs.readFileSync(path.join(root, 'campaign.json'), 'utf8'));
const rows = campaign.runs.map(run => {
  const metrics = run.providerMetrics ?? [];
  const generation = metrics.filter(m => m.provider === 'deepseek');
  const references = run.evidence ?? [];
  const text = (run.answer ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const lines = (run.answer ?? '').split('\n');
  const emptyHeadings = lines.filter((line, index) => {
    const heading = line.match(/^(#{1,6})\s/); if (!heading) return false;
    const next = lines.slice(index + 1).find(next => next.trim());
    if (!next) return true;
    const following = next.match(/^(#{1,6})\s/);
    // A title introducing child sections is populated, not an empty heading.
    return !!following && following[1].length <= heading[1].length;
  }).length;
  const tasks = run.researchRun?.tasks ?? [];
  return { caseId: run.caseId, mode: run.mode, seconds: run.elapsedMs / 1000, words: text.trim().split(/\s+/u).filter(Boolean).length,
    generationCalls: generation.length, embeddingCalls: metrics.filter(m => m.provider === 'openrouter').length,
    inputTokens: generation.reduce((n, m) => n + (m.inputTokens ?? 0), 0), outputTokens: generation.reduce((n, m) => n + (m.outputTokens ?? 0), 0),
    accountedUsdUpperBound: metrics.reduce((n, m) => n + (m.accountedUsd ?? m.maximumUsd ?? 0), 0),
    references: references.length, unresolvedReferences: references.filter(ref => !ref.detail && !ref.error).length,
    resolutionErrors: references.filter(ref => ref.error).length,
    rounds: run.stats?.researchTraversal?.rounds, evidenceBytes: run.stats?.researchTraversal?.evidenceTokens,
    stopReason: run.researchRun?.stopReason, taskCount: tasks.length, complementaryTasks: tasks.filter(t => t.priority > 1).map(t => ({ question: t.question, action: t.action, status: t.status })),
    emptyHeadings, error: run.error ?? null };
});
const total = mode => {
  const selected = rows.filter(row => row.mode === mode);
  const sum = key => selected.reduce((n, row) => n + (row[key] ?? 0), 0);
  return { completed: selected.filter(row => !row.error).length, attempts: selected.length,
    totalSeconds: sum('seconds'), meanSeconds: sum('seconds') / selected.length, generationCalls: sum('generationCalls'),
    embeddingCalls: sum('embeddingCalls'), inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'),
    accountedUsdUpperBound: sum('accountedUsdUpperBound'), unresolvedReferences: sum('unresolvedReferences'), emptyHeadings: sum('emptyHeadings'), meanWords: sum('words') / selected.length };
};
const measured = { corpus: campaign.corpus, model: campaign.model, verification: campaign.verification, retrieval: campaign.retrieval,
  totals: { legacy: total('legacy'), v1: total('v1') }, rows };
fs.writeFileSync(path.join(root, 'measurements.json'), JSON.stringify(measured, null, 2));
let markdown = '# Research Chat: A/B de diez consultas\n\n';
markdown += 'Mismo corpus congelado, DeepSeek Flash, esfuerzo Standard, web desactivada y presupuesto de recuperación idéntico. Orden alternado entre parejas. La verificación experimental de main está desactivada en ambos; v1 conserva su propia auditoría. Los importes son cotas conservadoras de consumo, no facturación exacta.\n\n';
markdown += '| Consulta | Modo | Segundos | Llamadas DeepSeek | Palabras | Citas no resueltas | Cota USD |\n|---|---|---:|---:|---:|---:|---:|\n';
for (const item of campaign.cases) for (const mode of ['legacy', 'v1']) {
  const row = rows.find(row => row.caseId === item.id && row.mode === mode); if (!row) continue;
  markdown += `| ${item.id} | ${mode} | ${row.seconds.toFixed(1)} | ${row.generationCalls} | ${row.words} | ${row.unresolvedReferences} | ${row.accountedUsdUpperBound.toFixed(5)} |\n`;
}
markdown += '\nEl número de citas, la longitud y las autoevaluaciones del agente no acreditan por sí solos calidad o corrección.\n';
for (const item of campaign.cases) {
  markdown += `\n## ${item.id}\n\n${item.question}\n\nCriterios: ${item.facets.join('; ')}.\n`;
  for (const mode of ['legacy', 'v1']) {
    const run = campaign.runs.find(run => run.caseId === item.id && run.mode === mode); if (!run) continue;
    fs.writeFileSync(path.join(root, `${item.id}-${mode}.md`), run.answer ?? run.error ?? '');
    markdown += `\n### ${mode}\n\n${run.answer || run.error || '(Sin respuesta)'}\n`;
  }
}
fs.writeFileSync(path.join(root, 'paired-answers.md'), markdown);
fs.writeFileSync('artifacts/research-harness-ab/measurements.json', JSON.stringify(measured, null, 2));
console.log(JSON.stringify(measured.totals, null, 2));
