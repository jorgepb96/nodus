<p align="center">
  <img src="docs/screenshots/readme-banner.png" alt="Nodus Research, an open-source, local-first research workspace for academic research, teaching, study, databases and Zotero integration. Research deeper, teach smarter, study better. Free forever, no account required, on macOS, Windows and Linux.">
</p>

<p align="center">
  <a href="https://github.com/jorgepb96/nodus/releases/latest"><img alt="Download Nodus Research" src="https://img.shields.io/badge/Download_Nodus_Research-4f46e5?style=for-the-badge&amp;logo=github&amp;logoColor=white"></a>
  <a href="https://nodusresearch.com/"><img alt="Visit the website" src="https://img.shields.io/badge/Visit_the_website-6d28d9?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white"></a>
  <a href="https://nodusresearch.com/demo/"><img alt="Try the interactive tour" src="https://img.shields.io/badge/Try_the_interactive_tour-0f766e?style=for-the-badge&amp;logo=safari&amp;logoColor=white"></a>
  <a href="https://github.com/jorgepb96/nodus/releases"><img alt="Total Nodus Research downloads" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnodusresearch.com%2Fdata%2Fgithub-release-downloads.json&amp;query=%24.total&amp;label=Downloads&amp;style=for-the-badge&amp;color=374151"></a>
</p>

Nodus Research is an open-source, local-first desktop application for university work that brings sources, notes, data, ideas and learning materials together without forcing every project into the same shape.

Each vault is a focused workspace. Researchers can build a connected corpus, historians can document a family tree, teams can explore structured data, teachers can plan and assess their courses, and students can organise an entire degree. You can move between them from one calm, consistent app.

Nodus Research is local first. Your vaults and search indexes live on your computer. You decide when a feature may use an online AI provider, and you can also work with compatible local models.

The interface supports independent light/dark modes, built-in colour themes,
and user-created themes. See the
[appearance and themes reference](docs/appearance.md).

## Install Nodus Research

Download the installer for your computer and open it. There is no server to configure and no account is required to begin.

