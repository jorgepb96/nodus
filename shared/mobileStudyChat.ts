import type {StudyAssistantSelection,StudyAssistantRequest,StudyAssistantCitation} from './studyAssistant';
import {compressStudyAssistantEvidence,studyAssistantSourceKey,DEFAULT_STUDY_ASSISTANT_SELECTION} from './studyAssistant';
import type {StudySearchIndexEntry,StudySearchOptions} from './studySearch';
import {studyChatCandidates,orderStudyChatEntries} from './studyChatRetrieval';
import {buildStudyChatPrompt,studyChatCitation} from './studyChatPrompt';
import {studyAssistantPromptPack} from './studyAssistantPromptPacks';
import {sha256Snapshot} from './databaseResearchEngine';
import type {PromptLanguage} from './types';
import type {StudyQuestion,StudyQuestionVersion} from './studyQuestions';
import type {StudyAssessment,StudyAttempt} from './studyAssessments';
import type {StudyRubric} from './studyGrading';

export interface MobileStudyOriginalRelated {
  versions?:StudyQuestionVersion[];
  /** Existing answers only. No new attempt is created by the companion reader. */
  attempts?:Array<Omit<StudyAttempt,'assessment'>>;
  rubric?:StudyRubric|null;
}
export type MobileStudyChatOriginal = ({kind:'question';sourceId:string;data:StudyQuestion}|{kind:'exam';sourceId:string;data:StudyAssessment})&{related?:MobileStudyOriginalRelated};

