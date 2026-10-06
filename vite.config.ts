import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import electronPlugin from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';
import { createRequire } from 'node:module';

// graphology and sigma ship CJS builds that `require('events')` (a Node
// builtin). Vite's dev optimizer externalizes builtins for the browser, which
// surfaces as a runtime "Dynamic require of 'events' is not supported" crash.
// Resolve `events` to the installed browser polyfill so it gets bundled instead.
const require = createRequire(import.meta.url);
const eventsPolyfill = require.resolve('events/');
const pkg = require('./package.json') as { version: string };

const databaseComputeWorkerAliases = () => ({
  name: 'database-compute-worker-aliases',
  enforce: 'pre' as const,
  resolveId(source: string, _importer?: string) {
    // This plugin is installed only in the standalone calculation-worker build, so
    // every database accessor in that graph must resolve to the authorized worker
    // connection (query suffixes may be normalized before resolveId runs).
    if (source === './database' || source === '../db/database') return path.resolve(__dirname, 'electron/db/databaseComputeRuntime.ts');
    if (source === './crossVault') return path.resolve(__dirname, 'electron/db/crossVaultComputeStub.ts');
    return null;
  },
});

// Native node modules and Electron-only deps must stay external in the main process bundle.
const mainExternals = [
  'better-sqlite3',
  'electron',
  'pdfjs-dist',
  'mammoth',
  'word-extractor',
  'xlsx',
  'adm-zip',
  'tesseract.js',
  '@napi-rs/canvas',
  'sharp',
  'heic-decode',
  '@anthropic-ai/sdk',
  '@google/genai',
  '@huggingface/transformers',
  '@nodus/embeddinggemma-transformers',
  // ws (pulled in by the SDKs above) optionally requires these native addons via
  // try/catch; keep them external so that fallback works instead of the bundler
  // hard-failing to resolve an uninstalled optional dependency.
  'ws',
  'selfsigned',
  'bufferutil',
  'utf-8-validate',
  '@modelcontextprotocol/sdk',
  '@modelcontextprotocol/sdk/server/mcp.js',
  '@modelcontextprotocol/sdk/server/streamableHttp.js',
  '@modelcontextprotocol/sdk/types.js',
  '@github/copilot-sdk',
  'openai',
  'electron-updater',
  // Turndown picks its HTML parser at module-evaluation time: with no `window` — i.e.
  // in the main process — it takes the Node branch, which is a bare
  // `require('@mixmark-io/domino')`. Bundled into an ESM chunk that call throws
  // "require is not defined in ES module scope" the moment the chunk is imported,
  // which took down the whole Zotero note-mirroring step. Kept external so it loads
  // as the real CommonJS package, where the require resolves normally.
  'turndown',
  '@mixmark-io/domino',
  // Chemistry Studio loads node-tikzjax's WASM and TeX tree from the package at
  // runtime. Keeping both chemistry dependencies external preserves those paths
  // and avoids embedding OpenChemLib's large pure-JS bundle in the main chunk.
  'node-tikzjax',
  'openchemlib',
  '@rdkit/rdkit',
];

/**
 * One preload build, emitting `<name>.cjs` into dist-electron.
 *
 * Each window class gets its OWN build rather than sharing one multi-entry build,
 * and the reason is `sandbox: true`: a sandboxed preload's `require` only resolves
 * electron and a couple of builtins, so it cannot load a sibling chunk. Rollup
 * splits shared code out the moment a build has two entries, which is exactly what
 * `inlineDynamicImports` prevents — and rollup rejects that flag with more than one
 * entry. Separate builds keep every preload a single self-contained file.
 *
 * `onstart` mirrors what vite-plugin-electron/simple does for its own preload:
 * reload the renderer instead of spawning another Electron instance in dev.
 */
const preloadBuild = (name: string, entry: string) => ({
  onstart: (args: { reload: () => void }) => args.reload(),
  vite: {
    // The top-level resolve.alias only applies to the renderer build.
    resolve: {
      alias: { '@shared': path.resolve(__dirname, 'shared') },
    },
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: { [name]: path.join(__dirname, entry) },
        external: mainExternals,
        // CommonJS: Electron loads a .cjs preload unambiguously as CJS, which is far
        // more reliable in packaged apps than an ESM (.mjs) one.
        output: { format: 'cjs' as const, entryFileNames: '[name].cjs', inlineDynamicImports: true },
      },
    },
  },
});

const databaseComputeWorkerBuild = {
  onstart: (args: { reload: () => void }) => args.reload(),
  vite: {
    plugins: [databaseComputeWorkerAliases()],
    resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } },
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: path.join(__dirname, 'electron/workers/databaseComputeWorker.ts'),
        external: mainExternals,
        // worker_threads in Electron cannot translate native CommonJS addons from an
        // ESM worker reliably. A self-contained CJS entry loads better-sqlite3 through
        // Node's native require path and keeps the worker independent from main chunks.
        output: { format: 'cjs' as const, entryFileNames: 'databaseComputeWorker.cjs', inlineDynamicImports: true },
      },
    },
  },
};

