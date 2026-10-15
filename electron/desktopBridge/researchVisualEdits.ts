import {createHash} from 'node:crypto';
import {canonicalJson} from '../../shared/canonicalJson';
import {DEFAULT_CHAT_SKILLS,skillHasCapability} from '../../shared/chatSkills';
import {validateDocumentSkillPolicy,type DocumentSkillPolicy} from '../../shared/documentSkills';
import type {DeepResearchRequest} from '../../shared/types';
import {getActiveVault} from '../vaults/vaultRegistry';
import {getDb} from '../db/database';
import {getWritingWorkshopDraft} from '../db/writingDraftsRepo';
import {readDocumentVisuals} from '../capabilities/documentStore';
import {validateMobileResearchVisuals,publishMobileResearchVisuals} from './mobileResearchVisuals';
/** A separate provider-free command lane: editing figures never rewrites the
 * original report publication request or spends another model call on the Mac. */
export function saveMobileDeepResearchVisuals(raw:unknown,grant:string){
 const input=raw as {version:1;requestId:string;reportId:string;expectedRevision:string|null;policy:DocumentSkillPolicy;visuals:unknown};
 const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
 if(!input||input.version!==1||!uuid(input.requestId)||!uuid(input.reportId)||!(input.expectedRevision===null||uuid(input.expectedRevision))||!grant||Buffer.byteLength(JSON.stringify(input))>16*1024*1024)throw new Error('invalid_mobile_research_visual_edit');
 const policy=validateDocumentSkillPolicy(input.policy,DEFAULT_CHAT_SKILLS.filter(skill=>skillHasCapability(skill,'nodus:svg')||skillHasCapability(skill,'nodus:image')).map(skill=>({skill,available:true,billing:skillHasCapability(skill,'nodus:image')?'per-call':'none'})));
 const db=getDb(),vault=getActiveVault().id,fingerprint=createHash('sha256').update(canonicalJson(input)).digest('hex');
 db.exec('CREATE TABLE IF NOT EXISTS mobile_research_visual_edits(device_grant TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT,PRIMARY KEY(device_grant,request_id))');
 let intent=db.prepare('SELECT payload_hash,state,result_json FROM mobile_research_visual_edits WHERE device_grant=? AND request_id=?').get(grant,input.requestId) as {payload_hash:string;state:string;result_json:string|null}|undefined;
 if(intent&&intent.payload_hash!==fingerprint)throw new Error('idempotency_conflict');if(intent?.state==='available')return JSON.parse(intent.result_json!);
 const saved=getWritingWorkshopDraft(input.reportId);if(!saved||saved.draft.brief.kind!=='deep_research')throw new Error('research_visual_document_missing');
 const target={kind:'deep-research' as const,id:input.reportId},current=readDocumentVisuals(vault,target),manifest=validateMobileResearchVisuals(input.visuals,{documentSkills:policy} as DeepResearchRequest,saved.draft,vault,input.reportId,grant);
 if(!manifest)throw new Error('invalid_mobile_research_visual_edit');
 if((current?.revision??null)!==input.expectedRevision&&!(intent&&current?.revision===manifest.revision))throw new Error('research_visual_revision_conflict');
 if(!intent){db.prepare('INSERT INTO mobile_research_visual_edits VALUES(?,?,?,\'pending\',NULL)').run(grant,input.requestId,fingerprint);intent={payload_hash:fingerprint,state:'pending',result_json:null};}
 // Durable pending intent precedes the atomic canonical file replacement. A kill
 // after that rename resumes this exact command, rather than conflicting with itself.
 publishMobileResearchVisuals(manifest);
 const result={version:1,id:input.requestId,reportId:input.reportId,revision:manifest.revision,state:'available'};
 db.prepare('UPDATE mobile_research_visual_edits SET state=\'available\',result_json=? WHERE device_grant=? AND request_id=? AND payload_hash=?').run(JSON.stringify(result),grant,input.requestId,fingerprint);return result;
}
