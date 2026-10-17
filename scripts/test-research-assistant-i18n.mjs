import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr', 'zh-Hans', 'zh-Hant', 'vi', 'ja', 'ru', 'uk', 'ko'];
const require = createRequire(import.meta.url);

async function loadPack() {
  const outfile = path.join(os.tmpdir(), `nodus-research-assistant-${process.pid}.cjs`);
  await build({ entryPoints: [path.join(root, 'shared/researchAssistantPromptPacks.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  try { return require(outfile); } finally { fs.rmSync(outfile, { force: true }); }
}

test('research assistant packs preserve complete rules, schemas, citations and limits', async () => {
  const { researchAssistantPromptPack } = await loadPack();
  const spanish = researchAssistantPromptPack('es');
  assert.equal(spanish.citationRules.length, 17);
  assert.equal(spanish.citationRulesCompact.length, 7);
  assert.equal(spanish.genealogy.full.split('\n').length, 14);
  assert.equal(spanish.genealogy.compact.split('\n').length, 4);
  const protocol = ['nodus://idea/<id>', 'nodus://work/<nodus_id>', 'nodus://passage/<id>', 'nodus://contradiction/<id>', 'nodus://gap/<id>', '`id`', '`citation`', '`pasajes_relevantes`', '`orientacion_documental`', '`documentos_resumidos`', '`parentescos_sugeridos`', '`persona_central`', '`parentesco_con_persona_central`'];
  for (const language of languages) {
    const prompt = researchAssistantPromptPack(language);
    assert.equal(prompt.citationRules.length, spanish.citationRules.length, `${language}: full citation rule count changed`);
    assert.equal(prompt.citationRulesCompact.length, spanish.citationRulesCompact.length, `${language}: compact citation rule count changed`);
    assert.equal(prompt.genealogy.full.split('\n').length, spanish.genealogy.full.split('\n').length, `${language}: genealogy full clause count changed`);
    assert.equal(prompt.genealogy.compact.split('\n').length, spanish.genealogy.compact.split('\n').length, `${language}: genealogy compact clause count changed`);
    const all = [prompt.chat.full, prompt.chat.compact, prompt.genealogy.full, prompt.genealogy.compact, ...prompt.citationRules, ...prompt.citationRulesCompact].join('\n');
    for (const token of protocol) assert.match(all, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${language}: lost ${token}`);
    assert.equal(Object.keys(prompt.context.sections).length, Object.keys(spanish.context.sections).length);
    assert.equal(prompt.context.genealogySections.length, spanish.context.genealogySections.length);
    if (language !== 'es') {
      assert.doesNotMatch(all, /Eres el asistente de investigacion|Responde en espanol|Eres un genealogista experto|CITAS DE FUENTES \(obligatorio|El texto visible del enlace debe ser/i, `${language}: Spanish prose leaked into active pack`);
      assert.doesNotMatch(prompt.titleSystem, /Eres un asistente que pone títulos|en español/i);
      assert.doesNotMatch(prompt.context.note, /Este objeto contiene exclusivamente/i);
    }
  }
  assert.equal(spanish.titleLabels.untitled, 'Conversación sin título');
  assert.equal(spanish.titleSystem, 'Eres un asistente que pone títulos. Devuelve EXCLUSIVAMENTE un título breve (máximo 6 palabras), en español, sin comillas, sin punto final y sin prefijos como "Título:". Resume el tema de la conversación.');
});

test('research assistant wires prompt language into all model-facing branches and genealogy labels', () => {
  const assistant = fs.readFileSync(path.join(root, 'electron/ai/researchAssistant.ts'), 'utf8');
  const genealogy = fs.readFileSync(path.join(root, 'electron/ai/genealogyChatContext.ts'), 'utf8');
  assert.match(assistant, /researchAssistantPromptPack\(promptLanguage\)/);
  assert.match(assistant, /const promptLanguage = getSettings\(\)\.promptLanguage \?\? 'es'/);
  assert.match(assistant, /prompt\.titleSystem/);
  assert.match(assistant, /prompt\.chat\.(compact|full)/);
  assert.match(assistant, /prompt\.genealogy\.(compact|full)/);
  assert.match(assistant, /buildGenealogyContext\(question, promptLanguage\)/);
  assert.match(assistant, /buildResearchContext\(request\.selection, indexedOnly \? indexedTextsQuery\(messages\) : question, contextBudget, promptLanguage\)/);
  assert.match(assistant, /run\.snapshotFromEvidence\(\{ kind: 'research_question', objective: question, language: promptLanguage \}\)/);
  assert.match(assistant, /prompt\.context\.sections/);
  assert.match(genealogy, /language: PromptLanguage = getSettings\(\)\.promptLanguage \?\? 'es'/);
  assert.match(genealogy, /treeKinshipLabel\(relative, normalizeUiLanguage\(language\)\)/);
  for (const key of ['contexto_familiar', 'conversacion', 'contexto_modular_seleccionado', 'contrato_de_salida_obligatorio']) {
    assert.match(assistant, new RegExp(key), `protocol key ${key} changed`);
  }
});
