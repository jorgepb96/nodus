// Pure, signed distribution contract for the independent Support application.
import {createHash,createPublicKey,verify} from 'node:crypto';
import semver from 'semver';
const origin='https://github.com/jorgepb96/nodus/releases/download/';
function check(value,code='SUPPORT_DOWNLOAD_INVALID'){if(!value)throw Object.assign(new Error(code),{code});}
export function supportInstallerFormat(platform,{appImage=false,deb=false,rpm=false}={}) {
  if(platform==='win32')return 'nsis';
  if(platform==='darwin')return 'dmg';
  check(platform==='linux','SUPPORT_PLATFORM_UNSUPPORTED');
  return appImage?'AppImage':deb?'deb':rpm?'rpm':'AppImage';
}
export function verifySupportApp(envelope,keys,platform,arch) {
  const key=keys.find(item=>item.keyId===envelope?.keyId);
  check(key&&typeof envelope.payload==='string'&&envelope.payload.length<6*1024**2&&typeof envelope.signature==='string');
  const payload=Buffer.from(envelope.payload,'base64'),publicKey=createPublicKey(key.publicKeyPem);
  check(publicKey.asymmetricKeyType==='ed25519'&&verify(null,payload,publicKey,Buffer.from(envelope.signature,'base64')));
  const manifest=JSON.parse(payload.toString('utf8'));
  check(manifest.format==='nodus.support-app/1'&&manifest.protocol===1&&manifest.platform===platform&&manifest.arch===arch&&semver.valid(manifest.version));
  check(Array.isArray(manifest.installers)&&manifest.installers.length>0&&Number.isSafeInteger(manifest.expandedBytes)&&manifest.expandedBytes>0&&manifest.expandedBytes<=16*1024**3);
  const executable=platform==='darwin'?'nodus-support.app/Contents/MacOS/nodus-support':platform==='win32'?'nodus-support.exe':'nodus-support';
  check(manifest.executable===executable&&manifest.runtime?.format==='zip'&&/^[a-f0-9]{64}$/.test(manifest.contentSha256));
  for(const item of [manifest.runtime,...manifest.installers]) {
    check(item&&/^Nodus-Support-[A-Za-z0-9.-]+$/.test(item.name)&&/^[a-f0-9]{64}$/.test(item.sha256)&&Number.isSafeInteger(item.bytes)&&item.bytes>0&&item.bytes<=4*1024**3);
    check(item.url===`${origin}v${manifest.version}/${item.name}`);
    check(platform==='darwin'?item.platformSignature==='macos-notarized':platform==='win32'?['none','authenticode'].includes(item.platformSignature):item.platformSignature==='none');
  }
  return manifest;
}
export function selectSupportInstaller(manifest,format) {
  const artifact=manifest.installers.find(item=>item.format===format);check(artifact,'SUPPORT_ASSET_PENDING');return artifact;
}
export async function supportJson(response) {
  check(response.ok&&response.body,'SUPPORT_NETWORK_UNAVAILABLE');const reader=response.body.getReader(),parts=[];let bytes=0;
  try{for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;check(bytes<=8*1024**2);parts.push(Buffer.from(item.value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export async function resolveSupportApp(version,keys,platform,arch,{fetch:fetcher=fetch,signal}={}) {
  check(semver.valid(version),'SUPPORT_VERSION_UNKNOWN');const beta=Boolean(semver.prerelease(version));
  const response=await fetcher(beta?'https://api.github.com/repos/jorgepb96/nodus/releases?per_page=30':'https://api.github.com/repos/jorgepb96/nodus/releases/latest',{signal,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
  const data=await supportJson(response),release=beta?data.find(item=>!item.draft&&item.prerelease&&semver.valid(String(item.tag_name).replace(/^v/,''))):data;
  check(release&&!release.draft&&Boolean(release.prerelease)===beta,'SUPPORT_ASSET_PENDING');
  const target=String(release.tag_name).replace(/^v/,'');check(semver.valid(target)&&semver.major(target)===semver.major(version),'SUPPORT_VERSION_UNSUPPORTED');
  const manifestResponse=await fetcher(`${origin}v${target}/nodus-support-app-${platform}-${arch}.json`,{signal});
  check(manifestResponse.status!==404&&manifestResponse.status!==410,'SUPPORT_ASSET_PENDING');
  const envelope=await supportJson(manifestResponse),manifest=verifySupportApp(envelope,keys,platform,arch);check(manifest.version===target);return {manifest,envelope};
}

export function supportContentDigest(value) {return createHash('sha256').update(JSON.stringify(value.entries.map(({mode:_mode,...entry})=>entry))).digest('hex');}

export function newerSupportVersion(a,b){return semver.gt(a,b);}
