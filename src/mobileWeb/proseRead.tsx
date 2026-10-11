import '../index.css';
import './proseRead.css';
import {useLayoutEffect,useRef,type CSSProperties} from 'react';
import {createRoot} from 'react-dom/client';
import {Markdown} from '../components/Markdown';
import {anchorFromRange,findAnchoredText,invalidateReaderTextIndex,rangeFromOffsets,readerTextIndex,type ReaderAnchor} from '../components/ReaderSelectionActions';
import {setActiveLang} from '../i18n';
import type {AppSettings} from '@shared/types';

interface Annotation extends ReaderAnchor {id:string;kind:'highlight'|'comment'|'bookmark';color:string|null}
interface Input {source:string;language:AppSettings['uiLanguage'];dark:boolean;accent:string;fontSize:number;justify:boolean;annotations:Annotation[];highlighter:string|null;search:Array<{location:number;length:number}>;activeSearch:{location:number;length:number}|null;searchAim:number;bookmarkAim:number;legacyBookmark?:{selectedText:string;startOffset:number;endOffset:number;prefix:string;suffix:string}|null}
const native=window as unknown as {webkit:{messageHandlers:{proseRead:{postMessage(value:unknown):void}}};nodusProseRender(input:Input):void;nodusProseUpdate(input:Input):void;nodusProseReply(id:string,result:unknown,error:string|null):void;nodusProseClear():void};
let sequence=0,current:Input,root:HTMLElement|null=null,searchAim=0,bookmarkAim=0,legacyMigrated=false;
const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
function send(method:string,value:unknown=null){native.webkit.messageHandlers.proseRead.postMessage({method,value});}
function call(method:string,value:unknown){return new Promise<any>((resolve,reject)=>{if(pending.size>=256){reject(new Error('Hay demasiadas imágenes cargándose.'));return;}const id=String(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(new Error('La imagen no ha respondido.'));},30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});native.webkit.messageHandlers.proseRead.postMessage({id,method,value});});}
native.nodusProseReply=(id,result,error)=>{const item=pending.get(id);if(!item)return;pending.delete(id);if(error)item.reject(new Error(error));else item.resolve(result);};
const colors:Record<string,string>={yellow:'#fde68a',rose:'#fecdd3',blue:'#bfdbfe',mint:'#bbf7d0',lavender:'#ddd6fe',peach:'#fed7aa'};
function rect(range:Range){const value=range.getBoundingClientRect();return {x:value.x,y:value.y,width:value.width,height:value.height};}
function resolve(anchor:ReaderAnchor){if(!root)return null;const direct=rangeFromOffsets(root,anchor.startOffset,anchor.endOffset);return direct?.toString()===anchor.selectedText?direct:findAnchoredText(root,anchor);}
function paint(){
  if(!root||!current)return;
  const css=CSS as unknown as {highlights?:Map<string,unknown>},Highlight=(window as any).Highlight;
  if(css.highlights&&Highlight){
    for(const [color,hex] of Object.entries(colors)){
      const ranges=current.annotations.filter(item=>item.kind==='highlight'&&item.color===color).map(resolve).filter((value):value is Range=>!!value);
      css.highlights.set('prose-'+color,new Highlight(...ranges));document.documentElement.style.setProperty('--prose-'+color,hex);
    }
    const marks=current.annotations.filter(item=>item.kind!=='highlight').map(resolve).filter((value):value is Range=>!!value);css.highlights.set('prose-marks',new Highlight(...marks));
    const found=current.search.map(item=>rangeFromOffsets(root!,item.location,item.location+item.length)).filter((value):value is Range=>!!value);css.highlights.set('prose-search',new Highlight(...found));
    const active=current.activeSearch?rangeFromOffsets(root,current.activeSearch.location,current.activeSearch.location+current.activeSearch.length):null;css.highlights.set('prose-active',new Highlight(...(active?[active]:[])));
    if(active&&current.searchAim!==searchAim){searchAim=current.searchAim;send('scroll',rect(active));}
  }
  if(current.bookmarkAim!==bookmarkAim){bookmarkAim=current.bookmarkAim;const mark=current.annotations.find(item=>item.kind==='bookmark'),range=mark&&resolve(mark);if(range)send('scroll',rect(range));}
  if(!legacyMigrated&&current.legacyBookmark){const range=resolve(current.legacyBookmark);if(range){legacyMigrated=true;send('migrateBookmark',anchorFromRange(root,range,range.toString()));}}
  root.querySelectorAll('[data-prose-marker]').forEach(node=>node.remove());
  for(const item of current.annotations.filter(item=>item.kind!=='highlight')){
    const range=resolve(item);if(!range)continue;
    const position=range.getBoundingClientRect(),offset=root.getBoundingClientRect(),button=document.createElement('button');
    button.dataset.proseMarker=item.id;button.dataset.readerIgnore='true';button.innerHTML=item.kind==='comment'?'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11a8 8 0 0 1-8 8H5l-3 3V5a3 3 0 0 1 3-3h8a8 8 0 0 1 8 9Z"/></svg>':'<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12v19l-6-4-6 4Z"/></svg>';button.setAttribute('aria-label',item.kind==='comment'?'Abrir comentario':'Marcador de lectura');button.style.top=Math.max(0,position.top-offset.top)+'px';button.addEventListener('click',()=>send('annotation',item.id));root.append(button);
  }
}
let heightFrame=0;
function measure(){cancelAnimationFrame(heightFrame);heightFrame=requestAnimationFrame(()=>{if(root)send('height',Math.ceil(root.getBoundingClientRect().height));});}
let selectionTimer:ReturnType<typeof setTimeout>|undefined;
document.addEventListener('selectionchange',()=>{clearTimeout(selectionTimer);selectionTimer=setTimeout(()=>{
  if(!root)return;const selection=getSelection();if(!selection||selection.rangeCount===0||selection.isCollapsed){send('selection',null);return;}
  const range=selection.getRangeAt(0);if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return;
  const fragment=range.cloneContents();fragment.querySelectorAll('[data-reader-ignore]').forEach(node=>node.remove());const text=fragment.textContent??'';if(!text.trim())return;
  const anchor=anchorFromRange(root,range,text);if(anchor.endOffset-anchor.startOffset!==text.length)return;
  send('selection',{anchor,rect:rect(range)});
},220);});
native.nodusProseClear=()=>getSelection()?.removeAllRanges();
const link=(host:string,id:string,query?:Record<string,number|null|undefined>)=>{const url=new URL(`nodus://${host}/${encodeURIComponent(id)}`);for(const [key,value] of Object.entries(query??{}))if(value!=null)url.searchParams.set(key,String(value));send('open',url.href);};

