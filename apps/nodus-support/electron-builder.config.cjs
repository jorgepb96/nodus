const path = require('node:path');
require('../../build/supportNsis.cjs').installSupportNsisTemplates();
const root = path.resolve(__dirname, '../..');
const release = process.env.NODUS_SUPPORT_RELEASE === '1' || process.env.NODUS_REQUIRE_MACOS_SIGNING === 'true';
module.exports = {
  appId: 'app.nodus.support', productName: 'Nodus Support', executableName: 'nodus-support',
  directories: { app: path.join(root, 'build/support-app'), output: path.join(root, 'release-support') },
  electronVersion: require(path.join(root, 'node_modules/electron/package.json')).version,
  files: ['main.mjs','preload.cjs','package.json','icon.png','ui/**/*','!node_modules/**/*'], npmRebuild: false, icon: path.join(__dirname, 'assets/icon.png'),
  extraResources: [{from:path.join(root,'build/support-app/legal'),to:'legal'},{from:path.join(__dirname,'assets/icon.png'),to:'support-icon.png'}],
  artifactName: 'Nodus-Support-${os}-${arch}.${ext}', publish: null,
  mac: { target: ['dmg','zip'], icon: path.join(__dirname, 'assets/icon.icns'), category: 'public.app-category.utilities', hardenedRuntime: true, forceCodeSigning: release, ...(release ? { notarize: true, sign:path.join(root,'build/supportMacSign.cjs'), entitlements: path.join(root, 'build/entitlements.mac.plist'), entitlementsInherit: path.join(root, 'build/entitlements.mac.inherit.plist') } : { identity: null }) },
  win: { target: ['nsis', { target: 'portable', arch: ['x64'] }], icon: path.join(__dirname, 'assets/icon.ico') },
  portable: { artifactName: 'Nodus-Support-win-${arch}-portable.exe' },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false },
  linux: { target: ['AppImage','deb','rpm'], category: 'Utility', maintainer: 'Jorge Pérez Burgueño <jorgepb96@users.noreply.github.com>' },
  appImage: { artifactName: 'Nodus-Support-${arch}.${ext}' },
};
