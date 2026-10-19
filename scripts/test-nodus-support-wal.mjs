import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

test('real native WAL damage is detected before SQLite can discard recent work',()=>{
  const repo=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-wal-')));
  try {
    const script=path.join(root,'verify.mjs');fs.writeFileSync(script,`
      import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
      import {verifySupportWal} from ${JSON.stringify(pathToFileURL(path.join(repo,'shared/support/wal-integrity.mjs')).href)};
      const require=createRequire(${JSON.stringify(path.join(repo,'package.json'))}),Database=require('better-sqlite3'),file=${JSON.stringify(path.join(root,'fixture.sqlite'))},db=new Database(file);
      db.pragma('journal_mode=WAL');db.pragma('wal_autocheckpoint=0');db.exec("CREATE TABLE notes(value TEXT);INSERT INTO notes VALUES('most recent committed work')");
      const original=fs.readFileSync(file+'-wal');verifySupportWal(file);
      const copy=file+'.copy';fs.copyFileSync(file,copy);const wal=copy+'-wal';fs.writeFileSync(wal,original);verifySupportWal(copy);
      const corrupt=Buffer.from(original);corrupt[corrupt.length-1]^=1;fs.writeFileSync(wal,corrupt);assert.throws(()=>verifySupportWal(copy),/SUPPORT_WAL_UNVERIFIED/);
      fs.writeFileSync(wal,original.subarray(0,-1));assert.throws(()=>verifySupportWal(copy),/SUPPORT_WAL_UNVERIFIED/);
      fs.writeFileSync(wal,original.subarray(0,18));assert.throws(()=>verifySupportWal(copy),/SUPPORT_WAL_UNVERIFIED/);
      const badHeader=Buffer.from(original);badHeader[24]^=1;fs.writeFileSync(wal,badHeader);assert.throws(()=>verifySupportWal(copy),/SUPPORT_WAL_UNVERIFIED/);
      const oldFrame=Buffer.from(original.subarray(32));oldFrame[8]^=1;fs.writeFileSync(wal,Buffer.concat([original,oldFrame]));verifySupportWal(copy);
      fs.writeFileSync(wal,original);const reopened=new Database(copy);assert.equal(reopened.prepare('SELECT value FROM notes').get().value,'most recent committed work');reopened.close();
      assert.deepEqual(fs.readFileSync(file+'-wal'),original);db.close();
    `);
    execFileSync(require('electron'),[script],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe'});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
