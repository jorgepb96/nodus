import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSync} from 'esbuild';
function load(entry){const output=buildSync({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'browser',metafile:true});assert(!Object.keys(output.metafile.inputs).some(file=>/aiClient|settingsRepo|database\.ts$/.test(file)));const module={exports:{}};new Function('module','exports',output.outputFiles[0].text)(module,module.exports);return module.exports;}
const {selectMobileCompleteGuideSources,previewMobileCompleteGuide}=load('shared/mobileCompleteGuide.ts');
const {resolveCompleteGuideSelection}=load('shared/completeGuide/selection.ts');
const {buildCompleteGuideSnapshot}=load('shared/completeGuide/snapshot.ts');
const organization={courses:[],subjects:[],folders:[],topics:[]};
const selection=(...ids)=>({nodes:ids.map(id=>({kind:'source',id})),excludedSourceKeys:[]});
function copy(ids,revision='a'.repeat(64),vaultId='owned-vault'){
 const catalog={sources:ids.map(id=>({sourceKey:`document:${id}`,kind:'document',sourceId:id,title:id,available:true,placements:[{courseId:null,subjectId:null,folderId:null,topicId:null}]})),organization};
 const chosen=selection(...catalog.sources.map(source=>source.sourceKey));
 const resolved=resolveCompleteGuideSelection(chosen,catalog.sources,organization);
 const texts=resolved.sources.map(source=>({source,text:`# ${source.title}\n\nActual retained source ${source.sourceId}. The second paragraph contains evidence unique to this owned source.`,updatedAt:'2026-10-15'}));
 return {version:1,kind:'completeGuide',context:{version:1,vaultId,vaultType:'estudio',revision,sourceScope:'device_downloads'},selection:chosen,frozen:{snapshot:buildCompleteGuideSnapshot(texts,organization),organization,snapshotAt:'2026-10-15'},catalog,texts,figures:{}};
}
test('downloaded selection rebuilds only the chosen actual source with canonical passages',()=>{const pack=copy(['one','two']);const result=selectMobileCompleteGuideSources([pack],selection('document:two'));assert.deepEqual(result.frozen.snapshot.sources.map(row=>row.sourceId),['two']);assert(result.frozen.snapshot.passages.every(row=>row.text.includes('two')));assert(!JSON.stringify(result).includes('Actual retained source one'));assert.equal(result.texts,undefined,'Author checkpoint retains canonical passages without duplicating raw downloaded bodies');});
test('union of downloaded packs uses canonical selection and preview, without any RPC',()=>{const packs=[copy(['one']),copy(['two'])],chosen=selection('document:one','document:two');const result=selectMobileCompleteGuideSources(packs,chosen);assert.equal(result.frozen.snapshot.sources.length,2);const preview=previewMobileCompleteGuide(packs,{completeGuide:{version:1,runId:'cg-device-fixture',selection:chosen},model:{provider:'openai',model:'test-config'},language:'es'});assert.equal(preview.totals.sources,2);});
test('catalogue entries alone never make an undownloaded body available',()=>{const pack=copy(['one']);delete pack.texts;assert.throws(()=>selectMobileCompleteGuideSources([pack],selection('document:one')),/not_downloaded/);assert.throws(()=>selectMobileCompleteGuideSources([copy(['one'])],selection('document:missing')),/not_downloaded/);});
test('cross-vault and mixed or ambiguous source revisions fail closed',()=>{assert.throws(()=>selectMobileCompleteGuideSources([copy(['one']),copy(['two'],'a'.repeat(64),'other-vault')],selection('document:one')),/scope_conflict/);assert.throws(()=>selectMobileCompleteGuideSources([copy(['one']),copy(['two'],'b'.repeat(64))],selection('document:one','document:two')),/revision_conflict/);assert.throws(()=>selectMobileCompleteGuideSources([copy(['one']),copy(['one'],'b'.repeat(64))],selection('document:one')),/revision_conflict/);});
