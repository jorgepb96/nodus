// The Nodus Server that ships inside the desktop app, and the proof that it runs there.
//
// Basic mode (electron/localServer/process.ts) starts Resources/nodus-server/server.mjs with the
// app's own executable as Node. electron-builder copies server/ there as an extra resource: the
// source, and nothing it imports. Node resolves `import 'pdf-lib'` by walking up from the
// importing file through node_modules directories, and from Resources/nodus-server that walk
// never passes app.asar/node_modules, where the desktop keeps its own copy. Relative imports
// that leave server/ (`../../shared/…`) found nothing either. So from 5.0.4, the first release
// whose server reached outside its own folder, every packaged build shipped a server that died
// loading its modules, and nothing noticed: every test that started it ran it from the
// repository, where the root node_modules and shared/ answered.
//
// This lays the shipped server out exactly like the published image, and then runs it:
//
//   server/Dockerfile                       packaged app (Resources/)
//   /app             server.mjs, lib/       nodus-server/                 (extraResources)
//   /app/node_modules                       nodus-server/node_modules     (staged here)
//   /app/electron/db, /app/shared           nodus-server/electron/db, …/shared
//                                           — the canonical migrations, compiled at first use
//   /shared/*.mjs                           shared/*.mjs
//                                           — reached by relative import from lib/
//
// One difference, and it is deliberate: the image runs `npm install` against
// server/package.json, while the app copies those same packages out of the root install. That
// way they carry the versions the test suite ran and the native builds electron-builder already
// made for Electron's ABI, and nothing is downloaded at packaging time.
//
// server/package.json is therefore the server's one runtime inventory. The image installs it,
// the app copies it, and scripts/test-packaged-server-runtime.mjs fails if the server imports a
// package that file does not declare: an undeclared import had already broken the image twice.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { isBuiltin } = require('node:module');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

/** Modules the server loads that no static import reaches: worker threads are started by URL. */
const SERVER_ENTRIES = ['server/server.mjs', 'server/lib/core/vectorSearchWorker.mjs'];
/** What lib/nativeMigrations.mjs compiles with esbuild the first time a native vault opens. */
const MIGRATIONS_ENTRY = 'electron/db/migrations.ts';
const SERVER_DIRECTORY = 'nodus-server';

/** `@scope/name/sub/path` → `@scope/name`; `name/sub` → `name`. */
function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ── What the server reaches ────────────────────────────────────────────────

/**
 * Walk the server's module graph the way esbuild resolves it, without bundling anything.
 *
 * Returns the packages it imports by name, with the first-party files that import them, and
 * the files it reaches outside server/: those the server imports by relative path from
 * server.mjs and lib/, and those the canonical migrations compile from at runtime.
 */
async function serverSourceGraph(repoRoot) {
  const { build } = require('esbuild');
  const packages = new Map();

  const walk = async (entries, alias = {}) => {
    const recorder = {
      name: 'record-package-imports',
      setup(builder) {
        builder.onResolve({ filter: /^[^./]/ }, (args) => {
          // An alias is resolved by esbuild itself, and an absolute Windows path is a file.
          if (path.isAbsolute(args.path) || Object.keys(alias).some((key) => args.path === key || args.path.startsWith(`${key}/`))) return undefined;
          if (isBuiltin(args.path)) return { path: args.path, external: true };
          if (args.path.startsWith('<')) return { path: args.path, external: true }; // esbuild's own runtime marker
          const name = packageName(args.path);
          const importers = packages.get(name) ?? new Set();
          importers.add(toPosix(path.relative(repoRoot, args.importer)));
          packages.set(name, importers);
          return { path: args.path, external: true };
        });
      },
    };
    const result = await build({
      entryPoints: entries.map((entry) => path.join(repoRoot, entry)),
      absWorkingDir: repoRoot,
      bundle: true,
      write: false,
      metafile: true,
      platform: 'node',
      format: 'esm',
      outdir: path.join(os.tmpdir(), 'nodus-server-graph'),
      alias,
      plugins: [recorder],
      logLevel: 'silent',
    });
    return Object.keys(result.metafile.inputs).map((input) => toPosix(input));
  };

  const serverFiles = await walk(SERVER_ENTRIES);
  const migrationFiles = await walk([MIGRATIONS_ENTRY], { '@shared': path.join(repoRoot, 'shared') });
  const insideServer = (file) => file.startsWith('server/');
  const outsideFiles = serverFiles.filter((file) => !insideServer(file)).sort();
  return {
    packages: new Map([...packages].map(([name, importers]) => [name, [...importers].sort()])),
    /** Reached by a relative import from server/, so they belong beside it, not inside it. */
    outsideFiles,
    /** Compiled from <server>/electron/db and <server>/shared, as the image lays them out. */
    migrationFiles: migrationFiles.filter((file) => !insideServer(file)).sort(),
    /**
     * Packages imported by a file that lives beside the server rather than in it. Neither the
     * image (/shared) nor the app (<resources>/shared) has a node_modules those can resolve from.
     */
    unreachablePackages: [...packages]
      .flatMap(([name, importers]) => [...importers].filter((file) => outsideFiles.includes(file)).map((file) => `${name} (imported by ${file})`))
      .sort(),
  };
}

