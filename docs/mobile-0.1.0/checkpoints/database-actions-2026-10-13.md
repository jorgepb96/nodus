# Database actions checkpoint — 2026-10-13

Implementation stopped at the user's request to publish the complete current PR state. This is a development checkpoint, not release approval or full database action parity.

## Implemented source

- Desktop `shared/mobileDatabaseActions.ts`: strict owning row/property request contract; pure bounded canonical automation compiler using the existing typed cell normalization and filter evaluation. It prepares the five canonical action types without executing providers, writes, notifications or webhooks. A changed computed dependency requires explicit refresh instead of using an invented result.
- Desktop `electron/desktopBridge/MobileDatabaseActions.ts`: owning-parent validation, content fingerprint/CAS, provider-free atomic cell/image publication, real Mac provider invocation wrappers, started/received/completed/interrupted receipts, explicit provider-free recovery of a received response, canonical button execution and a separate device button plan publication that does not resend webhooks or redispatch automation hooks.
- Mobile `DatabaseVisionCompletion.swift`: actual one/two-image OpenAI-compatible and Anthropic request bodies, selected device model/auth transport, no provider retry, malformed/truncated response failures.
- Mobile `CompanionDatabaseActionJournal.swift`: accepted intent before provider work, received result before publication/cancellation check, unfinished request guard, grant/vault ownership, retained older completed results, local cell deltas and deterministic action identities.
- Mobile `DatabasePropertyActions.swift`: distinct Live/device paths, explicit bounded seven/thirty-day action-context downloads, real device text/image calls, paid result recovery, device button plan progress/receipts and explicit unknown-webhook interruption. No agent invoked a provider or external action.

## Actual validation

- `node scripts/test-mobile-database-actions.mjs` passed using a fresh isolated canonical SQLite vault: source identity/foreign-parent rejection, text CAS and receipt replay, preserving an old image after stale publication, typed uploaded-blob hash/readback/cleanup replay, one injected completion received before cancellation and reused without another call, real button click count/idempotency, and rejecting an uncertain started receipt. External fetch count was zero. This does **not** test the newly prepared five-action device compiler/publication end to end.
- Root ran NodusAI contracts: 9 tests / 3 suites passed in `/private/tmp/nodus-010-image-provider-contract-03.log`, including the three `DatabaseVisionCompletionTests` (actual binary request payloads, Anthropic transport and failure handling). No provider calls.
- New native/helper/core sources pass source parsing. New `CompanionDatabaseActionJournalTests` have **not** been executed or compiled as a test suite at this checkpoint.
- The earlier Electron diagnostic at MobileDatabaseActions.ts:104 was fixed by retaining a typed result metadata object. No full final Electron or native acceptance claim.

## Required integrations / incomplete work

1. Register and dispatch `getMobileDatabaseActionSource`, `generateMobileDatabaseText`, `generateMobileDatabaseImage`, `saveMobileDatabaseGeneratedCell`, `runMobileDatabaseButton`, `recoverMobileDatabaseAction`, `saveMobileDatabaseButtonResult` in the owner-managed operations/registry and typed job allowlist. Generation wrappers require the actual grant, idempotency UUID and owning vault. This dispatch is not integrated here; current UI invocation is consequently blocked before effects.
2. Add `archiveDatabaseActionCheckpoint` as a non-sendable local ledger record and a dedicated `CompanionGenerationPublication` initializer so checkpoint + provider-free publication are retained atomically. Add new journal index/scope/history classification to unlink/regrant recovery; preserve the review flag and never rerun paid/unknown work.
3. Finish native chunk publication. The stable Desktop upload helpers exist (`8afc72ee`); `CompanionDatabaseAttachments.uploadForPublication` does not. Device images above the inline transport threshold remain durably retained with an explicit error, never inline success or another paid generation.
4. Add dedicated database action result rendering and job title/status mapping. Generic JSON/base64 rendering is not an acceptable completed UI. `DatabaseActionResultView.swift` was approved but not created before the publication freeze.
5. Integrate local row/created-page/notification projections with the owner-managed database reader and run focused journal tests, five-action compiler/publication regressions, native form/reopen tests and real provider acceptance when configured. The local cell overlay helper is prepared; full created-page navigation and publication dependency handling remain unverified.
6. Review condition/computed-dependent chains, partial external failure run accounting and explicit unknown-webhook resolution. Unknown HTTP outcomes intentionally cannot auto-resend; no exactly-once webhook claim.

Registry/job/recovery integration is mandatory before exposing this as completed functionality. Existing UI bindings are another agent's checkpoint and must be validated against this lane together. No normal user vaults were modified, no real providers/external recipients were called, and no Actions/push was performed by this agent.
