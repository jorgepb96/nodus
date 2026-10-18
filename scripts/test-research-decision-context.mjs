import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime,repoRoot} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--decision-context'))process.exit(0);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-decision-context-'));installRuntimeHooks(scratch);const require=createRequire(import.meta.url);
try{
 const {researchDecisionContext}=require(path.join(repoRoot,'electron/ai/researchDecisionContext.ts'));
 const {ResearchAgenda}=require(path.join(repoRoot,'shared/researchHarness.ts'));
 const agenda=new ResearchAgenda('Compare factual travel accounts');agenda.addQuestion(agenda.objective);
 const evidence=Array.from({length:24},(_,i)=>({id:'documentary:'+('a'.repeat(170))+':'+i,documentId:i<16?'dominant':`source-${i}`,source:i<16?'Dominant source':`Independent source ${i}`,text:('factual travel accounts evidence '+i+' ').repeat(90),page:'2'}));
 agenda.enqueue({action:'search',query:'original pending branch'},'A relevant open question',3,{purpose:'A possible contrast',relation:'contrast'});
 for(let i=0;i<20;i++){const task=agenda.enqueue({action:'search',query:'completed '+i},agenda.objective);agenda.complete(task,i===19?[evidence[23].id]:[]);}
 const original=structuredClone({evidence,questions:agenda.questions,tasks:agenda.tasks});
 const view=researchDecisionContext(evidence,agenda.questions,agenda.tasks);
 assert.equal(view.evidence.length,10);assert.equal(new Set(view.evidence.map(e=>e.documentId)).size,9,'Independent voices precede repeated passages');
 assert.equal(view.evidence[0].documentId,'source-23','The latest result remains visible');
 assert.ok(view.evidence.every(e=>/^e\d+$/.test(e.id)&&e.text.length<=900));
 assert.ok(view.tasks.some(t=>t.action.query==='original pending branch'),'An old pending question cannot be hidden by completed history');
 assert.equal(view.tasks.filter(t=>t.status==='completed').length,6);
 const restored=view.restoreCoverage([{question:agenda.objective,status:'supported',evidenceIds:[view.evidence[0].id,'e9999',evidence[0].id]}]);
 assert.deepEqual(restored[0].evidenceIds,[evidence[23].id],'Only aliases actually bound in this decision can claim support');
 assert.deepEqual(view.restoreCoverage([{question:agenda.objective,status:'supported',evidenceIds:[view.evidence[0].id]}],new Set())[0].evidenceIds,[],'Window-pruned evidence cannot be guessed back into coverage');
 assert.deepEqual(view.restoreCoverage([{question:agenda.objective,status:'supported',evidenceIds:['e3']}])[0].evidenceIds,[],'A short ID cannot guess an excerpt absent from this decision');
 agenda.assess(restored,new Set(evidence.map(e=>e.id)));assert.deepEqual(agenda.questions[0].evidenceIds,[evidence[23].id]);
 const forged=view.restoreCoverage([{question:'A relevant open question',status:'supported',evidenceIds:['invented']}]);agenda.assess(forged,new Set(evidence.map(e=>e.id)));assert.equal(agenda.questions[1].status,'partial');
 const serialized=JSON.stringify({evidence:view.evidence,agenda:view.agenda,tasks:view.tasks});
 const previous=JSON.stringify({evidence:evidence.slice(0,12).map(e=>({...e,text:e.text.slice(0,1600)})),agenda:original.questions,tasks:original.tasks});
 assert.ok(Buffer.byteLength(serialized)<Buffer.byteLength(previous)*0.6,'A representative supervisor context shrinks materially');
 assert.deepEqual(evidence,original.evidence,'Full writer evidence and original IDs are untouched');assert.deepEqual(original.tasks[0],agenda.tasks[0]);
 const compact=researchDecisionContext(evidence,original.questions,original.tasks,true);assert.equal(compact.evidence.length,4);assert.ok(compact.evidence.every(e=>e.text.length<=480));
 const reordered=researchDecisionContext(evidence,[],[]);for(const item of reordered.evidence){const prior=view.evidence.find(e=>e.documentId===item.documentId);if(prior?.text===item.text)assert.equal(item.id,prior.id,'Re-ranking does not change an evidence alias');}
 console.log('Research decision context: compact diverse evidence, stable bound aliases, honest coverage, complete pending queue and unchanged writer ledger passed.');
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
