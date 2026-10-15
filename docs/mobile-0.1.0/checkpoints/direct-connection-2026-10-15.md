# Direct workspace connection — 15 October 2026

The current acceptance scope is connection/reconnection and Desktop PR health. Broader consultation/generation parity remains unfinished. Both PRs stay unmerged. The owner explicitly authorized **one complete final-head CI** after local validation; it ran and failed. Corrections and their local verification are recorded in [the follow-up checkpoint](ci-corrections-2026-10-15.md). A second run is not yet authorized; mobile Actions remain unrequested. Workflows and branch protection stay unchanged.

## Connection behavior

- The renderer/preload boundary forwards `{wholeWorkspace:true}`. Previously the fifth argument was dropped, so an apparently complete link could still fail private-vault access.
- Desktop Settings has a dedicated **Conexión móvil** tab. Its primary action generates a temporary code, QR and link for the complete workspace. Advanced server/relay setup is not part of the primary mobile flow.
- Desktop advertises public, versioned Bonjour address hints independently of Settings. It preserves Mac identity, TLS certificate, grants and credentials through restarts. Advertisements contain no code, token, pin or vault names.
- If another process takes the saved port, only `EADDRINUSE` triggers a retry on an available port. The new origin is persisted and advertised; other errors remain visible.
- Mobile verifies both the saved TLS leaf pin and exact Mac identity before adopting an address or sending a credential. Discovery cannot revive pending, revoked or expired grants. Canonical credentials and stored workspace identities survive origin changes.
- Failed Bonjour resolution retries with bounded backoff and stops in the background. Visible mobile settings refresh canceled/stale diagnostics and retry the real semantic probe after the Mac returns. Network loss never changes Live to autonomous mode.

## Revisions and binary identity

Original references: Desktop `0a173fd9c698a7cb2d5989aa64b59cddd329bcf9`; mobile `ad6e3069bcea67b48de76de561fc27c3db417563`.

The real production renderer/Electron bundle was built at Desktop `9dfa24f7cb7f6aebd9a0dcfe3dd9fdf945b3fff7`, incorporating main through `58cd4b0f`. Dependency closure was corrected at `756c6473`, packaged-app test support at `271e80a8`, native signing at `63100ae9`, and the actual Settings renewal-code driver at `9a6e86ac`. Later documentation does not imply the app was rebuilt from that documentation commit. Each native execution has its own pre-execution source and compiled-artifact receipt.

The initial private **Nodus 5.10.0 arm64** preview was packaged with Electron 43.6.0 and signed with Developer ID / team `6RPLS9EA4X`:

- Application: `/private/tmp/nodus-desktop-mobile-20261015/mac-arm64/Nodus.app`.
- `app.asar` SHA-256: `e8424ae15dc1a2e30b1dea6f8dfec864419acd22f6c97505653a2446415ed76b`.
- Executable SHA-256: `ffedab9c263e273e3bd957cc4a9cf99feb3365c7b7d1a45c9ec4f0c63670b3f3`.
- Strict/deep application verification and individual verification of all **81 native components** passed with the same team identity.
- The preview is **not notarized, installed over normal Nodus or published**. Normal installation and original vaults remain unchanged. A final corrected-source preview at `706c7cfc` has since been rebuilt, signed and accepted against the actual Mac LAN; its hashes and exact scope are in [the follow-up checkpoint](ci-corrections-2026-10-15.md).

Packaging initially exposed stale root/server dependency locks and generic binary detection attempting to timestamp Python data. Root `ws` and server lock metadata were aligned; temporary server `npm ci --ignore-scripts` passed. The signing filter positively identifies Mach-O code/bundles and leaves resources sealed by their container. Existing release identity, entitlements and notarization checks remain intact. The generated sitemap dates were refreshed with the canonical generator.

## Executed evidence

Desktop evidence is private under `artifacts/pairing-2026-10-15/`. Native evidence is under the same relative directory in mobile PR #30. Tests use marked, isolated copies of 12 vaults; no original-vault writes or AI-provider calls were made.

