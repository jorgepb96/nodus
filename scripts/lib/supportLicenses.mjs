import fs from 'node:fs';
import path from 'node:path';

// Inventory the code actually bundled in Support, independent of Nodus engines.
export function bundleSupportLicenses(root,output,metafiles,{runtime=false}={}) {
  const packages=new Map(),legal=path.join(output,'legal');fs.mkdirSync(legal,{recursive:true});
  for(const meta of metafiles)for(const input of Object.keys(meta.inputs)) {
    if(!input.replaceAll('\\','/').includes('node_modules/'))continue;
    let folder=path.dirname(path.resolve(root,input));
    while(!fs.existsSync(path.join(folder,'package.json'))) {const parent=path.dirname(folder);if(parent===folder)throw new Error(`Missing package metadata for ${input}`);folder=parent;}
    const pkg=JSON.parse(fs.readFileSync(path.join(folder,'package.json'),'utf8')),id=`${pkg.name}@${pkg.version}`;
    if(packages.has(id))continue;
    const notices=fs.readdirSync(folder).filter(name=>/^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(name)&&fs.statSync(path.join(folder,name)).isFile()).sort();
    if(!notices.length)for(const name of fs.readdirSync(folder).filter(name=>/^readme(?:\.|$)/i.test(name))) {
      const text=fs.readFileSync(path.join(folder,name),'utf8');
      if(/Permission is hereby granted|Redistribution and use in source/i.test(text))notices.push(name);
    }
    if(!notices.length)throw new Error(`Missing bundled dependency license: ${id}`);
    packages.set(id,{license:pkg.license,source:typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url,notices:notices.map(name=>`${name}\n${fs.readFileSync(path.join(folder,name),'utf8')}`).join('\n\n')});
  }
  const entries=[...packages].sort(([a],[b])=>a.localeCompare(b));
  fs.writeFileSync(path.join(legal,'SUPPORT_DEPENDENCY_LICENSES.txt'),entries.map(([id,value])=>`${id}\nLicense: ${JSON.stringify(value.license)}\nSource: ${value.source??'See package-lock.json'}\n\n${value.notices}`).join('\n\n========================================\n\n'));
  for(const name of ['LICENSE','PRIVACY.md','SOURCE_CODE.md','THIRD_PARTY_NOTICES.md'])fs.copyFileSync(path.join(root,name),path.join(legal,name));
  if(runtime)for(const [source,target]of [['node_modules/electron/LICENSE','ELECTRON_LICENSE.txt'],['node_modules/electron/dist/LICENSES.chromium.html','ELECTRON_CHROMIUM_LICENSES.html']])fs.copyFileSync(path.join(root,source),path.join(legal,target));
  return entries.map(([id])=>id);
}
