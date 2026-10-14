import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ISSUE_CONTEXT, COMMENT_MARKER, issueLink, verifyIssues, belongsToPr, collectChecks,
  logExcerpt, failureDetails, commentBody, syncComment, run,
} from './pr-checks.mjs';

const repo = { owner: 'jorgepb96', repo: 'nodus' };
const fixture = (number = 42) => ({
  number, state: 'open', draft: false, body: 'Closes #123', user: { login: 'contributor' },
  head: { sha: 'a'.repeat(40), ref: 'feature', repo: { full_name: 'contributor/nodus' } },
  base: { sha: 'b'.repeat(40), ref: 'main' }, merge_commit_sha: 'c'.repeat(40),
});
const job = (id, name, conclusion = 'success') => ({ id, name, conclusion, status: 'completed',
  html_url: `https://github.com/jorgepb96/nodus/actions/runs/50/job/${id}`,
  steps: [{ name: 'Run tests', number: 3, status: 'completed', conclusion }],
});
const workflow = (overrides = {}) => ({
  id: 50, workflow_id: 1, name: 'CI', path: '.github/workflows/ci.yml',
  event: 'pull_request', head_sha: 'a'.repeat(40), run_attempt: 1,
  status: 'completed', conclusion: 'success', pull_requests: [{ number: 42 }],
  html_url: 'https://github.com/jorgepb96/nodus/actions/runs/50', ...overrides,
});

function harness(options = {}) {
  const pr = options.pr ?? fixture();
  const prs = options.prs ?? [pr];
  const writes = [], warnings = [], errors = [], calls = [];
  const comments = options.comments ?? [];
  const jobs = options.jobs ?? [job(10, 'Build'), job(11, 'test')];
  const runs = options.runs ?? [workflow()];
  const statuses = options.statuses ?? [
    { id: 5, context: ISSUE_CONTEXT, state: 'success' },
    { id: 4, context: 'CLA / signature', state: 'success' },
  ];
  let nextId = 100;
  const response = data => ({ data });
  const github = {
    paginate: async (method, args) => {
      const { data } = await method(args);
      return data.workflow_runs ?? data.jobs ?? data.check_runs ?? data;
    },
    graphql: async (query, args) => {
      if (options.graphqlError) throw new Error('GitHub unavailable');
      const found = prs.find(item => item.number === args.number);
      const linked = options.links?.[args.number] ?? options.linked ?? true;
      return { repository: { pullRequest: {
        headRefOid: found.head.sha, body: found.body ?? '', state: 'OPEN',
        closingIssuesReferences: { nodes: linked ? [{ url: 'https://github.com/jorgepb96/nodus/issues/123' }] : [] },
        ...options.graphqlOverrides,
      } } };
    },
    request: async () => response([{ type: 'required_status_checks', parameters: {
      required_status_checks: [{ context: 'test' }, { context: 'CLA / signature' }, ...(options.extraRequired ?? [])],
    } }]),
    rest: {
      pulls: {
        list: async () => response(prs),
        get: async ({ pull_number }) => response(options.currentPr ?? prs.find(item => item.number === pull_number)),
      },
      repos: {
        createCommitStatus: async args => {
          writes.push({ type: 'status', ...args });
          statuses.unshift({ id: nextId++, context: args.context, state: args.state,
            target_url: args.target_url, description: args.description });
          return response({});
        },
        listCommitStatusesForRef: async ({ ref }) => response(ref === pr.head.sha ? statuses : options.mergeStatuses ?? []),
      },
      checks: { listForRef: async args => response({ check_runs: options.checks?.[args.ref] ?? [] }) },
      actions: {
        listWorkflowRunsForRepo: async args => { calls.push(args); return response({ workflow_runs: runs }); },
        listJobsForWorkflowRun: async args => {
          calls.push(args);
          return response({ jobs: options.jobsByRun?.[args.run_id] ?? jobs });
        },
        downloadJobLogsForWorkflowRun: async args => {
          calls.push(args);
          if (options.logsError) throw new Error('Logs expired');
          if (options.onLog) options.onLog();
          return response(options.logs ?? 'Error: expected true, received false\nProcess completed with exit code 1.');
        },
      },
      issues: {
        listComments: async () => response(comments),
        createComment: async args => {
          writes.push({ type: 'create', ...args });
          comments.push({ id: nextId++, body: args.body, user: { login: 'github-actions[bot]', type: 'Bot' } });
          return response({});
        },
        updateComment: async args => {
          writes.push({ type: 'update', ...args });
          comments.find(comment => comment.id === args.comment_id).body = args.body;
          return response({});
        },
      },
    },
  };
  const core = { warning: text => warnings.push(text), setFailed: text => errors.push(text),
    summary: { addRaw() { return this; }, async write() {} } };
  const h = { github, core, pr, prs, jobs, runs, statuses, writes, warnings, errors, calls, comments, options };
  h.report = required => collectChecks({ github, repo, pr, required });
  h.sync = async (report, issue = { linked: true }) => syncComment({ github, repo, pr, core, issue,
    report: report ?? await h.report() });
  h.verify = () => verifyIssues({ github, repo, prs, core, runUrl: 'https://github.com/jorgepb96/nodus/actions/runs/1' });
  return h;
}

