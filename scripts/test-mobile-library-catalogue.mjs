import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-library-catalogue-'));
const hooks=installRuntimeHooks(directory),require=createRequire(import.meta.url),Module=require('node:module'),originalLoad=Module._load;
const realNow=Date.now;let clock=10000,version=1,builds=0;
Date.now=()=>clock;
Module._load=function(request,parent,isMain){
  if(request.endsWith('/serverSync/serverLibrary'))return {
    allServerLibraryItems:vault=>Array.from({length:501},(_,index)=>({id:`${vault}-${index}`,title:`Version ${version} document ${index}`,collectionIds:['collection']})),
    buildServerLibraryPublication:(_unused,{items})=>{builds++;return {manifest:{generatedAt:new Date(clock).toISOString(),documents:items,collections:[{id:'collection',parentId:null,name:`Collection ${version}`}]} };},
  };
  if(request.endsWith('/vaults/vaultRegistry'))return {withOwningVault:(_vault,run)=>run()};
  if(request.endsWith('/db/database'))return {withVaultDatabase:(_vault,run)=>run()};
  return originalLoad.call(this,request,parent,isMain);
};
try{
  const {serveLiveLibrary}=require('../electron/desktopBridge/liveLibrary.ts');
  const {retainLibraryCatalogueVersion}=require('../electron/desktopBridge/libraryCatalogueVersion.ts');
  const request=async(vault,offset)=>{let result;await serveLiveLibrary({method:'GET'},{writeHead:status=>assert.equal(status,200),end:body=>{result=JSON.parse(body);}},new URL(`https://lab.invalid/documents?limit=200&offset=${offset}`),vault,['documents']);return result;};
  const first=await request('vault-a',0);clock+=6001;
  const second=await request('vault-a',200);clock+=6001;
  const third=await request('vault-a',400);
  assert.equal(builds,3,'TTL still refreshes the actual global-library projection');
  assert.equal(first.generatedAt,second.generatedAt);assert.equal(first.generatedAt,third.generatedAt,'Unchanged large catalogue stays traversable beyond TTL');
  const all=[...first.items,...second.items,...third.items];assert.equal(all.length,501);assert.equal(new Set(all.map(row=>row.id)).size,501);assert.equal(third.hasMore,false);
  version=2;clock+=6001;const changed=await request('vault-a',200);
  assert.notEqual(changed.generatedAt,first.generatedAt,'Real metadata changes renew the catalogue identity during pagination');assert.match(changed.items[0].title,/Version 2/);
  const scoped=await request('vault-b',0);assert.ok(scoped.items.every(row=>row.id.startsWith('vault-b-')),'Fingerprint reuse never broadens a vault grant');
  const old={generatedAt:'a',documents:[{id:'one',updatedAt:'a',fileHash:'old'}],collections:[]};
  assert.equal(retainLibraryCatalogueVersion(old,{collections:[],documents:[{fileHash:'old',updatedAt:'a',id:'one'}],generatedAt:'b'}).generatedAt,'a','Object insertion order is irrelevant');
  for(const field of ['updatedAt','fileHash']){
    const next={...old,generatedAt:'b',documents:[{...old.documents[0],[field]:'changed'}]};assert.equal(retainLibraryCatalogueVersion(old,next).generatedAt,'b',`${field} must never be excluded from the content fingerprint`);
  }
  console.log('Mobile Library: 501 scoped records across TTL, stable unchanged versions, real mid-pagination changes and content timestamps/files passed.');
}finally{Date.now=realNow;Module._load=originalLoad;hooks.restore();fs.rmSync(directory,{recursive:true,force:true});}
