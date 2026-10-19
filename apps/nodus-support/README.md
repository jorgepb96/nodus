# Nodus Support

Independent Electron + React support application in the Nodus repository. Its S mark uses the Nodus node style and `#C7C21C`; the main Nodus N mark is unchanged. SVG geometry lives in `shared/support/mark.svg`; `node scripts/generate-support-icons.mjs` produces PNG, ICO and ICNS assets for every platform.

## Current delivery and safety gate

This implementation is **not yet qualified for public repair use**. Inspection, direct log reading, verified protection, retained sessions, isolated diagnostic workers and reviewed reports are implemented. The interface explicitly displays this state. `qualified-repairs.json` is deliberately empty: opening the full Nodus application on a copied profile, activating solutions, restoring archives and reinstalling are blocked in the main process until their native safety matrix passes. The release publisher enforces the same gate.

Do not fill that catalog merely to produce installers. Unknown problems must produce a report. In particular, this release does not certify repairs for AI providers, model downloads, synchronization, individual tools, drivers, antivirus or operating-system components. The runtime worker's canvas check proves that Electron can start and draw; it does **not** prove the normal Nodus application or an affected tool works.

## Development

Use the repository lockfile and Node 22:

```sh
npm ci
npm run support:dev
npm run support:typecheck
npm run support:test
NODUS_SUPPORT_LARGE_FILES=1 npm run support:test
node scripts/verify-nodus-support-ui.mjs
node scripts/build-nodus-support.mjs --runtime
node scripts/verify-nodus-support-runtime.mjs
npm run support:dist
```

The large-file environment assignment above is POSIX syntax; on PowerShell use `$env:NODUS_SUPPORT_LARGE_FILES = '1'`. The native early-bootstrap check additionally requires a current `npx vite build`, then `node scripts/verify-nodus-support-protocol.mjs`.

`support:build` bundles a separate main process, preload and UI in `build/support-app`. It imports no normal Nodus bootstrap, database, provider or engine. Electron is the same version as Nodus but has its own executable and runtime. Production Node dependencies are excluded from this package because its few JavaScript dependencies are bundled. `verify-nodus-support-runtime.mjs` checks the actual ASAR and launches the packaged executable against a synthetic profile.

`support:dist` creates Windows x64 NSIS and portable executables, macOS arm64 or x64 DMG/ZIP, and Linux x64 AppImage/DEB/RPM on the corresponding native build host. `build/supportRuntime.cjs` includes the complete independent executable inside the normal Nodus resources; Settings → Help launches it; the Windows installer also creates a separate Start Menu shortcut. macOS signing/notarization is required in release mode. Installed Nodus must have protocol 1 metadata for active diagnostics; previous releases remain available for inspection, protection and logs.

## Data boundary

- Sources are opened for reading by the assistant. It never opens original SQLite files through SQLite. The inventory includes the profile, registered external vault files and their WAL/SHM files, and the configured global library. Encrypted credential blobs are copied as bytes, never put in a report.
- Invalid preferences, missing registered sources, links/junctions, locked files, insufficient space, running Nodus or overlapping source/protection locations stop protection. Unrecognized external storage layouts are not certified for interactive repair.
- Every protection has a SHA-256 manifest, byte counts, private permissions and verification of the complete file set. Protection uses persistent storage separate from the source profile. It reserves space for protection, trials and recovery; it never prunes older sessions.
- The worker receives a new profile or verified copy. Registered external vault paths and the global library path are remapped into that profile, including adjacent WAL/SHM files. No normal application import occurs in the early worker bootstrap. Network requests in its renderer are denied.
- Journals use fsynced prepared records and exclusive hard links. Interrupted prepared records are retained, and incomplete records cannot become committed transitions. A damaged committed journal fails closed. No failed trial, partial copy or previous state is removed automatically.
- Original files must still match their verified inventory before selecting a recovered workspace. Fresh empty diagnostic profiles cannot become the main profile. Undo detects new work in a recovery workspace and offers keeping that workspace or selecting the previous one after creating and verifying another copy of the recent edits. Successive recovery selections resolve to the latest workspace; undo must follow reverse order. Both versions remain available.
- Binary replacement stages and preserves the old installation; it never runs an uninstall first. macOS bundle renames and AppImage replacements are journaled. Rollback retains the attempted installation. Privileged package-manager installation and Windows NSIS recovery still need native failure-injection tests before qualification.

Support uses a deliberately limited IPC API with sender validation, context isolation, sandboxed UI, a local custom protocol, restrictive CSP, no shell-command API and no general filesystem API. See [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).

## Reports and privacy

