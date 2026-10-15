// SPDX-License-Identifier: AGPL-3.0-only
// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

export function extensionTestChromium() {
  const candidates = [process.env.NODUS_TEST_CHROMIUM, chromium.executablePath()];
  const cache = process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Caches/ms-playwright')
    : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright') : path.join(os.homedir(), '.cache/ms-playwright');
  if (existsSync(cache)) for (const version of readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))) {
    for (const suffix of ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-linux64/chrome', 'chrome-win64/chrome.exe']) candidates.push(path.join(cache, version, suffix));
  }
  candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const executable = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) throw new Error('Set NODUS_TEST_CHROMIUM to a Chromium/Chrome for Testing executable.');
  return executable;
}
