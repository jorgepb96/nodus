// electron-builder 26 intentionally skips everything under Contents/PlugIns.
// Nodus owns a native DockTile plug-in there, so preserve the standard Electron
// signing walk while adding that executable and bundle explicitly. The normal
// inside-out depth sort then signs the executable, the plug-in bundle, all other
// native code/frameworks/helpers, and finally Nodus.app.
const { existsSync, readdirSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { signAsync } = require('@electron/osx-sign');
const { isSigningTarget } = require('./macSigningFiles.cjs');

function parseDeveloperIdIdentities(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"]+)"/i))
    .filter(Boolean)
    .map((match) => ({ hash: match[1].toUpperCase(), name: match[2] }))
    .filter(({ name }) => name.startsWith('Developer ID Application:'));
}

function resolveDeveloperIdIdentity(options) {
  if (!options.keychain) {
    throw new Error('A dedicated keychain is required for Developer ID release signing');
  }

  const output = execFileSync(
    'security',
    ['find-identity', '-v', '-p', 'codesigning', options.keychain],
    { encoding: 'utf8' },
  );
  const identities = parseDeveloperIdIdentities(output);
  const requested = options.identity?.toUpperCase();
  const selected = requested
    ? identities.find(({ hash, name }) => hash === requested || name.toUpperCase() === requested)
    : (identities.length === 1 ? identities[0] : undefined);

  if (!selected) {
    throw new Error('The selected Developer ID Application identity is not available in the temporary keychain');
  }
  return selected.name;
}

module.exports = async function signMacApplication(options) {
  // electron-builder 26 passes the selected certificate's SHA-1 hash to custom
  // signers with identity validation disabled. On hosted macOS runners, codesign
  // does not reliably resolve that hash when --keychain points at an isolated
  // keychain. Resolve the exact hash back to its full Developer ID name first.
  const signingIdentity = resolveDeveloperIdIdentity(options);
  const pluginBundle = path.join(
    options.app,
    'Contents',
    'PlugIns',
    'NodusDockTile.docktileplugin',
  );
  const pluginExecutable = path.join(
    pluginBundle,
    'Contents',
    'MacOS',
    'NodusDockTilePlugin',
  );
  if (!existsSync(pluginBundle) || !existsSync(pluginExecutable)) {
    throw new Error(`Missing required DockTile signing target: ${pluginBundle}`);
  }

  const presenterHelper = path.join(options.app, 'Contents', 'Resources', 'presenter-native', 'nodus-presenter-native');
  if (!existsSync(presenterHelper)) throw new Error('Missing native Presenter signing target');

  const originalIgnore = options.ignore;
  const originalOptionsForFile = options.optionsForFile;
  const emptyEntitlements = path.join(__dirname, 'entitlements.mac.empty.plist');
  const isDockTilePath = (filePath) => filePath === pluginBundle
    || filePath.startsWith(`${pluginBundle}${path.sep}`);
  const frameworksDirectory = path.join(options.app, 'Contents', 'Frameworks');
  const isElectronHelperRuntime = (filePath) => {
    const relative = path.relative(frameworksDirectory, filePath);
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
    const segments = relative.split(path.sep);
    if (!/ Helper(?: \([^)]+\))?\.app$/.test(segments[0] ?? '')) return false;
    return segments.length === 1
      || (segments.length === 4 && segments[1] === 'Contents' && segments[2] === 'MacOS');
  };
  const additionalBundleExtensions = new Set(['.appex', '.bundle', '.docktileplugin', '.plugin', '.xpc']);
  const additionalBundles = [];
  const collectBundles = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      collectBundles(candidate);
      if (additionalBundleExtensions.has(path.extname(candidate).toLowerCase())) {
        additionalBundles.push(candidate);
      }
    }
  };
  collectBundles(path.join(options.app, 'Contents'));

  await signAsync({
    ...options,
    identity: signingIdentity,
    binaries: [...new Set([
      ...(options.binaries ?? []),
      pluginExecutable,
      presenterHelper,
      ...additionalBundles,
    ])],
    // Override only electron-builder's blanket PlugIns exclusion. Every other
    // built-in or project-provided ignore rule remains intact.
    ignore: (filePath) => {
      if (!isSigningTarget(filePath)) return true;
      if (isDockTilePath(filePath)) return false;
      if (typeof originalIgnore === 'function') return originalIgnore(filePath);
      if (Array.isArray(originalIgnore)) {
        return originalIgnore.some((rule) => (typeof rule === 'function' ? rule(filePath) : filePath.match(rule)));
      }
      return false;
    },
    // Only actual Electron process executables need V8 JIT. Frameworks, native
    // modules, CLI tools, the Copilot companion app and the DockTile receive an
    // explicit empty plist instead of inheriting unnecessary capabilities.
    optionsForFile: (filePath) => {
      // @electron/osx-sign expects a synchronous callback. Returning a Promise
      // silently drops the selected plist and falls back to its broad defaults.
      const inherited = originalOptionsForFile ? originalOptionsForFile(filePath) : {};
      return filePath === options.app || isElectronHelperRuntime(filePath)
        ? inherited
        : { ...inherited, entitlements: emptyEntitlements };
    },
  });
};

module.exports.parseDeveloperIdIdentities = parseDeveloperIdIdentities;
