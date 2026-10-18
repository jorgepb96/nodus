# Nodus 5.13.0 release review

## Version and scope

The previous stable release is `v5.12.1` (`081c8e2f`). The preparation baseline is
`6f2bf3a6` on `main`. The five first-parent merges between them are all covered below.

5.13.0 is a compatible feature release. The research coordinator is shared within
existing product surfaces. Saved artifacts, source formats and integration contracts
remain supported. Neither these changes nor the release preparation introduce an
application-wide incompatible architecture or a data migration.

## Coverage of every merged change

| Merge | Final user-visible outcome | Highlights |
| --- | --- | --- |
| #1206 | Shared research execution, enabled context, related questions, useful stopping, durable tasks and pause/continue/cancel | 1 |
| #1206 | Fast/Expanded breadth, independent thinking, per-tool defaults and remembered choices | 2 |
| #1071 | Experimental local EmbeddingGemma 2 CPU profiles, shared optional download, compatible preparation, unchanged defaults and Intel Mac unavailability | 3 |
| #1206 | Direct translation, paraphrase and editing, with explicit later source lookup | 4 |
| #1206 | Connected Chat prose, requested headings and separate source notices excluded from copied prose | 5 |
| #1071, #1206 | Documentary retrieval, continued PDF tables, retained evidence and optional source checks | 6 |
| #1212 | Responsive, dismissible citation search with preserved metadata and focus | 7 |
| #1212 | Image deletion confirmation and undo, large-image storage, preview and download | 8 |
| #1210 | Single translated Graph research tooltip | 9 |
| #1204 | Synthesis compatibility recognizes consumed reactants as reagent inputs | 10 |
| #1206 | Non-reasoning OpenRouter compatibility and optional visual proposal arrays | 11 |

Supporting audits, fixtures, transport implementation steps and successive development
repairs are represented by these final outcomes, rather than separate announcements.
The experimental embedding profiles are not described as validated or superior.
The research engine notes make no universal answer-quality or performance claim.

## Release identity

- App package and root lockfile, server package/runtime/container metadata.
- Browser connector and Zotero manifests.
- Citation version/date and generated site metadata and citation page.
- Corresponding Source URLs and first-party notices for desktop and server.
- Server deployment examples, OCI labels and the maps User-Agent.
- Shared release registry and all six companion language maps.
- Generated English description, matching changelog and version-sensitive checks.

Historical versions and notes remain unchanged. The cached release download totals
continue to describe actual published assets. Website deployment refreshes that cache
from GitHub after publication rather than inventing downloads for an unpublished tag.

## Validation and publication

The release has eleven highlights in all twelve interface languages. Their three
sections are New features, Enhancements and Fixes. The English release body is generated
from the same data and displayed order as the modal.

Local checks cover release metadata and source offers, all translations and historical
notes, the three-section generator contract, AGPL/source references, server identity,
lint and TypeScript. The production modal is exercised in every language in light and
dark themes, through historical versions, and in a small viewport. Screenshots are in
`docs/verification/release-5.13.0/`.

The release PR must pass complete CI before merge. Stable publication runs the complete
tag CI again and requires the primary platform installers, updater manifests and the
Zotero integrity chain. The signed/notarized Intel build is a separate workflow after
primary publication and must also finish successfully. Deploy Website after publication
to refresh release metadata and download counts. Record actual workflow outcomes in the
release issue instead of treating an initiated build as completed verification.
