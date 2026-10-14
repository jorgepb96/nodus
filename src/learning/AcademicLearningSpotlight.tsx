import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {placeGuide,type GuideRect} from './spotlightLayout';
import './academicLearning.css';

/** A non-modal annotation of the real control. It never intercepts app actions. */
export function AcademicLearningSpotlight({targets,stepKey,children,onPause,label,testId='academic-learning-coach'}:{targets:readonly string[];stepKey:string;children:ReactNode;onPause:()=>void;label:string;testId?:string}) {
 const layer=useRef<HTMLDivElement>(null),card=useRef<HTMLElement>(null);
 const [anchor,setAnchor]=useState<HTMLElement|null>(null);
 const [rect,setRect]=useState<GuideRect|null>(null);
 const [controls,setControls]=useState<GuideRect[]>([]);
 const [size,setSize]=useState({width:318,height:220});
 const [viewport,setViewport]=useState({width:window.innerWidth,height:window.innerHeight});
 const descriptionId=useId(),arrowId=useId().replace(/:/g,'');
 const selectors=JSON.stringify(targets);
 useEffect(()=>{
  let frame=0,tracking=0,active=true,scrolled=false,current:HTMLElement|null=null;
  const measure=()=>{
   frame=0;if(!active)return;
   const modal=[...document.querySelectorAll<HTMLElement>('dialog[open],[aria-modal="true"]')].filter(el=>!el.closest('[data-learning-guide]')&&el.getClientRects().length>0).at(-1);
   let found:HTMLElement|null=null;
   for(const selector of JSON.parse(selectors) as string[]){
    found=[...document.querySelectorAll<HTMLElement>(selector)].find(el=>el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'&&(!modal||modal.contains(el)))??null;
    if(found)break;
   }
   if(found!==current){current=found;setAnchor(found);resize.disconnect();if(found)resize.observe(found);}
   if(!scrolled&&found){scrolled=true;const r=found.getBoundingClientRect();if(r.bottom<48||r.top>window.innerHeight-16)found.scrollIntoView({block:'nearest',behavior:'instant'});}
   const r=found?.getBoundingClientRect();
   const next=r&&r.bottom>44&&r.top<window.innerHeight&&r.right>0&&r.left<window.innerWidth ? {left:Math.max(0,r.left),top:Math.max(44,r.top),width:Math.min(r.right,window.innerWidth)-Math.max(0,r.left),height:Math.min(r.bottom,window.innerHeight)-Math.max(44,r.top)} : null;
   setRect(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
   const available=[...(modal??document).querySelectorAll<HTMLElement>('button,input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role="button"],[role="tab"]')].filter(el=>!el.closest('[data-learning-guide]')&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden').map(el=>{const r=el.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height};}).filter(r=>r.width>0&&r.height>0&&r.top<window.innerHeight&&r.top+r.height>44&&r.left<window.innerWidth&&r.left+r.width>0);
   setControls(previous=>JSON.stringify(previous)===JSON.stringify(available)?previous:available);
   setViewport(previous=>previous.width===window.innerWidth&&previous.height===window.innerHeight?previous:{width:window.innerWidth,height:window.innerHeight});
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const resize=new ResizeObserver(schedule);
  const observer=new MutationObserver(schedule);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-expanded','aria-selected','disabled']});
  window.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);
  // Track the short selector/view transition without a permanent animation loop.
  const until=performance.now()+400;
  const track=()=>{measure();if(performance.now()<until)tracking=requestAnimationFrame(track);};track();
  return()=>{active=false;cancelAnimationFrame(frame);cancelAnimationFrame(tracking);observer.disconnect();resize.disconnect();window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);};
 },[selectors,stepKey]);
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
 const target=rect ? {x:rect.left+rect.width/2,y:rect.top+rect.height/2}:null;
 const start=target?{x:Math.max(placed.left+8,Math.min(target.x,placed.left+placed.width-8)),y:Math.max(placed.top+8,Math.min(target.y,placed.top+placed.height-8))}:null;
 const end=target&&start&&rect?{
  x:start.x<rect.left?rect.left-7:start.x>rect.left+rect.width?rect.left+rect.width+7:target.x,
  y:start.y<rect.top?rect.top-7:start.y>rect.top+rect.height?rect.top+rect.height+7:target.y,
 }:target;
 // Rendering inside a native dialog keeps the annotation accessible in its focus scope.
 const host=anchor?.closest('dialog[open],[aria-modal="true"]')??document.querySelector('[data-testid="app-shell"]')??document.body;
 return createPortal(<div ref={layer} className="learning-spotlight-layer" data-learning-guide="true" data-browser-native-overlay="true" data-testid="academic-learning-spotlight" style={{position:'fixed',left:0,top:0,width:viewport.width,height:viewport.height}}>
  {rect&&rect.width*rect.height<viewport.width*viewport.height*.4&&<div aria-hidden="true" data-testid="learning-control-highlight" className="learning-control-highlight" style={{left:rect.left-4,top:rect.top-4,width:rect.width+8,height:rect.height+8}}/>}
  {end&&start&&<svg className="learning-guide-arrow" aria-hidden="true" width={viewport.width} height={viewport.height}><defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs><path d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd={`url(#${arrowId})`}/></svg>}
  <section ref={card} className="learning-coach learning-coach-floating" data-testid={testId} role="region" aria-label={label} id={descriptionId} tabIndex={-1} style={{left:placed.left,top:placed.top,width:318,maxWidth:viewport.width-24,maxHeight:Math.max(130,Math.min(placed.height,340,viewport.height-72))}}>{children}</section>
 </div>,host);
}