const databaseScaleFixtureWorkerBuild = {
  onstart: (args: { reload: () => void }) => args.reload(),
  vite: {
    plugins: [databaseComputeWorkerAliases()],
    resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } },
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: path.join(__dirname, 'electron/workers/databaseScaleFixtureWorker.ts'),
        external: mainExternals,
        output: { format: 'cjs' as const, entryFileNames: 'databaseScaleFixtureWorker.cjs', inlineDynamicImports: true },
      },
    },
  },
};

const databaseAggregateWorkerBuild = {
  onstart: (args: { reload: () => void }) => args.reload(),
  vite: {
    plugins: [databaseComputeWorkerAliases()],
    resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } },
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: path.join(__dirname, 'electron/workers/databaseAggregateWorker.ts'),
        external: mainExternals,
        output: { format: 'cjs' as const, entryFileNames: 'databaseAggregateWorker.cjs', inlineDynamicImports: true },
      },
    },
  },
};

const databaseDeepResearchWorkerBuild = {
  onstart: (args: { reload: () => void }) => args.reload(),
  vite: {
    plugins: [databaseComputeWorkerAliases()],
    resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } },
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: path.join(__dirname, 'electron/workers/databaseDeepResearchWorker.ts'),
        external: mainExternals,
        output: { format: 'cjs' as const, entryFileNames: 'databaseDeepResearchWorker.cjs', inlineDynamicImports: true },
      },
    },
  },
};

const vectorScanWorkerBuild = {
  onstart: (args: { reload: () => void }) => args.reload(),
  vite: {
    resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } },
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: path.join(__dirname, 'electron/workers/vectorScanWorker.ts'),
        external: mainExternals,
        output: { format: 'cjs' as const, entryFileNames: 'vectorScanWorker.cjs', inlineDynamicImports: true },
      },
    },
  },
};

/** A utility process must not share Rollup chunks with Electron's main entry: a shared
 * chunk may pull `app`/`BrowserWindow` imports into a process where Electron does not
 * expose them. Build it as one self-contained ESM file instead. */
const utilityBuild = (name: string, entry: string) => ({
  onstart: (args: { reload: () => void }) => args.reload(),
  vite: {
    resolve: {
      alias: { '@shared': path.resolve(__dirname, 'shared') },
    },
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: { [name]: path.join(__dirname, entry) },
        external: mainExternals,
        output: {
          format: 'es' as const,
          entryFileNames: '[name].js',
          inlineDynamicImports: true,
          banner:
            "import{fileURLToPath as __nodusFU}from'node:url';import{dirname as __nodusDN}from'node:path';" +
            'const __filename=__nodusFU(import.meta.url);const __dirname=__nodusDN(__filename);',
        },
      },
    },
  },
});

