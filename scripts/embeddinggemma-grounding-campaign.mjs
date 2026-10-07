import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { createResearchApp, reserveLoopbackPort } from './lib/research-app-harness.mjs';
import { checkEmbeddingProductChat } from './lib/embedding-product-chat.mjs';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const stage = argument('stage') ?? 'development';
assert(['development', 'repair', 'evaluation'].includes(stage));
const baseline = JSON.parse(fs.readFileSync('audit/embeddinggemma-2/campaign.json', 'utf8'));
const selected = argument('profiles')?.split(',') ?? baseline.products.map(product => product.profile);
assert(selected.every(profile => baseline.products.some(product => product.profile === profile)));
const childRoot = argument('root');
const resume = process.argv.includes('--resume');
const harnessRepair = process.argv.includes('--resume-harness-repair');
assert(!harnessRepair || resume, 'harness repair requires an explicit resume');
const scenarioDefinition = source => {
  const file = ts.createSourceFile('campaign.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let definition;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'scenarios') {
      assert(ts.isConditionalExpression(node.initializer));
      const array = stage === 'evaluation' ? node.initializer.whenFalse : node.initializer.whenTrue;
      assert(ts.isArrayLiteralExpression(array));
      definition = array.elements.map(tuple => { assert(ts.isArrayLiteralExpression(tuple)); return tuple.elements.map(value => { assert(ts.isStringLiteral(value)); return value.text; }); });
    }
    ts.forEachChild(node, visit);
  };
  visit(file); assert(definition); return definition;
};
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const runtimeFiles = ['electron/ai/researchAssistant.ts', 'electron/ai/researchClaimAudit.ts', 'electron/ai/researchChatGrounding.ts',
  'electron/ai/researchTurnPlanner.ts', 'shared/researchChatGrounding.ts', 'shared/mainProcessErrors.ts'];
const sourceVersion = { gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  files: Object.fromEntries(runtimeFiles.map(file => [file, hash(file)])),
  applicationEntry: hash('dist-electron/application.js'), campaignDefinition: hash('scripts/embeddinggemma-grounding-campaign.mjs'),
  chatHarness: hash('scripts/lib/embedding-product-chat.mjs'), node: process.version };
