import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {getDb} from '../db/database';
import {getActiveVault} from '../vaults/vaultRegistry';
import {mobileDomainAllowed} from './executionBoundary';
import {generationSignal} from '../ai/generationSignal';
import {captureMobileDatabaseResearchSources,runDatabaseDeepResearchAsync} from '../ai/databaseDeepResearch';
import * as repo from '../db/databaseDeepResearchRepo';
import {getDatabase} from '../db/databasesRepo';
import {getDatabaseProfile} from '../ai/databaseAnalysis';
import {sha256Snapshot,processDatabaseResearchRun,type DatabaseResearchHost} from '@shared/databaseResearchEngine';
import {databaseSourcePackPayload,validateMobileDatabaseSourcePack,mobileDatabaseSources,mobileDatabaseResearchHost,MobileDatabaseResearchRepository,createMobileDatabaseResearchDetail,type MobileDatabaseSourcePack} from '@shared/mobileDatabaseResearch';
import {normalizeDatabaseDeepResearchJobInput,type DatabaseDeepResearchJobInput,type DatabaseResearchRunDetail} from '@shared/databaseDeepResearch';

function signingKey():Buffer {
  const db=getDb();db.exec('CREATE TABLE IF NOT EXISTS mobile_database_research_signing(key_id TEXT PRIMARY KEY,key_hex TEXT NOT NULL)');
  const key=db.prepare('SELECT key_hex FROM mobile_database_research_signing WHERE key_id=?').get('v1') as {key_hex:string}|undefined;
  if(key) {if(!/^[a-f0-9]{64}$/.test(key.key_hex))throw new Error('invalid_database_signing_key');return Buffer.from(key.key_hex,'hex');}
  const created=randomBytes(32);db.prepare('INSERT INTO mobile_database_research_signing VALUES(?,?)').run('v1',created.toString('hex'));return created;
}
function signature(id:string){return createHmac('sha256',signingKey()).update(id).digest('hex');}
export function mobileDatabaseResearchSourcePack(raw:DatabaseDeepResearchJobInput|{databaseIds:string[]}):MobileDatabaseSourcePack {
  if(getActiveVault().type!=='databases'||!mobileDomainAllowed('corpus'))throw new Error('operation_forbidden');
  if(!raw||!Array.isArray(raw.databaseIds))throw new Error('invalid_database_sources');
  const ids=[...new Set(raw.databaseIds)];if(!ids.length||ids.length>30||ids.some(id=>typeof id!=='string'||!getDatabase(id)))throw new Error('invalid_database_sources');
  const pack:MobileDatabaseSourcePack={version:1,vaultId:getActiveVault().id,capturedAt:new Date().toISOString(),id:'',signature:'0'.repeat(64),databases:captureMobileDatabaseResearchSources(ids,id=>Object.fromEntries((getDatabaseProfile(id)?.profile.columns??[]).map(item=>[item.columnId,{filled:item.filled,fillRate:item.fillRate,distinct:item.distinct,valueType:item.valueType}])))};
  pack.id=sha256Snapshot(databaseSourcePackPayload(pack));validateMobileDatabaseSourcePack(pack);pack.signature=signature(pack.id);return pack;
}
function authenticatePack(pack:MobileDatabaseSourcePack) {
  validateMobileDatabaseSourcePack(pack);
  if(pack.vaultId!==getActiveVault().id||!timingSafeEqual(Buffer.from(pack.signature,'hex'),Buffer.from(signature(pack.id),'hex')))throw new Error('database_source_signature_invalid');
}
/** Publishing a finished device run uses no provider. The Mac recomputes the
 * signed snapshot's artifacts and gates the supplied narrative through the same
 * AST validator. A failed check cannot leave a half-created run or report. */
