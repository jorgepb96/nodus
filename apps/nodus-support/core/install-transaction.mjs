import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { assert,noLinks,separate,verifyInventory } from './files.mjs';

// Both versions must be fully staged on the destination filesystem before switching.
// Every rename has a durable pre-record; recovery never discards an unexpected version.
export async function activateInstallation(transaction,record,{transition=()=>{},rename=fsp.rename}={}) {
  const {original,staged,retained,previousInventory,candidateInventory}=transaction;
  for(const file of [original,staged,retained])noLinks(file);
  separate(original,staged);separate(original,retained);separate(staged,retained);
  assert(!fs.existsSync(retained),'DESTINATION_EXISTS');
  await verifyInventory(original,previousInventory);await verifyInventory(staged,candidateInventory);
  await record({...transaction,phase:'prepared'});await transition('prepared');
  await record({...transaction,phase:'retaining-original'});await rename(original,retained);await transition('original-retained');
  await record({...transaction,phase:'activating-candidate'});await rename(staged,original);await transition('candidate-active');
  await verifyInventory(original,candidateInventory);await record({...transaction,phase:'complete'});await transition('complete');
}
export async function recoverInstallation(transaction,record) {
  const {original,retained,previousInventory,candidateInventory}=transaction;
  for(const file of [original,retained])noLinks(file);
  if(fs.existsSync(original)) {
    try{await verifyInventory(original,candidateInventory);return 'awaiting-user';}catch{/* Try the unchanged previous installation next. */}
    try{await verifyInventory(original,previousInventory);return 'reverted';}catch{return 'conflict';}
  }
  assert(fs.existsSync(retained),'INSTALLATION_RECOVERY_REQUIRED');
  await verifyInventory(retained,previousInventory);
  await record({...transaction,phase:'restoring-original'});await fsp.rename(retained,original);
  await verifyInventory(original,previousInventory);await record({...transaction,phase:'recovered'});return 'reverted';
}
