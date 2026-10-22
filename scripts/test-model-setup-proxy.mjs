// A real Chromium network stack must use the configured proxy. The .invalid hosts below
// cannot work through a direct connection, and the proxy serves only synthetic fixtures.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { bundleModelSetup } from './lib/model-setup-fixture.mjs';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('real Electron routes model catalogues and verified downloads through a proxy without cookies; local providers stay direct', { timeout: 45_000 }, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-model-proxy-'));
  const body = Buffer.from('synthetic verified model bytes '.repeat(4000));
  const sha = createHash('sha256').update(body).digest('hex');
  const seen = [];
  const proxy = createServer((req, res) => {
    seen.push({ url: req.url, cookie: req.headers.cookie, auth: req.headers.authorization, range: req.headers.range });
    if (req.url === 'http://models.nodus.invalid/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'response-cookie=private; Path=/' });
      res.end(JSON.stringify({ data: [{ id: 'proxy-model' }] }));
    } else if (req.url === 'http://assets.nodus.invalid/redirect') {
      res.writeHead(302, { location: 'http://cdn.nodus.invalid/asset' }); res.end();
    } else if (req.url === 'http://cdn.nodus.invalid/asset') {
      const start = Number(/bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0);
      res.writeHead(start ? 206 : 200, { 'content-length': body.length - start, ...(start ? { 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` } : {}) });
      res.end(body.subarray(start));
    } else { res.writeHead(502); res.end('unexpected proxy destination'); }
  });
  const direct = createServer((req, res) => {
    if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'local-model' }] }));
    else if (req.url === '/api/v0/models') res.end(JSON.stringify({ data: [{ id: 'local-model', type: 'llm' }] }));
    else res.end(body);
  });
  try {
    const bundle = await bundleModelSetup(repo, tmp);
    await mkdir(path.join(tmp, 'profile'));
    await mkdir(path.join(tmp, 'session'));
    proxy.listen(0, '127.0.0.1'); direct.listen(0, '127.0.0.1');
    await Promise.all([once(proxy, 'listening'), once(direct, 'listening')]);
    const port = proxy.address().port;
    const directBase = `http://127.0.0.1:${direct.address().port}`;
    const script = path.join(tmp, 'verify.cjs');
    await writeFile(script, `
      const assert = require('node:assert/strict');
      const { app, session } = require('electron');
      const fs = require('node:fs/promises');
      const path = require('node:path');
      app.setName('Nodus Model Setup Test');
      app.setPath('userData', ${JSON.stringify(path.join(tmp, 'profile'))});
      app.setPath('sessionData', ${JSON.stringify(path.join(tmp, 'session'))});
      app.commandLine.appendSwitch('no-sandbox');
      app.whenReady().then(async () => {
        app.dock?.hide();
        const setup = require(${JSON.stringify(bundle)});
        const ses = session.defaultSession;
        await ses.setProxy({mode:'fixed_servers',proxyRules:'http=127.0.0.1:${port};https=127.0.0.1:${port}',proxyBypassRules:'<-loopback>'});
        // A newly created session can still resolve DIRECT after setProxy resolves.
        // Flush Chromium's proxy service before asserting or exercising production fetches.
        // https://github.com/electron/electron/issues/26166
        await ses.forceReloadProxyConfig();
        assert.equal(await ses.resolveProxy('http://models.nodus.invalid'), 'PROXY 127.0.0.1:${port}');
        await ses.cookies.set({ url:'http://models.nodus.invalid', name:'private-cookie', value:'must-not-travel' });
        globalThis.modelSetupSettings = {customProvider:{baseUrl:'http://models.nodus.invalid/v1',models:[]},localProviders:{ollama:{baseUrl:${JSON.stringify(directBase)}},lmstudio:{baseUrl:${JSON.stringify(directBase)}}}};
        assert.equal((await setup.listModels('custom','synthetic-key'))[0].id,'proxy-model');
        assert.equal((await ses.cookies.get({name:'response-cookie'})).length,0,'response cookies are not persisted');
        const file = path.join(${JSON.stringify(tmp)},'model.bin');
        const bytes = Buffer.from(${JSON.stringify(body.toString('base64'))},'base64');
        await fs.writeFile(file+'.download',bytes.subarray(0,1234));
        await setup.downloadVerifiedNodusAsset('http://assets.nodus.invalid/redirect',file,bytes.length,${JSON.stringify(sha)},()=>{});
        assert.deepEqual(await fs.readFile(file),bytes);
        for (const provider of ['ollama','lmstudio']) assert.equal((await setup.listModels(provider,null))[0].id,'local-model');
        await ses.setProxy({mode:'direct'});
        await ses.forceReloadProxyConfig();
        await ses.closeAllConnections();
        assert.equal(await ses.resolveProxy(${JSON.stringify(directBase + '/asset')}), 'DIRECT');
        await setup.downloadVerifiedNodusAsset(${JSON.stringify(directBase + '/asset')},path.join(${JSON.stringify(tmp)},'direct.bin'),bytes.length,${JSON.stringify(sha)},()=>{});
        console.log('MODEL_SETUP_PROXY_OK '+JSON.stringify({electron:process.versions.electron,proxyCatalogue:true,proxyDownload:true,redirectAndRange:true,localProviders:true,directDownload:true,cookiesOmitted:true}));
        app.quit();
      }).catch(error=>{console.error(error);app.exit(1);});
    `);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { stdout } = await promisify(execFile)(require('electron'), [script], { env, timeout: 35_000, maxBuffer: 2 * 1024 * 1024 });
    assert.match(stdout, /MODEL_SETUP_PROXY_OK/);
    console.log(stdout.trim());
    assert.equal(seen.length, 3, JSON.stringify(seen));
    assert.equal(seen[0].auth, 'Bearer synthetic-key');
    assert.equal(seen[2].range, 'bytes=1234-');
    assert.ok(seen.every(req => !req.cookie), 'no browser cookie reaches model servers');
  } finally {
    proxy.closeAllConnections(); direct.closeAllConnections();
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => direct.close(resolve))]);
    await rm(tmp, { recursive: true, force: true });
  }
});
