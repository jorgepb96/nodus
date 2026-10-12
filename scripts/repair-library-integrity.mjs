#!/usr/bin/env node
// Repairs the data-level damage the library audit (scripts/audit-graph-integrity.mjs +
// scripts/audit-library-checks.mjs) finds, for every class whose writer has since been
// fixed (see scripts/test-library-integrity-fixes.mjs). Everything here is local SQL
// or a deterministic recomputation; nothing calls a model.
//
//   self-loop edges           delete them; ideas they alone kept active go dormant
//                             (the exact dormancy predicate purgeDeepData uses)
//   edge owner ≠ trace        a 'deep' edge with no owner gets the one work where both
//                             endpoints occur, else becomes a derived ('reprocess') edge;
//                             an owned 'reprocess'/'bridge' edge whose endpoints occur in
//                             its owner is restored to 'deep', else loses the owner
//   duplicate active ideas    merge each group into its oldest id: occurrences, evidence,
//                             theme links, edges, gaps, external refs, Documentary Index
//                             links and research links move over, then the duplicate goes
//                             dormant (its id stays valid, pruneDormantIdeas removes it)
//   NUL bytes                 U+0000 → space in passages.text and evidence.quote (offsets
//                             unchanged; passages_fts follows through its update trigger)
//   inverted section pages    a section that ran into the next attachment ends on the
//                             last page of its own source (work_text_sources.page_count)
//   support → wrong passage   re-pick the passage exactly as the fixed passageForQuote does
//   index checkpoints         drop checkpoints of failed/cancelled jobs a later job
//                             completed, and of any completed job
//   deep-scan checkpoints     drop leftovers of works that are done and not queued
//
// Not repairable here (needs a model, reported only): a deep analysis older than its
// text needs a rescan in the app.
//
// Idempotent: every repair acts only on rows that still violate its invariant, so a
// second run is a no-op. Safe by default:
//   node scripts/repair-library-integrity.mjs                 # dry run: what would change
//   node scripts/repair-library-integrity.mjs --clone-test    # repair a snapshot copy, audit it
//   node scripts/repair-library-integrity.mjs --apply         # repair the vault (Nodus closed)
//   ... --db <path> | --user-data <dir>                       # pick the vault
//   ... --allow-running                                       # --apply even with Nodus open
//
// --apply refuses while Nodus is running: the app's own writers (a scan's purge, the
// Documentary Index queue) would race these repairs. It first writes a snapshot backup
// next to the vault (<vault>.before-library-repair-<time>); everything is then one
// transaction per vault, so a failure changes nothing.
//
// Exit code: 0 nothing left to repair, 1 repairable rows remain (dry run) or the
// post-repair audit still finds errors, 2 no vault found / refused.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WRONG_SUPPORT_PREDICATE, registerAuditFunctions } from './audit-library-checks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARK = '--electron-repair-library-integrity';
if (!process.argv.includes(MARK)) {
  const result = spawnSync(
    path.join(repoRoot, 'node_modules/.bin/electron'),
    [path.join(repoRoot, 'scripts/repair-library-integrity.mjs'), MARK, ...process.argv.slice(2)],
    { cwd: repoRoot, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' }
  );
  process.exit(result.status ?? 1);
}

const { default: Database } = await import('better-sqlite3');
const args = process.argv.slice(2).filter((a) => a !== MARK);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const apply = args.includes('--apply');
const cloneTest = args.includes('--clone-test');

function defaultUserDataDir() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Nodus');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Nodus');
  return path.join(home, '.config', 'Nodus');
}

function discoverVaults() {
  const explicitDb = flag('--db');
  if (explicitDb) return [{ name: path.basename(explicitDb), path: path.resolve(explicitDb) }];
  const userData = flag('--user-data') || defaultUserDataDir();
  const registryPath = path.join(userData, 'vaults.json');
  if (fs.existsSync(registryPath)) {
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (Array.isArray(registry.vaults) && registry.vaults.length > 0) return registry.vaults.map((v) => ({ name: v.name, path: v.path }));
  }
  const fallback = path.join(userData, 'nodus.sqlite');
  return fs.existsSync(fallback) ? [{ name: 'My vault', path: fallback }] : [];
}

