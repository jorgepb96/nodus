import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import QRCode from 'qrcode';
import {installRuntimeHooks} from './lib/tsRuntimeHooks.mjs';
installRuntimeHooks('/tmp/nodus-qr-contract-unused');
const {desktopPairingQR}=createRequire(import.meta.url)('../shared/desktopPairingQR.ts');
const fixture={id:'0824d8e8-44ed-498a-86a8-bb3e847b42fa',code:'ABCDE-23456',origins:['https://192.168.1.20:7443','https://100.64.1.20:7443'],certificateFingerprint:'a'.repeat(64),
  domains:['corpus','writing','research-generation','testimonies','teaching-roster','teaching-grades','study-recordings','primary-source-files','prosopography-private'],
  expiresAt:'2030-01-01T00:00:00Z',deviceName:'Mac de aceptación',macDeviceId:'d37f3d86-4351-4af4-9cf5-455fa11c098f',
  vaults:Array.from({length:12},(_,index)=>({id:`d37f3d86-4351-4af4-9cf5-${String(index).padStart(12,'0')}`,name:`Bóveda de aceptación ${index}`,type:'academic'})),
  relay:{url:'https://relay.example.org',id:'3593da8d-87ca-421d-872b-d97b80a17d9d',keyId:'efb43a55-3453-4c67-a5b1-c32054212e81',clientToken:'fixture-client-token-which-is-not-a-secret',secret:Buffer.alloc(32,17).toString('base64'),expiresAt:'2030-01-01T00:00:00Z'}};
const link=desktopPairingQR(fixture);
const encoded=JSON.parse(Buffer.from(new URL(link).searchParams.get('q'),'base64url'));
assert.deepEqual(encoded[8],fixture.vaults.map(vault=>[vault.id,vault.name,vault.type]));assert.deepEqual(encoded[9],fixture.relay);assert.equal(encoded[10],fixture.macDeviceId);
const png=await QRCode.toBuffer(link,{width:720,margin:4,errorCorrectionLevel:'M'});
const destination=path.resolve('scripts/fixtures/mobile-pairing');
const mobileDestination=path.resolve('../nodus-mobile/ios/Packages/NodusKit/Tests/NodusKitTests/Fixtures');
if(process.argv.includes('--write-fixture')){
 fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,'desktop-pairing-qr.png'),png);fs.writeFileSync(path.join(destination,'desktop-pairing-qr.json'),JSON.stringify({link,vaultIds:fixture.vaults.map(vault=>vault.id),macDeviceId:fixture.macDeviceId},null,2)+'\n');
}else{
 const saved=JSON.parse(fs.readFileSync(path.join(destination,'desktop-pairing-qr.json'),'utf8'));assert.equal(saved.link,link,'Node fixture must match the current wire encoder');assert.deepEqual(fs.readFileSync(path.join(destination,'desktop-pairing-qr.png')),png);
}
// Desktop's unit campaign is self-contained. The cross-repository campaign
// explicitly requires the Swift fixture; absence never counts as interop proof.
if(process.argv.includes('--verify-mobile-fixture')){
 const saved=JSON.parse(fs.readFileSync(path.join(mobileDestination,'desktop-pairing-qr.json'),'utf8'));
 assert.equal(saved.link,link,'Swift must decode the current Desktop wire fixture');
 assert.deepEqual(fs.readFileSync(path.join(mobileDestination,'desktop-pairing-qr.png')),png);
}
console.log(JSON.stringify({suite:'mobile-pairing-qr',passed:true,vaults:12,bytes:Buffer.byteLength(link),pngBytes:png.length,allGrantsPreserved:true,relayPreserved:true}));
