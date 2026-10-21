import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
test('real SQLite page corruption preserves recovered rows before the bad page and the damaged source',()=>{
  const repo=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-corrupt-page-')));
  try {
    const script=path.join(root,'verify.mjs');fs.writeFileSync(script,`
      import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
      import {installRuntimeHooks} from ${JSON.stringify(pathToFileURL(path.join(repo,'scripts/lib/tsRuntimeHooks.mjs')).href)};
      const require=createRequire(${JSON.stringify(path.join(repo,'package.json'))}),Database=require('better-sqlite3'),root=${JSON.stringify(root)},file=path.join(root,'nodus.sqlite'),db=new Database(file);
      db.pragma('page_size=1024');db.exec('CREATE TABLE notes(id INTEGER PRIMARY KEY,content TEXT)');const insert=db.prepare('INSERT INTO notes VALUES(?,?)');db.transaction(()=>{for(let i=0;i<1200;i++)insert.run(i,'synthetic recoverable content '.repeat(28));})();
      const table=db.prepare("SELECT rootpage FROM sqlite_master WHERE name='notes'").get().rootpage;db.close();const bytes=fs.readFileSync(file),leaves=[];
      const visit=page=>{const start=(page-1)*1024,header=start+(page===1?100:0),kind=bytes[header];if(kind===13){leaves.push(page);return;}assert.equal(kind,5);const n=bytes.readUInt16BE(header+3);for(let i=0;i<n;i++)visit(bytes.readUInt32BE(start+bytes.readUInt16BE(header+12+i*2)));visit(bytes.readUInt32BE(header+8));};visit(table);
      assert.ok(leaves.length>100);bytes[(leaves[Math.floor(leaves.length/2)]-1)*1024]=255;fs.writeFileSync(file,bytes);
      installRuntimeHooks(root);const {recoverReadableTables}=require(${JSON.stringify(path.join(repo,'electron/support/diagnostics.ts'))});const result=recoverReadableTables(root);
      assert.equal(result.partial,true);assert.ok(result.rows>500&&result.rows<1200,JSON.stringify(result));assert.deepEqual(fs.readFileSync(file),bytes);
      const recovered=path.join(root,'support-recovered-tables',fs.readdirSync(path.join(root,'support-recovered-tables'))[0]),check=new Database(recovered);assert.equal(check.pragma('integrity_check',{simple:true}),'ok');assert.equal(check.prepare('SELECT COUNT(*) AS n FROM notes').get().n,result.rows);check.close();
    `);
    execFileSync(require('electron'),[script],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe'});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
