# Nodus third-party notices

Nodus 5.8.1 is free software distributed exclusively under the GNU Affero
General Public License v3.0 (`AGPL-3.0-only`). Versions through 3.2.7 remain
available under MIT. Nodus includes or interoperates with the components and
data described below. Those components keep their own licenses and their
authors do not endorse Nodus.

Every packaged application also contains a `legal` directory next to its
resources with:

- the complete Nodus AGPL license and Corresponding Source offer;
- the complete, generated license inventory for the exact production packages;
- the upstream ONNX Runtime and sharp/libvips third-party notices;
- the Electron and Chromium license collections;
- the GNU GPL/LGPL and Creative Commons license texts; and
- instructions and source references for replacing/rebuilding LGPL components.

## BlockNote editorial editor

Nodus uses the unmodified base packages `@blocknote/core`, `@blocknote/react`
and `@blocknote/ariakit`, each pinned to 0.55.0, by TypeCell and the BlockNote
contributors. Source: <https://github.com/TypeCellOS/BlockNote/tree/v0.55.0>.
These packages are licensed under Mozilla Public License 2.0 (MPL-2.0).
Their complete license is distributed in `legal/generated/MPL-2.0.txt` and in
the generated production dependency inventory. Nodus's editor schema, user
interface, storage adapters, AI and voice integration are Nodus source files.
No BlockNote XL packages are used. Upstream licensing details:
<https://github.com/TypeCellOS/BlockNote/blob/v0.55.0/LICENSE.txt>.

## Managed Zotero MCP and private CPython

The application includes Zotero MCP 0.13.0 (MIT), the Nodus read-only adapter
(AGPL-3.0-only), and CPython 3.12.14 build 20260901. Their runtime is private to
Nodus and does not replace an installed Python or Zotero MCP.

`resources/zotero-mcp/legal/THIRD_PARTY_NOTICES.md` and `inventory.json` describe
the exact installed distributions, including every transitive dependency. The
referenced license texts, Python build metadata and native-library notices are
included alongside them. The runtime carries the Python sources for Unidecode
(GPL) and certifi (MPL); bibtexparser's BSD alternative is retained. Rebuild
instructions and pinned hashes are in `runtime/zotero-mcp/` in the corresponding
Nodus source tree. No semantic model weights are included.

## Managed SearXNG and private CPython

The application includes SearXNG (AGPL-3.0-or-later), pinned to the upstream
commit recorded in `runtime/searxng/manifest.json`, running on the same private
CPython 3.12.14 build described below. Its runtime is private to Nodus, listens
only on the loopback interface, is started on demand by Research Chat's web step
and stopped with the application; it does not replace an installed SearXNG, does
not expose a public instance and never retries around an engine's bot check.

`resources/zotero-mcp/searxng/legal/THIRD_PARTY_NOTICES.md` and `inventory.json`
describe the exact installed distributions, including every transitive
dependency, and the license texts travel alongside them. Nodus's modifications
to the vendored sources (the Windows path and `pwd` shims, the frozen version
module) are listed in the runtime's `searx/NODUS_MODIFICATIONS.txt`, as AGPL requires.
Rebuild instructions, the pinned upstream hash and the hashed dependency lock
are in `runtime/searxng/` in the corresponding Nodus source tree.

## AlphaGenome — Apache 2.0 client; separate service/output terms

AlphaGenome interoperates with Google DeepMind's AlphaGenome through a
user-installed, unmodified official Python SDK. Copyright 2024 Google LLC.
SDK revision: `aa6fc8f6faadcb8c910fa2b85b57386fbd5c7b5d` (0.9.0).
Source: https://github.com/google-deepmind/alphagenome

The client is Apache-2.0; its full license is included in
`legal/generated/ALPHAGENOME_LICENSE.txt`. SDK examples and documentation are
CC BY 4.0; its full text is in `legal/generated/CC-BY-4.0.txt`. Nodus's adapter,
skill instructions and plots are independently authored. No SDK modifications,
model weights or reference datasets are distributed. Python dependencies are
installed into the user's isolated runtime with their own upstream licenses.

