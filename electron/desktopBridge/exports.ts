import { app } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { renderSavedWritingFiles } from '../export/writingWorkshopExport';
import { renderCompleteGuideFiles } from '../export/completeGuideExport';
import { buildImmersionPdfInput } from '../export/immersionExport';
import { professionalReportPdf } from '../export/professionalReportPdf';
import { getWritingWorkshopDraft } from '../db/writingDraftsRepo';
import { getImmersionSession } from '../db/immersionRepo';
import type { WritingWorkshopExportRequest, DeepResearchArchiveRequest } from '../../shared/types';

export const MOBILE_EXPORT_METHODS = new Set(['exportWritingWorkshopDraft', 'exportDeepResearchArchive', 'exportImmersionSessionPdf']);
const lifetime = 24 * 60 * 60 * 1000;
function directory(vaultId: string): string {
  return path.join(app.getPath('userData'), 'desktop-bridge', 'exports', createHash('sha256').update(vaultId).digest('hex'));
}
function label(value: string): string { return value.normalize('NFKC').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 150) || 'Nodus'; }
function store(vaultId: string, name: string, mime: string, bytes: Buffer, extra: Record<string, unknown> = {}) {
  const folder = directory(vaultId); mkdirSync(folder, { recursive: true, mode: 0o700 });
  for (const file of readdirSync(folder)) if (Date.now() - statSync(path.join(folder, file)).mtimeMs > lifetime) rmSync(path.join(folder, file));
  const id = randomUUID();
  writeFileSync(path.join(folder, id), bytes, { mode: 0o600 });
  const result = { exportId: id, filename: name, mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...extra };
  writeFileSync(path.join(folder, `${id}.json`), JSON.stringify(result), { mode: 0o600 });
  return result;
}
export function readMobileExport(vaultId: string, id: string): { bytes: Buffer; mime: string; filename: string } | null {
  if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(id)) return null;
  const folder = directory(vaultId), file = path.join(folder, id);
  try {
    if (Date.now() - statSync(file).mtimeMs > lifetime) return null;
    const metadata = JSON.parse(readFileSync(`${file}.json`, 'utf8'));
    return { bytes: readFileSync(file), mime: metadata.mime, filename: metadata.filename };
  } catch { return null; }
}
export async function renderMobileExport(vaultId: string, method: string, args: unknown[], emit?: (channel: string, ...args: unknown[]) => void) {
  const requestId = typeof args[0] === 'string' && args.length > 1 ? args[0] : undefined;
  const input = args[requestId ? 1 : 0];
  if (method === 'exportImmersionSessionPdf') {
    if (typeof input !== 'string') throw new Error('invalid_export');
    const session = getImmersionSession(input); if (!session) throw new Error('immersion_not_found');
    return store(vaultId, `${label(session.plan.title)}.pdf`, 'application/pdf', await professionalReportPdf(buildImmersionPdfInput(session)));
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_export');
  if (method === 'exportWritingWorkshopDraft') {
    const request = input as WritingWorkshopExportRequest;
    if (!request.entityId) throw new Error('saved_report_required');
    const saved = getWritingWorkshopDraft(request.entityId); if (!saved) throw new Error('report_not_found');
    const format = request.format ?? 'markdown';
    if (!['markdown', 'pdf', 'docx'].includes(format)) throw new Error('invalid_export_format');
    const base = label(saved.title);
    const files = request.part === 'cheatsheet' && saved.draft.completeGuide
      ? await renderCompleteGuideFiles(saved.draft, { base: `${base}-ficha`, format, part: 'cheatsheet', entityId: saved.id })
      : await renderSavedWritingFiles(saved, base, format);
    if (files.length === 1) {
      const mime = format === 'pdf' ? 'application/pdf' : format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/markdown';
      return store(vaultId, files[0].name, mime, files[0].bytes);
    }
    const zip = new AdmZip(); for (const file of files) zip.addFile(file.name, file.bytes);
    return store(vaultId, `${base}.zip`, 'application/zip', zip.toBuffer());
  }
  const request = input as DeepResearchArchiveRequest;
  if (!Array.isArray(request.ids) || request.ids.some(id => typeof id !== 'string')) throw new Error('invalid_export');
  const format = request.format ?? 'markdown';
  if (!['markdown', 'pdf', 'docx', 'both'].includes(format)) throw new Error('invalid_export_format');
  const ids = [...new Set(request.ids)]; if (!ids.length) throw new Error('reports_required');
  const zip = new AdmZip(), failed: Array<{ title: string; reason: string }> = [];
  let count = 0, done = 0;
  for (const id of ids) {
    const saved = getWritingWorkshopDraft(id);
    if (!saved) throw new Error('report_not_found');
    try {
      for (const file of await renderSavedWritingFiles(saved, `${label(saved.title)}-${id}`, format, request.includeCheatSheets === true)) zip.addFile(file.name, file.bytes);
      count++;
    } catch (error) { failed.push({ title: saved.title, reason: error instanceof Error ? error.message : String(error) }); }
    emit?.('mobile:export:progress', requestId, ++done, ids.length, saved.title);
  }
  if (!count) throw new Error(failed.map(item => item.reason).join('; '));
  return store(vaultId, `Nodus-informes-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip', zip.toBuffer(), { count, failed });
}
