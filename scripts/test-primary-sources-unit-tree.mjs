// The provenance tree of the primary-sources archive renders in time linear in its size.
//
// UnitTree counted the sources beneath each unit by re-deriving that unit's descendants (a
// fixed-point pass over every unit) once per source row, at every node of the fully expanded
// tree: units x rows x units x depth on every render of the sidebar. An archive of 300 units
// and 3,000 catalogued sources took 2.8 s per sidebar render (16 ms after). This renders such an archive and checks both the
// counts (against the old definition) and that it finishes in well under a second.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire, Module } from 'node:module';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.localStorage = dom.window.localStorage;

const bundle = build({
  stdin: { contents: "export { UnitTree } from './src/views/PrimarySourcesArchiveView';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom', 'react/jsx-runtime'],
  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.webp': 'empty', '.woff2': 'empty' }, logLevel: 'silent',
}).then(result => {
  const module = new Module(path.join(root, 'scripts', 'primary-sources-unit-tree.cjs'));
  module.paths = Module._nodeModulePaths(root);
  module._compile(result.outputFiles[0].text, module.id);
  return module.exports;
});

function archive(unitCount, rowCount) {
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const units = [];
  for (let index = 0; index < unitCount; index++) {
    const parent = index < 3 ? null : units[Math.floor(random() * index)].unitId;
    units.push({ unitId: `u${index}`, parentUnitId: parent, title: `Unit ${String(index).padStart(4, '0')}`, position: index % 5, level: index % 4 === 0 ? 'item' : 'series' });
  }
  const rows = Array.from({ length: rowCount }, (_, index) => ({ item: { itemId: `i${index}` }, unit: units[Math.floor(random() * unitCount)] }));
  return { units, rows };
}

// The old definition of a unit's count: rows filed in the unit or anywhere beneath it.
function expectedCount(units, rows, unitId) {
  const inside = new Set([unitId]);
  for (let changed = true; changed;) {
    changed = false;
    for (const unit of units) if (unit.parentUnitId && inside.has(unit.parentUnitId) && !inside.has(unit.unitId)) { inside.add(unit.unitId); changed = true; }
  }
  return rows.filter(row => inside.has(row.unit.unitId)).length;
}

test('a 300-unit, 3,000-source archive renders its provenance tree with the right counts in well under a second', async () => {
  const { UnitTree } = await bundle;
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { units, rows } = archive(300, 3000);
  const started = performance.now();
  const html = renderToStaticMarkup(React.createElement(UnitTree, { units, rows, parentId: null, selectedId: null, onSelect: () => {} }));
  const elapsed = performance.now() - started;
  const shown = new JSDOM(html).window.document;
  const buttons = [...shown.querySelectorAll('button')];
  assert.equal(buttons.length, units.length, 'every unit is in the tree');
  for (const unit of [units[0], units[1], units[2], units[10], units[150], units[299]]) {
    const button = buttons.find(item => item.textContent.startsWith(unit.title));
    assert.ok(button, unit.title);
    assert.ok(button.textContent.endsWith(String(expectedCount(units, rows, unit.unitId))), `${unit.title}: ${button.textContent}`);
  }
  console.log(`rendering took ${Math.round(elapsed)} ms`);
  assert.ok(elapsed < 1000, `rendering took ${Math.round(elapsed)} ms`);
});
