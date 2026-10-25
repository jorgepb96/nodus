// Verifies that the numbers on the queue bar's live line never move backwards:
// the fragment counter (x/y), the percentage beside it, the per-fragment elapsed
// seconds, the elapsed time of the work being shown, and the stability of the row
// itself while several works run at once.
//
// It drives the REAL producers (runDeepScan's chunk fan-out and scanQueue's
// scheduler) with a stubbed transport, because that is where the counters are
// produced; nothing here is a re-implementation of the display maths.
//
// Part of the suite (`node --test scripts/test-*.mjs`): exit code 0 means every
// invariant holds, 1 lists the frames that broke one.
// Run alone: node scripts/test-queue-progress-monotonic.mjs

import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stubber(api) {
  return (filter, name, contents) => {
    api.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
    api.onLoad({ filter: new RegExp(`^${name}$`), namespace: 'stub' }, () => ({ contents, loader: 'js' }));
  };
}

async function bundle(entry, name, stubs) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `nodus-${name}-`));
  const outfile = path.join(directory, 'bundle.mjs');
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
    plugins: [{ name, setup(api) { const stub = stubber(api); for (const [filter, module, contents] of stubs) stub(filter, module, contents); } }],
  });
  return { module: await import(pathToFileURL(outfile)), directory };
}

const CHUNK_FRAME = /^Analizando fragmento (\d+)\/(\d+) con IA…(?: \((\d+)s\))?$/;
const FUSION_FRAME = /^Fusionando idea (\d+)\/(\d+)…$/;
const CHAIN_FRAME = /^(Generando el resumen requerido…|Indexando ideas y pasajes requeridos…|Modo léxico: no hay proveedor de embeddings configurado\.)$/;

// ── Section 1: runDeepScan writes the line once per phase, not once per worker ──

