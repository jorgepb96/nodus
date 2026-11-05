import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
const tmp=await mkdtemp(path.join(os.tmpdir(),'stellar-tests-'));
await build({entryPoints:['src/stellarGraph/context.ts','src/stellarGraph/exploration.ts','src/stellarGraph/source.ts','src/stellarGraph/layout.ts','src/stellarGraph/themes.ts','src/stellarGraph/forceLayout.ts'],outdir:tmp,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'}});
const {Exploration}=await import(path.join(tmp,'exploration.mjs'));
const {memorySource,workScopedSource}=await import(path.join(tmp,'source.mjs'));
const {placeNodes,isLegacyLinearLayout}=await import(path.join(tmp,'layout.mjs'));
const {capRelations,sortThemes,neighbourhood,themeConstellation,THEME_SQUASH}=await import(path.join(tmp,'themes.mjs'));
const {forceLayout}=await import(path.join(tmp,'forceLayout.mjs'));
const node=id=>({id,label:id,type:'claim',workCount:1,workIds:id==='outside'?['w2']:['w1'],read:true,themes:[],years:[],authors:[],maxConfidence:1});
const edge=(id,source,target)=>({id,source,target,type:'supports',basis:'explicit',confidence:.8});
const graph={nodes:['a','b','c','d','isolated','outside'].map(node),edges:[edge('1','a','b'),edge('2','a','c'),edge('3','b','d'),edge('4','c','d'),edge('5','d','a'),edge('6','outside','d'),{...edge('7','a','b'),type:'contains'}]};
const source=()=>memorySource('test',async()=>graph);
test('a reconnected corpus refreshes a work graph without changing its saved exploration',async()=>{
 let current={nodes:[{...node('a'),themes:['Before']},node('b')],edges:[edge('ab','a','b')]},reads=0;
 const base=memorySource('companion',async()=>{reads++;return current;});
 const scoped=workScopedSource(base,'w1');
 const exploration=new Exploration(scoped);await exploration.add('a',25);
 const saved={version:1,seeds:[...exploration.seeds],pinnedNodes:[...exploration.baselineNodes],history:[...exploration.history],cursor:exploration.cursor,activeSeed:exploration.activeSeed,camera:{x:90,y:120,zoom:1.1},positions:{a:{x:4,y:8}}};
 assert.equal(reads,1);assert.equal((await base.themes())[0].label,'Before');
 current={nodes:[{...node('a'),label:'Edited on Mac',themes:['After']},node('c')],edges:[edge('ac','a','c')]};
 scoped.invalidate();
 const restored=new Exploration(scoped);await restored.restore(saved);
 assert.equal(restored.nodes.get('a').label,'Edited on Mac');
 assert.deepEqual(restored.seeds,['a']);assert.ok(!restored.edges.has('ab'));
 assert.deepEqual(saved.camera,{x:90,y:120,zoom:1.1});
 assert.equal((await base.themes())[0].label,'After');
 await restored.add('a',25);assert.ok(restored.visible().nodes.some(n=>n.id==='c'));
 assert.equal(reads,2,'themes and all paginated work queries share the fresh corpus');
});
test('a temporary graph transport failure can be retried without a remount',async()=>{
 let attempts=0;const source=memorySource('retry',async()=>{if(++attempts===1)throw new Error('offline');return graph;});
 await assert.rejects(source.page({kind:'search'}),/offline/);
 assert.equal((await source.page({kind:'search'})).total,graph.nodes.length);
 assert.equal(attempts,2);
});
test('unique breadth-first relations, cycles, incoming edges, and rewind',async()=>{const e=new Exploration(source());e.ingest({nodes:[node('a')],edges:[]});e.start('a');const order=[];for(let x=await e.next();x;x=await e.next())order.push(x.id);assert.deepEqual(order,['1','2','5','7','3','4','6']);assert.equal(e.visible().nodes.length,5);e.previous();assert.equal(e.visible().nodes.length,4);assert.equal((await e.next()).id,'6');assert.equal(e.visible().nodes.length,5);});
test('work baseline includes isolated ideas and only internal links, reroot keeps baseline',async()=>{const e=new Exploration(source());await e.baseline('w1');assert.equal(e.visible().nodes.length,5);assert.equal(e.visible().edges.length,6);e.start('a');assert.equal((await e.next()).id,'6');e.previous();assert.equal(e.visible().nodes.length,5);assert.equal(e.visible().edges.length,6);});
test('multiple seeds retain history; restoring revalidates deletions',async()=>{const e=new Exploration(source());e.ingest({nodes:[node('a')],edges:[]});e.start('a');await e.next();e.start('b');await e.next();assert.equal(e.history.length,2);const restored=new Exploration(source());await restored.restore({version:1,seeds:e.seeds,activeSeed:'b',history:[...e.history,'deleted'],cursor:3});assert.deepEqual(restored.history,e.history);assert.equal(restored.cursor,2);});
test('pagination exhausts hubs beyond 200 without silent caps',async()=>{const g={nodes:[node('a'),...Array.from({length:503},(_,i)=>node('x'+i))],edges:Array.from({length:503},(_,i)=>edge(String(i).padStart(4,'0'),'a','x'+i))};const e=new Exploration(memorySource('hub',async()=>g));e.ingest({nodes:[node('a')],edges:[]});e.start('a');let n=0;while(await e.next())n++;assert.equal(n,503);assert.equal(e.visible().nodes.length,504);});
test('pause during the cooperative yield does not reveal an extra relationship',async()=>{let e;const s=source();let first=true;e=new Exploration({...s,page:async req=>{const page=await s.page(req);if(first){first=false;setTimeout(()=>e.interrupt(),0);}return page;}});e.ingest({nodes:[node('a')],edges:[]});e.start('a');assert.equal(await e.next(),undefined);assert.equal(e.cursor,0);assert.equal((await e.next()).id,'1');});
test('cancelled exploration cannot replay hidden history',async()=>{const e=new Exploration(source());e.ingest({nodes:[node('a')],edges:[]});e.start('a');await e.next();e.previous();e.cancel();assert.equal(await e.next(),null);assert.equal(e.cursor,0);});
test('new placement preserves dragged coordinates and has no occupied cells',()=>{const ids=Array.from({length:10000},(_,i)=>String(i));const edges=ids.slice(1).map(id=>({source:'0',target:id}));const before={'0':{x:560,y:340}};const positions=placeNodes(ids,edges,before);assert.deepEqual(positions['0'],before['0']);assert.equal(new Set(Object.values(positions).map(p=>`${p.x},${p.y}`)).size,10000);assert.deepEqual(placeNodes(ids,edges,positions),positions);});
test('sparse works form a compact two-dimensional canvas without inventing links',()=>{const ids=Array.from({length:32},(_,i)=>'g-'+(5884+i)),edges=[[0,1],[3,4],[8,9],[9,10],[10,11],[23,24]].map(([a,b])=>({source:ids[a],target:ids[b]}));const before=structuredClone(edges),positions=placeNodes(ids,edges,{}),ps=Object.values(positions);const width=Math.max(...ps.map(p=>p.x))-Math.min(...ps.map(p=>p.x)),height=Math.max(...ps.map(p=>p.y))-Math.min(...ps.map(p=>p.y));assert.equal(ps.length,32);assert.ok(new Set(ps.map(p=>p.y)).size>=5);assert.ok(width<5000&&height>700&&width/height<3);assert.equal(new Set(ps.map(p=>`${p.x},${p.y}`)).size,32);assert.deepEqual(edges,before);assert.deepEqual(placeNodes([...ids].reverse(),[...edges].reverse(),{}),positions);});
test('legacy row repair recognizes generated rows and leaves custom layouts alone',()=>{const ids=Array.from({length:32},(_,i)=>String(i));const row=Object.fromEntries(ids.map((id,i)=>[id,{x:Math.round(i*700/280)*280,y:0}]));assert.ok(isLegacyLinearLayout(ids,row));assert.equal(isLegacyLinearLayout(ids,{...row,'1':{x:123,y:45}}),false);assert.equal(isLegacyLinearLayout(ids,placeNodes(ids,[],{})),false);});
process.on('exit',()=>{void rm(tmp,{recursive:true,force:true});});

test('choosing an idea immediately reveals exactly its direct-link budget, with no second-hop fill',async()=>{
 const e=new Exploration(source());e.ingest({nodes:[node('a')],edges:[]});
 assert.equal(await e.add('a',2),2);
 assert.deepEqual(e.visible().edges.map(e=>e.id),['1','2']);
 assert.equal(await e.add('a',25),4);
 assert.deepEqual(e.visible().edges.map(e=>e.id),['1','2','5','7']);
 assert.ok(!e.visible().nodes.some(n=>n.id==='outside'));
});
test('direct loading paginates beyond 200 and unlimited ends at the seed neighborhood',async()=>{
 const g={nodes:[node('a'),...Array.from({length:503},(_,i)=>node('x'+i))],edges:Array.from({length:503},(_,i)=>edge(String(i).padStart(4,'0'),'a','x'+i))};
 const e=new Exploration(memorySource('hub',async()=>g));
 assert.equal(await e.add('a',251),251);assert.equal(e.visible().edges.length,251);
 assert.equal(await e.add('a',0),503);assert.equal(e.visible().edges.length,503);
});
test('a stalled page reports a translatable failure without publishing a partial graph',async()=>{
 const base=source();
 const e=new Exploration({...base,page:async request=>request.kind==='neighbors'
   ? {...await base.page(request),next:request.cursor}
   : base.page(request)});
 await assert.rejects(e.add('a',25),{message:'No se pudieron cargar todas las conexiones. Vuelve a intentarlo.'});
 assert.deepEqual(e.visible(),{nodes:[],edges:[]});
});
test('removing one node preserves other visible ideas and prevents dangling or resurrected edges',async()=>{
 const e=new Exploration(source());await e.add('a',25);
 const before=e.visible().nodes.map(n=>n.id);
 e.remove('a');
 assert.deepEqual(e.visible().nodes.map(n=>n.id).sort(),before.filter(id=>id!=='a').sort());
 assert.equal(e.visible().edges.length,0);
 await e.add('b',25);
 assert.ok(!e.visible().nodes.some(n=>n.id==='a'));
 assert.ok(e.visible().edges.every(e=>e.source!=='a'&&e.target!=='a'));
 await e.add('a',25);assert.equal(e.visible().edges.length,5);
});
test('an isolated idea can be removed and explicitly re-added',async()=>{
 const e=new Exploration(source());await e.add('isolated',25);assert.equal(e.visible().nodes.length,1);
 e.remove('isolated');assert.equal(e.visible().nodes.length,0);
 await e.add('isolated',25);assert.equal(e.visible().nodes[0].id,'isolated');
});
test('Clear during an in-flight neighborhood request cannot repopulate the canvas',async()=>{
 const backing=source();let release;
 const delayed={...backing,page:async req=>{if(req.kind==='neighbors')await new Promise(resolve=>{release=resolve;});return backing.page(req);}};
 const e=new Exploration(delayed);e.ingest({nodes:[node('a')],edges:[]});
 const load=e.add('a',25);e.clear();release();
 assert.equal(await load,undefined);assert.deepEqual(e.visible(),{nodes:[],edges:[]});
 assert.equal(e.activeSeed,null);assert.equal(e.history.length,0);
});
test('independent graph engines do not share visibility or removal state',async()=>{
 const shared=source(),first=new Exploration(shared),second=new Exploration(shared);
 await first.add('a',2);await second.add('b',25);
 first.clear();assert.equal(second.visible().edges.length,3);
 second.remove('a');await first.add('a',25);assert.equal(first.visible().edges.length,4);
});
test('work-scoped search and expansion stay inside the work without a visible baseline',async()=>{
 const {workScopedSource}=await import(path.join(tmp,'source.mjs'));
 const scoped=workScopedSource(source(),'w1'),e=new Exploration(scoped);
 assert.deepEqual(e.visible(),{nodes:[],edges:[]});
 assert.ok(!(await scoped.page({kind:'search',search:''})).nodes.some(n=>n.id==='outside'));
 await e.add('d',0);assert.ok(!e.visible().nodes.some(n=>n.id==='outside'));
});

// --- Themes hub: the first graph tab and the section behind each theme.
const themed=(id,...labels)=>({...node(id),themes:labels});
test('theme nodes sit on rings around the centre and fit a screen at full size',()=>{
 const hub=(label,ideaCount)=>({id:label,label,ideaCount,workCount:1,curated:false});
 for(const n of [2,7,14,31]){
  const themes=Array.from({length:n},(_,i)=>hub('t'+i,100-i));
  const p=themeConstellation(themes);
  assert.equal(Object.keys(p).length,n,`every theme is placed (${n})`);
  assert.equal(new Set(Object.values(p).map(q=>`${q.x},${q.y}`)).size,n,`no two themes share a spot (${n})`);
  // Every node lies on one of a few ellipses: that is what makes it read as a ring.
  const radii=new Set(themes.map(t=>Math.round(Math.hypot(p[t.id].x,p[t.id].y/THEME_SQUASH)/10)*10));
  assert.ok(radii.size<=Math.max(2,Math.ceil(n/6)),`themes form rings, not a scatter (${n} → ${radii.size} radii)`);
  const nearest=themes.map(a=>Math.min(...themes.filter(b=>b!==a)
    .map(b=>Math.hypot(p[a.id].x-p[b.id].x,p[a.id].y-p[b.id].y))));
  assert.ok(Math.min(...nearest)>150,`label cards keep room between neighbours (${n})`);
  const width=Math.max(...Object.values(p).map(q=>q.x))-Math.min(...Object.values(p).map(q=>q.x));
  const height=Math.max(...Object.values(p).map(q=>q.y))-Math.min(...Object.values(p).map(q=>q.y));
  // A screen holds about sixteen label cards; past that the ring grows and "Fit all" earns
  // its keep, but it must never grow for a corpus that would have fitted.
  if(n<=16) assert.ok(width<=1400&&height<=800,`the ring fits on screen without zooming out (${n}: ${width}x${height})`);
  // Two themes sit top and bottom, so only a real ring can be judged by its shape.
  if(n>=7) assert.ok(width>height,`the ring follows the shape of a screen (${n})`);
  assert.deepEqual(themeConstellation([...themes].reverse()),p,'input order cannot change the ring');
 }
 const seven=themeConstellation(Array.from({length:7},(_,i)=>hub('t'+i,100-i)));
 assert.equal(new Set(Object.values(seven).map(q=>Math.round(Math.hypot(q.x,q.y/THEME_SQUASH)/10)*10)).size,1,
  'a handful of themes make a single circle');
 assert.deepEqual(themeConstellation([hub('only',3)]).only,{x:0,y:0},'a single theme sits in the middle');
});
test('theme hubs are ordered by the ideas they nest, curated ones first on a tie',()=>{
 const hub=(label,ideaCount,curated=false)=>({id:label,label,ideaCount,workCount:1,curated});
 assert.deepEqual(sortThemes([hub('b',3),hub('a',9),hub('c',3,true)]).map(t=>t.label),['a','c','b']);
});
test('a theme page carries every idea of the theme and only its internal relations',async()=>{
 const graph={nodes:[themed('a','Poder'),themed('b','Poder'),themed('c','Ritual')],
  edges:[edge('1','a','b'),edge('2','b','c')]};
 const source=memorySource('themes',async()=>graph);
 const page=await source.page({kind:'theme',id:'Poder'});
 assert.deepEqual(page.nodes.map(n=>n.id).sort(),['a','b']);
 assert.deepEqual(page.edges.map(e=>e.id),['1'],'a relation leaving the theme is not part of it');
 const hubs=await source.themes();
 assert.deepEqual(hubs.map(t=>[t.label,t.ideaCount]),[['Poder',2],['Ritual',1]]);
});
test('a whole theme loads as the visible baseline, ideas included',async()=>{
 const graph={nodes:[themed('a','Poder'),themed('b','Poder'),themed('lonely','Poder')],edges:[edge('1','a','b')]};
 const e=new Exploration(memorySource('theme-baseline',async()=>graph));
 await e.baseline('Poder','theme');
 assert.deepEqual(e.visible().nodes.map(n=>n.id).sort(),['a','b','lonely']);
 assert.deepEqual(e.visible().edges.map(x=>x.id),['1']);
});
test('the child-relation limit caps every idea without dropping one, and 0 shows them all',()=>{
 const nodes=['hub','x','y','z'].map(node);
 const edges=[edge('e1','hub','x'),edge('e2','hub','y'),edge('e3','hub','z')];
 const data={nodes,edges};
 assert.equal(capRelations(data,0).edges.length,3);
 const capped=capRelations(data,1);
 assert.equal(capped.edges.length,1,'the hub spends its single relation once');
 assert.equal(capped.nodes.length,4,'no idea leaves the theme because its relations are hidden');
 const degree=id=>capped.edges.filter(e=>e.source===id||e.target===id).length;
 assert.ok(nodes.every(n=>degree(n.id)<=1));
});
test('the strongest relations win the budget, and a revealed one is never hidden',()=>{
 const nodes=['hub','x','y'].map(node);
 const weak={...edge('weak','hub','x'),basis:'inferred',confidence:.2};
 const strong={...edge('strong','hub','y'),basis:'explicit',confidence:.9};
 const data={nodes,edges:[weak,strong]};
 assert.deepEqual(capRelations(data,1).edges.map(e=>e.id),['strong']);
 assert.deepEqual(capRelations(data,1,['weak']).edges.map(e=>e.id),['weak'],'the revealed step survives the cap');
 assert.deepEqual(capRelations(data,1).edges,capRelations(data,1).edges,'the cap is deterministic');
});

test('the theme layout pulls linked ideas together and pushes the rest apart',()=>{
 // Two cliques joined by nothing: the layout must separate them, not blend them into a disc.
 const a=['a1','a2','a3','a4'],b=['b1','b2','b3','b4'];
 const clique=ids=>ids.flatMap((x,i)=>ids.slice(i+1).map(y=>({source:x,target:y})));
 const ids=[...a,...b],edges=[...clique(a),...clique(b)];
 const p=forceLayout(ids,edges,{},{iterations:220});
 const spread=group=>{const xs=group.map(id=>p[id]);return Math.max(...xs.flatMap(u=>xs.map(v=>Math.hypot(u.x-v.x,u.y-v.y))));};
 const centre=group=>({x:group.reduce((s,id)=>s+p[id].x,0)/group.length,y:group.reduce((s,id)=>s+p[id].y,0)/group.length});
 const gap=Math.hypot(centre(a).x-centre(b).x,centre(a).y-centre(b).y);
 assert.ok(gap>Math.max(spread(a),spread(b)),`clusters stay apart (gap ${gap.toFixed(0)})`);
 assert.equal(new Set(ids.map(id=>`${p[id].x},${p[id].y}`)).size,8,'no two ideas share a coordinate');
});
test('the theme layout is deterministic and never loses or misplaces an idea',()=>{
 const ids=Array.from({length:400},(_,i)=>'n'+i);
 const edges=ids.slice(1).map((id,i)=>({source:ids[i%40],target:id}));
 const first=forceLayout(ids,edges,{},{iterations:60});
 assert.deepEqual(forceLayout([...ids].reverse(),[...edges].reverse(),{},{iterations:60}),first,'input order cannot change the result');
 assert.equal(Object.keys(first).length,400);
 assert.ok(ids.every(id=>Number.isFinite(first[id].x)&&Number.isFinite(first[id].y)));
});
test('ideas with no relation inside the theme are parked outside the connected core',()=>{
 const ids=['a','b','c','lonely1','lonely2'];
 const p=forceLayout(ids,[{source:'a',target:'b'},{source:'b',target:'c'}],{},{iterations:120});
 const core=Math.max(...['a','b','c'].map(id=>Math.hypot(p[id].x,p[id].y)));
 for(const id of ['lonely1','lonely2'])
  assert.ok(Math.hypot(p[id].x,p[id].y)>core,'an unconnected idea sits beyond the core, still placed');
 assert.notDeepEqual(p.lonely1,p.lonely2,'unconnected ideas do not stack on one another');
});
test('layout progress is reported and hand-placed coordinates seed the run',()=>{
 const ids=['a','b','c'],edges=[{source:'a',target:'b'}];
 const frames=[];
 forceLayout(ids,edges,{a:{x:1000,y:0}},{iterations:24,progressEvery:6,onProgress:(f,p)=>frames.push([f,Object.keys(p).length])});
 assert.ok(frames.length>=4,'the canvas can draw the graph settling');
 assert.equal(frames.at(-1)[0],1);
 assert.ok(frames.every(([,n])=>n===3),'every frame carries every idea');
});

test('a theme is walked one step at a time, and depth 0 still shows the whole thing',()=>{
 const ids=['a','b','c','d','far'];
 const data={nodes:ids.map(node),edges:[edge('1','a','b'),edge('2','a','c'),edge('3','c','d'),edge('4','d','far')]};
 assert.deepEqual(neighbourhood(data,'a',1).nodes.map(n=>n.id).sort(),['a','b','c']);
 assert.deepEqual(neighbourhood(data,'a',1).edges.map(e=>e.id).sort(),['1','2']);
 assert.deepEqual(neighbourhood(data,'a',2).nodes.map(n=>n.id).sort(),['a','b','c','d']);
 assert.equal(neighbourhood(data,'a',0).nodes.length,5,'depth 0 is the whole theme');
 assert.equal(neighbourhood(data,null,2).nodes.length,5,'without a focus nothing is hidden');
 assert.equal(neighbourhood(data,'gone',2).nodes.length,5,'a focus that left the canvas hides nothing');
});
test('walking a theme keeps an isolated focus visible and never invents relations',()=>{
 const data={nodes:['lonely','x'].map(node),edges:[]};
 const view=neighbourhood(data,'lonely',2);
 assert.deepEqual(view.nodes.map(n=>n.id),['lonely']);
 assert.deepEqual(view.edges,[]);
});

test('simplifying connections preserves the complete neighbourhood and isolated theme ideas',()=>{
 const data={nodes:['a','b','c','d','isolated'].map(node),edges:[edge('1','a','b'),edge('2','a','c'),edge('3','c','d')]};
 const nearby=neighbourhood(data,'a',2);
 const simplified=capRelations(nearby,1);
 assert.deepEqual(simplified.nodes.map(n=>n.id),['a','b','c','d']);
 assert.ok(simplified.edges.length<nearby.edges.length);
 assert.deepEqual(capRelations(nearby,0),nearby);
 assert.equal(capRelations(neighbourhood(data,'a',0),1).nodes.length,5,'whole-theme mode also keeps isolated ideas');
});

const {loadCorpusContext}=await import(path.join(tmp,'context.mjs'));
test('corpus context includes every unique idea, isolated ideas and cross-theme links',async()=>{
 const g={nodes:Array.from({length:503},(_,i)=>({...node('c'+i),themes:[i%2?'A':'B']})),edges:Array.from({length:502},(_,i)=>edge('c'+i,'c'+i,'c'+(i+1)))};
 const result=await loadCorpusContext(memorySource('corpus',async()=>g),()=>false,()=>{});
 assert.equal(result.nodes.length,503);assert.equal(result.edges.length,502);
 assert.equal(new Set(result.nodes.map(n=>n.id)).size,503);
 const withLoose=await loadCorpusContext(source(),()=>false,()=>{});
 assert.ok(withLoose.nodes.some(n=>n.id==='isolated'));
 assert.ok(withLoose.edges.some(e=>e.source==='outside'));
});
test('context cancellation stops pagination and malformed pagination fails',async()=>{
 const base=source();let cancelled=false,calls=0;
 const result=await loadCorpusContext({...base,page:async req=>{calls++;cancelled=true;return {...await base.page(req),next:200};}},()=>cancelled,()=>{});
 assert.equal(result,null);assert.equal(calls,1);
 await assert.rejects(loadCorpusContext({...base,page:async req=>({...await base.page(req),next:0})},()=>false,()=>{}),/contexto/);
});
