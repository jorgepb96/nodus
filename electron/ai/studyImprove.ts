import { createHash } from 'node:crypto';
import type { ModelRef, PromptLanguage } from '@shared/types';
import type { StudyImproveRequest, StudyImproveResult, StudyStyle } from '@shared/studyImprove';
import {restoreProtectedSpans} from '@shared/studyImprove';
import { getStudyStyle, recordStudyImprovement } from '../db/studyStylesRepo';
import { getSettings } from '../db/settingsRepo';
import { completeTextStream } from './aiClient';
import { runStudyAiTask } from './studyAiPolicy';

import { normalizePromptLanguage } from '@shared/promptLanguageOptions';
import {prepareStudyImprovement, finishStudyImprovement} from '@shared/studyImprovementGeneration';
export {buildStudyImprovePrompt} from '@shared/studyImprovementGeneration';


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
  const style = getStudyStyle(request.styleId);
  if (!style) throw new Error('El estilo seleccionado no está disponible.');
  const aiSettings = getSettings();
  const promptLanguage: PromptLanguage = request.promptLanguage ?? aiSettings.promptLanguage ?? 'es';
  const {original, protectedValue, prompt} = prepareStudyImprovement(request, style, promptLanguage);
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
  const finished = finishStudyImprovement(request, style, raw || streamed, promptLanguage, normalizePromptLanguage(aiSettings.uiLanguage));
  const {text, warnings} = finished;
  if (text.startsWith(visibleStreamed)) {
    const trailingDelta = text.slice(visibleStreamed.length);
    visibleStreamed = text;
    if (trailingDelta) onDelta(trailingDelta);
  }
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
    protectedSpanCount: finished.protectedSpanCount,
    estimatedInputTokens: finished.estimatedInputTokens,
    estimatedOutputTokens: finished.estimatedOutputTokens,
  };
}
