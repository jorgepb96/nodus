import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-archive-source'))process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-archive-source-')),runtime=installRuntimeHooks(root),require=createRequire(import.meta.url);
runtime.app.on=()=>{};runtime.app.once=()=>{};let database;
try{
 const registry=require('../electron/vaults/vaultRegistry.ts');database=require('../electron/db/database.ts');const vault=registry.createVault('Isolated archive reader','genealogy');
 await database.withVaultDatabase(vault.id,()=>{const db=database.getDb(),now='2026-01-01';
  for(const id of['chosen','foreign'])db.prepare('INSERT INTO archive_items(item_id,title,kind,blob,extracted_text,description,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?)').run(id,`${id} archival source`,'document',Buffer.from('PRIVATE ORIGINAL BYTES'),`${id} legacy body`,`${id} description`,now,now);
  db.prepare("INSERT INTO archive_item_profiles(item_id,rights_statement,metadata_json,created_at,updated_at)VALUES('chosen','Actual reproduction rights',?, ?,?)").run(JSON.stringify({date_display:'c. 1850',external_path:'/private/NEVER-SENT',nested:{api_token:'NEVER-SENT',api_key:'NEVER-SENT',authored:'Actual metadata'}}),now,now);
  for(const id of['chosen','foreign']){db.prepare('INSERT INTO archive_text_versions(text_version_id,item_id,kind,content,created_at,updated_at)VALUES(?,?,?,?,?,?)').run(`version-${id}`,id,'literal',`${id} full normalized content`,now,now);
   db.prepare('INSERT INTO archive_text_segments(segment_id,text_version_id,sequence_no,content,created_at,updated_at)VALUES(?,?,?,?,?,?)').run(`segment-${id}`,`version-${id}`,0,`${id} exact segment`,now,now);}
  for(let i=0;i<201;i++)db.prepare('INSERT INTO archive_excerpts(excerpt_id,item_id,text_version_id,locator_display,quoted_text,created_at,updated_at)VALUES(?,?,?,?,?,?,?)').run(`excerpt-${i}`,'chosen','version-chosen',`folio ${i}`,`Literal excerpt ${i}`,now,now);
  db.prepare("INSERT INTO archive_excerpts(excerpt_id,item_id,locator_display,quoted_text,created_at,updated_at)VALUES('foreign-excerpt','foreign','folio private','FOREIGN MUST NOT TRAVEL',?,?)").run(now,now);
  const bytes=Buffer.from('PRIVATE FILE BYTES');db.prepare('INSERT INTO archive_item_files(file_id,item_id,role,original_file_name,content_blob,content_hash,hash_algorithm,created_at)VALUES(?,?,?,?,?,?,?,?)').run('file','chosen','master','actual.pdf',bytes,createHash('sha256').update(bytes).digest('hex'),'sha256',now);
  db.prepare('INSERT INTO archive_item_files(file_id,item_id,role,external_path,created_at,sequence_no)VALUES(?,?,?,?,?,1)').run('missing','chosen','master',path.join(root,'missing-original.pdf'),now);
 });
 const {readPrivateSource,listPrivateSources}=require('../electron/desktopBridge/privateSources.ts');
 await assert.rejects(readPrivateSource(vault.id,'corpus','archive-source','chosen'),error=>error.status===403);
 const source=await readPrivateSource(vault.id,'primary-source-files','archive-source','chosen');assert.equal(source.root.title,'chosen archival source');assert.equal(source.root.original_available,1);assert.equal(source.root.blob,undefined);
 const all={};for(const group of source.groups){let cursor=0,more=true,rows=[];while(more){const page=await readPrivateSource(vault.id,'primary-source-files','archive-source','chosen',{group:group.key,cursor,limit:100,revision:group.revision});rows.push(...page.rows);cursor=page.cursor;more=page.hasMore;}assert.equal(rows.length,group.total);all[group.key]=rows;}
 assert.equal(all.excerpts.length,201);assert.equal(all.excerpts.at(-1).quoted_text,'Literal excerpt 200');assert(all.excerpts.every(row=>row.item_id==='chosen'));
 assert.equal(all.textVersions[0].content,'chosen full normalized content');assert.equal(all.segments[0].content,'chosen exact segment');
 assert.equal(all.files.find(row=>row.file_id==='file').original_available,1);assert.equal(all.files.find(row=>row.file_id==='missing').original_available,0);
 const encoded=JSON.stringify({source,all});assert(!encoded.includes('FOREIGN MUST NOT TRAVEL'));assert(!encoded.includes('PRIVATE ORIGINAL BYTES'));assert(!encoded.includes('PRIVATE FILE BYTES'));assert(!encoded.includes('NEVER-SENT'));assert(!encoded.includes('missing-original.pdf'));assert(!encoded.includes('external_path'));assert(encoded.includes('Actual metadata'));
 const catalogue=await listPrivateSources(vault.id,'primary-source-files','archive-source',{offset:0,limit:100,query:'chosen'});assert.equal(catalogue.items.length,1);assert(!JSON.stringify(catalogue).includes('legacy body'));
 await assert.rejects(readPrivateSource(vault.id,'primary-source-files','archive-source','chosen',{group:'arbitrary',cursor:0,limit:100,revision:source.revision}),error=>error.status===403);
 console.log(JSON.stringify({suite:'mobile-archive-source',passed:true,boundedExactSource:true,actual201ExcerptPages:true,actualVersionsAndSegments:true,pathAndBinaryAbsent:true,fileAvailability:true,grantRequired:true}));
}finally{database?.closeDb?.();runtime.restore();fs.rmSync(root,{recursive:true,force:true});}
