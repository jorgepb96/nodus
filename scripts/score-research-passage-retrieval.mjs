#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ANNOTATION_FORMAT = 'nodus.retrieval-passage-evidence-annotations/1';
const RANKING_FORMAT = 'nodus.research-passage-rankings/1';
const REPORT_FORMAT = 'nodus.research-passage-retrieval-score/1';
const FREEZE_FORMAT = 'nodus.retrieval-annotation-freeze/1';
const INVENTORY_FORMAT = 'nodus.retrieval-corpus-current-passages/1';
const PREREGISTRATION_FORMAT = 'nodus.research-live-evidence-preregistration/1';
const EXPECTED_QUERY_COUNT = 80;
const K = 10;
const ownFile = fileURLToPath(import.meta.url);

function fail(message) { throw new Error(message); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function uniqueString(value) { return typeof value === 'string' && value.length > 0; }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function isSha256(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function bindJsonBytes(label, value, bytes, claimedSha256) {
  if (!Buffer.isBuffer(bytes) || !isSha256(claimedSha256) || sha256(bytes) !== claimedSha256) fail(`${label} byte hash is invalid`);
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { fail(`${label} bytes are not valid JSON`); }
  if (canonical(parsed) !== canonical(value)) fail(`${label} parsed content differs from the hash-bound bytes`);
}
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }

function parseRankedPassages(row, queryId, arm) {
  if (!isObject(row) || row.queryId !== queryId || !Array.isArray(row.rankedPassages)) {
    fail(`Malformed ranked query for ${arm}/${queryId}`);
  }
  const ids = row.rankedPassages.map((item, index) => {
    if (!isObject(item) || !uniqueString(item.passageId)) {
      fail(`Every ranking item must contain an exact passageId; document-only evidence is not scorable (${arm}/${queryId}/${index + 1})`);
    }
    return item.passageId;
  });
  if (new Set(ids).size !== ids.length) fail(`Duplicate passageId in ranking ${arm}/${queryId}`);
  return ids;
}

function passageAliasMap(inventory, passageById) {
  const aliases = new Map();
  if (inventory.evidenceAliases === undefined) return aliases;
  if (!Array.isArray(inventory.evidenceAliases) || !uniqueString(inventory.provenance?.scopeId)) fail('Evidence aliases require an explicit authorized inventory scope');
  const scopeId = inventory.provenance.scopeId;
  const addAlias = (aliasId, primaryId) => {
    if (!uniqueString(aliasId) || aliases.has(aliasId) || passageById.has(aliasId)) fail(`Ambiguous or colliding evidence alias: ${aliasId}`);
    aliases.set(aliasId, primaryId);
  };
  for (const alias of inventory.evidenceAliases) {
    if (!isObject(alias) || alias.scopeId !== scopeId || !Number.isSafeInteger(alias.ordinal) || alias.ordinal < 0) fail('Evidence alias has missing or foreign scope/ordinal');
    const primary = passageById.get(alias.vectorPassageId);
    if (!primary || primary.passage_id !== alias.vectorPassageId || primary.ordinal !== alias.ordinal
        || primary.sourceDocumentId !== alias.sourceDocumentId || alias.textSha256 !== primary.passage_text_sha256
        || alias.locatorSha256 !== sha256(Buffer.from(canonical(primary.locator), 'utf8'))
        || !uniqueString(primary.index_key)) fail(`Evidence alias does not resolve to a matching primary passage: ${alias.vectorPassageId}`);
    const expectedVectorEvidenceId = `documentary:${scopeId}:${primary.index_key}:${alias.ordinal}`;
    if (alias.vectorEvidenceId !== expectedVectorEvidenceId) fail('Vector evidence alias does not match the primary index identity');
    const lexicalPrefix = `documentary:${scopeId}:`;
    const lexicalSuffix = `:${alias.ordinal}`;
    if (!uniqueString(alias.lexicalEvidenceId) || !alias.lexicalEvidenceId.startsWith(lexicalPrefix)
        || !alias.lexicalEvidenceId.endsWith(lexicalSuffix)) fail('Lexical evidence alias has malformed scope or ordinal');
    const lexicalKey = alias.lexicalEvidenceId.slice(lexicalPrefix.length, -lexicalSuffix.length);
    if (!lexicalKey || lexicalKey === primary.index_key || !uniqueString(alias.lexicalPassageId)
        || alias.lexicalPassageId !== `${lexicalKey}:${alias.ordinal}`) fail('Lexical evidence alias does not identify a distinct lexical index passage');
    addAlias(alias.vectorEvidenceId, primary.passage_id);
    addAlias(alias.lexicalEvidenceId, primary.passage_id);
  }
  return aliases;
}

function validateInputs(annotations, rankings, inventory, preregistration, context) {
  if (!isObject(annotations) || annotations.format !== ANNOTATION_FORMAT || !Array.isArray(annotations.queries)) {
    fail(`Annotations must use ${ANNOTATION_FORMAT}`);
  }
  if (!isObject(inventory) || inventory.format !== INVENTORY_FORMAT || !Array.isArray(inventory.passages)) fail(`Inventory must use ${INVENTORY_FORMAT}`);
  if (!isObject(preregistration) || preregistration.format !== PREREGISTRATION_FORMAT || !Array.isArray(preregistration.queries)) fail(`Preregistration must use ${PREREGISTRATION_FORMAT}`);
  if (annotations.queries.length !== EXPECTED_QUERY_COUNT || preregistration.queries.length !== EXPECTED_QUERY_COUNT) {
    fail(`The fixed preregistered set requires exactly ${EXPECTED_QUERY_COUNT} annotations and queries`);
  }
  if (!isObject(rankings) || rankings.format !== RANKING_FORMAT || !Array.isArray(rankings.arms)) {
    fail(`Rankings must use ${RANKING_FORMAT}`);
  }
  const provenance = annotations.provenance;
  if (!isObject(provenance) || provenance.passageInventorySha256 !== context.inventorySha256
      || provenance.preregistrationSha256 !== context.preregistrationSha256) fail('Annotation provenance does not bind the supplied inventory and preregistration');
  const { freezeRecord } = context;
  if (!isObject(freezeRecord) || freezeRecord.format !== FREEZE_FORMAT
      || !isSha256(freezeRecord.annotationSha256) || freezeRecord.annotationSha256 !== context.annotationSha256
      || freezeRecord.passageInventorySha256 !== context.inventorySha256
      || freezeRecord.preregistrationSha256 !== context.preregistrationSha256) fail('Freeze record hashes do not match annotations, inventory, and preregistration');
  if (rankings.annotationSha256 !== context.annotationSha256 || rankings.inventorySha256 !== context.inventorySha256
      || rankings.preregistrationSha256 !== context.preregistrationSha256) fail('Rankings are not hash-bound to the supplied annotations, inventory, and preregistration');
  const passageById = new Map();
  for (const passage of inventory.passages) {
    if (!isObject(passage) || !uniqueString(passage.passage_id) || passageById.has(passage.passage_id)
        || !uniqueString(passage.sourceDocumentId) || !isSha256(passage.sourceSha256)
        || !isSha256(passage.text_fingerprint) || typeof passage.text !== 'string'
        || passage.passage_text_sha256 !== sha256(Buffer.from(passage.text, 'utf8')) || !isObject(passage.locator)) fail('Malformed or duplicate passage in inventory');
    passageById.set(passage.passage_id, passage);
  }
  const aliases = passageAliasMap(inventory, passageById);
  const preregById = new Map();
  for (const query of preregistration.queries) {
    if (!isObject(query) || !uniqueString(query.id) || preregById.has(query.id)
        || typeof query.question !== 'string' || typeof query.isAnswerable !== 'boolean') fail('Malformed or duplicate preregistered query');
    preregById.set(query.id, query);
  }
  const plannedAnswerable = preregistration.queries.filter(query => query.isAnswerable).length;
  if (plannedAnswerable !== 60 || preregistration.queries.length - plannedAnswerable !== 20) {
    fail('The fixed preregistration must contain 60 answerable and 20 insufficient-evidence queries');
  }
  if (preregistration.counts !== undefined && (!isObject(preregistration.counts)
      || preregistration.counts.total !== 80 || preregistration.counts.answerable !== 60
      || preregistration.counts.insufficient !== 20)) fail('Preregistration claimed counts do not match the fixed 80-query split');
  const cases = new Map();
  for (const row of annotations.queries) {
    if (!isObject(row) || !uniqueString(row.queryId) || cases.has(row.queryId)
        || typeof row.answerable !== 'boolean' || !Array.isArray(row.requiredFacts) || !uniqueString(row.annotationStatus)) {
      fail('Annotation cases require unique queryId, answerable, requiredFacts, and annotationStatus fields');
    }
    const prereg = preregById.get(row.queryId);
    if (!prereg || prereg.question !== row.question || prereg.isAnswerable !== row.answerable) {
      fail(`Annotation query identity/text/answerability differs from preregistration: ${row.queryId}`);
    }
    const allowedStatuses = row.answerable ? new Set(['ready', 'partial_pending']) : new Set(['absence_unverified', 'absence_verified']);
    if (!allowedStatuses.has(row.annotationStatus)) fail(`Unknown or contradictory annotation status for ${row.queryId}: ${row.annotationStatus}`);
    if (row.answerable && !row.requiredFacts.length) fail(`Answerable query ${row.queryId} has no required facts; refusing silent exclusion`);
    const factIds = new Set();
    for (const fact of row.requiredFacts) {
      if (!isObject(fact) || !uniqueString(fact.id) || factIds.has(fact.id) || !Array.isArray(fact.evidence)) fail(`Malformed or duplicate atomic fact on ${row.queryId}`);
      factIds.add(fact.id);
      for (const evidence of fact.evidence) {
        if (!isObject(evidence) || !uniqueString(evidence.passageId)) fail(`Missing exact passage ID on ${row.queryId}`);
        const passage = passageById.get(evidence.passageId);
        if (!passage) fail(`Annotation evidence passage is absent from the bound inventory: ${evidence.passageId}`);
        if (evidence.documentId !== passage.sourceDocumentId || evidence.documentSha256 !== passage.sourceSha256
            || evidence.textFingerprint !== passage.text_fingerprint || canonical(evidence.locator) !== canonical(passage.locator)
            || typeof evidence.quote !== 'string' || !evidence.quote || !passage.text.includes(evidence.quote)) {
          fail(`Annotation evidence does not match passage identity, locator, or literal text: ${evidence.passageId}`);
        }
      }
    }
    cases.set(row.queryId, { ...row, preregistration: { language: prereg.language ?? null, kind: prereg.kind ?? null } });
  }
  if (preregById.size !== cases.size || [...preregById.keys()].some(queryId => !cases.has(queryId))) fail('Annotation IDs do not exactly cover the fixed preregistered query set');
  const arms = new Map();
  for (const arm of rankings.arms) {
    if (!isObject(arm) || !uniqueString(arm.arm) || arms.has(arm.arm) || !Array.isArray(arm.queries)) fail('Ranking arms require unique names and query arrays');
    const rows = new Map();
    for (const row of arm.queries) {
      if (!isObject(row) || !uniqueString(row.queryId) || rows.has(row.queryId)) fail(`Duplicate or malformed query ranking in ${arm.arm}`);
      if (!cases.has(row.queryId)) fail(`Ranking contains an unknown query ID: ${row.queryId}`);
      const ids = parseRankedPassages(row, row.queryId, arm.arm);
      for (const id of ids) if (!passageById.has(id) && !aliases.has(id)) fail(`Ranked passage is absent from the bound inventory and verified aliases: ${id}`);
      const topIds = ids.slice(0, K);
      // Preserve the raw top-K boundary, then deduplicate aliases for the same source evidence.
      rows.set(row.queryId, [...new Set(topIds.map(id => aliases.get(id) ?? id))]);
    }
    for (const queryId of cases.keys()) if (!rows.has(queryId)) fail(`Ranking arm ${arm.arm} is missing planned query ${queryId}`);
    arms.set(arm.arm, rows);
  }
  if (!arms.size) fail('At least one ranking arm is required');
  return { cases, arms, passageById };
}

function factGold(fact) {
  if (!isObject(fact) || !uniqueString(fact.id) || !uniqueString(fact.status) || !Array.isArray(fact.evidence)) {
    fail('Atomic facts require id, status, and evidence fields');
  }
  const ids = new Set();
  const ambiguousEvidenceIds = new Set();
  for (const evidence of fact.evidence) {
    if (!isObject(evidence) || !uniqueString(evidence.passageId) || !uniqueString(evidence.documentSha256)
        || !uniqueString(evidence.textFingerprint) || !uniqueString(evidence.quote)) {
      fail(`Malformed passage evidence on fact ${fact.id}`);
    }
    if (evidence.ambiguity) ambiguousEvidenceIds.add(evidence.passageId);
    else ids.add(evidence.passageId);
  }
  return { complete: fact.status === 'supported' && fact.exhaustiveCorpusScan === true
      && ids.size > 0 && ambiguousEvidenceIds.size === 0, ids, ambiguousEvidenceIds };
}

function dcg(relevant, ids) {
  let score = 0;
  ids.slice(0, K).forEach((id, index) => { if (relevant.has(id)) score += 1 / Math.log2(index + 2); });
  return score;
}

function queryMetric(query, rankedIds) {
  if (query.answerable) {
    if (!query.requiredFacts.length) fail(`Answerable query ${query.queryId} has no required facts; refusing silent exclusion`);
    const factRows = query.requiredFacts.map(factGold);
    const knownRelevant = new Set(factRows.flatMap(row => [...row.ids]));
    const factHits = query.requiredFacts.map((fact, index) => ({
      factId: fact.id,
      status: fact.status,
      complete: factRows[index].complete,
      hitAt10: factRows[index].ids.size > 0 && rankedIds.some(id => factRows[index].ids.has(id)),
      ambiguousEvidencePassageIds: [...factRows[index].ambiguousEvidenceIds],
    }));
    const completeGold = query.annotationStatus === 'ready' && factRows.every(row => row.complete);
    const anyKnownHit = rankedIds.some(id => knownRelevant.has(id));
    const factCoverageLowerBound = factHits.filter(row => row.hitAt10).length / factHits.length;
    if (!completeGold) {
      return { queryId: query.queryId, annotationStatus: query.annotationStatus, goldStatus: 'pending',
        knownSupportedEvidenceHitAt10: anyKnownHit, knownFactCoverageAt10: factCoverageLowerBound,
        evidenceHitAt10LowerBound: anyKnownHit ? 1 : 0,
        factCoverageAt10LowerBound: factCoverageLowerBound,
        evidenceHitAt10: null, factCoverageAt10: null, exhaustiveRecallAt10: null, mrrAt10: null, ndcgAt10: null,
        unresolvedFactIds: factHits.filter(row => !row.complete).map(row => row.factId), factHits };
    }
    const relevant = knownRelevant;
    const hit = rankedIds.some(id => relevant.has(id));
    const firstRank = rankedIds.findIndex(id => relevant.has(id));
    const idealCount = Math.min(relevant.size, K);
    const ideal = Array.from({ length: idealCount }, (_, index) => 1 / Math.log2(index + 2)).reduce((a, b) => a + b, 0);
    const ndcg = ideal ? dcg(relevant, rankedIds) / ideal : null;
    return { queryId: query.queryId, annotationStatus: query.annotationStatus, goldStatus: 'complete',
      knownSupportedEvidenceHitAt10: hit, evidenceHitAt10: hit ? 1 : 0,
      factCoverageAt10: factCoverageLowerBound,
      exhaustiveRecallAt10: relevant.size ? [...new Set(rankedIds)].filter(id => relevant.has(id)).length / relevant.size : null,
      mrrAt10: firstRank < 0 ? 0 : 1 / (firstRank + 1), ndcgAt10: ndcg,
      relevantPassageCount: relevant.size, factHits };
  }
  const absenceVerified = query.annotationStatus === 'absence_verified'
    && query.absenceEvidence?.entireCorpusAbsence === 'verified';
  if (!absenceVerified) return { queryId: query.queryId, annotationStatus: query.annotationStatus,
    goldStatus: 'absence_unverified', falseHitAt10: null, unresolved: true };
  return { queryId: query.queryId, annotationStatus: query.annotationStatus, goldStatus: 'absence_verified',
    falseHitAt10: rankedIds.length > 0 ? 1 : 0, falseHitPassageIds: rankedIds };
}

function summaryFor(metrics, plannedQueries) {
  const answerable = metrics.filter(row => row.goldStatus === 'complete' || row.goldStatus === 'pending');
  const complete = metrics.filter(row => row.goldStatus === 'complete');
  const unresolved = answerable.filter(row => row.goldStatus !== 'complete');
  const completeMean = key => mean(complete.map(row => row[key]));
  const conservative = (key, lowerBoundKey = null) => mean(answerable.map(row => row.goldStatus === 'complete'
    ? row[key] : (lowerBoundKey ? row[lowerBoundKey] : 0)));
  const noEvidence = metrics.filter(row => row.goldStatus === 'absence_verified' || row.goldStatus === 'absence_unverified');
  return {
    plannedQueryCount: plannedQueries,
    answerablePlannedDenominator: answerable.length,
    answerableCompleteGold: complete.length,
    answerablePendingGold: unresolved.length,
    answerablePendingQueryIds: unresolved.map(row => row.queryId),
    noEvidencePlannedDenominator: noEvidence.length,
    noEvidenceVerified: noEvidence.filter(row => row.goldStatus === 'absence_verified').length,
    noEvidenceUnverified: noEvidence.filter(row => row.goldStatus === 'absence_unverified').length,
    metrics: {
      evidenceHitAt10: { completeGoldMean: completeMean('evidenceHitAt10'), plannedDenominatorLowerBound: conservative('evidenceHitAt10', 'evidenceHitAt10LowerBound'),
        plannedDenominator: answerable.length, unresolvedCount: unresolved.length },
      factCoverageAt10: { completeGoldMean: completeMean('factCoverageAt10'), plannedDenominatorLowerBound: conservative('factCoverageAt10', 'factCoverageAt10LowerBound'),
        plannedDenominator: answerable.length, unresolvedCount: unresolved.length,
        pendingFactCount: metrics.filter(row => row.goldStatus === 'pending').reduce((sum, row) => sum + row.unresolvedFactIds.length, 0),
        pendingGoldContribution: 0 },
      exhaustiveRecallAt10: { completeGoldMean: completeMean('exhaustiveRecallAt10'),
        plannedDenominatorLowerBound: conservative('exhaustiveRecallAt10'), plannedDenominator: answerable.length,
        unresolvedCount: unresolved.length, status: unresolved.length ? 'partial_pending' : 'measured' },
      mrrAt10: { completeGoldMean: completeMean('mrrAt10'), plannedDenominatorLowerBound: conservative('mrrAt10'),
        plannedDenominator: answerable.length, unresolvedCount: unresolved.length, status: unresolved.length ? 'partial_pending' : 'measured' },
      ndcgAt10: { completeGoldMean: completeMean('ndcgAt10'), plannedDenominatorLowerBound: conservative('ndcgAt10'),
        plannedDenominator: answerable.length, unresolvedCount: unresolved.length, status: unresolved.length ? 'partial_pending' : 'measured' },
      falseHitAt10: { verifiedGoldMean: mean(metrics.filter(row => row.goldStatus === 'absence_verified').map(row => row.falseHitAt10)),
        plannedDenominator: noEvidence.length, verifiedCount: noEvidence.filter(row => row.goldStatus === 'absence_verified').length,
        unresolvedCount: noEvidence.filter(row => row.goldStatus !== 'absence_verified').length,
        unresolvedQueryIds: noEvidence.filter(row => row.goldStatus !== 'absence_verified').map(row => row.queryId) },
    },
  };
}

export function scoreResearchPassageRetrieval({ annotations, annotationBytes, inventory, inventoryBytes,
  preregistration, preregistrationBytes, rankings, rankingBytes, freezeRecord }) {
  const context = {
    annotationSha256: annotationBytes ? sha256(annotationBytes) : null,
    inventorySha256: inventoryBytes ? sha256(inventoryBytes) : null,
    preregistrationSha256: preregistrationBytes ? sha256(preregistrationBytes) : null,
    freezeRecord,
  };
  bindJsonBytes('Annotations', annotations, annotationBytes, context.annotationSha256);
  bindJsonBytes('Inventory', inventory, inventoryBytes, context.inventorySha256);
  bindJsonBytes('Preregistration', preregistration, preregistrationBytes, context.preregistrationSha256);
  bindJsonBytes('Rankings', rankings, rankingBytes, rankingBytes ? sha256(rankingBytes) : null);
  const { cases, arms } = validateInputs(annotations, rankings, inventory, preregistration, context);
  const reportArms = [];
  for (const [arm, rankByQuery] of arms) {
    const perQuery = [...cases.values()].map(query => ({ ...queryMetric(query, rankByQuery.get(query.queryId)),
      language: query.preregistration.language, kind: query.preregistration.kind }));
    reportArms.push({ arm, summary: summaryFor(perQuery, cases.size), perQuery });
  }
  return { format: REPORT_FORMAT, k: K, annotationFormat: annotations.format,
    annotationSha256: context.annotationSha256,
    inventorySha256: context.inventorySha256,
    preregistrationSha256: context.preregistrationSha256,
    annotationFreezeSha256: freezeRecord.annotationSha256,
    rankingSha256: sha256(rankingBytes),
    rankingSource: rankings.source ?? null,
    scoringRules: { exactPassageIdRequired: true, documentOnlyMatchesCount: false,
      unknownOrPartialGoldExcludedSilently: false, exhaustiveMetricsRequireCompletePassageGold: true,
      noEvidenceScoringRequiresVerifiedCorpusWideAbsence: true }, arms: reportArms };
}

function readBytes(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`Input must be a regular file: ${file}`);
  return fs.readFileSync(file);
}
function readJson(file) {
  return JSON.parse(readBytes(file).toString('utf8'));
}
function usage() {
  return `Usage:\n  node scripts/score-research-passage-retrieval.mjs --annotations=FILE --freeze=FILE --inventory=FILE --preregistration=FILE --rankings=FILE --output=NEW_FILE\n\n` +
    `Score exact passage rankings against a frozen nodus.retrieval-passage-evidence-annotations/1 file. ` +
    `Input rankings use nodus.research-passage-rankings/1 with arms[].queries[].rankedPassages[] items containing passageId. ` +
    `Document-only matches never count. Partial facts and unknown absence stay explicit in planned denominators. ` +
    `Recall@10, MRR@10, and nDCG@10 are computed only for complete exhaustive gold; pending cases remain listed.\n\n` +
    `The runner validates the fixed 80-query preregistration and every exact passage ID/quote against the hash-bound inventory. ` +
    `The rank-independent corrected extraction workflow is nodus-clean-markdown/12; see scripts/RESEARCH_PASSAGE_ANNOTATION_WORKFLOW.md.\n`;
}
function cliArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (item === '--help' || item === '-h') args.help = true;
    else if (item.startsWith('--')) {
      const index = item.indexOf('=');
      if (index < 0) args[item.slice(2)] = true;
      else args[item.slice(2, index)] = item.slice(index + 1);
    } else fail(`Unexpected argument: ${item}`);
  }
  return args;
}
if (process.argv[1] && path.resolve(process.argv[1]) === ownFile) {
  try {
    const args = cliArgs(process.argv.slice(2));
    if (args.help) { console.log(usage()); }
    else {
      if (!args.annotations || !args.freeze || !args.inventory || !args.preregistration || !args.rankings || !args.output) fail(usage());
      const output = path.resolve(args.output);
      if (fs.existsSync(output)) fail('Output already exists; use a new versioned file path');
      const annotationFile = path.resolve(args.annotations);
      const inventoryFile = path.resolve(args.inventory);
      const preregistrationFile = path.resolve(args.preregistration);
      const rankingFile = path.resolve(args.rankings);
      const annotationBytes = readBytes(annotationFile), inventoryBytes = readBytes(inventoryFile);
      const preregistrationBytes = readBytes(preregistrationFile), rankingBytes = readBytes(rankingFile);
      const freezeRecord = readJson(path.resolve(args.freeze));
      const report = scoreResearchPassageRetrieval({ annotations: JSON.parse(annotationBytes.toString('utf8')), annotationBytes,
        inventory: JSON.parse(inventoryBytes.toString('utf8')), inventoryBytes,
        preregistration: JSON.parse(preregistrationBytes.toString('utf8')), preregistrationBytes,
        rankings: JSON.parse(rankingBytes.toString('utf8')), rankingBytes, freezeRecord });
      const fd = fs.openSync(output, 'wx', 0o600);
      try { fs.writeFileSync(fd, `${JSON.stringify(report, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      console.log(JSON.stringify({ status: 'scored', output, arms: report.arms.map(row => ({ arm: row.arm, summary: row.summary })) }));
    }
  } catch (error) { console.error(`Passage retrieval scoring rejected: ${String(error?.message ?? error)}`); process.exitCode = 1; }
}