function nodusRunning() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return false;
  const probe = spawnSync('pgrep', ['-f', 'Nodus.app/Contents/MacOS/Nodus|/nodus/release/.*/nodus'], { encoding: 'utf8' });
  return probe.status === 0 && probe.stdout.trim().length > 0;
}

// ── passageForQuote, ported from electron/ai/documentProfile.ts (keep in sync) ──────

function collapsedLiteralText(value) {
  let text = '';
  let inWhitespace = false;
  for (const character of value) {
    if (/\s/u.test(character)) {
      if (!inWhitespace) { text += ' '; inWhitespace = true; }
      continue;
    }
    text += character.normalize('NFKC').toLocaleLowerCase();
    inWhitespace = false;
  }
  return text;
}

function passageForQuote(quote, location, all) {
  const sameSource = location.sourceRef ? all.filter((row) => row.source_ref === location.sourceRef) : [];
  const rows = sameSource.length ? sameSource : all.filter((row) => row.source_ref == null || !location.sourceRef);
  const startsBefore = (row) => location.pageNumber == null || row.page_number == null || row.page_number <= location.pageNumber;
  const distance = (row) => (location.pageNumber == null || row.page_number == null ? 0 : location.pageNumber - row.page_number);
  const nearest = (list) => list.reduce((best, row) => (best == null || distance(row) < distance(best) ? row : best), null);
  const collapsedQuote = collapsedLiteralText(quote).trim();
  const haystacks = rows.map((row) => collapsedLiteralText(row.text));
  for (const length of [60, 40, 24]) {
    const needle = collapsedQuote.slice(0, length).trim();
    // A quote shorter than the floor (a running head: "Index I:15") is matched whole.
    if (needle.length < Math.min(12, collapsedQuote.length)) break;
    const containing = rows.filter((_, index) => haystacks[index].includes(needle));
    const chosen = nearest(containing.filter(startsBefore)) ?? nearest(containing);
    if (chosen) return chosen.passage_id;
  }
  const terms = quote.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 4).slice(0, 8);
  if (!terms.length) return null;
  let best = null;
  for (const row of rows.filter(startsBefore)) {
    const haystack = row.text.toLocaleLowerCase();
    const score = terms.filter((term) => haystack.includes(term)).length / terms.length;
    const rowDistance = distance(row);
    if (!best || score > best.score || (score === best.score && rowDistance < best.distance)) best = { id: row.passage_id, score, distance: rowDistance };
  }
  return best && best.score >= 0.45 ? best.id : null;
}

// ── Repairs ──────────────────────────────────────────────────────────────────

const SYMMETRIC = new Set(['contradicts', 'shares_method', 'measures_same', 'variant_of']);
const now = () => new Date().toISOString();

// The dormancy predicate of purgeDeepData (electron/db/ideasRepo.ts), verbatim.
function sweepUnheldIdeas(db) {
  return db.prepare(
    `UPDATE ideas SET orphaned_at = ?
      WHERE orphaned_at IS NULL
        AND global_id NOT IN (SELECT DISTINCT global_id FROM idea_occurrences)
        AND global_id NOT IN (
          SELECT json_extract(source_json, '$.ref') FROM notes
           WHERE json_extract(source_json, '$.note') = 'manual-idea'
        )
        AND global_id NOT IN (SELECT from_id FROM edges)
        AND global_id NOT IN (SELECT to_id FROM edges)`
  ).run(now()).changes;
}

const OWNER_TRACE_MISMATCH = `SELECT e.id, e.from_id, e.to_id, e.source_work, et.method FROM edges e
  JOIN edge_traces et ON et.edge_id = e.id
  WHERE (et.method = 'deep' AND e.source_work IS NULL)
     OR (et.method IN ('bridge','reprocess') AND e.source_work IS NOT NULL)`;

