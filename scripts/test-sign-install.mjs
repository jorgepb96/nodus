// Real on-demand installation stays isolated from user profiles and Python environments.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
const require=createRequire(import.meta.url);
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'nodus-sign-install-'));
await build({entryPoints:['electron/toolkit/sign/install.ts'],outfile:path.join(temp,'install.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron','better-sqlite3'],alias:{'@shared':path.resolve('shared')}});
const {SignInstaller}=require(path.join(temp,'install.cjs'));
await build({entryPoints:['electron/toolkit/sign/engine.ts'],outfile:path.join(temp,'engine.cjs'),bundle:true,platform:'node',format:'cjs'});
const {SignEngine}=require(path.join(temp,'engine.cjs'));
const assets=path.resolve('electron/assets/sign');
test.after(()=>fs.rm(temp,{recursive:true,force:true}));
test('packaged installation contains the complete hash-locked dependencies',async()=>{
  const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
  assert.ok(pkg.build.extraResources.find(r=>r.to==='sign').filter.includes('requirements.lock'));
  assert.ok(pkg.build.extraResources.some(r=>r.to==='zotero-mcp'));
  const lock=await fs.readFile(path.join(assets,'requirements.lock'),'utf8');
  for(const req of ['pyHanko==0.35.1','cryptography==50.0.1','Pillow==12.1.1','tzdata==2026.4']) assert.ok(lock.includes(req));
  assert.ok(lock.includes('--hash=sha256:'));
});
// Stub interpreters record which one would have built the venv, then fail it.
async function stub(file,log){
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,`#!/bin/sh\necho "${file} $*" >> "${log}"\nexit 1\n`,{mode:0o755});
  return file;
}
async function baseFor(name,platform,arch,systemVersion='3.12.9'){
  const dir=path.join(temp,name),log=path.join(dir,'calls.log'),root=path.join(dir,'root');
  const bundled=await stub(path.join(dir,'bundled/python/bin/python3'),log);
  const system=await stub(path.join(dir,'system/python3'),log);
  const downloaded=await stub(path.join(root,'interpreter/python/bin/python3'),log);
  let probed=false;
  const installer=new SignInstaller(root,assets,path.join(dir,'bundled'),async()=>{probed=true;return {path:system,version:systemVersion};},{platform,arch});
  await assert.rejects(()=>installer.install(()=>{}),/SIGN_INSTALL_FAILED/);
  const calls=(await fs.readFile(log,'utf8')).trim().split('\n');
  assert.equal(calls.length,1);
  assert.match(calls[0],/ -I -m venv /);
  const used=calls[0].split(' ')[0];
  return {used:used===bundled?'bundled':used===system?'system':used===downloaded?'downloaded':used,probed};
}
test('macOS never builds the engine on the team-signed bundled Python, whose library validation rejects PyPI wheels',{skip:process.platform==='win32'&&'stub interpreters are shell scripts'},async()=>{
  assert.deepEqual(await baseFor('mac-arm','darwin','arm64'),{used:'system',probed:true});
  assert.deepEqual(await baseFor('mac-arm-old','darwin','arm64','3.11.4'),{used:'downloaded',probed:true});
  // Intel reuses the bundled cryptography build, made for the pinned Python only.
  assert.deepEqual(await baseFor('mac-intel','darwin','x64'),{used:'downloaded',probed:false});
  assert.deepEqual(await baseFor('linux','linux','x64'),{used:'bundled',probed:false});
});
test('failed and cancelled installs do not publish a ready environment',async()=>{
  const failedRoot=path.join(temp,'failed');
  const failed=new SignInstaller(failedRoot,assets,'/missing',async()=>{throw new Error('offline')});
  await assert.rejects(()=>failed.install(()=>{}),/SIGN_INSTALL_FAILED/);
  assert.equal((await fs.readdir(failedRoot)).length,0);
  let started;
  const waiting=new Promise(resolve=>started=resolve);
  const cancelledRoot=path.join(temp,'cancelled');
  const installer=new SignInstaller(cancelledRoot,assets,'/missing',async()=>{started();await new Promise(resolve=>setTimeout(resolve,100));return null;});
  const promise=installer.install(()=>{});
  await waiting;installer.cancel();
  await assert.rejects(()=>promise,/SIGN_INSTALL_CANCELLED/);
  assert.ok(!(await fs.readdir(cancelledRoot)).some(n=>n.startsWith('env-')||n==='installed.json'));
});
test('real automatic Python download and installation can sign and validate without any preinstalled Python', {skip:process.env.NODUS_SIGN_INSTALL_TEST?false:'Set NODUS_SIGN_INSTALL_TEST=1 to download and install the real engine',timeout:900000},async()=>{
  const root=path.join(temp,'real');
  const phases=[];
  const installer=new SignInstaller(root,assets,'/missing',async()=>null);
  const python=await installer.install(event=>phases.push(event.phase));
  assert.ok(phases.includes('python'));
  assert.ok(phases.includes('dependencies'));
  assert.equal(phases.at(-1),'ready');
  assert.equal(await installer.install(()=>{}),python);
  assert.equal((await fs.readdir(root)).filter(n=>n.startsWith('env-')).length,1);
  execFileSync(python,['-I','-c',`from cryptography import x509
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
from datetime import datetime,timedelta,timezone
import pathlib,sys
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Nodus INSTALL TEST ONLY')]);now=datetime.now(timezone.utc)
c=x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=1)).sign(k,hashes.SHA256())
pathlib.Path(sys.argv[1]).write_bytes(pkcs12.serialize_key_and_certificates(b'test',k,c,None,serialization.BestAvailableEncryption(b'test-only')))`,path.join(temp,'test.p12')]);
  const pdf=await PDFDocument.create();pdf.addPage([595,842]);
  const engine=new SignEngine(python,path.join(assets,'engine.py'));
  const signed=await engine.run({op:'sign',pdf:Buffer.from(await pdf.save()).toString('base64'),certificate:path.join(temp,'test.p12'),password:'test-only',appearance:{reason:'Install test'},appearancePng:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMCsAAAAASUVORK5CYII=',page:1,box:[20,20,200,80]});
  assert.ok(signed.inspection.signatures[0].intact&&signed.inspection.signatures[0].valid);
  console.log('Real install: standalone Python, hash-locked wheels, reuse, PAdES and cryptographic validation passed');
});
