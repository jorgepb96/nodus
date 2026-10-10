import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire, Module } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

// Real React interactions and gesture geometry. Native keyboard/menu behaviour
// and visual acceptance must also run in WebKit on iOS.
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://phone.test', pretendToBeVisual: true });
for (const name of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Element','Node','Event','MouseEvent','KeyboardEvent','MutationObserver','DOMRect','localStorage'])
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.HTMLElement.prototype.scrollTo = function() {};
const require = createRequire(import.meta.url), React = require('react'), { createRoot } = require('react-dom/client');
const fixture = await build({ stdin: { contents: `export {NodeDetailPanel} from './src/components/NodeDetailPanel'; export {ArgumentMapCanvas} from './src/components/argumentMap/ArgumentMapCanvas'; export {ResearchAssistantModal} from './src/views/ResearchAssistantModal'; export {DEFAULT_APP_SETTINGS} from './shared/defaultAppSettings'; export {setActiveLang} from './src/i18n'; export {installMobileKeyboard} from './src/mobileWeb/mobileKeyboard'; export * from './shared/touchCamera';`, resolveDir: process.cwd(), loader:'ts' }, bundle:true, write:false, platform:'node', format:'cjs', jsx:'automatic', external:['react','react/jsx-runtime','react-dom','react-dom/client'],loader:{'.css':'empty','.svg':'dataurl'} });
const module = new Module(path.join(process.cwd(),'scripts','phone-interactions-fixture.cjs')); module.paths=Module._nodeModulePaths(process.cwd()); module._compile(fixture.outputFiles[0].text,module.id);
const {NodeDetailPanel,ArgumentMapCanvas,ResearchAssistantModal,DEFAULT_APP_SETTINGS,setActiveLang,installMobileKeyboard,touchPair,pinchTranslation,pinchWorldCamera}=module.exports;
setActiveLang('es'); after(()=>dom.window.close());

async function mount(Component, props, device='phone') {
  localStorage.clear(); window.nodusMobileConfig={device};
  window.nodus=new Proxy({}, {get(_,method) {
    if (String(method).startsWith('on')) return ()=>()=>{};
    if (method==='getSettings') return async()=>DEFAULT_APP_SETTINGS;
    if (method==='getResearchSystemPrompts') return async()=>({prompts:[],selectedId:null});
    if (method==='getActiveVault') return async()=>({id:'bound-vault',type:'academic'});
    return async()=>[];
  }});
  const container=document.getElementById('root'),root=createRoot(container);
  await React.act(async()=>root.render(React.createElement(Component,props)));
  return {container,async close(){await React.act(async()=>root.unmount());}};
}

test('phone graph/argument details occupy a modal sheet and restore the existing canvas on close',async()=>{
  let closed=0;
  const props={ideaDetail:null,edgeDetail:null,loading:{kind:'idea',id:'idea-a',label:'Idea de prueba'},width:384,fontSize:14,onWidthChange:()=>{throw Error('must not resize');},onFontChange:()=>{},onClose:()=>closed++};
  const view=await mount(NodeDetailPanel,props);
  try {
    assert.equal(view.container.querySelector('.graph-detail-panel'),null,'a phone detail must not take a sidebar column');
    const sheet=document.querySelector('[role="dialog"][aria-label="Idea de prueba"]'); assert.ok(sheet);
    assert.equal(view.container.inert,true,'the covered canvas cannot receive gestures');
    assert.equal(document.activeElement,sheet.querySelector('[data-sheet-close]'));
    await React.act(async()=>sheet.querySelector('[data-sheet-close]').click()); assert.equal(closed,1);
  } finally {await view.close();}
  assert.equal(document.getElementById('root').inert,false);
});

test('tablet keeps the shared desktop detail column',async()=>{
  const view=await mount(NodeDetailPanel,{ideaDetail:null,edgeDetail:null,loading:{kind:'idea',id:'a',label:'Idea'},width:384,fontSize:14,onWidthChange:()=>{},onFontChange:()=>{},onClose:()=>{}},'tablet');
  try {assert.ok(view.container.querySelector('.graph-detail-panel'));assert.equal(document.querySelector('.nodus-mobile-sheet'),null);} finally {await view.close();}
});

test('a dense phone argument map opens with a readable central card instead of fitting every branch', async()=>{
  const originalObserver=globalThis.ResizeObserver;
  globalThis.ResizeObserver=class {
    constructor(callback){this.callback=callback;}
    observe(){this.callback([{contentRect:{width:390,height:550}}]);}
    disconnect(){}
  };
  const root={id:'root',ideaId:'idea-root',label:'Idea central',statement:'Una afirmación con fuentes.',type:'claim',relation:'root',children:Array.from({length:12},(_,index)=>({id:`branch-${index}`,ideaId:`idea-${index}`,label:`Rama ${index}`,statement:'Otra afirmación.',type:'claim',relation:'supports',children:[]}))};
  const props={map:{root,seedLabel:root.label,ideaCount:13,overview:'Resumen del recorrido.'},onSelect:()=>{},fullscreen:false,onToggleFullscreen:()=>{},fullscreenError:false};
  const scale=container=>Number(container.querySelector('.argument-world').style.transform.match(/scale\(([^)]+)\)/)[1]);
  try {
    const phone=await mount(ArgumentMapCanvas,props);
    try {
      assert.ok(scale(phone.container)>=.85,'the first phone view must let the central card be read');
      assert.equal(phone.container.querySelector('.argument-phone-summary').open,false,'the overview can be opened without occupying the canvas initially');
      const zoomIn=phone.container.querySelector('button[aria-label="Acercar"]');
      for(let i=0;i<4;i++)await React.act(async()=>zoomIn.click());
      assert.equal(scale(phone.container),1.8,'manual zoom reaches its supported upper limit');
      const reset=[...phone.container.querySelectorAll('button')].find(button=>button.textContent==='Volver al inicio');
      await React.act(async()=>reset.click());
      assert.ok(scale(phone.container)<=1.1,'returning to the beginning must reset the phone camera to its readable initial scale');
      const automatic=phone.container.querySelector('[role="switch"]');
      await React.act(async()=>automatic.click());
      assert.equal(automatic.getAttribute('aria-checked'),'false');
      const previous=phone.container.querySelector('.argument-world').style.transform;
      await React.act(async()=>phone.container.querySelector('.argument-node-content').click());
      assert.equal(phone.container.querySelector('.argument-world').style.transform,previous,
        'manual selection must preserve the explored camera when automatic zoom is disabled');
    } finally {await phone.close();}
    const tablet=await mount(ArgumentMapCanvas,props,'tablet');
    try {assert.ok(scale(tablet.container)<.5,'the tablet keeps its existing full-map overview');assert.equal(tablet.container.querySelector('.argument-phone-summary'),null);} finally {await tablet.close();}
  } finally {globalThis.ResizeObserver=originalObserver;}
});

