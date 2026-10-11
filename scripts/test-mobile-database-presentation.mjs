import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
import {installRuntimeHooks,requireElectronRuntime} from './lib/tsRuntimeHooks.mjs';
if(!requireElectronRuntime(fileURLToPath(import.meta.url),'--electron-mobile-database-presentation'))process.exit(0);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'nodus-mobile-db-presentation-'));
const runtime=installRuntimeHooks(root);runtime.app.on=()=>{};runtime.app.once=()=>{};
const require=createRequire(import.meta.url),fetch=globalThis.fetch;let database;
globalThis.fetch=async()=>assert.fail('Database consultation must never invoke a provider');
if(!globalThis.crypto)globalThis.crypto=webcrypto;
try{
  database=require('../electron/db/database.ts');
  const vaults=require('../electron/vaults/vaultRegistry.ts'),vault=vaults.createVault('Vistas móviles aisladas','databases');
  const repo=require('../electron/db/databasesRepo.ts'),{mobileDatabasePresentationRead}=require('../electron/desktopBridge/databasePresentation.ts');
  const {queryCompanionDatabasePresentation}=require('../shared/companionDatabasePresentation.ts'),{defaultDatabaseViewConfig}=require('../shared/databaseViewConfig.ts');
  await vaults.withOwningVault(vault.id,()=>database.withVaultDatabase(vault.id,async()=>{
    const db=repo.createDatabase('Consultas completas'),title=repo.createColumn(db.id,'Título','title'),group=repo.createColumn(db.id,'Grupo','text'),amount=repo.createColumn(db.id,'Cantidad','number');
    const place=repo.createColumn(db.id,'Ubicación','location'),date=repo.createColumn(db.id,'Fecha','date'),dependency=repo.createColumn(db.id,'Depende de','relation',{relationTargetKind:'db_row',relationTargetDatabaseId:db.id});
    const option=repo.createColumn(db.id,'Estado','select'),firstOption=repo.addOption(option.id,'Zulu','#6366f1'),secondOption=repo.addOption(option.id,'Alfa','#10b981');
    const rows=[];
    for(let index=0;index<523;index++){
      const row=repo.createRow(db.id,`drow_presentation_${String(index).padStart(4,'0')}`);rows.push(row.id);
      repo.setCell(row.id,title.id,index%3===0?`ÁGORA ${index}`:`Dato %_ ${index}`);
      repo.setCell(row.id,group.id,index%11===0?null:index%2?'B':'A');repo.setCell(row.id,amount.id,index%13===0?null:String(index%37-10));
      repo.setCell(row.id,option.id,index%2?firstOption.id:secondOption.id);
      if(index<12)repo.setCell(row.id,place.id,JSON.stringify({name:`Lugar ${index}`,latitude:40+index/100,longitude:-3-index/100}));
      if(index<4)repo.setCell(row.id,date.id,JSON.stringify({start:`2026-10-${String(10+index).padStart(2,'0')}T10:00`,end:`2026-10-${String(10+index).padStart(2,'0')}T11:00`,includeTime:true,timeZone:'Europe/Madrid',...(index===0?{recurrence:'daily'}:{})}));
    }
    repo.addRelation(rows[1],dependency.id,'db_row',rows[0]);
    const layouts=['table','list','gallery','board','calendar','timeline','chart','map','feed','dashboard'];
    for(const layout of layouts)repo.createView(db.id,{name:layout,layout,filter:{conjunction:'and',conditions:[]},sorts:[],config:defaultDatabaseViewConfig(layout)});
    const read=(action,input)=>mobileDatabasePresentationRead(vault.id,{action,input:{databaseId:db.id,...input}}).data;
    const source={version:1,vaultId:vault.id,databaseId:db.id,...read('metadata',{}),rows:[],pages:{},dependencies:{}};
    let cursor=null,visited=0;
    do{const page=read('sourceRows',{cursor,limit:200});source.rows.push(...page.rows);Object.assign(source.pages,page.pages);Object.assign(source.dependencies,page.dependencies);cursor=page.nextCursor;visited++;}while(cursor);
    assert.equal(visited,3);assert.equal(source.rows.length,523);assert.equal(source.views.length,10);
    const queries=[
      ['chart',{xColumnId:group.id,yColumnId:amount.id,aggregation:'sum',type:'bar'}],
      ['chart',{xColumnId:group.id,yColumnId:amount.id,aggregation:'average',type:'line'}],
      ['chart',{xColumnId:group.id,yColumnId:amount.id,aggregation:'min',type:'area',limit:2}],
      ['chart',{xColumnId:group.id,yColumnId:amount.id,seriesColumnId:option.id,aggregation:'max',type:'scatter'}],
      ['chart',{xColumnId:option.id,aggregation:'count',type:'donut'}],
      ['map',{locationColumnId:place.id,limit:5}],
      ['feed',{dateColumnId:date.id,includePageChanges:true,limit:3}],
      ['feed',{includePageChanges:false,limit:4}],
      ['temporal',{startColumnId:date.id,dependencyColumnId:dependency.id,windowStart:'2026-10-01T00:00:00Z',windowEnd:'2026-11-01T00:00:00Z',timeZone:'Europe/Madrid',limit:50}],
    ];
    for(const [action,input] of queries)assert.deepEqual(await queryCompanionDatabasePresentation(source,action,{databaseId:db.id,...input}),read(action,input),action);
    for(const filter of [null,{type:'condition',columnId:title.id,op:'contains',value:'%_'},{type:'condition',columnId:title.id,op:'equals',value:'ÁGORA 0'},{type:'condition',columnId:group.id,op:'notEquals',value:'A'},{type:'condition',columnId:amount.id,op:'gte',value:'15'}]){
      for(const sorts of [[],[{columnId:amount.id,dir:'desc'}],[{columnId:option.id,dir:'asc'}],[{columnId:title.id,dir:'asc'}]]){
        const input={databaseId:db.id,filter,sorts,limit:500};const actual=read('rows',input),offline=await queryCompanionDatabasePresentation(source,'rows',input);
        assert.deepEqual(offline.rows,actual.rows);assert.equal(offline.totalCount,actual.totalCount);assert.equal(offline.hasMore,actual.hasMore);
      }
    }
    const first=await queryCompanionDatabasePresentation(source,'rows',{databaseId:db.id,limit:30});
    const second=await queryCompanionDatabasePresentation(source,'rows',{databaseId:db.id,limit:30,cursor:first.nextCursor});
    assert.equal(new Set([...first.rows,...second.rows].map(row=>row.id)).size,60);
    await assert.rejects(()=>queryCompanionDatabasePresentation(source,'rows',{databaseId:db.id,filter:{type:'condition',columnId:group.id,op:'equals',value:'B'},cursor:first.nextCursor}),/consulta descargada ha cambiado/);
    assert.throws(()=>mobileDatabasePresentationRead(vault.id,{action:'sql',input:{databaseId:db.id}}),/invalid_database_presentation/);
    assert.throws(()=>mobileDatabasePresentationRead(vault.id,{action:'map',input:{databaseId:db.id,locationColumnId:place.id,sql:'DELETE'}}),/invalid_database_presentation/);
    const before=database.getDb().prepare('SELECT count(*) AS n FROM db_rows').get().n;
    for(const [action,input] of queries)read(action,input);
    assert.equal(database.getDb().prepare('SELECT count(*) AS n FROM db_rows').get().n,before);
  }));
  console.log('Prepared database presentation contract: real queries, complete selected data, portable projections, filters, cursors and typed boundary.');
}finally{globalThis.fetch=fetch;database?.closeDb();fs.rmSync(root,{recursive:true,force:true});}
