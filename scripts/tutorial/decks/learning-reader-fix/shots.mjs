import {SHOTS as all,TITLE,END_CARD} from '../learning-complete/shots.mjs';
export {TITLE,END_CARD};
export const SHOTS=all.filter(s=>['deep-deep','deep-deep-evidence'].includes(s.id)).map(shot=>({...shot,act:async h=>{
 if(shot.id==='deep-deep-evidence'){
  await h.page.keyboard.press('Escape');
  const reports=await h.page.evaluate(()=>window.nodus.listWritingWorkshopDrafts());
  await h.page.locator(`[data-anchor-id="${reports[0].id}"] button`).first().click();
  await h.page.getByTestId('deep-research-reader-document').waitFor();await h.wait(s=>s.academicPracticeSession?.step>=1,'retained real report references');
  const citation=h.page.locator('[data-testid="deep-research-reader-document"] button.citation-link').first();await citation.waitFor();await h.settle(600);
  await citation.evaluate(el=>window.__retainedReportCitation=el);await citation.scrollIntoViewIfNeeded();await h.settle(1000);
  if(!await citation.evaluate(el=>el===window.__retainedReportCitation))throw new Error('Reader scrolling replaced the citation');
  console.log('Verified stable report citation through scrolling');
 }
 await shot.act?.(h);await h.settle(350);
 const clipped=await h.page.getByTestId('academic-learning-coach').evaluate(el=>el.scrollHeight>el.clientHeight+1);
 if(clipped)throw new Error('The reader balloon is clipped');
}}));
