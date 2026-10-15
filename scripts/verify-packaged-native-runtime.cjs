const { execFileSync } = require('node:child_process');
const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

// macOS ships as two single-architecture products, one per runner: npm resolves
// the native optional dependencies from the host architecture, so a build can
// only ever contain the slice of the machine that produced it. That is exactly
// what makes a mixed tree dangerous — an Intel dependency inside the Apple
// silicon app (or the reverse) does not fail at packaging time, it fails on a
// user's machine at first launch. Everything below exists to make that
// impossible before the artifact is signed.
const SUPPORTED_ARCHITECTURES = ['arm64', 'x64'];

// `lipo -archs` names the Intel slice x86_64; electron-builder names it x64.
const LIPO_ARCHITECTURES = { arm64: 'arm64', x64: 'x86_64' };

// The Codex and Copilot CLIs are not here on purpose: installers no longer carry them,
// and electron/ai/agentRuntime.ts downloads the one this architecture needs at first
// use. scripts/verify-packaged-node-modules.cjs proves they are absent and downloadable.
const REQUIRED_BINARIES = {
  arm64: [
    ['Canvas', '@napi-rs/canvas-darwin-arm64/skia.darwin-arm64.node'],
    ['Koffi', '@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node'],
  ],
  x64: [
    ['Canvas', '@napi-rs/canvas-darwin-x64/skia.darwin-x64.node'],
    ['Koffi', '@koromix/koffi-darwin-x64/darwin_x64/koffi.node'],
  ],
};

const REQUIRED_BINARY_PATTERNS = {
  arm64: [
    ['Sharp', '@img/sharp-darwin-arm64/lib', /^sharp-darwin-arm64(?:-[0-9.]+)?\.node$/],
    ['libvips', '@img/sharp-libvips-darwin-arm64/lib', /^libvips-cpp\.[0-9.]+\.dylib$/],
  ],
  x64: [
    ['Sharp', '@img/sharp-darwin-x64/lib', /^sharp-darwin-x64(?:-[0-9.]+)?\.node$/],
    ['libvips', '@img/sharp-libvips-darwin-x64/lib', /^libvips-cpp\.[0-9.]+\.dylib$/],
  ],
};

// npm names an architecture-specific package with the target as a suffix, so
// what has to be absent is a TOP-LEVEL package of the other architecture:
// `@img/sharp-darwin-arm64` inside the Intel app is what breaks at first launch.
//
// This deliberately reads the package name and not the whole path. Vendored
// binaries for every platform live inside the correct package and are perfectly
// legitimate — @github/copilot-darwin-x64 ships ripgrep and tgrep for
// darwin-arm64 among others — and a substring match over the path flagged those
// and failed the first Intel build ever attempted. Nested node_modules are the
// vendor's own business for the same reason, so only the top level is read.
const FOREIGN_PACKAGE_SUFFIXES = { arm64: '-darwin-x64', x64: '-darwin-arm64' };

/** The top-level package an asar entry belongs to, or null if it is nested. */
function topLevelPackage(entry) {
  const segments = entry.split('node_modules/');
  if (segments.length !== 2) return null; // not in node_modules, or vendored deeper
  const parts = segments[1].split('/');
  if (parts.length === 0) return null;
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function assertSupportedArchitecture(architecture) {
  if (!SUPPORTED_ARCHITECTURES.includes(architecture)) {
    throw new Error(
      `Unsupported macOS architecture: ${architecture} (expected ${SUPPORTED_ARCHITECTURES.join(' or ')})`,
    );
  }
}

function findForeignRuntimePaths(architecture, entries) {
  assertSupportedArchitecture(architecture);
  const suffix = FOREIGN_PACKAGE_SUFFIXES[architecture];
  const foreign = new Set();
  for (const entry of entries) {
    const packageName = topLevelPackage(entry);
    if (packageName && packageName.endsWith(suffix)) foreign.add(packageName);
  }
  return [...foreign].sort();
}

function getArchitectures(filename) {
  return execFileSync('lipo', ['-archs', filename], { encoding: 'utf8' }).trim().split(/\s+/);
}

function assertBinaryArchitecture(label, filename, architecture, architectureReader = getArchitectures) {
  assertSupportedArchitecture(architecture);
  const expected = LIPO_ARCHITECTURES[architecture];
  if (!existsSync(filename)) throw new Error(`Missing packaged ${architecture} ${label}: ${filename}`);
  const architectures = architectureReader(filename);
  if (!architectures.includes(expected)) {
    throw new Error(`Packaged ${label} is not ${expected} (${architectures.join(', ')}): ${filename}`);
  }
}

function findUniquePackagedBinary(label, directory, pattern, directoryReader = readdirSync) {
  let entries;
  try {
    entries = directoryReader(directory);
  } catch {
    throw new Error(`Missing packaged ${label} directory: ${directory}`);
  }
  const matches = entries.filter((entry) => pattern.test(entry)).sort();
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one packaged ${label} binary in ${directory}; found ${matches.length}`,
    );
  }
  return path.join(directory, matches[0]);
}

function verifyPackagedNativeRuntime(appPath, architecture, options = {}) {
  assertSupportedArchitecture(architecture);
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const asarPath = path.join(resourcesPath, 'app.asar');
  const unpackedModules = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules');
  if (!existsSync(asarPath)) throw new Error(`Missing packaged application archive: ${asarPath}`);

  const archiveEntries = (options.listPackage || asar.listPackage)(asarPath);
  const foreignPackages = findForeignRuntimePaths(architecture, archiveEntries);
  if (foreignPackages.length > 0) {
    throw new Error(
      `macOS runtime packages for the other architecture were bundled into the ${architecture} app:\n${foreignPackages.join('\n')}`,
    );
  }

  const appName = path.basename(appPath, '.app');
  assertBinaryArchitecture(
    'Electron executable',
    path.join(appPath, 'Contents', 'MacOS', appName),
    architecture,
    options.getArchitectures,
  );
  for (const [label, relativePath] of REQUIRED_BINARIES[architecture]) {
    assertBinaryArchitecture(label, path.join(unpackedModules, relativePath), architecture, options.getArchitectures);
  }
  for (const [label, relativeDirectory, pattern] of REQUIRED_BINARY_PATTERNS[architecture]) {
    const filename = findUniquePackagedBinary(
      label,
      path.join(unpackedModules, relativeDirectory),
      pattern,
      options.readDirectory,
    );
    assertBinaryArchitecture(label, filename, architecture, options.getArchitectures);
  }
  console.log(
    `[native-runtime] Verified ${architecture} Electron, Canvas, Sharp and Koffi in ${appPath}`,
  );
}

module.exports = {
  SUPPORTED_ARCHITECTURES,
  REQUIRED_BINARIES,
  REQUIRED_BINARY_PATTERNS,
  topLevelPackage,
  assertBinaryArchitecture,
  findUniquePackagedBinary,
  findForeignRuntimePaths,
  verifyPackagedNativeRuntime,
};
