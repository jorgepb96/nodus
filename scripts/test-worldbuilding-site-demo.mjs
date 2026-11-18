import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')
const demoDir = path.join(root, 'site', 'demo')
const assetDir = path.join(demoDir, 'assets', 'worldbuilding')
const screenshotDir = path.join(root, 'docs', 'screenshots', 'worldbuilding')

const viewIds = [
  'home',
  'encyclopedia',
  'characters',
  'places',
  'factions',
  'cultures',
  'timeline',
  'map',
  'relations',
  'tree',
  'dynasties',
  'worldChat',
  'rules',
  'conflicts',
  'arcs',
  'continuity',
  'questions',
  'notes',
  'scenes',
  'manuscript',
  'settings',
]

async function loadWorld() {
  const source = await readFile(path.join(demoDir, 'worldbuilding-data.js'), 'utf8')
  const context = vm.createContext({ window: {} })
  vm.runInContext(source, context)
  return context.window.WORLD
}

async function renderRoute(route) {
  const world = await loadWorld()
  const elements = Object.fromEntries(['nav', 'main', 'modal-root', 'toast'].map((id) => [
    id,
    {
      innerHTML: '',
      scrollTop: 0,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {},
      querySelector() { return null },
      querySelectorAll() { return [] },
    },
  ]))
  const context = {
    WORLD: world,
    document: {
      getElementById(id) { return elements[id] ?? null },
      querySelectorAll() { return [] },
    },
    location: { hash: `#${route}` },
    setTimeout() { return 1 },
    clearTimeout() {},
  }
  context.window = context
  context.window.WORLD = world
  context.window.addEventListener = () => {}

  vm.createContext(context)
  vm.runInContext(await readFile(path.join(demoDir, 'worldbuilding-app.js'), 'utf8'), context)
  return { context, html: elements.main.innerHTML }
}

test('the worldbuilding site contains the complete seeded demo dataset', async () => {
  const world = await loadWorld()

  assert.equal(world.assets.length, 55)
  assert.equal(world.characters.length, 10)
  assert.equal(world.places.length, 12)
  assert.equal(world.groups.length, 11)
  assert.equal(world.scenes.length, 9)
  assert.equal(world.entries.length, 71)
  assert.equal(world.threads.length, 7)
  assert.equal(world.rules.length, 7)
  assert.equal(world.maps.length, 4)
  assert.equal(world.worldEvents.length, 8)

  for (const asset of world.assets) {
    assert.match(asset, /^.+\.webp$/)
  }
})

test('the site ships all artwork as WebP and no PNG copies', async () => {
  const files = await readdir(assetDir)
  assert.equal(files.length, 55)
  assert.ok(files.every((file) => file.endsWith('.webp')))
})

test('every desktop section has a captured reference and a web route', async () => {
  const screenshots = await readdir(screenshotDir)
  const appSource = await readFile(path.join(demoDir, 'worldbuilding-app.js'), 'utf8')

  assert.equal(screenshots.filter((file) => file.endsWith('.png')).length, viewIds.length)
  for (const viewId of viewIds) {
    assert.match(appSource, new RegExp(`id:\\s*['"]${viewId}['"]`))
  }
  assert.doesNotMatch(appSource, /id:\s*['"]toolkit['"]/)
})

test('every live demo returns through the shared header and the homepage links Worldbuilding', async () => {
  const pages = [
    'index.html',
    'teaching.html',
    'study.html',
    'genealogy.html',
    'databases.html',
    'worldbuilding.html',
  ]

  for (const page of pages) {
    const html = await readFile(path.join(demoDir, page), 'utf8')
    assert.match(html, /data-nodus-site-header data-base="\.\.\/" data-context="demo"/)
    assert.match(html, /src="\.\.\/site-header\.js/)
  }

  const sharedHeader = await readFile(path.join(root, 'site', 'site-header.js'), 'utf8')
  // the vault catalogue lives at /nodus/ since the family front page, and the header's Nodus link returns to it
  assert.match(sharedHeader, /\{ id: 'nodus', label: 'Nodus', href: \(base\) => `\$\{base\}nodus\/` \}/)
  // The Nodus landing moved to site/nodus/ when site/index.html became the family front page.
  const homepage = await readFile(path.join(root, 'site', 'nodus', 'index.html'), 'utf8')
  assert.match(homepage, /<h3>Worldbuilding<\/h3>/)
  assert.match(homepage, /href="\.\.\/demo\/worldbuilding\.html"/)
})

test('Families and Settings render their upgraded interactive interfaces', async () => {
  const family = await renderRoute('tree')
  assert.match(family.html, /class="wb-family-toolbar"/)
  assert.match(family.html, /Search the tree/)
  assert.equal((family.html.match(/class="wb-family-node"/g) || []).length, 5)
  assert.match(family.html, /Spouses\/partners/)
  assert.match(family.html, /Adoptive kinship/)

  family.context.WB.familyFocus('demo-world-char-maelor')
  assert.match(family.context.document.getElementById('main').innerHTML, /Regent Maelor Sarn/)
  assert.match(family.context.document.getElementById('main').innerHTML, /Tarek Sarn/)

  const settings = await renderRoute('settings')
  assert.match(settings.html, /AI providers/)
  assert.match(settings.html, /Worldbuilding/)
  settings.context.WB.settingsTab('data')
  assert.match(settings.context.document.getElementById('main').innerHTML, /Automatic encrypted backups/)
  assert.doesNotMatch(settings.context.document.getElementById('nav').innerHTML, /Toolkit/i)
})
