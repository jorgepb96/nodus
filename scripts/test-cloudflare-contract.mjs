import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { getMutations } from '../cloudflare/src/sync.mjs';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Cloudflare Worker bundles and every source module parses', () => {
  for (const file of fs.readdirSync(path.join(root, 'cloudflare', 'src')).filter((name) => name.endsWith('.mjs'))) {
    execFileSync(process.execPath, ['--check', path.join(root, 'cloudflare', 'src', file)]);
  }
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-cloudflare-worker.mjs')]);
  assert.ok(fs.statSync(path.join(root, 'cloudflare', 'dist', 'worker.mjs')).size > 100_000);
});

test('D1 schema covers auth, publication, idempotency, sync and recovery', () => {
  const sql = fs.readdirSync(path.join(root, 'cloudflare', 'migrations')).sort()
    .map((name) => read(`cloudflare/migrations/${name}`)).join('\n');
  for (const table of ['installation', 'users', 'spaces', 'memberships', 'device_tokens', 'sessions', 'oauth_clients', 'oauth_codes', 'oauth_tokens', 'publications', 'published_rows', 'objects', 'multipart_uploads', 'vector_sets', 'vector_chunks', 'vector_members', 'mutations', 'private_mutation_ownership', 'rate_limits', 'recovery_events', 'space_actions', 'library_record_versions', 'library_records', 'library_objects', 'library_commands']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(sql, /CREATE VIRTUAL TABLE IF NOT EXISTS published_search USING fts5/);
  assert.match(sql, /PRIMARY KEY \(space_id, generation, kind, chunk_id\)/);
  assert.match(sql, /PRIMARY KEY \(space_id, kind, hash\)/);
});

test('one generated mutation registry drives Desktop, local server, Cloudflare and Swift', async () => {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-mutation-contract.mjs')]);
  const contract = JSON.parse(read('shared/mutableTables.json'));
  assert.ok(Object.keys(contract.tables).length > 0, 'the generated registry must not be empty');
  const server = await import(`${pathToFileURL(path.join(root, 'server/lib/core/generatedMutableTables.mjs'))}?t=${Date.now()}`);
  const cloud = await import(`${pathToFileURL(path.join(root, 'cloudflare/src/generated/mutableTables.mjs'))}?t=${Date.now()}`);
  assert.deepEqual(server.MUTABLE_TABLES, contract.tables);
  assert.deepEqual(cloud.MUTABLE_TABLES, contract.tables);
  const desktop = read('electron/serverSync/generatedMutableTables.ts');
  for (const name of Object.keys(contract.tables)) assert.match(desktop, new RegExp(`['"]${name}['"]`));
  const mobilePath = path.resolve(root, '..', 'nodus-mobile/ios/Packages/NodusKit/Sources/NodusKit/Generated/MutableTable.generated.swift');
  if (fs.existsSync(mobilePath)) {
    const mobile = fs.readFileSync(mobilePath, 'utf8');
    for (const name of Object.keys(contract.tables)) assert.match(mobile, new RegExp(`= "${name}"`));
  }
});

test('pricing catalog is source-backed and has no non-official links', () => {
  const catalog = JSON.parse(read('cloudflare/catalog/pricing.v1.json'));
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(Date.parse(catalog.checkedAt));
  for (const source of Object.values(catalog.sources)) {
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'developers.cloudflare.com');
    assert.ok(Date.parse(source.checkedAt));
  }
  assert.equal(catalog.r2.egressPerGb, 0);
  assert.equal(catalog.vectorize.maxDimensions, 1536);
  assert.equal(catalog.vectorize.freeStoredDimensions, 5_000_000);
  assert.equal(catalog.vectorize.freeQueriedDimensionsPerMonth, 30_000_000);
});

test('Nodus has no Cloudflare control-plane credential or provisioning API', () => {
  const workerSources = fs.readdirSync(path.join(root, 'cloudflare', 'src')).filter((name) => name.endsWith('.mjs')).map((name) => read(`cloudflare/src/${name}`)).join('\n');
  assert.doesNotMatch(workerSources, /api\.cloudflare\.com|CLOUDFLARE_API_TOKEN|CLOUDFLARE_OAUTH/);
  const desktopSources = fs.readdirSync(path.join(root, 'electron', 'cloudflare')).filter((name) => name.endsWith('.ts')).map((name) => read(`electron/cloudflare/${name}`)).join('\n');
  assert.doesNotMatch(desktopSources, /api\.cloudflare\.com|dash\.cloudflare\.com\/oauth2|CLOUDFLARE_API_TOKEN|client_secret/i);
  const deployment = read('electron/cloudflare/deployment.ts');
  assert.match(read('shared/cloudflare.ts'), /https:\/\/deploy\.workers\.cloudflare\.com/);
  assert.match(deployment, /setupVerifier/);
  assert.doesNotMatch(deployment, /accessToken|refreshToken|listCloudflareAccounts/);
  assert.equal(fs.existsSync(path.join(root, 'electron', 'cloudflare', 'oauth.ts')), false);
  assert.equal(fs.existsSync(path.join(root, 'cloudflare', 'oauth-client.json')), false);
});

