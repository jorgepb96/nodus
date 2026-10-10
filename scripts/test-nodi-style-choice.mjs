import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (file) => readFile(path.join(repoRoot, file), 'utf8');

// shared/nodiOrb.ts is dependency-free, so a plain esbuild bundle is enough.
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-nodiorb-'));
const bundle = path.join(outDir, 'nodiOrb.cjs');
execFileSync(
  path.join(repoRoot, 'node_modules/.bin/esbuild'),
  [path.join(repoRoot, 'shared/nodiOrb.ts'), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
  { cwd: repoRoot, stdio: 'inherit' }
);
const orb = require(bundle);

test.after(() => rm(outDir, { recursive: true, force: true }));

// ── the orb's colour rules ──────────────────────────────────────────────────────

test('every cool colour derives from one hue, and Nodi blue is the 210° the CSS offsets assume', () => {
  // nodiOrb.css writes every themed colour as hsl(calc(var(--nodi-hue) + Xdeg) …),
  // where the offsets were authored against Nodi's own blue. If this hue moves, the
  // whole palette rotates with it.
  assert.equal(orb.hueOfHex(orb.NODI_ORB_DEFAULT_COLOR), 210);
});

test('hueOfHex reads the vault accents and survives malformed input', () => {
  assert.equal(orb.hueOfHex('#b30333'), 344); // databases crimson
  assert.equal(orb.hueOfHex('#0f766e'), 175); // study teal
  assert.equal(orb.hueOfHex('#ca8a04'), 41); // genealogy gold
  assert.equal(orb.hueOfHex('#7c3aed'), 262); // worldbuilding violet
  // Anything unparseable must still yield a drawable orb rather than NaN, which
  // would silently blank every hsl() in the stylesheet.
  for (const bad of ['', 'nonsense', '#12', '#gggggg']) {
    assert.equal(orb.hueOfHex(bad), 210, `expected the default hue for ${JSON.stringify(bad)}`);
  }
  assert.equal(orb.hueOfHex('#4d9be8'), orb.hueOfHex('4d9be8'), 'the leading # is optional');
});

test('auto mode follows the active vault; manual mode ignores it', () => {
  const auto = { mascotOrbColorMode: 'auto', mascotOrbColor: '#b30333' };
  assert.equal(orb.orbColor(auto, 'genealogy'), '#ca8a04');
  assert.equal(orb.orbColor(auto, 'databases'), '#b30333');
  // No vault open (or an unknown one) still has to produce Nodi's own blue.
  assert.equal(orb.orbColor(auto, null), orb.NODI_ORB_DEFAULT_COLOR);

  const manual = { mascotOrbColorMode: 'manual', mascotOrbColor: '#7c3aed' };
  assert.equal(orb.orbColor(manual, 'genealogy'), '#7c3aed');
  assert.equal(orb.orbColor(manual, null), '#7c3aed');
  // A blank stored colour must not leave the orb colourless.
  assert.equal(orb.orbColor({ mascotOrbColorMode: 'manual', mascotOrbColor: '' }, null), orb.NODI_ORB_DEFAULT_COLOR);
});

test('the manual palette offers Nodi blue plus one swatch per distinct vault accent', () => {
  const hexes = orb.ORB_COLOR_CHOICES.map((choice) => choice.hex);
  assert.equal(hexes[0], orb.NODI_ORB_DEFAULT_COLOR);
  assert.equal(orb.ORB_COLOR_CHOICES[0].type, null);
  assert.deepEqual(hexes, [...new Set(hexes)], 'academic and primary_sources share an indigo: list it once');
  assert.ok(hexes.includes('#b30333') && hexes.includes('#ca8a04'), 'every vault accent must be reachable by hand');
});

// ── the choice is offered exactly once ──────────────────────────────────────────

test('the choice is stored app-wide, so it survives creating and switching vaults', async () => {
  const [types, defaults, prefs] = await Promise.all([
    read('shared/types.ts'),
    read('shared/defaultAppSettings.ts'),
    read('electron/db/appPrefs.ts'),
  ]);
  for (const key of ['mascotStyle', 'mascotStyleChosen', 'mascotOrbColorMode', 'mascotOrbColor']) {
    assert.match(types, new RegExp(`${key}:`), `${key} missing from AppSettings`);
    assert.match(defaults, new RegExp(`${key}:`), `${key} missing from shared factory defaults`);
    // A per-vault flag would re-ask the question in every new vault.
    assert.match(prefs, new RegExp(`'${key}'`), `${key} missing from GLOBAL_PREF_KEYS`);
  }
  // Existing installs must not wake up wearing a different mascot.
  assert.match(defaults, /mascotStyle: 'classic'/);
  assert.match(defaults, /mascotStyleChosen: false/);
});

test('the one-time modal is gated on the flag and behind the startup guides', async () => {
  const app = await read('src/App.tsx');
  assert.match(app, /startupGuidesSettled &&[\s\S]{0,400}?!settings\.mascotStyleChosen &&[\s\S]{0,80}?<NodiStyleModal/);
  // Update progress is non-blocking and no longer owns the foreground.
  assert.doesNotMatch(app, /StartupUpdateModal|updateSettled/);
  // Users still in the tutorial pick there instead.
  assert.match(app, /settings\.basicsTutorialVersion > 0 &&[\s\S]{0,200}?<NodiStyleModal/);
});

test('every way out of the modal records the choice, so it can never return', async () => {
  const modal = await read('src/components/NodiStyleModal.tsx');
  assert.match(modal, /mascotStyleChosen: true/);
  // Picking a card is the ONLY exit: a backdrop click, a close button or an Escape
  // handler could dismiss it with the flag unwritten, and it would come back.
  assert.doesNotMatch(modal, /onMouseDown|onClick=\{close\}|aria-label=\{t\('Cerrar'\)\}|'Escape'/);
});

test('both surfaces that offer the choice write the flag', async () => {
  const [startup, tutorial] = await Promise.all([read('src/app/StartupGate.tsx'), read('src/views/BasicsTutorial.tsx')]);
  // The tutorial's own screen, for new users.
  assert.match(startup, /onNodiStyleChosen=\{async \(mascotStyle\) => \{[\s\S]{0,160}?mascotStyleChosen: true/);
  assert.match(tutorial, /onPick=\{\(style\) => \{ setStyleChosen\(true\); setIndex\(0\); void onNodiStyleChosen\(style\); \}\}/);
});

// ── the two Nodi are interchangeable ────────────────────────────────────────────

test('every surface draws NodiAvatar, so the choice holds across the whole app', async () => {
  const surfaces = [
    'src/components/nodi/NodiCompanion.tsx',
    'src/components/WhatsNewModal.tsx',
    'src/views/RecoverySetupWizard.tsx',
    'src/views/BasicsTutorial.tsx',
  ];
  for (const file of surfaces) {
    const source = await read(file);
    assert.match(source, /<NodiAvatar/, `${file} should draw NodiAvatar`);
    // The picker is the one legitimate exception: it shows both on purpose.
    assert.doesNotMatch(source, /<Nodi\s|<Nodi>/, `${file} should not draw a fixed Nodi`);
  }
});

test('several orbs can coexist in different colours', async () => {
  const source = await read('src/components/nodi/NodiOrb.tsx');
  // Without namespaced ids, url(#gradient) resolves to whichever orb rendered first
  // and every orb on screen silently shares its hue.
  assert.match(source, /useId\(\)/);
  assert.match(source, /const u = \(id: string\) => `\$\{uid\}-\$\{id\}`/);
  assert.doesNotMatch(source, /id="(deepSpace|coreBloomG|sphereClip|star4)"/, 'gradient ids must be namespaced');
});
