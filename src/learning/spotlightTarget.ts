import {intersectGuideRects,type GuideRect} from './spotlightLayout';
/** Virtual rows can have DOM boxes outside a scroller without being visible. */
export function visibleGuideRect(element:HTMLElement):GuideRect|null {
 if(!element.isConnected||element.closest('[hidden],[inert],[aria-hidden="true"]')||!element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return null;
 const raw=element.getBoundingClientRect();
 let rect=intersectGuideRects({left:raw.left,top:raw.top,width:raw.width,height:raw.height},{left:0,top:0,width:window.innerWidth,height:window.innerHeight});
 for(let parent=element.parentElement;rect&&parent&&parent!==document.body;parent=parent.parentElement){
  const style=getComputedStyle(parent),r=parent.getBoundingClientRect();
  const clipsX=/hidden|clip|auto|scroll/.test(style.overflowX),clipsY=/hidden|clip|auto|scroll/.test(style.overflowY);
  if(clipsX||clipsY)rect=intersectGuideRects(rect,{left:clipsX?r.left:rect.left,top:clipsY?r.top:rect.top,width:clipsX?r.width:rect.width,height:clipsY?r.height:rect.height});
 }
 return rect;
}
