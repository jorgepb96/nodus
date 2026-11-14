import {createHash} from 'node:crypto';
import {getDb} from '../db/database';
import {getStudyWorkspace} from '../db/studyOrgRepo';
import {listStudyIdeas,getStudyIdeaDetail,getStudyKnowledgeGraph} from '../db/studyKnowledgeRepo';
import {canonicalJson} from '../../shared/canonicalJson';
/** A read-only, revision-bound page of canonical knowledge, never extraction. */
export function mobileStudyKnowledgeSource(vaultId:string,raw:unknown) {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_study_knowledge_source');
 const input=raw as Record<string,unknown>;
 if(Object.keys(input).some(k=>!['subjectId','offset','limit','revision'].includes(k))||typeof input.subjectId!=='string'||!input.subjectId||input.subjectId.length>128||!Number.isSafeInteger(input.offset)||Number(input.offset)<0||!Number.isSafeInteger(input.limit)||Number(input.limit)<1||Number(input.limit)>80||input.revision!==undefined&&(typeof input.revision!=='string'||!/^[a-f0-9]{64}$/.test(input.revision)))throw new Error('invalid_study_knowledge_source');
 return getDb().transaction(()=>{
  const workspace=getStudyWorkspace(),subject=workspace.subjects.find(s=>s.id===input.subjectId);if(!subject)throw new Error('study_subject_unavailable');
  const course=workspace.courses.find(c=>c.id===subject.courseId);if(!course)throw new Error('study_course_unavailable');
  const ideas=listStudyIdeas(subject.id),details=ideas.map(idea=>getStudyIdeaDetail(idea.id));
  if(details.some(detail=>!detail||detail.subjectId!==subject.id))throw new Error('study_knowledge_changed');
  const graph=getStudyKnowledgeGraph(subject.id),scope={subject,course,ideas,details,graph};
  const revision=createHash('sha256').update(canonicalJson(scope)).digest('hex');
  if(input.revision!==undefined&&input.revision!==revision)throw new Error('study_knowledge_changed');
  const offset=Number(input.offset),limit=Number(input.limit);if(offset>ideas.length)throw new Error('invalid_study_knowledge_offset');
  return {version:1,vaultId,subjectId:subject.id,revision,offset,limit,total:ideas.length,hasMore:offset+limit<ideas.length,
   workspace:{...workspace,courses:[course],subjects:[subject],documents:[],placements:[],topics:[],folders:[],tags:[],documentTags:[],templates:[]},
   ideas:ideas.slice(offset,offset+limit),details:details.slice(offset,offset+limit),...(offset===0?{graph}:{})};
 })();
}
