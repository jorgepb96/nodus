import type {PageDocument} from './pages';
import type {FilterNode} from './databaseQuery';

export type MobilePageDependency = {kind:'syncedBlock';id:string}|{kind:'linkedDatabase';viewId:string;localFilter:FilterNode|null};
/** Native compatibility blocks retain these exact Desktop export markers. */
export function pageCompatibilityDependency(markdown:string):MobilePageDependency|null {
  const synced=/^\s*<!-- nodus:synced ([^\s<>]+) -->\s*$/.exec(markdown);
  if(synced)return {kind:'syncedBlock',id:synced[1]};
  const view=/^\s*<!-- nodus:database-view ([^\s<>]+) -->\s*$/.exec(markdown);
  if(!view)return null;
  try{return databaseDependency(JSON.parse(decodeURIComponent(view[1])));}catch{return null;}
}
function databaseDependency(content:Record<string,unknown>):MobilePageDependency|null {
  if(typeof content.viewId!=='string'||!content.viewId)return null;
  const title=typeof content.titleFilter==='string'?content.titleFilter.trim():'';
  return {kind:'linkedDatabase',viewId:content.viewId,localFilter:title
    ? {type:'condition',columnId:'title',op:'contains',value:title}
    : content.localFilter&&typeof content.localFilter==='object'?content.localFilter as FilterNode:null};
}
export function mobilePageDependencies(document:Pick<PageDocument,'blocks'|'nativeDocument'>):MobilePageDependency[] {
  const found=new Map<string,MobilePageDependency>();
  const add=(value:MobilePageDependency|null)=>{if(value)found.set(JSON.stringify(value),value);};
  for(const block of document.blocks){
    if(block.type==='synced_block'&&typeof block.content.sourceBlockId==='string'&&block.content.sourceBlockId)add({kind:'syncedBlock',id:block.content.sourceBlockId});
    if(block.type==='database_view')add(databaseDependency(block.content));
  }
  const visit=(value:unknown)=>{
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(!value||typeof value!=='object')return;
    const object=value as Record<string,unknown>;
    if(object.type==='nodusMarkdown'&&object.props&&typeof object.props==='object'){
      const markdown=(object.props as Record<string,unknown>).markdown;if(typeof markdown==='string')add(pageCompatibilityDependency(markdown));
    }
    Object.values(object).forEach(visit);
  };
  visit(document.nativeDocument);return [...found.values()];
}
