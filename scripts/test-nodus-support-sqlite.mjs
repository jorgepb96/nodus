import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

test('actual native SQLite cannot open, attach, vacuum or back up outside the trial',()=>{
  const repo=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-sqlite-boundary-'))),script=path.join(root,'test.mjs');
  try {
    fs.writeFileSync(script,`
      import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
      import {installSqliteIsolation} from ${JSON.stringify(pathToFileURL(path.join(repo,'shared/support/sqlite-isolation.mjs')).href)};
      const require=createRequire(${JSON.stringify(path.join(repo,'package.json'))}),root=${JSON.stringify(root)},copy=path.join(root,'copy'),outside=path.join(root,'original.sqlite');fs.mkdirSync(copy);
      const Before=require('better-sqlite3'),original=new Before(outside);original.exec("CREATE TABLE notes(content TEXT); INSERT INTO notes VALUES('only original work')");original.close();const bytes=fs.readFileSync(outside);
      const restore=installSqliteIsolation(require,file=>{if(!path.resolve(file).startsWith(copy+path.sep))throw Object.assign(new Error('SUPPORT_WRITE_DENIED'),{code:'SUPPORT_WRITE_DENIED'});});
      try {
        const Database=require('better-sqlite3');assert.throws(()=>new Database(outside),/SUPPORT_WRITE_DENIED/);assert.throws(()=>Database(outside),/SUPPORT_WRITE_DENIED/);
        const db=new Database(path.join(copy,'trial.sqlite'));db.exec('CREATE TABLE sample(value TEXT)');
        assert.throws(()=>new db.constructor(outside),/SUPPORT_WRITE_DENIED/);
        assert.throws(()=>db.exec("ATTACH DATABASE '"+outside.replaceAll("'","''")+"' AS other"),/SUPPORT_WRITE_DENIED/);
        assert.throws(()=>db.prepare('ATTACH DATABASE ? AS other').run(outside),/SUPPORT_WRITE_DENIED/);
        assert.throws(()=>db.prepare('ATTACH DATABASE @source AS other').bind({source:outside}),/SUPPORT_WRITE_DENIED/);
        assert.throws(()=>db.exec("ATTACH DATABASE char(47)||'outside.sqlite' AS other"),/SUPPORT_WRITE_DENIED/);
        assert.throws(()=>db.prepare('VACUUM INTO ?').run(outside),/SUPPORT_WRITE_DENIED/);
        await assert.rejects(db.backup(outside),/SUPPORT_WRITE_DENIED/);assert.throws(()=>db.loadExtension(outside),/SUPPORT_WRITE_DENIED/);
        assert.throws(()=>db.pragma("temp_store_directory='"+root.replaceAll("'","''")+"'"),/SUPPORT_WRITE_DENIED/);
        db.prepare('VACUUM INTO ?').run(path.join(copy,'vacuum.sqlite'));
        db.prepare('ATTACH DATABASE @file AS other').bind({file:path.join(copy,'attached.sqlite')}).run();db.exec('DETACH DATABASE other');
        await db.backup(path.join(copy,'backup.sqlite'));assert.equal(db.prepare("SELECT 'ATTACH DATABASE' AS text").get().text,'ATTACH DATABASE');db.close();
        assert.deepEqual(fs.readFileSync(outside),bytes);assert.equal(fs.existsSync(outside+'-wal'),false);assert.equal(fs.existsSync(outside+'-shm'),false);
      }finally{restore();}
    `);
    execFileSync(require('electron'),[script],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe'});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
