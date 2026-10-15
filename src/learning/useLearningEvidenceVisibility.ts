import {useEffect,type RefObject} from 'react';
import type {IdeaDetail} from '@shared/types';
import {useAcademicLearning} from './AcademicLearningContext';

/** Reading the actual visible quotation is the checkpoint, not loading its record. */
export function useLearningEvidenceVisibility(detail:IdeaDetail|null,root:RefObject<HTMLElement|null>){
 const learning=useAcademicLearning();
 useEffect(()=>{
  const session=learning.session;
  if(!detail||!session||session.paused)return;
  const observer=new IntersectionObserver(entries=>{
   for(const entry of entries){
    if(!entry.isIntersecting||entry.intersectionRatio<.25||!(entry.target as HTMLElement).checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))continue;
    const evidence=detail.evidence.find(e=>String(e.id)===(entry.target as HTMLElement).dataset.evidenceId&&e.quote.trim());
    if(!evidence)continue;
    if(evidence.nodus_id===session.documentId)learning.emit({kind:'idea-evidence',documentId:evidence.nodus_id,ideaId:detail.idea.global_id,valid:true});
    if(session.artifactId&&session.citationIds?.includes(`idea:${detail.idea.global_id}`))learning.emit({kind:'artifact-evidence',artifactId:session.artifactId,citationIds:[`idea:${detail.idea.global_id}`],valid:true});
   }
  },{threshold:.25});
  for(const quote of root.current?.querySelectorAll('[data-evidence-id]')??[])observer.observe(quote);
  return()=>observer.disconnect();
 },[detail,learning.emit,learning.session?.documentId,learning.session?.artifactId,learning.session?.paused,root]);
}
