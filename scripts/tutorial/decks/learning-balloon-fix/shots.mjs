import {SHOTS as all,TITLE,END_CARD} from '../learning-complete/shots.mjs';
export {TITLE,END_CARD};
// Only the clipped chat/evidence balloons and moving Deep Research form are retaken.
const ids=['simple-send','simple-answer-wait','simple-answer','simple-evidence','simple-verified','deep-deep','deep-deep-question','deep-deep-scope','deep-deep-options','deep-deep-open','deep-deep-evidence'];
export const SHOTS=all.filter(s=>ids.includes(s.id)).map(shot=>({...shot,act:async h=>{
 if(shot.id==='deep-deep'){await h.pause();await h.profile('advanced');}
 if(shot.id==='deep-deep-open'){
  await h.page.keyboard.press('Escape');
  const reports=await h.page.evaluate(()=>window.nodus.listWritingWorkshopDrafts());
  if(!reports.length)throw new Error('A retained real report is required; this correction does not regenerate reports');
  h.deepId=reports[0].id;
 }
 await shot.act?.(h);await h.settle(350);
 const result=await h.page.evaluate(()=>{const coach=document.querySelector('[data-testid="academic-learning-coach"]');return coach?{scroll:coach.scrollHeight-coach.clientHeight}:null;});
 if(result&&result.scroll>1)throw new Error('A tutorial balloon is clipped');
 if(shot.id==='deep-deep-scope'){
  const audit=await h.page.evaluate(()=>new Promise(resolve=>{
   const coach=document.querySelector('[data-testid="academic-learning-coach"]'),ring=document.querySelector('[data-testid="learning-control-highlight"]');let last=null,toggles=0,replacements=0,samples=0;const until=performance.now()+1800;
   const read=()=>{const now=document.querySelector('[data-testid="academic-learning-coach"]'),r=document.querySelector('[data-testid="learning-control-highlight"]');const visible=!!r&&getComputedStyle(r).visibility!=='hidden';if(last!==null&&visible!==last)toggles++;last=visible;if(now!==coach||r!==ring)replacements++;samples++;if(performance.now()<until)requestAnimationFrame(read);else resolve({toggles,replacements,samples});};read();
  }));
  if(audit.toggles||audit.replacements)throw new Error('Unstable Deep Research annotation: '+JSON.stringify(audit));
  console.log('Deep Research stable annotation',JSON.stringify(audit));
 }
}}));
