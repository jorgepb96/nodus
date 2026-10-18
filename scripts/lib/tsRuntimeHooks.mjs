// Run the app's TypeScript modules straight from a test, under Electron-as-Node.
//
// Several suites need to drive REAL production code — the repositories, the graph service,
// the snapshot builder — rather than a re-implementation of it, and that code is TypeScript
// that imports `electron` and `@shared/*`. This installs the three hooks that make a bare
// `require('electron/db/whatever.ts')` work:
//
//   • `@shared/x` resolves to shared/x.ts, or shared/x/index.ts for a barrel;
//   • `electron` resolves to a stub with just the surface the main process touches;
//   • `.ts` files are transpiled on demand by the TypeScript compiler already in devDeps.
//
// Extracted from scripts/test-mcp.mjs, which was the only holder of it. Any suite that
// wants the real thing rather than a copy of it should call this instead of growing a
// second, subtly different version.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

export function installRuntimeHooks(userDataPath, overrides = {}) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const originalTsLoader = require.extensions['.ts'];
  const electronStub = {
    app: {
      getPath(name) {
        if (name === 'userData' || name === 'temp' || name === 'documents') return userDataPath;
        return userDataPath;
      },
      getVersion() {
        return '0.0.0-test';
      },
      getAppPath() {
        return repoRoot;
      },
      focus() {},
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable() {
        return false;
      },
      encryptString(value) {
        return Buffer.from(String(value), 'utf8');
      },
      decryptString(value) {
        return Buffer.from(value).toString('utf8');
      },
    },
    dialog: {},
    shell: {},
    // The Deep Research lane broadcasts its queue to every window; with none open
    // (as here) that is an empty sweep, exactly as in the real app before first paint.
    BrowserWindow: class {
      static getAllWindows() {
        return [];
      }
    },
    ...overrides,
  };

  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      // A shared entry is either a file (shared/x.ts) or a directory barrel
      // (shared/x/index.ts) — fall back to the index so a package-style import resolves.
      const base = path.join(repoRoot, request.replace('@shared/', 'shared/'));
      if (/\.(?:mjs|json)$/.test(base)) return originalResolveFilename.call(this, base, parent, isMain, options);
      const asFile = `${base}.ts`;
      return fs.existsSync(asFile) ? asFile : path.join(base, 'index.ts');
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    // TypeScript intentionally preserves `import.meta` when transpiling to CommonJS,
    // but Node cannot even parse that token in the Electron-as-Node test runtime.
    // Resolve the standard `import.meta.url` expression before transpilation so the
    // exact production module can be exercised under both module systems.
    const source = fs.readFileSync(filename, 'utf8')
      .replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(filename).href));
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };

  return Object.assign(electronStub, {restore() {
    Module._resolveFilename = originalResolveFilename;
    Module._load = originalLoad;
    if (originalTsLoader) require.extensions['.ts'] = originalTsLoader;
    else delete require.extensions['.ts'];
  }});
}

/**
 * Re-exec the current script under Electron-as-Node unless it is already there.
 *
 * better-sqlite3 is a native module built against Electron's ABI, so a test that opens a
 * real database has to run inside Electron's Node or it fails to load at all.
 */
export function requireElectronRuntime(scriptPath, flag) {
  if (process.argv.includes(flag)) return true;
  const { execFileSync } = require('node:child_process');
  const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  // This child is not the test runner's IPC worker. Inheriting its private
  // context writes binary test events into ordinary stdout and hides failures.
  delete environment.NODE_TEST_CONTEXT;
  execFileSync(
    require('electron'),
    [scriptPath, flag],
    { cwd: repoRoot, env: environment, stdio: 'inherit' }
  );
  return false;
}

export { repoRoot };
