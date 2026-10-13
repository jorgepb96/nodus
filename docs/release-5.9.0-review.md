# Review of the 5.9.0 release notes

Reviewed range: `v5.8.1..e1f78d28`. Release date: 2026-10-12.
Tracked in issue #1103.

The range adds backward-compatible features (Backups exports and three new
Nodus Scriptor capabilities) without incompatible changes, so the release is a
minor version under SemVer: 5.9.0.

The modal contains fourteen final user-visible changes in all twelve interface
languages, grouped into New features, Enhancements and Fixes. Each new feature
is described once with its final behavior. Corrections made before release, such
as localized dictation and editor AI errors, alphabetical model and style
selectors, and closing the dictation panel without restarting capture, are part
of those descriptions rather than separate entries. Historical 5.8.1 notes
remain unchanged.

## Displayed order and evidence

| Section | Order | Final outcome | Scope | Evidence |
| --- | --- | --- | --- | --- |
| New features | 1 | Backups in Tools: selective Markdown/CSV/JSON exports of one or more vaults to a folder or ZIP, record and library selection, reusable selections, research by works/authors/ideas, complete `.nodus` backup in the same tool; Desktop | Toolkit | #1100, `docs/backups.md` |
| New features | 2 | Scriptor live dictation with installed local models, editable and undoable text, pause/resume/stop, no remote transcription; Desktop | Toolkit | #1098 |
| New features | 3 | Scriptor AI polish of a selection with library styles, model choice and instructions; streamed proposal with marked changes, whole-proposal acceptance and one-step undo; Desktop | Toolkit | #1102 |
| New features | 4 | Scriptor AI image creation with model choice, preview, cancellation, favorites and insertion at the cursor; Desktop | Toolkit | #1102 |
| Enhancements | 5 | Faster Research Chat retrieval and evidence gathering in large libraries, Zotero scope checks and smoother streaming in long conversations | Academic | #1082, #1083 |
| Enhancements | 6 | The graph (Stellar) loads the complete map of large libraries in seconds | Academic | #1086 (`48db34b1`) |
| Enhancements | 7 | Scriptor inherits vault or theme colors; dictation settings and extra formatting open in separate menus; no toolbar scrolling | Toolkit | #1098 |
| Enhancements | 8 | Cloudflare synchronization budgets with pause notice, off-thread replica imports and replica convergence while the publisher is offline; requires the updated Worker | General | #1091 |
| Fixes | 9 | Executable attachments are revealed instead of run, LAN PIN attempt limits, non-overwriting browser downloads, sanitized publication HTML with MathML | General | #1085, #1086 |
| Fixes | 10 | Backups past 4 GiB (ZIP64), in-flight sync edits kept, deletions respected, all Nodi notes synchronized, failed first pull rolled back | General | #1084 |
| Fixes | 11 | Last edits before leaving a page saved, microphone released when a recorder closes during the permission prompt, Notion imports with external links, GEDCOM parents | General | #1086 |
| Fixes | 12 | Route check steps agree with the route verdict, including continuity; stop keeps the visible answer; web search requests are followed | AI | #1074, #1082 |
| Fixes | 13 | Plugin tool cancellation stops started processes, per-call timeouts are isolated, removing/updating a plugin stops its workers | Plugin | #1082 |
| Fixes | 14 | Stale Documentary Index errors cleared, OCR and damaged PDF pages isolated, duplicate detection beyond 5,000 records, space-separated ISBNs | Library | #1084, #1087 |

The 5.8.1 notes already state that a route diagram is drawn only when the route
passes, so that behavior is not repeated. Internal diagnostics, capability
budget fields, the route dump hook, CI routing and runtime requirements
(Electron 43.6) are not user-visible features.

## Version and publication metadata

Desktop package and lockfile, Server package and runtime version, Zotero and
browser manifests, container arguments and labels, source offers and immutable
source URLs, notice headings, Maps request identification, citation metadata and
generated website metadata use 5.9.0. macOS Intel downloads intentionally keep
pointing to v5.8.1, the last release with Intel builds. The byte-for-byte
snapshots in `.github/actions-budget/original-files/` are unchanged. Historical
release notes and audit records retain their versions. The sitemap is
regenerated after committing its sources.

`docs/release-5.9.0-notes.md` is generated from the exact English modal text in
displayed order. The changelog includes the same entries. Stable publication
regenerates that description from the checked-out tag.

## Translation and visual verification

Coverage is checked against the interface's `AppLanguage` union: Spanish,
English, French, German, European Portuguese, Brazilian Portuguese, Italian,
Turkish, Simplified Chinese, Traditional Chinese, Japanese and Korean. All 168
highlight translations are present. The six companion language maps explicitly
register 5.9.0. Section labels already cover every language.

`scripts/verify-release-notes-ui.mjs` passed against the actual modal in every
language and both themes. It verifies exact text, section order, scope icons,
historical release selection, all historical v5 sections, unchanged v4 layout
and scrolling in an 800 × 650 window. Saved light, dark and small-window captures
in `docs/verification/release-5.9.0/` were inspected.

## Local validation

- Release-section, release-history, licensing, artifact-name, update-channel and
  website page/sitemap tests passed.
- Citation synchronization, website metadata generation and the generated
  English description comparison passed.

The PR CI must pass its complete test inventory, real-app end-to-end checks and
the selected native and container checks before merge. The stable release then
validates, builds and publishes its supported platforms through the shared
release workflow.
