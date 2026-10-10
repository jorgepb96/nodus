import type {PromptLanguage} from './types';
import type {StudyImproveRequest, StudyStyle} from './studyImprove';
import {estimateStudyTokens, localizedStudyStyleInstruction, missingProtectedSpans, protectStudyText,
  renderStudyStylePrompt, restoreProtectedSpans, studyImprovePromptPack, studyFreeTransformationWarning,
  studyImprovementWarnings} from './studyImprove';

export const MAX_STUDY_SELECTION_CHARS = 48_000;

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

${copy.scopeLabel}: ${request.scope}.
${copy.outputLanguage}: ${request.variables?.language || style.language || copy.sameOriginal}.

${copy.selectionHeader}
<<<NODUS_SELECTION
${protectedText}
NODUS_SELECTION>>>`;
  return { system, user };
}


export function prepareStudyImprovement(request: StudyImproveRequest, style: StudyStyle, language: PromptLanguage) {
  const original = request.text.replace(/\r\n/g, '\n');
  if (!original.trim()) throw new Error('Selecciona texto para mejorarlo.');
  if (original.length > MAX_STUDY_SELECTION_CHARS) throw new Error(`La selección supera el límite de ${MAX_STUDY_SELECTION_CHARS.toLocaleString('es-ES')} caracteres.`);
  if (!style.active || style.archivedAt) throw new Error('El estilo seleccionado no está disponible.');
  const protectedValue = protectStudyText(original, request.protectedTerms ?? []);
  const prompt = buildStudyImprovePrompt(request, style, protectedValue.text, language);
  return {original, protectedValue, prompt};
}

export function finishStudyImprovement(request: StudyImproveRequest, style: StudyStyle, raw: string,
  promptLanguage: PromptLanguage, uiLanguage: PromptLanguage) {
  const {original, protectedValue, prompt} = prepareStudyImprovement(request, style, promptLanguage);
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i);
  const protectedResult = match ? match[1] : trimmed;
  if (!protectedResult.trim()) throw new Error('La mejora no devolvió texto. El original no se ha modificado.');
  const missing = missingProtectedSpans(protectedResult, protectedValue.spans).filter(span => !protectedResult.includes(span.value));
  if (missing.length) throw new Error(`La mejora alteró ${missing.length} fragmento(s) protegido(s). El original no se ha modificado.`);
  const text = restoreProtectedSpans(protectedResult, protectedValue.spans);
  const warnings = studyImprovementWarnings(original, text, protectedValue.spans, request.mode, uiLanguage);
  if (request.mode === 'free') warnings.unshift(studyFreeTransformationWarning(uiLanguage));
  return {text, warnings, protectedSpanCount: protectedValue.spans.length,
    estimatedInputTokens: estimateStudyTokens(`${prompt.system}\n${prompt.user}`), estimatedOutputTokens: estimateStudyTokens(text)};
}
