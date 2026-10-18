import type {StudySearchLocation} from '@shared/studySearch';

export function mobileChatSurface(vaultType:string): 'world'|'study'|'teaching'|'database'|'research' {
  switch(vaultType) {
    case 'worldbuilding': return 'world';
    case 'estudio': return 'study';
    case 'docencia': return 'teaching';
    case 'databases': return 'database';
    default: return 'research';
  }
}
export const MOBILE_CHAT_STREAM_METHODS = ['researchChatStream','worldChatStream','dbChatStream','streamStudyAssistant'] as const;
export const MOBILE_CHAT_CANCEL_METHODS = ['cancelResearchChat','cancelWorldChat','cancelDbChat','cancelStudyAssistant'] as const;
export const MOBILE_CHAT_STREAM_EVENTS: Record<string,string> = {
  'research:chatStream:delta':'onDelta','research:chatStream:reasoning':'onReasoning',
  'research:chatStream:replace':'onReplace','research:chatStream:concilium':'onConcilium','research:chatStream:activity':'onActivity',
  'worldChat:delta':'onDelta','db:chatStream:delta':'onDelta','study:assistant:delta':'onDelta','study:assistant:reasoning':'onReasoning',
};

/** Open the cited source at its real locator on this device, including transcript versions. */
export function mobileStudyCitation(kind:'doc'|'material'|'recording',id:string,location:StudySearchLocation={}):string {
  if(!id.trim()) throw new Error('La cita no tiene una fuente.');
  const query=new URLSearchParams();
  for(const [key,value] of [['page',location.pageNumber],['slide',location.slideNumber],['from',location.from],['to',location.to]] as const) {
    if(value!=null) {
      if(!Number.isSafeInteger(value)||value<0) throw new Error('La posición de la cita no es válida.');
      query.set(key,String(value));
    }
  }
  if(location.timestampSeconds!=null) {
    if(!Number.isFinite(location.timestampSeconds)||location.timestampSeconds<0) throw new Error('La posición de la grabación no es válida.');
    query.set('t',String(location.timestampSeconds));
  }
  if(location.transcriptId) query.set('transcript',location.transcriptId);
  return `nodus://study/${kind}/${encodeURIComponent(id)}${query.size?'?'+query.toString():''}`;
}
