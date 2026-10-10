import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createVault, listVaults, withOwningVault } from '../electron/vaults/vaultRegistry';
import { getDb, withVaultDatabase } from '../electron/db/database';
import {createStudyCourse, createStudySubject, createStudyDocument} from '../electron/db/studyOrgRepo';
import {replaceStudySourceKnowledge} from '../electron/db/studyKnowledgeRepo';
import { writeGlobalPrefsRaw } from '../electron/db/appPrefs';
import { seedPrimarySourcesDemoData } from '../electron/db/primarySourcesDemoData';
import { seedTestimonyDemoData } from '../electron/db/testimonyDemoData';
import { seedProsopDemo } from '../electron/db/prosopDemoRepo';
import { LibraryDiskStore } from '../electron/library/libraryStorage';
import { rebuildGlobalLibrary } from '../electron/library/libraryService';
import { getWritingWorkshopDraft, listWritingWorkshopDrafts } from '../electron/db/writingDraftsRepo';
import { renderSavedWritingFiles } from '../electron/export/writingWorkshopExport';

/** Called only after the runner verifies its isolated marker and every vault path. */
export async function ensureAcceptanceFixtures(lab: string): Promise<void> {
  for (const [type, seed] of [
    ['primary_sources', seedPrimarySourcesDemoData], ['testimonios', seedTestimonyDemoData], ['prosopography', seedProsopDemo],
  ] as const) {
    let vault = listVaults().find(vault => vault.type === type);
    if (!vault) vault = createVault(`Acceptance · ${type}`, type);
    await withOwningVault(vault.id, () => withVaultDatabase(vault!.id, seed));
  }
  await ensureStudyGraphFixtures(lab);
  const backup = path.join(lab, 'acceptance-backups');
  writeGlobalPrefsRaw({ autoBackupFolder: backup });
  const root = path.join(backup, 'nodus-library');
  const store = new LibraryDiskStore(root, 'acceptance-library-device'); store.initialize();
  const marker = path.join(lab, '.acceptance-library-fixtures');
  if (fs.existsSync(marker) && JSON.parse(fs.readFileSync(marker, 'utf8')).formatVersion === 2) return;
  const vault = listVaults().find(vault => vault.name === 'Principal')!;
  const saved = await withOwningVault(vault.id, () => withVaultDatabase(vault.id, () => {
    const first = listWritingWorkshopDrafts().find(report => report.brief.kind === 'deep_research');
    if (!first) throw new Error('Real report fixture required'); return getWritingWorkshopDraft(first.id)!;
  }));
  const folder = store.itemFolder('acceptance-report'); fs.mkdirSync(folder, { recursive: true });
  const markdown = `# ${saved.title}\n\n${saved.draft.draftMarkdown}`;
  fs.writeFileSync(path.join(folder, 'reader.md'), markdown, { mode: 0o600 });
  // Both formats must come from the same saved report. Reusing the first previous
  // PDF export could silently pair a document with another report's original.
  const files = await withOwningVault(vault.id, () => withVaultDatabase(vault.id,
    () => renderSavedWritingFiles(saved, 'acceptance-report', 'pdf')));
  if (files.length !== 1 || files[0].bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Matching real PDF export fixture required');
  const bytes = files[0].bytes;
  fs.writeFileSync(path.join(folder, 'original.pdf'), bytes, { mode: 0o600 });
  store.upsertItem({ id: 'nodus:acceptance-report', storageId: 'acceptance-report', source: 'nodus',
    metadata: { title: saved.title, itemType: 'report', creators: [], tags: ['mobile-acceptance'] }, citationKey: null,
    collectionIds: [], extraction: { status: 'ready' },
    files: { reader: 'reader.md', original: 'original.pdf' },
    attachments: [{ id: 'local:original', title: 'Original', fileName: 'original.pdf', relativePath: 'original.pdf', mimeType: 'application/pdf',
      role: 'original', position: 0, byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }],
  });
  const links = [{ itemId: 'nodus:acceptance-report', vaultId: vault.id, vaultName: vault.name, vaultType: vault.type, workId: 'acceptance-library-work',
    analysis: { lightStatus: 'done', deepStatus: 'done', summaryStatus: 'done', ideaCount: 0, passageCount: 0, evidenceCount: 0, gapCount: 0, hasSummary: false, hasNotes: false, archived: false } }];
  const linksFile = path.join(root, '.nodus/vault-links.json');
  fs.mkdirSync(path.dirname(linksFile), { recursive: true });
  fs.writeFileSync(linksFile, JSON.stringify({ format: 'nodus.library-vault-links', formatVersion: 1, updatedAt: new Date().toISOString(), links }), { mode: 0o600 });
  rebuildGlobalLibrary();
  fs.writeFileSync(marker, JSON.stringify({ formatVersion: 2, reportId: saved.id, libraryDocumentId: 'nodus:acceptance-report', originalSha256: createHash('sha256').update(bytes).digest('hex'), source: 'same isolated real report rendered as Markdown and PDF' }), { mode: 0o600 });
}

async function ensureStudyGraphFixtures(lab: string): Promise<void> {
  const marker = path.join(lab, 'study-graph-fixtures.json');
  if (fs.existsSync(marker)) return;
  const fixtures = [];
  for (const vault of listVaults().filter(vault => ['estudio','docencia'].includes(vault.type))) {
    const fixture = await withOwningVault(vault.id, () => withVaultDatabase(vault.id, () => {
      const db = getDb();
      const jobsBefore = (db.prepare('SELECT COUNT(*) AS n FROM study_knowledge_jobs').get() as {n:number}).n;
      const course = createStudyCourse({name:'Aceptación grafo 0.1.0', description:'Fixture ficticio y aislado; no se extrae ni se indexa desde el móvil.'});
      const subjects = [];
      for (const [suffix, count] of [['A',223],['B',2]] as const) {
        const subject = createStudySubject({courseId:course.id,name:`Aceptación grafo ${suffix} 0.1.0`});
        const definitions = Array.from({length:count},(_,index)=>({key:`concept-${index}`,type:'concept' as const,
          label:`Concepto de aceptación ${suffix} ${String(index).padStart(3,'0')}`,
          statement:`La definición ${suffix} ${index} pertenece a este corpus de pruebas ficticio.`,role:'principal' as const,confidence:1,
          evidence:[{quote:`La definición ${suffix} ${index} pertenece a este corpus de pruebas ficticio.`,location:`Sección ${index+1}`}]}));
        const document = createStudyDocument({title:`Evidencias del grafo ${suffix} de aceptación`,contentMarkdown:definitions.map(idea=>`## ${idea.label}\n\n${idea.statement}`).join('\n\n'),placement:{courseId:course.id,subjectId:subject.id}});
        // These are explicit preanalysed fixture records. Repository insertion
        // invokes no extractor, provider, embedding or background indexing lane.
        replaceStudySourceKnowledge({subjectId:subject.id,sourceKind:'document',sourceId:document.id,sourceTitle:document.title,
          sourceHash:createHash('sha256').update(document.contentMarkdown).digest('hex'),ideas:definitions,
          relations:definitions.slice(1).map((idea,index)=>({from:definitions[index].key,to:idea.key,type:'supports' as const,basis:'Relación explícita del fixture',confidence:1})),
          embeddings:definitions.map(()=>null),embeddingProvider:'',embeddingModel:''});
        subjects.push({id:subject.id,name:subject.name,documentId:document.id,nodes:count,edges:count-1,lastLabel:definitions.at(-1)!.label});
      }
      const jobsAfter = (db.prepare('SELECT COUNT(*) AS n FROM study_knowledge_jobs').get() as {n:number}).n;
      if(jobsAfter!==jobsBefore)throw new Error('Study fixture creation must not enqueue extraction or indexing');
      return {vaultId:vault.id,vaultName:vault.name,vaultType:vault.type,subjects,knowledgeJobsUnchanged:true};
    }));
    fixtures.push(fixture);
  }
  if (!fixtures.some(vault=>vault.vaultType==='estudio') || !fixtures.some(vault=>vault.vaultType==='docencia'))throw new Error('Both Study and Teaching laboratory copies are required');
  fs.writeFileSync(marker,JSON.stringify({version:1,fixtureKind:'explicit fictional preanalysed evidence',vaults:fixtures}),{mode:0o600});
}
