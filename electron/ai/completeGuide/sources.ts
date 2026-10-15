/**
 * Study-vault side of the complete guide's selection: the readable-source catalog,
 * the texts of the resolved sources, and the pre-flight preview (snapshot totals,
 * unavailable sources and the cost/time estimate) the composer shows before a job
 * is queued. The expansion and the snapshot themselves are pure (shared/completeGuide).
 */
import type { StudyAssistantSourceOption } from '@shared/studyAssistant';
import type { StudySourceOrganization } from '@shared/studySourceTree';
import {previewCompleteGuideSnapshot} from '@shared/completeGuide/preview';
import type { CompleteGuidePreview, CompleteGuidePreviewRequest } from '@shared/completeGuide/preview';
import { resolveCompleteGuideSelection } from '@shared/completeGuide/selection';
import { buildCompleteGuideSnapshot, type CompleteGuideSnapshot, type CompleteGuideSourceText } from '@shared/completeGuide/snapshot';
import {
  COMPLETE_GUIDE_SOURCE_KINDS,
  normalizeCompleteGuideConfig,
  type CompleteGuideCatalogSource,
  type CompleteGuideConfig,
  type CompleteGuideResolvedSelection,
  type CompleteGuideSourceKind,
} from '@shared/completeGuide/types';
import { getDb } from '../../db/database';
import { getStudyWorkspace } from '../../db/studyOrgRepo';
import { listStudyAssistantSourceOptions } from '../studySearch';

type Row = Record<string, unknown>;

export function completeGuideOrganization(): StudySourceOrganization {
  const workspace = getStudyWorkspace();
  return { courses: workspace.courses, subjects: workspace.subjects, folders: workspace.folders, topics: workspace.topics };
}

function unavailableReason(option: StudyAssistantSourceOption): CompleteGuideCatalogSource['unavailableReason'] {
  if (option.available !== false) return undefined;
  if (option.unavailableReason === 'excluded') return 'excluded';
  if (option.indexStatus === 'pending' || option.indexStatus === 'indexing') return 'not_indexed';
  return 'no_content';
}

/** Readable sources (materials, notes, transcripts) with every placement. */
export function listCompleteGuideCatalog(): CompleteGuideCatalogSource[] {
  const transcripts = new Map((getDb().prepare('SELECT id, recording_id, kind FROM study_transcripts').all() as Row[])
    .map((row) => [String(row.id), { recordingId: String(row.recording_id), kind: String(row.kind) as CompleteGuideCatalogSource['transcriptKind'] }]));
  return listStudyAssistantSourceOptions()
    .filter((option): option is StudyAssistantSourceOption & { kind: CompleteGuideSourceKind } => (COMPLETE_GUIDE_SOURCE_KINDS as readonly string[]).includes(option.kind))
    .map((option) => {
      const transcript = option.kind === 'transcript' ? transcripts.get(option.sourceId) : undefined;
      const reason = unavailableReason(option);
      return {
        sourceKey: option.sourceKey,
        kind: option.kind,
        sourceId: option.sourceId,
        title: option.title,
        placements: (option.placements?.length ? option.placements : [option.scope]).map(({ courseId, subjectId, folderId, topicId }) => ({ courseId, subjectId, folderId, topicId })),
        available: option.available !== false,
        ...(reason ? { unavailableReason: reason } : {}),
        ...(transcript ? { recordingId: transcript.recordingId, transcriptKind: transcript.kind } : {}),
        ...(option.fileName ? { fileName: option.fileName } : {}),
        ...(option.indexStatus ? { indexStatus: option.indexStatus } : {}),
      };
    });
}

/** Load the full text of every resolved source, exactly as stored in the vault. */
export function loadCompleteGuideTexts(resolved: CompleteGuideResolvedSelection): CompleteGuideSourceText[] {
  const db = getDb();
  const material = db.prepare('SELECT visual_description, extracted_text, updated_at FROM study_materials WHERE id = ? AND deleted_at IS NULL');
  const document = db.prepare('SELECT content_markdown, updated_at FROM study_docs WHERE id = ? AND deleted_at IS NULL');
  const transcript = db.prepare('SELECT updated_at FROM study_transcripts WHERE id = ?');
  const segments = db.prepare('SELECT id, t_start, t_end, text FROM study_transcript_segments WHERE transcript_id = ? ORDER BY t_start, position');
  const texts: CompleteGuideSourceText[] = [];
  for (const source of resolved.sources) {
    if (source.kind === 'material') {
      const row = material.get(source.sourceId) as Row | undefined;
      if (!row) continue;
      const text = [String(row.visual_description ?? ''), String(row.extracted_text ?? '')].filter((part) => part.trim()).join('\n\n');
      texts.push({ source, updatedAt: String(row.updated_at), text });
    } else if (source.kind === 'document') {
      const row = document.get(source.sourceId) as Row | undefined;
      if (!row) continue;
      texts.push({ source, updatedAt: String(row.updated_at), text: String(row.content_markdown ?? '') });
    } else {
      const row = transcript.get(source.sourceId) as Row | undefined;
      if (!row) continue;
      texts.push({
        source,
        updatedAt: String(row.updated_at),
        segments: (segments.all(source.sourceId) as Row[]).map((segment) => ({ id: String(segment.id), start: Number(segment.t_start ?? 0), end: Number(segment.t_end ?? segment.t_start ?? 0), text: String(segment.text ?? '') })),
      });
    }
  }
  return texts;
}

export interface CompleteGuideSelectionSnapshot {
  config: CompleteGuideConfig;
  resolved: CompleteGuideResolvedSelection;
  snapshot: CompleteGuideSnapshot;
  organization: StudySourceOrganization;
}

export function snapshotCompleteGuideSelection(rawConfig: unknown): CompleteGuideSelectionSnapshot {
  const config = normalizeCompleteGuideConfig(rawConfig);
  const organization = completeGuideOrganization();
  const resolved = resolveCompleteGuideSelection(config.selection, listCompleteGuideCatalog(), organization);
  const snapshot = buildCompleteGuideSnapshot(loadCompleteGuideTexts(resolved), organization);
  return { config, resolved, snapshot, organization };
}

export function previewCompleteGuide(request: CompleteGuidePreviewRequest): CompleteGuidePreview {
  const { config, resolved, snapshot } = snapshotCompleteGuideSelection(request.completeGuide);
  return previewCompleteGuideSnapshot(request,config,resolved,snapshot);
}
