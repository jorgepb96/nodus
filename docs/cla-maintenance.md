# Maintaining the Nodus Research CLA

The public license remains AGPL-3.0-only. `CLA.md` provides additional licensing
permission from consenting contributors to Jorge Pérez Burgueño, without
transferring ownership. Issues and feature suggestions do not require acceptance.
Previously merged contributions require separate permission if their existing
license does not permit a proposed future use.

## How verification works

`.github/workflows/cla.yml` checks out only trusted default-branch files and runs
`scripts/cla.mjs`. It never runs code or installs dependencies from the PR. The
built-in `GITHUB_TOKEN` is sufficient; no personal token or external CLA service
is needed. Permissions are `contents: write`, `pull-requests: read`, and
`statuses: write`.

Every run scans open PRs and their comments with pagination. An exact, unedited
acceptance comment from a human GitHub account creates a public record on the
independent `cla-signatures` branch. Records include the stable account ID,
username, comment ID/URL/timestamp, originating PR, statement, and full agreement
with its SHA-256 digest. Records are created once and never overwritten. Later
comment deletion or account renaming does not lose recorded acceptance.

The maintainer username/link update in PR #1052 has one explicit compatibility
exception. The current v1 document (SHA-256
`28018d5b63a8adcded0dfde9323a88f3c5e8611460b9bc27f3f1c67013e48aca`)
also recognizes persisted signatures for the original v1 document (SHA-256
`68b2b9153b43fb63d3f8d7bee0156375d02005d3023dc73822994a0273fdbaf1`).
Only the GitHub handle and profile/repository links differ. Both the gate and
reminders validate the original record against the exact document actually
signed, including its account ID, statement and evidence. Records are neither
rewritten nor copied to the new digest. New signatures use the current document.
Any further document edit disables this exception; matching version numbers
alone never establish compatibility.

The check requires the PR author and every commit author/coauthor linked to a
human GitHub account to have accepted. A commit email that no GitHub account
claims cannot post an acceptance comment, so it is not checked individually; the
signing PR author stays accountable for those commits. Truncated author lists,
API errors, or storage failures block verification. No maintainer, collaborator,
or general bot allowlist exists. A changed PR head must be checked again. PRs
sharing a head SHA are evaluated together so one cannot overwrite another's
failure with success.

The required status is **CLA / signature**, published on the PR head SHA. It is
different from the workflow job named `verify`, which can complete successfully
while reporting a missing signature. Its **Details** link opens the workflow
summary, including the exact agreement and statement to post. No bot comments
are posted to PR discussions.

If a PR closes or merges during verification, the scan skips publishing its
result instead of failing the workflow. Its pending status does not grant
acceptance; reopening triggers a fresh check. Open PRs sharing its head SHA
still determine that SHA's final status using their own contributors.

Runs are serialized. Each run scans every open PR so concurrent acceptances are
found even if GitHub replaces a pending run, and signing on one PR unblocks other
covered PRs. New PRs, pushes to PR branches, reopening, closing, retargeting, new acceptance
comments, changes to the agreement/workflow on main, and manual dispatch recheck
the gate. `workflow_dispatch` also initializes checks for PRs already open when
the workflow is installed.

## AI attributions

AI-assisted contributions are welcome. The human PR author must accept the CLA
and take responsibility for the submission and their authority to grant rights.
All other human authors and coauthors linked to GitHub accounts must accept as
well.

Only these exact tool identity combinations are recognized (case-insensitive):

| Name | Commit email |
| --- | --- |
| `Claude`, or `Claude Opus`, `Claude Sonnet`, `Claude Haiku`, optionally followed by a numeric version such as `Claude Sonnet 5` | `noreply@anthropic.com` |
| `Codex` | `codex@openai.com` or `noreply@openai.com` |
| `copilot-swe-agent[bot]` | `198982749+Copilot@users.noreply.github.com`, linked to GitHub's `Copilot` account with stable node ID `BOT_kgDOC9w8XQ` |

GitHub exposes that Copilot account as a GraphQL `User` even though its stable
ID identifies a bot. Its commit attribution requires the exact account ID,
login, name and email above. A similar name or login on another account does
not qualify. Copilot cannot provide an acceptance signature or replace the
human PR author; every human author and coauthor remains subject to the gate.

These are tool attributions, not human signatures or proof of authorship. The
human PR author is always checked even if every commit is attributed to a tool.
Do not exempt an account based just on its name, a `[bot]` suffix, or a PR label.
Do not remove real human attribution to make a check pass. Extending the tool
identity list requires a reviewed change and a regression test. PRs opened by
automated accounts still require a human to submit the PR under their account.

## Enforce merging in GitHub

A workflow alone does not prevent merging. A repository ruleset must require
`CLA / signature` from the **GitHub Actions** integration (ID `15368`) on `main`.
Keep the ruleset active with an empty bypass list, so administrators are subject
to the rule too. Require a PR to update `main`; keep the existing review and CI
requirements if any. Avoid requiring the generic `verify` job instead.

The installation order is:

1. Land the CLA, documentation, script, and workflow on `main`.
2. Run `gh workflow run cla.yml --ref main` and inspect the statuses on existing PRs.
3. Add the active required-status/PR ruleset and verify it through the GitHub API.

The checked-in definitions are `.github/rulesets/cla-main.json` and
`.github/rulesets/cla-signatures.json`. These files document the intended rules;
GitHub does not apply them automatically. List existing repository rulesets before
creating one, and update the matching ruleset by ID instead of duplicating it.
When updating, preserve any additional protections installed separately.

Keep `cla-signatures` outside the required-PR/status ruleset so the workflow can
create acceptance records there. Preserve this branch and its history in backups.
Protect it against deletion and force pushes; normal workflow commits must remain
possible. Do not manually manufacture signatures or mark unsigned checks green.

The same workflow evaluates PRs into other branches, but merge blocking requires
adding each intended integration branch to the ruleset. Do not apply required-PR
rules to every development branch: that would prevent normal feature pushes.
The Website workflow refreshes download totals directly in each deployed
artifact instead of pushing generated cache commits to `main`, so it needs no
CLA bypass. The checked-in cache remains a fallback if the GitHub API fails.
Merge queues are not configured or supported by this workflow; add and test
`merge_group` handling before enabling a queue.

## Updating or recovering

- Treat a published agreement as immutable. For changed terms, increment its
  version; its content digest also changes, and contributors must accept again.
  Retain all old acceptance records. Even a wording-only change changes the digest.
  The pinned PR #1052 username/link exception above does not cover future edits.
- Use **Actions → Contributor License Agreement → Run workflow** to recheck open
  PRs. A missing signature is a normal failing status; an API or storage error
  also fails the workflow and needs investigation.
- A contributor who edited a comment before it was recorded should post a new
  exact acceptance comment. A maintainer cannot sign or edit one for them.
- A commit author whose email is not linked to a GitHub account is not checked
  individually; the signing PR author covers those commits. Associating the email
  with the account makes the author an explicitly checked contributor, who must
  then post the acceptance comment as well.
- Run `node --test scripts/test-cla.mjs scripts/test-cla-reminder.mjs scripts/test-agpl-release.mjs` after changes.
