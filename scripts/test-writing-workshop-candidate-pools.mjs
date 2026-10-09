// The Writing Workshop candidate pools must stay linear in the rows they return.
//
// Each pool reports how many works/ideas/gaps/themes hang off a row. Doing that by
// LEFT JOINing the one-to-many tables and grouping the result multiplies before it
// aggregates, and every intermediate row carries the wide columns of the SELECT —
// for works, the summary and the document-profile overview. SQLite then answers
// with a temp b-tree per DISTINCT aggregate plus one for GROUP BY and one for
// ORDER BY, and `temp_store = MEMORY` keeps all of them in RAM. On a corpus of a
// few hundred profiled works that reached several GB and aborted the process
// mid-query, killing Deep Research and Immersion (both build this snapshot).
//
// So this test pins two things at once: the rewritten pools return exactly what the
// historical grouped queries returned, and they no longer ask SQLite to group.
// Runs under Electron-as-Node so better-sqlite3 matches the app ABI.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireElectronRuntime } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!requireElectronRuntime(fileURLToPath(import.meta.url), '--electron-candidate-pool-test')) process.exit(0);

const source = fs.readFileSync(path.join(repoRoot, 'electron/ai/writingWorkshop.ts'), 'utf8');

/** The SQL of one candidate pool: the first template literal inside its function. */
function poolSql(functionName) {
  const at = source.indexOf(`function ${functionName}(`);
  assert.notEqual(at, -1, `${functionName} not found in writingWorkshop.ts`);
  const open = source.indexOf('`', at);
  const close = source.indexOf('`', open + 1);
  assert.ok(open !== -1 && close !== -1, `${functionName} has no SQL template literal`);
  return source.slice(open + 1, close);
}

// The shape these pools had before the rewrite. Kept verbatim so the test compares
// against the behaviour that shipped, not against a paraphrase of it.
const HISTORICAL = {
  rankedIdeas: `SELECT i.global_id, i.type, i.label, i.statement,
          COALESCE(GROUP_CONCAT(DISTINCT t.label), '') AS themes,
          COUNT(DISTINCT io.nodus_id) AS work_count,
          COUNT(DISTINCT e.id) AS evidence_count,
          COALESCE(GROUP_CONCAT(DISTINCT io.nodus_id), '') AS work_ids
     FROM ideas i
     LEFT JOIN idea_occurrences io ON io.global_id = i.global_id
     LEFT JOIN evidence e ON e.global_id = i.global_id
     LEFT JOIN idea_theme_links itl ON itl.global_id = i.global_id
     LEFT JOIN themes t ON t.theme_id = itl.theme_id
    GROUP BY i.global_id
    ORDER BY work_count DESC, evidence_count DESC, i.created_at ASC`,
  rankedThemes: `SELECT t.theme_id, t.label, t.pinned,
          COUNT(DISTINCT wt.nodus_id) AS work_count,
          COUNT(DISTINCT itl.global_id) AS idea_count,
          COALESCE(GROUP_CONCAT(DISTINCT wt.nodus_id), '') AS work_ids
     FROM themes t
     LEFT JOIN work_themes wt ON wt.theme_id = t.theme_id
     LEFT JOIN idea_theme_links itl ON itl.theme_id = t.theme_id
    GROUP BY t.theme_id
    ORDER BY t.pinned DESC, work_count DESC, idea_count DESC`,
  rankedWorks: `SELECT w.nodus_id, w.zotero_key, w.title, w.authors_json, w.year, w.deep_status, w.doi,
          CASE WHEN w.summary_status = 'done' THEN ws.summary ELSE NULL END AS orientation_summary,
          dpv.overview AS document_overview,
          COALESCE(dps.status, 'missing') AS document_status,
          dps.current_version_id AS document_version_id,
          COALESCE(GROUP_CONCAT(DISTINCT t.label), '') AS themes,
          COUNT(DISTINCT io.global_id) AS idea_count,
          COUNT(DISTINCT g.id) AS gap_count
     FROM works w
     LEFT JOIN work_summaries ws ON ws.nodus_id = w.nodus_id
     LEFT JOIN document_profile_state dps ON dps.nodus_id = w.nodus_id
     LEFT JOIN document_profile_versions dpv ON dpv.version_id = dps.current_version_id
     LEFT JOIN work_themes wt ON wt.nodus_id = w.nodus_id
     LEFT JOIN themes t ON t.theme_id = wt.theme_id
     LEFT JOIN idea_occurrences io ON io.nodus_id = w.nodus_id
     LEFT JOIN gaps g ON g.nodus_id = w.nodus_id
    WHERE w.archived = 0
    GROUP BY w.nodus_id
    ORDER BY idea_count DESC, gap_count DESC, w.year DESC`,
};

