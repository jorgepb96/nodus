import {useEffect,useState} from 'react';
import type {AcademicLessonId} from '@shared/academicLearning';
/** Existing confirmations retain the screen; learning never adds a second modal. */
export function useLearningOverlayBusy(guiding?:AcademicLessonId){
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  const read=()=>setBusy([...document.querySelectorAll<HTMLElement>('[aria-modal="true"],dialog[open]')].some(el=>{
   if(el.closest('.learning-dialog')||!el.getClientRects().length)return false;
   if(guiding){
    if(el.matches('[data-testid="source-citation-modal"]')||el.querySelector('[data-testid="source-citation-modal"]'))return false;
    if(['first-answer','first-idea'].includes(guiding)&&el.matches('[data-testid="research-preparation-welcome"]'))return false;
    if(guiding==='interface'&&el.matches('[data-testid="academic-interface-picker"]'))return false;
    if(guiding==='deep-research'&&el.matches('[data-testid="deep-research-composer"]'))return false;
    if(guiding==='dictionary'&&el.querySelector('[data-testid="dictionary-concept-name-0"]'))return false;
    if(['first-idea','authors','argument-map','hypothesis'].includes(guiding)&&el.matches('[data-testid="idea-detail-modal"]'))return false;
    if(guiding==='first-idea'&&(el.matches('[data-testid="manual-idea-form"]')||el.querySelector('[data-testid="manual-idea-form"]')))return false;
   }
   return true;
  }));
  read();const observer=new MutationObserver(read);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','aria-modal','class','hidden']});
  return()=>observer.disconnect();
 },[guiding]);return busy;
}
