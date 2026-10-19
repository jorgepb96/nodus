import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import semver from 'semver';
import { assert, copyInventory, destination, hashFile, inventory, noLinks, sufficientSpace, writeNew } from './files.mjs';

export const RELEASE_ORIGIN = 'https://github.com/jorgepb96/nodus/releases/download/';
export function verifyRelease(envelope, keys, platform, arch) {
  const key = keys.find(k => k.keyId === envelope?.keyId);
  assert(key && typeof envelope.payload === 'string' && typeof envelope.signature === 'string', 'RELEASE_NOT_TRUSTED');
  const bytes = Buffer.from(envelope.payload, 'base64'); assert(bytes.length <= 4 * 1024 * 1024, 'RELEASE_NOT_TRUSTED');
  const publicKey=createPublicKey(key.publicKeyPem);assert(publicKey.asymmetricKeyType==='ed25519','RELEASE_NOT_TRUSTED');
  assert(verify(null, bytes, publicKey, Buffer.from(envelope.signature, 'base64')), 'RELEASE_SIGNATURE_INVALID');
  const manifest = JSON.parse(bytes.toString('utf8'));
  assert(manifest.format === 'nodus.support-release/1' && manifest.platform === platform && manifest.arch === arch && manifest.protocol === 1, 'RELEASE_INCOMPATIBLE');
  assert(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(manifest.version), 'RELEASE_INCOMPATIBLE');
  for (const artifact of [manifest.runtime, ...manifest.installers]) {
    assert(artifact && /^[a-f0-9]{64}$/.test(artifact.sha256) && Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0, 'RELEASE_NOT_TRUSTED');
    assert(platform==='darwin'?artifact.platformSignature==='macos-notarized':platform==='win32'?['authenticode','none'].includes(artifact.platformSignature):artifact.platformSignature==='none','RELEASE_NOT_TRUSTED');
    const url = new URL(artifact.url);
    assert(url.href.startsWith(`${RELEASE_ORIGIN}v${manifest.version}/`) && !url.search && !url.hash && !url.username && !url.password, 'RELEASE_NOT_TRUSTED');
    assert(decodeURIComponent(url.pathname.split('/').at(-1)) === artifact.name && path.basename(artifact.name) === artifact.name, 'RELEASE_NOT_TRUSTED');
  }
  assert(!path.isAbsolute(manifest.executable) && !manifest.executable.includes('..'), 'RELEASE_NOT_TRUSTED');
  return manifest;
}
export function acceptPlatformSignature(status,policy) {
  assert(policy==='authenticode'||policy==='none','RELEASE_NOT_TRUSTED');
  assert(status==='Valid'||policy==='none'&&status==='NotSigned','RELEASE_PLATFORM_SIGNATURE_INVALID');
}
async function boundedJson(response) {
  assert(response.body,'RELEASE_MANIFEST_UNAVAILABLE');const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;assert(size<=8*1024**2,'RELEASE_NOT_TRUSTED');parts.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export async function resolveRelease(version,keys,platform,arch,{fetch:fetcher=fetch,signal,update=false,approveUpgrade=async()=>false}={}) {
  assert(semver.valid(version),'RELEASE_VERSION_UNKNOWN');
  const load=async target=>{
    const response=await fetcher(`${RELEASE_ORIGIN}v${target}/nodus-support-release-${platform}-${arch}.json`,{signal});
    if(response.status===404||response.status===410)return null;
    assert(response.ok,'RELEASE_MANIFEST_UNAVAILABLE');const manifest=verifyRelease(await boundedJson(response),keys,platform,arch);
    assert(manifest.version===target,'RELEASE_INCOMPATIBLE');return manifest;
  };
  const previous=await load(version);if(previous&&!update)return {manifest:previous,previous};
  const response=await fetcher('https://api.github.com/repos/jorgepb96/nodus/releases/latest',{signal,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}});
  assert(response.ok,'RELEASE_MANIFEST_UNAVAILABLE');const release=await boundedJson(response),latest=String(release.tag_name??'').replace(/^v/,'');
  assert(!release.draft&&!release.prerelease&&semver.valid(latest)&&semver.gt(latest,version)&&semver.major(latest)===semver.major(version),'RELEASE_INCOMPATIBLE');
  const manifest=await load(latest);assert(manifest,'RELEASE_MANIFEST_UNAVAILABLE');
  assert(await approveUpgrade({from:version,to:latest}),'TEST_CANCELLED');return {manifest,previous};
}
export async function downloadArtifact(artifact, folder, { fetch: fetcher = fetch, signal, progress = () => {} } = {}) {
  noLinks(folder); await fsp.mkdir(folder, { recursive: true, mode: 0o700 });
  await sufficientSpace(folder, artifact.bytes, 2);
  const output = destination(folder, artifact.name); assert(!fs.existsSync(output), 'DESTINATION_EXISTS');
  const response = await fetcher(artifact.url, { signal }); assert(response.ok && response.body, 'DOWNLOAD_FAILED');
  const redirect = response.url ? new URL(response.url) : null;
  assert(!redirect || redirect.protocol === 'https:' && ['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(redirect.hostname), 'DOWNLOAD_ORIGIN_INVALID');
  const stream = Readable.fromWeb(response.body); let completed = 0;
  stream.on('data', chunk => { completed += chunk.length; if (completed > artifact.bytes) stream.destroy(new Error('DOWNLOAD_TOO_LARGE')); progress({ phase: 'download', completed, total: artifact.bytes }); });
  await pipeline(stream, fs.createWriteStream(output, { flags: 'wx', mode: 0o600 }), { signal });
  assert(completed === artifact.bytes && await hashFile(output, signal) === artifact.sha256, 'DOWNLOAD_HASH_MISMATCH');
  await writeNew(`${output}.verified.json`, { name: artifact.name, sha256: artifact.sha256, bytes: completed });
  return output;
}
export async function extractRuntime(archive, folder, openZip) {
  noLinks(folder); assert(!fs.existsSync(folder), 'DESTINATION_EXISTS'); await fsp.mkdir(folder, { recursive: true, mode: 0o700 });
  const zip = await new Promise((resolve, reject) => openZip(archive, { lazyEntries: true, autoClose: true }, (error, zip) => error ? reject(error) : resolve(zip)));
  return new Promise((resolve, reject) => {
    const links = []; let expanded = 0; const seen = new Set();
    zip.on('error', reject); zip.on('end', async () => {
      try {
        for (const link of links) {
          const resolved = path.resolve(path.dirname(link.file), link.target);
          assert(resolved.startsWith(`${folder}${path.sep}`) && !path.isAbsolute(link.target), 'ARCHIVE_PATH_ESCAPE');
          noLinks(path.dirname(link.file)); await fsp.symlink(link.target, link.file);
        }
        resolve();
      } catch (error) { reject(error); }
    });
    zip.on('entry', entry => { void (async () => {
      assert(!entry.fileName.includes('\\') && !entry.fileName.includes('\0'), 'ARCHIVE_PATH_ESCAPE');
      const file = destination(folder, entry.fileName.replace(/\/$/, ''));
      assert(!seen.has(file), 'ARCHIVE_DUPLICATE'); seen.add(file);
      expanded += entry.uncompressedSize; assert(Number.isSafeInteger(expanded) && expanded < 64 * 1024 ** 3, 'ARCHIVE_TOO_LARGE');
      const mode = entry.externalFileAttributes >>> 16;
      if (entry.fileName.endsWith('/')) { await fsp.mkdir(file, { recursive: true, mode: 0o700 }); zip.readEntry(); return; }
      await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const stream = await new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
      if ((mode & 0o170000) === 0o120000) {
        assert(entry.uncompressedSize < 4096, 'ARCHIVE_PATH_ESCAPE'); const chunks = [];
        // yauzl 2 uses readable-stream 2, whose async iterator can stall on Node 22.
        await new Promise((resolve,reject) => { stream.on('data',chunk=>chunks.push(chunk)); stream.once('end',resolve); stream.once('error',reject); });
        links.push({ file, target: Buffer.concat(chunks).toString('utf8') });
      } else {
        assert(!(mode & 0o170000) || (mode & 0o170000) === 0o100000, 'ARCHIVE_SPECIAL_FILE');
        await pipeline(stream, fs.createWriteStream(file, { flags: 'wx', mode: mode & 0o700 || 0o600 }));
      }
      zip.readEntry();
    })().catch(error => { zip.close(); reject(error); }); }); zip.readEntry();
  });
}
export function installerCommand(platform, format, file, target, {rollback=false}={}) {
  if (platform === 'win32' && format === 'nsis') return { command: file, args: [`/D=${target}`], elevation: 'installer' };
  if (platform === 'linux' && format === 'deb') return { command: '/usr/bin/pkexec', args: ['/usr/bin/dpkg', '--install', file], elevation: 'system' };
  if (platform === 'linux' && format === 'rpm') return { command: '/usr/bin/pkexec', args: ['/usr/bin/rpm', '-U', '--replacepkgs', ...(rollback?['--oldpackage']:[]), file], elevation: 'system' };
  if (platform === 'linux' && format === 'AppImage') return { command: null, args: [], target, elevation: 'none' };
  assert(platform === 'darwin' && format === 'zip', 'INSTALLER_NOT_SUPPORTED');
  return { command: null, args: [], target, elevation: 'filesystem' };
}
export async function preserveInstallation(source, folder) {
  const manifest = await inventory(source, undefined, undefined, { links: true }); await sufficientSpace(folder, manifest.bytes);
  const copy = path.join(folder, 'previous-installation'); await copyInventory(source, copy, manifest);
  await writeNew(path.join(folder, 'installation-protection.json'), { source, copy, inventory: manifest }); return copy;
}
export function runInstaller(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: 'ignore', windowsHide: false });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(Object.assign(new Error('INSTALLER_FAILED'), { code: 'INSTALLER_FAILED' })));
  });
}
