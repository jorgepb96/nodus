import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-page-documents'))process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-pages-'));
const runtime=installRuntimeHooks(directory);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),fetch=globalThis.fetch;let database,calls=0;
globalThis.fetch=async()=>{calls++;throw new Error('Page consultation and editing cannot invoke a provider');};
try{
  database=require('../electron/db/database.ts');database.getDb();
  const vaults=require('../electron/vaults/vaultRegistry.ts'),vault=vaults.createVault('Páginas móviles aisladas','databases'),other=vaults.createVault('Páginas ajenas','databases');
  const pages=require('../electron/db/pagesRepo.ts'),dbs=require('../electron/db/databasesRepo.ts'),bridge=require('../electron/desktopBridge/pageDocuments.ts'),dependencies=require('../electron/desktopBridge/pageDependencies.ts');
  const native=require('../shared/blockNoteDocument.ts');let pageId;
  await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,async()=>{
    const db=database.getDb(),parent=dbs.createDatabase('Filas reales'),title=dbs.createColumn(parent.id,'Nombre','title');
    for(let n=0;n<67;n++){const row=dbs.createRow(parent.id);dbs.setCell(row.id,title.id,`Fila ${n}`);}
    const view=dbs.listViews(parent.id)[0]??dbs.createView(parent.id,{name:'Todo',type:'table'});
    const origin=pages.createPage({title:'Original',blocks:[{id:'source-block',type:'paragraph',content:{text:'Texto compartido exacto'}}]});
    const asset=pages.storePageAsset({name:'fuente.txt',mimeType:'text/plain',bytes:Buffer.from('Fuente literal')});
    const page=pages.createPage({title:'Documento',blocks:[{id:'synced',type:'synced_block',content:{sourceBlockId:'source-block'}},{id:'view',type:'database_view',content:{viewId:view.id}},{id:'file',type:'file',content:{blobHash:asset.blobHash,name:asset.name}}]});pageId=page.page.id;
    const before=db.prepare('SELECT total_changes() AS count').get().count;
    const source=bridge.mobilePageDocument(vault.id,pageId);
    assert.equal(source.document.page.id,pageId);assert.equal(source.document.yjsState,undefined);
    assert.equal(source.assets[0].id,asset.blobHash);assert.equal(source.assets[0].available,true);
    assert.equal(source.dependencies.length,2);
    assert.equal(dependencies.mobileSyncedBlockSource(vault.id,'source-block').source.page.id,origin.page.id);
    const definition=dependencies.mobileLinkedDatabaseRead(vault.id,{action:'definition',input:view.id});assert.equal(definition.data.viewId,view.id);
    let cursor=null,ids=new Set(),revision;
    do{const result=dependencies.mobileLinkedDatabaseRead(vault.id,{action:'rows',input:{viewId:view.id,sourceId:null,localFilter:null,cursor,limit:30}}).data;
      revision??=result.revision;assert.equal(result.revision,revision);for(const row of result.rows){assert(!ids.has(row.id));ids.add(row.id);}cursor=result.nextCursor;
    }while(cursor);
    assert.equal(ids.size,67);assert.equal(db.prepare('SELECT total_changes() AS count').get().count,before,'Consultation must not initialise a source or materialise formulas/history');
    const document=native.markdownToBlockNote('# Texto móvil\n\n| A | B |\n| --- | --- |\n| 1 | 2 |');
    const input={pageId,expectedRevision:source.document.revision,expectedPageRevision:source.document.page.revision,title:'Título móvil',blocks:native.blockNoteToPageBlocks(document),nativeDocument:document,schemaVersion:2,reason:'contract-fixture'};
    const request={id:randomUUID(),input},saved=await bridge.saveMobilePageDocument(vault.id,'grant',request);
    assert.deepEqual(saved.document.nativeDocument,document);assert.equal(saved.document.page.title,'Título móvil');assert(saved.document.markdown.includes('Texto móvil'));
    const changes=db.prepare('SELECT total_changes() AS count').get().count;
    assert.deepEqual(await bridge.saveMobilePageDocument(vault.id,'grant',request),saved);
    assert.equal(db.prepare('SELECT total_changes() AS count').get().count,changes,'A lost acknowledgement must not duplicate history');
    await assert.rejects(()=>bridge.saveMobilePageDocument(vault.id,'grant',{...request,input:{...input,title:'Reutilización incorrecta'}}),error=>error.code==='idempotency_conflict');
    await assert.rejects(()=>bridge.saveMobilePageDocument(vault.id,'grant',{id:randomUUID(),input}),error=>error.code==='page_revision_conflict'&&error.remote.page.title==='Título móvil');
    // A metadata-only Desktop edit must also conflict with a phone draft.
    pages.updatePage(pageId,{title:'Título en Mac'},saved.document.page.revision,'mac');
    await assert.rejects(()=>bridge.saveMobilePageDocument(vault.id,'grant',{id:randomUUID(),input:{...input,expectedRevision:saved.document.revision,expectedPageRevision:saved.document.page.revision}}),error=>error.code==='page_revision_conflict');
    // Older pages without a canonical row remain a pure in-memory projection.
    db.prepare('DELETE FROM page_documents WHERE page_id=?').run(origin.page.id);
    const writes=db.prepare('SELECT total_changes() AS count').get().count;
    assert.equal(bridge.mobilePageDocument(vault.id,origin.page.id).document.blocks[0].content.text,'Texto compartido exacto');
    assert.equal(db.prepare('SELECT total_changes() AS count').get().count,writes);
  }));
  await vaults.withOwningVault(other.id,()=>database.withVaultDatabase(other.id,async()=>assert.throws(()=>bridge.mobilePageDocument(other.id,pageId),error=>error.code==='page_unavailable')));
  assert.equal(calls,0);console.log('Actual complete pages, native documents, idempotent edits, metadata conflicts, dependency pagination and read-only vault isolation: PASS');
}finally{globalThis.fetch=fetch;database?.closeDb();runtime.restore();fs.rmSync(directory,{recursive:true,force:true});}
