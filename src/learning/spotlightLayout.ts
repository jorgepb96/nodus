export interface GuideRect { left:number; top:number; width:number; height:number }
export function placeGuide(target:GuideRect|null, card:{width:number;height:number}, viewport:{width:number;height:number}, controls:readonly GuideRect[] = []) {
 const gap=18, margin=12;
 const width=Math.min(card.width,viewport.width-margin*2),height=Math.min(card.height,viewport.height-margin*2);
 const clamp=(value:number,max:number)=>Math.max(margin,Math.min(value,max-margin));
 const corners=[
  {left:viewport.width-width-margin,top:viewport.height-height-margin},
  {left:margin,top:viewport.height-height-margin},
  {left:viewport.width-width-margin,top:60},
  {left:margin,top:60},
 ];
 const candidates=target ? [
  {left:target.left+target.width+gap,top:target.top},
  {left:target.left-width-gap,top:target.top},
  {left:target.left,top:target.top+target.height+gap},
  {left:target.left,top:target.top-height-gap},...corners,
  // On small windows, let the annotation scroll instead of covering its control.
  ...(target.top-gap-margin>=130?[{left:target.left,top:margin,height:Math.min(height,target.top-gap-margin)}]:[]),
  ...(viewport.height-target.top-target.height-gap-margin>=130?[{left:target.left,top:target.top+target.height+gap,height:Math.min(height,viewport.height-target.top-target.height-gap-margin)}]:[]),
 ]:corners;
 const scored=candidates.map((candidate,index)=>{
  const candidateHeight='height' in candidate?candidate.height!:height;
  const placed={left:clamp(candidate.left,viewport.width-width),top:clamp(candidate.top,viewport.height-candidateHeight),width,height:candidateHeight};
  const overlap=target ? Math.max(0,Math.min(placed.left+width,target.left+target.width+8)-Math.max(placed.left,target.left-8))*Math.max(0,Math.min(placed.top+candidateHeight,target.top+target.height+8)-Math.max(placed.top,target.top-8)):0;
  const controlOverlap=controls.reduce((sum,control)=>sum+Math.max(0,Math.min(placed.left+width,control.left+control.width+4)-Math.max(placed.left,control.left-4))*Math.max(0,Math.min(placed.top+candidateHeight,control.top+control.height+4)-Math.max(placed.top,control.top-4)),0);
  return {placed,score:overlap*1000+controlOverlap*20+Math.abs(placed.left-candidate.left)+Math.abs(placed.top-candidate.top)+(height-candidateHeight)+index};
 });
 return scored.sort((a,b)=>a.score-b.score)[0].placed;
}
