import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-world-map-read'))process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-world-map-read-'));
const runtime=installRuntimeHooks(directory);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;let database,calls=0;
globalThis.fetch=async()=>{calls++;throw new Error('Reading an atlas must not invoke a provider');};
try {
  database=require('../electron/db/database.ts');database.getDb();
  const vaults=require('../electron/vaults/vaultRegistry.ts'),vault=vaults.createVault('Atlas móvil aislado','worldbuilding'),other=vaults.createVault('Otro atlas aislado','worldbuilding');
  const maps=require('../electron/db/worldMapsRepo.ts'),markers=require('../electron/db/mapMarkersRepo.ts'),read=require('../electron/desktopBridge/worldMapRead.ts');
  let selected;
  await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,async()=>{
    const root=maps.createWorldMap({name:'Mundo',kind:'world'}),region=maps.createWorldMap({name:'Región',kind:'region',parentMapId:root.mapId,scaleX0:0,scaleY0:0,scaleX1:1,scaleY1:0,scaleDistance:50,scaleUnit:'km'});
    selected=region.mapId;
    const image=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"><rect width="1600" height="800" fill="#6153db"/></svg>');
    const imageId=maps.saveMapImage({mapId:region.mapId,role:'base',mimeType:'image/svg+xml',width:1600,height:800,blob:image,thumbnail:null});
    const child=maps.createWorldMap({name:'Ciudad',kind:'city',parentMapId:region.mapId});
    const layer=markers.createMapLayer(region.mapId,{name:'Política',kind:'political',visible:false,color:'#6153db',opacity:0.65});
    markers.createMapMarker({mapId:region.mapId,layerId:layer.layerId,geometryKind:'polygon',x:0.25,y:0.25,points:[{x:0.1,y:0.1},{x:0.5,y:0.1},{x:0.2,y:0.7}],label:'Frontera'});
    markers.createMapMarker({mapId:region.mapId,geometryKind:'point',x:0.8,y:0.4,childMapId:child.mapId,label:'Ciudad'});
    const before=database.getDb().prepare('SELECT total_changes() AS count').get().count;
    const source=read.mobileWorldMapReadSource(vault.id,region.mapId);
    assert.equal(database.getDb().prepare('SELECT total_changes() AS count').get().count,before,'Reading must not initialise or mutate records');
    assert.deepEqual(source.map,maps.getWorldMap(region.mapId));assert.equal(source.map.imageId,imageId);assert.notEqual(imageId,region.mapId);
    assert.deepEqual(source.layers,markers.listMapLayers(region.mapId));assert.equal(source.layers[0].visible,false);
    assert.deepEqual(source.markers,markers.listMapMarkers(region.mapId));assert.equal(source.markers.find(marker=>marker.geometryKind==='polygon').points.length,3);
    assert.deepEqual(source.ancestry.map(map=>map.mapId),[region.mapId,root.mapId]);assert.deepEqual(source.children.map(map=>map.mapId),[child.mapId]);
    assert.equal(source.vaultId,vault.id);assert.equal(source.version,1);assert(!JSON.stringify(source).includes('content_blob'));
    assert.throws(()=>read.mobileWorldMapReadSource(vault.id,{mapId:region.mapId}),/invalid_arguments/);
  }));
  await vaults.withOwningVault(other.id,()=>database.withVaultDatabase(other.id,async()=>assert.throws(()=>read.mobileWorldMapReadSource(other.id,selected),/record_not_found/)));
  assert.equal(calls,0);console.log('Real Desktop atlas read DTOs, original identity, polygons, hidden layers, ancestry, no writes/providers and vault isolation: PASS');
} finally {globalThis.fetch=originalFetch;database?.closeDb();runtime.restore();fs.rmSync(directory,{recursive:true,force:true});}
