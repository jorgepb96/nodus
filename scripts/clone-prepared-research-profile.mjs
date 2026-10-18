import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ISOLATION_FORMAT = 'nodus.isolated-research-profile/1';
const RECEIPT_FORMAT = 'nodus.prepared-research-clone/1';
const MODEL = 'embeddinggemma-2-text-q8-v1';

// Deliberately excludes profile settings, provider credentials, subscription
// state, logs, browser sessions, temporary files, and all unreviewed artifacts.
const COPY_PATHS = [
  'profile/nodus.sqlite',
  'profile/documentary/store.sqlite',
  'profile/library/catalog.sqlite',
  'profile/library/device.json',
  'profile/profile-migrations/library-origin.json',
  `profile/local-ai/models/${MODEL}`,
  'library/nodus-library',
  'fixtures/corpus',
];
const DATABASE_PATHS = new Set(['profile/nodus.sqlite', 'profile/documentary/store.sqlite', 'profile/library/catalog.sqlite']);
const TEXT_EXTENSIONS = new Set(['.json', '.jsonl', '.md', '.txt', '.yaml', '.yml', '.toml', '.xml']);

function fail(message) { throw new Error(message); }
function sha256(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function within(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
function canonicalMarkedRoot(value, label) {
  const supplied = path.resolve(value);
  const suppliedStat = fs.lstatSync(supplied);
  if (suppliedStat.isSymbolicLink()) fail(`${label} root must not be a symlink`);
  const resolved = fs.realpathSync(supplied);
  if (resolved === path.parse(resolved).root) fail(`${label} cannot be a filesystem root`);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real directory`);
  const markerPath = path.join(resolved, 'isolation.json');
  const markerStat = fs.lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) fail(`${label} isolation marker must be a regular file`);
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  if (marker.format !== ISOLATION_FORMAT || marker.root !== resolved) fail(`${label} is not its canonical marked QA root`);
  return resolved;
}
function rejectLinksAndOpenDatabases(root, relative) {
  const absolute = path.join(root, relative);
  if (!within(root, absolute)) fail(`Path escapes marked QA root: ${relative}`);
  if (/\.sqlite$/i.test(absolute)) {
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = `${absolute}${suffix}`;
      if (fs.existsSync(sidecar)) fail(`SQLite sidecar means source is not closed: ${path.relative(root, sidecar)}`);
    }
  }
  const walk = (file) => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) fail(`Refusing symlink in prepared data: ${path.relative(root, file)}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file)) walk(path.join(file, name));
      return;
    }
    if (!stat.isFile()) fail(`Refusing non-regular prepared data: ${path.relative(root, file)}`);
    if (/(?:-wal|-shm|-journal)$/i.test(file)) fail(`SQLite sidecar means source is not closed: ${path.relative(root, file)}`);
  };
  walk(absolute);
  return absolute;
}
function copyTree(source, destination, receipt, sourceRoot) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) fail(`Refusing symlink in prepared data: ${path.relative(sourceRoot, source)}`);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    for (const name of fs.readdirSync(source).sort()) copyTree(path.join(source, name), path.join(destination, name), receipt, sourceRoot);
    return;
  }
  if (!stat.isFile()) fail(`Refusing non-regular prepared data: ${path.relative(sourceRoot, source)}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, stat.mode & 0o777);
  receipt.push({ path: path.relative(sourceRoot, source), bytes: stat.size, sha256: sha256(destination) });
}
function rebaseTextFiles(root, from, to) {
  const changed = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) fail(`Symlink appeared in clone: ${path.relative(root, file)}`);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile() && TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) {
        const before = fs.readFileSync(file, 'utf8');
        // Rewrite only paths rooted at the marked source, including the exact
        // root value. Similar-looking sibling paths are left untouched.
        const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const after = before.replace(new RegExp(`${escaped}(?=$|[/\\\\"'\\s,}\\]])`, 'g'), to);
        if (after !== before) { fs.writeFileSync(file, after); changed.push(path.relative(root, file)); }
      }
    }
  };
  walk(root);
  return changed;
}
function rebaseDatabase(db, from, to, allowedColumns = null) {
  const script = String.raw`
import json, re, sqlite3, sys
db, source, target = sys.argv[1:4]
allowed = json.loads(sys.argv[4]) if len(sys.argv) > 4 else None
con = sqlite3.connect('file:' + db + '?mode=rw', uri=True)
con.execute('PRAGMA journal_mode=DELETE')
pattern = re.compile(re.escape(source) + r'(?=$|/|["\\\s,}\\]])')
changed = 0
try:
  con.execute('BEGIN IMMEDIATE')
  tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
  for table in tables:
    qtable = '"' + table.replace('"', '""') + '"'
    info = con.execute('PRAGMA table_info(' + qtable + ')').fetchall()
    cols = [(r[1], r[2].upper()) for r in info if 'TEXT' in r[2].upper() and (allowed is None or table in allowed and r[1] in allowed[table])]
    primary = [r[1] for r in sorted(info, key=lambda item: item[5]) if r[5]]
    keycols = primary or ['rowid']
    qkeys = [k if k == 'rowid' else '"' + k.replace('"', '""') + '"' for k in keycols]
    for col, _ in cols:
      qcol = '"' + col.replace('"', '""') + '"'
      rows = con.execute('SELECT ' + ', '.join(qkeys) + ', ' + qcol + ' FROM ' + qtable + ' WHERE ' + qcol + ' IS NOT NULL').fetchall()
      updates = []
      for row in rows:
        keys, value = row[:-1], row[-1]
        if isinstance(value, str) and pattern.search(value):
          updates.append((pattern.sub(lambda _: target, value), *keys))
      if updates:
        where = ' AND '.join(key + '=?' for key in qkeys)
        con.executemany('UPDATE ' + qtable + ' SET ' + qcol + '=? WHERE ' + where, updates)
        changed += len(updates)
  # Preserve the selected local embedding model but remove inherited service
  # endpoints and any token/key-shaped provider settings from the clone only.
  if allowed is None and 'settings' in tables:
    row = con.execute("SELECT value FROM settings WHERE key='app'").fetchone()
    if row and isinstance(row[0], str):
      try:
        settings = json.loads(row[0])
      except Exception:
        settings = {}
      def scrub(value):
        if isinstance(value, dict):
          clean = {}
          for key, child in value.items():
            lower = key.lower()
            if lower in {'customprovider','localproviders','providerfreetier','nodusserverurl','mcptoken','copilottoken','zoteroplugintoken','browserconnectortoken','apikeys'} or re.search(r'(api.?key|secret|password|credential|token|proxy|endpoint|base.?url)$', lower):
              continue
            clean[key] = scrub(child)
          return clean
        if isinstance(value, list): return [scrub(child) for child in value]
        return value
      con.execute("UPDATE settings SET value=? WHERE key='app'", (json.dumps(scrub(settings), ensure_ascii=False, separators=(',', ':')),))
  con.commit()
  print(changed)
except Exception:
  con.rollback()
  raise
finally:
  con.close()
`;
  const result = spawnSync('python3', ['-c', script, db, from, to, JSON.stringify(allowedColumns)], { encoding: 'utf8' });
  if (result.status !== 0) fail(`Could not safely rebase cloned SQLite text paths: ${result.stderr || result.error || result.status}`);
  return Number(result.stdout.trim()) || 0;
}

