// Non-publishing integration check: real electron-builder DEB/RPM/AppImage,
// independent copies of one tiny native payload, and extracted update contracts.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { formats, packPreparedApp, restorePreparedApp, stageFormat, collectFormats } from './release-linux-artifact.mjs';
import { finalizeLinuxAppImage } from './finalize-linux-appimage.mjs';

const require = createRequire(import.meta.url), repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createPackage } = require('@electron/asar');
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-linux-formats-'));
const producer = path.join(temporary, 'producer');
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
try {
  fs.mkdirSync(path.join(producer, 'release/linux-unpacked/resources'), { recursive: true });
  fs.writeFileSync(path.join(producer, 'package.json'), JSON.stringify({ name: 'nodus', version: pkg.version,
    description: 'Disposable release-format payload', author: pkg.author, license: pkg.license, homepage: pkg.homepage }));
  fs.writeFileSync(path.join(producer, 'package-lock.json'), '{}');
  const fixture = path.join(producer, 'source'); fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(fixture, 'package.json'), '{"name":"nodus","main":"index.js"}');
  fs.writeFileSync(path.join(fixture, 'index.js'), 'console.log("synthetic Linux installer payload");');
  await createPackage(fixture, path.join(producer, 'release/linux-unpacked/resources/app.asar'));
  fs.copyFileSync('/usr/bin/true', path.join(producer, 'release/linux-unpacked/nodus'));
  fs.chmodSync(path.join(producer, 'release/linux-unpacked/nodus'), 0o755);
  const connector = path.join(producer, 'release/linux-unpacked/resources/browser/nodus-research-connector-chrome.zip');
  fs.mkdirSync(path.dirname(connector));
  fs.writeFileSync(connector, 'synthetic connector payload');
  fs.chmodSync(connector, 0o666);
  run('git', ['init', '-q'], producer);
  run('git', ['-c', 'user.name=Release Fixture', '-c', 'user.email=ci@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], producer);
  const context = { commit: run('git', ['rev-parse', 'HEAD'], producer).trim(),
    lockHash: hash(path.join(producer, 'package-lock.json')), version: pkg.version, tag: `v${pkg.version}`,
    channel: pkg.version.includes('-beta.') ? 'beta' : 'latest', repository: 'jorgepb96/nodus', platform: 'linux', arch: 'x64' };
  const manifest = packPreparedApp(producer, context);
  const cli = path.join(repo, 'node_modules/electron-builder/cli.js');
  const workers = formats.map(format => {
    const root = path.join(temporary, format);
    fs.mkdirSync(root);
    for (const name of ['package.json', 'package-lock.json', '.git', '.ci']) fs.cpSync(path.join(producer, name), path.join(root, name), { recursive: true });
    restorePreparedApp(root, context);
    // Fail if --prepackaged unexpectedly reruns a source packaging hook.
    fs.writeFileSync(path.join(root, 'builder.cjs'), `module.exports = {
      appId: 'app.nodus.release-fixture', productName: 'Nodus', executableName: 'nodus',
      electronVersion: ${JSON.stringify(pkg.devDependencies.electron.replace(/^[^\d]*/, ''))},
      artifactName: 'Nodus-\u0024{os}-\u0024{arch}.\u0024{ext}', directories: { output: 'release' },
      beforePack() { throw new Error('prepackaged app was rebuilt'); },
      afterPack() { throw new Error('prepackaged app was repacked'); },
      linux: { maintainer: 'Nodus CI <ci@example.invalid>', category: 'Office', icon: ${JSON.stringify(path.join(repo, 'build/icon.png'))} },
      appImage: { artifactName: 'Nodus-\u0024{arch}.\u0024{ext}' },
      publish: [{ provider: 'github', owner: 'jorgepb96', repo: 'nodus', channel: ${JSON.stringify(context.channel)} }]
    };`);
    return { format, root };
  });
  const results = await Promise.allSettled(workers.map(({ format, root }) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, '--projectDir', root, '--config', path.join(root, 'builder.cjs'),
      '--linux', format, '--x64', '--prepackaged', path.join(root, 'release/linux-unpacked'), '--publish', 'never'],
    { cwd: root, env: { ...process.env, NODUS_RELEASE_CHANNEL: context.channel } });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', status => status === 0 ? resolve() : reject(new Error(`${format} installer failed (${status}):\n${output}`)));
  })));
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('\n'));
  const source = path.join(temporary, 'formats'); fs.mkdirSync(source);
  for (const { format, root } of workers) {
    if (format === 'AppImage') await finalizeLinuxAppImage(path.join(root, 'release'), context.channel);
    const report = await stageFormat(root, context, format);
    for (const name of [...Object.keys(report.files), `${format}.json`]) fs.copyFileSync(path.join(root, `.ci/linux-format-${format}`, name), path.join(source, name));
    const extracted = path.join(root, 'extracted'); fs.mkdirSync(extracted);
    const installer = path.join(root, 'release', format === 'deb' ? 'Nodus-linux-amd64.deb'
      : format === 'rpm' ? 'Nodus-linux-x86_64.rpm' : 'Nodus-x86_64.AppImage');
    if (format === 'deb') run('dpkg-deb', ['-x', installer, extracted], root);
    else if (format === 'rpm') run('bsdtar', ['-xf', installer, '-C', extracted], root);
    else run(installer, ['--appimage-extract'], extracted);
    const payload = fs.readdirSync(extracted, { recursive: true }).find(file => file.endsWith('resources/app.asar'));
    assert.ok(payload, `${format} installer lost its application payload`);
    assert.equal(hash(path.join(extracted, payload)), hash(path.join(producer, 'release/linux-unpacked/resources/app.asar')));
    const app = path.dirname(path.dirname(path.join(extracted, payload)));
    assert.equal(hash(path.join(app, 'nodus')), hash(path.join(producer, 'release/linux-unpacked/nodus')));
    assert.ok(fs.statSync(path.join(app, 'nodus')).mode & 0o111, `${format} installer lost executable permissions`);
    assert.equal(hash(path.join(app, 'resources/browser/nodus-research-connector-chrome.zip')), hash(connector), `${format} installer lost its connector payload`);
    const update = load(fs.readFileSync(path.join(app, 'resources/app-update.yml'), 'utf8'));
    assert.equal(update.channel, context.channel);
    if (format !== 'AppImage') assert.equal(fs.readFileSync(path.join(app, 'resources/package-type'), 'utf8').trim(), format);
    console.log(`${format}: unchanged extracted payload, executable permissions and update channel verified`);
  }
  collectFormats(source, path.join(temporary, 'collected'), context, manifest.archiveSha256);
  console.log('All three independently generated Linux formats passed the production artifact gate without publishing.');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
