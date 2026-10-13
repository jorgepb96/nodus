/** Native database actions keep the owning row/property and captured context exact. */
export type MobileDatabaseActionKind = 'text' | 'image' | 'button';
export interface MobileDatabaseActionRequest { rowId: string; columnId: string; kind: MobileDatabaseActionKind; revision?: string }
export function mobileDatabaseActionRequest(raw: unknown, requireRevision = false): MobileDatabaseActionRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_database_action');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !['rowId','columnId','kind','revision'].includes(key)) ||
      !['text','image','button'].includes(String(value.kind)) ||
      [value.rowId,value.columnId].some(id => typeof id !== 'string' || !id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) ||
      (requireRevision || value.revision !== undefined) && (typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision))) throw new Error('invalid_database_action');
  return value as unknown as MobileDatabaseActionRequest;
}

import {normalizeCellValue,type DatabaseColumn,type DatabaseRow,type DatabaseRelation} from './databases';
import {isReadOnlyDatabaseProperty} from './databaseProperties';
import {matchesCondition} from './databaseFilters';
import type {FilterNode} from './databaseQuery';
import type {AutomationRule,AutomationValue,AutomationEvent} from './databaseAutomations';
export interface MobileButtonContext {
  rows: DatabaseRow[];
  columns: DatabaseColumn[];
  rules: AutomationRule[];
  relations: DatabaseRelation[];
}
export interface MobileButtonPlan {
  version: 1;
  operations: Array<Record<string,unknown>>;
  runs: Array<Record<string,unknown>>;
}
/** Compile downloaded canonical rules without executing any action. Placeholders
 * are replaced deterministically from the explicit click's UUID on both sides. */