test('official deploy template is isolated and provisions D1/R2 itself', () => {
  const pkg = JSON.parse(read('cloudflare/package.json'));
  assert.equal(pkg.scripts.deploy, 'npm run db:migrate && wrangler deploy');
  assert.equal(pkg.scripts['db:migrate'], 'wrangler d1 migrations apply DB --remote');
  assert.doesNotMatch(JSON.stringify(pkg), /\.\.\//);
  const config = JSON.parse(read('cloudflare/wrangler.jsonc'));
  assert.equal(config.d1_databases[0].binding, 'DB');
  assert.equal(config.r2_buckets[0].binding, 'OBJECTS');
  assert.equal(config.workers_dev, true);
  assert.match(read('cloudflare/.dev.vars.example'), /^NODUS_BOOTSTRAP_SECRET_HASH=/m);
  assert.match(read('cloudflare/src/auth.mjs'), /sha256Hex\(supplied\)/);
  assert.doesNotMatch(read('cloudflare/src/auth.mjs'), /env\.NODUS_BOOTSTRAP_SECRET\b/);
  assert.equal(read('cloudflare/LICENSE'), read('LICENSE'));
  assert.match(read('cloudflare/src/admin.mjs'), /href="\/source"/);
  assert.match(read('cloudflare/src/worker.mjs'), /url\.pathname === '\/source'/);
  for (const file of fs.readdirSync(path.join(root, 'cloudflare', 'src'), { recursive: true }).filter((name) => String(name).endsWith('.mjs'))) {
    assert.doesNotMatch(read(`cloudflare/src/${file}`), /from\s+['"]\.\.\//, `${file} reaches outside the deploy template`);
  }
  for (const generated of ['generated/debates.mjs', 'generated/deepResearchReport.mjs']) {
    assert.ok(fs.statSync(path.join(root, 'cloudflare', 'src', generated)).size > 0, `${generated} is missing`);
  }
});

test('v3 routes, recovery and compatibility routes remain present', () => {
  const worker = read('cloudflare/src/worker.mjs');
  for (const pathFragment of ['/api/v3', 'API_PREFIX', '/recovery/index.json', '/mcp', '/.well-known/oauth-authorization-server', "head === 'pair'", "head === 'settings'", 'recoveryObjectMatch']) assert.ok(worker.includes(pathFragment));
  const client = read('shared/cloudflareClient.ts');
  assert.match(client, /\/api\/v3\/auth\/login/);
  assert.match(client, /\/api\/v3\/spaces\/\$\{encodeURIComponent\(this\.credentials\.spaceId\)\}\/snapshot/);
});

test('release package includes every migration and public deployment configuration', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-cloudflare-worker.mjs')]);
  const manifest = JSON.parse(read('cloudflare/dist/migrations.json'));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.migrations, fs.readdirSync(path.join(root, 'cloudflare/migrations')).filter(name => name.endsWith('.sql')).sort());
  for (const name of [...manifest.migrations, 'catalog-config.json', 'pricing.v1.json']) {
    assert.ok(fs.statSync(path.join(root, 'cloudflare', 'dist', name)).size > 0, `${name} is missing from the packaged resources`);
  }
  assert.equal(fs.existsSync(path.join(root, 'cloudflare', 'dist', 'oauth-client.json')), false);
});

test('publication routes stay account-isolated and the optional Bridge relay transports sealed frames', () => {
  const worker = read('cloudflare/src/worker.mjs');
  const actions = read('cloudflare/src/actions.mjs');
  const library = read('cloudflare/src/librarySync.mjs');
  assert.match(worker, /resource === 'actions'/);
  assert.match(worker, /head === 'library'/);
  assert.match(actions, /ACTION_KINDS = new Set/);
  assert.doesNotMatch(actions, /ipc|sql|methodName/i);
  assert.match(library, /WHERE user_id=\?1/);
  assert.match(library, /hash_mismatch/);
  assert.match(worker, /desktopBridgeRelay: Boolean\(env\.BRIDGE_RELAY\)/);
  assert.match(worker, /transport: 'end-to-end-encrypted-websocket'/);
  const relay = read('cloudflare/src/bridgeRelay.mjs');
  assert.match(relay, /auth\.space_role !== 'owner' \|\| auth\.device_kind !== 'publisher'/);
  assert.match(relay, /WHERE owner_device_id=\?1/);
  assert.match(relay, /typeof frame\.sealed !== 'string'/);
  assert.doesNotMatch(relay, /executeMobileOperation|ipcRenderer|JSON\.parse\(frame\.sealed\)/);
  assert.doesNotMatch(worker, /head === ['"]bridge['"]|resource === ['"]bridge['"]|pathname.*bridge\/v1/i);
  const privateTables = [
    'testimony_interviews', 'testimony_transcripts', 'teaching_students',
    'teaching_grade_entries', 'study_recordings', 'archive_item_files', 'prosop_person_profiles',
  ];
  const cloudSources = fs.readdirSync(path.join(root, 'cloudflare', 'src'), { recursive: true })
    .filter((name) => String(name).endsWith('.mjs'))
    .map((name) => read(`cloudflare/src/${name}`)).join('\n');
  for (const table of privateTables) assert.doesNotMatch(cloudSources, new RegExp(`['"]${table}['"]`));
});

test('publication object validation uses bounded D1 and R2 operations', () => {
  const source = read('cloudflare/src/publications.mjs');
  assert.match(source, /json_each\(\?1\)/);
  assert.match(source, /SELECT DISTINCT json_extract\(requested\.value, '\$\.hash'\)/);
  assert.match(source, /RETURNING object_key/);
  assert.match(source, /OBJECTS\.delete\(keys\)/);
  assert.doesNotMatch(source, /for \(const object of obsoleteObjects\)/);
  assert.doesNotMatch(source, /for \(const entry of objects\)[\s\S]{0,500}SELECT 1 AS value FROM objects/);
});

test('oversized structured rows remain portable through private R2 objects', () => {
  const publisher = read('electron/serverSync/cloudflarePublisher.ts');
  assert.match(publisher, /INLINE_D1_ROW_BYTES/);
  assert.match(publisher, /purpose: 'row'/);
  assert.match(read('cloudflare/src/publications.mjs'), /undeclared_row_reference/);
  assert.match(read('cloudflare/src/rows.mjs'), /resolvePublishedRows/);
  assert.match(read('cloudflare/src/admin.mjs'), /resolvePublishedRows/);
});

test('mutation missing assets are rejected before persistence', () => {
  const source = read('cloudflare/src/sync.mjs');
  const missing = source.indexOf("if (missing.size) throw new HttpError(409, 'missing_assets'");
  const insert = source.indexOf('for (const { mutation, verdict } of valid)');
  assert.ok(missing > 0 && insert > missing);
});

test('Cloudflare mutation reads preserve private ownership while advancing the shared cursor', async () => {
  const body = (value) => JSON.stringify(value);
  const rows = [
    { sequence: 1, user_id: 'user-a', body_json: body({ id: 'private-a', table: 'notes', key: ['n-a'], kind: 'upsert', row: { id: 'n-a', content: 'A' }, ownerScope: 'user:user-a', userId: 'user-a' }) },
    { sequence: 2, user_id: 'user-b', body_json: body({ id: 'private-b', table: 'notes', key: ['n-b'], kind: 'upsert', row: { id: 'n-b', content: 'B' }, ownerScope: 'user:user-b', userId: 'user-b' }) },
    { sequence: 3, user_id: 'user-a', body_json: body({ id: 'shared', table: 'pages', key: ['shared-page'], kind: 'upsert', row: { id: 'shared-page', title: 'Shared' }, ownerScope: 'vault', userId: 'user-a' }) },
    { sequence: 4, user_id: 'user-a', body_json: body({ id: 'private-child-a', table: 'page_blocks', key: ['b-a'], kind: 'upsert', row: { id: 'b-a', page_id: 'note:n-a', content: 'A child' }, ownerScope: 'user:user-a', userId: 'user-a' }) },
  ];
  const DB = {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async all() {
              if (!sql.includes('FROM mutations')) return { results: [] };
              const since = Number(bindings[1] || 0); const limit = Number(bindings[2] || 33);
              return { results: rows.filter((row) => row.sequence > since).slice(0, limit) };
            },
            async first() { return sql.includes('FROM spaces') ? { schema_version: 121 } : null; },
          };
        },
      };
    },
  };
  const result = await getMutations({ DB }, { space_id: 'space-a', user_id: 'user-b' }, new Request('https://server.example/api/v1/spaces/space-a/mutations?since=0'));
  assert.deepEqual(result.mutations.map((entry) => entry.id), ['private-b', 'shared']);
  assert.equal(result.cursor, 4, 'invisible private rows cannot block the global cursor');
});

test('Cloudflare actions are private to their actor and reject credential-shaped payloads', () => {
  const source = read('cloudflare/src/actions.mjs');
  assert.match(source, /row\.actor_user_id === auth\.user_id/);
  assert.match(source, /actor_user_id=\?2/);
  assert.match(source, /payload_contains_secret/);
  assert.match(source, /result_contains_secret/);
  assert.doesNotMatch(source, /auth\.space_role === ['"]owner['"] \|\|/);
});
