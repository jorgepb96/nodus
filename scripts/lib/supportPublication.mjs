// Keep public names compatible with the validators already shipped in Nodus.
export function publicSupportArtifactName(name) {
  return name.replaceAll('_','-');
}

// A Node process launched by PowerShell 7 inherits its incompatible module paths.
// Let Windows PowerShell construct its own paths for Authenticode verification.
export function supportSignatureEnvironment(file,env=process.env) {
  return {...Object.fromEntries(Object.entries(env).filter(([key])=>key.toUpperCase()!=='PSMODULEPATH')),NODUS_SUPPORT_SIGNATURE_FILE:file};
}