Existing logs are read directly; the Nodus retention module is never initialized. The default is 50 errors, with 20, 100, all available errors and date filters. Parsing is bounded to 32 MiB per log; complete originals remain available through the separate local export.

Recommended ZIPs contain reviewed English Markdown, allowlisted technical diagnostics, classified errors and a manifest of the exported files. They omit documents, databases, credentials, paths and arbitrary log messages. Error names outside the known catalog become `UNCLASSIFIED_ERROR`. The user can edit the Markdown and must review it before copying, exporting or opening an issue. Automatic filtering is not a promise of anonymity, especially after manual edits.

Original logs require a separate native confirmation and export. They are never attached to GitHub automatically. Issue creation uses the existing bug form and [GitHub URL parameters](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue), caps the encoded URL at 2,000 characters, and uses a short summary plus a reviewed clipboard copy when needed. The user submits the issue and attaches files in their browser. No GitHub authentication is stored.

## Release setup and remaining qualification

`trusted-release-keys.json` pins the dedicated Ed25519 manifest key `nodus-support-2026-01`. The corresponding repository secrets `NODUS_SUPPORT_RELEASE_PRIVATE_KEY` and `NODUS_SUPPORT_RELEASE_KEY_ID` have been configured. The private recovery copy is outside Git, under `~/.config/nodus-release-signing/support-manifests-2026/`, with private permissions. It is never printed or bundled. The existing macOS code-signing certificate remains separate and unchanged. Future keys can be generated with `npm run support:keygen -- <key-id> <private-folder-outside-git>`; `scripts/configure-support-signing.mjs` performs initial GitHub setup and refuses to overwrite existing signing secrets. Signed manifests bind the exact version, OS, architecture, runtime, installer sizes and SHA-256 hashes. Missing trust, bad signatures, modified downloads and wrong architecture fail closed. Candidate native signatures are checked before execution where supported.

The release workflows build standalone Support artifacts and a ZIP of the final Nodus runtime. `support-release.mjs --publish` refuses publication until all four gated operations are qualified for that platform and the private key matches a pinned public key. No publication has been performed by this implementation task.

The new native CI matrix covers Windows x64, macOS arm64/x64 and Linux x64; it builds all three Linux formats, runs unit tests including a real file larger than 4 GiB, captures the 12 languages in both themes, checks early bootstrap, and launches the independent packaged runtime. Native Windows/Linux/Intel execution has not been observed locally.

Before enabling a repair, record and review actual native evidence for:

1. Full SQLite/WAL recovery and schema compatibility, corrupt databases and encrypted archives, correct and incorrect passwords, damaged registries, external paths, symlinks and Windows junctions.
2. Interruption at every binary and policy transition; disk-full, permission-denied and locked-file failures; cancelled elevation; source changes during a copy; preservation and explicit selection of divergent recovered work.
3. Full-application isolation including Node networking, subprocesses, provider calls, credentials, plugin execution, backups and cleanup. The normal interactive application is intentionally gated until this is proved.
4. Real reinstall/rollback for NSIS, signed macOS bundles, AppImage, DEB and RPM; damaged installations and interrupted downloads; restoration after assistant shutdown; same-version first and explicitly approved compatible-version fallback.
5. Both user modes from symptom through confirmation and fallback report, accessible keyboard/screen-reader interaction, high contrast, scaling and reduced motion, all 12 translations and both themes.

Current local evidence: renderer/Electron/Support typechecks and targeted lint pass; protection/privacy/transaction/release tests pass, including real file streaming beyond 4 GiB in the initial verification. The real Electron UI passes 24 locale/theme screenshots and 24 automated WCAG checks, plus keyboard interaction, reduced motion and 200% scaling. The independent macOS arm64 package and early bootstrap probes launch. Native SQLite compilation works with the installed macOS 26.5 SDK. The expanded native data suite now verifies committed WAL rows, external libraries, copied configuration and sync changes, plugin preservation, real library reconstruction, partial table recovery, an encrypted archive restored into an empty profile, an incorrect password, and the complete application running on copied data with networking denied. Source hashes remain unchanged. Native evidence is saved with a digest of the tested source in `.ci/support-native/`.

The desktop does **not** currently have production qualification for every repair or installer format. `qualified-repairs.json` remains empty until the complete matrix above is executed and reviewed on each platform. Neither passing the worker canvas check nor generating an installer is sufficient to fill it. Windows, Linux and Intel native jobs have not yet been observed passing for this change; the new CI matrix runs the expanded data tests with native database/calendar dependencies. Public release remains blocked. Known automatic repair coverage is limited to the explicit catalog; vendor downloads and OS/driver work currently open official instructions. Unknown tool/provider failures produce a report.
