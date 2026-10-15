import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import plist from 'plist';
import AdmZip from 'adm-zip';
import { machOEntries, unnotarizablePayload } from './notarization-payload.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

function releaseConfig(channel = 'latest') {
  const configPath = require.resolve(path.join(repoRoot, 'build/electron-builder.release.cjs'));
  const previous = process.env.NODUS_RELEASE_CHANNEL;
  process.env.NODUS_RELEASE_CHANNEL = channel;
  delete require.cache[configPath];
  const config = require(configPath);
  if (previous === undefined) delete process.env.NODUS_RELEASE_CHANNEL;
  else process.env.NODUS_RELEASE_CHANNEL = previous;
  delete require.cache[configPath];
  return config;
}

test('release-only macOS config is fail-closed and notarizes with explicit hardening', () => {
  for (const channel of ['latest', 'beta']) {
    const config = releaseConfig(channel);
    assert.equal(config.mac.forceCodeSigning, true);
    assert.equal(config.mac.hardenedRuntime, true);
    assert.equal(config.mac.strictVerify, true);
    assert.equal(config.mac.preAutoEntitlements, false);
    assert.equal(config.mac.notarize, true);
    assert.equal(config.mac.sign, 'build/macSign.cjs');
    assert.equal(config.mac.entitlements, 'build/entitlements.mac.plist');
    assert.equal(config.mac.entitlementsInherit, 'build/entitlements.mac.inherit.plist');
    assert.equal(config.afterSign, 'build/afterSign.cjs');
  }

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.build.mac.forceCodeSigning, undefined, 'local/dev packaging remains usable without release credentials');
  assert.equal(pkg.build.mac.notarize, undefined, 'notarization is mandatory only in the release configuration');
});

test('macOS entitlements are an exact minimum set with no dangerous exceptions', () => {
  const root = plist.parse(read('build/entitlements.mac.plist'));
  const inherited = plist.parse(read('build/entitlements.mac.inherit.plist'));
  const empty = plist.parse(read('build/entitlements.mac.empty.plist'));

  assert.deepEqual(Object.keys(root).sort(), [
    'com.apple.security.automation.apple-events',
    'com.apple.security.cs.allow-jit',
    'com.apple.security.device.audio-input',
    'com.apple.security.device.camera',
    'com.apple.security.personal-information.calendars',
  ]);
  assert.ok(Object.values(root).every((value) => value === true));
  assert.deepEqual(inherited, { 'com.apple.security.cs.allow-jit': true });
  assert.deepEqual(empty, {});

  const allKeys = [...Object.keys(root), ...Object.keys(inherited), ...Object.keys(empty)];
  for (const forbidden of [
    'com.apple.security.app-sandbox',
    'com.apple.security.cs.allow-unsigned-executable-memory',
    'com.apple.security.cs.disable-library-validation',
    'com.apple.security.get-task-allow',
  ]) {
    assert.equal(allKeys.includes(forbidden), false, `${forbidden} must not enter release entitlements`);
  }

  const info = JSON.parse(read('package.json')).build.mac.extendInfo;
  // Every privacy-scoped entitlement above needs its own user-facing explanation.
  for (const key of [
    'NSAppleEventsUsageDescription',
    'NSCalendarsFullAccessUsageDescription',
    'NSCalendarsUsageDescription',
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
  ]) {
    assert.equal(typeof info[key], 'string');
    assert.ok(info[key].trim().length > 0, `${key} has a user-facing explanation`);
  }
});

test('the release verifier allows exactly the entitlements the app is signed with', () => {
  // The plist decides what the app carries and the verifier decides what the release
  // accepts, and only the release build signs a real app. Without this comparison a
  // privacy-scoped entitlement added to the plist fails the release hours later, in
  // the macOS signing job, instead of here.
  const verifier = require(path.join(repoRoot, 'scripts/verify-macos-code-signing.cjs'));
  const root = plist.parse(read('build/entitlements.mac.plist'));
  const inherited = plist.parse(read('build/entitlements.mac.inherit.plist'));

  assert.deepEqual([...verifier.ROOT_ENTITLEMENTS].sort(), Object.keys(root).sort(),
    'the release verifier must allow exactly the entitlements in entitlements.mac.plist');
  assert.deepEqual([...verifier.CHILD_ENTITLEMENTS].sort(), Object.keys(inherited).sort(),
    'the release verifier must allow exactly the entitlements in entitlements.mac.inherit.plist');
});

test('the custom signer covers the DockTile and every enclosed native code bundle', () => {
  const signer = read('build/macSign.cjs');
  assert.match(signer, /NodusDockTile\.docktileplugin/);
  assert.match(signer, /NodusDockTilePlugin/);
  assert.match(signer, /additionalBundleExtensions/);
  assert.match(signer, /signAsync/);
  assert.match(signer, /entitlements\.mac\.empty\.plist/);
  assert.match(signer, /isElectronHelperRuntime/);
  assert.match(signer, /security.*find-identity/s);
  assert.match(signer, /identity: signingIdentity/);
  assert.doesNotMatch(signer, /optionsForFile:\s*async/, 'osx-sign silently ignores async per-file options');
  assert.doesNotMatch(signer, /--deep/);

  const afterPack = read('build/afterPack.cjs');
  assert.match(afterPack, /NODUS_REQUIRE_MACOS_SIGNING === 'true'/);
  assert.match(afterPack, /Deferred .* mandatory Developer ID signer/);
});

