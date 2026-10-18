import {commonsFileTitle,freeImageLicense,imageMatchesQuery,stripImageMetadataHtml,webImageCaption,type CompleteGuideWebImageRequest} from '@shared/completeGuide/webImages';
import type {CompleteGuideFigure} from '@shared/completeGuide/figures';
type Call=(method:string,...args:unknown[])=>Promise<any>;
const api='https://commons.wikimedia.org/w/api.php';
/** Commons owns both discovery and licensing. Bytes are fetched and rasterized by
 * the device host; none of this consults the Mac or accepts model-invented URLs. */
export async function mobileCompleteGuideWebImages(call:Call,requests:CompleteGuideWebImageRequest[],language:string,signal:AbortSignal):Promise<CompleteGuideFigure[]> {
 const figures:CompleteGuideFigure[]=[],used=new Set<string>();
 const json=(query:Record<string,string>)=>call('mobileGuideCommonsResource',`${api}?${new URLSearchParams({action:'query',format:'json',formatversion:'2',...query})}`,'json');
 const meta=(info:any,key:string)=>typeof info.extmetadata?.[key]?.value==='string'?stripImageMetadataHtml(info.extmetadata[key].value):'';
 for(const request of requests){
  signal.throwIfAborted();
  const search=await json({generator:'search',gsrsearch:request.query,gsrnamespace:'6',gsrlimit:'4',prop:'info',inprop:'url'});
  for(const candidate of search?.query?.pages??[]){
   signal.throwIfAborted();
   const candidateUrl=candidate.fullurl??`https://commons.wikimedia.org/wiki/${encodeURIComponent(candidate.title??'')}`;
   const file=commonsFileTitle(candidateUrl);if(!file||used.has(candidateUrl))continue;
   const response=await json({prop:'imageinfo',titles:file,iiprop:'url|mime|size|extmetadata',iiurlwidth:'1200',iiextmetadatafilter:'LicenseShortName|LicenseUrl|Artist|Credit|ObjectName|ImageDescription',iiextmetadatalanguage:language,uselang:language});
   const info=response?.query?.pages?.[0]?.imageinfo?.[0];if(!info)continue;
   const license=meta(info,'LicenseShortName');if(!freeImageLicense(license))continue;
   const title=meta(info,'ObjectName')||file.replace(/^File:/,'').replace(/\.[a-z0-9]+$/i,'');
   if(!imageMatchesQuery(request.query,[candidate.title??'',title,meta(info,'ImageDescription')]))continue;
   const raster=/^image\/(png|jpe?g|gif|webp)\b/i;
   const url=info.thumburl&&raster.test(info.thumbmime??'image/png')?info.thumburl:info.url&&raster.test(info.mime??'')?info.url:null;
   if(!url||(!info.thumburl&&(info.size??0)>5*1024*1024))continue;
   const image=await call('mobileGuideCommonsResource',url,'image');signal.throwIfAborted();
   if(!image||typeof image.png!=='string'||!image.png||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<1||image.height<1)throw new Error('invalid_mobile_web_image');
   const licenseUrl=meta(info,'LicenseUrl');
   const attribution={title:title.slice(0,200),author:(meta(info,'Artist')||meta(info,'Credit')).slice(0,200),license:license.slice(0,80),...(/^https?:\/\//.test(licenseUrl)?{licenseUrl}:{}),url:typeof info.descriptionurl==='string'&&/^https:\/\/commons\.wikimedia\.org\//.test(info.descriptionurl)?info.descriptionurl:candidateUrl,site:'Wikimedia Commons'};
   used.add(candidateUrl);figures.push({itemId:request.itemId,caption:webImageCaption(request.caption,attribution),png:image.png,width:image.width,height:image.height,source:attribution.url,wholePage:false,attribution});break;
  }
 }
 return figures;
}
