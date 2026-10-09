import { app } from 'electron';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import AdmZip from 'adm-zip';
import type { McpTunnelConnectInput, McpTunnelErrorCode, McpTunnelStatus } from '@shared/types';
import {
  classifyMcpTunnelFailure,
  isIgnorableLocalMcpOAuthDoctorFailure,
  isValidMcpTunnelId,
  mcpTunnelAssetName,
} from '@shared/mcpTunnel';
import { getSettings, updateSettings } from '../db/settingsRepo';
import {
  clearMcpTunnelApiKey,
  getMcpTunnelApiKey,
  hasMcpTunnelApiKey,
  setMcpTunnelApiKey,
} from '../secrets/secretStore';
import { getMcpStatus, startMcpServer } from './server';

const RELEASE_API = 'https://api.github.com/repos/openai/tunnel-client/releases/latest';
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const DOCTOR_TIMEOUT_MS = 45_000;
const READY_TIMEOUT_MS = 25_000;

interface TunnelConfig {
  tunnelId: string;
  enabled: boolean;
}

interface RuntimeMetadata {
  tag: string;
  assetName: string;
  sha256: string;
  executable: string;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
}

type TunnelChild = ChildProcessByStdio<null, Readable, Readable>;

let status: McpTunnelStatus = {
  configured: false,
  enabled: false,
  hasApiKey: false,
  phase: 'not_configured',
  tunnelId: null,
  clientVersion: null,
  installProgress: null,
  uiUrl: null,
  errorCode: null,
  errorDetail: null,
};
let activeChild: TunnelChild | null = null;
let activeLogs = '';
let runGeneration = 0;
let lifecycle = Promise.resolve();
let installPromise: Promise<RuntimeMetadata> | null = null;

function rootDirectory(): string {
  return path.join(app.getPath('userData'), 'mcp-tunnel');
}

function configFile(): string {
  return path.join(rootDirectory(), 'config.json');
}

function metadataFile(): string {
  return path.join(rootDirectory(), 'runtime.json');
}

function healthUrlFile(): string {
  return path.join(rootDirectory(), 'health.url');
}

function binaryName(): string {
  return process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client';
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function readConfig(): TunnelConfig | null {
  const parsed = readJson<Partial<TunnelConfig>>(configFile());
  if (!parsed || typeof parsed.tunnelId !== 'string' || !isValidMcpTunnelId(parsed.tunnelId)) return null;
  return { tunnelId: parsed.tunnelId, enabled: parsed.enabled === true };
}

function writeConfig(config: TunnelConfig): void {
  fs.mkdirSync(rootDirectory(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(configFile(), 0o600); } catch { /* best effort on Windows */ }
}

function readRuntimeMetadata(): RuntimeMetadata | null {
  const parsed = readJson<RuntimeMetadata>(metadataFile());
  if (!parsed
    || !/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(parsed.tag)
    || !/^[0-9a-f]{64}$/.test(parsed.sha256)
    || parsed.assetName !== mcpTunnelAssetName(parsed.tag, process.platform, process.arch)) return null;
  const expected = path.join(rootDirectory(), 'runtime', parsed.tag, binaryName());
  if (path.resolve(parsed.executable) !== path.resolve(expected)) return null;
  try {
    const stat = fs.lstatSync(expected);
    const root = fs.realpathSync(rootDirectory());
    const realExecutable = fs.realpathSync(expected);
    if (!stat.isFile() || stat.isSymbolicLink() || !realExecutable.startsWith(`${root}${path.sep}`)) return null;
  } catch {
    return null;
  }
  return parsed;
}

function publicStatus(): McpTunnelStatus {
  const config = readConfig();
  const runtime = readRuntimeMetadata();
  return {
    ...status,
    configured: Boolean(config && hasMcpTunnelApiKey()),
    enabled: config?.enabled === true,
    hasApiKey: hasMcpTunnelApiKey(),
    tunnelId: config?.tunnelId ?? null,
    clientVersion: runtime?.tag.replace(/^v/, '') ?? status.clientVersion,
  };
}

function setStatus(patch: Partial<McpTunnelStatus>): McpTunnelStatus {
  status = { ...status, ...patch };
  return publicStatus();
}

function fail(code: McpTunnelErrorCode, detail: string): McpTunnelStatus {
  return setStatus({
    phase: 'error',
    installProgress: null,
    uiUrl: null,
    errorCode: code,
    errorDetail: sanitizeDiagnostic(detail),
  });
}

function sanitizeDiagnostic(value: string, secrets: string[] = []): string {
  let clean = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) ? ' ' : character;
  }).join('');
  for (const secret of secrets) {
    if (secret) clean = clean.split(secret).join('<redacted>');
  }
  clean = clean
    .replace(/(?:sk|sess|key)-[A-Za-z0-9_-]{12,}/g, '<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi, 'Bearer <redacted>')
    .trim();
  return clean.slice(-1_500);
}

