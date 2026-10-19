import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { decodeVectorSet } from './core/vectors.mjs';
import { createEmbeddingContract, fingerprintEmbeddingContract } from './core/embeddingContract.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const kinds = new Set(['ideas', 'documents', 'passages']);
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };

/** Immutable staged files + one state.json head. A crash before save leaves the previous
 * publication intact; a crash after save sees every file of the new publication. */
export class EmbeddingPublications {
  constructor(store) { this.store = store; }
  directory(spaceId, id) {
    if (!/^[a-f0-9]{64}$/.test(id)) fail('invalid_publication_id', 400);
    return path.join(this.store.spaceDir(spaceId), 'embedding-publications', id);
  }
  manifest(space, id, owner) {
    const file = path.join(this.directory(space.id, id), 'manifest.json');
    if (!fs.existsSync(file)) fail('publication_not_found', 404);
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest.owner !== owner) fail('publication_owner_mismatch', 403);
    return manifest;
  }
  begin(space, input, owner) {
    if (!input || typeof input.revision !== 'string' || !input.revision.length || input.revision.length > 256
      || !/^[a-f0-9]{64}$/.test(input.snapshotHash) || !Array.isArray(input.vectors) || input.vectors.length > 3) fail('invalid_publication_manifest', 400);
    if (input.index !== null && (!input.index || typeof input.index.id !== 'string' || input.index.id.length > 128
      || !Number.isSafeInteger(input.index.generation) || input.index.generation < 1)) fail('invalid_embedding_index', 400);
    const seen = new Set();
    for (const vector of input.vectors) {
      if (!kinds.has(vector.kind) || seen.has(vector.kind) || !/^[a-f0-9]{64}$/.test(vector.hash)) fail('invalid_publication_vectors', 400);
      seen.add(vector.kind);
    }
    if (!input.index && input.vectors.length) fail('vectors_require_active_index', 400);
    const value = { revision: input.revision, snapshotHash: input.snapshotHash, index: input.index,
      vectors: input.vectors.map(vector => ({ kind: vector.kind, hash: vector.hash })), owner };
    const id = hash(JSON.stringify(value));
    const directory = this.directory(space.id, id);
    fs.mkdirSync(directory, { recursive: true });
    const manifestFile = path.join(directory, 'manifest.json');
    if (!fs.existsSync(manifestFile)) fs.writeFileSync(manifestFile, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    const committed = space.embeddingPublication === id;
    return { id, committed, missingSnapshot: !fs.existsSync(path.join(directory, 'snapshot.json.gz')),
      missingKinds: value.vectors.filter(vector => !fs.existsSync(path.join(directory, `vectors-${vector.kind}.bin`))).map(vector => vector.kind) };
  }
  stageSnapshot(space, id, owner, bytes) {
    const manifest = this.manifest(space, id, owner);
    this.assertMutable(space, id);
    if (hash(bytes) !== manifest.snapshotHash) fail('snapshot_hash_mismatch', 400);
    this.writeFile(path.join(this.directory(space.id, id), 'snapshot.json.gz'), bytes);
  }
  stageVectors(space, id, owner, kind, compressed, gunzip) {
    const manifest = this.manifest(space, id, owner);
    this.assertMutable(space, id);
    const expected = manifest.vectors.find(vector => vector.kind === kind);
    if (!expected || hash(compressed) !== expected.hash) fail('vector_hash_mismatch', 400);
    const bytes = gunzip(compressed);
    const set = decodeVectorSet(bytes);
    if (set.header.kind !== kind || set.header.indexId !== manifest.index.id || set.header.generation !== manifest.index.generation) fail('embedding_publication_mismatch', 400);
    const contract = createEmbeddingContract(set.header.embeddingContract);
    if (contract.provider !== set.header.provider || contract.model !== set.header.model || contract.dim !== set.dim) fail('embedding_contract_mismatch', 400);
    this.writeFile(path.join(this.directory(space.id, id), `vectors-${kind}.bin`), bytes);
  }
  writeFile(target, bytes) {
    const temporary = `${target}.tmp-${process.pid}`;
    try { fs.writeFileSync(temporary, bytes, { mode: 0o600 }); fs.renameSync(temporary, target); }
    finally { fs.rmSync(temporary, { force: true }); }
  }
  assertMutable(space, id) {
    if (space.embeddingPublication === id || fs.existsSync(path.join(this.directory(space.id, id), 'sealed'))) fail('publication_already_sealed');
  }
  commit(space, id, owner, validateSnapshot, gzip) {
    const manifest = this.manifest(space, id, owner);
    if (space.embeddingPublication === id) return { ok: true, unchanged: true, updatedAt: space.updatedAt, bytes: space.bytes };
    const directory = this.directory(space.id, id);
    const snapshotFile = path.join(directory, 'snapshot.json.gz');
    if (!fs.existsSync(snapshotFile)) fail('publication_incomplete');
    const snapshot = validateSnapshot(fs.readFileSync(snapshotFile));
    if ((snapshot.embeddingIndex?.id ?? null) !== (manifest.index?.id ?? null)
      || (snapshot.embeddingIndex?.generation ?? null) !== (manifest.index?.generation ?? null)) fail('snapshot_embedding_index_mismatch', 400);
    const contracts = {};
    let commonContract = null;
    for (const vector of manifest.vectors) {
      const file = path.join(directory, `vectors-${vector.kind}.bin`);
      if (!fs.existsSync(file)) fail('publication_incomplete');
      const set = decodeVectorSet(fs.readFileSync(file));
      const contract = createEmbeddingContract(set.header.embeddingContract);
      const fingerprint = fingerprintEmbeddingContract(contract);
      if (commonContract && commonContract !== fingerprint) fail('embedding_contract_mismatch', 400);
      commonContract = fingerprint;
      contracts[vector.kind] = { contract, fingerprint, lockedAt: new Date().toISOString() };
    }
    const publicationBytes = gzip(Buffer.from(JSON.stringify(snapshot)));
    this.writeFile(snapshotFile, publicationBytes);
    // A committed (or previously committed) bundle is immutable, even after another
    // publication replaces it. Failed head updates can retry commit without uploads.
    this.writeFile(path.join(directory, 'sealed'), Buffer.from('1'));
    const before = { ...space };
    Object.assign(space, { embeddingPublication: id, embeddingContracts: contracts,
      revision: manifest.revision, updatedAt: snapshot.provenance.publishedAt, vault: snapshot.vault,
      vaultType: snapshot.vault?.type, bytes: publicationBytes.length, schemaVersion: Number(snapshot.schemaVersion) || 0,
      snapshotFormatVersion: Number(snapshot.formatVersion), currentPublication: { ...snapshot.provenance } });
    try { this.store.save(); }
    catch (error) { for (const key of Object.keys(space)) delete space[key]; Object.assign(space, before); throw error; }
    // Retain the immediately previous committed publication for recovery; abandonments have
    // a full day to resume before collection. Never collect an active or just-replaced head.
    const root = path.dirname(directory);
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === id || entry.name === before.embeddingPublication || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
        const file = path.join(root, entry.name);
        if (Date.now() - fs.statSync(file).mtimeMs > 86_400_000) fs.rmSync(file, { recursive: true, force: true });
      }
    } catch { /* Collection must not turn a successful atomic publication into an error. */ }
    return { ok: true, unchanged: false, updatedAt: space.updatedAt, bytes: space.bytes };
  }
}
