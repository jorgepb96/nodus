<!--
SPDX-FileCopyrightText: 2026 Jorge Pérez Burgueño and Nodus contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

# Corresponding source for Nodus

Nodus 5.8.1 is licensed exclusively under the GNU Affero General Public
License v3.0 (`AGPL-3.0-only`). The complete, unmodified license text is in
[`LICENSE`](LICENSE). Versions published through Nodus 3.2.7 remain available
under the MIT license that accompanied those releases.

The preferred form for modifying the official Nodus 5.8.1 release is available
from the immutable release tag and its source archives:

- Tag and release: https://github.com/jorgepb96/nodus/releases/tag/v5.8.1
- Source tree: https://github.com/jorgepb96/nodus/tree/v5.8.1
- Tar archive: https://github.com/jorgepb96/nodus/archive/refs/tags/v5.8.1.tar.gz
- ZIP archive: https://github.com/jorgepb96/nodus/archive/refs/tags/v5.8.1.zip

The source includes the desktop app, Nodus Server, the Zotero add-on, build
scripts, lockfile and the material needed to rebuild the distributed work.
Install the locked dependencies with `npm ci`, then use the build commands in
[`README.md`](README.md), [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`server/README.md`](server/README.md).

## Modified network deployments

Anyone who modifies and deploys Nodus Server must provide the Corresponding
Source for the version users are actually interacting with. Set
`NODUS_SOURCE_URL` to a stable, public URL for that exact source. Official
unmodified builds default to the immutable Nodus version tag. The server shows
this URL in its web interface and returns it as `sourceCodeUrl` from its health
and about/capabilities responses.

Do not point a modified deployment at the official repository unless that
repository contains the complete source for the deployed modifications.
