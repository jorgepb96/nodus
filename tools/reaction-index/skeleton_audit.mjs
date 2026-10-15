// Batch audit of recorded reactions with the app's own bond-edit gate (skeletonChange from the
// chemistry-studio plugin), bundled the way the plugin's tests bundle it, so the reaction index and
// a checked route are judged by the same code. No atom map is needed. Reads JSONL
// {id, reactants: [smiles], products: [smiles], rearrangement?: bool, radical?: bool}; appends JSONL
// {id, verdict: clean|excluded|unaudited, flags, reason?} (resumable: ids already written are skipped).
//   node skeleton_audit.mjs in.jsonl out.jsonl <chemistry-studio plugin dir>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';

const plugin = path.resolve(process.argv[4] || process.env.CHEMISTRY_STUDIO || '.');
const require = createRequire(path.join(plugin, 'package.json'));
const { build } = require('esbuild');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'skeleton-audit-'));
fs.mkdirSync(path.join(scratch, 'capabilities/chemistry'), { recursive: true });
const bundle = path.join(scratch, 'capabilities/chemistry/skeleton.cjs');
await build({
  stdin: { contents: `export { skeletonChange } from './src/engine/chemistrySkeleton';`, resolveDir: plugin, loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent',
  external: ['@rdkit/rdkit', 'node-tikzjax'],
  define: { 'import.meta.url': '__nodusModuleUrl', 'globalThis.__CHEMISTRY_INSTRUCTIONS__': '""' },
  banner: { js: 'const __nodusModuleUrl = require("node:url").pathToFileURL(__filename).href;' },
});
fs.mkdirSync(path.join(scratch, 'vendor'), { recursive: true });
fs.symlinkSync(path.resolve(plugin, '../../node_modules'), path.join(scratch, 'vendor/node_modules'), 'dir');
const { skeletonChange } = createRequire(import.meta.url)(bundle);

const carbons = s => (s.replace(/\[[^\]]*\]/g, m => (/^\[(C|c)(?![laudsoren])/.test(m) ? 'C' : '')).match(/C(?![laudsoren])|c(?![laudsoren])/g) || []).length;

async function audit(row) {
  // Coefficient attempts: as written, then whole-side multiples that equalise the carbon count,
  // then a multiple on ONE species.
  //
  // The per-species attempts are what reach a reagent used more than once and listed once — a
  // Grignard double or triple addition, a double reductive amination, a malonate dialkylation.
  // No whole-side multiple expresses those, so the counts never matched and the gate returned
  // `unaudited`: the record was neither admitted nor excluded, just dropped unjudged. Measured on
  // three such records before this, each reported as short by exactly one carbon.
  //
  // The coefficient is DERIVED from the shortfall, not searched for. With species i at k and the
  // rest at 1, that side's carbon becomes total + (k-1)*count[i], so k is fixed by the difference
  // and only an exact integer in 2..4 is tried. That matters because this gate decides what enters
  // the index: a search that kept raising coefficients until a record came back clean would admit
  // the wrong chemistry, which is the opposite of what the audit is for.
  const rc = row.reactants.map(carbons), pc = row.products.map(carbons);
  const R = rc.reduce((a, b) => a + b, 0), P = pc.reduce((a, b) => a + b, 0);
  const flat = (counts, k) => counts.map(() => k);
  const one = (counts, index, k) => counts.map((_, i) => (i === index ? k : 1));
  const attempts = [{ r: flat(rc, 1), p: flat(pc, 1) }];
  for (const k of [2, 3, 4]) {
    if (R * k === P) attempts.push({ r: flat(rc, k), p: flat(pc, 1) });
    if (P * k === R) attempts.push({ r: flat(rc, 1), p: flat(pc, k) });
  }
  // Short side first: the species that must be counted again is on it.
  const perSpecies = (counts, short) => counts.flatMap((count, index) => {
    if (count <= 0 || short <= 0 || short % count !== 0) return [];
    const k = 1 + short / count;
    return k >= 2 && k <= 4 ? [{ index, k }] : [];
  });
  for (const { index, k } of perSpecies(rc, P - R)) attempts.push({ r: one(rc, index, k), p: flat(pc, 1) });
  for (const { index, k } of perSpecies(pc, R - P)) attempts.push({ r: flat(rc, 1), p: one(pc, index, k) });
  let last = null;
  for (const { r, p } of attempts) {
    // A record lists its main product only, so carbon fragments may leave as unlisted by-products.
    const rep = await skeletonChange(row.reactants.map((smiles, i) => ({ smiles, coefficient: r[i] })),
                                     row.products.map((smiles, i) => ({ smiles, coefficient: p[i] })), { omittedByproducts: true });
    last = rep;
    if (rep.change === 'unchecked') continue;
    // Exactly the route audit's rule (chemistryRouteAudit checkSkeleton): a declared rearrangement
    // explains a shift, a reorganisation or an unactivated carbon; a declared radical step explains
    // only an unactivated carbon.
    const flags = [];
    if (rep.migration && !row.rearrangement) flags.push('1,2-shift');
    if (rep.reorganised && !row.rearrangement) flags.push('reorganised skeleton');
    if (!row.rearrangement && !row.radical) {
      if (rep.unactivated) flags.push('unactivated C–C');
      if (rep.unactivatedHetero) flags.push('unactivated C–X');
    }
    return { id: row.id, verdict: flags.length ? 'excluded' : 'clean', flags, ...(rep.departed ? { departed: rep.departed } : {}) };
  }
  return { id: row.id, verdict: 'unaudited', flags: [], reason: last?.reason || 'unchecked' };
}

const [input, output] = process.argv.slice(2, 4);
const done = new Set(fs.existsSync(output) ? fs.readFileSync(output, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id) : []);
// Verdicts are appended synchronously in small batches. An async write stream only reaches disk when
// the event loop gets to its I/O phase, which a loop over lines already in memory never does — the
// results would sit in a buffer, unseen and lost if the process stops.
let pending = [];
const flush = () => { if (pending.length) { fs.appendFileSync(output, pending.join('')); pending = []; } };
let n = 0;
const started = Date.now();
for await (const line of readline.createInterface({ input: fs.createReadStream(input) })) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  if (done.has(row.id)) continue;
  const t0 = Date.now();
  let res;
  try { res = await audit(row); } catch (e) { res = { id: row.id, verdict: 'unaudited', flags: [], reason: `error: ${e.message}`.slice(0, 120) }; }
  const ms = Date.now() - t0;
  if (ms > 5000) console.error(`slow ${row.id} ${ms}ms ${res.verdict}`);
  pending.push(JSON.stringify(res) + '\n');
  if (++n % 100 === 0) flush();
  if (n % 2000 === 0) console.error(`${new Date().toISOString()} ${n} audited (${Math.round(n / ((Date.now() - started) / 1000))}/s)`);
}
flush();
console.log(`audited ${n}`);
