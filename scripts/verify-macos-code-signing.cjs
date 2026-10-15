const { execFileSync, spawnSync } = require('node:child_process');
const {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} = require('node:fs');
const path = require('node:path');
const plist = require('plist');

const ROOT_ENTITLEMENTS = new Set([
  'com.apple.security.automation.apple-events',
  'com.apple.security.cs.allow-jit',
  'com.apple.security.device.audio-input',
  'com.apple.security.device.camera',
  'com.apple.security.personal-information.calendars',
]);
const CHILD_ENTITLEMENTS = new Set(['com.apple.security.cs.allow-jit']);
const CODE_BUNDLE_EXTENSIONS = new Set([
  '.app',
  '.appex',
  '.bundle',
  '.docktileplugin',
  '.framework',
  '.plugin',
  '.xpc',
]);
const MACH_O_EXTENSIONS = new Set(['.dylib', '.node', '.so']);

function fail(message) {
  throw new Error(`[macOS release verification] ${message}`);
}

function run(file, args, options = {}) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout) : '';
    const stderr = error?.stderr ? String(error.stderr) : '';
    fail(`${file} ${args.join(' ')} failed\n${stdout}${stderr}`.trim());
  }
}

function combined(file, args) {
  const result = spawnSync(file, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(`${file} ${args.join(' ')} failed\n${result.stdout ?? ''}${result.stderr ?? ''}`.trim());
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

const TICKET_LOOKUP_ATTEMPTS = 6;
const NETWORK_FAILURE = /NSURLErrorDomain|network connection was lost|could not connect to the server|timed out|not connected to the internet/i;

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// `stapler validate` asks Apple's CloudKit ticket service about the app, and a
// dropped connection fails it with the same Error 68 as a missing ticket. The
// v5.9.0 Intel build lost that connection three times in a row after Apple had
// already notarized it. Only a network failure is retried: a ticket that is
// genuinely absent or invalid still fails on the first answer.
function validateStapledTicket(appPath, {
  validate = (target) => spawnSync('/usr/bin/xcrun', ['stapler', 'validate', target], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
  wait = pause,
} = {}) {
  let output = '';
  for (let attempt = 1; attempt <= TICKET_LOOKUP_ATTEMPTS; attempt += 1) {
    const result = validate(appPath);
    output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (result.status === 0) return output;
    if (!NETWORK_FAILURE.test(output) || attempt === TICKET_LOOKUP_ATTEMPTS) break;
    console.warn(`[macOS release verification] stapler validate lost the network (attempt ${attempt}); retrying`);
    wait(15_000 * attempt);
  }
  fail(`/usr/bin/xcrun stapler validate ${appPath} failed\n${output}`.trim());
}

function extractValue(output, label) {
  const match = output.match(new RegExp(`^${label}=(.+)$`, 'm'));
  return match?.[1]?.trim() ?? null;
}

function signatureInfo(target, expectedTeamId = null, { requireRuntime = true, requireTimestamp = true } = {}) {
  const output = combined('/usr/bin/codesign', ['-dvvv', '--verbose=4', target]);
  const authority = extractValue(output, 'Authority');
  const teamId = extractValue(output, 'TeamIdentifier');
  const cdHash = extractValue(output, 'CDHash');

  if (!authority?.startsWith('Developer ID Application:')) {
    fail(`${target} is not signed by a Developer ID Application identity`);
  }
  if (!teamId || teamId === 'not set') fail(`${target} has no signing TeamIdentifier`);
  if (expectedTeamId && teamId !== expectedTeamId) {
    fail(`${target} is signed by Team ${teamId}, expected ${expectedTeamId}`);
  }
  if (/Signature=adhoc/i.test(output)) fail(`${target} has an ad-hoc signature`);
  if (requireRuntime && !/flags=.*\bruntime\b/i.test(output)) {
    fail(`${target} is missing Hardened Runtime`);
  }
  if (requireTimestamp && (!/^Timestamp=.+$/m.test(output) || /^Signed Time=.+$/m.test(output))) {
    fail(`${target} has no secure signing timestamp`);
  }
  return { authority, teamId, cdHash, output };
}

function entitlementsOf(target) {
  const output = combined('/usr/bin/codesign', ['-d', '--entitlements', ':-', target]);
  const start = output.indexOf('<plist');
  const end = output.lastIndexOf('</plist>');
  if (start < 0 || end < start) return {};
  try {
    return plist.parse(output.slice(start, end + '</plist>'.length));
  } catch (error) {
    fail(`could not parse entitlements for ${target}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertEntitlements(target, allowed, { exact = false } = {}) {
  const entitlements = entitlementsOf(target);
  const keys = Object.keys(entitlements).sort();
  const forbidden = keys.filter((key) => !allowed.has(key));
  if (forbidden.length > 0) {
    fail(`${target} has unexpected entitlements: ${forbidden.join(', ')}`);
  }
  if (exact) {
    const missing = [...allowed].filter((key) => entitlements[key] !== true);
    if (missing.length > 0 || keys.length !== allowed.size) {
      fail(`${target} does not have the exact required entitlements (missing: ${missing.join(', ') || 'none'})`);
    }
  }
  if (entitlements['com.apple.security.get-task-allow'] === true) {
    fail(`${target} enables the forbidden get-task-allow entitlement`);
  }
}

function isRootExecutable(target, appPath) {
  return path.dirname(target) === path.join(appPath, 'Contents', 'MacOS');
}

function isElectronHelperRuntime(target, appPath) {
  const frameworksDirectory = path.join(appPath, 'Contents', 'Frameworks');
  const relative = path.relative(frameworksDirectory, target);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  const segments = relative.split(path.sep);
  if (!/ Helper(?: \([^)]+\))?\.app$/.test(segments[0] ?? '')) return false;
  return segments.length === 1
    || (segments.length === 4 && segments[1] === 'Contents' && segments[2] === 'MacOS');
}

function isMachO(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mode = statSync(filePath).mode;
  if (!MACH_O_EXTENSIONS.has(extension) && (mode & 0o111) === 0) return false;
  const description = run('/usr/bin/file', ['-b', filePath]);
  return /Mach-O/.test(description);
}

function enclosedCode(appPath) {
  const results = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(candidate);
        if (CODE_BUNDLE_EXTENSIONS.has(path.extname(candidate).toLowerCase())) results.push(candidate);
      } else if (entry.isFile() && isMachO(candidate)) {
        results.push(candidate);
      }
    }
  };
  walk(path.join(appPath, 'Contents'));
  return [...new Set(results)].filter((candidate) => candidate !== appPath);
}

function verifyUsageDescriptions(appPath) {
  const infoPath = path.join(appPath, 'Contents', 'Info.plist');
  const info = plist.parse(readFileSync(infoPath, 'utf8'));
  for (const key of [
    'NSAppleEventsUsageDescription',
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
  ]) {
    if (typeof info[key] !== 'string' || info[key].trim().length === 0) {
      fail(`${infoPath} is missing ${key}`);
    }
  }
}

function verifyMacApp(appPath, { verifyEveryComponent = true } = {}) {
  const resolvedApp = path.resolve(appPath);
  if (process.platform !== 'darwin') fail('official macOS verification must run on macOS');
  if (!existsSync(resolvedApp) || !lstatSync(resolvedApp).isDirectory()) {
    fail(`application bundle not found: ${resolvedApp}`);
  }

  combined('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', resolvedApp]);
  const root = signatureInfo(resolvedApp);
  assertEntitlements(resolvedApp, ROOT_ENTITLEMENTS, { exact: true });
  verifyUsageDescriptions(resolvedApp);

  let componentCount = 0;
  if (verifyEveryComponent) {
    const components = enclosedCode(resolvedApp);
    if (components.length === 0) fail(`${resolvedApp} contains no discoverable signed components`);
    for (const component of components) {
      combined('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', component]);
      signatureInfo(component, root.teamId);
      if (isRootExecutable(component, resolvedApp)) {
        assertEntitlements(component, ROOT_ENTITLEMENTS, { exact: true });
      } else if (isElectronHelperRuntime(component, resolvedApp)) {
        assertEntitlements(component, CHILD_ENTITLEMENTS, { exact: true });
      } else {
        assertEntitlements(component, new Set(), { exact: true });
      }
    }
    componentCount = components.length;
  }

  validateStapledTicket(resolvedApp);
  combined('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', resolvedApp]);
  return { ...root, appPath: resolvedApp, componentCount };
}

module.exports = {
  CHILD_ENTITLEMENTS,
  ROOT_ENTITLEMENTS,
  signatureInfo,
  validateStapledTicket,
  verifyMacApp,
};
