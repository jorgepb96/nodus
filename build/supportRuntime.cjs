/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Arch } = require('electron-builder');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
exports.prepareSupportRuntime = function(context) {
  execFileSync(process.execPath, [path.join(root, 'scripts/build-nodus-support.mjs'), '--runtime'], { cwd: root, stdio: 'inherit' });
  const platform = context.electronPlatformName;
  const arch = Arch[context.arch];
  const source = platform === 'darwin' ? path.join(root, 'release-support', `mac${arch === 'arm64' ? '-arm64' : ''}`, 'nodus-support.app') : path.join(root, 'release-support', platform === 'win32' ? 'win-unpacked' : 'linux-unpacked');
  if (!fs.existsSync(source)) throw new Error(`Missing independent Nodus Support runtime: ${source}`);
  return source;
};
exports.stageSupportRuntime = async function(context, resourcesPath) {
  const source = exports.prepareSupportRuntime(context);
  const target = path.join(resourcesPath, 'nodus-support', context.electronPlatformName === 'darwin' ? 'Nodus Support.app' : 'app');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, dereference: false, verbatimSymlinks: true });
  const hash=createHash('sha256');for await(const chunk of fs.createReadStream(path.join(resourcesPath,'app.asar')))hash.update(chunk);
  const metadata = { protocol: 1, version: require('../package.json').version, platform: context.electronPlatformName, arch: Arch[context.arch], archiveSha256:hash.digest('hex') };
  fs.writeFileSync(path.join(resourcesPath, 'nodus-support-protocol.json'), JSON.stringify(metadata));
};
