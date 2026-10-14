import {readFile,writeFile,mkdir,cp,mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {CURSOR_CSS,installCursor} from '../../engine/cursor.mjs';
export const TEXT_MODEL='openai/gpt-oss-20b';
export const EMBED_MODEL='baai/bge-m3';
export const paperName='Reading a scientific paper - Carey et al 2020.txt';
export const question='According to this article, what does Rule 3 recommend, and which six questions does it list? Use the passage headed Rule 3, not the references list. Cite the supporting passage.';
export const MODEL={provider:'openrouter',model:TEXT_MODEL};
export const SETTINGS={firstVaultVersion:9999,theme:'light',mascotEnabled:false,autoBackupEnabled:false,autoLightScan:false,autoDeepScanOnReadTag:false,autoSummaryAfterDeep:false,autoBridgeAfterQueue:false,researchWebSearch:'off',academicInterfaceProfile:'simple',modelSettingsMode:'advanced',modelSettingsVersion:4,chatModel:null,extractionModel:null,synthesisModel:null,reduceMotion:false};
export async function setup(ctx,{paid=false,master=false}={}) {
 const {page,app,repoRoot,userData}=ctx;
 const storage=path.join(userData,'video-storage');await mkdir(storage,{recursive:true});
 if(master){const prefs=JSON.parse(await readFile(path.join(userData,'app-prefs.json'),'utf8').catch(()=>'{ }'));if(prefs.autoBackupFolder&&existsSync(prefs.autoBackupFolder))await cp(prefs.autoBackupFolder,storage,{recursive:true,preserveTimestamps:true});}
 await page.evaluate(folder=>window.nodus.updateSettings({autoBackupEnabled:false,autoBackupFolder:folder,uiLanguage:'en',promptLanguage:'en'}),storage);
 if(paid){
  const key=(await readFile(path.join(os.homedir(),'.config/nodus/openrouter.key'),'utf8')).trim();
  const [keyRes,catalog]=await Promise.all([fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:`Bearer ${key}`}}),fetch('https://openrouter.ai/api/v1/models')]);
  if(!keyRes.ok)throw new Error(`OpenRouter key HTTP ${keyRes.status}`);
  const data=(await catalog.json()).data;const model=data.find(m=>m.id===TEXT_MODEL);if(!model||+model.pricing.prompt*1e6>=.20||+model.pricing.completion*1e6>=.20)throw new Error('Text model exceeds the agreed price');
  await app.evaluate(({app})=>{
   globalThis.__videoUsageFile=app.getPath('userData')+'/video-usage.json';const nativeFetch=globalThis.fetch;globalThis.__videoUsage=[];globalThis.__videoReserved=0;globalThis.__videoPending=[];
   globalThis.fetch=async(input,init)=>{
    const url=String(input);if(!url.includes('openrouter.ai/api/v1/')||!/(chat\/completions|embeddings)(\?|$)/.test(url))return nativeFetch(input,init);
    const body=JSON.parse(init?.body??'{}'),embedding=url.includes('/embeddings');
    const allowed=embedding?'baai/bge-m3':'openai/gpt-oss-20b';if(body.model!==allowed)throw new Error('Video budget: unapproved model');
    if(!embedding){body.provider={...body.provider,only:['AkashML'],allow_fallbacks:false,zdr:true,max_price:{prompt:.19,completion:.19}};body.max_tokens=Math.min(body.max_tokens??4096,8192);}
    const reserve=JSON.stringify(body).length*.19/1e6+(embedding?0:(body.max_tokens??4096)*.19/1e6)+.002;
    if(globalThis.__videoReserved+reserve>1)throw new Error('Video budget limit reached');globalThis.__videoReserved+=reserve;
    const entry={model:body.model,started:new Date().toISOString(),reserved:reserve};globalThis.__videoUsage.push(entry);
    const response=await nativeFetch(input,{...init,body:JSON.stringify(body)});entry.status=response.status;
    const pending=response.clone().text().then(raw=>{let payloads=[];try{payloads=[JSON.parse(raw)];}catch{payloads=raw.split('\n').filter(l=>l.startsWith('data: ')&&!l.endsWith('[DONE]')).flatMap(l=>{try{return[JSON.parse(l.slice(6))];}catch{return[];}});}
     for(const p of payloads){if(p.usage)entry.usage=p.usage;if(p.id)entry.id=p.id;if(p.error)entry.error=p.error.message;}entry.finished=new Date().toISOString();const actual=entry.usage?.cost??(entry.usage?(Number(entry.usage.prompt_tokens??0)+Number(entry.usage.completion_tokens??0))*.19/1e6:reserve);entry.accounted=actual;globalThis.__videoReserved+=actual-reserve;try{process.getBuiltinModule('fs').writeFileSync(globalThis.__videoUsageFile,JSON.stringify(globalThis.__videoUsage,null,2));}catch{}}).catch(()=>{});
    globalThis.__videoPending.push(pending);return response;
   };
  });
 }
 if(process.env.NODUS_VIDEO_RENDERER_URL)await app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows()[0].loadURL(url),process.env.NODUS_VIDEO_RENDERER_URL);
 else await app.evaluate(({BrowserWindow},file)=>BrowserWindow.getAllWindows()[0].loadFile(file),path.join(repoRoot,'artifacts/academic-interface/app/index.html'));
 await page.getByTestId('academic-interface-trigger').waitFor();await page.locator('.backup-health-dismiss').click({timeout:1000}).catch(()=>{});
 if(master)await page.evaluate(async()=>{const vault=await window.nodus.getActiveVault();const corpus=await window.nodus.getResearchCorpusSources();for(const source of corpus.documents.filter(d=>d.libraryItemId&&d.workId&&!d.noteId&&!d.conversationAttachment))await window.nodus.linkGlobalLibraryItemsToVault([source.libraryItemId],vault.id);});
 await page.evaluate(css=>window.__TUTORIAL_CURSOR_CSS__=css,CURSOR_CSS);await page.evaluate(installCursor);
 await page.evaluate(()=>{
  const lift=()=>{for(const node of document.querySelectorAll('#nodus-tutorial-cursor,.nodus-tutorial-ripple,.nodus-tutorial-spot')){node.setAttribute('popover','manual');node.setAttribute('aria-hidden','true');node.style.right='auto';node.style.bottom='auto';node.style.padding='0';if(node.id==='nodus-tutorial-cursor')node.style.border='0';else node.style.background='transparent';node.style.margin=node.id==='nodus-tutorial-cursor'?'-11px 0 0 -11px':node.classList.contains('nodus-tutorial-ripple')?'-7px 0 0 -7px':'0';if(!node.matches(':popover-open'))node.showPopover();}};
  lift();new MutationObserver(lift).observe(document.body,{childList:true,subtree:true});
 });
 await page.evaluate(async()=>{const v=await window.nodus.getActiveVault();await window.nodus.renameVault(v.id,'Guided research');});
 await writeFile(path.join(repoRoot,`artifacts/academic-learning/video/${ctx.deckName??'active'}-profile.json`),JSON.stringify({profile:userData,pid:app.process().pid,paid},null,2));
}
export function helpers(ctx){
 const {page,app,settle,repoRoot,userData}=ctx;
 const click=async sel=>{const target=page.locator(sel).first();await target.waitFor({state:'visible'});await target.evaluate(node=>node.scrollIntoView({block:'nearest'}));for(let i=0;i<60&&!await target.isEnabled();i++)await settle(100);if(!await target.isEnabled())throw new Error(`Disabled control ${sel}`);const r=await target.boundingBox();if(!r)throw new Error(`Missing control ${sel}`);await page.evaluate(r=>window.__tutorialCursor?.moveTo(r.x+r.width/2,r.y+r.height/2),r);await page.evaluate(()=>window.__tutorialCursor?.pulse());await target.evaluate(button=>button.click());await settle(350);};
 const state=()=>page.evaluate(()=>window.nodus.getSettings());
 const wait=async(check,label,ms=240000)=>{const stop=Date.now()+ms;let value;while(Date.now()<stop){value=await state();if(check(value)){console.log('Verified:',label);return value;}if(value.academicPracticeSession?.recovery==='provider')throw new Error('Provider recovery: '+label);await settle(500);}throw new Error(`${label}: ${JSON.stringify(value.academicPracticeSession)}`);};
 const closeSource=async()=>{if(await page.getByTestId('source-citation-close').count())await click('[data-testid="source-citation-close"]');};
 const pause=async()=>{await closeSource();if(await page.getByTestId('idea-detail-modal').isVisible().catch(()=>false))await page.keyboard.press('Escape');if(await page.getByTestId('learning-pause').count())await click('[data-testid="learning-pause"]');};
 const open=async id=>{await pause();await page.evaluate(id=>window.dispatchEvent(new CustomEvent('nodus:academic-learning',{detail:{lessonId:id,mode:'guide'}})),id);await page.getByTestId('academic-learning-coach').waitFor();await settle(400);};
 const profile=async id=>{await pause();await click('[data-testid="academic-interface-trigger"]');await click(`[data-testid="academic-profile-${id}"]`);if(await page.getByTestId('academic-learning-invitation').count())await page.getByTestId('academic-learning-invitation').getByRole('button',{name:'Close',exact:true}).click();await settle(500);};
 const pickModel=async(role,id)=>{await click(`[data-testid="${role}-trigger"]`);await page.getByTestId(`${role}-search`).fill(id);const option=page.getByRole('option').filter({hasText:'OpenRouter'}).filter({hasText:id.split('/').at(-1)}).first();await option.waitFor();await option.click();await settle(300);};
 const source=async()=>{const rows=await page.evaluate(()=>window.nodus.getResearchCorpusSources());return rows.documents.find(d=>d.workId&&!d.noteId&&!d.conversationAttachment);};
 const selectSource=async()=>{const d=await source();if(!d)throw new Error('Paper not imported');await page.getByTestId(`vault-library-item-${d.workId}`).locator('input[type=checkbox]').check();await settle(500);return d;};
 const citation=async()=>{
  await page.locator('.research-composer-stop').waitFor({state:'hidden',timeout:300000});
  const session=(await state()).academicPracticeSession;
  const root=session?.messageId?page.locator(`[data-message-id="${session.messageId}"]`):page.locator('main');
  for(let attempt=0;attempt<6;attempt++){
   if(await page.getByTestId('source-citation-modal').isVisible().catch(()=>false))return;
   const ref=root.locator('button.citation-link:not([data-verified="false"])').first();await ref.waitFor();
   try{
    await ref.scrollIntoViewIfNeeded({timeout:1500});await settle(250);
    const r=await ref.boundingBox();if(!r)continue;
    await page.evaluate(r=>window.__tutorialCursor?.moveTo(r.x+r.width/2,r.y+r.height/2),r);
    await ref.click({timeout:1800});
   }catch(error){if(attempt===5)throw error;await settle(500);continue;}
   try{await page.getByTestId('source-citation-modal').waitFor({timeout:2500});await settle(400);return;}catch{await settle(300);}
  }
  throw new Error('The citation did not open its evidence workspace');
 };
 const save=async(label)=>{await page.screenshot({path:path.join(repoRoot,`artifacts/academic-learning/video/${label}.png`)});const s=await state();await writeFile(path.join(repoRoot,`artifacts/academic-learning/video/${label}.json`),JSON.stringify({session:s.academicPracticeSession,progress:s.academicLearningProgress},null,2));const usage=await app.evaluate(async()=>{await Promise.all(globalThis.__videoPending??[]);return globalThis.__videoUsage??[];});await writeFile(path.join(userData,'video-usage.json'),JSON.stringify(usage,null,2));};
 return {click,state,wait,open,pause,profile,pickModel,source,selectSource,citation,save,closeSource,
  importPaper:async()=>{await ctx.highlight('[data-testid="library-vault-add-files"]');await page.locator('[data-testid="library-vault-file-drop-surface"] input[type=file]').setInputFiles(path.join(repoRoot,'.tutorial-out/academic-learning/source',paperName));await page.getByTestId('library-vault-file-drop-surface').waitFor();for(let i=0;i<40;i++){if(await source())break;await settle(500);}const d=await source();if(!d)throw new Error('Normal paper import failed');await page.evaluate(async id=>window.nodus.updateGlobalLibraryItemMetadata(id,{title:'Ten simple rules for reading a scientific paper',doi:'10.1371/journal.pcbi.1008032',date:'2020-07-30',language:'en',creators:[{creatorType:'author',firstName:'Maureen A.',lastName:'Carey'},{creatorType:'author',firstName:'Kevin L.',lastName:'Steiner'},{creatorType:'author',firstName:'William A.',lastName:'Petri Jr.'}]}),d.libraryItemId);await page.evaluate(async id=>{const vault=await window.nodus.getActiveVault();await window.nodus.linkGlobalLibraryItemsToVault([id],vault.id);},d.libraryItemId);await settle(1000);},
  waitForWork:async(minutes=15)=>{let calm=0;const stop=Date.now()+minutes*60000;while(Date.now()<stop){const q=await page.evaluate(()=>window.nodus.getQueue());const active=(q.items??[]).filter(i=>['queued','running'].includes(i.state));if(!active.length)calm++;else calm=0;if(calm>=20)return;await settle(3000);}throw new Error('Real task queue did not become idle');},
  finish:async(label)=>{await wait(s=>s.academicPracticeSession?.phase==='complete',label,30000);await save(label);},
  fill:async(sel,text)=>{const input=page.locator(sel).first();await input.click();await input.fill(text);},
 };
}

export async function withKey(run){const dir=await mkdtemp(path.join(os.tmpdir(),'nodus-video-credential-'));const file=path.join(dir,'keys.json');await writeFile(file,JSON.stringify({openrouter:(await readFile(path.join(os.homedir(),'.config/nodus/openrouter.key'),'utf8')).trim()}),{mode:0o600});process.env.NODUS_HARNESS_KEYS_FILE=file;process.env.NODUS_AUDIT_OPENROUTER_PROVIDER='AkashML';try{return await run();}finally{await rm(dir,{recursive:true,force:true});}}
