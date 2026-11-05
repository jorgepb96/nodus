import assert from 'node:assert/strict';
import fs from 'node:fs';
import {connectAcceptanceBridge} from './lib/mobileAcceptanceClient.mjs';

const client=await connectAcceptanceBridge('Large graph acceptance');
try {
  const themes=await client.operation('stellarThemes');
  const theme=[...themes].sort((a,b)=>b.ideaCount-a.ideaCount)[0];
  assert(theme && theme.ideaCount>1000,'Large graph acceptance requires a real theme with more than a thousand eligible ideas');
  let cursor=null,pages=0;
  const nodes=new Set(),edges=new Set(),cursors=new Set();
  do {
    const page=await client.operation('stellarPage',[{kind:'theme',id:theme.id,cursor,limit:200}]);
    // Node pages include the endpoints of that page's edges. An endpoint can
    // legitimately occur again; the canvas merges nodes by identity.
    const pageNodes=new Set(page.nodes.map(node=>node.id));
    assert.equal(pageNodes.size,page.nodes.length,'A page must contain each endpoint only once');
    for(const node of page.nodes)nodes.add(node.id);
    for(const edge of page.edges){
      assert(!edges.has(edge.id),'A page must not repeat an earlier relation');
      assert(pageNodes.has(edge.source) && pageNodes.has(edge.target),'Every relation must include both consultable endpoints');
      edges.add(edge.id);
    }
    cursor=page.next;pages++;
    if(cursor!==null){assert(!cursors.has(cursor),'Pagination must advance');cursors.add(cursor);}
  } while(cursor!==null);
  assert.equal(nodes.size,theme.ideaCount,'The whole theme is available beyond the first page');
  const result={result:'passed',vaultId:client.vault.id,themeId:theme.id,themeLabel:theme.label,ideas:nodes.size,edges:edges.size,pages,
    transport:'production pinned HTTPS',capturedAt:new Date().toISOString()};
  fs.writeFileSync(`${process.env.NODUS_MOBILE_ACCEPTANCE_LAB}/large-graph-acceptance-result.json`,JSON.stringify(result),{mode:0o600});
  console.log(JSON.stringify(result));
} finally {await client.close();}
