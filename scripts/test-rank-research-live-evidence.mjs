import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildResearchPassageRankings } from './rank-research-live-evidence.mjs';
import { canonicalResearchJson } from './lib/researchLiveIndexAuthorization.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const serialize = value => Buffer.from(JSON.stringify(value));
const scope = 'isolated-scope';
const contract = { model: 'fixture-model', dimensions: 512, revision: 'immutable-fixture' };
const passages = Array.from({ length: 12 }, (_, ordinal) => ({ passage_id: `vector:${ordinal}`, index_key: 'vector',
  ordinal, document_id: 'qa-library-document', sourceDocumentId: 'source-original',
  passage_text_sha256: hash(Buffer.from(`text-${ordinal}`)), locator: { pageNumber: ordinal + 1 } }));
const inventory = { format: 'nodus.retrieval-corpus-current-passages/1', provenance: { scopeId: scope }, passages,
  evidenceAliases: passages.map(p => ({ scopeId: scope, vectorPassageId: p.passage_id, lexicalPassageId: `lexical:${p.ordinal}`,
    vectorEvidenceId: `documentary:${scope}:${p.passage_id}`, lexicalEvidenceId: `documentary:${scope}:lexical:${p.ordinal}`,
    sourceDocumentId: p.sourceDocumentId, ordinal: p.ordinal, textSha256: p.passage_text_sha256,
    locatorSha256: hash(Buffer.from(canonicalResearchJson(p.locator))) })) };
const queries = Array.from({ length: 80 }, (_, index) => ({ id: `R${String(index + 1).padStart(3, '0')}`,
  question: `Exact question ${index + 1}`, language: 'en', isAnswerable: index < 60 }));
const preregistration = { format: 'nodus.research-live-evidence-preregistration/1', queries };
const candidates = key => passages.map(p => ({ id: `${key}:${p.ordinal}`, documentId: p.document_id }));
const source = { format: 'nodus.research-case-sources/1', profileId: 'fixture-profile', scopeContract: { scopeId: scope },
  profileContract: { provider: 'nodus', embeddingModelContract: contract },
  cases: queries.map(q => ({ ...q, retrievalTraces: [{ type: 'documentary-retrieval', scopeId: scope,
    contract, profile: { provider: 'nodus', model: 'fixture-profile' },
    retrieval: { semantic: candidates('vector'), lexical: candidates('lexical'), selected: candidates('lexical').slice(0, 5) } }] })) };
const annotations = { provenance: {}, queries: queries.map(q => ({ queryId: q.id })) };
function inputs(change = () => {}) {
  const data = structuredClone({ source, inventory, preregistration, annotations });
  change(data);
  data.inventory.provenance.preregistrationSha256 = hash(serialize(data.preregistration));
  data.annotations.provenance = { passageInventorySha256: hash(serialize(data.inventory)), preregistrationSha256: hash(serialize(data.preregistration)) };
  const result = { ...data, sourceBytes: serialize(data.source), inventoryBytes: serialize(data.inventory),
    preregistrationBytes: serialize(data.preregistration), annotationBytes: serialize(data.annotations) };
  result.freezeRecord = { format: 'nodus.retrieval-annotation-freeze/1', annotationSha256: hash(result.annotationBytes),
    passageInventorySha256: hash(result.inventoryBytes), preregistrationSha256: hash(result.preregistrationBytes) };
  return result;
}
const valid = inputs();
const before = JSON.stringify(valid);
const result = buildResearchPassageRankings(valid);
assert.equal(JSON.stringify(valid), before, 'must not rewrite source arrays or frozen inputs');
assert.deepEqual(result.arms.map(a => a.queries.length), [80, 80, 80]);
assert.deepEqual(result.arms[0].queries[0].rankedPassages.map(p => p.passageId), passages.map(p => p.passage_id));
assert.deepEqual(result.arms[1].queries[0].rankedPassages.map(p => p.passageId), passages.map(p => `documentary:${scope}:lexical:${p.ordinal}`));
assert.equal(result.arms[1].queries[0].rankedPassages[10].recordedPassageId, 'lexical:10', 'rank eleven must remain rank eleven');
assert.equal(result.arms[2].queries[0].rankedPassages.length, 5, 'must not supplement the actual product evidence selection');
const rejected = change => assert.throws(() => buildResearchPassageRankings(inputs(change)));
rejected(d => { d.source.cases[0].question = 'changed'; });
rejected(d => { d.source.cases.pop(); });
rejected(d => { d.source.cases[0].retrievalTraces.push(d.source.cases[0].retrievalTraces[0]); });
rejected(d => { d.source.cases[0].retrievalTraces[0].contract = { ...contract, revision: 'other-same-dimension' }; });
rejected(d => { d.source.cases[0].retrievalTraces[0].scopeId = 'other-vault'; });
rejected(d => { d.source.cases[0].retrievalTraces[0].retrieval.semantic[0].documentId = 'foreign'; });
rejected(d => { d.source.cases[0].retrievalTraces[0].retrieval.lexical[0].id = 'unknown:0'; });
rejected(d => { d.source.cases[0].retrievalTraces[0].retrieval.lexical.push(d.source.cases[0].retrievalTraces[0].retrieval.lexical[0]); });
rejected(d => { d.inventory.evidenceAliases[0].textSha256 = '0'.repeat(64); });
rejected(d => { d.inventory.evidenceAliases[0].locatorSha256 = '0'.repeat(64); });
const stale = inputs(); stale.freezeRecord.annotationSha256 = '0'.repeat(64);
assert.throws(() => buildResearchPassageRankings(stale), /freeze/u);
const alteredBytes = inputs(); alteredBytes.source.cases[0].language = 'es';
assert.throws(() => buildResearchPassageRankings(alteredBytes), /bytes differ/u);
console.log('PASS saved retrieval order, fixed-80 scope/contract/hash bindings, alias identity, and unchanged raw rank boundaries.');
