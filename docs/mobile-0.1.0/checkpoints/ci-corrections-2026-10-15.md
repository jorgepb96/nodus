# CI corrections and final connection preview — 15 October 2026

Connection acceptance is recorded in [the direct connection checkpoint](direct-connection-2026-10-15.md). This checkpoint records the complete CI failure, the concrete corrections and their local verification. **The Desktop PR is not yet green.** No additional CI has been dispatched after the owner's single authorized run.

## Authorized CI result

[CI run 38705992427](https://github.com/jorgepb96/nodus/actions/runs/38705992427) executed on `74b6f535552405b6fea2ed3cb61c3d930a588b04` and **failed**. This was the one complete run authorized by the owner; it must not be relabeled as a pass.

- All **1,046 assigned test files** completed across the six Linux shards: **5,259 tests**, **5,214 passed**, **35 failed**, **10 explicitly skipped** for platform/native-ABI reasons. The skips remain named in the inventories; they are not accepted functional evidence.
- Renderer/Electron static quality, Linux production build, Server, Scheme, native macOS and native Windows jobs passed.
- Real-app integration and backup/restore groups passed. In the smoke group, the basic smoke passed, then Stellar's immediate post-navigation assertion read its asynchronously restored hub too early.
- The required aggregate `test` gate failed. Required CLA and linked-issue metadata checks remain separate from the functional CI result.

Private evidence: `authorized-final-ci.json`, `authorized-final-ci-state.json`, `ci-run-1-plan/plan.json`, all six `ci-run-1-inventory/ci-tests-*/shard-*.json`, raw `ci-job-*.log` and `ci-failures-inventory.json`.

## Corrections

- Restored missing companion interface translations in all 11 translated locales: 38 keys per non-English table, and 37 new English keys (the expiry sentence already existed in English). No language fallback or coverage assertion was relaxed.
- Added 34 fixed companion recovery errors and one parameterized database error in all 11 languages. Runtime errors preserve their reason, recovery action and literal database ID, including replacement-sensitive characters. Spanish messages and runtime failure classification are unchanged.
- Narrowed the thinking-catalog provider stub to its actual owning importer and asserted the shared provider classifier remains real.
- Updated source-location/call-shape contracts after extraction to shared portable research/database/study/history modules. The assertions retain native prompts, configured/explicit languages, section-length rules, eight durable phases, history sanitation, privacy projections and raw-snapshot opt-in. New executable tests exercise actual production helpers, without AI providers.
- Removed an impossible CI dependency on a sibling mobile checkout by pinning the 15 real template revision hashes with source/blob provenance; a paired checkout still compares the full actual mobile resource. No missing-checkout skip or empty success was added.
- The normal argument-map route still returns to its catalog without generation. An explicitly supplied saved map opens its existing content without regeneration; both paths are checked against the real component's initializers/effect.
- Stellar now waits a bounded 30 seconds for the exact pre-navigation idea IDs and retains the count assertion. It cannot pass with the right count but the wrong restored ideas.

These changes are saved in `27285784`, `e68c14fd`, `947cf1b5`, `981fcfbf`, `1f760404`, `dc07e4a2`, `9f4e013f`, `6fa4cde2`, `602963cf`, `54859863` and `706c7cfc`, all using `[skip ci]`.

## Local verification after corrections

| Check | Actual result | Private evidence |
| --- | --- | --- |
| All 17 affected non-i18n scripts, integrated repeat | **174 passed / 0 failed / 0 skipped**, unchanged source/runtime | `ci-failed-contracts-local-final.log`, `.json` |
| Complete interface translation coverage | **35 passed / 0 skipped** | `ci-i18n-final.log` |
| Main-process error localization, including all 11 companion languages and literal dynamic IDs | **14 passed / 0 skipped** | `ci-runtime-errors-final-02.log` |
| Full renderer and Electron TypeScript checks | PASS | `typecheck-ci-corrections-final.log` |
| Full ESLint | PASS | `lint-ci-corrections-final.log` |
| Actual isolated Stellar Tabs E2E | PASS, one attempt, full original assertions plus exact restored IDs | `stellar-tabs-local-final.log` |
| Independent source review of mocks, template fixture and runtime errors | No actionable findings | Review recorded in the task; no binary certification inferred |

The integrated 17-script repeat was frozen at `706c7cfc22367e773edf89b1e26842374b8dae70`, with clean status before/after and unchanged Electron, SQLite and dependency hashes. The Stellar repeat used its actual existing production artifacts, whose exact hashes are in its log. The combined 19 corrected scripts pass **223 local tests**; this is not a complete second hosted CI pass.

## Final signed Desktop preview

The corrected sources were rebuilt and packaged at **`706c7cfc22367e773edf89b1e26842374b8dae70`**, source digest `49cbbaff39fb955212de0e56e656e921ed06c96857c5aa2bcd21b00e08ef2146`, unchanged across build/packaging and real-process acceptance.

- Application: `/private/tmp/nodus-desktop-mobile-20261015-final/mac-arm64/Nodus.app`; version **5.10.0 arm64**.
- Developer-ID team `6RPLS9EA4X`; strict/deep verification and **82 individual signing targets including the outer app** passed.
- `app.asar` SHA-256: `8fd627d34839121740bbb82504afb735d334e96ff3b17698031f90edfe41da74`.
- Executable SHA-256: `23f24153b364a5c9edb60811d480667ce70995d91aa0509ea1d632c9d535542a`.
- Main/preload hashes are unchanged from the earlier accepted production connection code. Renderer translations/error messages are rebuilt.
- The actual final signed application passed renderer/preload/IPC and real Mac LAN pinned HTTPS, all 12 isolated vaults, actual close/reopen, stable port/TLS/grant/credential, renewal without a duplicate device, rejection of the old credential and Desktop revocation: **1 passed / 0 skipped**.
- Evidence: `desktop-final-build.source.json`, `desktop-final-build.log`, `desktop-final-package.log`, `desktop-final-package.receipt.json`, `desktop-final-package.components.json`, `packaged-final-live.log`, `packaged-final-live/result.json`.
- It is a private preview, **not notarized, published or installed over normal Nodus**. The native iOS and code/QR acceptance retain their actual earlier receipts; they are not retrospectively attributed to this repackaging.

Mobile **0.1.0 (1003)** is now available in internal TestFlight, assigned to **Nodus interno** with saved notes. Archive source is mobile `d51aa71aae1f4450efe6e2293d3dc635b760c165`. [Delivery record](https://github.com/jorgepb96/nodus-mobile/blob/codex/mobile-0.1.0-parity/docs/mobile-0.1.0/TESTFLIGHT-2026-10-15.md). Installing iOS does not update the normal Desktop installation.

## Remaining gate

The corrected Desktop commits need a new genuine hosted `test` result. `.github/rulesets/cla-main.json` requires that check from GitHub Actions integration `15368`; local logs cannot substitute for it. The first CI authorization is consumed. **A second run requires another explicit owner exception.** Workflows/rules remain unchanged; no fabricated statuses, no merge.

LAN acceptance is complete for the cases above. Real Tailscale/VPN routing, physical camera/iPhone validation, actual Wi-Fi-interface switching and Mac sleep/wake are not established by these tests. Broader application parity remains unfinished.
