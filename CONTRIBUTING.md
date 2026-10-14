# Contributing to Nodus

Thank you for helping improve Nodus. Contributions may include bug reports,
feature proposals, product feedback, documentation, translations, tests, and
code.

By participating, you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Language

All issues and pull requests must be written in English, including titles,
descriptions, comments, and review discussion.

## Before opening an issue

Search the existing issues first. If a matching issue exists, add useful context
there instead of creating a duplicate.

Choose the path that best matches your contribution:

- **Bug report** for reproducible failures or incorrect behavior
- **Feature request** for a new capability or improvement
- **New vault type** for a specialized workspace proposal
- **Product feedback** belongs in the permanent
  [shared feedback thread](https://github.com/jorgepb96/nodus/issues/272);
  add a comment there instead of opening a new issue

The desktop app exposes the same four paths under **Suggest / Report**. Bug
reports, feature requests, and vault proposals open new issues. Product feedback
is copied and added as a comment to the shared thread. All four app flows include
the Nodus version and operating-system details automatically. If you report
directly on GitHub, include that environment information yourself when relevant.

Never include API keys, passwords, private vault content, student data, personal
data, unpublished research, or confidential documents in a public issue.
Security vulnerabilities must be reported privately as described in
[SECURITY.md](SECURITY.md).

## Development setup

Nodus uses Node.js 22 in continuous integration.

1. Fork and clone the repository.
2. Install the locked dependencies:

   ```bash
   npm ci
   ```

3. Rebuild native Electron dependencies:

   ```bash
   npx electron-builder install-app-deps
   ```

4. Start the development app:

   ```bash
   npm run dev
   ```

Use a throwaway vault or demo data while developing. Do not test with real
personal, student, research, or institutional data.

## Quality checks

Run the checks that cover your change:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Changes that affect Electron startup, IPC, the database, packaging, or a major
user flow should also run:

```bash
npm run test:e2e
```

The full end-to-end suite launches the real desktop app and is most reliable on
macOS, which is also the platform used by the main CI job.

CI compiles the current commit once on Linux, runs the complete test inventory across six
isolated Linux groups, and runs all five real-app E2E checks across three parallel groups.
Lint and TypeScript run alongside the build and remain required. The final
`test` check verifies complete execution as well as successful capability checks
on Linux, macOS and Windows. See [CI execution and measurement](docs/ci-performance.md)
for the inventory reports, cache behavior, and performance validation procedure.

## Publishing releases

Stable and Beta are separate GitHub Actions entry points backed by the shared
`release-build.yml` implementation:

- **Stable release** accepts only a package version and tag in the form `x.y.z`
  and `vX.Y.Z`. It publishes the existing `latest*.yml` updater manifests,
  installers, and stable Zotero plugin assets, then marks the release as latest.
- **Beta release** accepts only `x.y.z-beta.n` and `vX.Y.Z-beta.N`. It publishes
  `beta*.yml` plus the matching installers, marks the release as a prerelease,
  and never uploads a stable updater manifest.

Pushing a matching tag starts the corresponding workflow. Both workflows can
also be run manually by supplying the exact tag. The channel/version validator
stops a stable tag from entering Beta or a beta tag from entering Stable before
any native build begins.

Full CI and platform packaging run in parallel. Linux prepares one verified app
on Ubuntu 22.04, then generates DEB, RPM and AppImage on isolated runners in
parallel. Publication requires all primary platforms, their updater manifests,
full CI and, for Stable, the Zotero plugin. Intel starts in a separate workflow
after publication and appends its signed assets later. See
[Release execution and measurement](docs/release-performance.md) for installer
validation and timing definitions.

Linux AppImages support both the built-in Electron updater and external
AppImageUpdate tools. See [AppImage update compatibility](docs/appimage-updates.md)
for the finalization sequence, preserved download aliases and Linux checks.

Desktop updates download automatically, but installation and restart require
the explicit **Install and restart** action on every supported platform. An
ordinary app quit never installs a pending update. The downloaded update remains
accessible from Settings after choosing **Later**. The banner below the header
reappears during backup and installation, including when installation starts
from Settings after postponing the update. On launch, the banner shows the update
check, available version, and download progress
without blocking the workspace. It disappears when no update is available; an
initial check or download error is shown briefly and dismissed after five seconds.
Subsequent checks and downloads stay silent until an update is ready to install.
Settings reads the current main-process status when reopened instead of waiting
for another event.

The following screenshots show the shared banner in an isolated UI fixture with
synthetic update events:

![Update download progress](docs/images/update-banner-downloading.png)

![Update ready to install](docs/images/update-banner-ready.png)

Before installing a Beta build, the desktop app requires Recovery to be
configured and commits a full encrypted, verified `nodus-pre-update-*` snapshot.
The snapshot records the installed app/schema version and the target version in
its filename, has an independent five-snapshot retention lineage, and is never
removed by scheduled-backup pruning. A failed snapshot blocks only Beta. Stable
updates take the same snapshot when Recovery is already configured, but preserve
the established non-blocking stable update behavior if that optional snapshot
cannot be written.

Age-based backup cleanup is a separate, disabled-by-default opt-in in Settings.
It uses the automatic-backup schedule and catches up after the next launch when
a scheduled cleanup was missed. Before changing any file, Nodus verifies the
newest surviving encrypted backup. It considers only strict regular-backup names
for the current computer, always preserves the three newest regular backups, and
never includes another computer's lineage or `nodus-pre-update-*` snapshots.
Candidates first move atomically to `.nodus-cleanup-trash`; permanent deletion is
allowed only after a seven-day grace period and another successful survivor
verification. Manual confirmations carry an opaque fingerprint of the exact files
shown in the preview, so any intervening folder change aborts the operation. A
partial move is rolled back, and a failed due backup suppresses cleanup for that
maintenance cycle. When this opt-in is disabled, the established stable GFS
rotation remains unchanged.

## Project conventions

- Keep Nodus local-first. New network access must be explicit, documented, and
  initiated by the user.
- Preserve privacy boundaries. Do not send private content, student work,
  rosters, grades, or credentials to AI providers.
- Nodus must not use AI to grade, rank, profile, or evaluate students.
- Keep claims connected to real sources. Do not fabricate citations or silently
  replace user evidence.
- Add focused tests for behavior changes and regression fixes.
- Reuse established components and patterns before introducing a parallel
  implementation.
- Do not commit build outputs, release artifacts, `node_modules`, temporary
  profiles, credentials, or real user data.

### User-interface text

Spanish is the source language for the desktop interface. Every new static UI
string must also be added to all translation tables under `src/i18n.*.ts`.
Run the internationalization coverage tests before submitting the change.

### Database and privacy changes

Database migrations must be additive, deterministic, and safe for existing
vaults. Changes that affect stored data, backups, synchronization, telemetry,
network requests, AI providers, or student information must include appropriate
privacy documentation and tests.

Once a migration has shipped in a Beta, do not renumber, rewrite, or replace it
for Stable. Stable must carry that exact forward migration (plus later migrations
if needed); fixes belong in a new migration. Never rely on an application
downgrade or automatic data rollback as a migration strategy.

## Pull requests

Every pull request must address an existing issue. Open or find the issue first
and link it from **Development**, or use `Closes #123` / `Fixes #123` in the PR
description when targeting the default branch. A plain `#123` mention does not
create a linked issue. The required **Issue linked** check blocks merging until
the link exists. Sidebar changes are reconciled hourly; maintainers can run
**PR checks** manually to refresh the result immediately.

Keep each pull request focused on one coherent change. In the pull request:

- Explain the problem and the chosen solution.
- Reference the issue it addresses with `Closes #123` when the pull request
  should close it.
- List the checks you ran.
- Attach screenshots whenever possible: before-and-after images for visible UI
  changes and reproduction evidence for bug fixes.
- Call out migrations, privacy effects, network access, or compatibility risks.
- Update documentation and translations when behavior changes.

All required CI checks, including **Issue linked** and **CLA / signature**, must
pass. Every human author and coauthor must accept the [Contributor License Agreement](CLA.md)
before a pull request can be merged. Maintainers may ask for a smaller scope,
additional tests, or changes needed to preserve the project's privacy and
evidence standards.

After the checks for the current revision finish, the bot mentions the author
with the failing checks, links, and short log excerpts where available. It
updates repeated failures for that revision instead of posting duplicates.
When every applicable check passes, it mentions the repository owner and author
once each. This means the PR is ready for maintainer review and merge
consideration; it does not promise or perform a merge. Drafts receive the issue
check but no notification comments.

Maintainer setup and operation: [PR checks automation](docs/pr-checks.md).

## Licensing

The public project uses the [GNU Affero General Public License v3.0](LICENSE),
SPDX `AGPL-3.0-only`. Contributions also require explicit acceptance of the
[Nodus Research Contributor License Agreement](CLA.md). You retain ownership
and grant the maintainer permission to sublicense and relicense your Contribution,
including under different open-source, source-available, or commercial terms.
You must have the authority to grant these rights and preserve all applicable
third-party notices. Previously merged contributions are not automatically
covered. Published Nodus releases through 3.2.7 retain their MIT license.

### Accepting the CLA

1. Read [CLA.md](CLA.md).
2. Open **CLA / signature → Details** in your pull request's checks.
3. Copy the exact acceptance statement, including the document digest, from the
   workflow summary and post it as a **new comment from your own GitHub account**
   on the pull request. Do not edit an existing comment to sign.
4. The workflow records the acceptance and rechecks open pull requests. You only
   need to accept once for this exact agreement. Every other author and coauthor
   must do the same; a maintainer cannot accept on another person's behalf.

The check includes the pull request author and all commit authors and coauthors.
Use commit email addresses associated with the correct GitHub accounts. Missing
account mappings, incomplete contributor data, and unsigned accounts block the
check. Maintainers must accept too. AI-assisted contributions are welcome: the
person submitting them must review them, accept the CLA, and have the authority
to grant the required rights. Recognized Claude/Codex/Copilot tool attributions do not
need a separate signature; they never exempt the responsible human or another
human coauthor. Unrecognized or misattributed identities must be corrected;
never remove a real author's attribution to avoid obtaining their acceptance.
See the exact recognized tool identities in
[the maintenance guide](docs/cla-maintenance.md#ai-attributions).

Acceptance records are public on the `cla-signatures` branch. They contain the
account identifier, username, statement, comment link and timestamp, originating
PR, and exact agreement. Do not post private identity or contact information.
Checking a box in the PR template does not replace acceptance.

Maintainer setup and recovery are documented in
[docs/cla-maintenance.md](docs/cla-maintenance.md).
