import {useEffect,useLayoutEffect,useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {placeGuide,guideConnector,type GuideRect} from './spotlightLayout';
import {visibleGuideRect} from './spotlightTarget';
import {useGuidedInteraction} from './useGuidedInteraction';
import './academicLearning.css';

/** An annotation of real controls, optionally limiting a guided step to its expected actions. */
export function AcademicLearningSpotlight({targets,allowedTargets=[],guided=false,stepKey,children,onPause,label,testId='academic-learning-coach'}:{targets:readonly string[];allowedTargets?:readonly string[];guided?:boolean;stepKey:string;children:ReactNode;onPause:()=>void;label:string;testId?:string}) {
 const layer=useRef<HTMLDivElement>(null),card=useRef<HTMLElement>(null);
 const [target,setTarget]=useState<{key:string;element:HTMLElement;selector:string;rect:GuideRect}|null>(null);
 const [controls,setControls]=useState<GuideRect[]>([]);
 const [allowedRects,setAllowedRects]=useState<GuideRect[]>([]);
 const [host,setHost]=useState<HTMLElement>(()=>document.querySelector('[data-testid="app-shell"]')??document.body);
 const [size,setSize]=useState({width:318,height:220});
 const [viewport,setViewport]=useState({width:window.innerWidth,height:window.innerHeight});
 const descriptionId=useId(),arrowId=useId().replace(/:/g,'');
 const selectors=JSON.stringify(targets);
 const permissions=JSON.stringify([...targets,...allowedTargets]);
 const targetKey=stepKey+selectors;
 const currentTarget=target?.key===targetKey?target:null;
 const anchor=currentTarget?.element??null,rect=currentTarget?.rect??null;
 useGuidedInteraction(guided,JSON.parse(permissions),layer);
 const cardWidth=Math.min(viewport.width-24,viewport.height<650?368:318);
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
   setHost(old=>{const parent=modal??document.querySelector<HTMLElement>('[data-testid="app-shell"]')??document.body;return old===parent?old:parent;});
   const replaced=!found||!next||!previous||previous.element!==found;
   const moved=!!next&&!!previous&&!same(previous.rect,next);
   if(replaced){stableAt=performance.now();setTarget(old=>old?.element===found?old:null);dirty=true;}
   previous=found&&next?{element:found,rect:next}:null;
   if(found&&next&&!replaced&&performance.now()-stableAt>=90){
    setTarget(old=>old?.key===targetKey&&old.element===found&&same(old.rect,next!)?old:{key:targetKey,element:found!,selector:matched,rect:next!});
    // A stable control may move as its content loads. Follow it directly, without
    // dropping the anchor, remounting the card or waiting for another stable period.
    const ring=layer.current?.querySelector<HTMLElement>('.learning-control-highlight');
    if(ring){ring.style.left=`${next.left-4}px`;ring.style.top=`${next.top-4}px`;ring.style.width=`${next.width+8}px`;ring.style.height=`${next.height+8}px`;}
   }
   for(const el of layer.current?.querySelectorAll<HTMLElement|SVGElement>('.learning-control-highlight,.learning-guide-arrow')??[])el.style.visibility=replaced||performance.now()-stableAt<90?'hidden':'';
   if(moved)dirty=true;
   if(dirty||performance.now()-lastControls>=150){
    lastControls=performance.now();dirty=false;
    const available=[...(modal??document).querySelectorAll<HTMLElement>('button,input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role="button"],[role="tab"],.research-composer-shell,[data-message-id],[data-learning-protected]')].filter(el=>!el.closest('[data-learning-guide]')).flatMap(el=>{const r=visibleGuideRect(el);return r?[r]:[];});
    setControls(old=>JSON.stringify(old)===JSON.stringify(available)?old:available);
    const permitted=(JSON.parse(permissions) as string[]).flatMap(selector=>[...document.querySelectorAll<HTMLElement>(selector)]).flatMap(el=>{const r=visibleGuideRect(el);return r?[r]:[];});
    setAllowedRects(old=>JSON.stringify(old)===JSON.stringify(permitted)?old:permitted);
   }
   setViewport(old=>old.width===window.innerWidth&&old.height===window.innerHeight?old:{width:window.innerWidth,height:window.innerHeight});
   frame=requestAnimationFrame(measure);
  };
  const observer=new MutationObserver(()=>{dirty=true;});
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-expanded','aria-selected','disabled']});
  measure();
  return()=>{active=false;cancelAnimationFrame(frame);observer.disconnect();};
 },[selectors,targetKey,permissions]);
 useEffect(()=>{
  const element=layer.current;if(!element)return;
  const accent=document.querySelector<HTMLElement>('[data-testid="app-shell"]')?.style.getPropertyValue('--vault-accent');if(accent)element.style.setProperty('--vault-accent',accent);
  element.setAttribute('popover','manual');element.showPopover();
  if(document.activeElement===document.body&&anchor?.matches('button,input,textarea,select'))anchor.focus({preventScroll:true});
  const resize=new ResizeObserver(()=>{const element=card.current;if(element){const height=Math.ceil(Math.max(element.getBoundingClientRect().height,element.scrollHeight+2));setSize(old=>old.height===height?old:{width:cardWidth,height});}});if(card.current)resize.observe(card.current);
  return()=>{resize.disconnect();if(element.matches(':popover-open'))element.hidePopover();};
 },[host,cardWidth]);
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
 const placed=placeGuide(rect,{...size,width:cardWidth},viewport,controls);
 const connector=guideConnector(placed,rect,controls);
 // Rendering inside a native dialog keeps the annotation accessible in its focus scope.
 return createPortal(<div ref={layer} className="learning-spotlight-layer" data-learning-guide="true" data-learning-target={currentTarget?.selector} data-learning-step={stepKey} data-browser-native-overlay="true" data-testid="academic-learning-spotlight" style={{position:'fixed',left:0,top:0,width:viewport.width,height:viewport.height}}>
  {guided&&<svg className="learning-guided-shade" data-testid="learning-guided-shade" aria-hidden="true" width={viewport.width} height={viewport.height}><defs><mask id={`${arrowId}-shade`}><rect width="100%" height="100%" fill="white"/>{allowedRects.map((r,i)=><rect key={i} x={r.left-5} y={r.top-5} width={r.width+10} height={r.height+10} rx="8" fill="black"/>)}<rect x={placed.left-3} y={placed.top-3} width={placed.width+6} height={placed.height+6} rx="15" fill="black"/></mask></defs><rect width="100%" height="100%" fill="#0007" mask={`url(#${arrowId}-shade)`}/></svg>}
  {rect&&rect.width*rect.height<viewport.width*viewport.height*.4&&<div aria-hidden="true" data-testid="learning-control-highlight" className="learning-control-highlight" style={{left:rect.left-4,top:rect.top-4,width:rect.width+8,height:rect.height+8}}/>}
  {connector&&<svg className="learning-guide-arrow" data-testid="learning-guide-connector" aria-hidden="true" width={viewport.width} height={viewport.height}><defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs><path d={`M ${connector.start.x} ${connector.start.y} L ${connector.end.x} ${connector.end.y}`} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd={`url(#${arrowId})`}/></svg>}
  <section ref={card} className="learning-coach learning-coach-floating" data-testid={testId} role="region" aria-label={label} id={descriptionId} tabIndex={-1} style={{left:placed.left,top:placed.top,width:cardWidth,maxWidth:viewport.width-24,maxHeight:viewport.height-72}}>{children}</section>
 </div>,host);
}
