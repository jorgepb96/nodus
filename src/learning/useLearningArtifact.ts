import {useEffect} from 'react';
import type {AcademicLessonId} from '@shared/academicLearning';
import {useAcademicLearning} from './AcademicLearningContext';
export interface LearningArtifactRef { kind:'passage'|'idea'|'work'; id:string }
export async function resolveLearningArtifactRefs(refs:LearningArtifactRef[]) {
 const rows=await Promise.all(refs.slice(0,64).map(async ref=>{
  if(ref.kind==='passage'){const p=await window.nodus.getPassage(ref.id).catch(()=>null);return p?.text.trim()&&!p.web?`${ref.kind}:${ref.id}`:null;}
  if(ref.kind==='idea'){const p=await window.nodus.getIdeaDetail(ref.id).catch(()=>null);return p?.evidence.some(e=>e.quote.trim())?[`${ref.kind}:${ref.id}`,...p.evidence.filter(e=>e.quote.trim()).map(e=>`work:${e.nodus_id}`)]:null;}
  const work=await window.nodus.getWork(ref.id).catch(()=>null);return work?`${ref.kind}:${ref.id}`:null;
 }));return rows.flat().filter((row):row is string=>!!row);
}
export function learningMarkdownRefs(markdown:string):LearningArtifactRef[]{return [...markdown.matchAll(/nodus:\/\/(passage|idea|work)\/([^\s)\]<>]+)/g)].slice(0,64).flatMap(m=>{try{return[{kind:m[1] as LearningArtifactRef['kind'],id:decodeURIComponent(m[2])}];}catch{return[];}});}
export function useLearningArtifact(lessonId:AcademicLessonId, artifactId:string|undefined|null, refs:LearningArtifactRef[]){
 const learning=useAcademicLearning();const key=JSON.stringify(refs);
 useEffect(()=>{
  if(!artifactId||learning.session?.lessonId!==lessonId||learning.session.paused)return;
  let active=true;
  void resolveLearningArtifactRefs(refs).then(citationIds=>{if(active&&citationIds.length)learning.emit({kind:'artifact',artifactId,citationIds,valid:true});});
  return()=>{active=false;};
 },[lessonId,artifactId,key,learning.emit,learning.session?.lessonId,learning.session?.paused]);
 return learning;
}
