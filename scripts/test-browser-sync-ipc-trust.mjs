import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

// The synchronous Browser IPC handlers run outside the shared `h` wrapper, so each checks its
// sender itself. browser:setSectionVisibleSync swallowed that check's failure and toggled the
// view anyway.

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'electron/ipc/browser.ts'), 'utf8');

function handler(channel) {
  const start = source.indexOf(`ipcMain.on('${channel}'`);
  assert.ok(start >= 0, channel);
  const next = source.indexOf('\n  });\n', start);
  return source.slice(start, next);
}

for (const channel of ['browser:setSectionVisibleSync', 'browser:setViewportSync']) {
  test(`${channel} acts only after its sender check passes`, () => {
    const body = handler(channel);
    const check = body.indexOf('assertUiSender(');
    const tryOpen = body.lastIndexOf('try {', check);
    const catchAt = body.indexOf('catch', check);
    assert.ok(check > 0 && tryOpen >= 0 && catchAt > check, 'the check is inside a try');
    assert.doesNotMatch(body, /catch \{\}/, 'its failure is not swallowed with the action carried on');
    const action = channel === 'browser:setSectionVisibleSync' ? 'setSectionVisible(' : 'setViewport(';
    const actionAt = body.indexOf(action);
    assert.ok(actionAt > check && actionAt < catchAt, `${action} runs inside the try, after the check`);
    assert.match(body.slice(catchAt), /returnValue = null/, 'and sendSync is still released');
  });
}
