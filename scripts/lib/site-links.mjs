// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// Local link and asset checks for the static site. A page's relative and
// root-relative href/src values must point at files that exist in site/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const siteRoot = path.join(repoRoot, 'site');

const ATTRIBUTE = /\b(?:href|src)\s*=\s*"([^"]*)"/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\$\{)/i;

/** Every local href/src in the page (relative or root-relative), without query or hash. */
export function localReferences(htmlPath) {
  const html = fs.readFileSync(path.resolve(repoRoot, htmlPath), 'utf8');
  const found = new Set();
  for (const [, raw] of html.matchAll(ATTRIBUTE)) {
    const value = raw.trim();
    if (!value || EXTERNAL.test(value)) continue;
    const clean = value.split('#')[0].split('?')[0];
    if (clean) found.add(clean);
  }
  return [...found];
}

function targetFile(htmlPath, reference) {
  const pageDir = path.dirname(path.resolve(repoRoot, htmlPath));
  const decoded = decodeURI(reference);
  const absolute = decoded.startsWith('/') ? path.join(siteRoot, decoded) : path.resolve(pageDir, decoded);
  return decoded.endsWith('/') || decoded === '.' || decoded === './' ? path.join(absolute, 'index.html') : absolute;
}

/** Fails with the list of references whose target file does not exist. */
export function assertLocalReferencesResolve(htmlPath) {
  const missing = localReferences(htmlPath).filter((reference) => !fs.existsSync(targetFile(htmlPath, reference)));
  assert.deepEqual(missing, [], `${htmlPath} has local references that do not resolve`);
}
