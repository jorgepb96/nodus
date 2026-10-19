import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { bundleSupportLicenses } from './lib/supportLicenses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const output = path.join(root, 'build/support-app');
fs.mkdirSync(output, { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'apps/nodus-support/package.json'), 'utf8'));
pkg.version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify(pkg, null, 2));
const main=await build({ metafile:true,entryPoints: [path.join(root, 'apps/nodus-support/main.mjs')], outfile: path.join(output, 'main.mjs'), platform: 'node', format: 'esm', target: 'node22', bundle: true, external: ['electron'],
  banner: { js: 'import{createRequire as __supportRequire}from"node:module";import{fileURLToPath as __supportFile}from"node:url";import{dirname as __supportDir}from"node:path";const require=__supportRequire(import.meta.url);const __dirname=__supportDir(__supportFile(import.meta.url));' } });
const preload=await build({ metafile:true,entryPoints: [path.join(root, 'apps/nodus-support/preload.ts')], outfile: path.join(output, 'preload.cjs'), platform: 'node', format: 'cjs', bundle: true, external: ['electron'] });
const ui=await build({ metafile:true,entryPoints: [path.join(root, 'apps/nodus-support/ui/App.tsx')], outfile: path.join(output, 'ui/app.js'), platform: 'browser', format: 'esm', bundle: true, minify: true, loader: { '.svg': 'dataurl' }, define: { 'process.env.NODE_ENV': '"production"' } });
bundleSupportLicenses(root,output,[main.metafile,preload.metafile,ui.metafile],{runtime:process.argv.includes('--runtime')||process.argv.includes('--artifacts')});
fs.copyFileSync(path.join(root, 'apps/nodus-support/ui/index.html'), path.join(output, 'ui/index.html'));
fs.copyFileSync(path.join(root, 'apps/nodus-support/assets/icon.png'), path.join(output, 'icon.png'));
console.log(`Nodus Support ${pkg.version} built independently of the application graph.`);
if (process.argv.includes('--runtime') || process.argv.includes('--artifacts')) {
  const builder = require.resolve('electron-builder/cli.js');
  const args = [builder, '--config', 'apps/nodus-support/electron-builder.config.cjs', '--publish', 'never', ...(process.argv.includes('--runtime') ? ['--dir'] : [])];
  const result = spawnSync(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
