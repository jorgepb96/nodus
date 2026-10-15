# Nodus Sign

## Plan and architecture

1. Reuse the `toolkitNavigation` catalogue and pins, `ToolkitAppHero`, Nodus icons and controls, Protect's import capabilities, and Presenter's loader, renderer and thumbnails. Keep a single local pdfjs configuration and worker.
2. Build a visual editor with a global library in `userData/toolkit/sign`, per-page placements, real export with pdf-lib, and vault archive copies through `archiveRepo`, deduplicated by SHA-256.
3. Add an isolated pyHanko adapter for PKCS#12, PAdES B-B, appearances, local validation and incremental updates. A missing engine must never block handwritten signing.
4. Verify bytes, persistence, test certificates and the real Electron application, and keep screenshots and results. Distinguish the platform that was executed from the ones still pending.

`shared/signTypes.ts` defines contracts without Node or DOM. `src/sign` contains drawing, images and the PDF surfaces; `ToolkitSignView` coordinates editing. `electron/ipc/sign.ts` requires the Nodus main frame, keeps temporary capabilities for documents and certificates, confirms signing with a native dialog, and uses `SignStore`, `visual.ts` and `SignEngine`.

The global library uses JSON with atomic replacement and private files (0700/0600 on POSIX). It holds PNG signatures, profiles and a history of results. History copies are deduplicated by hash. Each copy can be opened, revealed, exported and deleted. Save to Nodus uses the existing archive and creates no parallel tables or services. A result stored in a vault is independent from the global history; deleting one does not remove the other.

## Optional engine

The engine is **pyHanko 0.35.1 (MIT)** with **Pillow 12.1.1** for appearances. Nodus reuses their primitives and those of cryptography and does not implement CMS or any cryptography of its own. The Python adapter receives a single JSON message on stdin, returns the result on stdout and exits. Passwords, keys and documents are never passed in arguments, temporary files or logs. The password is not stored in preferences and is cleared from the interface when signing runs. JavaScript and Python cannot guarantee that every in-memory copy is erased, so no zeroization is promised.

In the Certificates panel, click **Install signing engine**. Nodus shows progress, allows cancel and retry, creates a private environment under `userData/toolkit/sign/runtime`, and installs the full dependency set from `resources/sign/requirements.lock`, with pinned versions and SHA-256 hashes. The real engine is checked before its path is published; an incomplete installation is never presented as available. Handwritten signing remains usable during installation.

The private Python that Nodus already ships for Zotero MCP is reused first, so the package gains no second runtime. In development an existing compatible Python may be used (without modifying it). If none is available, the pinned standalone Python verified by the shared `runtime/zotero-mcp/manifest.json` manifest is downloaded automatically. Users are never asked to install Python or run commands. **Use another Python** remains an optional advanced setting.

Only installation needs GitHub/PyPI access, to download public components. Documents, signatures, certificates and passwords never take part in those requests. Signing and validation with the installed engine work offline. Only wheels with verified hashes are installed, without compilers or package build code.

macOS Intel reuses the native cryptography 50.0.1 build that Nodus already includes for its Python 3.12: upstream publishes no Intel wheels for that version. If that bundled component is missing, the user is told to update or reinstall Nodus; build tools are never required. Windows x64, macOS ARM64 and Linux x64 use the artifacts from the same manifest. The installer for this tool has been executed only on macOS ARM64; the other platforms need their own runs before they are declared verified. The adapter and the lock file are copied outside the asar through `extraResources`.

The official AutoFirma client was studied as an alternative. Invoking it through its protocol/Java client and reliably receiving the result would need its own adapter and tests, so Nodus neither launches a URL nor claims an integration that does not exist. pyHanko keeps the result local, inspectable and verifiable incrementally without reproducing AutoFirma.

## Integrity and security

- Handwritten signature: an image embedded in the PDF content. It is a visual mark and does not attest a cryptographic signature.
- Certificate signature: a PAdES field with the `ETSI.CAdES.detached` subfilter, SHA-256 and an incremental update. It requires an authorization checkbox and then a native dialog that identifies the document, subject and certificate fingerprint.
- Encrypted PDFs, expired or not-yet-valid certificates and files without a private key are rejected. A wrong password produces no result.
- pdf-lib is used only before any cryptographic signature. It detects Sig/ByteRange/DocMDP/FieldMDP objects; the visual editor never rewrites a signed or restricted PDF.
- pyHanko validates previous and new signatures without network access. The output is checked to start with all the original bytes and to grow by exactly the number of selected pages. Restricted documents are conservatively rejected, with no option to ignore the restriction.
- Successive signatures are allowed when earlier ones keep their integrity and the modifications are compatible. Trust in a certificate and its revocation status are separate from byte integrity. The interface explains this and never presents a self-signed test certificate as trusted.
- There is no TSA, OCSP, CRL or mandatory external service. PAdES B-T/LT/LTA, qualified signatures and administrative acceptance are not promised.
- The imported original is never written. Exporting over a registered original path is refused. Signing always creates a copy.

