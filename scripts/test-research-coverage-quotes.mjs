import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archiveRoot = path.join(repo, 'audit/research-chat-grounding/final-82dac50f');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-coverage-quotes-'));
const reportArgument = process.argv.find(argument => argument.startsWith('--report='));
const results = [];
const artifacts = {};

const hash = value => createHash('sha256').update(value).digest('hex');
const record = (name, passed, details = {}) => results.push({ name, passed, ...details });
const readProfile = (file, name, repetition) => {
  const absolute = path.join(archiveRoot, file);
  const raw = fs.readFileSync(absolute, 'utf8');
  artifacts[file] = { path: path.relative(repo, absolute), sha256: hash(raw) };
  const profile = JSON.parse(raw);
  const answer = profile.answers.find(row => row.name === name && row.repetition === repetition);
  assert.ok(answer, `archived answer ${file}/${name}/${repetition} exists`);
  const grounding = answer.traces.find(trace => trace.type === 'research-answer-grounding');
  assert.equal(grounding?.status, 'failed');
  assert.equal(typeof grounding.focusedDraft, 'string');
  const proofs = answer.traces.filter(trace => trace.type === 'research-answer-coverage-proof' && trace.status === 'invalid');
  assert.ok(proofs.length > 0, 'archived invalid coverage proof exists');
  return { answer, grounding, proofs };
};

