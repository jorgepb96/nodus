# Nodus Sign verification

This folder contains disposable test documents and evidence from the real Electron application on macOS Apple Silicon. The final execution details and screenshot inventory are in `report.json`. No private keys or PKCS#12 files are included.

The main walkthrough uses English. The `locale-*` images check the placement controls and drawing editor in all 12 supported interface languages. User-authored fixture names remain as entered.

## Reproduce

Run the existing development/release build first so the application's bootstrap and unrelated workers are available. `node scripts/build-sign-verification.mjs` then rebuilds the production renderer, main process and preload using the existing configuration. This focused build is not a complete release/package build.

```sh
npm run typecheck:ci
NODUS_SIGN_PYTHON=/path/to/test/python NODUS_SIGN_INSTALL_TEST=1 node --test scripts/test-sign.mjs scripts/test-sign-install.mjs scripts/test-toolkit-ui.mjs scripts/test-capability-python-host.mjs scripts/test-capability-runtime-provisioning.mjs
node --test scripts/test-sign-i18n.mjs scripts/test-i18n-coverage.mjs
node --test scripts/test-presenter-tools.mjs scripts/test-presenter-state.mjs scripts/test-presenter-perf.mjs scripts/test-protect-engine.mjs scripts/test-protect-ipc.mjs scripts/test-protect-persistence.mjs scripts/test-toolkit-localization.mjs
NODUS_SIGN_PYTHON=/path/to/test/python npm run verify:sign
```

These are developer verification commands. End users install the optional signing engine through **Install signing engine**, with progress, cancellation and retry; terminal commands are not part of the product workflow.

## Automated coverage

The signing, installer, translation, Toolkit, Python-host, runtime-provisioning, Presenter and Protect groups ran **106 tests: 100 passed, 0 failed**. The 6 skipped tests are the cryptographic cases, which need `NODUS_SIGN_PYTHON`. With a pyHanko test interpreter, `scripts/test-sign.mjs` ran **15 of 15 passed, 0 skipped**. The Electron walkthrough below finished with 36 checks and no errors.

Coverage includes single/multiple-page PDFs, placement geometry, image reuse, signature/profile persistence, original preservation, real exports, wrong passwords, expired certificates, empty certificate selection, restricted and previously signed PDFs, successive incremental signatures, tampering, cancellation, failed installations and real standalone-Python installation followed by real signing and verification. The review model also flags intact signatures with partial coverage or incompatible later changes. All 11 translated catalogues are checked against the Spanish source, including native dialog copy and localized unexpected-error handling.

## Real application walkthrough

The Playwright harness launches Electron with an isolated temporary profile. File pickers, save dialogs and native authorization responses are automated only by the harness. Production has no simulation switch. Cryptographic operations use a genuine disposable self-signed test certificate and the real installed pyHanko engine.

The walkthrough checks import, thumbnails, zoom, hide/show/resize panels, drawing and pixel-level undo/redo, image import, renaming/deleting library signatures, multiple placements, drag/resize/rotate, keyboard positioning, numeric dimensions, alignment presets, page ranges, preview, export, save/reimport through the real Nodus archive, certificate errors, appearance profiles, explicit authorization, cancellation, signing, validation, history and persistence after renderer restart.

Handwritten page replication is checked for current/all/custom targets without duplicate copies. Certificate mode produces **two genuine incremental signatures on pages 1 and 3**, and none on page 2. Exported widget rectangles are checked against position **8% / 60%** and dimensions **70% / 15%**. The original fixture remains byte-identical.

## Visual review

The final screenshots are reviewed for buttons, typography, alignment, spacing, panel behavior, the signature icon, light/dark mode, the `sage-stone` palette, 130% interface scale and the accessible font. Window sizes are recorded from Electron, including its actual minimum width rather than a requested width it cannot reach.

The exported visual and certificate PDFs are reopened and rendered independently with Poppler. `pdfsig` checks both cryptographic signatures. The self-signed certificate has an unknown issuer: integrity success is not presented as certificate trust, qualification or administrative acceptance.

| English screenshot | Scenario |
| --- | --- |
| [Tool and sidebar icon](01-empty-light.png) | Empty state and signature library |
| [Drawing](02-drawing.png) | Real pointer input and drawing controls |
| [Exact position and dimensions](03c-exact-dimensions-light.png), [pages](03a-placement-pages-light.png) | Handwritten position, dimensions and page ranges |
| [Automatic installation](05c-engine-install-progress.png) | Installation progress and cancellation |
| [Certificate placement](07a-certificate-placement-pages.png) | Certificate dimensions and selected pages |
| [Authorization](07-certificate-ready.png) | Explicit authorization before native confirmation |
| [Signed and validated](09-certificate-signed.png) | Real cryptographic results |
| [Small dark window](13-small-certificate-controls-dark.png) | Responsive controls in dark mode |
| [Custom light palette](14-palette-light.png), [dark palette](14-palette-dark.png) | Nodus theme colors |
| [Larger UI](15a-large-ui-light.png) | Scale and accessible font |

## Verification limits

Only **macOS Apple Silicon** was executed. Windows x64, Linux x64, macOS Intel and packaged installers still require platform runs. Static packaging/manifests do not establish platform verification. The Intel path reuses the native cryptography build already bundled with Nodus.

Physical pen/touch hardware was not exercised; cursor input was tested. Native certificate stores, AutoFirma integration, PKCS#11, direct finger capture on trackpads, qualified certificates/hardware, TSA and online revocation were not verified or implemented. Cursor drawing and PKCS#12 remain the functional alternatives. Current appearances provide three local font families and a fixed image/text arrangement; arbitrary font files and additional layout presets remain follow-ups.

The first optional engine download requires a connection; documents and credentials are never uploaded. Signing and validation operate locally. Visual exports are limited to 300 placements; cryptographic batches to 1,000 pages and 90 seconds, without publishing partial results after failure or cancellation.
