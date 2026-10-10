// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { constants as bufferLimits } from 'node:buffer';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Store, digest, pairingCode, token } from './lib/store.mjs';
import { DEFAULT_MAX_MUTATION_BYTES } from './lib/core/mutations.mjs';
import { lexicalSearch } from './lib/core/search.mjs';
import { SnapshotCache } from './lib/snapshotCache.mjs';
import { body, contentSecurityPolicy, cookies, escapeHtml, form, html, json, jsonBody, redirect, staticAsset } from './lib/http.mjs';
import { normalizeServerLanguage, serverTranslator } from './lib/i18n.mjs';
import { helpTip, languagePicker, nodusMark, NODUS_FAVICON_SVG, WEB_SCRIPT, WEB_STYLES } from './lib/webUi.mjs';
import { can as canRole, isSpaceRole, normalizeSpaceRole, SPACE_ROLES } from './lib/roles.mjs';
import { createAuthorizer } from './lib/auth.mjs';
import { createApiRoutes } from './lib/routes/api.mjs';
import { createCorpusRoutes } from './lib/routes/corpus.mjs';
import { NODUS_LICENSE, NODUS_SOURCE_URL, NODUS_VERSION } from './lib/version.mjs';
import { readAsset } from './lib/assets.mjs';
import { VAULT_TYPE_COLORS } from './lib/core/generated/vaultColors.mjs';
import { PrivateAnnotationStore } from './lib/privateAnnotations.mjs';
import { UserAIStore, redactStructured } from './lib/ai/index.mjs';
import { ProviderGateway } from './lib/ai/providerGateway.mjs';
import { UserPrivateDataStore } from './lib/privateDataStore.mjs';
import { createAIRoutes } from './lib/routes/ai.mjs';
import { UserArtifactStore } from './lib/userArtifacts.mjs';
import { createArtifactRoutes } from './lib/routes/artifacts.mjs';
import { createNativeVaultRoutes } from './lib/routes/nativeVaults.mjs';
import { deepResearchPdfBytes } from './lib/core/deepResearchPdf.mjs';
import { acquireDataDirectoryLock } from './lib/dataDirectoryLock.mjs';
import { BridgeRelay } from './lib/bridgeRelay.mjs';

// A zero, a `200m`-style unit or a value past what Node can hold in a single buffer
// would otherwise reach zlib and turn every publication into an opaque rejection, so
// an unusable limit stops the server at boot the way a half-configured admin does.
function byteLimit(name, fallback, ceiling) {
  const configured = String(process.env[name] ?? '').trim();
  if (!configured) return fallback;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 64 * 1024 || value > ceiling) {
    throw new Error(`${name} must be a whole number of bytes between ${64 * 1024} and ${ceiling}.`);
  }
  return value;
}

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.NODUS_DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.NODUS_PORT || 7443);
/** Addresses the main listener binds. A comma-separated list binds several. */
const HOSTS = String(process.env.NODUS_HOST || '0.0.0.0').split(',').map((value) => value.trim()).filter(Boolean);
/**
 * Optional second listener: plain HTTP, loopback only, same port.
 *
 * Only meaningful together with TLS, and it exists for one situation. When Nodus Desktop runs
 * this server itself and serves the local network over a self-signed certificate, the desktop
 * would have to validate its own certificate to publish into it — and Node's fetch has no way
 * to be handed a certificate authority after the process has started. Rather than weaken
 * certificate checking anywhere, the desktop gets a channel that needs none: 127.0.0.1 never
 * leaves the machine, so there is nothing on that path to encrypt against.
 */
const LOOPBACK_PORT = Number(process.env.NODUS_LOOPBACK_PORT || 0);
const SETUP_TOKEN = process.env.NODUS_SETUP_TOKEN || '';
/**
 * Serve TLS directly instead of behind a reverse proxy.
 *
 * The Docker recipe terminates HTTPS in Caddy or Nginx and this stays empty. Nodus Desktop's
 * basic mode has no proxy to lean on, so it hands the server a certificate of its own. Half a
 * pair is refused at boot rather than quietly falling back to cleartext: a typo in one variable
 * name must not be the reason passwords cross a wifi network unencrypted.
 */
const TLS = tlsMaterial();
/**
 * Path to the shared secret that lets the desktop that launched this process provision its own
 * spaces. Empty for every Docker deployment, so the endpoint below does not exist there at all.
 */
const LOCAL_PROVISION_FILE = process.env.NODUS_LOCAL_PROVISION_FILE || '';

function tlsMaterial() {
  const certFile = String(process.env.NODUS_TLS_CERT_FILE ?? '').trim();
  const keyFile = String(process.env.NODUS_TLS_KEY_FILE ?? '').trim();
  if (!certFile && !keyFile) return null;
  if (!certFile || !keyFile) throw new Error('NODUS_TLS_CERT_FILE and NODUS_TLS_KEY_FILE must be configured together.');
  try {
    return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  } catch (error) {
    throw new Error(`Could not read the configured TLS material: ${error.message}`);
  }
}
/** How large the gzipped upload may be on the wire. Mirror it in your proxy. */
const MAX_SNAPSHOT_BYTES = byteLimit('NODUS_MAX_SNAPSHOT_BYTES', 100 * 1024 * 1024, bufferLimits.MAX_LENGTH);
// A publication travels gzipped but is expanded into one JSON string before parsing,
// and JSON of this shape shrinks around ten times over: the upload cap says nothing
// about the memory the expanded projection needs, so it gets a ceiling of its own
// rather than borrowing the one meant for the wire. Sharing a single number made a
// perfectly ordinary vault fail as if its upload had been corrupt.
const MAX_SNAPSHOT_JSON_BYTES = byteLimit('NODUS_MAX_SNAPSHOT_JSON_BYTES', 384 * 1024 * 1024, bufferLimits.MAX_STRING_LENGTH);
/** One image. Comfortably above a 1536×1024 render and far below any real PDF or recording. */
const MAX_ASSET_BYTES = byteLimit('NODUS_MAX_ASSET_BYTES', 8 * 1024 * 1024, bufferLimits.MAX_LENGTH);
/** Total image budget for one space, so a shared server cannot be filled from one vault. */
const MAX_SPACE_ASSET_BYTES = byteLimit('NODUS_MAX_SPACE_ASSET_BYTES', 2 * 1024 * 1024 * 1024, bufferLimits.MAX_LENGTH);
/** One Clean Markdown + figures + supported original ZIP. */
const MAX_LIBRARY_PACKAGE_BYTES = byteLimit('NODUS_MAX_LIBRARY_PACKAGE_BYTES', 128 * 1024 * 1024, bufferLimits.MAX_LENGTH);
/** Total offline-readable published library budget for one space. */
const MAX_SPACE_LIBRARY_BYTES = byteLimit('NODUS_MAX_SPACE_LIBRARY_BYTES', 2 * 1024 * 1024 * 1024, bufferLimits.MAX_LENGTH);
const MAX_SPACE_DOCUMENT_UPDATE_BYTES = byteLimit('NODUS_MAX_SPACE_DOCUMENT_UPDATE_BYTES', 1024 * 1024 * 1024, bufferLimits.MAX_LENGTH);
const MAX_SPACE_SHARED_BLOB_BYTES = byteLimit('NODUS_MAX_SPACE_SHARED_BLOB_BYTES', 2 * 1024 * 1024 * 1024, bufferLimits.MAX_LENGTH);
const MAX_SPACE_PARTIAL_BLOB_BYTES = byteLimit('NODUS_MAX_SPACE_PARTIAL_BLOB_BYTES', 512 * 1024 * 1024, bufferLimits.MAX_LENGTH);
const MAX_VECTOR_BYTES = byteLimit('NODUS_MAX_VECTOR_BYTES', 512 * 1024 * 1024, bufferLimits.MAX_LENGTH);
/**
 * One row a collaborator may send. See DEFAULT_MAX_MUTATION_BYTES for why 256 KiB and why it
 * does not move alone.
 */
const MAX_MUTATION_BYTES = byteLimit('NODUS_MAX_MUTATION_BYTES', DEFAULT_MAX_MUTATION_BYTES, bufferLimits.MAX_LENGTH);
/**
 * One request full of them, on the wire.
 *
 * Deliberately not `MAX_MUTATION_BYTES * MAX_MUTATION_BATCH`: that product is the worst case a
 * client batching by count can hand over, and honouring it in full would mean accepting 50 MiB
 * of body, expanded to a string and then to objects — several hundred megabytes of peak for one
 * request, on a route that anyone with write access can call. 16 MiB accepts around sixty
 * maximum-size rows at once, which is far past any real queue, and refuses the rest with a
 * cursor the client keeps rather than losing.
 */
const MAX_MUTATION_BATCH_BYTES = byteLimit('NODUS_MAX_MUTATION_BATCH_BYTES', 16 * 1024 * 1024, bufferLimits.MAX_LENGTH);
/**
 * How much undrained ledger one space may hold.
 *
 * The ledger was the only write channel here with neither a quota nor a rate limit, which was
 * survivable only because a mutation could not be large. Images have had both for as long as
 * they have existed; this is the same idea. It fills only while the owner is away, and it is
 * refused with "come back later" rather than a rejection, because the condition resolves
 * itself the moment the owner opens Nodus and drains.
 */
const MAX_LEDGER_BYTES = byteLimit('NODUS_MAX_LEDGER_BYTES', 256 * 1024 * 1024, bufferLimits.MAX_LENGTH);
const MAX_PRIVATE_ANNOTATIONS_BYTES = byteLimit('NODUS_MAX_PRIVATE_ANNOTATIONS_BYTES', 8 * 1024 * 1024, bufferLimits.MAX_LENGTH);
const MAX_PRIVATE_ANNOTATIONS = Number(process.env.NODUS_MAX_PRIVATE_ANNOTATIONS || 10_000);
/**
 * How long an unreferenced image survives before the sweeper takes it.
 *
 * Not politeness — it closes a race. A writer uploads an image and then sends the mutation
 * that points at it; a republication landing in between would legitimately not mention that
 * hash yet, and an eager sweep would delete bytes still in flight.
 */
const ASSET_GRACE_MS = 24 * 60 * 60_000;
const dataDirectoryLock = acquireDataDirectoryLock(DATA_DIR);
const store = new Store(DATA_DIR);
const DEPLOYMENT_MODE = String(process.env.NODUS_DEPLOYMENT_MODE || 'basic').toLowerCase();
const aiJobRetention = Number(process.env.NODUS_AI_JOB_RETENTION_MS || 7 * 24 * 60 * 60_000);
const aiMaxJobs = Number(process.env.NODUS_AI_MAX_JOBS || 1_000);
const aiMaxActivePerUser = Number(process.env.NODUS_AI_MAX_ACTIVE_PER_USER || 4);
const aiMaxActiveGlobal = Number(process.env.NODUS_AI_MAX_ACTIVE_GLOBAL || 32);
if (!Number.isSafeInteger(aiMaxActivePerUser) || aiMaxActivePerUser < 1 || aiMaxActivePerUser > 100) {
  throw new Error('NODUS_AI_MAX_ACTIVE_PER_USER must be a whole number between 1 and 100.');
}
if (!Number.isSafeInteger(aiMaxActiveGlobal) || aiMaxActiveGlobal < aiMaxActivePerUser || aiMaxActiveGlobal > 1_000) {
  throw new Error('NODUS_AI_MAX_ACTIVE_GLOBAL must be a whole number between the per-user limit and 1000.');
}
const privateData = new UserPrivateDataStore(path.join(DATA_DIR, 'private'), {
  jobRetentionMs: Number.isFinite(aiJobRetention) && aiJobRetention > 0 ? aiJobRetention : undefined,
  maxJobs: Number.isSafeInteger(aiMaxJobs) && aiMaxJobs > 0 ? aiMaxJobs : undefined,
});
const userArtifacts = new UserArtifactStore(path.join(DATA_DIR, 'private'));
// Resolve jobs left in queued/running state before opening the listener. A process restart
// cannot resume an in-memory provider promise, so those records become deterministic failures.
privateData.recoverJobs();
const AI_KEYRING_FILE = String(process.env.NODUS_AI_KEYRING_FILE || '').trim();
const aiStore = AI_KEYRING_FILE ? new UserAIStore(path.join(DATA_DIR, 'private'), {
  keyringPath: AI_KEYRING_FILE,
  createKeyring: /^(1|true|yes)$/i.test(String(process.env.NODUS_AI_CREATE_KEYRING || '')),
  installationId: store.state.settings.instanceId,
}) : null;
const providerGateway = aiStore ? new ProviderGateway(aiStore) : null;
const privateAnnotations = new PrivateAnnotationStore(DATA_DIR, {
  maxBytes: MAX_PRIVATE_ANNOTATIONS_BYTES,
  maxAnnotations: Number.isSafeInteger(MAX_PRIVATE_ANNOTATIONS) && MAX_PRIVATE_ANNOTATIONS > 0 ? MAX_PRIVATE_ANNOTATIONS : 10_000,
});
/**
 * How much expanded publication the parsed-snapshot cache may hold.
 *
 * A parsed snapshot is the largest thing this process ever holds — 331 MB of heap for a real
 * academic corpus of 1,214 works — so the cache needs a ceiling. It used to be a count of
 * three, which is a different amount of memory for every deployment that has ever run this
 * server: a gigabyte for that corpus, and a needless eviction for anybody with eight small
 * spaces. The budget is measured in expanded JSON bytes, and the heap it implies is roughly
 * 3.3x that. 128 MiB therefore holds one very large space or a dozen ordinary ones; raise it
 * on a machine that has the memory and several large spaces to serve.
 */
const MAX_SNAPSHOT_CACHE_BYTES = byteLimit('NODUS_MAX_SNAPSHOT_CACHE_BYTES', 128 * 1024 * 1024, bufferLimits.MAX_LENGTH);
if (String(process.env.NODUS_MAX_CACHED_SNAPSHOTS ?? '').trim()) {
  // Silently ignoring it would leave an operator believing they had capped this process.
  throw new Error('NODUS_MAX_CACHED_SNAPSHOTS has been replaced by NODUS_MAX_SNAPSHOT_CACHE_BYTES, which bounds the cache by the memory it uses instead of by a count of snapshots of any size.');
}
const snapshotCache = new SnapshotCache(MAX_SNAPSHOT_CACHE_BYTES);
const rateBuckets = new Map();
const SCOPES = new Set(['profile', 'spaces.read', 'materials.read', 'materials.write', 'assets.read']);
const MCP_PROTOCOLS = new Set(['2025-11-25', '2025-06-18', '2025-03-26']);
const AUTH_BODY_BYTES = 32 * 1024;
const MAX_RATE_BUCKETS = 20_000;
const languageContext = new AsyncLocalStorage();
const TRUST_PROXY = /^(1|true|yes)$/i.test(String(process.env.NODUS_TRUST_PROXY || ''));

function environmentCredential(name) {
  const direct = process.env[name] || '';
  const file = process.env[`${name}_FILE`] || '';
  if (direct && file) throw new Error(`${name} and ${name}_FILE cannot be used together.`);
  if (!file) return direct;
  try {
    return fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  } catch {
    throw new Error(`Could not read the credential file configured by ${name}_FILE.`);
  }
}

function syncEnvironmentAdmin() {
  const email = environmentCredential('NODUS_ADMIN_EMAIL').trim();
  const password = environmentCredential('NODUS_ADMIN_PASSWORD');
  if (!email && !password) return false;
  if (!email || !password) throw new Error('NODUS_ADMIN_EMAIL and NODUS_ADMIN_PASSWORD must be configured together.');
  const result = store.syncAdminCredentials(email, password);
  const changes = [result.created && 'created', result.emailChanged && 'email updated', result.passwordChanged && 'password rotated'].filter(Boolean);
  console.log(`[nodus-server] environment administrator synchronized${changes.length ? ` (${changes.join(', ')})` : ''}`);
  return true;
}

const ENVIRONMENT_ADMIN_CONFIGURED = syncEnvironmentAdmin();

