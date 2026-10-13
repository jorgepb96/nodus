// What the packaged app carries from node_modules.
//
// electron-builder copies every production dependency into app.asar, yet most of
// them never run from there. Vite has already bundled the renderer — React,
// BlockNote, MathJax, three, the ONNX web runtimes, the speech voices — into
// dist/, and the main-side bundles in dist-electron import only the packages they
// leave external. Shipping the rest a second time is how 5.9.1 came to weigh
// 2.4 GB on disk with ~800 MB of node_modules nothing ever loads.
//
// So the packaged node_modules is the runtime closure of:
//   - MAIN_PROCESS_EXTERNALS: what every main, preload and worker build leaves to
//     runtime resolution (vite.config.ts takes this very array, so the bundler and
//     the packager cannot disagree about it);
//   - RUNTIME_RESOLVED_SPECIFIERS: what the main process locates by name at
//     runtime instead of importing;
// followed through dependencies, optionalDependencies and peerDependencies in
// package-lock.json the way Node resolves them. Every other production package is
// excluded with a negative `files` pattern.
//
// The renderer's dependencies stay production dependencies on purpose: they are
// still distributed, inside the renderer bundle, and the third-party notices are
// generated from the production tree (scripts/generate-third-party-licenses.mjs).
//
// The packed app itself is then checked by scripts/verify-packaged-node-modules.cjs:
// every package the packed dist-electron names must be inside it, and must load in
// the packaged runtime.
const { builtinModules } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');

// Native node modules and Electron-only deps must stay external in the main process bundle.
const MAIN_PROCESS_EXTERNALS = [
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

// Located with require.resolve rather than imported, so no bundler sees them.
// Exactly the specifiers the code resolves:
//   pagedjs         — academicExport injects its polyfill file into a print window;
//   @openai/codex   — codexSubscription spawns the binary of its platform package;
//   @github/copilot — githubCopilotSubscription spawns the binary of its platform package;
//   harfbuzzjs      — subset-font, bundled into main for the CJK subsets of exported
//                     PDFs, reads its WebAssembly by path.
const RUNTIME_RESOLVED_SPECIFIERS = [
  'pagedjs',
  '@openai/codex/package.json',
  '@github/copilot/package.json',
  'harfbuzzjs/hb-subset.wasm',
];

// Declared dependencies a package never loads in Node. transformers lists
// onnxruntime-web for its browser build only: dist/transformers.node.{mjs,cjs},
// the files its "node" export condition selects, import onnxruntime-node and
// onnxruntime-common and nothing of the web runtime. Held against the installed
// files by scripts/test-packaged-node-modules.mjs.
const BROWSER_ONLY_DEPENDENCIES = {
  '@huggingface/transformers': ['onnxruntime-web'],
};

// The reverse: packages a package imports without declaring them, and so gets
// only because npm happened to install them where Node finds them. Those same
// node builds of transformers import "onnxruntime-common" — the copy npm nests
// under transformers for onnxruntime-web — and would fail to load without it.
const UNDECLARED_DEPENDENCIES = {
  '@huggingface/transformers': ['onnxruntime-common'],
};

// Files inside packages that ARE loaded, but that the packaged app never reads.
// `${platform}` and `${arch}` are electron-builder macros: the host platform (the
// build is always native) and the architecture being packed.
const UNUSED_PACKAGE_FILES = [
  // Nothing enables source maps at runtime; they were 80 MB of the kept packages.
  '!node_modules/**/*.{js,mjs,cjs,css}.map',
  // onnxruntime-node carries its native library for every platform and
  // architecture in one package (~110 MB of it foreign to any given build).
  '!node_modules/onnxruntime-node/bin/napi-v3/!(${platform}){,/**}',
  '!node_modules/onnxruntime-node/bin/napi-v3/${platform}/!(${arch}){,/**}',
  // The browser builds of transformers, and a 21 MB copy of the ONNX web runtime.
  // The renderer bundles its own copy into dist/; main loads only the Node builds.
  '!node_modules/@huggingface/transformers/dist/!(transformers.node.mjs|transformers.node.cjs)',
  // SQLite's C sources, used only to compile the addon.
  '!node_modules/better-sqlite3/{deps,src}{,/**}',
];

// The vendor CLIs behind the subscription providers: OpenAI's Codex and GitHub's
// Copilot, ~540 MB of a macOS app between them. They stay production dependencies —
// development runs them from node_modules — but installers leave their platform
// packages out, and electron/ai/agentRuntime.ts downloads the one it needs the first
// time the provider is used, checked against the integrity in agentRuntimeManifest().
const ON_DEMAND_PACKAGE = /^@openai\/codex-(?:darwin|linux|win32)-[a-z0-9]+$|^@github\/copilot-(?:darwin|linux|linuxmusl|win32)-[a-z0-9]+$/;
const ON_DEMAND_PACKAGE_FILES = [
  '!**/node_modules/@openai/codex-{darwin,linux,win32}-*{,/**}',
  '!**/node_modules/@github/copilot-{darwin,linux,linuxmusl,win32}-*{,/**}',
];
const AGENT_RUNTIME_MANIFEST = 'agent-runtimes.json';

/** `@scope/name/sub/path` → `@scope/name`; `name/sub` → `name`. */
function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** The package name a lock path installs: the segment after its last node_modules/. */
function packageNameAt(lockPath) {
  return packageNameOf(lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length));
}

