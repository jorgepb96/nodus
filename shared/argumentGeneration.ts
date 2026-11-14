import {v4 as uuid} from 'uuid';
import type {ArgumentBlock,ArgumentMap,IdeaType} from './types';

export interface ArgumentGenerationSource {
  seedIdeaId:string;
  seed:{global_id:string;label:string;statement:string;type:IdeaType};
  ideas:Array<{global_id:string;label:string;statement:string;type:IdeaType}>;
  truncated:boolean;
  noMaterial:boolean;
  noConnections:{summary:string;overview:string};
  prompt:{system:string;user:string;temperature:number;maxTokens:number};
}
export function isArgumentGenerationResponse(value:unknown):value is {overview?:string;root:Record<string,unknown>}{
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&!!(value as {root?:unknown}).root&&typeof (value as {root?:unknown}).root==='object'&&!Array.isArray((value as {root?:unknown}).root);
}
const relations=new Set(['extends','variant_of','refines','contradicts','applies_to','shares_method','precondition_of','measures_same','supports','refutes','related','framing']);
const clip=(text:string,maximum:number)=>{const clean=text.replace(/\s+/g,' ').trim();return clean.length>maximum?`${clean.slice(0,maximum)}…`:clean;};
/** Desktop and device use the same grounding, cycle, block and depth limits.
 * A publication identity makes block IDs stable across a lost acknowledgement. */
export function finishArgumentGeneration(source:ArgumentGenerationSource,response:unknown,generatedAt=new Date().toISOString(),identity?:string):ArgumentMap{
  if(!source||!Array.isArray(source.ideas)||source.seed?.global_id!==source.seedIdeaId||!source.ideas.some(idea=>idea.global_id===source.seedIdeaId)||new Set(source.ideas.map(idea=>idea.global_id)).size!==source.ideas.length)throw new Error('invalid_argument_source');
  if(identity&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(identity))throw new Error('invalid_argument_identity');
  let blocks=0;const createId=()=>identity?`${identity}-${++blocks}`:(blocks++,uuid());
  const single=(summary:string,overview:string):ArgumentMap=>({seedIdeaId:source.seedIdeaId,seedLabel:source.seed.label,overview,root:{id:createId(),ideaId:source.seedIdeaId,label:source.seed.label,statement:source.seed.statement,type:source.seed.type,summary,relation:'root',children:[]},generatedAt,truncated:source.noMaterial?false:source.truncated,ideaCount:1});
  if(source.noMaterial)return single(source.noConnections.summary,source.noConnections.overview);
  if(!isArgumentGenerationResponse(response))throw new Error('invalid_argument_response');
  const ideas=new Map(source.ideas.map(idea=>[idea.global_id,idea])),seen=new Set<string>();
  const sanitize=(raw:unknown,root:boolean,depth:number):ArgumentBlock|null=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||blocks>=90)return null;
    const value=raw as Record<string,unknown>,id=typeof value.ideaId==='string'?value.ideaId:null;
    if(!id||root&&id!==source.seedIdeaId||!ideas.has(id)||seen.has(id))return null;
    seen.add(id);const idea=ideas.get(id)!,blockId=createId(),relation=typeof value.relation==='string'&&relations.has(value.relation)?value.relation:'related';
    const children:ArgumentBlock[]=[];
    if(depth<4&&Array.isArray(value.children))for(const child of value.children){const result=sanitize(child,false,depth+1);if(result)children.push(result);}
    return {id:blockId,ideaId:id,label:clip(typeof value.label==='string'&&value.label.trim()?value.label:idea.label,160),statement:idea.statement,type:idea.type,summary:clip(typeof value.summary==='string'?value.summary:'',200),relation:(root?'root':relation) as ArgumentBlock['relation'],children};
  };
  const overview=clip(typeof response.overview==='string'?response.overview:'',600),root=sanitize(response.root,true,0);
  return root?{seedIdeaId:source.seedIdeaId,seedLabel:source.seed.label,overview,root,generatedAt,truncated:source.truncated,ideaCount:seen.size}:single('',overview);
}