test('the custom signer resolves electron-builder certificate hashes to full Developer ID names', () => {
  const signer = require(path.join(repoRoot, 'build/macSign.cjs'));
  const identities = signer.parseDeveloperIdIdentities([
    '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Release Owner (TEAMID1234)"',
    '  2) ABCDEF0123456789ABCDEF0123456789ABCDEF01 "Apple Development: Local Developer (TEAMID1234)"',
    '     2 valid identities found',
  ].join('\n'));

  assert.deepEqual(identities, [{
    hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    name: 'Developer ID Application: Release Owner (TEAMID1234)',
  }]);
});

test('GitHub release workflow requires API-key notarization and verifies before upload', () => {
  const workflow = read('.github/workflows/release-build.yml');
  for (const secret of [
    'MACOS_CERTIFICATE_BASE64',
    'MACOS_CERTIFICATE_PASSWORD',
    'APPLE_API_KEY_BASE64',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`), `${secret} is read from GitHub Actions Secrets`);
  }
  for (const obsolete of ['HAS_MACOS_SIGNING', 'APPLE_ID:', 'APPLE_APP_SPECIFIC_PASSWORD:', 'Build ad-hoc macOS installer']) {
    assert.doesNotMatch(workflow, new RegExp(obsolete), `${obsolete} must not remain in the release path`);
  }
  assert.match(workflow, /RUNNER_TEMP\/nodus-signing-certificate\.p12/);
  assert.match(workflow, /RUNNER_TEMP\/nodus-notary-api-key\.p8/);
  assert.match(workflow, /security create-keychain/);
  assert.match(workflow, /security set-key-partition-list/);
  assert.match(workflow, /security list-keychains -d user -s/);
  assert.match(workflow, /nodus-codesign-probe/);
  assert.match(workflow, /codesign --verify --strict "\$signing_probe"/);
  assert.match(workflow, /security delete-keychain/);
  assert.match(workflow, /rm -f "\$certificate_path" "\$api_key_path" "\$keychain_path"/);
  assert.match(workflow, /NODUS_REQUIRE_MACOS_SIGNING: true/);
  assert.match(workflow, /verify-macos-release\.cjs release/);

  const build = workflow.indexOf('Build, sign and notarize macOS artifacts');
  const verify = workflow.indexOf('Verify signed and notarized macOS release artifacts');
  const cleanup = workflow.indexOf('Remove temporary macOS credentials');
  const upload = workflow.indexOf('Upload platform assets to the single draft');
  assert.ok(build >= 0 && build < verify && verify < cleanup && cleanup < upload);
});

test('official verification gates cover signing, Hardened Runtime, stapling and Gatekeeper', () => {
  const verifier = read('scripts/verify-macos-code-signing.cjs');
  const artifacts = read('scripts/verify-macos-release.cjs');
  for (const required of [
    /codesign/,
    /--verify/,
    /--deep/,
    /--strict/,
    /Developer ID Application:/,
    /TeamIdentifier/,
    /runtime/,
    /Timestamp/,
    /stapler/,
    /spctl/,
  ]) assert.match(verifier, required);
  assert.match(artifacts, /ditto/);
  assert.match(artifacts, /hdiutil/);
  assert.match(artifacts, /assertSameApp/);
});

// v5.9.0's Intel build was notarized and then lost the connection to Apple's
// ticket service three times running; each loss failed the whole build.
test('stapler validate retries a lost network, never a missing ticket', () => {
  const { validateStapledTicket } = require('./verify-macos-code-signing.cjs');
  const lost = { status: 68, stdout: 'Processing: Nodus.app\n', stderr: 'error is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."\nThe validate action failed! Error 68.' };
  const valid = { status: 0, stdout: 'The validate action worked!\n', stderr: '' };
  const missing = { status: 65, stdout: 'Nodus.app does not have a ticket stapled to it.\n', stderr: '' };
  const harness = (answers) => {
    const waits = [];
    let calls = 0;
    const attempt = () => validateStapledTicket('/tmp/Nodus.app', {
      validate: () => { calls += 1; return answers.shift(); },
      wait: (milliseconds) => waits.push(milliseconds),
    });
    return { attempt, calls: () => calls, waits };
  };

  const recovers = harness([lost, lost, valid]);
  assert.match(recovers.attempt(), /validate action worked/);
  assert.equal(recovers.calls(), 3);
  assert.deepEqual(recovers.waits, [15_000, 30_000]);

  const absent = harness([missing, valid]);
  assert.throws(absent.attempt, /does not have a ticket stapled/);
  assert.equal(absent.calls(), 1, 'a missing ticket is never retried');

  const offline = harness(Array.from({ length: 6 }, () => lost));
  assert.throws(offline.attempt, /network connection was lost/);
  assert.equal(offline.calls(), 6, 'a lasting outage still fails the build');
});

// v5.9.0's first Apple silicon build passed every signing check and then died
// cleaning up: the plain detach reported failure while the volume was already
// going away, and the -force retry found nothing to detach.
test('detaching the verified DMG trusts the mount table, not hdiutil exit codes', () => {
  const { detachDiskImage } = require('./verify-macos-release.cjs');
  const harness = (outcomes) => {
    const calls = [];
    let mounted = true;
    const result = detachDiskImage('/tmp/dmg', {
      detach: (args) => {
        calls.push(args.join(' '));
        const outcome = outcomes.shift();
        if (outcome.unmounts) mounted = false;
        if (outcome.throws) throw new Error(outcome.throws);
      },
      mounted: () => mounted,
      wait: () => {},
    });
    return { result, calls };
  };

  const v590 = harness([{ throws: 'hdiutil: couldn\'t unmount "disk4" - Resource busy', unmounts: true }]);
  assert.equal(v590.result.detached, true, 'a detach that failed but unmounted the volume is a success');
  assert.deepEqual(v590.calls, ['detach /tmp/dmg'], 'there is no -force retry against a volume that is gone');

  const busy = harness([{ throws: 'busy' }, { throws: 'busy' }, { unmounts: true }]);
  assert.equal(busy.result.detached, true);
  assert.deepEqual(busy.calls, ['detach /tmp/dmg', 'detach /tmp/dmg', 'detach -force /tmp/dmg']);

  const stuck = harness(Array.from({ length: 5 }, () => ({ throws: 'busy' })));
  assert.equal(stuck.result.detached, false, 'a volume that never goes away is reported, not hidden');
  assert.equal(stuck.calls.length, 5);
  assert.equal(stuck.result.errors.length, 5);

  const source = read('scripts/verify-macos-release.cjs');
  assert.match(source, /if \(verificationError\) throw verificationError;/, 'cleanup never replaces the verification verdict');
});

// The notary service opens archives it finds inside a submitted application and refuses
// the whole thing over unsigned code in them. v5.4.0's first attempt died exactly there:
// fifteen `.bare` prebuilds vendored into a bundled capability package, for macOS and iOS
// platforms the package never runs on. Nothing in this repository can sign them — the
// bytes are pinned by digest against a manifest the publisher signed — so the check that
// keeps a release building is the one that refuses to bundle them.
const zipOf = (files) => {
  const zip = new AdmZip();
  for (const [name, bytes] of Object.entries(files)) zip.addFile(name, bytes);
  return zip.toBuffer();
};
const machO = (magic) => Buffer.concat([Buffer.from(magic), Buffer.alloc(64)]);

test('a capability package carrying unsigned Mach-O is withheld from the macOS build only', () => {
  const packageWithPrebuilds = zipOf({
    'plugin.json': Buffer.from('{"id":"chemistry-studio"}'),
    'vendor/node_modules/bare-fs/prebuilds/darwin-arm64/bare-fs.bare': machO([0xcf, 0xfa, 0xed, 0xfe]),
    'vendor/node_modules/bare-url/prebuilds/ios-arm64/bare-url.bare': machO([0xca, 0xfe, 0xba, 0xbe]),
  });

  assert.deepEqual(machOEntries(packageWithPrebuilds), [
    'vendor/node_modules/bare-fs/prebuilds/darwin-arm64/bare-fs.bare',
    'vendor/node_modules/bare-url/prebuilds/ios-arm64/bare-url.bare',
  ], 'thin and universal binaries both fail notarization, in either byte order');

  assert.equal(unnotarizablePayload(packageWithPrebuilds, 'darwin').length, 2);
  for (const platform of ['win32', 'linux']) {
    assert.deepEqual(unnotarizablePayload(packageWithPrebuilds, platform), [],
      'only macOS is notarized, so only macOS gives up its bundled copy');
  }

  const ordinaryPackage = zipOf({
    'plugin.json': Buffer.from('{"id":"legalize"}'),
    'skills/legalize/skill.json': Buffer.from('{}'),
    'vendor/Main.class': Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x41]),
  });
  assert.deepEqual(unnotarizablePayload(ordinaryPackage, 'darwin'), [],
    'a Java class file shares the universal-binary magic and is not code the notary judges');
});

test('the capability bootstrap refuses to bundle what macOS cannot notarize', () => {
  const prepare = read('scripts/prepare-capability-bootstrap.mjs');
  assert.match(prepare, /unnotarizablePayload\(archive\)/, 'every bundled archive is inspected before it is written');
  assert.match(prepare, /written \+ withheld\.length !== pinned\.packages\.length/,
    'a package missing for any other reason still fails a required build');
  assert.match(prepare, /Withheld \$\{entry\.id\}/, 'a withheld package is named in the build log');
});