| Platform | Latest installer | Downloads |
| --- | --- | --- |
| macOS with Apple silicon | [Download DMG](https://github.com/jorgepb96/nodus/releases/latest/download/Nodus-mac-arm64.dmg) | <img alt="Downloads of the macOS Apple silicon build" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnodusresearch.com%2Fdata%2Fgithub-release-downloads.json&amp;query=%24.installers.macosArm64&amp;label=downloads&amp;style=flat-square&amp;color=374151"> |
| macOS with an Intel processor | [Download DMG](https://github.com/jorgepb96/nodus/releases/latest/download/Nodus-mac-x64.dmg) | <img alt="Downloads of the macOS Intel build" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnodusresearch.com%2Fdata%2Fgithub-release-downloads.json&amp;query=%24.installers.macosIntel&amp;label=downloads&amp;style=flat-square&amp;color=374151"> |
| Windows 10 and 11 | [Download EXE](https://github.com/jorgepb96/nodus/releases/latest/download/Nodus-win-x64.exe) | <img alt="Downloads of the Windows build" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnodusresearch.com%2Fdata%2Fgithub-release-downloads.json&amp;query=%24.installers.windows&amp;label=downloads&amp;style=flat-square&amp;color=374151"> |
| Ubuntu and Debian | [Download DEB](https://github.com/jorgepb96/nodus/releases/latest/download/Nodus-linux-amd64.deb) | <img alt="Downloads of the Debian and Ubuntu package" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnodusresearch.com%2Fdata%2Fgithub-release-downloads.json&amp;query=%24.installers.linuxDeb&amp;label=downloads&amp;style=flat-square&amp;color=374151"> |
| Fedora, openSUSE and other RPM-based distributions | [Download RPM](https://github.com/jorgepb96/nodus/releases/latest/download/Nodus-linux-x86_64.rpm) | <img alt="Downloads of the RPM package" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnodusresearch.com%2Fdata%2Fgithub-release-downloads.json&amp;query=%24.installers.linuxRpm&amp;label=downloads&amp;style=flat-square&amp;color=374151"> |
| Other Linux distributions | [Download AppImage](https://github.com/jorgepb96/nodus/releases/latest/download/Nodus-linux-x86_64.AppImage) | <img alt="Downloads of the AppImage" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fnodusresearch.com%2Fdata%2Fgithub-release-downloads.json&amp;query=%24.installers.linuxAppImage&amp;label=downloads&amp;style=flat-square&amp;color=374151"> |

Each counter counts every download of the build in its row across every release — the installer and the update package that the app fetches on its own alike — so the six add up to the total in the header. They refresh with the same deploy as that total.

The standalone Zotero plugin is available from the same release as [nodus-zotero.xpi](https://github.com/jorgepb96/nodus/releases/latest/download/nodus-zotero.xpi). In Zotero 9 or 10, open **Tools → Plugins**, choose **Install Add-on From File** from the gear menu, and select the downloaded file.

The optional [Nodus Connector for Chrome](browser-extension/README.md) captures the open academic
page or document into the local Library. It detects embedded bibliographic metadata, DOI/ISBN and
available files, then lets the user choose a nested Nodus Research collection and existing or new tags before
saving. It reads the active tab only after its toolbar icon is clicked.

The [latest release page](https://github.com/jorgepb96/nodus/releases/latest) always contains the newest available installers and release notes.

## One app, nine vaults

### Academic vault

Build a research corpus from Zotero and turn reading into connected knowledge. Nodus Research can surface themes, ideas, agreements, contradictions and unanswered questions while keeping every claim close to its source.

Its strongest tools include semantic search, an idea graph, author profiles, coverage and gap analysis, reading paths, argument maps, Deep Research and a writing workshop with verifiable citations. A Word companion is available for bringing Nodus Research context into a manuscript.

![Academic vault demo with a twelve-theme knowledge graph in Nodus Research](docs/screenshots/readme-academic-demo.jpg)

Open a theme to explore how its ideas connect, following relationships from one idea to the next.

![Relationships between ideas in the Retrieval practice theme in Nodus Research](docs/screenshots/readme-academic-theme-relations.jpg)

The argument map arranges connected claims into visual branches, making supporting, extending and conflicting ideas easier to follow.

![Nodus Research argument map with connected claims and color-coded relationship branches](docs/screenshots/readme-academic-argument-map.jpg)

Deep Research brings findings, limitations and future questions into a saved report, shown here with an AI-generated illustration.

![Nodus Research Deep Research report on learning science with an AI-generated illustration](docs/screenshots/readme-academic-deep-research.jpg)

Immersion turns a topic into a guided learning route with explanations, author perspectives and practice questions, with an optional image to introduce the session.

![Nodus Research Immersion learning route with an AI-generated illustration](docs/screenshots/readme-academic-immersion.jpg)

### Genealogy vault

Document people, relationships and evidence in a research-led family archive. The tree, timeline, map and records library stay connected so that a family story never loses its documentary basis.

You can import and export GEDCOM, attach records to people and events, review suggested relationships before accepting them and investigate a lineage with dedicated research tools.

![Genealogy vault demo in Nodus Research](docs/screenshots/readme-genealogy-demo.jpg)

### Databases vault

Create approachable databases for projects that do not fit a spreadsheet. Tables support typed fields, relations, formulas, rollups, filters and reusable views.

CSV import makes it easy to begin with existing material. Analysis, chat and AI-assisted columns help you classify records, find patterns and answer questions across the dataset.

![Databases vault demo in Nodus Research](docs/screenshots/readme-databases-demo.jpg)

### Study vault

Organise subjects, reading, class notes, recordings and deadlines in one place. Materials can include documents, PDFs, EPUB books and audio, with tools for transcription and focused reading.

Nodus Research turns those materials into study support grounded in your own course content. It includes course planning, connected ideas, a subject graph, question banks, practice tests, exams, flashcards and spaced review.

![Study vault demo in Nodus Research](docs/screenshots/readme-study-demo.jpg)

### Teaching vault

Plan academic years, courses, subjects and teaching groups in a workspace built for educators. Timetables, calendars, materials and recordings remain connected to the classes they support.

Teaching tools cover private student rosters, gradebooks, reusable rubrics and exam building. AI can generate teaching materials, questions and rubric structures, but Nodus Research does not send rosters, grades or student answers to a model and does not use AI to grade, profile or evaluate students.

![Teaching vault demo in Nodus Research](docs/screenshots/readme-teaching-demo.jpg)

## Nodus Toolkit

The Toolkit brings practical document tools together in every vault. Convert changes files between common formats, Protect combines files and adds permanent redactions, watermarks and traceable copies, and Translate works with text, files and Zotero attachments while preserving DOCX and EPUB structure. PDF Presenter and OCR Workspace complete the set. Nodus Drift, still in development, mixes ambient sounds while you read or study; it works offline and never uses the network.

Drift defaults to its recommended catalogue order. The sorting menu also offers alphabetical order, category followed by name, and most used first, with alphabetical ties and unused sounds at the end. The chosen order and use counts stay local. Sounds count a use when playback starts successfully; saved presets count their explicit loads and use their associated icon when sorting by type.

You can open material from disk or from compatible vault sources, then save the result, share it or return it to the vault. Nodus Protect processes documents entirely on your computer and never sends them to an AI provider. Translate only uses the model you choose when you ask it to.

![Nodus Toolkit showing Apps, Convert, Protect, Translate, PDF Presenter and OCR Workspace](docs/screenshots/readme-toolkit-demo.png)

## Skill marketplace

Open up new possibilities and make Nodus Research your own. The [Nodus Skill Marketplace](https://github.com/NodusResearch/nodus-research-skill-marketplace) extends the app with community-created research methods, creative tools and specialized workflows, helping you get more from the Assistant, native chats and Nodi. Discover skills and plugins, adapt them to your work, or share your own: every contribution expands what Nodus Research can do.

Open **Skills → Marketplace** to browse the official catalog, review a package and install it. Use **My skills** to configure your library and enable skills for the Assistant or Nodi. You can also add public GitHub repositories as sources, opening the door to an ever-growing ecosystem of tools for research, teaching and study.

[![Nodus Research window in English with the Skill Marketplace modal open](docs/screenshots/readme-skill-marketplace.png)](https://github.com/NodusResearch/nodus-research-skill-marketplace)

**Explore and contribute:** [Marketplace repository](https://github.com/NodusResearch/nodus-research-skill-marketplace) · [Browse the catalog](https://github.com/NodusResearch/nodus-research-skill-marketplace#browse-the-catalog) · [Create and contribute](https://github.com/NodusResearch/nodus-research-skill-marketplace/blob/main/CONTRIBUTING.md) · [Package specification](https://github.com/NodusResearch/nodus-research-skill-marketplace/blob/main/SPECIFICATION.md) · [Using skills in Nodus Research](docs/chat-skills.md) · [Marketplace integration guide](docs/skill-marketplace.md).

## Zotero plugin

The standalone Zotero plugin supports Zotero 9 and 10. It brings Nodus Research search into your reference manager and indexes PDF, EPUB and HTML attachments so you can search across them and receive answers grounded in exact passages. PDF citations can jump to their page; EPUB and HTML citations remain clearly marked as non-navigable until Zotero exposes a stable chapter or anchor locator.

Semantic search works across languages and combines with keyword search. The index stays in your Zotero profile, Vision can read scanned pages, figures, tables and formulas, and an evidence audit highlights claims that need stronger support.

![Zotero plugin with a sample PDF, source selection and evidence preparation controls](docs/screenshots/readme-zotero-plugin-demo.png)

## Meet Nodi

Nodi is the friendly guide that lives inside Nodus Research. It helps new users understand a vault, points out useful next steps and keeps notifications easy to follow without taking over the workspace.

![Nodi introducing itself inside an English demo vault](docs/screenshots/readme-nodi-demo.jpg)

## Share a vault with Nodus Server

Nodus Server shares a selected copy of a vault while the original database and documents stay on the owner's computer. Readers can search published spaces from Nodus Research, ChatGPT or Claude. Owners choose what is included and can give each person reader, writer or owner access.

Nodus Research can now start a private server from Settings for access on a phone or tablet through Tailscale or the local network. Groups can instead run the Docker version on their own server and manage spaces, people and devices from the web. Both options are experimental. See the [Nodus Server installation guide](server/README.md).

## A library shared by every vault

Nodus Research keeps one cross-vault Library inside `nodus-library`, nested under the
backup folder you choose. It can mirror a complete Zotero library with its
collection hierarchy and stable item keys, import RIS, BibTeX and CSL JSON from
Mendeley or other managers, or accept local documents directly.

Each original remains separate from a clean Markdown reading copy, extracted
figures, structured tables, page mappings, highlights, notes and document chat.
On first open, the reader asks whether to use the clean copy or the preserved
original and can remember that choice; it can be reset from **Versions and
files**. The same chooser switches between clean Markdown and preserved PDF,
EPUB, image, web, text and office attachments. Text can be highlighted in the
reflowable and PDF viewers, while images accept region highlights. Unsupported
legacy binaries open in their associated application without modifying them.
The citation manager uses real CSL styles, including custom `.csl` files copied
from Zotero, and formats them locally after installation. A document can then be linked into any compatible vault
for search and analysis without duplicating the global copy. See the
[architecture, recovery and privacy guide](docs/global-library.md).

## Cite Nodus Research

If Nodus Research contributes substantially to research that leads to a publication, please cite the version you used and credit **Jorge Pérez Burgueño and Nodus Contributors** as the authors. The repository provides machine-readable citation metadata in [`CITATION.cff`](CITATION.cff), which GitHub can render in APA and BibTeX formats. Use the [conceptual Zenodo DOI (10.5281/zenodo.21515531)](https://doi.org/10.5281/zenodo.21515531) for the project across all releases, or the [Nodus Research 4.2.2 DOI (10.5281/zenodo.22041926)](https://doi.org/10.5281/zenodo.22041926) for the current archived version. Ready-to-use formats are available at [nodusresearch.com/cite/](https://nodusresearch.com/cite/).

## Explore before importing anything

Every working vault includes a demo mode with sample content. It is the quickest way to understand how Nodus Research feels and what each workspace can do.

You can also visit the [interactive browser tour](https://nodusresearch.com/demo/) without installing the app.

## License

Nodus Research is licensed under the [GNU Affero General Public License v3.0](LICENSE), SPDX `AGPL-3.0-only`.

Contributions require acceptance of the [Contributor License Agreement](CLA.md).
Contributors retain ownership and grant the maintainer permission to sublicense
and relicense their contributions, including under commercial terms. See
[CONTRIBUTING.md](CONTRIBUTING.md#accepting-the-cla) for the acceptance process.

## Disclaimer

Nodus Research is a personal, independent open-source project. It currently sells no product or service and is not affiliated with, sponsored by or endorsed by any university, research group, company or unrelated software project that uses “Nodus” or a similar name. See the [name and independence notice](NAME_NOTICE.md).
