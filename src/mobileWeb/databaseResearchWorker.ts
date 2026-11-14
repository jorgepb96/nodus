import {runDatabaseDeepResearch} from '@shared/databaseResearchEngine';
self.onmessage=event=>{
  const {request,snapshot,columns}=event.data;
  try {
    const result=runDatabaseDeepResearch(request,{readSnapshot:()=>snapshot,readColumns:()=>columns,onStep:(completed,total)=>self.postMessage({progress:{completed,total}})},[]);
    self.postMessage({result});
  } catch(error) {self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
