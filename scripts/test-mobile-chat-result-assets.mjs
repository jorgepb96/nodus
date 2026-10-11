import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-chat-result-assets'))process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-chat-result-assets-'));
const runtime=installRuntimeHooks(directory);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Reading original results must not invoke a model or arbitrary network');};
let db;
try {
  db=require('../electron/db/database.ts');db.getDb();
  const vaults=require('../electron/vaults/vaultRegistry.ts'),history=require('../electron/desktopBridge/chatHistory.ts'),api=require('../electron/desktopBridge/chatResultAssets.ts'),assets=require('../electron/chatAssets.ts');
  const boundary=require('../electron/desktopBridge/executionBoundary.ts'),readers=require('../electron/ipc/capabilities.ts'),attachments=require('../electron/researchAttachments.ts');
  const grant=['corpus','writing','study-recordings'];
  for(const [kind,type,surface] of [['research','academic','assistant'],['world','worldbuilding','world-assistant'],['database','databases','database'],['study','estudio','study'],['study','docencia','study']]) {
    const vault=vaults.createVault(`Stored results ${type}`,type),conversationId=randomUUID();
    await vaults.withOwningVault(vault.id,()=>db.withVaultDatabase(vault.id,async()=>{
      const owner=assets.chatAssetOwner(surface,conversationId,vault.id),bytes=Buffer.from('Original result 🌊'),source=assets.storeCapabilityFile(owner,{bytes,mimeType:'text/plain',name:'result.txt'});
      const attachmentId=randomUUID(),originalSource=`nodus-attachment://chat/${owner}/${attachmentId}`,attachmentOwner={surface:kind,conversationId},folder=path.join(attachments.researchAttachmentDirectory(attachmentOwner),attachmentId);
      fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'metadata.json'),JSON.stringify({id:attachmentId,name:'original.txt'}));fs.writeFileSync(path.join(folder,'original'),bytes);
      const image=assets.storeChatImage(owner,{bytes:Buffer.from([1,2,3]),mimeType:'image/png'},{title:'Original title',provider:'Original provider',prompt:'Original prompt'});
      const id=randomUUID(),request={version:1,id,conversationId,expectedRevision:null,action:'save',draft:{title:'Real saved result',archived:false,messages:[{id:randomUUID(),role:'user',content:'Read original',attachments:[{id:attachmentId,name:'original.txt',size:bytes.length,kind:'text',textChars:10,imageCount:0}]},{id:randomUUID(),role:'assistant',content:`Saved ${source}\n![Actual](${image})`}]},companion:null};
      const plain={...request,draft:{...request.draft,messages:request.draft.messages.map(message=>{const {attachments,...text}=message;return text;})}};
      const initial=await history.saveMobileChat(vault.id,randomUUID(),kind,plain,grant);
      await history.saveMacStoredQuestionAttachments(vault.id,randomUUID(),kind,{...plain,id:randomUUID(),expectedRevision:initial.snapshot.revision,draft:{...plain.draft,messages:initial.snapshot.data.messages}},grant,plain.draft.messages[0].id,[attachmentId]);
      const metadata=await boundary.withMobileOperation(()=>api.getMobileChatReadResource({kind,conversationId,action:'metadata'}),grant);
      assert.equal(metadata.owner,owner);assert.deepEqual(metadata.requiredDomains,['corpus']);
      assert.equal((await boundary.withMobileOperation(()=>api.getMobileChatReadResource({kind,conversationId,action:'imageMetadata',source:image}),grant)).metadata.prompt,'Original prompt');
      await assert.rejects(boundary.withMobileOperation(()=>api.getMobileChatReadResource({kind,conversationId,action:'tile',capabilityId:'foreign',service:'https://example.com/not-in-view',path:'info.json'}),grant),error=>error.code==='chat_tile_not_referenced');
      await assert.rejects(boundary.withMobileOperation(()=>api.getMobileChatReadResource({kind,conversationId,action:'legacy',fence:'foreign',payload:'Not a saved result'}),grant),error=>error.code==='chat_result_not_referenced');
      const file=async(source,action,query='')=>{
        let status,headers,body;
        const response={writeHead(code,values){status=code;headers=values;},end(value){body=value;}};
        const id=JSON.stringify({kind,conversationId,source});await api.serveChatCapabilityFile({method:'GET'},response,new URL(`https://localhost/files${query}`),vault.id,grant,id,action);return {status,headers,body};
      };
      for(const original of [source,originalSource]) {
        const descriptor=await file(original,'descriptor');assert.equal(descriptor.status,200);
        const parsed=JSON.parse(descriptor.body);assert.equal(parsed.kind,'chatCapability');assert.equal(parsed.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(parsed.filename,original===source?'result.txt':'original.txt');
        const chunk=await file(original,'content','?offset=3&limit=5');assert.equal(chunk.status,200);assert.deepEqual(chunk.body,bytes.subarray(3,8));assert.equal(chunk.headers['x-nodus-file-offset'],'3');assert.equal(chunk.headers['x-nodus-file-size'],String(bytes.length));
        assert.equal((await file(original,'content','?offset=-1&limit=5')).status,416);
      }
      const foreign=assets.storeCapabilityFile(assets.chatAssetOwner(surface,randomUUID(),vault.id),{bytes,mimeType:'text/plain',name:'other.txt'});
      assert.equal((await file(foreign,'descriptor')).status,403);
      assert.equal((await file(`nodus-attachment://chat/${owner}/${randomUUID()}`,'descriptor')).status,403);
      assert.throws(()=>api.validateChatAssetRequest({kind,conversationId,source},[],'nodus-capability'),error=>error.code==='permission_denied');
      const adapters=readers.storedResultAdapters();assert.equal(adapters.model,undefined);assert.equal(adapters.vision,undefined);assert.equal(adapters.attachments,undefined);await assert.rejects(adapters.svg.refine({svg:'<svg/>',instruction:'Call a model'},new AbortController().signal),/cannot invoke a model/);
      if(kind==='study') {
        const raw=await history.readMobileChat(vault.id,kind,conversationId,grant);
        const changed={...request,id:randomUUID(),expectedRevision:raw.revision,draft:{...request.draft,messages:[...raw.data.messages,{id:randomUUID(),role:'assistant',content:'[Recording](nodus://study/recording/private)'}]}};
        await history.saveMobileChat(vault.id,randomUUID(),kind,changed,grant);
        await assert.rejects(history.readMobileChat(vault.id,kind,conversationId,['corpus']),error=>error.code==='permission_denied');
      }
    }));
  }
  console.log('Actual owning-vault originals, file chunks, private grants and provider-free reader adapters verified. Native rendering remains a separate acceptance gate.');
} finally { globalThis.fetch=originalFetch;db?.closeDb();runtime.restore();fs.rmSync(directory,{recursive:true,force:true}); }
