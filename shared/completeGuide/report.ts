/** Canonical complete-guide report assembly, shared by Desktop and device hosts. */
import type {DeepResearchMeta,DeepResearchReport,DeepResearchRequest,PromptLanguage,WritingWorkshopDraft} from '../types';
import type {StudySourceOrganization} from '../studySourceTree';
import type {CompleteGuideConfig,CompleteGuideDraftMeta} from './types';
import type {CompleteGuideSnapshot} from './snapshot';
import type {CompleteGuideResult} from '../../electron/ai/completeGuide/core';
import {COMPLETE_GUIDE_PROMPT_VERSION} from '../../electron/ai/completeGuide/prompts';
export interface CompleteGuideFrozenSource {snapshot:CompleteGuideSnapshot;organization:StudySourceOrganization;snapshotAt:string}
export function buildCompleteGuideReport(request:DeepResearchRequest,config:CompleteGuideConfig,frozen:CompleteGuideFrozenSource,result:CompleteGuideResult,language:PromptLanguage,usage:CompleteGuideDraftMeta['usage'],generatedAt=new Date().toISOString()):DeepResearchReport {
  const words = result.markdown.split(/\s+/).filter(Boolean).length;
  const { runId, ...configWithoutRun } = config;
  const meta: CompleteGuideDraftMeta = {
    version: 1,
    runId,
    config: configWithoutRun,
    snapshotAt: frozen.snapshotAt,
    promptVersion: COMPLETE_GUIDE_PROMPT_VERSION,
    sources: result.coverage.map((row) => ({
      sourceKey: row.source.sourceKey, kind: row.source.kind, alias: row.source.alias, title: row.source.title, path: row.source.path,
      passagesTotal: row.passagesTotal, passagesRead: row.passagesRead, ...(row.source.pages ? { pages: row.source.pages } : {}),
      itemsExtracted: row.itemsExtracted, itemsUsed: row.itemsUsed, duplicates: row.duplicates, unreadRanges: row.unreadRanges,
    })),
    units: result.chapters.map((chapter) => ({ unitKey: chapter.unitKey, title: chapter.title, sections: chapter.sections.length, items: result.items.filter((item) => item.unitKey === chapter.unitKey).length })),
    counts: {
      items: result.counts.items, itemsUsed: result.counts.itemsUsed, blocks: result.counts.blocks, aiBlocks: result.counts.aiBlocks,
      windows: result.counts.windows, failedWindows: result.counts.failedWindows, auditedBlocks: result.counts.auditedBlocks,
      removedSentences: result.counts.removedSentences, repairedBlocks: result.counts.repairedBlocks, invalidLatex: result.counts.invalidLatex,
      conflicts: result.counts.conflicts, cacheHits: result.counts.cacheHits, figures: result.counts.figures,
      ...(config.webText ? { webBlocks: result.counts.webBlocks } : {}),
      ...(config.webImages ? { webImages: result.counts.webImages } : {}),
    },
    usage,
    warnings: result.warnings,
    cheatSheetMarkdown: result.cheatSheetMarkdown,
  };
  const draft: WritingWorkshopDraft = {
    generatedAt,
    brief: {
      kind: 'deep_research',
      objective: request.objective?.trim() || result.title,
      audience: request.audience,
      tone: 'academic',
      language,
      deepResearchVersion: request.deepResearchVersion ?? 'v2',
      studyReportMode: 'complete_guide',
    },
    selection: { ideaIds: [], themeIds: [], gapIds: [], contradictionIds: [], workIds: [], passageIds: [], tutorRouteIds: [] },
    title: result.title,
    abstract: result.abstract,
    outline: result.chapters.map((chapter) => ({
      id: chapter.unitKey,
      title: chapter.title,
      purpose: chapter.overview,
      keyClaims: chapter.sections.map((section) => section.title),
      sources: [],
    })),
    draftMarkdown: result.markdown,
    matrix: [],
    bibliography: result.bibliography,
    nextSteps: [],
    limitations: result.limitations,
    deepResearchStructure: 'sectioned',
    completeGuide: meta,
    stats: {
      selectedIdeas: result.counts.itemsUsed, selectedThemes: 0, selectedGaps: 0, selectedContradictions: 0,
      selectedWorks: frozen.snapshot.sources.length, selectedPassages: frozen.snapshot.totals.readablePassages, selectedTutorRoutes: 0,
      contextChars: frozen.snapshot.totals.chars, truncated: result.counts.failedWindows > 0,
    },
  };
  const reportMeta: DeepResearchMeta = {
    deepResearchVersion: request.deepResearchVersion ?? 'v2',
    structure: 'sectioned',
    sections: result.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0),
    words,
    pages: Math.max(1, Math.ceil(words / 450)),
    ideasCovered: result.counts.itemsUsed,
    ideasConsidered: result.counts.items,
    worksCited: result.coverage.filter((row) => row.itemsUsed > 0).length,
    stoppedReason: null,
    verification: null,
  };
  return {
    draft,
    meta: reportMeta,
    ...(result.figures.length ? { completeGuideFigures: { figures: result.figures, siblings: result.figureSiblings } } : {}),
    completeGuideArtifacts: {
      runId,
      items: result.items,
      chapters: result.chapters,
      syllabus: result.syllabus,
      sources: frozen.snapshot.sources,
      passages: frozen.snapshot.passages.map(({ id, sourceKey, locator }) => ({ id, sourceKey, locator })),
    },
  };
}
