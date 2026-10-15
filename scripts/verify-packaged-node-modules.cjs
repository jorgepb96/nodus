// The packaged node_modules is pruned to the main process's runtime closure
// (build/packagedNodeModules.cjs). A wrong prune does not fail packaging: it fails
// on a user's machine, the first time a feature reaches for the missing package.
// This catches it on the packed app instead, in two steps:
//
//  1. every production package the packed dist-electron names, plus the runtime
//     roots, must be inside app.asar;
//  2. in the packaged Electron itself, run as Node, each must load (or, for what
//     main only locates with require.resolve, resolve), so a dependency that a
//     kept package imports without declaring it shows up too.
//
// Only a missing PRODUCTION package fails. Loading in plain Node leaves other
// errors behind (electron-updater asks for Electron's own API, pagedjs for a
// document), and those say nothing about what was packed.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const {
  AGENT_RUNTIME_MANIFEST,
  agentRuntimeManifest,
  findMissingRuntimePackages,
  onDemandPackagesFor,
  packedOnDemandPackages,
  isProductionPackage,
  packageNameOf,
  readLockPackages,
  runtimeRequests,
} = require('../build/packagedNodeModules.cjs');

// Runs inside the packaged Electron with ELECTRON_RUN_AS_NODE. From app.asar it
// requires each specifier to load, falling back to import() for the ESM-only ones,
// resolves each specifier to locate, and reports the module a failure could not find.
const PROBE = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const app = process.env.NODUS_PROBE_APP;
const load = createRequire(path.join(app, 'package.json'));
const pick = (target) => typeof target === 'string' ? target
  : Array.isArray(target) ? pick(target[0])
  : target ? pick(target.node) ?? pick(target.import) ?? pick(target.default) : undefined;
