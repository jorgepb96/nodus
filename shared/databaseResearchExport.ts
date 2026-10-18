import type {DatabaseDeepResearchExportOptions,DatabaseResearchReport,DatabaseResearchRunDetail} from './databaseDeepResearch';
import {redactDatabaseResearchMarkdown,sanitizeDatabaseResearchExternal} from './databaseDeepResearch';
import {anchoredMarkdown,PROFESSIONAL_REPORT_THEMES,type ProfessionalReportInput} from './professionalReport';
import {sha256Snapshot,type DatabaseResearchSnapshot} from './databaseResearchEngine';

function stableJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    if (seen.has(item)) throw new Error('No se puede exportar una estructura cíclica.');
    seen.add(item);
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  }, 2);
}


function qualityMetrics(report: DatabaseResearchReport): Array<{ value: string; label: string }> {
  const quality = report.quality ?? {};
  const candidates: Array<[string, unknown]> = [
    ['Claims verificados', quality.verifiedClaims],
    ['Artefactos', quality.artifactCount],
    ['Cobertura', quality.coverage],
  ];
  return candidates
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
    .map(([label, value]) => ({ label, value: String(value) }));
}

export function databaseResearchReportDocument(report: DatabaseResearchReport): ProfessionalReportInput {
  const rendered = anchoredMarkdown(redactDatabaseResearchMarkdown(report.markdown), 'database-research');
  return {
    title: report.title,
    subtitle: 'Deep Research verificable de Bases de datos',
    kindLabel: 'Database Deep Research',
    language: String(report.metadata.language ?? 'es'),
    generatedLabel: 'Generado por Nodus',
    generatedAt: report.createdAt,
    objectiveLabel: 'Objetivo',
    objective: report.summary ?? undefined,
    metrics: qualityMetrics(report),
    contentsLabel: 'Contenido y trazabilidad',
    sections: [{
      id: 'database-research-report',
      number: '01',
      title: 'Informe verificable',
      eyebrow: 'Evidencia local · cálculos deterministas',
      html: rendered.html,
      tocChildren: rendered.headings,
    }],
    theme: PROFESSIONAL_REPORT_THEMES.deepResearch,
  };
}


export function databaseResearchArchiveFiles(report:DatabaseResearchReport,detail:DatabaseResearchRunDetail,options:DatabaseDeepResearchExportOptions,snapshots?:DatabaseResearchSnapshot[]):Record<string,string> {
  const files:Record<string,string>={};
  const manifest: Record<string, unknown> = {
    format: 'nodus-database-deep-research-v1',
    reportId: report.id,
    runId: detail.run.id,
    reportType: report.reportType ?? detail.run.reportType ?? report.metadata.reportType ?? 'general',
    language: report.metadata.language ?? detail.run.language ?? 'en',
    promptVersion: report.provenance.promptVersion ?? detail.run.options.promptVersion ?? null,
    createdAt: report.createdAt,
    model: detail.run.model,
    snapshotFingerprint: detail.run.snapshotFingerprint,
    includeSnapshot: options.includeSnapshot === true,
    files: [
      'report.md', 'report.json', 'run.json', 'steps.json', 'claims.json',
      'artifacts.json', 'charts.json',
    ],
  };
  const safeMarkdown = redactDatabaseResearchMarkdown(report.markdown);
  const safeStructured = sanitizeDatabaseResearchExternal(report.structured) as Record<string, unknown>;
  const safeReport = {
    ...report,
    title: redactDatabaseResearchMarkdown(report.title),
    summary: report.summary == null ? null : redactDatabaseResearchMarkdown(report.summary),
    markdown: safeMarkdown,
    bibliography: sanitizeDatabaseResearchExternal(report.bibliography),
    metadata: sanitizeDatabaseResearchExternal(report.metadata),
    structured: safeStructured,
    quality: sanitizeDatabaseResearchExternal(report.quality),
    provenance: sanitizeDatabaseResearchExternal(report.provenance),
  };
  // Steps and claims are separately persisted and may contain model echoes or
  // cell-derived labels even when the structured report was clean. Sanitize the
  // entire object graph before writing each file; only the opt-in snapshot below
  // can contain raw cell values.
  const safeRun = sanitizeDatabaseResearchExternal({
    ...detail.run,
    title: detail.run.title == null ? null : redactDatabaseResearchMarkdown(detail.run.title),
    objective: '[redacted]',
  });
  const safeSteps = sanitizeDatabaseResearchExternal(detail.steps);
  const safeClaims = sanitizeDatabaseResearchExternal(detail.claims);
  const safeCharts = sanitizeDatabaseResearchExternal(report.structured.charts ?? []);
  files['report.md'] = safeMarkdown;
  files['report.json'] = stableJson(safeReport);
  files['run.json'] = stableJson(safeRun);
  files['steps.json'] = stableJson(safeSteps);
  files['claims.json'] = stableJson(safeClaims);
  files['artifacts.json'] = stableJson(safeStructured.evidenceLedger ?? safeStructured.evidence ?? []);
  files['charts.json'] = stableJson(safeCharts);

  if(options.includeSnapshot) {
    if(!snapshots?.length)throw new Error('Descarga las bases de origen para incluir el snapshot bruto.');
    const fingerprint=snapshots.length===1?snapshots[0].hash:sha256Snapshot(snapshots.map(snapshot=>({databaseId:snapshot.databaseId,hash:snapshot.hash})));
    if(String(report.provenance.snapshotFingerprint??detail.run.snapshotFingerprint??'')!==fingerprint)throw new Error('Los datos han cambiado desde el informe. No se puede exportar un snapshot diferente.');
    const raw=snapshots.map(({capturedAt:_capturedAt,...snapshot})=>snapshot);
    files['snapshot/data.json']=stableJson(raw);
    (manifest.files as string[]).push('snapshot/data.json');manifest.snapshotDataHash=sha256Snapshot(raw);
  }
  // The manifest is an external boundary too. Sanitize every value first;
  // restore only the fixed archive member names generated by this function so
  // reproducibility is retained without allowing a user-controlled filename
  // or cell-derived label to escape.
  const safeManifest = sanitizeDatabaseResearchExternal(manifest) as Record<string, unknown>;
  safeManifest.files = [...(manifest.files as string[])];
  files['manifest.json'] = stableJson(safeManifest);
  return files;
}
