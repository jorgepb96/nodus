// Explicit, one-time repository setup. Never prints or passes private material in argv.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSupportKey} from './support-keygen.mjs';

const [keyId,folder]=process.argv.slice(2),repo='jorgepb96/nodus';
if(!keyId||!folder)throw new Error('Usage: node scripts/configure-support-signing.mjs <key-id> <private-folder-outside-git>');
const existing=JSON.parse(execFileSync('gh',['secret','list','--repo',repo,'--json','name'],{encoding:'utf8'}));
if(existing.some(secret=>['NODUS_SUPPORT_RELEASE_PRIVATE_KEY','NODUS_SUPPORT_RELEASE_KEY_ID'].includes(secret.name)))throw new Error('Manifest signing secrets already exist. This command never overwrites them.');
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),registry=path.join(root,'apps/nodus-support/trusted-release-keys.json');
const trusted=JSON.parse(fs.readFileSync(registry,'utf8'));
if(trusted.keys.some(key=>key.keyId===keyId))throw new Error('This public key ID is already registered.');
const key=createSupportKey(keyId,folder,root),publicEntry=JSON.parse(fs.readFileSync(key.publicFile,'utf8'));
trusted.keys.push(publicEntry);fs.writeFileSync(registry,JSON.stringify(trusted,null,2)+'\n');
execFileSync('gh',['secret','set','NODUS_SUPPORT_RELEASE_PRIVATE_KEY','--repo',repo],{input:fs.readFileSync(key.privateFile),stdio:['pipe','pipe','pipe']});
execFileSync('gh',['secret','set','NODUS_SUPPORT_RELEASE_KEY_ID','--repo',repo],{input:keyId,stdio:['pipe','pipe','pipe']});
console.log(JSON.stringify({...key,repository:repo,secretsConfigured:true},null,2));
