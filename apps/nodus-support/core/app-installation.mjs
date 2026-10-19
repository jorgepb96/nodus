// Managed independent installations never replace Nodus, an older Support, or user data.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import yauzl from 'yauzl';
import {verifySupportApp,supportContentDigest} from '../../../shared/support/appDistribution.mjs';
import {assert,inventory,noLinks,sufficientSpace,verifyInventory,writeRecord,readJson} from './files.mjs';
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
