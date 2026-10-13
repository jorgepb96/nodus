import { createHash } from 'node:crypto';
import type { ModelRef, PromptLanguage } from '@shared/types';
import type { StudyImproveRequest, StudyImproveResult, StudyStyle } from '@shared/studyImprove';
import {
  estimateStudyTokens,
  localizedStudyStyleInstruction,
  missingProtectedSpans,
  protectStudyText,
  renderStudyStylePrompt,
  restoreProtectedSpans,
  studyImprovePromptPack,
  studyFreeTransformationWarning,
  studyImprovementWarnings,
} from '@shared/studyImprove';
import { getStudyStyle, recordStudyImprovement } from '../db/studyStylesRepo';
import { getSettings } from '../db/settingsRepo';
import { completeTextStream } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';

import { normalizePromptLanguage } from '@shared/promptLanguageOptions';
const MAX_SELECTION_CHARS = 48_000;

export function buildStudyImprovePrompt(request: StudyImproveRequest, style: StudyStyle, protectedText: string, language: PromptLanguage = 'es') {
  const copy = studyImprovePromptPack(language);
  const free = request.mode === 'free';
  const protectedMarkerRule = protectedText.includes('⟦NODUS_PROTECTED_')
    ? `- ${copy.protectedMarker}`
    : '';
  const styleInstruction = renderStudyStylePrompt(localizedStudyStyleInstruction(style, language), {
    ...request.variables,
    language: request.variables?.language ?? style.language,
    targetLength: request.length,
    selectedText: protectedText,
  });
  const system = `${copy.role}

${copy.rulesHeader}
- ${copy.mustReturn}
- ${copy.preserve}
${protectedMarkerRule}
- ${copy.noInvent}
${free
    ? `- ${copy.free}`
    : `- ${copy.faithful}`}
- ${copy.level[request.level]}
- ${copy.length[request.length]}
- ${copy.conflictInstruction}
${style.systemPrompt ? `\n${copy.styleHeader}\n${style.systemPrompt}` : ''}`;
  const user = `${styleInstruction}
${request.additionalInstructions?.trim() ? `\n${request.additionalInstructions.trim()}\n` : ''}

${copy.scopeLabel}: ${request.scope}.
${copy.outputLanguage}: ${request.variables?.language || style.language || copy.sameOriginal}.

${copy.selectionHeader}
<<<NODUS_SELECTION
${protectedText}
NODUS_SELECTION>>>`;
  return { system, user };
}

function stripWrappingFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1] : trimmed;
}