function auditDocumentaryRebase(sourceDb, cloneDb, sourceRoot, cloneRoot) {
  const script = String.raw`
import hashlib, json, re, sqlite3, sys
source_root, clone_root = sys.argv[3:]
pattern = re.compile(re.escape(source_root) + r'(?=$|/|["\\\s,}\\]])')
allowed = {'documentary_requests': {'configuration_json'}, 'documentary_campaigns': {'configuration_json'}}
def normalize(value):
  return {'blob': value.hex()} if isinstance(value, bytes) else value
def database(db, expected=False):
  con = sqlite3.connect('file:' + db + '?mode=ro&immutable=1', uri=True)
  try:
    names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    schemas = list(con.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"))
    table_rows = {}
    changes = []
    for table in sorted(names):
      qtable = '"' + table.replace('"','""') + '"'
      info = con.execute('PRAGMA table_info(' + qtable + ')').fetchall()
      cols = [r[1] for r in info]
      if not cols: continue
      try: rows = con.execute('SELECT rowid,* FROM ' + qtable + ' ORDER BY rowid').fetchall()
      except sqlite3.Error: rows = [(i,*row) for i,row in enumerate(con.execute('SELECT * FROM ' + qtable).fetchall())]
      transformed = []
      for row in rows:
        rowid, *values = row
        new = list(values)
        for col in allowed.get(table, set()):
          if col in cols:
            idx = cols.index(col)
            value = values[idx]
            if isinstance(value,str) and pattern.search(value):
              updated = pattern.sub(lambda _: clone_root, value)
              new[idx] = updated
              if expected and updated != value:
                key_cols = [r[1] for r in sorted(info,key=lambda x:x[5]) if r[5]]
                key = {key_col: values[cols.index(key_col)] for key_col in key_cols} if key_cols else {'rowid':rowid}
                changes.append({'table':table,'column':col,'rowKey':key,'oldValue':value,'newValue':updated,'oldValueSha256':hashlib.sha256(value.encode()).hexdigest(),'newValueSha256':hashlib.sha256(updated.encode()).hexdigest()})
        transformed.append([normalize(v) for v in new])
      table_rows[table] = transformed
    return schemas, table_rows, changes, con
  finally: con.close()
source, clone = sys.argv[1:3]
schemas_a, rows_a, changes, _ = database(source, True); schemas_b, rows_b, _, _ = database(clone)
schema_hash = lambda value: hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
row_hash = lambda value: hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
# expected source rows with only the explicitly allowed filesystem paths rebased
expected = json.loads(json.dumps(rows_a))
for table, colset in allowed.items():
  if table not in expected: continue
  con = sqlite3.connect('file:' + source + '?mode=ro&immutable=1',uri=True)
  info = con.execute('PRAGMA table_info("'+table+'")').fetchall(); cols = [r[1] for r in info]
  q='"'+table+'"'
  try: order = con.execute('SELECT rowid,* FROM '+q+' ORDER BY rowid').fetchall()
  except sqlite3.Error:
    pk=[r[1] for r in sorted(info,key=lambda x:x[5]) if r[5]]
    ordering=','.join('"'+x.replace('"','""')+'"' for x in pk)
    order = [(i,*row) for i,row in enumerate(con.execute('SELECT * FROM '+q+(' ORDER BY '+ordering if ordering else '')).fetchall())]
  con.close()
  # row ordinal lines up with the canonical rowid order above
  for i,row in enumerate(order):
    vals=list(row[1:])
    for col in colset:
      if col not in cols: continue
      j=cols.index(col); val=vals[j]
      if isinstance(val,str): vals[j]=pattern.sub(lambda _:clone_root,val)
    expected[table][i]=[normalize(v) for v in vals]
same = schemas_a == schemas_b and expected == rows_b
revisions = rows_b.get('documentary_revisions',[])
identities = {}
if 'documentary_revisions' in rows_b:
  con=sqlite3.connect('file:'+clone+'?mode=ro&immutable=1',uri=True)
  for index_key,document_id,identity_json,lexical_ready,embedding_ready,created_at in con.execute('SELECT index_key,document_id,identity_json,lexical_ready,embedding_ready,created_at FROM documentary_revisions ORDER BY index_key'):
    identities.setdefault(document_id,[]).append([index_key,identity_json,lexical_ready,embedding_ready,created_at])
  con.close()
identity_proof=[{'documentId':doc,'revisionCount':len(items),'sha256':row_hash(items)} for doc,items in sorted(identities.items())]
vectors=[]
if 'documentary_passages' in rows_b:
  con=sqlite3.connect('file:'+clone+'?mode=ro&immutable=1',uri=True)
  for id,index_key,document_id,ordinal,vector_json,vector in con.execute('SELECT id,index_key,document_id,ordinal,vector_json,vector FROM documentary_passages WHERE vector_json IS NOT NULL OR vector IS NOT NULL ORDER BY id'):
    value={'vectorJson':vector_json,'vectorBlob':{'blob':vector.hex()} if isinstance(vector,bytes) else None}
    vectors.append({'id':id,'indexKey':index_key,'documentId':document_id,'ordinal':ordinal,'sha256':row_hash(value)})
  con.close()
rev_digest=row_hash(revisions); vector_digest=row_hash(vectors)
print(json.dumps({'format':'nodus.prepared-index-path-rebase/1','sourceDbPath':source,'cloneDbPath':clone,
 'sourceDbSha256':hashlib.sha256(open(source,'rb').read()).hexdigest(),'cloneDbSha256':hashlib.sha256(open(clone,'rb').read()).hexdigest(),
 'allowedColumnChanges':changes,'changedCellCount':len(changes),'tablesEqualExceptAllowedColumns':same,'schemaSha256':schema_hash(schemas_a),'sourceSchemaSha256':schema_hash(schemas_b),
 'documentIdentities':identity_proof,'documentCount':len(identity_proof),'revisionCount':len(revisions),'revisionContractSha256':rev_digest,
 'vectorPayloads':vectors,'vectorCount':len(vectors),'vectorPayloadsSha256':vector_digest,
 'sameRevisionContract':same,'sameVectorPayloads':same,'rebaseVerified':same and (len(changes)==42 or not identities)}))
`;
  const result = spawnSync('python3', ['-c', script, sourceDb, cloneDb, sourceRoot, cloneRoot], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) fail(`Could not verify preserved document/revision/vector data: ${result.stderr || result.error || result.status}`);
  const proof = JSON.parse(result.stdout);
  if (!proof.tablesEqualExceptAllowedColumns || !proof.sameRevisionContract || !proof.sameVectorPayloads || !proof.rebaseVerified) fail('Cloned prepared index changed document revisions, vectors, or non-path data');
  if (proof.vectorCount && proof.vectorCount !== 787) fail(`Expected 787 precomputed vectors, found ${proof.vectorCount}`);
  if (proof.documentCount && proof.documentCount !== 40) fail(`Expected 40 prepared identities, found ${proof.documentCount}`);
  if (proof.documentCount && proof.changedCellCount !== 42) fail(`Expected exactly 42 runtime scope path changes, found ${proof.changedCellCount}`);
  return proof;
}
function readEmbeddingSelection(db) {
  const script = "import json,sqlite3,sys; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro&immutable=1',uri=True); r=c.execute(\"SELECT value FROM settings WHERE key='app'\").fetchone(); d=json.loads(r[0]) if r else {}; print(json.dumps({'embeddingProvider':d.get('embeddingProvider'),'embeddingModel':d.get('embeddingModel')})); c.close()";
  const result = spawnSync('python3', ['-c', script, db], { encoding: 'utf8' });
  if (result.status !== 0) fail(`Could not verify clone embedding selection: ${result.stderr || result.error || result.status}`);
  const selection = JSON.parse(result.stdout);
  if (selection.embeddingProvider !== 'nodus' || selection.embeddingModel !== 'embeddinggemma-2-text-q8-512-v1') fail(`Clone does not preserve the prepared Nodus EmbeddingGemma profile selection: ${JSON.stringify(selection)}`);
  return selection;
}