/** Only standalone image tags are converted; arbitrary HTML never executes. */
function imageMarkdown(source:string){let fence:string|null=null;return source.split('\n').map(line=>{
  const match=/^\s*(`{3,}|~{3,})/.exec(line);if(match){if(fence&&match[1][0]===fence[0]&&match[1].length>=fence.length)fence=null;else if(!fence)fence=match[1];return line;}if(fence||/^ {4}|^\t/.test(line))return line;
  return line.replace(/<img\b([^<>]*)\/?\s*>/gi,(_tag,attributes:string)=>{
    const attr=(name:string)=>new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'=<>`]+))','i').exec(attributes);
    const src=attr('src'),alt=attr('alt');if(!src)return '';
    const decode=(text:string)=>text.replace(/&(?:amp|quot|apos|lt|gt);/g,entity=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}[entity]!));
    const target=decode(src[1]??src[2]??src[3]??'');if(/[<>\n\r]/.test(target))return '';return '!['+decode(alt?.[1]??alt?.[2]??alt?.[3]??'').replace(/[\\\[\]]/g,'\\$&')+'](<'+target+'>)';
  });
}).join('\n');}
function Document({input}:{input:Input}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    root=ref.current;if(!root)return;legacyMigrated=false;searchAim=0;bookmarkAim=0;
    root.querySelectorAll('.katex-mathml').forEach(node=>node.setAttribute('data-reader-ignore','true'));
    root.querySelectorAll('table').forEach(table=>{const heads=Array.from(table.querySelectorAll('thead th'));if(heads.length>3)table.dataset.mobileColumns=String(heads.length);table.querySelectorAll('tbody tr').forEach(row=>row.querySelectorAll('td').forEach((cell,index)=>cell.setAttribute('data-column-label',heads[index]?.textContent??String(index+1))));});
    invalidateReaderTextIndex(root);send('text',readerTextIndex(root).content);paint();measure();
    const resize=new ResizeObserver(measure);resize.observe(root);
    root.querySelectorAll('img').forEach(image=>{
      const source=image.getAttribute('src');if(!source)return;image.removeAttribute('src');image.dataset.proseSource=source;
      void call('image',source).then(value=>{if(!image.isConnected)return;image.src=`data:${value.mime};base64,${value.data}`;image.addEventListener('click',()=>send('openImage',{source,title:image.alt}));image.setAttribute('tabindex','0');image.setAttribute('role','button');image.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();send('openImage',{source,title:image.alt});}});}).catch(error=>{if(image.isConnected){const label=document.createElement('button');label.dataset.readerIgnore='true';label.className='prose-image-error';label.textContent=`${image.alt||'Imagen'}: ${error.message}. Reintentar`;label.onclick=()=>{label.remove();void call('image',source).then(value=>{image.src=`data:${value.mime};base64,${value.data}`;image.onclick=()=>send('openImage',{source,title:image.alt});}).catch(error=>send('issue',error.message));};image.after(label);}measure();});
    });
    const clicked=(event:MouseEvent)=>{
      if((event.target as HTMLElement).closest('button,img'))return;
      const node=(event.target as HTMLElement).closest('a');
      if(node){const href=node.getAttribute('href');if(!href)return;event.preventDefault();if(href.startsWith('#')){const target=document.getElementById(decodeURIComponent(href.slice(1)));if(target)send('scroll',target.getBoundingClientRect().toJSON());}else send('open',href);return;}
      if(!getSelection()?.isCollapsed)return;
      const caret=document.caretRangeFromPoint?.(event.clientX,event.clientY);if(!caret)return;
      for(const item of current.annotations.filter(item=>item.kind==='highlight')){const range=resolve(item);if(range?.isPointInRange(caret.startContainer,caret.startOffset)){send('highlight',{id:item.id,rect:rect(range)});return;}}
    };root.addEventListener('click',clicked);
    return()=>{resize.disconnect();root?.removeEventListener('click',clicked);root=null;};
  },[input.source]);
  return <div ref={ref} className="prose-document" style={{fontSize:input.fontSize+'px',textAlign:input.justify?'justify':'start'} as CSSProperties}><Markdown content={imageMarkdown(input.source)} verify={false} allowDataImages localReaderImages
    onCitation={ref=>link(ref.kind,ref.id)} onWorldEntry={(kind,id)=>link('world/'+kind,id)}
    onStudyEvidence={id=>link('study/evidence',id)} onStudyDocument={(id,where)=>link('study/doc',id,{from:where?.from})}
    onStudyMaterial={(id,where)=>link('study/material',id,{page:where?.pageNumber,slide:where?.slideNumber})}
    onStudyRecording={(id,time)=>link('study/recording',id,{t:time})}/></div>;
}
const renderer=createRoot(document.getElementById('root')!);
function configure(input:Input){current=input;document.documentElement.classList.toggle('dark',input.dark);document.documentElement.style.setProperty('--prose-accent',input.accent);setActiveLang(input.language);}
native.nodusProseRender=input=>{configure(input);renderer.render(<Document input={input}/>);};
native.nodusProseUpdate=input=>{configure(input);renderer.render(<Document input={input}/>);requestAnimationFrame(()=>{paint();measure();});};
window.addEventListener('error',event=>send('issue',event.message));window.addEventListener('unhandledrejection',event=>send('issue',String(event.reason?.message??event.reason)));