| Operation/check | Actual result | Evidence filename |
| --- | --- | --- |
| Full renderer + Electron typecheck | PASS | `typecheck-05.log` |
| Full ESLint, including after packaging changes | PASS | `lint-04.log`, `desktop-package-lint-final.log` |
| Production renderer/Electron build | PASS | `build-03.log`, `desktop-build-03-receipt.json` |
| Actual Desktop renderer/preload/IPC + Mac LAN HTTPS | PASS: 1 executed, 0 skipped | `desktop-live-03.log`, `live-final/result.json` |
| Real process close/reopen; same port, TLS, credential and grant | PASS | Same real-process run |
| Renewal, previous-token rejection, no duplicate device; Desktop revocation | PASS | Same real-process run |
| Same lifecycle against the actual signed packaged application | PASS: 1 executed, 0 skipped | `packaged-desktop-live-02.log`, `packaged-live-02/result.json` |
| Saved-port collision with an actual external TCP listener | PASS: pinned HTTPS resumes on a new persisted port | `port-collision-final.log` |
| Whole-workspace preload/discovery regressions | PASS: 3 test files, 0 skipped | `connection-final-head.log` |
| Final production-head collision and visual contracts | PASS: 18 tests, 0 skipped | `contracts-head9dfa-extra.log` |
| Actual Settings QR pixels decoded with Apple Vision | PASS: code, pin, Mac and 12 vaults match | Laboratory `connection-evidence/qr-vision-result.json` |
| iPhone and iPad: type actual Mac UI code, discover, link, restart without new code | PASS | Mobile `code-iphone-02.xcresult`; individual code case in `code-ipad-01.xcresult` |
| Add a vault after linking; delete that isolated new vault | PASS: later catalogs reconcile, other 12 vaults remain | Mobile `new-vault-iphone-02.xcresult`, `removed-vault-iphone-01.xcresult` |
| iPad Settings stays open while actual Mac stops/restarts at same origin | PASS: current models and real semantic identity, Live retained | Mobile `reconnect-ipad-01.xcresult` |
| iPhone Settings stays open while saved Mac port is occupied and Mac moves | PASS: actual new model + semantic identity, no new code | Mobile `reconnect-iphone-02.xcresult` |
| Desktop Settings issues renewal code for existing phone; phone enters it | PASS: same device/grant/pin/scope and 12 connections, restart works | Mobile `code-renewal-iphone-01.xcresult` |
| Mobile renew button; revoke cancel; revoke confirm; all vaults absent after restart | PASS: 2 tests, 0 skipped | Mobile `native-controls-iphone-02.xcresult` |
| Actual signed Desktop code → native iPhone Bonjour/pinned HTTPS → all 12 vaults → restart | PASS: 1 test, 0 skipped; postconditions checked in real native store | Mobile `packaged-code-iphone-01.xcresult`, `.result.json` |
| Actual signed Desktop stops/restarts while native iPhone Settings remains foreground | PASS: 1 test, 0 skipped; real model and semantic response, Live and existing grant retained | Mobile `packaged-reconnect-iphone-03.xcresult`, `.source.json`, `.result.json` |
| Portable connection/security contracts | PASS: 76 tests / 12 suites, 0 skipped | Mobile `mobile-pairing-resolution-retry.log` |
| Native storage, credential aliases and semantic retry/races | PASS: 9 tests, 0 skipped | Mobile `native-storage-02.xcresult` |
| Packaged dependency closure and temporary server install | PASS | `desktop-package-final.json`, `desktop-package-server-lock-ci.log` |
| Packaging contracts; signing classifier + existing release checks | PASS: 13 packaging; 10 signing/release checks | `desktop-package-ws-contracts.log`, `desktop-sign-classifier-tests.log` |

Native builds 07–09 recorded their exact tested source and artifacts; the primary signed-app code acceptance used mobile `d99adbca0acbefc13ca05979ac051c33bf1243b3`. Build 10 at `0624e03` only gives the model and subsequent semantic assertions separate bounded waits for cold Desktop startup; production mobile behavior is unchanged by that test adjustment.

The supplementary constrained local CI review executed 282 files: 1,317 tests passed, none failed, one explicitly skipped for Electron ABI. It began at `6212d4dc` and ended at `9dfa24f7`; the harness correctly reported the binary digest changing during a separately announced rebuild. This is **not** a frozen-head full CI pass: 761 files and hosted platform/E2E jobs were deferred. See `ci-local-verification-summary.json` and `ci-preflight-final.summary.json`.

## Failed attempts and practical limits

Earlier results remain preserved: a report keyboard assertion failed after successful code linking; a stale embedding diagnostic led to the real recovery fix; the first mixed iPad bundle failed a unit-test wait race despite its two UI cases passing; the first native revoke test failed a screenshot teardown after access had correctly disappeared; a packaged copied-profile lock was refused before launch. The first packaged foreground-reconnect attempt recovered the actual model but exhausted the shared assertion deadline before scrolling to semantic status. A subsequent manually timed attempt restarted the Mac too late for the model deadline. Automated lifecycle orchestration then passed against the signed app (`packaged-reconnect-iphone-03`); it restarts Desktop on the actual native launch event. None is counted as a passing bundle. Focused corrected executions retain separate logs/results.

- Tailscale is installed, but its backend is stopped, self is offline and no usable online peer/route was demonstrated. **Real VPN handover remains unverified.** Learned VPN-origin and credential-security fixtures do not establish that route.
- Desktop listener/address enumeration supports IPv4 LAN/VPN. IPv6-only networks were not implemented or accepted by this checkpoint.
- Apple Vision decoded actual QR pixels; no physical camera scan is claimed. The owner will perform physical iPhone validation after TestFlight.
- TestFlight **0.1.0 (1003)** is now delivered internally, in **Nodus interno**, with saved test notes. The earlier **1002** remains historical. The existing shared renderer resources intentionally retain beta 1002's Desktop `80c54bd0` provenance; this connection campaign does not claim merged-main UI parity.
- GitHub requires `CLA / signature`, `Issue linked` and `test` from integration `15368`, declared in `.github/rulesets/cla-main.json`. The authorized complete CI must run on the final pushed Desktop head. Local logs cannot substitute for these statuses; a missing/canceled/failed check is not green.

Credentials, QR offers, copied vault content, screenshots, raw logs and `.xcresult` bundles stay local. Only sanitized descriptions and test source are committed.
