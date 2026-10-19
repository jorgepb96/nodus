import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),repo=path.resolve(import.meta.dirname,'..');
const {generateSupportNsisScript,hasSupportNsisContract}=require('../build/supportNsis.cjs');
test('the actual pinned NSIS template keeps normal updates and adds an explicit non-destructive repair branch',()=>{
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'support-nsis-'));
 try{
  const script=generateSupportNsisScript(repo,scratch);assert.equal(hasSupportNsisContract(script),true);
  const installer=fs.readFileSync(script,'utf8'),section=fs.readFileSync(path.join(scratch,'installSection.nsh'),'utf8');
  assert.match(installer,/TestParameter.*nodus-support-repair/);
  assert.match(section,/\$nodusSupportRepair != "true"[\s\S]*uninstallOldVersion SHELL_CONTEXT[\s\S]*uninstallOldVersion HKEY_CURRENT_USER[\s\S]*\$\{endif\}/);
  assert.equal((section.match(/nsProcess::FindProcess/g)??[]).length,2);
  assert.match(section,/\$R0 != 603[\s\S]*SetErrorLevel 2[\s\S]*Quit/);
  assert.match(section,/!macro doStartApp\s+\$\{if\} \$nodusSupportRepair != "true"/);
  fs.appendFileSync(path.join(scratch,'installSection.nsh'),'unexpected modification');assert.equal(hasSupportNsisContract(script),false);
 }finally{fs.rmSync(scratch,{recursive:true,force:true});}
});
