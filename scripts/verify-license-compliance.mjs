import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedRoot = path.join(root, 'legal', 'generated');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const text = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const packageJson = json('package.json');
const sourceManifest = json('legal/remote-notices.json');
const buildManifest = json('legal/generated/LEGAL_MANIFEST.json');

assert.equal(buildManifest.schemaVersion, 1);
assert.equal(buildManifest.nodusVersion, packageJson.version);
assert.equal(packageJson.license, 'AGPL-3.0-only');
assert.equal(
  sha256(fs.readFileSync(path.join(root, 'LICENSE'))),
  '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0',
  'the Nodus license text must be the unmodified GNU AGPL v3 text',
);
assert.equal(text('server/LICENSE'), text('LICENSE'), 'server distribution has a stale project license');
assert.equal(text('server/SOURCE_CODE.md'), text('SOURCE_CODE.md'), 'server distribution has a stale source offer');
assert.ok(buildManifest.packageInventory.packages > 500, 'production package inventory is unexpectedly small');

for (const expected of sourceManifest.files) {
  const actual = buildManifest.remoteFiles.find((entry) => entry.destination === expected.destination);
  assert.ok(actual, `generated manifest is missing ${expected.destination}`);
  assert.equal(actual.source, expected.url, `${expected.destination} source changed`);
  assert.equal(actual.sha256, expected.sha256, `${expected.destination} manifest digest changed`);
  const bytes = fs.readFileSync(path.join(generatedRoot, expected.destination));
  assert.equal(sha256(bytes), expected.sha256, `${expected.destination} bytes failed verification`);
}

const packageLicenses = fs.readFileSync(
  path.join(generatedRoot, buildManifest.packageInventory.file),
  'utf8',
);
assert.equal(sha256(packageLicenses), buildManifest.packageInventory.sha256);
for (const requiredPackage of [
  '@blocknote/core@0.55.0',
  '@blocknote/react@0.55.0',
  '@blocknote/ariakit@0.55.0',
  '@diffusionstudio/vits-web@1.0.3',
  '@github/copilot-sdk@1.0.7',
  '@openai/codex@0.144.6',
  'foundry-local-sdk@1.2.3',
  'heic-decode@2.1.0',
  'libheif-js@1.19.8',
  'onnxruntime-node@1.21.0',
  `sharp@${json('package-lock.json').packages['node_modules/sharp'].version}`,
  // Development dependencies of the desktop that ship anyway, in the bundled server's node_modules.
  `esbuild@${json('package-lock.json').packages['node_modules/esbuild'].version}`,
  `playwright-core@${json('package-lock.json').packages['node_modules/playwright-core'].version}`,
]) {
  assert.match(packageLicenses, new RegExp(`Package: ${requiredPackage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
}

for (const electronFile of ['ELECTRON_LICENSE.txt', 'ELECTRON_CHROMIUM_LICENSES.html']) {
  const actual = buildManifest.electronFiles.find((entry) => entry.destination === electronFile);
  assert.ok(actual, `generated manifest is missing ${electronFile}`);
  assert.equal(sha256(fs.readFileSync(path.join(generatedRoot, electronFile))), actual.sha256);
}

const configuredResources = packageJson.build.extraResources.map((entry) => `${entry.from}:${entry.to}`);
assert.ok(configuredResources.includes('LICENSE:legal/NODUS_LICENSE.txt'));
assert.ok(configuredResources.includes('SOURCE_CODE.md:legal/SOURCE_CODE.md'));
assert.ok(configuredResources.includes('THIRD_PARTY_NOTICES.md:legal/THIRD_PARTY_NOTICES.md'));
assert.ok(configuredResources.includes('legal:legal'));

for (const pattern of [
  'node_modules/libheif-js/**/*',
  'node_modules/@img/sharp-libvips-*/**/*',
]) {
  assert.ok(packageJson.build.asarUnpack.includes(pattern), `asarUnpack is missing ${pattern}`);
}

const notices = text('THIRD_PARTY_NOTICES.md');
for (const marker of ['GeoNames', 'CC BY 4.0', 'ONNX Runtime', 'libheif-js', 'sharp-libvips', 'IDprotector', 'Citation Style Language', 'CC BY-SA 3.0', 'citeproc-js']) {
  assert.match(notices, new RegExp(marker));
}

console.log(
  `[licenses] verified ${buildManifest.packageInventory.packages} packages, ` +
  `${sourceManifest.files.length} pinned upstream files and Electron/Chromium notices`,
);