function esmEntry(specifier) {
  const parts = specifier.split('/');
  const name = parts.slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
  const subpath = '.' + specifier.slice(name.length);
  const directory = path.join(app, 'node_modules', name);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  let exported = manifest.exports;
  if (exported && typeof exported === 'object' && !Array.isArray(exported) && Object.keys(exported).some((key) => key.startsWith('.'))) exported = exported[subpath];
  else if (subpath !== '.') exported = undefined;
  if (subpath !== '.') return path.join(directory, pick(exported) ?? subpath);
  return path.join(directory, pick(exported) ?? manifest.module ?? manifest.main ?? 'index.js');
}
const ESM_ONLY = new Set(['ERR_REQUIRE_ESM', 'ERR_REQUIRE_ASYNC_MODULE', 'ERR_PACKAGE_PATH_NOT_EXPORTED']);
const NOT_FOUND = new Set(['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND']);
(async () => {
  const results = [];
  for (const { kind, specifier } of JSON.parse(process.env.NODUS_PROBE_REQUESTS)) {
    let failure = null;
    try {
      if (kind === 'resolve') load.resolve(specifier);
      else load(specifier);
    } catch (error) {
      failure = error;
      if (kind === 'load' && ESM_ONLY.has(error && error.code)) {
        try { await import(pathToFileURL(esmEntry(specifier)).href); failure = null; } catch (retry) { failure = retry; }
      }
    }
    const message = failure ? String(failure.message || failure) : null;
    const missing = failure && NOT_FOUND.has(failure.code)
      ? (message.match(/Cannot find (?:module|package) '([^']+)'/) || [])[1] || null
      : null;
    results.push({ kind, specifier, missing, error: message && message.split('\n')[0].slice(0, 300) });
  }
  process.stdout.write('\n@@NODUS_PROBE@@' + JSON.stringify(results) + '\n');
})();
`;

/** Where a packed app keeps its Electron executable and its resources. */
function packedLayout(appOutDir, platform, productFilename, executableName) {
  if (platform === 'darwin') {
    const app = path.join(appOutDir, `${productFilename}.app`);
    return {
      executable: path.join(app, 'Contents', 'MacOS', productFilename),
      resources: path.join(app, 'Contents', 'Resources'),
    };
  }
  return {
    executable: path.join(appOutDir, platform === 'win32' ? `${productFilename}.exe` : executableName),
    resources: path.join(appOutDir, 'resources'),
  };
}

/** The bare package a missing-module message names, or null for a file path. */
function missingPackage(missing) {
  if (!missing || missing.startsWith('.') || path.isAbsolute(missing) || missing.startsWith('file:')) return null;
  return packageNameOf(missing);
}

/**
 * Throws unless every runtime package is packed and, with `load`, also loads (or
 * resolves) in the packaged executable. Returns the probe's results (none without `load`).
 */
function verifyPackagedNodeModules({ executable, resources }, { load = true, packages = readLockPackages(), spawn = spawnSync } = {}) {
  const archive = path.join(resources, 'app.asar');
  const packedFiles = asar.listPackage(archive).map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''));
  const requests = runtimeRequests(packedFiles, (file) => asar.extractFile(archive, file).toString('utf8'), packages);
  const { names } = requests;

  const absent = findMissingRuntimePackages(names, packedFiles);
  if (absent.length > 0) {
    throw new Error(`The packaged app is missing packages its main process loads:\n${absent.join('\n')}`);
  }
  if (!load) {
    console.log(`[node-modules] ${names.length} runtime packages are packed in ${archive}`);
    return [];
  }

  const run = spawn(executable, ['-e', PROBE], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODUS_PROBE_APP: archive,
      NODUS_PROBE_REQUESTS: JSON.stringify([
        ...requests.load.map((specifier) => ({ kind: 'load', specifier })),
        ...requests.resolve.map((specifier) => ({ kind: 'resolve', specifier })),
      ]),
    },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
  });
  const marker = (run.stdout ?? '').lastIndexOf('@@NODUS_PROBE@@');
  if (marker === -1) {
    throw new Error(`The packaged runtime did not report its module probe (status ${run.status}, signal ${run.signal}):\n${(run.stderr ?? '').slice(-2000)}`);
  }
  const results = JSON.parse(run.stdout.slice(marker + '@@NODUS_PROBE@@'.length).trim().split('\n')[0]);
  const broken = results.filter((result) => {
    const missing = missingPackage(result.missing);
    return missing && isProductionPackage(missing, packages);
  });
  if (broken.length > 0) {
    throw new Error(
      `Packages the packaged main process loads fail for want of a pruned dependency:\n${
        broken.map((result) => `${result.kind} ${result.specifier}: ${result.error}`).join('\n')}`,
    );
  }
  console.log(`[node-modules] ${names.length} runtime packages are packed and load in ${executable}`);
  return results;
}

/** Every file below a directory, '/'-separated and relative to it. */
function filesBelow(directory) {
  const found = [];
  const pending = [''];
  while (pending.length > 0) {
    const relative = pending.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(directory, relative), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) pending.push(child);
      else found.push(child);
    }
  }
  return found;
}

/**
 * The Codex and Copilot CLIs are downloaded at first use (electron/ai/agentRuntime.ts).
 * Write the manifest that says from where and with which integrity, then prove the
 * packed app carries it for this platform and carries none of the CLIs themselves.
 */
function stageAndVerifyOnDemandRuntimes({ resources }, platform, arch, packages = readLockPackages()) {
  const manifest = agentRuntimeManifest(packages);
  fs.writeFileSync(path.join(resources, AGENT_RUNTIME_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const name of onDemandPackagesFor(platform, arch)) {
    if (!manifest.packages[name]) {
      throw new Error(`${AGENT_RUNTIME_MANIFEST} cannot download ${name}, which this ${platform}-${arch} app needs`);
    }
  }
  const archive = path.join(resources, 'app.asar');
  const packed = [
    ...asar.listPackage(archive).map((entry) => entry.replace(/\\/g, '/').replace(/^\//, '')),
    ...filesBelow(path.join(resources, 'app.asar.unpacked')),
  ];
  const shipped = packedOnDemandPackages(packed);
  if (shipped.length > 0) {
    throw new Error(`The packaged app still carries CLIs it should download on demand:\n${shipped.join('\n')}`);
  }
  console.log(`[node-modules] ${onDemandPackagesFor(platform, arch).join(' and ')} download on demand`);
  return manifest;
}

module.exports = { PROBE, packedLayout, missingPackage, verifyPackagedNodeModules, stageAndVerifyOnDemandRuntimes };

if (require.main === module) {
  // node scripts/verify-packaged-node-modules.cjs <appOutDir> [platform] [executableName]
  const [appOutDir, platform = process.platform, executableName = 'nodus'] = process.argv.slice(2);
  if (!appOutDir) {
    console.error('usage: node scripts/verify-packaged-node-modules.cjs <appOutDir> [platform] [executableName]');
    process.exit(2);
  }
  const productFilename = require('../package.json').build.productName;
  const results = verifyPackagedNodeModules(packedLayout(appOutDir, platform, productFilename, executableName));
  for (const result of results) {
    console.log(`${result.error ? '·' : '✓'} ${result.kind} ${result.specifier}${result.error ? `  (${result.error})` : ''}`);
  }
}
