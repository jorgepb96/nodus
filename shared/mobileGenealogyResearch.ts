import {PROMPT_LANGUAGES,type PromptLanguage} from './types';
import type {FamilyFacts,FocusPerson,GenSource,GenSectionInput} from './portableGenealogyDeepResearch';
import type {MobileDeepResearchProof} from './mobileDeepResearch';
import {sha256Snapshot} from './databaseResearchEngine';
export interface GenealogyResearchCapture {
 language:PromptLanguage;sources:GenSource[];family:FamilyFacts;focusPerson:FocusPerson|null;
 evidence:Array<GenSectionInput['evidence'][number]&{personId:string}>;
 selection:{retrieval:'lexical';documentLimit:number;workLimit:number;documentsConsidered:number;worksConsidered:number;worksAvailable:number;bounded:boolean};
}
export interface MobileGenealogyResearchSource extends GenealogyResearchCapture {
 version:1;kind:'genealogy';context:MobileDeepResearchProof;sourceHash:string;
}
/** The signed/linked capture carries actual prepared documents and quotations.
 * The phone never infers missing OCR, embeddings, biography or proof records. */
export function captureMobileGenealogyResearchSource(capture:GenealogyResearchCapture,context:MobileDeepResearchProof):MobileGenealogyResearchSource {
 const value:MobileGenealogyResearchSource={...structuredClone(capture),version:1,kind:'genealogy',context:{...context,preparedSourcesOnly:true},sourceHash:sha256Snapshot(capture)};
 validateMobileGenealogyResearchSource(value);return value;
}
export function validateMobileGenealogyResearchSource(value:MobileGenealogyResearchSource):void {
 if(value?.version!==1||value.kind!=='genealogy'||!value.context||value.context.version!==1||value.context.vaultType!=='genealogy'||!value.context.vaultId||!/^[a-f0-9]{64}$/.test(value.context.revision)||!['linked_corpus','device_downloads'].includes(value.context.sourceScope)||value.context.preparedSourcesOnly!==true)throw new Error('invalid_genealogy_research_context');
 const {language,sources,family,focusPerson,evidence,selection}=value;
 if(!(PROMPT_LANGUAGES as readonly unknown[]).includes(language))throw new Error('invalid_genealogy_research_language');
 if(!Array.isArray(sources)||!sources.length||sources.length>34||!family||!Array.isArray(family.personas)||!Array.isArray(family.eventos)||!Array.isArray(family.relaciones_sociales)||!Array.isArray(evidence)||!selection||selection.retrieval!=='lexical'||selection.documentLimit!==24||selection.workLimit!==10||typeof selection.bounded!=='boolean'||[selection.documentsConsidered,selection.worksConsidered,selection.worksAvailable].some(count=>!Number.isSafeInteger(count)||count<0))throw new Error('genealogy_research_sources_not_downloaded');
 const ids=new Set<string>();for(const source of sources){if(!source||!['document','work'].includes(source.kind)||typeof source.refId!=='string'||!source.refId||source.id!==`${source.kind==='document'?'doc':'work'}:${source.refId}`||ids.has(source.id)||typeof source.title!=='string'||typeof source.label!=='string'||!Array.isArray(source.persons)||source.persons.some(person=>typeof person!=='string')||typeof source.snippet!=='string'||typeof source.fullText!=='string'||!source.fullText.trim())throw new Error('invalid_genealogy_research_source');ids.add(source.id);}
 if(sources.filter(source=>source.kind==='document').length>24||sources.filter(source=>source.kind==='work').length>10||family.personas.length>200||family.eventos.length>200||family.relaciones_sociales.length>200)throw new Error('genealogy_research_source_limit');
 const persons=new Set(family.personas.map(person=>person.id));
 if(family.personas.some(person=>!person.id||typeof person.nombre!=='string'||!Array.isArray(person.padres)||!Array.isArray(person.conyuges)||!Array.isArray(person.hijos))||persons.size!==family.personas.length||focusPerson&&(!persons.has(focusPerson.id)||typeof focusPerson.nombre!=='string')||evidence.some(item=>typeof item.personId!=='string'||typeof item.persona!=='string'||typeof item.cita!=='string'||!item.cita.trim()||item.localizacion!==null&&typeof item.localizacion!=='string'))throw new Error('invalid_genealogy_research_facts');
 const capture:GenealogyResearchCapture={language,sources,family,focusPerson,evidence,selection};if(value.sourceHash!==sha256Snapshot(capture))throw new Error('genealogy_research_source_conflict');
 if(new TextEncoder().encode(JSON.stringify(value)).length>16_000_000)throw new Error('deep_research_source_too_large');
}
