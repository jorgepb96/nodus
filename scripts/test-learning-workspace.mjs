import test from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';import {createRequire} from 'node:module';import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
const require=createRequire(import.meta.url),scratch=await mkdtemp(path.join(os.tmpdir(),'nodus-workspace-contract-'));
const outfile=path.join(scratch,'workspace.cjs');buildSync({entryPoints:['shared/learningWorkspace.ts'],outfile,bundle:true,format:'cjs',platform:'node',logLevel:'silent'});const W=require(outfile);test.after(()=>rm(scratch,{recursive:true,force:true}));
test('practice configuration copies only roles and presentation, without content or integrations',()=>{
 const source={uiLanguage:'en',chatModel:{provider:'lmstudio',model:'my-chat'},embeddingModel:'my-embedding',academicMode:'manual',academicInterfaceProfile:'custom',sidebarOrder:['mine'],autoBackupFolder:'/personal/recovery',zoteroApiKey:'private',nodusServerEnabled:true,autoResumeQueue:true,academicPracticeSession:{documentId:'personal-document'},browserDownloadFolder:'/my/documents'};
 const original=JSON.stringify(source),patch=W.learningWorkspaceSettings(source);assert.equal(JSON.stringify(source),original);assert.deepEqual(patch.chatModel,source.chatModel);assert.equal(patch.academicMode,'manual');assert.equal(patch.academicInterfaceProfile,'simple');assert.equal(patch.autoBackupEnabled,false);assert.equal(patch.autoResumeQueue,false);
 for(const key of ['autoBackupFolder','zoteroApiKey','nodusServerEnabled','academicPracticeSession','sidebarOrder','browserDownloadFolder'])assert.equal(Object.hasOwn(patch,key),false,key);
});
test('only actionable checkpoints dim the workspace and constrain interaction',()=>{
 for(const phase of ['explanation','action','verification','recovery'])assert.equal(W.learningRequiresInteraction({phase},false),true,phase);
 for(const phase of ['wait','complete'])assert.equal(W.learningRequiresInteraction({phase},false),false,phase);
 for(const phase of ['explanation','action','wait','verification','recovery','complete'])assert.equal(W.learningRequiresInteraction({phase},true),false,phase);
});
