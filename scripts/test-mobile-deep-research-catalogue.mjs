import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'nodus-dr-catalogue-'));
test.after(()=>fs.rm(tmp,{recursive:true,force:true}));
const output=path.join(tmp,'catalogue.mjs');
await build({entryPoints:['shared/mobileDeepResearchCatalogue.ts'],outfile:output,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {mergeMobileDeepResearchReports:merge}=await import(pathToFileURL(output));
const local={id:'mobile-dr-local',title:'Report',draft:{draftMarkdown:'Local retained prose'},image:null,mobilePublicationId:'canonical'};
test('confirmed publication has one card with current canonical content cover and reading state',()=>{
 const remote={id:'canonical',title:'Report',draft:{draftMarkdown:'Canonical revised prose'},image:{id:'cover'},readAt:'2026-10-16T00:00:00Z'};
 assert.deepEqual(merge([local],[remote]),[remote]);assert.equal(local.draft.draftMarkdown,'Local retained prose');
});
test('offline or removed Mac rows never discard retained authored report',()=>{
 assert.deepEqual(merge([local],[]),[local]);
});
test('titles cannot merge unrelated records; unconfirmed publication cannot hide a remote row',()=>{
 const remote={id:'other',title:'Report',draft:{draftMarkdown:'Other report'}};
 assert.deepEqual(merge([local],[remote]),[local,remote]);
 const pending={...local,mobilePublicationId:undefined};assert.equal(merge([pending],[{...remote,id:'canonical'}]).length,2);
});