/** The lock path of the package that contains a nested lock path, or '' at the top. */
function parentLockPath(lockPath) {
  const index = lockPath.lastIndexOf('/node_modules/');
  return index === -1 ? '' : lockPath.slice(0, index);
}

/** Node's resolution, over package-lock.json paths instead of the disk. */
function resolveLockPath(packages, fromPath, name) {
  for (let directory = fromPath; ; directory = parentLockPath(directory)) {
    const candidate = directory ? `${directory}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!directory) return null;
  }
}

function readLockPackages(root = repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages ?? {};
}

/** Every lock path the packaged main process can load. */
function runtimePackagePaths(packages = readLockPackages()) {
  const roots = [...MAIN_PROCESS_EXTERNALS, ...RUNTIME_RESOLVED_SPECIFIERS].map(packageNameOf);
  const pending = roots.map((name) => resolveLockPath(packages, '', name)).filter(Boolean);
  const reached = new Set();
  while (pending.length > 0) {
    const at = pending.pop();
    if (reached.has(at)) continue;
    reached.add(at);
    const metadata = packages[at];
    const packageName = packageNameAt(at);
    const ignored = BROWSER_ONLY_DEPENDENCIES[packageName] ?? [];
    const names = [
      ...Object.keys({ ...metadata.dependencies, ...metadata.optionalDependencies, ...metadata.peerDependencies }),
      ...(UNDECLARED_DEPENDENCIES[packageName] ?? []),
    ];
    for (const name of names) {
      if (ignored.includes(name)) continue;
      const resolved = resolveLockPath(packages, at, name);
      if (resolved) pending.push(resolved);
    }
  }
  return reached;
}

/** The production packages to leave out: the outermost unreachable lock paths. */
function unusedProductionPackages(packages = readLockPackages()) {
  const reached = runtimePackagePaths(packages);
  return Object.entries(packages)
    .filter(([at, metadata]) => at.startsWith('node_modules/') && metadata.dev !== true && !reached.has(at))
    // A nested package already goes with an excluded parent.
    .filter(([at]) => {
      const parent = parentLockPath(at);
      return parent === '' || reached.has(parent);
    })
    .map(([at]) => at)
    .sort();
}

/** The negative `files` patterns that keep the packaged node_modules to its runtime closure. */
function packagedNodeModuleExclusions(packages = readLockPackages()) {
  return [
    ...unusedProductionPackages(packages).map((at) => `!${at}{,/**}`),
    ...UNUSED_PACKAGE_FILES,
    ...ON_DEMAND_PACKAGE_FILES,
  ];
}

/**
 * What Resources/agent-runtimes.json tells the app: for every platform package of the
 * vendor CLIs, the exact npm tarball and the integrity npm installed it with here.
 */
function agentRuntimeManifest(packages = readLockPackages()) {
  const entries = {};
  for (const [at, metadata] of Object.entries(packages)) {
    if (!at.startsWith('node_modules/') || parentLockPath(at) !== '') continue;
    const name = packageNameAt(at);
    if (!ON_DEMAND_PACKAGE.test(name) || metadata.dev === true) continue;
    if (!metadata.resolved || !/^sha512-/.test(metadata.integrity ?? '')) {
      throw new Error(`${name} has no pinned tarball and sha512 integrity in package-lock.json`);
    }
    entries[name] = { version: metadata.version, resolved: metadata.resolved, integrity: metadata.integrity };
  }
  return { version: 1, packages: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) };
}

/** The on-demand packages a build for this platform and architecture must download. */
function onDemandPackagesFor(platform, arch) {
  return [`@openai/codex-${platform}-${arch}`, `@github/copilot-${platform}-${arch}`];
}

/** Packed entries (asar listing or unpacked paths) that belong to an on-demand package. */
function packedOnDemandPackages(packedFiles) {
  const found = new Set();
  for (const file of packedFiles) {
    const match = file.match(/(?:^|\/)node_modules\/(@openai\/codex-[^/]+|@github\/copilot-[^/]+)/);
    if (match && ON_DEMAND_PACKAGE.test(match[1])) found.add(match[1]);
  }
  return [...found].sort();
}

// The bare specifiers a bundled file can still hand to Node at runtime: those it
// loads, and those it only locates with require.resolve.
const LOAD_PATTERNS = [
  /\bfrom\s*["']([^"'./][^"']*)["']/g,
  /\bimport\s*\(?\s*["']([^"'./][^"']*)["']/g,
  /\brequire\s*\(\s*["'`]([^"'`./$][^"'`$]*)["'`]\s*\)/g,
  // createRequire(import.meta.url)("name")
  /\)\s*\(\s*["']([^"'./][^"']*)["']\s*\)/g,
];
const RESOLVE_PATTERNS = [/\.resolve\s*\(\s*["'`]([^"'`./$][^"'`$]*)["'`]\s*\)/g];
const BUILTINS = new Set(builtinModules);

function runtimeSpecifiers(source) {
  const found = { load: new Set(), resolve: new Set() };
  for (const line of source.split('\n')) {
    // Bundled libraries keep their doc comments, and those are full of usage
    // examples: "import {unified} from 'unified'" is not an import.
    const code = line.trimStart();
    if (code.startsWith('*') || code.startsWith('/*') || code.startsWith('//')) continue;
    for (const [kind, patterns] of [['load', LOAD_PATTERNS], ['resolve', RESOLVE_PATTERNS]]) {
      for (const pattern of patterns) {
        for (const match of code.matchAll(pattern)) {
          const specifier = match[1];
          if (specifier.startsWith('node:') || BUILTINS.has(packageNameOf(specifier))) continue;
          if (!/^(@[a-z0-9._~-]+\/)?[a-z0-9._~-]+(\/.*)?$/i.test(specifier)) continue;
          found[kind].add(specifier);
        }
      }
    }
  }
  return found;
}

/** The packages a bundled file names, however it reaches them. */
function bareSpecifiers(source) {
  const { load, resolve } = runtimeSpecifiers(source);
  return new Set([...load, ...resolve].map(packageNameOf));
}

/** Whether `name` is a production dependency installed at the top of node_modules. */
function isProductionPackage(name, packages = readLockPackages()) {
  const metadata = packages[`node_modules/${name}`];
  return Boolean(metadata) && metadata.dev !== true;
}

/**
 * What the packaged main side may hand to Node by name: the runtime roots plus
 * whatever the packed dist-electron bundles name, as specifiers to `load` and to
 * `resolve`, and the `names` of their packages.
 *
 * `packedFiles` are the app.asar entries ('/'-separated, no leading slash; unpacked
 * entries are listed in the archive header too) and `readPacked(file)` returns
 * one's text. Only production dependencies count: a bundled library may mention
 * optional packages nobody installs, and that is not what this guards.
 */
function runtimeRequests(packedFiles, readPacked, packages = readLockPackages()) {
  const load = new Set(MAIN_PROCESS_EXTERNALS);
  const resolve = new Set(RUNTIME_RESOLVED_SPECIFIERS);
  for (const file of packedFiles) {
    if (!/^dist-electron\/[^/]+\.(?:js|cjs|mjs)$/.test(file)) continue;
    const found = runtimeSpecifiers(readPacked(file));
    for (const specifier of found.load) load.add(specifier);
    for (const specifier of found.resolve) resolve.add(specifier);
  }
  const production = (specifier) => isProductionPackage(packageNameOf(specifier), packages);
  const requests = { load: [...load].filter(production).sort(), resolve: [...resolve].filter(production).sort() };
  return { ...requests, names: [...new Set([...requests.load, ...requests.resolve].map(packageNameOf))].sort() };
}

/** Those of `names` whose package is not inside the packed app. */
function findMissingRuntimePackages(names, packedFiles) {
  const packed = new Set(packedFiles);
  return names.filter((name) => !packed.has(`node_modules/${name}/package.json`));
}

module.exports = {
  MAIN_PROCESS_EXTERNALS,
  RUNTIME_RESOLVED_SPECIFIERS,
  BROWSER_ONLY_DEPENDENCIES,
  UNDECLARED_DEPENDENCIES,
  UNUSED_PACKAGE_FILES,
  ON_DEMAND_PACKAGE_FILES,
  AGENT_RUNTIME_MANIFEST,
  agentRuntimeManifest,
  onDemandPackagesFor,
  packedOnDemandPackages,
  packageNameOf,
  readLockPackages,
  resolveLockPath,
  runtimePackagePaths,
  unusedProductionPackages,
  packagedNodeModuleExclusions,
  runtimeSpecifiers,
  bareSpecifiers,
  isProductionPackage,
  runtimeRequests,
  findMissingRuntimePackages,
};
