import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
const scratch=await mkdtemp(path.join(os.tmpdir(),'nodus-learning-test-'));
function load(file){const out=path.join(scratch,path.basename(file)+'.cjs');buildSync({entryPoints:[file],outfile:out,bundle:true,format:'cjs',platform:'node',logLevel:'silent'});return require(out);}
const L=load('shared/academicLearning.ts'),C=load('shared/academicLearningCopy.ts'),S=load('shared/academicLearningSample.ts');
test.after(()=>rm(scratch,{recursive:true,force:true}));
const event=(session,kind,extras={})=>({sessionId:session.id,vaultId:session.vaultId,kind,...extras});
const observe=(s,kind,extra)=>L.observeLearning(s,event(s,kind,extra));
test('a rejected uncited chat turn is distinguished from a provider error or a user stop',()=>{
 assert.equal(L.learningChatRecovery(new Error('Error invoking remote method: El modelo no devolvió ninguna cita verificable del contexto tras tres intentos idénticos.')),'no-citation');
 assert.equal(L.learningChatRecovery(new Error('quota')),'provider');
 assert.equal(L.learningChatRecovery(new Error('quota'),true),'cancelled');
});
test('first answer needs the chosen source, preparation, a cited answer and opening that exact message',()=>{
 let s=L.newPractice('vault-a','first-answer','run-a');
 assert.equal(observe(s,'explanation'),s);s=observe(s,'source',{documentId:'doc-a'});
 assert.equal(s.step,1);assert.equal(observe(s,'prepared',{documentId:'doc-b',valid:true}),s);
 assert.equal(observe(s,'prepared',{valid:false}),s);s=observe(s,'prepared',{documentId:'doc-a',valid:true});
 assert.equal(s.step,2);assert.equal(observe(s,'answer',{valid:true,citationIds:[]}),s);
 s=observe(s,'answer',{documentId:'doc-a',valid:true,citationIds:['passage:p1'],conversationId:'chat-a',messageId:'answer-a'});
 assert.equal(s.step,3);assert.equal(observe(s,'citation',{documentId:'doc-a',valid:true,citationIds:['passage:p1'],conversationId:'other',messageId:'old'}),s);
 assert.equal(observe(s,'citation',{documentId:'doc-b',valid:true,citationIds:['passage:p1'],conversationId:'chat-a',messageId:'answer-a'}),s);
 s=observe(s,'citation',{documentId:'doc-a',valid:true,citationIds:['passage:p1'],conversationId:'chat-a',messageId:'answer-a'});
 assert.equal(s.phase,'complete');assert.equal(s.step,4);
});
test('late events, another vault, paused and completed sessions cannot move a lesson',()=>{
 const s=L.newPractice('v1','first-answer','r1');
 for(const bad of [{vaultId:'v2'},{sessionId:'r2'}])assert.equal(L.observeLearning(s,{...event(s,'source',{documentId:'d1'}),...bad}),s);
 const paused={...s,paused:true};assert.equal(L.observeLearning(paused,event(paused,'source',{documentId:'d1'})),paused);
 const done={...s,step:4,phase:'complete'};assert.equal(L.observeLearning(done,event(done,'recovery',{recovery:'provider'})),done);
});
test('extraction requires real results, evidence and a graph node; no ideas is never a success',()=>{
 let s=L.newPractice('v','first-idea','r');s=observe(s,'source',{documentId:'d'});
 s=observe(s,'extraction',{documentId:'d',taskId:'task'});assert.equal(s.phase,'wait');
 s=observe(s,'recovery',{recovery:'no-ideas'});assert.equal(s.step,2);assert.equal(s.phase,'recovery');
 assert.equal(observe(s,'ideas',{valid:false}),s);
 s=observe(s,'ideas',{documentId:'d',ideaId:'i',valid:true});assert.equal(s.step,3);
 assert.equal(observe(s,'idea-evidence',{documentId:'d',ideaId:'other',valid:true}),s);
 s=observe(s,'idea-evidence',{documentId:'d',ideaId:'i',valid:true});
 assert.equal(observe(s,'graph',{ideaId:'wrong',valid:true}),s);
 s=observe(s,'graph',{documentId:'d',ideaId:'i',valid:true});assert.equal(s.phase,'complete');
});
test('recoveries preserve identifiers and checkpoints; only a valid outcome clears them',()=>{
 let s=observe(L.newPractice('v','first-answer','r'),'source',{documentId:'d'});
 for(const recovery of ['model','source','partial','paused','cancelled','provider']){s=observe(s,'recovery',{recovery});assert.equal(s.documentId,'d');assert.equal(s.step,1);assert.equal(s.phase,'recovery');assert.equal(observe(s,'recovery',{recovery}),s);}
 s=observe(s,'prepared',{documentId:'d',valid:true});assert.equal(s.step,2);assert.equal(s.recovery,undefined);
});
test('each independent challenge checks an artifact and its own resolved reference',()=>{
 for(const id of ['overview','hypothesis','reading','deep-research','scriptor','authors','argument-map','dictionary']){
  let s=L.newPractice('v',id,'r');assert.equal(observe(s,'explanation'),s);
  s=observe(s,'artifact',{artifactId:'a',citationIds:['idea:i'],valid:true});assert.equal(s.step,1);
  assert.equal(observe(s,'artifact-evidence',{artifactId:'b',citationIds:['idea:i'],valid:true}),s);
  assert.equal(observe(s,'artifact-evidence',{artifactId:'a',citationIds:['idea:other'],valid:true}),s);
  s=observe(s,'artifact-evidence',{artifactId:'a',citationIds:['idea:i'],valid:true});assert.equal(s.phase,'complete',id);
 }
});
test('new simple model setup only assigns chat and embeddings, bypassing basic fan-out',()=>{
 const base={synthesisModel:null,extractionModel:null,fusionModel:null,relationModel:null,summaryModel:null,chatModel:null};
 const chat={provider:'openai',model:'chat-fixture'},embed={provider:'openai',model:'embed-fixture'};
 const patch=L.learningModelPatch(base,'chat',chat,embed);
 assert.equal(patch.modelSettingsMode,'advanced');assert.equal(patch.modelSettingsVersion,4);assert.deepEqual(patch.chatModel,chat);assert.equal(patch.embeddingModel,'embed-fixture');
 for(const key of ['synthesisModel','extractionModel','fusionModel','summaryModel','deepResearchModel','documentIndexingEnabled','academicMode','academicInterfaceProfile'])assert.equal(Object.hasOwn(patch,key),false,key);
 const analysis={provider:'openai',model:'analysis-fixture'};const next=L.learningModelPatch({...base,chatModel:chat},'analysis',analysis);
 assert.deepEqual(next.extractionModel,analysis);assert.equal(Object.hasOwn(next,'chatModel'),false);assert.equal(Object.hasOwn(next,'embeddingModel'),false);
 const custom={provider:'openai',model:'custom-fusion'};
 assert.equal(Object.hasOwn(L.learningModelPatch({...base,fusionModel:custom},'analysis',analysis),'fusionModel'),false);
});
test('existing users never get opted into new invitations by missing settings',()=>{
 assert.equal(L.learningProgress().invitationsEligible,false);
 const existing={version:1,invitationsEligible:false,lessons:{'first-answer':{invitations:false}}};
 assert.equal(L.learningProgress(existing),existing);
 assert.equal(L.lessonForProfile('simple'),'first-answer');assert.equal(L.lessonForProfile('intermediate'),'first-idea');assert.equal(L.lessonForProfile('advanced'),'research-question');assert.equal(L.lessonForProfile('custom'),'interface');
});
test('reactivating one invitation does not enroll an existing user in all other lessons',()=>{
 const user=L.learningProgress();const next=L.learningInvitationPreference(user,'first-answer',true);
 assert.equal(next.invitationsEligible,true);assert.equal(next.lessons['first-answer'].invitations,true);
 for(const id of L.LESSON_IDS.filter(id=>id!=='first-answer'))assert.equal(next.lessons[id].invitations,false,id);
 const muted=L.learningInvitationPreference(next,'first-answer',false);assert.equal(muted.lessons['first-answer'].invitations,false);
});
test('queued demo checkpoints preserve newer results and invitation choices in other lessons',()=>{
 const before={...L.learningProgress(),invitationsEligible:true,lessons:{reading:{invitations:true,demoStep:0}}};
 const current={...before,lessons:{...before.lessons,reading:{invitations:false,demoStep:0},'first-answer':{practiceCompleted:true}}};
 const requested={...before,lessons:{...before.lessons,overview:{demoStep:2}}};
 const next=L.mergeLearningProgressChange(current,before,requested);
 assert.equal(next.lessons.reading.invitations,false);assert.equal(next.lessons['first-answer'].practiceCompleted,true);assert.equal(next.lessons.overview.demoStep,2);
});
test('checkpoint persistence sanitizes IDs, preserves independent chapters and drops unrelated vault data',()=>{
 const s=L.newPractice('v','first-answer','r');s.checkpoints={overview:{...L.newPractice('v','overview','r2'),step:1,artifactId:'a',citationIds:['passage:p']},hypothesis:L.newPractice('other','hypothesis','r3')};
 const saved=L.sanitizePracticeSession({...s,credentials:'secret',answer:'text'});assert.equal(saved.checkpoints.overview.step,1);assert.equal(saved.checkpoints.hypothesis,undefined);assert.equal(saved.credentials,undefined);assert.equal(saved.answer,undefined);
 assert.equal(L.sanitizePracticeSession({...s,step:100}),undefined);
 assert.equal(L.sanitizeLearningProgress({version:77,lessons:{}}),undefined);
 const progress=L.sanitizeLearningProgress({version:1,invitationsEligible:true,lessons:{'first-answer':{invitations:false,demoCompleted:true,practiceCompleted:false},fake:{invitations:true}}});assert.equal(progress.lessons['first-answer'].invitations,false);assert.equal(progress.lessons.fake,undefined);
});
test('an incomplete restored checkpoint returns to the action that can prove it',()=>{
 const s=L.newPractice('v','first-answer','r');
 assert.equal(L.sanitizePracticeSession({...s,step:4,phase:'complete'}).step,0);
 const repaired=L.sanitizePracticeSession({...s,documentId:'d',step:3,phase:'complete',conversationId:'c'});
 assert.equal(repaired.step,2);assert.equal(repaired.phase,'action');assert.equal(repaired.documentId,'d');
 assert.equal(L.sanitizePracticeSession({...s,id:123}),undefined);
 const idea=L.sanitizePracticeSession({...L.newPractice('v','first-idea','i'),documentId:'d',step:5,phase:'complete'});
 assert.equal(idea.step,2);assert.notEqual(idea.phase,'complete');
});
test('all twelve languages have every instruction, placeholder and exact original evidence',()=>{
 assert.equal(C.LEARNING_LANGUAGES.length,12);
 for(const [key,row] of Object.entries(C.LEARNING_COPY)){
  assert.equal(row.length,12,key);assert.ok(row.every(text=>typeof text==='string'&&text.trim()),key);
  const placeholders=text=>[...text.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]).sort();
  for(const text of row)assert.deepEqual(placeholders(text),placeholders(row[0]),key);
 }
 for(const language of C.LEARNING_LANGUAGES){const sample=S.academicLearningSample(language);assert.ok(sample.text.includes(sample.passage));assert.ok(sample.title&&sample.answer&&sample.idea);assert.equal(C.learningText('prepared',language,{ready:1,total:3}).includes('{'),false);}
});
test('guides render annotations of actual app controls and never a simulated workspace',async()=>{
 const surface=await readFile('src/learning/AcademicLearningSurface.tsx','utf8');
 assert.equal(surface.includes('AcademicLearningDemo'),false);
 assert.ok(surface.includes('AcademicLearningSpotlight'));
 assert.equal(/demo-send|demo-open-result|learning-demo-workspace|sample.answer/.test(surface),false);
 const startup=await readFile('src/app/StartupGate.tsx','utf8');assert.ok(startup.indexOf("id: 'academic-learning-welcome'")<startup.indexOf("id: 'recovery-setup'"));assert.match(startup,/realSetupStarted/);
});
const G=load('src/learning/spotlightLayout.ts');
test('guide geometry excludes clipped rows and keeps only the visible intersection',()=>{
 assert.equal(G.intersectGuideRects({left:200,top:500,width:120,height:30},{left:180,top:100,width:400,height:200}),null);
 assert.deepEqual(G.intersectGuideRects({left:200,top:280,width:120,height:30},{left:180,top:100,width:400,height:200}),{left:200,top:280,width:120,height:20});
});
test('guide arrows stay short and do not cross adjacent controls',()=>{
 const target={left:700,top:300,width:40,height:36},card={left:350,top:220,width:318,height:220};
 const line=G.guideConnector(card,target);assert.ok(line);
 assert.ok(Math.hypot(line.start.x-line.end.x,line.start.y-line.end.y)<=96);
 assert.equal(G.guideConnector({...card,left:12},target),null);
 assert.equal(G.guideConnector(card,target,[{left:677,top:300,width:12,height:36}]),null);
 assert.equal(G.guideConnector(card,{left:700,top:300,width:700,height:400}),null);
});
test('a guide uses adjacent free space rather than drawing an arrow from a corner',()=>{
 const target={left:700,top:300,width:40,height:36};
 const placed=G.placeGuide(target,{width:318,height:220},{width:1600,height:900});
 assert.ok(G.guideConnector(placed,target));
});
test('guide placement never shrinks readable content to avoid busy controls',()=>{
 const viewport={width:1440,height:900},target={left:700,top:350,width:100,height:36};
 const card=G.placeGuide(target,{width:318,height:410},viewport,[{left:0,top:60,width:1440,height:500}]);
 assert.equal(card.height,410,'the complete balloon fits instead of imposing 160px or 340px');
});
test('annotations remain inside narrow and scaled windows and leave their controls uncovered',()=>{
 for(const viewport of [{width:1600,height:900},{width:819,height:614},{width:640,height:500}]) {
  for(const target of [{left:20,top:80,width:24,height:24},{left:viewport.width-160,top:viewport.height-60,width:140,height:32},{left:viewport.width/2,top:210,width:80,height:36}]) {
   const card=G.placeGuide(target,{width:318,height:260},viewport);
   assert.ok(card.left>=0&&card.top>=0&&card.left+card.width<=viewport.width&&card.top+card.height<=viewport.height);
   const overlap=Math.max(0,Math.min(card.left+card.width,target.left+target.width)-Math.max(card.left,target.left))*Math.max(0,Math.min(card.top+card.height,target.top+target.height)-Math.max(card.top,target.top));
   assert.equal(overlap,0);
  }
 }
});
test('annotations also leave nearby form inputs reachable',()=>{
 const target={left:1200,top:240,width:200,height:40};
 const controls=[target,{left:800,top:180,width:320,height:100},{left:1200,top:298,width:240,height:90}];
 const card=G.placeGuide(target,{width:318,height:220},{width:1600,height:900},controls);
 for(const control of controls){
  const overlap=Math.max(0,Math.min(card.left+card.width,control.left+control.width)-Math.max(card.left,control.left))*Math.max(0,Math.min(card.top+card.height,control.top+control.height)-Math.max(card.top,control.top));
  assert.equal(overlap,0);
 }
});
