import {validateMobileStudyChatSourcePack,type MobileStudyChatSourcePack} from './mobileStudyChat';
import {canonicalJson} from './canonicalJson';
import type {MobileDeepResearchProof} from './mobileDeepResearch';
import type {StudySearchIndexEntry} from './studySearch';
import type {StudyIdeaSummary,StudyIdeaConnection} from './studyKnowledge';
export interface MobileStudyResearchSource {
 version:1;kind:'study';context:MobileDeepResearchProof;packIds:string[];entries:StudySearchIndexEntry[];
 knowledge:{ideas:StudyIdeaSummary[];connections:StudyIdeaConnection[]};ideaSources:Record<string,string[]>;
 retrieval:'lexical';
}
/** Only explicitly carried source packs supply this corpus. No old pack gains an
 * invented revision or an inferred knowledge graph just because the Mac is off. */
export function captureMobileStudyResearchSources(packs:MobileStudyChatSourcePack[],scope:'linked_corpus'|'device_downloads'):MobileStudyResearchSource {
 if(!Array.isArray(packs)||!packs.length)throw new Error('study_research_sources_not_downloaded');
 let context:MobileDeepResearchProof|undefined;
 const entries=new Map<string,StudySearchIndexEntry>(),ideas=new Map<string,StudyIdeaSummary>(),edges=new Map<string,StudyIdeaConnection>(),ideaSources:Record<string,string[]>={};
 for(const pack of packs){
  validateMobileStudyChatSourcePack(pack,pack.vaultId);
  const research=pack.research;
  if(pack.researchUnavailable)throw new Error('La selección supera el contexto de investigación del móvil. Descarga un conjunto menor de fuentes de estudio.');
  if(!research?.context||research.context.version!==1||research.context.vaultId!==pack.vaultId||!['estudio','docencia'].includes(research.context.vaultType)||!/^[a-f0-9]{64}$/.test(research.context.revision)||!Array.isArray(research.knowledge?.ideas)||!Array.isArray(research.knowledge.connections)||!research.ideaSources||typeof research.ideaSources!=='object')throw new Error('study_research_download_needs_refresh');
  if(context&&(context.vaultId!==research.context.vaultId||context.vaultType!==research.context.vaultType||context.revision!==research.context.revision))throw new Error('study_research_source_conflict');
  context=research.context;
  for(const entry of pack.entries.filter(entry=>['material','document','transcript'].includes(entry.kind))){const prior=entries.get(entry.indexId);if(prior&&canonicalJson(prior)!==canonicalJson(entry))throw new Error('study_research_source_conflict');entries.set(entry.indexId,entry);}
  for(const idea of research.knowledge.ideas){if(typeof idea.id!=='string'||typeof idea.label!=='string'||typeof idea.statement!=='string'||!Array.isArray(research.ideaSources[idea.id]))throw new Error('invalid_study_research_knowledge');const prior=ideas.get(idea.id);if(prior&&canonicalJson(prior)!==canonicalJson(idea))throw new Error('study_research_source_conflict');ideas.set(idea.id,idea);ideaSources[idea.id]=[...new Set([...(ideaSources[idea.id]??[]),...research.ideaSources[idea.id]])];}
  for(const edge of research.knowledge.connections){if(typeof edge.id!=='string'||typeof edge.fromId!=='string'||typeof edge.toId!=='string'||!Number.isFinite(edge.confidence))throw new Error('invalid_study_research_knowledge');edges.set(edge.id,edge);}
 }
 if(!entries.size)throw new Error('study_research_sources_not_downloaded');
 const keys=new Set([...entries.values()].map(entry=>`${entry.kind}:${entry.sourceId}`));
 const selectedIdeas=[...ideas.values()].filter(idea=>ideaSources[idea.id]?.some(key=>keys.has(key))),ids=new Set(selectedIdeas.map(idea=>idea.id));
 const result:MobileStudyResearchSource={version:1,kind:'study',context:{...context!,sourceScope:scope,preparedSourcesOnly:true},entries:[...entries.values()],packIds:packs.map(pack=>pack.id),knowledge:{ideas:selectedIdeas,connections:[...edges.values()].filter(edge=>ids.has(edge.fromId)&&ids.has(edge.toId))},ideaSources:Object.fromEntries(selectedIdeas.map(idea=>[idea.id,ideaSources[idea.id].filter(key=>keys.has(key))])),retrieval:'lexical'};
 if(new TextEncoder().encode(JSON.stringify(result)).length>16_000_000)throw new Error('deep_research_source_too_large');
 return result;
}
export function studyResearchKnowledge(source:MobileStudyResearchSource,sourceKeys:string[]) {
 const selected=new Set(sourceKeys);
 const ideas=source.knowledge.ideas.filter(idea=>source.ideaSources[idea.id]?.some(key=>selected.has(key))).sort((a,b)=>b.sourceCount-a.sourceCount||b.connectionCount-a.connectionCount||(a.label<b.label?-1:a.label>b.label?1:0)).slice(0,60),ids=new Set(ideas.map(idea=>idea.id));
 return {ideas,connections:source.knowledge.connections.filter(edge=>ids.has(edge.fromId)&&ids.has(edge.toId)).sort((a,b)=>b.confidence-a.confidence).slice(0,80)};
}
