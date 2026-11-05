import assert from 'node:assert/strict';
import fs from 'node:fs';
import {connectAcceptanceBridge} from './lib/mobileAcceptanceClient.mjs';
const lab=process.env.NODUS_MOBILE_ACCEPTANCE_LAB;
const client=await connectAcceptanceBridge('Study and Teaching graph consultation');
try {
  const fixtures=JSON.parse(fs.readFileSync(`${lab}/study-graph-fixtures.json`,'utf8'));
  const results=[];
  for(const vault of fixtures.vaults){
    const operation=async(method,args=[]) => (await client.request(`/bridge/v2/vaults/${encodeURIComponent(vault.vaultId)}/operations`,'POST',{method,args})).result;
    const workspace=await operation('getStudyWorkspace');
    for(const subject of vault.subjects){
      assert(workspace.subjects.some(row=>row.id===subject.id));
      const graph=await operation('getStudyKnowledgeGraph',[subject.id]);
      const ideas=await operation('listStudyIdeas',[subject.id]);
      assert.equal(graph.subjectId,subject.id);assert.equal(graph.nodes.length,subject.nodes);assert.equal(graph.edges.length,subject.edges);
      assert.equal(ideas.length,subject.nodes);
      const last=ideas.find(idea=>idea.label===subject.lastLabel);assert(last,'The last record beyond page one remains available');
      const detail=await operation('getStudyIdeaDetail',[last.id]);
      assert(detail.evidence.some(evidence=>evidence.sourceKind==='document' && evidence.sourceId===subject.documentId));
      assert(detail.connections.length>0);
      const searched=await operation('listStudyIdeas',[subject.id,subject.lastLabel]);assert.equal(searched.length,1);assert.equal(searched[0].id,last.id);
      const scoped=await operation('getStudyKnowledgeGraph',[vault.subjects.find(row=>row.id!==subject.id).id]);
      assert(!scoped.nodes.some(node=>node.id===last.id),'Switching subjects must not leak the previous graph');
      results.push({vaultId:vault.vaultId,vaultType:vault.vaultType,subjectId:subject.id,nodes:graph.nodes.length,edges:graph.edges.length,evidence:true,search:true,subjectIsolation:true});
    }
  }
  const result={result:'passed',transport:'production pinned HTTPS',fixtures:'explicit fictional preanalysed evidence',results};
  fs.writeFileSync(`${lab}/study-graph-acceptance-result.json`,JSON.stringify(result),{mode:0o600});console.log(JSON.stringify(result));
}finally{await client.close();}
