import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {copyInventory,inventory,noLinks,readJson,separate,sufficientSpace,verifyInventory,writeRecord} from './files.mjs';

export async function retainSupportRuntime(source,storage,{copy=copyInventory}={}) {
  noLinks(source);noLinks(storage);separate(source,storage);
  const manifest=await inventory(source,undefined,undefined,{links:true});
  const digest=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  await fsp.mkdir(storage,{recursive:true,mode:0o700});
  for(const name of fs.readdirSync(storage)) {
    const marker=path.join(storage,name,'runtime.json');if(!fs.existsSync(marker))continue;
    try {
      const value=readJson(marker);if(value.digest!==digest)continue;
      const runtime=path.join(storage,name,path.basename(source));
      await verifyInventory(runtime,manifest);return runtime;
    }catch{/* Keep damaged or interrupted copies; prepare a new one below. */}
  }
  await sufficientSpace(storage,manifest.bytes);
  const folder=path.join(storage,randomUUID()),runtime=path.join(folder,path.basename(source));
  await fsp.mkdir(folder,{mode:0o700});await copy(source,runtime,manifest);await verifyInventory(runtime,manifest);
  await writeRecord(path.join(folder,'runtime.json'),{format:'nodus.support-runtime/1',digest,inventory:manifest});return runtime;
}
