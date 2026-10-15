import {aggregateRollup,decodeMultiSelect,type DatabaseColumn,type RollupFunction} from './databases';
import {formulaDependencies,type FormulaSpec} from './databaseFormula';
import {formulaExpressionRelations,type FormulaRuntimeValue} from './databaseFormulaExpression';
import {computeFormulas,orderFormulaColumns} from './databaseFormulaEval';
import type {CompanionDatabasePresentationSource} from './companionDatabasePresentation';

/** Only databases actually needed by rollups or relation formula expressions. */
export function companionDerivedDatabaseIds(columns:DatabaseColumn[]):string[] {
  const relations=new Set<string>();
  for(const column of columns){
    if(column.type==='rollup'&&column.config.rollupRelationColumnId)relations.add(column.config.rollupRelationColumnId);
    const formula=column.config.formula;
    if(column.type==='formula'&&formula?.kind==='expression')for(const pair of formulaExpressionRelations(formula.ast))relations.add(pair.relationColumnId);
  }
  return [...new Set(columns.filter(column=>relations.has(column.id)&&column.type==='relation'&&column.config.relationTargetKind==='db_row')
    .flatMap(column=>column.config.relationTargetDatabaseId?[column.config.relationTargetDatabaseId]:[]))].sort();
}

/** Recalculate the complete selected graph, never a partial target table sample. */
export function prepareCompanionDatabaseDerived(root:CompanionDatabasePresentationSource):CompanionDatabasePresentationSource {
  const captured=new Map<string,CompanionDatabasePresentationSource>([[root.databaseId,root],...Object.entries(root.relatedSources??{})]);
  if(![...captured.values()].some(source=>source.localChanges))return root;
  const sources=new Map([...captured].map(([id,source])=>{
    if(source.version!==1||source.vaultId!==root.vaultId||source.databaseId!==id||source.database.id!==id)throw new Error('Una dependencia de cálculo no pertenece a esta copia.');
    return [id,{...source,rows:source.rows.map(row=>({...row,cells:{...row.cells},rollups:{...row.rollups},formulaColors:{...row.formulaColors},formulaErrors:{...row.formulaErrors}}))}] as const;
  }));
  const source=sources.get(root.databaseId)!;
  for(const current of sources.values())if(current.localChanges)for(const row of current.rows)for(const column of current.columns){
    if(column.type==='created_time')row.cells[column.id]=row.createdAt;
    if(column.type==='last_edited_time')row.cells[column.id]=row.updatedAt;
    if(column.type==='created_by')row.cells[column.id]=row.createdBy??'';
    if(column.type==='last_edited_by')row.cells[column.id]=row.updatedBy??'';
    if(column.type==='unique_id')row.cells[column.id]=String(column.config.uniqueIdPrefix??'').slice(0,24)+String(row.uniqueSequence??0).padStart(Math.min(12,Math.max(1,Math.trunc(Number(column.config.uniqueIdPadding??4)))),'0');
  }
  const state=new Map<string,'visiting'|'done'>();
  const circular=new Map([...sources].map(([id,current])=>[id,orderFormulaColumns(current.columns).circular]));
  const target=(current:CompanionDatabasePresentationSource,relationId:string|undefined,columnId:string|undefined)=>{
    const relation=current.columns.find(column=>column.id===relationId);
    if(relation?.type!=='relation'||relation.config.relationTargetKind!=='db_row'||!relation.config.relationTargetDatabaseId)return null;
    const related=sources.get(relation.config.relationTargetDatabaseId);
    if(!related)throw new Error('Falta una dependencia de cálculo en la descarga. Renueva la copia completa.');
    const column=!columnId||columnId==='__title__'?related.columns.find(column=>column.type==='title')??related.columns[0]:related.columns.find(column=>column.id===columnId);
    return {source:related,column,relation};
  };
  const ids=(current:CompanionDatabasePresentationSource,rowId:string,columnId:string,rollup=false):string[]=>{
    if(!current.relations)return current.dependencies[rowId]?.[columnId]??[];
    return current.relations.filter(row=>row.row_id===rowId&&row.column_id===columnId&&row.target_kind==='db_row').slice()
      .sort((a,b)=>a.position-b.position||(rollup?compare(a.created_at,b.created_at):0)||compare(a.id,b.id)).map(row=>row.target_id);
  };
  const relatedValues=(current:CompanionDatabasePresentationSource,rowId:string,relationId:string,columnId:string):FormulaRuntimeValue[]=>{
    const related=target(current,relationId,columnId);if(!related?.column)return [];
    const values=new Map(related.source.rows.map(row=>[row.id,row.cells[related.column!.id]??null]));
    return ids(current,rowId,relationId).flatMap((id):FormulaRuntimeValue[]=>{
      const raw=values.get(id)??null;if(raw==null)return [];
      if(['number','formula','rollup'].includes(related.column!.type)){const numeric=Number(raw.replace(/%$/,''));return [Number.isFinite(numeric)?numeric:raw];}
      return related.column!.type==='checkbox'?[raw==='1'||raw==='true']:[raw];
    });
  };
  const evaluate=(current:CompanionDatabasePresentationSource,column:DatabaseColumn):void=>{
    if(!['formula','rollup'].includes(column.type))return;
    const key=current.databaseId+':'+column.id;if(state.get(key)==='done')return;
    if(column.type==='formula'&&circular.get(current.databaseId)?.has(column.id)){
      computeFormulas(current.rows,current.columns,current.rows,{columnIds:new Set([column.id])});state.set(key,'done');return;
    }
    if(state.get(key)==='visiting')throw new Error('Las propiedades calculadas contienen una referencia circular. Revisa su configuración en Nodus.');
    state.set(key,'visiting');
    if(column.type==='rollup'){
      const related=target(current,column.config.rollupRelationColumnId,column.config.rollupTargetColumnId);
      if(related?.column)evaluate(related.source,related.column);
      const values=new Map(related?.source.rows.map(row=>[row.id,related.column?row.cells[related.column.id]??null:null])??[]);
      const labels=new Map(related?.column?.options.map(option=>[option.id,option.label])??[]);
      for(const row of current.rows){
        const display=related?ids(current,row.id,related.relation.id,true).map(id=>{
          const raw=values.get(id)??null;if(raw==null)return null;
          if(related.column?.type==='select')return labels.get(raw)??raw;
          if(related.column?.type==='multi_select')return decodeMultiSelect(raw).map(id=>labels.get(id)??id).join(', ');
          return raw;
        }):[];
        const value=related?aggregateRollup((column.config.rollupFunction??'show') as RollupFunction,display):'';
        (row.rollups??={})[column.id]=value;row.cells[column.id]=value===''?null:value;
      }
    }else{
      const formula=column.config.formula as FormulaSpec|undefined;
      for(const id of formulaDependencies(formula)){const dependency=current.columns.find(column=>column.id===id);if(dependency)evaluate(current,dependency);}
      if(formula?.kind==='expression')for(const pair of formulaExpressionRelations(formula.ast)){
        const related=target(current,pair.relationColumnId,pair.targetColumnId);if(related?.column)evaluate(related.source,related.column);
      }
      computeFormulas(current.rows,current.columns,current.rows,{columnIds:new Set([column.id]),relatedValues:(rowId,relationId,columnId)=>relatedValues(current,rowId,relationId,columnId)});
    }
    state.set(key,'done');
  };
  for(const current of sources.values())for(const column of current.columns)evaluate(current,column);
  return {...source,relatedSources:Object.fromEntries([...sources].filter(([id])=>id!==root.databaseId))};
}
function compare(left:string,right:string){return left<right?-1:left>right?1:0;}
