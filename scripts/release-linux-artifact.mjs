// Prepare Linux once, then repackage the verified payload on isolated runners.
// Installer-specific updater/AppArmor metadata is the only permitted mutation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { validateReleaseChannel } from './verify-release-channel.mjs';
import { verifyAppImage, APPIMAGE_NAME, LEGACY_APPIMAGE_NAME } from './finalize-linux-appimage.mjs';

export const formats = ['deb', 'rpm', 'AppImage'];
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const appAt = root => path.join(root, 'release/linux-unpacked');
const bundleAt = root => path.join(root, '.ci/linux-release');

export function formatAssets(format, channel) {
  assert.ok(formats.includes(format), 'Unknown Linux format');
  assert.ok(['latest', 'beta'].includes(channel), 'Unknown release channel');
  return format === 'deb' ? ['Nodus-linux-amd64.deb'] : format === 'rpm' ? ['Nodus-linux-x86_64.rpm']
    : [APPIMAGE_NAME, `${APPIMAGE_NAME}.zsync`, LEGACY_APPIMAGE_NAME, `${channel}-linux.yml`];
}

export function appInventory(app) {
  const entries = {};
  const walk = directory => {
    for (const name of fs.readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const file = path.relative(app, full).split(path.sep).join('/');
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(full);
        const resolved = path.relative(app, path.resolve(directory, target));
        assert.ok(!path.isAbsolute(target) && resolved !== '..' && !resolved.startsWith(`..${path.sep}`), `Unsafe app symlink: ${file}`);
        entries[file] = { type: 'link', target };
      } else if (stat.isDirectory()) {
        entries[file] = { type: 'directory', mode: stat.mode & 0o777 };
        walk(full);
      } else {
        assert.ok(stat.isFile(), `Unsupported app entry: ${file}`);
        entries[file] = { type: 'file', mode: stat.mode & 0o777, size: stat.size, sha256: digest(full) };
      }
    }
  };
  assert.ok(fs.lstatSync(app).isDirectory(), 'Missing unpacked Linux app');
  walk(app);
  assert.ok(entries['resources/app.asar']?.size > 0 && entries.nodus?.type === 'file'
    && (entries.nodus.mode & 0o111), 'Missing application payload or executable');
  return entries;
}

export function createAppManifest(app, context) {
  validateReleaseChannel(context.channel, context.tag, context.version);
  assert.equal(context.platform, 'linux');
  assert.equal(context.arch, 'x64');
  return { schemaVersion: 1, context, entries: appInventory(app) };
}

export function verifyAppManifest(app, manifest, context, format) {
  assert.equal(manifest.schemaVersion, 1, 'Unsupported Linux manifest');
  assert.deepEqual(manifest.context, context, 'Linux build commit, lockfile, channel or runtime differs');
  const mutable = format === undefined ? [] : format === 'AppImage' ? ['resources/app-update.yml']
    : ['resources/app-update.yml', 'resources/package-type', 'resources/apparmor-profile'];
  if (format !== undefined) assert.ok(formats.includes(format), 'Unknown Linux format');
  const filtered = entries => Object.fromEntries(Object.entries(entries).filter(([file]) => !mutable.includes(file)));
  assert.deepEqual(filtered(appInventory(app)), filtered(manifest.entries), 'Unpacked Linux payload or permissions changed');
  if (format !== undefined) {
    const update = load(fs.readFileSync(path.join(app, 'resources/app-update.yml'), 'utf8'));
    const [owner, repo] = context.repository.split('/');
    assert.ok(update.provider === 'github' && update.owner === owner && update.repo === repo
      && update.channel === context.channel, 'Installer update feed differs from its release channel');
    if (format !== 'AppImage') {
      assert.equal(fs.readFileSync(path.join(app, 'resources/package-type'), 'utf8').trim(), format, 'Wrong native installer update type');
      assert.ok(fs.statSync(path.join(app, 'resources/apparmor-profile')).size > 0, 'Missing native installer AppArmor profile');
    }
  }
}

export function packPreparedApp(root, context) {
  const app = appAt(root), bundle = bundleAt(root);
  const manifest = createAppManifest(app, context);
  fs.mkdirSync(bundle, { recursive: true });
  execFileSync('tar', ['-czf', path.join(bundle, 'linux-unpacked.tgz'), '-C', path.dirname(app), 'linux-unpacked']);
  manifest.archiveSha256 = digest(path.join(bundle, 'linux-unpacked.tgz'));
  write(path.join(bundle, 'manifest.json'), manifest);
  return manifest;
}

