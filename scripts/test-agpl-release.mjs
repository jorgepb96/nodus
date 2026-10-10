// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');
const json = async (relative) => JSON.parse(await read(relative));

const AGPL_SHA256 = '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0';
const LICENSE_ID = 'AGPL-3.0-only';
const VERSION = '5.8.1';

test('Nodus 5 carries the unmodified GNU AGPL v3 license text', async () => {
  const license = await read('LICENSE');
  assert.equal(createHash('sha256').update(license).digest('hex'), AGPL_SHA256);
  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(license, /13\. Remote Network Interaction/);
});

test('all first-party release metadata identifies 5.8.1 as AGPL-3.0-only', async () => {
  const [pkg, lock, serverPkg, plugin, citation] = await Promise.all([
    json('package.json'),
    json('package-lock.json'),
    json('server/package.json'),
    json('zotero-plugin/manifest.json'),
    read('CITATION.cff'),
  ]);

  assert.equal(pkg.version, VERSION);
  assert.equal(pkg.license, LICENSE_ID);
  assert.equal(lock.version, VERSION);
  assert.equal(lock.packages[''].version, VERSION);
  assert.equal(lock.packages[''].license, LICENSE_ID);
  assert.equal(serverPkg.version, VERSION);
  assert.equal(serverPkg.license, LICENSE_ID);
  assert.equal(plugin.version, VERSION);
  assert.equal(plugin.license, LICENSE_ID);
  assert.match(citation, new RegExp(`^version: "${VERSION.replace(/\./g, '\\.')}"$`, 'm'));
  assert.match(citation, /^license: ["']AGPL-3\.0-only["']$/m);
});

test('desktop, server, container and Zotero package expose corresponding source', async () => {
  const [pkg, versionModule, server, api, dockerfile, xpiBuilder, sourceOffer] = await Promise.all([
    json('package.json'),
    read('server/lib/version.mjs'),
    read('server/server.mjs'),
    read('server/lib/routes/api.mjs'),
    read('server/Dockerfile'),
    read('scripts/build-zotero-xpi.mjs'),
    read('SOURCE_CODE.md'),
  ]);

  const resources = pkg.build.extraResources.map((entry) => `${entry.from}:${entry.to}`);
  assert.ok(resources.includes('LICENSE:legal/NODUS_LICENSE.txt'));
  assert.ok(resources.includes('SOURCE_CODE.md:legal/SOURCE_CODE.md'));
  assert.match(versionModule, /export const NODUS_LICENSE = 'AGPL-3\.0-only'/);
  assert.match(versionModule, /NODUS_SOURCE_URL/);
  assert.match(server, /license: NODUS_LICENSE, sourceCodeUrl: NODUS_SOURCE_URL/);
  assert.match(server, /data-testid="source-code"/);
  assert.match(api, /sourceCodeUrl: NODUS_SOURCE_URL/);
  assert.match(dockerfile, /org\.opencontainers\.image\.licenses="AGPL-3\.0-only"/);
  assert.match(dockerfile, /COPY LICENSE SOURCE_CODE\.md THIRD_PARTY_NOTICES\.md/);
  assert.match(xpiBuilder, /SOURCE_CODE\.md/);
  assert.match(sourceOffer, /NODUS_SOURCE_URL/);
  assert.match(sourceOffer, new RegExp(`releases/tag/v${VERSION.replace(/\./g, '\\.')}`));
});

test('project licensing scope is machine-readable and historical MIT releases stay documented', async () => {
  const [reuse, exceptions, notices, readme, contributing, privacy, site] = await Promise.all([
    read('REUSE.toml'),
    json('legal/license-exceptions.json'),
    read('THIRD_PARTY_NOTICES.md'),
    read('README.md'),
    read('CONTRIBUTING.md'),
    read('PRIVACY.md'),
    read('site/index.html'),
  ]);

  assert.match(reuse, /SPDX-License-Identifier = "AGPL-3\.0-only"/);
  assert.equal(exceptions.projectLicense, LICENSE_ID);
  assert.ok(exceptions.entries.length >= 4);
  assert.match(notices, /Versions through 3\.2\.7 remain\s+available under MIT/);
  assert.match(readme, /AGPL-3\.0-only/);
  assert.match(contributing, /Contributions also require explicit acceptance/);
  assert.match(contributing, /\[Nodus Research Contributor License Agreement\]\(CLA.md\)/);
  assert.doesNotMatch(contributing, /without an additional contributor license agreement/);
  assert.match(privacy, /GNU Affero General Public License v3\.0 only/);
  assert.match(site, /AGPL-3\.0-only/);
  assert.doesNotMatch(site, /Nodus (?:is|es|est|è|ist|é).*\bMIT\b/);
});
