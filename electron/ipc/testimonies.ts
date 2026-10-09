// testimonies channels, moved verbatim out of the monolithic registerIpc.
// The channel names are unchanged; scripts/test-ipc-contract.mjs is what proves it.
import type { IpcContext } from './context';
import { addParticipant as addTestimonyInterviewParticipant, agreementHistory as testimonyAgreementHistory, saveAgreement as saveTestimonyAgreement, accessContextFor as testimonyAccessContextFor, applyProposedStatus as applyTestimonyProposedStatus, archiveInterview as archiveTestimonyInterview, createInterview as createTestimonyInterview, createSession as createTestimonySession, deleteSession as deleteTestimonySession, deletionImpact as testimonyDeletionImpact, getInterviewRow as getTestimonyInterviewRow, getSession as getTestimonySession, interviewFacets as testimonyInterviewFacets, listInterviews as listTestimonyInterviews, listParticipants as listTestimonyInterviewParticipants, listSessions as listTestimonySessions, purgeInterview as purgeTestimonyInterview, removeParticipant as removeTestimonyInterviewParticipant, trashInterview as trashTestimonyInterview, updateInterview as updateTestimonyInterview, updateSession as updateTestimonySession } from '../db/testimonyRepo';
import { createParticipant as createTestimonyParticipant, deleteParticipant as deleteTestimonyParticipant, getParticipantProfile as getTestimonyParticipantProfile, listParticipantRows as listTestimonyParticipantRows, participantInterviews as testimonyParticipantInterviews, updateParticipant as updateTestimonyParticipant } from '../db/testimonyParticipantRepo';
import { TESTIMONY_AUDIO_EXTENSIONS, assignSpeaker as assignTestimonySpeaker, createTranscript as createTestimonyTranscript, deleteMedia as deleteTestimonyMedia, deleteTranscript as deleteTestimonyTranscript, deriveTranscript as deriveTestimonyTranscript, dropMediaBytes as dropTestimonyMediaBytes, getMediaBlob as getTestimonyMediaBlob, importMedia as importTestimonyMedia, importMediaFile as importTestimonyMediaFile, listSegments as listTestimonySegments, listTranscripts as listTestimonyTranscripts, remapAnnotationsTo as remapTestimonyAnnotationsTo, applySpeakerLabels as applyTestimonySpeakerLabels, speakerLabels as testimonySpeakerLabels, updateSegment as updateTestimonySegment, verifyMediaHash as verifyTestimonyMediaHash, CreateTranscriptInput as CreateTestimonyTranscriptInput } from '../db/testimonyMediaRepo';
import { createAnnotation as createTestimonyAnnotation, createCode as createTestimonyCode, deleteAnnotation as deleteTestimonyAnnotation, deleteCode as deleteTestimonyCode, listAnnotations as listTestimonyAnnotations, listCodes as listTestimonyCodes, listFragments as listTestimonyFragments, mergeCodes as mergeTestimonyCodes, updateAnnotation as updateTestimonyAnnotation, updateCode as updateTestimonyCode } from '../db/testimonyAnalysisRepo';
import { createContrast as createTestimonyContrast, deleteContrast as deleteTestimonyContrast, getContrast as getTestimonyContrast, listContrasts as listTestimonyContrasts, pinFragment as pinTestimonyFragment, reorderItems as reorderTestimonyContrastItems, runContrast as runTestimonyContrast, updateContrast as updateTestimonyContrast } from '../db/testimonyContrastRepo';
import { searchTestimonies, testimonyDashboard } from '../db/testimonySearchRepo';
import { addNoteLink, createNoteFromFragment as createNoteFromTestimonyFragment, linksForTarget, listNoteLinks, removeNoteLink } from '../db/noteLinksRepo';
import { evaluateAccess as evaluateTestimonyAccess } from '@shared/testimonyAccess';
import { buildTestimonyPackage } from '../export/testimonyExport';
import { analyzeTestimonyInterview, improveTestimonyTranscript } from '../ai/testimonyAnalysis';
import { buildTestimonyIndex, testimonyIndexStatus } from '../ai/testimonyIndex';
import { dropAllEmbeddings as dropTestimonyEmbeddings, semanticSearch as testimonySemanticSearch } from '../db/testimonyEmbeddingsRepo';
import { embedQuery as embedText } from '../ai/aiClient';
import type { TestimonyAccessChannel, TestimonyAgreementInput, TestimonyExportRequest, TestimonyAnnotationInput, TestimonyCodeInput, TestimonyContrastFilters, TestimonyContrastInput, TestimonyInterviewInput, TestimonyMediaRole, TestimonyParticipantInput, TestimonyParticipantRole, TestimonySearchKind, TestimonySessionInput, TestimonyTranscriptKind, TestimonyAnnotationKind } from '@shared/types';
import fs from 'node:fs';
import { dialog } from 'electron';
import { showImportOpenDialog } from '../privacy';
import { getSettings } from '../db/settingsRepo';

