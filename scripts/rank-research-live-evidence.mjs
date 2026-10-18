#!/usr/bin/env node
/** Preserve the recorded ordering of current-source retrieval candidates for offline scoring. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalResearchJson, verifyDerivedIndexAuthorization } from './lib/researchLiveIndexAuthorization.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const bind = (label, value, bytes) => {
  if (!Buffer.isBuffer(bytes) || canonicalResearchJson(JSON.parse(bytes.toString('utf8'))) !== canonicalResearchJson(value)) fail(`${label} bytes differ from parsed input`);
  return hash(bytes);
};

export function buildResearchPassageRankings({ source, sourceBytes, inventory, inventoryBytes, preregistration,
  preregistrationBytes, annotations, annotationBytes, freezeRecord }) {
  const sourceSha256 = bind('Source', source, sourceBytes);
  const inventorySha256 = bind('Inventory', inventory, inventoryBytes);
  const preregistrationSha256 = bind('Preregistration', preregistration, preregistrationBytes);
  const annotationSha256 = bind('Annotations', annotations, annotationBytes);
  if (freezeRecord?.format !== 'nodus.retrieval-annotation-freeze/1'
      || freezeRecord.annotationSha256 !== annotationSha256 || freezeRecord.passageInventorySha256 !== inventorySha256
      || freezeRecord.preregistrationSha256 !== preregistrationSha256) fail('An exact detached annotation freeze is required');
  if (annotations?.provenance?.passageInventorySha256 !== inventorySha256
      || annotations.provenance.preregistrationSha256 !== preregistrationSha256) fail('Annotation provenance mismatch');
  if (source?.format !== 'nodus.research-case-sources/1' || source.cases?.length !== 80
      || preregistration?.format !== 'nodus.research-live-evidence-preregistration/1' || preregistration.queries?.length !== 80
      || annotations?.queries?.length !== 80 || inventory?.format !== 'nodus.retrieval-corpus-current-passages/1') fail('Expected the complete fixed-80 current-source campaign');
  const scopeId = source.scopeContract?.scopeId;
  if (!scopeId || inventory.provenance?.scopeId !== scopeId
      || inventory.provenance.preregistrationSha256 !== preregistrationSha256) fail('Inventory scope/preregistration mismatch');
  const primary = new Map(inventory.passages.map(row => [row.passage_id, row]));
  if (primary.size !== inventory.passages.length) fail('Duplicate inventory passage');
  const aliases = new Map();
  for (const alias of inventory.evidenceAliases ?? []) {
    const passage = primary.get(alias.vectorPassageId);
    if (!passage || alias.scopeId !== scopeId || alias.ordinal !== passage.ordinal
        || alias.sourceDocumentId !== passage.sourceDocumentId || alias.textSha256 !== passage.passage_text_sha256
        || alias.locatorSha256 !== hash(Buffer.from(canonicalResearchJson(passage.locator)))
        || alias.vectorEvidenceId !== `documentary:${scopeId}:${passage.index_key}:${passage.ordinal}`
        || alias.lexicalEvidenceId !== `documentary:${scopeId}:${alias.lexicalPassageId}`
        || aliases.has(alias.lexicalPassageId) || primary.has(alias.lexicalPassageId)) fail('Invalid or colliding source evidence alias');
    aliases.set(alias.lexicalPassageId, { passage, evidenceId: alias.lexicalEvidenceId });
  }
  const queryById = new Map(preregistration.queries.map(row => [row.id, row]));
  const annotationIds = new Set(annotations.queries.map(row => row.queryId));
  const sourceIds = new Set(source.cases.map(row => row.id));
  if (queryById.size !== 80 || annotationIds.size !== 80 || sourceIds.size !== 80
      || [...queryById.keys()].some(id => !annotationIds.has(id) || !sourceIds.has(id))) fail('Question IDs do not match the fixed preregistration');
  const arms = ['semantic', 'lexical', 'hybrid-selected'].map(arm => ({ arm, queries: [] }));
  for (const row of source.cases) {
    const planned = queryById.get(row.id);
    if (row.question !== planned.question || row.language !== planned.language || row.isAnswerable !== planned.isAnswerable
        || row.searchError || row.retrievalTraces?.length !== 1) fail(`Incomplete or changed single-query trace: ${row.id}`);
    const trace = row.retrievalTraces[0];
    if (trace.type !== 'documentary-retrieval' || trace.scopeId !== scopeId
        || canonicalResearchJson(trace.contract) !== canonicalResearchJson(source.profileContract.embeddingModelContract)
        || trace.profile?.provider !== source.profileContract.provider || trace.profile?.model !== source.profileId) fail(`Trace scope/model contract mismatch: ${row.id}`);
    for (const [index, field] of ['semantic', 'lexical', 'selected'].entries()) {
      const candidates = trace.retrieval?.[field];
      if (!Array.isArray(candidates)) fail(`Missing ${field} candidates: ${row.id}`);
      const seen = new Set();
      const rankedPassages = candidates.map(candidate => {
        const direct = primary.get(candidate.id), alias = aliases.get(candidate.id);
        const passage = direct ?? alias?.passage;
        if (!passage || candidate.documentId !== passage.document_id || seen.has(candidate.id)) fail(`Unknown, foreign or duplicate candidate: ${row.id}/${field}`);
        seen.add(candidate.id);
        return { passageId: direct ? candidate.id : alias.evidenceId,
          recordedPassageId: candidate.id, recordedDocumentId: candidate.documentId };
      });
      arms[index].queries.push({ queryId: row.id, rankedPassages });
    }
  }
  return { format: 'nodus.research-passage-rankings/1', annotationSha256, inventorySha256, preregistrationSha256,
    source: { format: 'nodus.recorded-live-retrieval-order/1', sourceSnapshotSha256: sourceSha256,
      profileContractSha256: source.profileContractSha256, scopeContractSha256: source.scopeContractSha256,
      ordering: 'Exact saved array order; no sorting, deduplication, gold-dependent selection or top-K expansion.',
      arms: { semantic: 'saved semantic candidates', lexical: 'saved lexical candidates, including the recorded lexical query expansion',
        'hybrid-selected': 'actual product evidence selection; this includes its context budget and diversity filters, not an unrestricted hybrid ranking' },
      limitation: 'All three arrays come from the same product search. They are candidate-lane diagnostics, not separately executed ablation runs.' }, arms };
}

function read(file) {
  const absolute = path.resolve(file), stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(absolute) !== absolute) fail('Expected canonical regular input');
  const bytes = fs.readFileSync(absolute);
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = Object.fromEntries(process.argv.slice(2).map(arg => {
      const split = arg.indexOf('=');
      if (!arg.startsWith('--') || split < 3) fail('Use --sources, --inventory, --preregistration, --annotations, --freeze and --output with =PATH');
      return [arg.slice(2, split), arg.slice(split + 1)];
    }));
    for (const key of ['sources', 'inventory', 'preregistration', 'annotations', 'freeze', 'output']) if (!args[key]) fail(`Missing --${key}`);
    const source = read(args.sources);
    verifyDerivedIndexAuthorization(source.value);
    const root = fs.realpathSync(source.value.profileRoot);
    const artifacts = path.join(root, 'artifacts');
    for (const file of Object.values(args)) if (!path.resolve(file).startsWith(`${artifacts}${path.sep}`)) fail('Every input and output must remain inside the marked campaign artifacts');
    const inventory = read(args.inventory), preregistration = read(args.preregistration), annotations = read(args.annotations), freeze = read(args.freeze);
    const result = buildResearchPassageRankings({ source: source.value, sourceBytes: source.bytes,
      inventory: inventory.value, inventoryBytes: inventory.bytes, preregistration: preregistration.value, preregistrationBytes: preregistration.bytes,
      annotations: annotations.value, annotationBytes: annotations.bytes, freezeRecord: freeze.value });
    const output = path.resolve(args.output);
    if (fs.realpathSync(path.dirname(output)) !== path.dirname(output)) fail('Output parent is not canonical');
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ output, sha256: hash(fs.readFileSync(output)), arms: result.arms.map(arm => ({ arm: arm.arm, queries: arm.queries.length })) }));
  } catch (error) { console.error(`Ranking export rejected: ${String(error?.message ?? error)}`); process.exitCode = 1; }
}
