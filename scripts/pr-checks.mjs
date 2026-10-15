// SPDX-License-Identifier: AGPL-3.0-only
// Privileged metadata-only automation. Load exclusively from the default branch.
import { createHash } from 'node:crypto';

export const ISSUE_CONTEXT = 'Issue linked';
export const COMMENT_MARKER = '<!-- nodus-pr-checks:v1 ';
const REQUIRED = [ISSUE_CONTEXT, 'CLA / signature', 'test'];
const PASS = new Set(['success', 'neutral', 'skipped']);
const MAX_FAILURES = 20;
const MAX_LOGS = 8;
const MAX_LOG_CHARS = 1800;
const RETRYABLE = new Set(['failure', 'cancelled', 'timed_out']);
const ciWorkflow = run => run.path?.split('@')[0] === '.github/workflows/ci.yml';
const HISTORICAL = '\n\n**Checks are being re-evaluated. The result above is historical until the current checks finish.**';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const botComment = comment => comment.user?.type === 'Bot'
  && comment.user.login === 'github-actions[bot]' && comment.body?.startsWith(COMMENT_MARKER);
const plain = value => String(value ?? '').replace(/@/g, '@\u200b').replace(/[\r\n]/g, ' ')
  .replace(/[\\`*_[\]<>]/g, '\\$&').slice(0, 250);
const html = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const safeUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com'
      ? url.href.replace(/[()]/g, c => encodeURIComponent(c)) : null;
  } catch { return null; }
};
const linked = (label, url) => safeUrl(url) ? `[${plain(label)}](${safeUrl(url)})` : plain(label);
const identity = pr => JSON.stringify([pr.state, pr.draft, pr.head.sha, pr.base.sha, pr.base.ref, pr.body]);
const latestBy = (items, key) => {
  const result = new Map();
  for (const item of [...items].sort((a, b) => b.id - a.id)) {
    if (!result.has(key(item))) result.set(key(item), item);
  }
  return [...result.values()];
};

export async function issueLink(github, repo, pr) {
  const data = await github.graphql(`query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        headRefOid body state
        closingIssuesReferences(first: 1) { nodes { url } }
      }
    }
  }`, { ...repo, number: pr.number });
  const details = data.repository?.pullRequest;
  if (!details || details.state !== 'OPEN' || details.headRefOid !== pr.head.sha || (details.body ?? '') !== (pr.body ?? '')) {
    throw new Error('PR changed during issue verification; a fresh scan is required.');
  }
  return details.closingIssuesReferences.nodes.length > 0;
}

export async function verifyIssues({ github, repo, prs, runUrl, core }) {
  const outcomes = new Map();
  const groups = new Map();
  for (const pr of prs) {
    if (!groups.has(pr.head.sha)) groups.set(pr.head.sha, []);
    groups.get(pr.head.sha).push(pr);
  }
  for (const [sha, group] of groups) {
    const setStatus = (state, description) => github.rest.repos.createCommitStatus({
      ...repo, sha, context: ISSUE_CONTEXT, state, description, target_url: runUrl,
    });
    // Invalidate old green results before calling a fallible API. Statuses are
    // commit-scoped, so all open PRs sharing a SHA must satisfy the requirement.
    await setStatus('pending', 'Checking linked issues for every open PR with this commit.');
    for (const pr of group) {
      try {
        outcomes.set(pr.number, { linked: await issueLink(github, repo, pr) });
      } catch (error) {
        outcomes.set(pr.number, { error: true });
        core.warning(`Issue verification for PR #${pr.number}: ${error.message}`);
      }
    }
    const values = group.map(pr => outcomes.get(pr.number));
    const state = values.some(value => value.error) ? 'error'
      : values.every(value => value.linked) ? 'success' : 'failure';
    const description = state === 'success' ? 'Every open PR with this commit has a linked issue.'
      : state === 'error' ? 'Issue verification could not complete. See Details or rerun PR checks.'
        : 'Link an existing issue in Development or use Closes #123 in the PR description.';
    await setStatus(state, description);
    if (state === 'error') core.setFailed('Linked issue verification could not complete. See warnings and rerun PR checks.');
  }
  return outcomes;
}

