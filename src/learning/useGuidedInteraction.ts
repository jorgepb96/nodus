import {useEffect,type RefObject} from 'react';

const focusable='button:not(:disabled),input:not(:disabled):not([type="hidden"]),textarea:not(:disabled),select:not(:disabled),[contenteditable="true"],a[href],[tabindex]:not([tabindex="-1"])';
/** Keep the real app controls active, but constrain a guided step to its expected actions. */
export function useGuidedInteraction(enabled:boolean,selectors:readonly string[],layer:RefObject<HTMLDivElement|null>) {
 const key=JSON.stringify(selectors);
 useEffect(()=>{
  if(!enabled)return;
  const parsed=JSON.parse(key) as string[];
  const roots=()=>parsed.flatMap(selector=>[...document.querySelectorAll<HTMLElement>(selector)]).filter(el=>el.isConnected&&el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
  const allowed=(target:EventTarget|null)=>target instanceof Node&&(!!layer.current?.contains(target)||roots().some(el=>el.contains(target)));
  const choices=()=>[...new Set([...roots().flatMap(el=>el.matches(focusable)?[el]:[...el.querySelectorAll<HTMLElement>(focusable)]),...layer.current?.querySelectorAll<HTMLElement>(focusable)??[]])].filter(el=>el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
  const block=(event:Event)=>{if(!allowed(event.target)){event.preventDefault();event.stopImmediatePropagation();}};
  const keyboard=(event:KeyboardEvent)=>{
   if(event.key==='Escape')return; // A guide can always be left; native dialogs keep their own close action.
   if(event.key==='Tab'){
    const items=choices();if(!items.length)return;
    const index=items.indexOf(document.activeElement as HTMLElement),next=index<0?(event.shiftKey?items.length-1:0):(index+(event.shiftKey?-1:1)+items.length)%items.length;
    event.preventDefault();event.stopImmediatePropagation();items[next].focus({preventScroll:true});return;
   }
   block(event);
  };
  const focus=(event:FocusEvent)=>{if(!allowed(event.target))choices()[0]?.focus({preventScroll:true});};
  const events=['pointerdown','mousedown','mouseup','click','dblclick','contextmenu','beforeinput','dragstart','drop'];
  for(const name of events)document.addEventListener(name,block,true);
  document.addEventListener('keydown',keyboard,true);document.addEventListener('focusin',focus,true);
  return()=>{for(const name of events)document.removeEventListener(name,block,true);document.removeEventListener('keydown',keyboard,true);document.removeEventListener('focusin',focus,true);};
 },[enabled,key,layer]);
}
