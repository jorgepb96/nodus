# PR checks automation

`pr-checks.yml` verifies **Issue linked** and reports the completed checks for
each open PR. It runs on a standard Linux runner without dependencies, AI API
calls, additional artifacts, or paid bot services.

## Activation

1. Merge the workflow and `scripts/pr-checks.mjs` into the default branch. The
   push trigger checks existing PRs. Metadata events and retry commands
   intentionally execute only the trusted default-branch implementation.
2. Confirm that **Issue linked** appears on an open PR. In the existing default
   branch ruleset, add **Issue linked**, supplied by **GitHub Actions**, to the
   required status checks. Keep **test**, **CLA / signature**, and every other
   existing rule. `.github/rulesets/cla-main.json` documents the required contexts;
   changing this file alone does not update GitHub's live ruleset.
3. Run **PR checks** from Actions to reconcile existing PRs if needed. Do not
   require the new check before its trusted workflow is available: that would
   leave the implementation PR waiting for a check that cannot run yet.

## Linked issues

The check reads GitHub's actual linked issues, including links in Development
and supported closing keywords targeting the default branch. It does not accept
an arbitrary issue number, a nonexistent issue, or a reference to another PR.
GitHub's closing links can automatically close the issue when the PR merges.
PRs targeting other branches should use the Development link.

Metadata edits and new commits recheck the link. There is no scheduled scan:
idle PRs do not cause hourly runs. Sidebar linking/unlinking has no dedicated
Actions event; after changing a Development link, run **PR checks** manually or
comment `retry` as a maintainer to refresh it. All open PRs sharing a commit must
have an issue, since GitHub commit statuses are shared by SHA. Drafts are checked
too.

## Retries on PR activity

Editing a PR, reopening it, or marking it ready for review automatically retries
its latest failed **CI** run once per revision. Activity must come from the PR
author or a maintainer with write permission. This also supports fork authors
without giving them the maintainer-only manual command.

The automatic retry requires an already completed failure, cancellation, or
timeout on the current head. It does nothing while CI is pending or running,
when CI finished after the activity, or after any retry has already been used
for that revision. New commits run CI normally and get a fresh retry allowance.
Closing a PR, converting it to a draft, bot activity, ordinary comments, and
CI completion do not trigger retries.

## Manual retries

On an open, non-draft PR, a maintainer with **write**, **maintain**, or **admin**
repository permission can post exactly `retry`, `/retry`, or
`@github-actions retry` (case-insensitive). This restarts only the failed jobs
and their dependents in the latest **CI** pull-request run for the current
revision, then refreshes linked-issue verification and notifications. The bot's
failure comment includes these instructions. Ordinary comments and bot comments
are ignored. Permission is checked against GitHub at execution time.

Alternatively, choose **Actions → PR checks → Run workflow**. Leave
**Retry failed CI jobs** unchecked to refresh metadata only. To retry CI, enable
it and enter the **PR number**. Missing or invalid numbers never retry all PRs.

Successful jobs are retained by [GitHub's failed-jobs retry](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs#re-running-failed-jobs-in-a-workflow). A running or queued
CI run, an older revision, a superseded failure, and unrelated release, push,
manual, or privileged metadata workflows are never restarted. If the failure is
only **Issue linked**, the command just refreshes metadata. CLA acceptance and
external checks follow their own instructions; the command cannot approve fork
workflows or rerun external services. GitHub may refuse old or unavailable runs;
the Actions summary links to the affected CI run.

Completed checks refresh the report without retrying failing code again. There
is no automatic retry loop or time-based retry. CI completion triggers a fresh
report after a retry. Retry requests are serialized per PR, separately from the
shared metadata reconciliation queue, so activity on another PR cannot displace
a retry request.

## Completion and notifications

The bot waits for the current PR's CI workflow, its `test` gate, the CLA status,
the linked issue status, additional required contexts from branch rulesets, and
other observed PR workflows or external checks. It inspects both the head and
test-merge refs. Unrelated push, release, and manual workflows are excluded.
Skipped or neutral checks are accepted; cancelled, timed-out, and failed checks
are reported. A pending or missing required check prevents a success message.

`workflow_run` covers CI and CLA, including statuses written by their Actions
token. `check_run` and `status` cover external integrations. Missed events can
be reconciled with a manual run.
When adding an automatic PR workflow, add its workflow name to the
`workflow_run.workflows` list for prompt notifications after completion. Do not
subscribe PR checks to its own completion: that would cause a workflow loop.

The bot posts one failure comment per revision, updates its failure list when
needed, and posts a new comment for a failure/success transition. A new comment
ensures GitHub can deliver mention notifications; editing alone may not notify.
Repeated events and identical reruns stay quiet. On success the owner and author
are mentioned once each, including when they are the same account. Delivery
still follows each recipient's GitHub notification settings. Closed PRs and
drafts receive no new notification comments.

If checks start again, the previous result is marked historical until the
current checks finish. PR metadata, linked issues, and check versions are read
again before publishing a completed result. Old commits cannot produce a new
green notification. Success means ready for maintainer review and merge
consideration; the bot never merges or promises a merge.

## Failure logs and permissions

Each failed Actions job links to its full logs. Up to eight jobs contribute
excerpts from up to two failed steps each, limited to 30 lines and 1,800
characters per excerpt. The bot selects the error with surrounding context,
strips ANSI formatting, redacts common credential formats, and HTML-escapes
untrusted output. It never executes logs or artifacts. Deleted, expired, or
temporarily unavailable logs leave a useful link and do not prevent the alert.
Issue and CLA failures get direct resolution instructions instead of raw logs.

The workflow checks out only its script from the default branch with persisted
credentials disabled. Its token reads Actions/checks and repository metadata,
writes the linked issue commit status, and manages PR comments. Only the
retry job has Actions write permission; the reconciliation job retains Actions
read permission. Neither job can modify source, publish releases, or change
repository rules.

Run the focused checks locally with:

```sh
node --test scripts/test-pr-checks.mjs
```
