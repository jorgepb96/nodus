export interface GuideRect { left:number; top:number; width:number; height:number }
export function intersectGuideRects(a:GuideRect,b:GuideRect):GuideRect|null {
 const left=Math.max(a.left,b.left),top=Math.max(a.top,b.top);
 const width=Math.min(a.left+a.width,b.left+b.width)-left,height=Math.min(a.top+a.height,b.top+b.height)-top;
 return width>1&&height>1?{left,top,width,height}:null;
}
const overlap=(a:GuideRect,b:GuideRect)=>Math.max(0,Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top));
const distance=(a:GuideRect,b:GuideRect)=>Math.hypot(Math.max(a.left-b.left-b.width,b.left-a.left-a.width,0),Math.max(a.top-b.top-b.height,b.top-a.top-a.height,0));

/** Prefer nearby free space; use a compact card without an arrow when space is limited. */
export function placeGuide(target:GuideRect|null,card:{width:number;height:number},viewport:{width:number;height:number},controls:readonly GuideRect[]=[]){
 const gap=18,margin=12,topMargin=60;
 const width=Math.min(card.width,viewport.width-margin*2),height=Math.min(card.height,viewport.height-topMargin-margin);
 const candidates:{left:number;top:number;edge?:boolean}[]=[];
 if(target){
  for(const top of [target.top+(target.height-height)/2,target.top,target.top+target.height-height])candidates.push({left:target.left+target.width+gap,top},{left:target.left-width-gap,top});
  for(const left of [target.left+(target.width-width)/2,target.left,target.left+target.width-width])candidates.push({left,top:target.top+target.height+gap},{left,top:target.top-height-gap});
 }
 for(const top of [viewport.height-height-margin,topMargin])for(const left of [viewport.width-width-margin,margin])candidates.push({left,top});
 // A narrow viewport can fit the full card beside a control only at its edge.
 // Prefer that small horizontal margin over covering the control or clipping text.
 if(target)for(const left of [0,viewport.width-width])candidates.push({left,top:target.top,edge:true});
 const scored=candidates.map((candidate,index)=>{
  const h=height;
  const sideMargin=candidate.edge?0:margin;
  const placed={left:Math.max(sideMargin,Math.min(candidate.left,viewport.width-width-sideMargin)),top:Math.max(topMargin,Math.min(candidate.top,viewport.height-h-margin)),width,height:h};
  const targetOverlap=target?overlap(placed,{left:target.left-8,top:target.top-8,width:target.width+16,height:target.height+16}):0;
  const controlOverlap=controls.reduce((sum,control)=>sum+overlap(placed,control),0);
  return {placed,score:targetOverlap*10000+controlOverlap*100+(target?distance(placed,target)*4:0)+(height-h)*2+index*.01};
 });
 return scored.sort((a,b)=>a.score-b.score)[0].placed;
}

/** Connect nearby edges only, without crossing another control. */
export function guideConnector(card:GuideRect,target:GuideRect|null,controls:readonly GuideRect[]=[]){
 if(!target||target.width>600||target.height>240||overlap(card,target))return null;
 const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(n,max));
 const start={x:clamp(target.left+target.width/2,card.left,card.left+card.width),y:clamp(target.top+target.height/2,card.top,card.top+card.height)};
 const edge={x:clamp(start.x,target.left,target.left+target.width),y:clamp(start.y,target.top,target.top+target.height)};
 const length=Math.hypot(start.x-edge.x,start.y-edge.y);
 if(length<12||length>96)return null;
 const end={x:edge.x+(start.x-edge.x)*7/length,y:edge.y+(start.y-edge.y)*7/length};
 for(let i=1;i<10;i++){const x=start.x+(end.x-start.x)*i/10,y=start.y+(end.y-start.y)*i/10;if(controls.some(r=>!overlap(r,target)&&x>r.left&&x<r.left+r.width&&y>r.top&&y<r.top+r.height))return null;}
 return {start,end};
}
