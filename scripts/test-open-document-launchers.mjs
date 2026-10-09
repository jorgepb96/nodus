import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

// A preserved source or library attachment can come from someone else (a research package,
// server sync, a Zotero group). "Open" must not RUN it: a `.command` copy Nodus writes itself has
// no quarantine flag, so macOS would run it in Terminal without asking.

const root = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-open-document-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the handlers that open a stored file do not hand it to openPath directly', () => {
  const sites = [
    ['electron/ipc/primarySources.ts', /primarySources:files:openExternal[\s\S]*?openDocumentPath\(target\)/],
    ['electron/ipc/library.ts', /library:openAttachment[^\n]*openDocumentPath\(/],
    ['electron/ipc/academic.ts', /libraryReader:openOriginal[\s\S]{0,300}openDocumentPath\(originalPath\)/],
  ];
  for (const [file, pattern] of sites) assert.match(source(file), pattern, `${file} opens through openDocumentPath`);
});

test('a file that would run when opened is recognised; a document is not', async () => {
  const bundle = path.join(scratch, 'launchable.cjs');
  await build({ entryPoints: [path.join(root, 'electron/util/launchableFiles.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { launchesOnOpen } = createRequire(import.meta.url)(bundle);
  for (const name of ['transcription.command', 'x.TERMINAL', 'notes.fileloc', 'site.webloc', 'tool.jar', 'Setup.pkg', 'a.scpt', 'run.sh', 'x.py'])
    assert.equal(launchesOnOpen(path.join(scratch, name)), true, name);
  for (const name of ['paper.pdf', 'scan.tiff', 'letter.docx', 'book.epub', 'notes.txt', 'page.html'])
    assert.equal(launchesOnOpen(path.join(scratch, name)), false, name);

  const bundleDir = path.join(scratch, 'Viewer');
  fs.mkdirSync(bundleDir);
  assert.equal(launchesOnOpen(bundleDir), true, 'a directory is a bundle');
  const bare = path.join(scratch, 'README');
  fs.writeFileSync(bare, '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(launchesOnOpen(bare), true, 'an extensionless executable opens in Terminal');
  fs.chmodSync(bare, 0o644);
  assert.equal(launchesOnOpen(bare), false);
  const pdf = path.join(scratch, 'copied-from-usb.pdf');
  fs.writeFileSync(pdf, '%PDF', { mode: 0o777 });
  assert.equal(launchesOnOpen(pdf), false, 'an execute bit on a document does not make it a program');
});
