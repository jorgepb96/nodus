# Model activation and upgrade default correction

The historical E5 cache was incorrectly treated as an explicit model choice.
Upgrade startup now uses Granite whenever no model preference was saved. A
successfully saved explicit choice still takes precedence. Existing per-model
vectors remain available and are reused when that encoder is selected again.

Preparation also reused the foreground chat abort controller. Zotero's item
notifier/polling calls resetSourceContext when the selected item changes. This
cancelled the model download/index preparation and returned the dropdown to E5;
the error was only shown on the Chat panel while the user was in Settings.

Corrections:

- A library preparation owns its own abort controller and survives reader/item
  context changes. Explicit cancellation and window shutdown still stop it.
- Settings displays the active encoder independently of the requested encoder,
  plus live progress, inline error/success status and a cancel button.
- A failed target stays selected for retry; the active preference is unchanged.
- Clicking Prepare for the already-active encoder validates the runtime and
  prepares missing vectors instead of returning without work.
- A busy foreground operation produces an explanation in Settings.

## Reproduction and verification

A disposable native Zotero 10.0.6 profile indexes a synthetic passage with E5,
starts Granite activation, creates/selects a synthetic book while the destination
loads, and allows the item notifier and polling to run. The uncorrected package
fails the `Granite activation` assertion. The corrected package passes this
case, vector reuse, explicit cancellation, credential persistence and per-item
history/restart/deletion.

```sh
node --test --test-concurrency=1 scripts/test-zotero-plugin.mjs
node scripts/smoke-zotero-xpi.mjs --xpi dist-zotero/nodus-zotero-5.15.5.xpi \
  --embedding-switch-smoke --embedding-context-switch-smoke --keep-profile
```

108 plugin tests pass. Additional regressions cover historical E5 data without
an explicit preference, saved model choices, context changes during preparation,
visible failure/retry state, preparing the active encoder and busy-operation
feedback. Local model tests are sequential. No personal Zotero profile is used.

5.15.5 is the local plugin artifact version, unchanged until the next release;
the desktop/server release version is unchanged. It retains the existing addon
ID and update channel. The earlier three-model retrieval measurements remain
unchanged; this correction does not change vector semantics or inference.