The service and predictions are **not** licensed under Apache 2.0 or Nodus's
AGPL. This integration requires a personal key and eligible non-commercial
use under https://deepmind.google.com/science/alphagenome/terms and
https://developers.google.com/terms. Output/derivative use and redistribution
are subject to https://deepmind.google.com/science/alphagenome/output-terms.
The official service/output terms PDFs are bundled in `legal/generated/`.
See `legal/ALPHAGENOME.md` for the reviewed obligations and implementation.

Every generated result and graphic includes its output terms, provenance and
Nodus modifications (track selection, bin averaging and visualization).
Research use only; no clinical use. Nodus is not endorsed by Google.
Scientific citation: Avsec et al. (2026), Nature 649, 1206–1218,
https://doi.org/10.1038/s41586-025-10014-0.

## GeoNames geographical data — CC BY 4.0

The offline gazetteer in Nodus is derived from the GeoNames `cities15000`,
`admin1CodesASCII` and `countryInfo` datasets.

- Creator: GeoNames (https://www.geonames.org/)
- Source: https://download.geonames.org/export/dump/
- License: Creative Commons Attribution 4.0 International
  (https://creativecommons.org/licenses/by/4.0/)
- Changes made by Nodus: records are filtered to the `cities15000` dataset,
  joined with country and first-level administrative names, reduced to the
  fields used by the place picker, sorted by population, converted to TSV and
  compressed with gzip.

GeoNames data is provided "as is" and without endorsement. A complete copy of
CC BY 4.0 is included in `legal/generated/CC-BY-4.0.txt`.

## Inter and Fraunces typefaces — OFL 1.1

The promotional website at `site/` serves its two typefaces from its own origin
instead of Google Fonts, so that no third-party request stands between a visitor
and the first drawn word.

- Creators: the Inter Project Authors (https://github.com/rsms/inter) and the
  Fraunces Project Authors (https://github.com/undercasetype/Fraunces)
- Source: the Google Fonts CSS API, `latin` variable subsets
- License: SIL Open Font License 1.1, vendored beside the fonts as
  `site/assets/fonts/Inter-OFL.txt` and `site/assets/fonts/Fraunces-OFL.txt`
- Changes made by Nodus: none. The `woff2` files are served byte for byte as
  they are published upstream.

## Noto Sans SC — OFL 1.1

The PDF exporters (the desktop professional report stamper and the Nodus Server
Deep Research export) draw their text with `pdf-lib`, whose bundled fonts are the
WinAnsi StandardFonts and cannot encode Han characters. A Simplified Chinese
font is therefore vendored so Chinese reports and labels render instead of being
stripped, and every exported document embeds only a per-document subset.

- Creators: the Noto Project Authors (https://github.com/notofonts/noto-cjk)
- Source: `Sans/SubsetOTF/SC/NotoSansSC-Regular.otf`
- Vendored file: `server/lib/assets/fonts/NodusCJK-Regular.ttf`, with the
  license text beside it as `server/lib/assets/fonts/OFL.txt`
- License: SIL Open Font License 1.1
- Changes made by Nodus: the upstream Simplified Chinese subset was instantiated
  at weight 400 and reduced with `fontTools` to the BMP CJK blocks, Latin and
  punctuation. The glyph outlines are unchanged beyond that subsetting.

## Multilingual E5 small model — MIT

Nodus for Zotero downloads and runs the quantized ONNX weights from
`Xenova/multilingual-e5-small`, pinned to revision
`761b726dd34fb83930e26aab4e9ac3899aa1fa78`. That repository is an ONNX
conversion of `intfloat/multilingual-e5-small`; the base model is licensed
under the MIT License.

- Model: https://huggingface.co/Xenova/multilingual-e5-small
- Base model and license: https://huggingface.co/intfloat/multilingual-e5-small

## Transformers.js — Apache License 2.0

Nodus bundles Transformers.js 3.8.1 to run the local Zotero embedding model.
Transformers.js is copyright Hugging Face and contributors and is licensed
under the Apache License 2.0. Its license text is included in the generated
third-party license bundle.

## ONNX Runtime — MIT

Nodus uses ONNX Runtime 1.18.0, 1.21.0 and the development build identified by
commit `89f8206ba4f1c22c39e0297fb55272e8ce8cd7d0`, through Transformers.js and
VITS Web. Copyright Microsoft Corporation. ONNX Runtime is licensed under MIT.

The full MIT license and the version-specific upstream third-party notices are
included in `legal/generated/`.

## LGPL components

Nodus uses the following unmodified LGPL components:

- `libheif-js` 1.19.8 / libheif, used for HEIC decoding, LGPL-3.0;
- the shared libraries supplied by `@img/sharp-libvips-*` 1.2.4, including
  libvips 8.17.3 and other LGPL libraries listed by the upstream package.

These libraries remain under the GNU LGPL; Nodus does not impose restrictions
on reverse engineering for debugging modifications to them. The full GPL and
LGPL texts, upstream notices, exact source references and replacement/build
instructions are in `legal/LGPL_COMPLIANCE.md` and `legal/generated/`.

## Managed AI runtimes

Nodus redistributes the following official, unmodified runtimes as optional
parts of its AI-provider integration:

- OpenAI Codex CLI (`@openai/codex` 0.144.6), Apache License 2.0;
- GitHub Copilot SDK (`@github/copilot-sdk` 1.0.7), MIT License;
- GitHub Copilot CLI (`@github/copilot` 1.0.71), under the GitHub Copilot CLI
  License distributed with the application.

Nodus is independently licensed. OpenAI, ChatGPT, Codex, GitHub and Copilot are
trademarks of their respective owners. Inclusion does not imply affiliation,
certification or endorsement.

## Nodus Drift — Moodist recordings, under the licenses Moodist declares

Nodus Drift bundles the 81 ambient recordings of the active catalogue of
[Moodist](https://github.com/remvze/moodist), at commit
[`11c0be2200116a3635880d600fd6953899cc51a3`](https://github.com/remvze/moodist/tree/11c0be2200116a3635880d600fd6953899cc51a3).
They are the upstream files, unmodified (each one is checked against its SHA-256 before it
is packaged). The recordings are third-party material: they are **not** covered by Nodus's
AGPL-3.0-only license, and Nodus adds no license or restriction of its own to them.

**Their licenses are the ones the Moodist repository declares for its audio.** This is what
its [README](https://github.com/remvze/moodist/blob/11c0be2200116a3635880d600fd6953899cc51a3/README.md#license)
says, section "License", subsection "Third-Party Assets":

> Some sounds used in this project are sourced from third-party providers and **are subject to different licenses**:
>
> - Sounds licensed under the **Pixabay Content License**: [Pixabay Content License](https://pixabay.com/service/license-summary/)
> - Sounds licensed under **CC0**: [Creative Commons Zero License](https://creativecommons.org/publicdomain/zero/1.0/)

So the two licenses are the [Pixabay Content License](https://pixabay.com/service/license-summary/)
and [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Moodist does not say which of
the two applies to each recording, and Nodus has not verified that itself: each recording is
covered by whichever of those two licenses applies to it upstream. Read the terms at the links;
the Pixabay Content License is not an open license and carries restrictions of its own.

Moodist's own license file is its
[`LICENSE`](https://github.com/remvze/moodist/blob/11c0be2200116a3635880d600fd6953899cc51a3/LICENSE):
the MIT License, copyright (c) 2023 MAZE, which covers Moodist's **code**, not the audio. Its text
is kept in `legal/drift/MOODIST_LICENSE.txt` because the catalogue's identifiers, English labels
and relative paths were read from Moodist's data files. No Moodist source code is used or adapted.

The recordings are used only as part of the app, and Nodus Drift has no feature to download or
export them. The upstream path, size and SHA-256 of every file are in `legal/drift/PROVENANCE.md`;
the decision to bundle them, and what it rests on, is in `legal/drift/REVIEW.md`. Nodus Drift's
noise and binaural tones are generated by Nodus's own code (AGPL-3.0-only) and reuse no Moodist
audio.

## Zotero mark

The Zotero “Z” shown in the in-app tutorial is the official symbolic icon from
the Zotero source distribution:
https://github.com/zotero/zotero/blob/main/app/linux/icons/symbolic.svg

Zotero is developed by the Corporation for Digital Scholarship. Zotero and its
logo are trademarks of the Corporation for Digital Scholarship. Nodus is an
independent project and is not affiliated with or endorsed by Zotero.

## Site platform marks

The download dialog on nodusresearch.com identifies each build with its
platform's own mark:

- the Apple M series mark (`site/index.html`) is the public-domain
  [Apple M1](https://commons.wikimedia.org/wiki/File:Apple_M1.svg) artwork from
  Wikimedia Commons, drawn in the dialog's ink colour;
- the Intel wordmark (`site/index.html`) is the public-domain
  [Intel logo 2023](https://commons.wikimedia.org/wiki/File:Intel_logo_2023.svg),
  kept in Intel's own blue and cyan;
- the AppImage mark (`site/assets/brands/appimage.svg`) is the public-domain
  [App-image-logo](https://commons.wikimedia.org/wiki/File:App-image-logo.svg) by
  Peter Simon;
- the Tux, Debian and Fedora marks are the corresponding paths from
  [simple-icons](https://github.com/simple-icons/simple-icons), released under
  CC0-1.0.

Apple, Intel, AppImage, Debian, Fedora and their logos are trademarks of their
respective owners, used here only to identify the platform each download is
built for. Nodus is an independent project and is not affiliated with or
endorsed by any of them.

## Citation Style Language styles and locales — CC BY-SA 3.0

Nodus can download unmodified citation styles from the official CSL styles repository
and bundles a small set of CSL styles and locale files supplied through
`@citation-js/plugin-csl`. Chicago author-date, Chicago notes-bibliography, MLA, and IEEE are bundled as
unmodified compressed files from official Style Repository revision
`d17b5135c5b38f9ffadd0c3ec257f6892ba07f6e`. The style data originates from the
Citation Style Language project and is licensed under Creative Commons
Attribution-ShareAlike 3.0 Unported.

- Project and attribution: https://citationstyles.org/
- Style source: https://github.com/citation-style-language/styles
- Locale source: https://github.com/citation-style-language/locales
- License: https://creativecommons.org/licenses/by-sa/3.0/

Nodus preserves the authors, contributors, rights, identifiers, and update
metadata embedded in every `.csl` file. A style imported from a user's Zotero
profile or local disk is copied unchanged into that user's `nodus-library` and
is not redistributed by Nodus. The Citation Style Language project and Zotero
do not endorse Nodus.

## citeproc-js — AGPL v3 election

Nodus formats CSL citations locally with citeproc-js 1.4.63, distributed in the
`citeproc` npm package 2.4.63. Upstream offers citeproc-js under CPAL or GNU
AGPL v3-or-later; Nodus elects the AGPL v3 terms, which are compatible with the
project's `AGPL-3.0-only` distribution. Copyright Frank G. Bennett, Jr. and
contributors.

- Source: https://github.com/Juris-M/citeproc-js
- Upstream license: https://github.com/Juris-M/citeproc-js/blob/master/LICENSE

The complete GNU AGPL v3 text is the root `LICENSE` and is included with every
Nodus distribution. `@citation-js/plugin-csl`, used only for its bundled style
and locale data, is MIT licensed and remains identified in the generated
package-license inventory.

## Engines downloaded at runtime

The local model installer downloads the unmodified `llama.cpp` release b10002
directly from its GitHub release. llama.cpp is MIT licensed and its source is:
https://github.com/ggml-org/llama.cpp/tree/b10002

The local image model installer downloads the unmodified `stable-diffusion.cpp`
release `master-782-b290693` directly from its GitHub release. The runtime and
its bundled ggml component are MIT licensed; license texts are included in the
downloaded archive and the corresponding source is:
https://github.com/leejet/stable-diffusion.cpp/tree/b290693

Piper speech downloads `@diffusionstudio/piper-wasm` 1.0.0 from jsDelivr when
the user first invokes it. That runtime incorporates eSpeak NG, licensed under
GPL-3.0-or-later. Nodus is AGPL/GPL-compatible free software and imposes no
additional restriction on that component. The GPL text is included in
`legal/generated/GPL-3.0.txt`; source and build information are available at:

- https://github.com/diffusion-studio/piper-wasm/tree/69522c832bd52d7c16389e9a8aee568065027689
- https://github.com/espeak-ng/espeak-ng

## Downloadable models and voices

Model weights are not included in the Nodus installer. When the user requests
one, Nodus downloads it directly from its named upstream repository. The model
picker displays its source and license before download.

The optional native image pipeline downloads FLUX.2 [klein] 4B Q4 weights, its
Qwen3 4B Q4 text encoder and the FLUX.2 VAE. These components are Apache-2.0;
Nodus also downloads the upstream license texts next to the weights. This
integration intentionally uses the 4B model. The similarly named 9B model is
subject to the separate FLUX Non-Commercial License and is not downloaded by
Nodus. Sources:

- https://huggingface.co/leejet/FLUX.2-klein-4B-GGUF
- https://huggingface.co/black-forest-labs/FLUX.2-klein-4B
- https://huggingface.co/unsloth/Qwen3-4B-GGUF
- https://huggingface.co/Qwen/Qwen3-4B

Nodus is free and open-source software. Some optional Piper
voice datasets, including HFC Female and Ryan, are marked CC BY-NC-SA 4.0 and
must not be reused for commercial purposes. LFM2.5 is governed by the LFM Open
License v1.0, which contains a separate condition for legal entities with at
least USD 10 million in annual revenue. Users remain responsible for uses
outside the license terms of those optional datasets.

## IDprotector v0.4.1 — MIT

Nodus Protect contains a maintainable TypeScript port of algorithms and
behaviour from IDprotector 0.4.1:
https://github.com/Drakonis96/idprotector

Copyright (c) 2026 Drakonis96

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Legalize — legislation by country

The optional **Legalize** chat skill reads public repositories from
[legalize-dev](https://github.com/legalize-dev), created by
[Enrique López](https://enriquelopez.eu). The United Kingdom contribution also
credits [Florin Ungur (@florinungur)](https://github.com/florinungur), and South
Korea credits [@9bow](https://github.com/9bow).

The MIT licence for Legalize's tooling/overview is **not** a blanket licence for
its legislative datasets. Each country retains its source's terms. Nodus does
not redistribute the pipeline, SDK, MCP server, Git, government logos or model
weights. It retrieves Markdown documents over HTTPS and retains their metadata.
The independently written adapter remains under Nodus's licence; retrieved
legislation is not relicensed under Nodus's AGPL.

[The country-by-country attribution and licence register](legal/LEGALIZE.md)
identifies all 32 enabled jurisdictions, their exact reviewed repository
revisions, official sources and terms. Unmodified per-repository LICENSE and
README notices are included in `legal/generated/LEGALIZE_*` and in the normal
SHA-256-verified legal bundle. They are also linked from **About → Licenses and
attribution**. Result cards, saved chat records and text downloads retain
country-specific credits, the source link, declared last update, repository
revision and a statement identifying Nodus's presentation/extraction changes.

Spain: **Basado en datos de la Agencia Estatal Boletín Oficial del Estado**
([BOE](https://www.boe.es)). **Texto consolidado de carácter meramente
informativo.** Reuse follows the BOE conditions approved on 27 June 2024. Nodus
and Legalize are not endorsed by the BOE. The original document's update and
reuse metadata are preserved. Other mandatory source attributions, including
SAIJ, IMPO, Lovdata, Crown/database rights and Korean KOGL type 1, appear in the
country register and alongside applicable results.

## Academic delivery: Paged.js, MathJax and fflate

Nodus Scriptor uses Paged.js (`pagedjs` 0.4.3, MIT, Fred Chasen and contributors, https://github.com/pagedjs/pagedjs) for local pagination; MathJax (`@mathjax/src` 4.1.3, Apache-2.0, MathJax Consortium, https://github.com/mathjax/MathJax-src) and its New Computer Modern font package for mathematical SVG; `fflate` 0.8.2 (MIT, Arjun Barrett, https://github.com/101arrowz/fflate) for LaTeX packages; and `@xmldom/xmldom` 0.9.12 (MIT, xmldom contributors, https://github.com/xmldom/xmldom) for converting mathematical markup to native Word equations. Full package license texts and font notices are included in the generated dependency notices. The browser used by Nodus Server is Chromium; its upstream notices are distributed with the operating-system package.
