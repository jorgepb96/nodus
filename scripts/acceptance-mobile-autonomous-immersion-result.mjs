import assert from 'node:assert/strict';
import {connectAcceptanceBridge} from './lib/mobileAcceptanceClient.mjs';

const client=await connectAcceptanceBridge('Verify phone-owned immersion in Desktop');
try {
  const settings=await client.operation('getSettings');
  const sessions=await client.operation('listImmersionSessions');
  const candidates=[];
  for (const row of sessions.filter(row=>row.topic==='propaganda turística')) {
    const session=await client.operation('getImmersionSession',[row.id]);
    if (session.model?.provider==='deepseek' && session.model?.model==='deepseek-chat') candidates.push(session);
  }
  assert.equal(candidates.length,1,'Restart and retries must not duplicate the phone-generated immersion');
  const session=candidates[0];
  assert.notDeepEqual(session.model,settings.immersionModel,'Phone and Mac models intentionally differ to detect fallback');
  assert.equal(session.plan.stoppedReason,null,'A degraded fallback plan does not count as completed generation');
  assert(session.plan.stations.length>=2);
  assert(session.plan.stats.citations>0);
  assert(session.plan.exam.questions.length>0);
  assert(session.plan.stations.every(station=>station.synthesis.length>100));
  assert(session.progress.startedAt && session.progress.currentStep>=1 && session.progress.completedSteps.length>0,
    'The player must persist and recover its progress');
  const citations=session.plan.stations.flatMap(station=>station.citations);
  assert(citations.every(citation=>citation.passageId && citation.text.length>0 && citation.commentary.length>0));
  const reopened=await client.operation('getImmersionSession',[session.id]);
  assert.deepEqual(reopened.progress,session.progress);
  assert.deepEqual(reopened.plan,session.plan);
  console.log(JSON.stringify({executed:1,passed:1,failed:0,skipped:0,sessionId:session.id,phoneModel:session.model,
    macModel:settings.immersionModel,stations:session.plan.stations.length,citations:citations.length,
    questions:session.plan.exam.questions.length,stoppedReason:session.plan.stoppedReason,
    persistedInDesktop:true,progress:session.progress,duplicateSessions:false},null,2));
} finally {await client.close();}