function completeProtectedStreamPrefix(value: string): string {
  const unicodeOpen = value.lastIndexOf('⟦');
  const asciiOpen = value.lastIndexOf('[');
  const incompleteOpen = Math.max(
    unicodeOpen > value.lastIndexOf('⟧') ? unicodeOpen : -1,
    asciiOpen > value.lastIndexOf(']') ? asciiOpen : -1,
  );
  return incompleteOpen >= 0 ? value.slice(0, incompleteOpen) : value;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function modelFor(request: StudyImproveRequest, style: StudyStyle): ModelRef | null {
  if (request.model?.provider && request.model.model) return request.model as ModelRef;
  if (style.modelProvider && style.modelName) return { provider: style.modelProvider, model: style.modelName } as ModelRef;
  return null;
}

export async function improveStudyText(
  request: StudyImproveRequest,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<StudyImproveResult> {
  signal?.throwIfAborted();
  if (request.additionalInstructions !== undefined && (typeof request.additionalInstructions !== 'string' || request.additionalInstructions.length > 4000)) throw new Error('Las instrucciones superan el límite de 4.000 caracteres.');
  const original = request.text.replace(/\r\n/g, '\n');
  if (!original.trim()) throw new Error('Selecciona texto para mejorarlo.');
  if (original.length > MAX_SELECTION_CHARS) throw new Error(`La selección supera el límite de ${MAX_SELECTION_CHARS.toLocaleString('es-ES')} caracteres.`);
  const style = getStudyStyle(request.styleId);
  if (!style || !style.active || style.archivedAt) throw new Error('El estilo seleccionado no está disponible.');
  const aiSettings = getSettings();
  const promptLanguage: PromptLanguage = request.promptLanguage ?? aiSettings.promptLanguage ?? 'es';
  const protectedValue = protectStudyText(original, request.protectedTerms ?? []);
  const prompt = buildStudyImprovePrompt(request, style, protectedValue.text, promptLanguage);
  const requestedModel = modelFor(request, style);
  let streamed = '';
  let visibleStreamed = '';
  /** How much of `streamed` has already been restored and emitted. */
  let restoredUpTo = 0;
  // The editor exposes the active model beside every AI action. Invoking one of
  // those actions is the send decision, so a second native provider confirmation
  // adds no information and interrupts the writing flow.
  const completed = await runStudyAiTask<string>({ task: 'improve', explicitModel: requestedModel, subjectId: request.subjectId, inputChars: prompt.system.length + prompt.user.length, outputChars: (value) => value.length, allowFallback: () => !streamed, externalConsentModelKey: '*' }, (model) => {
    return completeTextStream({
      system: prompt.system,
      user: prompt.user,
      temperature: request.mode === 'free' ? Math.max(style.temperature, style.creativity) : Math.min(style.temperature, 0.45),
      maxTokens: Math.min(style.maxOutputTokens, aiSettings.studyAiMaxOutputTokens),
      plainContext: true,
    }, (delta, kind) => {
      if (kind !== 'content') return;
      streamed += delta;
      // Provider chunks can split a protected marker. Hold an unfinished marker
      // and expose only restored, user-facing text to the preview.
      //
      // Only the newly-safe slice is restored, never the whole accumulated
      // prefix: re-restoring everything on every token made the cost quadratic
      // in the length of the answer. The cut point is safe by construction —
      // completeProtectedStreamPrefix never ends inside a marker, and it only
      // ever moves forward — so restoring slice-by-slice yields exactly the
      // same text as restoring the prefix in one go.
      const safeEnd = completeProtectedStreamPrefix(streamed).length;
      if (safeEnd <= restoredUpTo) return;
      const visibleDelta = restoreProtectedSpans(streamed.slice(restoredUpTo, safeEnd), protectedValue.spans);
      restoredUpTo = safeEnd;
      if (visibleDelta) {
        visibleStreamed += visibleDelta;
        onDelta(visibleDelta);
      }
    }, model, signal);
  });
  const raw = completed.value; const model = completed.model;
  signal?.throwIfAborted();
  const protectedResult = stripWrappingFence(raw || streamed);
  // Some small local models helpfully expand a placeholder back to the exact
  // protected value even though the prompt asks them not to touch it. That is
  // still a successful preservation, so only reject spans for which neither the
  // marker nor its byte-for-byte original value survives.
  const missing = missingProtectedSpans(protectedResult, protectedValue.spans)
    .filter((span) => !protectedResult.includes(span.value));
  if (missing.length) {
    throw new Error(`La mejora alteró ${missing.length} fragmento(s) protegido(s). El original no se ha modificado.`);
  }
  const text = restoreProtectedSpans(protectedResult, protectedValue.spans);
  if (!text.trim()) throw new Error('La IA no devolvió texto. El original no se ha modificado.');
  if (text.startsWith(visibleStreamed)) {
    const trailingDelta = text.slice(visibleStreamed.length);
    visibleStreamed = text;
    if (trailingDelta) onDelta(trailingDelta);
  }
  const warnings = studyImprovementWarnings(original, text, protectedValue.spans, request.mode, normalizePromptLanguage(aiSettings.uiLanguage));
  if (request.mode === 'free') warnings.unshift(studyFreeTransformationWarning(normalizePromptLanguage(aiSettings.uiLanguage)));
  const originalHash = hash(original);
  const resultHash = hash(text);
  const log = recordStudyImprovement({
    documentId: request.documentId ?? null,
    noteId: request.noteId ?? null,
    styleId: style.id,
    scope: request.scope,
    mode: request.mode,
    level: request.level,
    length: request.length,
    modelProvider: model.provider,
    modelName: model.model,
    originalHash,
    resultHash,
    originalChars: original.length,
    resultChars: text.length,
    warnings,
    action: 'generated',
  });
  return {
    logId: log.id,
    text,
    warnings,
    styleId: style.id,
    modelProvider: model.provider,
    modelName: model.model,
    originalHash,
    resultHash,
    protectedSpanCount: protectedValue.spans.length,
    estimatedInputTokens: estimateStudyTokens(`${prompt.system}\n${prompt.user}`),
    estimatedOutputTokens: estimateStudyTokens(text),
  };
}
