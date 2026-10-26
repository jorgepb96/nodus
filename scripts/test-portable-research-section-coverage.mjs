import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSync} from 'esbuild';
const result=buildSync({entryPoints:['shared/portableResearchSectionCoverage.ts'],bundle:true,format:'cjs',platform:'browser',write:false,metafile:true});
assert(!Object.keys(result.metafile.inputs).some(file=>file.includes('electron/')));
const module={exports:{}};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
const {portableResearchSectionCoverage}=module.exports;
test('browser canonical coverage validates literal source and draft, repairs only once',async()=>{
 const fact='El caudal medido descendió a la mitad en 1782.',token='[Archivo](nodus://passage/captured)',input={language:'es',objective:'Explicar el cambio',section:{id:'s',title:'Cambio',keyClaims:[fact]},citationMenu:[{kind:'passage',token,note:fact}]};let json=0,text=0;
 const engine=portableResearchSectionCoverage({completeJson:async()=>{json++;return {items:[{index:0,status:'missing',sourceToken:token,sourceQuote:fact,draftQuote:''}]};},completeText:async()=>{text++;return `${fact} ${token}`;},withResearchValidationThinking:(_model,work)=>work()}).createResearchSectionCoverage({provider:'openai',model:'phone'});
 const original='El archivo registra el caudal.';const revised=await engine.repair(input,original);assert(revised.includes(fact));assert.equal(await engine.repair(input,revised),revised);assert.equal(text,1);assert.equal(await engine.check(input,original),false);assert.equal(json,1);
 const bad=portableResearchSectionCoverage({completeJson:async()=>({items:[{index:0,status:'covered',sourceToken:token,sourceQuote:'Una afirmación inventada sin evidencia.',draftQuote:fact}]}),completeText:async()=>{throw new Error('must_not_repair');},withResearchValidationThinking:(_model,work)=>work()}).createResearchSectionCoverage(null);assert.equal(await bad.check(input,revised),false);assert.equal(await bad.repair(input,original),original);
});
