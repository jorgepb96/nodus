import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const cssRule = (css, selector) => {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `missing CSS rule for ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
};

test('worldbuilding and teaching use their own visible vault icons', async () => {
  const [picker, switcher, app, ui, dock] = await Promise.all([
    read('src/components/vaultTypeUi.tsx'),
    read('src/components/VaultSwitcher.tsx'),
    read('src/App.tsx'),
    read('src/components/ui.tsx'),
    read('src/dockIcon.ts'),
  ]);
  assert.match(picker, /case 'worldbuilding': return 'globe'/);
  assert.match(picker, /case 'docencia': return 'presentation'/);
  assert.match(picker, /new-vault-type-icon-/);
  assert.match(switcher, /vault-type-icon-/);
  assert.match(app, /vaultTypeIcon\(activeVault\.type\)/);
  assert.match(ui, /globe:/);
  assert.match(ui, /presentation:/);
  // Vault accents live once in shared/vaultColors; vaultTypes and the server import them.
  const vaultColors = await read('shared/vaultColors.ts');
  assert.match(vaultColors, /worldbuilding: '#7c3aed'/);
  assert.match(vaultColors, /docencia: '#ea580c'/);
  assert.match(dock, /vaultTypeColor\(type\)/);
});

test('the guide hands over to the first-vault chooser, not to an academic vault', async () => {
  const [app, screen, registry] = await Promise.all([
    read('src/app/StartupGate.tsx'),
    read('src/views/FirstVaultSetup.tsx'),
    read('electron/vaults/vaultRegistry.ts'),
  ]);
  // It comes straight after the guide and before anything else asks for a decision.
  // The order is now the order of the guard list, so read it off the ids.
  const guideAt = app.indexOf("id: 'basics-tutorial'");
  const chooserAt = app.indexOf('<FirstVaultSetup');
  const recoveryAt = app.indexOf('<RecoverySetupWizard');
  const onboardingAt = app.indexOf('<Onboarding');
  assert.ok(guideAt > 0 && chooserAt > guideAt, 'the chooser follows the guide');
  assert.ok(chooserAt < recoveryAt && chooserAt < onboardingAt, 'and precedes recovery setup and the model wizard');
  assert.match(app, /!state\.isPreviewVault && state\.newInstall && state\.settings\.firstVaultVersion === 0 && !!state\.activeVault/);

  // It RENAMES the vault the registry always materialises rather than creating a second
  // one — `defaultVaultRecord` is re-added whenever it is missing, so a create here
  // would strand an empty «Principal» on every new install.
  assert.match(registry, /function defaultVaultRecord\(\): VaultRecord/);
  assert.match(registry, /vaults\.unshift\(defaultVaultRecord\(\)\)/);
  assert.match(screen, /window\.nodus\.renameVault\(vault\.id, trimmed\)/);
  assert.match(screen, /window\.nodus\.setVaultType\(vault\.id, type\)/);
  assert.doesNotMatch(screen, /createVault/, 'the install already has a vault');
  // The flag is written LAST, so a failed rename leaves the screen retryable instead of
  // marking it answered with the vault half-configured.
  const renameAt = screen.indexOf('renameVault(vault.id');
  const flagAt = screen.indexOf('firstVaultVersion: FIRST_VAULT_VERSION');
  assert.ok(renameAt > 0 && flagAt > renameAt);
  // Never a dead end: the name is pre-filled and Enter submits.
  assert.match(screen, /useState\(\(\) => t\('Mi bóveda'\)\)/);
  assert.match(screen, /event\.key === 'Enter'/);
  assert.match(screen, /data-testid="first-vault-create"/);
  // Cinematic chrome, like the guide it follows.
  assert.match(screen, /className="tutorial-cinema tutorial-language-screen first-vault-screen"/);
  assert.match(screen, /<NodiAvatar/);
});

test('the first-vault chooser keeps its create action visible without scrolling', async () => {
  const [screen, css] = await Promise.all([
    read('src/views/FirstVaultSetup.tsx'),
    read('src/index.css'),
  ]);
  assert.match(screen, /className="tutorial-cinema tutorial-language-screen first-vault-screen"/);
  assert.match(screen, /className="first-vault-intro"/);
  assert.match(screen, /className="first-vault-footer"/);
  assert.match(screen, /className="first-vault-footer"[\s\S]*data-testid="first-vault-create"/);

  const screenRule = cssRule(css, '.tutorial-cinema.first-vault-screen');
  const cardRule = cssRule(css, '.first-vault-card');
  const pickerRule = cssRule(css, ".first-vault-card [data-testid='vault-type-picker'] > button");
  assert.match(screenRule, /overflow:\s*clip/);
  assert.match(cardRule, /overflow:\s*hidden/);
  assert.doesNotMatch(cardRule, /overflow-y:\s*auto/);
  assert.match(pickerRule, /height:\s*clamp/);
});

test('the first-vault chooser can only ever meet a genuinely new install', async () => {
  const [app, prefs, defaults, types] = await Promise.all([
    read('src/App.tsx'),
    read('electron/db/appPrefs.ts'),
    read('shared/defaultAppSettings.ts'),
    read('shared/types.ts'),
  ]);
  // The gate is captured from the FIRST settings read of the run. Both flags it depends
  // on flip while the app is running — the guide sets basicsTutorialVersion, then the
  // chooser sets firstVaultVersion — so a live read would close the chooser the instant
  // it opened, and would show it to installs that predate it.
  assert.match(app, /const newInstallRef = useRef<boolean \| null>\(null\)/);
  assert.match(app, /if \(!settings \|\| newInstallRef\.current !== null\) return;/);
  assert.match(app, /const fresh = settings\.basicsTutorialVersion === 0;/);
  // …and an install that already completed the guide is stamped, so replaying the guide
  // from Settings and restarting can never make it look new.
  assert.match(app, /if \(!fresh && settings\.firstVaultVersion === 0\) \{\s*\n\s*void window\.nodus\.updateSettings\(\{ firstVaultVersion: FIRST_VAULT_VERSION \}\);/);
  // App-wide, like the tutorial version it sits next to: answering it in one vault must
  // not leave another vault asking again.
  assert.match(types, /firstVaultVersion: number;/);
  assert.match(defaults, /firstVaultVersion: 0,/);
  assert.match(prefs, /'firstVaultVersion',/);
});

test('preview vaults bypass setup and every automatic tutorial', async () => {
  const [app, startup] = await Promise.all([read('src/App.tsx'), read('src/app/StartupGate.tsx')]);
  assert.match(startup, /!state\.isPreviewVault && state\.settings\.basicsTutorialVersion === 0/);
  assert.match(startup, /!state\.isPreviewVault && !state\.settings\.onboardingComplete/);
  assert.match(app, /\{!isPreviewVault && settings\.onboardingComplete[^\n]+!settings\.tourComplete/);
  assert.match(app, /\{!isPreviewVault && settings\.onboardingComplete[^\n]+settings\.tourComplete[^\n]+!settings\.advancedTourComplete/);
  assert.match(app, /\{!isPreviewVault && settings\.onboardingComplete &&/);
});

test('academic onboarding offers Nodus Library or optional Zotero while dedicated vaults stay local-first', async () => {
  const onboarding = await read('src/views/Onboarding.tsx');
  assert.match(onboarding, /const usesZoteroOnboarding = vaultType === 'academic';/);
  assert.match(onboarding, /const simple = !usesZoteroOnboarding;/);
  assert.match(onboarding, /useState<'nodus' \| 'zotero'>\('nodus'\)/);
  assert.match(onboarding, /data-testid="onboarding-library-nodus"/);
  assert.match(onboarding, /data-testid="onboarding-library-zotero"/);
  // The two sources are shown as brands, not as generic glyphs: the Nodus node mark
  // and the same mark drawn as a red Z, with Zotero carrying the recommendation.
  assert.match(onboarding, /import nodusLogo from '\.\.\/assets\/nodus-logo\.svg';/);
  assert.match(onboarding, /import zoteroLogo from '\.\.\/assets\/nodus-logo-zotero\.svg';/);
  assert.match(onboarding, /data-testid="onboarding-library-nodus"[\s\S]*?<img src=\{nodusLogo\}/);
  assert.match(onboarding, /data-testid="onboarding-library-zotero"[\s\S]*?<img src=\{zoteroLogo\}/);
  assert.match(onboarding, /data-testid="onboarding-library-zotero-recommended"[^>]*>\{t\('Recomendado'\)\}/);
  // Nodus Library is the standalone reference manager, still in beta; the pair of
  // badges is what tells the two options apart at a glance.
  assert.match(onboarding, /data-testid="onboarding-library-nodus-beta"[^>]*>BETA</);
  assert.match(onboarding, /if \(connectsZotero\) \{[\s\S]*syncNow/);
  assert.match(onboarding, /No necesitas Zotero/);
  assert.match(onboarding, /Organiza cursos, apuntes, materiales y repasos en un espacio de aprendizaje local/);
  assert.match(onboarding, /enlazar materiales de Zotero de forma opcional/);
  assert.match(onboarding, /Conserva entrevistas, participantes y transcripciones en un archivo de historia oral local y privado/);
  assert.match(onboarding, /Estudia una población histórica desde sus fuentes, observaciones y criterios explícitos/);
  assert.match(onboarding, /Construye un mundo de ficción coherente a partir de tu propio canon/);
});

test('academic first-run tour stays focused on the current evidence workflow in every language', async () => {
  const [tour, engine, library, translations] = await Promise.all([
    read('src/views/Tour.tsx'),
    read('src/views/tourEngine.tsx'),
    read('src/views/GlobalLibraryView.tsx'),
    read('src/i18n.academicTour.ts'),
  ]);

  assert.match(tour, /export const ACADEMIC_TOUR_STEPS/);
  assert.equal(tour.match(/^\s{4}title:/gm)?.length, 9, 'the essential tour should remain a nine-step path');
  assert.match(tour, /Biblioteca → Ideas → Grafo/);
  assert.match(tour, /La fuente sigue siendo la autoridad|la fuente sigue siendo la autoridad/);
  for (const target of ['vault-badge', 'nav-library', 'library-scope', 'nav-ideas', 'nav-graph', 'nav-workspace']) {
    assert.match(tour, new RegExp(`target: '${target}'`), `missing current tour target ${target}`);
  }
  for (const obsoleteTarget of ['sync', 'model', 'nav-notes', 'nav-search']) {
    assert.doesNotMatch(tour, new RegExp(`target: '${obsoleteTarget}'`), `obsolete tour target ${obsoleteTarget}`);
  }

  assert.match(library, /data-tour="library-scope"/);
  assert.match(engine, /scrollIntoView\(\{ block: 'center', inline: 'nearest' \}\)/);
  assert.match(engine, /data-testid="tour-next"/);
  for (const language of ['en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
    const key = language === 'pt-BR' ? `'pt-BR'` : language;
    assert.match(translations, new RegExp(`^  ${key}: \\{`, 'm'), `missing academic tour copy for ${language}`);
  }
});

test('a failed Zotero check names the setting that fixes it', async () => {
  const [client, helper, onboarding, translate, en] = await Promise.all([
    read('electron/zotero/zoteroClient.ts'),
    read('src/lib/zoteroConnection.ts'),
    read('src/views/Onboarding.tsx'),
    read('src/views/ToolkitTranslateView.tsx'),
    read('src/i18n.en.ts'),
  ]);
  // A closed Zotero answers with a bare transport error ("The operation could not be
  // completed."), so the cause has to travel as a reason the renderer can localize.
  assert.match(client, /reason: res\.status === 403 \? 'forbidden' : 'http'/);
  assert.match(client, /reason: 'unreachable'/);
  assert.doesNotMatch(client, /Habilita "Permitir/);
  // …and a Zotero that DID answer, with some other status, must not be blamed on it.
  assert.match(helper, /if \(status\?\.reason === 'http'\) return null;/);
  const hint = /Comprueba que Zotero esté abierto y que «Permitir que otras aplicaciones de este ordenador se comuniquen con Zotero» esté activado en los ajustes Avanzados de Zotero\./;
  assert.match(helper, hint);
  assert.match(en, hint);
  // Both surfaces that check the connection show it: the academic wizard and Translate.
  for (const view of [onboarding, translate]) {
    assert.match(view, /zoteroConnectionHint/);
    assert.match(view, /zoteroPingErrorText/);
  }
});

test('Zotero controls stay out of testimonies, prosopography and worldbuilding', async () => {
  const [app, settings] = await Promise.all([
    read('src/App.tsx'),
    read('src/views/Settings.tsx'),
  ]);
  assert.match(settings, /ZOTERO_FREE_VAULT_TYPES = new Set<VaultType>\(\['testimonios', 'prosopography', 'worldbuilding'\]\)/);
  assert.match(settings, /if \(tab === 'library' && !hasZoteroLibraryWorkflow\) return false;/);
  assert.match(settings, /tab\.id !== 'library' \|\| hasZoteroLibraryWorkflow/);
  assert.match(app, /!isWorldbuilding && !isProsopography && !isTestimonios/);
});

test('study has a first-run tour and a replay action in settings', async () => {
  const [tour, app, settings, sidebar] = await Promise.all([
    read('src/views/StudyTour.tsx'),
    read('src/App.tsx'),
    read('src/views/Settings.tsx'),
    read('src/components/StudySidebar.tsx'),
  ]);
  for (const target of ['studyCourses', 'studySchedule', 'studyCalendar', 'studyLibrary', 'studyRecordings', 'studyChat', 'studyIdeas', 'studyQuestions', 'studyReview']) {
    assert.match(tour, new RegExp(`nav-${target}`));
  }
  assert.match(app, /isEstudio && !settings\.studyTourComplete/);
  assert.match(app, /updateSettings\(\{ studyTourComplete: true \}\)/);
  assert.match(settings, /data-testid="study-tour-replay"/);
  assert.match(settings, /patch\(\{ studyTourComplete: false \}\)/);
  assert.match(sidebar, /data-tour=\{`nav-\$\{item\.view\}`\}/);
});

test('demos never trigger tutorials; only vault creation and Settings can do that', async () => {
  const [app, engine, settings, ...demoSeeders] = await Promise.all([
    read('src/App.tsx'),
    read('src/views/tourEngine.tsx'),
    read('src/views/Settings.tsx'),
    read('electron/db/demoData.ts'),
    read('electron/db/genealogyDemoData.ts'),
    read('electron/db/databasesDemoData.ts'),
    read('electron/db/studyDemoData.ts'),
    read('electron/db/teachingDemoData.ts'),
    read('electron/db/primarySourcesDemoData.ts'),
    read('electron/db/testimonyDemoData.ts'),
    read('electron/db/worldbuildingDemoData.ts'),
    read('electron/db/prosopDemoRepo.ts'),
  ]);

  // Every tour shows the video route. A missing publication changes only its enabled
  // state, not whether the choice exists.
  assert.match(engine, /showUnavailableVideo = true/);
  assert.match(engine, /\(video \|\| showUnavailableVideo\)/);
  assert.match(engine, /disabled=\{!video\}/);

  // Testimonios used to wait for demoMode, so loading its sample looked like the thing
  // that launched the tutorial. Its creation-time gate is now independent of the demo.
  assert.match(app, /isTestimonios && !settings\.testimonyTourComplete/);
  assert.doesNotMatch(app, /isTestimonios && settings\.demoMode && !settings\.testimonyTourComplete/);

  // The explicit replay controls in Settings are the only product code allowed to
  // reset a completed dedicated tutorial.
  for (const flag of [
    'genealogyTourComplete',
    'databasesTourComplete',
    'testimonyTourComplete',
    'studyTourComplete',
    'docenciaTourComplete',
  ]) {
    assert.match(settings, new RegExp(`patch\\(\\{ ${flag}: false \\}\\)`), `${flag} remains replayable from Settings`);
    for (const seeder of demoSeeders) {
      assert.doesNotMatch(seeder, new RegExp(`${flag}: false`), `a demo seeder resets ${flag}`);
    }
  }
  for (const seeder of demoSeeders) {
    assert.doesNotMatch(seeder, /tourComplete: false/, 'a demo seeder resets the shared tutorial');
  }
});

test('discarding a new onboarding vault switches away before deleting it', async () => {
  const app = await read('src/App.tsx');
  const start = app.indexOf('const cancelOnboarding = useCallback');
  const end = app.indexOf('const exitDemo = useCallback', start);
  assert.ok(start >= 0 && end > start);
  const cancelFlow = app.slice(start, end);
  const switchAt = cancelFlow.indexOf('switchVault(other.id)');
  const deleteAt = cancelFlow.indexOf('deleteVault(discardedVaultId, true)');
  assert.ok(switchAt >= 0 && deleteAt > switchAt, 'the active vault must be switched before it can be deleted');
  assert.match(cancelFlow, /if \(!switched\.ok\) throw new Error\(switched\.message\)/);
});

test('both vault creation screens offer the SAME modes, from one picker', async () => {
  const [shared, switcher, first] = await Promise.all([
    read('src/components/vaultTypeUi.tsx'),
    read('src/components/VaultSwitcher.tsx'),
    read('src/views/FirstVaultSetup.tsx'),
  ]);
  // Which modes exist, which are "Pronto", which carry a BETA/PREVIEW tag and what each
  // promises are decided once. Two copies of this grid is exactly how the first-run
  // chooser would end up offering a type the switcher had already retired.
  assert.match(shared, /export function VaultTypePicker\(/);
  for (const file of [switcher, first]) {
    assert.match(file, /<VaultTypePicker value=/, 'renders the shared picker');
    assert.doesNotMatch(file, /CREATE_VAULT_TYPES\.map/, 'must not re-implement the grid');
    assert.doesNotMatch(file, /vaultTypeDescription\(tp\)/);
  }
  // The vocabulary moved wholesale: nothing may be left behind to drift.
  for (const symbol of ['vaultTypeLabel', 'vaultTypeIcon', 'vaultTypeDescription', 'vaultTypePhase', 'CREATE_VAULT_TYPES']) {
    assert.match(shared, new RegExp(`export (?:function|const) ${symbol}\\b`), `${symbol} lives in vaultTypeUi`);
    assert.doesNotMatch(switcher, new RegExp(`^(?:export )?function ${symbol}\\(`, 'm'), `${symbol} must not be redefined in the switcher`);
  }
  // The header and Settings have imported these from VaultSwitcher since before the
  // split, so it re-exports them rather than breaking those call sites.
  assert.match(switcher, /export \{ vaultTypeIcon, vaultTypeLabel \} from '\.\/vaultTypeUi'/);
});

test('PRE-ALPHA is explicit and blocks both creation flows behind confirmation', async () => {
  const [shared, switcher, first] = await Promise.all([
    read('src/components/vaultTypeUi.tsx'),
    read('src/components/VaultSwitcher.tsx'),
    read('src/views/FirstVaultSetup.tsx'),
  ]);

  assert.match(shared, /type === 'primary_sources' \|\| type === 'prosopography' \|\| type === 'testimonios'\) return 'pre-alpha'/);
  assert.match(shared, /if \(type === 'worldbuilding'\) return 'alpha'/);
  assert.match(shared, /PRE-ALPHA: este vault no es utilizable para trabajo real/);
  assert.match(shared, /data-testid="pre-alpha-vault-confirmation"/);
  assert.match(shared, /Sí, crear solo para pruebas/);

  for (const file of [switcher, first]) {
    assert.match(file, /isPreAlphaVaultType\(/);
    assert.match(file, /<PreAlphaVaultConfirmation/);
    assert.match(file, /preAlphaConfirmed/);
  }
  assert.match(switcher, /void createVault\(true\)/);
  assert.match(first, /void submit\(true\)/);
});

test('the create-vault modal shows an inline accessible name error', async () => {
  const picker = await read('src/components/VaultSwitcher.tsx');
  assert.match(picker, /setAddNameError\(t\('Escribe un nombre para la bóveda\.'\)\)/);
  assert.match(picker, /data-testid="vault-name-error"/);
  assert.match(picker, /role="alert"/);
  assert.match(picker, /aria-invalid=\{Boolean\(addNameError\)\}/);
});

test('vault deletion names its target in the security-code and final confirmation steps', async () => {
  const switcher = await read('src/components/VaultSwitcher.tsx');
  assert.match(
    switcher,
    /tx\('Introduce este código manualmente para eliminar la bóveda "\{name\}"\.', \{ name: pendingAction\.vault\.name \}\)/,
  );
  assert.match(
    switcher,
    /tx\('Código correcto\. Confirma una última vez para eliminar la bóveda "\{name\}"\.', \{ name: pendingAction\.vault\.name \}\)/,
  );
  assert.match(switcher, /<p className="mb-4 text-sm text-neutral-400">\{codeMessage\}<\/p>/);
  assert.match(switcher, /message=\{finalMessage\}/);
});

test('the create-vault modal asks for a name and a type, never for models', async () => {
  // Model choice belongs to the setup wizard, where Nodus can discover the models
  // from the stored keys. Asking again here is the duplication this replaced.
  const [picker, types] = await Promise.all([
    read('src/components/VaultSwitcher.tsx'),
    read('shared/vaultTypes.ts'),
  ]);
  assert.doesNotMatch(picker, /VaultCreationModels/, 'the creation modal must not embed the model picker');
  assert.doesNotMatch(picker, /aiModel|embeddingProvider|embeddingModel/, 'creation must not send a model payload');
  assert.doesNotMatch(picker, /downloadNodusLocalModel|installNodusLocalRuntime/, 'downloading belongs to the wizard, not to creation');
  assert.match(picker, /createVault\(\{ name, type: addType \}\)/);
  // The button now routes to one of the two origins — a local vault or a replica of a Nodus
  // Server space — but neither branch may depend on a model selection, which is the point.
  assert.match(picker, /addMode === 'connected' \? connectVault\(\) : createVault\(\)/);
  assert.doesNotMatch(picker, /disabled=\{[^}]*(aiModel|embeddingModel|modelsReady|selectedModel)[^}]*\}/);
  assert.match(picker, /data-testid="vault-models-next-step"/);
  // Both origins are offered, and the local one is the default.
  assert.match(picker, /data-testid=\{`vault-origin-\$\{mode\}`\}/);
  assert.match(picker, /useState<'local' \| 'connected'>\('local'\)/);
  for (const type of ['academic', 'genealogy', 'estudio', 'databases']) {
    assert.match(types, new RegExp(`id: '${type}'[\\s\\S]{0,180}available: true`));
  }
});

test('the wizard discovers both model roles but can be explicitly postponed', async () => {
  const [onboarding, step, select] = await Promise.all([
    read('src/views/Onboarding.tsx'),
    read('src/components/OnboardingModelStep.tsx'),
    read('src/components/SearchableModelSelect.tsx'),
  ]);
  // Discovery runs on mount against every reachable provider — no button to press.
  assert.match(step, /useEffect\(\(\) => \{\s*void discover\(keys\)/);
  assert.match(step, /autoDiscoverableAiProviders\(active\)/);
  assert.match(step, /autoDiscoverableEmbeddingProviders\(active\)/);
  assert.match(step, /listModels\(provider\)/);
  assert.match(step, /listEmbeddingModels\(provider as EmbeddingProvider\)/);
  // Both roles are picked separately, and each picker has a searchbox.
  assert.match(step, /testId="onboarding-ai-model"/);
  assert.match(step, /testId="onboarding-embedding-model"/);
  assert.match(select, /data-testid=\{`\$\{testId\}-search`\}/);
  assert.match(select, /filterModelChoices\(choices, query\)/);
  // Adding a key re-runs discovery rather than asking the user to reload.
  assert.match(step, /await window\.nodus\.setApiKey\(keyProvider, keyValue\.trim\(\)\)[\s\S]{0,200}await discover\(next\)/);
  // The wizard, not vault creation, now persists both models and fetches local ones.
  assert.match(onboarding, /synthesisModel: aiModel/);
  assert.match(onboarding, /embeddingProvider,/);
  assert.match(onboarding, /embeddingModel: normalizeEmbeddingModel\(embeddingProvider, embeddingModel\.model\)/);
  assert.match(onboarding, /await downloadLocalModels\(\[aiModel, embeddingModel\]\)/);
  assert.match(onboarding, /data-testid="onboarding-start"[\s\S]{0,180}disabled=\{finishing \|\| skippingAi \|\| !aiModel \|\| !embeddingModel\}/);
  // Postponing is a distinct confirmed path: it completes onboarding without
  // persisting either auto-selected model, so the vault can be explored first.
  assert.match(onboarding, /data-testid="onboarding-configure-ai-later"/);
  assert.match(onboarding, /title=\{t\('Configurar IA más tarde'\)\}/);
  assert.match(onboarding, /confirmLabel=\{t\('Explorar sin IA'\)\}/);
  assert.match(onboarding, /const configureAiLater = async \(\) => \{[\s\S]*onboardingComplete: true,[\s\S]*onDone\('home'\)/);
  const postpone = onboarding.slice(onboarding.indexOf('const configureAiLater'), onboarding.indexOf('const steps'));
  assert.doesNotMatch(postpone, /synthesisModel|embeddingProvider|embeddingModel/, 'postponing must not silently save the discovered models');
});

test('vault creation persists the complete model selection and keeps legacy callers compatible', async () => {
  const [types, ipc, settings] = await Promise.all([
    read('shared/types.ts'),
    read('electron/ipc.ts'),
    read('electron/vaults/vaultCreationSettings.ts'),
  ]);
  assert.match(types, /aiModel\?: ModelRef/);
  assert.match(types, /embeddingProvider\?: EmbeddingProvider/);
  assert.match(types, /embeddingModel\?: string/);
  assert.match(ipc, /validateVaultModelSelection\(input\)/);
  assert.match(ipc, /initializeVaultModelSelection\(vault\.path, modelSelection\)/);
  assert.match(settings, /if \(!hasAnySelection\) return null/);
  assert.match(settings, /modelSettingsMode: 'basic'/);
  assert.match(settings, /embeddingProvider: selection\.embeddingProvider/);
  assert.match(settings, /writeGlobalPrefs\(\{ favorites, synthesisModel: selection\.aiModel \}\)/);
});
