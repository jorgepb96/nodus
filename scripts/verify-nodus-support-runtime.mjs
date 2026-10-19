// Launch the independently packaged Electron runtime with synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { listPackage, extractFile } from '@electron/asar';
import { _electron } from 'playwright-core';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packed=process.platform==='darwin' ? path.join(root,'release-support',process.arch==='arm64'?'mac-arm64':'mac','nodus-support.app/Contents') : path.join(root,'release-support',process.platform==='win32'?'win-unpacked':'linux-unpacked');
const resources=path.join(packed,process.platform==='darwin'?'Resources':'resources');
const asar=path.join(resources,'app.asar');
const files=listPackage(asar).map(file=>file.replaceAll('\\','/'));
assert.ok(files.length<40,'Support must not package the normal Nodus dependency graph');
assert.ok(!files.some(file=>file.includes('/node_modules/')||file.endsWith('.node')||file.includes('application.js')));
assert.equal(JSON.parse(extractFile(asar,'package.json').toString()).name,'nodus-support');
for(const required of ['LICENSE','PRIVACY.md','SOURCE_CODE.md','THIRD_PARTY_NOTICES.md','SUPPORT_DEPENDENCY_LICENSES.txt','ELECTRON_LICENSE.txt','ELECTRON_CHROMIUM_LICENSES.html']) assert.ok(fs.existsSync(path.join(resources,'legal',required)));
const notices=fs.readFileSync(path.join(resources,'legal/SUPPORT_DEPENDENCY_LICENSES.txt'),'utf8');for(const pkg of ['react@','semver@','archiver@','yauzl@'])assert.ok(notices.includes(pkg));
const scratch=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-support-packaged-')));
const profile=path.join(scratch,'profile');fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'app-prefs.json'),'{}');
const executable=path.join(packed,process.platform==='darwin'?'MacOS/nodus-support':process.platform==='win32'?'nodus-support.exe':'nodus-support');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:executable,args:['--support-retained=1',`--support-state=${path.join(scratch,'support')}`,`--nodus-profile=${profile}`],env,timeout:60000});
try {
  const page=await app.firstWindow();await page.locator('h1').waitFor();
  const state=await page.evaluate(()=>window.nodusSupport.inspect());
  assert.equal(state.inspection.profile,profile);assert.equal(fs.readFileSync(path.join(profile,'app-prefs.json'),'utf8'),'{}');
  console.log(`Independent Nodus Support runtime passed: ${process.platform}/${process.arch}, ${files.length} packaged entries, no main-app modules.`);
} finally { await app.close(); }
