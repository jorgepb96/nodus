const { execFileSync } = require('node:child_process');
const { mkdirSync, statSync, existsSync } = require('node:fs');
const path = require('node:path');

function buildTrackpadNative(architecture = process.arch) {
  if (process.platform !== 'darwin') return;
  const arch = { arm64: 'arm64', x64: 'x86_64' }[architecture];
  if (!arch) throw new Error(`Unsupported trackpad architecture: ${architecture}`);
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'build/trackpad-native/Trackpad.cc');
  const output = path.join(root, 'build/trackpad-native', architecture, 'nodus-trackpad.node');
  if (existsSync(output) && statSync(output).mtimeMs >= Math.max(statSync(source).mtimeMs, statSync(__filename).mtimeMs)) return output;
  mkdirSync(path.dirname(output), { recursive: true });
  const headers = path.join(path.dirname(require.resolve('node-api-headers/package.json')), 'include');
  execFileSync('xcrun', ['clang++', '-std=c++17', '-bundle', '-undefined', 'dynamic_lookup',
    '-arch', arch, '-mmacosx-version-min=11.0', '-DNAPI_VERSION=8', '-I', headers,
    '-framework', 'CoreFoundation', source, '-o', output], { stdio: 'inherit' });
  return output;
}
module.exports = { buildTrackpadNative };
if (require.main === module) buildTrackpadNative(process.argv[2] || process.arch);
