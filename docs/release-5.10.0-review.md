# Review of the 5.10.0 release notes

Prepared range: `v5.9.1..2068886c3ce6018fff87e070b2b3a15df4bf5022`, plus
PR [#1136](https://github.com/jorgepb96/nodus/pull/1136) at
`af7b0ead803d89edb411447acdb64a24c2bd3691`.
Proposed release date: 2026-10-14.
Tracked in issue [#1153](https://github.com/jorgepb96/nodus/issues/1153).

The range adds backward-compatible features, including academic interface
profiles, resumable lessons and new bookmark controls. It contains no identified
breaking change, so the next version under SemVer is 5.10.0.

PR #1136 must be included with passing required checks before the release is
tagged. At the reviewed revision, its Graph tabs E2E check fails because the
graph legend intercepts a context-label click. The release-preparation PR does
not resolve that separate failure. Recheck the final diff and any later changes
on main before tagging. If publication moves to another date, update
`releaseMetadata.dateReleased`,
the modal date, the changelog, citation metadata and generated site metadata
together.

## Displayed order and evidence

The modal has eighteen entries: three New features, seven Enhancements and eight
Fixes. Every entry has all twelve interface translations. The English release
description and changelog use the modal's exact displayed text and order.

| Section | Order | Final outcome | Scope | Evidence |
| --- | --- | --- | --- | --- |
| New features | 1 | Per-vault Simple, Intermediate, Advanced and Custom profiles, sidebar and header visibility, unified Interface selector, preserved existing and custom layouts | Academic | #1136 |
| New features | 2 | Twelve resumable lessons in the actual workspace, action and evidence checkpoints, separate chat/embedding and analysis setup | Academic | #1136 |
| New features | 3 | Bookmarks as the browser home, favorites and favorites-only, date/name/folder sorting, card/list views, preserved custom and blank homes | Browser | #1148 |
| Enhancements | 4 | Gallery multi-select filters, counts, clearing, approach/language and immersion progress filters | General | #1140 |
| Enhancements | 5 | Consistent workspace tabs, close controls, horizontal overflow and Scriptor tabs above the toolbar | General | #1124 |
| Enhancements | 6 | Smaller installation packages, Codex/Copilot engines downloaded on demand, queue progress/retry and automatic preparation for existing users | General | #1134 |
| Enhancements | 7 | Retired startup announcements, current tutorials retained | General | #1132 |
| Enhancements | 8 | Forward reaction templates, supplied atom maps, optional building-block evidence with whole-target fallback | AI | #1114 |
| Enhancements | 9 | Recognized output limits for GPT-6.1 Sol and Claude Fable 5.1 | AI | #1113 |
| Enhancements | 10 | Fixed reader controls and toolbar access to the audio dialog | Academic | #1120 |
| Fixes | 11 | Content-language citations and reports, interface-language export labels, preserved existing saved content | Languages | #1147 |
| Fixes | 12 | Correct Japanese/Korean state and action labels on desktop and Server web | Languages | #1142, #1140 |
| Fixes | 13 | Lower supported reasoning on cut-off retry, longer idle allowance for silent reasoning streams | AI | #1111, #1110 |
| Fixes | 14 | Structure checks use connectivity, retaining genuine connectivity and regiochemistry failures | AI | #1112 |
| Fixes | 15 | Packaged basic-mode Server has its runtime and web app | Server | #1128, #1130 |
| Fixes | 16 | Thirteen localized Scriptor improvement presets and consistent formatting control sizes | Toolkit | #1117, #1122 |
| Fixes | 17 | Dictionary uses the global model/reasoning/web settings without duplicate controls or empty progress rows | Academic | #1138 |
| Fixes | 18 | Theme-aware sidebar scrollbar and header logo | General | #1126 |

The new features from #1136 are documented once with their final behavior.
Intermediate guide positioning, overlay, checkpoint, recording and citation
adjustments are included in those outcomes. Generated tutorial recordings are
not part of this release preparation. Existing Scriptor dictation, AI review,
image creation and Backups export features were released in 5.9.0 and are not
announced again. The unrelated CI and macOS notarization retry changes in #1115,
#1118, #1144, #1150 and #1152 are omitted from the user-facing notes.

Optional Chemistry Studio decomposition depends on a compatible installed
plugin exposing `decompose-target` and a reaction index. Whole-target searches
remain available without it. Installer size measurements in #1134 cover macOS
arm64, so these notes do not promise a numeric reduction on unmeasured platforms.

## Version metadata

Desktop package and lockfile, Server package and runtime constant, Zotero and
browser manifests, container arguments and labels, immutable source offers,
Maps request identification, notice headings, citation metadata and generated
website metadata all use 5.10.0. Historical notes, archives and audit records
retain their original identifiers. The sitemap uses source commit dates and is
regenerated after the release-preparation commit.

## Verification

`npm run typecheck`, `npm run lint` and `npm run build` passed with a complete,
isolated dependency installation. The production build includes the renderer,
Electron entry points and Cloudflare Worker. The later main update only changes
release workflows, documentation and their tests, so it does not alter those
compiled sources.

The release history check passed and compared all 94 historical releases with
the unchanged main baseline, including every translation, date, scope and
category. Citation synchronization, generated website metadata and exact
English-description comparison passed.

All 94 focused checks passed on the updated main base: release sections,
version agreement, AGPL/source metadata, artifact names, website pages and
sitemap, citation metadata, update channels, Intel dispatch, release workflow
contracts, download counts, support links, Server deployment and historical
backup migrations. Server deployment ran with Node. The migration test ran with
Electron after rebuilding SQLite for its native ABI. The stable validator
accepted `latest` / `v5.10.0`.

The actual modal passed `scripts/verify-release-notes-ui.mjs`: exact text,
displayed order, all twelve languages in light and dark modes, all scope icons,
historical v5 section labels, unchanged v4 layout and scrolling at 800 × 650.
The English full modal and Spanish light, dark and small-window captures are
saved in `docs/verification/release-5.10.0/` and were visually inspected.

- [English modal](verification/release-5.10.0/modal-en-light-full.png)
- [Spanish light modal](verification/release-5.10.0/modal-light-full.png)
- [Spanish dark modal](verification/release-5.10.0/modal-dark-full.png)
- [Small window](verification/release-5.10.0/modal-small.png)

The release-preparation checks run on main with the new notes. PR #1136's
implementation has not been merged into this branch. The release PR's full CI
and the stable tag's native packaging, signing and publication checks remain
required before shipping.