export const MOBILE_STUDY_CHAT_MAX_BYTES=16_000_000;
export interface MobileStudyChatSourcePack {
  version:1;vaultId:string;capturedAt:string;id:string;selection:StudyAssistantSelection;
  /** Existing indexed fragments only. Vectors are omitted for bounded downloads;
   * on-device retrieval uses the identical Desktop lexical ranking/fallback. */
  entries:StudySearchIndexEntry[];
  /** Opaque Mac signatures are retained with authored citations. The key never
   * leaves the owning vault; downloaded fragments remain valid after reindex. */
  proofs:Record<string,string>;
  /** Complete selected question/exam records, kept with their chosen fragments.
   * Older packs omit this and remain usable for retrieval and quoted evidence. */
  originals?:Record<string,MobileStudyChatOriginal>;
}
export interface MobileStudyChatEvidence {entry:StudySearchIndexEntry;signature:string;maxChars:number}
export type MobileStudyChatOptions=Pick<StudyAssistantRequest,'selection'|'task'|'level'|'tone'|'language'|'allowExternalKnowledge'>;
export function normalizeMobileStudyChatOptions(request:MobileStudyChatOptions):MobileStudyChatOptions {
  if(!request||!['answer','summary','explain','compare','outline','timeline','table','concept-map','glossary','critique','review-questions'].includes(request.task)||!['simple','standard','advanced'].includes(request.level)||!['clear','academic','concise','guided'].includes(request.tone)||!['auto','es','en','fr'].includes(request.language)||typeof request.allowExternalKnowledge!=='boolean'||Object.keys(request).some(key=>!['selection','task','level','tone','language','allowExternalKnowledge'].includes(key)))throw new Error('invalid_study_chat_options');
  return {...request,selection:normalizeMobileStudyChatSelection(request.selection)};
}
export function studyChatSelectionOptions(selection:StudyAssistantSelection):StudySearchOptions {
  if(selection.scope==='course')return {courseId:selection.courseId||undefined};
  if(selection.scope==='subject')return {subjectId:selection.subjectId||undefined};
  if(selection.scope==='topic')return {topicId:selection.topicId||undefined};
  return {};
}
export function normalizeMobileStudyChatSelection(value:unknown):StudyAssistantSelection {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_study_chat_selection');
  const selection=value as StudyAssistantSelection;
  if(!['library','course','subject','topic','manual'].includes(selection.scope)||!Array.isArray(selection.sourceKeys)||selection.sourceKeys.length>100||new Set(selection.sourceKeys).size!==selection.sourceKeys.length||selection.sourceKeys.some(key=>typeof key!=='string'||!key||key.length>1024)||Object.keys(selection).some(key=>!['scope','sourceKeys','courseId','subjectId','topicId'].includes(key)))throw new Error('invalid_study_chat_selection');
  for(const key of ['courseId','subjectId','topicId'] as const)if(selection[key]!=null&&(typeof selection[key]!=='string'||!selection[key]||selection[key]!.length>256))throw new Error('invalid_study_chat_selection');
  for(const [scope,key] of [['course','courseId'],['subject','subjectId'],['topic','topicId']] as const)if(selection.scope===scope&&!selection[key])throw new Error('study_chat_scope_missing');
  return {...DEFAULT_STUDY_ASSISTANT_SELECTION,...selection};
}
export function studyChatPackPayload(pack:MobileStudyChatSourcePack) {
  const {id:_id,...payload}=pack;return payload;
}
export function validateMobileStudyChatSourcePack(pack:MobileStudyChatSourcePack,vaultId:string) {
  if(!pack||pack.version!==1||pack.vaultId!==vaultId||!Number.isFinite(Date.parse(pack.capturedAt))||pack.id!==sha256Snapshot(studyChatPackPayload(pack))||!Array.isArray(pack.entries)||!pack.proofs||typeof pack.proofs!=='object'||Array.isArray(pack.proofs)||new TextEncoder().encode(JSON.stringify(pack)).length>MOBILE_STUDY_CHAT_MAX_BYTES)throw new Error('invalid_study_chat_source_pack');
  const selection=normalizeMobileStudyChatSelection(pack.selection),keys=new Set<string>();
  for(const entry of pack.entries) {
    if(!entry||!entry.indexId||keys.has(entry.indexId)||!['document','material','transcript','question','exam'].includes(entry.kind)||!entry.sourceId||typeof entry.text!=='string'||typeof entry.title!=='string'||typeof entry.subtitle!=='string'||!entry.scope||!entry.location||!Array.isArray(entry.tags)||entry.embedding!==null||entry.excluded)throw new Error('invalid_study_chat_source_entry');
    keys.add(entry.indexId);if(!/^[a-f\d]{64}$/.test(pack.proofs[entry.indexId]??''))throw new Error('study_chat_source_proof_missing');
    if(selection.scope==='manual'&&!selection.sourceKeys.includes(studyAssistantSourceKey(entry.kind,entry.sourceId)))throw new Error('study_chat_source_outside_selection');
  }
  if(pack.originals!==undefined) {
    if(!pack.originals||typeof pack.originals!=='object'||Array.isArray(pack.originals))throw new Error('invalid_study_chat_originals');
    for(const [key,source] of Object.entries(pack.originals)) {
      validateMobileStudyChatOriginal(source);
      if(key!==studyAssistantSourceKey(source.kind,source.sourceId)||!pack.entries.some(entry=>entry.kind===source.kind&&entry.sourceId===source.sourceId))throw new Error('study_chat_original_outside_selection');
    }
  }
}
export function validateMobileStudyChatOriginal(source:MobileStudyChatOriginal) {
  if(!source||!['question','exam'].includes(source.kind)||typeof source.sourceId!=='string'||!source.sourceId||!source.data||source.data.id!==source.sourceId)throw new Error('invalid_study_chat_original');
  const question=(value:StudyQuestion)=>Boolean(value&&typeof value.id==='string'&&typeof value.prompt==='string'&&typeof value.explanation==='string'&&value.answer&&typeof value.answer==='object'&&!Array.isArray(value.answer)&&Array.isArray(value.options)&&value.options.every(option=>option&&typeof option.id==='string'&&typeof option.text==='string'&&typeof option.correct==='boolean'));
  if(source.kind==='question'?!question(source.data):source.data.kind!=='exam'||typeof source.data.title!=='string'||typeof source.data.description!=='string'||!Array.isArray(source.data.items)||source.data.items.some(item=>!item||typeof item.points!=='number'||!Number.isFinite(item.points)||!question(item.question)||item.questionId!==item.question.id))throw new Error('invalid_study_chat_original');
  if(source.related!==undefined) {
    const related=source.related;
    if(!related||typeof related!=='object'||Array.isArray(related)||Object.keys(related).some(key=>!['versions','attempts','rubric'].includes(key)))throw new Error('invalid_study_chat_original_related');
    if(related.versions!==undefined&&(!Array.isArray(related.versions)||source.kind!=='question'||related.versions.some(version=>!version||typeof version.id!=='string'||version.questionId!==source.sourceId||!Number.isInteger(version.versionNo)||version.versionNo<1||!version.snapshot||typeof version.snapshot!=='object'||typeof version.createdAt!=='string')))throw new Error('invalid_study_chat_original_versions');
    if(related.attempts!==undefined&&(!Array.isArray(related.attempts)||related.attempts.some(attempt=>!attempt||typeof attempt.id!=='string'||typeof attempt.assessmentId!=='string'||typeof attempt.status!=='string'||typeof attempt.startedAt!=='string'||!Array.isArray(attempt.answers)||attempt.answers.some(answer=>!answer||answer.attemptId!==attempt.id||typeof answer.questionId!=='string'||!answer.response||typeof answer.response!=='object'||Array.isArray(answer.response))||(source.kind==='exam'?attempt.assessmentId!==source.sourceId:!attempt.answers.length||attempt.answers.some(answer=>answer.questionId!==source.sourceId)))))throw new Error('invalid_study_chat_original_attempts');
    if(related.rubric!=null&&(source.kind!=='exam'||related.rubric.id!==source.data.rubricId||typeof related.rubric.name!=='string'||!Array.isArray(related.rubric.criteria)||related.rubric.criteria.some(criterion=>!criterion||typeof criterion.label!=='string'||typeof criterion.description!=='string'||!Number.isFinite(criterion.weight))))throw new Error('invalid_study_chat_original_rubric');
  }
}
export function makeStudyChatCitations(entries:StudySearchIndexEntry[],question:string):{citations:StudyAssistantCitation[];truncated:boolean} {
  const citations:StudyAssistantCitation[]=[];let chars=0,truncated=entries.length>=20;
  for(const entry of entries) {
    if(chars>=52_000){truncated=true;break;}
    const compressed=compressStudyAssistantEvidence(entry.text,question,Math.min(3600,52_000-chars));
    if(!compressed.text)continue;
    citations.push(studyChatCitation(`S${citations.length+1}`,entry,compressed.text));chars+=compressed.text.length;truncated ||= compressed.truncated;
  }
  return {citations,truncated};
}
export function prepareStudyChat(input:{packs:MobileStudyChatSourcePack[];request:StudyAssistantRequest;vaultId:string;interfaceLanguage:PromptLanguage}) {
  const request=input.request,{selection}=normalizeMobileStudyChatOptions({selection:request.selection,task:request.task,level:request.level,tone:request.tone,language:request.language,allowExternalKnowledge:request.allowExternalKnowledge});
  if(!Array.isArray(request.messages)||request.messages.some(message=>!message||!['user','assistant'].includes(message.role)||typeof message.content!=='string'))throw new Error('invalid_study_chat_request');
  const question=[...request.messages].reverse().find(message=>message.role==='user'&&message.content.trim())?.content;
  if(!question)throw new Error('study_chat_question_missing');
  const entries=new Map<string,StudySearchIndexEntry>(),proofs=new Map<string,string>();
  for(const pack of input.packs) {
    validateMobileStudyChatSourcePack(pack,input.vaultId);
    for(const entry of pack.entries)if(!entries.has(entry.indexId)){entries.set(entry.indexId,entry);proofs.set(entry.indexId,pack.proofs[entry.indexId]);}
  }
  const manual=selection.scope==='manual'?selection.sourceKeys:[],options=studyChatSelectionOptions(selection);
  if(manual.some(key=>![...entries.values()].some(entry=>studyAssistantSourceKey(entry.kind,entry.sourceId)===key)))throw new Error('study_chat_source_not_downloaded');
  const candidates=selection.scope==='manual'&&!manual.length?[]:studyChatCandidates([...entries.values()],options,manual);
  const ranked=orderStudyChatEntries(question,candidates,options,manual,null,20),{citations,truncated}=makeStudyChatCitations(ranked,question);
  const language=request.language==='auto'?input.interfaceLanguage:request.language;
  const prompt=buildStudyChatPrompt(request,citations,input.interfaceLanguage);
  let chars=0;const evidence:Record<string,MobileStudyChatEvidence>={};
  for(const citation of citations){evidence[citation.id]={entry:entries.get(citation.indexId)!,signature:proofs.get(citation.indexId)!,maxChars:Math.min(3600,52_000-chars)};chars+=citation.quote.length;}
  return {...prompt,citations,evidence,truncated,temperature:0.18,maxTokens:3200,sourceChars:chars,retrieval:'lexical' as const,
    ...(citations.length||request.allowExternalKnowledge?{}:{immediateAnswer:studyAssistantPromptPack(language).insufficientInformation})};
}
