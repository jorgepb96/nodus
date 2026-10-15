import type {StudyIdeaDetail,StudyIdeaSummary,StudyKnowledgeGraph,StudyWorkspace} from '../../shared/types';
import {sqliteLike} from '../../shared/studyKnowledgeProjection';
export interface StudyKnowledgeCopy {
 version:1;vaultId:string;subjectId:string;revision:string;workspace:StudyWorkspace;
 total:number;ideas:StudyIdeaSummary[];details:StudyIdeaDetail[];graph:StudyKnowledgeGraph;
}
export function studyKnowledgeCopies(raw:unknown,vaultId:string) {
 if(!Array.isArray(raw)||!raw.length)throw new Error('Descarga las ideas de una asignatura mientras Nodus esté conectado.');
 const subjects=new Map<string,StudyKnowledgeCopy>();
 for(const value of raw) {
  const copy=value as StudyKnowledgeCopy;
  if(!copy||copy.version!==1||copy.vaultId!==vaultId||!copy.subjectId||!/^[a-f0-9]{64}$/.test(copy.revision)||!Number.isSafeInteger(copy.total)||copy.total<0||!Array.isArray(copy.ideas)||!Array.isArray(copy.details)||copy.ideas.length!==copy.total||copy.details.length!==copy.total||!Array.isArray(copy.graph?.nodes)||!Array.isArray(copy.graph?.edges)||copy.workspace?.subjects?.length!==1||copy.workspace.subjects[0].id!==copy.subjectId||copy.workspace.courses?.length!==1||copy.workspace.subjects[0].courseId!==copy.workspace.courses[0].id)throw new Error('La descarga de ideas no es completa o pertenece a otro espacio.');
  const ids=new Set(copy.ideas.map(x=>x.id));
  if(ids.size!==copy.total||copy.ideas.some(x=>x.subjectId!==copy.subjectId)||copy.details.some(x=>!ids.has(x.id)||x.subjectId!==copy.subjectId||!Array.isArray(x.evidence)||!Array.isArray(x.connections))||new Set(copy.details.map(x=>x.id)).size!==copy.total||copy.graph.nodes.length!==copy.total||copy.graph.nodes.some(x=>!ids.has(x.id))||copy.graph.edges.some(x=>!ids.has(x.source)||!ids.has(x.target)))throw new Error('La descarga contiene ideas o evidencias incompatibles.');
  // downloadedData supplies read packs newest first; an older pack cannot
  // overwrite a newer selected revision of the same subject.
  if(!subjects.has(copy.subjectId))subjects.set(copy.subjectId,copy);
 }
 const copies=[...subjects.values()];
 const workspace={...copies[0].workspace,subjects:copies.flatMap(c=>c.workspace.subjects),courses:[...new Map(copies.flatMap(c=>c.workspace.courses).map(c=>[c.id,c])).values()]};
 const selected=(id:string)=>{const copy=subjects.get(id);if(!copy)throw new Error('Esta asignatura no está descargada en este dispositivo.');return copy;};
 return {workspace,list:(id:string,query='')=>{const match=sqliteLike(query.trim());return selected(id).ideas.filter(x=>!query.trim()||match(x.label)||match(x.statement));},
  detail:(id:string)=>{const result=copies.flatMap(c=>c.details).find(x=>x.id===id);if(!result)throw new Error('La idea no está descargada en este dispositivo.');return result;},graph:(id:string)=>selected(id).graph};
}
