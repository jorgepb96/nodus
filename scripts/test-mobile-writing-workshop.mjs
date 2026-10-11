import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';

if (!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-workshop-test')) process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-workshop-contract-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url), fetchBefore=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Workshop preparation and publication must not invoke providers');};
let database;
try {
  database=require('../electron/db/database.ts');const db=database.getDb();
  const settings=require('../electron/db/settingsRepo.ts');
  settings.updateSettings({academicMode:'auto',promptLanguage:'es'});
  const insert=db.prepare('INSERT INTO ideas(global_id,type,label,statement,created_at) VALUES (?,?,?,?,?)');
  for(let index=0;index<121;index++)insert.run(`workshop-${String(index).padStart(3,'0')}`,'claim',`Ámbito ${index}`,
    `El enunciado literal de la idea ${index} conserva 37 datos y no inventa evidencias.`,new Date().toISOString());
  const mobile=require('../electron/ai/mobileWritingWorkshop.ts');
  const selection=require('../shared/mobileWritingWorkshop.ts').normalizeMobileWorkshopSelection({ideaIds:['workshop-100']});
  const first=mobile.mobileWritingWorkshopCatalogue({selectionKey:'ideaIds',limit:100,offset:0});
  const last=mobile.mobileWritingWorkshopCatalogue({selectionKey:'ideaIds',limit:100,offset:100});
  assert.equal(first.total,121);assert.equal(last.items.length,21);assert.equal(last.items[0].selection_id,'workshop-100');
  assert.equal(last.hasMore,false);assert.equal(last.revision,first.revision);
  assert.equal(mobile.mobileWritingWorkshopCatalogue({selectionKey:'ideaIds',query:'ambito 100',limit:100,offset:0}).items[0].selection_id,'workshop-100');
  const source=await mobile.mobileWritingWorkshopSource(selection);
  assert.equal(source.groups.ideas.length,1);assert.equal(source.groups.obras.length,0);
  assert.match(source.groups.ideas[0].value.enunciado,/conserva 37 datos/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM writing_saved_drafts').get().count,0);
  const request={brief:{kind:'literature_review',objective:'Nueva pregunta desde el móvil',tone:'critical',language:'es'},
    title:'Borrador del móvil',selection,model:{provider:'deepseek',model:'phone-owned'}};
  const raw=JSON.stringify({title:'Borrador del móvil',abstract:'Síntesis acotada a la idea seleccionada',
    outline:[{id:'section-a',title:'Argumento',purpose:'Examinar la evidencia',keyClaims:['Se conservan 37 datos'],sources:['nodus://idea/workshop-100']}],
    draftMarkdown:Array.from({length:30},()=> 'La idea seleccionada conserva 37 datos y permite examinar sus límites [fuente](nodus://idea/workshop-100).').join('\n\n'),
    matrix:[{claim:'Se conservan 37 datos',role:'support',sourceLabel:'Ámbito 100',citation:'nodus://idea/workshop-100',
      evidence:source.groups.ideas[0].value.enunciado,notes:'Revisión de la fuente elegida'}],bibliography:[],nextSteps:['Revisar el borrador'],limitations:['Una sola fuente elegida']});
  const input={request,source,revision:source.configurationRevision,raw,sourceScope:'device_downloads',requestId:'47163d94-6f4f-4ab2-b087-7399121c1c11'};
  const saved=await mobile.saveMobileWritingWorkshop(input);
  assert.equal(saved.id,input.requestId);assert.equal(saved.model.model,'phone-owned');
  assert.equal(saved.draft.stats.selectedIdeas,1);assert.equal(saved.draft.stats.selectedWorks,0);
  assert.match(saved.draft.draftMarkdown,/no representa todo el vault/);
  assert.equal(saved.draft.mobileGenerationReceipt.sourceScope,'device_downloads');
  assert.equal(saved.draft.outline.length,1);assert.equal(saved.draft.matrix.length,1);
  assert.equal(db.prepare('SELECT statement FROM ideas WHERE global_id=?').get('workshop-100').statement,source.groups.ideas[0].value.enunciado);
  db.prepare('UPDATE ideas SET statement=? WHERE global_id=?').run('El Mac cambió después del guardado','workshop-100');
  assert.equal((await mobile.saveMobileWritingWorkshop(input)).id,saved.id,'Lost acknowledgement returns the original even after a later Mac edit');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM writing_saved_drafts').get().count,1);
  await assert.rejects(mobile.saveMobileWritingWorkshop({...input,raw:raw.replace('37 datos','38 datos')}),/idempotency_conflict/);
  await assert.rejects(mobile.saveMobileWritingWorkshop({...input,requestId:'ab291503-5859-42d6-bef9-6ed3930ff2e5'}),/generation_conflict/);
  const tampered=structuredClone(source);tampered.groups.ideas[0].value.enunciado='Inventado';
  await assert.rejects(mobile.saveMobileWritingWorkshop({...input,source:tampered,requestId:'49f421fa-7180-4d0a-9521-a623b3e4262d'}),/generation_conflict/);
  await assert.rejects(mobile.mobileWritingWorkshopSource({...selection,ideaIds:['foreign-vault']}),/source_unavailable/);
  await assert.rejects(mobile.saveMobileWritingWorkshop({...input,sourceScope:'entire_vault'}),/invalid_workshop_publication/);
  assert.throws(()=>mobile.mobileWritingWorkshopCatalogue({selectionKey:'browser',limit:100,offset:0}),/invalid_workshop_catalogue/);
  assert.throws(()=>mobile.mobileWritingWorkshopCatalogue({selectionKey:'ideaIds',limit:100,offset:-1}),/invalid_workshop_catalogue/);
  const boundary=require('../electron/desktopBridge/operations.ts');
  assert.throws(()=>boundary.authorizeMobileOperation(['corpus'],'saveWritingWorkshopFromMobile'),/permission_denied/);
  boundary.authorizeMobileOperation(['writing'],'saveWritingWorkshopFromMobile');
  console.log(JSON.stringify({suite:'mobile-writing-workshop',passed:true,readOnlyPreparation:true,completePagination:true,
    selectedSourcesOnly:true,providerFreePublication:true,structuredDraft:true,staleSourceRejected:true,idempotentSave:true}));
} finally {globalThis.fetch=fetchBefore;database?.closeDb();fs.rmSync(root,{recursive:true,force:true});}
