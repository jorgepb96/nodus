import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko'];
const require = createRequire(import.meta.url);

async function load(entry, label, plugins = []) {
  const outfile = path.join(os.tmpdir(), `nodus-${label}-${process.pid}.cjs`);
  await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: 'node', format: 'cjs', outfile, plugins, logLevel: 'silent' });
  try { return require(outfile); } finally { fs.rmSync(outfile, { force: true }); }
}

test('notes-order prompts are native in all locales and preserve the ordering contract', async () => {
  const prompts = await load('shared/notesOrderPromptPacks.ts', 'notes-order-prompts');
  const spanish = prompts.notesOrderPromptPack('es');
  assert.equal(spanish.system, 'Eres un editor académico. Ordena un conjunto de notas de investigación para que la sucesión de una nota tras otra tenga lógica: de lo general a lo concreto, respetando dependencias conceptuales (definiciones y premisas antes que sus consecuencias) y agrupando temas afines. Devuelve EXCLUSIVAMENTE un JSON con la forma {"order": ["id1","id2", ...]} usando los id exactos proporcionados, incluyendo todos los id una sola vez, sin inventar ni omitir ninguno.');
  for (const language of languages) {
    const prompt = prompts.notesOrderPromptPack(language);
    for (const token of ['order', 'id1', 'id2']) assert.match(prompt.system, new RegExp(token));
    for (const field of ['title', 'summary', 'notes', 'returnOrder']) assert.ok(prompt[field], `${language}: missing ${field}`);
    if (language !== 'es') assert.doesNotMatch(Object.values(prompt).join('\n'), /Eres un editor académico|Devuelve el orden lógico|incluyendo todos los id una sola vez/i);
  }
});

test('connection-reprocessing prompts preserve schemas, enums, thresholds and rules', async () => {
  const prompts = await load('shared/reprocessConnectionsPromptPacks.ts', 'reprocess-prompts');
  const spanish = prompts.reprocessConnectionsPromptPack('es');
  for (const language of languages) {
    const prompt = prompts.reprocessConnectionsPromptPack(language);
    for (const token of ['assignments', 'id', 'themes', 'available_themes']) assert.match(`${prompt.themeSystem}${prompt.themeLockedRule}${prompt.themeOpenRule}`, new RegExp(token));
    for (const token of ['relations', 'from', 'to', 'type', 'confidence', 'rationale', 'extends', 'contradicts', 'applies_to', 'shares_method', 'precondition_of', 'measures_same', 'supports', 'refutes', 'variant_of', 'refines', '0.7', '1.0', '0.4']) assert.match(prompt.relationSystem, new RegExp(token.replace('.', '\\.')));
    assert.equal((prompt.themeSystem.match(/^- /gm) ?? []).length, (spanish.themeSystem.match(/^- /gm) ?? []).length, `${language}: theme rule count changed`);
    assert.equal((prompt.relationSystem.match(/^- /gm) ?? []).length, (spanish.relationSystem.match(/^- /gm) ?? []).length, `${language}: relation rule count changed`);
    if (language !== 'es') assert.doesNotMatch(Object.values(prompt).join('\n'), /Eres el motor|Si varias ideas|Evalúa cada par|No inventes relaciones|una frase breve en español/i);
  }
});

test('matrix and work-synthesis prompts are native and retain their JSON contracts', async () => {
  const prompts = await load('shared/synthesisPromptPacks.ts', 'synthesis-prompts');
  for (const language of languages) {
    const prompt = prompts.synthesisPromptPack(language);
    for (const token of ['stance']) assert.match(prompt.matrixSystem, new RegExp(token));
    for (const token of ['thesis', 'remember', 'positioning', '3', '6']) assert.match(prompt.workSystem(6), new RegExp(token));
    for (const type of ['claim', 'finding', 'construct', 'method', 'framework']) assert.ok(prompt.ideaTypes[type], `${language}: missing ${type}`);
    for (const field of ['matrixAuthor', 'matrixTheme', 'matrixIdeas', 'matrixReturn', 'work', 'authors', 'themes', 'workIdeas', 'connections', 'workReturn', 'noAuthorship', 'noThemes', 'noConnections', 'primary', 'secondary']) assert.ok(prompt[field], `${language}: missing ${field}`);
    if (language !== 'es') assert.doesNotMatch(`${prompt.matrixSystem}\n${prompt.workSystem(6)}\n${prompt.matrixReturn}\n${prompt.workReturn}`, /Eres un asistente|Devuelve EXCLUSIVAMENTE|No inventes nada|Trabaja solo con las ideas/i);
  }
});

