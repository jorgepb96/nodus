# Automatic local preparation and sidebar divider

The selected encoder is warmed automatically shortly after the plugin's sidebar
initializes, including first-time weight download. It does not require opening
Settings or clicking Prepare. If document context is disabled, automatic model
and document preparation are disabled too.

Only the actual active reader attachment is indexed automatically. Collection
and library scopes do not cause a startup scan. Existing extracted text and
compatible vectors are reused. Automatic preparation performs no OCR and sends
no document text to an embedding API. Downloads remain pinned model assets.

The composer is not locked by automatic work. Foreground chat pauses automatic
document preparation, and background inference uses batches of at most two
passages (the worker still processes individual inputs sequentially). Manual
model changes cancel the previous automatic warmup before selecting a target.
Leaving a reader prevents stale background vector publication. Window shutdown
cancels work. Idle workers retain the existing five-minute termination policy;
UI polling does not repeatedly reload an idle model.

Offline/failed downloads leave chat available and retry with a 60–300 second
backoff while the plugin is running. Automatic status never overwrites an error
for a different, manually requested encoder. Progress appears in Settings and
the existing document embedding bar. Explicit Prepare remains available.

The native sidebar splitter is 6 pixels wide (previously 1), uses a horizontal
resize cursor and highlights on hover. Sidebar width limits are unchanged.

## Verification

116 plugin regressions pass. Focused additions cover automatic model warmup,
reader-triggered vector generation without Settings, foreground preemption,
failed-download backoff, opt-out, shared in-flight warmup, manual error visibility
and switching models during automatic warmup.

The real packaged 5.15.5 XPI passes on Zotero 10.0.6/macOS ARM64 in a disposable
profile. Without invoking warmup/embed or clicking Prepare from the driver, it
waits for automatic model readiness, imports/opens an authored PDF and verifies
saved Granite vectors. It also measures the native splitter at >=6 pixels and
checks its resize cursor. Credential, per-item history, restart/deletion and
normal shutdown checks remain successful.

```sh
node --test --test-concurrency=1 scripts/test-zotero-plugin.mjs
node scripts/smoke-zotero-xpi.mjs --xpi dist-zotero/nodus-zotero-5.15.5.xpi \
  --automatic-preparation-smoke --keep-profile
```

All local-model checks run sequentially. No personal Zotero profile is opened.
The local XPI remains 5.15.5 until the next release; this is not a new desktop
or server release.
