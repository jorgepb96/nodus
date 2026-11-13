import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  classifyInstallerAsset,
  classifyReleaseAsset,
  fetchAllReleases,
  isZoteroPluginAsset,
  pickLatestRelease,
  refreshReleaseDownloadStats,
  sumReleaseDownloads,
} from './github-release-downloads.mjs';

function response(body, { status = 200, link = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'link' ? link : null) },
    json: async () => body,
  };
}

test('classifies the supported packages by operating system', () => {
  assert.equal(classifyReleaseAsset('nodus-linux-amd64.deb'), 'linux');
  assert.equal(classifyReleaseAsset('Nodus-x86_64.AppImage'), 'linux');
  assert.equal(classifyReleaseAsset('Nodus-linux-x86_64.rpm'), 'linux');
  assert.equal(classifyReleaseAsset('Nodus-mac-arm64.dmg'), 'macos');
  assert.equal(classifyReleaseAsset('Nodus-mac-arm64.zip'), 'macos');
  assert.equal(classifyReleaseAsset('Nodus-mac-x64.dmg'), 'macos');
  assert.equal(classifyReleaseAsset('Nodus-mac-x64.zip'), 'macos');
  assert.equal(classifyReleaseAsset('Nodus-win-x64.exe'), 'windows');
  assert.equal(classifyReleaseAsset('checksums.txt'), null);
});

test('excludes updater metadata and blockmaps before classifying extensions', () => {
  assert.equal(classifyReleaseAsset('latest.yml'), null);
  assert.equal(classifyReleaseAsset('latest-mac.yml'), null);
  assert.equal(classifyReleaseAsset('latest-linux.YML'), null);
  assert.equal(classifyReleaseAsset('Nodus.exe.blockmap'), null);
  assert.equal(classifyReleaseAsset('Nodus.AppImage.blockmap'), null);
});

test('names the installer each row of the README download table links', () => {
  assert.equal(classifyInstallerAsset('Nodus-mac-arm64.dmg'), 'macosArm64');
  assert.equal(classifyInstallerAsset('Nodus-mac-x64.dmg'), 'macosIntel');
  assert.equal(classifyInstallerAsset('Nodus-win-x64.exe'), 'windows');
  assert.equal(classifyInstallerAsset('Nodus-linux-amd64.deb'), 'linuxDeb');
  assert.equal(classifyInstallerAsset('Nodus-linux-x86_64.rpm'), 'linuxRpm');
  assert.equal(classifyInstallerAsset('Nodus-linux-x86_64.AppImage'), 'linuxAppImage');
});

test('recognises the version-prefixed installers older releases published', () => {
  assert.equal(classifyInstallerAsset('Nodus-2.4.0-mac-arm64.dmg'), 'macosArm64');
  assert.equal(classifyInstallerAsset('Nodus-2.4.0-arm64.dmg'), 'macosArm64');
  assert.equal(classifyInstallerAsset('Nodus-2.4.0-linux-amd64.deb'), 'linuxDeb');
  assert.equal(classifyInstallerAsset('Nodus-2.4.0-win-x64.exe'), 'windows');
  assert.equal(classifyInstallerAsset('Nodus-Setup-0.1.0.exe'), 'windows');
});

test('the macOS update archive counts in the row of the build it updates', () => {
  // electron-updater fetches these itself. macOS is the only platform that
  // publishes the update apart from the installer (the Windows .exe and the Linux
  // AppImage are both at once), and a row counts what delivers its build.
  assert.equal(classifyInstallerAsset('Nodus-mac-arm64.zip'), 'macosArm64');
  assert.equal(classifyInstallerAsset('Nodus-mac-x64.zip'), 'macosIntel');
  assert.equal(classifyInstallerAsset('Nodus-2.4.0-mac-arm64.zip'), 'macosArm64');
});

test('the files that are not a download of any build count in no row', () => {
  assert.equal(classifyInstallerAsset('nodus-zotero.xpi'), null);
  assert.equal(classifyInstallerAsset('checksums.txt'), null);
  assert.equal(classifyInstallerAsset('latest-mac.yml'), null);
  assert.equal(classifyInstallerAsset('updates.json'), null);
  assert.equal(classifyInstallerAsset('Nodus-win-x64.exe.blockmap'), null);
  assert.equal(classifyInstallerAsset('Nodus-mac-arm64.zip.blockmap'), null);
});

test('a macOS package that does not name an architecture names no row', () => {
  // Every package the project has published names one, which is what makes the
  // six counters add up to `total`. Pinned so the day one does not, this test
  // fails instead of the README quietly losing the difference.
  assert.equal(classifyInstallerAsset('Nodus-macos.zip'), null);
  assert.equal(classifyInstallerAsset('Nodus.dmg'), null);
  assert.equal(classifyReleaseAsset('Nodus.dmg'), 'macos');
});