export async function saveMobileDatabaseResearchReport(raw:{request:DatabaseDeepResearchJobInput;sourcePacks:MobileDatabaseSourcePack[];detail:DatabaseResearchRunDetail;requestId:string},analyze:DatabaseResearchHost['analyze']=runDatabaseDeepResearchAsync) {
  if(getActiveVault().type!=='databases'||!mobileDomainAllowed('corpus')||!mobileDomainAllowed('writing'))throw new Error('operation_forbidden');
  if(!raw||!/^[a-f0-9-]{36}$/i.test(raw.requestId)||!Array.isArray(raw.sourcePacks)||raw.sourcePacks.length>30||!raw.detail?.report||raw.detail.run.id!==`dbr_mobile_${raw.requestId}`||!['completed','partial'].includes(raw.detail.run.status))throw new Error('invalid_database_publication');
  if(Buffer.byteLength(JSON.stringify(raw),'utf8')>20_000_000)throw new Error('database_publication_too_large');
  const db=getDb(),payload=sha256Snapshot(raw);
  db.exec('CREATE TABLE IF NOT EXISTS mobile_database_research_publications(request_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,report_id TEXT NOT NULL)');
  const receipt=db.prepare('SELECT payload_hash,report_id FROM mobile_database_research_publications WHERE request_id=?').get(raw.requestId) as {payload_hash:string;report_id:string}|undefined;
  if(receipt) {if(receipt.payload_hash!==payload)throw new Error('idempotency_conflict');const report=repo.getDatabaseResearchReport(receipt.report_id);if(!report)throw new Error('database_publication_result_unavailable');return report;}
  raw.sourcePacks.forEach(authenticatePack);
  const request=normalizeDatabaseDeepResearchJobInput(raw.request),sources=mobileDatabaseSources(raw.sourcePacks,request.databaseIds);
  if(sources.some(source=>!getDatabase(source.snapshot.databaseId)))throw new Error('database_publication_source_removed');
  const memory=new MobileDatabaseResearchRepository(createMobileDatabaseResearchDetail(raw.detail.run.id,request,sources,raw.detail.run.createdAt));
  const signal=generationSignal(),cancel=()=>{memory.detail.run.status='cancelling';};signal?.addEventListener('abort',cancel,{once:true});
  const step=(kind:string)=>raw.detail.steps.find(item=>item.kind===kind)?.output;
  const responses:{[role:string]:unknown}={planner:step('planning')?.plannerSelection,critic:(step('adversarial_review')?.criticOutput as {structured?:unknown}|undefined)?.structured,verifier:(step('verification')?.verifierOutput as {structured?:unknown}|undefined)?.structured,synthesizer:step('assembly')?.narrativeAst,writer:step('assembly')?.narrativeAst,editor:step('assembly')?.narrativeAst};
  try {
    signal?.throwIfAborted();
    // A numerical-only run has no model review to replay. Introducing a
    // completion adapter would turn absent reviews into failed verifier gates.
    // Model-assisted runs still replay their structured output and all gates.
    const modelDriven=step('adversarial_review')?.criticOutput!=null || step('verification')?.verifierOutput!=null || step('assembly')?.synthesizerOutput!=null || step('assembly')?.editorOutput!=null;
    const agents=modelDriven?{complete:async({role}:Parameters<NonNullable<import('@shared/databaseResearchEngine').DatabaseResearchAgentDeps['complete']>>[0])=>{signal?.throwIfAborted();return JSON.stringify(responses[role]??null);}}:{};
    const verified=await processDatabaseResearchRun(memory.detail.run.id,agents,mobileDatabaseResearchHost(memory,sources,analyze));
    const result=verified.report,authored=raw.detail.report;
    if(!result||!Number.isFinite(Date.parse(authored.createdAt))||authored.id!==result.id||authored.runId!==verified.run.id)throw new Error('database_publication_verification_failed');
    const same=(a:unknown,b:unknown)=>sha256Snapshot(a??null)===sha256Snapshot(b??null);
    const identity=['title','markdown','summary','reportType'] as const;
    const artifacts=['evidence','charts','sections','evidenceLedger','claims'];
    const quality=['verifiedClaims','artifactCount','coverage','status'];
    const provenance=['snapshotFingerprint','sha256','model','seed','promptVersion'];
    if(identity.some(key=>authored[key]!==result[key])||artifacts.some(key=>!same(authored.structured[key],result.structured[key]))||quality.some(key=>!same(authored.quality[key],result.quality[key]))||provenance.some(key=>!same(authored.provenance[key],result.provenance[key])))throw new Error('database_publication_verification_failed');
    signal?.throwIfAborted();
    return db.transaction(()=>{
      const duplicate=db.prepare('SELECT payload_hash,report_id FROM mobile_database_research_publications WHERE request_id=?').get(raw.requestId) as {payload_hash:string;report_id:string}|undefined;
      if(duplicate) {if(duplicate.payload_hash!==payload)throw new Error('idempotency_conflict');const report=repo.getDatabaseResearchReport(duplicate.report_id);if(!report)throw new Error('database_publication_result_unavailable');return report;}
      const run=repo.createDatabaseResearchRun({databaseId:request.databaseIds[0],objective:request.objective,title:verified.run.title,language:verified.run.language,model:verified.run.model,options:verified.run.options},{id:verified.run.id,createdAt:verified.run.createdAt});
      repo.startDatabaseResearchRun(run.id);
      repo.updateDatabaseResearchRun(run.id,{plan:verified.run.plan,request:verified.run.request,snapshotManifest:{...verified.run.snapshotManifest,deviceSourcePacks:raw.sourcePacks.map(pack=>({id:pack.id,capturedAt:pack.capturedAt})),generatedOnDevice:true},snapshotFingerprint:verified.run.snapshotFingerprint,budget:verified.run.budget,reportType:verified.run.reportType});
      for(const item of verified.steps)repo.upsertDatabaseResearchStep({...item,id:`${run.id}:${item.kind}:${item.ordinal}`,runId:run.id});
      for(const item of verified.claims)repo.saveDatabaseResearchClaim({...item,id:`${run.id}:${item.ordinal}`,runId:run.id});
      const report=repo.saveDatabaseResearchReport({...raw.detail.report!,finalStatus:verified.run.status==='partial'?'partial':'completed'});
      // Preserve the validated device document verbatim: its whitespace is
      // part of the source revision used by already-authored annotations.
      db.prepare('UPDATE database_research_reports SET created_at=?,markdown=? WHERE id=?').run(raw.detail.report!.createdAt,raw.detail.report!.markdown,report.id);
      const saved=repo.getDatabaseResearchReport(report.id)!;
      db.prepare('INSERT INTO mobile_database_research_publications VALUES(?,?,?)').run(raw.requestId,payload,report.id);return saved;
    })();
  } finally {signal?.removeEventListener('abort',cancel);}
}
