import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function createResearchTestRoot() {
  // Keep Unix socket paths below sockaddr_un's limit (the Darwin user temp
  // directory plus a profile suffix can already exceed it).
  const parent = process.env.NODUS_ISOLATED_ROOT
    ? path.join(fs.realpathSync(process.env.NODUS_ISOLATED_ROOT), 'tmp')
    : process.platform === 'darwin' ? '/private/tmp' : os.tmpdir();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(parent, 'nodus-research-')));
  fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify({
    format: 'nodus.isolated-research-profile/1', root,
  }), { mode: 0o600 });
  for (const name of ['profile', 'tmp', 'library', 'fixtures', 'artifacts', 'zotero', 'mcp']) {
    fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  }
  return root;
}

/** Construct from an allowlist; never inherit provider keys, proxies or NODE_OPTIONS. */
export function researchTestEnvironment(root) {
  const env = {};
  for (const name of ['PATH', 'LANG', 'LC_ALL', 'DISPLAY', 'XAUTHORITY', 'SystemRoot', 'WINDIR']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { ...env, XDG_CONFIG_HOME: path.join(root, 'profile/config'), XDG_CACHE_HOME: path.join(root, 'profile/cache'),
    NODUS_ISOLATED_ROOT: root, NODUS_USERDATA: path.join(root, 'profile'),
    NODUS_ZOTERO_SQLITE: path.join(root, 'fixtures/no-production-zotero.sqlite'),
    // No test may silently fall back to the user's running Zotero on 23119.
    NODUS_ZOTERO_API_BASE: 'http://127.0.0.1:1/api',
    NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available',
    TMPDIR: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), TEMP: path.join(root, 'tmp') };
}

export function macResearchSandbox(root, allowedLoopbackPorts = []) {
  if (!Array.isArray(allowedLoopbackPorts) || allowedLoopbackPorts.some(port => !Number.isInteger(port) || port < 1024 || port > 65535 || port === 23119)) throw new Error('Only explicit disposable loopback ports are allowed');
  if (process.platform !== 'darwin') throw new Error('Use a disposable native test environment on this platform');
  const quoted = JSON.stringify(fs.realpathSync(root));
  const productionRoots = [
    path.join(os.homedir(), 'Library/Application Support/Nodus'),
    path.join(os.homedir(), 'Library/Application Support/nodus'),
    path.join(os.homedir(), 'Library/Application Support/Zotero'),
    path.join(os.homedir(), 'Zotero'),
    path.join(os.homedir(), '.config/zotero-mcp'),
    path.join(os.homedir(), '.cache/zotero-mcp'),
  ];
  // The descendants inherit the OS sandbox. /dev/null is the sole writable device.
  return `(version 1)\n(allow default)\n` +
    `(deny file-write* (require-not (require-any (subpath ${quoted}) (literal "/dev/null"))))\n` +
    productionRoots.map(value => `(deny file-read* (subpath ${JSON.stringify(value)}))`).join('\n') + '\n' +
    '(deny network-outbound)\n' +
    [...new Set(allowedLoopbackPorts)].map(port => `(allow network-outbound (remote tcp "localhost:${port}"))`).join('\n') + '\n';
}

export function verifyResearchSandbox(root, profile = macResearchSandbox(root)) {
  // TMPDIR may itself be confined to root. The denial probe must remain outside
  // that root even when this verifier runs from an already isolated preparer.
  const outside = fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/private/tmp' : path.dirname(root), 'nodus-sandbox-sentinel-'));
  const canary = path.join(outside, 'sentinel');
  const inside = path.join(root, 'tmp', 'allowed');
  fs.writeFileSync(canary, 'unchanged');
  try {
    const result = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e',
      'const fs=require("node:fs");fs.writeFileSync(process.argv[1],"allowed");try{fs.writeFileSync(process.argv[2],"changed");process.exit(2)}catch(e){if(e.code!=="EPERM"&&e.code!=="EACCES")throw e}',
      inside, canary], { env: researchTestEnvironment(root), encoding: 'utf8' });
    if (result.status !== 0 || fs.readFileSync(canary, 'utf8') !== 'unchanged'
        || fs.readFileSync(inside, 'utf8') !== 'allowed') {
      throw new Error(`OS isolation verification failed: ${result.stderr || result.error || result.status}`);
    }
    const descendant = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e',
      `const cp=require('node:child_process');const r=cp.spawnSync(process.execPath,['-e','try{require("node:fs").writeFileSync(process.argv[1],"changed");process.exit(2)}catch(e){if(!["EPERM","EACCES"].includes(e.code))throw e}',process.argv[1]]);process.exit(r.status??3)`,
      canary], { env: researchTestEnvironment(root), encoding: 'utf8' });
    if (descendant.status !== 0 || fs.readFileSync(canary, 'utf8') !== 'unchanged') throw new Error('Descendant OS write isolation failed');
    const networkProbe = `const net=require('node:net');
      Promise.all([['203.0.113.1',443],['127.0.0.1',31991],['::1',31991]].map(([host,port])=>new Promise((resolve,reject)=>{
        const socket=net.createConnection({host,port});
        const timer=setTimeout(()=>{socket.destroy();reject(new Error('denial_not_proven'))},3000);
        socket.once('connect',()=>{clearTimeout(timer);socket.destroy();reject(new Error('unauthorized_connection:'+host+':'+port))});
        socket.once('error',error=>{clearTimeout(timer);socket.destroy();['EPERM','EACCES'].includes(error.code)?resolve():reject(error)});
      }))).catch(error=>{console.error(error.code ?? error.message);process.exitCode=4});`;
    // Probe a disposable unlisted port, never the user's Zotero. Both IPv4 and
    // IPv6 localhost endpoints must remain denied by the default policy.
    if (profile.includes('localhost:31991')) throw new Error('Probe port must not be allowed');
    const network = spawnSync('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', networkProbe], {
      env: researchTestEnvironment(root), encoding: 'utf8', timeout: 5000 });
    if (network.status !== 0) throw new Error(`OS network denial not verified: ${network.stderr || network.error || network.status}`);
    return { writeInsideAllowed: true, writeOutsideDenied: true, descendantWriteDenied: true, externalNetworkDenied: true, forbiddenLoopbackPortDenied: true };
  } finally { fs.rmSync(outside, { recursive: true, force: true }); }
}
