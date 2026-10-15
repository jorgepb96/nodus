import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';

// The MCP server falls back to a free port when the configured one is taken. The tunnel built
// its local URL from the SETTING, so it sent `Authorization: Bearer <mcpToken>` and every remote
// tool call to whichever process held the configured port.

const root = path.resolve(import.meta.dirname, '..');

test('the local server really does move off a taken port', async () => {
  const { build } = await import('esbuild');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-mcp-port-'));
  const bundle = path.join(scratch, 'listen.cjs');
  await build({ entryPoints: [path.join(root, 'electron/listenLoopback.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const { listenLoopback } = createRequire(import.meta.url)(bundle);
  const squatter = net.createServer();
  await new Promise(resolve => squatter.listen(0, '127.0.0.1', resolve));
  const taken = squatter.address().port;
  const server = http.createServer();
  try {
    const port = await listenLoopback(server, taken);
    assert.notEqual(port, taken, 'the server is elsewhere, and the configured port belongs to someone else');
  } finally {
    server.close(); squatter.close(); fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the tunnel points at the port the server is on, not the configured one', () => {
  const source = fs.readFileSync(path.join(root, 'electron/mcp/tunnel.ts'), 'utf8');
  const body = source.slice(source.indexOf('function tunnelEnvironment'), source.indexOf('async function runDoctor'));
  assert.doesNotMatch(body, /settings\.mcpPort/, 'the setting is not where the server necessarily is');
  assert.match(body, /getMcpStatus\(\)/);
  assert.match(body, /MCP_SERVER_URL: `http:\/\/127\.0\.0\.1:\$\{live\.port\}\/mcp`/);
});
