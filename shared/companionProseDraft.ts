import type {BeatThreadKind,BeatMark,PromptLanguage,WorldBeat} from './types';
import {BEAT_MARK_LABEL,marksFor} from './worldThreads';
import {proseReviewContextCopy} from './worldContextPromptPacks';
import {stripWorldLinks} from './worldManuscript';
import {hasProseReviewMaterial,type ProseReviewSources} from './worldProseReview';
import {worldOperationSystemPrompt} from './worldOperationPrompts';
import {composeProseReviewContext} from './worldProseReview';

export type ProseDraftBeat=Pick<WorldBeat,'threadKind'|'threadId'|'threadTitle'|'mark'|'text'>;
export type CompanionProseDraft={sceneTitle:string;text:string;beats:ProseDraftBeat[]};
export function validateProseDraft(raw:unknown):CompanionProseDraft {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_prose_draft');
  const value=raw as CompanionProseDraft;
  if(Object.keys(value).some(key=>!['sceneTitle','text','beats'].includes(key))||typeof value.sceneTitle!=='string'||value.sceneTitle.length>4096||typeof value.text!=='string'||new TextEncoder().encode(value.text).length>500_000||!Array.isArray(value.beats)||value.beats.length>512)throw new Error('invalid_prose_draft');
  const identities=new Set<string>();
  const beats=value.beats.map(beat=>{
    if(!beat||typeof beat!=='object'||Array.isArray(beat)||Object.keys(beat).some(key=>!['threadKind','threadId','threadTitle','mark','text'].includes(key))||!['conflict','arc','rule'].includes(beat.threadKind)||typeof beat.threadId!=='string'||!beat.threadId||beat.threadId.length>256||typeof beat.threadTitle!=='string'||beat.threadTitle.length>4096||!marksFor(beat.threadKind).includes(beat.mark)||beat.text!=null&&(typeof beat.text!=='string'||beat.text.length>4096))throw new Error('invalid_prose_draft_beat');
    const key=`${beat.threadKind}:${beat.threadId}`;if(identities.has(key))throw new Error('duplicate_prose_draft_beat');identities.add(key);
    return {threadKind:beat.threadKind,threadId:beat.threadId,threadTitle:beat.threadTitle,mark:beat.mark,text:beat.text??null};
  });return {sceneTitle:value.sceneTitle,text:value.text,beats};
}
export function proseDraftTemplate(language:PromptLanguage){
  const copy=proseReviewContextCopy(language);
  return {scene:copy.scene,declaredBeats:copy.declaredBeats,sceneText:copy.sceneText,askTemplate:copy.ask(92837),
    threadKinds:copy.threadKinds,beatMarks:copy.beatMarks,replyMarks:BEAT_MARK_LABEL,
    allowedMarks:Object.fromEntries((['conflict','arc','rule'] as BeatThreadKind[]).map(kind=>[kind,marksFor(kind)]))};
}
export type PreparedProseReview={sceneId:string;beats:ProseDraftBeat[];sources:ProseReviewSources;noMaterial:boolean;
  prompt:{system:string;user:string;plainContext:boolean;temperature:number;maxTokens:number};draftTemplate:ReturnType<typeof proseDraftTemplate>};
/** Provider-independent template for a scene authored on the companion. */
export function portableProseReviewTemplate(language:PromptLanguage):PreparedProseReview {
  const sources:ProseReviewSources={sceneTitle:'',prose:'',beats:[]};
  return {sceneId:'',beats:[],sources,noMaterial:true,draftTemplate:proseDraftTemplate(language),
    prompt:{system:worldOperationSystemPrompt('proseReview',language),user:composeProseReviewContext(sources,language),plainContext:true,temperature:0.2,maxTokens:600}};
}
export function localSceneBaselineRevisionInput(sceneId:string,language:PromptLanguage,creationMutationId:string,templateRevision:string):string {
  return ['mobile-prose-local-scene-v1',sceneId,language,creationMutationId,templateRevision]
    .map(field=>`${new TextEncoder().encode(field).length}:${field}`).join('');
}
export function applyProseDraft(source:PreparedProseReview,raw:unknown):PreparedProseReview {
  const draft=validateProseDraft(raw),template=source.draftTemplate;
  const sources={...source.sources,sceneTitle:draft.sceneTitle,prose:stripWorldLinks(draft.text),beats:draft.beats.map(beat=>({threadLabel:`${template.threadKinds[beat.threadKind]}: ${beat.threadTitle}`,mark:template.beatMarks[beat.mark as BeatMark]??beat.mark,text:beat.text}))};
  const lines=[`${template.scene}: ${sources.sceneTitle}`,'',`${template.declaredBeats}:`,
    ...sources.beats.map((beat,index)=>`${index+1}. ${beat.threadLabel} — ${beat.mark}${beat.text?`: ${beat.text}`:''}`),
    '',`${template.sceneText}:`,sources.prose.trim(),'',template.askTemplate.replaceAll('92837',String(draft.beats.length))];
  return {...source,beats:draft.beats,sources,noMaterial:!hasProseReviewMaterial(sources),prompt:{...source.prompt,user:lines.join('\n')}};
}
/** A byte-length framing independent of JSON key ordering/escaping on Swift.
 * The actual Mac baseline still participates in conflict detection. */
export function proseDraftRevisionInput(baseRevision:string,draft:CompanionProseDraft):string {
  return ['mobile-prose-draft-v1',baseRevision,draft.sceneTitle,draft.text,String(draft.beats.length),...draft.beats.flatMap(beat=>[beat.threadKind,beat.threadId,beat.threadTitle,beat.mark,beat.text??''])]
    .map(field=>`${new TextEncoder().encode(field).length}:${field}`).join('');
}
