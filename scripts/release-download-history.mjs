#!/usr/bin/env node
// Prints how release download counts grew between the snapshots that the
// "Download stats" workflow keeps on the download-stats branch.
//
//   node scripts/release-download-history.mjs                 every file, every snapshot
//   node scripts/release-download-history.mjs --match .rpm    only files whose tag or name contains ".rpm"
//   node scripts/release-download-history.mjs --since 2026-11-10
//   node scripts/release-download-history.mjs --no-fetch      use the branch already fetched
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATS_BRANCH, STATS_FILE, downloadIncreases, parseDownloadTable } from './release-download-snapshots.mjs';

export function parseArgs(argv) {
  const options = { match: null, since: null, fetch: true, remote: 'origin' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--match') options.match = argv[++i] ?? null;
    else if (arg === '--since') options.since = argv[++i] ?? null;
    else if (arg === '--remote') options.remote = argv[++i] ?? 'origin';
    else if (arg === '--no-fetch') options.fetch = false;
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

/** Turns consecutive tables (oldest first) into the increases between each pair. */
export function historyFromTables(tables, { match = null, since = null } = {}) {
  const needle = match ? match.toLowerCase() : null;
  const steps = [];
  for (let i = 1; i < tables.length; i += 1) {
    const takenAt = parseDownloadTable(tables[i]).takenAt;
    if (since && (takenAt ?? '') < since) continue;
    const increases = downloadIncreases(tables[i - 1], tables[i])
      .filter((item) => !needle || `${item.tag} ${item.asset}`.toLowerCase().includes(needle));
    if (increases.length) steps.push({ from: parseDownloadTable(tables[i - 1]).takenAt, takenAt, increases });
  }
  return steps;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const ref = `${options.remote}/${STATS_BRANCH}`;
  if (options.fetch) git(['fetch', '--quiet', options.remote, `+refs/heads/${STATS_BRANCH}:refs/remotes/${ref}`]);
  const commits = git(['log', '--reverse', '--format=%H', ref, '--', STATS_FILE]).split('\n').filter(Boolean);
  const tables = commits.map((sha) => git(['show', `${sha}:${STATS_FILE}`]));
  const steps = historyFromTables(tables, options);
  if (!steps.length) console.log(tables.length < 2 ? 'Fewer than two snapshots so far.' : 'No matching increases.');
  for (const step of steps) {
    const total = step.increases.reduce((sum, item) => sum + item.delta, 0);
    console.log(`${step.from} → ${step.takenAt}  +${total}`);
    for (const item of step.increases) console.log(`  +${item.delta}\t${item.tag}\t${item.asset}\t(${item.count})`);
  }
}
