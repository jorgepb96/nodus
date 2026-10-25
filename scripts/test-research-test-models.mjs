// An isolated test profile cannot reach a provider's model catalogue (the OS sandbox
// denies the network). OpenRouter's embeddings list exactly what the paid gate forwards;
// DeepSeek's chat catalogue is read live through the gate's free /models route, so the
// application supplies no list of its own for it.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const repo = path.resolve(import.meta.dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-research-test-models-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const outfile = path.join(scratch, 'proxy.cjs');
await build({ entryPoints: [path.join(repo, 'electron/qa/researchProviderProxy.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', alias: { '@shared': path.join(repo, 'shared') } });
const { researchTestProviderModels, researchTestProviderBase, researchTestEmbeddingEndpointIdentity } = createRequire(import.meta.url)(outfile);
const ids = (provider, kind) => researchTestProviderModels(provider, kind)?.map(model => model.id) ?? null;

test('outside an isolated run every provider lists its real catalogue', () => {
  delete process.env.NODUS_RESEARCH_PROVIDER_PROXY;
  assert.equal(ids('deepseek', 'chat'), null);
  assert.equal(ids('openrouter', 'embedding'), null);
});

test('inside an isolated run the gated providers list what the gate forwards or serves', () => {
  process.env.NODUS_RESEARCH_PROVIDER_PROXY = 'http://127.0.0.1:1/00000000-0000-0000-0000-000000000000';
  try {
    const gate = fs.readFileSync(path.join(repo, 'scripts/research-provider-proxy.mjs'), 'utf8');
    const forwarded = Object.fromEntries([...gate.matchAll(/(deepseek|openrouter): \{ model: '([^']+)', route: '([^']+)'/g)].map(([, provider, model, route]) => [provider, { model, route }]));
    assert.deepEqual(forwarded, { deepseek: { model: 'deepseek-flash', route: '/chat/completions' }, openrouter: { model: 'baai/bge-m3', route: '/embeddings' } });
    assert.equal(ids('deepseek', 'chat'), null, 'DeepSeek chat metadata comes from the live catalogue the gate serves');
    assert.match(gate, /provider === 'deepseek' && match\[2\] === '\/models'/, 'the gate serves that catalogue route');
    assert.deepEqual(ids('openrouter', 'embedding'), [forwarded.openrouter.model]);
    assert.deepEqual(ids('openrouter', 'chat'), [], 'OpenRouter chat is not forwarded');
    assert.equal(ids('openai', 'chat'), null, 'other providers keep their own behaviour');
  } finally { delete process.env.NODUS_RESEARCH_PROVIDER_PROXY; }
});


test('the paid proxy retains the real embedding identity without bypassing transport validation', () => {
  const isolated=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nodus-embedding-identity-')));
  fs.writeFileSync(path.join(isolated,'isolation.json'),JSON.stringify({format:'nodus.isolated-research-profile/1',root:isolated}));
  try{
    delete process.env.NODUS_RESEARCH_PROVIDER_PROXY;
    assert.equal(researchTestEmbeddingEndpointIdentity('openrouter','https://custom.example/v1'),'https://custom.example/v1');
    process.env.NODUS_ISOLATED_ROOT=isolated;process.env.NODUS_QA_ROOT=isolated;
    process.env.NODUS_RESEARCH_PROVIDER_PROXY='http://127.0.0.1:12345/00000000-0000-0000-0000-000000000000';
    const transport=researchTestProviderBase('openrouter');assert.match(transport,/127.0.0.1:12345/);
    assert.equal(researchTestEmbeddingEndpointIdentity('openrouter',transport),'https://openrouter.ai/api/v1');
    assert.equal(researchTestEmbeddingEndpointIdentity('openrouter','https://custom.example/v1'),'https://custom.example/v1');
    process.env.NODUS_QA_ROOT='wrong';assert.throws(()=>researchTestEmbeddingEndpointIdentity('openrouter',transport),/Unvalidated/);
  }finally{delete process.env.NODUS_RESEARCH_PROVIDER_PROXY;delete process.env.NODUS_ISOLATED_ROOT;delete process.env.NODUS_QA_ROOT;fs.rmSync(isolated,{recursive:true,force:true});}
});
