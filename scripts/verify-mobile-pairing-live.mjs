// Real Desktop renderer/preload/IPC/HTTPS and process-restart acceptance.
// Uses only the explicitly marked copied lab, never the normal installation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import tls from 'node:tls';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {sourceRevision} from './lib/sourceRevision.mjs';
import {_electron} from 'playwright-core';

const require = createRequire(import.meta.url);
const repo = path.resolve(import.meta.dirname, '..');
const lab = fs.realpathSync(process.env.NODUS_MOBILE_ACCEPTANCE_LAB ?? '');
assert(fs.existsSync(path.join(lab, '.nodus-mobile-acceptance-lab')), 'A marked isolated lab is required');
const root = path.dirname(lab);
const marker = JSON.parse(fs.readFileSync(path.join(root, 'isolation.json'), 'utf8'));
assert.equal(marker.root, root);
assert.equal(path.join(root, 'profile'), lab);
const registry = JSON.parse(fs.readFileSync(path.join(lab, 'vaults.json'), 'utf8'));
assert(registry.vaults.every(v => fs.realpathSync(v.path).startsWith(lab + path.sep)));
const evidence = path.resolve(process.env.NODUS_PAIRING_EVIDENCE ?? path.join(repo, 'artifacts/pairing-2026-10-15/live'));
fs.mkdirSync(evidence, {recursive:true, mode:0o700});
const before = sourceRevision(repo);
let app, page, bearer, origin, pin, grant, originalPort;
const agent = new https.Agent({keepAlive:false});
agent.createConnection = (options, callback) => {
  // The production phone uses the same leaf pin rather than public CA trust.
  const socket = tls.connect({...options, rejectUnauthorized:false});
  socket.once('error', callback);
  socket.once('secureConnect', () => {
    if (createHash('sha256').update(socket.getPeerCertificate().raw).digest('hex') !== pin) {
      socket.destroy(); callback(new Error('certificate_mismatch')); return;
    }
    callback(null, socket);
  });
};
async function request(route, method='GET', body, expected=200) {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve,reject) => {
    const req = https.request(new URL(route,origin), {agent,method,headers:{...(bearer?{authorization:`Bearer ${bearer}`} : {}),...(data?{'content-type':'application/json'}:{})}},res=>{
      const chunks=[];res.on('error',reject);res.on('data',v=>chunks.push(v));res.on('end',()=>{
        try {const parsed=JSON.parse(Buffer.concat(chunks).toString());assert.equal(res.statusCode,expected,`${route}: ${JSON.stringify(parsed).slice(0,160)}`);resolve(parsed);}catch(e){reject(e);}
      });
    });req.setTimeout(15000,()=>req.destroy(new Error('request_timeout')));req.on('error',reject);req.end(data);
  });
}
async function launch() {
  const env={...process.env,NODUS_USERDATA:lab,NODUS_ISOLATED_ROOT:root,NODUS_DISABLE_AUTO_UPDATE:'1',NODUS_E2E_UPDATE_STATUS:'not-available'};
  delete env.ELECTRON_RUN_AS_NODE;delete env.NODUS_HARNESS_KEYS_FILE;
  app=await _electron.launch({executablePath:require('electron'),args:[repo],cwd:repo,env,timeout:90000});
  page=await app.firstWindow();page.setDefaultTimeout(30000);
  await page.waitForFunction(()=>Boolean(document.getElementById('root')?.children.length),null,{timeout:90000});
}
async function close() {if(app){await app.close();app=undefined;}}
try {
  await launch();
  assert.equal(await page.evaluate(()=>typeof window.nodus?.createDesktopBridgeOffer),'function');
  // This is the actual Desktop window's API boundary, not a mock renderer API.
  const vaults=await page.evaluate(()=>window.nodus.listVaults());
  const initial=await page.evaluate(()=>window.nodus.getDesktopBridgeStatus());
  const domains=['corpus','writing','research-generation','testimonies','teaching-roster','teaching-grades','study-recordings','primary-source-files','prosopography-private'];
  const offer=await page.evaluate(async domains=>window.nodus.createDesktopBridgeOffer([],domains,undefined,'direct',{wholeWorkspace:true}),domains);
  assert.equal(offer.wholeWorkspace,true);assert.deepEqual(new Set(offer.vaultIds),new Set(vaults.map(v=>v.id)));
  originalPort=(await page.evaluate(()=>window.nodus.getDesktopBridgeStatus())).port;
  pin=offer.certificateFingerprint;
  // Prefer the actual Mac LAN interface, not a loopback-only fixture.
  origin=offer.origins.find(value=>/^https:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(value));
  assert(origin,'A real private LAN address is required; no skipped network acceptance');
  const token=randomBytes(32).toString('base64url');
  const paired=await request('/bridge/v1/pair','POST',{code:offer.code,deviceId:'desktop-connection-lifecycle',deviceName:'Connection lifecycle QA',nextToken:token},201);
  bearer=token;grant=paired.pairing;
  const caps=await request('/bridge/v2/capabilities');
  assert.equal(caps.deviceId,offer.macDeviceId);assert.equal(caps.wholeWorkspace,true);
  assert.deepEqual(new Set(caps.vaultIds),new Set(vaults.map(v=>v.id)));
  assert.equal((await request('/bridge/v2/health')).version,JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).version);
  await close();
  await assert.rejects(request('/bridge/v2/health'),/ECONNREFUSED|ECONNRESET|socket hang up/,'Closing the real Mac app must stop the listener');
  await launch();
  await page.waitForFunction(async()=>Boolean((await window.nodus.getDesktopBridgeStatus()).running),null,{timeout:30000});
  const restored=await page.evaluate(()=>window.nodus.getDesktopBridgeStatus());
  assert.equal(restored.port,originalPort);assert.equal(restored.certificateFingerprint,pin);
  assert.equal(restored.pairings.filter(p=>p.id===grant.id).length,1);
  assert.equal((await request('/bridge/v2/capabilities')).deviceId,caps.deviceId);
  assert.equal((await request('/bridge/v2/pairing')).pairing.id,grant.id);
  const renewed=randomBytes(32).toString('base64url');
  await request('/bridge/v2/pairing/renew','POST',{nextToken:renewed});
  await request('/bridge/v2/health','GET',undefined,401);bearer=renewed;
  assert.equal((await request('/bridge/v2/pairing')).pairing.id,grant.id);
  assert.equal(await page.evaluate(id=>window.nodus.revokeDesktopBridgePairing(id),grant.id),true);
  await request('/bridge/v2/capabilities','GET',undefined,401);
  const end=await page.evaluate(()=>window.nodus.getDesktopBridgeStatus());
  assert.equal(end.pairings.filter(p=>p.id===grant.id&&!p.revokedAt).length,0);
  assert.equal(end.pairings.length,initial.pairings.length+1,'Renewal creates no extra linked device');
  assert.equal(sourceRevision(repo).sourceDigest,before.sourceDigest,'Source changed during acceptance');
  const receipt={executed:1,passed:1,failed:0,skipped:0,at:new Date().toISOString(),source:before,scope:'actual Desktop app renderer/preload/IPC and real HTTPS via Mac LAN address; phone UI and VPN route separate',checks:{wholeWorkspacePreload:true,realMacProcessRestart:true,stablePort:true,stableTLSIdentity:true,persistedGrant:true,noDuplicate:true,renewal:true,oldTokenRejected:true,desktopRevocation:true,providerCalls:0}};
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
} finally {agent.destroy();await close();}
