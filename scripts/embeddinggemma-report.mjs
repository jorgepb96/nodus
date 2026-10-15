import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
function root(name, required = true) {
  const value = argument(name); if (!value && !required) return null;
  const canonical = fs.realpathSync(value), marker = read(path.join(canonical, 'isolation.json'));
  if (marker.format !== 'nodus.isolated-research-profile/1' || marker.root !== canonical) throw new Error(`Unmarked ${name}`);
  return canonical;
}
const controlledRoot = root('controlled-root'), corpusRoot = root('corpus-root'), campaignRoot = root('campaign-root');
const controlled = read(path.join(controlledRoot, 'artifacts/comparison-v2.json'));
const corpus = read(path.join(corpusRoot, 'artifacts/corpus-manifest.json')), gold = fs.readFileSync(path.join(corpusRoot, 'artifacts/queries-gold.json'));
const output = path.resolve(argument('output') ?? 'audit/embeddinggemma-2'); fs.mkdirSync(output, { recursive: true });
const sourceBase = argument('source-base') ?? execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim();
const changed = execFileSync('git', ['diff', '--name-only', '-z', '--diff-filter=ACMRTUXB', sourceBase], { encoding: 'utf8' });
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' });
const sourceFiles = [...new Set((changed + untracked).split('\0'))]
  .filter(file => file && !file.startsWith('audit/') && fs.existsSync(file) && fs.statSync(file).isFile())
  .sort().map(file => ({ file, sha256: hash(fs.readFileSync(file)) }));
fs.writeFileSync(path.join(output, 'source-files.json'), JSON.stringify(sourceFiles, null, 2));
const documents = corpus.documents.map(({ file, ...document }) => ({ ...document, filename: path.basename(file) }));
const corpusIdentity = { ...corpus, documents }; delete corpusIdentity.root; delete corpusIdentity.createdAt;
const fixtureDirectory = path.join(output, 'fixtures'); fs.mkdirSync(fixtureDirectory, { recursive: true });
for (const document of corpus.documents.filter(document => document.id.startsWith('fixture-'))) fs.copyFileSync(document.file, path.join(fixtureDirectory, path.basename(document.file)));
fs.writeFileSync(path.join(output, 'corpus-manifest.json'), JSON.stringify({ ...corpusIdentity, documents: documents.map(({ filename, ...document }) => ({ ...document, file: `fixtures/${filename}` })) }, null, 2));
fs.writeFileSync(path.join(output, 'queries-gold.json'), gold);
const report = { format: 'nodus.embedding-delivery/1', generatedAt: new Date().toISOString(), validatedProfiles: [],
  hardware: { platform: process.platform, architecture: process.arch, os: os.release(), cpu: os.cpus()[0].model, memoryBytes: os.totalmem(), node: process.version },
  versions: { nodus: read('package.json').version, electron: read('node_modules/electron/package.json').version,
    transformersHistorical: read('node_modules/@huggingface/transformers/package.json').version, transformersEmbeddingGemma: read('node_modules/@nodus/embeddinggemma-transformers/package.json').version,
    lockSha256: hash(fs.readFileSync('package-lock.json')), sourceFilesSha256: hash(JSON.stringify(sourceFiles)),
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceBase,
    dirty: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim()) },
  corpus: { sha256: hash(JSON.stringify(corpusIdentity)), goldSha256: hash(gold), totals: corpus.totals, documents: documents.map(({ controlChunks, ...document }) => document),
    limitations: ['Thirty authored, partly parallel fixtures and ten public papers; this is not a general multilingual benchmark.', 'Catalan and mixed-language stress cases occur in development only; Basque and Latin have one positive evaluation query each.'] },
  controlled: controlled.profiles.map(({ id, root, status, report }) => ({ id, root, status, hardware: { cpu: report.cpu, memoryBytes: report.memoryBytes }, runtime: report.runtime,
    results: report.results.map(({ queries, ...result }) => result) })), products: [], pending: [], classifiedFailures: [] };
