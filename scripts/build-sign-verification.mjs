// Focused local verification build. CI/release still uses the full npm run build.
// Reuse the production Vite config while leaving unrelated Electron workers alone.
import { build as viteBuild, loadConfigFromFile } from 'vite';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { config } = await loadConfigFromFile({ command: 'build', mode: 'production' });
async function flatten(value) {
  value = await value;
  return Array.isArray(value) ? (await Promise.all(value.map(flatten))).flat() : value ? [value] : [];
}
const plugins = (await flatten(config.plugins)).filter(plugin => plugin.name !== 'vite-plugin-electron');
await viteBuild({ ...config, configFile: false, plugins, build: { ...config.build, reportCompressedSize: false } });
const { MAIN_PROCESS_EXTERNALS } = require('../build/packagedNodeModules.cjs');
const common = { bundle: true, platform: 'node', target: 'node22', external: MAIN_PROCESS_EXTERNALS, alias: { '@shared': process.cwd() + '/shared' }, logLevel: 'info' };
await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/application.js', format: 'esm', banner: { js: "import{fileURLToPath as __nodusFU}from'node:url';import{dirname as __nodusDN}from'node:path';import{createRequire as __nodusCR}from'node:module';const __filename=__nodusFU(import.meta.url);const __dirname=__nodusDN(__filename);const require=__nodusCR(import.meta.url);" } });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', format: 'cjs' });
