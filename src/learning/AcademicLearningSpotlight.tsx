import {useEffect,useLayoutEffect,useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {placeGuide,guideConnector,type GuideRect} from './spotlightLayout';
import {visibleGuideRect} from './spotlightTarget';
import './academicLearning.css';

/** A non-modal annotation of the real control. It never intercepts app actions. */
export function AcademicLearningSpotlight({targets,stepKey,children,onPause,label,testId='academic-learning-coach'}:{targets:readonly string[];stepKey:string;children:ReactNode;onPause:()=>void;label:string;testId?:string}) {
 const layer=useRef<HTMLDivElement>(null),card=useRef<HTMLElement>(null);
 const [target,setTarget]=useState<{key:string;element:HTMLElement;selector:string;rect:GuideRect}|null>(null);
 const [controls,setControls]=useState<GuideRect[]>([]);
 const [size,setSize]=useState({width:318,height:220});
 const [viewport,setViewport]=useState({width:window.innerWidth,height:window.innerHeight});
 const descriptionId=useId(),arrowId=useId().replace(/:/g,'');
 const selectors=JSON.stringify(targets);
 const targetKey=stepKey+selectors;
 const currentTarget=target?.key===targetKey?target:null;
 const anchor=currentTarget?.element??null,rect=currentTarget?.rect??null;
 useLayoutEffect(()=>{
  let frame=0,active=true,stableAt=0,lastControls=0,dirty=true,scrolled=false;
  let previous:{element:HTMLElement;rect:GuideRect}|null=null;
  const parsed=JSON.parse(selectors) as string[];
  const same=(a:GuideRect,b:GuideRect)=>Math.abs(a.left-b.left)<.5&&Math.abs(a.top-b.top)<.5&&Math.abs(a.width-b.width)<.5&&Math.abs(a.height-b.height)<.5;
  const measure=()=>{
   if(!active)return;
   const modal=[...document.querySelectorAll<HTMLElement>('dialog[open],[aria-modal="true"]')].filter(el=>!el.closest('[data-learning-guide]')&&el.getClientRects().length>0).at(-1);
   let found:HTMLElement|null=null,next:GuideRect|null=null,matched='';
   for(const selector of parsed){
    for(const el of document.querySelectorAll<HTMLElement>(selector)){
     if(modal&&!modal.contains(el))continue;
     let r=visibleGuideRect(el);
     if(!r&&!scrolled&&!el.closest('[hidden],[inert],[aria-hidden="true"]')&&el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})){
      scrolled=true;el.scrollIntoView({block:'nearest',behavior:'instant'});r=visibleGuideRect(el);
     }
     if(r){found=el;next=r;matched=selector;break;}
    }
    if(found)break;
   }
   const changed=!found||!next||!previous||previous.element!==found||!same(previous.rect,next);
   if(changed){stableAt=performance.now();previous=found&&next?{element:found,rect:next}:null;setTarget(null);dirty=true;}
   if(found&&next&&!changed&&performance.now()-stableAt>=90)setTarget(old=>old?.key===targetKey&&old.element===found&&same(old.rect,next!)?old:{key:targetKey,element:found!,selector:matched,rect:next!});
   // Hide before the compositor paints a moving or replaced control.
   for(const el of layer.current?.querySelectorAll<HTMLElement|SVGElement>('.learning-control-highlight,.learning-guide-arrow')??[])el.style.visibility=changed?'hidden':'';
   if(dirty||performance.now()-lastControls>=150){
    lastControls=performance.now();dirty=false;
    const available=[...(modal??document).querySelectorAll<HTMLElement>('button,input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role="button"],[role="tab"],.research-composer-shell,[data-message-id]')].filter(el=>!el.closest('[data-learning-guide]')).flatMap(el=>{const r=visibleGuideRect(el);return r?[r]:[];});
    setControls(old=>JSON.stringify(old)===JSON.stringify(available)?old:available);
   }
   setViewport(old=>old.width===window.innerWidth&&old.height===window.innerHeight?old:{width:window.innerWidth,height:window.innerHeight});
   frame=requestAnimationFrame(measure);
  };
  const observer=new MutationObserver(()=>{dirty=true;});
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-expanded','aria-selected','disabled']});
  measure();
  return()=>{active=false;cancelAnimationFrame(frame);observer.disconnect();};
 },[selectors,targetKey]);
 useEffect(()=>{
  const element=layer.current;if(!element)return;
  const accent=document.querySelector<HTMLElement>('[data-testid="app-shell"]')?.style.getPropertyValue('--vault-accent');if(accent)element.style.setProperty('--vault-accent',accent);
  element.setAttribute('popover','manual');element.showPopover();
  if(document.activeElement===document.body)card.current?.focus({preventScroll:true});
  const resize=new ResizeObserver(()=>{const element=card.current;if(element){const height=Math.max(element.getBoundingClientRect().height,element.scrollHeight+2);setSize(old=>old.height===height?old:{width:318,height});}});if(card.current)resize.observe(card.current);
  return()=>{resize.disconnect();if(element.matches(':popover-open'))element.hidePopover();};
 },[anchor?.closest('dialog[open],[aria-modal="true"]')]);
 useEffect(()=>{
  if(!anchor)return;
  const previous=anchor.getAttribute('aria-describedby');
  anchor.setAttribute('aria-describedby',[previous,descriptionId].filter(Boolean).join(' '));
  return()=>{const remaining=(anchor.getAttribute('aria-describedby')??'').split(/\s+/).filter(id=>id&&id!==descriptionId);if(remaining.length)anchor.setAttribute('aria-describedby',remaining.join(' '));else anchor.removeAttribute('aria-describedby');};
 },[anchor,descriptionId]);
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(event.key!=='Escape'||event.defaultPrevented)return;
   const popup=[...document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"],[aria-modal="true"],[data-testid="header-queue-panel"],[data-testid="header-more-panel"],.academic-secondary-panel:not([hidden])')].some(el=>el.getClientRects().length>0);
   if(!popup)onPause();
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[onPause]);
 const placed=placeGuide(rect,size,viewport,controls);
 const connector=guideConnector(placed,rect,controls);
 // Rendering inside a native dialog keeps the annotation accessible in its focus scope.
 const host=anchor?.closest('dialog[open],[aria-modal="true"]')??document.querySelector('[data-testid="app-shell"]')??document.body;
 return createPortal(<div ref={layer} className="learning-spotlight-layer" data-learning-guide="true" data-learning-target={currentTarget?.selector} data-learning-step={stepKey} data-browser-native-overlay="true" data-testid="academic-learning-spotlight" style={{position:'fixed',left:0,top:0,width:viewport.width,height:viewport.height}}>
  {rect&&rect.width*rect.height<viewport.width*viewport.height*.4&&<div aria-hidden="true" data-testid="learning-control-highlight" className="learning-control-highlight" style={{left:rect.left-4,top:rect.top-4,width:rect.width+8,height:rect.height+8}}/>}
  {connector&&<svg className="learning-guide-arrow" data-testid="learning-guide-connector" aria-hidden="true" width={viewport.width} height={viewport.height}><defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs><path d={`M ${connector.start.x} ${connector.start.y} L ${connector.end.x} ${connector.end.y}`} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd={`url(#${arrowId})`}/></svg>}
  <section ref={card} className="learning-coach learning-coach-floating" data-testid={testId} role="region" aria-label={label} id={descriptionId} tabIndex={-1} style={{left:placed.left,top:placed.top,width:318,maxWidth:viewport.width-24,maxHeight:Math.max(130,Math.min(placed.height,340,viewport.height-72))}}>{children}</section>
 </div>,host);
}
