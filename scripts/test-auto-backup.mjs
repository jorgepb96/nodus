// Automatic encrypted backups: drives the REAL autoBackup + exportImport +
// backupCrypto modules against a scratch DB and proves the contract — one
// master password for every backup, full-state archives, atomic writes,
// GFS retention scoped per machine, and the due-scheduling logic. Runs under
// Electron-as-Node so better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomFillSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, rm, writeFile, readdir, mkdir } from 'node:fs/promises';
import Module, { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.argv.includes('--electron-auto-backup-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-auto-backup.mjs'), '--electron-auto-backup-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

process.env.NODE_PATH = [path.join(repoRoot, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();
const require = createRequire(import.meta.url);
const zlib = require('node:zlib');
const nodeCrypto = require('node:crypto');
const meter = { deflateSync: 0, deflateStream: 0, scryptSync: 0, scryptAsync: 0 };
const originalPrimitives = {
  deflateRawSync: zlib.deflateRawSync,
  createDeflateRaw: zlib.createDeflateRaw,
  DeflateRaw: zlib.DeflateRaw,
  scryptSync: nodeCrypto.scryptSync,
  scrypt: nodeCrypto.scrypt,
};
// Install before bundling production modules: ZIP/crypto libraries capture these
// references at module evaluation time. node:zlib exports require defineProperty.
const swapPrimitive = (host, name, value) => Object.defineProperty(host, name, { value, configurable: true, writable: true });
swapPrimitive(zlib, 'deflateRawSync', (...a) => { meter.deflateSync += 1; return originalPrimitives.deflateRawSync(...a); });
swapPrimitive(zlib, 'createDeflateRaw', (...a) => { meter.deflateStream += 1; return originalPrimitives.createDeflateRaw(...a); });
swapPrimitive(zlib, 'DeflateRaw', class MeteredDeflateRaw extends originalPrimitives.DeflateRaw {
  constructor(...args) { super(...args); meter.deflateStream += 1; }
});
swapPrimitive(nodeCrypto, 'scryptSync', (...a) => { meter.scryptSync += 1; return originalPrimitives.scryptSync(...a); });
swapPrimitive(nodeCrypto, 'scrypt', (...a) => { meter.scryptAsync += 1; return originalPrimitives.scrypt(...a); });

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-auto-backup-'));
process.env.NODUS_TEST_USERDATA = root; // stub-electron app.getPath → temp files land here
try {
  const Database = require('better-sqlite3');
  const db = new Database(path.join(root, 'nodus.sqlite'));
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE works (nodus_id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE ideas (global_id TEXT PRIMARY KEY, label TEXT, embedding BLOB);
    CREATE TABLE passages (passage_id TEXT PRIMARY KEY, text TEXT, embedding BLOB);
    CREATE TABLE work_summaries (nodus_id TEXT PRIMARY KEY, summary TEXT, embedding BLOB);
  `);
  db.prepare("INSERT INTO works VALUES ('w1', 'Obra uno')").run();
  db.prepare("INSERT INTO ideas VALUES ('g-0001', 'Idea', ?)").run(Buffer.from(new Float32Array([1, 0]).buffer));
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
    'app',
    JSON.stringify({ zoteroUserId: '42', mcpEnabled: true, mcpToken: 'SECRET-TOKEN', autoBackupIntervalHours: 24 })
  );

  const bundle = await bundleModules();
  globalThis.__backupTestDb = db;
  globalThis.__backupTestPassword = 'mi-frase-maestra';
  globalThis.__backupTestRecoveryKey = null;
  const { autoBackup, exportImport, crypto, settingsRepo } = require(bundle);
  const AdmZip = require('adm-zip');

  // ── Pure scheduling + naming logic ──────────────────────────────────────────
  assert.equal(autoBackup.isBackupDue(null, 24), true, 'never backed up → due');
  assert.equal(autoBackup.isBackupDue(new Date(Date.now() - 2 * 3600e3).toISOString(), 24), false, '2h ago on 24h cadence → not due');
  assert.equal(autoBackup.isBackupDue(new Date(Date.now() - 25 * 3600e3).toISOString(), 24), true, '25h ago → due');
  assert.equal(autoBackup.isBackupDue('garbage-date', 24), true, 'unparseable timestamp → fail open (due)');

  // ── Schedule by day(s)-of-week + time, with startup catch-up semantics ──────
  const now = new Date(2026, 6, 10, 10, 0, 0); // fixed reference: 10:00 local
  const at = (dayOffset, h, m = 0) => new Date(2026, 6, 10 + dayOffset, h, m, 0).toISOString();
  // Daily schedule at 03:00.
  assert.equal(autoBackup.isScheduledBackupDue(null, [], 3, 0, now), true, 'never backed up → due');
  assert.equal(autoBackup.isScheduledBackupDue(at(0, 9), [], 3, 0, now), false, 'already backed up after today’s 03:00 slot → not due');
  assert.equal(autoBackup.isScheduledBackupDue(at(-1, 9), [], 3, 0, now), true, 'last backup yesterday → today’s slot passed → due');
  // Startup catch-up: machine was off for a week, daily schedule → due on next launch.
  assert.equal(autoBackup.isScheduledBackupDue(at(-8, 9), [], 3, 0, now), true, 'missed slots while off → due at next start');
  // Weekly on today's weekday → today's slot applies like the daily case.
  const today = now.getDay();
  const tomorrow = (today + 1) % 7;
  assert.equal(autoBackup.isScheduledBackupDue(at(-1, 9), [today], 3, 0, now), true, 'scheduled weekday, last backup yesterday → due');
  assert.equal(autoBackup.isScheduledBackupDue(at(-1, 9), [tomorrow], 3, 0, now), false, 'not a scheduled weekday today → last slot was days ago, already covered');
  // A slot exactly now counts as passed.
  assert.equal(autoBackup.isScheduledBackupDue(at(-1, 9), [], 10, 0, now), true, 'slot at exactly now has passed');

  assert.equal(autoBackup.retentionCutoff(1, 'days', now).getDate(), 9, 'day retention uses calendar subtraction');
  assert.equal(autoBackup.retentionCutoff(2, 'weeks', now).getDate(), 26, 'week retention uses seven-day units');
  assert.equal(autoBackup.retentionCutoff(1, 'months', now).getMonth(), 5, 'month retention uses calendar months');
  assert.equal(autoBackup.retentionCutoff(1, 'years', now).getFullYear(), 2025, 'year retention uses calendar years');
  assert.equal(
    autoBackup.retentionCutoff(1, 'months', new Date(2026, 2, 31, 10)).getDate(),
    28,
    'month retention clamps to the target month instead of rolling into March',
  );
  assert.equal(
    autoBackup.retentionCutoff(1, 'years', new Date(2024, 1, 29, 10)).getDate(),
    28,
    'year retention clamps leap day to February 28',
  );
  assert.equal(autoBackup.retentionCutoff(0, 'days', now), null, 'zero retention is rejected');
  assert.equal(autoBackup.retentionCutoff(-1, 'days', now), null, 'negative retention is rejected');
  assert.equal(autoBackup.retentionCutoff(11, 'years', now), null, 'unsafe out-of-range retention is rejected');

  assert.equal(autoBackup.sanitizeHostname('MacBook-Pro-de-Jorge.local'), 'macbook-pro-de-jorge');
  const name = autoBackup.backupFileName('MacBook-Pro-de-Jorge.local', new Date(2026, 6, 10, 9, 30, 5));
  assert.equal(name, 'nodus-backup-macbook-pro-de-jorge-20260710-093005.nodus');
  const versionedName = autoBackup.backupFileName('MacBook-Pro-de-Jorge.local', new Date(2026, 6, 10, 9, 30, 5), '3.4.0-beta.2', 122);
  assert.equal(versionedName, 'nodus-backup-macbook-pro-de-jorge-v3.4.0-beta.2-schema122-20260710-093005.nodus');
  assert.equal(
    autoBackup.parseBackupFile('MacBook-Pro-de-Jorge.local', 'nodus-backup-macbook-pro-de-jorge-v3.4.0-schema122-20260231-093005.nodus'),
    null,
    'impossible dates are never normalized into cleanup candidates',
  );
  const preUpdateName = autoBackup.preUpdateBackupFileName(
    'MacBook-Pro-de-Jorge.local',
    new Date(2026, 6, 10, 9, 30, 5),
    '3.3.0',
    '3.4.0-beta.2',
    122,
  );
  assert.equal(preUpdateName, 'nodus-pre-update-macbook-pro-de-jorge-from-v3.3.0-to-v3.4.0-beta.2-schema122-20260710-093005.nodus');

  // ── GFS retention, scoped to this machine's lineage ────────────────────────
  const mk = (host, y, m, d, hh = 3) => autoBackup.backupFileName(host, new Date(y, m - 1, d, hh, 0, 0));
  const mine = [];
  for (let day = 1; day <= 20; day++) mine.push(mk('mac-a', 2026, 7, day)); // 20 daily backups
  mine.push(mk('mac-a', 2026, 6, 15), mk('mac-a', 2026, 5, 20), mk('mac-a', 2026, 4, 25)); // older months
  const theirs = [mk('mac-b', 2026, 7, 1), mk('mac-b', 2026, 7, 2)];
  const doomed = autoBackup.selectBackupsToPrune('mac-a', [...mine, ...theirs, 'unrelated.txt']);

  assert.ok(!doomed.some((f) => f.includes('mac-b')), 'other machines’ lineages untouched');
  assert.ok(!doomed.includes('unrelated.txt'), 'non-backup files untouched');
  for (let day = 14; day <= 20; day++) assert.ok(!doomed.includes(mk('mac-a', 2026, 7, day)), `newest 7 dailies kept (day ${day})`);
  assert.ok(!doomed.includes(mk('mac-a', 2026, 6, 15)), 'monthly grandfather kept (June)');
  assert.ok(!doomed.includes(mk('mac-a', 2026, 5, 20)), 'monthly grandfather kept (May)');
  assert.ok(doomed.includes(mk('mac-a', 2026, 7, 3)), 'mid-month surplus pruned');
  assert.ok(doomed.length >= 8, `a real chunk of surplus goes (${doomed.length} pruned)`);
  const versionedLineage = Array.from({ length: 9 }, (_, index) => autoBackup.backupFileName(
    'mac-versioned',
    new Date(2026, 6, 1 + index, 3, 0, 0),
    index < 5 ? '3.3.0' : '3.4.0-beta.2',
    122,
  ));
  assert.ok(
    autoBackup.selectBackupsToPrune('mac-versioned', versionedLineage).includes(versionedLineage[0]),
    'GFS retention recognizes newly version-tagged names',
  );

  const preUpdateFiles = Array.from({ length: 7 }, (_, index) => autoBackup.preUpdateBackupFileName(
    'mac-a',
    new Date(2026, 6, 10 + index, 3, 0, 0),
    '3.3.0',
    `3.4.0-beta.${index + 1}`,
    122,
  ));
  const preUpdateDoomed = autoBackup.selectPreUpdateBackupsToPrune('mac-a', [
    ...preUpdateFiles,
    autoBackup.preUpdateBackupFileName('mac-b', new Date(2026, 6, 1), '3.3.0', '3.4.0-beta.1', 122),
    ...mine,
  ]);
  assert.deepEqual(preUpdateDoomed.sort(), preUpdateFiles.slice(0, 2).sort(), 'pre-update retention keeps five and ignores normal/other-host files');
  assert.ok(!autoBackup.selectBackupsToPrune('mac-a', [...mine, ...preUpdateFiles]).some((file) => file.startsWith('nodus-pre-update-')), 'scheduled retention never prunes pre-update snapshots');

  // ── Real v6 full backup: recovery key, secrets, atomic write ────────────────
  const backupDir = path.join(root, 'backups');
  await mkdir(backupDir, { recursive: true });
  settingsRepo.updateSettings({
    autoBackupFolder: backupDir,
    // Simulate stale granular preferences from an older release. They must not
    // be able to reduce a new backup under the full-state invariant.
    backupVaultIds: ['does-not-exist'],
    backupIncludePreferences: false,
    backupIncludeHistories: false,
    backupIncludeGeneratedMedia: false,
    backupIncludeApiKeys: false,
  });

  const result = await autoBackup.runAutoBackupNow('9.9.9-test');
  assert.equal(result.ok, true, `backup runs: ${result.message}`);
  const written = (await readdir(backupDir)).filter((f) => f.endsWith('.nodus'));
  assert.equal(written.length, 1, 'exactly one archive, no .tmp leftovers');
  assert.match(written[0], /^nodus-backup-.+-v9\.9\.9-test-schema\d+-\d{8}-\d{6}\.nodus$/, 'new backups expose app/schema versions in the filename');

  const unchangedPath = path.join(root, 'unchanged.nodus');
  const unchanged = await exportImport.createBackupArchiveFile({ password: 'mi-frase-maestra', appVersion: 'x' }, unchangedPath);
  assert.equal(unchanged.reusedVaults, 1, 'an unchanged vault reuses its verified cached snapshot instead of running VACUUM INTO');
  db.prepare("INSERT INTO works VALUES ('w2', 'Cambio posterior')").run();
  const changedPath = path.join(root, 'changed.nodus');
  const changed = await exportImport.createBackupArchiveFile({ password: 'mi-frase-maestra', appVersion: 'x' }, changedPath);
  assert.equal(changed.reusedVaults, 0, 'a content write invalidates the cached vault snapshot');

  const zip = new AdmZip(path.join(backupDir, written[0]));
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  assert.equal(manifest.format, 'nodus.encrypted-backup');
  assert.equal(manifest.formatVersion, 6, 'automatic backups are v6 (password + independent recovery key)');
  assert.equal(manifest.includesSecrets, false);
  assert.equal(manifest.appVersion, '9.9.9-test');
  assert.ok(manifest.vaultCount >= 1, 'at least one vault backed up');

  assert.ok(zip.getEntry('recovery-key.bin'), 'password-wrapped recovery key is present');
  const recoveredKey = crypto.decryptBackupPayload(
    zip.getEntry('recovery-key.bin').getData(),
    'mi-frase-maestra',
    manifest.recovery.wrappedKeyCipher
  ).toString('utf8');
  assert.equal(recoveredKey, globalThis.__backupTestRecoveryKey, 'master password unwraps the stable recovery key');
  const payload = new AdmZip(crypto.decryptBackupPayload(zip.getEntry('backup.bin').getData(), recoveredKey, manifest.cipher));
  const names = payload.getEntries().map((e) => e.entryName).sort();
  assert.ok(!names.includes('api-keys.json'), 'new backups never serialize API keys, even inside the encrypted payload');
  assert.ok(names.includes('registry.json'), 'the vault registry is included');
  const dbEntryName = names.find((n) => /^vaults\/.+\/database\.sqlite$/.test(n));
  const invEntryName = names.find((n) => /^vaults\/.+\/inventory\.json$/.test(n));
  assert.ok(dbEntryName && invEntryName, 'each vault carries its DB snapshot + inventory');
  const registry = JSON.parse(payload.readAsText('registry.json'));
  assert.ok(Array.isArray(registry.vaults) && registry.vaults.length >= 1, 'registry lists the vaults');
  const payloadManifest = JSON.parse(payload.readAsText('payload-manifest.json'));
  assert.deepEqual(payloadManifest.selection, {
    vaultIds: [],
    includePreferences: true,
    includeHistories: true,
    includeGeneratedMedia: true,
    includeApiKeys: false,
  }, 'stale granular settings cannot reduce data coverage or re-enable secret export');

  // The DB snapshot inside is a valid SQLite file with the scrubbed settings row.
  const snapshotFile = path.join(root, 'snapshot-check.sqlite');
  await writeFile(snapshotFile, payload.getEntry(dbEntryName).getData());
  const snap = new Database(snapshotFile, { readonly: true });
  const snapSettings = JSON.parse(snap.prepare("SELECT value FROM settings WHERE key = 'app'").get().value);
  assert.equal(snapSettings.mcpToken, undefined, 'token scrubbed inside the DB snapshot too');
  assert.equal(snap.prepare('SELECT COUNT(*) AS n FROM ideas').get().n, 1, 'graph data present in snapshot');
  snap.close();

  assert.throws(
    () => crypto.decryptBackupPayload(zip.getEntry('recovery-key.bin').getData(), 'contraseña-equivocada', manifest.recovery.wrappedKeyCipher),
    'wrong master password refuses to unwrap the recovery key'
  );
  assert.doesNotThrow(() => crypto.decryptBackupPayload(zip.getEntry('backup.bin').getData(), recoveredKey, manifest.cipher), 'recovery key independently decrypts the payload');

  // Status + timestamp persisted for the UI and the scheduler.
  const appSettings = settingsRepo.getSettings();
  assert.ok(appSettings.lastAutoBackupAt, 'lastAutoBackupAt recorded');
  assert.ok(String(appSettings.lastAutoBackupStatus).startsWith('ok:'), 'status recorded');

  const preUpdate = await autoBackup.runPreUpdateBackupNow('9.9.9-test', '10.0.0-beta.1');
  assert.equal(preUpdate.ok, true, `pre-update backup runs: ${preUpdate.message}`);
  assert.match(path.basename(preUpdate.path), /^nodus-pre-update-.+-from-v9\.9\.9-test-to-v10\.0\.0-beta\.1-schema\d+-\d{8}-\d{6}\.nodus$/);
  assert.ok(existsSync(preUpdate.path), 'verified pre-update snapshot is retained separately');

  // A blob the keychain can no longer decrypt must NOT cost the user their library
  // snapshot. The backup runs, the library is protected, and the unreadable providers
  // are named in the status so the omission is visible rather than silent. Restoring is
  // merge-only, so a key missing from the archive never erases the local one.
  globalThis.__backupTestLocked = ['openai'];
  const lockedRun = await autoBackup.runAutoBackupNow('9.9.9-test');
  assert.equal(lockedRun.ok, true, 'locked API keys no longer block the library backup');
  assert.match(lockedRun.message, /Aviso: las claves de openai no se pudieron leer/);
  globalThis.__backupTestLocked = [];

  // ── maybeRunAutoBackup gating ───────────────────────────────────────────────
  assert.equal(await autoBackup.maybeRunAutoBackup('9.9.9-test'), null, 'disabled → no run');
  settingsRepo.updateSettings({ autoBackupEnabled: true });
  assert.equal(await autoBackup.maybeRunAutoBackup('9.9.9-test'), null, 'enabled but fresh → no run');
  settingsRepo.updateSettings({ lastAutoBackupAt: new Date(Date.now() - 48 * 3600e3).toISOString() });
  const scheduled = await autoBackup.maybeRunAutoBackup('9.9.9-test');
  assert.equal(scheduled?.ok, true, 'overdue → scheduler runs a backup');

  // An unreadable master password must be REPORTED, not silently skipped: otherwise
  // lastAutoBackupStatus stays frozen on the last success and the UI keeps claiming the
  // user is protected while nothing is being written.
  globalThis.__backupTestPassword = null;
  const unreadable = await autoBackup.maybeRunAutoBackup('9.9.9-test');
  assert.equal(unreadable?.ok, false, 'unreadable master password reports a failure');
  assert.match(String(settingsRepo.getSettings().lastAutoBackupStatus), /^error:/, 'the failure reaches the UI status');
  globalThis.__backupTestPassword = 'mi-frase-maestra';

  // ── Guarded age cleanup: preview, quarantine, catch-up and delayed purge ────
  const cleanupNow = new Date();
  const currentHost = os.hostname();
  const currentRegularName = (await readdir(backupDir)).find((file) => file.startsWith(`nodus-backup-${autoBackup.sanitizeHostname(currentHost)}-`));
  assert.ok(currentRegularName, 'a verified regular backup exists before cleanup');
  const currentRegularPath = path.join(backupDir, currentRegularName);
  const oldNames = [];
  for (let index = 0; index < 5; index += 1) {
    const oldDate = new Date(cleanupNow.getTime() - (40 + index) * 24 * 3600e3);
    const oldName = autoBackup.backupFileName(currentHost, oldDate, '9.9.9-test', 28);
    await copyFile(currentRegularPath, path.join(backupDir, oldName));
    oldNames.push(oldName);
  }
  const otherHostName = autoBackup.backupFileName('another-machine', new Date(cleanupNow.getTime() - 400 * 24 * 3600e3), '9.9.9-test', 28);
  await copyFile(currentRegularPath, path.join(backupDir, otherHostName));
  await writeFile(path.join(backupDir, 'unrelated-old-file.nodus'), 'not a Nodus backup');

  settingsRepo.updateSettings({
    backupCleanupEnabled: true,
    backupRetentionValue: 30,
    backupRetentionUnit: 'days',
    lastBackupCleanupAt: null,
    lastBackupCleanupStatus: null,
  });
  const cleanupPreview = await autoBackup.previewBackupCleanup(cleanupNow);
  assert.equal(cleanupPreview.ok, true, cleanupPreview.message);
  assert.equal(cleanupPreview.protectedCount, 3, 'the three newest regular backups are unconditionally protected');
  assert.equal(cleanupPreview.candidateCount, 3, 'only old files beyond the protected floor are candidates');
  assert.ok(cleanupPreview.candidateBytes > 0, 'preview reports bytes before any mutation');
  assert.equal(cleanupPreview.purgeReadyCount, 0, 'nothing can be permanently deleted on the first pass');
  assert.match(cleanupPreview.scopeToken, /^[a-f0-9]{64}$/, 'preview seals the exact filesystem scope');

  const appearedAfterPreview = autoBackup.backupFileName(
    currentHost,
    new Date(cleanupNow.getTime() - 100 * 24 * 3600e3),
    '9.9.9-test',
    28,
  );
  await copyFile(currentRegularPath, path.join(backupDir, appearedAfterPreview));
  const staleScope = await autoBackup.runBackupCleanupNow(cleanupNow, cleanupPreview.scopeToken);
  assert.equal(staleScope.ok, false, 'a changed folder invalidates the reviewed scope');
  assert.match(staleScope.message, /cambió desde la vista previa/);
  assert.equal(existsSync(path.join(backupDir, '.nodus-cleanup-trash')), false, 'a stale confirmation moves and deletes nothing');
  await rm(path.join(backupDir, appearedAfterPreview));

  const refreshedPreview = await autoBackup.previewBackupCleanup(cleanupNow);
  const cleaned = await autoBackup.runBackupCleanupNow(cleanupNow, refreshedPreview.scopeToken);
  assert.equal(cleaned.ok, true, cleaned.message);
  assert.equal(cleaned.quarantinedCount, 3, 'eligible files move to quarantine first');
  assert.equal(cleaned.purgedCount, 0, 'nothing is permanently deleted on its first cleanup pass');
  assert.ok(existsSync(cleaned.trashPath), 'the safety trash is a real, inspectable directory');
  assert.equal((await readdir(cleaned.trashPath)).length, 3, 'all selected files remain recoverable in safety trash');
  assert.ok(existsSync(path.join(backupDir, otherHostName)), 'another computer’s backup is never touched');
  assert.ok(existsSync(preUpdate.path), 'pre-update snapshots are never touched by age cleanup');
  assert.ok(existsSync(path.join(backupDir, 'unrelated-old-file.nodus')), 'unrecognized files are never touched');

  assert.equal(await autoBackup.maybeRunBackupCleanup(cleanupNow), null, 'a completed cleanup is not repeated before the next scheduled slot');
  settingsRepo.updateSettings({ lastBackupCleanupAt: new Date(cleanupNow.getTime() - 10 * 24 * 3600e3).toISOString() });
  const caughtUpCleanup = await autoBackup.maybeRunBackupCleanup(cleanupNow);
  assert.equal(caughtUpCleanup?.ok, true, 'a missed cleanup slot catches up when Nodus next runs');

  const afterGrace = await autoBackup.runBackupCleanupNow(new Date(cleanupNow.getTime() + 8 * 24 * 3600e3));
  assert.equal(afterGrace.ok, true, afterGrace.message);
  assert.equal(afterGrace.purgeReadyCount, 3, 'the run discloses the exact permanent-deletion scope before applying it');
  assert.ok(afterGrace.purgeReadyBytes > 0, 'the permanent-deletion scope includes its byte size');
  assert.equal(afterGrace.purgedCount, 3, 'quarantined files are purged only after the seven-day grace period');
  assert.equal((await readdir(cleaned.trashPath)).length, 0, 'purged quarantine is empty');

  // A corrupt newest survivor must stop the whole operation before even one candidate
  // moves. This is the fail-closed invariant that protects an old but usable lineage.
  const corruptDir = path.join(root, 'cleanup-corrupt-survivor');
  await mkdir(corruptDir, { recursive: true });
  const corruptNewest = autoBackup.backupFileName(currentHost, cleanupNow, '9.9.9-test', 28);
  await writeFile(path.join(corruptDir, corruptNewest), 'corrupt');
  for (let index = 0; index < 3; index += 1) {
    const oldName = autoBackup.backupFileName(currentHost, new Date(cleanupNow.getTime() - (60 + index) * 24 * 3600e3), '9.9.9-test', 28);
    await copyFile(currentRegularPath, path.join(corruptDir, oldName));
  }
  settingsRepo.updateSettings({ autoBackupFolder: corruptDir, lastBackupCleanupAt: null });
  const refusedCleanup = await autoBackup.runBackupCleanupNow(cleanupNow);
  assert.equal(refusedCleanup.ok, false, 'cleanup refuses a corrupt newest survivor');
  assert.match(refusedCleanup.message, /no superó la verificación|No se pudo verificar/);
  assert.equal((await readdir(corruptDir)).filter((file) => file.startsWith('nodus-backup-')).length, 4, 'verification failure leaves every active backup in place');
  assert.equal(existsSync(path.join(corruptDir, '.nodus-cleanup-trash')), false, 'verification failure creates no trash and moves nothing');
  settingsRepo.updateSettings({ autoBackupFolder: backupDir, backupCleanupEnabled: false });

  // ── Manual exports also provide a second independent recovery credential ───
  const manualRecoveryKey = 'clave-recuperacion-manual-independiente';
  const manual = await exportImport.createBackupArchive({ password: 'clave-manual-larga', recoveryKey: manualRecoveryKey, appVersion: 'x' });
  const manualZip = new AdmZip(manual);
  const manualManifest = JSON.parse(manualZip.readAsText('manifest.json'));
  assert.equal(manualManifest.formatVersion, 6, 'manual export is v6 and supports an independent recovery key');
  assert.equal(manualManifest.includesSecrets, false, 'manual export excludes secrets');
  const manualPayload = new AdmZip(
    crypto.decryptBackupPayload(manualZip.getEntry('backup.bin').getData(), manualRecoveryKey, manualManifest.cipher)
  );
  assert.equal(manualPayload.getEntry('api-keys.json'), null, 'manual export does not carry keys');

  // ── The archive must be built WITHOUT parking the main-process event loop ─────
  // Automatic backups run unattended every 30 minutes on the same single thread
  // that serves every IPC handler, so a synchronous deflate took the whole app
  // with it — including the Nodi overlay, which pings the main process on every
  // mouse hit-test transition and froze mid-animation for the entire pass.
  //
  // Metering which primitive gets used, rather than timing the call, keeps this
  // deterministic under the parallel runner: deflateRawSync and scryptSync burn
  // the event loop, their streaming/callback counterparts run on libuv's
  // threadpool. The probe is a ~32 MB incompressible auxiliary file
  // (nodi-notes.json is read from userData, which the stub points at `root`).
  const filler = Buffer.alloc(32 * 1024 * 1024);
  for (let offset = 0; offset < filler.length; offset += 65536) randomFillSync(filler, offset, 65536);
  await writeFile(path.join(root, 'nodi-notes.json'), filler);

  meter.deflateSync = 0; meter.deflateStream = 0; meter.scryptSync = 0; meter.scryptAsync = 0;
  const archive = await exportImport.createBackupArchive({ password: 'clave-manual-larga', appVersion: 'x' });
  assert.ok(archive.length > 32 * 1024 * 1024, 'the probe payload really made it into the archive');
  const probeOuterZip = new AdmZip(archive);
  assert.equal(
    probeOuterZip.getEntry('backup.bin').header.method,
    0,
    'already-encrypted backup.bin must use ZIP STORE instead of a second deflate pass',
  );
  assert.ok(meter.deflateStream > 0, 'the archive is deflated through zlib’s asynchronous API');
  assert.equal(meter.deflateSync, 0, 'no entry may be deflated with deflateRawSync on the main thread');
  assert.ok(meter.scryptAsync > 0, 'the backup key is derived on libuv’s threadpool');
  assert.equal(meter.scryptSync, 0, 'scryptSync must not run on the main thread while writing a backup');
  assert.equal(
    exportImport.verifyBackupArchive(archive, 'clave-manual-larga').ok,
    true,
    'an archive built off the event loop is still decryptable',
  );

  // ── verifyBackupArchive: the gate that must hold before retention deletes ──────
  // Retention only runs when this returns ok, so a false positive here is what would
  // let Nodus prune the last recoverable snapshot in favour of an unreadable one.
  assert.equal(
    exportImport.verifyBackupArchive(manual, manualRecoveryKey).ok,
    true,
    'a good archive verifies with the recovery key'
  );
  assert.equal(
    exportImport.verifyBackupArchive(manual, 'clave-manual-larga').ok,
    true,
    'a good archive verifies with the master password'
  );
  assert.equal(
    exportImport.verifyBackupArchive(manual, 'una-contraseña-que-no-es').ok,
    false,
    'a wrong credential fails verification'
  );
  assert.equal(exportImport.verifyBackupArchive(manual, '   ').ok, false, 'a blank credential fails verification');

  // Flipping a single ciphertext byte must be caught: GCM authentication and the
  // payload hashes are exactly what a silently corrupted cloud write would break.
  const tamperedZip = new AdmZip(manual);
  const goodCipher = tamperedZip.getEntry('backup.bin').getData();
  const corrupted = Buffer.from(goodCipher);
  corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
  tamperedZip.updateFile('backup.bin', corrupted);
  assert.equal(
    exportImport.verifyBackupArchive(tamperedZip.toBuffer(), manualRecoveryKey).ok,
    false,
    'a single flipped ciphertext byte fails verification'
  );

  // Truncation (a half-synced cloud file) must not read as a valid backup.
  assert.equal(
    exportImport.verifyBackupArchive(manual.subarray(0, Math.floor(manual.length / 2)), manualRecoveryKey).ok,
    false,
    'a truncated archive fails verification'
  );

  // The scheduled path reports verification, so "ok" in the UI means "decryptable".
  const verifiedRun = await autoBackup.runAutoBackupNow('9.9.9-test');
  assert.equal(verifiedRun.ok, true, 'scheduled backup succeeds');
  assert.match(verifiedRun.message, /verificada/, 'success message states the snapshot was verified');

  db.close();
  console.log('auto backup (master password + GFS retention) test passed');
} finally {
  for (const [name, value] of Object.entries(originalPrimitives)) {
    swapPrimitive(name.startsWith('scrypt') ? nodeCrypto : zlib, name, value);
  }
  await rm(root, { recursive: true, force: true });
}

/** Bundle the real modules with database + secretStore stubbed and electron aliased. */
async function bundleModules() {
  const dbStub = path.join(root, 'stub-database.js');
  await writeFile(
    dbStub,
    'export function getDb() { return globalThis.__backupTestDb; }\nexport const SCHEMA_VERSION = 28;\n' +
      'export function closeDb() {}\nexport function replaceDbFile() {}\n' +
      // Armed by the paged similarity scan before each statement; no-op here.
      'export function setVectorScanQuery() {}\nexport function withVaultDatabase(_id, work) { return work(); }\nexport function withoutDatabaseContext(work) { return work(); }\nexport function onBeforeDatabaseClose() {}\n'
  );
  const secretsStub = path.join(root, 'stub-secrets.js');
  await writeFile(
    secretsStub,
    [
      'export function getBackupPassword() { return globalThis.__backupTestPassword ?? null; }',
      'export function hasBackupPassword() { return Boolean(globalThis.__backupTestPassword); }',
      'export function getBackupRecoveryKey() { return globalThis.__backupTestRecoveryKey ?? null; }',
      'export function setBackupRecoveryKey(value) { globalThis.__backupTestRecoveryKey = value; }',
      "export function getApiKey(p) { return p === 'openai' ? 'sk-test' : null; }",
      'export function setApiKey() {}',
      'export function clearApiKey() {}',
      'export function providerKeyMap() { return {}; }',
      'export function lockedApiKeyProviders() { return globalThis.__backupTestLocked ?? []; }',
      "export function getAudioKey(name) { return globalThis.__backupTestAudioKeys?.[name] ?? null; }",
      'export function setAudioKey(name, value) { (globalThis.__backupTestAudioKeys ??= {})[name] = value; }',
      'export function clearAudioKey(name) { delete globalThis.__backupTestAudioKeys?.[name]; }',
    ].join('\n')
  );
  const entry = path.join(root, 'entry.ts');
  await writeFile(
    entry,
    [
      `export * as autoBackup from ${JSON.stringify(path.join(repoRoot, 'electron/export/autoBackup.ts'))};`,
      `export * as exportImport from ${JSON.stringify(path.join(repoRoot, 'electron/export/exportImport.ts'))};`,
      `export * as crypto from ${JSON.stringify(path.join(repoRoot, 'electron/export/backupCrypto.ts'))};`,
      `export * as settingsRepo from ${JSON.stringify(path.join(repoRoot, 'electron/db/settingsRepo.ts'))};`,
    ].join('\n')
  );
  const out = path.join(root, 'bundle.cjs');
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    packages: 'external',
    external: ['better-sqlite3'],
    alias: { '@shared': path.join(repoRoot, 'shared'), electron: path.join(repoRoot, 'scripts/stub-electron.mjs') },
    plugins: [
      {
        name: 'stub-deps',
        setup(api) {
          api.onResolve({ filter: /\/database$|^\.\/database$|\.\.\/db\/database$/ }, () => ({ path: dbStub }));
          api.onResolve({ filter: /secretStore$/ }, () => ({ path: secretsStub }));
        },
      },
    ],
  });
  return out;
}