export function restorePreparedApp(root, context) {
  const bundle = bundleAt(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.context, context, 'Linux archive belongs to another build');
  assert.equal(digest(path.join(bundle, 'linux-unpacked.tgz')), manifest.archiveSha256, 'Linux archive hash mismatch');
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  // Consumer umasks must not alter the producer's recorded permissions.
  // In 5.10.0 the connector ZIP was 0666, and default extraction made it 0644.
  execFileSync('tar', ['-xzpf', path.join(bundle, 'linux-unpacked.tgz'), '-C', path.join(root, 'release')]);
  verifyAppManifest(appAt(root), manifest, context);
  return manifest;
}

export function createFormatReport(directory, context, archiveSha256, format) {
  assert.match(archiveSha256, /^[a-f\d]{64}$/);
  const files = Object.fromEntries(formatAssets(format, context.channel).map(name => {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && stat.size > 0, `Missing or empty installer asset: ${name}`);
    return [name, { size: stat.size, sha256: digest(file) }];
  }));
  return { schemaVersion: 1, context, archiveSha256, format, files };
}

export async function stageFormat(root, context, format) {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundleAt(root), 'manifest.json'), 'utf8'));
  verifyAppManifest(appAt(root), manifest, context, format);
  const source = path.join(root, 'release');
  if (format === 'AppImage') {
    const update = load(fs.readFileSync(path.join(source, `${context.channel}-linux.yml`), 'utf8'));
    assert.equal(update.version, context.version);
    await verifyAppImage(path.join(source, APPIMAGE_NAME), update, context.channel);
    assert.equal(digest(path.join(source, APPIMAGE_NAME)), digest(path.join(source, LEGACY_APPIMAGE_NAME)), 'AppImage compatibility alias differs');
  }
  const report = createFormatReport(source, context, manifest.archiveSha256, format);
  const destination = path.join(root, `.ci/linux-format-${format}`);
  fs.mkdirSync(destination, { recursive: true });
  for (const name of Object.keys(report.files)) fs.copyFileSync(path.join(source, name), path.join(destination, name));
  write(path.join(destination, `${format}.json`), report);
  return report;
}

export function collectFormats(source, destination, context, archiveSha256) {
  assert.match(archiveSha256, /^[a-f\d]{64}$/);
  const reports = formats.map(format => JSON.parse(fs.readFileSync(path.join(source, `${format}.json`), 'utf8')));
  const expected = formats.flatMap(format => formatAssets(format, context.channel));
  assert.deepEqual(fs.readdirSync(source).sort(), [...expected, ...formats.map(format => `${format}.json`)].sort(), 'Missing or unexpected Linux format artifacts');
  for (const report of reports) {
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(report.context, context, 'Installer belongs to another commit, version or channel');
    assert.equal(report.archiveSha256, archiveSha256, 'Installer used another prepared Linux payload');
    assert.deepEqual(report, createFormatReport(source, context, archiveSha256, report.format), 'Installer asset hash or inventory mismatch');
  }
  assert.deepEqual(reports.map(report => report.format), formats, 'Missing or duplicate Linux format report');
  const update = load(fs.readFileSync(path.join(source, `${context.channel}-linux.yml`), 'utf8'));
  assert.equal(update.version, context.version, 'Wrong AppImage update version');
  assert.equal(update.path, APPIMAGE_NAME, 'Wrong AppImage update pointer');
  assert.equal(digest(path.join(source, APPIMAGE_NAME)), digest(path.join(source, LEGACY_APPIMAGE_NAME)), 'AppImage alias mismatch');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of expected) fs.copyFileSync(path.join(source, name), path.join(destination, name));
  return expected;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd(), pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(process.platform, 'linux', 'Release Linux artifacts require their native Linux host');
  assert.equal(process.arch, 'x64');
  const context = {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    lockHash: digest(path.join(root, 'package-lock.json')), version: pkg.version,
    tag: process.env.RELEASE_TAG, channel: process.env.NODUS_RELEASE_CHANNEL,
    repository: process.env.GITHUB_REPOSITORY, platform: process.platform, arch: process.arch,
  };
  validateReleaseChannel(context.channel, context.tag, context.version);
  const [command, format] = process.argv.slice(2);
  if (command === 'pack') {
    const manifest = packPreparedApp(root, context);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `archive_sha256=${manifest.archiveSha256}\n`);
  } else if (command === 'restore') restorePreparedApp(root, context);
  else if (command === 'stage') await stageFormat(root, context, format);
  else {
    assert.equal(command, 'collect', 'Unknown Linux release command');
    collectFormats(path.join(root, '.ci/linux-formats'), path.join(root, 'release'), context, process.env.LINUX_PREPARED_SHA256);
    const update = load(fs.readFileSync(path.join(root, `release/${context.channel}-linux.yml`), 'utf8'));
    await verifyAppImage(path.join(root, 'release', APPIMAGE_NAME), update, context.channel);
  }
}
