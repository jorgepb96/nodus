import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright-core';
const require = createRequire(import.meta.url), root = path.resolve(new URL('..', import.meta.url).pathname);
const profile = await mkdtemp(path.join(os.tmpdir(), 'nodus-scriptor-actions-')), output = path.join(root, 'output/qa/scriptor-actions');
await mkdir(output, { recursive: true });
const env = {...process.env, NODUS_USERDATA:profile, NODUS_DISABLE_AUTO_UPDATE:'1', NODUS_E2E_UPDATE_STATUS:'not-available', NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI:'1'};
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
let app, page; const errors = [], screenshots = [];
try {
  app = await electron.launch({executablePath:require('electron'),args:[root],env}); page = await app.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.nodus && document.getElementById('root')?.children.length));
  await page.evaluate(async version => {
    for (const [key,value] of Object.entries({'nodus.lastSeenVersion':version,'nodus.platformHighlightsSeen.2026-07':'1','nodus.toolkitBetaGuideSeen.2.4.0':'1','nodus.tutorialVideosAnnouncementSeen.2026-07':'1','nodus.pdfPresenterTutorialSeen.e2js_u-05OA':'1','nodus.mobileTeaserSeen.3.2.4':'1'})) localStorage.setItem(key,value);
    sessionStorage.setItem('nodus.startupUpdateChecked','1');localStorage.setItem('nodus.sidebarWidth','246');
    await window.nodus.setResearchPreparationPolicy({welcomeVersion:1});
    await window.nodus.updateSettings({onboardingComplete:true,basicsTutorialVersion:999,recoverySetupVersion:999,tourComplete:true,advancedTourComplete:true,uiLanguage:'es',theme:'light',mascotEnabled:false,reduceMotion:true,academicMode:'manual'});
  },require('../package.json').version);
  await page.reload(); await page.getByTestId('app-shell').waitFor();
  const fixture = await page.evaluate(async () => {
    const folder = await window.nodus.createNoteFolder({name:'Tesis · Escritura y fuentes'});
    const note = await window.nodus.createNote({title:'La escritura académica y sus fuentes',content:'',folderId:folder.id});
    const props={textAlignment:'left',textColor:'default',backgroundColor:'default'};
    const native=[
      {id:'intro',type:'heading',props:{...props,level:2,isToggleable:false},content:[{type:'text',text:'La memoria del paisaje',styles:{}}],children:[]},
      {id:'first',type:'paragraph',props,content:[{type:'text',text:'La memoria del paisaje se sostiene en las fuentes.',styles:{}}],children:[]},
      {id:'second',type:'paragraph',props,content:[{type:'text',text:'La memoria del paisaje requiere contrastar cada interpretación con el archivo.',styles:{}}],children:[]},
      {id:'end',type:'paragraph',props:{...props,nodusEvidence:'keep'},content:[{type:'text',text:'Cada documento conserva la relación entre investigación, análisis y escritura.',styles:{italic:true}}],children:[]}
    ];
    await window.nodus.updateWorkspaceNote(note.id,{title:note.title,contentMarkdown:'',nativeDocument:native});
    const prompt=await window.nodus.createStudyStyle({name:'Revisión de la selección',prompt:'Conserva las fuentes y mejora la precisión.',icon:'sparkles',active:true});
    return {noteId:note.id,promptId:prompt.id,vault:(await window.nodus.getActiveVault()).id};
  });
  await page.locator('[data-tour="nav-workspace"]').click(); await page.getByTestId('workspace-item-'+fixture.noteId).click();
  const editor=page.locator('.nodus-blocknote .bn-editor');await editor.waitFor();
  const warning=page.getByTestId('backup-health-banner').getByRole('button',{name:'Ocultar aviso'});if(await warning.isVisible().catch(()=>false))await warning.click();
  const capture=async name=>{await page.screenshot({path:path.join(output,name+'.png')});screenshots.push(name+'.png');};
  const options=page.getByRole('button',{name:'Opciones del documento',exact:true});
  const bar=page.getByRole('toolbar',{name:'Acciones del documento'});
  for(const name of ['Deshacer','Rehacer','Enlazar con Nodus','Citar fuente','Prompts de mejora','Añadir comentario','Buscar y reemplazar']) {
    const button=bar.getByRole('button',{name,exact:true});assert.ok(await button.isVisible());assert.ok(await button.getAttribute('title'));
  }
  await app.evaluate(({app,BrowserWindow})=>{app.focus({steal:true});BrowserWindow.getAllWindows()[0]?.focus();});
  const original=await page.evaluate(id=>window.nodus.getWorkspaceNoteEditorData(id),fixture.noteId);
  const select=async (id,text='La memoria del paisaje')=>{
    const inline=page.locator(`[data-id="${id}"] .bn-inline-content`);await inline.click();
    await inline.evaluate((element,text)=>{element.closest('.bn-editor').focus();const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const at=node.textContent.indexOf(text);if(at<0)continue;const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+text.length);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));return;}throw new Error('Selection fixture missing');},text);
    await page.waitForTimeout(120);await page.locator('.editorial-editor-body').dispatchEvent('mouseup');
    assert.equal(await page.evaluate(()=>window.getSelection().toString()),text);
  };
  // Toolbar comment uses the exact second occurrence and native block anchor.
  await select('second');
  const formatting=page.locator('.bn-formatting-toolbar');await formatting.waitFor();
  const formatButtons=formatting.locator('button:not(:disabled):not([data-testid=study-selection-improve]):is([aria-label],[title])');
  for(let i=0;i<await formatButtons.count();i++){await page.mouse.move(10,100);await formatButtons.nth(i).hover();await page.locator('[role=tooltip]:visible').first().waitFor({timeout:3000});await page.waitForTimeout(150);assert.equal(await page.locator('[role=tooltip]:visible').count(),1,'single contextual formatting tooltip: '+await formatButtons.nth(i).getAttribute('aria-label')); }
  await capture('formatting-single-tooltip');await page.mouse.move(10,100);
  await bar.getByRole('button',{name:'Añadir comentario',exact:true}).click();
  const comment=page.getByTestId('study-comment-dialog');await comment.waitFor();
  await comment.getByRole('textbox').fill('Comprobar esta segunda afirmación.');await comment.getByRole('button',{name:'Guardar',exact:true}).click();
  await comment.waitFor({state:'hidden'});
  const annotated=await page.evaluate(id=>window.nodus.getWorkspaceNoteEditorData(id),fixture.noteId);
  const annotation=annotated.annotations.at(-1);assert.equal(annotation.selectedText,'La memoria del paisaje');assert.equal(annotation.anchor.blockId,'second');
  assert.equal(annotation.from,annotated.contentMarkdown.indexOf('La memoria del paisaje',annotated.contentMarkdown.indexOf('La memoria del paisaje',annotated.contentMarkdown.indexOf('La memoria del paisaje')+1)+1));
  assert.deepEqual(annotated.nativeDocument,original.nativeDocument,'comment does not change native text');
  // Opening the overflow then clicking an action keeps the selected range, even after keyboard focus moves.
  await select('second');await options.click();await page.getByRole('button',{name:'Vincular evidencia',exact:true}).focus();await page.keyboard.press('Enter');
  const academic=page.locator('.academic-dialog');await academic.waitFor();assert.ok(await academic.getByRole('button',{name:'Guardar marca',exact:true}).isEnabled());
  await academic.getByRole('button',{name:'Guardar marca',exact:true}).click();await academic.waitFor({state:'hidden'});
  await page.keyboard.press('Meta+s');await page.waitForTimeout(1000);
  const evidenced=await page.evaluate(id=>window.nodus.getWorkspaceNoteEditorData(id),fixture.noteId);assert.equal(evidenced.academicMetadata.evidence.at(-1).blockId,'second');assert.equal(evidenced.academicMetadata.evidence.at(-1).text,'La memoria del paisaje');
  // Pin/unpin stays in the menu and persists independently of the document.
  await options.click();const readPin=page.getByRole('button',{name:'Fijar en la barra: Lectura por voz',exact:true});await readPin.hover();await page.waitForTimeout(700);assert.equal(await page.locator('[role=tooltip]:visible').count(),1,'single pin tooltip');await readPin.click();assert.ok(await page.locator('.editorial-editor-header .editorial-options').getAttribute('open')!==null);
  assert.ok(await bar.getByTestId('study-audio-toggle').isVisible());
  await page.getByRole('button',{name:'Fijar en la barra: Vincular evidencia',exact:true}).click();
  await page.getByRole('button',{name:'Fijar en la barra: Fórmula en línea',exact:true}).click();
  assert.deepEqual(await page.evaluate(vault=>JSON.parse(localStorage.getItem('nodus.workspacePreferences.'+vault)).pinnedActionIds,fixture.vault),['read','evidence','formula']);
  await page.keyboard.press('Escape');
  for(const id of ['read','evidence','formula']){await page.mouse.move(10,100);await bar.locator(`[data-editorial-action="${id}"]`).hover();await page.waitForTimeout(700);assert.equal(await page.locator('[role=tooltip]:visible').count(),1,'single pinned action tooltip');}
  await page.mouse.move(10,100);
  await select('second');await bar.getByTestId('study-audio-toggle').click();assert.match(await page.getByTestId('study-audio-panel').innerText(),/selección/i);
  await bar.getByTestId('study-audio-toggle').click();
  // A formatting command from overflow formats only the selected second occurrence.
  await select('second');await options.click();await page.getByTestId('study-inline-code').click();
  assert.equal(await page.locator('[data-id="second"] code').innerText(),'La memoria del paisaje');assert.equal(await page.locator('[data-id="first"] code').count(),0);
  await bar.getByTestId('study-editor-undo').click();assert.equal(await page.locator('[data-id="second"] code').count(),0);
  // AI transport alone is mocked; real UI, editor, storage, streaming and undo run normally.
  await app.evaluate(({ipcMain})=>{
    globalThis.scriptorActionRequests=[];const requests=globalThis.scriptorActionRequests;ipcMain.removeHandler('study:improve');ipcMain.removeHandler('study:improve:action');
    ipcMain.handle('study:improve',async(event,id,request)=>{requests.push(request);const text='La memoria documentada del paisaje';for(const delta of ['La memoria ','documentada del paisaje']){await new Promise(resolve=>setTimeout(resolve,200));event.sender.send('study:improve:delta',id,delta);}await new Promise(resolve=>setTimeout(resolve,500));return {logId:'qa-actions',text,styleId:request.styleId,warnings:[],protectedSpanCount:0,modelProvider:'qa',modelName:'controlled',originalHash:'',resultHash:'',estimatedInputTokens:5,estimatedOutputTokens:5};});ipcMain.handle('study:improve:action',async()=>undefined);
  });
  await select('second');await options.click();await bar.getByTestId('study-improve-toggle').click();
  const prompts=page.getByTestId('study-improve-dialog');await prompts.waitFor();await page.getByTestId('study-style-'+fixture.promptId).click();await page.getByTestId('study-prompt-apply').click();
  await page.getByTestId('scriptor-ai-send').click();await page.getByTestId('scriptor-ai-accept').click();await page.getByTestId('study-improve-complete').waitFor();assert.deepEqual(await app.evaluate(()=>globalThis.scriptorActionRequests.map(request=>({text:request.text,scope:request.scope}))),[{text:'La memoria del paisaje',scope:'selection'}]);
  assert.match(await page.locator('[data-id="second"] .bn-inline-content').innerText(),/La memoria documentada del paisaje/);assert.match(await page.locator('[data-id="first"] .bn-inline-content').innerText(),/^La memoria del paisaje/);
  await page.getByTestId('study-improve-undo').click();await page.keyboard.press('Meta+s');await page.waitForTimeout(1000);
  assert.deepEqual((await page.evaluate(id=>window.nodus.getWorkspaceNoteEditorData(id),fixture.noteId)).nativeDocument,original.nativeDocument,'one-step undo restores IDs, rich text and custom properties');
  // Markdown mode keeps textarea offsets through overflow and comments.
  await options.click();await page.getByRole('button',{name:'Markdown crudo',exact:true}).click();
  const raw=page.getByTestId('study-markdown-editor');await raw.waitFor();
  const rawRange=await raw.evaluate(element=>{element.focus();const from=element.value.lastIndexOf('La memoria del paisaje');element.setSelectionRange(from,from+'La memoria del paisaje'.length);return from;});
  await options.click();await bar.getByRole('button',{name:'Añadir comentario',exact:true}).click();await comment.getByRole('textbox').fill('Comentario exacto desde Markdown.');await comment.getByRole('button',{name:'Guardar',exact:true}).click();await comment.waitFor({state:'hidden'});
  const rawAnnotation=(await page.evaluate(id=>window.nodus.getWorkspaceNoteEditorData(id),fixture.noteId)).annotations.at(-1);assert.equal(rawAnnotation.from,rawRange);assert.equal(rawAnnotation.selectedText,'La memoria del paisaje');
  await options.click();await page.getByRole('button',{name:'Markdown crudo',exact:true}).click();await editor.waitFor();
  // Tabs and header remain stable when pins change; all surfaces and tooltips fit.
  const headerY=(await page.locator('.editorial-editor-header').boundingBox()).y;
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>window.nodus.updateSettings({theme}),theme);
    for(const [width,height] of [[1280,800],[1440,900],[1920,1080],[900,700],[600,800]]) {
      await page.setViewportSize({width,height});await page.locator('[data-id="end"] .bn-inline-content').click();await page.keyboard.press('ArrowRight');
      assert.equal((await page.locator('.editorial-editor-header').boundingBox()).y,headerY);
      assert.ok(await bar.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      for(const button of await bar.getByRole('button').all()){const box=await button.boundingBox();const surface=await bar.boundingBox();assert.ok(box.x>=surface.x&&box.x+box.width<=surface.x+surface.width+1);}
      await capture(`${theme}-${width}-bar`);
      await options.click();const menu=page.locator('.editorial-options-panel');assert.ok(await menu.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await menu.evaluate(el=>{el.scrollTop=0;});await capture(`${theme}-${width}-menu`);await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>window.nodus.updateSettings({theme:'light'}));
  await page.mouse.move(10,100);await page.waitForTimeout(450);await page.keyboard.press('Tab');await bar.getByTestId('study-improve-toggle').focus();await page.getByRole('tooltip',{name:/Prompts de mejora/}).waitFor();await capture('keyboard-tooltip');await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Añadir comentario');await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),await bar.locator('button:not(:disabled)').first().getAttribute('aria-label'));
  await page.reload();await page.getByTestId('app-shell').waitFor();await page.locator('[data-tour="nav-workspace"]').click();await page.getByTestId('workspace-item-'+fixture.noteId).click();await editor.waitFor();assert.ok(await bar.getByTestId('study-audio-toggle').isVisible());assert.ok(await bar.locator('[data-editorial-action="evidence"]').isVisible());
  await options.click();await page.getByRole('button',{name:'Retirar de la barra: Lectura por voz',exact:true}).click();assert.equal(await bar.getByTestId('study-audio-toggle').count(),0);assert.ok(await page.getByTestId('study-audio-toggle').isVisible());
  assert.equal(await page.evaluate(()=>localStorage.getItem('nodus.sidebarWidth')),'246');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'results.json'),JSON.stringify({passed:true,errors,screenshots,checks:['7 essential actions with tooltips','single tooltip for contextual formatting buttons','single tooltip for pin and pinned buttons','single keyboard tooltip and toolbar arrow navigation','exact repeated text selection in comments','native block evidence from menu with keyboard','format selected text from overflow','AI through overflow preserves selection','controlled streaming and one-step native undo','pins persisted by vault','unpin remains usable in menu','stable header and tabs','white and dark surfaces at 5 sizes','no horizontal overflow','unchanged sidebar width']},null,2));
  await writeFile(path.join(output,'index.html'),'<!doctype html><meta charset="utf-8"><title>Scriptor · Acciones</title><style>body{font:16px system-ui;margin:32px;background:#fafafa;color:#333}img{width:100%;border:1px solid #ddd;border-radius:8px}section{margin:32px 0}h2{font-size:16px}</style><h1>Scriptor · Acciones y selección</h1>'+screenshots.map(name=>`<section><h2>${name}</h2><img src="${name}"></section>`).join(''));
  console.log('Scriptor action bar, pin persistence, exact selections, streaming, undo and visual bounds passed.');
} catch(error) {await page?.screenshot({path:path.join(output,'failure.png')});throw error;} finally {await app?.close();await rm(profile,{recursive:true,force:true});}