## Capture and advanced compatibility

Universal input uses Pointer Events (mouse/trackpad as a cursor, touch, and pen with pressure when the device provides it). PNG/JPEG/WebP images can be imported, and light background pixels can be removed with Canvas; no AI is used. This is not segmentation of arbitrary backgrounds.

Direct finger capture on a trackpad **is not implemented** and is not confused with cursor movement. AppKit provides `NSTouch.normalizedPosition` and indirect touch events in a native view; that would need an AppKit helper/bridge, focus handling and hardware tests. Windows Precision Touchpad describes HID collections, not a drawing API reachable from Electron; direct access requires research into Raw Input/drivers and per-device compatibility. libinput delivers touchpad gestures/motion; reading absolute evdev events on Linux depends on permissions and the session. No global input permissions or private APIs are added without a tested implementation.

Pending: native capture, enumeration and use of system keychains, PKCS#11, AutoFirma integration, configurable trust roots and offline revocation validation through imported evidence, arbitrary font selection, and optimized appearance layouts. Current appearances use three local Canvas font families, size, text, date, identifier and an optional image. The Sign interface and native dialogs are translated into Nodus's 12 languages: Spanish, English, French, German, European and Brazilian Portuguese, Italian, Turkish, Simplified and Traditional Chinese, Japanese and Korean. Dates follow the selected language.

## Technical sources

- [AutoFirma, official repository](https://github.com/ctt-gob-es/clienteafirma)
- [pyHanko: signing functionality](https://docs.pyhanko.eu/en/stable/lib-guide/signing.html)
- [pyHanko: validation](https://docs.pyhanko.eu/en/stable/lib-guide/validation.html)
- [Apple: NSTouch.normalizedPosition](https://developer.apple.com/documentation/appkit/nstouch/normalizedposition)
- [Microsoft: Precision Touchpad Collection](https://learn.microsoft.com/en-us/windows-hardware/design/component-guidelines/touchpad-windows-precision-touchpad-collection)
- [libinput: touchpads](https://wayland.freedesktop.org/libinput/doc/latest/touchpads.html)

## Tests

`npm run test:sign` runs the model, persistence, visual export and failed/cancelled installation tests. With `NODUS_SIGN_INSTALL_TEST=1` it also tests the real Python download, hash-checked installation, environment reuse and a real signature with the freshly installed engine. With `NODUS_SIGN_PYTHON=/path/to/python` it also runs real cryptography with ephemeral self-signed certificates, a wrong password, an expired certificate, two successive signatures, tampering and cancellation. Without that variable the cryptographic tests are explicitly marked as skipped.

`node scripts/build-sign-verification.mjs` rebuilds the production renderer, main process and preload with the existing configuration, keeping the non-Sign workers from the development build. It is a focused QA build and does not replace the full CI or release build.

`npm run verify:sign` runs Electron in an isolated test profile. Its native dialogs are automated only inside the test process; production has no simulation switches. The certificates are real test certificates. Screenshots and the run report are saved in `docs/verification/nodus-sign`. The main walkthrough runs in English and adds a visual matrix of the 12 languages. See that folder's README for the actual results and platform limits.

## Position, dimensions and pages

Both modes share `src/sign/PlacementControls.tsx`: horizontal/vertical position and width/height as page percentages with 0.1 % precision, optional proportion locking and nine quick positions. A signature can be dragged, resized from its corner and moved with the arrow keys (Shift for a larger step). Handwritten signatures also support rotation and undo/redo. Percentages are measured from the top left of the displayed page area and converted to each page's PDF coordinates when signing.

The page selector offers current, all and explicit ranges (`1, 3-5`). It rejects empty, reversed or out-of-document ranges. For handwritten signatures, **Apply to pages** replaces the copies in that group without duplicating other signatures; each copy can be adjusted individually, and applying again reuses the position/size of the selected one. When an image repeats, the PDF reuses its graphic resource.

For certificates, the preview appears only on the selected pages. Each page receives **an independent, real cryptographic signature** from the same certificate, in an incremental update. One authorization is requested for the whole set, and the native dialog lists the pages and the number of signatures. No visual stamps are added with pdf-lib after signing. The engine verifies every signature at the end; a failure or cancellation saves no partial copy. Any change of position, size, page or profile withdraws the pending authorization.

The workspace and editor use the active palette, light/dark colors and Nodus fonts. The document and the ink canvas keep their paper background to show the exported result. The layout responds to the actual width left by the sidebar, placing the settings below the viewer in narrow spaces.

## Reading the validation

`src/sign/validation.ts` distinguishes the signed bytes, revision coverage and later changes. Even when a signature's bytes are intact, partial coverage or an incompatible change needs review and is shown as a warning. Full revisions with new signatures or compatible form changes are explained with translated text; internal engine codes are never shown. A voluntary cancellation is shown as a neutral notice. Changing the language regenerates the appearance text and date and withdraws the pending authorization.