function queue<T>(job: () => Promise<T>): Promise<T> {
  const next = lifecycle.then(job, job);
  lifecycle = next.then(() => undefined, () => undefined);
  return next;
}

async function fetchChecked(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Nodus/${app.getVersion()}` },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP status ${response.status} al descargar ${new URL(url).hostname}.`);
  return response;
}

function trustedReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith('/openai/tunnel-client/releases/download/');
  } catch {
    return false;
  }
}

async function releaseDigest(release: GitHubRelease, asset: GitHubAsset): Promise<string> {
  const direct = asset.digest?.match(/^sha256:([0-9a-f]{64})$/i)?.[1];
  if (direct) return direct.toLowerCase();
  const sums = release.assets.find((candidate) => candidate.name === 'SHA256SUMS.txt');
  if (!sums || !trustedReleaseUrl(sums.browser_download_url)) throw new Error('La versión oficial no publica una suma SHA-256 verificable.');
  const text = await (await fetchChecked(sums.browser_download_url)).text();
  const match = text.split(/\r?\n/).map((line) => line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i))
    .find((candidate) => candidate?.[2] === asset.name);
  if (!match) throw new Error(`SHA-256 ausente para ${asset.name}.`);
  return match[1].toLowerCase();
}

async function latestReleaseAsset(): Promise<{ release: GitHubRelease; asset: GitHubAsset; sha256: string }> {
  const release = await (await fetchChecked(RELEASE_API)).json() as GitHubRelease;
  if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(release.tag_name)) {
    throw new Error('La versión publicada del cliente de túnel no es válida.');
  }
  const wanted = mcpTunnelAssetName(release.tag_name, process.platform, process.arch);
  if (!wanted) throw new Error(`Plataforma no soportada: ${process.platform}-${process.arch}.`);
  const asset = release.assets.find((candidate) => candidate.name === wanted);
  if (!asset || !trustedReleaseUrl(asset.browser_download_url)) {
    throw new Error(`OpenAI no ofrece ${wanted} en la versión actual.`);
  }
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`Tamaño no válido para ${wanted}.`);
  }
  return { release, asset, sha256: await releaseDigest(release, asset) };
}

async function downloadArchive(asset: GitHubAsset, expectedSha256: string, target: string): Promise<void> {
  const response = await fetchChecked(asset.browser_download_url);
  const contentLength = Number(response.headers.get('content-length') ?? asset.size);
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_ARCHIVE_BYTES) {
    throw new Error('El archivo oficial supera el tamaño permitido.');
  }
  if (!response.body) throw new Error('La descarga oficial no devolvió contenido.');
  const handle = await fsp.open(target, 'w', 0o600);
  const hash = createHash('sha256');
  let received = 0;
  try {
    const reader = response.body.getReader();
    let completed = false;
    while (!completed) {
      const result = await reader.read();
      if (result.done) {
        completed = true;
      } else {
        const chunk = Buffer.from(result.value);
        received += chunk.length;
        if (received > MAX_ARCHIVE_BYTES) throw new Error('La descarga oficial supera el tamaño permitido.');
        hash.update(chunk);
        await handle.write(chunk);
        setStatus({ installProgress: Math.max(0, Math.min(0.95, received / asset.size)) });
      }
    }
  } finally {
    await handle.close();
  }
  if (received !== asset.size) throw new Error(`Descarga incompleta: ${received} de ${asset.size} bytes.`);
  const actual = hash.digest('hex');
  if (actual !== expectedSha256) throw new Error(`Fallo de integridad SHA-256 (${actual}).`);
}

