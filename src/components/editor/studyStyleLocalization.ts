import { localizedStudyStyleInstruction, STUDY_IMPROVE_PRESETS, type StudyStyle } from '@shared/studyImprove';
import { normalizePromptLanguage } from '@shared/promptLanguageOptions';
import { getActiveLang, t } from '../../i18n';

/** Display copy only: keep stored styles and user-authored prompts unchanged. */
export function studyStyleDisplay(style: StudyStyle): Pick<StudyStyle, 'name' | 'description' | 'prompt'> {
  const preset = style.builtIn && STUDY_IMPROVE_PRESETS.find(item => item.id === style.id);
  if (!preset) return style;
  // The catalogue translates the title and description together to retain context.
  const label = t(`${preset.name} · ${preset.description}`);
  const separator = label.search(/[·・]/);
  return {
    name: separator < 0 ? preset.name : label.slice(0, separator).trim(),
    description: separator < 0 ? preset.description : label.slice(separator + 1).trim(),
    prompt: localizedStudyStyleInstruction(preset, normalizePromptLanguage(getActiveLang())),
  };
}
