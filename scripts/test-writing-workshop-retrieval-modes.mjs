// Provider/DB-free contract tests for the three workshop retrieval modes.
// The fake indexes expose their call lanes so a compatibility regression cannot
// silently reintroduce hierarchical/document retrieval into v1.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-workshop-modes-'));
const outfile = path.join(root, 'writingWorkshop.mjs');
globalThis.__workshopModeCalls = { hierarchy: 0, ideas: 0, works: 0, passages: 0 };

const plugin = {
  name: 'writing-workshop-mode-stubs',
  setup(api) {
    const stub = (filter, name, contents) => {
      api.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
      api.onLoad({ filter: new RegExp(`^${name}$`), namespace: 'stub' }, () => ({ contents, loader: 'js' }));
    };
    stub(/\.\.\/db\/database$/, 'database', `
      const rows = {
        ideas: [{global_id:'i-1',type:'claim',label:'Idea',statement:'Argumento',themes:'',work_count:1,evidence_count:1,work_ids:'w-1'}],
        works: [{nodus_id:'w-1',zotero_key:'z-1',title:'Obra',authors_json:'["Autor"]',year:2020,deep_status:'done',doi:null,orientation_summary:'Resumen',document_overview:'Perfil documental',document_status:'current',document_version_id:'v-1',themes:'',idea_count:1,gap_count:0}],
      };
      export function getDb(){ return { prepare(sql){ return {
        get(){ const table = sql.match(/FROM (ideas|works|themes|gaps)/)?.[1]; return table ? (rows[table]?.[0] ?? {n:0}) : {n:0}; },
        all(){ if(sql.includes('FROM ideas i')) return rows.ideas; if(sql.includes('FROM works w')) return rows.works; return []; },
      }; } }; }
    `);
    stub(/\.\.\/graph\/graphService$/, 'graph', 'export function getContradictions(){return []}');
    stub(/\.\.\/db\/tutorRepo$/, 'tutor', 'export function listTutorRoutes(){return []}');
    stub(/\.\.\/db\/settingsRepo$/, 'settings', "export function getSettings(){return {promptLanguage:'es'}}");
    stub(/\.\/aiClient$/, 'ai', `
      export async function embedQuery(){return [1,0,0]}
      export async function embedMany(queries){return queries.map(()=>[1,0,0])}
      export async function completeJson(){return {}}
    `);
    stub(/\.\.\/db\/ideasRepo$/, 'ideas', `export async function findSimilarIdeasPaged(){globalThis.__workshopModeCalls.ideas++; return [{global_id:'i-1',type:'claim',label:'Idea',statement:'Argumento',similarity:.9}]}`);
    stub(/\.\.\/db\/workSummariesRepo$/, 'works', `export async function findSimilarWorksPaged(){globalThis.__workshopModeCalls.works++; return [{nodus_id:'w-1',title:'Obra',authors_json:'["Autor"]',year:2020,zotero_key:'z-1',doi:null,similarity:.88}]}`);
    stub(/\.\.\/db\/passagesRepo$/, 'passages', `export async function findSimilarPassagesPaged(){globalThis.__workshopModeCalls.passages++; return [{passage_id:'p-1',nodus_id:'w-1',text:'Evidencia literal.',page_label:'1',similarity:.87,title:'Obra',authors_json:'["Autor"]',year:2020,zotero_key:'z-1'}]}`);
    stub(/\.\/hierarchicalRetrieval$/, 'hierarchy', `
      export async function retrieveHierarchical(){globalThis.__workshopModeCalls.hierarchy++; return {ideas:[],works:[],documents:[],passages:[]}}
      export function selectPassageEvidence(passages){return passages}
    `);
  },
};

await build({
  entryPoints: [path.join(repoRoot, 'electron/ai/writingWorkshop.ts')],
  outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  alias: { '@shared': path.join(repoRoot, 'shared') }, plugins: [plugin], logLevel: 'silent',
});
const workshop = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
const brief = { kind: 'deep_research', objective: 'consulta', language: 'es' };

test.after(async () => { delete globalThis.__workshopModeCalls; await rm(root, { recursive: true, force: true }); });

test('legacy snapshot uses direct ideas/works/passages and never hierarchy', async () => {
  globalThis.__workshopModeCalls = { hierarchy: 0, ideas: 0, works: 0, passages: 0 };
  const snapshot = await workshop.buildHistoricalWritingWorkshopSnapshot(brief, ['probe']);
  assert.ok(snapshot.passages.length > 0);
  assert.equal(globalThis.__workshopModeCalls.hierarchy, 0);
  assert.ok(globalThis.__workshopModeCalls.passages >= 2, 'objective and probe use the historical passage index');
  assert.ok(globalThis.__workshopModeCalls.ideas > 0 && globalThis.__workshopModeCalls.works > 0);
});

test('idea-first snapshot excludes passages until document enrichment', async () => {
  globalThis.__workshopModeCalls = { hierarchy: 0, ideas: 0, works: 0, passages: 0 };
  const snapshot = await workshop.buildIdeaFirstWritingWorkshopSnapshot(brief, ['probe']);
  assert.equal(snapshot.passages.length, 0);
  assert.equal(globalThis.__workshopModeCalls.passages, 0);
  assert.equal(globalThis.__workshopModeCalls.hierarchy, 0);
});

test('hierarchical snapshot enters the hierarchical retriever', async () => {
  globalThis.__workshopModeCalls = { hierarchy: 0, ideas: 0, works: 0, passages: 0 };
  await workshop.buildWritingWorkshopSnapshot(brief);
  assert.equal(globalThis.__workshopModeCalls.hierarchy, 1);
});

test('legacy section retrieval is direct while current section retrieval is hierarchical', async () => {
  globalThis.__workshopModeCalls = { hierarchy: 0, ideas: 0, works: 0, passages: 0 };
  const input = {
    objective: 'consulta', sectionTitle: 'Sección', purpose: 'propósito', keyClaims: ['afirmación'],
    coverageQuestions: [], excludeIdeaIds: [], excludePassageIds: [], limits: { ideas: 2, passages: 2 },
  };
  const historical = await workshop.retrieveSectionMaterialLegacy(input);
  assert.ok(historical.passages.length > 0);
  assert.equal(globalThis.__workshopModeCalls.hierarchy, 0);
  assert.ok(globalThis.__workshopModeCalls.passages > 0);

  globalThis.__workshopModeCalls = { hierarchy: 0, ideas: 0, works: 0, passages: 0 };
  await workshop.retrieveSectionMaterial(input);
  assert.ok(globalThis.__workshopModeCalls.hierarchy > 0);
});
