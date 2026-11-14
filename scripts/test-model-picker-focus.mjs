import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire, Module } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// Exercise the real React focus handler. Native popover placement and touch
// selection are separately checked by the iOS acceptance test.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://models.test', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Event']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
dom.window.HTMLElement.prototype.showPopover = function () {};
dom.window.HTMLElement.prototype.hidePopover = function () {};
const matches = dom.window.Element.prototype.matches;
dom.window.Element.prototype.matches = function (selector) {
  return selector === ':popover-open' ? false : matches.call(this, selector);
};
const require = createRequire(import.meta.url);
const React = require('react');
const { createRoot } = require('react-dom/client');
const fixture = await build({
  stdin: { contents: "export { ModelPicker } from './src/components/ModelPicker'; export { setActiveLang } from './src/i18n'; export { installMobileKeyboard } from './src/mobileWeb/mobileKeyboard';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'], loader: { '.css': 'empty', '.svg': 'dataurl' },
});
const module = new Module(path.join(process.cwd(), 'scripts', 'model-picker-focus-fixture.cjs'));
module.paths = Module._nodeModulePaths(process.cwd());
module._compile(fixture.outputFiles[0].text, module.id);
const { ModelPicker, setActiveLang, installMobileKeyboard } = module.exports;
setActiveLang('es');
after(() => dom.window.close());

async function mount({ mobileKeyboard = false } = {}) {
  const container = document.createElement('div'); document.body.append(container);
  const objective = document.createElement('textarea'); document.body.append(objective);
  const outside = document.createElement('button'); document.body.append(outside);
  const removeKeyboard = mobileKeyboard ? installMobileKeyboard(document) : () => {};
  const root = createRoot(container), selections = [];
  await React.act(async () => root.render(React.createElement(ModelPicker, {
    settings: { favorites: [{ provider: 'deepseek', model: 'deepseek-chat' }] },
    value: null, ariaLabel: 'Modelo', onChange: value => selections.push(value),
  })));
  const trigger = container.querySelector('.model-picker-trigger');
  await React.act(async () => { objective.focus(); trigger.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  const search = container.querySelector('input');
  assert.ok(search, 'opening exposes the model search');
  return { container, trigger, search, outside, selections,
    async close() { removeKeyboard(); await React.act(async () => root.unmount()); container.remove(); objective.remove(); outside.remove(); } };
}

test('a model click keeps its newly focused search open when the mobile keyboard handler is installed', async () => {
  const view = await mount({ mobileKeyboard: true });
  try {
    assert.equal(document.activeElement, view.search);
    assert.ok(view.container.querySelector('[role="listbox"]'));
  } finally { await view.close(); }
});

test('a completed click that focuses a new field does not immediately dismiss that field', async () => {
  const root = document.createElement('div');
  root.innerHTML = '<textarea></textarea><button>Open editor</button><input>';
  document.body.append(root);
  const removeKeyboard = installMobileKeyboard(document);
  try {
    const before = root.querySelector('textarea'), after = root.querySelector('input');
    const button = root.querySelector('button');
    button.addEventListener('click', () => after.focus());
    before.focus(); button.click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(document.activeElement, after, 'the click opened this field; dismissing the previous editor must preserve it');
  } finally { removeKeyboard(); root.remove(); }
});

test('touching an editor delays forced focus until the completed click to preserve modal hit coordinates', async () => {
  const editor = document.createElement('textarea'); document.body.append(editor);
  const removeKeyboard = installMobileKeyboard(document);
  try {
    editor.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    assert.notEqual(document.activeElement, editor, 'pointerdown must not move a keyboard-sensitive modal before mousedown and click');
    editor.click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(document.activeElement, editor, 'the completed touch must focus the editor');
  } finally { removeKeyboard(); editor.remove(); }
});

test('a null relatedTarget while focus stays inside preserves the menu and permits selection', async () => {
  const view = await mount();
  try {
    await React.act(async () => {
      view.search.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    assert.ok(view.container.querySelector('[role="listbox"]'), 'an internal focus transition must not close the menu');
    const model = [...view.container.querySelectorAll('[role="option"]')].find(option => option.textContent.includes('deepseek-chat'));
    assert.ok(model);
    assert.equal(model.getAttribute('aria-label'), 'DeepSeek · deepseek-chat', 'options name their own provider and model');
    await React.act(async () => model.click());
    assert.deepEqual(view.selections, [{ provider: 'deepseek', model: 'deepseek-chat' }]);
    assert.equal(view.container.querySelector('[role="listbox"]'), null);
  } finally { await view.close(); }
});

test('moving keyboard focus outside closes the menu and clears its search', async () => {
  const view = await mount();
  try {
    await React.act(async () => { view.outside.focus(); await new Promise(resolve => setTimeout(resolve, 20)); });
    assert.equal(view.container.querySelector('[role="listbox"]'), null);
    await React.act(async () => view.trigger.click());
    assert.equal(view.container.querySelector('input').value, '');
  } finally { await view.close(); }
});