/**
 * The secret behind /api/v1/local/provision, regenerated on every boot.
 *
 * Nodus Desktop's basic mode runs this process itself and needs a space per vault, but creating
 * one is an administration form built for a browser with a session and a CSRF token. Rather than
 * drive that form, the desktop reads this file — which only a process running as the same
 * operating-system user can open — and presents its contents as a bearer token.
 *
 * The file is the whole authentication story, so it is written before the listener opens and the
 * endpoint additionally refuses anything that did not arrive over loopback.
 */
const LOCAL_PROVISION_SECRET = writeLocalProvisionSecret();

function writeLocalProvisionSecret() {
  if (!LOCAL_PROVISION_FILE) return '';
  const secret = token(32);
  fs.mkdirSync(path.dirname(LOCAL_PROVISION_FILE), { recursive: true });
  fs.writeFileSync(LOCAL_PROVISION_FILE, `${secret}\n`, { encoding: 'utf8', mode: 0o600 });
  // writeFileSync's mode is ignored when the file already exists, and this one survives restarts.
  try { fs.chmodSync(LOCAL_PROVISION_FILE, 0o600); } catch { /* best effort on Windows */ }
  return secret;
}

/**
 * Whether the request reached us over loopback, judged by the socket alone.
 *
 * Deliberately not clientIp(): that trusts the X-Forwarded-For a reverse proxy appends, which is
 * exactly the header a remote caller would forge to look local.
 */
