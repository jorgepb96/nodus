import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-podcast-read'))process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-link-podcast-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url);
let database;
try {
  database=require('../electron/db/database.ts');
  const registry=require('../electron/vaults/vaultRegistry.ts');
  const first=registry.getActiveVault(),second=registry.createVault('Other Link vault');
  const own=(vault,run)=>registry.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,run));
  const repo=require('../electron/db/podcastRepo.ts');
  const {executeMobileOperation}=require('../electron/desktopBridge/operations.ts');
  const {serveBridgeFile}=require('../electron/desktopBridge/files.ts');
  const bytes=Buffer.alloc(4*1024*1024+117,0x17);
  const request={objective:'Fixture read only',format:'lesson',language:'es',ttsModelId:'fixture',hosts:[{speaker:'A',name:'Host',voiceId:'fixture'}],audience:'university',durationCapMin:5,cover:false,extraImages:0,reviewScript:false};
  const input={id:'link-podcast',title:'Saved episode',request,
    plan:{title:'Saved episode',hook:'Hook',summary:'Summary',chapters:[{index:0,title:'Chapter',goal:'Goal',keyPoints:[],sourceIds:['S1'],targetWords:10}],images:[]},
    script:{turns:[{id:'turn-1',chapterIndex:0,speaker:'A',text:'Real saved transcript',sourceIds:['S1']}]},
    sources:[{id:'S1',kind:'idea',title:'Idea',excerpt:'Stored evidence',link:'nodus://idea/fixture'}],researchLog:'Read existing evidence',
    timeline:{turns:[{turnId:'turn-1',startS:0,durationS:4}],chapters:[{index:0,title:'Chapter',startS:0}]},
    durationS:4,audioFile:'link-podcast.m4a',audioMime:'audio/mp4',audioBytes:bytes.length,generation:{ttsModelId:'fixture',engine:'kokoro',codec:'mp4a.40.2'}};
  await own(first,()=>{
    repo.savePodcastEpisode(input);
    const folder=path.join(registry.activeVaultDir(),'audio');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,input.audioFile),bytes);
    repo.putPodcastImagePlaceholder(input.id,0,null,'Fixture','contemporary_editorial');
    repo.setPodcastImageData(input.id,0,{mime:'image/png',image:Buffer.from('fixture image'),thumbnail:Buffer.from('fixture thumbnail'),provider:'fixture',model:'fixture'});
  });
  const before=await own(first,()=>repo.getPodcastEpisode(input.id));
  const call=(method,args=[],vault=first,domains=['corpus'])=>executeMobileOperation(vault.id,domains,method,args);
  const list=await call('podcastEpisodes');assert.equal(list.length,1);assert.equal(list[0].id,input.id);assert.equal(list[0].imageCount,1);
  const detail=await call('podcastEpisode',[input.id]);assert.deepEqual(detail,before);assert.equal(detail.script.turns[0].text,'Real saved transcript');
  assert.equal((await call('podcastImages',[input.id])).length,1);
  assert.equal(await call('podcastImageData',[input.id,0,'thumbnail']),'data:image/png;base64,'+Buffer.from('fixture thumbnail').toString('base64'));
  assert.deepEqual(await call('podcastEpisodes',[],second),[]);assert.equal(await call('podcastEpisode',[input.id],second),null);
  await assert.rejects(call('podcastImages',[input.id],second),/podcast_not_found/);
  for(const method of ['podcastEnqueue','podcastDeleteEpisode','podcastRenameEpisode','podcastSetPosition','podcastApproveScript'])await assert.rejects(call(method,[],first,['corpus','writing','research-generation']),/operation_forbidden/);
  await assert.rejects(call('podcastEpisodes',[],first,[]),/permission_denied/);
  for(const [method,args] of [['podcastEpisodes',['extra']],['podcastEpisode',[]],['podcastEpisode',['']],['podcastImageData',[input.id,-1,'image']],['podcastImageData',[input.id,0,'bad']]])await assert.rejects(call(method,args),/invalid_arguments/);
  const file = async (vault=first,action='descriptor',query='',domains=['corpus']) => {
    let status,payload,headers;
    await serveBridgeFile({method:'GET'},{writeHead(code,value){status=code;headers=value;},end(value){payload=value;}},new URL('https://localhost/file'+query),vault.id,domains,'podcastAudio',input.id,action);
    return {status,payload,headers};
  };
  const descriptor=await file();assert.equal(descriptor.status,200);
  const value=JSON.parse(descriptor.payload);assert.equal(value.kind,'podcastAudio');assert.equal(value.mime,'audio/mp4');assert.equal(value.sha256,createHash('sha256').update(bytes).digest('hex'));
  const firstChunk=await file(first,'content'),lastChunk=await file(first,'content','?offset=4194304&limit=117');assert.deepEqual(Buffer.concat([firstChunk.payload,lastChunk.payload]),bytes);
  assert.equal((await file(second)).status,404);assert.equal((await file(first,'content','',[])).status,403);assert.equal((await file(first,'content','?offset=-1')).status,416);
  assert.deepEqual(await own(first,()=>repo.getPodcastEpisode(input.id)),before,'Reading never mutates the saved episode');
  await own(first,()=>database.getDb().prepare('UPDATE podcast_episodes SET audio_file=? WHERE id=?').run('../outside.mp4',input.id));assert.equal((await file()).status,403);
  await own(first,()=>{const folder=path.join(registry.activeVaultDir(),'audio');fs.writeFileSync(path.join(root,'outside.mp4'),'private');fs.symlinkSync(path.join(root,'outside.mp4'),path.join(folder,'link.mp4'));database.getDb().prepare('UPDATE podcast_episodes SET audio_file=? WHERE id=?').run('link.mp4',input.id);});assert.equal((await file()).status,403);
  console.log(JSON.stringify({suite:'mobile-podcast-read',result:'passed',vaults:2,canonicalEpisode:true,transcriptAndSources:true,images:true,chunkedAudio:true,sha256:true,readOnly:true,pathIsolation:true}));
} finally {database?.closeDb();fs.rmSync(root,{recursive:true,force:true});}
