// Local packaging uses the identity selected by electron-builder. Release builds
// retain their dedicated keychain/identity checks in macSign.cjs.
const path = require('node:path');
const { signAsync } = require('@electron/osx-sign');
const { signingIgnore, additionalSigningTargets } = require('./macSigningFiles.cjs');
module.exports = async function signLocalMacApplication(options) {
  const plugins = path.join(options.app, 'Contents', 'PlugIns') + path.sep;
  await signAsync({
    ...options,
    binaries: [...new Set([...(options.binaries ?? []), ...additionalSigningTargets(options.app)])],
    ignore: filePath => signingIgnore(filePath, filePath.startsWith(plugins) ? undefined : options.ignore),
  });
};
