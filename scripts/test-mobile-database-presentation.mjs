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
  const {queryCompanionDatabaseContainer}=require('../shared/companionDatabaseContainer.ts');
  const {mobileDatabaseRowLocation}=require('../electron/desktopBridge/databaseRowLocation.ts');
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
    const associated=database.getDb().prepare("SELECT id FROM pages WHERE row_id=? AND state='active' ORDER BY id LIMIT 1").get(rows[522]);
    assert.ok(associated?.id,'Canonical row creation must retain its actual associated page');
    assert.deepEqual(mobileDatabaseRowLocation(vault.id,rows[522]),{version:1,vaultId:vault.id,rowId:rows[522],databaseId:db.id,pageId:associated.id});
    assert.throws(()=>mobileDatabaseRowLocation(vault.id,'missing-row'),/record_not_found/);
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
    const linked=repo.createDatabase('Fuente enlazada'),linkedTitle=repo.createColumn(linked.id,'Nombre','title'),linkedGroup=repo.createColumn(linked.id,'Categoría','text'),linkedAmount=repo.createColumn(linked.id,'Valor','number');
    for(let index=0;index<37;index++){
      const row=repo.createRow(linked.id,`drow_linked_${index}`);
      repo.setCell(row.id,linkedTitle.id,`Enlazado ${index}`);repo.setCell(row.id,linkedGroup.id,index%2?'B':'A');repo.setCell(row.id,linkedAmount.id,String(36-index));
    }
    const partial=repo.createDatabase('Fuente sin categoría'),partialTitle=repo.createColumn(partial.id,'Título','title');
    for(let index=0;index<2;index++){const row=repo.createRow(partial.id,`drow_partial_${index}`);repo.setCell(row.id,partialTitle.id,`Otra ${index}`);}
    let saved=repo.createView(db.id,{name:'Contenedor completo',layout:'board',filter:{conjunction:'and',conditions:[]},sorts:[],config:defaultDatabaseViewConfig('board')});
    repo.attachDatabaseViewSource(saved.id,linked.id,{alias:'Fuente enlazada',propertyMap:{title:linkedTitle.id,text:linkedGroup.id,number:linkedAmount.id}});
    repo.attachDatabaseViewSource(saved.id,partial.id,{alias:'Fuente sin categoría',propertyMap:{title:partialTitle.id}});
    const capture=id=>{
      const get=(action,input)=>mobileDatabasePresentationRead(vault.id,{action,input:{databaseId:id,...input}}).data;
      const copy={version:1,vaultId:vault.id,databaseId:id,...get('metadata',{}),rows:[],pages:{},dependencies:{},relations:[]};
      let cursor=null;do{const page=get('sourceRows',{cursor,limit:200});copy.rows.push(...page.rows);Object.assign(copy.pages,page.pages);Object.assign(copy.dependencies,page.dependencies);copy.relations.push(...page.relations);cursor=page.nextCursor;}while(cursor);
      return copy;
    };
    const canonical=(sourceId=null,localFilter=null)=>{
      let cursor=null;const all=[];
      do{const page=repo.queryDatabaseContainerRows({viewId:saved.id,sourceId,localFilter,cursor,limit:30},{readOnly:true});all.push(...page.rows);cursor=page.nextCursor;}while(cursor);
      return all;
    };
    const category={type:'condition',columnId:group.id,op:'equals',value:'A'},titleFilter={type:'condition',columnId:title.id,op:'contains',value:'Otra'};
    for(const filter of [null,category,{type:'group',operator:'and',children:[category,titleFilter]},{type:'group',operator:'or',children:[category,titleFilter]}]){
      saved=repo.updateView(saved.id,{config:{...saved.config,filter,sorts:[{columnId:amount.id,dir:'desc'}]}});
      const definition=repo.getDatabaseContainer(saved.id,true),sources=Object.fromEntries([db.id,linked.id,partial.id].map(id=>[id,capture(id)]));
      const input={version:1,vaultId:vault.id,viewId:saved.id,definition,sources};
      for(const sourceId of [null,definition.sources[1].sourceId]){
        const actual=canonical(sourceId),offline=await queryCompanionDatabaseContainer({...input,sourceId});
        assert.deepEqual(offline.rows,actual,`complete mapped query ${JSON.stringify(filter)} / ${sourceId}`);
        if(!filter&&!sourceId)assert.equal(offline.rows.length,562,'All sources survive more than 500 rows');
      }
      assert.deepEqual((await queryCompanionDatabaseContainer({...input,localFilter:category})).rows,canonical(null,category));
      await assert.rejects(()=>queryCompanionDatabaseContainer({...input,sources:{[db.id]:sources[db.id]}}),/Falta una fuente vinculada/);
      await assert.rejects(()=>queryCompanionDatabaseContainer({...input,sources:{...sources,[linked.id]:{...sources[linked.id],vaultId:'foreign'}}}),/Falta una fuente vinculada/);
      await assert.rejects(()=>queryCompanionDatabaseContainer({...input,sourceId:'not-attached'}),/fuente no pertenece/);
    }
    saved=repo.updateView(saved.id,{config:{...saved.config,filter:category,sorts:[{columnId:amount.id,dir:'desc'}]}});
    const definition=repo.getDatabaseContainer(saved.id,true),copies=Object.fromEntries([db.id,linked.id,partial.id].map(id=>[id,capture(id)]));
    const originalCopy=JSON.stringify(copies[db.id]);
    const edited=structuredClone(copies);edited[db.id].localChanges=true;edited[db.id].localRevision='actual-pending-edits';
    edited[db.id].rows.find(row=>row.id===rows[2]).cells[group.id]='B';
    repo.setCell(rows[2],group.id,'B');
    const created=repo.createRow(db.id,'drow_created_offline');repo.setCell(created.id,title.id,'Nuevo local');repo.setCell(created.id,group.id,'A');repo.setCell(created.id,amount.id,'999');
    edited[db.id].rows.push(capture(db.id).rows.find(row=>row.id===created.id));
    const offline=await queryCompanionDatabaseContainer({version:1,vaultId:vault.id,viewId:saved.id,definition,sources:edited});
    const content=rows=>rows.map(({id,cells,databaseId,rowId})=>({id,cells,databaseId,rowId}));
    assert.deepEqual(content(offline.rows),content(canonical()),'Pending cells remove a filtered row; local creation is sorted into its actual group');
    assert.equal(offline.rows[0].rowId,created.id);assert.equal(JSON.stringify(copies[db.id]),originalCopy,'Queries do not mutate the retained copy');
    await assert.rejects(()=>queryCompanionDatabaseContainer({version:1,vaultId:vault.id,viewId:saved.id,definition:{...definition,revision:definition.revision+1},sources:copies}),/vista cambió/);
    const relation=repo.createColumn(db.id,'Métricas relacionadas','relation',{relationTargetKind:'db_row',relationTargetDatabaseId:linked.id});
    const total=repo.createColumn(linked.id,'Total de toda la fuente','formula',{formula:{kind:'columnStat',fn:'columnTotal',columnId:linkedAmount.id}});
    const sum=repo.createColumn(db.id,'Suma enlazada','rollup',{rollupRelationColumnId:relation.id,rollupTargetColumnId:linkedAmount.id,rollupFunction:'sum'});
    const globalSum=repo.createColumn(db.id,'Estadística enlazada','rollup',{rollupRelationColumnId:relation.id,rollupTargetColumnId:total.id,rollupFunction:'sum'});
    const expression=`sum(relation("${relation.id}", "${linkedAmount.id}"))`;
    const {parseFormulaExpression}=require('../shared/databaseFormulaExpression.ts');
    const formula=repo.createColumn(db.id,'Expresión enlazada','formula',{formula:{kind:'expression',source:expression,ast:parseFormulaExpression(expression),resultKind:'number'}});
    const firstRelation=repo.addRelation(rows[0],relation.id,'db_row','drow_linked_0');repo.addRelation(rows[0],relation.id,'db_row','drow_linked_1');
    const dependent=capture(db.id);dependent.relatedSources={[linked.id]:capture(linked.id)};
    assert.deepEqual(dependent.derivedDatabaseIds,[linked.id]);
    dependent.relatedSources[linked.id].localChanges=true;dependent.relatedSources[linked.id].localRevision='pending-target-value';
    dependent.relatedSources[linked.id].rows.find(row=>row.id==='drow_linked_0').cells[linkedAmount.id]='100';
    const retained=JSON.stringify(dependent);
    repo.setCell('drow_linked_0',linkedAmount.id,'100');
    const values=async copy=>{
      const computed=await queryCompanionDatabasePresentation(copy,'allRows',{databaseId:db.id});
      const row=computed.rows.find(row=>row.id===rows[0]);return [sum.id,globalSum.id,formula.id].map(id=>row.cells[id]);
    };
    const actual=()=>{const row=read('rows',{limit:500}).rows.find(row=>row.id===rows[0]);return [sum.id,globalSum.id,formula.id].map(id=>row.cells[id]);};
    assert.deepEqual(await values(dependent),actual(),'Rollups and relation expressions use edited targets and complete target-table statistics');
    assert.equal(JSON.stringify(dependent),retained,'Derived graph consultation never mutates the protected capture');
    const changed=structuredClone(dependent);changed.localChanges=true;changed.relations=changed.relations.filter(link=>link.id!==firstRelation.id);
    repo.removeRelation(firstRelation.id);
    assert.deepEqual(await values(changed),actual(),'Deleting a local relation changes the computed aggregate');
    await assert.rejects(()=>values({...changed,relatedSources:{}}),/Falta una dependencia de cálculo/);
    const {computeFormulas}=require('../shared/databaseFormulaEval.ts'),{prepareCompanionDatabaseDerived}=require('../shared/companionDatabaseDerived.ts');
    const capturedError=structuredClone(changed),target=capturedError.relatedSources[linked.id];
    for(const row of target.rows){row.formulaErrors={[total.id]:'Former configuration error'};row.formulaColors={[total.id]:'#ff0000'};}
    const healthy=prepareCompanionDatabaseDerived(capturedError);
    assert.ok(healthy.relatedSources[linked.id].rows.every(row=>!row.formulaErrors?.[total.id]&&!row.formulaColors?.[total.id]),'Successful local formula clears captured error and obsolete colour');
    const pureColumns=repo.getColumns(linked.id),row=structuredClone(target.rows[0]),page=structuredClone(row);
    page.formulaColors={unrelated:'#111111',[total.id]:'#ff0000'};page.formulaErrors={unrelated:'Keep',[total.id]:'Old'};
    computeFormulas([page],pureColumns,target.rows,{columnIds:new Set([total.id])});
    assert.equal(page.formulaColors.unrelated,'#111111');assert.equal(page.formulaErrors.unrelated,'Keep');
    assert.equal(page.formulaColors[total.id],undefined);assert.equal(page.formulaErrors[total.id],undefined);
    const circular=structuredClone(changed),formulaColumn=circular.columns.find(column=>column.id===formula.id);
    const self=`property("${formula.id}")`;
    formulaColumn.config.formula={kind:'expression',source:self,ast:parseFormulaExpression(self),resultKind:'number'};
    const cyclic=prepareCompanionDatabaseDerived(circular).rows.find(row=>row.id===rows[0]);
    assert.equal(cyclic.cells[formula.id],null);assert.match(cyclic.formulaErrors[formula.id],/Referencia circular/);
    assert.notEqual(cyclic.cells[sum.id],null,'One invalid formula does not hide the other calculated or plain values');
    const diagnosticView=repo.createView(db.id,{name:'Diagnósticos móviles',layout:'table',filter:{conjunction:'and',conditions:[]},sorts:[]});
    const diagnosticDefinition=repo.getDatabaseContainer(diagnosticView.id,true),diagnosticSource=capture(db.id);
    diagnosticSource.columns=circular.columns;diagnosticSource.relatedSources=circular.relatedSources;diagnosticSource.localChanges=true;
    const diagnostic=await queryCompanionDatabaseContainer({version:1,vaultId:vault.id,viewId:diagnosticView.id,definition:diagnosticDefinition,sources:{[db.id]:diagnosticSource}});
    const mappedFormula=Object.entries(diagnosticDefinition.sources[0].propertyMap).find(([,column])=>column===formula.id)?.[0];
    assert(mappedFormula,'The actual primary source maps its physical formula property');
    const failed=diagnostic.rows.find(row=>row.rowId===rows[0]);
    assert.equal(failed.cells[mappedFormula],null);assert.match(failed.formulaErrors[mappedFormula],/Referencia circular/);
  }));
  console.log('Prepared database presentation contract: real queries, complete selected data, portable projections, filters, cursors and typed boundary.');
}finally{globalThis.fetch=fetch;database?.closeDb();fs.rmSync(root,{recursive:true,force:true});}