test('manuscript-verifier prompts preserve statuses, evidence rules and schema', async () => {
  const prompts = await load('shared/manuscriptVerifierPromptPacks.ts', 'manuscript-verifier-prompts');
  const spanish = prompts.manuscriptVerifierPrompt('es');
  assert.match(spanish, /Eres un verificador academico/);
  for (const language of languages) {
    const prompt = prompts.manuscriptVerifierPrompt(language);
    for (const token of ['missing_citation', 'covered', 'own_argument', 'weak_match', 'evidenceIds', 'kind:id', 'high|medium|low|info', 'replacementHint']) assert.ok(prompt.includes(token), `${language}: missing ${token}`);
    assert.equal((prompt.match(/\n/g) ?? []).length, (spanish.match(/\n/g) ?? []).length, `${language}: verifier clause count changed`);
    if (language !== 'es') assert.doesNotMatch(prompt, /Eres un verificador|No recibes el manuscrito|Tu tarea es clasificar|No inventes fuentes|Escribe rationale/i);
  }
});

test('study-knowledge extraction prompts preserve vocabularies and evidence schema', async () => {
  const prompts = await load('shared/studyKnowledgePromptPacks.ts', 'study-knowledge-prompts');
  const spanish = prompts.studyKnowledgePromptPack('es');
  for (const language of languages) {
    const prompt = prompts.studyKnowledgePromptPack(language);
    for (const token of ['ideas', 'key', 'type', 'concept', 'definition', 'principle', 'process', 'cause', 'consequence', 'example', 'debate', 'relations', 'related', 'supports', 'contrasts', 'causes', 'depends_on', 'part_of', 'applies', 'principal|secondary', 'evidence', 'quote', 'location']) assert.ok(prompt.system.includes(token), `${language}: missing ${token}`);
    assert.equal((prompt.system.match(/\n/g) ?? []).length, (spanish.system.match(/\n/g) ?? []).length, `${language}: knowledge clause count changed`);
    for (const field of ['title', 'text', 'insufficientText', 'externalPurpose', 'connection']) assert.ok(prompt[field], `${language}: missing ${field}`);
    if (language !== 'es') assert.doesNotMatch(prompt.system, /Analiza material docente|Extrae solo ideas|Cada idea necesita|No inventes páginas|Devuelve JSON/i);
  }
});

test('study diarization prompts are native and preserve timing/speaker schema', async () => {
  const prompts = await load('shared/studyDiarizationPromptPacks.ts', 'study-diarization-prompts');
  for (const language of languages) {
    const prompt = prompts.studyDiarizationPromptPack(language);
    const text = [prompt.expected(3), prompt.inferSpeakers, prompt.analyze, prompt.json, prompt.turns, prompt.noNames, prompt.transcript].join('\n');
    for (const token of ['segments', 'startSeconds', 'endSeconds', 'speaker', 'speaker_1', 'text', 'confidence', '0.95']) assert.ok(text.includes(token), `${language}: missing ${token}`);
    assert.match(prompt.expected(3), /3/);
    if (language !== 'es') assert.doesNotMatch(text, /Se esperan aproximadamente|Determina el número de hablantes|Analiza acústicamente|Devuelve exclusivamente|Crea un segmento por turno|No inventes nombres propios|La transcripción existente/i);
  }
});