export function registerTestimoniesIpc({ h, getWindow }: IpcContext): void {
  // ── Testimonios (historia oral) ────────────────────────────────────────────
  // Los canales van agrupados por entidad y con argumentos explícitos: el renderer pide
  // entrevistas, participantes o fragmentos, nunca rutas de disco ni SQL. El blob de un
  // medio se pide siempre aparte y por id, para que ninguna lista arrastre horas de audio.
  h('testimony:dashboard:get', async () =>
    testimonyDashboard({ lastBackupAt: getSettings().lastAutoBackupAt ?? null }));

  h('testimony:interviews:list', async (_e, options: Parameters<typeof listTestimonyInterviews>[0]) =>
    listTestimonyInterviews(options ?? {}));
  h('testimony:interviews:get', async (_e, id: string) => getTestimonyInterviewRow(id));
  h('testimony:interviews:create', async (_e, input: TestimonyInterviewInput) => createTestimonyInterview(input));
  h('testimony:interviews:update', async (_e, id: string, patch: Partial<TestimonyInterviewInput>) =>
    updateTestimonyInterview(id, patch));
  h('testimony:interviews:archive', async (_e, id: string, archived: boolean) => archiveTestimonyInterview(id, archived));
  h('testimony:interviews:trash', async (_e, id: string, trashed: boolean) => trashTestimonyInterview(id, trashed));
  h('testimony:interviews:impact', async (_e, id: string) => testimonyDeletionImpact(id));
  h('testimony:interviews:purge', async (_e, id: string) => {
    purgeTestimonyInterview(id);
  });
  h('testimony:interviews:facets', async () => testimonyInterviewFacets());

  h('testimony:participants:list', async (_e, search: string) => listTestimonyParticipantRows(search ?? ''));
  h('testimony:participants:get', async (_e, personId: string) => getTestimonyParticipantProfile(personId));
  h('testimony:participants:create', async (_e, input: TestimonyParticipantInput) => createTestimonyParticipant(input));
  h('testimony:participants:update', async (_e, personId: string, patch: Partial<TestimonyParticipantInput>) =>
    updateTestimonyParticipant(personId, patch));
  h('testimony:participants:delete', async (_e, personId: string) => {
    deleteTestimonyParticipant(personId);
  });
  h('testimony:participants:interviews', async (_e, personId: string) => testimonyParticipantInterviews(personId));
  h('testimony:participants:add', async (
    _e,
    interviewId: string,
    personId: string,
    role: TestimonyParticipantRole,
    options: { isPrimary?: boolean; speakerLabel?: string | null }
  ) => {
    addTestimonyInterviewParticipant(interviewId, personId, role, options ?? {});
  });
  h('testimony:participants:remove', async (_e, interviewId: string, personId: string, role: TestimonyParticipantRole) => {
    removeTestimonyInterviewParticipant(interviewId, personId, role);
  });
  h('testimony:participants:forInterview', async (_e, interviewId: string) => listTestimonyInterviewParticipants(interviewId));

  h('testimony:agreements:history', async (_e, interviewId: string) => testimonyAgreementHistory(interviewId));
  h('testimony:agreements:save', async (_e, input: TestimonyAgreementInput) => saveTestimonyAgreement(input));

  h('testimony:sessions:list', async (_e, interviewId: string) => listTestimonySessions(interviewId));
  h('testimony:sessions:create', async (_e, input: TestimonySessionInput) => createTestimonySession(input));
  h('testimony:sessions:update', async (_e, id: string, patch: Partial<TestimonySessionInput>) => updateTestimonySession(id, patch));
  h('testimony:sessions:delete', async (_e, id: string) => {
    deleteTestimonySession(id);
  });

  h('testimony:media:import', async (
    _e,
    input: { sessionId: string; fileName: string; mimeType: string; bytes: ArrayBuffer; durationSeconds?: number | null; role?: TestimonyMediaRole }
  ) => {
    const result = importTestimonyMedia({ ...input, bytes: Buffer.from(input.bytes) });
    const session = getTestimonySession(result.media.sessionId);
    // El estado del flujo se PROPONE al añadir un maestro, no se impone: importar audio en
    // una entrevista ya terminada no debe devolverla a «Grabada».
    const proposed = session && result.media.role === 'master'
      ? applyTestimonyProposedStatus(session.interviewId, 'master_added')
      : null;
    return { ...result, proposedStatus: proposed };
  });
  h('testimony:media:importPaths', async (_e, sessionId: string, paths: string[]) => {
    const results = paths.map((filePath) => importTestimonyMediaFile(sessionId, filePath));
    const session = getTestimonySession(sessionId);
    if (session && results.some((result) => result.media.role === 'master')) {
      applyTestimonyProposedStatus(session.interviewId, 'master_added');
    }
    return results;
  });
  h('testimony:media:pick', async () => {
    // Los selectores nativos pasan SIEMPRE por el punto auditado de privacy.ts: es lo que
    // impide que un importador nuevo abra el selector del sistema por su cuenta, y un test
    // lo comprueba sobre todo el proceso principal.
    const options = {
      properties: ['openFile', 'multiSelections'] as const,
      filters: [{ name: 'Audio', extensions: [...TESTIMONY_AUDIO_EXTENSIONS] }],
    };
    const parent = getWindow();
    const result = parent
      ? await showImportOpenDialog(parent, { ...options, properties: [...options.properties] })
      : await showImportOpenDialog({ ...options, properties: [...options.properties] });
    return result.canceled ? [] : result.filePaths;
  });
  h('testimony:media:blob', async (_e, mediaId: string) => {
    const blob = getTestimonyMediaBlob(mediaId);
    if (!blob) return null;
    return {
      bytes: blob.bytes.buffer.slice(blob.bytes.byteOffset, blob.bytes.byteOffset + blob.bytes.byteLength),
      mimeType: blob.mimeType,
      fileName: blob.fileName,
    };
  });
  h('testimony:media:verify', async (_e, mediaId: string) => verifyTestimonyMediaHash(mediaId));
  h('testimony:media:exportMaster', async (_e, mediaId: string) => {
    const blob = getTestimonyMediaBlob(mediaId);
    if (!blob) return null;
    const result = await dialog.showSaveDialog({ defaultPath: blob.fileName });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, blob.bytes);
    return result.filePath;
  });
  h('testimony:media:dropBytes', async (_e, mediaId: string) => dropTestimonyMediaBytes(mediaId));
  h('testimony:media:delete', async (_e, mediaId: string) => {
    deleteTestimonyMedia(mediaId);
  });

  h('testimony:transcripts:list', async (_e, mediaId: string) => listTestimonyTranscripts(mediaId));
  h('testimony:transcripts:segments', async (_e, transcriptId: string) => listTestimonySegments(transcriptId));
  h('testimony:transcripts:create', async (_e, input: CreateTestimonyTranscriptInput) => createTestimonyTranscript(input));
  h('testimony:transcripts:derive', async (_e, sourceId: string, kind: TestimonyTranscriptKind, options: { language?: string | null }) => {
    const transcript = deriveTestimonyTranscript(sourceId, kind, options ?? {});
    // Al nacer una versión, sus fragmentos se reanclan contra ella. Los que no se pueden
    // reanclar con seguridad quedan marcados y se cuentan: una cita NUNCA se mueve en
    // silencio.
    const remap = remapTestimonyAnnotationsTo(sourceId, transcript.id);
    return { transcript, ...remap };
  });
  h('testimony:transcripts:delete', async (_e, id: string) => {
    deleteTestimonyTranscript(id);
  });
  h('testimony:transcripts:updateSegment', async (
    _e,
    id: string,
    patch: { text?: string; speakerPersonId?: string | null; speakerLabel?: string | null; tStart?: number; tEnd?: number }
  ) => updateTestimonySegment(id, patch));
  h('testimony:transcripts:assignSpeaker', async (_e, transcriptId: string, speakerLabel: string | null, personId: string | null) =>
    assignTestimonySpeaker(transcriptId, speakerLabel, personId));
  h('testimony:transcripts:speakers', async (_e, transcriptId: string) => testimonySpeakerLabels(transcriptId));
  h('testimony:index:build', async () => buildTestimonyIndex());
  h('testimony:index:status', async () => testimonyIndexStatus());
  h('testimony:index:clear', async () => dropTestimonyEmbeddings());
  h('testimony:search:semantic', async (_e, query: string, limit: number | null) => {
    const vector = await embedText(query);
    // Sin vector no hay búsqueda: devolver los resultados textuales disfrazados de
    // semánticos haría creer que el índice funciona cuando el proveedor está caído.
    if (!vector) throw new Error('No se pudo consultar el modelo de embeddings. Revisa el proveedor en Ajustes.');
    return testimonySemanticSearch(vector, limit ?? 20);
  });
  h('testimony:ai:analyze', async (_e, interviewId: string) => analyzeTestimonyInterview(interviewId));
  h('testimony:ai:improve', async (_e, transcriptId: string) => improveTestimonyTranscript(transcriptId));
  h('testimony:transcripts:applyDetectedSpeakers', async (
    _e,
    transcriptId: string,
    entries: { segmentId: string; label: string | null }[],
  ) => applyTestimonySpeakerLabels(transcriptId, entries));

  h('testimony:codes:list', async () => listTestimonyCodes());
  h('testimony:codes:create', async (_e, input: TestimonyCodeInput) => createTestimonyCode(input));
  h('testimony:codes:update', async (_e, id: string, patch: Partial<TestimonyCodeInput>) => updateTestimonyCode(id, patch));
  h('testimony:codes:delete', async (_e, id: string) => {
    deleteTestimonyCode(id);
  });
  h('testimony:codes:merge', async (_e, sourceId: string, targetId: string) => mergeTestimonyCodes(sourceId, targetId));
  h('testimony:annotations:list', async (_e, interviewId: string) => listTestimonyAnnotations(interviewId));
  h('testimony:annotations:create', async (_e, input: TestimonyAnnotationInput) => createTestimonyAnnotation(input));
  h('testimony:annotations:update', async (
    _e,
    id: string,
    patch: { memo?: string | null; kind?: TestimonyAnnotationKind; codeIds?: string[]; linkStatus?: 'valid' | 'needs_review' }
  ) => updateTestimonyAnnotation(id, patch));
  h('testimony:annotations:delete', async (_e, id: string) => {
    deleteTestimonyAnnotation(id);
  });
  h('testimony:annotations:fragments', async (_e, filters: TestimonyContrastFilters) => listTestimonyFragments(filters ?? {}));

  h('testimony:contrasts:list', async () => listTestimonyContrasts());
  h('testimony:contrasts:get', async (_e, id: string) => getTestimonyContrast(id));
  h('testimony:contrasts:create', async (_e, input: TestimonyContrastInput) => createTestimonyContrast(input));
  h('testimony:contrasts:update', async (_e, id: string, patch: Partial<TestimonyContrastInput>) => updateTestimonyContrast(id, patch));
  h('testimony:contrasts:delete', async (_e, id: string) => {
    deleteTestimonyContrast(id);
  });
  h('testimony:contrasts:pin', async (_e, contrastId: string, annotationId: string, pinned: boolean) =>
    pinTestimonyFragment(contrastId, annotationId, pinned));
  h('testimony:contrasts:reorder', async (_e, contrastId: string, annotationIds: string[]) =>
    reorderTestimonyContrastItems(contrastId, annotationIds));
  h('testimony:contrasts:run', async (_e, filters: TestimonyContrastFilters) => runTestimonyContrast(filters ?? {}));

  h('testimony:search:query', async (_e, query: string, kinds: TestimonySearchKind[] | null) =>
    searchTestimonies(query, kinds ?? undefined));

  h('testimony:notes:links', async (_e, noteId: string) => listNoteLinks(noteId));
  h('testimony:notes:linksForTarget', async (_e, targetKind: string, targetId: string) => linksForTarget(targetKind, targetId));
  h('testimony:notes:addLink', async (_e, noteId: string, targetKind: string, targetId: string, label: string | null) => {
    addNoteLink(noteId, targetKind, targetId, label);
  });
  h('testimony:notes:removeLink', async (_e, noteId: string, targetKind: string, targetId: string) => {
    removeNoteLink(noteId, targetKind, targetId);
  });
  h('testimony:notes:fromFragment', async (_e, annotationId: string) => createNoteFromTestimonyFragment(annotationId));

  h('testimony:export:package', async (_e, request: TestimonyExportRequest) => {
    const { zip, result } = buildTestimonyPackage(request);
    const suffix = request.kind === 'preservation' ? 'preservacion' : request.kind === 'access' ? 'consulta' : 'revision';
    const saved = await dialog.showSaveDialog({
      defaultPath: `nodus-testimonios-${suffix}-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (saved.canceled || !saved.filePath) return null;
    fs.writeFileSync(saved.filePath, zip);
    return { ...result, path: saved.filePath };
  });
  h('testimony:export:accessDecision', async (_e, interviewId: string, channel: TestimonyAccessChannel) =>
    evaluateTestimonyAccess(testimonyAccessContextFor(interviewId), channel, {
      policy: { allowExternalProviders: getSettings().testimonyAllowExternalProviders },
    }));
}
