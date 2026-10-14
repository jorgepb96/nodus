# PR checks automation

`pr-checks.yml` verifies **Issue linked** and reports the completed checks for
each open PR. It runs on a standard Linux runner without dependencies, AI API
calls, additional artifacts, or paid bot services.

## Activation

1. Merge the workflow and `scripts/pr-checks.mjs` into the default branch. The
   push trigger checks existing PRs. `pull_request_target` and `workflow_run`
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

Metadata edits and new commits recheck the link. Sidebar linking/unlinking has no
dedicated Actions event; an hourly reconciliation and manual workflow entry
cover these changes. All open PRs sharing a commit must have an issue, since
GitHub commit statuses are shared by SHA. Drafts are checked too.

## Completion and notifications

The bot waits for the current PR's CI workflow, its `test` gate, the CLA status,
the linked issue status, additional required contexts from branch rulesets, and
other observed PR workflows or external checks. It inspects both the head and
test-merge refs. Unrelated push, release, and manual workflows are excluded.
Skipped or neutral checks are accepted; cancelled, timed-out, and failed checks
are reported. A pending or missing required check prevents a success message.

`workflow_run` covers CI and CLA, including statuses written by their Actions
token. `check_run`, `status`, and the hourly scan cover external integrations.
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
writes the linked issue commit status, and manages PR comments. It cannot modify
source, publish releases, or change repository rules. Standard runners are free
for public repositories under GitHub's current Actions terms.

Run the focused checks locally with:

```sh
node --test scripts/test-pr-checks.mjs
```
