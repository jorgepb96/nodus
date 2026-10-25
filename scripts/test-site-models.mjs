import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The model guide is meant to be kept current by editing one data file. These
// checks are what make that safe: a typo in an id, a dangling reference or a
// forgotten date fails here instead of drawing an empty table on the site.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

const page = read('site/models/index.html');
const renderer = read('site/models/models.js');
const sandbox = {};
new Function('window', read('site/models/models-data.js'))(sandbox);
const guide = sandbox.NODUS_MODEL_GUIDE;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const optionsOf = (facet) => (facet.groups ? facet.groups.flatMap((group) => group.options) : facet.options);
const resolve = (table, row) => ({ ...(table.row || {}), ...(row.ref ? guide.apiModels[row.ref] : {}), ...row });
const textFields = (value) => (typeof value === 'string' ? [value] : []);

test('the guide loads with its tabs, methodology, sources and history', () => {
  assert.ok(guide, 'models-data.js publishes window.NODUS_MODEL_GUIDE');
  assert.deepEqual(
    guide.tabs.map((tab) => tab.id),
    ['local', 'embeddings', 'chat', 'extraction', 'deep', 'guide'],
    'the tabs keep their order and their linkable ids',
  );
  assert.ok(guide.method.length >= 5, 'the methodology explains the numbers');
  assert.ok(guide.sources.every((group) => group.links.length), 'every source group lists its sources');
  assert.ok(guide.changelog.length >= 1, 'the update history has at least one entry');
});

