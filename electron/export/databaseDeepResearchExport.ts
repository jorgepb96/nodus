import AdmZip from 'adm-zip';
import type {
  DatabaseDeepResearchExportOptions,
} from '@shared/databaseDeepResearch';
import {
  redactDatabaseResearchMarkdown,
} from '@shared/databaseDeepResearch';
import {databaseResearchReportDocument,databaseResearchArchiveFiles} from '@shared/databaseResearchExport';
import type {DatabaseResearchSnapshot} from '@shared/databaseResearchEngine';
import * as repo from '../db/databaseDeepResearchRepo';
import {
  captureDatabaseResearchSnapshot,
  relationEdgesForRows,
  rehashDatabaseResearchSnapshot,
  sha256Snapshot,
} from '../ai/databaseDeepResearch';
import { getColumns, listViews } from '../db/databasesRepo';
import { professionalReportPdf } from './professionalReportPdf';
import { markdownToDocx } from './markdownDocx';

export interface DatabaseDeepResearchExport {
  bytes: Buffer;
  extension: 'md' | 'pdf' | 'docx' | 'zip';
  mime: string;
}

function requireDetail(reportId: string) {
  const report = repo.getDatabaseResearchReport(reportId);
  if (!report) throw new Error('Informe de Deep Research no encontrado.');
  const detail = repo.getDatabaseResearchRunDetail(report.runId);
  if (!detail) throw new Error('No se encuentra la ejecución que produjo el informe.');
  return { report, detail };
}

function addStableFile(zip: AdmZip, path: string, data: string | Buffer): void {
  zip.addFile(path, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
  const entry = zip.getEntry(path);
  if (entry) entry.header.time = new Date('1980-01-01T00:00:00.000Z');
}

export async function buildDatabaseDeepResearchExport(
  reportId: string,
  options: DatabaseDeepResearchExportOptions,
): Promise<DatabaseDeepResearchExport> {
  const { report, detail } = requireDetail(reportId);
  if (options.format === 'markdown') {
    return { bytes: Buffer.from(redactDatabaseResearchMarkdown(report.markdown), 'utf8'), extension: 'md', mime: 'text/markdown' };
  }
  if (options.format === 'pdf') {
    return { bytes: await professionalReportPdf(databaseResearchReportDocument(report)), extension: 'pdf', mime: 'application/pdf' };
  }
  if (options.format === 'docx') {
    // Redacted exactly like the Markdown export: the same report text leaves the
    // trusted process either way, so the same rule applies to both.
    return {
      bytes: await markdownToDocx(redactDatabaseResearchMarkdown(report.markdown)),
      extension: 'docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  let rawSnapshots:DatabaseResearchSnapshot[]|undefined;
  if (options.includeSnapshot) {
    const configuredIds = Array.isArray(detail.run.options.databaseIds)
      ? detail.run.options.databaseIds.map(String)
      : [detail.run.databaseId];
    const viewIds = new Set(Array.isArray(detail.run.options.viewIds) ? detail.run.options.viewIds.map(String) : []);
    const filters = detail.run.options.filters && typeof detail.run.options.filters === 'object'
      ? detail.run.options.filters as { query?: unknown; columnIds?: unknown }
      : {};
    const maxRows = Math.max(1, Math.min(500_000, Number(detail.run.budget.maxRows ?? 500_000) || 500_000));
    const snapshots = configuredIds.map((databaseId) => {
      const selectedView = listViews(databaseId).find((view) => viewIds.has(view.id));
      const known = new Set(getColumns(databaseId).map((column) => column.id));
      const columnIds = Array.isArray(filters.columnIds) ? filters.columnIds.map(String).filter((id) => known.has(id)) : [];
      return captureDatabaseResearchSnapshot(databaseId, { maxRows }, undefined, { viewId: selectedView?.id ?? null, query: String(filters.query ?? ''), columnIds });
    });
    if (snapshots.length > 1) {
      const allowedTargets = new Set(snapshots.flatMap((snapshot) => snapshot.rows.map((row) => row.id)));
      for (const snapshot of snapshots) {
        snapshot.relationEdges = relationEdgesForRows(snapshot.databaseId, snapshot.rows, undefined, allowedTargets);
        snapshot.hash = rehashDatabaseResearchSnapshot(snapshot);
      }
    }
    const reportFingerprint = String(report.provenance.snapshotFingerprint ?? detail.run.snapshotFingerprint ?? '');
    if (!reportFingerprint) {
      throw new Error('El informe no conserva una huella de snapshot verificable; regenera la investigación antes de exportar datos brutos.');
    }
    const currentFingerprint = snapshots.length === 1
      ? snapshots[0].hash
      : sha256Snapshot(snapshots.map((snapshot) => ({ databaseId: snapshot.databaseId, hash: snapshot.hash })));
    if (reportFingerprint !== currentFingerprint) {
      throw new Error('Los datos han cambiado desde el informe. Regenera la investigación antes de exportar el snapshot bruto.');
    }
    rawSnapshots = snapshots;
  }
  const zip=new AdmZip();
  for(const [name,content] of Object.entries(databaseResearchArchiveFiles(report,detail,options,rawSnapshots)))addStableFile(zip,name,content);
  return {bytes:zip.toBuffer(),extension:'zip',mime:'application/zip'};
}
