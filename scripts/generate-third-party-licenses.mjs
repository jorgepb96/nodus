import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const legalRoot = path.join(root, 'legal');
const generatedRoot = path.join(legalRoot, 'generated');
const nodeModulesRoot = path.join(root, 'node_modules');
const lockPath = path.join(root, 'package-lock.json');
const remoteManifestPath = path.join(legalRoot, 'remote-notices.json');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const normalizeText = (value) => value.replace(/\r\n/g, '\n').trimEnd() + '\n';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value);
  fs.renameSync(temporary, file);
}

async function fetchWithRetry(url, options, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        // Upstream license hosts (gnu.org, apache.org, …) intermittently tarpit
        // or drop CI egress; a short backoff rides out the transient failure.
        const delayMs = 1000 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw new Error(`Unable to fetch ${url} after ${attempts} attempts: ${lastError?.message ?? lastError}`);
}

async function ensureRemoteNotices() {
  const manifest = readJson(remoteManifestPath);
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) {
    throw new Error(`Unsupported legal manifest: ${remoteManifestPath}`);
  }

  const results = [];
  for (const entry of manifest.files) {
    if (!entry.destination || !entry.url || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid remote legal entry: ${JSON.stringify(entry)}`);
    }
    const destination = path.join(generatedRoot, entry.destination);
    let bytes = fs.existsSync(destination) ? fs.readFileSync(destination) : null;
    if (!bytes || sha256(bytes) !== entry.sha256) {
      if (process.env.NODUS_LICENSES_OFFLINE === '1') {
        throw new Error(`Missing verified legal file in offline mode: ${entry.destination}`);
      }
      const response = await fetchWithRetry(entry.url, {
        redirect: 'follow',
        headers: { 'user-agent': 'Nodus-license-bundler/1.0' },
      });
      bytes = Buffer.from(await response.arrayBuffer());
      const actual = sha256(bytes);
      if (actual !== entry.sha256) {
        throw new Error(`Digest mismatch for ${entry.url}: expected ${entry.sha256}, received ${actual}`);
      }
      writeAtomic(destination, bytes);
    }
    results.push({ ...entry, bytes: bytes.length });
  }
  return results;
}

function bundledPackageJsonsBelow(directory) {
  const results = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (
        entry.isFile() &&
        entry.name === 'package.json' &&
        path.relative(directory, absolute).split(path.sep).includes('node_modules')
      ) {
        results.push(absolute);
      }
    }
  }
  return results;
}

function installedProductionPackages() {
  if (!fs.existsSync(nodeModulesRoot)) {
    throw new Error('node_modules is missing; run npm ci before generating third-party licenses');
  }
  const lock = readJson(lockPath);
  const packageFiles = new Set();
  for (const [relative, metadata] of Object.entries(lock.packages ?? {})) {
    if (!relative.startsWith('node_modules/') || metadata.dev === true) continue;
    const packageRoot = path.join(root, relative);
    const packageFile = path.join(packageRoot, 'package.json');
    if (!fs.existsSync(packageFile)) continue; // platform-specific optional package
    packageFiles.add(packageFile);
    // Some native packages (notably Copilot CLI) contain bundled npm packages
    // that are not represented as separate package-lock nodes.
    for (const nested of bundledPackageJsonsBelow(packageRoot)) packageFiles.add(nested);
  }
  // The Nodus Server ships with a node_modules of its own, inside the app and inside the image
  // (scripts/packaged-server-runtime.cjs). Some of those packages, esbuild and playwright-core,
  // are only development dependencies of the desktop, but they are distributed all the same.
  for (const entry of require('./packaged-server-runtime.cjs').serverPackageClosure(root)) {
    packageFiles.add(path.join(entry.directory, 'package.json'));
  }

  const packages = [];
  for (const packageFile of packageFiles) {
    let metadata;
    try {
      metadata = readJson(packageFile);
    } catch (cause) {
      throw new Error(`Cannot parse ${path.relative(root, packageFile)}: ${cause}`);
    }
    if (!metadata.name || !metadata.version) continue;
    packages.push({
      name: String(metadata.name),
      version: String(metadata.version),
      declaredLicense: typeof metadata.license === 'string' ? metadata.license : '',
      author: metadata.author ?? null,
      contributors: metadata.contributors ?? null,
      repository: metadata.repository ?? null,
      homepage: metadata.homepage ?? null,
      directory: path.dirname(packageFile),
    });
  }

  // The same package can occur at several lock paths. One identical notice is
  // enough, while genuinely different versions stay separate.
  const byIdentity = new Map();
  for (const record of packages) {
    const key = `${record.name}@${record.version}`;
    const existing = byIdentity.get(key);
    if (!existing || licenseFiles(record.directory).length > licenseFiles(existing.directory).length) {
      byIdentity.set(key, record);
    }
  }
  return [...byIdentity.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function licenseFiles(directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && /^(licen[cs]e|copying|notice|copyright)(?:\.|$)/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function readableMetadata(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(readableMetadata).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    return value.name || value.url || value.email
      ? [value.name, value.email, value.url].filter(Boolean).join(' ')
      : JSON.stringify(value);
  }
  return String(value);
}

function projectFallback(record) {
  const generated = (...names) => names.map((name) => path.join(generatedRoot, name));
  if (/^onnxruntime-(?:common|node|web)$/.test(record.name)) {
    return generated('ONNX_RUNTIME_LICENSE.txt');
  }
  if (record.name === '@github/copilot-sdk') return generated('GITHUB_COPILOT_SDK_LICENSE.txt');
  if (record.name === '@github/copilot' || record.name.startsWith('@github/copilot-')) {
    return generated('GITHUB_COPILOT_CLI_LICENSE.md');
  }
  if (record.name === '@openai/codex' || record.name.startsWith('@openai/codex-')) {
    return generated('OPENAI_CODEX_LICENSE.txt');
  }
  if (record.name.startsWith('@img/sharp-libvips-')) {
    return generated('GPL-3.0.txt', 'LGPL-3.0.txt', 'SHARP_LIBVIPS_THIRD_PARTY_NOTICES.md');
  }
  if (record.name.startsWith('@napi-rs/canvas-')) {
    return [path.join(nodeModulesRoot, '@napi-rs', 'canvas', 'LICENSE')];
  }
  if (record.name.startsWith('@koromix/koffi-')) {
    return [path.join(nodeModulesRoot, 'koffi', 'LICENSE.txt')];
  }
  return [];
}

function standardFallback(record) {
  const expression = record.declaredLicense.trim();
  if (expression === 'MIT') return [path.join(legalRoot, 'templates', 'MIT.txt')];
  if (expression === 'ISC') return [path.join(legalRoot, 'templates', 'ISC.txt')];
  if (expression === 'BSD-2-Clause') return [path.join(legalRoot, 'templates', 'BSD-2-Clause.txt')];
  if (expression === 'Apache-2.0') return [path.join(generatedRoot, 'APACHE-2.0.txt')];
  if (expression === 'LGPL-3.0' || expression === 'LGPL-3.0-or-later') {
    return [path.join(generatedRoot, 'GPL-3.0.txt'), path.join(generatedRoot, 'LGPL-3.0.txt')];
  }
  return [];
}

function noticeFor(record) {
  let files = licenseFiles(record.directory);
  let fallback = false;
  if (!files.length) {
    files = projectFallback(record);
    if (!files.length) files = standardFallback(record);
    fallback = true;
  }
  if (!files.length || files.some((file) => !fs.existsSync(file))) {
    throw new Error(
      `No distributable license text for ${record.name}@${record.version} ` +
      `(declared: ${record.declaredLicense || 'none'}, path: ${path.relative(root, record.directory)})`,
    );
  }

  const author = readableMetadata(record.author);
  const contributors = readableMetadata(record.contributors);
  const repository = readableMetadata(record.repository);
  const metadata = [
    `Package: ${record.name}@${record.version}`,
    `Declared license: ${record.declaredLicense || 'not declared'}`,
    author ? `Author/copyright attribution from package metadata: ${author}` : '',
    contributors ? `Contributors from package metadata: ${contributors}` : '',
    repository ? `Source repository: ${repository}` : '',
    record.homepage ? `Homepage: ${record.homepage}` : '',
    fallback ? 'License text source: verified project or SPDX-license fallback listed by Nodus.' : '',
  ].filter(Boolean).join('\n');
  const bodies = files.map((file) => {
    const label = path.basename(file);
    return `--- ${label} ---\n${normalizeText(fs.readFileSync(file, 'utf8'))}`;
  }).join('\n');
  return `${metadata}\n\n${bodies}`;
}

function aggregatePackageLicenses() {
  const packages = installedProductionPackages();
  const groups = new Map();
  for (const record of packages) {
    const notice = noticeFor(record);
    // Group only the legal body, while retaining every package attribution in
    // the generated document. This keeps repeated monorepo licenses compact.
    const split = notice.indexOf('\n\n--- ');
    const metadata = split >= 0 ? notice.slice(0, split) : `${record.name}@${record.version}`;
    const body = split >= 0 ? notice.slice(split + 2) : notice;
    const key = sha256(body);
    const group = groups.get(key) ?? { body, metadata: [] };
    group.metadata.push(metadata);
    groups.set(key, group);
  }

  const header = [
    'NODUS THIRD-PARTY PACKAGE LICENSES',
    '==================================',
    '',
    `Nodus version: ${readJson(path.join(root, 'package.json')).version}`,
    `Installed production package identities: ${packages.length}`,
    '',
    'Generated from package-lock.json and the exact platform dependency tree.',
    'Packages bundled inside native/runtime packages are included as well.',
    'The human-readable special notices are in THIRD_PARTY_NOTICES.md.',
    '',
  ].join('\n');
  const sections = [...groups.values()].map((group, index) => [
    `NOTICE GROUP ${index + 1}`,
    '-'.repeat(72),
    ...group.metadata,
    '',
    group.body.trimEnd(),
    '',
  ].join('\n'));
  const output = normalizeText(header + sections.join('\n'));
  const destination = path.join(generatedRoot, 'THIRD_PARTY_PACKAGE_LICENSES.txt');
  writeAtomic(destination, output);
  return { destination, packages: packages.length, groups: groups.size, sha256: sha256(output) };
}

/** Electron 43 has no install script: `npm install` unpacks the package but not the
 *  distribution, which is downloaded the first time the module is required. Chromium's licence
 *  notice lives in that distribution, so ask for it rather than assuming an earlier step
 *  already did — otherwise packaging a fresh clone fails, blaming an install step that no
 *  longer exists. */
function materializeElectronDist() {
  if (process.env.ELECTRON_DIST_PATH) return;
  if (fs.existsSync(path.join(nodeModulesRoot, 'electron', 'dist'))) return;
  try {
    require('electron'); // resolves the executable, downloading the distribution if it is absent
  } catch (error) {
    console.warn(`[legal] Electron distribution could not be resolved: ${error.message}`);
  }
}

function copyElectronLegalFiles() {
  const electronPackage = readJson(path.join(nodeModulesRoot, 'electron', 'package.json'));
  const electronLicense = path.join(nodeModulesRoot, 'electron', 'LICENSE');
  materializeElectronDist();
  const chromiumCandidates = [
    path.join(nodeModulesRoot, 'electron', 'dist', 'LICENSES.chromium.html'),
    process.env.ELECTRON_DIST_PATH
      ? path.join(process.env.ELECTRON_DIST_PATH, 'LICENSES.chromium.html')
      : '',
  ].filter(Boolean);
  const chromiumLicenses = chromiumCandidates.find((candidate) => fs.existsSync(candidate));
  if (!fs.existsSync(electronLicense) || !chromiumLicenses) {
    throw new Error(
      `Electron ${electronPackage.version} legal files are incomplete: its distribution is ` +
      'downloaded on demand and could not be fetched. Run `node node_modules/electron/install.js` ' +
      'with network access, or set ELECTRON_DIST_PATH to a verified Electron distribution.',
    );
  }
  const copies = [
    [electronLicense, path.join(generatedRoot, 'ELECTRON_LICENSE.txt')],
    [chromiumLicenses, path.join(generatedRoot, 'ELECTRON_CHROMIUM_LICENSES.html')],
  ];
  return copies.map(([source, destination]) => {
    const bytes = fs.readFileSync(source);
    writeAtomic(destination, bytes);
    return { destination: path.basename(destination), bytes: bytes.length, sha256: sha256(bytes) };
  }).concat({ electronVersion: electronPackage.version });
}

async function main() {
  fs.mkdirSync(generatedRoot, { recursive: true });
  const remoteFiles = await ensureRemoteNotices();
  const packageInventory = aggregatePackageLicenses();
  const electronFiles = process.argv.includes('--server-web') ? [] : copyElectronLegalFiles();
  const buildManifest = {
    schemaVersion: 1,
    nodusVersion: readJson(path.join(root, 'package.json')).version,
    packageInventory: {
      file: path.basename(packageInventory.destination),
      packages: packageInventory.packages,
      noticeGroups: packageInventory.groups,
      sha256: packageInventory.sha256,
    },
    remoteFiles: remoteFiles.map(({ destination, url, sha256: digest, bytes }) => ({
      destination,
      source: url,
      sha256: digest,
      bytes,
    })),
    electronFiles,
  };
  writeAtomic(path.join(generatedRoot, 'LEGAL_MANIFEST.json'), `${JSON.stringify(buildManifest, null, 2)}\n`);
  console.log(
    `[licenses] ${packageInventory.packages} production packages, ` +
    `${packageInventory.groups} notice groups, ${remoteFiles.length} pinned upstream files`,
  );
}

await main();