async function deepScanFrames({ concurrencyMode, concurrency, chunkDurations, chunks }) {
  const probe = {
    settings: {
      deepContextMode: 'standard',
      deepStandardChunkWords: 400,
      deepLongChunkWords: 800,
      promptLanguage: 'es',
      themesLocked: false,
      extractionModel: null,
      fusionModel: null,
      synthesisModel: null,
      aiConcurrencyMode: concurrencyMode,
      concurrency,
    },
    chunkDurations,
    chunks,
  };
  globalThis.__deepScanProbe = probe;
  const { module, directory } = await bundle('electron/ai/deepScan.ts', 'deep-scan-probe', [
    [/^\.\/aiClient$/, 'aiClient', `
      export class AiError extends Error { constructor(message, retriable = false, config = false) { super(message); this.retriable = retriable; this.config = config; } }
      export async function embedMany() { return []; }
      export async function completeJson(request) {
        const probe = globalThis.__deepScanProbe;
        // jobId is "paper-1:deep:<chunk>:<depth>:<hash>". Split, never a regex: this
        // source travels inside a template literal and a backslash-d would collapse.
        const index = Number(String(request.jobId ?? '').split(':')[2] ?? 0) || 0;
        await new Promise((resolve) => setTimeout(resolve, probe.chunkDurations[index] ?? 20));
        return {
          document: { processing_status: 'ok', type: 'research', language: 'en', notes: null },
          ideas: [{
            id: 'i1', type: 'claim', label: 'Idea del fragmento ' + index, statement: 'Enunciado ' + index,
            role: 'secondary', development: 'Enunciado ' + index, evidence: [], theme_labels: [], confidence: 0.8,
            uncertainty_reason: null,
          }],
          internal_relations: [], external_references: [], gaps: [], authors_detail: [],
        };
      }
    `],
    [/^\.\/prompts$/, 'prompts', `export function deepScanPrompt() { return 'prompt'; }`],
    [/^\.\/fusion$/, 'fusion', `
      export async function resolveIdeaFusion() { return { decision: null, plan: { kind: 'new' } }; }
      export function applyFusionPlan() { return 'global-idea'; }
      export function applyFusionLink() {}
    `],
    [/^\.\.\/db\/ideasRepo$/, 'ideasRepo', `
      export function upsertOccurrence() {} export function addEvidence() { return 'evidence'; }
      export function addEdge() {} export function purgeDeepData() {}
      export function embeddingTextForIdea() { return 'texto'; } export function assertDeepDataIntegrity() {}
    `],
    [/^\.\.\/db\/gapsRepo$/, 'gapsRepo', `export function addGap() {} export function addExternalRef() {}`],
    [/^\.\.\/db\/authorsRepo$/, 'authorsRepo', `
      export function canonicalKeyFromDisplay(name) { return String(name).toLowerCase(); }
      export function linkZoteroAuthors() {} export function recomputeAuthorRelations() {}
    `],
    [/^\.\.\/db\/worksRepo$/, 'worksRepo', `export function setDeepResult() {}`],
    [/^\.\.\/db\/themesRepo$/, 'themesRepo', `
      export function getWorkThemeLabels() { return []; } export function listThemeLabels() { return []; }
      export function normalizeThemeLabel(label) { return String(label).toLowerCase().trim(); }
      export function setIdeaThemeLinks() {} export function unionWorkThemes() {} export function pruneOrphanThemes() {}
    `],
    [/^\.\.\/db\/scanCheckpointRepo$/, 'checkpoints', `
      export function loadCheckpoints() { return new Map(); } export function saveCheckpoint() {} export function clearCheckpoints() {}
    `],
    [/^\.\.\/db\/settingsRepo$/, 'settings', `export function getSettings() { return globalThis.__deepScanProbe.settings; }`],
    [/^\.\.\/extraction\/textExtractor$/, 'textExtractor', `
      export function planTextChunks() {
        const probe = globalThis.__deepScanProbe;
        const words = Array.from({ length: probe.chunks * 400 }, (_, index) => 'w' + index);
        return {
          mode: 'standard', chunks: Array.from({ length: probe.chunks }, (_, index) => words.slice(index * 400, (index + 1) * 400).join(' ')),
          wordCount: words.length, chunkWords: 400, overlapWords: 0,
          maxIdeasPerChunk: 8, maxRelationsPerChunk: 4, maxGapsPerChunk: 2,
        };
      }
    `],
    [/^\.\.\/perf$/, 'perf', `export function perfLog() {} export function startPerf() { return () => {}; }`],
    [/^\.\.\/library\/libraryVaultProvenance$/, 'vaultProvenance', `export function recordLinkedLibraryAnalysis() {}`],
    [/^\.\.\/db\/libraryAnalysisProvenance$/, 'analysisProvenance', `
      export function analysisFingerprint() { return 'fingerprint'; }
      export function analysisModelFingerprint() { return 'model-fingerprint'; }
      export function isLocalAnalysisCurrent() { return false; }
      export function recordLocalAnalysisProvenance() {}
    `],
    [/embeddingIndexesRepo$/, 'indexes', `export function activeEmbeddingIndex() { return null; } export function profileFingerprint() { return 'fixture'; } export function withEmbeddingIndexContext(_context, work) { return work(); }`],
    [/^\.\.\/db\/database$/, 'database', `export function getDb() { return { transaction: (fn) => fn }; }`],
    [/@shared\/localAiModels$/, 'localAiModels', `export function modelRefSupportsExtraction() { return true; } export function getNodusLocalModel() { return undefined; }`],
  ]);
  try {
    const frames = [];
    const startedAt = Date.now();
    const work = {
      nodus_id: 'paper-1', zotero_key: 'z1', title: 'BitNet b1.58 2B4T Technical Report',
      authors_json: '[]', year: 2025, item_type: 'journalArticle',
      deep_hash: 'stale-hash', source_type: 'pdf', notes: null,
    };
    const doc = { text: 'texto', sourceType: 'pdf', notes: null, segments: [] };
    await module.runDeepScan(work, doc, null, (progress) => {
      frames.push({ at: Date.now() - startedAt, detail: progress.detail, pct: progress.pct });
    });
    return frames;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** The counter, the percentage and the seconds all belong to one phase and only advance. */
function checkDeepScanFrames(frames, section) {
  const regressions = [];
  // Fragments and ideas are two counters behind two different labels; each one, and the
  // shared percentage that runs through both phases, must only move forward.
  let maxIndex = { fragmento: 0, idea: 0 };
  let maxPct = -1;
  let maxSeconds = 0;
  let sawFusion = false;
  let lastChunkPct = -1;
  for (const frame of frames) {
    const chunk = CHUNK_FRAME.exec(frame.detail);
    const fusion = FUSION_FRAME.exec(frame.detail);
    const counter = chunk ? 'fragmento' : fusion ? 'idea' : null;
    const index = counter ? Number((chunk ?? fusion)[1]) : null;
    const seconds = chunk && chunk[3] !== undefined ? Number(chunk[3]) : null;
    if (counter && index < maxIndex[counter]) {
      regressions.push({ section, kind: `contador de ${counter}s`, detail: `«${frame.detail}»`, at: frame.at });
    }
    if (counter) maxIndex[counter] = Math.max(maxIndex[counter], index);
    if (typeof frame.pct === 'number') {
      if (frame.pct < maxPct - 1e-9) {
        regressions.push({ section, kind: 'porcentaje', detail: `«${frame.detail}» con ${Math.round(frame.pct * 100)}% (venía de ${Math.round(maxPct * 100)}%)`, at: frame.at });
      }
      maxPct = Math.max(maxPct, frame.pct);
      if (fusion && !sawFusion) {
        sawFusion = true;
        if (lastChunkPct >= 0 && frame.pct < lastChunkPct - 1e-9) {
          regressions.push({ section, kind: 'salto de fase', detail: `la fusión arranca en ${Math.round(frame.pct * 100)}% tras ${Math.round(lastChunkPct * 100)}%`, at: frame.at });
        }
      }
      if (chunk) lastChunkPct = frame.pct;
    }
    if (seconds !== null) {
      if (seconds < maxSeconds) {
        regressions.push({ section, kind: 'segundos del fragmento', detail: `«${frame.detail}»`, at: frame.at });
      }
      maxSeconds = Math.max(maxSeconds, seconds);
    }
  }
  return regressions;
}

function printFrames(title, frames) {
  console.log(`\n  ${title}`);
  for (const frame of frames) {
    const pct = typeof frame.pct === 'number' ? `${String(Math.round(frame.pct * 100)).padStart(3)}%` : '  —';
    console.log(`    [${String(frame.at).padStart(5)}ms] pct=${pct}  ${frame.detail}`);
  }
}

/** Repeated frames collapse to one entry so the report stays readable. */
function dedupe(entries) {
  return [...new Map(entries.map((entry) => [`${entry.kind}|${entry.detail}`, entry])).values()];
}

// ── Section 2 and 3: the real scanQueue, with a transport that walks the same
// phases a deep item walks (extraction pages, fragments, fusion, required tail) ──

async function scanQueueFrames(durations) {
  const probe = { durations: { ...durations } };
  globalThis.__scanQueueProbe = probe;
  const { module, directory } = await bundle('electron/pipeline/scanQueue.ts', 'scan-queue-probe', [
    [/\.\.\/db\/database$/, 'db', `
      export function getDb() { return { prepare: () => ({ get: (id) => ({ nodus_id: id, zotero_key: id, title: id, doi: null, item_type: 'journalArticle', authors_json: '[]', deep_hash: 'stale', source_type: 'pdf', notes: null }), all: () => [], run: () => ({ changes: 1 }) }) }; }
    `],
    [/\.\.\/db\/settingsRepo$/, 'settings', `export function getSettings() { return { aiConcurrencyMode: 'automatic', concurrency: 1, autoBridgeAfterQueue: false, autoSummaryAfterDeep: false, embeddingProvider: 'openai', providerKeys: { openai: false }, zoteroUserId: '', zoteroStoragePath: '', unpaywallEmail: '', preferZoteroFulltext: false, ocrEnabled: false, ocrLanguages: [], ocrMaxPages: 0, themesLocked: false, synthesisModel: null }; }`],
    [/\.\.\/ai\/lightScan$/, 'light', `export async function runLightScan() {}`],
    [/\.\.\/ai\/deepScan$/, 'deep', `
      export function issueDeepScanPublicationOrdinal() { return 1; }
      export function finishDeepScanPublicationOrdinal() {}
      export async function runDeepScan(work, _doc, _model, onProgress) {
        const ms = globalThis.__scanQueueProbe.durations[work.nodus_id] ?? 100;
        // The scale runDeepScan now reports: fragments own 0 → 90%, fusion 90% → 100%.
        const frames = [
          { detail: 'Analizando fragmento 1/2 con IA…', pct: 0 },
          { detail: 'Analizando fragmento 2/2 con IA… (1s)', pct: 0.45 },
          { detail: 'Fusionando idea 1/1…', pct: 0.9 },
          { detail: 'Fusionando idea 1/1…', pct: 1 },
        ];
        for (const frame of frames) {
          onProgress?.(frame);
          await new Promise((resolve) => setTimeout(resolve, Math.max(5, Math.round(ms * 0.05))));
        }
      }
    `],
    [/\.\.\/ai\/summaryScan$/, 'summary', `export async function runSummaryScan() {}`],
    [/\.\.\/ai\/reprocessConnections$/, 'reprocess', `export async function reprocessConnections() { return { relationsAdded: 0, newThemes: 0 }; }`],
    [/\.\.\/db\/themesRepo$/, 'themes', `export function listThemeLabels() { return []; }`],
    [/\.\.\/extraction\/textExtractor$/, 'text', `
      export async function resolveWorkText(_userId, zoteroKey, _path, _abstract, _doi, opts) {
        const ms = globalThis.__scanQueueProbe.durations[zoteroKey] ?? 100;
        opts.onProgress?.({ phase: 'analyze', detail: 'Analizando PDF…', pct: null });
        await new Promise((resolve) => setTimeout(resolve, Math.max(5, Math.round(ms * 0.05))));
        for (let page = 1; page <= 4; page++) {
          opts.onProgress?.({ phase: 'extract', detail: 'Extrayendo p. ' + page + '/4', pct: page / 4 });
          await new Promise((resolve) => setTimeout(resolve, Math.max(5, Math.round(ms * 0.1))));
        }
        return { text: 'paper text', segments: [] };
      }
      export function resolvedTextStateFromDoc() { return {}; }
    `],
    [/\.\.\/zotero\/zoteroClient$/, 'zotero', `export async function getItem() { return { abstract: 'abstract' }; }`],
    [/\.\.\/db\/worksRepo$/, 'works', `export function clearDeepQueued() {} export function setDeepPending() {} export function setDeepResult() {} export function setResolvedTextState() {} export function setSummaryPending() {}`],
    [/\.\.\/db\/workSummariesRepo$/, 'summaries', `export function failedSummaryWorks() { return []; } export function pendingSummaryWorks() { return []; }`],
    [/\.\.\/ai\/aiClient$/, 'ai', `export class AiError extends Error { constructor(message, retriable = false, config = false) { super(message); this.retriable = retriable; this.config = config; } }`],
    [/\.\.\/ai\/semanticBridges$/, 'bridges', `export async function discoverSemanticBridges() { return { added: 0, validated: 0, candidatesScanned: 0 }; }`],
    [/\.\.\/ai\/embeddingPipeline$/, 'embeddings', `export async function startEmbedding() {}`],
    [/\.\.\/ai\/passageEmbeddingPipeline$/, 'passages', `export async function startPassageEmbedding() {}`],
    [/\.\.\/perf$/, 'perf', `export function startPerf() { return () => {}; }`],
    [/\.\.\/notifications$/, 'notifications', `export function addNotification() {}`],
    [/\.\.\/util\/coalesce$/, 'coalesce', `export function coalesce(fn) { return { schedule: fn }; }`],
    [/@shared\/nodiNotifications$/, 'nodi', `export function nodiText(key) { return key; }`],
  ]);
  try {
    const frames = [];
    const startedAt = Date.now();
    // Mirrors QueueBar: the row shown is the oldest running work, and it narrates the
    // same item the snapshot calls `current`.
    const off = module.scanQueue.onProgress(() => {
      const snapshot = module.scanQueue.snapshot();
      const runningItems = snapshot.items.filter((item) => item.state === 'running');
      const oldest = runningItems.reduce((oldestSoFar, item) => {
        if (!oldestSoFar) return item;
        return (item.started_at ?? item.enqueued_at) < (oldestSoFar.started_at ?? oldestSoFar.enqueued_at) ? item : oldestSoFar;
      }, undefined);
      frames.push({
        at: Date.now() - startedAt,
        current: snapshot.current?.title ?? null,
        title: oldest?.title ?? null,
        detail: oldest?.detail ?? null,
        subPct: oldest?.subPct ?? null,
        elapsedMs: oldest?.started_at ? Date.now() - Date.parse(oldest.started_at) : null,
        runningTitles: runningItems.map((item) => item.title),
      });
    });
    for (const nodusId of Object.keys(durations)) module.scanQueue.enqueue(nodusId, nodusId, 'deep');
    await delay(Math.max(...Object.values(durations)) * 2 + 400);
    off();
    return frames;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** One item walks one scale: extraction first half, analysis second, tail no fraction. */
function checkItemProgress(frames, section) {
  const regressions = [];
  let maxSubPct = -1;
  let previous = null;
  for (const frame of frames) {
    if (frame.title === null) continue;
    if (typeof frame.subPct === 'number') {
      if (frame.subPct < maxSubPct - 1e-9) {
        regressions.push({ section, kind: 'porcentaje del elemento', detail: `${Math.round(frame.subPct * 100)}% tras ${Math.round(maxSubPct * 100)}% con «${frame.detail}»`, at: frame.at });
      }
      maxSubPct = Math.max(maxSubPct, frame.subPct);
    }
    if (frame.detail && CHAIN_FRAME.test(frame.detail) && frame.subPct != null && frame.detail !== previous) {
      regressions.push({ section, kind: 'porcentaje pegado', detail: `«${frame.detail}» conserva ${Math.round(frame.subPct * 100)}% del análisis`, at: frame.at });
    }
    previous = frame.detail;
    if (frame.current !== null && frame.title !== null && frame.current !== frame.title) {
      regressions.push({ section, kind: 'título y fila discrepan', detail: `snapshot.current=${frame.current} pero la barra muestra ${frame.title}`, at: frame.at });
    }
  }
  return regressions;
}

/** The row may only change when the work it was narrating has ended. */
function checkDisplayedWork(frames, section) {
  const regressions = [];
  let previous = null;
  let maxElapsed = 0;
  for (const frame of frames) {
    if (frame.title === null) continue;
    if (previous && frame.title !== previous.title && frame.runningTitles.includes(previous.title)) {
      regressions.push({ section, kind: 'cambio de obra', detail: `${previous.title} → ${frame.title} con ${previous.title} aún en curso (${frame.runningTitles.length} en curso)`, at: frame.at });
    }
    if (previous && frame.title === previous.title && frame.elapsedMs !== null && frame.elapsedMs + 50 < maxElapsed) {
      regressions.push({ section, kind: 'tiempo de la obra mostrada', detail: `${(frame.elapsedMs / 1000).toFixed(1)}s tras ${(maxElapsed / 1000).toFixed(1)}s en «${frame.title}»`, at: frame.at });
    }
    if (!previous || frame.title !== previous.title) maxElapsed = 0;
    maxElapsed = Math.max(maxElapsed, frame.elapsedMs ?? 0);
    previous = frame;
  }
  return regressions;
}

function report(section, frames, regressions) {
  console.log(`\n  ${section}`);
  let previousKey = null;
  for (const frame of frames) {
    if (frame.title === null) continue;
    const key = `${frame.title}|${frame.detail}|${Math.floor((frame.subPct ?? -1) * 20)}`;
    if (key === previousKey) continue;
    previousKey = key;
    const subPct = typeof frame.subPct === 'number' ? ` pct=${Math.round(frame.subPct * 100)}%` : '';
    const elapsed = frame.elapsedMs === null ? '' : ` obra=${(frame.elapsedMs / 1000).toFixed(1)}s`;
    console.log(`    [${String(frame.at).padStart(5)}ms] ${frame.title}${elapsed}${subPct}  ${frame.detail ?? ''}`);
  }
  console.log(`    → ${regressions.length ? `${regressions.length} fallos` : 'sin retrocesos'}`);
}

// ── Report ────────────────────────────────────────────────────────────────────

const failures = [];

console.log('Verificando monotonicidad de los contadores del progreso…');

// 1a. Manual concurrency: two fragment workers overlap, one of them starts late.
{
  const frames = await deepScanFrames({ concurrencyMode: 'manual', concurrency: 2, chunks: 3, chunkDurations: [3000, 1500, 3000] });
  printFrames('runDeepScan · modo manual (2 fragmentos en paralelo), 3 fragmentos', frames);
  const regressions = dedupe(checkDeepScanFrames(frames, 'runDeepScan (manual, 2 en paralelo)'));
  failures.push(...regressions);
  console.log(`    → ${regressions.length ? `${regressions.length} retrocesos: ${regressions.map((entry) => `${entry.kind} ${entry.detail}`).join(' | ')}` : 'sin retrocesos'}`);
}

// 1b. Default automatic mode: the pool is 8 wide and the document has more fragments
// than workers, so some fragments start minutes after others did.
{
  const frames = await deepScanFrames({
    concurrencyMode: 'automatic', concurrency: 1, chunks: 12,
    chunkDurations: [1200, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 30, 30, 30, 30],
  });
  printFrames('runDeepScan · modo automático por defecto (8 en paralelo), 12 fragmentos', frames);
  const regressions = dedupe(checkDeepScanFrames(frames, 'runDeepScan (automático, 8 en paralelo)'));
  failures.push(...regressions);
  console.log(`    → ${regressions.length ? `${regressions.length} retrocesos: ${regressions.map((entry) => `${entry.kind} ${entry.detail}`).join(' | ')}` : 'sin retrocesos'}`);
}

// 2. One item, whole plan: extraction, fragments, fusion and the required tail.
{
  const frames = await scanQueueFrames({ 'obra-unica': 900 });
  report('scanQueue · una obra: escala única del porcentaje', frames, []);
  const regressions = dedupe(checkItemProgress(frames, 'scanQueue (escala del elemento)'));
  failures.push(...regressions);
  const last = [...frames].reverse().find((frame) => typeof frame.subPct === 'number');
  console.log(`    → ${regressions.length ? `${regressions.length} fallos: ${regressions.map((entry) => `${entry.kind} (${entry.detail})`).join(' | ')}` : `sin retrocesos (último porcentaje ${Math.round((last?.subPct ?? 0) * 100)}%)`}`);
}

// 3. Several works in flight: the row must not hop between them.
{
  const frames = await scanQueueFrames({ 'obra-a': 800, 'obra-b': 400, 'obra-c': 400, 'obra-d': 400, 'obra-e': 1500, 'obra-f': 1500 });
  report('scanQueue · varias obras en paralelo: fila estable', frames, []);
  const regressions = dedupe(checkDisplayedWork(frames, 'scanQueue (varias obras)'));
  failures.push(...regressions);
  const switches = [];
  for (let index = 1; index < frames.length; index++) {
    const before = frames[index - 1];
    const after = frames[index];
    if (before.title && after.title && before.title !== after.title) {
      switches.push(`${before.title} → ${after.title} (t=${after.at}ms, ${after.runningTitles.length} en curso)`);
    }
  }
  console.log(`    → cambios de obra: ${switches.length ? switches.join(' | ') : 'ninguno'}`);
  console.log(`    → ${regressions.length ? `${regressions.length} fallos: ${regressions.map((entry) => `${entry.kind} (${entry.detail})`).join(' | ')}` : 'sin saltos con la obra en curso'}`);
}

console.log('\n──────── Resultado ────────');
if (failures.length === 0) {
  console.log('OK: todos los contadores son monótonos y la fila mostrada es estable.');
  process.exit(0);
}
console.log(`FALLO: ${failures.length} inconsistencias reproducidas con el código real.`);
for (const failure of failures) {
  console.log(`  · [${failure.section}] ${failure.kind}: ${failure.detail} (t=${failure.at}ms)`);
}
process.exit(1);