/** GROUP_CONCAT order is unspecified; compare the members, not the string. */
function normalize(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    key === 'themes' || key === 'work_ids'
      ? String(value ?? '').split(',').filter(Boolean).sort().join(',')
      : value,
  ])));
}

const WORKS = 6;
const THEMES_PER_WORK = 3;
const IDEAS_PER_WORK = 5;
const EVIDENCE_PER_IDEA = 4;
const GAPS_PER_WORK = 2;

function seed(db) {
  const now = '2026-01-01T00:00:00.000Z';
  const insert = {
    work: db.prepare(`INSERT INTO works (nodus_id, zotero_key, title, authors_json, year, item_type, archived,
                                         source_type, resolved_text_hash, deep_status, summary_status)
                      VALUES (?,?,?,?,?, 'journalArticle', 0, 'fulltext', ?, 'done', 'done')`),
    summary: db.prepare(`INSERT INTO work_summaries (nodus_id, summary, source_level, content_hash, created_at, updated_at)
                         VALUES (?,?, 'deep', ?, ?, ?)`),
    version: db.prepare(`INSERT INTO document_profile_versions (version_id, nodus_id, state, source_fingerprint,
                                                                pipeline_version, schema_version, presentation_language,
                                                                overview, profile_json, prompt_hash, created_at)
                         VALUES (?,?, 'current', ?, '1', 1, 'es', ?, '{}', ?, ?)`),
    state: db.prepare(`INSERT INTO document_profile_state (nodus_id, current_version_id, status, updated_at)
                       VALUES (?,?, 'current', ?)`),
    theme: db.prepare('INSERT INTO themes (theme_id, label, created_at) VALUES (?,?,?)'),
    workTheme: db.prepare('INSERT INTO work_themes (nodus_id, theme_id) VALUES (?,?)'),
    idea: db.prepare("INSERT INTO ideas (global_id, type, label, statement, created_at) VALUES (?, 'claim', ?, ?, ?)"),
    occurrence: db.prepare("INSERT INTO idea_occurrences (global_id, nodus_id, role, confidence) VALUES (?,?, 'states', 0.8)"),
    ideaTheme: db.prepare("INSERT INTO idea_theme_links (nodus_id, global_id, theme_id, confidence, basis) VALUES (?,?,?,0.7,'test')"),
    evidence: db.prepare('INSERT INTO evidence (id, global_id, nodus_id, quote, location) VALUES (?,?,?,?,?)'),
    gap: db.prepare("INSERT INTO gaps (id, nodus_id, related_idea, kind, statement, confidence) VALUES (?,?,NULL,'evidence',?,0.5)"),
  };
  const themeCount = WORKS * THEMES_PER_WORK;
  for (let t = 0; t < themeCount; t += 1) insert.theme.run(`T${t}`, `Tema ${t}`, now);
  let ideaSeq = 0;
  let evidenceSeq = 0;
  for (let w = 0; w < WORKS; w += 1) {
    const workId = `W${w}`;
    insert.work.run(workId, `zk${w}`, `Obra ${w}`, JSON.stringify([`Autor ${w}`]), 2020 + w, `h${w}`);
    insert.summary.run(workId, `Resumen de la obra ${w}`, `s${w}`, now, now);
    insert.version.run(`V${w}`, workId, `f${w}`, `Perfil documental de la obra ${w}`, `p${w}`, now);
    insert.state.run(workId, `V${w}`, now);
    for (let t = 0; t < THEMES_PER_WORK; t += 1) insert.workTheme.run(workId, `T${(w * THEMES_PER_WORK + t) % themeCount}`);
    for (let i = 0; i < IDEAS_PER_WORK; i += 1) {
      const ideaId = `I${ideaSeq += 1}`;
      insert.idea.run(ideaId, `Idea ${ideaId}`, `Enunciado de ${ideaId}`, now);
      // Fan-out on every side the pools aggregate over: the idea recurs in two works,
      // carries the same themes through both of them, and is evidenced several times.
      // That duplication is precisely what the grouped queries multiplied and what the
      // DISTINCT aggregates then had to undo.
      const carriers = [workId, `W${(w + 1) % WORKS}`];
      for (const carrier of carriers) {
        insert.occurrence.run(ideaId, carrier);
        for (let t = 0; t < THEMES_PER_WORK; t += 1) {
          insert.ideaTheme.run(carrier, ideaId, `T${(w * THEMES_PER_WORK + t) % themeCount}`);
        }
      }
      for (let e = 0; e < EVIDENCE_PER_IDEA; e += 1) {
        insert.evidence.run(`E${evidenceSeq += 1}`, ideaId, workId, `Cita ${evidenceSeq}`, `p. ${e + 1}`);
      }
    }
    for (let g = 0; g < GAPS_PER_WORK; g += 1) insert.gap.run(`G${w}_${g}`, workId, `Hueco ${w}-${g}`);
  }
}

