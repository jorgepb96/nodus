// Rebuild the browser demo from the exact data returned by a freshly seeded
// Worldbuilding vault, copy its distributable WebP artwork, and capture every section
// from the real Electron interface.
//
//   npm run capture:worldbuilding-site
//
// The throwaway profile keeps the operation reproducible and never touches a user's
// vaults. The full originals (`*.original.webp`) stay in electron/assets/worldbuilding-demo;
// the public site receives only their smaller card derivatives.

import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshotsDir = path.join(repoRoot, 'docs', 'screenshots', 'worldbuilding');
const sourceAssetsDir = path.join(repoRoot, 'electron', 'assets', 'worldbuilding-demo');
const siteAssetsDir = path.join(repoRoot, 'site', 'demo', 'assets', 'worldbuilding');
const siteDataPath = path.join(repoRoot, 'site', 'demo', 'worldbuilding-data.js');
const require = createRequire(import.meta.url);

if (!existsSync(path.join(repoRoot, 'dist-electron', 'main.js')) || !existsSync(path.join(repoRoot, 'dist', 'index.html'))) {
  throw new Error('Run `npm run build` before capturing the Worldbuilding demo.');
}

await rm(screenshotsDir, { recursive: true, force: true });
await rm(siteAssetsDir, { recursive: true, force: true });
await mkdir(screenshotsDir, { recursive: true });
await mkdir(siteAssetsDir, { recursive: true });

const webpAssets = (await readdir(sourceAssetsDir))
  .filter((fileName) => fileName.endsWith('.webp') && !fileName.endsWith('.original.webp'))
  .sort();
assert.equal(webpAssets.length, 55, 'the Worldbuilding demo must expose all 55 WebP assets');
await Promise.all(webpAssets.map((fileName) => (
  cp(path.join(sourceAssetsDir, fileName), path.join(siteAssetsDir, fileName))
)));

const userData = await mkdtemp(path.join(os.tmpdir(), 'nodus-worldbuilding-site-'));
const childEnv = {
  ...process.env,
  NODUS_USERDATA: userData,
  NODUS_DISABLE_AUTO_UPDATE: '1',
  NODUS_E2E_UPDATE_STATUS: 'not-available',
  NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1',
};
delete childEnv.ELECTRON_RUN_AS_NODE;

const app = await electron.launch({
  executablePath: require('electron'),
  args: [repoRoot],
  env: childEnv,
});