try {
  const bundle = path.join(temp, 'researchChatGrounding.mjs');
  await build({ entryPoints: [path.join(repo, 'shared/researchChatGrounding.ts')], outfile: bundle,
    bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  const { validResearchAnswerQuotes } = await import(pathToFileURL(bundle).href);
  assert.equal(typeof validResearchAnswerQuotes, 'function', 'shared quote guard is exported');
  record('shared-guard-export', true);

  const syntheticAnswer = 'The measured value is 18 metres. A distinct supported result is 24 people.';
  const maxChars = 512;
  const synthetic = [
    ['legacy-single-span', { answerQuote: 'The measured value is 18 metres.' }, true],
    ['structured-single-span', { answerQuotes: ['The measured value is 18 metres.'] }, true],
    ['structured-multiple-spans', { answerQuotes: ['The measured value is 18 metres.', 'A distinct supported result is 24 people.'] }, true],
    ['zero-spans', { answerQuotes: [] }, false],
    ['more-than-six-spans', { answerQuotes: Array(7).fill('The measured value is 18 metres.') }, false],
    ['over-aggregate-character-limit', { answerQuotes: ['The measured value is 18 metres.', 'A distinct supported result is 24 people.'] }, false, 40],
    ['duplicate-spans', { answerQuotes: ['The measured value is 18 metres.', 'The measured value is 18 metres.'] }, false],
    ['mixed-legacy-and-array-formats', { answerQuote: 'The measured value is 18 metres.', answerQuotes: ['A distinct supported result is 24 people.'] }, false],
    ['fabricated-span', { answerQuotes: ['The measured value is 18 metres.', 'A fabricated organization paid for the survey.'] }, false],
    ['ellipsis-joined-spans', { answerQuote: 'The measured value is 18 metres. ... A distinct supported result is 24 people.' }, false],
    ['meaningless-short-span', { answerQuotes: ['short'] }, false],
    ['non-string-span', { answerQuotes: ['The measured value is 18 metres.', 4] }, false],
  ];
  for (const [name, proof, expected, limit = maxChars] of synthetic) {
    const actual = validResearchAnswerQuotes(syntheticAnswer, proof, limit);
    assert.equal(actual, expected, `${name}: expected ${expected ? 'acceptance' : 'rejection'}`);
    record(`synthetic-${name}`, true);
  }

  // These spans are copied independently from the frozen focusedDraft prose.
  // The helper checks literal presence only; it does not approve semantic coverage.
  const regressions = [
    {
      id: 'multilingual-e5-small-int8/heldout-paper/0',
      file: 'multilingual-e5-small-int8.json', name: 'heldout-paper', repetition: 0,
      spans: [
        '- **NF4**: tipo de dato 4-bit NormalFloat, información-teóricamente óptimo para pesos con distribución normal, que ahorra memoria al almacenar el modelo preentrenado congelado en 4-bit.',
        '- **Doble cuantización**: cuantiza las constantes de cuantización, ahorrando en promedio unos 0,37 bits por parámetro (aproximadamente 3 GB para un modelo de 65B).',
        '- **Optimizadores paginados**: gestionan los picos de memoria, evitando errores de falta de memoria; son críticos para el ajuste QLORA de 33B/65B en una sola GPU de 24/48 GB.',
      ],
    },
    {
      id: 'gte-multilingual-base-int8/heldout-negation/1',
      file: 'gte-multilingual-base-int8.json', name: 'heldout-negation', repetition: 1,
      spans: [
        '**Vega.** En el ensayo Vega, el grupo que practicó recuperación espaciada recordó el 72%; el grupo de relectura, el 51%. No se midió inteligencia. (fixture 07, p. 1)',
        '**Bruma.** La encuesta Bruma incluyó 240 personas de seis pueblos. El intervalo de confianza fue del 95%. La mediana fue 18 y la media 24; no son equivalentes. (fixture 19, p. 1)',
        '**Límites de interpretación.** En Vega, la conclusión no respaldada sería atribuir efectos a la inteligencia, porque no se midió. En Bruma, la conclusión no respaldada sería tratar la mediana (18) y la media (24) como equivalentes, pues la fuente indica que no lo son; además, el 95% corresponde a un nivel o intervalo de confianza declarado, no a una medida de resultado.',
      ],
    },
    {
      id: 'embeddinggemma-2-text-q8-256-v1/heldout-negation/0',
      file: 'embeddinggemma-2-text-q8-256-v1.json', name: 'heldout-negation', repetition: 0,
      spans: [
        '**Vega** midió el recuerdo: en el ensayo Vega, el grupo que practicó recuperación espaciada recordó el 72% y el grupo de relectura, el 51%; no se midió inteligencia (fixture 07, p. 1).',
        '**Bruma** midió una encuesta de 240 personas de seis pueblos, con confianza del 95%, mediana 18 y media 24; la mediana y la media no son equivalentes (fixture 19, p. 1).',
        '*Interpretación (premisas: mediana 18 y media 24, no equivalentes):* la diferencia entre ambas no autoriza a inferir una distribución ni una causa.',
      ],
    },
  ];

  const archivedResults = [];
  for (const regression of regressions) {
    const { grounding, proofs } = readProfile(regression.file, regression.name, regression.repetition);
    const draft = grounding.focusedDraft;
    for (const span of regression.spans) assert.ok(draft.includes(span), `${regression.id}: copied span is present in frozen focusedDraft`);
    assert.equal(validResearchAnswerQuotes(draft, { answerQuotes: regression.spans }, 4000), true,
      `${regression.id}: separate literal spans pass the shared guard`);

    const joined = proofs.flatMap(trace => trace.proof?.addressed ?? []).find(row =>
      typeof row.answerQuote === 'string' && row.answerQuote.includes('...'));
    assert.ok(joined, `${regression.id}: archived invalid proof contains an ellipsis-joined answerQuote`);
    assert.equal(validResearchAnswerQuotes(draft, { answerQuote: joined.answerQuote }, 4000), false,
      `${regression.id}: archived ellipsis-joined answerQuote remains rejected`);

    const fabricated = [...regression.spans, 'A fabricated source establishes an unrelated fact.'];
    assert.equal(validResearchAnswerQuotes(draft, { answerQuotes: fabricated }, 4000), false,
      `${regression.id}: adding an invented fragment invalidates the proof`);
    archivedResults.push({ id: regression.id, focusedDraftSha256: hash(draft),
      invalidJoinedQuoteRejected: true, copiedStructuredSpansAccepted: true, inventedFragmentRejected: true });
    record(`archived-${regression.id}`, true);
  }

  if (reportArgument) {
    const reportPath = reportArgument.slice('--report='.length);
    assert.ok(path.isAbsolute(reportPath), '--report must name an absolute path');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify({ format: 'research-coverage-quotes-regression-v1',
      measuredAt: new Date().toISOString(),
      scope: 'Representation-only helper regressions; archived synthetic traces and local inputs, no providers or quality-rate claims.',
      currentSources: Object.fromEntries(['shared/researchChatGrounding.ts', 'electron/ai/researchChatGrounding.ts']
        .map(file => [file, hash(fs.readFileSync(path.join(repo, file)))])),
      artifacts, results, archivedResults }, null, 2)}\n`);
  }

  console.log(`Research answer quote guard: ${results.length} checks passed across legacy, structured, synthetic safety, and 3 archived regressions.`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
