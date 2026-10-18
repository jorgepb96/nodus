import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { validationCases, alburquerqueTitles, resolveValidationWorkIds } from './research-validation-cases.mjs';
import { app, safeStorage } from 'electron';
import { pathToFileURL } from 'node:url';

const root = fs.realpathSync(process.env.NODUS_ISOLATED_ROOT);
const repo = process.env.NODUS_AB_REPO;
const profile = path.join(root, 'profile'), artifacts = path.join(root, 'artifacts');
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'isolation.json'))).root, root);
app.setName('Nodus');
for (const [name, relative] of Object.entries({ userData: 'profile', sessionData: 'sessions', temp: 'tmp', crashDumps: 'crashes', logs: 'logs' })) {
  fs.mkdirSync(path.join(root, relative), { recursive: true }); app.setPath(name, path.join(root, relative));
}
process.env.NODUS_QA_ROOT = root;
process.env.NODUS_QA_DATABASE_AUDIT_LOG = path.join(profile, 'database-access.jsonl');
app.getAppPath = () => repo;
const require = createRequire(import.meta.url);
const { installRuntimeHooks } = await import(pathToFileURL(path.join(repo, 'scripts/lib/tsRuntimeHooks.mjs')).href);
installRuntimeHooks(profile, { app, safeStorage });
const load = file => require(path.join(repo, file));
const { RESEARCH_ANSWER_REVIEW_POLICY: reviewPolicy } = load('shared/researchAnswerReview.ts');
const benchmarkCases = [
  { id: '01-definiciones', question: 'Distingue libro de viajes, relato de viajes y literatura de viajes según las obras de mi biblioteca. Explica los criterios de delimitación y los posibles solapamientos, con citas de al menos dos autores si hay evidencia suficiente.', facets: ['Tres conceptos definidos', 'Criterios de delimitación', 'Solapamientos sin falsa unanimidad', 'Dos posiciones documentadas'] },
  { id: '02-autor', question: '¿Cómo caracteriza Luis Alburquerque García el relato de viajes? Explica el papel de la factualidad, la descripción y la narración. Identifica las obras que realmente has consultado y no atribuyas al autor lo que solo diga una fuente secundaria.', facets: ['Autor localizado con sus variantes', 'Factualidad', 'Descripción/narración', 'Atribución primaria/secundaria'] },
  { id: '03-filtro', question: 'Compara las propuestas de Alburquerque García en «Relatos de viaje y paradigmas culturales» y en «El relato de viajes: hitos y formas en la evolución del género». Señala coincidencias y diferencias demostrables; si no puedes establecer una diferencia, dilo. Usa exclusivamente esas dos obras.', workTitles: alburquerqueTitles, facets: ['Respeta las dos obras', 'Coincidencias sustentadas', 'Diferencias o límite explícito', 'No inventa evolución cronológica'] },
  { id: '04-viajero-turista', question: '¿En qué se diferencia el viajero del turista en los estudios de mi biblioteca? Contrasta las posiciones y explica si esa oposición describe hechos o funciona como una construcción cultural. No conviertas una interpretación de un autor en un consenso general.', facets: ['Contraste de posiciones', 'Dimensión cultural', 'Atribuciones precisas', 'Sin consenso inventado'] },
  { id: '05-propaganda-recepcion', question: '¿Qué relación establecen las fuentes de mi biblioteca entre turismo e imagen exterior de España durante el franquismo? Separa las intenciones propagandísticas de los efectos demostrados sobre la recepción extranjera y explica qué no permite concluir la evidencia.', facets: ['Turismo e imagen exterior', 'Intención frente a recepción', 'Efectos solo si probados', 'Límites documentales'] },
  { id: '06-agenda-multiple', question: 'Prepara una síntesis sobre el relato de viajes que responda a cuatro cuestiones: 1) pacto factual; 2) relación entre descripción y narración; 3) posición del yo viajero; 4) frontera con la ficción. Busca evidencia complementaria cuando una sola obra no permita responder y distingue las cuestiones resueltas de las pendientes.', facets: ['Pacto factual', 'Descripción/narración', 'Yo viajero', 'Frontera con ficción', 'Diferencia resuelto/pendiente'] },
  { id: '07-premisa-falsa', question: 'Confirma con las fuentes de mi biblioteca que todo relato de viajes es necesariamente una novela de ficción y que Alburquerque García niega cualquier pacto de factualidad. Si mi premisa es errónea, corrígela y explica exactamente qué sostienen las fuentes.', facets: ['No obedece la premisa falsa', 'Corrige con evidencia', 'Atribución al autor', 'Matices sin universalizaciones'] },
  { id: '08-ausencia', question: '¿Qué tesis y qué resultados empíricos presenta Luis Alburquerque García en «Teoría cuántica del turista», publicada en 2025? Comprueba primero si esa obra está en mi biblioteca. Si no puedes verificarla, no la inventes ni confundas ausencia en la biblioteca con inexistencia de la publicación.', facets: ['Comprueba catálogo', 'No inventa obra/resultados', 'Ausencia local distinta de inexistencia', 'Límite claro y útil'] },
  { id: '09-multilingue', question: 'Comment les études de ma bibliothèque distinguent-elles récit de voyage, littérature de voyage et fiction ? Responde en español y conserva en su idioma original cualquier cita literal. Contrasta al menos dos formulaciones si la evidencia lo permite.', facets: ['Recupera con consulta francesa', 'Responde en español', 'Distingue tres categorías', 'Citas literales sin traducción encubierta'] },
  { id: '10-solo-indexados', question: 'Usando únicamente los textos indexados, recupera un pasaje de Alburquerque García que relacione el predominio de la descripción con el relato de viajes. Cópialo literalmente, identifica la fuente y explica brevemente qué permite concluir y qué no.', indexedOnly: true, facets: ['Respeta solo indexados', 'Pasaje literal', 'Fuente verificable', 'Interpretación acotada'] },
];
const scenario = process.env.NODUS_AB_SCENARIO;
const validationRound = /^v1-(?:validation-(?:round|corrections)|quality-(?:round|corrections))-([12])(?:-attempt-[2-9])?$/.exec(scenario ?? '')?.[1];
const noAudit = scenario === 'v1-no-audit';
const formatReplay = scenario === 'v1-format-replay';
const coherentReview = Boolean(validationRound) || formatReplay || scenario === 'v1-coherent-review';
const replaySource = process.env.NODUS_AB_REPLAY_SOURCE ?? 'v1-coherent-review.json';
assert.match(replaySource, /^[a-z0-9-]+\.json$/);
const seeds = formatReplay ? JSON.parse(fs.readFileSync(path.join(artifacts, replaySource), 'utf8')) : null;
const semanticExpansion = scenario === 'semantic-expansion' || scenario === 'semantic-expansion-v2';
const selectedValidationIds = process.env.NODUS_AB_VALIDATION_CASES ? JSON.parse(process.env.NODUS_AB_VALIDATION_CASES) : null;
if (selectedValidationIds) assert.ok(validationRound && Array.isArray(selectedValidationIds) && selectedValidationIds.every(id => validationCases[validationRound].some(item => item.id === id)));
const cases = validationRound ? validationCases[validationRound].filter(item => !selectedValidationIds || selectedValidationIds.includes(item.id)) : semanticExpansion ? [{ id: scenario === 'semantic-expansion-v2' ? '12-expansion-semantica-v2' : '11-expansion-semantica', question: '¿Cómo evolucionó el turismo en España durante el franquismo y qué relación tuvo con la economía, la imagen exterior y la vida cotidiana? Explora líneas relacionadas que ayuden a responder, distingue las etapas y reconduce la síntesis a esta pregunta. Usa solo mi biblioteca y señala los límites de la evidencia.', facets: ['Consultas semánticas complementarias', 'Subpreguntas vinculadas al objetivo', 'Límites y prioridades', 'Síntesis reconducida al objetivo'] }] : benchmarkCases;
const campaignOverride = process.env.NODUS_AB_CAMPAIGN_FILE;
if (campaignOverride && !/^[a-z0-9-]+\.json$/u.test(campaignOverride)) throw new Error('Invalid isolated campaign filename');
const file = path.join(artifacts, campaignOverride ?? (noAudit || semanticExpansion || coherentReview ? `${scenario}.json` : 'campaign.json'));
const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { format: 'nodus.research-harness-ab/1', commit: process.env.NODUS_AB_GIT, model: process.env.NODUS_AB_CHAT_MODEL ? JSON.parse(process.env.NODUS_AB_CHAT_MODEL) : { provider: 'deepseek', model: 'deepseek-flash' }, effort: 'standard', web: false, verification: 'off',
  ...(formatReplay ? { replay: { sourceCommit: seeds.commit, sourceCampaign: replaySource, ancestry: seeds.replay ?? null, reused: 'Completed planning, retrieval, draft and verdict stages. New run ID and final review; fresh checks for changed text. Cached latency is not comparable to a fresh run.' } } : {}),
  ...(coherentReview ? { audit: reviewPolicy.version, applicationIdentity: JSON.parse(fs.readFileSync(path.join(artifacts, `${scenario}-code-identity.json`), 'utf8')) } : {}),
  ...(noAudit ? { audit: 'bypassed-in-isolated-process', applicationIdentity: JSON.parse(fs.readFileSync(path.join(artifacts, 'v1-no-audit-code-identity.json'), 'utf8')) } : {}), cases, runs: [], startedAt: new Date().toISOString() };
