// Kept out of migrations.ts so the publication worker can read it without loading every
// migration body and the modules they import.

/**
 * The schema version stamped on what this build SENDS to another machine: replica outbox
 * mutations, Nodus Server snapshots and .nodussync packages.
 *
 * A receiver refuses anything stamped above its own SCHEMA_VERSION, because rows from a newer
 * schema may carry columns it would drop. That danger exists only when a migration changes a
 * table's columns. Stamping SCHEMA_VERSION itself made every index- or trigger-only migration
 * a hard break: v201 adds one index and rewrites two triggers, and still made every v200
 * replica refuse a v201 publication and every v200 owner drop a v201 collaborator's changes.
 *
 * So this is the LAST migration that changed any table's set of columns. Raise it to the new
 * migration's number whenever a migration adds, drops or alters a table or a column;
 * scripts/test-sync-schema-version.mjs fails until it matches.
 */
export const SYNC_SCHEMA_VERSION = 200;
