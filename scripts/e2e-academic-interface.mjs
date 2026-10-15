import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(path.join(os.tmpdir(), 'nodus-interface-e2e-'));
const shots = path.join(root, 'artifacts/academic-interface');
await mkdir(shots, { recursive: true });
let requests = 0;
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', chunk => body += chunk);
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'fixture-embedding' }] }));
    if (req.url?.endsWith('/embeddings')) {
      requests++; const input = JSON.parse(body);
      return res.end(JSON.stringify({ data: [input.input].flat().map((_, index) => ({ index, embedding: input.encoding_format === 'base64' ? Buffer.from(new Float32Array([1, 0.5, 0.2]).buffer).toString('base64') : [1, 0.5, 0.2] })) }));
    }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const env = { ...process.env, NODUS_USERDATA: path.join(scratch, 'profile'), NODUS_DISABLE_AUTO_UPDATE: '1', NODUS_E2E_UPDATE_STATUS: 'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI: '1', NODUS_ZOTERO_API_BASE: `${baseUrl}/zotero` };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ executablePath: require('electron'), args: [root], env });
  const page = await app.firstWindow(); page.setDefaultTimeout(30_000);
  if (process.env.NODUS_E2E_RENDERER) await page.waitForLoadState('load');
  if (process.env.NODUS_E2E_RENDERER) await app.evaluate(({ BrowserWindow }, renderer) => BrowserWindow.getAllWindows()[0].loadFile(renderer), path.resolve(process.env.NODUS_E2E_RENDERER));
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(document.getElementById('root')?.children.length));
  return page;
}
async function setup(page, extra = {}) {
  await page.evaluate(async ({ version, backup, baseUrl, extra }) => {
    for (const key of ['nodus.mobileTeaserSeen.3.2.4','nodus.platformHighlightsSeen.2026-07','nodus.tutorialVideosAnnouncementSeen.2026-07','nodus.pdfPresenterTutorialSeen.e2js_u-05OA','nodus.toolkitBetaGuideSeen.2.4.0']) localStorage.setItem(key,'1');
    localStorage.setItem('nodus.lastSeenVersion', version);
    await window.nodus.updateSettings({ onboardingComplete: true, basicsTutorialVersion: 999, firstVaultVersion: 999, recoverySetupVersion: 999, tourComplete: true, advancedTourComplete: true, uiLanguage: 'es', mascotEnabled: false, mascotStyleChosen: true, reduceMotion: true, autoBackupFolder: backup, autoLightScan: false, autoDeepScanOnReadTag: false, autoSummaryAfterDeep: false, autoBridgeAfterQueue: false, embeddingProvider: 'lmstudio', embeddingModel: 'fixture-embedding', localProviders: { lmstudio: { baseUrl }, ollama: { baseUrl: 'http://127.0.0.1:11434' } }, ...extra });
  }, { version: require(path.join(root, 'package.json')).version, backup: path.join(scratch,'backups'), baseUrl, extra });
  await page.reload();
  const startup = page.getByTestId('startup-update-modal');
  if (await startup.count()) await startup.getByRole('button', { name: 'Entendido' }).click();
  await page.getByTestId('academic-interface-trigger').waitFor();
}
async function choose(page, profile) {
  await page.getByTestId('academic-interface-trigger').click();
  await page.getByTestId(`academic-profile-${profile}`).click();
  await page.getByTestId('academic-interface-picker').waitFor({ state: 'detached' });
}
async function openGuide(page) {
  await page.getByTestId('academic-interface-trigger').click();
  await page.getByRole('button',{name:'Cómo empezar con este perfil'}).click();
  await page.getByTestId('academic-learning-invitation').waitFor();
}
async function navIds(page) {
  return page.getByTestId('sidebar-scroll-region').locator('button[data-tour^="nav-"]').evaluateAll(buttons => buttons.map(button => button.dataset.tour.slice(4)));
}
async function openMore(page) {
  await page.getByTestId('header-actions').getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByTestId('header-more-panel').waitFor();
}
async function checkHeaderDefaults(page) {
  const rail = page.getByTestId('header-actions');
  for (const id of ['sync','focus','feedback','skills']) assert.equal(await rail.locator(`[data-header-action="${id}"]`).isVisible(),false,id);
  assert.equal(await rail.locator('[data-header-action="gettingStarted"]').count(),0);
  assert.equal(await rail.locator('[data-header-action="theme"]').isVisible(),true);
  await openMore(page);
  for (const id of ['sync','focus','feedback','skills']) assert.equal(await page.getByTestId(`header-visibility-${id}`).getAttribute('aria-pressed'),'false',id);
  assert.equal(await page.getByTestId('header-more-panel').locator('[data-header-menu-action="gettingStarted"]').count(),0);
  await page.keyboard.press('Escape');
}
async function checkCustomEditor(page) {
  await page.waitForFunction(() => document.activeElement?.id === 'settings-sidebar-editor');
  assert.equal(await page.getByTestId('academic-learning-invitation').count(),0,'Custom opens its editor without an automatic guide');
  const scroll = await page.getByTestId('settings-scroll').boundingBox();
  const section = await page.locator('#settings-sidebar-section').boundingBox();
  assert.ok(section && scroll && section.y >= scroll.y && section.y <= scroll.y + 32,'the Sidebar section starts at the top, including its title and description');
}
async function checkInterfacePreferences(page) {
  const original = await page.evaluate(() => window.nodus.getSettings());
  const trigger = page.getByTestId('academic-interface-trigger');
  const picker = page.getByTestId('academic-interface-picker');
  const settled = () => page.waitForFunction(() => document.querySelector('[data-testid="academic-interface-picker"]')?.getAttribute('aria-busy') === 'false');
  await trigger.click();
  assert.equal(await picker.getByRole('tab').count(),4);
  await page.getByTestId('interface-tab-profiles').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByTestId('interface-tab-theme').getAttribute('aria-selected'),'true');
  await page.getByTestId('interface-theme-system').click(); await settled();
  assert.equal((await page.evaluate(() => window.nodus.getSettings())).theme,'system');
  await page.getByTestId('interface-theme-light').click();
  await page.waitForFunction(() => document.documentElement.classList.contains('light'));
  await page.getByTestId('interface-theme-picker').getByRole('button').nth(1).click();
  const palette = (await page.evaluate(() => window.nodus.getSettings())).appTheme;
  assert.notEqual(palette,'default');
  await page.getByTestId('interface-share-theme').setChecked(!original.shareAppThemeAcrossVaults);
  await settled();
  await page.screenshot({path:path.join(shots,'interface-theme-light.png')});
  await page.getByTestId('interface-theme-dark').click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('light'));
  await settled();
  await page.screenshot({path:path.join(shots,'interface-theme-dark.png')});
  await page.getByTestId('interface-tab-languages').click();
  await page.locator('#interface-ui-language').selectOption('en');
  await page.waitForFunction(() => document.getElementById('interface-tab-languages')?.textContent?.includes('Languages'));
  await page.locator('#interface-prompt-language').selectOption('ru');
  const languages = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(languages.uiLanguage,'en'); assert.equal(languages.promptLanguage,'ru');
  await settled();
  await page.screenshot({path:path.join(shots,'interface-languages.png')});
  await page.locator('#interface-ui-language').selectOption('es');
  await page.waitForFunction(() => document.getElementById('interface-tab-languages')?.textContent?.includes('Idiomas'));
  await page.getByTestId('interface-tab-nodi').click();
  await page.getByTestId('interface-nodi-enabled').check();
  assert.equal((await page.evaluate(() => window.nodus.getSettings())).mascotEnabled,true);
  await settled();
  await page.screenshot({path:path.join(shots,'interface-nodi.png')});
  await page.getByTestId('interface-nodi-enabled').uncheck();
  const settings = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(settings.academicInterfaceProfile,original.academicInterfaceProfile);
  assert.deepEqual(settings.sidebarOrder,original.sidebarOrder);
  assert.deepEqual(settings.sidebarHidden,original.sidebarHidden);
  assert.deepEqual(settings.defaultModel,original.defaultModel);
  assert.equal(settings.academicMode,original.academicMode);
  await page.keyboard.press('Escape'); await picker.waitFor({state:'detached'});
  assert.equal(await trigger.evaluate(element => document.activeElement === element),true);
  await trigger.click();
  await page.getByTestId('interface-tab-theme').click();
  await picker.getByRole('button',{name:'Crear o editar temas'}).click();
  await page.waitForFunction(() => document.activeElement?.id === 'settings-appearance-section');
  await page.getByTestId('theme-picker').waitFor();
  await trigger.click(); await page.getByTestId('interface-tab-nodi').click();
  await picker.getByRole('button',{name:'Más ajustes de Nodi'}).click();
  await page.waitForFunction(() => document.activeElement?.id === 'settings-nodi-section');
  await page.getByTestId('nodi-size-setting').waitFor();
  // Both selectors dismiss on real clicks in the previously draggable header.
  const header = page.locator('header.app-titlebar');
  const headerBounds = await header.boundingBox();
  const outside = {x:headerBounds.x + headerBounds.width * .45,y:headerBounds.y + 2};
  await trigger.click();
  assert.equal(await header.evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region')),'no-drag');
  await page.mouse.click(outside.x,outside.y); await picker.waitFor({state:'detached'});
  const vaultTrigger = page.getByTestId('header-vault-badge');
  await vaultTrigger.click(); await page.getByTestId('vault-switcher-panel').waitFor();
  await page.mouse.click(outside.x,outside.y); await page.getByTestId('vault-switcher-panel').waitFor({state:'detached'});
  await trigger.click(); await vaultTrigger.click();
  await picker.waitFor({state:'detached'}); await page.getByTestId('vault-switcher-panel').waitFor();
  await trigger.click(); await page.getByTestId('vault-switcher-panel').waitFor({state:'detached'});
  await picker.waitFor(); await trigger.click(); await picker.waitFor({state:'detached'});
  // A header action still works on its first click while a selector is open.
  const beforeTheme = (await page.evaluate(() => window.nodus.getSettings())).theme;
  await trigger.click(); await page.getByTestId('header-actions').locator('[data-header-action="theme"]').click();
  await picker.waitFor({state:'detached'});
  assert.notEqual((await page.evaluate(() => window.nodus.getSettings())).theme,beforeTheme);
  await page.evaluate(original => window.nodus.updateSettings({theme:original.theme,appTheme:original.appTheme,shareAppThemeAcrossVaults:original.shareAppThemeAcrossVaults,uiLanguage:original.uiLanguage,promptLanguage:original.promptLanguage,mascotEnabled:original.mascotEnabled}),original);
}
try {
  let page = await launch(); await setup(page, { sidebarCustomized: true, sidebarOrder: ['authors','graph','ideas','dictionary','researchChat','toolkit'], sidebarHidden: ['graph','dictionary'], scriptorSidebarVersion: 1 });
  assert.match(await page.getByTestId('academic-interface-trigger').innerText(), /Personalizado/);
  assert.equal(await page.getByTestId('academic-learning-invitation').count(), 0, 'upgrades do not force a guide');
  const legacy = await navIds(page);
  const legacySettings = await page.evaluate(() => window.nodus.getSettings());
  assert.equal(legacySettings.academicInterfaceProfile,'custom','existing personalized vaults migrate directly to Custom');
  for (const profile of ['simple','intermediate','advanced']) {
    await choose(page,profile);
    const presetSettings = await page.evaluate(() => window.nodus.getSettings());
    assert.deepEqual(presetSettings.sidebarOrder,legacySettings.sidebarOrder);
    assert.deepEqual(presetSettings.sidebarHidden,legacySettings.sidebarHidden);
    await choose(page,'custom');
    assert.deepEqual(await navIds(page),legacy,'returning from a preset restores the existing presentation');
    await checkCustomEditor(page);
  }
  await choose(page,'simple');
  assert.deepEqual(await navIds(page), ['library','researchChat','toolkit','workspace','toolkit:drift','toolkit:presenter','settings']);
  assert.equal(await page.getByTestId('academic-learning-invitation').count(),0,'guides are opened explicitly from Interface');
  await openGuide(page);
  await page.getByTestId('academic-learning-invitation').waitFor();
  await page.getByTestId('academic-learning-invitation').getByRole('button',{name:'Cerrar',exact:true}).click();
  await checkHeaderDefaults(page);
  await openGuide(page);
  assert.equal(await page.locator('[data-tour="toolkit"]').isVisible(), false);
  await page.screenshot({ path: path.join(shots,'simple-dark.png') });
  await page.getByTestId('academic-learning-invitation').getByRole('button', { name:'Cerrar' }).click();
  await page.getByTestId('academic-learning-invitation').waitFor({ state:'detached' });
  await page.reload(); await page.getByTestId('academic-interface-trigger').waitFor();
  assert.equal(await page.getByTestId('academic-learning-invitation').count(), 0);
  await page.getByTestId('academic-interface-trigger').click();
  await page.getByRole('button',{name:'Cómo empezar con este perfil'}).click();
  await page.getByTestId('academic-learning-invitation').waitFor();
  await page.getByTestId('academic-learning-invitation').getByRole('button',{name:'Cerrar'}).click();
  // All interface profiles keep the same header defaults and shared tool shortcuts.
  for (const profile of ['intermediate','advanced','custom']) {
    await choose(page,profile);
    await checkHeaderDefaults(page);
    const ids = await navIds(page);
    for (const id of ['workspace','toolkit:drift','toolkit:presenter']) assert.ok(ids.includes(id),`${profile}: ${id}`);
  }
  await choose(page,'simple');
  await checkInterfacePreferences(page);
  await page.locator('[data-tour="nav-researchChat"]').click();
  await openMore(page);
  await page.getByTestId('header-visibility-feedback').click();
  assert.equal(await page.getByTestId('header-visibility-feedback').getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByTestId('header-actions').locator('[data-header-action="feedback"]').isVisible(),true);
  await page.getByTestId('header-visibility-theme').click();
  assert.equal(await page.getByTestId('header-actions').locator('[data-header-action="theme"]').isVisible(),false);
  // Menu actions remain usable while hidden; the theme action changes the real setting.
  await page.getByTestId('header-more-panel').locator('[data-header-menu-action="theme"] .header-more-run').click();
  await openMore(page);
  await page.getByTestId('header-visibility-theme').click();
  await page.keyboard.press('Escape');
  assert.equal((await page.evaluate(() => window.nodus.getSettings())).headerActionVisibility.feedback,true);
  assert.equal((await page.evaluate(() => window.nodus.getSettings())).academicInterfaceProfile,'simple','header edits keep the selected preset');
  await page.reload(); await page.getByTestId('academic-interface-trigger').waitFor();
  assert.equal(await page.getByTestId('header-actions').locator('[data-header-action="feedback"]').isVisible(),true,'header choices survive reload');
  // Runtime coverage of selector, guide, and visibility actions in every UI locale.
  const tables = JSON.parse((await readFile(path.join(root,'src/i18n.academicInterface.ts'),'utf8')).split(' = ')[1].trim().replace(/;$/,''));
  for (const [language,table] of Object.entries({es:{},...tables})) {
    await page.evaluate(language => window.nodus.updateSettings({uiLanguage:language}),language);
    const label = table.Sencillo ?? 'Sencillo';
    await page.waitForFunction(label => document.querySelector('[data-testid="academic-interface-trigger"]')?.textContent?.includes(label),label);
    await page.getByTestId('academic-interface-trigger').click();
    assert.equal(await page.getByTestId('academic-profile-simple').locator('strong').innerText(),label);
    assert.equal(await page.getByTestId('academic-profile-intermediate').locator('strong').innerText(),table.Intermedio ?? 'Intermedio');
    assert.equal(await page.getByTestId('interface-tab-profiles').innerText(),table.Perfiles ?? 'Perfiles');
    assert.equal(await page.getByTestId('interface-tab-languages').innerText(),table.Idiomas ?? 'Idiomas');
    await page.keyboard.press('Escape');
    await page.getByTestId('academic-interface-picker').waitFor({state:'detached'});
    // Identify by the stable icon trigger rather than translating a test locator.
    await page.getByTestId('header-actions').locator('.academic-header-more > button').click();
    const menu = page.getByTestId('header-more-panel');
    await menu.getByText(table['Botones de la cabecera'] ?? 'Botones de la cabecera',{exact:true}).waitFor();
    const eyeName = await page.getByTestId('header-visibility-feedback').getAttribute('aria-label');
    assert.ok(eyeName && eyeName.startsWith((table['Ocultar {action} de la cabecera'] ?? 'Ocultar {action} de la cabecera').split('{action}')[0]),language);
    await page.keyboard.press('Escape');
    await page.getByTestId('academic-interface-trigger').click();
    await page.getByRole('button',{name:table['Cómo empezar con este perfil'] ?? 'Cómo empezar con este perfil'}).click();
    await page.getByTestId('academic-learning-invitation').waitFor();
    await page.getByTestId('academic-learning-invitation').getByRole('button').first().click();
  }
  await page.evaluate(() => window.nodus.updateSettings({uiLanguage:'es',theme:'dark'}));
  await page.waitForFunction(() => document.querySelector('[data-testid="academic-interface-trigger"]')?.textContent?.includes('Sencillo'));
  for (const [shortcut,destination] of [['toolkit:drift','toolkit-drift'],['toolkit:presenter','presenter-workspace']]) {
    await page.locator(`[data-tour="nav-${shortcut}"]`).click();
    await page.getByTestId(destination).waitFor();
  }
  await page.locator('[data-tour="nav-workspace"]').click();
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-nodi-view') === 'workspace');
  await page.locator('[data-tour="nav-researchChat"]').click();
  const draft = page.locator('textarea').first(); await draft.fill('Borrador que se conserva');
  await choose(page,'intermediate'); assert.equal(await draft.inputValue(),'Borrador que se conserva');
  await choose(page,'simple'); assert.equal(await draft.inputValue(),'Borrador que se conserva');
  // Import through the same desktop pipeline as the file picker and drop surface.
  const source = path.join(scratch,'source.md');
  await writeFile(source,'# Fuente de prueba\n\nLa biblioteca reúne fuentes verificables. La indexación permite recuperar los pasajes originales y consultar su evidencia. Esta fuente es una fixture local y no usa un proveedor externo.\n');
  const imported = await page.evaluate(async source => {
    const vault = await window.nodus.getActiveVault();
    await window.nodus.setResearchPreparationPolicy({ futureAdditions:true });
    return window.nodus.importDroppedFilesIntoVault([source],vault.id);
  },source);
  assert.equal(imported.linked,1);
  const deadline = Date.now() + 60_000;
  while (!(await page.evaluate(async () => (await window.nodus.getResearchPreparationInventory()).documents.some(doc => doc.workId && doc.preparation.embeddings === 'ready')))) {
    if (Date.now() > deadline) throw new Error('Source preparation timed out');
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.ok(requests > 0, 'automatic preparation reached only the local embedding fixture');
  const globalSource = path.join(scratch,'global-source.md');
  await writeFile(globalSource,'# Segunda fuente\n\nUna fuente de la biblioteca global solo entra en el contexto de investigación después de vincularla al vault. Esta fixture permite comprobar el alcance de las fuentes.\n');
  const globalId = await page.evaluate(async source => (await window.nodus.importDroppedGlobalLibraryFiles([source],null)).itemIds[0],globalSource);
  assert.ok(globalId);
  assert.equal(await page.evaluate(async id => (await window.nodus.getResearchPreparationInventory()).documents.some(doc => doc.libraryItemId === id && doc.workId),globalId),false);
  await page.evaluate(async id => { const vault = await window.nodus.getActiveVault(); await window.nodus.linkGlobalLibraryItemsToVault([id],vault.id); },globalId);
  const linkedDeadline = Date.now() + 60_000;
  while (!(await page.evaluate(async id => (await window.nodus.getResearchPreparationInventory()).documents.some(doc => doc.libraryItemId === id && doc.preparation.embeddings === 'ready'),globalId))) {
    if (Date.now() > linkedDeadline) throw new Error('Linked global source preparation timed out');
    await new Promise(resolve => setTimeout(resolve,300));
  }
  await page.locator('[data-tour="nav-library"]').click();
  await page.getByTestId('library-vault-add-files').waitFor();
  assert.equal(await page.getByTestId('library-extract-ideas').count(),0);
  await page.screenshot({ path:path.join(shots,'library-simple.png') });
  await page.getByRole('button',{ name:'Ver en Queue', exact:true }).click();
  await page.getByTestId('preparation-queue-bar').waitFor();
  await page.keyboard.press('Escape');
  await choose(page,'intermediate');
  assert.deepEqual(await navIds(page),['home','library','ideas','authors','argument','graph','researchChat','dictionary','deepResearch','toolkit','workspace','toolkit:drift','toolkit:presenter','settings']);
  await page.getByTestId('library-extract-ideas').waitFor();
  const sidebar=page.getByTestId('sidebar-scroll-region');
  for (const label of ['Explorar','Analizar','Herramientas']) await sidebar.getByRole('button',{name:label,exact:true}).waitFor();
  await page.screenshot({ path:path.join(shots,'intermediate.png') });
  await choose(page,'custom');
  const editor = page.locator('#settings-sidebar-editor'); await editor.waitFor();
  for (const label of ['Explorar','Analizar','Herramientas']) await editor.getByText(label,{exact:true}).waitFor();
  assert.equal(await editor.getByText('Nodus Scriptor',{exact:true}).count(),1);
  await checkCustomEditor(page);
  // Hidden sections retain their positions when another visibility preference changes.
  const orderBeforeVisibility = (await page.evaluate(() => window.nodus.getSettings())).sidebarOrder;
  await page.getByRole('button',{ name:'Proveedores',exact:true }).click();
  await choose(page,'custom');
  await editor.waitFor();
  await checkCustomEditor(page);
  const libraryRow = editor.locator('li').filter({hasText:/^Biblioteca$/});
  await libraryRow.getByTitle('Ocultar',{exact:true}).click();
  assert.ok(!(await navIds(page)).includes('library'));
  assert.deepEqual((await page.evaluate(() => window.nodus.getSettings())).sidebarOrder,orderBeforeVisibility);
  const graphHiddenRow = editor.locator('li').filter({hasText:/^Grafo$/});
  await graphHiddenRow.getByTitle('Mostrar',{exact:true}).click();
  assert.deepEqual((await page.evaluate(() => window.nodus.getSettings())).sidebarOrder,orderBeforeVisibility);
  const graphRow = editor.locator('li').filter({hasText:/^Grafo$/});
  await graphRow.getByTitle('Subir',{exact:true}).click();
  const saved = await page.evaluate(() => window.nodus.getSettings());
  await choose(page,'advanced');
  const advanced = await navIds(page); assert.ok(advanced.includes('hypothesis') && advanced.includes('reading'));
  assert.equal(advanced.filter(id => id === 'notes' || id === 'workspace').length,1);
  await choose(page,'custom');
  const restored = await page.evaluate(() => window.nodus.getSettings());
  assert.deepEqual(restored.sidebarOrder,saved.sidebarOrder); assert.deepEqual(restored.sidebarHidden,saved.sidebarHidden);
  // A sidebar edit adopts Custom in every preset; returning to the preset is unchanged.
  const requestsBeforeProfileEdits = requests;
  for (const profile of ['simple','intermediate','advanced']) {
    await choose(page,profile);
    const beforeHeader = await page.evaluate(() => window.nodus.getSettings());
    await openMore(page);
    await page.getByTestId('header-visibility-feedback').click();
    const afterHeader = await page.evaluate(() => window.nodus.getSettings());
    assert.equal(afterHeader.academicInterfaceProfile,profile);
    assert.deepEqual(afterHeader.sidebarOrder,beforeHeader.sidebarOrder);
    assert.deepEqual(afterHeader.sidebarHidden,beforeHeader.sidebarHidden);
    await page.getByTestId('header-visibility-feedback').click();
    await page.keyboard.press('Escape');
    await page.locator('[data-tour="nav-settings"]').click();
    await page.getByRole('button',{name:'Interfaz',exact:true}).click();
    await page.getByTestId('sidebar-preset-notice').waitFor();
    await page.locator('#settings-sidebar-section').evaluate(section => section.scrollIntoView({block:'start'}));
    await page.screenshot({path:path.join(shots,`sidebar-preset-${profile}.png`)});
    const presetNavigation = await navIds(page);
    const row = editor.locator('li').filter({hasText:/^Autores$/});
    const eye = row.getByTitle(profile === 'simple' ? 'Mostrar' : 'Ocultar',{exact:true});
    await eye.click();
    await page.waitForFunction(() => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-academic-profile') === 'custom');
    assert.equal(await page.getByTestId('sidebar-preset-notice').count(),0);
    await page.screenshot({path:path.join(shots,`sidebar-edit-${profile}.png`)});
    await choose(page,profile);
    assert.deepEqual(await navIds(page),presetNavigation,'editing a preset cannot mutate its definition');
  }
  assert.equal(requests,requestsBeforeProfileEdits,'interface changes do not start indexing');
  await page.evaluate(saved => window.nodus.updateSettings({academicInterfaceProfile:'custom',sidebarCustomized:true,sidebarOrder:saved.sidebarOrder,sidebarHidden:saved.sidebarHidden}),saved);
  await page.reload(); await page.getByTestId('academic-interface-trigger').waitFor();
  // No request or policy changes caused by profile switches.
  const policy = await page.evaluate(() => window.nodus.getResearchPreparationPolicy()); assert.equal(policy.futureAdditions,true);
  await page.setViewportSize({width:1024,height:768});
  const triggerBounds = await page.getByTestId('academic-interface-trigger').boundingBox();
  const vaultBounds = await page.getByTestId('header-vault-badge').boundingBox();
  assert.ok(vaultBounds && triggerBounds && triggerBounds.x + triggerBounds.width <= vaultBounds.x);
  await page.getByTestId('academic-interface-trigger').click();
  await page.screenshot({path:path.join(shots,'picker-narrow.png')}); await page.keyboard.press('Escape');
  await page.evaluate(() => window.nodus.updateSettings({theme:'light'}));
  await page.getByTestId('academic-interface-trigger').click();
  await page.screenshot({path:path.join(shots,'picker-light.png')}); await page.keyboard.press('Escape');
  // New local vault defaults are seeded independently of model setup.
  const created = await page.evaluate(async () => {
    const result = await window.nodus.createVault({ name:'Nuevo perfil',type:'academic' });
    await window.nodus.switchVault(result.vault.id);
    return { id:result.vault.id,settings:await window.nodus.getSettings() };
  });
  assert.equal(created.settings.academicInterfaceProfile,'simple');
  assert.equal(created.settings.headerActionVisibility?.feedback,undefined,'header choices belong to the original vault');
  await setup(page,{academicMode:'manual'});
  await choose(page,'intermediate');
  await openGuide(page);
  assert.match(await page.getByTestId('academic-learning-invitation').innerText(),/En trabajo Manual/);
  await page.getByTestId('academic-learning-invitation').getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.locator('[data-tour="nav-library"]').click();
  await page.locator('[data-tour="nav-toolkit"]').click();
  await page.getByTestId('toolkit-card-translate-pin').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="app-shell"]')?.getAttribute('data-academic-profile') === 'custom');
  assert.ok((await navIds(page)).includes('toolkit:translate'));
  const vaults = await page.evaluate(() => window.nodus.listVaults());
  await page.evaluate(id => window.nodus.switchVault(id),vaults.find(vault => vault.id !== created.id).id);
  await page.reload(); await page.getByTestId('academic-interface-trigger').waitFor();
  assert.match(await page.getByTestId('academic-interface-trigger').getAttribute('aria-label'),/Personalizado/);
  await app.close(); app=null;
  page=await launch(); await page.getByTestId('academic-interface-trigger').waitFor();
  const reopened=await page.evaluate(() => window.nodus.getSettings());
  assert.equal(reopened.academicInterfaceProfile,'custom'); assert.deepEqual(reopened.sidebarOrder,saved.sidebarOrder);
  assert.equal(reopened.headerActionVisibility.feedback,true,'header choices survive app restart');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('Academic profiles: guides, indexing, grouped navigation, shared tools, themes, vault isolation and restart passed.');
} catch(error) {
  if(app) { const page=await app.firstWindow(); await page.screenshot({path:path.join(shots,'failure.png')}).catch(()=>{}); console.error(await page.locator('body').innerText().catch(()=>'')); }
  throw error;
} finally {
  if(app) await app.close(); server.close(); await rm(scratch,{recursive:true,force:true});
}
