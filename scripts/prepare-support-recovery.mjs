// Reconstruct the already-published application; never rebuild or replace Nodus assets.
// This is only run after native repair qualification permits recovery publication.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readInstalledPackage,executableArchitectures} from '../apps/nodus-support/core/installation.mjs';
import {hashFile,assert} from '../apps/nodus-support/core/files.mjs';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),pkg=require('../package.json'),tag=`v${pkg.version}`;
const output=path.join(root,'release');fs.mkdirSync(output,{recursive:true});
const platform=process.platform,arch=process.arch;
const names=platform==='darwin'?[`Nodus-mac-${arch}.zip`]:platform==='win32'?['Nodus-win-x64.exe']:['Nodus-x86_64.AppImage','Nodus-linux-amd64.deb','Nodus-linux-x86_64.rpm'];
// Intel is added asynchronously too. A missing Intel asset fails just its retryable
// recovery job; it cannot retract Nodus or the independent diagnostics application.
execFileSync('gh',['release','download',tag,'--repo','jorgepb96/nodus','--dir',output,...names.flatMap(name=>['--pattern',name])],{stdio:'inherit'});
let app;
if(platform==='darwin') {
 const directory=path.join(output,`mac${arch==='arm64'?'-arm64':''}`);fs.mkdirSync(directory);execFileSync('/usr/bin/ditto',['-x','-k',path.join(output,names[0]),directory],{stdio:'inherit'});app=path.join(directory,'Nodus.app');
} else if(platform==='win32') {
 const seven=require('7zip-bin').path7za,scratch=path.join(root,'.ci/support-main-extract');fs.mkdirSync(scratch,{recursive:true});
 execFileSync(seven,['x',path.join(output,names[0]),`-o${scratch}`,'-y'],{stdio:'inherit'});
 const archives=folder=>fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?archives(path.join(folder,entry.name)):entry.name.endsWith('.7z')?[path.join(folder,entry.name)]:[]);
 const payloads=archives(scratch);assert(payloads.length===1,'RELEASE_INCOMPATIBLE');app=path.join(output,'win-unpacked');fs.mkdirSync(app);execFileSync(seven,['x',payloads[0],`-o${app}`,'-y'],{stdio:'inherit'});
} else {
 const image=path.join(output,names[0]);fs.chmodSync(image,0o700);execFileSync(image,['--appimage-extract'],{cwd:output,stdio:'inherit'});app=path.join(output,'linux-unpacked');fs.renameSync(path.join(output,'squashfs-root'),app);
}
const executable=platform==='darwin'?path.join(app,'Contents/MacOS/Nodus'):path.join(app,platform==='win32'?'Nodus.exe':'nodus');
assert(executableArchitectures(executable).includes(arch),'RELEASE_INCOMPATIBLE');
const resources=platform==='darwin'?path.join(app,'Contents/Resources'):path.join(app,'resources');
const installed=readInstalledPackage(resources);assert(installed.version===pkg.version,'RELEASE_INCOMPATIBLE');
const metadata=JSON.parse(fs.readFileSync(path.join(resources,'nodus-support-protocol.json'),'utf8'));
assert(metadata.protocol===1&&metadata.version===pkg.version&&metadata.archiveSha256===await hashFile(path.join(resources,'app.asar')),'RELEASE_INCOMPATIBLE');
console.log(`Verified published Nodus recovery source ${platform}/${arch}.`);
