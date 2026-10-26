import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!process.argv.includes('--electron-genealogy-demo-test')) {
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/test-genealogy-demo.mjs'), '--electron-genealogy-demo-test'],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(0);
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-geneademo-test-'));
installRuntimeHooks(root);

// A 1×1 PNG so the portrait pipeline (nativeImage → JPEG) has real bytes to process.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

try {
  const demo = require(path.join(repoRoot, 'electron/db/genealogyDemoData.ts'));
  const portraits = require(path.join(repoRoot, 'electron/ai/genealogyDemoPortraits.ts'));
  const entities = require(path.join(repoRoot, 'electron/db/entitiesRepo.ts'));
  const rels = require(path.join(repoRoot, 'electron/db/relationshipsRepo.ts'));
  const sug = require(path.join(repoRoot, 'electron/db/kinshipSuggestionsRepo.ts'));
  const archive = require(path.join(repoRoot, 'electron/db/archiveRepo.ts'));
  const social = require(path.join(repoRoot, 'electron/db/socialRepo.ts'));
  const personPlaces = require(path.join(repoRoot, 'electron/db/personPlacesRepo.ts'));
  const orch = require(path.join(repoRoot, 'electron/archive/archiveDiscovery.ts'));
  const { getSettings, updateSettings } = require(path.join(repoRoot, 'electron/db/settingsRepo.ts'));
  const { getActiveVault } = require(path.join(repoRoot, 'electron/vaults/vaultRegistry.ts'));
  const { clearDemoData } = require(path.join(repoRoot, 'electron/db/demoData.ts'));
  const { getDb } = require(path.join(repoRoot, 'electron/db/database.ts'));

  const priorType = getActiveVault().type;

  // ── Seed ──────────────────────────────────────────────────────────────────
  updateSettings({ genealogyTourComplete: true });
  assert.equal(demo.seedGenealogyDemoData(), true, 'seeded on an empty vault');
  assert.equal(demo.seedGenealogyDemoData(), false, 'idempotent: no re-seed when data exists');

  // Vault flipped to genealogy; prior type remembered for restore.
  assert.equal(getActiveVault().type, 'genealogy', 'active vault is now genealogy');
  assert.equal(getSettings().demoMode, true, 'demo flag set');
  assert.equal(getSettings().genealogyTourComplete, true, 'loading the demo preserves the tutorial decision');
  assert.equal(getSettings().demoPriorVaultType, priorType, 'prior vault type remembered');

  const counts = entities.recordCounts();
  assert.equal(counts.persons, 14, 'all demo persons seeded');
  assert.ok(counts.events >= 10, 'events seeded');
  assert.ok(counts.places >= 4, 'places seeded');
  assert.equal(archive.archiveCounts().items, 9, 'archive documents seeded');
  assert.equal(rels.allRelationships().length, 18, 'kinship relationships seeded');

  // ── Map: per-person place records drive the individual + general maps ───────
  const allMapPoints = personPlaces.mapPoints();
  assert.ok(allMapPoints.length >= 15, 'demo person-places seeded and located on the map');
  assert.ok(allMapPoints.every((p) => p.latitude != null && p.longitude != null), 'every map point is located');
  const rafael = entities.listPersons({ search: 'Rafael Serrano' })[0];
  assert.ok(rafael, 'the emigrant Rafael persisted');
  const rafaelPlaces = personPlaces.listPersonPlaces(rafael.personId);
  assert.ok(rafaelPlaces.some((p) => p.placeName === 'Carmona') && rafaelPlaces.some((p) => p.placeName === 'Sevilla'), 'Rafael moves Carmona → Sevilla');
  assert.equal(rafaelPlaces[0].placeName, 'Carmona', 'his record starts at Carmona (birth) chronologically');
  assert.ok(rafaelPlaces.every((p) => p.country === 'España'), 'demo places carry their country for display');
  // The general map spans more than one municipality (Carmona, Sevilla, Écija).
  assert.ok(new Set(allMapPoints.map((p) => p.placeId)).size >= 3, 'the family spreads across several places');

  // ── Social-relations network: a SECOND graph, independent from kinship ──────
  assert.equal(social.listSocialContacts().length, 2, 'demo social contacts seeded');
  const socialGraph = social.socialGraph();
  assert.equal(socialGraph.edges.length, 3, 'demo social relations seeded');
  assert.ok(socialGraph.nodes.some((n) => n.kind === 'contact'), 'a contact node appears in the network');
  assert.ok(socialGraph.nodes.some((n) => n.kind === 'person'), 'a tree-person node appears in the network');

  // Kinship suggestions: 3 open proposals awaiting review, with evidence + strength.
  const open = sug.listOpenSuggestions();
  assert.equal(open.length, 3, 'three open kinship suggestions surface');
  const spouseSug = open.find((s) => s.type === 'spouse');
  assert.ok(spouseSug, 'a spouse suggestion surfaces');
  assert.equal(spouseSug.strength, 'alta', 'two corroborating sources → alta');
  assert.equal(spouseSug.evidence.length, 2, 'record + explicit-claim evidence both retained');
  assert.ok(spouseSug.evidence.some((e) => e.quote && e.quote.length > 0), 'evidence carries verbatim quotes');

  // No suggestion duplicates a relationship already asserted.
  const juan = entities.listPersons({ search: 'Tomás Serrano' })[0];
  assert.ok(juan, 'Tomás persisted');
  assert.equal(
    sug.listSuggestionsForPerson(juan.personId).length,
    0,
    'confirmed family (Tomás) has no pending suggestions'
  );

  // ── Document ↔ person discovery (lexical, AI-free) ─────────────────────────
  // The 1925 letter names Amparo but is only linked to Rafael → Amparo is proposed.
  const letter = archive.listItems({ search: 'Carta de Amparo' })[0];
  assert.ok(letter, 'letter document present');
  const suggestedPersons = orch.suggestPersonsForItem(letter.itemId);
  assert.ok(
    suggestedPersons.some((p) => p.displayName.includes('Amparo')),
    'a named-but-unlinked person is proposed for the document'
  );

  // Name variants power identity search (Encarna → Encarnación).
  assert.ok(entities.listPersons({ search: 'Encarna' }).length >= 1, 'name variant is searchable');

  // ── Portraits (injected generator — no network) ────────────────────────────
  let calls = 0;
  const result = await portraits.generateDemoPortraits({
    generator: async (prompt) => {
      calls++;
      assert.match(prompt, /daguerreotype/i, 'prompt asks for a daguerreotype');
      assert.match(prompt, /centered/i, 'prompt asks for a centered face');
      return PNG_1PX;
    },
  });
  assert.equal(result.generated, 14, 'a portrait generated for every demo person');
  assert.equal(calls, 14);
  const withPortrait = entities.getPerson(entities.listPersons()[0].personId);
  assert.ok(withPortrait.portrait, 'portrait focus stored');
  assert.equal(withPortrait.portrait.focusY, 0.42, 'face centered slightly above middle');

  const promptSample = portraits.buildDaguerreotypePrompt({ name: 'X', sex: 'female', birthYear: 1868, portrait: 'a woman' });
  assert.match(promptSample, /black-and-white/i, 'monochrome portrait');
  assert.match(promptSample, /No text/i, 'no-text guardrail present');

  // ── Global search adapts: persons, events and archive documents are findable ──
  const { globalSearch } = require(path.join(repoRoot, 'electron/db/searchRepo.ts'));
  const byName = globalSearch('Serrano', 8);
  assert.ok(byName.some((r) => r.kind === 'person'), 'search finds persons by name');
  assert.ok(byName.some((r) => r.kind === 'person' && r.title.includes('Serrano')), 'person result carries the name');
  const byPlace = globalSearch('Carmona', 8);
  assert.ok(byPlace.some((r) => r.kind === 'event'), 'search finds events by place');
  assert.ok(byPlace.some((r) => r.kind === 'archive'), 'search finds archive documents by text');
  // A name variant is searchable too (Encarna → Encarnación).
  assert.ok(globalSearch('Encarna', 8).some((r) => r.kind === 'person'), 'search matches a person name variant');

  // ── Genealogy chat context: family-history material assembled from a question ──
  const { buildGenealogyContext } = require(path.join(repoRoot, 'electron/ai/genealogyChatContext.ts'));
  const tomasPerson = entities.listPersons({ search: 'Tomás Serrano Campos' })[0];
  updateSettings({ treeFocusPersonId: tomasPerson.personId });
  const ctx = await buildGenealogyContext('¿Quiénes eran los padres de Tomás Serrano y qué dice su partida de bautismo?');
  assert.equal(ctx.resumen.personas, 14, 'the whole family is in the context');
  const tomas = ctx.personas.find((p) => p.nombre === 'Tomás Serrano Campos');
  assert.ok(tomas, 'the mentioned person is present');
  assert.equal(ctx.persona_central.nombre, 'Tomás Serrano Campos', 'the persisted tree focus reaches the AI context');
  assert.equal(tomas.parentesco_tag, 'focus', 'the protagonist is tagged as the focus person');
  assert.equal(tomas.parentesco_con_persona_central, 'Persona principal', 'the visible Spanish kinship tag reaches both assistants');
  assert.ok(ctx.personas.some((person) => person.parentesco_tag === 'father' || person.parentesco_tag === 'mother'), 'parents receive focus-relative tags');
  assert.ok(tomas.padres.length >= 2, 'kinship resolved (parents present)');
  assert.ok(tomas.relevante_para_la_consulta, 'a person named in the question is flagged relevant');
  assert.ok(ctx.eventos.length > 0, 'life events assembled');
  assert.ok(ctx.documentos.length > 0, 'documents assembled');
  assert.ok(ctx.evidencia.some((e) => e.persona.includes('Tomás')), 'cited evidence for the mentioned person');
  assert.equal(ctx.parentescos_sugeridos.length, 3, 'open kinship suggestions surfaced as hypotheses');

  // ── Genealogy Deep Research: retrieve sources by embedding + write with full text ──
  const gdr = require(path.join(repoRoot, 'electron/ai/genealogyDeepResearch.ts'));
  const gsources = await gdr.buildGenealogySourcePool('la partida de bautismo de Tomás Serrano y sus padres');
  assert.ok(gsources.length > 0 && gsources.some((s) => s.kind === 'document'), 'source pool has documents (fallback works without embeddings)');
  const family = gdr.buildFamilyFacts();
  assert.equal(family.personas.length, 14, 'family facts include the whole family');

  const seenCoverageQuestions = [];
  const fakeDeps = {
    planReport: async (input) => ({
      title: 'Los Serrano–Vidal',
      abstract: 'Informe de ejemplo.',
      sections: [
        { id: 's1', title: 'Orígenes de la familia', purpose: 'Presentar la familia.', keyPoints: ['a'], sourceIds: input.sources.slice(0, 2).map((s) => s.id) },
        { id: 's2', title: 'Síntesis y fuentes', purpose: 'Cerrar.', keyPoints: [], sourceIds: [] },
      ],
    }),
    writeSection: async (input) => {
      seenCoverageQuestions.push(...(input.section.coverageQuestions ?? []));
      const first = input.sources[0];
      const good = first ? `[${first.title}](nodus://archive/${first.id.replace(/^doc:/, '')})` : '';
      // The section is given the assigned documents' FULL TEXT — assert it arrived.
      assert.ok(!first || typeof first.texto === 'string', 'assigned source carries full text');
      return `## ${input.section.title}\n\nDesarrollo ${good}, y una cita inventada [x](nodus://archive/inexistente).`;
    },
    finalize: async () => ({ title: 'Los Serrano–Vidal', abstract: 'Resumen final.', limitations: ['Vínculos por probar.'], nextSteps: ['Buscar más partidas.'] }),
    auditFinalSummary: async (input, draft) => {
      assert.ok(input.sectionFindings?.some((finding) => finding.text.includes('Desarrollo')), 'the genealogy summary audit sees grounded section findings');
      assert.equal(draft.abstract, 'Resumen final.');
      return { title: draft.title, abstract: 'Resumen final acotado a los documentos citados.', limitations: [], nextSteps: draft.nextSteps };
    },
    resolveWorkFullText: async () => '',
  };
  const report = await gdr.orchestrateGenealogyDeepResearch(
    {
      objective: 'Historia de la familia Serrano',
      coverageQuestions: ['¿Qué prueba la partida de bautismo?', '¿Qué vínculos siguen siendo inciertos?'],
      sectionLimit: 2,
      language: 'es',
    },
    gsources,
    family,
    fakeDeps
  );
  assert.equal(report.meta.sections, 2, 'both planned sections written');
  assert.ok(report.draft.draftMarkdown.includes('## Orígenes de la familia'), 'section rendered');
  assert.ok(report.draft.draftMarkdown.includes('## Fuentes'), 'sources/references section rendered');
  assert.ok(!report.draft.draftMarkdown.includes('inexistente'), 'a hallucinated citation is stripped');
  assert.ok(report.draft.bibliography.length > 0, 'cited documents listed in references');
  assert.ok(report.draft.matrix.length > 0, 'support matrix built from the cited sources');
  assert.ok(report.draft.draftMarkdown.includes('Limitaciones'), 'genealogical limitations included');
  assert.equal(report.draft.abstract, 'Resumen final acotado a los documentos citados.', 'the cold summary audit can narrow the abstract');
  assert.ok(report.draft.limitations.includes('Vínculos por probar.'), 'the cold summary audit cannot erase an established limitation');
  assert.deepEqual([...new Set(seenCoverageQuestions)].sort(), ['¿Qué prueba la partida de bautismo?', '¿Qué vínculos siguen siendo inciertos?'].sort(), 'every genealogy coverage question reaches a section even when the planner omits assignments');
  assert.ok(report.draft.qualityAssessment, 'genealogy persists the shared professional quality assessment');

  const continuousReport = await gdr.orchestrateGenealogyDeepResearch(
    { objective: 'Historia continua de la familia Serrano', sectionLimit: 'single', language: 'es' },
    gsources,
    family,
    fakeDeps,
  );
  assert.equal(continuousReport.meta.structure, 'single', 'genealogy persists continuous structure metadata');
  assert.equal(continuousReport.meta.sections, 1, 'genealogy publishes one logical block');
  assert.equal(continuousReport.draft.outline.length, 0, 'genealogy hides its internal evidence movements');
  assert.equal((continuousReport.draft.draftMarkdown.match(/^#{1,6}\s+/gmu) ?? []).length, 0, 'genealogy continuous prose has no section headings');
  assert.ok(continuousReport.draft.bibliography.length > 0, 'genealogy continuous mode keeps cited sources');

  // ── Clear restores everything ──────────────────────────────────────────────
  clearDemoData();
  assert.equal(entities.recordCounts().persons, 0, 'persons cleared');
  assert.equal(archive.archiveCounts().items, 0, 'archive cleared');
  assert.equal(sug.listOpenSuggestions().length, 0, 'suggestions cleared');
  assert.equal(social.listSocialContacts().length, 0, 'social contacts cleared');
  assert.equal(social.socialGraph().edges.length, 0, 'social relations cleared');
  assert.equal(personPlaces.mapPoints().length, 0, 'per-person place records cleared');
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS n FROM person_portraits').get().n,
    0,
    'portraits cleared'
  );
  assert.equal(getActiveVault().type, priorType, 'vault type restored on exit');
  assert.equal(getSettings().demoMode, false, 'demo flag cleared');
  assert.equal(getSettings().demoPriorVaultType, null, 'prior type reset');

  console.log('Genealogy demo test passed!');
} finally {
  await rm(root, { recursive: true, force: true });
}

function installRuntimeHooks(userDataPath) {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  const originalLoad = Module._load;
  const electronStub = {
    app: {
      getPath: () => userDataPath,
      getVersion: () => '0.0.0-test',
      getAppPath: () => repoRoot,
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (v) => Buffer.from(String(v), 'utf8'),
      decryptString: (v) => Buffer.from(v).toString('utf8'),
    },
    // Minimal nativeImage: the portrait pipeline only resizes + re-encodes; a passthrough
    // is enough to exercise the flow without the real (GUI-only) image backend.
    nativeImage: {
      createFromBuffer: (bytes) => ({
        isEmpty: () => !bytes || bytes.length === 0,
        getSize: () => ({ width: 512, height: 512 }),
        resize: () => ({ toJPEG: () => bytes }),
      }),
    },
    dialog: {},
    shell: {},
    BrowserWindow: class {},
  };
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
      .replace(/\bimport\.meta\.url\b/g, JSON.stringify(pathToFileURL(filename).href));
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