export function belongsToPr(run, pr) {
  if (run.event !== 'pull_request' || run.head_sha !== pr.head.sha) return false;
  if (run.pull_requests?.length) return run.pull_requests.some(item => item.number === pr.number);
  // GitHub can omit pull_requests for forks. SHA alone would confuse PRs that
  // happen to share a commit, so require the source repository and branch too.
  return run.head_repository?.full_name === pr.head.repo?.full_name && run.head_branch === pr.head.ref;
}

export async function retryFailedCi({ github, context, core }) {
  const { repo, payload, eventName } = context;
  const comment = eventName === 'issue_comment' ? payload.comment : null;
  const activity = eventName === 'pull_request_target' && payload.sender?.type === 'User'
    && ['edited', 'reopened', 'ready_for_review'].includes(payload.action) ? payload.pull_request : null;
  const manual = eventName === 'workflow_dispatch'
    && [true, 'true'].includes(payload.inputs?.retry_failed);
  if (!manual && !activity && !(comment?.user?.type === 'User' && payload.action === 'created'
    && payload.issue?.pull_request && /^(?:\/?retry|@github-actions retry)$/i.test(comment.body))) return;

  const finish = async message => core.summary.addRaw(message).write();
  const number = String(comment ? payload.issue.number : activity?.number ?? payload.inputs?.pr_number ?? '');
  if (!/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number))) {
    core.setFailed('Enter a PR number when requesting a retry.');
    return finish('No CI jobs retried: a valid PR number is required.');
  }
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: Number(number) });
  if (pr.state !== 'open' || pr.draft) return finish(`PR #${pr.number}: no retry for a closed or draft PR.`);
  const actor = comment?.user.login ?? context.actor;
  // Explicit commands match GitHub's native rerun permission. Activity by the
  // PR's own author may also request the single automatic retry, including forks.
  if (!activity || actor.toLowerCase() !== pr.user.login.toLowerCase()) {
    const { data: access } = await github.rest.repos.getCollaboratorPermissionLevel({
      ...repo, username: actor,
    });
    if (!['write', 'maintain', 'admin'].includes(access.permission)) {
      return finish('No CI jobs retried: repository write permission is required.');
    }
  }
  if (activity && activity.head.sha !== pr.head.sha) {
    return finish(`PR #${pr.number}: activity was for an older revision; no CI jobs retried.`);
  }
  core.setOutput('accepted', 'true');
  // Only CI's latest pull_request run on the current head can be retried. A
  // privileged metadata, push, release or manual workflow is never a candidate.
  const runs = (await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
    ...repo, head_sha: pr.head.sha, event: 'pull_request', per_page: 100,
  })).filter(item => belongsToPr(item, pr) && ciWorkflow(item)).sort((a, b) => b.id - a.id);
  const candidate = runs[0];
  if (!candidate || candidate.status !== 'completed' || !RETRYABLE.has(candidate.conclusion)) {
    return finish(`PR #${pr.number}: no completed failed CI run to retry; refreshing metadata checks.`);
  }
  if (activity && (runs.some(item => item.run_attempt > 1)
    || candidate.run_attempt !== 1 || Date.parse(candidate.updated_at) > Date.parse(activity.updated_at))) {
    return finish(`PR #${pr.number}: automatic retry already used, or CI finished after the activity; refreshing metadata checks.`);
  }
  // A queued or redelivered comment must not retry an attempt which started
  // after that command was posted, even if it has already failed again.
  if (comment && candidate.run_attempt > 1 && Date.parse(candidate.updated_at) > Date.parse(comment.created_at)) {
    return finish(`PR #${pr.number}: CI has already been retried since this command; refreshing metadata checks.`);
  }
  const { data: currentPr } = await github.rest.pulls.get({ ...repo, pull_number: pr.number });
  const { data: currentRun } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: candidate.id });
  if (identity(currentPr) !== identity(pr) || currentPr.merge_commit_sha !== pr.merge_commit_sha
    || !belongsToPr(currentRun, currentPr) || !ciWorkflow(currentRun)
    || currentRun.run_attempt !== candidate.run_attempt || currentRun.status !== 'completed'
    || !RETRYABLE.has(currentRun.conclusion)) {
    return finish(`PR #${pr.number}: PR or CI changed while preparing the retry; no stale run restarted.`);
  }
  try {
    await github.rest.actions.reRunWorkflowFailedJobs({ ...repo, run_id: candidate.id });
    return finish(`PR #${pr.number}: requested failed CI jobs and their dependents for ${linked('CI', candidate.html_url)}.`);
  } catch (error) {
    core.warning(`CI retry for PR #${pr.number}: ${error.message}`);
    core.setFailed('CI could not be retried. Inspect the run in Actions; it may be running, awaiting approval, or too old to rerun.');
    return finish(`PR #${pr.number}: CI retry was not accepted; inspect ${linked('CI', candidate.html_url)}.`);
  }
}

