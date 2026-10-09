// How a browser download is classified, and what Nodus offers to do with it.
//
// The classification decides whether the user is offered "save and import into
// the Library". Getting it wrong is either a missing offer on a paper the
// researcher wanted filed, or a nonsense offer on an installer.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(path.join(tmpdir(), 'nodus-dl-'));
const bundle = path.join(dir, 'dl.cjs');

execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [
    path.join(repoRoot, 'shared/browserDownloads.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`,
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

const require = createRequire(import.meta.url);
const {
  classifyDownload, isImportable, isTooLarge, safeBrowserDownloadName,
  MAX_DOWNLOAD_BYTES, MAX_IMPORTABLE_BYTES,
} = require(bundle);

test('a PDF is recognised by MIME and by extension', () => {
  assert.equal(classifyDownload('article.pdf', ''), 'pdf');
  assert.equal(classifyDownload('download', 'application/pdf'), 'pdf');
  // Charset parameters are normal on real servers.
  assert.equal(classifyDownload('x', 'application/pdf; charset=binary'), 'pdf');
  assert.equal(classifyDownload('X.PDF', ''), 'pdf');
});

test('a declared MIME beats a misleading extension', () => {
  // Publisher download endpoints routinely end in .php or have no extension.
  assert.equal(classifyDownload('download.php', 'application/pdf'), 'pdf');
  assert.equal(classifyDownload('getfile.aspx', 'text/csv'), 'dataset');
});

test('a generic MIME falls back to the extension instead of giving up', () => {
  // application/octet-stream is what most servers send, and it means nothing.
  assert.equal(classifyDownload('thesis.pdf', 'application/octet-stream'), 'pdf');
  assert.equal(classifyDownload('data.csv', 'application/octet-stream'), 'dataset');
  assert.equal(classifyDownload('paper.docx', 'application/octet-stream'), 'document');
});

test('documents and datasets are told apart', () => {
  for (const name of ['a.epub', 'a.docx', 'a.odt', 'a.rtf', 'a.txt', 'a.md', 'a.pptx']) {
    assert.equal(classifyDownload(name, ''), 'document', name);
  }
  for (const name of ['a.csv', 'a.tsv', 'a.xlsx', 'a.ods', 'a.xls']) {
    assert.equal(classifyDownload(name, ''), 'dataset', name);
  }
});

test('installers and archives are not offered an import', () => {
  for (const name of ['setup.exe', 'app.dmg', 'bundle.zip', 'archive.tar.gz', 'thing.pkg', 'x.deb']) {
    const kind = classifyDownload(name, 'application/octet-stream');
    assert.equal(kind, 'other', name);
    assert.equal(isImportable(kind, 1000), false, name);
  }
});

test('media is classified but deliberately not importable', () => {
  // The Library accepts audio and video, but a downloaded MP3 is almost always
  // a file for disk. Offering an import for each one turns the prompt into noise.
  for (const name of ['lecture.mp3', 'talk.mp4', 'interview.wav']) {
    assert.equal(classifyDownload(name, ''), 'media', name);
    assert.equal(isImportable('media', 1000), false, name);
  }
  assert.equal(classifyDownload('stream', 'audio/mpeg'), 'media');
  assert.equal(classifyDownload('clip', 'video/mp4'), 'media');
});

test('importable kinds are offered only under the size cap', () => {
  assert.equal(isImportable('pdf', 1024), true);
  assert.equal(isImportable('pdf', MAX_IMPORTABLE_BYTES), true);
  assert.equal(isImportable('pdf', MAX_IMPORTABLE_BYTES + 1), false);
  assert.equal(isImportable('document', 5_000_000), true);
  assert.equal(isImportable('dataset', 5_000_000), true);
  assert.equal(isImportable('other', 1), false);
});

test('a server that declares no length is still offered an import', () => {
  // Electron reports 0 when Content-Length is missing, which is common. Refusing
  // those would silently drop the offer on a large share of real downloads.
  assert.equal(isImportable('pdf', 0), true);
});

test('anything past the hard cap is refused outright', () => {
  assert.equal(isTooLarge(MAX_DOWNLOAD_BYTES), false);
  assert.equal(isTooLarge(MAX_DOWNLOAD_BYTES + 1), true);
  assert.equal(isTooLarge(0), false);
});

test('the two caps are ordered, so an importable file is never refused first', () => {
  assert.ok(MAX_IMPORTABLE_BYTES < MAX_DOWNLOAD_BYTES);
});

test('missing or hostile input classifies as other rather than throwing', () => {
  for (const [name, mime] of [[undefined, undefined], ['', ''], ['.', ''], ['no-extension', ''], ['__proto__', 'constructor']]) {
    assert.equal(classifyDownload(name, mime), 'other', String(name));
  }
});

test('a site-controlled filename cannot escape the trusted download directory', () => {
  assert.equal(safeBrowserDownloadName('../../vault.sqlite'), 'vault.sqlite');
  assert.equal(safeBrowserDownloadName('..\\..\\vault.sqlite'), 'vault.sqlite');
  assert.equal(safeBrowserDownloadName('/etc/passwd'), 'passwd');
  assert.equal(safeBrowserDownloadName('..'), 'download');
  assert.equal(safeBrowserDownloadName('a\u0000\nb.pdf'), 'ab.pdf');
  assert.equal(safeBrowserDownloadName(undefined), 'download');
  assert.ok(safeBrowserDownloadName('x'.repeat(500)).length <= 240);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a download never replaces a file already in the folder, and is never hidden', async () => {
  const { availableDownloadPath } = require(bundle);
  assert.equal(typeof availableDownloadPath, 'function', 'the save path is chosen, not just joined');
  const folder = mkdtempSync(path.join(tmpdir(), 'nodus-dl-folder-'));
  const { writeFileSync, existsSync } = await import('node:fs');
  try {
    writeFileSync(path.join(folder, 'paper.pdf'), 'the paper from yesterday');
    writeFileSync(path.join(folder, 'paper (1).pdf'), 'and its twin');
    assert.equal(availableDownloadPath(folder, 'paper.pdf', existsSync, path.join), path.join(folder, 'paper (2).pdf'));
    assert.equal(availableDownloadPath(folder, 'notes.txt', existsSync, path.join), path.join(folder, 'notes.txt'));
    assert.equal(availableDownloadPath(folder, '.zshrc', existsSync, path.join), path.join(folder, 'zshrc'));
    assert.equal(availableDownloadPath(folder, 'archive.tar.gz', () => false, path.join), path.join(folder, 'archive.tar.gz'));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('the download handler uses the chosen path, not a bare join', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(path.join(repoRoot, 'electron/browser/downloads.ts'), 'utf8');
  assert.doesNotMatch(source, /setSavePath\(path\.join\(folder, filename\)\)/);
  assert.match(source, /setSavePath\(availableDownloadPath\(folder, filename,/);
});
