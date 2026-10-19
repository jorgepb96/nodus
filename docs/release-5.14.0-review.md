# Nodus 5.14.0 release review

## Version and scope

The previous stable release is `v5.13.0` (`7d611d7b`). The preparation baseline is
`e88d7e94` on `main`. The five first-parent merges between them are all covered below.

5.14.0 is a compatible feature release. It adds saved embedding indexes per vault, an
A/B retrieval comparison and a Research Chat request queue. Schema migrations 203–204
are additive and protected. Existing vectors, saved conversations and integration
contracts remain supported, so the release does not warrant a major version.

## Coverage of every merged change

| Merge | Final user-visible outcome | Highlights |
| --- | --- | --- |
| #1222 | Saved indexes per vault, reuse preview, Prepare and activate, active index kept during preparation, reactivation without new embeddings | 1 |
| #1222 | A/B comparison of two saved indexes without activation, quality only with complete annotations, export | 2 |
| #1226 | Research Chat queue: shortcut, per-request settings snapshot, sequential execution, reorder, edit, delete, pause | 3 |
| #1222 | Optional local documentary reranking with separate download and fallback to the original order | 4 |
| #1222 | Model-specific query/document input profiles, custom prefixes, existing recipes preserved | 5 |
| #1226 | Web search and Verify sources as icon buttons with tooltips | 6 |
| #1216 | No desktop freeze while publishing a new document's text for search | 7 |
| #1224 | Conversation history kept after source changes, review follow-ups keep the topic | 8 |
| #1224 | Idea search with mixed indexed revisions, accurate context summary | 9 |
| #1221 | Full-width sidebar titles with overlaid row actions | 10 |
| #1222 | Explicit float encoding for OpenAI-compatible embedding providers | 11 |

Backup coverage, remote publication atomicity, migration safety, preparation history
and test fixtures are represented by these final outcomes rather than separate
announcements. Intermediate CI repairs inside each pull request are not documented.
The comparison and reranking notes make no retrieval-quality claim.

The release also aligns eight new embedding-index strings with the fixed vault
terminology in Italian (`vault`), Japanese and Korean (`Vault`) and Traditional
Chinese (`知識庫`).

## Release identity

- App package and root lockfile, server package/runtime/container metadata.
- Browser connector and Zotero manifests.
- Citation version/date and generated site metadata and citation page.
- Corresponding Source URLs and first-party notices for desktop and server.
- Server deployment examples, OCI labels and the maps User-Agent.
- Shared release registry and all six companion language maps.
- Generated English description, matching changelog and version-sensitive checks.

## Validation and publication

The release has eleven highlights in all twelve interface languages. Their three
sections are New features, Enhancements and Fixes. The English release body is generated
from the same data and displayed order as the modal.

The release PR must pass complete CI before merge. Stable publication runs the complete
tag CI again and requires the primary platform installers, updater manifests and the
Zotero integrity chain. The signed/notarized Intel build is a separate workflow after
primary publication and must also finish successfully.
