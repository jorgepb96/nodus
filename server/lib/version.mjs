/**
 * The one version number this project has.
 *
 * The desktop, the iOS app and this server ship as one release and carry one number, so that
 * "which version are you on?" has a single answer and a compatibility problem can be named
 * before it is diagnosed. A server on 3.1.0 and a phone on 3.0.4 is a fact worth seeing on
 * screen; two independent version schemes make it invisible.
 *
 * Written out rather than read from `package.json` because this server has no build step and
 * the Dockerfile copies only what it needs — a file that may or may not be in the image is a
 * poor place for a value four routes depend on. `scripts/test-version-agreement.mjs` fails if
 * this drifts from the root `package.json`, from `server/package.json`, or from the two iOS
 * targets in `ios/project.yml`.
 */
// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

export const NODUS_VERSION = '5.8.1';
export const NODUS_LICENSE = 'AGPL-3.0-only';

const OFFICIAL_SOURCE_URL = `https://github.com/jorgepb96/nodus/tree/v${NODUS_VERSION}`;

function configuredSourceUrl(value) {
  const candidate = String(value ?? '').trim() || OFFICIAL_SOURCE_URL;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('NODUS_SOURCE_URL must be an absolute http(s) URL for the deployed Corresponding Source.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('NODUS_SOURCE_URL must use http or https.');
  }
  return parsed.toString().replace(/\/$/, '');
}

/** Exact Corresponding Source offered to remote users under AGPLv3 section 13. */
export const NODUS_SOURCE_URL = configuredSourceUrl(process.env.NODUS_SOURCE_URL);