function fromLoopback(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function language() {
  return normalizeServerLanguage(languageContext.getStore() || store.state.settings.language);
}

function tr(key, variables) {
  return serverTranslator(language())(key, variables);
}

function normalizePublicUrl(value) {
  const parsed = new URL(String(value));
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('The public URL must use HTTPS.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) throw new Error('The public URL must contain only the domain or subdomain, without a path or credentials.');
  return parsed.origin;
}

function publicUrl() {
  return normalizePublicUrl(process.env.NODUS_PUBLIC_URL || store.state.settings.publicUrl || `${TLS ? 'https' : 'http'}://localhost:${PORT}`);
}

function safeReturnPath(value) {
  const candidate = String(value || '/');
  if (!candidate.startsWith('/') || candidate.startsWith('//') || /\\|%5c|[\u0000-\u001f\u007f]/i.test(candidate)) return '/';
  try {
    const base = new URL('https://nodus.invalid/');
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin || parsed.username || parsed.password) return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return '/'; }
}

/**
 * Two OAuth protected resources over one origin.
 *
 * MCP and the client API are different surfaces with different powers — an AI client reads,
 * an app reads and writes — so a token minted for one must not open the other. The boundary
 * is the resource identifier plus its scopes, which is enforced in software; a second
 * hostname would cost a second certificate and buy nothing.
 *
 * Before this existed, `oauthAccess()` compared against the MCP resource and nothing else,
 * so any future REST route would have accepted an MCP token, and vice versa.
 */
function resourceMap() {
  return { mcp: `${publicUrl()}/mcp`, api: `${publicUrl()}/api/v1` };
}

function mcpResource() {
  return resourceMap().mcp;
}

function apiResource() {
  return resourceMap().api;
}

function knownResource(value) {
  return Object.values(resourceMap()).includes(String(value));
}

const { authorize, challenge: authChallenge } = createAuthorizer({
  store,
  resourceFor: (key) => resourceMap()[key],
  publicUrl,
});

function page(title, content, options = {}) {
  if (options.variant === 'embedded') {
    const themeClass = options.theme === 'light' ? 'light' : 'dark';
    return `<!doctype html><html class="${themeClass}" lang="${escapeHtml(language())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="${themeClass === 'light' ? '#f8fafc' : '#08080d'}"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><title>${escapeHtml(title)} · Nodus Server</title><style>${WEB_STYLES}\nhtml,body{min-height:100%}.app-main{width:100%;max-width:none;margin:0;padding:20px 24px 48px}.site-header,.site-footer{display:none!important}</style><script src="/server-ui.js?v=2" defer></script></head><body data-formation="off" data-embedded="true"><main class="app-main">${content}</main></body></html>`;
  }
  const picker = languagePicker(language(), { language: tr('language') });
  const header = `<header class="site-header">
    <a class="site-brand" href="/" data-testid="nodus-brand">
      ${nodusMark('nodus-header-mark')}
      <span>Nodus Server<small>${tr('administration')}</small></span>
    </a>
    ${picker}
  </header>`;
  const main = options.variant === 'auth'
    ? `<main class="auth-main" data-testid="auth-layout">
        <canvas id="organism" class="auth-organism" aria-hidden="true"></canvas>
        <section class="auth-card"><div class="auth-identity">${nodusMark('nodus-auth-mark', 'auth-mark')}<p class="brand-kicker">Nodus Server</p><span>${tr('brandTagline')}</span></div>${content}<div class="trust-list"><span class="trust-pill">${tr('privateByDesign')}</span><span class="trust-pill">${tr('oauthProtected')}</span></div></section>
      </main>`
    : `<main class="app-main">${content}</main>`;
  const organismScript = options.variant === 'auth' ? '<script src="/organism.js?v=1" defer></script>' : '';
  return `<!doctype html><html lang="${escapeHtml(language())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#08080d"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><title>${escapeHtml(title)} · Nodus Server</title><style>${WEB_STYLES}</style><script src="/server-ui.js?v=2" defer></script>${organismScript}</head><body data-formation="off">${header}${main}<footer class="site-footer">Nodus Server ${escapeHtml(NODUS_VERSION)} · ${escapeHtml(NODUS_LICENSE)} · <a data-testid="source-code" href="${escapeHtml(NODUS_SOURCE_URL)}" rel="license source">${tr('sourceCode')}</a></footer></body></html>`;
}

function sessionFor(req) {
  return store.session(cookies(req).nodus_session);
}

function requireSession(req, res, admin = false) {
  const current = sessionFor(req);
  if (!current || (admin && current.user.role !== 'admin')) {
    redirect(res, `/login?next=${encodeURIComponent(req.url || '/')}`);
    return null;
  }
  return current;
}

function safeEqual(value, expected) {
  const actual = Buffer.from(String(value ?? ''));
  const wanted = Buffer.from(String(expected ?? ''));
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function checkCsrf(current, value) {
  return safeEqual(value, current.session.csrf);
}

function bearer(req) {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function clientIp(req) {
  // Forwarding headers are attacker-controlled unless the operator has explicitly put
  // this process behind a reverse proxy. Docker/Portainer set this flag and do not expose
  // the application listener publicly; standalone/basic mode deliberately ignores it.
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((value) => value.trim()).filter(Boolean);
  return (TRUST_PROXY ? forwarded.at(-1) : '') || req.socket.remoteAddress || 'unknown';
}

function rateLimit(req, res, key, limit, windowMs, identity = clientIp(req)) {
  const now = Date.now();
  const bucketKey = `${key}:${identity}`;
  let bucket = rateBuckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  rateBuckets.set(bucketKey, bucket);
  if (rateBuckets.size > MAX_RATE_BUCKETS) {
    for (const [candidate, value] of rateBuckets) if (value.resetAt <= now) rateBuckets.delete(candidate);
    while (rateBuckets.size > MAX_RATE_BUCKETS) rateBuckets.delete(rateBuckets.keys().next().value);
  }
  if (bucket.count <= limit) return true;
  json(res, 429, { error: 'rate_limited', error_description: 'Too many attempts. Wait a few minutes and try again.' }, {
    'retry-after': String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
  });
  return false;
}

function clearRateLimit(key, identity) {
  rateBuckets.delete(`${key}:${identity}`);
}

function validRedirectUri(value) {
  try {
    const parsed = new URL(String(value));
    if (parsed.username || parsed.password || parsed.hash) return false;
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function validPkceValue(value) {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(String(value || ''));
}

function requestedScopes(value, fallback = 'profile spaces.read materials.read') {
  const scopes = [...new Set(String(value || fallback).split(/\s+/).filter(Boolean))];
  if (scopes.length === 0 || scopes.some((scope) => !SCOPES.has(scope))) return null;
  return scopes;
}

function oauthRedirectHeaders(redirectUri) {
  // The consent form posts only to this server. Browsers also apply form-action
  // to every redirect in that navigation, so the validated OAuth callback
  // origin must be present or ChatGPT/Claude cannot receive the code. Keeping
  // the source to the exact registered origin preserves the restrictive CSP.
  const callbackOrigin = new URL(redirectUri).origin;
  return { 'content-security-policy': contentSecurityPolicy(["'self'", callbackOrigin]) };
}

function membership(userId, spaceId) {
  return store.state.memberships.find((entry) => entry.userId === userId && entry.spaceId === spaceId) ?? null;
}

/**
 * The role a device token actually operates with.
 *
 * A token paired before roles existed belongs, by construction, to whoever was publishing
 * that space, so it keeps owner powers. Refusing it would stop every installed desktop from
 * publishing the moment its server was upgraded.
 */
function ownerCount(spaceId) {
  return store.state.memberships.filter((entry) => entry.spaceId === spaceId && normalizeSpaceRole(entry.role) === 'owner').length;
}

function effectiveRole(device) {
  const entry = membership(device.userId, device.spaceId);
  return entry ? normalizeSpaceRole(entry.role) : null;
}

function oauthAccess(req, neededScope = 'materials.read') {
  const raw = bearer(req);
  if (!raw) return null;
  store.cleanup();
  const entry = store.state.accessTokens.find((candidate) => candidate.hash === digest(raw));
  if (!entry || entry.resource !== mcpResource() || !entry.scopes.includes(neededScope)) return null;
  const user = store.state.users.find((candidate) => candidate.id === entry.userId);
  return user ? { token: entry, user } : null;
}

function oauthChallenge(res, scope = 'materials.read') {
  const metadata = `${publicUrl()}/.well-known/oauth-protected-resource`;
  json(res, 401, { error: 'unauthorized', error_description: 'Sign in to Nodus to continue.' }, {
    'www-authenticate': `Bearer resource_metadata="${metadata}", scope="${scope}"`,
  });
}

function mib(value) {
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Expanded size a gzip stream declares in its trailer, or null when it is not gzip. */
function declaredGzipSize(bytes) {
  return bytes.length >= 18 && bytes[0] === 0x1f && bytes[1] === 0x8b ? bytes.readUInt32LE(bytes.length - 4) : null;
}

/**
 * Expand an uploaded publication, keeping the two ways it can fail apart: too big to
 * hold in memory, or not readable gzipped JSON at all. The trailer is only a hint —
 * it costs nothing, it names the real size in the rejection, and `maxOutputLength`
 * still enforces the limit when a client lies about it.
 */
function expandSnapshot(bytes) {
  const declared = declaredGzipSize(bytes);
  if (declared !== null && declared > MAX_SNAPSHOT_JSON_BYTES) return { reason: 'too-large', expanded: declared };
  let text;
  try {
    text = gunzipSync(bytes, { maxOutputLength: MAX_SNAPSHOT_JSON_BYTES }).toString('utf8');
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE' || error?.code === 'ERR_STRING_TOO_LONG') return { reason: 'too-large', expanded: declared };
    return { reason: 'invalid' };
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { reason: 'invalid' };
  }
}

function readSnapshot(spaceId) {
  const target = store.snapshotPath(spaceId);
  if (!fs.existsSync(target)) return null;
  const stat = fs.statSync(target);
  const cached = snapshotCache.get(spaceId, stat.mtimeMs);
  if (cached) return cached;
  // Stored publications passed the publish-time limit already, so read them against
  // the hard ceiling: lowering NODUS_MAX_SNAPSHOT_JSON_BYTES must not make a space
  // that is already on disk unreadable to every MCP client.
  const json = gunzipSync(fs.readFileSync(target), { maxOutputLength: bufferLimits.MAX_STRING_LENGTH });
  const value = JSON.parse(json.toString('utf8'));
  // The expanded length is what the cache charges this space, which is why it is measured
  // here rather than guessed from the size of the file on disk: gzip on this shape ranges
  // from four to fifteen times depending on how much of it is prose.
  snapshotCache.set(spaceId, stat.mtimeMs, value, json.length);
  return value;
}

function invalidateSnapshot(spaceId) {
  snapshotCache.delete(spaceId);
}

function rows(snapshot, table) {
  const value = snapshot?.tables?.[table];
  return Array.isArray(value) ? value : [];
}

const WORLD_ENTITIES = {
  character: { table: 'persons', id: 'person_id', title: 'display_name' },
  place: { table: 'places', id: 'place_id', title: 'name' },
  group: { table: 'world_groups', id: 'group_id', title: 'name' },
  scene: { table: 'world_scenes', id: 'scene_id', title: 'title' },
  article: { table: 'world_articles', id: 'article_id', title: 'title' },
  map: { table: 'world_maps', id: 'map_id', title: 'name' },
  thread: { table: 'world_threads', id: 'thread_id', title: 'title' },
  rule: { table: 'world_rules', id: 'rule_id', title: 'title' },
  question: { table: 'world_questions', id: 'question_id', title: 'question' },
  secret: { table: 'world_secrets', id: 'secret_id', title: 'title' },
  event: { table: 'events', id: 'event_id', title: 'label' },
};

function requireWorldSnapshot(snapshot) {
  if (snapshot?.vault?.type !== 'worldbuilding') {
    return { error: 'This tool only applies to a published Worldbuilding vault.' };
  }
  return null;
}

function worldEntityRows(snapshot, kind) {
  const def = WORLD_ENTITIES[kind];
  if (!def) return [];
  return rows(snapshot, def.table).map((row) => ({
    ...row,
    entityKind: kind,
    id: row[def.id],
    title: row[def.title] ?? '',
  }));
}

function worldEntityDetail(snapshot, kind, id) {
  const def = WORLD_ENTITIES[kind];
  if (!def) return null;
  const entity = rows(snapshot, def.table).find((row) => String(row[def.id]) === String(id));
  if (!entity) return null;
  const related = {};
  if (kind === 'character') {
    related.profile = rows(snapshot, 'character_profiles').find((row) => String(row.person_id) === String(id)) ?? null;
    related.names = rows(snapshot, 'person_names').filter((row) => String(row.person_id) === String(id));
    related.abilities = rows(snapshot, 'character_abilities').filter((row) => String(row.person_id) === String(id));
    related.affiliations = rows(snapshot, 'character_affiliations').filter((row) => String(row.person_id) === String(id));
    related.appearances = rows(snapshot, 'scene_characters').filter((row) => String(row.person_id) === String(id));
    related.eventParticipants = rows(snapshot, 'event_participants').filter((row) => String(row.person_id) === String(id));
    related.ownedSecrets = rows(snapshot, 'world_secrets').filter((row) => String(row.owner_person_id) === String(id));
    related.knownSecrets = rows(snapshot, 'secret_knowers').filter((row) => String(row.person_id) === String(id));
  } else if (kind === 'place') {
    related.profile = rows(snapshot, 'place_profiles').find((row) => String(row.place_id) === String(id)) ?? null;
    related.children = rows(snapshot, 'places').filter((row) => String(row.parent_id) === String(id));
    related.maps = rows(snapshot, 'world_maps').filter((row) => String(row.place_id) === String(id));
    related.markers = rows(snapshot, 'map_markers').filter((row) => String(row.place_id) === String(id));
    related.scenes = rows(snapshot, 'world_scenes').filter((row) => String(row.place_id) === String(id));
    related.inhabitants = rows(snapshot, 'person_places').filter((row) => String(row.place_id) === String(id));
  } else if (kind === 'group') {
    related.affiliations = rows(snapshot, 'character_affiliations').filter((row) => String(row.group_id) === String(id));
    related.threadParties = rows(snapshot, 'thread_parties').filter((row) => row.party_kind === 'group' && String(row.party_id) === String(id));
  } else if (kind === 'scene') {
    related.cast = rows(snapshot, 'scene_characters').filter((row) => String(row.scene_id) === String(id));
    related.manuscript = rows(snapshot, 'world_scene_text').find((row) => String(row.scene_id) === String(id)) ?? null;
    related.day = rows(snapshot, 'world_scene_days').find((row) => String(row.scene_id) === String(id)) ?? null;
    related.beats = rows(snapshot, 'world_beats').filter((row) => String(row.scene_id) === String(id));
    related.questions = rows(snapshot, 'world_questions').filter((row) => row.anchor_kind === 'scene' && String(row.anchor_id) === String(id));
  } else if (kind === 'article') {
    related.links = rows(snapshot, 'world_links').filter((row) => row.source_kind === 'article' && String(row.source_id) === String(id));
    related.backlinks = rows(snapshot, 'world_links').filter((row) => row.target_kind === 'article' && String(row.target_id) === String(id));
  } else if (kind === 'map') {
    related.layers = rows(snapshot, 'map_layers').filter((row) => String(row.map_id) === String(id));
    related.markers = rows(snapshot, 'map_markers').filter((row) => String(row.map_id) === String(id));
    related.travelModes = rows(snapshot, 'map_travel_modes').filter((row) => String(row.map_id) === String(id));
  } else if (kind === 'thread') {
    related.parties = rows(snapshot, 'thread_parties').filter((row) => String(row.thread_id) === String(id));
    related.beats = rows(snapshot, 'world_beats').filter((row) => String(row.thread_id) === String(id));
  } else if (kind === 'rule') {
    related.beats = rows(snapshot, 'world_beats').filter((row) => row.thread_kind === 'rule' && String(row.thread_id) === String(id));
  } else if (kind === 'question') {
    related.options = rows(snapshot, 'world_question_options').filter((row) => String(row.question_id) === String(id));
  } else if (kind === 'secret') {
    related.knowers = rows(snapshot, 'secret_knowers').filter((row) => String(row.secret_id) === String(id));
  } else if (kind === 'event') {
    related.participants = rows(snapshot, 'event_participants').filter((row) => String(row.event_id) === String(id));
    related.worldDate = rows(snapshot, 'event_world_dates').find((row) => String(row.event_id) === String(id)) ?? null;
  }
  return { kind, id, entity, related };
}

function userSpaces(userId) {
  const ids = new Set(store.state.memberships.filter((entry) => entry.userId === userId).map((entry) => entry.spaceId));
  return store.state.spaces.filter((space) => ids.has(space.id));
}

const TOOLS = [
  { name: 'nodus_list_spaces', title: 'List Nodus spaces', description: 'Lists the shared Nodus spaces the authenticated user can read.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_get_space_summary', title: 'Get space summary', description: 'Returns counts and publication metadata for one authorized Nodus space.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' } }, required: ['spaceId'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_search', title: 'Search Nodus', description: 'Searches the canonical text available in one authorized shared space, including academic and Worldbuilding corpora.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['spaceId', 'query'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_get_work', title: 'Get work', description: 'Gets one shared bibliographic work by its Nodus id.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, id: { type: 'string' } }, required: ['spaceId', 'id'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_get_idea', title: 'Get idea', description: 'Gets one shared idea and its direct relations.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, id: { type: 'string' } }, required: ['spaceId', 'id'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_world_get_overview', title: 'Get shared world overview', description: 'Returns counts, calendar and manuscript totals for one authorized Worldbuilding space.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' } }, required: ['spaceId'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_world_search', title: 'Search shared fictional world', description: 'Searches canonical character, place, group, scene, article, rule, question, secret and manuscript text in one authorized Worldbuilding space.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['spaceId', 'query'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_world_list_entities', title: 'List shared world entities', description: 'Lists one kind of entity from a Worldbuilding space. Kinds: character, place, group, scene, article, map, thread, rule, question, secret, event.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, kind: { type: 'string', enum: Object.keys(WORLD_ENTITIES) }, query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 200 }, offset: { type: 'integer', minimum: 0 } }, required: ['spaceId', 'kind'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_world_get_entity', title: 'Get shared world entity', description: 'Gets one Worldbuilding entity with its directly related profile, cast, links, beats, options or manuscript data.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, kind: { type: 'string', enum: Object.keys(WORLD_ENTITIES) }, id: { type: 'string' } }, required: ['spaceId', 'kind', 'id'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'nodus_world_get_manuscript', title: 'Get shared world manuscript', description: 'Returns ordered scene metadata, current prose and chapter/book starts from a Worldbuilding space.', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' }, includeText: { type: 'boolean' } }, required: ['spaceId'], additionalProperties: false }, annotations: { readOnlyHint: true } },
];

for (const tool of TOOLS) tool.securitySchemes = [{ type: 'oauth2', scopes: ['materials.read'] }];

function toolResult(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

function callTool(auth, name, args) {
  if (name === 'nodus_list_spaces') return toolResult({ spaces: userSpaces(auth.user.id).map(({ id, name, description, updatedAt, vault }) => ({ id, name, description, updatedAt, vault: vault ?? null })) });
  const spaceId = typeof args?.spaceId === 'string' ? args.spaceId : '';
  const space = store.state.spaces.find((entry) => entry.id === spaceId);
  if (!space || !membership(auth.user.id, spaceId)) return toolResult({ error: 'You do not have access to that space.' }, true);
  const snapshot = readSnapshot(spaceId);
  if (!snapshot) return toolResult({ error: 'This space has not received a publication yet.' }, true);
  if (name === 'nodus_get_space_summary') {
    return toolResult({ space: { id: space.id, name: space.name, description: space.description, updatedAt: space.updatedAt }, vault: snapshot.vault, generatedAt: snapshot.generatedAt, counts: Object.fromEntries(Object.entries(snapshot.tables ?? {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])) });
  }
  if (name === 'nodus_search') {
    // Shared with GET /api/v1/spaces/:id/search rather than copied beside it. The copy
    // that used to live here is exactly what lib/core/search.mjs was extracted to
    // prevent, and it drifted: the fix that gave a theme or a passage hit a usable id
    // landed in one surface and not the other.
    const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
    return toolResult({ results: lexicalSearch(snapshot, args.query, limit) });
  }
  if (name === 'nodus_get_work') {
    const work = rows(snapshot, 'works').find((entry) => String(entry.nodus_id ?? entry.id) === String(args.id));
    return work ? toolResult({ work }) : toolResult({ error: 'Work not found.' }, true);
  }
  if (name === 'nodus_get_idea') {
    const idea = rows(snapshot, 'ideas').find((entry) => String(entry.global_id ?? entry.id) === String(args.id));
    if (!idea) return toolResult({ error: 'Idea not found.' }, true);
    const id = String(idea.global_id ?? idea.id);
    const relations = rows(snapshot, 'edges').filter((entry) => String(entry.from_id) === id || String(entry.to_id) === id);
    return toolResult({ idea, relations });
  }
  if (name.startsWith('nodus_world_')) {
    const wrongVault = requireWorldSnapshot(snapshot);
    if (wrongVault) return toolResult(wrongVault, true);
  }
  if (name === 'nodus_world_get_overview') {
    const counts = Object.fromEntries(Object.entries(WORLD_ENTITIES).map(([kind, def]) => [kind, rows(snapshot, def.table).length]));
    const calendar = {
      settings: rows(snapshot, 'world_calendar')[0] ?? null,
      eras: rows(snapshot, 'world_calendar_eras'),
      months: rows(snapshot, 'world_calendar_months'),
    };
    const sceneText = rows(snapshot, 'world_scene_text');
    return toolResult({
      vault: snapshot.vault,
      counts,
      calendar,
      manuscript: {
        scenes: rows(snapshot, 'world_scenes').length,
        words: sceneText.reduce((sum, row) => sum + (Number(row.word_count) || 0), 0),
        chapters: rows(snapshot, 'world_chapter_breaks').length,
        books: rows(snapshot, 'world_manuscript_starts').length,
      },
    });
  }
  if (name === 'nodus_world_search') {
    const query = String(args.query ?? '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(100, Number(args.limit) || 30));
    if (!query) return toolResult({ results: [] });
    const definitions = [
      ['character', 'persons', 'person_id', 'display_name', ['display_name', 'notes', 'biography']],
      ['character-profile', 'character_profiles', 'person_id', 'species', ['species', 'gender', 'pronouns', 'appearance', 'personality', 'backstory']],
      ['place', 'places', 'place_id', 'name', ['name', 'kind', 'notes']],
      ['place-profile', 'place_profiles', 'place_id', 'place_id', ['appearance', 'atmosphere', 'history']],
      ['group', 'world_groups', 'group_id', 'name', ['name', 'summary', 'description', 'notes']],
      ['scene', 'world_scenes', 'scene_id', 'title', ['title', 'summary', 'notes']],
      ['manuscript', 'world_scene_text', 'scene_id', 'scene_id', ['text']],
      ['article', 'world_articles', 'article_id', 'title', ['title', 'summary', 'body', 'aka', 'notes']],
      ['thread', 'world_threads', 'thread_id', 'title', ['title', 'pitch', 'stakes', 'outcome']],
      ['rule', 'world_rules', 'rule_id', 'title', ['title', 'statement', 'cost', 'limits']],
      ['question', 'world_questions', 'question_id', 'question', ['question']],
      ['secret', 'world_secrets', 'secret_id', 'title', ['title', 'content', 'notes']],
    ];
    const results = [];
    for (const [kind, table, idField, titleField, fields] of definitions) {
      for (const row of rows(snapshot, table)) {
        const text = fields.map((field) => row[field]).filter((value) => typeof value === 'string').join('\n');
        if (text.toLowerCase().includes(query)) {
          results.push({ kind, id: row[idField], title: row[titleField] ?? '', excerpt: text.slice(0, 800) });
        }
        if (results.length >= limit) return toolResult({ query: args.query, results, truncated: true });
      }
    }
    return toolResult({ query: args.query, results, truncated: false });
  }
  if (name === 'nodus_world_list_entities') {
    const kind = String(args.kind ?? '');
    if (!WORLD_ENTITIES[kind]) return toolResult({ error: 'Unknown world entity kind.' }, true);
    const query = String(args.query ?? '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, Number(args.limit) || 100));
    const offset = Math.max(0, Number(args.offset) || 0);
    const all = worldEntityRows(snapshot, kind).filter((row) => !query || JSON.stringify(row).toLowerCase().includes(query));
    return toolResult({ kind, entities: all.slice(offset, offset + limit), total: all.length, limit, offset, hasMore: offset + limit < all.length });
  }
  if (name === 'nodus_world_get_entity') {
    const detail = worldEntityDetail(snapshot, String(args.kind ?? ''), String(args.id ?? ''));
    return detail ? toolResult(detail) : toolResult({ error: 'World entity not found.' }, true);
  }
  if (name === 'nodus_world_get_manuscript') {
    const includeText = args.includeText === true;
    const texts = new Map(rows(snapshot, 'world_scene_text').map((row) => [String(row.scene_id), row]));
    const chapters = new Map(rows(snapshot, 'world_chapter_breaks').map((row) => [String(row.scene_id), row]));
    const books = new Map(rows(snapshot, 'world_manuscript_starts').map((row) => [String(row.scene_id), row]));
    const scenes = [...rows(snapshot, 'world_scenes')]
      .sort((a, b) => (Number(a.narrative_order) || 0) - (Number(b.narrative_order) || 0))
      .map((scene) => {
        const manuscript = texts.get(String(scene.scene_id)) ?? null;
        const text = typeof manuscript?.text === 'string' ? manuscript.text : null;
        return {
          ...scene,
          manuscript: manuscript ? {
            word_count: manuscript.word_count ?? 0,
            updated_at: manuscript.updated_at ?? null,
            ...(includeText ? { text } : { text_snippet: text ? text.slice(0, 800) : null }),
          } : null,
          chapter: chapters.get(String(scene.scene_id)) ?? null,
          book: books.get(String(scene.scene_id)) ?? null,
        };
      });
    return toolResult({ scenes, includeText });
  }
  return toolResult({ error: 'Unknown tool.' }, true);
}

async function handleMcp(req, res) {
  const auth = oauthAccess(req);
  if (!auth) return oauthChallenge(res);
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' });
  const request = await jsonBody(req, 2 * 1024 * 1024);
  if (request.method === 'notifications/initialized') return json(res, 202, {});
  let result;
  let protocolVersion = MCP_PROTOCOLS.has(req.headers['mcp-protocol-version']) ? req.headers['mcp-protocol-version'] : '2025-11-25';
  if (request.method === 'initialize') {
    protocolVersion = MCP_PROTOCOLS.has(request.params?.protocolVersion) ? request.params.protocolVersion : '2025-11-25';
    result = { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'nodus-server', version: NODUS_VERSION, license: NODUS_LICENSE, sourceCodeUrl: NODUS_SOURCE_URL, description: 'Read-only access to explicitly shared Nodus vaults, including Worldbuilding spaces.' }, instructions: 'Consult only spaces authorized for this user. Use nodus_list_spaces before querying a space and inspect its vault type. Shared data is read-only; use nodus_world_* tools for Worldbuilding spaces.' };
  } else if (request.method === 'tools/list') result = { tools: TOOLS };
  else if (request.method === 'tools/call') result = callTool(auth, request.params?.name, request.params?.arguments ?? {});
  else return json(res, 200, { jsonrpc: '2.0', id: request.id ?? null, error: { code: -32601, message: 'Method not found' } });
  return json(res, 200, { jsonrpc: '2.0', id: request.id ?? null, result }, { 'mcp-protocol-version': protocolVersion });
}

function setupPage(error = '') {
  return page(tr('setupTitle'), `<p class="eyebrow">${tr('setupTitle')}</p><h1>${tr('setupHeading')}</h1><p class="lead">${tr('setupIntro')}</p>${error ? `<p class="warn">${escapeHtml(error)}</p>` : ''}<form class="card" method="post" action="/setup">
    <div class="field"><div class="label-line"><label for="setup-token">${tr('setupToken')}</label>${helpTip(tr('setupTokenHelp'), tr('moreInformation'))}</div><input id="setup-token" name="setupToken" type="password" maxlength="1024" required></div>
    <div class="field"><label for="server-name">${tr('serverName')}</label><input id="server-name" name="name" value="Nodus Server" maxlength="120" required></div>
    <div class="field"><div class="label-line"><label for="public-url">${tr('publicUrl')}</label>${helpTip(tr('publicUrlHelp'), tr('moreInformation'))}</div><input id="public-url" name="publicUrl" type="url" placeholder="https://nodus.example.com" maxlength="2048" required></div>
    <div class="field"><label for="admin-email">${tr('adminEmail')}</label><input id="admin-email" name="email" type="email" autocomplete="username" maxlength="320" required></div>
    <div class="field"><label for="admin-password">${tr('adminPassword')}</label><input id="admin-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required></div>
    <button type="submit">${tr('createServer')}</button>
  </form>`, { variant: 'auth' });
}

function loginPage(next = '/', error = '', csrf = '') {
  return page(tr('loginTitle'), `<p class="eyebrow">${tr('oauthProtected')}</p><h1>${tr('loginHeading')}</h1><p class="lead">${tr('serverReady')}</p>${error ? `<p class="warn">${escapeHtml(error)}</p>` : ''}<form class="card" method="post" action="/login">
    <input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <div class="field"><label for="login-email">${tr('email')}</label><input id="login-email" name="email" type="email" autocomplete="username" maxlength="320" required autofocus></div>
    <div class="field"><label for="login-password">${tr('password')}</label><input id="login-password" name="password" type="password" autocomplete="current-password" maxlength="1024" required></div>
    <button type="submit">${tr('signIn')}</button>
  </form>`, { variant: 'auth' });
}

function loginCsrfCookie(value, { clear = false } = {}) {
  return `nodus_login_csrf=${encodeURIComponent(value)}; Path=/login; HttpOnly; SameSite=Strict${clear ? '; Max-Age=0' : '; Max-Age=600'}${publicUrl().startsWith('https://') ? '; Secure' : ''}`;
}

function loginRequestSameOrigin(req) {
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return false;
  let supplied = String(req.headers.origin || '').trim();
  // Chromium serializes the Origin as `null` for a same-origin form POST when the
  // response carries Referrer-Policy: no-referrer. Fetch Metadata remains trustworthy
  // in that case. Sandboxed/cross-site forms have a different Sec-Fetch-Site value.
  if (supplied === 'null') return fetchSite === 'same-origin';
  if (!supplied && req.headers.referer) {
    try { supplied = new URL(String(req.headers.referer)).origin; } catch { return false; }
  }
  if (!supplied) return true; // Non-browser clients still need the unguessable form token.
  try { return new URL(supplied).origin === new URL(publicUrl()).origin; } catch { return false; }
}

function accountPage(current, notice = '', error = '') {
  const adminLink = current.user.role === 'admin' ? `<a class="button-link" href="/">${tr('administration')}</a>` : '';
  return page(tr('accountTitle'), `<div class="page-heading">
    <div><p class="eyebrow">${tr('oauthProtected')}</p><h1>${tr('accountTitle')}</h1><p class="lead">${escapeHtml(current.user.email)}</p></div>
    <div class="heading-actions">${adminLink}<form method="post" action="/logout"><input type="hidden" name="csrf" value="${current.session.csrf}"><button class="secondary" type="submit">${tr('signOut')}</button></form></div>
  </div>
  ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ''}${error ? `<p class="warn">${escapeHtml(error)}</p>` : ''}
  <form class="card" method="post" action="/account/password">
    <div class="section-header"><div><h2>${tr('changePassword')}</h2><p>${tr('passwordHelp')}</p></div></div>
    <input type="hidden" name="csrf" value="${current.session.csrf}">
    <div class="grid">
      <div class="field"><label for="current-password">${tr('currentPassword')}</label><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required></div>
      <div></div>
      <div class="field"><label for="new-password">${tr('newPassword')}</label><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="12" required></div>
      <div class="field"><label for="confirm-password">${tr('repeatPassword')}</label><input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required></div>
    </div>
    <button type="submit">${tr('changePassword')}</button>
  </form>`);
}

function resetPasswordPage(current, user, error = '') {
  const visibleEmail = store.sensitiveAccessValid(current.session) ? user.email : maskEmail(user.email);
  return page(tr('resetPassword'), `<div class="page-heading"><div><p class="eyebrow">${tr('usersAccess')}</p><h1>${tr('resetPassword')}</h1><p class="lead">${escapeHtml(visibleEmail)}</p></div><a class="button-link" href="/">${tr('backAdmin')}</a></div>${error ? `<p class="warn">${escapeHtml(error)}</p>` : ''}<form class="card" method="post" action="/admin/users/password">
    <p class="muted">${tr('resetHelp')}</p>
    <input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="userId" value="${user.id}">
    <div class="grid">
      <div class="field"><label for="temporary-password">${tr('temporaryPassword')}</label><input id="temporary-password" name="newPassword" type="password" autocomplete="new-password" minlength="12" required></div>
      <div class="field"><label for="temporary-password-confirm">${tr('repeatPassword')}</label><input id="temporary-password-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" required></div>
    </div>
    <button type="submit">${tr('resetPassword')}</button>
  </form>`);
}

const ROLE_LABEL_KEYS = { reader: 'roleReader', writer: 'roleWriter', owner: 'roleOwner' };
const VAULT_TYPES = ['academic', 'primary_sources', 'genealogy', 'databases', 'estudio', 'docencia', 'testimonios', 'prosopography', 'worldbuilding'];
const VAULT_TYPE_LABEL_KEYS = {
  academic: 'vaultTypeAcademic', primary_sources: 'vaultTypePrimarySources', genealogy: 'vaultTypeGenealogy',
  databases: 'vaultTypeDatabases', estudio: 'vaultTypeStudy', docencia: 'vaultTypeTeaching',
  testimonios: 'vaultTypeTestimonies', prosopography: 'vaultTypeProsopography', worldbuilding: 'vaultTypeWorldbuilding',
};

function roleLabel(role) {
  return tr(ROLE_LABEL_KEYS[normalizeSpaceRole(role)]);
}

function roleOptions(selected) {
  return SPACE_ROLES.map((role) => `<option value="${role}"${role === normalizeSpaceRole(selected) ? ' selected' : ''}>${escapeHtml(roleLabel(role))}</option>`).join('');
}

function normalizeVaultType(value) {
  const type = String(value || '').trim();
  return VAULT_TYPES.includes(type) ? type : '';
}

function spaceVaultType(space) {
  return normalizeVaultType(space?.vault?.type || space?.vaultType);
}

function vaultTypeLabel(type) {
  const normalized = normalizeVaultType(type);
  return normalized ? tr(VAULT_TYPE_LABEL_KEYS[normalized]) : tr('vaultTypePending');
}

function vaultTypeOptions(selected = 'academic') {
  const normalized = normalizeVaultType(selected) || 'academic';
  return VAULT_TYPES.map((type) => `<option value="${type}"${type === normalized ? ' selected' : ''}>${escapeHtml(vaultTypeLabel(type))}</option>`).join('');
}

function vaultBadge(space) {
  const type = spaceVaultType(space);
  const accent = type ? VAULT_TYPE_COLORS[type] : '#71717a';
  return `<span class="vault-type" data-vault-type="${escapeHtml(type || 'pending')}" style="--vault-accent:${escapeHtml(accent)}">${escapeHtml(vaultTypeLabel(type))}</span>`;
}

/**
 * One checkbox plus one role selector per space.
 *
 * The keys are namespaced per space (`space:<id>` / `role:<id>`) rather than repeated under
 * a single name, because `form()` builds a plain object from URLSearchParams and a repeated
 * key would silently collapse to its last value — which is exactly how a multi-space grant
 * would quietly become a single-space one.
 */
function spaceGrantPicker(entries = [], idPrefix = 'new-user') {
  if (store.state.spaces.length === 0) return `<p class="muted">${tr('noSpacesYet')}</p>`;
  const assigned = new Map(entries.map((entry) => [entry.spaceId, entry]));
  return `<div class="grant-list">${store.state.spaces.map((space) => {
    const entry = assigned.get(space.id);
    const checked = Boolean(entry);
    const locked = entry?.role === 'owner' && ownerCount(space.id) <= 1;
    const inputId = `${idPrefix}-space-${space.id}`;
    return `<div class="grant-row" data-testid="grant-${escapeHtml(idPrefix)}-${space.id}">
      <label class="grant-choice" for="${escapeHtml(inputId)}">
        <input id="${escapeHtml(inputId)}" type="checkbox" name="space:${space.id}" value="on"${checked ? ' checked' : ''}${locked ? ' disabled' : ''}>
        ${locked ? `<input type="hidden" name="space:${space.id}" value="on">` : ''}
        <span class="grant-vault">${vaultBadge(space)}<strong>${escapeHtml(space.name)}</strong>${locked ? `<small class="locked-owner"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>${escapeHtml(tr('lockedOwner'))}</small>` : ''}</span>
      </label>
      <div class="grant-role"><label for="${escapeHtml(inputId)}-role">${escapeHtml(tr('accessLevel'))}</label><select id="${escapeHtml(inputId)}-role" name="role:${space.id}" aria-label="${escapeHtml(`${tr('accessLevel')}: ${space.name}`)}"${locked ? ' disabled' : ''}>${roleOptions(entry?.role || 'reader')}</select>${locked ? `<input type="hidden" name="role:${space.id}" value="owner">` : ''}</div>
    </div>`;
  }).join('')}</div>`;
}

function readSpaceGrants(values) {
  const grants = [];
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith('space:') || value !== 'on') continue;
    const spaceId = key.slice('space:'.length);
    if (!store.state.spaces.some((space) => space.id === spaceId)) continue;
    grants.push({ spaceId, role: normalizeSpaceRole(values[`role:${spaceId}`]) });
  }
  // The form used to carry a single `spaceId` with an implicit reader role. Anything that
  // still posts that shape keeps working rather than silently creating an account with no
  // access at all, which is the failure mode that would be hardest to notice.
  if (grants.length === 0 && values.spaceId && store.state.spaces.some((space) => space.id === values.spaceId)) {
    grants.push({ spaceId: values.spaceId, role: normalizeSpaceRole(values.role) });
  }
  return grants;
}

function copyButton(value, copyLabel, copiedLabel, testId, className = 'copy-endpoint') {
  return `<button type="button" class="${escapeHtml(className)}" data-testid="${escapeHtml(testId)}" data-copy-value="${escapeHtml(value)}" data-copy-label="${escapeHtml(copyLabel)}" data-copied-label="${escapeHtml(copiedLabel)}" aria-label="${escapeHtml(copyLabel)}" title="${escapeHtml(copyLabel)}">
    <svg class="copy-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>
    <svg class="check-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
  </button>`;
}

function endpointRow(label, help, value, testId) {
  return `<div class="endpoint-group">
    <div class="section-title"><h2>${escapeHtml(label)}</h2>${helpTip(help, tr('moreInformation'))}</div>
    <div class="endpoint">
      <code data-testid="${testId}">${escapeHtml(value)}</code>
      ${copyButton(value, tr('copyUrl'), tr('urlCopied'), `${testId}-copy`)}
      <span class="copy-feedback" data-copy-feedback aria-live="polite"></span>
    </div>
  </div>`;
}

function publishedLibraryMeta(space) {
  if (!space.updatedAt) return '';
  const library = readSnapshot(space.id)?.library;
  const valid = library?.format === 'nodus.server-library' && Number(library?.formatVersion) === 1;
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8"/></svg>';
  if (!valid) return `<span class="publication-meta muted-library">${icon}${escapeHtml(tr('libraryNotShared'))}</span>`;
  const count = Array.isArray(library.documents) ? library.documents.length : 0;
  const label = count === 1 ? tr('publishedLibraryOne') : tr('publishedLibraryCount', { count });
  return `<span class="publication-meta" data-testid="published-library-${escapeHtml(space.id)}">${icon}${escapeHtml(label)}</span>`;
}

function dashboard(current, notice = '', options = {}) {
  const emailsUnlocked = store.sensitiveAccessValid(current.session);
  const spaces = store.state.spaces.map((space) => {
    const policy = space.publicationPolicy && typeof space.publicationPolicy === 'object' ? space.publicationPolicy : {};
    const checked = (field) => policy[field] === true || (field === 'allowPersonalImports' && policy.allowLegacyPublisherImport === true) ? ' checked' : '';
    return `<tr>
    <td><div class="space-name"><div class="space-heading">${vaultBadge(space)}<strong>${escapeHtml(space.name)}</strong></div>${space.description ? `<div class="muted">${escapeHtml(space.description)}</div>` : ''}${publishedLibraryMeta(space)}</div>
      <details class="inline-editor"><summary>${escapeHtml(tr('editSpaceName'))}</summary><form method="post" action="/admin/spaces/name"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="spaceId" value="${space.id}"><input name="name" value="${escapeHtml(space.name)}" maxlength="120" aria-label="${escapeHtml(tr('name'))}" required><button class="secondary" type="submit">${escapeHtml(tr('saveName'))}</button></form></details>
    </td>
    <td><div class="space-id"><code>${space.id}</code>${copyButton(space.id, tr('copySpaceId'), tr('spaceIdCopied'), `space-id-copy-${space.id}`, 'copy-endpoint copy-id')}<span class="copy-feedback" data-copy-feedback aria-live="polite"></span></div></td>
    <td>${escapeHtml(space.updatedAt || tr('unpublished'))}</td>
    <td><form method="post" action="/admin/pairing"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="spaceId" value="${space.id}"><button class="secondary" type="submit">${tr('createPairing')}</button></form>${space.updatedAt ? `<form method="post" action="/admin/spaces/clear-request"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="spaceId" value="${space.id}"><button class="danger" type="submit">${tr('deletePublication')}</button></form>` : ''}
      <details class="inline-editor publication-policy"><summary>Publication policy</summary><form method="post" action="/admin/spaces/policy"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="spaceId" value="${space.id}">
        <label><input type="checkbox" name="allowLibraryDocuments" value="on"${checked('allowLibraryDocuments')}> Library documents</label>
        <label><input type="checkbox" name="allowPassages" value="on"${checked('allowPassages')}> Extracted passages</label>
        <label><input type="checkbox" name="allowUserContent" value="on"${checked('allowUserContent')}> Authored notes and projects</label>
        <label><input type="checkbox" name="allowVectors" value="on"${checked('allowVectors')}> Semantic indexes</label>
        <label><input type="checkbox" name="allowPrimarySources" value="on"${checked('allowPrimarySources')}> Primary-source text</label>
        <label><input type="checkbox" name="allowTestimonies" value="on"${checked('allowTestimonies')}> Testimony transcripts</label>
        <label><input type="checkbox" name="allowPersonalImports" value="on"${checked('allowPersonalImports')}> Import publisher's private annotations</label>
        <small class="muted">Credentials, local paths, media, contacts, agreements, students, grades and attempts are always excluded.</small>
        <button class="secondary" type="submit">Save policy</button>
      </form></details>
    </td>
  </tr>`;
  }).join('');
  const users = store.state.users.map((user) => {
    const entries = store.state.memberships.filter((entry) => entry.userId === user.id);
    const reset = user.role === 'member' ? `<a href="/admin/users/password?userId=${encodeURIComponent(user.id)}">${tr('resetPassword')}</a>` : `<a href="/account">${tr('changeMyPassword')}</a>`;
    const accountLabel = user.role === 'admin' ? tr('administrator') : tr('memberAccount');
    const visibleEmail = emailsUnlocked ? user.email : maskEmail(user.email);
    const emailEditor = emailsUnlocked
      ? ENVIRONMENT_ADMIN_CONFIGURED && user.role === 'admin'
        ? `<div class="email-readonly"><strong>${escapeHtml(user.email)}</strong><span class="muted">${escapeHtml(tr('environmentEmailReadonly'))}</span></div>`
        : `<form class="email-edit-form" method="post" action="/admin/users/email"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="userId" value="${user.id}"><input name="email" type="email" value="${escapeHtml(user.email)}" maxlength="320" aria-label="${escapeHtml(tr('email'))}" required><button class="secondary" type="submit">${escapeHtml(tr('saveEmail'))}</button></form>`
      : `<strong data-testid="masked-email-${escapeHtml(user.id)}">${escapeHtml(visibleEmail)}</strong>`;
    return `<article class="user-card" data-testid="user-${escapeHtml(user.id)}">
      <div class="user-card-header"><div class="user-identity"><span class="user-avatar" aria-hidden="true">${escapeHtml(user.email.slice(0, 1))}</span><div>${emailEditor}<span class="account-tag">${escapeHtml(accountLabel)}</span></div></div>${reset}</div>
      <form class="user-access-form" method="post" action="/admin/users/access">
        <input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="userId" value="${user.id}">
        <div class="user-access-heading"><div><h3>${escapeHtml(tr('assignedVaults'))}</h3><p>${escapeHtml(tr('manageAccessHelp'))}</p></div></div>
        ${spaceGrantPicker(entries, `user-${user.id}`)}
        <button class="secondary" type="submit">${escapeHtml(tr('saveAccess'))}</button>
      </form>
    </article>`;
  }).join('');
  const devices = store.state.deviceTokens.map((device) => {
    const space = store.state.spaces.find((entry) => entry.id === device.spaceId);
    return `<tr><td><strong>${escapeHtml(device.deviceName)}</strong></td><td>${escapeHtml(space?.name || device.spaceId)}</td><td>${escapeHtml(device.lastUsedAt || tr('never'))}</td><td><form method="post" action="/admin/devices/revoke"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="tokenHash" value="${device.hash}"><button class="secondary" type="submit">${tr('revokeAccess')}</button></form></td></tr>`;
  }).join('');
  return page(tr('administration'), `<div class="page-heading">
    <div><p class="eyebrow">${tr('administration')}</p><h1>${escapeHtml(store.state.settings.name)}</h1><p class="lead">${tr('serverReady')}</p></div>
    <div class="heading-actions"><a class="button-link" href="/account">${tr('accountTitle')}</a><form method="post" action="/logout"><input type="hidden" name="csrf" value="${current.session.csrf}"><button class="secondary" type="submit">${tr('signOut')}</button></form></div>
  </div>
  <section class="server-overview">
    <div>
      <div class="status-line"><span class="status-dot"></span>${tr('administration')}</div>
      <div class="endpoint-list">
        ${endpointRow(tr('serverUrl'), tr('publicUrlHelp'), publicUrl(), 'server-url')}
        ${endpointRow(tr('mcpUrl'), tr('mcpHelp'), mcpResource(), 'mcp-url')}
      </div>
    </div>
    <div class="metric-grid">
      <div class="metric"><strong>${store.state.spaces.length}</strong><span>${tr('spaces')}</span></div>
      <div class="metric"><strong>${store.state.users.length}</strong><span>${tr('usersAccess')}</span></div>
      <div class="metric"><strong>${store.state.deviceTokens.length}</strong><span>${tr('publisherDevices')}</span></div>
    </div>
  </section>
  ${notice ? `<p class="ok">${escapeHtml(notice)}</p>` : ''}
  <section class="section"><div class="grid">
    <form class="card" method="post" action="/admin/spaces">
      <div class="section-header"><div><div class="section-title"><h2>${tr('newSpace')}</h2>${helpTip(tr('newSpaceHelp'), tr('moreInformation'))}</div></div></div>
      <input type="hidden" name="csrf" value="${current.session.csrf}">
      <div class="field"><label for="space-name">${tr('name')}</label><input id="space-name" name="name" required></div>
      <div class="field"><label for="space-vault-type">${escapeHtml(tr('vaultType'))}</label><select id="space-vault-type" name="vaultType">${vaultTypeOptions()}</select></div>
      <div class="field"><label for="space-description">${tr('description')}</label><input id="space-description" name="description"></div>
      <button type="submit">${tr('createSpace')}</button>
    </form>
    <form class="card" method="post" action="/admin/users">
      <div class="section-header"><div><div class="section-title"><h2>${tr('newUser')}</h2>${helpTip(tr('newUserHelp'), tr('moreInformation'))}</div></div></div>
      <input type="hidden" name="csrf" value="${current.session.csrf}">
      <div class="field"><label for="reader-email">${tr('email')}</label><input id="reader-email" name="email" type="email" autocomplete="off" required></div>
      <div class="field"><label for="reader-password">${tr('temporaryPasswordLabel')}</label><input id="reader-password" name="password" type="password" autocomplete="new-password" minlength="12" required></div>
      <div class="field"><div class="label-line"><label>${tr('spacesAndRoles')}</label>${helpTip(tr('newUserSpacesHelp'), tr('moreInformation'))}</div>${spaceGrantPicker([], 'new-user')}</div>
      <p class="muted role-legend"><strong>${escapeHtml(tr('roleReader'))}:</strong> ${tr('roleReaderHelp')}<br><strong>${escapeHtml(tr('roleWriter'))}:</strong> ${tr('roleWriterHelp')}<br><strong>${escapeHtml(tr('roleOwner'))}:</strong> ${tr('roleOwnerHelp')}</p>
      <button type="submit">${tr('createUser')}</button>
    </form>
  </div></section>
  <section class="section">
    <div class="section-header"><div><div class="section-title"><h2>${tr('spaces')}</h2>${helpTip(tr('spacesHelp'), tr('moreInformation'))}</div></div></div>
    <div class="table-shell"><table><thead><tr><th>${tr('name')}</th><th>ID</th><th>${tr('lastPublication')}</th><th>${tr('actions')}</th></tr></thead><tbody>${spaces || `<tr><td class="empty" colspan="4">${tr('noSpaces')}</td></tr>`}</tbody></table></div>
  </section>
  <section class="section">
    <div class="section-header"><div><div class="section-title"><h2>${tr('usersAccess')}</h2>${helpTip(tr('usersHelp'), tr('moreInformation'))}</div><p>${tr('mcpReadOnly')}</p></div></div>
    ${emailsUnlocked
      ? `<p class="ok" data-testid="email-access-unlocked">${escapeHtml(tr('emailAccessUnlocked'))}</p>`
      : `<form class="email-unlock card" method="post" action="/admin/users/email-access" data-testid="email-unlock-form"><div><strong>${escapeHtml(tr('unlockEmails'))}</strong><p class="muted">${escapeHtml(tr('unlockEmailsHelp'))}</p></div><input type="hidden" name="csrf" value="${current.session.csrf}"><input name="password" type="password" autocomplete="current-password" maxlength="1024" aria-label="${escapeHtml(tr('currentPassword'))}" required><button class="secondary" type="submit">${escapeHtml(tr('unlockForFiveMinutes'))}</button></form>`}
    <div class="user-list">${users}</div>
  </section>
  <section class="section">
    <div class="section-header"><div><div class="section-title"><h2>${tr('publisherDevices')}</h2>${helpTip(tr('devicesHelp'), tr('moreInformation'))}</div></div></div>
    <div class="table-shell"><table><thead><tr><th>${tr('device')}</th><th>${tr('space')}</th><th>${tr('lastUsed')}</th><th>${tr('actions')}</th></tr></thead><tbody>${devices || `<tr><td class="empty" colspan="4">${tr('noDevices')}</td></tr>`}</tbody></table></div>
  </section>`, options);
}

function maskEmail(value) {
  const [local = '', domain = ''] = String(value || '').split('@');
  const domainParts = domain.split('.');
  const host = domainParts.shift() || '';
  const suffix = domainParts.length ? `.${domainParts.join('.')}` : '';
  const mask = (part) => part ? `${part.slice(0, 1)}${'•'.repeat(Math.max(3, Math.min(8, part.length - 1)))}` : '•••';
  return `${mask(local)}@${mask(host)}${suffix}`;
}

function languageReturnPath(req) {
  try {
    const referer = new URL(String(req.headers.referer || ''), publicUrl());
    if (referer.origin === new URL(publicUrl()).origin) return safeReturnPath(`${referer.pathname}${referer.search}`);
  } catch {
    // A missing or malformed Referer simply returns to the appropriate home page.
  }
  return store.state.users.length === 0 ? '/setup' : '/';
}

// `readAssetBytes` is here for one route: the styled report document inlines its cover image
// as a `data:` URL, because the client that prints it may not be able to fetch anything else.
const corpusRoutes = createCorpusRoutes({
  readSnapshot,
  readAssetBytes: (spaceId, hash) => readAsset(store, spaceId, hash),
  renderPdf: deepResearchPdfBytes,
});

const apiRoutes = createApiRoutes({
  store, authorize, json, body, jsonBody, fs, path,
  privateAnnotations,
  readSnapshot, invalidateSnapshot, expandSnapshot,
  publicUrl, language, rateLimit, clearRateLimit, mib,
  gunzip: (bytes, maxOutputLength) => gunzipSync(bytes, { maxOutputLength }),
  gzip: (bytes) => gzipSync(bytes),
  // A function, not a snapshot: the public URL is only settled once /setup has run.
  resourceMap,
  corpus: corpusRoutes,
  limits: {
    maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
    maxSnapshotJsonBytes: MAX_SNAPSHOT_JSON_BYTES,
    maxAssetBytes: MAX_ASSET_BYTES,
    maxSpaceAssetBytes: MAX_SPACE_ASSET_BYTES,
    maxLibraryPackageBytes: MAX_LIBRARY_PACKAGE_BYTES,
    maxSpaceLibraryBytes: MAX_SPACE_LIBRARY_BYTES,
    maxSpaceDocumentUpdateBytes: MAX_SPACE_DOCUMENT_UPDATE_BYTES,
    maxSpaceSharedBlobBytes: MAX_SPACE_SHARED_BLOB_BYTES,
    maxSpacePartialBlobBytes: MAX_SPACE_PARTIAL_BLOB_BYTES,
    maxVectorBytes: MAX_VECTOR_BYTES,
    maxMutationBytes: MAX_MUTATION_BYTES,
    maxMutationBatchBytes: MAX_MUTATION_BATCH_BYTES,
    maxLedgerBytes: MAX_LEDGER_BYTES,
    assetGraceMs: ASSET_GRACE_MS,
  },
});

// Server-native vaults use the canonical Electron schema in one SQLite file per vault. The
// legacy `spaces/` publication tree remains untouched and is exposed as desktop_published.
const nativeVaultRoutes = createNativeVaultRoutes({
  store, authorize, json, jsonBody, body, root: DATA_DIR,
  checkCsrf: (session, supplied) => safeEqual(supplied, session?.csrf),
  sameOrigin: (req) => {
    let origin = String(req.headers.origin || '').trim();
    if (!origin) { try { origin = new URL(String(req.headers.referer || '')).origin; } catch { origin = ''; } }
    let expected = ''; try { expected = new URL(publicUrl()).origin; } catch {}
    const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    const validSite = !fetchSite || fetchSite === 'same-origin' || fetchSite === 'same-site';
    try { return Boolean(origin) && new URL(origin).origin === expected && validSite; } catch { return false; }
  },
});

const aiRoutes = createAIRoutes({
  authorize, json, jsonBody, publicUrl, aiStore, privateData, gateway: providerGateway, store, rateLimit,
  maxActiveJobsPerUser: aiMaxActivePerUser,
  maxActiveJobsGlobal: aiMaxActiveGlobal,
});
const artifactRoutes = createArtifactRoutes({
  authorize, json, jsonBody, publicUrl, artifacts: userArtifacts, privateData, renderPdf: deepResearchPdfBytes,
});

/**
 * Give the desktop that launched this process a space and a pairing code for one vault.
 *
 * Two independent gates guard it, and neither is a password the user chose: the caller must have
 * read a 0600 file owned by this operating-system user, and must have reached us over loopback.
 * Either alone would do; a remote attacker has to defeat both. In a Docker deployment
 * NODUS_LOCAL_PROVISION_FILE is unset and this answers 404 like any unknown path, so the surface
 * is not merely closed there — it does not exist.
 *
 * Idempotent per vault: re-provisioning reuses the space created the first time, so reconnecting
 * a vault does not scatter empty duplicates across the administration page.
 */
async function handleLocalProvision(req, res) {
  if (!LOCAL_PROVISION_SECRET || !fromLoopback(req)) return json(res, 404, { error: 'not_found' });
  if (!rateLimit(req, res, 'local-provision', 60, 15 * 60_000)) return;
  const presented = Buffer.from(bearer(req), 'utf8');
  const expected = Buffer.from(LOCAL_PROVISION_SECRET, 'utf8');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return json(res, 401, { error: 'unauthorized', error_description: 'Invalid local provisioning secret.' });
  }

  const admin = store.state.users.find((entry) => entry.role === 'admin');
  if (!admin) return json(res, 409, { error: 'not_configured', error_description: 'The server has no administrator account yet.' });

  const input = await jsonBody(req, AUTH_BODY_BYTES);
  const vaultId = String(input.vaultId || '').trim().slice(0, 120);
  if (!vaultId) return json(res, 400, { error: 'invalid_request', error_description: 'A vaultId is required.' });
  const vaultName = String(input.vaultName || '').trim().slice(0, 120) || 'Nodus';
  const vaultType = normalizeVaultType(input.vaultType);

  let space = store.state.spaces.find((entry) => entry.localVaultId === vaultId);
  if (!space) {
    const createdAt = new Date().toISOString();
    space = { id: randomUUID(), name: vaultName, description: '', createdAt, updatedAt: null, revision: '', bytes: 0, localVaultId: vaultId, vaultType, receiveSequence: 0,
      provenance: { schemaVersion: 4, originInstanceId: store.state.settings.instanceId, originDeviceId: 'desktop-basic', createdBy: admin.id, createdAt } };
    store.state.spaces.push(space);
    store.state.memberships.push({ userId: admin.id, spaceId: space.id, role: 'owner' });
  } else if (!space.nameEdited && space.name !== vaultName) {
    // Renaming the vault in Nodus should rename the space people see, not orphan it.
    space.name = vaultName;
  }
  if (vaultType) space.vaultType = vaultType;

  // Local provisioning is authenticated by a fresh 0600 secret and accepted only over
  // loopback. It may therefore carry the Desktop's explicit publication switches. This is
  // intentionally unavailable to remote/advanced publishers, whose policy remains an
  // administrator decision made through the normal session + CSRF control plane.
  if (input.publicationPolicy && typeof input.publicationPolicy === 'object' && !Array.isArray(input.publicationPolicy)) {
    const requested = input.publicationPolicy;
    const bool = (field) => requested[field] === true;
    space.publicationPolicy = {
      version: 1,
      allowUserContent: bool('allowUserContent'),
      allowPersonalImports: bool('allowPersonalImports'),
      allowLibraryDocuments: bool('allowLibraryDocuments'),
      allowPassages: bool('allowPassages'),
      allowVectors: bool('allowVectors'),
      allowPrimarySources: bool('allowPrimarySources'),
      allowTestimonies: bool('allowTestimonies'),
      publishPersonalAnnotations: false,
      updatedAt: new Date().toISOString(),
    };
    space.publicationPolicy.allowLegacyPublisherImport = space.publicationPolicy.allowPersonalImports;
  }

  const code = pairingCode();
  store.state.pairingCodes.push({ hash: digest(code), userId: admin.id, spaceId: space.id, kind: 'publisher', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), usedAt: null });
  store.save();
  return json(res, 200, { spaceId: space.id, spaceName: space.name, code, publicUrl: publicUrl() });
}

const WEB_DIST = path.join(ROOT, 'dist', 'web');
const WEB_MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function serveWebApp(req, res, pathname) {
  if (!fs.existsSync(WEB_DIST)) return false;
  let relative;
  try {
    const appPath = pathname === '/app' || pathname.startsWith('/app/') ? pathname.slice('/app'.length) : pathname;
    relative = decodeURIComponent(appPath).replace(/^\/+/, '');
  }
  catch { json(res, 400, { error: 'bad_path' }); return true; }
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const candidate = path.resolve(WEB_DIST, relative);
  const rootWithSep = `${path.resolve(WEB_DIST)}${path.sep}`;
  let target = candidate.startsWith(rootWithSep) ? candidate : path.join(WEB_DIST, 'index.html');
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) target = path.join(WEB_DIST, 'index.html');
  if (!fs.existsSync(target)) return false;
  const ext = path.extname(target).toLowerCase();
  const bytes = fs.readFileSync(target);
  const immutable = /[.-][0-9a-f]{8,}[.-]/i.test(path.basename(target));
  staticAsset(res, 200, bytes, WEB_MIME[ext] || 'application/octet-stream', {
    'cache-control': ext === '.html' ? 'no-store' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
  });
  return true;
}

