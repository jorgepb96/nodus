import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  STATS_BRANCH,
  STATS_FILE,
  downloadIncreases,
  downloadRows,
  formatDownloadTable,
  parseDownloadTable,
  recordDownloadSnapshot,
} from './release-download-snapshots.mjs';
import { historyFromTables, parseArgs } from './release-download-history.mjs';

const release = (tag, publishedAt, assets, extra = {}) => ({
  tag_name: tag,
  published_at: publishedAt,
  assets: Object.entries(assets).map(([name, download_count]) => ({ name, download_count })),
  ...extra,
});

const RELEASES = [
  release('v5.16.1', '2026-10-25T12:01:36Z', { 'Nodus-linux-x86_64.rpm': 185, 'latest-linux.yml': 143 }),
  release('v5.17.1', null, { 'nodus-zotero.xpi': 0 }, { draft: true }),
  release('v5.17.0', '2026-11-09T04:32:08Z', { 'Nodus-win-x64.exe': 4, 'Nodus-linux-x86_64.rpm': 1 }),
];

test('one row per file of every published release, newest first, drafts left out', () => {
  assert.deepEqual(downloadRows(RELEASES), [
    'v5.17.0\t2026-11-09T04:32:08Z\tNodus-linux-x86_64.rpm\t1',
    'v5.17.0\t2026-11-09T04:32:08Z\tNodus-win-x64.exe\t4',
    'v5.16.1\t2026-10-25T12:01:36Z\tNodus-linux-x86_64.rpm\t185',
    'v5.16.1\t2026-10-25T12:01:36Z\tlatest-linux.yml\t143',
  ]);
  const table = formatDownloadTable(RELEASES, '2026-11-09T11:00:00.000Z');
  assert.ok(table.startsWith('# Nodus release asset downloads'));
  const parsed = parseDownloadTable(table);
  assert.equal(parsed.takenAt, '2026-11-09T11:00:00.000Z');
  assert.equal(parsed.counts.get('v5.16.1\tlatest-linux.yml'), 143, 'update checks are kept: they show real use');
  assert.equal(parsed.counts.has('v5.17.1\tnodus-zotero.xpi'), false);
});

test('increases list the files that grew or appeared, largest first', () => {
  const before = formatDownloadTable(RELEASES, 'a');
  const after = formatDownloadTable([
    release('v5.16.1', '2026-10-25T12:01:36Z', { 'Nodus-linux-x86_64.rpm': 185, 'latest-linux.yml': 150 }),
    release('v5.17.0', '2026-11-09T04:32:08Z', { 'Nodus-win-x64.exe': 4, 'Nodus-linux-x86_64.rpm': 31, 'latest.yml': 2 }),
  ], 'b');
  assert.deepEqual(downloadIncreases(before, after), [
    { tag: 'v5.17.0', asset: 'Nodus-linux-x86_64.rpm', delta: 30, count: 31 },
    { tag: 'v5.16.1', asset: 'latest-linux.yml', delta: 7, count: 150 },
    { tag: 'v5.17.0', asset: 'latest.yml', delta: 2, count: 2 },
  ]);
});

function fakeGithub(releases) {
  const state = { branch: false, file: null, writes: [], refs: [] };
  const notFound = () => Object.assign(new Error('Not Found'), { status: 404 });
  const github = {
    paginate: async (method, params) => {
      assert.equal(method, github.rest.repos.listReleases);
      assert.equal(params.per_page, 100);
      return releases();
    },
    rest: {
      repos: {
        listReleases: () => {},
        getContent: async ({ path, ref }) => {
          assert.equal(path, STATS_FILE);
          assert.equal(ref, STATS_BRANCH);
          if (!state.file) throw notFound();
          return { data: { sha: state.file.sha, content: Buffer.from(state.file.text).toString('base64') } };
        },
        createOrUpdateFileContents: async (params) => {
          assert.equal(params.branch, STATS_BRANCH, 'only the data branch is written');
          assert.equal(params.sha, state.file?.sha, 'updates name the blob they replace');
          state.writes.push(params);
          state.file = { sha: `sha${state.writes.length}`, text: Buffer.from(params.content, 'base64').toString('utf8') };
          return { data: {} };
        },
      },
      git: {
        getRef: async () => { if (!state.branch) throw notFound(); return { data: {} }; },
        createTree: async ({ tree }) => { assert.equal(tree[0].path, 'README.md'); return { data: { sha: 'tree' } }; },
        createCommit: async ({ parents }) => { assert.deepEqual(parents, [], 'the data branch shares no history with main'); return { data: { sha: 'root' } }; },
        createRef: async (params) => { state.refs.push(params); state.branch = true; return { data: {} }; },
      },
    },
  };
  return { github, state };
}