test('every tab is complete and dated', () => {
  const icons = new Set([...renderer.matchAll(/^\s{4}(\w+): '</gm)].map((match) => match[1]));
  for (const tab of guide.tabs) {
    assert.ok(tab.label && tab.title && tab.intro, `${tab.id} has a label, a title and an introduction`);
    assert.match(tab.updated, ISO, `${tab.id} carries an ISO review date`);
    assert.match(tab.accent, /^#[0-9a-f]{6}$/i, `${tab.id} has a six-digit accent`);
    assert.ok(icons.has(tab.icon), `${tab.id} uses an icon the renderer draws`);
    assert.ok(tab.tables.length, `${tab.id} has at least one table`);
  }
});

test('the newest review is recorded in the update history', () => {
  const latest = guide.tabs.map((tab) => tab.updated).sort().at(-1);
  const dates = guide.changelog.map((entry) => entry.date);
  for (const date of dates) assert.match(date, ISO);
  assert.deepEqual(dates, [...dates].sort().reverse(), 'the history runs newest first');
  assert.equal(dates[0], latest, 'whoever moves a review date also says what changed');
});

test('ids are unique, so tables, tabs and links stay addressable', () => {
  const tables = guide.tabs.flatMap((tab) => tab.tables.map((table) => table.id));
  assert.equal(new Set(tables).size, tables.length, 'table ids are unique across the guide');
  for (const tab of guide.tabs) {
    for (const table of tab.tables) {
      const columns = table.columns.map((column) => column.id || column.key);
      assert.equal(new Set(columns).size, columns.length, `${table.id} column ids are unique`);
    }
  }
});

test('API rows point at a model that exists, and every model is fully described', () => {
  for (const [id, model] of Object.entries(guide.apiModels)) {
    for (const key of ['input', 'output', 'intelligence', 'speed', 'taskCost']) {
      assert.equal(typeof model[key], 'number', `${id}.${key} is a number`);
    }
    assert.ok(model.name && model.provider, `${id} names its model and provider`);
    assert.match(model.source, /^https:\/\//, `${id} links to its benchmark page`);
  }
  for (const tab of guide.tabs) {
    for (const table of tab.tables) {
      for (const row of table.rows) {
        if (row.ref) assert.ok(guide.apiModels[row.ref], `${table.id} refers to the declared model ${row.ref}`);
      }
    }
  }
});

test('every column uses a cell type the renderer knows, and every row has a name', () => {
  const types = new Set([...renderer.matchAll(/case '(\w+)':/g)].map((match) => match[1]));
  types.add('text');
  for (const tab of guide.tabs) {
    for (const table of tab.tables) {
      assert.equal(table.columns[0].type, 'name', `${table.id} opens with its name column`);
      for (const column of table.columns) {
        assert.ok(types.has(column.type), `${table.id}.${column.key} uses the known type ${column.type}`);
      }
      for (const row of table.rows) {
        const resolved = resolve(table, row);
        assert.ok(resolved.name, `${table.id} rows each have a name`);
        for (const column of table.columns.filter((entry) => entry.type === 'verdict')) {
          assert.ok(['yes', 'aux', 'no'].includes(resolved[column.key]), `${resolved.name}: ${column.key} is yes, aux or no`);
        }
      }
    }
  }
});

test('every bubble can match something, and the hardware filter only names real machines', () => {
  const machineIds = new Set();
  const shared = new Map();
  // A shared filter may have nothing to offer on one tab (no Google model
  // extracts ideas); the page hides that bubble there. It must still match
  // somewhere, or it is a dead option nobody can ever use.
  const reachable = new Map();
  for (const tab of guide.tabs) {
    const rows = tab.tables.flatMap((table) => table.rows.map((row) => resolve(table, row)));
    for (const facet of tab.filters) {
      const options = optionsOf(facet);
      const ids = options.map((option) => option.id);
      assert.equal(new Set(ids).size, ids.length, `${tab.id}/${facet.id} option ids are unique`);

      // a filter id on two tabs shares one selection, so it must mean the same thing
      const signature = JSON.stringify(ids);
      if (shared.has(facet.id)) assert.equal(shared.get(facet.id), signature, `${facet.id} offers the same options on every tab`);
      shared.set(facet.id, signature);

      if (facet.type === 'machine') {
        for (const option of options) machineIds.add(option.id);
        assert.ok(rows.some((row) => row.fit || row.machines), `${tab.id} has rows the hardware filter can act on`);
        continue;
      }
      const values = rows.flatMap((row) => [].concat(row[facet.field] ?? []));
      assert.ok(values.length, `${tab.id}/${facet.id} acts on at least one row`);
      for (const option of options) {
        const ranged = ['atLeast', 'over', 'upTo', 'below'].some((key) => option[key] != null);
        const hit = ranged
          ? values.some((value) => typeof value === 'number'
            && (option.atLeast == null || value >= option.atLeast) && (option.over == null || value > option.over)
            && (option.upTo == null || value <= option.upTo) && (option.below == null || value < option.below))
          : values.includes(option.id);
        const key = `${facet.id}/${option.id}`;
        reachable.set(key, Boolean(reachable.get(key) || hit));
      }
    }
  }
  for (const [key, hit] of reachable) assert.ok(hit, `${key} matches at least one row somewhere in the guide`);
  for (const tab of guide.tabs) {
    for (const table of tab.tables) {
      for (const row of table.rows) {
        for (const id of row.machines || []) assert.ok(machineIds.has(id), `${table.id}: ${id} is a declared machine`);
        if (row.fit) {
          assert.ok(row.fit.mac || row.fit.gpu || row.fit.cpu, `${row.name} says what it runs on`);
          for (const key of Object.keys(row.fit)) assert.ok(['mac', 'gpu', 'cpu'].includes(key), `${row.name}: fit.${key} is known`);
        }
      }
    }
  }
});

test('links in the copy are https, or point at a tab that exists', () => {
  const tabIds = new Set(guide.tabs.map((tab) => tab.id));
  const strings = [];
  const collect = (value) => {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(guide);
  let links = 0;
  for (const text of strings.flatMap(textFields)) {
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
      links += 1;
      const href = match[1];
      if (href.startsWith('#')) assert.ok(tabIds.has(href.slice(1)), `${href} names a tab`);
      else assert.match(href, /^https:\/\//, `${href} is an https link`);
    }
  }
  assert.ok(links > 0, 'the copy links its sources');
  for (const row of guide.tabs.flatMap((tab) => tab.tables.flatMap((table) => table.rows))) {
    if (row.href) assert.ok(tabIds.has(row.href.slice(1)), `${row.name} links to an existing tab`);
  }
});

test('Idea Extraction stays an API job with no winner named in advance', () => {
  const extraction = guide.tabs.find((tab) => tab.id === 'extraction');
  const rows = extraction.tables.flatMap((table) => table.rows.map((row) => resolve(table, row)));
  assert.ok(rows.every((row) => row.runs === 'api'), 'no local model is offered for bulk extraction');
  assert.ok(rows.every((row) => !row.pick), 'no candidate is badged as the pick');
  assert.ok(extraction.tables.some((table) => table.estimator), 'the cost estimate is the reader’s to adjust');
});

test('the page mounts the shared chrome and loads the data before the renderer', () => {
  assert.match(page, /data-nodus-site-header data-base="\.\.\/" data-page="models"/);
  assert.match(read('site/site-header.js'), /\{ id: 'models', label: 'Models', href: \(base\) => `\$\{base\}models\/` \}/);
  assert.match(page, /<link rel="canonical" href="https:\/\/nodusresearch\.com\/models\/"\/>/);
  assert.ok(page.indexOf('models-data.js?v=') < page.indexOf('models.js?v='), 'the data is in place before it is drawn');
  assert.match(page, /role="tablist"/, 'the sections are real tabs');
  assert.match(page, /<noscript>/, 'without JavaScript the reader is pointed at the data');
  assert.match(read('site/sitemap.xml'), /<loc>https:\/\/nodusresearch\.com\/models\/<\/loc>/);
  assert.match(read('site/site-footer.js'), /href="\$\{base\}models\/">Model guide/);
});
