# Direct workspace connection — 15 October 2026

The current acceptance scope is connection/reconnection and Desktop PR health. Broader consultation/generation parity remains a separate unfinished campaign. Both PRs remain unmerged. No GitHub Actions were requested or enabled for this checkpoint.

## Fixes

- The actual renderer/preload boundary now forwards `{wholeWorkspace:true}`. Previously the fifth argument was dropped, so a seemingly complete link could still receive private-vault permission errors.
- Desktop advertises public, versioned Bonjour address hints independently of Settings. Saved Mac identity, TLS certificate, grants and credentials remain stable through process/network changes. The advertisement carries no pairing code, credential, certificate pin or vault names.
- If another process takes the saved port, only `EADDRINUSE` causes a retry on an available port. The new port/origins are persisted and advertised. Other errors remain visible.
- Mobile verifies both the saved TLS leaf pin and exact Mac identity before adopting a discovered address or sending credentials. Pending, revoked and expired grants do not gain access through discovery. Native origin/credential aliases follow the canonical grant without replacing local workspace identities or execution mode.
- Failed Bonjour resolutions retry with capped backoff and stop when the app leaves the foreground.

## Executed evidence

Desktop production sources were built and tested at `9dfa24f7cb7f6aebd9a0dcfe3dd9fdf945b3fff7`, incorporating main through `58cd4b0f`. The original reference remains Desktop `0a173fd9c698a7cb2d5989aa64b59cddd329bcf9` and mobile `ad6e3069bcea67b48de76de561fc27c3db417563`.

| Check | Actual result | Local evidence under `artifacts/pairing-2026-10-15/` |
| --- | --- | --- |
| Full renderer + Electron typecheck | PASS | `typecheck-05.log` |
| Full ESLint | PASS | `lint-04.log` |
| Production renderer/Electron bundle | PASS | `build-03.log`, `desktop-build-03-receipt.json` |
| Real Desktop renderer/preload/IPC + Mac LAN HTTPS | PASS, 1 executed / 0 skipped | `desktop-live-03.log`, `live-final/result.json` |
| Close/reopen real Desktop, stable port and TLS, existing credential and grant | PASS | Same real-process run |
| Renew credential, reject previous credential, no duplicate device, revoke from Desktop | PASS | Same real-process run |
| Real saved-port TCP collision + pinned HTTPS resume | PASS, 1 executed / 0 skipped | `port-collision-final.log` |
| Whole-workspace preload and discovery regressions | PASS, 3 test files / 0 skipped | `connection-final-head.log` |
| Additional final-head collision and visual contracts | PASS, 18 tests / 0 skipped | `contracts-head9dfa-extra.log` |
| Actual Settings UI QR decoded with Apple Vision | PASS; code, pin, Mac and 12 vaults match | Private laboratory `connection-evidence/qr-vision-result.json` |

The real-process test used an explicitly isolated copy of 12 vaults, the real installed Electron runtime and the Mac's LAN address. It made no AI-provider requests. Normal Nodus installation and original vaults were not used for writes.

The supplementary constrained local CI review executed 282 files: 1,317 tests passed, none failed, one explicitly skipped for Electron ABI. It began at `6212d4dc` and ended at `9dfa24f7`; the harness correctly reported a changed binary digest during the separately announced root rebuild. This is **not** a frozen-head full CI pass: 761 files and the hosted platform/E2E jobs were not executed. Details: `ci-local-verification-summary.json`.

Native iPhone acceptance also executed real code entry, Bonjour, HTTPS, process restart, discovery of a subsequently created vault and removal of that vault. The first port-recovery run retrieved a new Mac model without another code, but its screenshot exposed a stale embedding error; the mobile follow-up must verify that independently before claiming complete reconnection acceptance. Native final results are tracked in mobile PR #30.

## Explicit limits and next gates

- Tailscale is installed but its actual backend is stopped, self is offline and no online peer/usable route was demonstrated. A real VPN handover is **not** approved by these LAN tests. QR/encrypted HTTPS fixtures are not a substitute for that external route.
- Desktop's current listener/address enumeration supports IPv4 LAN/VPN. IPv6-only networks were not tested or implemented by this checkpoint.
- Apple Vision decoded actual QR pixels; this is not a physical camera scan. Physical iPhone validation remains owned by the user after TestFlight.
- The normal installed Desktop has not been replaced by this source checkout. TestFlight 0.1.0 (1002) and the forthcoming native rediscovery changes are distinct builds.
- GitHub requires `CLA / signature`, `Issue linked` and `test` from integration `15368` (GitHub Actions), as declared in `.github/rulesets/cla-main.json`. Local logs cannot legitimately satisfy those hosted checks. Keep workflows intact, do not create substitute statuses and do not declare the PR green while those checks are absent/canceled.

Credentials, QR offers, real copied data, screenshots and `.xcresult` bundles remain local. Only sanitized descriptions and test source are committed. Historical failed attempts remain evidence rather than being relabeled as passes.
