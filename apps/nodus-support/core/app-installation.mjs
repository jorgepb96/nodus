// Managed independent installations never replace Nodus, an older Support, or user data.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import yauzl from 'yauzl';
import {verifySupportApp,supportContentDigest} from '../../../shared/support/appDistribution.mjs';
import {assert,inventory,noLinks,sufficientSpace,verifyInventory,writeRecord,readJson} from './files.mjs';
import {readInstalledPackage} from './installation.mjs';
import {downloadArtifact,extractRuntime} from './releases.mjs';

export class SupportAppInstallation {
  constructor({storage,keys,platform,arch,verifyPlatform=async()=>{}}){Object.assign(this,{storage,keys,platform,arch,verifyPlatform});}
  async current() {
    noLinks(this.storage);if(!fs.existsSync(this.storage))return null;
    const candidates=[];
    for(const name of fs.readdirSync(this.storage)) {
      if(!/^[a-f0-9-]{36}$/.test(name))continue;
      const folder=path.join(this.storage,name),record=path.join(folder,'installed.json');if(!fs.existsSync(record))continue;
      try {
        noLinks(record);const value=readJson(record),manifest=verifySupportApp(value.envelope,this.keys,this.platform,this.arch);
        assert(value.format==='nodus.support-installation/1'&&typeof value.at==='string','SUPPORT_DOWNLOAD_INVALID');
        candidates.push({folder,manifest,value});
      }catch{/* Preserve incomplete or damaged records; only verified installations can open. */}
    }
    candidates.sort((a,b)=>b.value.at.localeCompare(a.value.at));
    for(const item of candidates)try {
      assert(supportContentDigest(item.value.inventory)===item.manifest.contentSha256,'SUPPORT_DOWNLOAD_INVALID');
      const runtime=path.join(item.folder,'application');await verifyInventory(runtime,item.value.inventory);
      const executable=path.join(runtime,item.manifest.executable);noLinks(executable);assert(fs.statSync(executable).isFile(),'SUPPORT_DOWNLOAD_INVALID');
      await this.verifyPlatform(executable,item.manifest);return {...item,executable};
    }catch{/* Retain a damaged update and try an older verified installation. */}
    return null;
  }
  async install(envelope,{signal,progress=()=>{},fetch:fetcher=fetch}={}) {
    const manifest=verifySupportApp(envelope,this.keys,this.platform,this.arch);noLinks(this.storage);
    await fsp.mkdir(this.storage,{recursive:true,mode:0o700});await sufficientSpace(this.storage,manifest.runtime.bytes+manifest.expandedBytes,2);
    const folder=path.join(this.storage,randomUUID());await fsp.mkdir(folder,{mode:0o700});
    await writeRecord(path.join(folder,'prepared.json'),{format:'nodus.support-installation/1',envelope,at:new Date().toISOString()});
    const archive=await downloadArtifact(manifest.runtime,folder,{signal,progress,fetch:fetcher});signal?.throwIfAborted();
    progress({phase:'installing'});const runtime=path.join(folder,'application');
    await extractRuntime(archive,runtime,yauzl.open);signal?.throwIfAborted();
    const executable=path.join(runtime,manifest.executable);noLinks(executable);assert(fs.statSync(executable).isFile(),'SUPPORT_DOWNLOAD_INVALID');
    await this.verifyPlatform(executable,manifest);signal?.throwIfAborted();
    const protectedFiles=await inventory(runtime,signal,undefined,{links:true});assert(supportContentDigest(protectedFiles)===manifest.contentSha256,'SUPPORT_DOWNLOAD_INVALID');await verifyInventory(runtime,protectedFiles,signal);
    await writeRecord(path.join(folder,'installed.json'),{format:'nodus.support-installation/1',envelope,at:new Date().toISOString(),inventory:protectedFiles});
    return {executable,manifest};
  }
}

// Native package managers add their own uninstaller. All application/runtime
// contents still have to match the signed Support package, not a local marker.
export async function verifySystemSupport(executable,envelope,{keys,platform,arch,verifyPlatform=async()=>{}}) {
 const manifest=verifySupportApp(envelope,keys,platform,arch);noLinks(executable);
 const root=platform==='darwin'?path.resolve(executable,'../../..'):path.dirname(executable);
 const resources=platform==='darwin'?path.join(root,'Contents/Resources'):path.join(root,'resources');
 const pkg=readInstalledPackage(resources);assert(pkg.name==='nodus-support'&&pkg.version===manifest.version,'SUPPORT_DOWNLOAD_INVALID');
 let actual=await inventory(root,undefined,undefined,{links:true});
 if(platform==='win32')actual={...actual,entries:actual.entries.filter(entry=>!['Uninstall Nodus Support.exe','Uninstall nodus-support.exe','uninstallerIcon.ico'].includes(entry.path))};
 if(platform==='darwin')actual={...actual,entries:[{path:'',type:'directory'},...actual.entries.map(entry=>({...entry,path:entry.path?`nodus-support.app/${entry.path}`:'nodus-support.app'}))]};
 assert(supportContentDigest(actual)===manifest.contentSha256,'SUPPORT_DOWNLOAD_INVALID');await verifyPlatform(executable,manifest);return {executable,manifest};
}
