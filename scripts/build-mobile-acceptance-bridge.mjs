import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sourceRevision} from './lib/sourceRevision.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=path.join(root,'node_modules/.cache/nodus-mobile-acceptance');fs.mkdirSync(folder,{recursive:true});
const bundle=path.join(folder,'lab-bridge.cjs'),metadata=path.join(folder,'lab-bridge.build.json');
const before=sourceRevision(root);
// Launch a real application package so Electron reports the Desktop source
// version, rather than its own runtime version when executing a loose script.
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
fs.writeFileSync(path.join(folder,'package.json'),JSON.stringify({name:'nodus-mobile-acceptance',productName:'Nodus',version,main:'lab-bridge.cjs'})+'\n');
execFileSync(path.join(root,'node_modules/esbuild/bin/esbuild'),[path.join(root,'scripts/mobile-acceptance-bridge.ts'),
  '--bundle','--platform=node','--format=cjs','--packages=external','--tsconfig='+path.join(root,'electron/tsconfig.json'),
  '--define:import.meta.url='+JSON.stringify(pathToFileURL(path.join(root,'electron/export/academicExport.ts')).href),'--outfile='+bundle],{cwd:root,stdio:'inherit'});
if(sourceRevision(root).sourceDigest!==before.sourceDigest)throw new Error('Desktop sources changed during the acceptance build.');
fs.writeFileSync(metadata,JSON.stringify({...before,desktopVersion:version,builtAt:new Date().toISOString(),bundleSha256:createHash('sha256').update(fs.readFileSync(bundle)).digest('hex')},null,2)+'\n');
console.log(JSON.stringify({built:true,...before}));
