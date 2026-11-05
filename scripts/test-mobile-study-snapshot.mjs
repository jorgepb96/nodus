import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';

if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-study-snapshot'))process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-study-snapshot-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url);
const fetchBefore=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Snapshot consultation must never invoke a provider');};
let database;
try {
  database=require('../electron/db/database.ts');const db=database.getDb();
  const org=require('../electron/db/studyOrgRepo.ts'),knowledge=require('../electron/db/studyKnowledgeRepo.ts');
  const {projectStudyWorkspace}=require('../shared/studyOrgProjection.ts');
  const {studyKnowledgeProjection}=require('../shared/studyKnowledgeProjection.ts');
  const {DEFAULT_APP_SETTINGS}=require('../shared/defaultAppSettings.ts');
  const settings=require('../electron/db/settingsRepo.ts').getSettings();
  assert.equal(settings.studyKnowledgeAutoProcess,DEFAULT_APP_SETTINGS.studyKnowledgeAutoProcess);
  assert.deepEqual(settings.studyImproveToolbarStyleIds,DEFAULT_APP_SETTINGS.studyImproveToolbarStyleIds);
  const course=org.createStudyCourse({name:'Curso ficticio'});
  const subjects=['A','B'].map(name=>org.createStudySubject({courseId:course.id,name:`Asignatura ${name}`}));
  for(const [index,subject]of subjects.entries()){
    const document=org.createStudyDocument({title:`Evidencia ${index}`,contentMarkdown:'Texto ficticio',placement:{courseId:course.id,subjectId:subject.id}});
    const count=index===0?241:2;
    const ideas=Array.from({length:count},(_,i)=>({key:`key-${i}`,type:'concept',label:i===0?'Propáganda [especial]':`Concepto de aceptación ${index} ${String(i).padStart(3,'0')}`,
      statement:`La definición ${i} pertenece al corpus ficticio ${index}.`,role:'principal',confidence:1,evidence:[{quote:`Cita ${i}`,location:`Sección ${i+1}`}]}));
    knowledge.replaceStudySourceKnowledge({subjectId:subject.id,sourceKind:'document',sourceId:document.id,sourceTitle:document.title,sourceHash:'fixture',ideas,
      relations:ideas.slice(1).map((idea,i)=>({from:ideas[i].key,to:idea.key,type:'supports',basis:'fixture',confidence:1-i/1000})),
      embeddings:ideas.map(()=>null),embeddingProvider:'',embeddingModel:''});
    if(index===0){
      const second=org.createStudyDocument({title:'Otra fuente',placement:{courseId:course.id,subjectId:subject.id}});
      knowledge.replaceStudySourceKnowledge({subjectId:subject.id,sourceKind:'document',sourceId:second.id,sourceTitle:second.title,sourceHash:'fixture-2',
        ideas:[{...ideas[0],evidence:[{quote:'Segunda cita',location:'Página 2'},{quote:'Tercera cita',location:'Página 3'}]}],relations:[],embeddings:[null],embeddingProvider:'',embeddingModel:''});
    }
  }
  const archived=org.createStudyDocument({title:'Documento archivado'});
  db.prepare('UPDATE study_docs SET archived_at=? WHERE id=?').run('2026-01-01T00:00:00.000Z',archived.id);
  const tableNames=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'study_%'").all().map(row=>row.name);
  const tables=Object.fromEntries(tableNames.map(name=>{assert.match(name,/^study_[a-z_]+$/);return [name,db.prepare(`SELECT * FROM ${name}`).all()];}));
  const published=JSON.parse(JSON.stringify(tables));
  const before=db.prepare('SELECT total_changes() AS count').get().count;
  const projection=studyKnowledgeProjection(published);
  for(const options of [{},{includeArchived:true},{includeDeleted:true},{includeArchived:true,includeDeleted:true}])assert.deepEqual(projectStudyWorkspace(published,options),org.getStudyWorkspace(options));
  let comparedDetails=0;
  for(const subject of subjects){
    assert.deepEqual(projection.graph(subject.id),knowledge.getStudyKnowledgeGraph(subject.id));
    for(const query of ['', 'concepto', '0 240', '%', '0 24_', 'PROPÁGANDA', 'propáganda', '[especial]', '\\']){
      assert.deepEqual(projection.list(subject.id,query),knowledge.listStudyIdeas(subject.id,query));
    }
    for(const idea of knowledge.listStudyIdeas(subject.id)){assert.deepEqual(projection.detail(idea.id),knowledge.getStudyIdeaDetail(idea.id));comparedDetails++;}
  }
  assert.equal(projection.detail('missing'),null);
  assert.deepEqual(projection.graph('missing'),{subjectId:'missing',nodes:[],edges:[]});
  assert.throws(()=>studyKnowledgeProjection({...published,study_idea_evidence:undefined}),/no incluye la tabla/);
  assert.throws(()=>projectStudyWorkspace({...published,study_subjects:undefined}),/no incluye la tabla/);
  assert.equal(db.prepare('SELECT total_changes() AS count').get().count,before,'Consultation must not write or schedule analysis');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM study_knowledge_jobs').get().count,0);
  console.log(JSON.stringify({passed:true,subjects:2,comparedDetails,workspaceLifecycleVariants:4,searches:18,missingTablesFailExplicitly:true,providerCalls:0,knowledgeJobs:0}));
} finally {
  globalThis.fetch=fetchBefore;
  try{database?.closeDb?.();}catch{}
  fs.rmSync(root,{recursive:true,force:true});
}