test('issue verification uses real GitHub links, including an empty REST body', async () => {
  const h = harness({ linked: false });
  assert.equal(await issueLink(h.github, repo, h.pr), false, 'Closes #123 text alone does not prove the issue exists');
  h.options.linked = true;
  assert.equal(await issueLink(h.github, repo, h.pr), true);
  h.pr.body = null;
  assert.equal(await issueLink(h.github, repo, h.pr), true);
  for (const graphqlOverrides of [{ headRefOid: 'old' }, { body: 'changed' }, { state: 'CLOSED' }]) {
    const changed = harness({ graphqlOverrides });
    await assert.rejects(issueLink(changed.github, repo, changed.pr), /PR changed/);
  }
});

test('shared commit statuses cannot turn green if any open PR lacks a linked issue', async () => {
  const h = harness({ prs: [fixture(), fixture(43)], links: { 42: true, 43: false } });
  const result = await h.verify();
  assert.equal(result.get(42).linked, true);
  assert.equal(result.get(43).linked, false);
  assert.deepEqual(h.writes.map(write => write.state), ['pending', 'failure']);
  assert.deepEqual(h.errors, []);
});

test('API errors invalidate previous green issue statuses and report an operational failure', async () => {
  const h = harness({ graphqlError: true });
  await h.verify();
  assert.deepEqual(h.writes.map(write => write.state), ['pending', 'error']);
  assert.equal(h.errors.length, 1);
});

test('a PR waits for CI to appear and for queued or running workflows', async () => {
  for (const runs of [[], [workflow({ status: 'queued', conclusion: null })],
    [workflow(), workflow({ id: 60, workflow_id: 2, name: 'Security', status: 'in_progress', conclusion: null })]]) {
    assert.equal((await harness({ runs }).report()).pending, true);
  }
});

test('only the latest run and latest execution of each job count, retaining successful jobs from earlier attempts', async () => {
  const h = harness({ runs: [workflow({ id: 40, conclusion: 'failure' }), workflow({ run_attempt: 2 })],
    jobs: [job(1, 'Build', 'failure'), job(11, 'test'), job(10, 'Build')] });
  const report = await h.report();
  assert.equal(report.pending, false);
  assert.deepEqual(report.failures, []);
  assert.ok(h.calls.some(call => call.run_id === 50 && call.filter === 'all'));
  assert.ok(!h.calls.some(call => call.run_id === 40));
});

test('fork run fallback requires the exact head, source repository, and source branch', () => {
  const pr = fixture();
  const fork = workflow({ pull_requests: [], head_repository: { full_name: pr.head.repo.full_name }, head_branch: pr.head.ref });
  assert.equal(belongsToPr(fork, pr), true);
  for (const overrides of [{ head_sha: 'old' }, { head_branch: 'other' },
    { head_repository: { full_name: 'other/nodus' } }, { pull_requests: [{ number: 99 }] }, { event: 'push' }]) {
    assert.equal(belongsToPr({ ...fork, ...overrides }, pr), false);
  }
});

test('a completed CI startup failure is actionable even if it never created the test job', async () => {
  const report = await harness({ runs: [workflow({ conclusion: 'failure' })], jobs: [] }).report();
  assert.equal(report.pending, false);
  assert.ok(report.failures.some(check => check.name === 'test'));
});

test('legitimate skips and neutral jobs pass while cancellations and timeouts remain failures', async () => {
  const h = harness({ jobs: [job(1, 'Unused platform', 'skipped'), job(2, 'Advisory', 'neutral'), job(11, 'test')] });
  assert.deepEqual((await h.report()).failures, []);
  h.jobs.push(job(3, 'Build', 'timed_out'), job(4, 'E2E', 'cancelled'));
  assert.deepEqual((await h.report()).failures.map(check => check.state).sort(), ['cancelled', 'timed_out']);
});

