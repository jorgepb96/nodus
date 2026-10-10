import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getDb, withVaultDatabase } from '../electron/db/database';
import { listVaults, withOwningVault } from '../electron/vaults/vaultRegistry';
import { createDictionaryEntry, getDictionaryEntry, getDictionaryEntryDetail, saveDictionaryVersion, upsertDictionaryEvidence } from '../electron/db/dictionaryRepo';
import { LibraryDiskStore } from '../electron/library/libraryStorage';
import { rebuildGlobalLibrary } from '../electron/library/libraryService';

/** Explicit, preanalysed acceptance evidence. Never extracts, indexes or calls AI. */
export async function ensureAcceptanceSourceCitationFixtures(lab: string): Promise<void> {
  if (!fs.existsSync(path.join(lab, '.nodus-mobile-acceptance-lab'))) throw new Error('Isolated marker required');
  const vaults = listVaults();
  if (!vaults.every(vault => path.resolve(vault.path).startsWith(path.resolve(lab) + path.sep))) throw new Error('All source fixtures must be isolated');
  const vault = vaults.find(vault => vault.name === 'Principal');
  if (!vault) throw new Error('Principal laboratory copy required');
  const marker = path.join(lab, 'source-citation-fixtures.json');
  if (fs.existsSync(marker)) {
    const saved = JSON.parse(fs.readFileSync(marker, 'utf8'));
    await withOwningVault(vault.id, () => withVaultDatabase(vault.id, () => {
      if (saved.formatVersion !== 1 || !getDictionaryEntry(saved.entryId)) throw new Error('Source citation fixture is incomplete');
    }));
    return;
  }
  const store = new LibraryDiskStore(path.join(lab, 'acceptance-backups/nodus-library'), 'acceptance-library-device');
  const record = store.readMaterializedItem('acceptance-report');
  if (!record || record.id !== 'nodus:acceptance-report') throw new Error('Matching actual report original required');
  const folder = store.itemFolder(record.storageId);
  const original = fs.readFileSync(path.join(folder, 'original.pdf'));
  if (original.subarray(0, 5).toString() !== '%PDF-') throw new Error('Actual PDF required');
  const supplement = Buffer.from('Adjunto ficticio del laboratorio de citas. No pertenece al contenido del informe.\n');
  fs.writeFileSync(path.join(folder, 'acceptance-supplement.txt'), supplement, {mode:0o600});
  const attachmentId = 'acceptance:supplement/one';
  store.upsertItem({...record, attachments:[...record.attachments.filter(item => item.id !== attachmentId), {
    id:attachmentId, title:'Adjunto de aceptación', fileName:'acceptance-supplement.txt', relativePath:'acceptance-supplement.txt',
    mimeType:'text/plain', role:'supplement', position:record.attachments.length, byteSize:supplement.length,
    sha256:createHash('sha256').update(supplement).digest('hex'),
  }]}, record.clock.revision);
  rebuildGlobalLibrary();
  const name = 'Aceptación fuente documental 0.1.0';
  const evidenceLabel = 'Página dos de la fuente de aceptación';
  // This literal quote was checked against page two of the real isolated PDF.
  const text = 'Investiga por qué la fotografía de viaje europea y norteamericana del periodo evitó sistemáticamente los emblemas de modernidad urbana';
  const passageId = 'acceptance-source-page-two';
  const revision = createHash('sha256').update(text).digest('hex');
  const fixture = await withOwningVault(vault.id, () => withVaultDatabase(vault.id, () => {
    const db = getDb();
    return db.transaction(() => {
      db.prepare('INSERT INTO works(nodus_id,title,authors_json,item_type,source_type,deep_hash) VALUES(?,?,?,?,?,?)')
        .run(record.id, record.metadata.title, '[]', 'report', 'manual', revision);
      db.prepare(`INSERT INTO passages(passage_id,nodus_id,chunk_index,text,page_label,page_number,char_len,content_hash,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(passageId, record.id, 0, text, 'p. 2', 2, text.length, revision, new Date().toISOString());
      const entry = createDictionaryEntry({name, aliases:[], focusPrompt:'Fixture ficticio para verificar la apertura de una fuente en su página exacta.',
        scope:{kind:'works',workIds:[record.id]}, outputLanguage:'es', detailLevel:'standard', tags:['mobile-acceptance']});
      upsertDictionaryEvidence(entry.id, [{kind:'passage', refId:passageId, decision:'included', score:1, reason:'Cita literal preparada para la aceptación',
        label:evidenceLabel, text, workId:record.id, workTitle:record.metadata.title, zoteroKey:null,
        works:[{id:record.id,title:record.metadata.title,zoteroKey:null,authors:[],year:null}], pageLabel:'p. 2', authors:[], tags:['mobile-acceptance'], sourceRevision:revision, isNew:false}]);
      const version = saveDictionaryVersion({entryId:entry.id, contentMarkdown:'# Fuente documental de aceptación\n\nEsta entrada ficticia comprueba el acceso al original del informe guardado.',
        evidence:[{kind:'passage',id:passageId}], citations:[], authorSummaries:[], model:null, trigger:'manual_edit', state:'applied',
        outcome:'synthesis', degradationReason:null, generationAttempts:1, generationProblems:[], insufficientEvidence:false});
      const detail = getDictionaryEntryDetail(entry.id);
      if (!detail || detail.entry.evidenceCount !== 1) throw new Error('Source dictionary fixture missing evidence');
      return {entryId:entry.id, versionId:version.id};
    })();
  }));
  fs.writeFileSync(marker, JSON.stringify({formatVersion:1, fixtureKind:'explicit fictional preanalysed evidence attached to an actual isolated saved report PDF',
    vaultId:vault.id, ...fixture, name, evidenceLabel, passageId, documentId:record.id, attachmentId, page:2,
    originalSha256:createHash('sha256').update(original).digest('hex'), providerCalls:0, extractionOrIndexingStarted:false}), {mode:0o600});
}