report.modelManifests = controlled.profiles.map(profile => {
  const { directory, executable, ...manifest } = read(path.join(profile.root, 'artifacts/model-manifest.json'));
  return manifest;
});
const catalogFile = path.join(campaignRoot, 'tmp/delivery-catalog.mjs');
await build({ entryPoints: ['shared/localAiModels.ts'], outfile: catalogFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { NODUS_LOCAL_MODELS } = await import(pathToFileURL(catalogFile));
report.resourceLicenses = NODUS_LOCAL_MODELS.find(model => model.id === 'embeddinggemma-2-text-q8-512-v1').assets.map(asset => ({
  file: asset.file, url: asset.url, sha256: asset.sha256, license: asset.license, licenseUrl: asset.licenseUrl, notice: asset.licenseNotice,
}));
report.packaging = { macArm64: 'Real ASAR smoke, both profiles, offline, local ad-hoc signature',
  distributionSignature: 'Developer ID signing failed with errSecInternalComponent; certificate access and release signing were not changed.' };
fs.writeFileSync(path.join(output, 'controlled-rankings.json'), JSON.stringify(controlled.profiles.map(({ id, report }) => ({ id, results: report.results })), null, 2));
const reviews = argument('reviews-file') ? read(argument('reviews-file')) : { reviews: [] };
for (const value of (argument('product-roots') ?? '').split(',').filter(Boolean)) {
  const marker = read(path.join(value, 'isolation.json')); if (marker.root !== fs.realpathSync(value)) throw new Error('Unmarked product root');
  const file = path.join(value, 'artifacts/product-report.json'), product = read(file);
  fs.copyFileSync(file, path.join(output, `${product.profile}-product.json`));
  const productRankings = path.join(value, 'artifacts/product-retrieval.json');
  if (fs.existsSync(productRankings)) fs.copyFileSync(productRankings, path.join(output, `${product.profile}-rankings.json`));
  const productCaptures = path.join(output, 'screenshots'); fs.mkdirSync(productCaptures, { recursive: true });
  for (const [name, check] of Object.entries(product.checks)) {
    const capture = typeof check === 'string' ? check : check?.screenshot;
    if (capture && path.extname(capture) === '.png' && fs.existsSync(capture)) fs.copyFileSync(capture, path.join(productCaptures, `${product.profile}-${name}.png`));
  }
  const answers = product.answers.filter(answer => answer.response);
  const primary = answers.filter(answer => !answer.name.startsWith('conversation-attachment') && answer.name !== 'follow-up-prerequisite');
  const reviewed = reviews.reviews.filter(review => review.profile === product.profile);
  report.products.push({ profile: product.profile, root: value, completed: product.completed, failure: product.failure?.message,
    checks: Object.keys(product.checks), retrieval: product.checks.productRetrieval && { ...product.checks.productRetrieval, memory: undefined },
    answers: answers.length, primaryAnswers: primary.length, attachment: product.checks.conversationAttachment,
    citations: answers.flatMap(answer => answer.citations).length, unresolvedCitations: answers.flatMap(answer => answer.citations).filter(citation => !citation.resolvable).length,
    grounding: { reviewed: reviewed.length, supported: reviewed.filter(review => review.supported).length,
      factualReviewed: reviewed.filter(review => !review.name.startsWith('insufficient-evidence')).length,
      factualSupported: reviewed.filter(review => !review.name.startsWith('insufficient-evidence') && review.supported).length,
      insufficientReviewed: reviewed.filter(review => review.name.startsWith('insufficient-evidence')).length,
      insufficientRecognized: reviewed.filter(review => review.insufficientEvidenceRecognized === true).length,
      coverage: 'Only individually source-reviewed answers contribute; no inference about unreviewed answers.' },
    academicCoverage: 'Full light/deep/summary/document-profile chain on one representative source per configuration; all forty originals underwent extraction and documentary vector preparation.',
    pending: product.pending });
  for (const answer of answers) {
    const ordinal = answers.filter(candidate => candidate.name === answer.name && candidate.repetition === answer.repetition).indexOf(answer);
    const fileName = `${product.profile}-${answer.repetition}-${answer.name}${ordinal ? `-attempt-${ordinal + 1}` : ''}.json`;
    fs.writeFileSync(path.join(output, fileName), JSON.stringify(answer, null, 2));
    if (answer.screenshot && fs.existsSync(answer.screenshot)) {
      const captures = path.join(output, 'screenshots'); fs.mkdirSync(captures, { recursive: true });
      fs.copyFileSync(answer.screenshot, path.join(captures, fileName.replace(/\.json$/, '.png')));
    }
  }
  for (const failure of [product.failure, ...(product.attempts ?? []).map(attempt => attempt.failure)].filter(Boolean)) report.classifiedFailures.push({ profile: product.profile, message: failure.message,
    classification: /adjunto forma parte del historial/.test(failure.message) ? 'expected-history-guard-test-assertion' : /context.*destroy|preload CSS|locator\.|Timeout/.test(failure.message) ? 'harness-or-build-interference' : /SIGTRAP|Target page.*closed/.test(failure.message) ? 'native-process-exit' : 'product-or-test-assertion' });
  const audit = path.join(value, 'profile/database-access.jsonl');
  if (fs.existsSync(audit)) {
    const paths = fs.readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    if (paths.some(row => !row.path.startsWith(path.join(value, 'profile') + path.sep))) throw new Error('Database escaped isolated profile');
    report.products.at(-1).databaseIsolation = { opens: paths.length, escaped: 0 };
  }
}
const ledger = read(path.join(campaignRoot, 'artifacts/cost-ledger.json'));
if (ledger.calls.some(call => call.provider !== 'deepseek' || call.model !== 'deepseek-flash')) throw new Error('Unexpected paid provider/model in the campaign');
report.cost = { limitUsd: Math.min(5, ledger.limitUsd), calls: ledger.calls.length, chargedOrReservedUpperBoundUsd: ledger.calls.reduce((sum, call) => sum + (call.actualUsd ?? call.maximumUsd), 0),
  remoteEmbeddingCalls: 0, evidence: 'Every reserved call is direct DeepSeek Flash generation; the isolated proxy admits no embedding API route.' };
for (const [name, relative] of [['capacity-root', 'capacity-report.json'], ['context-root', 'context-report.json'], ['desktop-capacity-root', 'desktop-capacity.json'], ['package-root', 'package-smoke.json'], ['restart-root', 'restart-preparation.json'], ['native-server-root', 'native-server.json']]) {
  const directory = root(name, false); if (directory) report[name] = read(path.join(directory, 'artifacts', relative));
}
report.supplementaryDesktopRuns = (argument('supplementary-desktop-roots') ?? '').split(',').filter(Boolean).map(directory => {
  const canonical = fs.realpathSync(directory), marker = read(path.join(canonical, 'isolation.json'));
  if (marker.root !== canonical || marker.format !== 'nodus.isolated-research-profile/1') throw new Error('Unmarked supplementary capacity root');
  return read(path.join(canonical, 'artifacts/desktop-capacity.json'));
});
report.reviews = reviews;
const semanticRecommended = id => controlled.profiles.find(profile => profile.id === id)?.report.results.find(result => result.lane === 'recommended' && result.retrieval === 'semantic');
const reference = semanticRecommended('multilingual-e5-small-int8'), full = semanticRecommended('embeddinggemma-2-text-q8-512-v1');
report.gates = ['embeddinggemma-2-text-q8-512-v1', 'embeddinggemma-2-text-q8-256-v1'].map(profile => {
  const lane = semanticRecommended(profile), product = report.products.find(row => row.profile === profile);
  const categoryRegressions = ['byLanguage', 'byFormat', 'byDifficulty'].flatMap(group => Object.entries(reference?.[group] ?? {}).filter(([, value]) => value.queries > 0).map(([category, baseline]) =>
    ({ group, category, queries: lane?.[group]?.[category]?.queries ?? 0, ndcgLoss: baseline.ndcg10 - (lane?.[group]?.[category]?.ndcg10 ?? 0) })));
  const factual = product?.grounding;
  const desktop10k = report['desktop-capacity-root']?.counts?.find(row => row.count === 10000);
  const measuredProfile = report['desktop-capacity-root']?.profile ?? desktop10k?.trace?.profile?.model;
  const baselineRss = desktop10k?.baseline?.reduce((sum, process) => sum + process.memory.workingSetSize, 0);
  const memoryGrowthUpperBoundKiB = desktop10k && baselineRss !== undefined ? desktop10k.upperBoundSumProcessPeaksKiB - baselineRss : undefined;
  return { profile, validated: false,
    controlledRecall10: lane?.metrics.recall10 >= .85 ? 'pass' : 'fail',
    controlledNdcgVersusE5: lane?.metrics.ndcg10 >= reference.metrics.ndcg10 - .02 && categoryRegressions.every(row => row.ndcgLoss <= .05) ? 'pass' : 'fail', categoryRegressions,
    controlledNdcg256Versus512: profile.includes('-256-') ? lane?.metrics.ndcg10 >= full.metrics.ndcg10 - .02 ? 'pass' : 'fail' : 'not-applicable',
    productRecall10: product?.retrieval ? product.retrieval.metrics.semantic.metrics.recall10 >= .85 ? 'pass' : 'fail' : 'pending',
    resolvableCitations: product?.primaryAnswers >= 24 ? product.unresolvedCitations === 0 ? 'pass-at-response-time' : 'fail' : 'pending',
    factualGrounding: factual?.factualReviewed ? factual.factualSupported / factual.factualReviewed >= .95 ? factual.factualReviewed >= 20 ? 'pass-reviewed-campaign' : 'pending-coverage' : 'fail-reviewed-sample' : 'pending',
    insufficientEvidence: factual?.insufficientReviewed >= 4 ? factual.insufficientRecognized / factual.insufficientReviewed >= .90 ? 'pass' : 'fail' : 'pending-coverage',
    desktop10kHotP95: desktop10k && measuredProfile === profile ? desktop10k.p95Ms <= 1500 ? 'pass-recorded-run' : 'fail-recorded-run' : 'pending-not-measured-for-this-profile',
    nativePlatformCoverage: 'pending-Windows-Linux-Intel',
    memory: { result: measuredProfile === profile && Number.isFinite(memoryGrowthUpperBoundKiB) ? memoryGrowthUpperBoundKiB <= 1.5 * 1024 * 1024 ? 'pass-recorded-resident-upper-bound' : 'fail-recorded-resident-upper-bound' : 'pending-not-measured-for-this-profile',
      measuredProfile, memoryGrowthUpperBoundKiB, limitation: 'Resident memory on this machine; per-process peaks sum is a conservative upper bound, not simultaneous total. Compression and 2K/8K contexts are reported separately.' } };
});
report.pending = ['Windows x64, Linux x64 and macOS Intel native and packaged execution', 'Do not validate a profile until every applicable quality, grounding, scope and performance gate has recorded evidence'];
for (const gate of report.gates) if (gate.desktop10kHotP95.startsWith('pending')) report.pending.push(`${gate.profile}: separate Desktop capacity and resident-memory run not executed; the 512-profile run is not extrapolated.`);
if (!report['desktop-capacity-root']?.counts?.some(row => row.count === 10000)) report.pending.push('Desktop SQLite query and renderer responsiveness at 10,000 real generated vectors');
if (reviews.reviews.length < 20) report.pending.push('Complete twenty manual source-grounded answer reviews');
if (report.products.some(product => product.grounding.factualSupported < 0.95 * product.grounding.factualReviewed)) report.pending.push('The reviewed factual-answer sample fails the 95% grounding gate; preserve experimental status');
fs.writeFileSync(path.join(output, 'campaign.json'), JSON.stringify(report, null, 2));
const table = report.controlled.flatMap(profile => profile.results.filter(result => result.retrieval === 'semantic').map(result => `| ${profile.id} | ${result.lane} | ${result.metrics.recall10.toFixed(3)} | ${result.metrics.ndcg10.toFixed(3)} |`)).join('\n');
const products = report.products.map(product => `| ${product.profile} | ${product.completed ? 'recorrido completado' : product.failure ?? 'en ejecución'} | ${product.retrieval?.metrics.semantic.metrics.recall10.toFixed(3) ?? 'pendiente'} | ${product.answers} |`).join('\n');
const grounding = report.products.map(product => `| ${product.profile} | ${product.grounding.factualSupported}/${product.grounding.factualReviewed} | ${product.grounding.insufficientRecognized}/${product.grounding.insufficientReviewed} | ${product.citations - product.unresolvedCitations}/${product.citations} |`).join('\n');
const desktop = report['desktop-capacity-root'];
const performance = desktop ? desktop.counts.map(row => `| ${row.count} | ${row.coldMs.toFixed(1)} | ${row.p50Ms.toFixed(1)} | ${row.p95Ms.toFixed(1)} | ${row.maximumFrameGapMs.toFixed(1)} |`).join('\n') : '| pendiente | — | — | — | — |';
const ordinary = desktop?.counts.find(row => row.count === 10000);
const memoryText = ordinary ? `Con 10.000 fragmentos, el mayor total residente muestreado de la aplicación fue ${(ordinary.maximumSampledFullAppRssKiB / 1024 / 1024).toFixed(2)} GiB y el incremento final frente al arranque fue ${(ordinary.runtimeRssGrowthKiB / 1024 / 1024).toFixed(2)} GiB. La suma conservadora de picos por proceso menos el total inicial da ${((ordinary.upperBoundSumProcessPeaksKiB - ordinary.baseline.reduce((sum, process) => sum + process.memory.workingSetSize, 0)) / 1024 / 1024).toFixed(2)} GiB de incremento. Solo acredita este recorrido y perfil en el M2.` : 'Memoria del recorrido habitual pendiente.';
const contextText = report['context-root']?.context.map(row => `${row.tokensIncludingPrefixAndSpecial} tokens: ${(row.elapsedMs / 1000).toFixed(2)} s y ${(row.maxRssKiB / 1024 / 1024).toFixed(2)} GiB de RSS máximo del proceso nativo`).join('; ') ?? 'pendiente';
const retrievalStatus = report.gates.every(gate => ['controlledRecall10', 'controlledNdcgVersusE5', 'controlledNdcg256Versus512'].every(name => ['pass', 'not-applicable'].includes(gate[name])))
  ? 'Los umbrales de recuperación controlada se han superado en este corpus.'
  : 'Hay umbrales de recuperación controlada pendientes o incumplidos; consultar los resultados por perfil.';
const groundingStatus = report.gates.some(gate => gate.factualGrounding === 'fail-reviewed-sample')
  ? 'La muestra revisada de respuestas factuales incumple el criterio de fundamentación.'
  : 'El estado de fundamentación y su cobertura se detallan por perfil en campaign.json.';
const text = `# Campaña EmbeddingGemma 2 · ${report.generatedAt.slice(0, 10)}\n\nLos perfiles de 512 y 256 dimensiones están implementados como opciones experimentales. No se ha cambiado el modelo predeterminado ni se ha accedido a bases de datos reales. ${retrievalStatus} ${groundingStatus} Falta cobertura nativa en otros sistemas. No se ofrecen como opciones validadas. Los criterios completos están en campaign.json.\n\n## Recuperación controlada\n\n40 documentos, 120 consultas; 70 positivas y 10 sin evidencia en evaluación, 40 consultas para desarrollo. Los textos controlados son extractos; la importación completa se mide aparte.\n\n| Perfil | Preparación | Recall@10 | nDCG@10 |\n| --- | --- | --- | --- |\n${table}\n\n## Producto completo\n\n| Perfil | Ejecución | Recall@10 semántico | Respuestas capturadas |\n| --- | --- | --- | --- |\n${products}\n\n## Fundamentación revisada\n\n| Perfil | Factuales sustentadas / revisadas | Ausencia reconocida / revisada | Citas resolubles / capturadas |\n| --- | --- | --- | --- |\n${grounding}\n\nRevisión manual de Codex contra los pasajes originales; no auditoría humana externa. La muestra dirigida no estima la tasa de respuestas sin revisar. Los errores observados incluyen atribuciones de idioma, inferencias estadísticas sin datos y condiciones de restauración no documentadas. Se conservan respuestas, pasajes, hashes y notas de cada revisión.\n\n## Capacidad en Desktop\n\n| Fragmentos reales | Frío (ms) | Caliente p50 (ms) | Caliente p95 (ms) | Mayor pausa entre frames (ms) |\n| --- | --- | --- | --- | --- |\n${performance}\n\nPerfil medido: ${desktop?.profile ?? "pendiente"}. Carga concurrente declarada: ${desktop?.contention ?? "pendiente"}. Las pruebas anteriores bajo carga permanecen en supplementaryDesktopRuns. El objetivo de 1,5 s se evalúa sobre 10.000 fragmentos en el Desktop real; la comparación de vectores en JavaScript se informa por separado. Las muestras completas de memoria se conservan; la compresión impide interpretar una diferencia negativa de RSS como consumo negativo.\n\n${memoryText}\n\nContextos largos, medidos aparte: ${contextText}. El máximo de 8K tokens requiere bastante más memoria que el recorrido habitual. La medida de capacidad de 256 dimensiones y la cobertura de Windows, Linux e Intel permanecen pendientes.\n\n## Alcance y límites\n\nApple M2, 16 GB, macOS ARM64; las cifras no se extrapolan a Windows, Linux o Intel. El corpus sintético contiene traducciones paralelas y pocos casos por idioma de estrés. Los rankings completos, contratos, fuentes, localizadores, errores y revisiones están en los JSON adjuntos. El modelo generativo es DeepSeek Flash directo, idéntico para todos los perfiles.\n\nPresupuesto compartido: ${report.cost.chargedOrReservedUpperBoundUsd.toFixed(6)} USD como cota de gasto comprometido o reservado, de 5 USD. No se incorporan credenciales al informe.\n\nLos contextos de 2K y 8K se presentan por separado del consumo habitual. Una cita resoluble no certifica que todas las afirmaciones de la respuesta estén sustentadas. Los fallos de generación y de recuperación permanecen separados.\n\n## Reproducción\n\nVer docs/embeddinggemma-2.md y los comandos test:embeddinggemma:contracts, audit:embeddinggemma, audit:embeddinggemma:product, test:e2e:embeddinggemma, test:embeddinggemma:capacity, test:embeddinggemma:restart, test:embeddinggemma:server:native y test:embeddinggemma:package. Toda ejecución crea perfiles marcados y bóvedas desechables con una frontera de aislamiento del sistema operativo.\n`;
fs.writeFileSync(path.join(output, 'README.md'), text); console.log(`Campaign report: ${output}/README.md`);
