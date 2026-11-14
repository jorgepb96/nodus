import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSync} from 'esbuild';
const output=buildSync({entryPoints:['shared/portableStudyDeepResearch.ts'],bundle:true,write:false,format:'cjs',platform:'browser',metafile:true,alias:{'@shared':'./shared'}});
assert(!Object.keys(output.metafile.inputs).some(file=>/aiClient|settingsRepo|studyKnowledgeRepo|studySearch\.ts$/.test(file)&&!file.startsWith('shared/')),'Portable report has no Mac/provider/repository runtime');
const module={exports:{}};new Function('module','exports',output.outputFiles[0].text)(module,module.exports);
const {portableStudyDeepResearch}=module.exports;
const entry={indexId:'actual-copy-1',kind:'material',sourceId:'actual-material',title:'Actual copied gas notes',text:'La presión se define como fuerza por unidad de superficie. La temperatura absoluta se mide en kelvin.',subtitle:'Actual source',tags:[],scope:{courseId:null,subjectId:null,folderId:null,topicId:null},location:{materialId:'actual-material',pageNumber:2},createdAt:'2026-10-15',updatedAt:'2026-10-15',contentHash:'actual-content',embedding:null,excluded:false};
test('canonical study and teaching pipelines execute entirely over copied sources and exact fixed outline',async()=>{
 for(const unitMode of [false,true]){
  const prompts=[],retrieval=[];
  const engine=portableStudyDeepResearch({retrieveStudyAssistantEntries:async query=>{retrieval.push(query);return [entry];},listStudyIdeasForSources:()=>({ideas:[],connections:[]}),completeJson:async(opts,guard)=>{const input=JSON.parse(opts.user);prompts.push([opts.system,input]);const result={title:'Actual report',abstract:'Presión y temperatura.',sections:[{id:'s1',title:'Model tried replacing the title',purpose:'Explain pressure',keyClaims:['presión'],sourceIds:['S1'],ideaIds:[]}],limitations:[],nextSteps:[]};assert(guard(result));return result;},completeText:async opts=>{const input=JSON.parse(opts.user);prompts.push([opts.system,input]);const source=input.allowedSources?.[0];return `## Presión\n\nLa presión se define como fuerza por unidad de superficie. ${source?.exactCitation??'[Actual source](nodus://study/material/actual-material)'}`;}});
  const report=await engine.generateStudyDeepResearchReport({objective:'Explicar la presión',model:{provider:'openai',model:'fixture'},language:'es',unitMode,studyMode:!unitMode,audience:unitMode?'teacher':'students',outline:unitMode?[{title:'Fixed teacher section',focus:'Actual teacher guidance'}]:undefined,sectionLimit:1}, {provider:'openai',model:'fixture'});
  assert.equal(report.draft.brief.audience,unitMode?'teacher':'students');assert(report.draft.draftMarkdown.includes('nodus://study/material/actual-material'));assert.deepEqual(retrieval,['Explicar la presión']);
  if(unitMode){assert.equal(report.draft.outline[0].title,'Fixed teacher section');assert(report.draft.outline[0].purpose.includes('Actual teacher guidance'));assert(prompts.some(([,input])=>input.section?.teacherFocus==='Actual teacher guidance'));}
 }
});
