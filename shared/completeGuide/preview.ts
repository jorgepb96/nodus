import type { ModelRef } from '../types';
import type { ResearchEffort } from '../researchReasoning';
import {estimateCompleteGuide,type CompleteGuideEstimate} from './estimate';
import type { CompleteGuideSnapshot } from './snapshot';
import type { StudySourceOrganization } from '../studySourceTree';
import type { CompleteGuideConfig, CompleteGuideCatalogSource, CompleteGuideResolvedSelection, CompleteGuideSourceKind } from './types';

export interface CompleteGuideCatalog {
  sources: CompleteGuideCatalogSource[];
  organization: StudySourceOrganization;
}

/** Composer → main: what would a guide over this selection read, and at what cost? */
export interface CompleteGuidePreviewRequest {
  completeGuide: unknown;
  model?: ModelRef | null;
  thinkingEffort?: ResearchEffort | null;
}

export interface CompleteGuidePreview {
  sources: Array<{ sourceKey: string; kind: CompleteGuideSourceKind; title: string; alias: string; path: string; chars: number; pages: number | null; passages: number }>;
  unavailable: CompleteGuideResolvedSelection['unavailable'];
  superseded: CompleteGuideResolvedSelection['superseded'];
  issues: CompleteGuideSnapshot['issues'];
  totals: CompleteGuideSnapshot['totals'];
  subjects: number;
  units: number;
  estimate: CompleteGuideEstimate;
}

/** Canonical estimate over a frozen source set; no live vault access is needed. */
export function previewCompleteGuideSnapshot(request:CompleteGuidePreviewRequest,config:CompleteGuideConfig,resolved:CompleteGuideResolvedSelection,snapshot:CompleteGuideSnapshot):CompleteGuidePreview {
  const units = new Set(snapshot.sources.map((source) => source.placement.topicId ?? source.placement.folderId ?? source.placement.subjectId ?? 'root')).size;
  return {
    sources: snapshot.sources.map((source) => ({
      sourceKey: source.sourceKey, kind: source.kind, title: source.title, alias: source.alias, path: source.path,
      chars: source.chars, pages: source.pages?.total ?? null, passages: source.passageIds.length,
    })),
    unavailable: resolved.unavailable,
    superseded: resolved.superseded,
    issues: snapshot.issues,
    totals: snapshot.totals,
    subjects: resolved.subjectIds.length,
    units,
    estimate: estimateCompleteGuide({
      snapshot,
      model: request.model ?? null,
      effort: request.thinkingEffort ?? null,
      verification: config.verification,
      webText: config.webText,
      unavailableSources: resolved.unavailable.length,
      subjectCount: resolved.subjectIds.length,
      unitCount: units,
    }),
  };
}
