import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
const paletteModule = await build({entryPoints:['shared/vaultColors.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {VAULT_TYPE_COLORS} = await import('data:text/javascript;base64,'+Buffer.from(paletteModule.outputFiles[0].text).toString('base64'));
const output = 'artifacts/research-attachments'; await fs.mkdir(output,{recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const fixtures = [
  {id:'docx',name:'Informe de investigación.docx',size:28450,kind:'text',textChars:4300,imageCount:0},
  {id:'pdf',name:'Fuentes históricas.pdf',size:342190,kind:'pdf',textChars:8210,imageCount:4},
  {id:'xlsx',name:'Censo de población.xlsx',size:18422,kind:'text',textChars:2100,imageCount:0},
  {id:'image',name:'Mapa de Madrid.png',size:140844,kind:'image',textChars:0,imageCount:1},
  {id:'csv',name:'Resultados.csv',size:3142,kind:'text',textChars:3100,imageCount:0},
];
async function setup(view,theme='light',vault) {
  await page.goto(`http://127.0.0.1:5198/visual-tests/research-assistant-harness.html?view=${view}&theme=${theme}${vault ? `&vault=${vault}` : ''}`);
  await page.evaluate(()=>localStorage.clear());await page.reload();
  await page.evaluate(files=>{
    window.attachmentPickOwners=[];window.attachmentRemoved=[];window.attachmentSaves=[];window.attachmentStore={};
    window.nodus.pickResearchAttachments=async owner=> { window.attachmentPickOwners.push(owner); const list=files.map(file=>({...file}));window.attachmentStore[owner.conversationId]=list;return {attachments:list,errors:[]}; };
    window.nodus.listResearchAttachments=async owner=>window.attachmentStore[owner.conversationId]??[];
    window.nodus.removeResearchAttachment=async(owner,id)=>{window.attachmentRemoved.push(id);window.attachmentStore[owner.conversationId]=window.attachmentStore[owner.conversationId].filter(file=>file.id!==id);};
    window.nodus.saveResearchAttachment=async(owner,id)=>window.attachmentSaves.push({owner,id});
  },fixtures);
}
try {
  for(const view of ['embedded','database','study','teaching','world']) {
    await setup(view);
    const input=page.locator('.research-composer-input');const add=page.getByRole('button',{name:'Añadir archivos',exact:true});
    assert.equal(await add.count(),1);const buttonBounds=await add.boundingBox();const inputBounds=await input.boundingBox();assert.ok(buttonBounds.x<inputBounds.x,'plus precedes textarea inside textbox');
    await add.click();await page.waitForFunction(()=>document.querySelectorAll('.research-composer-shell .research-attachment').length===5);
    assert.equal(await page.locator('.research-composer-shell .research-attachment').count(),5);
    await page.getByRole('button',{name:'Quitar adjunto: Resultados.csv',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.attachmentRemoved),['csv']);
    if(view==='embedded') {
      await input.fill('Compara el informe con el censo y explica qué aporta el mapa.');
      await page.screenshot({animations:'disabled',path:`${output}/composer-light.png`});
    }
    // Files alone are a valid first turn, even with no native source selected.
    if(view!=='embedded') {
      await page.getByTestId('research-context-toggle').click();
      if(view==='database')await page.getByLabel('Base seleccionada',{exact:true}).uncheck();
      else await page.getByTestId('research-context-sidebar').locator('select').selectOption('manual');
      await page.getByTestId('research-context-toggle').click();
    }
    await page.getByRole('button',{name:'Enviar',exact:true}).click();
    await page.waitForFunction(()=>window.requests.length===1 && !document.querySelector('.research-composer-stop'));
    const request=await page.evaluate(()=>window.requests[0]);assert.deepEqual(request.attachmentIds,['docx','pdf','xlsx','image']);
    assert.equal(await page.locator('.research-composer-shell .research-attachment').count(),0);
    assert.equal(await page.locator('[data-message-id] .research-attachment').count(),4);
    await page.getByRole('button',{name:'Regenerar respuesta',exact:true}).click();
    await page.waitForFunction(()=>window.requests.length===2 && !document.querySelector('.research-composer-stop'));
    assert.deepEqual(await page.evaluate(()=>window.requests[1].attachmentIds),request.attachmentIds,'regeneration keeps file references');
    if (!(await page.getByTestId('research-history-sidebar').isVisible())) await page.getByTestId('research-history-toggle').click();
    await page.getByRole('button',{name:'Nueva conversación',exact:true}).last().click();
    assert.equal(await page.locator('.research-attachment').count(),0);
    const history=page.getByTestId('research-history-sidebar');
    await history.locator('[data-testid^="research-conversation-"]').first().click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-message-id] .research-attachment').length===4);
    assert.equal(await page.locator('.research-composer-shell .research-attachment').count(),0,'saved files are not re-added as drafts');
    await page.getByRole('button',{name:/Informe de investigación.docx/}).click();assert.equal(await page.evaluate(()=>window.attachmentSaves[0].id),'docx');
    await input.fill('Continúa con los mismos archivos.');await input.press('Enter');
    await page.waitForFunction(()=>window.requests.length===3 && !document.querySelector('.research-composer-stop'));
    assert.deepEqual(await page.evaluate(()=>window.requests[2].attachmentIds),request.attachmentIds,'reopened conversation resends original file references');
    await history.locator('[data-testid^="research-conversation-"]').first().getByRole('button',{name:'Más acciones'}).click();await page.getByRole('menuitem',{name:'Eliminar',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Eliminar',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-message-id]').length===0);
  }
  // Native File paths are resolved by the existing Electron preload bridge.
  // Fixture IPC here isolates real browser drag events and React state handling.
  for (const theme of ['light', 'dark']) for (const view of ['embedded','database','study','teaching','world','modal']) {
    await setup(view, theme, theme === 'light' ? 'estudio' : 'genealogy');
    await page.evaluate(files => {
      window.attachmentDropCalls = [];
      window.nodus.getPathForDroppedFile = file => `/fixture/${file.name}`;
      window.nodus.importResearchAttachments = async (owner, paths) => {
        window.attachmentDropCalls.push({owner, paths});
        await new Promise(resolve => { window.finishDrop = resolve; });
        const result = files.map(file => ({...file}));
        window.attachmentStore[owner.conversationId] = result;
        return { attachments: result, errors: [] };
      };
    }, fixtures);
    const surface = page.getByRole(view === 'modal' ? 'dialog' : 'region', {name:'Research chat',exact:true});
    const transfer = await page.evaluateHandle(files => {
      const data = new DataTransfer();
      for (const file of files) data.items.add(new File(['fixture'], file.name));
      return data;
    }, fixtures);
    const textTransfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData('text/plain','Selected text'); return data; });
    await surface.dispatchEvent('dragenter', {dataTransfer:textTransfer});
    assert.equal(await page.locator('.research-file-drop-overlay').count(), 0, 'text drags stay untouched');
    await surface.dispatchEvent('drop', {dataTransfer:textTransfer});
    assert.equal(await page.evaluate(()=>window.attachmentDropCalls.length),0);
    await surface.dispatchEvent('dragenter', {dataTransfer:transfer});
    await page.locator('.research-file-drop-overlay').waitFor();
    const input = page.locator('.research-composer-input');
    await input.dispatchEvent('dragenter',{dataTransfer:transfer});
    await surface.dispatchEvent('dragleave',{dataTransfer:transfer});
    assert.equal(await page.locator('.research-file-drop-overlay').count(),1,'crossing children keeps drop affordance');
    await input.dispatchEvent('dragleave',{dataTransfer:transfer});
    assert.equal(await page.locator('.research-file-drop-overlay').count(),0,'leaving cancels affordance');
    await surface.dispatchEvent('dragenter',{dataTransfer:transfer});
    if(view==='embedded') await page.screenshot({animations:'disabled',path:`${output}/drop-${theme}.png`});
    await input.dispatchEvent('drop',{dataTransfer:transfer});
    await page.waitForFunction(()=>window.attachmentDropCalls.length===1);
    assert.equal(await page.locator('.research-file-drop-overlay').count(),0);
    assert.equal(await page.getByRole('button',{name:'Añadir archivos',exact:true}).isDisabled(),true);
    await surface.dispatchEvent('dragover',{dataTransfer:transfer});
    await surface.dispatchEvent('drop',{dataTransfer:transfer});
    assert.equal(await page.evaluate(()=>window.attachmentDropCalls.length),1,'busy drop cannot duplicate imports');
    assert.equal(await page.locator('.research-file-drop-overlay').count(),0);
    await page.evaluate(()=>window.finishDrop());
    await page.waitForFunction(()=>document.querySelectorAll('.research-composer-shell .research-attachment').length===5);
    const drop = await page.evaluate(()=>window.attachmentDropCalls[0]);
    assert.deepEqual(drop.paths,fixtures.map(file=>`/fixture/${file.name}`));
    assert.equal(drop.owner.surface,{embedded:'research',modal:'research',teaching:'study'}[view]??view);
    assert.equal(await page.evaluate(()=>window.attachmentPickOwners.length),0,'drop bypasses file picker');
    // Sending dropped files goes through the same request and history path.
    await page.getByRole('button',{name:'Enviar',exact:true}).click();
    await page.waitForFunction(()=>window.requests.length===1&&!document.querySelector('.research-composer-stop'));
    assert.deepEqual(await page.evaluate(()=>window.requests[0].attachmentIds),fixtures.map(file=>file.id));
    assert.equal(await page.locator('[data-message-id] .research-attachment').count(),5);
    await page.evaluate(()=> { window.nodus.getPathForDroppedFile=()=>''; });
    await surface.dispatchEvent('drop',{dataTransfer:transfer});
    await page.getByRole('alert').filter({hasText:'No se pudieron leer'}).waitFor();
    assert.equal(await page.evaluate(()=>window.attachmentDropCalls.length),1,'unreadable native file reports an error');
    await transfer.dispose(); await textTransfer.dispose();
  }
  const contrastChecks = [];
  for (const theme of ['light','dark']) for (const [vault, accent] of Object.entries(VAULT_TYPE_COLORS)) {
    const view = {estudio:'study',docencia:'teaching',databases:'database',worldbuilding:'world'}[vault] ?? 'embedded';
    await setup(view,theme,vault);
    await page.getByRole('button',{name:'Añadir archivos',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.research-composer-shell .research-attachment').length===5);
    const assertCards = async selector => {
      const styles = await page.locator(selector).first().evaluate(card => {
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
        const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
        const ratio=(a,b)=>{const l=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);const x=l(rgba(a)),y=l(rgba(b));return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
        const c=getComputedStyle(card),badge=getComputedStyle(card.querySelector('.research-attachment-type'));
        return {accent:c.getPropertyValue('--vault-accent').trim(),alpha:rgba(c.backgroundColor)[3],border:ratio(c.borderTopColor,c.backgroundColor),name:ratio(getComputedStyle(card.querySelector('strong')).color,c.backgroundColor),metadata:ratio(getComputedStyle(card.querySelector('.research-attachment-name span')).color,c.backgroundColor),badge:ratio(badge.color,badge.backgroundColor)};
      });
      assert.equal(styles.accent,accent);assert.equal(styles.alpha,255,'file cards must be opaque');
      assert.ok(styles.border>=3,`${vault}/${theme} file outline contrast ${styles.border}`);
      for(const key of ['name','metadata','badge'])assert.ok(styles[key]>=4.5,`${vault}/${theme} ${key} contrast ${styles[key]}`);
      contrastChecks.push({vault,theme,selector,...styles});
    };
    await assertCards('.research-composer-shell .research-attachment');
    await page.locator('.research-composer-input').fill('Contrasta estos documentos y resume los datos del censo.');
    await page.getByRole('button',{name:'Enviar',exact:true}).click();
    await page.waitForFunction(()=>window.requests.length===1&&!document.querySelector('.research-composer-stop'));
    await assertCards('[data-message-id] .research-attachment');
    const rgb=`rgb(${[1,3,5].map(start=>parseInt(accent.slice(start,start+2),16)).join(', ')})`;
    assert.equal(await page.locator('.research-message.research-accent-solid').evaluate(el=>getComputedStyle(el).backgroundColor),rgb);
    await page.locator('[data-message-id]').first().evaluate(el=>{for(const animation of el.getAnimations({subtree:true}))animation.finish();});
    await page.screenshot({animations:'disabled',path:`${output}/vault-${vault}-${theme}.png`});
    if ((vault==='estudio' && theme==='light') || (vault==='genealogy' && theme==='dark')) {
      await page.setViewportSize({width:620,height:820});
      await assertCards('[data-message-id] .research-attachment');
      await page.locator('.research-message.research-accent-solid').screenshot({animations:'disabled',path:`${output}/files-${vault}-${theme}.png`});
      await page.setViewportSize({width:1440,height:900});
    }

  }
  await fs.writeFile(`${output}/contrast-checks.json`,JSON.stringify(contrastChecks,null,2));
  await setup('embedded','dark');await page.getByRole('button',{name:'Añadir archivos',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.research-composer-shell .research-attachment').length===5);
  await page.locator('.research-composer-input').fill('Contrasta estos documentos y resume los datos del censo.');
  await page.screenshot({animations:'disabled',path:`${output}/composer-dark.png`});
  await page.getByRole('button',{name:'Enviar',exact:true}).click();await page.waitForFunction(()=>window.requests.length===1&&!document.querySelector('.research-composer-stop'));
  await page.locator('[data-message-id]').first().evaluate(element => { for (const animation of element.getAnimations({subtree:true})) animation.finish(); });
  await page.screenshot({animations:'disabled',path:`${output}/conversation-dark.png`});
  await page.setViewportSize({width:620,height:820});await page.getByRole('button',{name:'Añadir archivos',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.research-composer-shell .research-attachment').length===5);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  await page.screenshot({animations:'disabled',path:`${output}/composer-compact.png`});
  assert.deepEqual(errors,[]);console.log('PASS: nine canonical vault accents in light/dark, opaque cards, ≥3:1 outlines and ≥4.5:1 file text; file drops in five Research chat variants and modal (light/dark), cancelled/nested/text/busy drops, + placement, multiple files, remove, attachment-only requests, regeneration, reopen/follow-up, download/delete UI and responsive light/dark screenshots. Renderer uses fixture IPC; extraction and provider contracts are tested separately.');
} finally {await browser.close();}