export function compileMobileDatabaseButton(context:MobileButtonContext,rowId:string,columnId:string):MobileButtonPlan {
  if(JSON.stringify(context).includes('NODUS_ACTION_ID:')||JSON.stringify(context).includes('NODUS_ACTION_CLICK_TIME'))throw new Error('database_action_reserved_token');
  const rows=new Map(context.rows.map(row=>[row.id,{...row,cells:{...row.cells}}])),columns=new Map(context.columns.map(c=>[c.id,c])),dirty=new Set<string>();
  const plan:MobileButtonPlan={version:1,operations:[],runs:[]};
  let sequence=0;
  function token(prefix:string){return `NODUS_ACTION_ID:${prefix}:${sequence++}`;}
  function append(operation:Record<string,unknown>){if(plan.operations.length>=500)throw new Error('database_action_plan_limit');plan.operations.push(operation);}
  function computedSafe(row:DatabaseRow,columnId:string) {if(dirty.has(row.id)&&isReadOnlyDatabaseProperty(columns.get(columnId)?.type??''))throw new Error('database_action_computed_dependency_requires_refresh');}
  function render(template:string,row:DatabaseRow,databaseId:string,variables:Record<string,string|null>){
    return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g,(_all,keyValue:string)=>{const key=keyValue.trim();if(key==='row.id')return row.id;if(key==='database.id')return databaseId;if(key==='row.title')return Object.values(row.cells).find(Boolean)??'';
      if(key.startsWith('column:')){const id=key.slice(7);computedSafe(row,id);return row.cells[id]??'';}if(key.startsWith('variable:'))return variables[key.slice(9)]??'';return '';});
  }
  function resolve(value:AutomationValue,row:DatabaseRow,databaseId:string,variables:Record<string,string|null>):string|null {
    if(value.type==='literal')return value.value;if(value.type==='column'){computedSafe(row,value.columnId);return row.cells[value.columnId]??null;}return render(value.template,row,databaseId,variables)||null;
  }
  function matches(node:FilterNode|null,row:DatabaseRow):boolean {
    if(!node)return true;if(node.type==='group'){const values=node.children.map(child=>matches(child,row));return node.operator==='or'?values.some(Boolean):values.every(Boolean);}
    computedSafe(row,node.columnId);const column=columns.get(node.columnId);if(!column)throw new Error('database_action_context_incomplete');return matchesCondition(column,row,{id:'automation',columnId:node.columnId,op:node.op,value:node.value});
  }
  function set(row:DatabaseRow,columnId:string,value:string|null) {
    const column=columns.get(columnId);if(!column||column.databaseId!==row.databaseId||isReadOnlyDatabaseProperty(column.type))throw new Error('database_action_context_incomplete');
    row.cells[columnId]=normalizeCellValue(column.type,value);dirty.add(row.id);append({type:'set_property',rowId:row.id,columnId,value:row.cells[columnId]});
  }
  function dispatch(event:AutomationEvent) {
    const row=event.rowId?rows.get(event.rowId):undefined;if(!row)throw new Error('database_action_context_incomplete');
    for(const rule of context.rules.filter(rule=>rule.enabled&&rule.databaseId===event.databaseId&&rule.trigger.type===event.type&&(rule.trigger.type!=='button'||rule.trigger.columnId===event.columnId)&&(rule.trigger.type!=='property_changed'||!rule.trigger.columnId||rule.trigger.columnId===event.columnId))) {
      const depth=event.depth??0,run={id:token('arun'),ruleId:rule.id,databaseId:rule.databaseId,rowId:row.id,depth,actionsCompleted:0,status:'succeeded',startedStep:plan.operations.length,finishedStep:plan.operations.length,actionEnds:[] as number[]};
      plan.runs.push(run);
      if(depth>=rule.maxDepth||(event.visitedRuleIds??[]).includes(rule.id)||!matches(rule.condition,row)){run.status='skipped';continue;}
      const variables:Record<string,string|null>={};for(const [name,value] of Object.entries(rule.variables))variables[name]=resolve(value,row,rule.databaseId,variables);
      for(const action of rule.actions) {
        if(action.type==='set_property'){set(row,action.columnId,resolve(action.value,row,rule.databaseId,variables));dispatch({type:'property_changed',databaseId:row.databaseId,rowId:row.id,columnId:action.columnId,eventKey:event.eventKey,depth:depth+1,visitedRuleIds:[...(event.visitedRuleIds??[]),rule.id]});}
        else if(action.type==='create_page'){
          const databaseId=action.databaseId??rule.databaseId;if(!context.columns.some(c=>c.databaseId===databaseId))throw new Error('database_action_context_incomplete');
          const created:DatabaseRow={id:token('drow'),databaseId,position:0,cells:{},createdAt:'',updatedAt:''};rows.set(created.id,created);
          append({type:'create_page',rowId:created.id,databaseId,blocks:action.blocks.map(block=>({...block,id:block.id??token('pblk')}))});
          for(const [id,value] of Object.entries(action.properties))set(created,id,resolve(value,row,rule.databaseId,variables));
          dispatch({type:'row_created',databaseId,rowId:created.id,eventKey:event.eventKey,depth:depth+1,visitedRuleIds:[...(event.visitedRuleIds??[]),rule.id]});
        }else if(action.type==='update_related'){
          for(const relation of context.relations.filter(r=>r.rowId===row.id&&r.columnId===action.relationColumnId&&r.targetKind==='db_row'&&!r.broken)){
            const related=rows.get(relation.targetId);if(!related)throw new Error('database_action_context_incomplete');for(const change of action.changes)set(related,change.columnId,resolve(change.value,row,rule.databaseId,variables));
          }
        }else if(action.type==='notify')append({type:'notify',id:token('anote'),ruleId:rule.id,runId:run.id,databaseId:rule.databaseId,rowId:row.id,title:render(action.title,row,rule.databaseId,variables),body:render(action.body,row,rule.databaseId,variables)});
        else append({type:'webhook',ruleId:rule.id,runId:run.id,url:action.url,method:action.method,headers:Object.fromEntries(Object.entries(action.headers).map(([key,value])=>[key,render(value,row,rule.databaseId,variables)])),body:render(action.body,row,rule.databaseId,variables),maxAttempts:rule.maxAttempts,retryDelayMs:rule.retryDelayMs});
        run.actionsCompleted++;run.actionEnds.push(plan.operations.length);
      }
      run.finishedStep=plan.operations.length;
    }
  }
  const row=rows.get(rowId),column=columns.get(columnId);if(!row||!column||row.databaseId!==column.databaseId||column.type!=='button')throw new Error('database_action_parent_unavailable');
  const prior=(()=>{try{return JSON.parse(row.cells[columnId]??'{}');}catch{return {};}})();
  const clicks=Math.max(0,Number(prior.clicks??0))+1;
  row.cells[columnId]=JSON.stringify({clicks,lastClickedAt:'NODUS_ACTION_CLICK_TIME',lastClickedBy:'local'});
  append({type:'button_click',rowId,columnId,clicks});
  dispatch({type:'button',databaseId:row.databaseId,rowId,columnId,eventKey:'explicit-device-click'});
  return plan;
}
