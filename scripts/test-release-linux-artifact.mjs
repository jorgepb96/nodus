import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  formats, formatAssets, createAppManifest, verifyAppManifest, packPreparedApp,
  restorePreparedApp, createFormatReport, collectFormats,
} from './release-linux-artifact.mjs';

const context = { commit: 'a'.repeat(40), lockHash: 'b'.repeat(64), version: '1.2.3', tag: 'v1.2.3',
  channel: 'latest', repository: 'jorgepb96/nodus', platform: 'linux', arch: 'x64' };
const temporary = action => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nodus-linux-release-'));
  try { return action(root); } finally { rmSync(root, { recursive: true, force: true }); }
};
function app(root) {
  const directory = path.join(root, 'release/linux-unpacked');
  mkdirSync(path.join(directory, 'resources'), { recursive: true });
  writeFileSync(path.join(directory, 'nodus'), 'native executable', { mode: 0o755 });
  writeFileSync(path.join(directory, 'resources/app.asar'), 'compiled application');
  symlinkSync('app.asar', path.join(directory, 'resources/relative-link'));
  return directory;
}
function reports(root, selected = context) {
  const source = path.join(root, 'formats'); mkdirSync(source);
  for (const format of formats) {
    for (const name of formatAssets(format, selected.channel)) writeFileSync(path.join(source, name),
      name.endsWith('-linux.yml') ? `version: ${selected.version}\npath: Nodus-x86_64.AppImage\n` :
        name.endsWith('.AppImage') ? 'identical canonical and legacy AppImage' : `installer ${name}`);
    writeFileSync(path.join(source, `${format}.json`), JSON.stringify(createFormatReport(source, selected, 'c'.repeat(64), format)));
  }
  return source;
}

test('real tar transfer preserves the executable, every byte and relative symlinks on isolated consumers', () => temporary(root => {
  const producer = path.join(root, 'producer'); app(producer);
  const manifest = packPreparedApp(producer, context);
  for (const format of formats) {
    const consumer = path.join(root, format);
    cpSync(path.join(producer, '.ci'), path.join(consumer, '.ci'), { recursive: true });
    assert.deepEqual(restorePreparedApp(consumer, context), manifest);
    verifyAppManifest(path.join(consumer, 'release/linux-unpacked'), manifest, context);
  }
}));

test('another commit, lockfile, platform, architecture or channel cannot reuse the app', () => temporary(root => {
  const directory = app(root), manifest = createAppManifest(directory, context);
  for (const key of ['commit', 'lockHash', 'version', 'tag', 'channel', 'repository', 'platform', 'arch']) {
    assert.throws(() => verifyAppManifest(directory, manifest, { ...context, [key]: 'different' }), /differs/);
  }
  assert.throws(() => createAppManifest(directory, { ...context, channel: 'beta' }));
}));

test('archive corruption, missing files, changed executable permissions and escaping links fail closed', () => temporary(root => {
  const directory = app(root), manifest = packPreparedApp(root, context);
  writeFileSync(path.join(root, '.ci/linux-release/linux-unpacked.tgz'), 'corrupt archive');
  assert.throws(() => restorePreparedApp(root, context), /hash mismatch/);
  chmodSync(path.join(directory, 'nodus'), 0o644);
  assert.throws(() => verifyAppManifest(directory, manifest, context), /executable/);
  chmodSync(path.join(directory, 'nodus'), 0o755);
  writeFileSync(path.join(directory, 'resources/app.asar'), 'changed bytes');
  assert.throws(() => verifyAppManifest(directory, manifest, context), /payload/);
  symlinkSync('../../../outside', path.join(directory, 'resources/escape'));
  assert.throws(() => createAppManifest(directory, context), /Unsafe app symlink/);
}));

test('only each installer format may add its normal updater and AppArmor metadata', () => temporary(root => {
  const directory = app(root), manifest = createAppManifest(directory, context);
  const resource = name => path.join(directory, 'resources', name);
  writeFileSync(resource('app-update.yml'), 'provider: github\nowner: jorgepb96\nrepo: nodus\nchannel: latest\n');
  verifyAppManifest(directory, manifest, context, 'AppImage');
  writeFileSync(resource('package-type'), 'deb'); writeFileSync(resource('apparmor-profile'), 'native profile');
  verifyAppManifest(directory, manifest, context, 'deb');
  assert.throws(() => verifyAppManifest(directory, manifest, context, 'rpm'), /update type/);
  assert.throws(() => verifyAppManifest(directory, manifest, context, 'AppImage'), /payload/);
  writeFileSync(resource('app-update.yml'), 'provider: github\nowner: jorgepb96\nrepo: nodus\nchannel: beta\n');
  assert.throws(() => verifyAppManifest(directory, manifest, context, 'deb'), /update feed/);
}));

test('all three complete reports collect the exact stable or beta assets and only the AppImage manifest', () => {
  for (const selected of [context, { ...context, version: '1.2.3-beta.1', tag: 'v1.2.3-beta.1', channel: 'beta' }]) temporary(root => {
    const source = reports(root, selected), destination = path.join(root, 'collected');
    assert.deepEqual(collectFormats(source, destination, selected, 'c'.repeat(64)), formats.flatMap(format => formatAssets(format, selected.channel)));
    assert.equal(readFileSync(path.join(destination, 'Nodus-linux-amd64.deb'), 'utf8'), 'installer Nodus-linux-amd64.deb');
  });
});

test('missing, duplicate, cross-build, mixed-channel, empty and corrupted format assets prevent upload', () => {
  for (const mutate of [
    source => rmSync(path.join(source, 'rpm.json')),
    source => writeFileSync(path.join(source, 'unexpected.yml'), 'extra manifest'),
    source => writeFileSync(path.join(source, 'Nodus-linux-amd64.deb'), 'changed installer'),
    source => writeFileSync(path.join(source, 'Nodus-linux-x86_64.rpm'), ''),
    source => {
      const file = path.join(source, 'deb.json'), report = JSON.parse(readFileSync(file));
      report.context.channel = 'beta'; writeFileSync(file, JSON.stringify(report));
    },
    source => {
      const file = path.join(source, 'rpm.json'), report = JSON.parse(readFileSync(file));
      report.archiveSha256 = 'd'.repeat(64); writeFileSync(file, JSON.stringify(report));
    },
    source => {
      const file = path.join(source, 'rpm.json'), report = JSON.parse(readFileSync(file));
      report.format = 'deb'; writeFileSync(file, JSON.stringify(report));
    },
  ]) temporary(root => {
    const source = reports(root); mutate(source);
    assert.throws(() => collectFormats(source, path.join(root, 'collected'), context, 'c'.repeat(64)));
  });
});