test('sums several releases, skips drafts and keeps the platform breakdown', () => {
  const counts = sumReleaseDownloads([
    {
      draft: false,
      assets: [
        { name: 'Nodus-linux-amd64.deb', download_count: 10 },
        { name: 'Nodus-linux-x86_64.AppImage', download_count: 20 },
        { name: 'Nodus-mac-arm64.dmg', download_count: 30 },
      ],
    },
    {
      draft: false,
      assets: [
        { name: 'Nodus-mac-x64.zip', download_count: 40 },
        { name: 'Nodus-win-x64.exe', download_count: 50 },
        { name: 'latest.yml', download_count: 999 },
      ],
    },
    { draft: true, assets: [{ name: 'Nodus-win-x64.exe', download_count: 1000 }] },
  ]);

  const { latest, ...historical } = counts;
  assert.deepEqual(historical, {
    linux: 30,
    macos: 70,
    windows: 50,
    total: 150,
    installers: {
      macosArm64: 30,
      macosIntel: 40,
      windows: 50,
      linuxDeb: 10,
      linuxRpm: 0,
      linuxAppImage: 20,
    },
    zotero: 0,
    overall: 150,
  });
  assert.equal(counts.macos, counts.installers.macosArm64 + counts.installers.macosIntel);
  // Without dates, the first non-draft release in GitHub's order is the latest.
  assert.equal(latest.total, 60);
});

test('the row counters add up to the total', () => {
  // The property the README table leans on: a reader can add the column and land
  // on the badge in the header. Only the macOS update archives needed counting to
  // make it true, since every other package is both the installer and the update.
  const counts = sumReleaseDownloads([
    {
      draft: false,
      assets: [
        { name: 'Nodus-mac-arm64.dmg', download_count: 353 },
        { name: 'Nodus-mac-arm64.zip', download_count: 431 },
        { name: 'Nodus-mac-x64.dmg', download_count: 14 },
        { name: 'Nodus-mac-x64.zip', download_count: 2 },
        { name: 'Nodus-win-x64.exe', download_count: 660 },
        { name: 'Nodus-linux-amd64.deb', download_count: 106 },
        { name: 'Nodus-linux-x86_64.AppImage', download_count: 244 },
        // Ignored by both: metadata, updater manifests and the plugin.
        { name: 'Nodus-mac-arm64.zip.blockmap', download_count: 248 },
        { name: 'latest-mac.yml', download_count: 4605 },
        { name: 'nodus-zotero.xpi', download_count: 790 },
      ],
    },
  ]);

  const rows = Object.values(counts.installers).reduce((sum, count) => sum + count, 0);
  assert.equal(rows, counts.total);
  assert.equal(rows, 1810);
});

test('the Zotero plugin has its own counter, outside the app total', () => {
  assert.equal(isZoteroPluginAsset('nodus-zotero.xpi'), true);
  assert.equal(isZoteroPluginAsset('Nodus-Zotero.XPI'), true);
  assert.equal(isZoteroPluginAsset('nodus-zotero.xpi.blockmap'), false);
  assert.equal(isZoteroPluginAsset('updates.json'), false);

  const counts = sumReleaseDownloads([
    { draft: false, assets: [
      { name: 'Nodus-win-x64.exe', download_count: 10 },
      { name: 'nodus-zotero.xpi', download_count: 4 },
    ] },
    { draft: false, assets: [{ name: 'nodus-zotero.xpi', download_count: 3 }] },
    { draft: true, assets: [{ name: 'nodus-zotero.xpi', download_count: 100 }] },
  ]);
  assert.equal(counts.total, 10, 'the plugin is not a build of the app');
  assert.equal(counts.zotero, 7);
  assert.equal(counts.overall, 17, 'the Total row adds the plugin to the app');
});

test('the latest release is the newest published one that is not a prerelease', () => {
  const releases = [
    { tag_name: 'v3.0.0', draft: true, published_at: null, created_at: '2026-11-05T00:00:00Z' },
    { tag_name: 'v2.1.0-beta', prerelease: true, published_at: '2026-11-04T00:00:00Z' },
    { tag_name: 'v2.0.0', published_at: '2026-11-03T00:00:00Z' },
    { tag_name: 'v1.9.1', published_at: '2026-11-01T00:00:00Z' },
  ];
  assert.equal(pickLatestRelease(releases)?.tag_name, 'v2.0.0');
  // GitHub orders by creation; a later-published backport still loses to the newest.
  assert.equal(pickLatestRelease([...releases].reverse())?.tag_name, 'v2.0.0');
  assert.equal(pickLatestRelease([{ draft: true }, { prerelease: true }]), null);
});

