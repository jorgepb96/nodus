# Companion world content edits — source stage

The versioned, closed `shared/mobileWorldContentTables.json` registry permits authored world content only in a real worldbuilding vault with the writing domain. Image metadata additionally requires files. It does not expose ACLs, other vault families' private tables, document extraction, indexing pipelines or tools. Bridge capabilities advertise the actual permitted tables per owning vault.

The existing canonical mutation conflict and receipt transaction remains authoritative. The world adapter checks scene/beat ownership and vocabulary, normalizes titles, promotes authored links and refreshes their references with the Desktop repositories. Scene prose uses canonical word counts, link handling, shrink recovery and the word diary. Retries retain the same committed receipt and cannot execute those side effects again.

Mobile reopening projects durable pending content using generated real primary keys, including compound beats. A newer canonical row supersedes an applied overlay. Canonical delete jobs are retained across reopening; a refused, failed or cancelled job preserves the entity. Paired clients do not downgrade a rejected repository delete to raw table deletes. Saves and reconnection drain authorised parent mutations before child edits and jobs, and retain distinct local/accepted/applied messages.

Prepared acceptance fixtures: `scripts/test-mobile-world-mutations.mjs` and NodusKit `CompanionContentProjectionTests`. **Neither has been executed for this source revision.** Local compilation, complete world UI acceptance, mixed network recovery, all entity invariants, map/file writes and autonomous review of a newly created offline scene remain acceptance work. This document is not release approval.
