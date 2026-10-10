import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire, Module } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// Render the production view and exercise its promises and visible Retry button.
// JSDOM supplies no visual or native-device acceptance evidence.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://catalog.test', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'CustomEvent', 'Event', 'MutationObserver', 'DOMRect', 'DOMParser', 'localStorage']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.CSS = dom.window.CSS ?? {};
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const React = require('react');
const { createRoot } = require('react-dom/client');
const fixture = await build({
  stdin: { contents: "export { DeepResearchView } from './src/views/DeepResearchView'; export { FeedbackHost } from './src/components/feedback'; export { savedResearchCatalog } from './shared/savedResearchCatalog'; export { DEFAULT_APP_SETTINGS } from './shared/defaultAppSettings'; export { setActiveLang } from './src/i18n';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  loader: { '.css': 'empty', '.svg': 'dataurl' },
  // Use the same audio boundary as the production mobile bundle; no TTS model
  // or provider is started by this consultation/recovery test.
  plugins: [{ name: 'mobile-audio', setup(builder) {
    builder.onResolve({ filter: /\/(AudioPanel|StudyDictation)$/ }, () => ({ path: path.resolve('src/mobileWeb/MobileAudio.tsx') }));
  } }],
});
const module = new Module(path.join(process.cwd(), 'scripts', 'deep-research-catalog-fixture.cjs'));
module.paths = Module._nodeModulePaths(process.cwd());
module._compile(fixture.outputFiles[0].text, module.id);
const { DeepResearchView, FeedbackHost, savedResearchCatalog, DEFAULT_APP_SETTINGS, setActiveLang } = module.exports;
setActiveLang('es');
after(() => dom.window.close());

const report = id => ({ id, title: `Informe ${id}`, brief: { kind: 'deep_research', objective: 'Pregunta' },
  selection: { ideaIds: [], themeIds: [], authorIds: [], workIds: [] }, model: null, image: null, readAt: null,
  createdAt: '2026-10-09T10:00:00Z', updatedAt: '2026-10-09T10:00:00Z',
  draft: { title: `Informe ${id}`, abstract: 'Resumen', draftMarkdown: '# Sección\n\nTexto guardado.',
    outline: [], matrix: [], bibliography: [], nextSteps: [], limitations: [], generatedAt: '2026-10-09T10:00:00Z' } });

async function mount(props = {}, bridgeOverrides = {}) {
  localStorage.clear();
  window.nodusMobileConfig = { live: true };
  const requests = [], listeners = new Map();
  window.nodus = new Proxy({}, { get(_, name) {
    if (Object.hasOwn(bridgeOverrides, name)) return bridgeOverrides[name];
    if (String(name).startsWith('on')) return listener => { listeners.set(name, listener); return () => listeners.delete(name); };
    if (name === 'listWritingWorkshopDrafts') return () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
    if (name === 'getSettings') return async () => DEFAULT_APP_SETTINGS;
    if (name === 'getDocumentVisuals') return async () => null;
    return async () => [];
  } });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await React.act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement(DeepResearchView, { settings: DEFAULT_APP_SETTINGS, ...props }),
    React.createElement(FeedbackHost))));
  return { container, requests, listeners,
    async retry() { const retry = [...container.querySelectorAll('button')].find(button => button.textContent === 'Reintentar'); assert.ok(retry, 'a visible Retry action is required'); await React.act(async () => retry.click()); },
    async settle(index, value, failure = false) { await React.act(async () => requests[index][failure ? 'reject' : 'resolve'](value)); },
    async close() { await React.act(async () => root.unmount()); container.remove(); } };
}
const error = container => container.querySelector('[data-testid="deep-research-catalog-error"]');
const empty = container => /Aún no hay informes\./.test(container.textContent);

test('large catalogues preserve every report and malformed or duplicate records fail explicitly', () => {
  const records = Array.from({ length: 301 }, (_, index) => report(String(index)));
  assert.equal(savedResearchCatalog(records).length, 301);
  assert.equal(savedResearchCatalog([{ id: 'other', title: 'Borrador', brief: { kind: 'abstract' } }, ...records]).length, 301);
  for (const value of [null, {}, [null], [report('a'), report('a')], [{ ...report('a'), draft: { draftMarkdown: 'Incompleto' } }]]) {
    assert.throws(() => savedResearchCatalog(value), /formato inválido/);
  }
});

