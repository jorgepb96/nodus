// Only newly created, small images are mounted. Never select a physical disk.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

export function createFaultVolume(root) {
  assert.ok(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));
  assert.ok(path.basename(root).startsWith('nodus-support-storage-'));
  assert.ok(!fs.existsSync(path.join(root,'volume-created.json')));
  let mount=path.join(root,'mounted'),letter,mounted=false;
  const image=path.join(root,process.platform==='win32'?'fixture.vhd':process.platform==='darwin'?'fixture.dmg':'fixture.ext4');
  if(process.platform!=='win32')fs.mkdirSync(mount);
  const run=(file,args)=>execFileSync(file,args,{stdio:'pipe',timeout:60000,windowsHide:true});
  let diskpartFinished=0;
  const invokeDiskpart=file=>{
    // Microsoft requires 15 seconds between scripts for DiskPart to finish shutting down.
    // https://learn.microsoft.com/windows-server/administration/windows-commands/diskpart-scripts-and-examples
    const delay=15000-(Date.now()-diskpartFinished);if(delay>0)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,delay);
    try{return run('diskpart.exe',['/s',file]);}
    catch(error){throw new Error(`Disposable VHD operation failed: ${error.stdout?.toString()??''} ${error.stderr?.toString()??''}`,{cause:error});}
    finally{diskpartFinished=Date.now();}
  };
  const diskpart=lines=>{
    assert.equal(process.env.CI,'true','Virtual disk administration is restricted to disposable CI hosts');
    assert.ok(!image.includes('"')&&!mount.includes('"'));
    const file=path.join(root,`diskpart-${Date.now()}.txt`);fs.writeFileSync(file,[`select vdisk file="${image}"`,...lines,'exit'].join('\r\n'));
    return invokeDiskpart(file);
  };
  if(process.platform==='darwin')run('/usr/bin/hdiutil',['create','-size','96m','-fs','HFS+','-volname','NodusSupportQA',image]);
  else if(process.platform==='linux') {
    assert.equal(process.env.CI,'true','Loop mounts are restricted to disposable CI hosts');
    const fd=fs.openSync(image,'wx');fs.ftruncateSync(fd,112*1024**2);fs.closeSync(fd);
    run('/usr/sbin/mkfs.ext4',['-q','-F',image]);
  } else {
    assert.equal(process.platform,'win32');assert.equal(process.env.CI,'true');
    const drives=run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Environment]::GetLogicalDrives() -join ','"]).toString();
    letter=[...'ZYXWVUTSRQPONMLKJIHGFE'].find(value=>!drives.includes(`${value}:`)&&!fs.existsSync(`${value}:\\`));assert.ok(letter,'No unused fixture drive letter');mount=`${letter}:\\`;
    const file=path.join(root,'diskpart-create.txt');fs.writeFileSync(file,[`create vdisk file="${image}" maximum=112 type=expandable`,`select vdisk file="${image}"`,'attach vdisk','create partition primary','format fs=ntfs quick label=NodusSupportQA',`assign letter=${letter}`,'exit'].join('\r\n'));
    invokeDiskpart(file);mounted=true;
  }
  const check=()=>{
    const stat=fs.statfsSync(mount,{bigint:true});
    // Refuse to fill anything unless it is the expected small mounted image.
    assert.ok(stat.blocks*stat.bsize<128n*1024n**2n,'Fixture volume did not mount; refusing to fill the host filesystem');
    assert.ok(stat.bavail*stat.bsize>70n*1024n**2n,'The empty fixture volume has insufficient capacity');
  };
  const reconnect=()=>{
    if(mounted)return;
    if(process.platform==='darwin')run('/usr/bin/hdiutil',['attach','-nobrowse','-owners','off','-mountpoint',mount,image]);
    else if(process.platform==='linux') {
      run('/usr/bin/sudo',['-n','/usr/bin/mount','-o','loop,nosuid,nodev',image,mount]);
      run('/usr/bin/sudo',['-n','/usr/bin/chown',`${process.getuid()}:${process.getgid()}`,mount]);
    } else diskpart(['attach vdisk','select partition 1',`assign letter=${letter}`]);
    mounted=true;
  };
  const disconnect=()=>{
    if(!mounted)return;
    if(process.platform==='darwin')run('/usr/bin/hdiutil',['detach','-force',mount]);
    else if(process.platform==='linux')run('/usr/bin/sudo',['-n','/usr/bin/umount',mount]);
    else {
      // DiskPart can report an error after the volume has already detached.
      // Ask the Storage API for the image's actual state rather than retrying it.
      const command="$ErrorActionPreference='Stop'; $image=Get-DiskImage -ImagePath $env:NODUS_QA_VHD; if($image.Attached){Dismount-DiskImage -ImagePath $env:NODUS_QA_VHD | Out-Null}; if((Get-DiskImage -ImagePath $env:NODUS_QA_VHD).Attached){throw 'Fixture image remains attached'}";
      execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{env:{...process.env,NODUS_QA_VHD:image},stdio:'pipe',timeout:60000,windowsHide:true});
    }
    mounted=false;
  };
  try{reconnect();check();fs.writeFileSync(path.join(root,'volume-created.json'),JSON.stringify({image,mount}));}
  catch(error){try{disconnect();}catch{}throw error;}
  return {mount,image,reconnect,disconnect};
}

export function fillFaultVolume(mount,file) {
  assert.equal(path.dirname(file),mount);
  const info=fs.statfsSync(mount,{bigint:true});assert.ok(info.blocks*info.bsize<128n*1024n**2n,'Refusing to fill the host filesystem');
  const fd=fs.openSync(file,'wx',0o600),chunk=Buffer.alloc(1024**2,37);
  try {
    for(;;) {
      const stat=fs.statfsSync(mount,{bigint:true}),free=stat.bavail*stat.bsize;
      if(free<=16384n)break;
      const length=Number(free-16384n>BigInt(chunk.length)?BigInt(chunk.length):free-16384n);
      try{fs.writeSync(fd,chunk,0,length);}catch(error){if(error.code!=='ENOSPC')throw error;break;}
    }
    try{fs.fsyncSync(fd);}catch(error){if(error.code!=='ENOSPC')throw error;}
  }finally{fs.closeSync(fd);}
}