const sections = [
  ['home', '00-home'],
  ['encyclopedia', '01-encyclopedia'],
  ['characters', '02-characters'],
  ['places', '03-places'],
  ['factions', '04-factions'],
  ['cultures', '05-cultures'],
  ['timeline', '06-timeline'],
  ['map', '07-map'],
  ['relations', '08-relations'],
  ['tree', '09-families'],
  ['dynasties', '10-dynasties'],
  ['worldChat', '11-world-chat'],
  ['rules', '12-rules'],
  ['conflicts', '13-conflicts'],
  ['arcs', '14-arcs'],
  ['continuity', '15-continuity'],
  ['questions', '16-open-questions'],
  ['notes', '17-notes'],
  ['scenes', '18-scenes'],
  ['manuscript', '19-manuscript'],
  ['settings', '20-settings'],
];

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Nodus')
      ?? BrowserWindow.getAllWindows()[0];
    main.setContentSize(1440, 900);
    main.center();
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));

  const appVersion = require(path.join(repoRoot, 'package.json')).version;
  const publicSettings = {
    onboardingComplete: true,
    basicsTutorialVersion: 999,
    recoverySetupVersion: 999,
    tourComplete: true,
    advancedTourComplete: true,
    worldbuildingTourComplete: true,
    theme: 'dark',
    uiLanguage: 'en',
    promptLanguage: 'en',
    mascotStyle: 'orb',
    mascotStyleChosen: true,
    mascotEnabled: true,
    mascotAlwaysOnTop: false,
    reduceMotion: true,
  };

  await page.evaluate((version) => localStorage.setItem('nodus.lastSeenVersion', version), appVersion);
  await page.evaluate(async ({ settings }) => {
    const created = await window.nodus.createVault({ name: 'The Ashen Tides', type: 'worldbuilding' });
    const switched = await window.nodus.switchVault(created.vault.id);
    if (!switched.ok) throw new Error(switched.message);
    await window.nodus.updateSettings(settings);
    const seeded = await window.nodus.seedWorldbuildingDemoData();
    if (!seeded) throw new Error('Worldbuilding demo could not be seeded.');
  }, { settings: publicSettings });
  await page.reload();
  await page.waitForFunction(() => (
    Boolean(document.querySelector('[data-testid="worldbuilding-sidebar"]'))
    && document.documentElement.classList.contains('worldbuilding')
    && document.body.innerText.includes('Demo mode:')
  ));

  const backupWarningDismiss = page.locator('.backup-health-dismiss');
  if (await backupWarningDismiss.count() === 1 && await backupWarningDismiss.isVisible()) {
    await backupWarningDismiss.click();
    await backupWarningDismiss.waitFor({ state: 'hidden' });
  }

  const data = await page.evaluate(async (assetFiles) => {
    const api = window.nodus;
    const [
      characters,
      places,
      groups,
      scenes,
      entries,
      threads,
      beats,
      rules,
      questions,
      questionFeed,
      maps,
      calendar,
      worldEvents,
      relationships,
      socialGraph,
      notes,
      secrets,
      continuity,
      continuityAll,
      continuitySummary,
      manuscriptSpine,
      manuscriptProgress,
      threadBoard,
      threadSceneContext,
      sceneDayLinks,
      mapCoverage,
      worldPresences,
      travelModes,
    ] = await Promise.all([
      api.listCharacters(),
      api.listWorldPlaces(),
      api.listWorldGroups(),
      api.listScenes('narrative'),
      api.listWorldEntries(),
      api.listWorldThreads(),
      api.listWorldBeats(),
      api.listWorldRules(),
      api.listWorldQuestions(),
      api.questionFeed(true),
      api.listWorldMaps(),
      api.getWorldCalendar(),
      api.listWorldEvents(),
      api.allRelationships(),
      api.socialGraph(),
      api.getNotesTree(),
      api.listSecrets(),
      api.runWorldContinuity(),
      api.runWorldContinuityUnfiltered(),
      api.continuitySummary(),
      api.manuscriptSpine(),
      api.manuscriptProgress(),
      api.threadBoardData(),
      api.threadSceneContext(),
      api.listSceneDayLinks(),
      api.mapCoverage(),
      api.listWorldPresences(),
      api.listTravelModes(),
    ]);

    const withKey = async (items, idOf, load) => Object.fromEntries(await Promise.all(
      items.map(async (item) => [idOf(item), await load(item)]),
    ));
    const characterDetails = await withKey(characters, (item) => item.personId, async (item) => ({
      abilities: await api.listCharacterAbilities(item.personId),
      affiliations: await api.listAffiliationsForCharacter(item.personId),
      events: await api.listCharacterEvents(item.personId),
      images: await api.listWorldImages('character', item.personId),
      places: await api.listPersonPlaces(item.personId),
      scenes: await api.appearancesOfCharacter(item.personId),
      secrets: await api.secretsForCharacter(item.personId),
    }));
    const placeDetails = await withKey(places, (item) => item.placeId, async (item) => ({
      images: await api.listWorldImages('place', item.placeId),
      inhabitants: await api.placeInhabitants(item.placeId),
      mapAppearances: await api.placeMapAppearances(item.placeId),
    }));
    const groupDetails = await withKey(groups, (item) => item.groupId, async (item) => ({
      images: await api.listWorldImages('group', item.groupId),
      affiliations: await api.listAffiliationsForGroup(item.groupId),
    }));
    const sceneDetails = await withKey(scenes, (item) => item.sceneId, async (item) => ({
      cast: await api.listSceneCharacters(item.sceneId),
      images: await api.listWorldImages('scene', item.sceneId),
      questions: await api.questionsForScene(item.sceneId),
      rules: await api.rulesInPlay(item.sceneId),
      text: await api.getSceneText(item.sceneId),
    }));
    const entryDetails = await withKey(entries, (item) => `${item.kind}:${item.id}`, async (item) => ({
      detail: await api.getWorldEntry({ kind: item.kind, id: item.id }),
      backlinks: await api.worldBacklinks({ kind: item.kind, id: item.id }),
      images: item.kind === 'article' ? await api.listWorldImages('article', item.id) : [],
    }));
    const threadDetails = await withKey(threads, (item) => item.threadId, async (item) => (
      api.getWorldThread(item.threadId)
    ));
    const questionDetails = await withKey(questions, (item) => item.questionId, async (item) => (
      api.getWorldQuestion(item.questionId)
    ));
    const mapDetails = await withKey(maps, (item) => item.mapId, async (item) => ({
      markers: await api.listMapMarkers(item.mapId),
      layers: await api.listMapLayers(item.mapId),
      children: await api.childMaps(item.mapId),
      ancestry: await api.mapAncestry(item.mapId),
    }));
    const secretKnowers = await withKey(secrets, (item) => item.secretId, async (item) => (
      api.listKnowers(item.secretId)
    ));

    return {
      vault: { name: 'The Ashen Tides', mode: 'Worldbuilding', demo: true },
      assets: assetFiles,
      characters,
      characterDetails,
      places,
      placeDetails,
      groups,
      groupDetails,
      scenes,
      sceneDetails,
      entries,
      entryDetails,
      threads,
      threadDetails,
      beats,
      rules,
      questions,
      questionDetails,
      questionFeed,
      maps,
      mapDetails,
      calendar,
      worldEvents,
      relationships,
      socialGraph,
      notes,
      secrets,
      secretKnowers,
      continuity,
      continuityAll,
      continuitySummary,
      manuscriptSpine,
      manuscriptProgress,
      threadBoard,
      threadSceneContext,
      sceneDayLinks,
      mapCoverage,
      worldPresences,
      travelModes,
    };
  }, webpAssets);

  await writeFile(
    siteDataPath,
    `/* Generated by scripts/capture-worldbuilding-site-demo.mjs from the real seeded vault. */\nwindow.WORLD = ${JSON.stringify(data, null, 2)};\n`,
    'utf8',
  );

  for (const [view, filename] of sections) {
    const button = page.locator(`[data-tour="nav-${view}"]`);
    assert.equal(await button.count(), 1, `navigation target ${view} must be unique`);
    await button.click();
    await page.waitForFunction((target) => (
      document.querySelector(`[data-tour="nav-${target}"]`)?.classList.contains('bg-indigo-600')
    ), view);
    await page.locator('main').evaluate((element) => {
      element.scrollTop = 0;
    }).catch(() => {});
    await page.waitForTimeout(['map', 'tree', 'relations'].includes(view) ? 1_500 : 450);
    await page.screenshot({
      path: path.join(screenshotsDir, `${filename}.png`),
      animations: 'disabled',
    });
    console.log(`[worldbuilding] ${filename}.png`);
  }

  console.log(`Worldbuilding site data written to ${siteDataPath}`);
  console.log(`Copied ${webpAssets.length} WebP assets to ${siteAssetsDir}`);
  console.log(`Captured ${sections.length} sections in ${screenshotsDir}`);
} finally {
  await app.close();
  await rm(userData, { recursive: true, force: true });
}
