import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
if (process.platform !== 'darwin') throw new Error('Multipeer transport requires macOS');
const temp = mkdtempSync(path.join(os.tmpdir(), 'nodus-multipeer-'));
try {
  execFileSync(process.execPath, ['scripts/build-presenter-native.cjs'], { stdio: 'inherit' });
  const binary = path.join(temp, 'multipeer-test');
  execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-framework', 'MultipeerConnectivity',
    'build/presenter-native/Protocol.swift', 'build/presenter-native/PeerProtocol.swift',
    'scripts/multipeer-presenter/main.swift', '-o', binary], { stdio: 'inherit' });
  execFileSync(binary, [path.resolve(`build/presenter-native/${process.arch}/nodus-presenter-native`)],
    { stdio: 'inherit', timeout: 55000 });
} finally { rmSync(temp, { recursive: true, force: true }); }
