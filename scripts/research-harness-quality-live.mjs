// One durable authorization across every native round, audit and correction.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { researchTestEnvironment, macResearchSandbox, verifyResearchSandbox } from './research-isolation.mjs';
import { importResearchTestCredentials } from './research-test-credentials.mjs';
import { startResearchProviderProxy } from './research-provider-proxy.mjs';
import { verifyResearchQualityAuthorization } from './research-quality-authorization.mjs';
const require = createRequire(import.meta.url), repo = path.resolve(import.meta.dirname, '..');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = arg('phase');
if (!['preaudit', 'round1', 'round2', 'audit', 'corrections1', 'corrections2', 'intent'].includes(phase)) throw new Error('Choose an explicit quality phase');
const out = path.join(repo, 'artifacts/research-harness-ab/quality');fs.mkdirSync(out,{recursive:true});
const file = path.join(out,'authorization.json');
const recordedAuthorization = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : null;
const requestedRoot = arg('resume-root') ?? recordedAuthorization?.root;
if (!requestedRoot) throw new Error('Pass --resume-root=/absolute/isolated/root for a new authorized quality campaign');
const root = fs.realpathSync(requestedRoot), artifacts = path.join(root,'artifacts');
if (recordedAuthorization && recordedAuthorization.root !== root) throw new Error('Do not move or reset an existing campaign authorization');
const marker = JSON.parse(fs.readFileSync(path.join(root,'isolation.json')));
if(marker.format!=='nodus.isolated-research-profile/1'||marker.root!==root)throw new Error('Invalid frozen profile');
if (!fs.existsSync(file)) {
  if (['deepseek','openrouter','gemini'].some(p=>fs.existsSync(path.join(artifacts,`cost-ledger-${p}.json`)))) throw new Error('Budget already has calls: do not reset authorization');
  fs.writeFileSync(file,JSON.stringify({format:'nodus.research-quality-budget/1',root,authorizedAt:new Date().toISOString(),userLimitEurPerProvider:1,
    providerLimitsUsd:{deepseek:.8,openrouter:.8,gemini:.8},bgeExcluded:true,
    conversion:'Conservative USD 0.80 ceiling per provider; no budget borrowing. Margin against EUR/USD and fees.',
    prices:{deepseek:'https://api-docs.deepseek.com/quick_start/pricing/',gemini:'https://ai.google.dev/gemini-api/docs/pricing',openrouter:'https://openrouter.ai/api/v1/models',fx:'https://www.ecb.europa.eu/stats/exchange/eurofxref/shared/pdf/2026/10/20261009.pdf'}},null,2),{mode:0o600});
}
const authorization=JSON.parse(fs.readFileSync(file));
verifyResearchQualityAuthorization(authorization, root, provider => { const ledger = path.join(artifacts, `cost-ledger-${provider}.json`); return fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger)) : null; });
const nativeModels={
  'deepseek:deepseek-flash':{provider:'deepseek',model:'deepseek-flash'},
  'openrouter:mistralai/mistral-large-4-0':{provider:'openrouter',model:'mistralai/mistral-large-4-0'},
  'openrouter:qwen/qwen3.6-plus':{provider:'openrouter',model:'qwen/qwen3.6-plus'},
  'openrouter:deepseek/deepseek-v4.1-flash-1017':{provider:'openrouter',model:'deepseek/deepseek-v4.1-flash-1017'},
};
const nativeModel=nativeModels[arg('model')??'deepseek:deepseek-flash'];
if(!nativeModel)throw new Error('Unapproved native model');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const providers=['deepseek','openrouter','gemini'];
const missing=providers.filter(p=>!fs.existsSync(path.join(root,`profile/secrets/ai_key_${p}.bin`)));
if(missing.length)importResearchTestCredentials(root,undefined,missing);
let sequence=fs.existsSync(path.join(artifacts,'request-map.jsonl'))?fs.readFileSync(path.join(artifacts,'request-map.jsonl'),'utf8').trim().split('\n').filter(Boolean).length:0;
const proxy=await startResearchProviderProxy(root,{providerLimitsUsd:authorization.providerLimitsUsd,allowedProviders:providers,excludeBgeFromBudget:true,
  captureVisibleResponses:true,extraChatModels:['mistralai/mistral-large-4-0','deepseek/deepseek-v4.1-flash-1017','gemini-3.8-flash','qwen/qwen3.6-plus','qwen/qwen3.8-max-0902'],maxOutputTokens:393216,
  catalogDispatch:fetch,dispatch:async(url,init)=>{
    const body=JSON.parse(Buffer.from(init.body).toString());const id=++sequence;const requestHash=createHash('sha256').update(init.body).digest('hex');
    const active=JSON.parse(fs.readFileSync(path.join(artifacts,'active-case.json')));
    fs.appendFileSync(path.join(artifacts,'request-map.jsonl'),JSON.stringify({...active,id,requestHash,model:body.model,at:new Date().toISOString()})+'\n');
    if(body.messages)fs.writeFileSync(path.join(artifacts,`${active.caseId}-${active.mode}-request-${id}.json`),JSON.stringify(body,null,2),{mode:0o600});
    return fetch(url,init);
  }});
