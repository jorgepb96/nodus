# Backups: portable exports and recovery

Backups is a local Nodus Tool. It exports selected user content as Markdown, CSV, JSON, or a combination, into a dated folder or a streaming ZIP/ZIP64 archive. The current vault is selected by default; exporting other vaults does not activate them. Scheduling and restoration remain in Settings. The complete encrypted `.nodus` action uses the existing all-vault recovery pipeline.

## Selection

All nine vault types use the same selection contract in `shared/backups.ts`. Categories, entity selections, attachment inclusion and history inclusion apply before serialization, so every requested format sees the same selected records. Missing preset references produce omissions and never expand the selection. Personal presets are stored in global preferences; per-export preservation acknowledgement is not saved in a preset.

The global library contributes documents linked to selected vaults by default. Selecting the entire global library, or individual library records, is explicit. Original attachments retain their contents and extension. A missing file is recorded in the omissions list.

Source access policies and testimony preservation policies apply to these exports. Confirmable preservation content requires acknowledgement for that export; restricted or withdrawn content is excluded. Canonical workspace ACL rules apply to native pages and database resources. No AI generation is performed.

## Output contract (version 1)

Every package has `README.md` and `manifest.json`. The manifest format is `nodus.open-backup`, with `formatVersion: 1`, the selected options, vault identities, record count, omissions, and the relative path, byte count and SHA-256 of each payload and index file. The manifest does not hash itself. The returned result includes its size in the overall file/byte totals.

Markdown contains one principal entity per file and separate relationship indexes. Research can be organized by works, authors or ideas; summaries can be integrated, separate or excluded. Evidence names its source and location and distinguishes quotations from paraphrases. Manual ideas without an occurrence remain exportable. Native Scriptor documents are projected from their actual Yjs content. Internal document and attachment URLs become encoded relative links; code spans and fenced blocks are preserved. Original Markdown attachments are copied unchanged.

CSV contains entity tables and relationship tables, with separate `ideas`, `idea_occurrences` and `evidence` tables. Files use UTF-8 with BOM, comma delimiters, quoted fields, doubled quotation marks and CRLF record separators. Nested values are JSON inside a CSV cell. Empty/null cells are empty quoted fields. Databases also have a spreadsheet projection preserving row identities and typed values.

JSON table envelopes use `format: "nodus.open-backup-table"`, `formatVersion: 1`, `vaultId`, `table`, `primaryKey` and `records`. Structured JSON fields remain structured. Binary values become `{file, bytes, sha256}` descriptors when included; otherwise they are omitted. Library records use a separate versioned envelope, preserving the source format metadata. Stable entity identifiers are preserved across all presentations.

New persistent tables must be classified in `electron/export/backupsRegistry.ts` as exportable content or technical/excluded data. Unknown tables fail closed. Credentials, settings, synchronization tokens, caches, embeddings and regenerable indexes are excluded from portable output. User-authored fields named "password" or "secrets" are preserved; actual database connection credentials are scrubbed from connection configuration.

## Execution and verification

The service creates consistent SQLite snapshots in a private application temporary directory. A utility process serializes selected records and streams binary values in chunks. It prepares only selected payloads in a temporary directory within the destination, then publishes by rename after completion. Cancellation, worker errors and destination errors clean up temporary output. ZIP writing reuses the existing streaming ZIP64 writer.

Run `npm run build` followed by `npm run test:e2e:backups`. The E2E suite launches actual Electron with Playwright and an isolated profile. Only native file dialogs are automated; preload, IPC, snapshots, worker and export writers are real. Independent Markdown and CSV parsers, direct fixture assertions and SHA-256 checks validate the output. Folder and ZIP payloads must be equivalent. The suite also restores a complete `.nodus` archive in a second isolated Electron profile. Set `NODUS_BACKUPS_ARTIFACT_DIR` to retain five UI screenshots, produced files and `verification.json` in a chosen evidence directory.

`node --test scripts/test-open-backups.mjs` supplements the real-app suite with exact binary streaming, access-policy, filename, Markdown, JSON and simulated disk-full failures. The native backup, ACL, Toolkit, IPC and translation tests cover the shared integrations.