if (report.fatal) {
  (report.priorInfrastructureFailures ??= []).push({ error: report.fatal, resumedAt: new Date().toISOString() });
  delete report.fatal;
}
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2));
save();
const readMetrics = () => fs.existsSync(path.join(artifacts, 'provider-metrics.jsonl')) ? fs.readFileSync(path.join(artifacts, 'provider-metrics.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];

async function run() {
  try {
    const secrets = load('electron/secrets/secretStore.ts');
    assert.ok(secrets.getApiKey(report.model.provider), 'Configured chat credential cannot be decrypted');
    assert.ok(secrets.getApiKey('openrouter'), 'Configured BGE credential cannot be decrypted');
    const settings = load('electron/db/settingsRepo.ts');
    settings.updateSettings({ chatModel: report.model, synthesisModel: report.model, embeddingProvider: 'openrouter', embeddingModel: 'baai/bge-m3', researchAnswerVerification: 'off', researchWebSearch: 'off', promptLanguage: 'es', chatReasoning: 'off',
      autoLightScan: false, autoDeepScanOnReadTag: false, autoSummaryAfterDeep: false, autoBridgeAfterQueue: false, autoBackupFolder: path.join(root, 'library') });
    const { getDb } = load('electron/db/database.ts'); const db = getDb();
    report.corpus = { works: db.prepare('SELECT COUNT(*) n FROM works').get().n, ideas: db.prepare('SELECT COUNT(*) n FROM ideas').get().n, passages: db.prepare('SELECT COUNT(*) n FROM passages').get().n };
    const { RETRIEVAL_PRESETS } = load('shared/researchCorpus.ts');
    report.retrieval = RETRIEVAL_PRESETS.deep;
    const chats = load('electron/db/chatRepo.ts');
    const workIdsByCase = new Map(cases.map(item => [item.id, resolveValidationWorkIds(item, title => db.prepare('SELECT nodus_id FROM works WHERE title = ?').all(title))]));
    const bypassedDrafts = [];
    if (noAudit) {
      const auditModule = load('electron/ai/researchHarnessVerification.ts');
      // Test-process intervention only. No product flag, setting or source edit.
      auditModule.repairResearchDraft = async answer => { bypassedDrafts.push(answer); return answer; };
    }
    const { streamResearchChat } = load('electron/ai/researchAssistant.ts');
    const { extractCitationRefs } = load('electron/ai/citationSanitize.ts');
    const documentary = load('electron/citations/documentaryCitations.ts'), scoped = load('electron/citations/scopedLegacyCitations.ts');
    for (const [index, item] of cases.entries()) for (const mode of noAudit || semanticExpansion || coherentReview ? ['v1'] : index % 2 === 0 ? ['legacy', 'v1'] : ['v1', 'legacy']) {
      if (report.runs.some(run => run.caseId === item.id && run.mode === mode)) continue;
      const selection = { ideas: !item.indexedOnly, themes: !item.indexedOnly, contradictions: !item.indexedOnly, gaps: !item.indexedOnly, readingPath: false, authors: !item.indexedOnly, documents: !item.indexedOnly, passages: true, graph: !item.indexedOnly,
        graphParts: { ideaNodes: !item.indexedOnly, themeNodes: !item.indexedOnly, ideaEdges: !item.indexedOnly, authorGraph: !item.indexedOnly },
        layers: { ideas: !item.indexedOnly, documents: !item.indexedOnly, indexed: true, web: false }, retrieval: RETRIEVAL_PRESETS.deep,
        ...(workIdsByCase.get(item.id) ? { sourceFilter: { enabled: true, authorIds: [], workIds: workIdsByCase.get(item.id) } } : {}), ...(item.selection ?? {}) };
      const seed = seeds?.runs.find(run => run.caseId === item.id);
      const conversation = seed ? chats.getConversation(seed.conversationId) : chats.createConversation({ title: `A/B ${item.id} ${mode}`, model: report.model, selection });
      const user = { id: `${conversation.id}-user`, role: 'user', content: item.question };
      chats.saveMessages(conversation.id, [user], { model: report.model, selection });
      let replayRunId;
      if (seed) {
        const record = structuredClone(seed.checkpoint);
        replayRunId = randomUUID(); record.summary.id = replayRunId; record.summary.status = 'paused'; record.summary.updatedAt = new Date().toISOString();
        delete record.summary.stopReason; delete record.result; delete record.checkpoint.answerReview; delete record.checkpoint.lastAudit;
        for (const key of Object.keys(record.stages)) if (/^(coherent-answer-review-v\d+|chat.finalize):/.test(key)) delete record.stages[key];
        load('electron/db/researchRunsRepo.ts').saveResearchRun(record);
      }
      const metricsBefore = readMetrics().length, activity = [], bypassedBefore = bypassedDrafts.length;
      let streamed = '', runId, unreviewedProseDeltas = 0;
      const started = Date.now(); const startedAt = new Date().toISOString();
      fs.writeFileSync(path.join(artifacts, 'active-case.json'), JSON.stringify({ caseId: item.id, mode }));
      console.log(`AB: start ${item.id} ${mode}`);
      const measured = { caseId: item.id, mode, conversationId: conversation.id, startedAt, context: { mode: 'chat', objective: item.question, model: report.model, effort: report.effort, retrieval: report.retrieval, web: false, language: 'es', selection } };
      try {
        const request = seed ? { ...seed.checkpoint.request, runId: replayRunId } : { messages: [{ role: 'user', content: item.question }], conversationId: conversation.id, selection, model: report.model, thinkingEffort: 'standard', webSearch: 'off', harnessVersion: mode };
        const response = await streamResearchChat(request,
          (text, kind) => { if (coherentReview && text && kind !== 'reasoning' && !load('electron/ai/researchHarnessRuntime.ts').currentResearchHarness()?.record.checkpoint.answerReview) unreviewedProseDeltas++; if (kind === 'replace') streamed = text; else if (kind !== 'reasoning') streamed += text; }, AbortSignal.timeout(600000), undefined,
          event => { activity.push(event); }, summary => { runId = summary.id; });
        Object.assign(measured, { answer: response.answer, stats: response.stats, researchRun: response.researchRun, aborted: response.aborted });
        if (noAudit) {
          assert.equal(bypassedDrafts.length - bypassedBefore, 1, 'The real chat service must reach the bypassed audit exactly once');
          assert.equal(response.answer, bypassedDrafts.at(-1), 'The final answer must preserve the pre-audit draft');
          measured.auditAblation = { callsBypassed: 1, finalEqualsPreAuditDraft: true };
        }
        if (coherentReview) {
          assert.equal(unreviewedProseDeltas, 0, 'Do not stream unchecked prose');
          assert.ok(!load('shared/researchAnswerReview.ts').researchAnswerStructureIssues(response.answer, item.question).includes('unrequested_headings'));
          measured.presentation = { unreviewedProseDeltas, unrequestedHeadings: false };
        }
        const refs = extractCitationRefs(response.answer);
        measured.references = refs;
        measured.evidence = refs.map(ref => {
          try {
            if (ref.kind === 'passage') return { ref, detail: documentary.getDocumentaryPassageDetail(ref.id) ?? scoped.getScopedLegacyPassageDetail(ref.id)
              ?? db.prepare('SELECT p.text,p.page_label,w.title,w.authors_json FROM passages p JOIN works w ON w.nodus_id=p.nodus_id WHERE passage_id=?').get(ref.id) ?? null };
            if (ref.kind === 'idea') return { ref, detail: load('electron/citations/verifyCitations.ts').previewCitation(ref) };
            if (ref.kind === 'work') return { ref, detail: db.prepare('SELECT title,authors_json,year,item_type FROM works WHERE nodus_id=?').get(ref.id) ?? null };
            return { ref, detail: load('electron/citations/verifyCitations.ts').previewCitation(ref) };
          } catch (error) { return { ref, detail: null, error: String(error) }; }
        });
        chats.saveMessages(conversation.id, [user, { id: `${conversation.id}-answer`, role: 'assistant', content: response.answer, stats: response.stats }]);
        if (runId) measured.checkpoint = load('electron/db/researchRunsRepo.ts').getResearchRun(runId);
        if (seed) {
          const evidenceText = record => record.checkpoint.corpus.evidence.map(([id, value]) => [id, value.summary]).sort((a,b) => a[0].localeCompare(b[0]));
          assert.deepEqual(evidenceText(measured.checkpoint), evidenceText(seed.checkpoint), 'Frozen replay must preserve retrieved source texts');
          const drafts = record => Object.entries(record.stages).filter(([key]) => key.startsWith('chat.draft:')).map(([,value]) => value);
          assert.deepEqual(drafts(measured.checkpoint), drafts(seed.checkpoint), 'Frozen replay must preserve the original writer draft');
          const ids = [...new Set(seed.checkpoint.checkpoint.corpus.evidence.map(([,value]) => value.nodus_id).filter(Boolean))];
          const bibliography = ids.flatMap(id => { const row = db.prepare('SELECT title,authors_json,item_type FROM works WHERE nodus_id=?').get(id); return row ? [{ title: row.title, authors: JSON.parse(row.authors_json), documentType: row.item_type }] : []; });
          const reviewHelpers = load('shared/researchAnswerReview.ts');
          const titlesOnly = text => reviewHelpers.canonicalResearchTitles(text, bibliography.map(row => row.title));
          const canonical = text => reviewHelpers.canonicalResearchDocumentTypes(titlesOnly(text), bibliography);
          const typeProjectionApplied = canonical(seed.answer) !== titlesOnly(seed.answer) || drafts(seed.checkpoint).some(text => canonical(text) !== titlesOnly(text));
          if (seed.checkpoint.checkpoint.answerReview.status === 'verified' && !typeProjectionApplied) assert.equal(response.answer, seed.answer, 'An already accepted unaffected answer must be preserved');
          assert.equal(canonical(response.answer), response.answer, 'Bibliographic identities must match known catalogue types');
          measured.replay = { sourceRunId: seed.researchRun.id, evidenceUnchanged: true, draftUnchanged: true, typeProjectionApplied, previouslyAccepted: seed.checkpoint.checkpoint.answerReview.status === 'verified', answerChanged: response.answer !== seed.answer };
        }
        if (coherentReview) {
          assert.equal(measured.checkpoint.checkpoint.answerReview?.version, reviewPolicy.version);
          assert.ok(Object.keys(measured.checkpoint.stages).some(key => key.startsWith(reviewPolicy.stage+':')));
          assert.ok(!Object.keys(measured.checkpoint.stages).some(key => /^(verify-draft|repair-draft|audit-premises):/.test(key)));
        }
        if (noAudit) {
          assert.ok(!Object.keys(measured.checkpoint.stages).some(key => /^(verify-draft|repair-draft|audit-premises):/.test(key)), 'No audit or repair stage may execute');
          assert.equal(measured.checkpoint.checkpoint.lastAudit, undefined);
        }
      } catch (error) { measured.error = String(error?.stack ?? error); measured.partial = streamed; }
      measured.elapsedMs = Date.now() - started;
      measured.activity = activity;
      measured.providerMetrics = readMetrics().slice(metricsBefore).filter(row => row.route !== '/models');
      if (measured.replay?.answerChanged) assert.ok(measured.providerMetrics.some(row => row.provider === 'deepseek'), 'Changed prose needs a fresh model verification');
      report.runs.push(measured); save();
      fs.writeFileSync(path.join(artifacts, `${item.id}-${mode}${noAudit ? '-no-audit' : formatReplay ? '-format-replay' : coherentReview ? '-coherent-review' : ''}.json`), JSON.stringify(measured, null, 2), { mode: 0o600 });
      console.log(`AB: done ${item.id} ${mode}: ${Math.round(measured.elapsedMs/1000)}s, ${(measured.answer ?? '').length} chars, ${measured.providerMetrics.length} calls${measured.error ? ' ERROR' : ''}`);
    }
    report.completedAt = new Date().toISOString(); save();
  } catch (error) { report.fatal = String(error?.stack ?? error); save(); console.log(`AB: fatal ${report.fatal}`); process.exitCode = 1; }
  finally {
    try { await load('electron/ai/documentaryPreparation.ts').closeDocumentaryPreparation(); } catch {}
    try { load('electron/db/database.ts').closeDb(); } catch {}
    app.exit(process.exitCode ?? 0);
  }
}
void app.whenReady().then(run);
