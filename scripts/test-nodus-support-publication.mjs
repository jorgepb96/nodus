import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,sign} from 'node:crypto';
import {publicSupportArtifactName,supportSignatureEnvironment} from './lib/supportPublication.mjs';
import {verifySupportApp} from '../shared/support/appDistribution.mjs';

test('actual Linux package names produce manifests compatible with shipped Nodus clients',()=>{
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');
 const keys=[{keyId:'test',publicKeyPem:publicKey.export({type:'spki',format:'pem'})}];
 const artifact=(name,format)=>({name,format,platformSignature:'none',bytes:1,sha256:'a'.repeat(64),url:`https://github.com/jorgepb96/nodus/releases/download/v5.15.1/${name}`});
 const manifest={format:'nodus.support-app/1',protocol:1,version:'5.15.1',platform:'linux',arch:'x64',executable:'nodus-support',contentSha256:'b'.repeat(64),expandedBytes:1,runtime:artifact('Nodus-Support-Runtime-linux-x64.zip','zip'),installers:[['Nodus-Support-x86_64.AppImage','AppImage'],['Nodus-Support-linux-amd64.deb','deb'],['Nodus-Support-linux-x86_64.rpm','rpm']].map(([name,format])=>artifact(publicSupportArtifactName(name),format))};
 const payload=Buffer.from(JSON.stringify(manifest));
 assert.equal(verifySupportApp({keyId:'test',payload:payload.toString('base64'),signature:sign(null,payload,privateKey).toString('base64')},keys,'linux','x64').installers.length,3);
 assert.equal(manifest.installers[0].name,'Nodus-Support-x86-64.AppImage');
 assert.equal(publicSupportArtifactName('Nodus-Support-mac-arm64.dmg'),'Nodus-Support-mac-arm64.dmg');
 assert.equal(publicSupportArtifactName('Nodus-Support-win-x64.exe'),'Nodus-Support-win-x64.exe');
});

test('Authenticode checks drop inherited PowerShell module paths without changing the parent environment',()=>{
 const env={PSModulePath:'PowerShell 7 modules',psmodulepath:'other modules',Path:'retain',SystemRoot:'C:\\Windows',NODUS_SUPPORT_SIGNATURE_FILE:'old'};
 assert.deepEqual(supportSignatureEnvironment('new',env),{Path:'retain',SystemRoot:'C:\\Windows',NODUS_SUPPORT_SIGNATURE_FILE:'new'});
 assert.equal(env.PSModulePath,'PowerShell 7 modules');
});

test('Windows PowerShell can load its security module when called through Node from PowerShell 7',{skip:process.platform!=='win32'},()=>{
 const powershell=path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const env=supportSignatureEnvironment(process.execPath,{...process.env,PSModulePath:path.join(process.env.ProgramFiles??'C:\\Program Files','PowerShell/7/Modules')});
 const status=execFileSync(powershell,['-NoProfile','-NonInteractive','-Command','(Get-AuthenticodeSignature -LiteralPath $env:NODUS_SUPPORT_SIGNATURE_FILE).Status.ToString()'],{env,encoding:'utf8'}).trim();
 assert.ok(['Valid','NotSigned'].includes(status),status);
});
