// SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
// SPDX-License-Identifier: AGPL-3.0-only

// Package zotero-plugin/ into an installable .xpi and generate the matching
// release integrity manifest (updates.json). Single source of truth = the
// plugin's manifest.json (id, version, strict versions).
//
//   node scripts/build-zotero-xpi.mjs [--base <url>]
//
// --base (or env ZOTERO_XPI_BASE) is the public directory where the .xpi will
// be hosted. Releases override it with their immutable tag URL; local builds
// default to the stable latest-release URL used for direct downloads.
//
// Outputs to dist-zotero/:
//   nodus-zotero.xpi   — fixed-name packaged add-on (manifest.json at root)
//   updates.json       — release metadata pointing at the tagged XPI with a
//                        SHA-256 integrity hash. Zotero 9 and 10 require update_url
//                        even when background updates are disabled per add-on.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { buildSync } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = path.join(repoRoot, 'zotero-plugin');
const outDir = path.join(repoRoot, 'dist-zotero');
const workerEntry = path.join(repoRoot, 'scripts', 'zotero-local-embedding-worker.mjs');

function parseBase() {
  const arg = process.argv.find((a) => a.startsWith('--base='));
  if (arg) return arg.slice('--base='.length);
  const i = process.argv.indexOf('--base');
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.ZOTERO_XPI_BASE || 'https://github.com/jorgepb96/nodus/releases/latest/download/';
}

// Files to include: the whole plugin tree, minus junk. manifest.json lands at
// the zip root (required by Zotero) because we add paths relative to pluginDir.
const SKIP = new Set(['.DS_Store', 'Thumbs.db']);
function collectFiles(dir, rel = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const abs = path.join(dir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...collectFiles(abs, relPath));
    else out.push({ abs, relPath });
  }
  return out;
}

export function buildXpi() {
  const manifest = JSON.parse(readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
  const app = manifest.applications?.zotero ?? {};
  const id = app.id;
  const version = manifest.version;
  if (!id || !version) throw new Error('manifest.json missing applications.zotero.id or version');
  if (!/^https:\/\//.test(app.update_url ?? '')) {
    throw new Error('manifest.json missing the HTTPS applications.zotero.update_url required by Zotero 9 and 10');
  }

  const staging = mkdtempSync(path.join(os.tmpdir(), 'nodus-zotero-xpi-'));
  let files;
  const xpiName = 'nodus-zotero.xpi';
  const xpiPath = path.join(outDir, xpiName);
  try {
    cpSync(pluginDir, staging, { recursive: true });
    for (const legalFile of ['LICENSE', 'SOURCE_CODE.md', 'THIRD_PARTY_NOTICES.md']) {
      cpSync(path.join(repoRoot, legalFile), path.join(staging, legalFile));
    }
    const runtimeDir = path.join(staging, 'content', 'runtime');
    mkdirSync(runtimeDir, { recursive: true });
    buildSync({
      entryPoints: [workerEntry],
      outfile: path.join(runtimeDir, 'local-embedding-worker.js'),
      bundle: true,
      minify: true,
      sourcemap: false,
      platform: 'browser',
      format: 'iife',
      target: ['firefox128'],
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'warning',
    });
    for (const name of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.jspi.mjs', 'ort-wasm-simd-threaded.jspi.wasm']) {
      cpSync(path.join(repoRoot, 'node_modules', '@nodus', 'embeddinggemma-transformers', 'node_modules', 'onnxruntime-web', 'dist', name), path.join(runtimeDir, name));
    }

    files = collectFiles(staging);
    if (!files.some((f) => f.relPath === 'manifest.json')) throw new Error('manifest.json not found at plugin root');
    for (const required of [
      'content/evidence-db.sys.mjs',
      'content/local-embeddings.js',
      'content/embedding-models.js',
      'content/models/harrier-270m-q8-wasm.onnx',
      'content/models/NOTICE.md',
      'content/runtime/ort-wasm-simd-threaded.asyncify.mjs',
      'content/runtime/ort-wasm-simd-threaded.asyncify.wasm',
      'content/runtime/ort-wasm-simd-threaded.jspi.mjs',
      'content/runtime/ort-wasm-simd-threaded.jspi.wasm',
      'content/runtime/local-embedding-worker.js',
      'content/runtime/ort-wasm-simd-threaded.jsep.mjs',
      'content/runtime/ort-wasm-simd-threaded.jsep.wasm',
      'icons/nodus.svg',
      'LICENSE',
      'SOURCE_CODE.md',
      'THIRD_PARTY_NOTICES.md',
    ]) {
      if (!files.some((file) => file.relPath === required)) throw new Error(`missing local embedding runtime: ${required}`);
    }

    const zip = new AdmZip();
    const deterministicTime = new Date("1980-01-01T00:00:00.000Z");
    for (const file of files) {
      zip.addFile(file.relPath, readFileSync(file.abs));
      const entry = zip.getEntry(file.relPath);
      if (entry) entry.header.time = deterministicTime;
    }
    mkdirSync(outDir, { recursive: true });
    zip.writeZip(xpiPath);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const buf = readFileSync(xpiPath);
  const sha256 = createHash('sha256').update(buf).digest('hex');

  const base = parseBase().endsWith('/') ? parseBase() : parseBase() + '/';
  const zoteroApp = {};
  if (app.strict_min_version) zoteroApp.strict_min_version = app.strict_min_version;
  if (app.strict_max_version) zoteroApp.strict_max_version = app.strict_max_version;
  const updates = {
    addons: {
      [id]: {
        updates: [
          {
            version,
            update_link: base + xpiName,
            update_hash: `sha256:${sha256}`,
            ...(Object.keys(zoteroApp).length ? { applications: { zotero: zoteroApp } } : {}),
          },
        ],
      },
    },
  };
  const updatesPath = path.join(outDir, 'updates.json');
  writeFileSync(updatesPath, JSON.stringify(updates, null, 2) + '\n');

  return { id, version, xpiName, xpiPath, updatesPath, sha256, base, updateUrl: manifest.applications?.zotero?.update_url, fileCount: files.length };
}

// Run as a script (not when imported by tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = buildXpi();
  console.log(`✔ Built ${r.xpiName} (${r.fileCount} files)`);
  console.log(`  ${r.xpiPath}`);
  console.log(`  sha256: ${r.sha256}`);
  console.log(`✔ Wrote updates.json → ${r.updatesPath}`);
  console.log('');
  console.log('Release integrity metadata:');
  console.log(`  required Zotero feed  : ${r.updateUrl}`);
  console.log('  background updates    : disabled per add-on; installation remains manual');
  console.log(`  published XPI base    : ${r.base}`);
  console.log('Install or update this XPI through Zotero: Tools → Plugins → ⚙ → Install Add-on From File.');
}
