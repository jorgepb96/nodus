import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-database-file-uploads'))process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-file-'));
const runtime=installRuntimeHooks(directory);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;let database,calls=0;
globalThis.fetch=async()=>{calls++;throw new Error('File transport must not call a provider');};
const sha=value=>createHash('sha256').update(value).digest('hex');
try {
  database=require('../electron/db/database.ts');database.getDb();
  const vaults=require('../electron/vaults/vaultRegistry.ts'),vault=vaults.createVault('Adjuntos temporales','databases');
  const repo=require('../electron/db/databasesRepo.ts'),upload=require('../electron/desktopBridge/databaseAttachmentUploads.ts');
  let rowId,columnId,spec;
  await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,()=>{
    const created=repo.createDatabase('Archivos'),column=repo.createColumn(created.id,'Archivos','files'),row=repo.createRow(created.id);
    rowId=row.id;columnId=column.id;
    spec={rowId,columnId,fileName:'large.bin',mimeType:'application/octet-stream',expectedRowRevision:database.getDb().prepare('SELECT revision FROM db_rows WHERE id=?').get(rowId).revision,expectedColumnRevision:database.getDb().prepare('SELECT revision FROM db_columns WHERE id=?').get(columnId).revision};
  }));
  const id=randomUUID(),bytes=Buffer.alloc(13*1024*1024+17);for(let offset=0;offset<bytes.length;offset++)bytes[offset]=(offset*31)%251;
  const input={...spec,size:bytes.length,sha256:sha(bytes)},run=(action,value={},grant='grant',allowed=true)=>upload.mobileDatabaseFileUpload(vault.id,grant,id,action,value,()=>allowed);
  await run('begin',input);
  const chunkBytes=upload.MOBILE_DATABASE_FILE_CHUNK_BYTES;
  for(let index=0;index<Math.ceil(bytes.length/chunkBytes);index++) {
    const chunk=bytes.subarray(index*chunkBytes,(index+1)*chunkBytes),body={index,bytes:chunk.toString('base64'),sha256:sha(chunk)};
    await run('chunk',body);if(index===0){assert.equal((await run('chunk',body)).received.length,1);assert.equal((await run('status')).received.length,1);}
  }
  await assert.rejects(run('status',{},'other-grant'),error=>error.code==='database_file_upload_unavailable');
  await assert.rejects(run('commit',{},'grant',false),error=>error.code==='permission_denied');
  const result=await run('commit');assert.equal(result.state,'available');assert.equal(result.result.bytes,bytes.length);assert.equal(result.result.id,'datt_'+id);
  assert.equal(result.result.attachment.id,result.result.id);assert.equal(result.result.attachment.content_hash,sha(bytes));assert.equal(result.result.attachment.revision,1);
  assert.equal(result.result.row.id,rowId);assert(result.result.row.revision>input.expectedRowRevision,'the response exposes the real post-attachment parent revision');
  await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,()=>{
    const actual=repo.getAttachmentBlob(result.result.id);assert.equal(sha(actual),sha(bytes));assert.deepEqual(actual,bytes);
    assert.equal(repo.getAttachment(result.result.id).extractedText,null,'Transport does not extract or index files');
  }));
  assert.deepEqual((await run('commit')).result,result.result);assert.deepEqual((await run('begin',input)).result,result.result,'Lost ACK retry uses exact stable canonical attachment');
  await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,()=>{
    const nextId=randomUUID(),current={...spec,expectedRowRevision:database.getDb().prepare('SELECT revision FROM db_rows WHERE id=?').get(rowId).revision};
    const staged=upload.stageMobileDatabaseImageBytes(vault.id,'grant',nextId,{...current,fileName:'generated.png',mimeType:'image/png'},bytes);
    const read=upload.readMobileDatabaseUploadedBlob(vault.id,'grant',staged.blobUploadId);assert.deepEqual(read.bytes,bytes);assert.equal(read.manifest.sha256,sha(bytes));
    repo.updateColumn(columnId,{name:'Changed'});
    assert.throws(()=>upload.readMobileDatabaseUploadedBlob(vault.id,'grant',nextId),error=>error.code==='database_file_revision_conflict');
  }));
  assert.equal(calls,0);console.log('Actual canonical 13MiB+17 file, chunk resume, stable lost-ACK identity, grant namespace, SHA readback, no extraction/provider, staged generated output CAS: PASS');
} finally {globalThis.fetch=originalFetch;database?.closeDb();runtime.restore();fs.rmSync(directory,{recursive:true,force:true});}
