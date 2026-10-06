import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { waitFor } from './research-app-harness.mjs';

/** Actual UI requests and citation dialogs, with observational IPC capture only. */
export async function checkEmbeddingProductChat(harness, report, save, shot) {
  const { app, page } = harness, notebooks = report.notebooks;
  await page.evaluate(() => window.nodus.updateSettings({ researchWebSearch: 'off' }));
  await page.getByRole('button', { name: 'Research chat', exact: true }).first().click();
  await page.locator('.research-assistant-header').waitFor();
  if (!(await page.getByTestId('research-history-sidebar').isVisible())) await page.getByTestId('research-history-toggle').click();
  const capturedFile = path.join(harness.root, 'profile/qa-chat-answers.jsonl');
  fs.writeFileSync(capturedFile, '');
  await app.evaluate(({ ipcMain }, file) => {
    const append = row => process.getBuiltinModule('node:fs').appendFileSync(file, JSON.stringify(row) + '\n');
    const handlers = ipcMain._invokeHandlers, original = handlers.get('research:chatStream');
    handlers.set('research:chatStream', async (...args) => {
      const started = Date.now();
      try { const response = await original(...args); append({ started, finished: Date.now(), request: args[2], response }); return response; }
      catch (error) { append({ started, finished: Date.now(), request: args[2], error: error.message }); throw error; }
    });
  }, capturedFile);
  const captured = () => fs.readFileSync(capturedFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const open = async scope => {
    if (scope === 'corpus') await page.getByTestId('research-new-conversation').click();
    else {
      const notebook = scope === 'limited' ? report.checks.semanticOnlySource.notebook : notebooks[scope];
      // The main row expands its chats; the explicit action opens the notebook.
      await page.getByTestId(`research-notebook-${notebook.id}`).getByRole('button', { name: `Abrir ${notebook.name}`, exact: true }).click();
      await page.getByTestId('research-notebook-home').waitFor();
    }
  };
  const traceFile = path.join(harness.root, 'profile/embedding-trace.jsonl');
  const send = async (name, repetition, question, scope) => {
    const offset = fs.statSync(traceFile).size, before = captured().length;
    await page.getByRole('textbox', { name: /Pregunta al asistente/ }).fill(question);
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    const answer = await waitFor(() => { const answers = captured(); return answers.length > before && answers.at(-1); }, { timeoutMs: 600000, intervalMs: 500 });
    assert(answer, 'Research Chat returned');
    assert.equal(answer.request.model.provider, 'deepseek'); assert.equal(answer.request.model.model, 'deepseek-flash');
    const citations = [];
    for (const id of new Set([...answer.response?.answer?.matchAll(/nodus:\/\/passage\/([^\s)\]"<>]+)/g) ?? []].map(match => decodeURIComponent(match[1])))) {
      const passage = await page.evaluate(id => window.nodus.getPassage(id), id); citations.push({ id, resolvable: Boolean(passage), passage });
    }
    const traces = fs.readFileSync(traceFile).subarray(offset).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const row = { name, repetition, question, scope, ...answer, citations, traces, manualReview: 'pending' };
    report.answers.push(row); save();
    if (answer.error && /budget|presupuesto/i.test(answer.error)) {
      report.budgetExhausted = true; report.pending.push('Remaining Research Chat repetitions: campaign budget exhausted'); save(); return null;
    }
    assert(!answer.error, answer.error); assert(citations.every(citation => citation.resolvable), 'all cited passages resolve');
    // The last rendered message is the returned assistant turn, after persistence.
    await waitFor(() => page.getByRole('button', { name: 'Añadir archivos', exact: true }).isEnabled(), { timeoutMs: 30000 });
    const links = page.locator('[data-message-id]').last().locator('button[data-citation-kind="passage"]');
    row.openedCitations = [];
    for (let index = 0; index < await links.count(); index++) {
      await links.nth(index).click(); await page.getByTestId('source-citation-passage').waitFor();
      const content = await page.getByTestId('source-citation-passage').innerText();
      const matched = citations.find(citation => content.includes(citation.passage.text.slice(0, 80)));
      assert(matched, 'citation dialog displays the captured source text');
      row.openedCitations.push({ id: matched.id, title: matched.passage.work.title, locator: matched.passage.page_label ?? matched.passage.source_ref, content });
      await page.getByTestId('source-citation-close').click();
    }
    row.screenshot = await shot(`chat-${repetition}-${name}`); save(); return row;
  };
  const scenarios = [
    ['single-source', '¿En qué año se abrió la biblioteca de Puerto Claro? Cita la fuente.', 'corpus'],
    ['follow-up', '¿Qué fecha corresponde entonces al laboratorio?', 'follow-up'],
    ['cross-language', 'Which apparatus determines how cloudy a liquid is using a visible beam? Cite the Spanish source.', 'limited'],
    ['negation', '¿El ensayo Vega midió la inteligencia de los participantes?', 'fixed'],
    ['table', 'Presenta una tabla comparando los porcentajes de recuerdo de recuperación espaciada y relectura.', 'fixed'],
    ['contradiction', '¿Cómo se reconcilian las cifras de 239 y 240 participantes en el archivo Bruma?', 'dynamic'],
    ['synthesis', 'Relaciona las limitaciones del ensayo Vega y de la encuesta Bruma.', 'dynamic'],
    ['method', 'Explica la diferencia entre media y mediana en Bruma sin inventar datos.', 'corpus'],
    ['public-paper', '¿Cómo reduce QLoRA la memoria de ajuste del modelo? Cita el artículo.', 'fixed'],
    ['technical', '¿Puede /restore de Linde recuperar una cuenta cerrada?', 'dynamic'],
    ['insufficient-evidence', '¿Cuánto cuesta el sensor Alba en euros?', 'limited'],
    ['insufficient-evidence-2', '¿Quién donó los libros de Puerto Claro?', 'corpus'],
  ];
  chatScenarios: for (let repetition = 0; repetition < 2; repetition++) for (const [name, question, scope] of scenarios) {
    if (report.answers.some(row => row.name === name && row.repetition === repetition && !row.error)) {
      // A skipped first turn cannot provide follow-up history after a restart.
      if (name === 'single-source' && !report.answers.some(row => row.name === 'follow-up' && row.repetition === repetition && !row.error)) {
        await open('corpus'); await send('follow-up-prerequisite', repetition, question, 'corpus');
      }
      continue;
    }
    if (scope !== 'follow-up') await open(scope);
    const row = await send(name, repetition, question, scope); if (!row) break chatScenarios;
    if (scope === 'limited' && name === 'cross-language') {
      assert(row.traces.some(trace => trace.retrieval?.semantic?.some(candidate => trace.retrieval.selected?.some(selected => selected.semanticIds?.includes(candidate.id)))), 'the cross-language chat actually selects semantic candidates');
    }
  }
  if (!report.budgetExhausted && !report.checks.conversationAttachment) {
    // Notebook membership intentionally excludes unpromoted conversation files.
    // A whole-library conversation authorizes its own attachments explicitly.
    await open('corpus');
    const attachment = path.join(harness.root, 'fixtures/conversation-only.txt');
    fs.writeFileSync(attachment, 'The Arco QA mission reserves its amber calibration window for exactly 97 minutes. This conversation-only memo is unrelated to Alba and does not authorize any other document.');
    await app.evaluate(({ dialog }, file) => { globalThis.qaChatPicker = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, attachment);
    try { await page.getByRole('button', { name: 'Añadir archivos', exact: true }).click(); await page.getByRole('button', { name: /Quitar adjunto: conversation-only/ }).waitFor(); }
    finally { await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.qaChatPicker; delete globalThis.qaChatPicker; }); }
    const row = await send('conversation-attachment', 0, '¿Cuántos minutos reserva Arco para su ventana de calibración ámbar? Cita el archivo adjunto.', 'corpus-with-attachment');
    if (row) {
      // Direct attachments deliberately cite their filename in plain text. Also
      // promote the same file explicitly to exercise indexed, clickable evidence.
      const directSupported = row.response.answer.includes('97') && row.response.answer.includes('conversation-only.txt') && !/no puedo responder|no puede determinar/i.test(row.response.answer);
      const source = (await page.evaluate(() => window.nodus.getResearchCorpusSources())).documents.find(document =>
        document.conversationAttachment?.conversationId === row.request.conversationId && row.request.attachmentIds.includes(document.conversationAttachment.attachmentId));
      assert(source, 'the UI attachment is an authorized selectable source');
      const book = await page.evaluate(id => window.nodus.saveResearchNotebook({ name: 'QA explicit conversation file', mode: 'fixed', sources: [{ kind: 'conversation-attachment', id }], exclusions: [] }), source.id);
      await page.evaluate(id => window.nodus.prepareResearchDocuments([id]), source.id);
      assert(await waitFor(async () => (await page.evaluate(() => window.nodus.getResearchPreparationInventory())).documents.find(document => document.id === source.id)?.preparation.embeddings === 'ready', { timeoutMs: 120000 }));
      // This notebook was seeded through the fixture API; remount the UI so its
      // sidebar refreshes the persisted list before opening the real chat.
      await page.reload();
      await page.getByRole('button', { name: 'Research chat', exact: true }).first().click();
      await page.locator('.research-assistant-header').waitFor();
      if (!(await page.getByTestId('research-history-sidebar').isVisible())) await page.getByTestId('research-history-toggle').click();
      await page.getByTestId(`research-notebook-${book.id}`).getByRole('button', { name: `Abrir ${book.name}`, exact: true }).click();
      await page.getByTestId('research-notebook-home').waitFor();
      const promoted = await send('conversation-attachment-indexed', 0, '¿Cuántos minutos reserva Arco para la calibración ámbar? Cita esta fuente.', 'explicit-attachment');
      if (!promoted) return;
      const citations = promoted.citations.filter(citation => citation.passage.conversationAttachment);
      assert(citations.length, 'the explicitly promoted attachment has resolvable citations');
      assert(promoted.traces.some(trace => trace.retrieval?.semantic?.length), 'the promoted file is retrieved semantically');
      const owner = { surface: 'research', conversationId: row.request.conversationId };
      const historyGuard = await page.evaluate(async ({ owner, id }) => {
        try { await window.nodus.removeResearchAttachment(owner, id); return false; }
        catch (error) { return /historial/.test(error.message); }
      }, { owner, id: row.request.attachmentIds[0] });
      assert(historyGuard, 'a sent attachment remains immutable while its conversation exists');
      await page.evaluate(id => window.nodus.deleteConversation(id), owner.conversationId);
      for (const citation of citations) assert.equal(await page.evaluate(id => window.nodus.getPassage(id), citation.id), null, 'removal revokes attachment citation access');
      report.checks.conversationAttachment = { directSupported, indexedSupported: promoted.response.answer.includes('97'), cited: citations.map(citation => citation.id), historyGuard, revoked: true }; save();
    }
  }
  report.checks.chatScopes = [...new Set(report.answers.filter(row => !row.error).map(row => row.scope))]; save();
}