function browserDocumentRequest(req) {
  return String(req.headers['sec-fetch-dest'] || '').toLowerCase() === 'document';
}

function canonicalWebPath(pathname) {
  return pathname === '/' || pathname === '/view' || pathname.startsWith('/view/')
    || pathname === '/detail' || pathname.startsWith('/detail/')
    || pathname === '/library' || pathname.startsWith('/library/');
}

function embeddedAdminRequest(req) {
  try {
    const referer = new URL(String(req.headers.referer || ''), publicUrl());
    return referer.origin === new URL(publicUrl()).origin && referer.pathname === '/admin/settings' && referer.searchParams.get('embedded') === '1';
  } catch { return false; }
}

function adminRedirect(req, notice = '') {
  let embeddedTheme = 'dark';
  try { embeddedTheme = new URL(String(req.headers.referer || ''), publicUrl()).searchParams.get('theme') === 'light' ? 'light' : 'dark'; } catch { /* default */ }
  const base = embeddedAdminRequest(req) ? `/admin/settings?embedded=1&theme=${embeddedTheme}` : '/?legacy-admin=1';
  return `${base}${notice ? `${base.includes('?') ? '&' : '?'}notice=${encodeURIComponent(notice)}` : ''}`;
}

const EMBEDDED_ADMIN_HEADERS = Object.freeze({
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': contentSecurityPolicy().replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
});

