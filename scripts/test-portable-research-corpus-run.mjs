import test from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';
const built=buildSync({stdin:{contents:"export {portableResearchCorpusRun} from './shared/portableResearchCorpusRun';export {RETRIEVAL_PRESETS} from './shared/researchCorpus';",resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'browser',metafile:true});assert(!Object.keys(built.metafile.inputs).some(file=>file.includes('electron/')));const module={exports:{}};new Function('module','exports','Buffer',built.outputFiles[0].text)(module,module.exports,undefined);const {portableResearchCorpusRun,RETRIEVAL_PRESETS}=module.exports;
test('canonical run consumes prepared host evidence with its exact scope, citation and shared budget',async()=>{const document={id:'source-one',workId:'work-one',title:'Copia documental real',authors:['Autora'],year:1782,origin:{kind:'nodus',id:'source-one'},revision:'actual-source-revision',attachmentId:null,coverage:'fulltext',permissionRevision:'permission-one'},scope={id:'scope-one',vaultId:'vault-one',notebookId:null,documents:[document]},evidence={id:'raw-source:0',documentId:document.id,workId:document.workId,revision:document.revision,text:'El caudal descendió a la mitad según la medición conservada.',locator:{pageNumber:3,pageLabel:'3',sourceRef:null},provenance:'source',limitations:[]};let currentVault='vault-one',reads=0;
 const methods={recordEmbeddingTrace:undefined,getResearchPreparationInventory:()=>({documents:[{...document,preparation:{text:'fulltext',embeddings:'ready',lexical:'ready'}}]}),manualIdeaIds:()=>null,resolveResearchSourceScope:()=>({ideaIds:new Set()}),getActiveVault:()=>({id:currentVault}),researchCorpusInventory:()=>({documents:[document]}),documentsById:rows=>new Map(rows.map(row=>[row.id,row])),assertResearchDocument:(_scope,id,current)=>{assert.equal(id,document.id);assert.equal(current,document);},embed:async()=>null,researchActivityStep:(_kind,_step,work)=>work(),retrieveHierarchical:async()=>({ideas:[],passages:[]}),retrieveSharedDocumentaryEvidence:async()=>{reads++;return {evidence:[evidence],traversal:{rounds:1,candidates:1,partial:false}};},scopedIdeaEvidencePassages:()=>[],selectPassageEvidence:()=>[],startResearchActivity:()=>()=>{},lexicalIdeas:()=>[],graph:()=>({gaps:[],contradictions:[],themes:[]})};
 const host=new Proxy(methods,{get:(target,key)=>key in target?target[key]:(()=>{throw new Error(`Unexpected host method ${String(key)}`);})});const run=new (portableResearchCorpusRun(host).ResearchCorpusRun)(scope,RETRIEVAL_PRESETS.fast);await run.retrieve('caudal');assert.equal(reads,1);const snapshot=run.snapshotFromEvidence({objective:'caudal',kind:'deep_research'});assert.equal(snapshot.passages[0].citation,'nodus://passage/documentary%3Ascope-one%3Araw-source%3A0');assert.equal(snapshot.passages[0].summary,evidence.text);assert.equal(run.coverage().evidenceTokens,new TextEncoder().encode(evidence.text).length);assert.equal(run.coverage().rounds,1);currentVault='foreign';assert.throws(()=>run.snapshotFromEvidence({objective:'caudal'}),/scope_changed/);
});

test('prepared lexical ideas use the portable host with manual scope and only owning work links', async () => {
  const document = {id: 'source-one', workId: 'work-one', title: 'Fuente QA', authors: [], year: 2024,
    origin: {kind: 'nodus', id: 'source-one'}, revision: 'source-r1', attachmentId: null,
    coverage: 'fulltext', permissionRevision: 'permission-r1'};
  const scope = {id: 'scope-one', vaultId: 'vault-one', notebookId: null, documents: [document]};
  const idea = {global_id: 'idea-one', type: 'claim', label: 'Caudal medido', statement: 'El caudal se mide en la fuente QA.'};
  const calls = [];
  let trace;
  const methods = {
    recordEmbeddingTrace: event => { trace = event; },
    getResearchPreparationInventory: () => ({documents: [{...document, preparation: {text: 'fulltext', embeddings: 'ready', lexical: 'ready'}}]}),
    manualIdeaIds: () => new Set(['idea-one']),
    resolveResearchSourceScope: () => ({ideaIds: new Set(['idea-one', 'idea-excluded-by-manual-mode'])}),
    getActiveVault: () => ({id: scope.vaultId}), researchCorpusInventory: () => ({documents: [document]}),
    documentsById: rows => new Map(rows.map(row => [row.id, row])),
    assertResearchDocument: (_scope, id, current) => { assert.equal(id, document.id); assert.equal(current, document); },
    embed: async () => null, researchActivityStep: (_kind, _step, work) => work(),
    retrieveHierarchical: async (_query, options) => { assert.deepEqual(options.ideaIds, ['idea-one']); return {ideas: [], passages: []}; },
    startResearchActivity: () => () => {}, scopedIdeaEvidencePassages: () => [], selectPassageEvidence: () => [],
    lexicalIdeas: ids => { calls.push(['lexical', ids]); assert.deepEqual(ids, ['idea-one']); return [idea]; },
    ideaWorkIds: id => { calls.push(['works', id]); return [{nodus_id: 'work-one'}, {nodus_id: 'foreign-work'}]; },
    graph: () => ({gaps: [], contradictions: [], themes: []}),
  };
  const host = new Proxy(methods, {get: (target, key) => key in target ? target[key]
    : (() => { throw new Error(`Unexpected host operation ${String(key)}`); })});
  const run = new (portableResearchCorpusRun(host).ResearchCorpusRun)(scope, RETRIEVAL_PRESETS.fast);
  run.layers = {ideas: true, documents: false, indexed: false};
  await run.retrieve('caudal');
  const snapshot = run.snapshotFromEvidence({objective: 'caudal', kind: 'deep_research'});
  assert.deepEqual(calls, [['lexical', ['idea-one']], ['works', 'idea-one']]);
  assert.deepEqual(snapshot.ideas.map(item => item.id), ['idea-one']);
  assert.deepEqual(snapshot.ideas[0].works.map(item => item.nodus_id), ['work-one']);
  assert.equal(snapshot.ideas[0].statement, idea.statement);
  assert.deepEqual(trace.selectedIdeas, ['idea-one']);
  assert.equal(trace.scopeId, scope.id);
});
