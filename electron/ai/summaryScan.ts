import { assertAcademicAutomation } from './academicMode';
import crypto from 'node:crypto';
import type { ModelRef, TextBlockReason, Work } from '@shared/types';
import { AiError, completeText, embed } from './aiClient';
import { coreStructuredPrompt } from './prompts';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { setSummaryResult } from '../db/worksRepo';
import { getItem } from '../zotero/zoteroClient';
import { resolveWorkText } from '../extraction/textExtractor';
import { updateWorkSummaryEmbedding, upsertWorkSummary } from '../db/workSummariesRepo';
import { recordLinkedLibraryAnalysis } from '../library/libraryVaultProvenance';
import { analysisModelFingerprint, isLocalAnalysisCurrent, recordLocalAnalysisProvenance } from '../db/libraryAnalysisProvenance';
import { modelRefSupportsCapability } from '@shared/localAiModels';
import { startPerf } from '../perf';

function parseAuthors(authorsJson: string): string[] {
  try {
    const parsed = JSON.parse(authorsJson || '[]');
    return Array.isArray(parsed) ? parsed.filter((author): author is string => typeof author === 'string') : [];
  } catch {
    return [];
  }
}

function clip(text: string | null | undefined, max: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}

function modelId(model: ModelRef | null): string {
  return model?.provider && model.model ? `${model.provider}/${model.model}` : 'default';
}

/**
 * The orientation summary asks for two or three paragraphs. A ceiling of 800 tokens was
 * sized for models that answer directly; a reasoning model spends part of that same
 * budget on its thinking trace and then stops mid-sentence, which used to be stored as a
 * finished summary. The first attempt now asks for real headroom, and a cut-off answer is
 * retried once at the app's default ceiling before the pipeline records a failure.
 */
const SUMMARY_MAX_TOKENS = 2_400;
const SUMMARY_RETRY_MAX_TOKENS = 8_000;

export function summaryContentHash(
  work: Pick<Work, 'deep_hash' | 'light_hash'>,
  model?: ModelRef | null
): string {
  const settings = getSettings();
  const scanModel = model ?? settings.summaryModel ?? settings.synthesisModel ?? null;
  if (!modelRefSupportsCapability(scanModel, 'summary')) {
    throw new AiError('El modelo local seleccionado no está certificado para resumir; no se inició la inferencia.', false, true);
  }
  return crypto
    .createHash('sha1')
    .update(`${work.deep_hash ?? ''}|${work.light_hash ?? ''}|${modelId(scanModel)}|summary-v1`)
    .digest('hex');
}

/**
 * Builds a non-citable orientation summary from material already extracted into
 * Nodus. Full text is only used when neither ideas nor an abstract is available.
 */