function adminDashboardResponse(req, res, current, status, notice) {
  const embedded = embeddedAdminRequest(req);
  let theme = 'dark';
  try { theme = new URL(String(req.headers.referer || ''), publicUrl()).searchParams.get('theme') === 'light' ? 'light' : 'dark'; } catch { /* default */ }
  return html(
    res,
    status,
    dashboard(current, notice, embedded ? { variant: 'embedded', theme } : {}),
    embedded ? EMBEDDED_ADMIN_HEADERS : {},
  );
}

function publishedPolicy(space) {
  const input = space?.publicationPolicy && typeof space.publicationPolicy === 'object' ? space.publicationPolicy : {};
  return {
    version: 1,
    allowUserContent: input.allowUserContent === true,
    allowPersonalImports: input.allowPersonalImports === true || input.allowLegacyPublisherImport === true,
    allowLibraryDocuments: input.allowLibraryDocuments === true,
    allowPassages: input.allowPassages === true,
    allowVectors: input.allowVectors === true,
    allowPrimarySources: input.allowPrimarySources === true,
    allowTestimonies: input.allowTestimonies === true,
    publishPersonalAnnotations: false,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : null,
  };
}

function webAdminState(current) {
  const emailsUnlocked = store.sensitiveAccessValid(current.session);
  return {
    server: {
      name: store.state.settings.name,
      publicUrl: publicUrl(),
      mcpUrl: mcpResource(),
      version: NODUS_VERSION,
      language: normalizeServerLanguage(store.state.settings.language),
      deploymentMode: DEPLOYMENT_MODE,
    },
    spaces: store.state.spaces.map((space) => {
      const snapshot = readSnapshot(space.id);
      return {
        id: space.id,
        name: space.name,
        description: space.description || '',
        vaultType: spaceVaultType(space) || space.vaultType || '',
        storageKind: space.storageKind || 'desktop_published',
        authorityMode: space.authorityMode || 'desktop',
        initializationState: space.initializationState || (space.storageKind === 'server_native' ? 'ready' : 'published'),
        updatedAt: space.updatedAt || null,
        revision: space.revision || '',
        bytes: Number(space.bytes) || 0,
        counts: snapshot ? Object.fromEntries(Object.entries(snapshot.tables ?? {}).map(([table, values]) => [table, Array.isArray(values) ? values.length : 0])) : {},
        libraryDocuments: Array.isArray(snapshot?.library?.documents) ? snapshot.library.documents.length : 0,
        publicationPolicy: publishedPolicy(space),
      };
    }),
    users: store.state.users.map((user) => ({
      id: user.id,
      email: user.id === current.user.id || emailsUnlocked ? user.email : maskEmail(user.email),
      emailMasked: user.id !== current.user.id && !emailsUnlocked,
      role: user.role,
      memberships: store.state.memberships.filter((entry) => entry.userId === user.id)
        .map((entry) => ({ spaceId: entry.spaceId, role: normalizeSpaceRole(entry.role) })),
    })),
    devices: store.state.deviceTokens.map((device) => ({
      id: device.hash,
      deviceName: device.deviceName,
      userId: device.userId,
      spaceId: device.spaceId,
      createdAt: device.createdAt || null,
      lastUsedAt: device.lastUsedAt || null,
      kind: device.kind || 'publisher',
    })),
    sensitiveAccessUnlocked: emailsUnlocked,
    csrfToken: current.session.csrf,
  };
}

