// sanitizeModelMarkdown strips callout markers ("> [!NOTE] …") from every block a model writes for
// the complete study guide. Its pattern began `^\s*>?\s*` under the multiline flag, so the blanks
// could run across line breaks: in a run of blank lines every line start rescanned the rest of the
// run, twice over, which is cubic. Measured on the base: 1,000 " \n" pairs 1.0 s, 2,000 8.0 s,
// 4,000 63 s, all on the main process. The marker is now matched within its own line.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
async function load(entry) {
  const built = await build({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node' });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, require_);
  return module.exports;
}
const { sanitizeModelMarkdown } = await load('shared/completeGuide/blocks.ts');

test('a long run of blank lines in a model block is sanitized in linear time', () => {
  for (const pad of [' \n', '\n\t', '\n']) {
    const text = `A paragraph.${pad.repeat(3000)}More text.`;
    const started = performance.now();
    const out = sanitizeModelMarkdown(text);
    const elapsed = performance.now() - started;
    assert.match(out, /^A paragraph\.\n\n[ \t]*More text\.$/);
    assert.ok(elapsed < 1000, `${JSON.stringify(pad)} × 3000 took ${elapsed.toFixed(0)} ms`);
  }
});

test('callout markers are still removed, quoted or not, after blank lines or not', () => {
  assert.equal(sanitizeModelMarkdown('Before.\n\n> [!NOTE] remember this\nAfter.'), 'Before.\n\nAfter.');
  assert.equal(sanitizeModelMarkdown('Before.\n   [!tip-x] aside\n\nAfter.'), 'Before.\n\nAfter.');
  assert.equal(sanitizeModelMarkdown('Before.\n>\t[!WARNING]\nAfter.'), 'Before.\n\nAfter.');
  assert.equal(sanitizeModelMarkdown('Inline [!NOTE] stays.'), 'Inline [!NOTE] stays.');
});