const WRONG_SUPPORT = `SELECT u.support_id, u.nodus_id, u.quote, u.source_ref, u.page_start_number, u.passage_id
  FROM document_profile_support u
  JOIN document_profile_state s ON s.current_version_id = u.version_id
  JOIN passages p ON p.passage_id = u.passage_id
  WHERE ${WRONG_SUPPORT_PREDICATE}`;

const REPAIRS = [
  {
    label: 'self-loop edges',
    count: (db) => db.prepare('SELECT COUNT(*) n FROM edges WHERE from_id = to_id').get().n,
    apply(db) {
      db.prepare('DELETE FROM edge_traces WHERE edge_id IN (SELECT id FROM edges WHERE from_id = to_id)').run();
      const removed = db.prepare('DELETE FROM edges WHERE from_id = to_id').run().changes;
      const dormant = sweepUnheldIdeas(db);
      return `${removed} deleted, ${dormant} idea(s) now dormant`;
    },
  },
  {
    label: 'edge owner ≠ trace method',
    count: (db) => db.prepare(`SELECT COUNT(*) n FROM (${OWNER_TRACE_MISMATCH})`).get().n,
    apply(db) {
      const worksWithBoth = db.prepare(`SELECT a.nodus_id FROM idea_occurrences a
        JOIN idea_occurrences b ON b.nodus_id = a.nodus_id AND b.global_id = ? WHERE a.global_id = ?`);
      const setOwner = db.prepare('UPDATE edges SET source_work = ? WHERE id = ?');
      const setMethod = db.prepare('UPDATE edge_traces SET method = ? WHERE edge_id = ?');
      let claimed = 0, derived = 0, restored = 0, released = 0;
      for (const edge of db.prepare(OWNER_TRACE_MISMATCH).all()) {
        const owners = worksWithBoth.all(edge.to_id, edge.from_id).map((row) => row.nodus_id);
        if (edge.method === 'deep') {
          if (owners.length === 1) { setOwner.run(owners[0], edge.id); claimed++; }
          else { setMethod.run('reprocess', edge.id); derived++; }
        } else if (owners.includes(edge.source_work)) { setMethod.run('deep', edge.id); restored++; }
        else { setOwner.run(null, edge.id); released++; }
      }
      return `${claimed} given their work, ${derived} made derived, ${restored} restored to deep, ${released} released`;
    },
  },
  {
    label: 'duplicate active ideas',
    count: (db) => db.prepare(`SELECT COUNT(*) n FROM (SELECT 1 FROM ideas WHERE orphaned_at IS NULL
      GROUP BY type, lower(trim(statement)) HAVING COUNT(*) > 1)`).get().n,
    apply(db) {
      const groups = db.prepare(`SELECT group_concat(global_id) ids FROM (
          SELECT global_id, type, statement, created_at FROM ideas WHERE orphaned_at IS NULL ORDER BY created_at, global_id)
        GROUP BY type, lower(trim(statement)) HAVING COUNT(*) > 1`).all();
      let merged = 0;
      for (const group of groups) {
        const [keep, ...drops] = group.ids.split(',');
        for (const drop of drops) { mergeIdea(db, keep, drop); merged++; }
      }
      return `${merged} duplicate(s) merged into ${groups.length} idea(s)`;
    },
  },
  {
    label: 'NUL bytes in citable text',
    count: (db) => db.prepare(`SELECT (SELECT COUNT(*) FROM passages WHERE instr(CAST(text AS BLOB), x'00') > 0)
      + (SELECT COUNT(*) FROM evidence WHERE instr(CAST(quote AS BLOB), x'00') > 0) n`).get().n,
    apply(db) {
      const passages = db.prepare(`SELECT passage_id, text FROM passages WHERE instr(CAST(text AS BLOB), x'00') > 0`).all();
      const setPassage = db.prepare('UPDATE passages SET text = ? WHERE passage_id = ?');
      for (const row of passages) { setPassage.run(row.text.replaceAll('\u0000', ' '), row.passage_id); }
      const evidence = db.prepare(`SELECT id, quote FROM evidence WHERE instr(CAST(quote AS BLOB), x'00') > 0`).all();
      const setQuote = db.prepare('UPDATE evidence SET quote = ? WHERE id = ?');
      for (const row of evidence) { setQuote.run(row.quote.replaceAll('\u0000', ' '), row.id); }
      return `${passages.length} passage(s), ${evidence.length} evidence quote(s)`;
    },
  },
  {
    label: 'inverted section page ranges',
    count: (db) => db.prepare(`SELECT COUNT(*) n FROM document_sections
      WHERE page_start_number IS NOT NULL AND page_end_number IS NOT NULL AND page_end_number < page_start_number`).get().n,
    apply(db) {
      const changed = db.prepare(`UPDATE document_sections SET
          page_end_number = (SELECT t.page_count FROM work_text_sources t WHERE t.nodus_id = document_sections.nodus_id AND t.source_ref = document_sections.source_ref),
          page_end = 'p. ' || (SELECT t.page_count FROM work_text_sources t WHERE t.nodus_id = document_sections.nodus_id AND t.source_ref = document_sections.source_ref)
        WHERE page_start_number IS NOT NULL AND page_end_number IS NOT NULL AND page_end_number < page_start_number
          AND (SELECT t.page_count FROM work_text_sources t WHERE t.nodus_id = document_sections.nodus_id AND t.source_ref = document_sections.source_ref) >= page_start_number`).run().changes;
      return `${changed} section(s) end on their own source's last page`;
    },
  },
  {
    label: 'supports → wrong passage',
    count: (db) => db.prepare(`SELECT COUNT(*) n FROM (${WRONG_SUPPORT})`).get().n,
    apply(db) {
      const passagesOf = new Map();
      const loadPassages = db.prepare('SELECT passage_id, text, source_ref, page_number FROM passages WHERE nodus_id = ? ORDER BY chunk_index');
      const setPassage = db.prepare('UPDATE document_profile_support SET passage_id = ? WHERE support_id = ?');
      let moved = 0, cleared = 0, kept = 0;
      for (const support of db.prepare(WRONG_SUPPORT).all()) {
        if (!passagesOf.has(support.nodus_id)) passagesOf.set(support.nodus_id, loadPassages.all(support.nodus_id));
        const chosen = passageForQuote(support.quote, { sourceRef: support.source_ref, pageNumber: support.page_start_number }, passagesOf.get(support.nodus_id));
        if (chosen === support.passage_id) { kept++; continue; }
        setPassage.run(chosen, support.support_id);
        if (chosen) moved++; else cleared++;
      }
      return `${moved} re-pointed, ${cleared} cleared (no passage holds the quote), ${kept} unchanged`;
    },
  },
  {
    label: 'stale Documentary Index checkpoints',
    count: (db) => db.prepare(`SELECT COUNT(*) n FROM document_index_checkpoints c JOIN document_index_jobs f ON f.job_id = c.job_id
      WHERE f.status IN ('completed','unavailable')
         OR (f.status IN ('failed','cancelled') AND EXISTS (SELECT 1 FROM document_index_jobs k
              WHERE k.nodus_id = f.nodus_id AND k.vault_id = f.vault_id AND k.status = 'completed' AND k.updated_at > f.updated_at))`).get().n,
    apply(db) {
      return `${db.prepare(`DELETE FROM document_index_checkpoints WHERE job_id IN (
        SELECT f.job_id FROM document_index_jobs f
         WHERE f.status IN ('completed','unavailable')
            OR (f.status IN ('failed','cancelled') AND EXISTS (SELECT 1 FROM document_index_jobs k
                 WHERE k.nodus_id = f.nodus_id AND k.vault_id = f.vault_id AND k.status = 'completed' AND k.updated_at > f.updated_at)))`).run().changes} deleted`;
    },
  },
  {
    label: 'leftover deep-scan checkpoints',
    count: (db) => db.prepare(`SELECT COUNT(*) n FROM scan_checkpoints sc JOIN works w ON w.nodus_id = sc.nodus_id
      WHERE w.deep_status = 'done' AND w.deep_queued = 0`).get().n,
    apply(db) {
      return `${db.prepare(`DELETE FROM scan_checkpoints WHERE nodus_id IN (
        SELECT nodus_id FROM works WHERE deep_status = 'done' AND deep_queued = 0)`).run().changes} deleted`;
    },
  },
];

