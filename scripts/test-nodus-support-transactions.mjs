import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import archiver from 'archiver';
import { open as openZip } from 'yauzl';
import { inventory, verifyInventory, writeRecord, copyInventory } from '../apps/nodus-support/core/files.mjs';
import { readPolicy, writePolicy } from '../apps/nodus-support/core/policies.mjs';
import { extractRuntime } from '../apps/nodus-support/core/releases.mjs';
import { requireQualified } from '../apps/nodus-support/core/qualification.mjs';

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-support-transactions-')));
process.on('exit',()=>fs.rmSync(scratch,{recursive:true,force:true}));
const put = (file, value) => { fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,value); };
test('verification detects additional files and changed data without touching either version',async () => {
  const root = path.join(scratch,'concurrency'); put(path.join(root,'before.txt'),'before'); const manifest = await inventory(root);
  put(path.join(root,'new.txt'),'recent work');
  await assert.rejects(verifyInventory(root,manifest),/COPY_NOT_VERIFIED/);
  assert.equal(fs.readFileSync(path.join(root,'new.txt'),'utf8'),'recent work');
  put(path.join(root,'before.txt'),'changed work');
  await assert.rejects(verifyInventory(root,manifest),/COPY_NOT_VERIFIED/);
  assert.equal(fs.readFileSync(path.join(root,'before.txt'),'utf8'),'changed work');
});
test('only complete durable records are committed and an existing record is never overwritten', async () => {
  const record = path.join(scratch,'journal','00000001.json');
  await writeRecord(record,{sequence:1,state:{status:'protected'}});
  put(path.join(path.dirname(record),'prepared','interrupted.json'),'{partial');
  assert.deepEqual(JSON.parse(fs.readFileSync(record,'utf8')),{sequence:1,state:{status:'protected'}});
  await assert.rejects(writeRecord(record,{sequence:1,state:{status:'testing'}}),/EEXIST/);
  assert.equal(JSON.parse(fs.readFileSync(record,'utf8')).state.status,'protected');
});
test('launch selections use optimistic concurrency and preserve every previous choice',async () => {
  const profile = path.join(scratch,'source'), folder = path.join(scratch,'policies'); fs.mkdirSync(profile);
  const before = await inventory(profile);
  const first = await writePolicy(folder,profile,{softwareGraphics:true,recoveredRoot:null},null);
  await assert.rejects(writePolicy(folder,profile,{softwareGraphics:false,recoveredRoot:null},null),/CONCURRENT_CHANGE/);
  const second = await writePolicy(folder,profile,{softwareGraphics:false,recoveredRoot:null},first.id);
  assert.equal(readPolicy(folder,profile).id,second.id);
  assert.equal(fs.readdirSync(folder).filter(n=>n.endsWith('.json')).length,2);
  assert.deepEqual(await inventory(profile),before);
  await assert.rejects(writePolicy(folder,profile,{softwareGraphics:false,recoveredRoot:profile},second.id),/OVERLAPPING_STORAGE/);
});
async function zip(name, entries) {
  const file = path.join(scratch,`${name}.zip`);
  await new Promise((resolve,reject)=>{
    const output=fs.createWriteStream(file), archive=archiver('zip');
    output.on('close',resolve); output.on('error',reject); archive.on('error',reject); archive.pipe(output);
    for (const item of entries) {
      if (item.target) archive.symlink(item.name,item.target,0o120777);
      else archive.append(item.data,{name:item.name,mode:0o100700});
    }
    void archive.finalize();
  }); return file;
}
test('actual ZIP extraction refuses escaping links and duplicate names',async () => {
  const escape=await zip('escape',[{name:'runtime/link',target:'../../escaped'}]);
  await assert.rejects(extractRuntime(escape,path.join(scratch,'escape-runtime'),openZip),/ARCHIVE_PATH_ESCAPE/);
  assert.equal(fs.existsSync(path.join(scratch,'escaped')),false);
  const duplicate=await zip('duplicate',[{name:'runtime/file',data:'first'},{name:'runtime/file',data:'second'}]);
  await assert.rejects(extractRuntime(duplicate,path.join(scratch,'duplicate-runtime'),openZip),/ARCHIVE_DUPLICATE/);
  assert.equal(fs.readFileSync(path.join(scratch,'duplicate-runtime/runtime/file'),'utf8'),'first');
});
test('an unqualified repair is blocked for every supported native platform',() => {
  const catalog=JSON.parse(fs.readFileSync(new URL('../apps/nodus-support/qualified-repairs.json',import.meta.url),'utf8'));
  for(const [platform,arch] of [['win32','x64'],['darwin','arm64'],['darwin','x64'],['linux','x64']]) for(const action of ['reinstall','interactive-copy','apply-solution','restore-copy']) {
    assert.throws(()=>requireQualified({...catalog,platforms:{}},platform,arch,action),/REPAIR_NOT_QUALIFIED/);
  }
  const source='a'.repeat(64),approved={...catalog,sourceSha256:source,platforms:{'win32-x64':['reinstall']}};
  assert.doesNotThrow(()=>requireQualified(approved,'win32','x64','reinstall',source));
  assert.throws(()=>requireQualified(approved,'win32','x64','reinstall','b'.repeat(64)),/REPAIR_NOT_QUALIFIED/);
  assert.throws(()=>requireQualified(approved,'win32','x64','reinstall'),/REPAIR_NOT_QUALIFIED/);
  assert.throws(()=>requireQualified({...catalog,protocol:2},'win32','x64','reinstall'),/REPAIR_NOT_QUALIFIED/);
});
test('application framework symlinks copy privately without traversing the links', {skip:process.platform==='win32'},async () => {
  const source=path.join(scratch,'bundle'),copy=path.join(scratch,'bundle-copy');
  put(path.join(source,'Framework/Versions/A/binary'),'executable'); fs.symlinkSync('A',path.join(source,'Framework/Versions/Current'));
  fs.symlinkSync('Versions/Current/binary',path.join(source,'Framework/binary'));
  const manifest=await inventory(source,undefined,undefined,{links:true});
  await copyInventory(source,copy,manifest); await verifyInventory(copy,manifest);
  assert.equal(fs.readlinkSync(path.join(copy,'Framework/Versions/Current')),'A');
  assert.equal(fs.readFileSync(path.join(copy,'Framework/binary'),'utf8'),'executable');
});
test('streamed protection handles files larger than four GiB', {skip:process.env.NODUS_SUPPORT_LARGE_FILES !== '1' ? 'Runs in the mandatory four-platform Nodus Support native matrix' : false}, async () => {
  const source=path.join(scratch,'large-source'),target=path.join(scratch,'large-copy');
  const fd=fs.openSync(source,'wx'); fs.ftruncateSync(fd,4*1024**3+17); fs.writeSync(fd,Buffer.from('end'),0,3,4*1024**3+14); fs.closeSync(fd);
  const manifest=await inventory(source); await copyInventory(source,target,manifest); await verifyInventory(target,manifest);
  assert.equal(fs.statSync(target).size,4*1024**3+17);
});
