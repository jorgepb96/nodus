# Review of the 5.8.1 release notes

Reviewed range: `v5.8.0..dcd285e1`. Release date: 2026-10-09.
Tracked in issue #1080.

The modal contains eight final user-visible changes in all twelve interface
languages, grouped into New features, Enhancements and Fixes. At the release
owner's request, Nodus Scriptor is presented as a new feature with its complete
editing and academic export behavior. Its prompt-star correction is included in
that final behavior rather than listed separately. Historical 5.8.0 notes remain
unchanged.

## Displayed order and evidence

| Section | Order | Final outcome | Scope | Evidence |
| --- | --- | --- | --- | --- |
| New features | 1 | Scriptor documents, research links, citations, bibliography, notes, chapters, academic exports, versions and reversible AI improvements on Desktop and Server web | Toolkit | #1056, #1063, `docs/scriptor-academic-workflow-2026-10-02.md` |
| Enhancements | 2 | Reagent-aware chemistry templates, atom-map validation and optional strict scheme preparation | AI | #1064, #1067 |
| Enhancements | 3 | Research Chat answer length follows context space and recorded model output limits | Academic | #1065, #1066 |
| Fixes | 4 | Synthesis checks use declared substances, preserve repeated salt components, distinguish unchecked steps, report structure origins and draw only routes that pass | AI | #1066, #1068, #1069 |
| Fixes | 5 | Saved plugin results identify the content version that produced them while installed packages keep loading | AI | #1072 |
| Fixes | 6 | Corpus retrieval works with large libraries and prompts, citation references remain accessible, and context lists only participating works | Academic | #1065 |
| Fixes | 7 | Zotero 10 saves API keys and connection credentials using its asynchronous password manager | Zotero | #1078 |
| Fixes | 8 | Installers omit files left by previous builds, reducing application size | General | #1073 |

Related chemistry, retrieval and plugin changes are described by final behavior,
without listing intermediate repairs or internal diagnostic logging. Presenter’s
mobile announcement (#1075) is delivered through the existing remote feed. The
separate Drift mobile privacy policy (#1079) is not a desktop feature.

## Version and publication metadata

Desktop package and lockfile, Server package and runtime version, Zotero and
browser manifests, container arguments and labels, source offers and immutable
source URLs, notice headings, Maps request identification, citation metadata and
generated website metadata use 5.8.1. Historical release notes and audit records
retain their versions. The sitemap is regenerated after committing its sources.

`docs/release-5.8.1-notes.md` is generated from the exact English modal text in
displayed order. The changelog includes the same entries. Stable publication
regenerates that description from the checked-out tag.

## Translation and visual verification

Coverage is checked against the interface's `AppLanguage` union: Spanish,
English, French, German, European Portuguese, Brazilian Portuguese, Italian,
Turkish, Simplified Chinese, Traditional Chinese, Japanese and Korean. All 96
highlight translations are present. The six companion language maps explicitly
register 5.8.1. Section labels already cover every language.

`scripts/verify-release-notes-ui.mjs` passed against the actual modal in every
language and both themes. It verifies exact text, section order, scope icons,
historical release selection, all historical v5 sections, unchanged v4 layout
and scrolling in an 800 × 650 window. Saved light, dark and small-window captures
in `docs/verification/release-5.8.1/` were inspected.

## Local validation

- 20 release-section, version, licensing and artifact-name tests passed.
- 167 website, translation, modal-support and macOS release-security tests passed.
- 16 citation and release-download tests passed.
- Release history, citation synchronization, source offers, stable channel
  validation and the saved English description comparison passed.
- Full ESLint and renderer/Electron TypeScript checks passed under Node 22.23.2.

The PR CI must pass its complete test inventory, real-app end-to-end checks,
capability checks on Linux, macOS and Windows, and container smoke test before
merge. The stable release then validates, builds and publishes its supported
platforms through the shared release workflow.
