import {studyKnowledgeCopies} from './studyKnowledgeCopy';
type StudyReadConfig={live:boolean;surface:string;vaultType:string;vaultId?:string};
const methods=new Set(['getStudyWorkspace','listStudyIdeas','getStudyIdeaDetail','getStudyKnowledgeGraph']);
/** Explicit selected consultation, independent of the provider execution mode. */
export async function selectedStudyOffline(nativeCall:(method:string,...args:unknown[])=>Promise<any>,config:StudyReadConfig,method:string,args:unknown[],error:unknown):Promise<{handled:false}|{handled:true;value:unknown}> {
 if((error as {code?:string})?.code!=='offline'||!config.live||!methods.has(method)||!(config.surface==='studyIdeas'||config.surface==='graph'&&['estudio','docencia'].includes(config.vaultType)))return {handled:false};
 const copy=studyKnowledgeCopies(await nativeCall('studyKnowledgeCopy','load'),config.vaultId??'');
 const value=method==='getStudyWorkspace'?copy.workspace:method==='listStudyIdeas'?copy.list(String(args[0]),args[1] as string|undefined):method==='getStudyIdeaDetail'?copy.detail(String(args[0])):copy.graph(String(args[0]));
 return {handled:true,value};
}
