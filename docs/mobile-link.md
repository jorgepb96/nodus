# Nodus Link: first companion release

The first iOS/iPadOS release reads the linked Desktop workspace and plays its
saved podcasts. Creation, editing, autonomous providers and audio synthesis are
retained but disabled in the mobile product. Desktop authoring remains intact.
See the mobile repository's `docs/mobile-0.1.0/nodus-link-2026-11-13.md` for the
release scope and explicit pending native acceptance.

Desktop 5.17.1 main was merged into the companion branch in `06f6ca08` so the
bridge reads the actual current podcast repository. Four bounded corpus methods
expose saved episodes, details and images. `podcastAudio` resolves the registered
opaque episode identity within its owning vault, verifies the audio directory,
rejects traversal/symlinks and serves hash-checked chunks. No podcast generation,
rename, deletion or position-writing method is remotely exposed.

The code/QR/link pairing contract remains compatible. macOS keeps native DNS-SD;
Windows/Linux use an in-process Bonjour publisher with the same service type and
TXT payload. Code advertisements omit the code and authenticate the offer with
its existing HMAC. Reconnection advertisements contain only public address hints.
No Server/Cloud relay is introduced. VPNs without mDNS use the self-contained QR
or link and its LAN/VPN origins.

Local checks: typecheck PASS; touched-file ESLint PASS; saved audio, podcast and
portable Study contracts 7/7 PASS; discovery/direct HTTPS/restart 4/4 PASS; new Link
translations 35/35 PASS. Portable mDNS was tested over the real network stack on
this Mac; Windows/Linux OS runs, physical VPN and camera QR are not claimed.

The provider-free Link lab is opt-in with `NODUS_LINK_ACCEPTANCE_FIXTURES=1` and
requires the isolated lab marker, an empty academic database and vault paths
inside the lab. Its existing seed corpus, manual dictionary versions/relations
and quiet 30-second podcast tone are fictional fixtures, never AI output. The
normal acceptance host and its generation tests remain available separately.

Private logs and `.xcresult` files remain in each repository's ignored
`artifacts/link-2026-11-13/`. This campaign does not run GitHub Actions, change the installed application or
production vaults, publish to the App Store or merge a PR.