function webJsonSession(req, res, { admin = false, mutate = false } = {}) {
  const current = sessionFor(req);
  if (!current) { json(res, 401, { error: 'authentication_required' }); return null; }
  if (admin && current.user.role !== 'admin') { json(res, 403, { error: 'admin_required' }); return null; }
  if (!mutate) return current;
  let origin = String(req.headers.origin || '').trim();
  if (!origin) {
    try { origin = new URL(String(req.headers.referer || '')).origin; } catch { origin = ''; }
  }
  let expected = '';
  try { expected = new URL(publicUrl()).origin; } catch { expected = ''; }
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  const validSite = !fetchSite || fetchSite === 'same-origin' || fetchSite === 'same-site';
  if (!origin || origin !== expected || !validSite || !checkCsrf(current, req.headers['x-csrf-token'] || req.headers['x-csrf'])) {
    json(res, 403, { error: 'csrf_failed', error_description: 'A same-origin request and a valid CSRF token are required.' });
    return null;
  }
  return current;
}

function requestedMemberships(input) {
  const values = Array.isArray(input?.memberships) ? input.memberships : [];
  const result = new Map();
  for (const entry of values) {
    const spaceId = String(entry?.spaceId || '');
    if (!store.state.spaces.some((space) => space.id === spaceId)) continue;
    result.set(spaceId, normalizeSpaceRole(entry?.role));
  }
  return result;
}

async function handleWebControlApi(req, res, url) {
  if (!url.pathname.startsWith('/api/v1/web/')) return false;
  let segments;
  try { segments = url.pathname.slice('/api/v1/web/'.length).split('/').filter(Boolean).map(decodeURIComponent); }
  catch { json(res, 400, { error: 'bad_path' }); return true; }
  const adminRoute = segments[0] === 'admin';

  if (adminRoute && segments.length === 1 && req.method === 'GET') {
    const current = webJsonSession(req, res, { admin: true });
    if (current) json(res, 200, webAdminState(current));
    return true;
  }

  if (adminRoute && segments[1] === 'spaces' && segments.length === 2 && req.method === 'POST') {
    const current = webJsonSession(req, res, { admin: true, mutate: true }); if (!current) return true;
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    const name = String(input.name || '').trim().slice(0, 120);
    if (!name) { json(res, 400, { error: 'invalid_space', error_description: 'The space needs a name.' }); return true; }
    const createdAt = new Date().toISOString();
    const space = {
      id: randomUUID(), name, description: String(input.description || '').trim().slice(0, 500),
      vaultType: normalizeVaultType(input.vaultType) || 'academic', nameEdited: true,
      createdAt, updatedAt: null, revision: '', bytes: 0, receiveSequence: 0,
      provenance: { schemaVersion: 4, originInstanceId: store.state.settings.instanceId, originDeviceId: 'server-web', createdBy: current.user.id, createdAt },
    };
    store.state.spaces.push(space);
    store.state.memberships.push({ userId: current.user.id, spaceId: space.id, role: 'owner' });
    store.save(); json(res, 201, { space: webAdminState(current).spaces.find((entry) => entry.id === space.id) }); return true;
  }

  if (adminRoute && segments[1] === 'spaces' && segments[2] && segments.length === 3 && req.method === 'PATCH') {
    const current = webJsonSession(req, res, { admin: true, mutate: true }); if (!current) return true;
    const space = store.state.spaces.find((entry) => entry.id === segments[2]);
    if (!space) { json(res, 404, { error: 'space_not_found' }); return true; }
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    if (input.name !== undefined) {
      const name = String(input.name || '').trim().slice(0, 120);
      if (!name) { json(res, 400, { error: 'invalid_space', error_description: 'The space needs a name.' }); return true; }
      space.name = name; space.nameEdited = true;
    }
    if (input.description !== undefined) space.description = String(input.description || '').trim().slice(0, 500);
    if (input.publicationPolicy !== undefined) {
      if (!input.publicationPolicy || typeof input.publicationPolicy !== 'object' || Array.isArray(input.publicationPolicy)) {
        json(res, 400, { error: 'invalid_policy' }); return true;
      }
      const policy = input.publicationPolicy;
      const fields = ['allowUserContent', 'allowPersonalImports', 'allowLibraryDocuments', 'allowPassages', 'allowVectors', 'allowPrimarySources', 'allowTestimonies'];
      for (const field of fields) if (policy[field] !== undefined && typeof policy[field] !== 'boolean') {
        json(res, 400, { error: 'invalid_policy', field }); return true;
      }
      const previous = publishedPolicy(space);
      space.publicationPolicy = { version: 1, publishPersonalAnnotations: false, updatedAt: new Date().toISOString() };
      for (const field of fields) space.publicationPolicy[field] = policy[field] === undefined ? previous[field] : policy[field];
      space.publicationPolicy.allowLegacyPublisherImport = space.publicationPolicy.allowPersonalImports;
    }
    store.save(); json(res, 200, { space: webAdminState(current).spaces.find((entry) => entry.id === space.id) }); return true;
  }

  if (adminRoute && segments[1] === 'spaces' && segments[2] && segments[3] === 'pairing' && segments.length === 4 && req.method === 'POST') {
    const current = webJsonSession(req, res, { admin: true, mutate: true }); if (!current) return true;
    const access = membership(current.user.id, segments[2]);
    if (!access || !canRole(normalizeSpaceRole(access.role), 'own')) { json(res, 403, { error: 'owner_required' }); return true; }
    const code = pairingCode(); const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    store.state.pairingCodes.push({ hash: digest(code), userId: current.user.id, spaceId: segments[2], kind: 'publisher', expiresAt, usedAt: null });
    store.save(); json(res, 201, { code, expiresAt }); return true;
  }

  if (adminRoute && segments[1] === 'users' && segments.length === 2 && req.method === 'POST') {
    const current = webJsonSession(req, res, { admin: true, mutate: true }); if (!current) return true;
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    try {
      const user = store.createUser(input.email, input.password, 'member');
      for (const [spaceId, role] of requestedMemberships(input)) store.state.memberships.push({ userId: user.id, spaceId, role });
      store.save(); json(res, 201, { user: webAdminState(current).users.find((entry) => entry.id === user.id) });
    } catch (error) { json(res, 400, { error: 'invalid_user', error_description: error instanceof Error ? error.message : String(error) }); }
    return true;
  }

  if (adminRoute && segments[1] === 'users' && segments[2] && segments[3] === 'access' && segments.length === 4 && req.method === 'PATCH') {
    const current = webJsonSession(req, res, { admin: true, mutate: true }); if (!current) return true;
    const user = store.state.users.find((entry) => entry.id === segments[2]);
    if (!user) { json(res, 404, { error: 'user_not_found' }); return true; }
    const input = await jsonBody(req, AUTH_BODY_BYTES); const desired = requestedMemberships(input);
    const existing = store.state.memberships.filter((entry) => entry.userId === user.id);
    for (const entry of existing) if (entry.role === 'owner' && desired.get(entry.spaceId) !== 'owner' && ownerCount(entry.spaceId) <= 1) {
      json(res, 409, { error: 'last_owner', error_description: 'A space needs at least one owner.' }); return true;
    }
    const removed = new Set(existing.filter((entry) => !desired.has(entry.spaceId)).map((entry) => entry.spaceId));
    store.state.memberships = store.state.memberships.filter((entry) => entry.userId !== user.id || desired.has(entry.spaceId));
    for (const [spaceId, role] of desired) { const entry = membership(user.id, spaceId); if (entry) entry.role = role; else store.state.memberships.push({ userId: user.id, spaceId, role }); }
    if (removed.size) {
      store.state.deviceTokens = store.state.deviceTokens.filter((entry) => entry.userId !== user.id || !removed.has(entry.spaceId));
      store.state.pairingCodes = store.state.pairingCodes.filter((entry) => entry.userId !== user.id || !removed.has(entry.spaceId));
    }
    store.save(); json(res, 200, { user: webAdminState(current).users.find((entry) => entry.id === user.id) }); return true;
  }

  if (adminRoute && segments[1] === 'devices' && segments[2] && segments.length === 3 && req.method === 'DELETE') {
    const current = webJsonSession(req, res, { admin: true, mutate: true }); if (!current) return true;
    const before = store.state.deviceTokens.length;
    store.state.deviceTokens = store.state.deviceTokens.filter((entry) => entry.hash !== segments[2]);
    if (store.state.deviceTokens.length === before) { json(res, 404, { error: 'device_not_found' }); return true; }
    store.save(); json(res, 200, { ok: true }); return true;
  }

  if (segments[0] === 'account' && segments[1] === 'password' && segments.length === 2 && req.method === 'PUT') {
    const current = webJsonSession(req, res, { mutate: true }); if (!current) return true;
    if (!rateLimit(req, res, 'password-change', 10, 15 * 60_000)) return true;
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    if (input.newPassword !== input.confirmPassword) { json(res, 400, { error: 'password_mismatch' }); return true; }
    try {
      store.changePassword(current.user.id, input.currentPassword, input.newPassword, current.session.hash);
      json(res, 200, { ok: true, signedOutOtherSessions: true });
    } catch (error) { json(res, 400, { error: 'invalid_password', error_description: error instanceof Error ? error.message : String(error) }); }
    return true;
  }

  return false;
}

