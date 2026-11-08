// "Sign in with Hugging Face": the authorize URL carries PKCE S256 and the anti-forgery state,
// a callback answering another request is refused, token responses become sessions (a refresh
// keeps the refresh token and account when not reissued), sessions expire a minute early, and
// the published Client ID Metadata Document matches what the app sends.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = await mkdtemp(path.join(os.tmpdir(), 'nodus-hf-oauth-'));
test.after(() => rm(tmp, { recursive: true, force: true }));
const outfile = path.join(tmp, 'oauth.mjs');
await build({ entryPoints: [path.join(repoRoot, 'shared/huggingFaceOAuth.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const o = await import(pathToFileURL(outfile).href);

test('the authorize URL asks for PKCE S256, the state and the gated-repos scope', () => {
  const url = new URL(o.authorizeUrl({ state: 'st', challenge: 'ch' }));
  assert.equal(url.origin + url.pathname, 'https://huggingface.co/oauth/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), 'ch');
  assert.equal(url.searchParams.get('state'), 'st');
  assert.equal(url.searchParams.get('redirect_uri'), 'nodus://oauth/huggingface');
  assert.match(url.searchParams.get('scope'), /gated-repos/);
});

test('callbacks: only the answer to this request yields a code', () => {
  assert.equal(o.isHuggingFaceCallback('nodus://oauth/huggingface?code=a&state=b'), true);
  assert.equal(o.isHuggingFaceCallback('nodus://passage/x'), false);
  assert.equal(o.codeFromCallback('nodus://oauth/huggingface?code=abc&state=st', 'st'), 'abc');
  assert.throws(() => o.codeFromCallback('nodus://oauth/huggingface?code=abc&state=other', 'st'), /HF_OAUTH_STATE_MISMATCH/);
  assert.throws(() => o.codeFromCallback('nodus://oauth/huggingface?error=access_denied&state=st', 'st'), /HF_OAUTH_DENIED/);
  assert.throws(() => o.codeFromCallback('nodus://oauth/huggingface?state=st', 'st'), /HF_OAUTH_INVALID_RESPONSE/);
});

test('token responses become sessions; refreshes keep what was not reissued', () => {
  const now = 1_000_000;
  const first = o.sessionFromTokenResponse({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 }, null, now);
  assert.deepEqual(first, { accessToken: 'a1', refreshToken: 'r1', expiresAt: now + 3_600_000 });
  const refreshed = o.sessionFromTokenResponse({ access_token: 'a2', expires_in: 60 }, { ...first, account: 'jorge' }, now);
  assert.equal(refreshed.refreshToken, 'r1');
  assert.equal(refreshed.account, 'jorge');
  assert.throws(() => o.sessionFromTokenResponse({}, null, now), /HF_OAUTH_INVALID_RESPONSE/);
  assert.equal(o.sessionExpired({ accessToken: 'x', expiresAt: now + 30_000 }, now), true, 'expires a minute early');
  assert.equal(o.sessionExpired({ accessToken: 'x', expiresAt: now + 120_000 }, now), false);
  assert.equal(o.sessionExpired({ accessToken: 'x' }, now), false);
  assert.equal(o.tokenRequestBody({ b: '2 3', a: 'x/y' }), 'a=x%2Fy&b=2%203');
  assert.equal(o.exchangeFields('c', 'v').code_verifier, 'v');
  assert.equal(o.accountFromUserInfo({ preferred_username: 'jorge' }), 'jorge');
  assert.equal(o.accountFromUserInfo({}), undefined);
});

test('the published client document matches the app', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oauth/huggingface-client.json'), 'utf8'));
  assert.equal(doc.client_id, o.HF_OAUTH_CLIENT_ID);
  assert.deepEqual(doc.redirect_uris, [o.HF_OAUTH_REDIRECT_URI]);
  assert.equal(doc.scope, o.HF_OAUTH_SCOPE);
  assert.equal(doc.token_endpoint_auth_method, 'none', 'a public client: no secret ships in the app');
});
