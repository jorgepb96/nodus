// Publish the independent diagnostics app only after the matching Nodus release is public.
// Repair qualification is separate and remains enforced by the Support main process.
import fs from 'node:fs';
import path from 'node:path';
import {createPublicKey,sign} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import archiver from 'archiver';
import yauzl from 'yauzl';
import {hashFile,inventory,assert} from '../apps/nodus-support/core/files.mjs';
import {executableArchitectures} from '../apps/nodus-support/core/installation.mjs';
import {extractRuntime,acceptPlatformSignature} from '../apps/nodus-support/core/releases.mjs';
import {verifySupportApp,supportContentDigest} from '../shared/support/appDistribution.mjs';
const root=path.resolve(import.meta.dirname,'..'),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const platform=process.platform,arch=process.arch,tag=`v${pkg.version}`,output=path.join(root,'release-support');
const released=JSON.parse(execFileSync('gh',['release','view',tag,'--repo','jorgepb96/nodus','--json','isDraft,tagName'],{encoding:'utf8'}));
assert(!released.isDraft&&released.tagName===tag,'SUPPORT_RELEASE_NOT_PUBLISHED');
const keyId=process.env.NODUS_SUPPORT_RELEASE_KEY_ID,privateKey=process.env.NODUS_SUPPORT_RELEASE_PRIVATE_KEY;
assert(keyId&&privateKey,'RELEASE_NOT_TRUSTED');
const keys=JSON.parse(fs.readFileSync(path.join(root,'apps/nodus-support/trusted-release-keys.json'),'utf8')).keys;
const publicKey=createPublicKey(privateKey).export({type:'spki',format:'pem'});
assert(keys.some(key=>key.keyId===keyId&&key.publicKeyPem.trim()===publicKey.trim()),'RELEASE_NOT_TRUSTED');
const app=platform==='darwin'?path.join(output,`mac${arch==='arm64'?'-arm64':''}`,'nodus-support.app'):path.join(output,platform==='win32'?'win-unpacked':'linux-unpacked');
const executable=platform==='darwin'?'nodus-support.app/Contents/MacOS/nodus-support':platform==='win32'?'nodus-support.exe':'nodus-support';
const nativeExecutable=platform==='darwin'?path.join(app,'Contents/MacOS/nodus-support'):path.join(app,executable);
assert(executableArchitectures(nativeExecutable).includes(arch),'RELEASE_INCOMPATIBLE');
function signature(file) {
 if(platform==='darwin') {execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app]);execFileSync('/usr/sbin/spctl',['--assess','--type','execute',app]);return 'macos-notarized';}
 if(platform==='win32') {
  const powershell=path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const status=execFileSync(powershell,['-NoProfile','-NonInteractive','-Command','(Get-AuthenticodeSignature -LiteralPath $env:NODUS_SUPPORT_SIGNATURE_FILE).Status.ToString()'],{env:{...process.env,NODUS_SUPPORT_SIGNATURE_FILE:file},encoding:'utf8'}).trim();
  acceptPlatformSignature(status,'none');return status==='Valid'?'authenticode':'none';
 }
 return 'none';
}
const runtimeName=platform==='darwin'?`Nodus-Support-mac-${arch}.zip`:`Nodus-Support-Runtime-${platform}-${arch}.zip`,runtimeFile=path.join(output,runtimeName);
if(platform!=='darwin')await new Promise((resolve,reject)=>{
 const stream=fs.createWriteStream(runtimeFile,{flags:'wx'}),zip=archiver('zip',{forceZip64:true,zlib:{level:6}});stream.on('error',reject);zip.on('error',reject);stream.on('close',resolve);zip.pipe(stream);
 function walk(folder,relative=''){for(const name of fs.readdirSync(folder).sort()){const file=path.join(folder,name),entry=relative?`${relative}/${name}`:name,stat=fs.lstatSync(file);if(stat.isSymbolicLink())zip.symlink(entry,fs.readlinkSync(file),stat.mode);else if(stat.isDirectory()){zip.append('',{name:entry+'/',mode:stat.mode});walk(file,entry);}else zip.file(file,{name:entry,mode:stat.mode});}}
 walk(app);void zip.finalize();
});
const verification=path.join(root,'.ci/support-app-release',`${platform}-${arch}`);await extractRuntime(runtimeFile,verification,yauzl.open);
const expandedInventory=await inventory(verification,undefined,undefined,{links:true}),contentSha256=supportContentDigest(expandedInventory);
const artifact=async(name,format,executablePolicy=false)=>({name,format,url:`https://github.com/jorgepb96/nodus/releases/download/${tag}/${name}`,bytes:fs.statSync(path.join(output,name)).size,sha256:await hashFile(path.join(output,name)),platformSignature:signature(executablePolicy?nativeExecutable:path.join(output,name))});
const names=fs.readdirSync(output).filter(name=>/^Nodus-Support-/.test(name)&&!name.includes('-Runtime-')&&/\.(exe|dmg|deb|rpm|AppImage)$/.test(name));
const installers=await Promise.all(names.map(name=>artifact(name,name.endsWith('-portable.exe')?'portable':name.endsWith('.exe')?'nsis':name.split('.').at(-1))));
const manifest={format:'nodus.support-app/1',protocol:1,version:pkg.version,platform,arch,executable,contentSha256,expandedBytes:expandedInventory.bytes,runtime:await artifact(runtimeName,'zip',true),installers};
const payload=Buffer.from(JSON.stringify(manifest)),envelope={keyId,payload:payload.toString('base64'),signature:sign(null,payload,privateKey).toString('base64')};
verifySupportApp(envelope,keys,platform,arch);
const manifestName=`nodus-support-app-${platform}-${arch}.json`;fs.writeFileSync(path.join(output,manifestName),JSON.stringify(envelope));
// Upload the signed manifest LAST. Clients never see an available manifest before its assets.
execFileSync('gh',['release','upload',tag,...new Set([runtimeName,...names].map(name=>path.join(output,name))),'--repo','jorgepb96/nodus','--clobber'],{stdio:'inherit'});
execFileSync('gh',['release','upload',tag,path.join(output,manifestName),'--repo','jorgepb96/nodus','--clobber'],{stdio:'inherit'});
console.log(`Independent Nodus Support ${platform}/${arch} appended to the published ${tag}.`);
