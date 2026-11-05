import type {DeepResearchRequest} from '../../shared/types';
import {normalizeCompleteGuideConfig} from '../../shared/completeGuide/types';
import {completeGuideFigureKey,assertMobileCompleteGuideSource,type MobileCompleteGuideSource} from '../../shared/mobileCompleteGuide';
import {snapshotCompleteGuideSelection,listCompleteGuideCatalog,completeGuideOrganization,loadCompleteGuideTexts} from '../ai/completeGuide/sources';
import {extractCompleteGuideFigures} from '../ai/completeGuide/figures';
import {resolveCompleteGuideSelection} from '../../shared/completeGuide/selection';
import {getActiveVault} from '../vaults/vaultRegistry';
/** Explicit source preparation. No provider, indexing, extraction of text or run
 * cache is started here; only the already readable selection and its file images. */
export async function captureMobileCompleteGuide(request:DeepResearchRequest,revision:string,signal?:AbortSignal):Promise<MobileCompleteGuideSource> {
 const vault=getActiveVault();if(vault.type!=='estudio'||!request.completeGuide)throw new Error('invalid_complete_guide_source');
 const config=normalizeCompleteGuideConfig(request.completeGuide),{snapshot,organization}=snapshotCompleteGuideSelection(config);
 if(!snapshot.totals.readablePassages)throw new Error('Ninguna de las fuentes seleccionadas tiene texto legible. Indexa o prepara los materiales e inténtalo de nuevo.');
 const requests=new Map<string,Parameters<typeof extractCompleteGuideFigures>[0][number]>();
 for(const source of snapshot.sources){
  if(source.kind!=='material')continue;
  const passages=snapshot.passages.filter(passage=>passage.sourceKey===source.sourceKey);
  for(const passage of passages){
   const page=passage.locator.kind==='page'?passage.locator.page:null,slide=passage.locator.kind==='slide'?passage.locator.slide:null,key=completeGuideFigureKey(source.sourceId,page,slide);
   requests.set(key,{itemId:key,sourceKey:source.sourceKey,materialId:source.sourceId,caption:source.title,page,slide,unitKey:'download',source:''});
  }
 }
 const figures:MobileCompleteGuideSource['figures']={};
 const prepared=[...requests.values()];
 for(let offset=0;offset<prepared.length;offset+=8){
  signal?.throwIfAborted();for(const figure of await extractCompleteGuideFigures(prepared.slice(offset,offset+8),signal))figures[figure.itemId]=figure;
  if(Buffer.byteLength(JSON.stringify(figures))>12_000_000)throw new Error('deep_research_source_too_large');
 }
 const source:MobileCompleteGuideSource={version:1,kind:'completeGuide',context:{version:1,vaultId:vault.id,vaultType:vault.type,revision,sourceScope:'linked_corpus',preparedSourcesOnly:true},texts:loadCompleteGuideTexts(resolveCompleteGuideSelection(config.selection,listCompleteGuideCatalog(),organization)),selection:config.selection,frozen:{snapshot,organization,snapshotAt:new Date().toISOString()},catalog:{sources:listCompleteGuideCatalog().filter(source=>snapshot.sources.some(selected=>selected.sourceKey===source.sourceKey)),organization:completeGuideOrganization()},figures};
 assertMobileCompleteGuideSource(source,config.selection);return source;
}
