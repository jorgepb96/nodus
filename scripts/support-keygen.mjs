// Creates a free manifest-signing key. App code-signing certificates are unrelated.
// Private output is deliberately outside every Git checkout and never printed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, createPublicKey, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export function createSupportKey(keyId, folder, repository) {
  if (!/^[a-z0-9][a-z0-9-]{3,47}$/.test(keyId)) throw new Error('Use a key ID with 4–48 lowercase letters, digits or hyphens.');
  const output=path.resolve(folder),root=fs.realpathSync(repository);
  fs.mkdirSync(output,{recursive:true,mode:0o700});
  const canonical=fs.realpathSync(output),relative=path.relative(root,canonical);
  if (!relative || !relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('Private key output must be outside the repository.');
  try { execFileSync('git',['-C',canonical,'rev-parse','--show-toplevel'],{stdio:'pipe'}); throw new Error('Private key output must not be inside any Git repository.'); }
  catch(error) { if (!error.status) throw error; }
  if(process.platform==='win32') {
    execFileSync('icacls.exe',[canonical,'/inheritance:r','/grant:r',`${os.userInfo().username}:(OI)(CI)F`],{stdio:'pipe',windowsHide:true});
  }
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const publicKeyPem=publicKey.export({type:'spki',format:'pem'}).toString();
  const privateFile=path.join(canonical,`${keyId}.private.pem`),publicFile=path.join(canonical,`${keyId}.public.json`);
  fs.writeFileSync(privateFile,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
  fs.writeFileSync(publicFile,JSON.stringify({keyId,publicKeyPem},null,2)+'\n',{flag:'wx',mode:0o600});
  const fingerprint=createHash('sha256').update(createPublicKey(publicKeyPem).export({type:'spki',format:'der'})).digest('hex');
  return {keyId,privateFile,publicFile,fingerprint};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [keyId,folder]=process.argv.slice(2);
  if(!keyId||!folder)throw new Error('Usage: npm run support:keygen -- <key-id> <private-folder-outside-git>');
  const result=createSupportKey(keyId,folder,path.resolve(fileURLToPath(new URL('..',import.meta.url))));
  console.log(JSON.stringify(result,null,2));
  console.log('Add only the public JSON entry to apps/nodus-support/trusted-release-keys.json.');
  console.log('Store the private PEM in NODUS_SUPPORT_RELEASE_PRIVATE_KEY and its ID in NODUS_SUPPORT_RELEASE_KEY_ID in the release environment. Keep a private recovery copy.');
}
