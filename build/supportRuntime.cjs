/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('electron-builder');
const { createHash } = require('node:crypto');
exports.stageSupportRuntime = async function(context, resourcesPath) {
  // Keep the lightweight diagnostic protocol; Support's own runtime is downloaded on demand.
  const hash=createHash('sha256');for await(const chunk of fs.createReadStream(path.join(resourcesPath,'app.asar')))hash.update(chunk);
  const {supportSourceDigest}=await import('../scripts/lib/supportEvidence.mjs');
  const metadata = { protocol: 1, trialReadyProtocol: 1,supportSourceSha256:supportSourceDigest(path.resolve(__dirname,'..')), version: require('../package.json').version, platform: context.electronPlatformName, arch: Arch[context.arch], archiveSha256:hash.digest('hex') };
  if(context.electronPlatformName==='win32'&&!context.packager?.config?.nsis?.script&&require('./supportNsis.cjs').hasInstalledSupportNsisContract())metadata.windowsRepairProtocol=1;
  fs.writeFileSync(path.join(resourcesPath, 'nodus-support-protocol.json'), JSON.stringify(metadata));
};
