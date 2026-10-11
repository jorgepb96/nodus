# Companion derived database values — source stage

The closed database metadata read exposes only the actual database identities needed by rollups and relation formula expressions. Paginated selected source reads include the real scoped relation records; clients keep their complete row/column dependency graph under the chosen download budget. No arbitrary SQL, external endpoint or mobile extraction operation is introduced.

The portable engine now uses the shared rollup aggregator and formula evaluator, complete table statistics and canonical relation values to derive results after local edits. Cross-database columns are evaluated in dependency order, with explicit missing-copy/circular-reference errors. Target option labels, null values, numeric/checkbox formula coercion and relation ordering follow the Desktop repository. The original protected capture is never modified by consultation. Existing callers of `computeFormulas` retain their defaults; pure selected-graph callers can supply relation values and an exact column subset.

Prepared `test-mobile-database-presentation.mjs` coverage compares edited related values, table-wide target statistics, downstream rollups/formulas and removed relations to actual SQLite reads. **Not run for this revision.** Apple runtime and full mobile acceptance remain pending.
