import path from 'node:path';
import { resolvePolicy } from './policies.mjs';

// A resumed session may inspect an old source. It must not replace the saved
// installation/profile selection used by the next troubleshooting session.
export function rememberSelection(service) {
  service.selectedProfile=service.profile;
  service.selectedExecutable=service.executable;
  service.selectedVersionHint=service.versionHint;
}
export function selectCurrentProfile(service,policies) {
  const source=service.selectedProfile??service.originProfile??service.profile;
  service.selectedProfile=source;
  service.profile=source;service.originProfile=null;service.selectionError=service.choicesError===true;
  if(Object.hasOwn(service,'selectedExecutable'))service.executable=service.selectedExecutable;
  if(Object.hasOwn(service,'selectedVersionHint'))service.versionHint=service.selectedVersionHint;
  try {
    const current=resolvePolicy(policies,source);
    if(current?.recoveredRoot){service.profile=path.join(current.recoveredRoot,'profile');service.originProfile=source;}
  }catch{service.selectionError=true;}
}
