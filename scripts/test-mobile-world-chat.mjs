import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-world-chat'))process.exit(0);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-world-chat-'));
const runtime=installRuntimeHooks(directory);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),originalFetch=globalThis.fetch;let db,calls=0;
globalThis.fetch=async()=>{calls++;throw new Error('World source capture and calculations must never invoke a provider');};
try {
  db=require('../electron/db/database.ts');db.getDb();
  const vaults=require('../electron/vaults/vaultRegistry.ts'),vault=vaults.createVault('Mundo companion aislado','worldbuilding');
  const characters=require('../electron/db/charactersRepo.ts'),places=require('../electron/db/worldPlacesRepo.ts'),groups=require('../electron/db/worldGroupsRepo.ts'),story=require('../electron/db/worldStoryRepo.ts'),rules=require('../electron/db/worldRulesRepo.ts');
  const capture=require('../electron/db/mobileWorldChatSource.ts'),native=require('../electron/ai/worldChat.ts'),portable=require('../shared/mobileWorldChat.ts'),context=require('../shared/worldChatContext.ts'),history=require('../electron/desktopBridge/chatHistory.ts');
  await vaults.withOwningVault(vault.id,()=>db.withVaultDatabase(vault.id,async()=>{
    const kaelen=characters.createCharacter({displayName:'Kaelen Vor',backstory:'Kaelen pertenece a los Cuervos y estudia la Marca.'});
    const arden=characters.createCharacter({displayName:'Arden',backstory:'Arden descubre el secreto más tarde.'});
    const kingdom=places.createWorldPlace({name:'Reino de Vael',notes:'El reino contiene la ciudad.'});
    const city=places.createWorldPlace({name:'Ciudad de Vael',parentId:kingdom.placeId,notes:'La ciudad está dentro del reino.'});
    const tavern=places.createWorldPlace({name:'Taberna Umbral',parentId:city.placeId,notes:'El encuentro ocurre aquí.'});
    const crows=groups.createWorldGroup({name:'Cuervos',description:'La orden de la Marca.'});
    groups.addAffiliation({personId:kaelen.personId,groupId:crows.groupId,fromWorldDay:10,toWorldDay:20});
    const law=rules.createWorldRule({title:'Invocar tiene un coste',statement:'La Marca exige memoria.',scopeKind:'world'});
    rules.createWorldRule({title:'Excepción de los Cuervos',statement:'La orden puede aplazar el coste.',scopeKind:'group',scopeId:crows.groupId,parentRuleId:law.ruleId});
    rules.createWorldRule({title:'Ley del reino',statement:'El templo queda cerrado.',scopeKind:'place',scopeId:kingdom.placeId});
    const scene=story.createScene({title:'Encuentro del Umbral',placeId:tavern.placeId,worldDay:15,worldYear:1,summary:'Kaelen cruza la puerta.'});story.addSceneCharacter(scene.sceneId,kaelen.personId);
    const later=story.createScene({title:'Viaje a Vael',placeId:city.placeId,worldDay:25,worldYear:1,summary:'Kaelen llega a la ciudad.'});story.addSceneCharacter(later.sceneId,kaelen.personId);
    const secret=story.createSecret({title:'Precio verdadero',content:'El coste afecta a los recuerdos.',ownerPersonId:kaelen.personId});
    story.addKnower({secretId:secret.secretId,personId:kaelen.personId,sinceWorldDay:0});story.addKnower({secretId:secret.secretId,personId:arden.personId,sinceWorldDay:20});
    const keys=[`character:${kaelen.personId}`,`scene:${scene.sceneId}`,`place:${tavern.placeId}`],pack=capture.getMobileWorldChatSourcePack({entryKeys:keys});
    assert.deepEqual(new Set(pack.entryKeys),new Set(keys));assert.ok(!pack.data.entries.some(entry=>entry.id===arden.personId),'Dependency names never broaden the downloaded focus');
    for(const language of ['es','en','fr','de','pt','pt-BR','it','tr','zh-Hans','zh-Hant','vi','ja','ru','uk','ko'])for(const day of [null,5,15,22,30]) {
      const word={es:'día',en:'day',fr:'jour',de:'tag',pt:'dia','pt-BR':'dia',it:'giorno',tr:'gün','zh-Hans':'天','zh-Hant':'天',vi:'ngày',ja:'日',ru:'день',uk:'день',ko:'일'}[language];
      const request={question:`Kaelen Vor: ${day==null?'estado':`${word} ${day}`}`,focusKeys:keys,history:[{role:'user',content:'Dónde estaba?'},{role:'assistant',content:'En el Umbral.'}]};
      const expected=native.buildWorldChatFacts(request,language),result=portable.prepareWorldChat({packs:[pack],request,language,vaultId:vault.id});
      assert.deepEqual(result.facts,expected,`${language}, ${day}`);assert.equal(result.user,context.composeWorldChatContext(expected,language));
    }
    const at15=portable.prepareWorldChat({packs:[pack],request:{question:'Kaelen Vor día 15',focusKeys:keys},language:'es',vaultId:vault.id});
    assert.equal(at15.facts.computed.knowersAt[0].people.length,1);assert.ok(at15.facts.computed.effectiveRules.some(rule=>rule.overriddenBy.includes('Excepción de los Cuervos')));
    const at22=portable.prepareWorldChat({packs:[pack],request:{question:'Kaelen Vor día 22',focusKeys:keys},language:'es',vaultId:vault.id});assert.equal(at22.facts.computed.knowersAt[0].people.length,2);assert.ok(!at22.facts.computed.memberships?.length);
    const request={question:'Quién es Kaelen Vor?',history:[]},auto=capture.getMobileWorldChatSourcePack({question:request.question});
    assert.deepEqual(portable.prepareWorldChat({packs:[auto],request,language:'es',vaultId:vault.id}).facts,native.buildWorldChatFacts(request));
    const empty=portable.prepareWorldChat({packs:[pack],request:{question:'Qué opinas?',history:[]},language:'es',vaultId:vault.id});assert.equal(empty.noMaterial,true);assert.deepEqual(empty.facts.computed,{});
    const first=capture.getMobileWorldChatSourcePack({entryKeys:[keys[0]]}),second=capture.getMobileWorldChatSourcePack({entryKeys:[keys[1]]});
    assert.throws(()=>portable.prepareWorldChat({packs:[first,second],request:{question:'Compara',focusKeys:keys.slice(0,2)},language:'es',vaultId:vault.id}),/misma descarga/);
    const tampered=structuredClone(pack);tampered.data.rules[0].title='Regla falsa';assert.throws(()=>portable.prepareWorldChat({packs:[tampered],request,language:'es',vaultId:vault.id}),/source_pack/);
    assert.throws(()=>portable.prepareWorldChat({packs:[pack],request,language:'es',vaultId:randomUUID()}),/source_pack/);
    const valid=portable.validateMobileWorldChatAnswer({text:`Kaelen entra [Kaelen](nodus://world/character/${kaelen.personId}). Inventado [Arden](nodus://world/character/${arden.personId}).`,citable:at15.citable,language:'es'});assert.ok(!valid.text.includes(`nodus://world/character/${arden.personId}`));
    const world={selection:{scope:'manual',entryKeys:keys,keepFocus:true},focus:at15.focus},edit={version:1,id:randomUUID(),conversationId:randomUUID(),expectedRevision:null,action:'save',draft:{title:'Mundo autónomo',archived:false,messages:[{role:'user',content:'Kaelen día 15'},{role:'assistant',content:valid.text}],world}};
    const saved=await history.saveMobileChat(vault.id,randomUUID(),'world',edit,['corpus','writing']);assert.deepEqual(saved.snapshot.data.selection,world.selection);assert.deepEqual(saved.snapshot.data.focus,world.focus);
  }));
  assert.equal(calls,0);
  console.log('Actual isolated world snapshots, identical Desktop/device temporal facts in 15 languages, focused auto/manual retrieval, no mixed captures, scoped citations and genuine history context passed. Native/device acceptance remains separate.');
} finally { globalThis.fetch=originalFetch;db?.closeDb();runtime.restore();fs.rmSync(directory,{recursive:true,force:true}); }