const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-candidate-pools-'));
installTsHook();

const Database = require('better-sqlite3');
const { runMigrations } = require(path.join(repoRoot, 'electron/db/migrations.ts'));
const db = new Database(path.join(root, 'pools.sqlite'));
runMigrations(db);
seed(db);

test.after(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});

const KEY = { rankedIdeas: 'global_id', rankedThemes: 'theme_id', rankedWorks: 'nodus_id' };

for (const [pool, historicalSql] of Object.entries(HISTORICAL)) {
  const currentSql = poolSql(pool);
  const byKey = (rows) => normalize(rows).sort((a, b) => String(a[KEY[pool]]).localeCompare(String(b[KEY[pool]])));

  test(`${pool} returns what the grouped query returned`, () => {
    // Compared as a set: neither shape defined an order among ties, and the two
    // plans broke them differently. What the pool contains is the contract; the
    // order is pinned separately, below.
    assert.deepEqual(
      byKey(db.prepare(currentSql).all()),
      byKey(db.prepare(historicalSql).all()),
      `${pool} changed the candidate pool it produces`
    );
  });

  test(`${pool} asks SQLite for no grouping`, () => {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${currentSql}`).all().map((row) => row.detail).join('\n');
    assert.ok(
      !/TEMP B-TREE FOR GROUP BY/i.test(plan),
      `${pool} is back to a grouped join, which allocates the whole cross product in memory:\n${plan}`
    );
    assert.ok(!/\bGROUP BY\b/i.test(currentSql), `${pool} must aggregate with scalar subqueries, not GROUP BY`);
  });

  test(`${pool} orders its candidates deterministically`, () => {
    // The pool is truncated to MAX_IDEAS/MAX_THEMES/MAX_WORKS after scoring, so an
    // order left to the planner decides which tied candidates survive the cut.
    const orderBy = currentSql.slice(currentSql.toUpperCase().lastIndexOf('ORDER BY'));
    assert.match(orderBy, new RegExp(`${KEY[pool]}\\s+ASC\\s*$`), `${pool} must break ties on ${KEY[pool]}`);
  });
}

// The pools must not reintroduce a one-to-many join at the top level either: a
// grouped plan is the symptom, the multiplying join is the cause.
test('no candidate pool joins a one-to-many table at the top level', () => {
  const fanOut = ['idea_occurrences', 'evidence', 'idea_theme_links', 'work_themes', 'gaps'];
  for (const pool of Object.keys(HISTORICAL)) {
    const sql = poolSql(pool);
    const topLevel = sql.replace(/\(SELECT[\s\S]*?\)(?=\s*(?:AS|,|$))/g, '');
    for (const table of fanOut) {
      assert.ok(
        !new RegExp(`JOIN\\s+${table}\\b`, 'i').test(topLevel),
        `${pool} joins ${table} outside a subquery, which multiplies rows before aggregating`
      );
    }
  }
});

function installTsHook() {
  const ts = require('typescript');
  const Module = require('node:module');
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    if (request.startsWith('@shared/')) {
      return path.join(repoRoot, `${request.replace('@shared/', 'shared/')}.ts`);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  require.extensions['.ts'] = function loadTs(module, filename) {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
      },
    }).outputText;
    module._compile(output, filename);
  };
}
