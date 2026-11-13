import fs from 'node:fs';
import path from 'node:path';
import {getActiveVault, listVaults, withOwningVault} from '../electron/vaults/vaultRegistry';
import {getDb, withVaultDatabase} from '../electron/db/database';
import {seedDemoData} from '../electron/db/demoData';
import {updateSettings} from '../electron/db/settingsRepo';
import {createDictionaryEntry, saveDictionaryVersion, upsertDictionaryEvidence, addDictionaryRelation} from '../electron/db/dictionaryRepo';
import {savePodcastEpisode} from '../electron/db/podcastRepo';

/** Explicitly fictional, provider-free Link fixtures. Never runs against a real profile. */
export async function ensureLinkAcceptanceFixtures(lab:string):Promise<void> {
  if(!fs.existsSync(path.join(lab,'.nodus-mobile-acceptance-lab')))throw new Error('isolated_link_lab_required');
  if(!listVaults().every(vault=>path.resolve(vault.path).startsWith(path.resolve(lab)+path.sep)))throw new Error('link_vault_outside_lab');
  const marker=path.join(lab,'link-fixture.json');
  if(fs.existsSync(marker))return;
  const vault=getActiveVault();
  await withOwningVault(vault.id,()=>withVaultDatabase(vault.id,()=>{
    if((getDb().prepare('SELECT COUNT(*) AS n FROM works').get() as {n:number}).n!==0)throw new Error('link_seed_requires_empty_lab');
    updateSettings({uiLanguage:'es'});seedDemoData();
    const entry=createDictionaryEntry({name:'Aprendizaje · Nodus Link',aliases:['Estudio'],focusPrompt:'Fixture manual de consulta',scope:{kind:'vault'},outputLanguage:'es',detailLevel:'standard',tags:['link-fixture']});
    const related=createDictionaryEntry({name:'Recuperación · Nodus Link',aliases:[],focusPrompt:'Concepto relacionado de prueba',scope:{kind:'vault'},outputLanguage:'es',detailLevel:'concise',tags:['link-fixture']});
    const idea=getDb().prepare('SELECT label,statement FROM ideas WHERE global_id=?').get('demo-i1') as {label:string;statement:string};
    const work=getDb().prepare('SELECT title,authors_json FROM works WHERE nodus_id=?').get('demo-w1') as {title:string;authors_json:string};
    upsertDictionaryEvidence(entry.id,[{kind:'idea',refId:'demo-i1',decision:'included',score:1,reason:'Evidencia del corpus ficticio',label:idea.label,text:idea.statement,workId:'demo-w1',workTitle:work.title,zoteroKey:null,works:[{id:'demo-w1',title:work.title,zoteroKey:null,authors:JSON.parse(work.authors_json),year:2006}],pageLabel:null,authors:JSON.parse(work.authors_json).map((name:string)=>({id:null,name})),tags:['link-fixture'],sourceRevision:null}]);
    for(const number of [1,2])saveDictionaryVersion({entryId:entry.id,contentMarkdown:`# Aprendizaje\n\nDefinición manual de prueba, versión ${number}.\n\n${idea.statement} [Idea del corpus](nodus://idea/demo-i1)`,evidence:[{kind:'idea',id:'demo-i1'}],citations:[{kind:'idea',id:'demo-i1',label:idea.label,tags:[]}],authorSummaries:[],model:null,trigger:'manual_edit',state:'applied',outcome:'synthesis',degradationReason:null,generationAttempts:0,generationProblems:[],insufficientEvidence:false});
    addDictionaryRelation(entry.id,related.id);
    const samples=16000*30,wav=Buffer.alloc(44+samples*2);
    wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
    for(let n=0;n<samples;n++)wav.writeInt16LE(Math.round(100*Math.sin(n*2*Math.PI*440/16000)),44+n*2);
    const folder=path.join(path.dirname(vault.path),'audio');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'link-fixture.wav'),wav);
    savePodcastEpisode({id:'link-podcast-fixture',title:'Podcast · Nodus Link',request:{objective:'Fixture ficticio de reproducción: tono suave, no voz generada.',format:'lesson',language:'es',ttsModelId:'acceptance-tone',hosts:[{speaker:'A',name:'Anfitrión de prueba',voiceId:'acceptance-tone'}],audience:'general',durationCapMin:5,cover:false,extraImages:0,reviewScript:false},
      plan:{title:'Podcast · Nodus Link',hook:'Prueba de escucha',summary:'Fixture de transporte y reproducción',chapters:[{index:0,title:'Primera parte',goal:'Escuchar',keyPoints:[],sourceIds:['S1'],targetWords:5},{index:1,title:'Segunda parte',goal:'Saltar de capítulo',keyPoints:[],sourceIds:['S1'],targetWords:5}],images:[]},
      script:{turns:[{id:'link-turn-1',chapterIndex:0,speaker:'A',text:'Transcripción ficticia para verificar la consulta desde Nodus Link.',sourceIds:['S1']}]},sources:[{id:'S1',kind:'idea',title:idea.label,excerpt:idea.statement,link:'nodus://idea/demo-i1'}],researchLog:'Fixture manual, sin IA ni extracción.',timeline:{turns:[{turnId:'link-turn-1',startS:0,durationS:30}],chapters:[{index:0,title:'Primera parte',startS:0},{index:1,title:'Segunda parte',startS:15}]},durationS:30,audioFile:'link-fixture.wav',audioMime:'audio/wav',audioBytes:wav.length,generation:{ttsModelId:'acceptance-tone',engine:'kokoro',codec:'pcm-s16le'}});
    fs.writeFileSync(marker,JSON.stringify({vaultId:vault.id,vaultName:vault.name,dictionaryId:entry.id,dictionaryTitle:entry.name,reportId:'demo-deep-research-draft',podcastId:'link-podcast-fixture',fictional:true,providerCalls:0}),{mode:0o600});
  }));
}
