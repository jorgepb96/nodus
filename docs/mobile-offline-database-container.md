# Companion saved container queries — source stage

Desktop SQL and the complete selected-copy query share `combinedDatabaseContainerFilter`, preserving physical-to-canonical property translation and missing-property AND/OR semantics. `queryCompanionDatabaseContainer` consumes every captured source, checks the saved configuration revision and actual mapped columns, and returns the same canonical source/row identities and mapped values in source order. The internal `allRows` portable action avoids a 500-row or first-page ceiling. It is not added to the public Mac read API.

Local row/cell/column edits feed the existing portable derived-value/query engine before saved filtering and ordering. Missing/foreign selected sources and changed configuration are explicit errors. The companion bundles this pure engine in a network-disabled WK data renderer; live reads continue to use actual SQL pages.

Prepared `test-mobile-database-presentation.mjs` acceptance includes 562 real SQLite rows, three sources, source-specific property maps, unmapped filters, source selection, full pagination, local edited/created rows and configuration mismatch. **Unexecuted for this revision.** This source commit is not a validation result. Rollup/relation dependencies and all Apple/visual acceptance remain pending.