try {
  const sandbox=macResearchSandbox(root,[Number(new URL(proxy.url).port)]);verifyResearchSandbox(root,sandbox);
  const env={...researchTestEnvironment(root),NODUS_RESEARCH_PROVIDER_PROXY:proxy.url,NODUS_AB_REPO:repo,NODUS_AB_GIT:commit,NODUS_EMBEDDING_QA_TRACE:'1'};
  let script;
  if(phase.includes('round')||phase.startsWith('corrections')){
    const round=phase.endsWith('1')?'1':'2';const attempt=arg('attempt');if(attempt&&(!phase.startsWith('corrections')||!/[2-9]/.test(attempt)||attempt.length!==1))throw new Error('Invalid correction attempt');const scenario=`v1-quality-${phase.startsWith('corrections')?'corrections':'round'}-${round}${attempt?'-attempt-'+attempt:''}`;
    const existing=path.join(artifacts,`${scenario}.json`);
    const cases=arg('cases')?.split(',');
    if(fs.existsSync(existing)){
      const previous=JSON.parse(fs.readFileSync(existing));
      if(JSON.stringify(previous.model)!==JSON.stringify(nativeModel))throw new Error('Do not mix native models in a campaign');
      if(previous.commit!==commit|| (cases&&JSON.stringify(previous.cases.map(c=>c.id))!==JSON.stringify(cases)))throw new Error('Archive changed campaign before fresh run; never reset budget ledgers');
    }
    env.NODUS_AB_SCENARIO=scenario;env.NODUS_AB_CHAT_MODEL=JSON.stringify(nativeModel);if(nativeModel.provider==='openrouter')env.NODUS_RESEARCH_OPENROUTER_CHAT_QA='1';if(cases)env.NODUS_AB_VALIDATION_CASES=JSON.stringify(cases);
    const files=execFileSync('git',['ls-files','electron/ai','electron/qa','shared','scripts/lib/research-harness-ab-electron.mjs','scripts/lib/research-validation-cases.mjs'],{cwd:repo,encoding:'utf8'}).trim().split('\n');
    fs.writeFileSync(path.join(artifacts,`${scenario}-code-identity.json`),JSON.stringify({commit,files:Object.fromEntries(files.map(p=>[p,createHash('sha256').update(fs.readFileSync(path.join(repo,p))).digest('hex')])),intervention:'Native V1 with the selected context, no audit bypass.'},null,2));
    script='scripts/lib/research-harness-ab-electron.mjs';
  }else if(phase==='intent'){
    env.NODUS_AB_CHAT_MODEL=JSON.stringify(nativeModel);
    if(nativeModel.provider==='openrouter')env.NODUS_RESEARCH_OPENROUTER_CHAT_QA='1';
    env.NODUS_QUALITY_OUTPUT=path.join(artifacts,`quality-intent-${commit}.json`);
    script='scripts/lib/research-intent-electron.mjs';
  }else{
    const inputs=[];
    const folders=phase==='preaudit'?fs.readdirSync(path.join(repo,'artifacts/research-harness-ab')).filter(n=>n.startsWith('v1-validation-')).map(n=>path.join(repo,'artifacts/research-harness-ab',n,'campaign.json'))
      :fs.readdirSync(artifacts).filter(n=>/^v1-quality-(?:round-[12]|corrections-[12](?:-attempt-[2-9])?)\.json$/.test(n)).map(n=>path.join(artifacts,n));
    for(const f of folders){if(!fs.existsSync(f))continue;const c=JSON.parse(fs.readFileSync(f));for(const run of c.runs){
      if(run.error||run.aborted)continue;
      const old=inputs.find(x=>x.caseId===run.caseId);const verified=run.checkpoint?.checkpoint.answerReview?.status==='verified';
      if(old&&(phase==='preaudit'?((old.verified&&!verified)||(old.verified===verified&&old.completedAt>=c.completedAt)):old.completedAt>=c.completedAt))continue;
      if(old)inputs.splice(inputs.indexOf(old),1);
      const corpus=run.checkpoint.checkpoint.corpus;
      let researchLog=corpus.researchLog;
      if(!researchLog){
        const hashes=new Set(run.providerMetrics.map(metric=>metric.requestHash));
        const rows=fs.readFileSync(path.join(artifacts,'request-map.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
        for(const row of rows.filter(row=>row.caseId===run.caseId&&row.mode==='v1'&&hashes.has(row.requestHash))){
          const f=path.join(artifacts,`${row.caseId}-${row.mode}-request-${row.id}.json`);if(!fs.existsSync(f))continue;
          const b=JSON.parse(fs.readFileSync(f));if(!b.messages?.[0]?.content?.startsWith('Write a cohesive'))continue;
          try{researchLog=JSON.parse(b.messages.at(-1).content).contexto_modular_seleccionado?.research_scope?.research_log;}catch{}
        }
      }
      const sources=(corpus.evidence??[]).map(([id,s])=>({id,title:s.label,authors:s.authors,year:s.year,page:s.pageLabel,citation:s.citation,text:s.summary}));
      sources.push(...(corpus.ideas??[]).map(([id,s])=>({id:`idea:${id}`,text:s.statement,attributionOnly:true})));
      sources.push({id:'operations',text:JSON.stringify({researchLog,lookups:corpus.lookups,read:corpus.read,limitations:corpus.limitations,operations:corpus.operations,
        metadataOfFinalWorkLinks:run.evidence.filter(e=>e.ref.kind==='work'),retrieved:sources.map(({id,title})=>({id,title}))})});
      inputs.push({caseId:run.caseId,question:c.cases.find(x=>x.id===run.caseId).question,answer:run.answer,sources,context:run.context.selection,verified,commit:c.commit,completedAt:c.completedAt});
    }}
    if(inputs.length!==25)throw new Error('Need exactly 25 source-backed cases');
    const inputFile=path.join(artifacts,`quality-${phase}-inputs.json`);fs.writeFileSync(inputFile,JSON.stringify(inputs),{mode:0o600});
    env.NODUS_QUALITY_INPUT=inputFile;env.NODUS_QUALITY_OUTPUT=path.join(out,`${phase}-${arg('provider')??'gemini'}.json`);
    // The sandbox can only write inside root; copy the final public artifact afterwards.
    env.NODUS_QUALITY_OUTPUT=path.join(artifacts,`quality-${phase}-${arg('provider')??'gemini'}.json`);
    env.NODUS_QUALITY_PROVIDER=arg('provider')??'gemini';if(arg('audit-model'))env.NODUS_QUALITY_AUDIT_MODEL=arg('audit-model');env.NODUS_QUALITY_CASES=arg('cases')??'';
    script='scripts/lib/research-quality-audit-electron.mjs';
  }
  const child=spawn('/usr/bin/sandbox-exec',['-p',sandbox,require('electron'),'--no-sandbox',path.join(repo,script)],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  const log=fs.createWriteStream(path.join(out,`${phase}-${Date.now()}.log`),{mode:0o600});let partial='';
  child.stdout.on('data',b=>{log.write(b);partial+=b;const lines=partial.split('\n');partial=lines.pop();for(const l of lines)if(l.startsWith('AB:')||l.startsWith('QA:'))console.log(l);});child.stderr.on('data',b=>log.write(b));
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});log.end();
  if(code!==0)throw new Error(`Isolated quality phase failed (${code}); spending remains reserved`);
  if(env.NODUS_AB_SCENARIO){const result=JSON.parse(fs.readFileSync(path.join(artifacts,`${env.NODUS_AB_SCENARIO}.json`)));if(!result.completedAt||result.runs.some(run=>run.error||run.aborted))throw new Error('Native quality campaign has incomplete or failed runs');}
  for(const name of fs.readdirSync(artifacts).filter(n=>n.startsWith('v1-quality-')||n.startsWith('quality-')))if(name.endsWith('.json'))fs.copyFileSync(path.join(artifacts,name),path.join(out,name));
} finally {
  await proxy.close();
  fs.writeFileSync(path.join(out,'budget.json'),JSON.stringify({authorization,providers:Object.fromEntries(providers.map(p=>{const l=proxy.ledgers[p].read();return[p,{limitUsd:l.limitUsd,committedUsd:l.calls.reduce((s,c)=>s+(c.actualUsd??c.maximumUsd),0),calls:l.calls.length}];})),bge:{excluded:true,calls:proxy.bgeLedger.read().calls.length}},null,2));
}
