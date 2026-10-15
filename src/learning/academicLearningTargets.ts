import {ACADEMIC_LESSONS,type AcademicPracticeSession} from '@shared/academicLearning';
import type {LearningCopyKey} from '@shared/academicLearningCopy';
import type {View} from '../navigation';

export const GUIDE_INTERFACE_TABS=['profiles','theme','languages','nodi'] as const;
/** Controls needed to perform this step, including its real dialogs and form fields. */
export function academicGuideActions(session:AcademicPracticeSession) {
 const evidence=['[data-testid="source-citation-modal"]','[data-testid="idea-detail-modal"]','[data-testid="learning-evidence-panel"]'];
 if(session.lessonId==='interface')return ['[data-testid="academic-interface-picker"]'];
 if(session.lessonId==='first-answer'||session.lessonId==='research-question')return session.step>=2||session.lessonId==='research-question'?['.research-composer-input','.research-composer-send','.research-composer-stop',...(session.lessonId==='first-answer'&&session.step===2||session.lessonId==='research-question'&&session.step===0?['[data-testid="research-new-conversation"]']:[]),...evidence]:['[data-testid="research-preparation-welcome"]','[data-testid="header-queue-panel"]','[data-header-action="queue"]'];
 if(session.lessonId==='first-idea')return ['[data-testid="header-queue-panel"]','[data-header-action="queue"]','[data-testid="manual-idea-form"]','[data-testid="manual-create-idea"]',...evidence];
 const regions:Record<string,string[]>={
  'deep-research':['[data-testid="deep-research-composer"]','[data-anchor-id] button'],
  overview:['[data-testid="coverage-catalog"]'],
  hypothesis:['[data-testid="hypothesis-view"]','[data-testid="hypothesis-create-modal"]'],
  reading:['[data-testid="reading-path-view"]'],
  scriptor:['[data-testid="workspace-view"] .bn-editor'],
  authors:['[data-testid="author-ideas"] button'],
  'argument-map':['[data-testid="argument-map-view"]'],
  dictionary:['[role="dialog"]:has([data-testid="dictionary-concept-name-0"])','[data-testid="dictionary-entry-detail"]'],
 };
 return [...(session.step===0?regions[session.lessonId]??[]:[]),...evidence];
}
export function academicGuideStep(session:AcademicPracticeSession,view:View,hasSources:boolean,preparing:boolean,manual=false) {
 const lesson=ACADEMIC_LESSONS.find(l=>l.id===session.lessonId)!;
 const nav=(destination:string)=>`[data-tour="nav-${destination}"]`;
 const citedMessage=session.messageId?`[data-message-id=${JSON.stringify(session.messageId)}] `:'';
 const citedReferences=(session.citationIds??[]).map(ref=>`${citedMessage}.citation-link[data-citation-id=${JSON.stringify(ref.slice(ref.indexOf(':')+1))}]:not([data-verified="false"])`);
 const evidence=['[data-testid="learning-evidence-panel"] [data-evidence-id]','[data-testid="source-citation-content"] blockquote','[data-testid="source-citation-content"]','[data-testid="idea-detail-modal"] blockquote',...citedReferences,`${citedMessage}.citation-link:not([data-verified="false"])`];
 const composer=['.research-composer-stop','.research-composer-send:not(:disabled)','.research-composer-input'];
 let destination:View=lesson.destination,body:LearningCopyKey='guideEvidence',targets:string[]=[];
 if(session.lessonId==='first-answer'||session.lessonId==='first-idea'){
  destination=session.lessonId==='first-answer'&&session.step>=2?'researchChat':session.lessonId==='first-idea'&&(session.step===3||manual&&session.step===1)?'ideas':session.lessonId==='first-idea'&&session.step===4?'graph':'library';
  if(session.step===0){body=hasSources?'guideSelect':'guideAdd';targets=hasSources?['[data-testid^="vault-library-item-"] input[type="checkbox"]','[data-testid="library-vault-add-files"]']:['[data-testid="library-vault-add-files"]'];}
  else if(session.lessonId==='first-answer'){
   if(session.step===1){body=preparing?'guideWait':'guidePrepare';targets=[manual?'[data-testid="research-preparation-text"]':'[data-testid="research-preparation-enqueue"]',...(preparing?['[data-testid="header-queue-panel"]','[data-header-action="queue"]']:['[data-testid="library-prepare-sources"]'])];}
   else if(session.step===2){body='guideAsk';targets=composer;}
   else {body='guideCitation';targets=evidence;}
  }else if(session.step<=2){body=session.step===2?'guideWait':'cloud';targets=manual?['[data-testid="manual-idea-title"]','[data-testid="manual-create-idea"]']:['[data-testid="library-extract-ideas"]','[data-testid="header-queue-panel"]','[data-header-action="queue"]'];}
  else if(session.step===3){body='guideIdea';targets=['[data-testid="learning-idea-evidence"]','[data-testid^="idea-card-"]','[data-testid^="idea-"]'];}
  else {body='noEdges';targets=['[data-testid="graph-view"] canvas',nav('graph')];}
 }else if(session.lessonId==='research-question'){destination='researchChat';body=session.step===0?'guideAsk':'guideCitation';targets=session.step===0?composer:evidence;}
 else if(session.lessonId==='interface'){body=(['guideProfiles','guideTheme','guideLanguages','guideNodi'] as const)[Math.min(session.step,3)];targets=[`[data-testid="interface-tab-${GUIDE_INTERFACE_TABS[Math.min(session.step,3)]}"]`,'[data-testid="academic-interface-trigger"]'];}
 else if(session.step===0){
  const chapters:Record<string,{body:LearningCopyKey;targets:string[]}>= {
   overview:{body:'guideOverview',targets:['[data-testid="coverage-map-action"]','[data-testid="coverage-catalog"] textarea','[data-testid="coverage-catalog"] aside button']},
   hypothesis:{body:'guideHypothesis',targets:['[data-testid="hypothesis-generate"]','[data-testid="hypothesis-objective"]']},
   reading:{body:'guideReading',targets:['[data-testid="reading-source"]','[data-testid="reading-refresh"]']},
   'deep-research':{body:'guideDeep',targets:['[data-testid="deep-research-composer"] textarea','[data-testid="deep-research-new"]']},
   scriptor:{body:'guideScriptor',targets:['[data-testid="workspace-view"] .bn-editor','[data-testid="workspace-create-note"]','.editorial-create-options summary']},
   authors:{body:'guideAuthors',targets:['[data-testid="author-name"]','[data-testid="authors-search"]']},
   'argument-map':{body:'guideArgument',targets:['[data-testid^="argument-route-"]','[data-testid="argument-routes-search"]']},
   dictionary:{body:'guideDictionary',targets:['[data-testid="dictionary-concept-name-0"]','[data-testid="dictionary-new"]']},
  };({body,targets}=chapters[session.lessonId]);
 }else targets=session.lessonId==='scriptor'?['[data-testid="workspace-view"] .bn-editor',...evidence]:session.lessonId==='authors'?[...evidence,'[data-testid="author-ideas"] button']:session.lessonId==='argument-map'?[...evidence,'.argument-node.is-root .argument-node-content']:session.lessonId==='dictionary'?[...evidence,'[data-testid="dictionary-detail-tab-overview"]']:evidence;
 const wrongView=session.lessonId!=='interface'&&view!==destination;
 // Actual view controls stay reachable through the guide even when a Custom sidebar hides them.
 return {destination,body,targets:wrongView?[nav(destination)]:targets,wrongView};
}