test('a transport failure is never an empty library; Retry can confirm a genuinely empty catalogue', async () => {
  const view = await mount();
  try {
    assert.equal(empty(view.container), false); assert.match(view.container.textContent, /Cargando informes/);
    await view.settle(0, new Error('Mac desconectado'), true);
    assert.match(error(view.container).textContent, /Mac desconectado/); assert.equal(empty(view.container), false);
    await view.retry(); assert.equal(error(view.container), null); assert.equal(empty(view.container), false);
    await view.settle(1, []); assert.equal(error(view.container), null); assert.equal(empty(view.container), true);
  } finally { await view.close(); }
});

test('the research composer stays open when focusing its editor retargets mousedown to the backdrop', async () => {
  const view = await mount();
  try {
    await view.settle(0, []);
    const create = [...view.container.querySelectorAll('button')].find(button => button.textContent.includes('Nuevo informe'));
    assert.ok(create); await React.act(async () => create.click());
    const dialog = view.container.querySelector('[role="dialog"]'); assert.ok(dialog);
    const editor = dialog.querySelector('textarea'), backdrop = dialog.parentElement;
    await React.act(async () => {
      editor.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
      backdrop.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
      backdrop.click();
    });
    assert.ok(view.container.querySelector('[role="dialog"]'), 'a touch that started in the editor must not dismiss the composer');
    await React.act(async () => {
      backdrop.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
      backdrop.click();
    });
    assert.equal(view.container.querySelector('[role="dialog"]'), null, 'a completed touch on the backdrop still dismisses');
  } finally { await view.close(); }
});

test('a malformed response offers recovery instead of claiming the library is empty', async () => {
  const view = await mount();
  try { await view.settle(0, {}); assert.match(error(view.container).textContent, /formato inválido/); assert.equal(empty(view.container), false); }
  finally { await view.close(); }
});

test('the shared confirmation permits dismissing or cancelling a running research request', async () => {
  const cancelled = [];
  const job = { id: 'running-fixture', title: 'Informe de prueba', status: 'running', origin: 'mobile',
    enqueuedAt: '2026-10-09T10:00:00Z', progress: { phase: 'planning', message: 'Planificando secciones' }, error: null, saveError: null };
  const view = await mount({}, { listDeepResearchJobs: async () => [job],
    cancelDeepResearchJob: async id => { cancelled.push(id); return true; } });
  try {
    await view.settle(0, []);
    const remove = view.container.querySelector('[aria-label="Quitar de la cola"]'); assert.ok(remove);
    await React.act(async () => remove.click());
    const dialog = document.querySelector('[role="dialog"][aria-label="Quitar de la cola"]'); assert.ok(dialog, 'the confirmation host must render the request');
    const buttons = () => [...document.querySelectorAll('[role="dialog"] button')];
    await React.act(async () => buttons().find(button => button.textContent === 'Cancelar').click());
    assert.deepEqual(cancelled, [], 'dismissing confirmation must leave the Mac job running');
    await React.act(async () => remove.click());
    await React.act(async () => buttons().find(button => button.textContent === 'Eliminar').click());
    assert.deepEqual(cancelled, [job.id], 'confirmation cancels the exact queued request once');
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally { await view.close(); }
});

test('a failure without an error message still exposes recovery and never an empty library', async () => {
  const view = await mount();
  try { await view.settle(0, new Error(''), true); assert.ok(error(view.container)); assert.equal(empty(view.container), false); }
  finally { await view.close(); }
});

test('a stale failed request cannot overwrite the newer successful refresh', async () => {
  const view = await mount();
  try {
    await React.act(async () => view.listeners.get('onWritingDraftsChanged')());
    assert.equal(view.requests.length, 2);
    await view.settle(1, []); await view.settle(0, new Error('Fallo antiguo'), true);
    assert.equal(error(view.container), null); assert.equal(empty(view.container), true);
  } finally { await view.close(); }
});

test('failed reopening retains the saved reader identity and exposes Retry rather than an endless loading pane', async () => {
  const changes = [], saved = report('reopen');
  const view = await mount({ snapshot: { surface: 'reader', openReport: saved, openIds: [saved.id] }, onSnapshotChange: patch => changes.push(patch) });
  try {
    await view.settle(0, new Error('Mac desconectado'), true);
    assert.ok(error(view.container)); assert.equal(empty(view.container), false);
    assert.equal(changes.some(patch => 'openReport' in patch && patch.openReport === null), false);
    await view.retry(); assert.equal(view.requests.length, 2);
    await view.settle(1, [saved]);
    assert.equal(error(view.container), null);
    assert.ok(view.container.querySelector('[data-testid="deep-research-reader-shell"]'), 'the original reader reopens after recovery');
    assert.match(view.container.textContent, /Texto guardado/);
  } finally { await view.close(); }
});
