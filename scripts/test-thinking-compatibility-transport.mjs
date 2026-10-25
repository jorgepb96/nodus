// Exercise the production transports with real SDKs and loopback HTTP only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { installRuntimeHooks, requireElectronRuntime, repoRoot } from './lib/tsRuntimeHooks.mjs';
if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--thinking-wire')) process.exit(0);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-thinking-wire-'));
installRuntimeHooks(scratch);
const require = createRequire(import.meta.url);
const load = file => require(path.join(repoRoot, file));
const seen = [];
const sonnetMessage = 'To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}.';
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => raw += chunk);
  req.on('end', () => {
    const body = JSON.parse(raw || '{}'); seen.push({ url: req.url, body });
    if (body.model === 'gateway/non-reasoning' && body.reasoning) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'No endpoints found that support all requested parameters' } })); return;
    }
    const disabled = body.thinking?.type === 'disabled' || body.reasoning?.enabled === false || body.reasoning?.effort === 'none' || body.reasoning_effort === 'none';
    if (body.model.includes('native-future') && disabled) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: sonnetMessage } })); return;
    }
    if ((body.model.includes('required') || body.model.includes('5.5')) && disabled) {
      res.writeHead(422, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Reasoning is mandatory on this model' } })); return;
    }
    const text = body.response_format ? '{"ok":true}' : 'Answer';
    if (req.url.endsWith('/messages')) {
      if (body.stream) res.writeHead(200, { 'content-type': 'text/event-stream' }).end('event: content_block_delta\ndata: '+JSON.stringify({ type:'content_block_delta', index:0, delta:{type:'text_delta', text} })+'\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n');
      else res.writeHead(200, { 'content-type':'application/json' }).end(JSON.stringify({content:[{type:'text',text}],stop_reason:'end_turn'}));
    } else if (req.url.endsWith('/responses')) {
      if (body.stream) res.writeHead(200, { 'content-type':'text/event-stream' }).end('event: response.output_text.delta\ndata: '+JSON.stringify({type:'response.output_text.delta',delta:text})+'\n\nevent: response.completed\ndata: '+JSON.stringify({type:'response.completed',response:{status:'completed'}})+'\n\n');
      else res.writeHead(200, { 'content-type':'application/json' }).end(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text}]}]}));
    } else if (body.stream) res.writeHead(200, { 'content-type':'text/event-stream' }).end('data: '+JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
    else res.writeHead(200, { 'content-type':'application/json' }).end(JSON.stringify({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]}));
  });
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.href === 'https://openrouter.ai/api/v1/models') return Promise.resolve(new Response(JSON.stringify({data:[
    {id:'gateway/required-catalogue',reasoning:{mandatory:true,supported_efforts:['high','medium']},supported_parameters:['reasoning']},
    {id:'gateway/accepts-disabled',reasoning:{mandatory:false,supported_efforts:['high','low','none']},supported_parameters:['reasoning']},
    {id:'gateway/non-reasoning',supported_parameters:['response_format']},
  ]}), {headers:{'content-type':'application/json'}}));
  assert.equal(url.origin,new URL(base).origin,'External inference forbidden');
  return originalFetch(input,options);
};
let cases = 0;
try {
  load('electron/db/settingsRepo.ts').updateSettings({chatReasoning:'off',promptLanguage:'en',openRouterThroughput:false,customProvider:{baseUrl:base+'/v1',models:[]}});
  load('electron/secrets/secretStore.ts').getApiKey = () => 'fixture-key';
  const providers = load('electron/ai/providers.ts');
  providers.openAiCompatBase = () => base+'/v1';
  process.env.ANTHROPIC_BASE_URL = base;
  const ai = load('electron/ai/aiClient.ts');
  const catalogue = await providers.listModels('openrouter',null);
  assert.equal(catalogue.find(m=>m.id==='gateway/required-catalogue').reasoningMandatory,true);
  for (const streaming of [false,true]) {
    const ask = (ref, opts) => streaming ? ai.completeTextStreamNeutral(opts,()=>{},ref) : ai.completeTextNeutral(opts,ref);
    const opts = {system:'Test',user:'Question',maxTokens:4096,reasoning:'off',researchEffort:'standard'};
    const plainBefore=seen.length;
    assert.equal(await ask({provider:'openrouter',model:'gateway/non-reasoning'},{system:'Test',user:'Question',maxTokens:4096,reasoning:'off',noRetry:true}),'Answer');
    assert.equal(seen.length-plainBefore,1,'strict routing accepts a non-reasoning model without a retry');
    assert.equal(seen.at(-1).body.reasoning,undefined,'do not send an unsupported opt-out');cases++;
    const rows = [
      ['anthropic','claude-sonnet-5-5',b=>assert.deepEqual(b.thinking,{type:'between_tools'})],
      ['anthropic','claude-opus-5-5',b=>assert.deepEqual(b.thinking,{type:'adaptive'})],
      ['anthropic','claude-opus-4-6',b=>assert.deepEqual(b.thinking,{type:'disabled'})],
      ['deepseek','deepseek-flash',b=>assert.deepEqual(b.thinking,{type:'disabled'})],
      ['xiaomi','mimo-v2.5',b=>assert.deepEqual(b.thinking,{type:'disabled'})],
      ['openai','gpt-5.4',b=>assert.equal(b.reasoning_effort,'none')],
      ['groq','qwen3-32b',b=>assert.equal(b.reasoning_effort,'none')],
      ['cerebras','qwen3.8',b=>assert.equal(b.reasoning_effort,'none')],
      ['gemini','gemini-3-pro-preview',b=>assert.equal(b.extra_body.google.thinking_config.thinking_level,'low')],
      ['openrouter','anthropic/claude-sonnet-5.5',b=>assert.deepEqual(b.reasoning,{effort:'low'})],
      ['openrouter','anthropic/claude-opus-5.5',b=>assert.deepEqual(b.reasoning,{effort:'low'})],
      ['openrouter','gateway/required-catalogue',b=>assert.deepEqual(b.reasoning,{effort:'medium'})],
      ['openrouter','gateway/accepts-disabled',b=>assert.deepEqual(b.reasoning,{enabled:false})],
    ];
    for (const [provider,model,check] of rows) {
      const before=seen.length; assert.equal(await ask({provider,model},{...opts,researchEffort:model==='gateway/accepts-disabled'?'none':'standard',noRetry:true}),'Answer');
      assert.equal(seen.length-before,1);check(seen.at(-1).body);cases++;
    }
    for(const [provider,model,expected] of [
      ['anthropic',`claude-sonnet-5-6-native-future-${streaming}`,{type:'between_tools'}],
      ['deepseek',`deepseek-flash-required-${streaming}`,{type:'enabled'}],
      ['xiaomi',`mimo-required-${streaming}`,{type:'enabled'}],
      ['custom',`gpt-5.4-required-${streaming}`,null],
      ['openai',`gpt-5.4-required-${streaming}`,null],
      ['groq',`qwen3-required-${streaming}`,null],
      ['cerebras',`qwen3.8-required-${streaming}`,null],
      ['openrouter',`anthropic/claude-sonnet-5.6-required-${streaming}`,null],
    ]) {
      const before=seen.length;
      assert.equal(await ask({provider,model},opts),'Answer');
      const bodies=seen.slice(before).map(entry=>entry.body);assert.equal(bodies.length,2);
      assert.deepEqual(bodies[0].messages,bodies[1].messages);assert.equal(bodies[0].max_tokens,bodies[1].max_tokens);
      if(expected) assert.deepEqual(bodies[1].thinking,expected);
      else if(provider==='openrouter') assert.equal(bodies[1].reasoning.effort,'low');
      else assert.equal(bodies[1].reasoning_effort,provider==='groq'?'default':'low');
      const cached=seen.length;assert.equal(await ask({provider,model},opts),'Answer');assert.equal(seen.length-cached,1);cases+=2;
    }
    const enabled=seen.length;
    assert.equal(await ask({provider:'anthropic',model:'claude-sonnet-5-5'},{...opts,researchEffort:'max'}),'Answer');
    assert.equal(seen.length-enabled,1);assert.deepEqual(seen.at(-1).body.thinking,{type:'adaptive'});assert.equal(seen.at(-1).body.output_config.effort,'max');cases++;
    const single=seen.length;
    await assert.rejects(ask({provider:'anthropic',model:`claude-sonnet-5-6-native-future-single-${streaming}`},{...opts,noRetry:true}));
    assert.equal(seen.length-single,1);cases++;
  }
  assert.deepEqual(await ai.completeJson({system:'Test',user:'Question',maxTokens:4096,researchEffort:'standard'},value=>value?.ok===true,{provider:'deepseek',model:'deepseek-flash-required-json'}),{ok:true});cases++;
  const jsonBefore=seen.length;
  assert.deepEqual(await ai.completeJson({system:'Test',user:'Question',maxTokens:4096,noRetry:true},value=>value?.ok===true,{provider:'openrouter',model:'gateway/non-reasoning'}),{ok:true});
  assert.equal(seen.length-jsonBefore,1,'planner/coordinator JSON calls also omit the unsupported field');
  assert.equal(seen.at(-1).body.reasoning,undefined);cases++;
  const go=load('electron/ai/openCodeGoCompletion.ts');
  for(const streaming of [false,true]) {
    for(const model of [`qwen-required-${streaming}`,`gpt-5.6-required-${streaming}`]) {
      const before=seen.length;
      const options={apiKey:'fixture-key',baseUrl:base,model,system:'Test',user:'Question',researchEffort:'standard',reasoning:'off',...(streaming?{onDelta:()=>{}}:{})};
      assert.equal((await go.completeWithOpenCodeGo(options)).text,'Answer');assert.equal(seen.length-before,2);cases++;
      const cached=seen.length;assert.equal((await go.completeWithOpenCodeGo(options)).text,'Answer');assert.equal(seen.length-cached,1);cases++;
    }
    const before=seen.length;
    await assert.rejects(go.completeWithOpenCodeGo({apiKey:'fixture-key',baseUrl:base,model:`qwen-required-single-${streaming}`,system:'Test',user:'Question',reasoning:'off',noRetry:true,...(streaming?{onDelta:()=>{}}:{})}));
    assert.equal(seen.length-before,1);cases++;
  }
  console.log(`Thinking compatibility: ${cases} production transport cases passed with actual SDKs, normal/streaming requests, JSON, cached recovery, native/gateway controls, metadata and noRetry.`);
} finally {
  globalThis.fetch=originalFetch;
  load('electron/db/database.ts').closeDb();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  fs.rmSync(scratch,{recursive:true,force:true});
}