if (!childRoot) {
  // Processes and embedding spaces remain separate; the shared proxy admits only
  // two paid calls at once and retains the original campaign-wide $5 ledger.
  const runs = [];
  for (let offset = 0; offset < selected.length; offset += 2) {
    runs.push(...await Promise.all(selected.slice(offset, offset + 2).map(async profile => {
      const product = baseline.products.find(product => product.profile === profile);
      const log = path.join(product.root, 'artifacts', `grounding-${stage}.log`);
      const fd = fs.openSync(log, 'a');
      const child = spawn(process.execPath, ['scripts/embeddinggemma-grounding-campaign.mjs', `--stage=${stage}`, `--root=${product.root}`, `--profiles=${profile}`, ...(resume ? ['--resume'] : []), ...(harnessRepair ? ['--resume-harness-repair'] : [])], { stdio: ['ignore', fd, fd] });
      let code;
      try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
      finally { fs.closeSync(fd); }
      return { profile, code, log, report: path.join(product.root, 'artifacts', `grounding-${stage}.json`) };
    })));
    console.log(JSON.stringify(runs.slice(-2)));
  }
  if (runs.some(run => run.code !== 0)) process.exitCode = 1;
} else {
  assert.equal(selected.length, 1);
  const profile = selected[0], product = baseline.products.find(product => product.profile === profile);
  assert.equal(fs.realpathSync(childRoot), fs.realpathSync(product.root));
  const previous = JSON.parse(fs.readFileSync(path.join(childRoot, 'artifacts/product-report.json'), 'utf8'));
  assert(previous.completed && previous.profile === profile);
  const localPort = await reserveLoopbackPort();
  const harness = await createResearchApp({ root: childRoot, realProvider: { campaignRoot: previous.campaignRoot, proxyOptions: { limitUsd: 5, allowedProviders: ['deepseek'] } },
    extraPorts: [localPort], extraEnv: { NODUS_EMBEDDING_QA_TRACE: '1', NODUS_LOCAL_AI_QA_PORT: String(localPort) } });
  const report = { format: 'nodus.research-chat-grounding/1', root: childRoot, campaignRoot: previous.campaignRoot, stage, profile,
    baselineSourceCommit: baseline.versions.gitHead, sourceVersion, isolation: harness.proof, completed: false, answers: [], pending: [],
    notebooks: previous.notebooks, checks: { semanticOnlySource: previous.checks.semanticOnlySource }, startedAt: new Date().toISOString() };
  const output = path.join(childRoot, 'artifacts', `grounding-${stage}.json`);
  if (fs.existsSync(output)) {
    const prior = JSON.parse(fs.readFileSync(output, 'utf8'));
    fs.copyFileSync(output, path.join(childRoot, 'artifacts', `grounding-${stage}-previous-${Date.now()}.json`));
    if (resume) {
      assert.equal(prior.stage, stage); assert.equal(prior.profile, profile);
      assert.deepEqual(prior.sourceVersion.files, sourceVersion.files, 'cannot resume a different implementation as the same campaign');
      assert.equal(prior.sourceVersion.applicationEntry, sourceVersion.applicationEntry);
      if (harnessRepair) {
        const old = execFileSync('git', ['show', `${prior.sourceVersion.gitHead}:scripts/embeddinggemma-grounding-campaign.mjs`], { encoding: 'utf8' });
        assert.equal(createHash('sha256').update(old).digest('hex'), prior.sourceVersion.campaignDefinition);
        assert.deepEqual(scenarioDefinition(old), scenarioDefinition(fs.readFileSync('scripts/embeddinggemma-grounding-campaign.mjs', 'utf8')), 'harness-only resume cannot change the questions');
        report.harnessRepair = { reason: 'Use history search to locate virtualised notebook rows; runtime, model settings, repetitions and questions remain fixed.', previousSourceVersion: prior.sourceVersion };
      } else {
        assert.equal(prior.sourceVersion.campaignDefinition, sourceVersion.campaignDefinition);
        assert.equal(prior.sourceVersion.chatHarness, sourceVersion.chatHarness);
      }
      report.answers = prior.answers.filter(answer => !answer.error);
      report.priorFailures = [...(prior.priorFailures ?? []), ...prior.answers.filter(answer => answer.error)];
      report.resumedAt = report.startedAt; report.startedAt = prior.startedAt;
    }
  }
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
  const shot = async name => {
    const file = path.join(childRoot, 'artifacts', `grounding-${stage}-${name}.png`);
    await harness.page.screenshot({ path: file, animations: 'disabled' }); return file;
  };
  const scenarios = stage !== 'evaluation' ? [
    ['technical', '¿Puede /restore de Linde recuperar una cuenta cerrada?', 'dynamic'],
    ['method', 'Explica la diferencia entre media y mediana en Bruma sin inventar datos.', 'corpus'],
    ['table', 'Presenta una tabla comparando los porcentajes de recuerdo de recuperación espaciada y relectura.', 'fixed'],
    ['synthesis', 'Relaciona las limitaciones del ensayo Vega y de la encuesta Bruma.', 'dynamic'],
    ['public-paper', '¿Cómo reduce QLoRA la memoria de ajuste del modelo? Cita el artículo.', 'fixed'],
    ['single-source', '¿En qué año se abrió la biblioteca de Puerto Claro? Cita la fuente.', 'corpus'],
  ] : [
    ['heldout-dates', 'Identifica por separado los años de apertura de la biblioteca y del laboratorio de Puerto Claro.', 'corpus'],
    ['heldout-sensor', 'Which quantity does Alba determine using visible light, and which quantity does it explicitly exclude?', 'limited'],
    ['heldout-calculation', 'Compara en una tabla los grupos de Vega, calcula la diferencia en puntos porcentuales e indica qué resultado se midió.', 'fixed'],
    ['heldout-correction', 'Which total should I use for Bruma after the correction, and which earlier total does it replace?', 'dynamic'],
    ['heldout-statistics', 'Quelles sont la médiane et la moyenne consignées pour Bruma, et que permettent-elles de conclure sur la distribution ?', 'corpus'],
    ['heldout-negation', 'Compare the interpretation limits of Vega and Bruma, distinguishing measured outcomes from unsupported conclusions.', 'dynamic'],
    ['heldout-policy', 'Distingue lo que Linde permite restaurar y lo que excluye, sin mezclarlo con la retención de eventos.', 'dynamic'],
    ['heldout-paper', 'Explica cómo NF4, la doble cuantización y los optimizadores paginados ahorran memoria en QLoRA; distingue almacenamiento y cómputo y cita el artículo.', 'fixed'],
    ['heldout-absent-price', '¿Qué precio en euros está documentado para comprar Alba?', 'limited'],
    ['heldout-absent-donor', '¿Quién financió la compra de los libros de Puerto Claro?', 'corpus'],
    ['heldout-absent-funding', '¿Qué organización financió el ensayo Vega?', 'fixed'],
    ['heldout-absent-data', '¿Qué valores individuales de cada encuestado ofrece Bruma para recalcular su media?', 'dynamic'],
  ];
  report.evaluation = { factual: stage === 'evaluation' ? 8 : 6, insufficientEvidence: stage === 'evaluation' ? 4 : 0, repetitions: stage === 'evaluation' ? 2 : 1,
    requirements: { factualSupportAndAnswerAdequacy: 0.95, insufficientEvidence: 0.9, resolvableCitations: 1 },
    note: 'Expected answers never enter the indexed content or model context. These questions were previously attempted against 69f4fe88; subsequent revisions are repeated regression evaluation, not a new untouched holdout. Every final answer needs independent source review; auditor approval alone is not the quality score.' };
  try {
    const { page } = await harness.launch();
    const vault = previous.vaults.find(vault => vault.mode === 'auto'); assert(vault);
    await page.evaluate(id => window.nodus.switchVault(id), vault.id);
    const settings = await page.evaluate(() => window.nodus.getSettings());
    assert.equal(settings.embeddingProvider, 'nodus'); assert.equal(settings.embeddingModel, profile);
    await page.evaluate(() => window.nodus.updateSettings({ chatModel: { provider: 'deepseek', model: 'deepseek-flash' }, chatReasoning: 'off', researchWebSearch: 'off' }));
    await page.reload();
    const repetitions = stage === 'evaluation' ? 2 : 1;
    await checkEmbeddingProductChat(harness, report, save, shot, { scenarios, repetitions, attachments: false, captureName: `qa-grounding-${stage}.jsonl`,
      continueFailures: stage === 'evaluation', budgetExhausted: () => harness.proxy.blocked.some(row => row.message === 'research_budget_exhausted') });
    const databaseLog = fs.readFileSync(path.join(childRoot, 'profile/database-access.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    assert(databaseLog.every(row => row.path.startsWith(path.join(childRoot, 'profile') + path.sep)));
    report.databaseIsolation = { escaped: 0, opened: databaseLog.length };
    report.citations = { captured: report.answers.reduce((sum, answer) => sum + answer.citations.length, 0), allResolvable: report.answers.every(answer => answer.citations.every(citation => citation.resolvable)) };
    report.grounding = report.answers.map(answer => ({ name: answer.name, audits: answer.traces.filter(trace => trace.type === 'research-answer-grounding').length,
      semanticSelection: answer.traces.some(trace => trace.retrieval?.semantic?.some(candidate => trace.retrieval.selected?.some(selected => selected.semanticIds?.includes(candidate.id)))),
      answerSha256: createHash('sha256').update(answer.response?.answer ?? '').digest('hex') }));
    assert(report.grounding.filter((_row, index) => !report.answers[index].error).every(answer => answer.audits > 0), 'every published documentary answer actually passes through the new verification');
    if (stage === 'evaluation') assert(report.grounding.filter(answer => !answer.name.includes('absent')).every(answer => answer.semanticSelection), 'positive evaluations actually select semantic candidates');
    report.completed = !report.budgetExhausted && report.answers.length === scenarios.length * repetitions;
    report.executionErrors = report.answers.filter(answer => answer.error).length;
    if (report.executionErrors || report.budgetExhausted) process.exitCode = 1;
  } catch (error) { report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); report.providerBlocked = harness.proxy.blocked; save(); await harness.close(); }
  console.log(`Grounding report: ${output}`);
}