export default defineConfig({
  // Expose the app version to the renderer at build time (shown in Settings).
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Renderer entries: the main app (index.html), the standalone Nodi overlay
  // (mascot.html), and the two PDF Presenter windows (audience + presenter view),
  // each a lean standalone bundle loaded into its own BrowserWindow.
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        documentFigure: path.resolve(__dirname, 'documentFigure.html'),
        mascot: path.resolve(__dirname, 'mascot.html'),
        presenterAudience: path.resolve(__dirname, 'presenterAudience.html'),
        presenterView: path.resolve(__dirname, 'presenterView.html'),
        presenterRemote: path.resolve(__dirname, 'presenterRemote.html'),
      },
    },
  },
  resolve: {
    // One KaTeX for the whole renderer: rehype-katex otherwise bundles its own copy,
    // and the mhchem extension (\ce{} in chemistry) registers on the instance that
    // imports it, which then never renders.
    dedupe: ['katex'],
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      events: eventsPolyfill,
      // Use kokoro-js's self-contained browser bundle for local TTS. Its default
      // entry pulls in @huggingface/transformers, which vite-plugin-electron-
      // renderer resolves to a Node build that `require('path')` — unsupported in
      // the sandboxed renderer. The web bundle inlines the WASM transformers build
      // and has no node-builtin requires.
      'kokoro-js': path.resolve(__dirname, 'node_modules/kokoro-js/dist/kokoro.web.js'),
    },
  },
  // The TTS worker (src/lib/audio/tts.worker.ts) lazy-imports vits-web / kokoro-js,
  // so its bundle is code-split — which Rollup only allows with the ES output
  // format. This also matches the `{ type: 'module' }` worker we instantiate.
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Pre-bundle the WebGL graph stack (incl. the FA2 worker subpath, which the
    // dep scanner misses) so CJS→ESM interop is handled at optimize time.
    include: [
      'sigma',
      'graphology',
      'graphology-layout-forceatlas2',
      'graphology-layout-forceatlas2/worker',
      'events',
    ],
  },
  plugins: [
    react(),
    electron({
      main: {
        // computeWorker.ts is a worker_threads entry: it must land in
        // dist-electron as its own file (computeWorker.js) so the main process
        // can spawn it with `new Worker(...)`.
        // Use named entries rather than a positional array. Besides keeping the
        // packaged filenames stable, this prevents Rollup from coalescing
        // worker entries that share most of their Library dependency graph.
        entry: {
          main: 'electron/bootstrap.ts',
          application: 'electron/main.ts',
          documentaryChunkWorker: 'electron/workers/documentaryChunkWorker.ts',
          backgroundUtility: 'electron/workers/backgroundUtility.ts',
          documentaryRetrievalWorker: 'electron/workers/documentaryRetrievalWorker.ts',
          documentaryMaintenanceWorker: 'electron/workers/documentaryMaintenanceWorker.ts',
          computeWorker: 'electron/workers/computeWorker.ts',
          libraryExtractionWorker: 'electron/workers/libraryExtractionWorker.ts',
          libraryOperationWorker: 'electron/workers/libraryOperationWorker.ts',
          libraryReaderWorker: 'electron/workers/libraryReaderWorker.ts',
          compassWorker: 'electron/workers/compassWorker.ts',
          webExtractionWorker: 'electron/workers/webExtractionWorker.ts',
        },
        vite: {
          // The top-level resolve.alias only applies to the renderer build;
          // main-process code importing @shared at RUNTIME needs its own copy.
          resolve: {
            alias: { '@shared': path.resolve(__dirname, 'shared') },
          },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: mainExternals,
              output: {
                // package.json is "type":"module", so the main bundle is ESM and lacks
                // __dirname/__filename. Re-create them from import.meta.url.
                banner:
                  "import{fileURLToPath as __nodusFU}from'node:url';import{dirname as __nodusDN}from'node:path';" +
                  'const __filename=__nodusFU(import.meta.url);const __dirname=__nodusDN(__filename);',
              },
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          resolve: {
            alias: { '@shared': path.resolve(__dirname, 'shared') },
          },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: mainExternals,
              // Emit a CommonJS .cjs preload: Electron loads it unambiguously as CJS,
              // which is far more reliable in packaged apps than an ESM (.mjs) preload.
              output: { format: 'cjs', entryFileNames: 'preload.cjs', inlineDynamicImports: true },
            },
          },
        },
      },
    }),
    // Nodi and the Presenter get their own preload, exposing a named subset of the
    // bridge instead of all ~1,250 methods (see shared/api/windows.ts).
    electronPlugin([
      preloadBuild('preload.nodi', 'electron/preload/nodi.ts'),
      preloadBuild('preload.presenter', 'electron/preload/presenter.ts'),
      // The Nodus Browser page preload. Unlike every other entry here it exposes
      // NOTHING on window: it is a sensor the main process drives, and the whole
      // point is that a remote website finds no bridge to reach for.
      preloadBuild('preload.browserPage', 'electron/preload/browserPage.ts'),
      databaseComputeWorkerBuild,
      databaseScaleFixtureWorkerBuild,
      databaseAggregateWorkerBuild,
      databaseDeepResearchWorkerBuild,
      vectorScanWorkerBuild,
      { ...vectorScanWorkerBuild, vite: { ...vectorScanWorkerBuild.vite, build: { ...vectorScanWorkerBuild.vite.build,
        rollupOptions: { ...vectorScanWorkerBuild.vite.build.rollupOptions,
          input: path.join(__dirname, 'electron/workers/embeddingGemma2Worker.ts'),
          output: { format: 'cjs' as const, entryFileNames: 'embeddingGemma2Worker.cjs', inlineDynamicImports: true },
        },
      } } },
      utilityBuild('backupUtilityWorker', 'electron/export/backupUtilityWorker.ts'),
      // One bootstrap for every trusted capability: a plugin ships a module, not a process.
      utilityBuild('capabilityWorkerBootstrap', 'electron/capabilities/workerBootstrap.ts'),
      utilityBuild('recoveryProbeUtilityWorker', 'electron/recovery/recoveryProbeUtilityWorker.ts'),
      utilityBuild('migrationRecoveryUtilityWorker', 'electron/db/migrationRecoveryUtilityWorker.ts'),
      utilityBuild('serverPublishWorker', 'electron/serverSync/serverPublishWorker.ts'),
    ]),
    renderer(),
  ],
});
