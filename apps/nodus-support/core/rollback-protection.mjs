import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifyInventory } from './files.mjs';
import { preserveInstallation } from './releases.mjs';

export async function protectInstallationRollback(service,session) {
  // Do not install older code over data that the new app may have migrated.
  for(const source of await service.protectedSources(session))await verifyInventory(source.original,source.inventory);
  // A system installer can overwrite files added since the attempted repair.
  // Preserve that complete current installation as well as the initial one.
  const folder=path.join(session.folder,'installation-rollback',randomUUID());
  await service.event(session.id,{installationRollbackPrepared:folder});
  await fs.mkdir(folder,{recursive:true,mode:0o700});
  const previous=await preserveInstallation(session.installationOriginal,folder);
  await service.event(session.id,{installationRollbackRetained:previous});
  return previous;
}
