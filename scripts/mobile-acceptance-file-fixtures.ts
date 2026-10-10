import fs from 'node:fs';
import path from 'node:path';
import { getDb, withVaultDatabase } from '../electron/db/database';
import { listVaults, withOwningVault } from '../electron/vaults/vaultRegistry';
import { importStudyMaterialFile, replaceStudyMaterialFile } from '../electron/db/studyMaterialsRepo';
import { createStudyRecording } from '../electron/db/studyRecordingsRepo';
import { importMedia } from '../electron/db/testimonyMediaRepo';
import { createArchiveFile, listArchiveFiles } from '../electron/db/archiveFilesRepo';
import { createItem, getItem } from '../electron/db/archiveRepo';
import { BRIDGE_FILE_KINDS } from '../electron/desktopBridge/files';

export async function ensureAcceptanceFileFixtures(lab: string): Promise<void> {
  if (!fs.existsSync(path.join(lab, '.nodus-mobile-acceptance-lab'))) throw new Error('Isolated marker required');
  const marker = path.join(lab, 'private-file-fixtures.json');
  if (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf8')).formatVersion === 2) return;
  const vaults = listVaults();
  if (!vaults.every(vault => path.resolve(vault.path).startsWith(path.resolve(lab) + path.sep))) throw new Error('All file fixtures must be isolated');
  const study = vaults.find(vault => vault.type === 'estudio')!, testimony = vaults.find(vault => vault.type === 'testimonios')!, archive = vaults.find(vault => vault.type === 'primary_sources')!;
  if (!study || !testimony || !archive) throw new Error('File acceptance needs all three domain vaults');
  const samples = 32_000, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16_000, 24); wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let n = 0; n < samples; n++) wav.writeInt16LE(Math.round(3000 * Math.sin(n * 2 * Math.PI * 440 / 16_000)), 44 + n * 2);
  const textFile = path.join(lab, 'Aceptación consulta de archivos.md');
  fs.writeFileSync(textFile, '# Consulta de archivos 0.1.0\n\nDocumento del laboratorio aislado para comprobar descarga, integridad y lectura móvil.\n', {mode:0o600});
  const own = <T>(id: string, callback: () => T) => withOwningVault(id, () => withVaultDatabase(id, callback));
  await own(study.id, async () => {
    const imported = await importStudyMaterialFile(textFile);
    await replaceStudyMaterialFile(imported.material.id, textFile);
    createStudyRecording({ title: 'Aceptación audio privado 0.1.0', fileName: 'acceptance-private-audio.wav', mimeType: 'audio/wav', bytes: wav, durationSeconds: 2 });
  });
  await own(testimony.id, () => {
    const session = getDb().prepare('SELECT id FROM testimony_sessions LIMIT 1').get() as { id: string };
    if (!session) throw new Error('Actual testimony session required');
    importMedia({ sessionId: session.id, fileName: 'acceptance-private-audio.wav', mimeType: 'audio/wav', bytes: wav, durationSeconds: 2 });
  });
  await own(archive.id, () => {
    const existing = getDb().prepare('SELECT item_id FROM archive_items WHERE title=?').get('Aceptación archivo original 0.1.0') as {item_id:string} | undefined;
    const item = (existing && getItem(existing.item_id)) || createItem({ title: 'Aceptación archivo original 0.1.0', kind: 'text', fileName: 'acceptance-original.md', mimeType: 'text/markdown', blob: fs.readFileSync(textFile) });
    if (!listArchiveFiles(item.itemId).some(file => file.originalFileName === 'acceptance-original.md')) createArchiveFile({ itemId: item.itemId, role: 'master', originalFileName: 'acceptance-original.md', mimeType: 'text/markdown', content: fs.readFileSync(textFile) });
  });
  const records = [];
  for (const [kind, spec] of Object.entries(BRIDGE_FILE_KINDS)) {
    const vault = kind.startsWith('study') ? study : kind === 'testimonyMedia' ? testimony : archive;
    const deleted = 'deleted' in spec ? ` AND ${spec.deleted} IS NULL` : '';
    const row = await own(vault.id, () => getDb().prepare(`SELECT ${spec.id} AS id FROM ${spec.table} WHERE ${spec.blob} IS NOT NULL${deleted} LIMIT 1`).get()) as {id:string} | undefined;
    if (!row) throw new Error(`Missing executable file fixture: ${kind}`);
    records.push({kind, id:row.id, vaultId:vault.id, domain:spec.domain});
  }
  fs.writeFileSync(marker, JSON.stringify({formatVersion:2, records, note:'Explicit active isolated fixtures; audio includes a two second 440Hz test tone.'}), {mode:0o600});
}
