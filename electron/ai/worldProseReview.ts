// Read the scene and say which of its declared beats are actually on the page.
//
// A narrow, read-only worldbuilding model call. An earlier design lacked a reliable input:
// its source was `world_scenes.summary`, which is nullable and
// empty most of the time in a real vault. The manuscript created the input.
//
// It never rewrites and never judges the prose. The beats are the author's own statement of
// what this scene has to do; the model only reads and reports. Anything more would be a
// model with opinions about somebody else's novel.

import { completeText } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { beatsForScene } from '../db/worldThreadsRepo';
import { getDb } from '../db/database';
import {
  composeProseReviewContext,
  hasProseReviewMaterial,
  parseProseReview,
  type ProseReviewSources,
} from '@shared/worldProseReview';
import { worldOperationSystemPrompt } from '@shared/worldOperationPrompts';
import { BEAT_MARK_LABEL } from '@shared/worldThreads';
import { stripWorldLinks } from '@shared/worldManuscript';
import type { ProseReviewResult,PromptLanguage } from '@shared/types';
import { proseReviewContextCopy } from '@shared/worldContextPromptPacks';
import {applyProseDraft,proseDraftTemplate,type PreparedProseReview} from '@shared/companionProseDraft';

export function prepareWorldProseReview(sceneId:string,requestedLanguage?:PromptLanguage):PreparedProseReview{
  const scene = getDb().prepare('SELECT title FROM world_scenes WHERE scene_id = ?').get(sceneId) as
    | { title: string }
    | undefined;
  if (!scene) throw new Error('Escena no encontrada.');

  // Portable source capture always supplies its language. Avoid reading and
  // migrating model preferences while merely consulting that scene.
  const language = requestedLanguage ?? getSettings().promptLanguage ?? 'es';
  const promptCopy = proseReviewContextCopy(language);
  const beats = beatsForScene(sceneId);
  const sources: ProseReviewSources = {
    sceneTitle: scene.title,
    beats: beats.map((beat) => ({
      threadLabel: `${promptCopy.threadKinds[beat.threadKind]}: ${beat.threadTitle}`,
      mark: promptCopy.beatMarks[beat.mark] ?? beat.mark,
      text: beat.text,
    })),
    // The model reads what a reader would read, so the internal links go out first: a
    // `nodus://` URL mid-sentence is noise it would try to interpret.
    prose: stripWorldLinks((getDb().prepare('SELECT text FROM world_scene_text WHERE scene_id=?').get(sceneId) as {text:string}|undefined)?.text??''),
  };

  return {sceneId,beats,sources,draftTemplate:proseDraftTemplate(language),noMaterial:!hasProseReviewMaterial(sources),prompt:{
      system: worldOperationSystemPrompt('proseReview', language),
      user: composeProseReviewContext(sources, language),
      plainContext: true,
      // Cold. This is a reading, not a piece of writing: everything true in the answer is
      // already on the page.
      temperature: 0.2,
      maxTokens: 600,
    }};
}

export function finishWorldProseReview(source:ReturnType<typeof prepareWorldProseReview>,completion:string):ProseReviewResult{
  if(source.noMaterial)return {beats:[],noMaterial:true};

  // Zipped by POSITION, and short-circuited when the model returned fewer lines than beats:
  // a beat with no verdict comes back as unread rather than as a guess. Telling an author
  // that something is on the page when nobody checked is the one failure this exists to
  // avoid.
  const verdicts = parseProseReview(completion);
  return {
    beats: source.beats.map((beat, index) => ({
      threadKind: beat.threadKind,
      threadId: beat.threadId,
      threadTitle: beat.threadTitle,
      mark: BEAT_MARK_LABEL[beat.mark] ?? beat.mark,
      present: verdicts[index]?.present ?? null,
      note: verdicts[index]?.note ?? null,
    })),
    noMaterial: false,
  };
}

export async function reviewWorldProse(sceneId:string,language?:PromptLanguage,draft?:unknown):Promise<ProseReviewResult>{
  const baseline=prepareWorldProseReview(sceneId,language),source=draft==null?baseline:applyProseDraft(baseline,draft);
  if(source.noMaterial)return {beats:[],noMaterial:true};
  const settings=getSettings(),model=settings.synthesisModel??settings.extractionModel??null;
  return finishWorldProseReview(source,await completeText(source.prompt,model));
}
