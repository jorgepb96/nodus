// electron-builder 26 notarizes and staples inside MacPackager.sign(), before
// emitting afterSign. A failure here therefore aborts artifact creation.
const path = require('node:path');
const { verifyMacApp } = require('../scripts/verify-macos-code-signing.cjs');
const { packedLayout, verifyPackagedNodeModules } = require('../scripts/verify-packaged-node-modules.cjs');

module.exports = async function verifySignedMacApplication(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const result = verifyMacApp(appPath, { verifyEveryComponent: true });
  console.log(
    `[afterSign] Verified Developer ID, Hardened Runtime, notarization and ${result.componentCount} enclosed code components`,
  );
  // The pruned node_modules was checked for presence in afterPack; only now can the
  // signed app run to prove that each runtime package also loads.
  verifyPackagedNodeModules(packedLayout(context.appOutDir, 'darwin', appName));
};