export async function collectChecks({ github, repo, pr, required = REQUIRED }) {
  const runs = latestBy((await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
    ...repo, head_sha: pr.head.sha, event: 'pull_request', per_page: 100,
  })).filter(run => belongsToPr(run, pr)), run => run.workflow_id);
  const checks = [];
  const versions = [];
  for (const run of runs) {
    versions.push(['run', run.id, run.run_attempt, run.status, run.conclusion]);
    if (run.status !== 'completed') {
      checks.push({ name: run.name, state: 'pending', url: run.html_url });
      continue;
    }
    // Include successful jobs retained from previous attempts when only failed
    // jobs were rerun. A newer execution of the same job replaces its old one.
    const jobs = latestBy(await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
      ...repo, run_id: run.id, filter: 'all', per_page: 100,
    }), job => job.name);
    for (const job of jobs) {
      checks.push({ name: job.name, label: `${run.name} / ${job.name}`,
        state: job.status === 'completed' ? job.conclusion : 'pending',
        url: job.html_url, job, run });
    }
    if (!PASS.has(run.conclusion) && !jobs.some(job => job.status === 'completed' && !PASS.has(job.conclusion))) {
      checks.push({ name: run.name, state: run.conclusion ?? 'failure', url: run.html_url });
    }
  }
  // CI must exist even if no checks have been published yet (fork approval,
  // queue delay, or a workflow startup failure). No empty-set green messages.
  const ci = runs.find(ciWorkflow);
  if (!ci) {
    checks.push({ name: 'CI', state: 'pending' });
  }
  const statuses = new Map();
  const external = new Map();
  for (const ref of new Set([pr.head.sha, pr.merge_commit_sha].filter(Boolean))) {
    const commits = await github.paginate(github.rest.repos.listCommitStatusesForRef, { ...repo, ref, per_page: 100 });
    for (const status of latestBy(commits, item => item.context)) {
      // The metadata checks deliberately publish on the PR head, never on the
      // synthetic test-merge commit. Other contexts follow GitHub's merge ref.
      if (ref !== pr.head.sha && [ISSUE_CONTEXT, 'CLA / signature'].includes(status.context)) continue;
      statuses.set(status.context, { name: status.context, state: status.state, url: status.target_url,
        description: status.description, id: status.id });
    }
    const items = await github.paginate(github.rest.checks.listForRef, { ...repo, ref, filter: 'latest', per_page: 100 });
    for (const check of items) {
      // Actions jobs above come from the exact PR run, not unrelated push or
      // release workflows on the same SHA. External integrations use checks.
      if (check.app?.slug === 'github-actions') continue;
      external.set(`${check.app?.id}:${check.name}`, { name: check.name,
        state: check.status === 'completed' ? check.conclusion : 'pending', url: check.html_url,
        id: check.id, description: check.output?.title });
    }
  }
  checks.push(...statuses.values(), ...external.values());
  for (const name of required) {
    const exists = [ISSUE_CONTEXT, 'CLA / signature'].includes(name) ? statuses.has(name)
      : name === 'test' ? checks.some(check => check.name === name && check.run?.id === ci?.id)
        : checks.some(check => check.name === name);
    if (!exists) checks.push({ name, state: name === 'test' && ci?.status === 'completed' && !PASS.has(ci.conclusion)
      ? 'failure' : 'pending', url: ci?.html_url });
  }
  const pending = checks.some(check => !check.state || check.state === 'pending');
  const failures = checks.filter(check => check.state && check.state !== 'pending' && !PASS.has(check.state));
  const fingerprint = digest(failures.map(check => [check.label ?? check.name, check.state, check.description]).sort());
  return { pending, failures, checks, fingerprint,
    logVersion: digest(failures.map(check => [check.job?.id, check.run?.run_attempt, check.url])),
    // IDs and attempts protect publication against concurrent reruns. The
    // user-visible fingerprint excludes them to avoid duplicate notifications.
    version: digest([versions, checks.map(check => [check.name, check.state, check.id, check.job?.id])]) };
}

