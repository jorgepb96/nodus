import assert from 'node:assert/strict';
import {SOURCE_MATERIALS, sourceMaterialRows} from '../server/lib/core/sourceMaterials.mjs';
import {contextReadQuery} from '../server/lib/core/corpusQueries.mjs';

const snapshot = {tables:{}, vault:{type:'world'}};
for (const [path, table, key, route, fields] of SOURCE_MATERIALS) {
  snapshot.tables[table] = [{[key]:`${path}/37`,[fields[0]]:'Fuente sobre fotografía · 37',
    [fields.at(-1)]:`Contenido literal completo de ${path} sobre fotografía con 37 datos`, national_id:'PRIVATE NEVER CONTEXT', speaker_contact:'PRIVATE NEVER CONTEXT'}];
}
snapshot.tables.archive_excerpts[0].item_id = snapshot.tables.archive_items[0].item_id;
snapshot.tables.world_scene_text = [{scene_id:snapshot.tables.world_scenes[0].scene_id,text:'Manuscrito de la escena íntegro: fotografía y 37 datos.'},
  {scene_id:'unselected-neighbour',text:'Texto de otro vecino que no pertenece a esta escena.'}];
snapshot.tables.prosop_name_attestations = [{attestation_id:'private',literal_name:'fotografía secreta'}];
snapshot.tables.study_recordings = [{id:'private-recording',title:'fotografía secreta',audio_blob:'PRIVATE NEVER CONTEXT'}];
const materials = sourceMaterialRows(snapshot,'¿Qué fuentes describen la fotografía?');
assert.equal(materials.length,SOURCE_MATERIALS.length);
assert.equal(new Set(materials.map(row=>row.citation)).size,materials.length);
assert.equal(JSON.stringify(materials).includes('PRIVATE NEVER CONTEXT'),false);
const scene = materials.find(row=>row.collection==='world-scenes');
assert.match(scene.text,/Manuscrito de la escena íntegro/); assert.doesNotMatch(scene.text,/otro vecino/);
assert.equal(scene.citation,'nodus://world/scene/world-scenes%2F37');
const excerpt = materials.find(row=>row.collection==='archive-excerpts');
assert.equal(excerpt.citation,'nodus://primary-source/archive-items%2F37/excerpt/archive-excerpts%2F37');
const metadata = sourceMaterialRows({tables:{study_materials:[{id:'material',title:'fotografía',description:'Solo descripción'}]}},'fotografía')[0];
assert.equal(metadata.contentScope,'metadata'); assert.match(metadata.text,/no contiene su documento original/);
const full = sourceMaterialRows({tables:{study_docs:[{id:'doc',title:'fotografía',content:'Texto íntegro '+ '37 datos '.repeat(10_000)}]}},'fotografía')[0];
assert.equal(full.text.split('37 datos').length,10_001); assert.equal(full.citation,'nodus://study/doc/doc');
assert.equal(sourceMaterialRows(snapshot,'tema inexistente').length,0);
assert.equal(sourceMaterialRows({tables:{archive_excerpts:[{excerpt_id:'orphan',item_id:'missing',quoted_text:'fotografía'}]}},'fotografía').length,0);
const packageValue = contextReadQuery(snapshot,{query:'fotografía',include:['sources'],budget:120_000},'revision').body;
assert.equal(packageValue.sections[0].kind,'sources'); assert.equal(packageValue.sections[0].items.length,materials.length);
const bounded = contextReadQuery({tables:{study_docs:[{id:'doc',title:'fotografía',content:'37 datos '.repeat(10_000)}]}},{query:'fotografía',include:['sources'],budget:1000},'revision').body;
assert.equal(bounded.stats.truncated,true); assert.equal(bounded.sections.length,0);
console.log('Specialised source ownership, canonical citations, full text, metadata scope and budget contracts passed.');