async function route(req, res) {
  const url = new URL(req.url || '/', publicUrl());
  if (url.pathname === '/api/v1/bridge-relay/channels' && req.method === 'POST') {
    const auth = authorize(req, res, { need: 'own', via: ['device'], resource: 'api', boundSpace: true });
    if (!auth) return;
    if ((auth.device?.kind ?? 'publisher') !== 'publisher') return json(res, 403, { error: 'publisher_required' });
    if (!rateLimit(req, res, 'bridge-relay-create', 10, 60_000)) return;
    const input = await jsonBody(req, 4 * 1024);
    try { return json(res, 201, relay.create(auth.device.hash, input.macId)); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const relayDelete = /^\/api\/v1\/bridge-relay\/channels\/([a-f0-9-]+)$/.exec(url.pathname);
  if (relayDelete && req.method === 'DELETE') {
    const auth = authorize(req, res, { need: 'own', via: ['device'], resource: 'api', boundSpace: true });
    if (!auth) return;
    return json(res, relay.revoke(relayDelete[1], auth.device.hash) ? 200 : 404, { revoked: true });
  }
  if (url.pathname === '/favicon.svg' && req.method === 'GET') {
    return staticAsset(res, 200, NODUS_FAVICON_SVG, 'image/svg+xml; charset=utf-8', { 'cache-control': 'public, max-age=86400' });
  }
  if (url.pathname === '/server-ui.js' && req.method === 'GET') {
    return staticAsset(res, 200, WEB_SCRIPT, 'text/javascript; charset=utf-8', { 'cache-control': 'no-cache' });
  }
  if (url.pathname === '/organism.js' && req.method === 'GET') {
    const organism = path.join(WEB_DIST, 'organism.js');
    if (!fs.existsSync(organism)) return json(res, 404, { error: 'not_found' });
    return staticAsset(res, 200, fs.readFileSync(organism), 'text/javascript; charset=utf-8', { 'cache-control': 'public, max-age=3600' });
  }
  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    const current = sessionFor(req);
    if (!current) return redirect(res, `/login?next=${encodeURIComponent('/admin')}`);
    if (current.user.role !== 'admin') return redirect(res, '/account');
    return redirect(res, `/view/settings?tab=server`);
  }
  if (url.pathname === '/admin/settings' && req.method === 'GET') {
    const current = requireSession(req, res, true); if (!current) return;
    const embedded = url.searchParams.get('embedded') === '1';
    return html(
      res,
      200,
      dashboard(current, url.searchParams.get('notice') || '', embedded ? { variant: 'embedded', theme: url.searchParams.get('theme') === 'light' ? 'light' : 'dark' } : {}),
      embedded ? EMBEDDED_ADMIN_HEADERS : {},
    );
  }
  if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'method_not_allowed' });
    const current = requireSession(req, res);
    if (!current) return;
    if (serveWebApp(req, res, url.pathname)) return;
    return redirect(res, current.user.role === 'admin' ? '/' : '/account');
  }
  if (canonicalWebPath(url.pathname) && (url.pathname !== '/' || browserDocumentRequest(req)) && ['GET', 'HEAD'].includes(req.method)) {
    const current = requireSession(req, res);
    if (!current) return;
    if (serveWebApp(req, res, url.pathname)) return;
  }
  if (url.pathname === '/language' && req.method === 'POST') {
    const values = await form(req, 4 * 1024);
    const selected = normalizeServerLanguage(values.language);
    const secure = publicUrl().startsWith('https:') ? '; Secure' : '';
    return redirect(res, languageReturnPath(req), {
      'set-cookie': `nodus_language=${encodeURIComponent(selected)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
    });
  }
  if (url.pathname === '/healthz' || url.pathname === '/about') return json(res, 200, { ok: true, service: 'nodus-server', version: NODUS_VERSION, license: NODUS_LICENSE, sourceCodeUrl: NODUS_SOURCE_URL, language: language() });
  if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') return json(res, 200, { resource: mcpResource(), authorization_servers: [publicUrl()], scopes_supported: ['profile', 'spaces.read', 'materials.read'], resource_documentation: `${publicUrl()}/` });
  // The client API is a separate protected resource from MCP: an AI client reads the corpus,
  // an app also writes to it, and a token for one must not be accepted by the other.
  if (url.pathname === '/.well-known/oauth-protected-resource/api/v1') return json(res, 200, { resource: apiResource(), authorization_servers: [publicUrl()], scopes_supported: [...SCOPES], resource_documentation: `${publicUrl()}/` });
  if (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/openid-configuration') return json(res, 200, { issuer: publicUrl(), authorization_endpoint: `${publicUrl()}/oauth/authorize`, token_endpoint: `${publicUrl()}/oauth/token`, registration_endpoint: `${publicUrl()}/oauth/register`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], scopes_supported: [...SCOPES] });
  if (url.pathname === '/mcp') return handleMcp(req, res);
  if (url.pathname === '/api/v1/local/provision' && req.method === 'POST') return handleLocalProvision(req, res);

  // Native JSON control plane used by the integrated Server settings tab. It deliberately
  // runs before the general API dispatcher and never renders or embeds the legacy admin UI.
  if (await handleWebControlApi(req, res, url)) return;

  // v2 is the reusable Server/Desktop service boundary. Native vault lifecycle is available
  // in both deployments; the existing advanced-only AI/artifact surfaces retain their gate.
  if (await nativeVaultRoutes.handle(req, res, url)) return;
  if (await nativeVaultRoutes.handleLegacyRead(req, res, url)) return;
  // Portable profile preferences are needed for appearance/theme sync in both
  // basic and advanced deployments. Server AI itself remains advanced-only.
  if (await aiRoutes.handleProfilePreferences(req, res, url)) return;
  if (DEPLOYMENT_MODE === 'advanced' && await artifactRoutes.handle(req, res, url)) return;
  if (DEPLOYMENT_MODE === 'advanced' && await aiRoutes.handle(req, res, url)) return;

  // The client API answers before the "no users yet" gate below. A machine surface should
  // get a 401 it can act on, not a 303 to an HTML setup page it cannot read. Routes this
  // handler does not recognise fall through untouched.
  if (await apiRoutes.handle(req, res, url)) return;

  if (store.state.users.length === 0) {
    if (url.pathname !== '/setup') return redirect(res, '/setup');
    if (req.method === 'GET') return html(res, 200, setupPage());
    if (!rateLimit(req, res, 'setup-global', 60, 60 * 60_000, 'all')) return;
    if (!rateLimit(req, res, 'setup-ip', 10, 15 * 60_000)) return;
    const values = await form(req, AUTH_BODY_BYTES);
    try {
      if (!SETUP_TOKEN || SETUP_TOKEN.length < 16 || !safeEqual(values.setupToken, SETUP_TOKEN)) throw new Error('The setup token is invalid.');
      store.state.settings = { ...store.state.settings, name: String(values.name).trim(), publicUrl: normalizePublicUrl(values.publicUrl), language: 'en' };
      const user = store.createUser(values.email, values.password, 'admin');
      const raw = store.createSession(user.id);
      return redirect(res, '/', { 'set-cookie': `nodus_session=${encodeURIComponent(raw)}; Path=/; HttpOnly; SameSite=Lax${publicUrl().startsWith('https://') ? '; Secure' : ''}` });
    } catch (error) { return html(res, 400, setupPage(error instanceof Error ? error.message : String(error))); }
  }

  if (url.pathname === '/setup') return redirect(res, '/login');

  if (url.pathname === '/login') {
    if (req.method === 'GET') {
      const csrf = randomBytes(32).toString('base64url');
      return html(res, 200, loginPage(url.searchParams.get('next') || '/', '', csrf), { 'set-cookie': loginCsrfCookie(csrf) });
    }
    if (!rateLimit(req, res, 'login-global', 240, 5 * 60_000, 'all')) return;
    if (!rateLimit(req, res, 'login-ip', 60, 15 * 60_000)) return;
    const values = await form(req, AUTH_BODY_BYTES);
    const csrf = String(cookies(req).nodus_login_csrf || '');
    if (!csrf || !safeEqual(values.csrf, csrf) || !loginRequestSameOrigin(req)) {
      const replacement = randomBytes(32).toString('base64url');
      return html(res, 403, loginPage(safeReturnPath(values.next), tr('sessionExpired'), replacement), { 'set-cookie': loginCsrfCookie(replacement) });
    }
    const accountIdentity = digest(String(values.email || '').trim().toLowerCase());
    if (!rateLimit(req, res, 'login-account', 10, 10 * 60_000, accountIdentity)) return;
    const user = store.authenticate(values.email, values.password);
    if (!user) {
      const replacement = randomBytes(32).toString('base64url');
      return html(res, 401, loginPage(safeReturnPath(values.next), tr('invalidLogin'), replacement), {
        'set-cookie': loginCsrfCookie(replacement),
      });
    }
    clearRateLimit('login-account', accountIdentity);
    const raw = store.createSession(user.id);
    const safeNext = safeReturnPath(values.next);
    const destination = safeNext === '/' ? (browserDocumentRequest(req) ? '/' : user.role === 'admin' ? '/admin' : '/app') : safeNext;
    return redirect(res, destination, { 'set-cookie': [
      `nodus_session=${encodeURIComponent(raw)}; Path=/; HttpOnly; SameSite=Lax${publicUrl().startsWith('https://') ? '; Secure' : ''}`,
      loginCsrfCookie('', { clear: true }),
    ] });
  }

  if (url.pathname === '/account' && req.method === 'GET') {
    const current = requireSession(req, res); if (!current) return;
    return html(res, 200, accountPage(current, url.searchParams.get('notice') || ''));
  }
  if (url.pathname === '/account/password' && req.method === 'POST') {
    const current = requireSession(req, res); if (!current) return;
    if (!rateLimit(req, res, 'password-change', 10, 15 * 60_000)) return;
    const values = await form(req, AUTH_BODY_BYTES);
    if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    if (values.newPassword !== values.confirmPassword) return html(res, 400, accountPage(current, '', 'The new passwords do not match.'));
    try {
      store.changePassword(current.user.id, values.currentPassword, values.newPassword, current.session.hash);
      return redirect(res, '/account?notice=' + encodeURIComponent('Password updated. Your other sessions and OAuth connections have been signed out.'));
    } catch (error) {
      return html(res, 400, accountPage(current, '', error instanceof Error ? error.message : String(error)));
    }
  }

  if (url.pathname === '/admin/users/password' && req.method === 'GET') {
    const current = requireSession(req, res, true); if (!current) return;
    const user = store.state.users.find((entry) => entry.id === url.searchParams.get('userId') && entry.role === 'member');
    if (!user) return html(res, 404, page(tr('error'), `<h1>${tr('readerNotFound')}</h1>`));
    return html(res, 200, resetPasswordPage(current, user));
  }
  if (url.pathname === '/admin/users/password' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    if (!rateLimit(req, res, 'password-reset', 20, 15 * 60_000)) return;
    const values = await form(req, AUTH_BODY_BYTES);
    if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const user = store.state.users.find((entry) => entry.id === values.userId && entry.role === 'member');
    if (!user) return html(res, 404, page(tr('error'), `<h1>${tr('readerNotFound')}</h1>`));
    if (values.newPassword !== values.confirmPassword) return html(res, 400, resetPasswordPage(current, user, 'The new passwords do not match.'));
    try {
      store.resetPassword(user.id, values.newPassword);
      return redirect(res, '/?notice=' + encodeURIComponent('Password reset.'));
    } catch (error) {
      return html(res, 400, resetPasswordPage(current, user, error instanceof Error ? error.message : String(error)));
    }
  }
  if (url.pathname === '/admin/users/email-access' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    if (!rateLimit(req, res, 'email-unlock', 10, 15 * 60_000)) return;
    const values = await form(req, AUTH_BODY_BYTES);
    if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    try {
      store.unlockSensitiveAccess(current.session.hash, values.password);
      return redirect(res, '/?notice=' + encodeURIComponent(tr('emailAccessUnlocked')));
    } catch {
      return adminDashboardResponse(req, res, current, 401, tr('emailUnlockFailed'));
    }
  }
  if (url.pathname === '/admin/users/email' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    if (!rateLimit(req, res, 'email-change', 20, 15 * 60_000)) return;
    const values = await form(req, AUTH_BODY_BYTES);
    if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    if (!store.sensitiveAccessValid(current.session)) return adminDashboardResponse(req, res, current, 403, tr('emailAccessExpired'));
    const target = store.state.users.find((entry) => entry.id === values.userId);
    if (!target) return adminDashboardResponse(req, res, current, 404, tr('readerNotFound'));
    if (ENVIRONMENT_ADMIN_CONFIGURED && target.role === 'admin') return adminDashboardResponse(req, res, current, 403, tr('environmentEmailReadonly'));
    try {
      const result = store.changeEmail(target.id, values.email);
      if (result.changed && target.id === current.user.id) {
        return redirect(res, '/login?notice=' + encodeURIComponent(tr('emailUpdatedSignIn')), { 'set-cookie': 'nodus_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
      }
      return redirect(res, '/?notice=' + encodeURIComponent(result.changed ? tr('emailUpdated') : tr('emailUnchanged')));
    } catch (error) {
      return adminDashboardResponse(req, res, current, 400, error instanceof Error ? error.message : String(error));
    }
  }

  if (url.pathname === '/oauth/register' && req.method === 'POST') {
    if (!rateLimit(req, res, 'oauth-register-global', 300, 60 * 60_000, 'all')) return;
    if (!rateLimit(req, res, 'oauth-register', 30, 60 * 60_000)) return;
    if (store.state.oauthClients.length >= 10_000) return json(res, 503, { error: 'registration_capacity_reached' });
    const input = await jsonBody(req, 64 * 1024);
    const redirects = Array.isArray(input.redirect_uris) ? [...new Set(input.redirect_uris.filter((value) => typeof value === 'string' && validRedirectUri(value)))].slice(0, 10) : [];
    if (redirects.length === 0) return json(res, 400, { error: 'invalid_redirect_uri' });
    const client = { client_id: `client_${token(18)}`, client_name: String(input.client_name || 'MCP client').slice(0, 120), redirect_uris: redirects, createdAt: new Date().toISOString() };
    store.state.oauthClients.push(client); store.save();
    return json(res, 201, { ...client, token_endpoint_auth_method: 'none' });
  }

  if (url.pathname === '/oauth/authorize' && req.method === 'GET') {
    const current = sessionFor(req);
    if (!current) return redirect(res, `/login?next=${encodeURIComponent(req.url || '/')}`);
    const client = store.state.oauthClients.find((entry) => entry.client_id === url.searchParams.get('client_id'));
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const resource = url.searchParams.get('resource') || mcpResource();
    const requested = requestedScopes(url.searchParams.get('scope'));
    if (!client || !client.redirect_uris.includes(redirectUri) || !knownResource(resource) || url.searchParams.get('response_type') !== 'code' || url.searchParams.get('code_challenge_method') !== 'S256' || !validPkceValue(url.searchParams.get('code_challenge')) || !requested) return html(res, 400, page('OAuth', `<h1>${tr('invalidOauth')}</h1>`));
    const hidden = [...url.searchParams].map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join('');
    return html(res, 200, page(tr('authorize'), `<div class="page-heading"><div><p class="eyebrow">${tr('oauthProtected')}</p><h1>${tr('connectClient', { name: escapeHtml(client.client_name) })}</h1><p class="lead">${tr('assignedOnly', { email: escapeHtml(current.user.email) })}</p></div></div><div class="card"><h2>${tr('appCan')}</h2><ul>${requested.map((scope) => `<li>${escapeHtml(scope)}</li>`).join('')}</ul><form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="csrf" value="${current.session.csrf}"><button type="submit">${tr('authorize')}</button></form></div>`), oauthRedirectHeaders(redirectUri));
  }

  if (url.pathname === '/oauth/authorize' && req.method === 'POST') {
    const current = requireSession(req, res); if (!current) return;
    const values = await form(req, 64 * 1024);
    if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const client = store.state.oauthClients.find((entry) => entry.client_id === values.client_id);
    const grantedResource = String(values.resource || mcpResource());
    const scopes = requestedScopes(values.scope);
    if (!client || !client.redirect_uris.includes(values.redirect_uri) || values.code_challenge_method !== 'S256' || !validPkceValue(values.code_challenge) || !knownResource(grantedResource) || !scopes) return html(res, 400, page('OAuth', `<h1>${tr('invalidOauth')}</h1>`));
    const raw = token(24);
    // The code carries the resource it was granted for, and /oauth/token copies it onto the
    // access token, so the surface a client asked for is the only one it can reach.
    store.state.oauthCodes.push({ hash: digest(raw), userId: current.user.id, clientId: client.client_id, redirectUri: values.redirect_uri, codeChallenge: values.code_challenge, scopes, resource: grantedResource, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
    store.save();
    const target = new URL(values.redirect_uri); target.searchParams.set('code', raw); if (values.state) target.searchParams.set('state', values.state);
    return redirect(res, target.toString(), oauthRedirectHeaders(values.redirect_uri));
  }

  if (url.pathname === '/oauth/token' && req.method === 'POST') {
    if (!rateLimit(req, res, 'oauth-token-global', 1_000, 60_000, 'all')) return;
    if (!rateLimit(req, res, 'oauth-token', 120, 60_000)) return;
    const values = await form(req, AUTH_BODY_BYTES);
    if (values.grant_type === 'authorization_code') {
      store.cleanup();
      const index = store.state.oauthCodes.findIndex((entry) => entry.hash === digest(values.code));
      const code = store.state.oauthCodes[index];
      if (!validPkceValue(values.code_verifier)) return json(res, 400, { error: 'invalid_grant' });
      const verifierHash = createHash('sha256').update(String(values.code_verifier || '')).digest('base64url');
      if (!code || code.clientId !== values.client_id || code.redirectUri !== values.redirect_uri || code.codeChallenge !== verifierHash || values.resource !== code.resource) return json(res, 400, { error: 'invalid_grant' });
      store.state.oauthCodes.splice(index, 1);
      const access = token(); const refresh = token();
      store.state.accessTokens.push({ hash: digest(access), userId: code.userId, clientId: code.clientId, scopes: code.scopes, resource: code.resource, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
      store.state.refreshTokens.push({ hash: digest(refresh), userId: code.userId, clientId: code.clientId, scopes: code.scopes, resource: code.resource, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() });
      store.save();
      return json(res, 200, { access_token: access, token_type: 'Bearer', expires_in: 900, refresh_token: refresh, scope: code.scopes.join(' ') });
    }
    if (values.grant_type === 'refresh_token') {
      store.cleanup();
      const index = store.state.refreshTokens.findIndex((entry) => entry.hash === digest(values.refresh_token));
      const previous = store.state.refreshTokens[index];
      if (!previous || previous.clientId !== values.client_id || values.resource !== previous.resource) return json(res, 400, { error: 'invalid_grant' });
      store.state.refreshTokens.splice(index, 1);
      const access = token(); const refresh = token();
      store.state.accessTokens.push({ ...previous, hash: digest(access), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
      store.state.refreshTokens.push({ ...previous, hash: digest(refresh), expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() });
      store.save();
      return json(res, 200, { access_token: access, token_type: 'Bearer', expires_in: 900, refresh_token: refresh, scope: previous.scopes.join(' ') });
    }
    return json(res, 400, { error: 'unsupported_grant_type' });
  }

  if (url.pathname === '/api/v1/pair' && req.method === 'POST') {
    if (!rateLimit(req, res, 'pair-global', 300, 15 * 60_000, 'all')) return;
    if (!rateLimit(req, res, 'pair', 30, 15 * 60_000)) return;
    const input = await jsonBody(req, AUTH_BODY_BYTES);
    store.cleanup();
    const pairing = store.state.pairingCodes.find((entry) => entry.hash === digest(String(input.code || '').toUpperCase()));
    if (!pairing) return json(res, 401, { error: 'Invalid or expired pairing code.' });
    pairing.usedAt = new Date().toISOString();
    const raw = token();
    store.state.deviceTokens.push({ hash: digest(raw), userId: pairing.userId, spaceId: pairing.spaceId, kind: pairing.kind || 'publisher', grandfathered: false, deviceName: String(input.deviceName || 'Nodus Desktop').slice(0, 120), createdAt: new Date().toISOString(), lastUsedAt: null });
    store.save();
    const space = store.state.spaces.find((entry) => entry.id === pairing.spaceId);
    return json(res, 200, { accessToken: raw, space: { id: space.id, name: space.name }, server: { name: store.state.settings.name, publicUrl: publicUrl(), language: language() } });
  }

  if (url.pathname === '/api/v1/settings/language' && req.method === 'PUT') {
    // The web interface language is server-wide, so only a space owner may change it.
    // `boundSpace` keeps even this path-less route inside the central live-membership gate.
    const auth = authorize(req, res, { need: 'own', via: ['device'], resource: 'api', boundSpace: true });
    if (!auth) return;
    const input = await jsonBody(req, 4 * 1024);
    if (typeof input.language !== 'string' || normalizeServerLanguage(input.language) !== input.language) {
      return json(res, 400, { error: 'Unsupported server language.' });
    }
    store.state.settings.language = input.language;
    store.save();
    return json(res, 200, { language: normalizeServerLanguage(store.state.settings.language) });
  }

  if (url.pathname === '/') {
    const current = requireSession(req, res); if (!current) return;
    if (current.user.role !== 'admin') return redirect(res, '/account');
    return html(res, 200, dashboard(current, url.searchParams.get('notice') || ''));
  }
  if (url.pathname === '/logout' && req.method === 'POST') {
    const current = requireSession(req, res); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    store.state.sessions = store.state.sessions.filter((entry) => entry.hash !== current.session.hash); store.save();
    return redirect(res, '/login', { 'set-cookie': 'nodus_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
  }
  if (url.pathname === '/admin/spaces' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const createdAt = new Date().toISOString();
    const space = { id: randomUUID(), name: String(values.name || '').trim().slice(0, 120), description: String(values.description || '').trim().slice(0, 500), vaultType: normalizeVaultType(values.vaultType) || 'academic', nameEdited: true, createdAt, updatedAt: null, revision: '', bytes: 0, receiveSequence: 0,
      provenance: { schemaVersion: 4, originInstanceId: store.state.settings.instanceId, originDeviceId: 'server-web', createdBy: current.user.id, createdAt } };
    if (!space.name) return adminDashboardResponse(req, res, current, 400, 'The space needs a name.');
    store.state.spaces.push(space); store.state.memberships.push({ userId: current.user.id, spaceId: space.id, role: 'owner' }); store.save();
    return redirect(res, adminRedirect(req, 'Space created.'));
  }
  if (url.pathname === '/admin/spaces/name' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const space = store.state.spaces.find((entry) => entry.id === values.spaceId);
    if (!space) return html(res, 404, page(tr('error'), `<h1>${tr('spaceNotFound')}</h1>`));
    const name = String(values.name || '').trim().slice(0, 120);
    if (!name) return adminDashboardResponse(req, res, current, 400, 'The space needs a name.');
    space.name = name;
    // A deliberate administration name wins over later local reprovisioning of the vault.
    space.nameEdited = true;
    store.save();
    return redirect(res, adminRedirect(req, 'Space name updated.'));
  }
  if (url.pathname === '/admin/spaces/policy' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const space = store.state.spaces.find((entry) => entry.id === values.spaceId);
    if (!space) return html(res, 404, page(tr('error'), `<h1>${tr('spaceNotFound')}</h1>`));
    const enabled = (field) => ['on', 'true', '1'].includes(String(values[field] || '').toLowerCase());
    space.publicationPolicy = {
      version: 1,
      allowUserContent: enabled('allowUserContent'),
      allowPersonalImports: enabled('allowPersonalImports') || enabled('allowLegacyPublisherImport'),
      allowLibraryDocuments: enabled('allowLibraryDocuments'),
      allowPassages: enabled('allowPassages'),
      allowVectors: enabled('allowVectors'),
      allowPrimarySources: enabled('allowPrimarySources'),
      allowTestimonies: enabled('allowTestimonies'),
      publishPersonalAnnotations: false,
      updatedAt: new Date().toISOString(),
    };
    space.publicationPolicy.allowLegacyPublisherImport = space.publicationPolicy.allowPersonalImports;
    store.save();
    return redirect(res, adminRedirect(req, 'Publication policy updated.'));
  }
  if (url.pathname === '/admin/spaces/clear-request' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const space = store.state.spaces.find((entry) => entry.id === values.spaceId);
    if (!space) return html(res, 404, page(tr('error'), `<h1>${tr('spaceNotFound')}</h1>`));
    return html(res, 200, page(tr('deletePublication'), `<div class="page-heading"><div><p class="eyebrow">${tr('spaces')}</p><h1>${tr('deletePublicationHeading')}</h1></div><a class="button-link" href="/">${tr('cancel')}</a></div><div class="card danger-card"><p>${tr('deletePublicationHelp', { name: `<strong>${escapeHtml(space.name)}</strong>` })}</p><form method="post" action="/admin/spaces/clear"><input type="hidden" name="csrf" value="${current.session.csrf}"><input type="hidden" name="spaceId" value="${space.id}"><button class="danger" type="submit">${tr('deletePermanently')}</button></form></div>`));
  }
  if (url.pathname === '/admin/spaces/clear' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const space = store.state.spaces.find((entry) => entry.id === values.spaceId);
    if (!space) return html(res, 404, page(tr('error'), `<h1>${tr('spaceNotFound')}</h1>`));
    store.removeSnapshot(space.id); snapshotCache.delete(space.id);
    // Deleting a publication also revokes its publishers so an open desktop app
    // cannot silently recreate data the administrator has just removed.
    store.state.deviceTokens = store.state.deviceTokens.filter((entry) => entry.spaceId !== space.id);
    store.state.pairingCodes = store.state.pairingCodes.filter((entry) => entry.spaceId !== space.id);
    // Jobs can contain private prompts and generated output. A publication deletion must
    // not leave those records orphaned in the server-wide control file.
    store.state.spaceActions = (store.state.spaceActions ?? []).filter((entry) => entry.spaceId !== space.id);
    space.vaultType = spaceVaultType(space) || space.vaultType || '';
    space.updatedAt = null; space.revision = ''; space.vault = null;
    space.bytes = 0; space.assetBytes = 0; space.libraryPackageBytes = 0; store.save();
    return redirect(res, adminRedirect(req, 'Publication deleted from the server.'));
  }
  if (url.pathname === '/admin/users' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    try {
      const user = store.createUser(values.email, values.password, 'member');
      // A researcher is rarely given exactly one space, and their level differs per space:
      // reader on a colleague's corpus, writer on the shared one. Both are set here at once.
      const grants = readSpaceGrants(values);
      for (const grant of grants) store.state.memberships.push({ userId: user.id, spaceId: grant.spaceId, role: grant.role });
      if (grants.length) store.save();
      return redirect(res, adminRedirect(req, `User created with access to ${grants.length} space(s).`));
    } catch (error) { return adminDashboardResponse(req, res, current, 400, error instanceof Error ? error.message : String(error)); }
  }
  if (url.pathname === '/admin/users/access' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const user = store.state.users.find((entry) => entry.id === values.userId);
    if (!user) return adminDashboardResponse(req, res, current, 400, 'Invalid user.');
    const desired = new Map(readSpaceGrants(values).map((grant) => [grant.spaceId, grant.role]));
    const existing = store.state.memberships.filter((entry) => entry.userId === user.id);

    // Validate the complete edit before changing anything, so one invalid last-owner change
    // cannot leave the other vault permissions half-applied.
    for (const entry of existing) {
      const nextRole = desired.get(entry.spaceId);
      if (entry.role === 'owner' && nextRole !== 'owner' && ownerCount(entry.spaceId) <= 1) {
        return adminDashboardResponse(req, res, current, 400, 'A space needs at least one owner. Grant owner access to another account before changing this one.');
      }
    }

    const removedSpaceIds = new Set(existing.filter((entry) => !desired.has(entry.spaceId)).map((entry) => entry.spaceId));
    store.state.memberships = store.state.memberships.filter((entry) => entry.userId !== user.id || desired.has(entry.spaceId));
    for (const [spaceId, role] of desired) {
      const entry = membership(user.id, spaceId);
      if (entry) entry.role = role;
      else store.state.memberships.push({ userId: user.id, spaceId, role });
    }
    if (removedSpaceIds.size) {
      store.state.deviceTokens = store.state.deviceTokens.filter((device) => device.userId !== user.id || !removedSpaceIds.has(device.spaceId));
      store.state.pairingCodes = store.state.pairingCodes.filter((pairing) => pairing.userId !== user.id || !removedSpaceIds.has(pairing.spaceId));
    }
    store.save();
    return redirect(res, adminRedirect(req, 'User access updated.'));
  }
  if (url.pathname === '/admin/access/role' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const entry = membership(values.userId, values.spaceId);
    if (!entry) return adminDashboardResponse(req, res, current, 400, 'That access cannot be changed here.');
    if (!isSpaceRole(values.role)) return adminDashboardResponse(req, res, current, 400, 'Unknown access level.');
    // A space with no owner can never be published to again, and nothing in the interface
    // can undo that. Demoting the last one is refused; demoting one of several is fine.
    if (entry.role === 'owner' && values.role !== 'owner' && ownerCount(values.spaceId) <= 1) {
      return adminDashboardResponse(req, res, current, 400, 'A space needs at least one owner. Grant owner access to another account before changing this one.');
    }
    entry.role = values.role;
    // Nothing else to revoke: authorize() reads the role live on every request, so an
    // already-issued device or OAuth token drops to the new level on its very next call.
    store.save();
    return redirect(res, adminRedirect(req, 'Access level updated.'));
  }
  if (url.pathname === '/admin/access/grant' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const user = store.state.users.find((entry) => entry.id === values.userId);
    const space = store.state.spaces.find((entry) => entry.id === values.spaceId);
    if (!user || !space) return adminDashboardResponse(req, res, current, 400, 'Invalid user or space.');
    const role = isSpaceRole(values.role) ? values.role : 'reader';
    if (!membership(user.id, space.id)) { store.state.memberships.push({ userId: user.id, spaceId: space.id, role }); store.save(); }
    return redirect(res, adminRedirect(req, `Access granted (${role}).`));
  }
  if (url.pathname === '/admin/access/revoke' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const entry = membership(values.userId, values.spaceId);
    if (!entry) return adminDashboardResponse(req, res, current, 400, 'That access cannot be revoked here.');
    if (entry.role === 'owner' && ownerCount(values.spaceId) <= 1) {
      return adminDashboardResponse(req, res, current, 400, 'A space needs at least one owner. Grant owner access to another account before revoking this one.');
    }
    store.state.memberships = store.state.memberships.filter((candidate) => candidate !== entry);
    store.state.deviceTokens = store.state.deviceTokens.filter((device) => device.userId !== values.userId || device.spaceId !== values.spaceId);
    store.save();
    return redirect(res, adminRedirect(req, 'Access revoked.'));
  }
  if (url.pathname === '/admin/devices/revoke' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    store.state.deviceTokens = store.state.deviceTokens.filter((entry) => entry.hash !== values.tokenHash); store.save();
    return redirect(res, adminRedirect(req, 'Device revoked.'));
  }
  if (url.pathname === '/admin/pairing' && req.method === 'POST') {
    const current = requireSession(req, res, true); if (!current) return;
    const values = await form(req, AUTH_BODY_BYTES); if (!checkCsrf(current, values.csrf)) return html(res, 403, page(tr('error'), `<h1>${tr('sessionExpired')}</h1>`));
    const access = membership(current.user.id, values.spaceId);
    if (!access || !canRole(normalizeSpaceRole(access.role), 'own')) return html(res, 403, page(tr('error'), '<h1>Only a space owner can create a publisher pairing.</h1>'));
    const raw = pairingCode();
    store.state.pairingCodes.push({ hash: digest(raw), userId: current.user.id, spaceId: values.spaceId, kind: 'publisher', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), usedAt: null }); store.save();
    return html(res, 200, page(tr('createPairing'), `<div class="page-heading"><div><p class="eyebrow">${tr('publisherDevices')}</p><h1>${tr('connectDesktop')}</h1></div><a class="button-link" href="/">${tr('back')}</a></div><div class="card code-panel"><p>${tr('pairingHelp')}</p><h2><code>${raw}</code></h2><p class="muted">${tr('pairingExpiry')}</p></div>`));
  }
  return json(res, 404, { error: 'not_found' });
}

const handler = (req, res) => {
  const requestLanguage = normalizeServerLanguage(cookies(req).nodus_language || store.state.settings.language);
  languageContext.run(requestLanguage, () => {
    Promise.resolve(route(req, res)).catch((error) => {
      console.error('[server]', redactStructured({
        name: error?.name || 'Error', code: error?.code || null,
        message: error?.message || 'Unhandled server error',
      }));
      if (!res.headersSent) json(res, Number(error?.statusCode) || 500, { error: Number(error?.statusCode) ? error.message : tr('internalError') });
      else res.end();
    });
  });
};

function applyLimits(instance) {
  instance.requestTimeout = 5 * 60_000;
  instance.headersTimeout = 65_000;
  instance.maxHeadersCount = 100;
  instance.maxRequestsPerSocket = 1_000;
  return instance;
}

const server = applyLimits(TLS ? https.createServer({ cert: TLS.cert, key: TLS.key }, handler) : http.createServer(handler));
const relay = new BridgeRelay({
  records: () => store.state.bridgeRelayChannels ??= [], save: () => store.save(),
  isOwnerActive: record => {
    const device = store.state.deviceTokens.find(item => item.hash === record.ownerDeviceHash && (!item.expiresAt || Date.parse(item.expiresAt) > Date.now()));
    return Boolean(device && store.state.users.some(user => user.id === device.userId) &&
      store.state.memberships.some(member => member.userId === device.userId && member.spaceId === device.spaceId && canRole(normalizeSpaceRole(member.role), 'own')));
  },
});
relay.attach(server);
const scheme = TLS ? 'https' : 'http';
let pending = HOSTS.length;
for (const host of HOSTS) {
  server.listen(PORT, host, () => {
    console.log(`[nodus-server] listening on ${scheme}://${host}:${PORT}`);
    pending -= 1;
    if (pending > 0) return;
    console.log(`[nodus-server] public URL: ${publicUrl()}`);
    if (!ENVIRONMENT_ADMIN_CONFIGURED && store.state.users.length === 0 && (!SETUP_TOKEN || SETUP_TOKEN.length < 16)) console.warn('[nodus-server] Configure NODUS_ADMIN_EMAIL + NODUS_ADMIN_PASSWORD, or provide a temporary NODUS_SETUP_TOKEN with at least 16 characters.');
  });
}

if (LOOPBACK_PORT) {
  if (!TLS) throw new Error('NODUS_LOOPBACK_PORT is only meaningful when TLS is configured; without it the main listener already speaks HTTP.');
  const loopback = applyLimits(http.createServer(handler));
  relay.attach(loopback);
  loopback.listen(LOOPBACK_PORT, '127.0.0.1', () => {
    console.log(`[nodus-server] loopback listener on http://127.0.0.1:${LOOPBACK_PORT}`);
  });
}