/**
 * Copy the corpus, independently prepared documentary vectors, library catalog,
 * and local embedding model from a closed marked QA root. `sourceClosed` is an
 * explicit caller attestation; WAL/SHM/journal sidecars are independently
 * rejected. Provider settings and all subscription/profile state are omitted.
 */
export function clonePreparedResearchProfile({ sourceRoot, targetParent = '/private/tmp', name = 'shard', sourceClosed = false,
  expectedDocumentCount = 40, expectedVectorCount = 787 }) {
  if (sourceClosed !== true) fail('Refusing clone without explicit sourceClosed: true attestation');
  const source = canonicalMarkedRoot(sourceRoot, 'Source');
  const parent = fs.realpathSync(targetParent);
  if (!fs.statSync(parent).isDirectory()) fail('Target parent must be a real directory');
  if (within(source, parent)) fail('Target parent cannot be inside the marked source root');
  const safeName = String(name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'shard';
  const target = fs.realpathSync(fs.mkdtempSync(path.join(parent, `nodus-research-${safeName}-`)));
  if (within(source, target) || within(target, source)) { fs.rmSync(target, { recursive: true, force: true }); fail('Source root and target root must be independent'); }
  const receiptFiles = [];
  const present = [];
  try {
    for (const relative of COPY_PATHS) {
      const sourcePath = path.join(source, relative);
      if (!fs.existsSync(sourcePath)) fail(`Required prepared QA input is missing: ${relative}`);
      rejectLinksAndOpenDatabases(source, relative);
      present.push(relative);
    }
    for (const relative of present) copyTree(path.join(source, relative), path.join(target, relative), receiptFiles, source);
    fs.mkdirSync(path.join(target, 'profile', 'cache'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(target, 'profile', 'config'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(target, 'tmp'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(target, 'artifacts'), { recursive: true, mode: 0o700 });
    const rebasedFiles = rebaseTextFiles(target, source, target);
    const rebasedDatabaseCells = [];
    for (const relative of DATABASE_PATHS) {
      const allowed = relative === 'profile/documentary/store.sqlite'
        ? { documentary_requests: ['configuration_json'], documentary_campaigns: ['configuration_json'] }
        : null;
      rebasedDatabaseCells.push({ path: relative, cells: rebaseDatabase(path.join(target, relative), source, target, allowed) });
    }
    const documentaryTransferProof = auditDocumentaryRebase(
      path.join(source, 'profile/documentary/store.sqlite'), path.join(target, 'profile/documentary/store.sqlite'), source, target);
    const embeddingSelection = readEmbeddingSelection(path.join(target, 'profile/nodus.sqlite'));
    if (expectedDocumentCount !== null && documentaryTransferProof.documentCount !== expectedDocumentCount) fail(`Expected ${expectedDocumentCount} prepared identities, found ${documentaryTransferProof.documentCount}`);
    if (expectedVectorCount !== null && documentaryTransferProof.vectorCount !== expectedVectorCount) fail(`Expected ${expectedVectorCount} prepared vectors, found ${documentaryTransferProof.vectorCount}`);
    const at = new Date().toISOString();
    fs.writeFileSync(path.join(target, 'isolation.json'), JSON.stringify({ format: ISOLATION_FORMAT, root: target, clonedFrom: source, createdAt: at }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    // Deliberately fresh profile data: no provider endpoints, tokens, keys,
    // vault registry paths, user settings, or session state are inherited.
    fs.writeFileSync(path.join(target, 'profile', 'app-prefs.json'), JSON.stringify({
      libraryGlobalEnabled: false,
      libraryScope: 'vault',
      autoBackupFolder: path.join(target, 'library'),
      localProviders: {},
      customProvider: null,
      providerFreeTier: {},
      researchWebSearch: 'off',
    }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(path.join(target, 'profile', 'vaults.json'), JSON.stringify({
      formatVersion: 1,
      activeVaultId: 'default',
      vaults: [{ id: 'default', name: 'Principal', path: path.join(target, 'profile', 'nodus.sqlite'),
        createdAt: at, lastOpenedAt: at, legacy: true, type: 'academic', origin: 'local' }],
    }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    const freshProfileFiles = ['profile/app-prefs.json', 'profile/vaults.json'].map((relative) => ({
      path: relative, bytes: fs.statSync(path.join(target, relative)).size, sha256: sha256(path.join(target, relative)),
    }));
    const hashes = receiptFiles.map((item) => ({ ...item, sha256: sha256(path.join(target, item.path)) }));
    const rebaseReceiptPath = path.join(target, 'artifacts', 'clone-rebase-receipt.json');
    fs.writeFileSync(rebaseReceiptPath, JSON.stringify({ ...documentaryTransferProof, format: 'nodus.prepared-index-path-rebase/1' }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    const receipt = {
      format: RECEIPT_FORMAT,
      sourceRoot: source,
      root: target,
      createdAt: at,
      sourceClosedAttested: true,
      sourceFilesUnchangedByDesign: true,
      copiedFiles: hashes,
      freshProfileFiles,
      rebasedTextFiles: rebasedFiles,
      rebasedDatabaseCells,
      documentaryTransferProofPath: rebaseReceiptPath,
      documentaryTransferProofSha256: sha256(rebaseReceiptPath),
      embeddingSelection,
      omitted: ['inherited profile settings', 'all provider credentials and endpoints', 'subscription state', 'logs and browser sessions', 'unreviewed artifacts'],
      cloneSafety: { noSymlinks: true, noSQLiteSidecars: true, independentSQLiteFiles: true, sourceFilesReadOnly: true },
    };
    fs.writeFileSync(path.join(target, 'artifacts', 'clone-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    return receipt;
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

function cli() {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i++) {
    const [key, ...value] = process.argv[i].split('=');
    if (key.startsWith('--')) args.set(key.slice(2), value.join('=') || process.argv[++i]);
  }
  if (!args.get('source')) fail('Usage: node scripts/clone-prepared-research-profile.mjs --source=/marked/qa/root --name=shard-a --source-closed');
  const receipt = clonePreparedResearchProfile({
    sourceRoot: args.get('source'),
    targetParent: args.get('target-parent') || '/private/tmp',
    name: args.get('name') || 'shard',
    sourceClosed: args.has('source-closed'),
  });
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