const REPORT_ONLY = [
  {
    label: 'deep analysis older than text (rescan in the app)',
    rows: (db) => db.prepare(`SELECT title FROM works WHERE archived = 0 AND deep_status = 'done'
      AND resolved_text_hash IS NOT NULL AND deep_hash IS NOT resolved_text_hash`).all().map((row) => row.title),
  },
];

/** Move every reference from `drop` onto `keep`, then let `drop` go dormant. */
function mergeIdea(db, keep, drop) {
  // Rows keyed by the idea: move what does not collide, drop what would duplicate.
  for (const [table, column] of [['idea_occurrences', 'global_id'], ['idea_theme_links', 'global_id'], ['document_idea_links', 'global_id']]) {
    db.prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`).run(keep, drop);
    db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(drop);
  }
  db.prepare('UPDATE evidence SET global_id = ? WHERE global_id = ?').run(keep, drop);
  db.prepare('UPDATE gaps SET related_idea = ? WHERE related_idea = ?').run(keep, drop);
  db.prepare('UPDATE external_refs SET from_idea = ? WHERE from_idea = ?').run(keep, drop);
  db.prepare("UPDATE research_coverage_links SET ref_id = ? WHERE kind = 'idea' AND ref_id = ?").run(keep, drop);
  // Edges: re-point, re-canonicalise symmetric types, and fold into an existing edge
  // (keeping the higher confidence) or drop a would-be self-loop.
  const edges = db.prepare('SELECT id, from_id, to_id, type, confidence FROM edges WHERE from_id = ? OR to_id = ?').all(drop, drop);
  const find = db.prepare('SELECT id, confidence FROM edges WHERE from_id = ? AND to_id = ? AND type = ? AND id <> ?');
  const remove = (id) => { db.prepare('DELETE FROM edge_traces WHERE edge_id = ?').run(id); db.prepare('DELETE FROM edges WHERE id = ?').run(id); };
  for (const edge of edges) {
    let from = edge.from_id === drop ? keep : edge.from_id;
    let to = edge.to_id === drop ? keep : edge.to_id;
    if (from === to) { remove(edge.id); continue; }
    if (SYMMETRIC.has(edge.type) && from > to) [from, to] = [to, from];
    const existing = find.get(from, to, edge.type, edge.id);
    if (existing) {
      if (edge.confidence > existing.confidence) db.prepare('UPDATE edges SET confidence = ? WHERE id = ?').run(edge.confidence, existing.id);
      remove(edge.id);
    } else {
      db.prepare('UPDATE edges SET from_id = ?, to_id = ? WHERE id = ?').run(from, to, edge.id);
    }
  }
  db.prepare('UPDATE ideas SET orphaned_at = ? WHERE global_id = ? AND orphaned_at IS NULL').run(now(), drop);
}

// ── Driver ───────────────────────────────────────────────────────────────────

function survey(db) {
  return REPAIRS.map((repair) => ({ label: repair.label, count: repair.count(db) }));
}

function repairVault(dbPath) {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 10000');
    registerAuditFunctions(db);
    const results = [];
    db.transaction(() => {
      for (const repair of REPAIRS) {
        const before = repair.count(db);
        const outcome = before > 0 ? repair.apply(db) : 'nothing to do';
        results.push({ label: repair.label, before, after: repair.count(db), outcome });
      }
    })();
    const reportOnly = REPORT_ONLY.map((item) => ({ label: item.label, rows: item.rows(db) }));
    return { results, reportOnly };
  } finally {
    db.close();
  }
}

function printRepair(result) {
  for (const row of result.results) {
    console.log(`  ${row.label.padEnd(38)} ${String(row.before).padStart(5)} → ${String(row.after).padEnd(5)} ${row.outcome}`);
  }
  for (const item of result.reportOnly) {
    if (!item.rows.length) continue;
    console.log(`  ${item.label}: ${item.rows.length}`);
    for (const title of item.rows) console.log(`      · ${title}`);
  }
}

function runAudit(dbPath) {
  console.log(`\n  -- audit of ${dbPath} --`);
  return spawnSync(process.execPath, [path.join(repoRoot, 'scripts/audit-graph-integrity.mjs'), '--electron-audit-graph-integrity', '--db', dbPath],
    { cwd: repoRoot, env: process.env, stdio: 'inherit' }).status;
}

const vaults = discoverVaults();
if (vaults.length === 0) {
  console.error('No vaults found. Pass --db <path> or --user-data <dir>.');
  process.exit(2);
}
if (apply && !args.includes('--allow-running') && nodusRunning()) {
  console.error('Nodus is running. Quit it first (or pass --allow-running): its scans and index queue write the same tables.');
  process.exit(2);
}

let exitCode = 0;
for (const vault of vaults) {
  console.log(`\n=== ${vault.name} (${vault.path}) ===`);
  if (!fs.existsSync(vault.path)) { console.log('  ! database file not found'); exitCode = 1; continue; }

  if (cloneTest) {
    // A consistent snapshot through SQLite's backup API — safe while the app has it open.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-repair-clone-'));
    const clone = path.join(dir, 'clone.sqlite');
    const source = new Database(vault.path, { readonly: true, fileMustExist: true });
    await source.backup(clone);
    source.close();
    console.log(`  clone: ${clone}`);
    printRepair(repairVault(clone));
    const second = repairVault(clone);
    const idempotent = second.results.every((row) => row.before === 0);
    console.log(`  second run on the clone: ${idempotent ? 'no-op (idempotent)' : 'CHANGED THINGS AGAIN'}`);
    if (!idempotent) exitCode = 1;
    if (runAudit(clone) !== 0) exitCode = 1;
    if (args.includes('--keep-clone')) console.log(`  kept clone: ${clone}`);
    else fs.rmSync(dir, { recursive: true, force: true });
    continue;
  }

  if (!apply) {
    const db = new Database(vault.path, { readonly: true, fileMustExist: true });
    registerAuditFunctions(db);
    const rows = survey(db);
    const reportOnly = REPORT_ONLY.map((item) => ({ label: item.label, rows: item.rows(db) }));
    db.close();
    for (const row of rows) console.log(`  ${row.label.padEnd(38)} ${row.count === 0 ? 'clean' : `${row.count} to repair`}`);
    for (const item of reportOnly) if (item.rows.length) console.log(`  ${item.label}: ${item.rows.join(' · ')}`);
    if (rows.some((row) => row.count > 0)) {
      exitCode = 1;
      console.log('\n  dry run — nothing changed. --clone-test to rehearse on a copy, --apply to repair.');
    }
    continue;
  }

  // A consistent snapshot next to the vault before the first write; restore by copying it back.
  const backup = `${vault.path}.before-library-repair-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const source = new Database(vault.path, { readonly: true, fileMustExist: true });
  await source.backup(backup);
  source.close();
  console.log(`  backup: ${backup}`);
  printRepair(repairVault(vault.path));
  if (runAudit(vault.path) !== 0) exitCode = 1;
}
process.exit(exitCode);