export async function runSummaryScan(work: Work, model?: ModelRef | null, options: { force?: boolean } = {}): Promise<void> {
  assertAcademicAutomation();
  const perf = { nodusId: work.nodus_id, title: work.title };
  const summaryDone = startPerf('summary pipeline', perf);
  const settings = getSettings();
  const scanModel = model ?? settings.summaryModel ?? settings.synthesisModel ?? null;
  const hash = summaryContentHash(work, model);
  const modelFingerprint = analysisModelFingerprint('summary', { ...settings, summaryModel: scanModel });

  if (!options.force && work.summary_status === 'done' && work.summary_hash === hash
    && isLocalAnalysisCurrent(work.nodus_id, 'summary', hash, modelFingerprint)) return;

  const db = getDb();
  const ideas = db
    .prepare(
      `SELECT i.label, i.statement, io.development, io.role, i.type, io.confidence
         FROM idea_occurrences io
         JOIN ideas i ON i.global_id = io.global_id
        WHERE io.nodus_id = ?
        ORDER BY io.role = 'principal' DESC, io.confidence DESC, i.label ASC
        LIMIT 48`
    )
    .all(work.nodus_id) as {
    label: string;
    statement: string;
    development: string;
    role: string;
    type: string;
    confidence: number;
  }[];
  const evidence = db
    .prepare(
      `SELECT i.label, e.quote, e.location, e.kind
         FROM evidence e
         LEFT JOIN ideas i ON i.global_id = e.global_id
        WHERE e.nodus_id = ?
        ORDER BY e.kind = 'explicit' DESC, length(e.quote) DESC
        LIMIT 40`
    )
    .all(work.nodus_id) as { label: string | null; quote: string; location: string | null; kind: string }[];
  const themes = db
    .prepare(
      `SELECT t.label
         FROM work_themes wt JOIN themes t ON t.theme_id = wt.theme_id
        WHERE wt.nodus_id = ?
        ORDER BY t.label
        LIMIT 16`
    )
    .all(work.nodus_id) as { label: string }[];
  const gaps = db
    .prepare(
      `SELECT kind, statement, confidence
         FROM gaps
        WHERE nodus_id = ?
        ORDER BY confidence DESC
        LIMIT 20`
    )
    .all(work.nodus_id) as { kind: string; statement: string; confidence: number }[];

  let abstract: string | null = null;
  try {
    abstract = (await getItem(settings.zoteroUserId, work.zotero_key))?.abstract ?? null;
  } catch {
    // Offline is fine: Nodus already has extracted material locally.
  }

  let fallbackText: string | null = null;
  let fallbackBlockReason: TextBlockReason | null = null;
  if (ideas.length === 0 && !abstract?.trim()) {
    try {
      const doc = await resolveWorkText(settings.zoteroUserId, work.zotero_key, settings.zoteroStoragePath, null, work.doi, {
        unpaywallEmail: settings.unpaywallEmail,
        preferZoteroFulltext: settings.preferZoteroFulltext,
        ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
      });
      fallbackText = clip(doc.text, 24_000) || null;
      fallbackBlockReason = doc.blockReason ?? null;
    } catch {
      fallbackText = null;
    }
    if (!fallbackText) {
      // A Zotero outage is not "no text": fail retriably instead of persisting a
      // false `skipped_no_text` that would read as "no PDF" in the library.
      if (fallbackBlockReason === 'zotero_unavailable') {
        throw new AiError('Zotero no está disponible: no se pudo comprobar si la obra tiene texto completo.', true);
      }
      setSummaryResult(work.nodus_id, 'skipped_no_text', hash);
      return;
    }
  }

  const evidenceByIdea = new Map<string, { quote: string; location: string | null; kind: string }[]>();
  for (const item of evidence) {
    const key = item.label ?? '';
    const items = evidenceByIdea.get(key) ?? [];
    items.push({ quote: clip(item.quote, 700), location: item.location, kind: item.kind });
    evidenceByIdea.set(key, items);
  }
  const input = {
    title: work.title,
    authors: parseAuthors(work.authors_json),
    year: work.year,
    item_type: work.item_type,
    abstract: abstract ? clip(abstract, 8_000) : null,
    themes: themes.map((theme) => theme.label),
    ideas: ideas.map((idea) => ({
      label: idea.label,
      statement: clip(idea.statement, 1_100),
      development: clip(idea.development, 1_300),
      role: idea.role,
      type: idea.type,
      confidence: idea.confidence,
      evidence: (evidenceByIdea.get(idea.label) ?? []).slice(0, 3),
    })),
    gaps: gaps.map((gap) => ({ kind: gap.kind, statement: clip(gap.statement, 900), confidence: gap.confidence })),
    fallback_text: fallbackText,
  };

  let summary: string;
  try {
    const summaryRequest = {
      system: coreStructuredPrompt('summary', getSettings().promptLanguage ?? 'es'),
      user: JSON.stringify(input),
      temperature: 0.2,
      // A two-paragraph orientation summary needs no thinking trace. Without this the call
      // inherited the chat reasoning setting, so a library scan paid for reasoning on every work.
      reasoning: 'off' as const,
      task: 'summary' as const,
      requestClass: 'background' as const,
      jobId: `${work.nodus_id}:summary`,
      perf,
      requireCompleteOutput: true as const,
    };
    try {
      summary = (await completeText({ ...summaryRequest, maxTokens: SUMMARY_MAX_TOKENS }, scanModel)).trim();
    } catch (error) {
      // A reasoning model can spend the first ceiling on its thinking trace. The same
      // request with more room is the only lever, and it is worth exactly one retry:
      // a second cut-off means the provider budget, not luck, is the limit.
      if (!(error instanceof AiError && error.code === 'output_truncated')) throw error;
      summary = (await completeText({ ...summaryRequest, maxTokens: SUMMARY_RETRY_MAX_TOKENS }, scanModel)).trim();
    }
    if (!summary) throw new Error('El modelo no devolvió un resumen utilizable.');

    // Publish the readable summary and its status atomically. A crash cannot leave
    // a new row hidden behind an old failed status (or vice versa).
    db.transaction(() => {
      upsertWorkSummary({
        nodusId: work.nodus_id,
        summary,
        sourceLevel: work.deep_status === 'done' ? 'deep' : 'light',
        model: scanModel,
        contentHash: hash,
      });
      setSummaryResult(work.nodus_id, 'done', hash);
      recordLocalAnalysisProvenance({
        workId: work.nodus_id,
        components: ['summary'],
        documentFingerprint: hash,
        modelFingerprints: { summary: modelFingerprint },
      });
    })();
  } catch (error) {
    summaryDone({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    if (error instanceof AiError && error.config) throw error;
    if (!(options.force && work.summary_status === 'done')) {
      setSummaryResult(work.nodus_id, 'failed', hash, error instanceof Error ? error.message : String(error));
    }
    throw error;
  }

  // Library provenance is useful for cross-vault reuse, but it must not revoke a
  // summary that has already been generated and committed successfully.
  try {
    recordLinkedLibraryAnalysis({ workId: work.nodus_id, components: ['summary'], documentFingerprint: hash });
  } catch (error) {
    console.warn(`[summaryScan] resumen guardado; procedencia diferida para ${work.nodus_id}: ${error instanceof Error ? error.message : String(error)}`);
  }

  // A readable summary does not depend on its optional retrieval vector. If the
  // embedding provider is temporarily unavailable, keep the committed summary
  // successful and let the reindex flow fill this derived field later.
  try {
    const embedding = await embed(summary, undefined, { role: 'document', title: work.title, perf, jobId: `${work.nodus_id}:summary-embedding` });
    if (embedding) updateWorkSummaryEmbedding(work.nodus_id, summary, embedding, work.title);
    summaryDone({ status: 'ok', embedding: embedding ? 'done' : 'not-configured' });
  } catch (error) {
    console.warn(`[summaryScan] resumen guardado; embedding diferido para ${work.nodus_id}: ${error instanceof Error ? error.message : String(error)}`);
    summaryDone({ status: 'ok', embedding: 'deferred' });
  }
}