test('both refs include external checks but unrelated Actions push/release jobs are ignored', async () => {
  const pr = fixture();
  const h = harness({ pr, mergeStatuses: [{ id: 9, context: 'External build', state: 'error' }], checks: {
    [pr.head.sha]: [{ id: 20, name: 'Security', app: { id: 2, slug: 'security' }, status: 'completed', conclusion: 'failure' },
      { id: 21, name: 'Publish release', app: { slug: 'github-actions' }, status: 'in_progress' }],
    [pr.merge_commit_sha]: [{ id: 22, name: 'Security', app: { id: 2, slug: 'security' }, status: 'completed', conclusion: 'success' }],
  } });
  const report = await h.report();
  assert.equal(report.pending, false);
  assert.deepEqual(report.failures.map(check => check.name), ['External build']);
});

test('observed pending external checks and missing required contexts prevent premature notices', async () => {
  const pr = fixture();
  const h = harness({ pr, checks: { [pr.head.sha]: [{ name: 'Review', app: { id: 2 }, status: 'queued' }] } });
  assert.equal((await h.report()).pending, true);
  assert.equal((await harness().report(['Issue linked', 'CLA / signature', 'test', 'New required check'])).pending, true);
  const spoof = harness({ pr, statuses: [{ id: 5, context: ISSUE_CONTEXT, state: 'success' }],
    checks: { [pr.head.sha]: [{ name: 'CLA / signature', app: { id: 2 }, status: 'completed', conclusion: 'success' }] } });
  assert.equal((await spoof.report()).pending, true, 'external checks cannot impersonate the CLA status');
});

test('excerpts select the failed step, preserve error context, redact credentials, and stay bounded', () => {
  const lines = ['2026-10-14T12:00:00.000Z Previous step Error: irrelevant',
    '2026-10-14T12:01:00.000Z \x1b[31mError: actual failure\x1b[0m',
    '2026-10-14T12:01:01.000Z GITHUB_TOKEN=ghp_verysecretvalue',
    '2026-10-14T12:01:02.000Z Authorization: Bearer sensitive-value',
    ...Array.from({ length: 60 }, (_, i) => `2026-10-14T12:01:03.000Z context ${i}`)];
  const result = logExcerpt(lines.join('\n'), { started_at: '2026-10-14T12:01:00Z', completed_at: '2026-10-14T12:01:05Z' });
  assert.match(result, /Error: actual failure/);
  assert.doesNotMatch(result, /irrelevant|verysecretvalue|sensitive-value|\x1b|2026-/);
  assert.ok(result.split('\n').length <= 30);
  assert.ok(logExcerpt('Error: ' + 'x'.repeat(10000)).length < 1900);
});

