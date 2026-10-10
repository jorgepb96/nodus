import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { app, safeStorage } from 'electron';

const lab = process.env.NODUS_MOBILE_ACCEPTANCE_LAB;
if (!lab || !fs.existsSync(path.join(lab, '.nodus-mobile-acceptance-lab'))) throw new Error('An isolated acceptance lab is required.');
const build = JSON.parse(fs.readFileSync(path.join(path.dirname(__filename),'lab-bridge.build.json'),'utf8'));
if (createHash('sha256').update(fs.readFileSync(__filename)).digest('hex') !== build.bundleSha256) throw new Error('The acceptance Bridge bundle does not match its build receipt.');
// Match Desktop's stable Safe Storage identity. A distinct visible test name
// strands credentials when this same isolated profile is opened by Desktop.
app.setName('Nodus'); app.setPath('userData', path.resolve(lab));
// Exporters briefly create a hidden Chromium window. Closing it must not stop this headless acceptance host.
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('The laboratory needs the real macOS keychain.');
  const recovered = await (await import('../electron/secrets/legacySecretRecovery')).recoverLegacyApiKeys();
  if (recovered.remainingLockedProviders.length) throw new Error('The laboratory has inaccessible configured provider credentials.');
  const { listVaults } = await import('../electron/vaults/vaultRegistry');
  if (!listVaults().every(vault => path.resolve(vault.path).startsWith(path.resolve(lab) + path.sep))) throw new Error('All vaults must be isolated.');
  await (await import('./mobile-acceptance-fixtures')).ensureAcceptanceFixtures(lab);
  await (await import('./mobile-acceptance-file-fixtures')).ensureAcceptanceFileFixtures(lab);
  await (await import('./mobile-acceptance-source-citation-fixtures')).ensureAcceptanceSourceCitationFixtures(lab);
  if (process.env.NODUS_MOBILE_ACCEPTANCE_SAVED_AUDIO === '1') {
    await (await import('./mobile-acceptance-audio-fixtures')).ensureAcceptanceAudioFixtures(lab);
  }
  const { createIpcContext } = await import('../electron/ipc/context');
  const context = createIpcContext(() => null);
  (await import('../electron/ipc/academic')).registerAcademicIpc(context);
  (await import('../electron/ipc/platform')).registerPlatformIpc(context);
  (await import('../electron/ipc/capabilities')).registerCapabilitiesIpc(context);
  (await import('../electron/ipc/library')).registerLibraryIpc(context);
  const { getDocumentVisuals } = await import('../electron/ai/documentVisuals');
  const { listDocumentSkills } = await import('../electron/capabilities/documentCatalog');
  context.h('documentVisuals:get', (_event, target) => getDocumentVisuals(target));
  context.h('documentSkills:list', () => listDocumentSkills());
  const { getSettings, updateSettings } = await import('../electron/db/settingsRepo');
  if (process.env.NODUS_MOBILE_ACCEPTANCE_PREPARE_DESKTOP === '1') {
    // Prepare this disposable install through the real recovery service, rather
    // than weakening the production startup guards or storing a user password.
    const recovery = await import('../electron/recovery/recoveryManager');
    if ((await recovery.getRecoveryStatus()).needsSetup) {
      const folder = path.join(path.dirname(lab), 'desktop-recovery'); fs.mkdirSync(folder, {recursive:true});
      const result = await recovery.initializeRecoveryFolder(folder, randomBytes(32).toString('base64url'), app.getVersion());
      if (!result.ok) throw new Error(result.message);
      console.log(JSON.stringify({desktopRecoveryPrepared:true,snapshot:result.snapshot?.path}));
    }
    updateSettings({onboardingComplete:true,basicsTutorialVersion:1,firstVaultVersion:1,tourComplete:true,advancedTourComplete:true});
  }
  context.h('settings:get', () => getSettings()); context.h('settings:update', (_event, patch) => updateSettings(patch));
  const relayFixture = path.join(lab, 'acceptance-relay-configuration.json');
  if (fs.existsSync(relayFixture)) {
    const configuration = JSON.parse(fs.readFileSync(relayFixture, 'utf8'));
    const origin = new URL(configuration.url);
    if (origin.protocol !== 'https:' || !configuration.id || !configuration.hostToken || !configuration.clientToken || Date.parse(configuration.expiresAt) <= Date.now()) throw new Error('Invalid isolated relay fixture');
    const folder = path.join(lab, 'desktop-bridge'); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'relay.bin'), safeStorage.encryptString(JSON.stringify(configuration)), { mode: 0o600 });
  }
  const bridge = await import('../electron/desktopBridge/server');
  const renew = async () => {
    const offer = await bridge.createDesktopBridgeOffer(listVaults().map(vault => vault.id), ['corpus', 'writing', 'research-generation', 'testimonies', 'primary-source-files', 'prosopography-private', 'teaching-roster', 'teaching-grades', 'study-recordings']);
    fs.writeFileSync(path.join(lab, 'mobile-pairing-offer.json'), JSON.stringify(offer), { mode: 0o600 });
  };
  await renew();
  process.on('SIGUSR1', () => void renew().catch(console.error));
  // Acceptance evidence reads the same public metadata as Desktop's connected-device UI.
  process.on('SIGUSR2', () => {
    fs.writeFileSync(path.join(lab, 'mobile-bridge-status.json'), JSON.stringify(bridge.desktopBridgeStatus()), { mode: 0o600 });
  });
  console.log(JSON.stringify({ ready: true, pid: process.pid, transport: 'production HTTPS and encrypted relay', laboratory: lab, sourceDigest: build.sourceDigest, bundleSha256: build.bundleSha256 }));
  process.on('SIGTERM', () => void bridge.stopDesktopBridge().finally(() => app.quit()));
}).catch(error => { console.error(error); app.exit(1); });