async function installLatestTunnelClient(): Promise<RuntimeMetadata> {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    setStatus({ phase: 'installing', installProgress: 0, errorCode: null, errorDetail: null, uiUrl: null });
    await fsp.mkdir(rootDirectory(), { recursive: true });
    const { release, asset, sha256 } = await latestReleaseAsset();
    const current = readRuntimeMetadata();
    if (current?.tag === release.tag_name && current.sha256 === sha256 && fs.existsSync(current.executable)) {
      setStatus({ clientVersion: release.tag_name.replace(/^v/, ''), installProgress: 1 });
      return current;
    }

    const partial = path.join(rootDirectory(), `${asset.name}.download`);
    await fsp.rm(partial, { force: true });
    try {
      await downloadArchive(asset, sha256, partial);
      const archive = new AdmZip(partial);
      const entry = archive.getEntry(binaryName());
      if (!entry || entry.isDirectory || entry.header.size <= 0 || entry.header.size > MAX_ARCHIVE_BYTES) {
        throw new Error(`El paquete verificado no contiene ${binaryName()}.`);
      }
      const directory = path.join(rootDirectory(), 'runtime', release.tag_name);
      await fsp.mkdir(directory, { recursive: true });
      const executable = path.join(directory, binaryName());
      const temporaryExecutable = `${executable}.tmp-${process.pid}`;
      await fsp.writeFile(temporaryExecutable, entry.getData(), { mode: 0o700 });
      if (process.platform !== 'win32') await fsp.chmod(temporaryExecutable, 0o700);
      await fsp.rm(executable, { force: true });
      await fsp.rename(temporaryExecutable, executable);
      const metadata: RuntimeMetadata = { tag: release.tag_name, assetName: asset.name, sha256, executable };
      await fsp.writeFile(metadataFile(), JSON.stringify(metadata, null, 2), { encoding: 'utf8', mode: 0o600 });
      setStatus({ clientVersion: release.tag_name.replace(/^v/, ''), installProgress: 1 });
      return metadata;
    } finally {
      await fsp.rm(partial, { force: true });
    }
  })().finally(() => { installPromise = null; });
  return installPromise;
}

function tunnelEnvironment(config: TunnelConfig, apiKey: string): NodeJS.ProcessEnv {
  const settings = getSettings();
  if (!settings.mcpToken) throw new Error('El servidor MCP local todavía no tiene token.');
  // The port the server is ACTUALLY on. When the configured port is taken, listenLoopback moves
  // the server to a free one; building the URL from the setting sent the bearer token, and every
  // remote call, to whatever other process held the configured port.
  const live = getMcpStatus();
  if (!live.running || !live.port) throw new Error('El servidor MCP local no está activo.');
  return {
    ...process.env,
    CONTROL_PLANE_API_KEY: apiKey,
    CONTROL_PLANE_TUNNEL_ID: config.tunnelId,
    MCP_SERVER_URL: `http://127.0.0.1:${live.port}/mcp`,
    NODUS_MCP_AUTHORIZATION: `Bearer ${settings.mcpToken}`,
    MCP_EXTRA_HEADERS: 'Authorization: env:NODUS_MCP_AUTHORIZATION',
    MCP_DISCOVERY_EXTRA_HEADERS: 'Authorization: env:NODUS_MCP_AUTHORIZATION',
    HEALTH_LISTEN_ADDR: '127.0.0.1:0',
    HEALTH_URL_FILE: healthUrlFile(),
    LOG_FORMAT: 'json',
    LOG_LEVEL: 'info',
  };
}