// ── Which installed packages that means ────────────────────────────────────

/**
 * The installed directory Node would load `name` from when asked from `fromDirectory`.
 * Walks up through node_modules the way Node does, and stops at the repository.
 */
function resolvePackageDirectory(name, fromDirectory, repoRoot) {
  let directory = fromDirectory;
  for (;;) {
    const candidate = path.join(directory, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (path.resolve(directory) === path.resolve(repoRoot)) return null;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * Every installed package the server's declared dependencies need, transitively.
 *
 * Each entry keeps its path relative to the repository (`node_modules/pdf-lib/node_modules/tslib`)
 * so the copy nests exactly as npm nested it, and resolves to exactly the same files. Optional
 * dependencies npm skipped for this platform (another architecture's esbuild) are skipped here
 * too; a missing required one is an error, because the copy would fail the same way at runtime.
 */
function serverPackageClosure(repoRoot) {
  const semver = require('semver');
  const manifest = readJson(path.join(repoRoot, 'server', 'package.json'));
  const declared = { ...(manifest.dependencies ?? {}), ...(manifest.optionalDependencies ?? {}) };
  const closure = new Map();

  const visit = (name, fromDirectory, optional, requiredBy) => {
    const directory = resolvePackageDirectory(name, fromDirectory, repoRoot);
    if (!directory) {
      if (optional) return;
      throw new Error(`${name} (needed by ${requiredBy}) is not installed. Run npm ci before packaging.`);
    }
    if (closure.has(directory)) return;
    const pkg = readJson(path.join(directory, 'package.json'));
    closure.set(directory, {
      name,
      version: pkg.version,
      directory,
      relative: toPosix(path.relative(repoRoot, directory)),
    });
    for (const dependency of Object.keys(pkg.dependencies ?? {})) visit(dependency, directory, false, name);
    for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) visit(dependency, directory, true, name);
  };

  for (const [name, range] of Object.entries(declared)) {
    visit(name, repoRoot, Boolean(manifest.optionalDependencies?.[name]), 'server/package.json');
    const directory = resolvePackageDirectory(name, repoRoot, repoRoot);
    const installed = directory ? readJson(path.join(directory, 'package.json')).version : null;
    // The image installs the range; the app ships what the root lockfile chose. Both must be
    // the same release line, or the two servers people run would quietly differ.
    if (installed && !semver.satisfies(installed, range)) {
      throw new Error(
        `server/package.json asks for ${name}@${range}, but the root lockfile installs ${installed}. `
        + 'Align the two so the packaged server runs what the image runs.',
      );
    }
  }
  return [...closure.values()].sort((a, b) => a.relative.localeCompare(b.relative));
}

// ── Staging ────────────────────────────────────────────────────────────────

const KEPT_LEGAL_FILE = /^(?:licen[cs]e|notice|copying|authors)/i;
const SKIPPED_EXTENSIONS = /\.(?:md|markdown|map|tsbuildinfo|o|obj|a)$/i;
const TYPESCRIPT_SOURCE = /\.(?:ts|mts|cts|tsx)$/i; // declarations included: Node never loads either

/**
 * Whether a file or directory inside an installed package is needed to run it.
 *
 * Deliberately short. Everything removed here is something Node cannot load: documentation,
 * TypeScript, source maps, and a native addon's C sources and compiler output once the addon is
 * compiled. Licence texts always stay. Anything subtler would be a guess, and the verifier
 * below runs the result, so a wrong guess fails the build rather than a user's server.
 */
function packageEntryNeeded(relativePath, { directory = false, nativeAddon = false } = {}) {
  const segments = toPosix(relativePath).split('/');
  const base = segments[segments.length - 1];
  // Nested dependencies are staged as entries of their own, and only when something needs them.
  if (segments.includes('node_modules')) return false;
  if (directory) {
    if (!nativeAddon) return true;
    if (segments.length === 1 && (base === 'deps' || base === 'src')) return false;
    return !(segments[0] === 'build' && (base === 'obj' || base === 'obj.target' || base === '.deps'));
  }
  if (KEPT_LEGAL_FILE.test(base)) return true;
  return !SKIPPED_EXTENSIONS.test(base) && !TYPESCRIPT_SOURCE.test(base);
}

function copyPackage(source, destination) {
  const nativeAddon = fs.existsSync(path.join(source, 'binding.gyp'));
  let bytes = 0;
  fs.cpSync(source, destination, {
    recursive: true,
    // Copy-on-write where the filesystem has it (APFS, btrfs), a plain copy everywhere else.
    mode: fs.constants.COPYFILE_FICLONE,
    filter: (file) => {
      if (file === source) return true;
      const stat = fs.lstatSync(file);
      const needed = packageEntryNeeded(path.relative(source, file), { directory: stat.isDirectory(), nativeAddon });
      if (needed && !stat.isDirectory()) bytes += stat.size;
      return needed;
    },
  });
  return bytes;
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

/**
 * Give the server electron-builder already copied to <resources>/nodus-server everything it
 * imports, in the places it imports them from.
 */
async function stagePackagedServerRuntime({ repoRoot, resourcesPath }) {
  const serverRoot = path.join(resourcesPath, SERVER_DIRECTORY);
  if (!fs.existsSync(path.join(serverRoot, 'server.mjs'))) {
    throw new Error(`The server was not copied into the app: ${path.join(serverRoot, 'server.mjs')} is missing.`);
  }
  const graph = await serverSourceGraph(repoRoot);
  if (graph.unreachablePackages.length > 0) {
    throw new Error(`Files beside the server import packages they cannot resolve there: ${graph.unreachablePackages.join(', ')}`);
  }
  const packages = serverPackageClosure(repoRoot);

  // A developer's own server/node_modules (from running the server by hand) must not ride along:
  // it was installed for their Node, not for this Electron.
  const modules = path.join(serverRoot, 'node_modules');
  fs.rmSync(modules, { recursive: true, force: true });
  let bytes = 0;
  for (const entry of packages) bytes += copyPackage(entry.directory, path.join(serverRoot, entry.relative));

  // lib/ imports `../../shared/…` by relative path: from nodus-server/lib that is
  // <resources>/shared, exactly as from /app/lib in the image it is /shared.
  for (const file of graph.outsideFiles) copyFile(path.join(repoRoot, file), path.join(resourcesPath, file));
  for (const file of graph.migrationFiles) copyFile(path.join(repoRoot, file), path.join(serverRoot, file));

  return { serverRoot, packages, outsideFiles: graph.outsideFiles, migrationFiles: graph.migrationFiles, bytes };
}

// ── Verification ───────────────────────────────────────────────────────────

/** Where electron-builder put the executable it packed. */
function packagedExecutable(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const productFilename = packager.appInfo.productFilename;
  if (electronPlatformName === 'darwin' || electronPlatformName === 'mas') {
    return path.join(appOutDir, `${productFilename}.app`, 'Contents', 'MacOS', productFilename);
  }
  if (electronPlatformName === 'win32') return path.join(appOutDir, `${productFilename}.exe`);
  return path.join(appOutDir, packager.executableName);
}

/**
 * The environment basic mode gives the server, minus anything that could make it resolve a
 * module from somewhere other than the app. NODE_PATH pointing into a checkout would turn a
 * missing package into a pass.
 */
function isolatedEnvironment(extra) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('NODUS_') || key === 'NODE_PATH' || key === 'NODE_OPTIONS' || key === 'NODE_TEST_CONTEXT') delete environment[key];
  }
  return { ...environment, ELECTRON_RUN_AS_NODE: '1', ...extra };
}

// Runs inside the packaged runtime. It loads the server's modules by file URL, so every package
// they import is resolved from where the server lives, never from where this probe was written.
const PROBE = String.raw`
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [serverRoot, requireNative] = process.argv.slice(2);
const at = (relative) => pathToFileURL(path.join(serverRoot, relative)).href;
const fromServer = createRequire(path.join(serverRoot, 'server.mjs'));
const failures = [];
const passed = [];
async function check(label, run) {
  try { passed.push(label + (await run() ?? '')); }
  catch (error) { failures.push(label + ': ' + String(error?.message ?? error).split('\nRequire stack:')[0]); }
}

const manifest = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));
for (const name of Object.keys(manifest.dependencies ?? {})) {
  await check('resolves ' + name, () => {
    const resolved = fs.realpathSync(fromServer.resolve(name));
    if (!resolved.startsWith(fs.realpathSync(serverRoot) + path.sep)) throw new Error('resolved outside the server: ' + resolved);
  });
}

let Database = null;
if (requireNative === 'true') {
  await check('better-sqlite3 loads in this runtime and has FTS5', () => {
    Database = fromServer('better-sqlite3');
    const db = new Database(':memory:');
    try {
      db.exec("CREATE VIRTUAL TABLE probe USING fts5(body); INSERT INTO probe(body) VALUES ('nodus');");
      if (db.prepare("SELECT count(*) AS n FROM probe WHERE probe MATCH 'nodus'").get().n !== 1) throw new Error('FTS5 found nothing');
    } finally { db.close(); }
    return ' (ABI ' + process.versions.modules + ')';
  });
}

await check('canonical migrations compile', async () => {
  const { loadCanonicalMigrations } = await import(at('lib/nativeMigrations.mjs'));
  try {
    const { runMigrations, SCHEMA_VERSION } = await loadCanonicalMigrations();
    if (typeof runMigrations !== 'function') throw new Error('runMigrations is missing from the compiled migrations');
    if (!Database) return ' (schema v' + SCHEMA_VERSION + ')';
    const db = new Database(':memory:');
    try { runMigrations(db); } finally { db.close(); }
    return ' and apply (schema v' + SCHEMA_VERSION + ')';
  } finally {
    fs.rmSync(path.join(os.tmpdir(), 'nodus-native-migrations-' + process.pid + '.mjs'), { force: true });
  }
});

await check('Deep Research PDF renders Chinese text', async () => {
  const { deepResearchPdfBytes } = await import(at('lib/core/deepResearchPdf.mjs'));
  const bytes = Buffer.from(await deepResearchPdfBytes({ title: '研究报告', abstract: '中文摘要 with Latin', brief: { language: 'zh' } }));
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF');
  return ' (' + bytes.length + ' bytes)';
});

await check('playwright-core loads', async () => {
  await import(pathToFileURL(fromServer.resolve('playwright-core')).href);
});

process.stdout.write(JSON.stringify({ passed, failures }));
`;

function run(executable, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Start server.mjs the way basic mode does and wait for it to answer, or say why it did not. */
async function bootServer({ executable, serverRoot, scratch, timeoutMs }) {
  const port = await freePort();
  const environment = isolatedEnvironment({
    NODUS_DATA_DIR: path.join(scratch, 'data'),
    NODUS_PORT: String(port),
    NODUS_HOST: '127.0.0.1',
    NODUS_ADMIN_EMAIL: 'verify@nodus.local',
    NODUS_ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'),
    NODUS_LOCAL_PROVISION_FILE: path.join(scratch, 'provision.key'),
    NODUS_PUBLIC_URL: `http://127.0.0.1:${port}`,
  });
  const child = spawn(executable, [path.join(serverRoot, 'server.mjs')], {
    cwd: serverRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1_500) });
        const health = await response.json().catch(() => null);
        if (response.ok && health?.ok === true) return { port, health };
      } catch {
        // Still loading or binding.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`The packaged server did not answer /healthz.\n${logs.trim().slice(-4_000) || '(no output)'}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  }
}

/**
 * Prove the staged server runs inside the given runtime: every declared package resolves from
 * inside it, the lazily loaded ones work (native SQLite, the migrations esbuild compiles, PDF
 * fonts), and server.mjs itself starts and answers /healthz.
 *
 * `requireNative` is false only for tests, whose runtime is whatever Node or Electron the
 * checkout has, not necessarily the one the native module was built for.
 */
async function verifyPackagedServerRuntime({ executable, resourcesPath, requireNative = true, timeoutMs = 60_000 }) {
  const serverRoot = path.join(resourcesPath, SERVER_DIRECTORY);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-server-verify-'));
  try {
    const probe = path.join(scratch, 'probe.mjs');
    fs.writeFileSync(probe, PROBE);
    const result = await run(executable, [probe, serverRoot, String(requireNative)], {
      cwd: serverRoot,
      env: isolatedEnvironment({}),
      timeoutMs,
    });
    let report;
    try { report = JSON.parse(result.stdout); }
    catch {
      throw new Error(`The server probe did not finish (exit ${result.code ?? result.signal}).\n${result.stderr.trim().slice(-4_000)}`);
    }
    // Started even when the probe failed: what server.mjs dies on first is the most useful line.
    const failures = [...report.failures];
    const passed = [...report.passed];
    try {
      const boot = await bootServer({ executable, serverRoot, scratch, timeoutMs: Math.min(timeoutMs, 30_000) });
      passed.push(`server.mjs answered /healthz on port ${boot.port}`);
    } catch (error) {
      failures.push(`server.mjs: ${error.message}`);
    }
    if (failures.length > 0) throw new Error(`The packaged server cannot load what it needs:\n${failures.join('\n')}`);
    return { passed };
  } finally {
    // Windows keeps a killed process's files busy for a moment after it exits.
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

module.exports = {
  MIGRATIONS_ENTRY,
  SERVER_ENTRIES,
  packageEntryNeeded,
  packageName,
  packagedExecutable,
  resolvePackageDirectory,
  serverPackageClosure,
  serverSourceGraph,
  stagePackagedServerRuntime,
  verifyPackagedServerRuntime,
};
