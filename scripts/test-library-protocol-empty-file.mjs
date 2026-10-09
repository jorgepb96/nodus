// nodus-library:// must describe an empty file as zero bytes long.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-library-protocol-'));
test.after(() => fs.rmSync(userData, { recursive: true, force: true }));
const handlers = {};
installRuntimeHooks(userData, { protocol: { handle: (scheme, handler) => { handlers[scheme] = handler; }, registerSchemesAsPrivileged() {} } });
const require = createRequire(import.meta.url);
const Module = require('node:module');
const empty = path.join(userData, 'empty.pdf');
fs.writeFileSync(empty, '');
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('libraryReader/libraryReaderStore')) return { libraryReaderOriginalPath: () => empty, libraryReaderAttachmentPath: () => empty };
  return load.call(this, request, parent, isMain);
};
require(path.join(root, 'electron/libraryProtocol.ts')).registerLibraryProtocol();

test('an empty file is served with Content-Length 0', async () => {
  const response = await handlers['nodus-library'](new Request('nodus-library://original/doc1'));
  const body = new Uint8Array(await response.arrayBuffer());
  assert.equal(response.status, 200);
  assert.equal(body.length, 0);
  assert.equal(response.headers.get('content-length'), String(body.length));
});