test('the first snapshot starts an orphan branch, unchanged counts record nothing, growth commits', async () => {
  let current = RELEASES;
  const { github, state } = fakeGithub(() => current);
  const logs = [];
  const core = { info: (line) => logs.push(line) };
  const context = { repo: { owner: 'jorgepb96', repo: 'nodus' } };
  let clock = 0;
  const now = () => new Date(Date.UTC(2026, 10, 9, 11 + 12 * clock++));

  assert.equal((await recordDownloadSnapshot({ github, context, core, now })).recorded, true);
  assert.deepEqual(state.refs.map((ref) => ref.ref), [`refs/heads/${STATS_BRANCH}`]);
  assert.equal(state.writes[0].message, 'Release downloads at 2026-11-09T11:00:00.000Z');

  assert.equal((await recordDownloadSnapshot({ github, context, core, now })).recorded, false, 'only the time changed');
  assert.equal(state.writes.length, 1);

  current = [release('v5.17.0', '2026-11-09T04:32:08Z', { 'Nodus-win-x64.exe': 9, 'Nodus-linux-x86_64.rpm': 1 }), RELEASES[0]];
  const result = await recordDownloadSnapshot({ github, context, core, now });
  assert.equal(result.recorded, true);
  assert.equal(state.writes[1].message, 'Release downloads at 2026-11-10T11:00:00.000Z (+5)');
  assert.equal(state.refs.length, 1, 'the branch is created once');
  assert.ok(logs.includes('+5\tv5.17.0\tNodus-win-x64.exe'));
});

test('the history reader turns consecutive snapshots into increases, filtered by file', () => {
  const tables = [
    formatDownloadTable(RELEASES, '2026-11-09T11:00:00.000Z'),
    formatDownloadTable([release('v5.17.0', '2026-11-09T04:32:08Z', { 'Nodus-win-x64.exe': 5, 'Nodus-linux-x86_64.rpm': 12 }), RELEASES[0]], '2026-11-09T23:00:00.000Z'),
    formatDownloadTable([release('v5.17.0', '2026-11-09T04:32:08Z', { 'Nodus-win-x64.exe': 6, 'Nodus-linux-x86_64.rpm': 12 }), RELEASES[0]], '2026-11-10T11:00:00.000Z'),
  ];
  const rpm = historyFromTables(tables, { match: '.RPM' });
  assert.deepEqual(rpm, [{
    from: '2026-11-09T11:00:00.000Z', takenAt: '2026-11-09T23:00:00.000Z',
    increases: [{ tag: 'v5.17.0', asset: 'Nodus-linux-x86_64.rpm', delta: 11, count: 12 }],
  }]);
  assert.equal(historyFromTables(tables, { since: '2026-11-10' }).length, 1);
  assert.deepEqual(parseArgs(['--match', 'rpm', '--no-fetch']), { match: 'rpm', since: null, fetch: false, remote: 'origin' });
  assert.throws(() => parseArgs(['--bogus']), /Unknown option/);
});

test('the snapshot workflow runs trusted code after each website deploy and writes only its branch', async () => {
  const workflow = await readFile(new URL('../.github/workflows/download-stats.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_run:\s*\n\s*workflows: \[Website\]\s*\n\s*types: \[completed\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s*contents: write/);
  assert.doesNotMatch(workflow, /pages: write|id-token|issues: write|pull-requests: write/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /git push|git commit|npm (?:ci|install)|head_branch|head_sha/);
  for (const use of workflow.matchAll(/uses: ([^\s]+)/g)) assert.match(use[1], /@[0-9a-f]{40}$/, `${use[1]} is pinned to a commit`);
  assert.match(workflow, /recordDownloadSnapshot\(\{ github, context, core \}\)/);
  const site = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(site, /^name: Website$/m, 'the trigger names the website workflow');
});
