// Argument map — progressive unfold and block rendering.
//
// Two bugs were reported against this view: branches could not be unfolded one
// by one, and collapsing one left the card stretched to the height the whole
// branch used to occupy. The first is logic (asserted by running the unfold),
// the second is a rendering choice (asserted on the source, the app's
// convention for UI wiring).
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(repoRoot, 'node_modules', '.nodus-argmap-'));
test.after(async () => { await rm(outDir, { recursive: true, force: true }); });

function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file).replace(/\.tsx?$/, '')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [
      path.join(repoRoot, file),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=es2022',
      `--alias:@shared=${path.join(repoRoot, 'shared')}`,
      `--outfile=${bundle}`,
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return require(bundle);
}

const { expandableIdsByDepth } = loadModule('src/argumentMapTree.ts');
const view = fs.readFileSync(path.join(repoRoot, 'src/views/ArgumentMapView.tsx'), 'utf8');

/** A block tree shaped like the structural (automatic) maps: fan-out plus depth. */
function makeTree() {
  const leaf = (id) => ({ id, children: [] });
  return {
    id: 'root',
    children: [
      { id: 'a', children: [{ id: 'a1', children: [leaf('a1x'), leaf('a1y')] }, leaf('a2')] },
      { id: 'b', children: [leaf('b1')] },
      leaf('c'),
    ],
  };
}

/** Walk every block, so the assertions can talk about the whole tree. */
function walk(block, depth = 0, acc = []) {
  acc.push({ block, depth });
  for (const child of block.children) walk(child, depth + 1, acc);
  return acc;
}

test('the unfold opens one level per tick, root first', () => {
  const levels = expandableIdsByDepth(makeTree());
  assert.deepEqual(levels, [['root'], ['a', 'b'], ['a1']]);
});

test('every expandable block is reached, so the whole map does unfold', () => {
  const tree = makeTree();
  const levels = expandableIdsByDepth(tree);
  const unfolded = new Set(levels.flat());
  const expandable = walk(tree)
    .filter(({ block }) => block.children.length > 0)
    .map(({ block }) => block.id);
  assert.deepEqual([...unfolded].sort(), [...expandable].sort());
});

test('a block is never opened before its parent (no orphan levels)', () => {
  const tree = makeTree();
  const levels = expandableIdsByDepth(tree);
  const depthOf = new Map(walk(tree).map(({ block, depth }) => [block.id, depth]));
  levels.forEach((ids, level) => {
    assert.ok(ids.length > 0, `level ${level} is populated — the unfold must not stall on a hole`);
    for (const id of ids) assert.equal(depthOf.get(id), level);
  });
});

test('a leaf-only map yields a single level and stops the timer immediately', () => {
  assert.deepEqual(expandableIdsByDepth({ id: 'root', children: [{ id: 'x', children: [] }] }), [['root']]);
  assert.deepEqual(expandableIdsByDepth({ id: 'root', children: [] }), []);
});

test('collapsing a branch cannot distort the block: only the children wrapper animates', () => {
  assert.ok(
    !/<motion\.div\s+layout\b/.test(view) && !/\slayout(\s|=)/.test(view.replace(/layout="[^"]*"/g, '')),
    'no framer-motion `layout` prop: its scale correction stretched the collapsed card and its text',
  );
  assert.match(
    view,
    /<motion\.div[\s\S]{0,200}key="children"[\s\S]{0,400}animate=\{\{ height: 'auto'/,
    'the children wrapper animates its own height instead',
  );
  assert.doesNotMatch(view, /revealDepth/, 'the depth gate is gone — `expanded` is the only source of truth');
});

test('a manual toggle takes over from the automatic unfold', () => {
  assert.match(
    view,
    /const toggleExpand = useCallback\(\(id: string\) => \{\s*\n\s*stopReveal\(\);/,
    'toggling stops the timer, so the unfold cannot reopen a branch the user just collapsed',
  );
});

test('the catalogue and open maps are persistent workspace tabs', () => {
  assert.match(view, /data-testid="argument-map-tabs"/, 'the argument workspace exposes a tab strip');
  assert.match(view, /data-testid="argument-tab-catalog"/, 'the catalogue is always reachable as the first tab');
  assert.match(view, /data-testid="argument-tab-map"/, 'the selected idea owns a named map tab');
  assert.match(
    view,
    /className=\{surface === 'catalog' \? 'flex h-full min-h-0 flex-col' : 'hidden'\}/,
    'the catalogue stays mounted while its idea map is open',
  );
  const source = ts.createSourceFile('ArgumentMapView.tsx', view, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const maps = [];
  function visit(node) {
    if (ts.isJsxExpression(node) && node.expression && ts.isCallExpression(node.expression)
      && node.expression.expression.getText(source) === 'openArgumentMaps.map'
      && /<ArgumentMapTab\b/.test(node.expression.getText(source))) maps.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(maps.length, 1, 'the workspace renders the complete open-map collection');
  assert.equal(maps[0].parent.openingElement?.tagName.getText(source), 'main',
    'the tab collection is an unconditional workspace child, so inactive tabs remain mounted');
  const javascript = ts.transpileModule(`return (${maps[0].expression.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const renderTabs = new Function('React', 'ArgumentMapTab', 'openArgumentMaps', 'surface', 'activeMapKey', 'readOnly', 'mobile', javascript);
  const tabs = [{ key: 'auto:a', mode: 'auto' }, { key: 'saved:b', mode: 'ai' }];
  const React = { createElement: (type, props) => ({ type, props }) };
  const ArgumentMapTab = () => {};
  for (const readOnly of [false, true]) {
    for (const surface of ['catalog', 'map']) {
      for (const activeKey of tabs.map(tab => tab.key)) {
        const elements = renderTabs(React, ArgumentMapTab, tabs, surface, activeKey, readOnly, false);
        assert.equal(elements.length, tabs.length, 'returning to the catalogue keeps every map mounted');
        elements.forEach((element, index) => {
          assert.equal(element.type, ArgumentMapTab);
          assert.equal(element.props.key, tabs[index].key, 'stable keys preserve each map’s local state');
          assert.equal(element.props.tab, tabs[index]);
          assert.equal(element.props.active, surface === 'map' && activeKey === tabs[index].key);
          assert.equal(element.props.readOnly, readOnly, 'each saved map receives the reader permission');
        });
      }
    }
  }
});