test('workflow consumers select the configured prompt language', () => {
  const notes = fs.readFileSync(path.join(root, 'electron/ai/notesOrder.ts'), 'utf8');
  const reprocess = fs.readFileSync(path.join(root, 'electron/ai/reprocessConnections.ts'), 'utf8');
  const matrix = fs.readFileSync(path.join(root, 'electron/ai/synthesisMatrix.ts'), 'utf8');
  const work = fs.readFileSync(path.join(root, 'electron/ai/workIdeaSynthesis.ts'), 'utf8');
  const verifier = fs.readFileSync(path.join(root, 'electron/ai/manuscriptVerifier.ts'), 'utf8');
  const knowledge = fs.readFileSync(path.join(root, 'electron/ai/studyKnowledge.ts'), 'utf8');
  const diarization = fs.readFileSync(path.join(root, 'electron/ai/studyDiarization.ts'), 'utf8');
  assert.match(notes, /notesOrderPromptPack\(getSettings\(\)\.promptLanguage \?\? 'es'\)/);
  assert.match(reprocess, /reprocessConnectionsPromptPack\(settings\.promptLanguage \?\? 'es'\)/);
  assert.match(reprocess, /system: prompt\.relationSystem/);
  assert.match(matrix, /language\?:PromptLanguage/);
  assert.match(matrix, /synthesisPromptPack\(language\s*\?\?\s*getSettings\(\)\.promptLanguage \?\? 'es'\)/);
  assert.match(matrix, /const source=prepareMatrixCellSynthesis\(authorId,themeId\)/);
  assert.match(work, /synthesisPromptPack\(getSettings\(\)\.promptLanguage \?\? 'es'\)/);
  assert.match(verifier, /manuscriptVerifierPrompt\(language\)/);
  assert.match(knowledge, /buildStudyKnowledgePrompt\(source\.title, chunk, language\)/);
  assert.match(knowledge, /studyKnowledgePromptPack\(getSettings\(\)\.promptLanguage \?\? 'es'\)/);
  assert.match(diarization, /getSettings\(\)\.promptLanguage \?\? 'es'/);
  assert.match(diarization, /transcriptPrompt\(transcript, expectedSpeakers, language\)/);
});


test('matrix synthesis honors explicit language, then configured language, then Spanish', async () => {
  const matrix = await load('electron/ai/synthesisMatrix.ts', 'matrix-language', [{
    name: 'matrix-language-isolated-io',
    setup(api) {
      api.onResolve({filter: /\.\.\/db\/(database|settingsRepo)$|\.\/aiClient$/}, ({path: source}) => ({path: source, namespace: 'matrix-fixture'}));
      api.onLoad({filter: /.*/, namespace: 'matrix-fixture'}, ({path: source}) => ({loader: 'js', contents:
        source.endsWith('database') ? `export const getDb = () => ({prepare: (sql) => ({get: () => sql.includes('authors') ? {name:'Fixture author'} : {label:'Fixture theme'}, all: () => [{global_id:'fixture-idea',label:'Fixture idea',type:'concept',statement:'Fixture evidence'}]})});` :
        source.endsWith('settingsRepo') ? `export const getSettings = () => globalThis.__matrixPromptSettings;` :
        `export const completeJson = async () => { throw new Error('preparing a prompt must never invoke a provider'); };`
      }));
    },
  }]);
  const prompts = await load('shared/synthesisPromptPacks.ts', 'matrix-language-packs');
  try {
    for (const language of languages) {
      globalThis.__matrixPromptSettings = {promptLanguage: language};
      const configured = matrix.prepareMatrixCellSynthesis('fixture-author', 'fixture-theme');
      assert.equal(configured.prompt.system, prompts.synthesisPromptPack(language).matrixSystem);
      assert.match(configured.prompt.user, /Fixture evidence/);
      const explicit = language === 'es' ? 'en' : 'es';
      assert.equal(matrix.prepareMatrixCellSynthesis('fixture-author', 'fixture-theme', explicit).prompt.system, prompts.synthesisPromptPack(explicit).matrixSystem);
    }
    globalThis.__matrixPromptSettings = {};
    assert.equal(matrix.prepareMatrixCellSynthesis('fixture-author', 'fixture-theme').prompt.system, prompts.synthesisPromptPack('es').matrixSystem);
  } finally { delete globalThis.__matrixPromptSettings; }
});