async function runDoctor(executable: string, env: NodeJS.ProcessEnv, secrets: string[]): Promise<void> {
  setStatus({ phase: 'checking', installProgress: null, errorCode: null, errorDetail: null });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['doctor', '--json', '--explain'], {
      cwd: path.dirname(executable), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-32_000); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-32_000); });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('El diagnóstico del túnel agotó el tiempo de espera.'));
    }, DOCTOR_TIMEOUT_MS);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else if (env.MCP_SERVER_URL && isIgnorableLocalMcpOAuthDoctorFailure(stdout, env.MCP_SERVER_URL)) resolve();
      else {
        const output = [stdout, stderr].filter(Boolean).join('\n');
        reject(new Error(sanitizeDiagnostic(output || `doctor exited with ${code ?? signal ?? 'unknown'}`, secrets)));
      }
    });
  });
}

function appendRuntimeLog(chunk: Buffer): void {
  activeLogs = `${activeLogs}${chunk.toString('utf8')}`.slice(-32_000);
}

async function waitForReady(child: TunnelChild): Promise<string> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(activeLogs || 'tunnel-client exited before becoming ready');
    const baseUrl = await fsp.readFile(healthUrlFile(), 'utf8').then((value) => value.trim()).catch(() => '');
    if (baseUrl) {
      try {
        const ready = await fetch(`${baseUrl}/readyz`, { signal: AbortSignal.timeout(1_500) });
        if (ready.ok) return baseUrl;
      } catch { /* startup race; retry */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(activeLogs || 'tunnel-client did not become ready in time');
}

async function stopActiveChild(): Promise<void> {
  const child = activeChild;
  activeChild = null;
  runGeneration++;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_500)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function launchConfigured(config: TunnelConfig, runtime: RuntimeMetadata, apiKey: string): Promise<McpTunnelStatus> {
  const secrets = [apiKey, getSettings().mcpToken];
  const env = tunnelEnvironment(config, apiKey);
  await runDoctor(runtime.executable, env, secrets);
  await stopActiveChild();
  await fsp.rm(healthUrlFile(), { force: true });
  activeLogs = '';
  const generation = ++runGeneration;
  const child = spawn(runtime.executable, ['run'], {
    cwd: path.dirname(runtime.executable), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  activeChild = child;
  child.stdout.on('data', appendRuntimeLog);
  child.stderr.on('data', appendRuntimeLog);
  child.once('exit', (code, signal) => {
    if (activeChild === child) activeChild = null;
    if (generation !== runGeneration) return;
    fail('client_stopped', sanitizeDiagnostic(activeLogs || `tunnel-client exited with ${code ?? signal ?? 'unknown'}`, secrets));
  });
  setStatus({ phase: 'connecting', uiUrl: null, errorCode: null, errorDetail: null });
  try {
    const baseUrl = await waitForReady(child);
    return setStatus({
      phase: 'connected',
      clientVersion: runtime.tag.replace(/^v/, ''),
      installProgress: null,
      uiUrl: `${baseUrl}/ui`,
      errorCode: null,
      errorDetail: null,
    });
  } catch (error) {
    await stopActiveChild();
    throw error;
  }
}

async function connectConfigured(checkForUpdate: boolean): Promise<McpTunnelStatus> {
  const config = readConfig();
  const apiKey = getMcpTunnelApiKey();
  if (!config) return fail('invalid_tunnel_id', 'Tunnel ID ausente o inválido.');
  if (!apiKey) return fail('missing_api_key', 'Runtime API key ausente.');
  if (!getSettings().mcpEnabled) return setStatus({ phase: 'stopped', uiUrl: null, errorCode: null, errorDetail: null });
  if (!getMcpStatus().running) await startMcpServer();
  if (!getMcpStatus().running) return fail('local_server', getMcpStatus().error ?? 'El servidor MCP local no está activo.');
  let runtime: RuntimeMetadata;
  try {
    const installed = checkForUpdate ? null : readRuntimeMetadata();
    runtime = installed ?? await installLatestTunnelClient();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const classified = classifyMcpTunnelFailure(detail);
    const code = classified === 'integrity_failed' || classified === 'unsupported_platform'
      ? classified
      : 'download_failed';
    return fail(code, detail);
  }
  try {
    return await launchConfigured(config, runtime, apiKey);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(classifyMcpTunnelFailure(detail), detail);
  }
}

export function getMcpTunnelStatus(): McpTunnelStatus {
  const current = publicStatus();
  if (!current.configured && current.phase !== 'installing' && current.phase !== 'checking') {
    status = { ...current, phase: 'not_configured', uiUrl: null };
  }
  return publicStatus();
}

export function connectMcpTunnel(input: McpTunnelConnectInput): Promise<McpTunnelStatus> {
  return queue(async () => {
    const tunnelId = typeof input?.tunnelId === 'string' ? input.tunnelId.trim() : '';
    if (!isValidMcpTunnelId(tunnelId)) return fail('invalid_tunnel_id', 'Expected tunnel_ followed by 32 lowercase hexadecimal characters.');
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (apiKey) setMcpTunnelApiKey(apiKey);
    if (!hasMcpTunnelApiKey()) return fail('missing_api_key', 'A runtime API key is required.');
    writeConfig({ tunnelId, enabled: true });
    if (!getSettings().mcpEnabled) updateSettings({ mcpEnabled: true });
    if (!getMcpStatus().running) await startMcpServer();
    return connectConfigured(true);
  });
}

/** Start automatically after the local MCP listener is healthy. */
export function startMcpTunnelIfConfigured(): Promise<McpTunnelStatus> {
  return queue(async () => {
    const config = readConfig();
    if (!config?.enabled || !getSettings().mcpEnabled) {
      return setStatus({ phase: config ? 'stopped' : 'not_configured', uiUrl: null, errorCode: null, errorDetail: null });
    }
    return connectConfigured(false);
  });
}

/** Stop the process but preserve the user's auto-start preference and credentials. */
export function stopMcpTunnel(): Promise<void> {
  return queue(async () => {
    await stopActiveChild();
    const config = readConfig();
    setStatus({ phase: config ? 'stopped' : 'not_configured', uiUrl: null, installProgress: null, errorCode: null, errorDetail: null });
  });
}

export function restartMcpTunnelIfConfigured(): Promise<McpTunnelStatus> {
  return queue(async () => {
    await stopActiveChild();
    const config = readConfig();
    if (!config?.enabled || !getSettings().mcpEnabled) {
      return setStatus({ phase: config ? 'stopped' : 'not_configured', uiUrl: null, errorCode: null, errorDetail: null });
    }
    return connectConfigured(false);
  });
}

export function disconnectMcpTunnel(): Promise<McpTunnelStatus> {
  return queue(async () => {
    await stopActiveChild();
    const config = readConfig();
    if (config) writeConfig({ ...config, enabled: false });
    return setStatus({ phase: config ? 'stopped' : 'not_configured', uiUrl: null, installProgress: null, errorCode: null, errorDetail: null });
  });
}

export function forgetMcpTunnel(): Promise<McpTunnelStatus> {
  return queue(async () => {
    await stopActiveChild();
    clearMcpTunnelApiKey();
    await fsp.rm(configFile(), { force: true });
    status = {
      configured: false, enabled: false, hasApiKey: false, phase: 'not_configured', tunnelId: null,
      clientVersion: readRuntimeMetadata()?.tag.replace(/^v/, '') ?? null,
      installProgress: null, uiUrl: null, errorCode: null, errorDetail: null,
    };
    return publicStatus();
  });
}

/** Best-effort synchronous kill for Electron's non-awaitable before-quit event. */
export function killMcpTunnelSync(): void {
  runGeneration++;
  const child = activeChild;
  activeChild = null;
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
}
