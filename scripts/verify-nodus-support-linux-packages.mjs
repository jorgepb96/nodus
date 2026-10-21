// Native package-manager transactions inside disposable containers, never the host.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {installerCommand,runInstaller} from '../apps/nodus-support/core/releases.mjs';
import {supportSourceDigest} from './lib/supportEvidence.mjs';
assert.equal(process.platform,'linux');assert.equal(process.env.CI,'true','Disposable Linux CI only');
const repo=path.resolve(import.meta.dirname,'..'),sourceSha256=supportSourceDigest(repo),root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'support-package-native-'))),release=path.join(repo,'release-support'),checked=[];
for(const [format,image] of [['deb','ubuntu:22.04'],['rpm','fedora:43']]) {
 const name=fs.readdirSync(release).find(name=>name.endsWith(`.${format}`));assert.ok(name);const file=`/artifacts/${name}`,command=installerCommand('linux',format,file,'/unused'),rollback=installerCommand('linux',format,file,'/unused',{rollback:true});
 assert.equal(command.command,'/usr/bin/pkexec');assert.ok(command.args[0].startsWith('/usr/bin/'));
 // The container is root; execute the exact approved inner command there.
 const install=command.args.map(value=>`'${value.replaceAll("'","'\\''")}'`).join(' '),undo=rollback.args.map(value=>`'${value.replaceAll("'","'\\''")}'`).join(' ');
 const dependencies=format==='deb'?`apt-get update -qq\nDEBIAN_FRONTEND=noninteractive apt-get install -y '${file}'`:`dnf -y install '${file}'`;
 const script=path.join(root,`${format}.sh`);fs.writeFileSync(script,`#!/bin/bash\nset -euxo pipefail\nmkdir -p /root/.config/Nodus\nprintf 'Latest original user work' >/root/.config/Nodus/note.txt\n${dependencies}\n${install}\nexe="$(readlink -f /usr/bin/nodus-support)"\n[[ "$exe" == /opt/* && -f "$exe" ]]\nprogram="$(dirname "$exe")"\nprintf 'Retain installation additions' >"$program/retain-addition.txt"\ncp -a "$program" /fixture/previous\nbefore="$(sha256sum "$exe" | cut -d' ' -f1)"\n${install}\n[[ "$(cat "$program/retain-addition.txt")" == 'Retain installation additions' ]]\nprintf damaged >"$exe"\n${undo}\n[[ "$(sha256sum "$exe" | cut -d' ' -f1)" == "$before" ]]\n[[ "$(sha256sum /fixture/previous/$(basename "$exe") | cut -d' ' -f1)" == "$before" ]]\n[[ "$(cat /root/.config/Nodus/note.txt)" == 'Latest original user work' ]]\n[[ "$(cat "$program/retain-addition.txt")" == 'Retain installation additions' ]]\nprintf passed >/fixture/passed\n`);
 const fixture=path.join(root,format);fs.mkdirSync(fixture);
 execFileSync('docker',['pull',image],{stdio:'inherit',timeout:300000});
 // Fedora's RPM transaction isolation needs its own mount namespace. Grant
 // that capability only in this disposable container, retaining Docker's
 // default seccomp/AppArmor policies and the read-only package mount.
 execFileSync('docker',['run','--rm',...(format==='rpm'?['--cap-add=SYS_ADMIN']:[]),'--mount',`type=bind,src=${release},dst=/artifacts,readonly`,'--mount',`type=bind,src=${script},dst=/verify.sh,readonly`,'--mount',`type=bind,src=${fixture},dst=/fixture`,image,'bash','/verify.sh'],{stdio:'inherit',timeout:300000});
 assert.equal(fs.readFileSync(path.join(fixture,'passed'),'utf8'),'passed');checked.push({format,image,nativeManager:true,freshInstall:true,sameVersionRepair:true,damagedExecutableRestored:true,rollbackInstaller:true,previousRetained:true,unownedAdditionsRetained:true,originalProfileUnchanged:true});
}
// Refuse privilege escalation without an authentication agent. The command is
// /usr/bin/false, so even an unexpected authorization cannot install anything.
assert.notEqual(process.getuid(),0,'The permission-refusal case needs the ordinary CI user');
const refusedArgs=['--disable-internal-agent','/usr/bin/false'],permissionEnv={...process.env,DISPLAY:'',WAYLAND_DISPLAY:'',DBUS_SESSION_BUS_ADDRESS:`unix:path=${path.join(root,'absent-session-bus')}`};
let refusedCode;try{execFileSync('/usr/bin/pkexec',refusedArgs,{env:permissionEnv,stdio:'ignore',timeout:20000});}catch(error){refusedCode=error.status;}
assert.ok([126,127].includes(refusedCode),`Expected an actual authorization refusal, got ${refusedCode}`);
await assert.rejects(runInstaller('/usr/bin/pkexec',refusedArgs),error=>error.code==='INSTALLER_FAILED');
const output=path.join(repo,'.ci/support-native');fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'linux-x64-packages.json'),JSON.stringify({format:'nodus.support-linux-package-evidence/1',sourceSha256,platform:process.platform,arch:process.arch,hostInstallationUnchanged:true,nativeAuthorizationRefused:true,authorizationExitCode:refusedCode,installerRefusalHandled:true,containers:checked},null,2));
