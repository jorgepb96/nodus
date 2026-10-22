import {supportSourceDigest} from './lib/supportEvidence.mjs';
// Runtime archives and signed manifests are produced from the final, signed app.
// No release can enable reinstall without an independently configured trust key.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicKey, sign, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import archiver from 'archiver';
import { hashFile } from '../apps/nodus-support/core/files.mjs';
import { acceptPlatformSignature,verifyRelease } from '../apps/nodus-support/core/releases.mjs';
import { requireQualified } from '../apps/nodus-support/core/qualification.mjs';
import {supportSignatureEnvironment} from './lib/supportPublication.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const platform = process.platform, arch = process.arch;
const release = path.join(root, 'release');
const runtimeName = `Nodus-Runtime-${platform}-${arch}.zip`;
const preparedRuntime = path.join(root, '.ci/support-release', runtimeName);
const app = platform === 'darwin' ? path.join(release, `mac${arch === 'arm64' ? '-arm64' : ''}`, 'Nodus.app') : path.join(release, platform === 'win32' ? 'win-unpacked' : 'linux-unpacked');
function platformSignature(file) {
  if(platform==='darwin') {execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app]);execFileSync('/usr/sbin/spctl',['--assess','--type','execute',app]);return 'macos-notarized';}
  if(platform!=='win32')return 'none';
  const powershell=path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const status=execFileSync(powershell,['-NoProfile','-NonInteractive','-Command','(Get-AuthenticodeSignature -LiteralPath $env:NODUS_SUPPORT_SIGNATURE_FILE).Status.ToString()'],{env:supportSignatureEnvironment(file),encoding:'utf8'}).trim();
  acceptPlatformSignature(status,'none');return status==='Valid'?'authenticode':'none';
}
if (process.argv.includes('--runtime')) {
  fs.mkdirSync(path.dirname(preparedRuntime), { recursive: true });
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(preparedRuntime, { flags: 'wx' });
    const zip = archiver('zip', { forceZip64: true, zlib: { level: 6 } }); zip.on('error', reject); out.on('error', reject); out.on('close', resolve); zip.pipe(out);
    function walk(directory, relative) {
      for (const name of fs.readdirSync(directory).sort()) {
        const file = path.join(directory,name), entry = relative ? `${relative}/${name}` : name, stat = fs.lstatSync(file);
        if (stat.isSymbolicLink()) zip.symlink(entry, fs.readlinkSync(file), stat.mode);
        else if (stat.isDirectory()) walk(file,entry);
        else zip.file(file,{name:entry,mode:stat.mode});
      }
    }
    walk(app, platform === 'darwin' ? 'Nodus.app' : ''); void zip.finalize();
  });
  console.log(`Prepared ${runtimeName}`);
}
if (process.argv.includes('--publish')) {
  const qualified = JSON.parse(fs.readFileSync(path.join(root,'apps/nodus-support/qualified-repairs.json'),'utf8'));
  for (const repair of ['interactive-copy','apply-solution','restore-copy','reinstall']) requireQualified(qualified,platform,arch,repair,supportSourceDigest(root));
  const privateKey = process.env.NODUS_SUPPORT_RELEASE_PRIVATE_KEY;
  const keyId = process.env.NODUS_SUPPORT_RELEASE_KEY_ID;
  if (!privateKey || !keyId) throw new Error('Support publication requires NODUS_SUPPORT_RELEASE_PRIVATE_KEY and NODUS_SUPPORT_RELEASE_KEY_ID');
  const keys = JSON.parse(fs.readFileSync(path.join(root,'apps/nodus-support/trusted-release-keys.json'),'utf8')).keys;
  const derived = createPublicKey(privateKey).export({type:'spki',format:'pem'});
  if (!keys.some(key => key.keyId === keyId && key.publicKeyPem.trim() === derived.trim())) throw new Error('The support release key is not pinned in the application');
  fs.copyFileSync(preparedRuntime, path.join(release,runtimeName));
  const names = platform === 'darwin' ? [[`Nodus-mac-${arch}.zip`,'zip']] : platform === 'win32' ? [['Nodus-win-x64.exe','nsis']] : [['Nodus-x86_64.AppImage','AppImage'],['Nodus-linux-amd64.deb','deb'],['Nodus-linux-x86_64.rpm','rpm']];
  const artifact = async (name,format) => {
    if(format==='nsis'&&JSON.parse(fs.readFileSync(path.join(app,'resources/nodus-support-protocol.json'),'utf8')).windowsRepairProtocol!==1)throw new Error('Windows recovery requires the verified non-destructive NSIS repair protocol');
    return {name,format,...(format==='nsis'?{repairProtocol:1}:{}),platformSignature:platformSignature(name===runtimeName?path.join(app,platform==='win32'?'Nodus.exe':'nodus'):path.join(release,name)),url:`https://github.com/jorgepb96/nodus/releases/download/v${pkg.version}/${name}`,bytes:fs.statSync(path.join(release,name)).size,sha256:await hashFile(path.join(release,name))};
  };
  const manifest = {format:'nodus.support-release/1',protocol:1,version:pkg.version,platform,arch,executable:platform === 'darwin' ? 'Nodus.app/Contents/MacOS/Nodus' : platform === 'win32' ? 'Nodus.exe' : 'nodus',runtime:await artifact(runtimeName,'zip'),installers:await Promise.all(names.map(([name,format])=>artifact(name,format)))};
  const payload = Buffer.from(JSON.stringify(manifest)); const envelope = {keyId,payload:payload.toString('base64'),signature:sign(null,payload,privateKey).toString('base64')};
  verifyRelease(envelope,keys,platform,arch);
  const manifestName = `nodus-support-release-${platform}-${arch}.json`; fs.writeFileSync(path.join(release,manifestName),JSON.stringify(envelope));
  const support = path.join(root,'release-support');
  const supportNames = fs.readdirSync(support).filter(name => name.startsWith('Nodus-Support-') && /\.(?:exe|dmg|zip|deb|rpm|AppImage)$/.test(name));
  if (!supportNames.length) throw new Error('Standalone support installers are missing');
  const files = [path.join(release,runtimeName),path.join(release,manifestName),...supportNames.map(name=>path.join(support,name))];
  // Command arguments keep key material out of shell commands, process arguments and logs.
  execFileSync('gh',['release','upload',`v${pkg.version}`,...files,'--repo','jorgepb96/nodus','--clobber'],{stdio:'inherit'});
  const digest = createHash('sha256').update(payload).digest('hex'); console.log(`Published verified support manifest ${platform}/${arch}: ${digest}`);
}
