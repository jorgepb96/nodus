import { build } from 'esbuild';
import path from 'node:path';
import { symlink } from 'node:fs/promises';

/** Bundle production setup code; only settings/profile metadata comes from a fixture. */
export async function bundleModelSetup(repo, tmp) {
  await symlink(path.join(repo, 'node_modules'), path.join(tmp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const outfile = path.join(tmp, 'model-setup.cjs');
  await build({
    stdin: { contents: `
      export { downloadVerifiedNodusAsset } from ${JSON.stringify(path.join(repo, 'electron/ai/nodusLocalAi.ts'))};
      export { fetchModelResource, modelResourceError } from ${JSON.stringify(path.join(repo, 'electron/network/modelResource.ts'))};
      export { listModels } from ${JSON.stringify(path.join(repo, 'electron/ai/providers.ts'))};
      export { localizeRuntimeError } from ${JSON.stringify(path.join(repo, 'shared/uiLanguage.ts'))};
    `, resolveDir: repo, loader: 'ts' },
    outfile, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent',
    alias: { '@shared': path.join(repo, 'shared') },
    external: ['electron', '@huggingface/transformers', '@nodus/embeddinggemma-transformers'],
    plugins: [{ name: 'fixture-settings', setup(b) {
      b.onResolve({ filter: /(?:^|\/)settingsRepo$/ }, () => ({ path: 'settings', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const getSettings = () => globalThis.modelSetupSettings ?? {};', loader: 'js' }));
    } }],
  });
  return outfile;
}
