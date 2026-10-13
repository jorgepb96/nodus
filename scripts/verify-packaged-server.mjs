// Check that the Nodus Server inside a built app can actually run.
//
//   node scripts/verify-packaged-server.mjs release/mac-arm64/Nodus.app
//   node scripts/verify-packaged-server.mjs /Applications/Nodus.app
//   node scripts/verify-packaged-server.mjs release/win-unpacked      (or linux-unpacked)
//
// The same check afterPack runs before any installer is made, pointed at an app that already
// exists: an installed release, or a build to compare against. It changes nothing inside the
// app. The app's executable runs as Node (as basic mode runs it), with a scratch data directory
// in the system temporary folder and no access to any Nodus profile.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { verifyPackagedServerRuntime } = require('./packaged-server-runtime.cjs');

function locate(target) {
  if (target.endsWith('.app')) {
    const plist = fs.readFileSync(path.join(target, 'Contents', 'Info.plist'), 'utf8');
    const name = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
    if (!name) throw new Error(`${target} has no CFBundleExecutable`);
    return { executable: path.join(target, 'Contents', 'MacOS', name), resourcesPath: path.join(target, 'Contents', 'Resources') };
  }
  // win-unpacked and linux-unpacked keep the executable beside resources/.
  const executable = ['Nodus.exe', 'nodus', 'Nodus'].map((name) => path.join(target, name)).find((file) => fs.existsSync(file));
  if (!executable) throw new Error(`No Nodus executable in ${target}`);
  return { executable, resourcesPath: path.join(target, 'resources') };
}

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/verify-packaged-server.mjs <Nodus.app | win-unpacked | linux-unpacked>');
  process.exit(2);
}
const { executable, resourcesPath } = locate(path.resolve(target));
try {
  const { passed } = await verifyPackagedServerRuntime({ executable, resourcesPath });
  for (const line of passed) console.log(`  ✓ ${line}`);
  console.log(`[packaged-server] ${target}: the bundled server runs.`);
} catch (error) {
  console.error(`[packaged-server] ${target}: ${error.message}`);
  process.exit(1);
}