test('phone chat history opens separately, preserves the draft, and leaves the model and composer visible',async()=>{
  const view=await mount(ResearchAssistantModal,{settings:DEFAULT_APP_SETTINGS,embedded:true,isAcademic:true});
  const removeKeyboard=installMobileKeyboard(document);
  try {
    const history=document.querySelector('[role="dialog"][aria-label="Historial de chats"]').parentElement;
    assert.equal(history.hidden,true);
    const input=view.container.querySelector('textarea'); assert.ok(input);
    await React.act(async()=>input.click()); await Promise.resolve(); assert.equal(document.activeElement,input);
    const draft='Una pregunta sin enviar\ncon dos líneas';
    await React.act(async()=>{
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(input,draft);
      input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    });
    const enter=new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});input.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented,false,'Return on the iPhone keyboard writes a newline, sending uses the explicit button');
    assert.ok(view.container.querySelector('.research-assistant-header select'));
    await React.act(async()=>view.container.querySelector('[data-testid="research-history-toggle"]').click());
    assert.equal(history.hidden,false); assert.equal(view.container.inert,true);
    await React.act(async()=>history.querySelector('[data-sheet-close]').click());
    assert.equal(history.hidden,true); assert.equal(view.container.inert,false);
    assert.equal(input.value,draft,'opening and dismissing history must not replace the composer or lose its unsent text');
    const options=[...view.container.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='Opciones');
    await React.act(async()=>options.click());
    assert.equal(document.querySelector('[role="dialog"][aria-label="Opciones"]').parentElement.hidden,false);
  } finally {removeKeyboard();await view.close();}
});

test('pinch keeps the argument point beneath the fingers while panning and clamps magnification',()=>{
  const camera={x:20,y:40,zoom:.5},start=touchPair({x:100,y:120},{x:200,y:120}),next=touchPair({x:80,y:160},{x:280,y:160});
  const result=pinchTranslation(camera,start,next);
  assert.equal(result.zoom,1);
  assert.equal((start.x-camera.x)/camera.zoom,(next.x-result.x)/result.zoom);
  assert.equal((start.y-camera.y)/camera.zoom,(next.y-result.y)/result.zoom);
  assert.equal(pinchTranslation(camera,start,{...next,distance:1e9}).zoom,1.8);
});

test('pinch preserves the graph world coordinate on a portrait viewport',()=>{
  const camera={x:50,y:90,zoom:.8},size={w:390,h:700},start=touchPair({x:80,y:180},{x:180,y:180}),next=touchPair({x:40,y:220},{x:240,y:220});
  const result=pinchWorldCamera(camera,start,next,size);
  assert.equal(camera.x+(start.x-size.w/2)/camera.zoom,result.x+(next.x-size.w/2)/result.zoom);
  assert.equal(camera.y+(start.y-size.h/2)/camera.zoom,result.y+(next.y-size.h/2)/result.zoom);
});