export function logExcerpt(raw, step) {
  let lines = String(raw).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/);
  if (step?.started_at && step?.completed_at) {
    const start = Date.parse(step.started_at);
    const end = Date.parse(step.completed_at) + 1000;
    const selected = lines.filter(line => {
      const time = Date.parse(line.split(' ')[0]);
      return time >= start && time < end;
    });
    if (selected.length) lines = selected;
  }
  lines = lines.map(line => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s*/, ''));
  let command = false;
  lines = lines.filter(line => {
    // Runner command groups echo source code and environment variables before
    // executing a step. They are not diagnostics and may themselves say Error.
    if (/^##\[group\]Run /.test(line)) { command = true; return false; }
    if (command && /^##\[endgroup\]/.test(line)) { command = false; return false; }
    return !command;
  });
  // Prefer the actual error and surrounding context to the final generic
  // "Process completed with exit code 1" line. Logs remain untrusted text.
  const anchor = lines.findIndex(line => /\b(?:error|exception|assertion(?:error)?)\b|^\s*(?:not ok\b|FAIL(?:ED)?(?:\s|:)|✖)/i.test(line)
    && !/Process completed with exit code|\b0 errors?\b|::(?:group|endgroup)::/i.test(line));
  const start = anchor < 0 ? Math.max(0, lines.length - 30) : Math.max(0, anchor - 5);
  let text = lines.slice(start, start + 30).join('\n').trim();
  text = text.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]')
    .replace(/(\b(?:authorization|[\w-]*token|api[_-]?key|password|secret)\b\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]');
  return text.length > MAX_LOG_CHARS ? `${text.slice(0, MAX_LOG_CHARS)}\n[Excerpt truncated; see full logs.]` : text;
}

export async function failureDetails({ github, repo, report, issue, core }) {
  const excerpts = new Map();
  let downloads = 0;
  for (const check of report.failures.slice(0, MAX_FAILURES)) {
    if (!check.job || downloads >= MAX_LOGS) continue;
    const steps = check.job.steps?.filter(step => step.status === 'completed' && !PASS.has(step.conclusion)) ?? [];
    if (!steps.length) continue;
    downloads++;
    try {
      const { data } = await github.rest.actions.downloadJobLogsForWorkflowRun({ ...repo, job_id: check.job.id });
      const raw = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
      excerpts.set(check.job.id, steps.slice(0, 2).map(step => ({ name: step.name, text: logExcerpt(raw, step) })));
    } catch {
      core.warning(`Logs for job ${check.job.id} are unavailable; the comment will link to the full job.`);
    }
  }
  return report.failures.slice(0, MAX_FAILURES).map(check => {
    let body = `- **${linked(check.label ?? check.name, check.url)}** — ${plain(check.state)}.`;
    if (check.name === ISSUE_CONTEXT) {
      body += issue.error ? ' Issue verification could not complete. Rerun PR checks.'
        : issue.linked ? ' Another open PR sharing this commit has no linked issue; check the status details.'
          : ' Link an existing issue from **Development**, or add `Closes #123` / `Fixes #123` to the description when targeting the default branch.';
    } else if (check.name === 'CLA / signature') {
      body += ' Open the check details and follow the CLA acceptance instructions.';
    } else if (['cancelled', 'timed_out', 'stale', 'action_required'].includes(check.state)) {
      body += ' Inspect the run details; a rerun or maintainer action may be needed.';
    }
    for (const excerpt of excerpts.get(check.job?.id) ?? []) {
      body += `\n\n<details>\n<summary>Failed step: ${html(excerpt.name.replace(/@/g, '@\u200b').slice(0, 200))}</summary>\n\n<pre>${html(excerpt.text || 'No log excerpt is available. Open the full job logs.')}</pre>\n</details>\n`;
    }
    return body;
  }).join('\n\n') + (report.failures.length > MAX_FAILURES ? '\n\nAdditional failures are listed in the PR checks tab.' : '');
}

export function commentBody({ pr, report, details = '', owner }) {
  const kind = report.failures.length ? 'failure' : 'success';
  const marker = `${COMMENT_MARKER}${JSON.stringify({ sha: pr.head.sha, kind, format: 2,
    fingerprint: report.fingerprint, logVersion: report.logVersion })} -->`;
  const revision = `Latest revision: \`${pr.head.sha.slice(0, 12)}\`.`;
  if (kind === 'failure') return `${marker}\n@${pr.user.login}, the following checks have failed:\n\n${details}\n\n`
    + 'Please resolve the reported failures so that all required checks pass. A maintainer with repository write access can comment `retry` or `/retry` to rerun failed CI jobs for the current revision and refresh Issue linked. '
    + 'Editing, reopening, or marking the PR ready for review can retry failed CI once per revision. '
    + 'External checks and CLA acceptance need the resolution described above. New commits run CI automatically.\n\n' + revision;
  const mentions = [...new Set([owner.toLowerCase(), pr.user.login.toLowerCase()])].map(login => `@${login}`).join(' ');
  return `${marker}\n${mentions}, all required checks have passed for the latest revision of this PR. `
    + 'It is ready for maintainer review and merge consideration.\n\n' + revision;
}

export async function syncComment({ github, repo, pr, report, issue, core, required }) {
  if (pr.draft || pr.state !== 'open') return 'skipped';
  const comments = await github.paginate(github.rest.issues.listComments, { ...repo, issue_number: pr.number, per_page: 100 });
  const previous = comments.filter(botComment).sort((a, b) => b.id - a.id)[0];
  let previousState;
  try { previousState = JSON.parse(previous?.body.slice(COMMENT_MARKER.length).split(' -->')[0]); } catch { /* No valid managed comment. */ }
  if (report.pending) {
    if (previous && !previous.body.endsWith(HISTORICAL)) {
      await github.rest.issues.updateComment({ ...repo, comment_id: previous.id,
        body: previous.body + HISTORICAL });
    }
    return 'pending';
  }
  const kind = report.failures.length ? 'failure' : 'success';
  if (previousState?.sha === pr.head.sha && previousState.kind === kind && previousState.fingerprint === report.fingerprint
    && previousState.format === 2 && previousState.logVersion === report.logVersion
    && !previous.body.endsWith(HISTORICAL)) return 'unchanged';
  const details = report.failures.length ? await failureDetails({ github, repo, report, issue, core }) : '';
  const body = commentBody({ pr, report, details, owner: repo.owner });
  // Log downloads can take time. Re-read both metadata and checks immediately
  // before publishing to avoid announcing an old commit, closed PR, or rerun.
  const { data: current } = await github.rest.pulls.get({ ...repo, pull_number: pr.number });
  if (identity(current) !== identity(pr)) return 'changed';
  if (!issue.error && await issueLink(github, repo, current) !== issue.linked) return 'changed';
  const fresh = await collectChecks({ github, repo, pr: current, required });
  if (fresh.pending || fresh.version !== report.version) return 'changed';
  if (previousState?.sha === pr.head.sha && previousState.kind === kind) {
    await github.rest.issues.updateComment({ ...repo, comment_id: previous.id, body });
    return 'updated';
  }
  // New comments on state transitions deliver real mention notifications;
  // editing a single permanent comment would not reliably notify recipients.
  await github.rest.issues.createComment({ ...repo, issue_number: pr.number, body });
  return 'created';
}

export async function run({ github, context, core }) {
  const repo = context.repo;
  const runUrl = `https://github.com/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`;
  const prs = await github.paginate(github.rest.pulls.list, { ...repo, state: 'open', per_page: 100 });
  const outcomes = await verifyIssues({ github, repo, prs, runUrl, core });
  const rules = new Map();
  const summary = [];
  for (const pr of prs) {
    try {
      if (!rules.has(pr.base.ref)) {
        const { data } = await github.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', { ...repo, branch: pr.base.ref });
        rules.set(pr.base.ref, [...new Set([...REQUIRED, ...data.filter(rule => rule.type === 'required_status_checks')
          .flatMap(rule => rule.parameters.required_status_checks.map(check => check.context))])]);
      }
      const required = rules.get(pr.base.ref);
      const report = await collectChecks({ github, repo, pr, required });
      const result = await syncComment({ github, repo, pr, report, issue: outcomes.get(pr.number), core, required });
      summary.push(`PR #${pr.number}: issue ${outcomes.get(pr.number).linked ? 'linked' : 'not verified'}; notification ${result}.`);
    } catch (error) {
      core.warning(`PR #${pr.number} could not be reconciled: ${error.message}`);
      summary.push(`PR #${pr.number}: reconciliation failed; no completed result announced.`);
      core.setFailed('Some PR checks could not be reconciled. See warnings and rerun this workflow.');
    }
  }
  await core.summary.addRaw(summary.join('\n\n') || 'No open pull requests.').write();
}
