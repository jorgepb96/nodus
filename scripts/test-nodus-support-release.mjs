import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { verifyRelease, downloadArtifact, installerCommand,resolveRelease } from '../apps/nodus-support/core/releases.mjs';

const keys = generateKeyPairSync('ed25519');
const trusted = [{ keyId: 'test', publicKeyPem: keys.publicKey.export({ format: 'pem', type: 'spki' }) }];
const artifact = (name, format) => ({ name, format, url: `https://github.com/jorgepb96/nodus/releases/download/v5.13.0/${name}`, bytes: 7, sha256: createHash('sha256').update('payload').digest('hex') });
const payload = { format: 'nodus.support-release/1', platform: 'win32', arch: 'x64', version: '5.13.0', protocol: 1, executable: 'Nodus.exe', runtime: artifact('runtime.zip','zip'), installers: [artifact('Nodus-win-x64.exe','nsis')] };
const envelope = value => { const bytes = Buffer.from(JSON.stringify(value)); return { keyId: 'test', payload: bytes.toString('base64'), signature: sign(null, bytes, keys.privateKey).toString('base64') }; };
test('only signed official artifacts for the exact platform and architecture are accepted', () => {
  assert.equal(verifyRelease(envelope(payload), trusted, 'win32','x64').version, '5.13.0');
  assert.throws(() => verifyRelease(envelope(payload), [], 'win32','x64'), /RELEASE_NOT_TRUSTED/);
  assert.throws(() => verifyRelease(envelope(payload), trusted, 'darwin','arm64'), /RELEASE_INCOMPATIBLE/);
  const tampered = envelope(payload); tampered.payload = Buffer.from('{}').toString('base64');
  assert.throws(() => verifyRelease(tampered, trusted, 'win32','x64'), /RELEASE_SIGNATURE_INVALID/);
  const external = structuredClone(payload); external.runtime.url = 'https://malicious.example/runtime.zip';
  assert.throws(() => verifyRelease(envelope(external), trusted, 'win32','x64'), /RELEASE_NOT_TRUSTED/);
});
test('downloads verify actual bytes, retain failures and never overwrite another artifact', async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-support-download-')));
  try {
    const file = await downloadArtifact(payload.runtime, folder, { fetch: async () => new Response('payload') });
    assert.equal(fs.readFileSync(file,'utf8'), 'payload');
    await assert.rejects(downloadArtifact(payload.runtime, folder, { fetch: async () => new Response('payload') }), /DESTINATION_EXISTS/);
    const bad = artifact('bad.zip','zip'); await assert.rejects(downloadArtifact(bad, folder, { fetch: async () => new Response('corrupt') }), /DOWNLOAD_HASH_MISMATCH/);
    assert.equal(fs.readFileSync(path.join(folder,'bad.zip'),'utf8'), 'corrupt');
  } finally { fs.rmSync(folder,{recursive:true,force:true}); }
});
test('platform installers never invoke a shell or an uninstall operation', () => {
  for (const [platform,format,file] of [['win32','nsis','C:\\installer & data.exe'],['linux','deb','/tmp/package.deb'],['linux','rpm','/tmp/package.rpm']]) {
    const command = installerCommand(platform,format,file,'target'); assert.ok(!command.args.some(arg => /uninstall|remove|purge/.test(arg)));
  }
  assert.equal(installerCommand('linux','AppImage','/tmp/new.AppImage','/home/user/Nodus.AppImage').command, null);
  assert.throws(() => installerCommand('linux','exe','file','target'), /INSTALLER_NOT_SUPPORTED/);
});
test('same version is preferred and a compatible update requires explicit approval of verified metadata',async()=>{
  let prompts=0;const current=await resolveRelease('5.13.0',trusted,'win32','x64',{fetch:async()=>Response.json(envelope(payload)),approveUpgrade:async()=>{prompts++;return true;}});
  assert.equal(current.manifest.version,'5.13.0');assert.equal(prompts,0);
  const newer=structuredClone(payload);newer.version='5.14.0';for(const artifact of [newer.runtime,...newer.installers])artifact.url=artifact.url.replace('v5.13.0/','v5.14.0/');
  const fetcher=async url=>url.includes('/v5.13.0/')?new Response('',{status:404}):url.includes('/latest')?Response.json({tag_name:'v5.14.0',draft:false,prerelease:false}):Response.json(envelope(newer));
  await assert.rejects(resolveRelease('5.13.0',trusted,'win32','x64',{fetch:fetcher,approveUpgrade:async()=>false}),/TEST_CANCELLED/);
  const accepted=await resolveRelease('5.13.0',trusted,'win32','x64',{fetch:fetcher,approveUpgrade:async({from,to})=>{assert.equal(from,'5.13.0');assert.equal(to,'5.14.0');prompts++;return true;}});
  assert.equal(accepted.manifest.version,'5.14.0');assert.equal(accepted.previous,null);assert.equal(prompts,1);
});