test('the latest-version column counts only the release the links resolve to', () => {
  const counts = sumReleaseDownloads([
    { tag_name: 'v2.0.0', published_at: '2026-11-03T00:00:00Z', assets: [
      { name: 'Nodus-mac-arm64.dmg', download_count: 5 },
      { name: 'Nodus-mac-arm64.zip', download_count: 6 },
      { name: 'Nodus-linux-x86_64.rpm', download_count: 2 },
      { name: 'nodus-zotero.xpi', download_count: 9 },
      { name: 'latest-mac.yml', download_count: 500 },
    ] },
    { tag_name: 'v1.0.0', published_at: '2026-10-01T00:00:00Z', assets: [
      { name: 'Nodus-mac-arm64.dmg', download_count: 100 },
      { name: 'nodus-zotero.xpi', download_count: 50 },
    ] },
  ]);

  assert.equal(counts.latest.version, 'v2.0.0');
  assert.equal(counts.latest.installers.macosArm64, 11);
  assert.equal(counts.latest.installers.linuxRpm, 2);
  assert.equal(counts.latest.total, 13);
  assert.equal(counts.latest.zotero, 9);
  assert.equal(counts.latest.overall, 22);
  const latestRows = Object.values(counts.latest.installers).reduce((sum, n) => sum + n, 0);
  assert.equal(latestRows, counts.latest.total, 'the latest column adds up like the total one');

  assert.equal(counts.installers.macosArm64, 111);
  assert.equal(counts.zotero, 59);
  assert.equal(counts.overall, 172);
});

test('accepts releases without assets', () => {
  const empty = {
    linux: 0,
    macos: 0,
    windows: 0,
    total: 0,
    installers: {
      macosArm64: 0,
      macosIntel: 0,
      windows: 0,
      linuxDeb: 0,
      linuxRpm: 0,
      linuxAppImage: 0,
    },
    zotero: 0,
    overall: 0,
  };
  assert.deepEqual(sumReleaseDownloads([{ draft: false }, { draft: false, assets: [] }]), {
    ...empty,
    latest: { ...empty, version: null },
  });
  assert.deepEqual(sumReleaseDownloads([]).latest, { ...empty, version: null });
});

test('requests every GitHub Releases page with per_page=100', async () => {
  const calls = [];
  const firstPage = Array.from({ length: 100 }, (_, id) => ({ id, assets: [] }));
  const releases = await fetchAllReleases({
    token: 'server-only-test-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return response(firstPage, {
          link: '<https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="next", <https://api.github.com/repositories/1/releases?per_page=100&page=2>; rel="last"',
        });
      }
      return response([{ id: 101, assets: [] }]);
    },
  });

  assert.equal(releases.length, 101);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /per_page=100/);
  assert.match(calls[0].url, /page=1/);
  assert.match(calls[1].url, /page=2/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer server-only-test-token');
});

test('keeps the last valid value when GitHub returns an error', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nodus-release-downloads-'));
  const outputPath = path.join(directory, 'stats.json');
  const previous = {
    linux: 11,
    macos: 22,
    windows: 33,
    total: 66,
    installers: {
      macosArm64: 20,
      macosIntel: 2,
      windows: 33,
      linuxDeb: 6,
      linuxRpm: 0,
      linuxAppImage: 5,
    },
    zotero: 4,
    latest: {
      linux: 1,
      macos: 2,
      windows: 3,
      total: 6,
      installers: {
        macosArm64: 2,
        macosIntel: 0,
        windows: 3,
        linuxDeb: 1,
        linuxRpm: 0,
        linuxAppImage: 0,
      },
      zotero: 1,
      version: 'v1.2.3',
      overall: 7,
    },
    overall: 70,
    updatedAt: '2026-07-17T03:17:00.000Z',
  };

  try {
    await writeFile(outputPath, `${JSON.stringify(previous, null, 2)}\n`, 'utf8');
    const before = await readFile(outputPath, 'utf8');
    const result = await refreshReleaseDownloadStats({
      outputPath,
      fetchImpl: async () => response({ message: 'temporary failure' }, { status: 503 }),
    });

    assert.equal(result.updated, false);
    assert.equal(result.stale, true);
    assert.deepEqual(result.stats, previous);
    assert.equal(await readFile(outputPath, 'utf8'), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a stats file that predates the installer breakdown is still a fallback', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nodus-release-downloads-'));
  const outputPath = path.join(directory, 'stats.json');
  const legacy = {
    linux: 11,
    macos: 22,
    windows: 33,
    total: 66,
    updatedAt: '2026-07-17T03:17:00.000Z',
  };

  try {
    await writeFile(outputPath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');
    const result = await refreshReleaseDownloadStats({
      outputPath,
      fetchImpl: async () => response({ message: 'temporary failure' }, { status: 503 }),
    });

    assert.equal(result.updated, false);
    assert.equal(result.stale, true);
    assert.deepEqual(result.stats.installers, {
      macosArm64: 0,
      macosIntel: 0,
      windows: 0,
      linuxDeb: 0,
      linuxRpm: 0,
      linuxAppImage: 0,
    });
    assert.equal(result.stats.total, 66);
    assert.equal(result.stats.zotero, 0);
    assert.equal(result.stats.overall, 66);
    assert.equal(result.stats.latest.total, 0);
    assert.equal(result.stats.latest.version, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