test('failure comments escape untrusted logs and step names; expired logs keep useful links', async () => {
  const h = harness({ jobs: [job(10, 'Build', 'failure'), job(11, 'test', 'failure')],
    logs: 'Error: </pre></details><script>alert(1)</script>\n```\n@someone' });
  h.jobs[0].steps[0].name = 'Build </summary> @someone';
  const report = await h.report();
  const details = await failureDetails({ ...h, repo, report, issue: { linked: true } });
  assert.match(details, /&lt;script&gt;/);
  assert.doesNotMatch(details, /<script>|Build <\/summary>|Build.* @someone/);
  h.options.logsError = true;
  const fallback = await failureDetails({ ...h, repo, report, issue: { linked: true } });
  assert.match(fallback, /https:\/\/github.com\//);
  assert.doesNotMatch(fallback, /<pre>/);
  assert.ok(h.warnings.length > 0);
});

test('excerpts ignore successful TAP summaries and echoed command source before the actual error', () => {
  const raw = ['# tests 6', '# pass 6', '# fail 0',
    '##[group]Run node example.mjs', 'throw new Error("this is source, not the failure")', 'env:', '##[endgroup]',
    ...Array.from({ length: 60 }, (_, i) => `Build progress ${i}`),
    'src/example.ts(42,1): error TS2322: Type string is not assignable to number.',
    '##[error]Process completed with exit code 2.'].join('\n');
  const excerpt = logExcerpt(raw);
  assert.match(excerpt, /error TS2322/);
  assert.doesNotMatch(excerpt, /fail 0|this is source|Build progress 0/);
});

test('a repeated failure updates its existing comment; a green transition creates a real mention notification', async () => {
  const h = harness({ jobs: [job(10, 'Build', 'failure'), job(11, 'test')] });
  assert.equal(await h.sync(), 'created');
  assert.match(h.comments[0].body, /@contributor, the following checks have failed/);
  assert.equal(await h.sync(), 'unchanged');
  h.jobs.push(job(12, 'E2E', 'failure'));
  assert.equal(await h.sync(), 'updated');
  assert.equal(h.comments.length, 1);
  for (const item of h.jobs) { item.conclusion = 'success'; item.steps[0].conclusion = 'success'; }
  assert.equal(await h.sync(), 'created');
  assert.equal(h.comments.length, 2);
  assert.match(h.comments[1].body, /@jorgepb96 @contributor, all required checks have passed/);
  assert.doesNotMatch(h.comments[1].body, /will be merged/);
  assert.equal(await h.sync(), 'unchanged');
});

test('failed-job reruns refresh excerpts and links without generating duplicate notifications', async () => {
  const h = harness({ jobs: [job(10, 'Build', 'failure'), job(11, 'test')] });
  await h.sync();
  h.runs[0].run_attempt = 2;
  h.jobs[0].id = 1000;
  h.options.logs = 'Error: new failure details from the rerun';
  assert.equal(await h.sync(), 'updated');
  assert.equal(h.comments.length, 1);
  assert.match(h.comments[0].body, /new failure details from the rerun/);
});

test('success mentions the owner only once when the owner also authored the PR', () => {
  const pr = fixture(); pr.user.login = 'JorgePB96';
  const body = commentBody({ pr, owner: 'jorgepb96', report: { failures: [], fingerprint: 'same' } });
  assert.equal((body.match(/@jorgepb96/g) ?? []).length, 1);
});

test('a contributor cannot forge a managed bot comment to suppress the real notification', async () => {
  const original = harness();
  const report = await original.report();
  const body = commentBody({ pr: original.pr, owner: repo.owner, report });
  const h = harness({ comments: [{ id: 10, body, user: { type: 'User', login: 'contributor' } }] });
  assert.equal(await h.sync(), 'created');
});

test('draft and closed PRs produce no notification comments', async () => {
  for (const changes of [{ draft: true }, { state: 'closed' }]) {
    const h = harness({ pr: { ...fixture(), ...changes } });
    assert.equal(await h.sync(), 'skipped');
    assert.deepEqual(h.writes, []);
  }
});

test('PR changes during log retrieval prevent stale comments', async () => {
  for (const change of [{ head: { ...fixture().head, sha: 'new' } }, { draft: true }, { state: 'closed' }, { body: 'changed' }]) {
    const h = harness({ jobs: [job(10, 'Build', 'failure'), job(11, 'test')] });
    h.options.onLog = () => { h.options.currentPr = { ...h.pr, ...change }; };
    assert.equal(await h.sync(), 'changed');
    assert.equal(h.comments.length, 0);
  }
});

test('a check rerun or sidebar unlink during log retrieval prevents a stale completed notice', async () => {
  for (const mode of ['checks', 'issue']) {
    const h = harness({ jobs: [job(10, 'Build', 'failure'), job(11, 'test')] });
    h.options.onLog = () => {
      if (mode === 'checks') h.runs[0].status = 'in_progress';
      else h.options.linked = false;
    };
    assert.equal(await h.sync(), 'changed');
    assert.equal(h.comments.length, 0);
  }
});

test('pending reruns mark previous green results historical and restore them without a new notification', async () => {
  const h = harness();
  await h.sync();
  h.runs[0].status = 'in_progress';
  assert.equal(await h.sync(), 'pending');
  assert.match(h.comments[0].body, /result above is historical/);
  const count = h.writes.length;
  await h.sync();
  assert.equal(h.writes.length, count);
  h.runs[0].status = 'completed';
  assert.equal(await h.sync(), 'updated');
  assert.equal(h.comments.length, 1);
  assert.doesNotMatch(h.comments[0].body, /historical/);
});

test('full reconciliation publishes the issue status and an actionable failure only after all checks finish', async () => {
  const h = harness({ linked: false });
  await run({ ...h, context: { repo, runId: 1 } });
  assert.deepEqual(h.writes.filter(write => write.type === 'status').map(write => write.state), ['pending', 'failure']);
  assert.equal(h.comments.length, 1);
  assert.match(h.comments[0].body, /Link an existing issue/);
  assert.match(h.comments[0].body, /@contributor/);
  assert.deepEqual(h.errors, []);
});

test('additional required branch rules are respected and setup preserves CI and CLA', async () => {
  const h = harness({ extraRequired: [{ context: 'Required review integration' }] });
  await run({ ...h, context: { repo, runId: 1 } });
  assert.equal(h.comments.length, 0);
  const ruleset = JSON.parse(await readFile(new URL('../.github/rulesets/cla-main.json', import.meta.url), 'utf8'));
  const required = ruleset.rules.find(rule => rule.type === 'required_status_checks').parameters.required_status_checks;
  assert.deepEqual(required.map(check => check.context).sort(), ['CLA / signature', 'Issue linked', 'test']);
  assert.ok(required.every(check => check.integration_id === 15368));
  assert.ok(h.writes.every(write => write.type === 'status'));
  assert.ok(COMMENT_MARKER.startsWith('<!--'));
});
