# Changelog

## 5.8.1 — 2026-10-09

### New features

- Nodus Scriptor, in Tools, lets you write and organize documents with rich text, tables, images and formulas. Insert sources and ideas with [[, add citations, bibliographies and notes, assemble chapters and export to Word, PDF or LaTeX. It includes version history, fullscreen writing and AI text improvements that you can cancel or undo. Available on Desktop and Server web.

### Enhancements

- Chemistry Studio templates take each scheme’s reagents into account. Index preparation validates atom mapping and lets you exclude schemes with mechanism or stereochemistry problems.

- Research Chat adjusts response length to the available context space and the model’s limits. Supported models can produce longer answers and synthesis routes with fewer interruptions caused by the output limit.

### Fixes

- Synthesis route checks use the substances declared in the text and retain repeated salt components. They identify steps that could not be checked and show where structures came from. A route diagram is generated only when the route passes its checks.

- Results saved by plugins record the version of the content that produced them. Replacing an installed package no longer makes a result report an older plugin version.

- Research Chat retrieves passages correctly in large libraries and with lengthy instructions. Saved citations keep resolving and new citations are no longer blocked by the previous limit. The context includes works that contributed to the query without adding unrelated titles.

- The Nodus add-on for Zotero can save API keys and connection credentials in Zotero 10 again. It uses Zotero’s password manager and confirms that credentials have been saved before continuing.

- Installation packages include only files from the current build. Copies from earlier builds are removed to reduce the application’s size.

## 5.8.0 — 2026-10-03

### New features

- Nodus Scriptor, in Tools, lets you write and organize documents with rich text, tables, images and formulas. Insert sources and ideas with [[, add citations, bibliographies and notes, assemble chapters and export to Word, PDF or LaTeX. It includes version history, fullscreen writing and AI text improvements that you can cancel or undo. Available on Desktop and Server web.

### Enhancements

- Nodus Focus is available in Tools for all nine vaults. Switching vaults does not interrupt the timer. Navigation adapts to each vault and the shared history records time spent in each one. Previous histories are retained and each vault’s shortcuts can be customized.

- PDF Presenter adds an alternative native connection for the mobile app on macOS. Enable it by starting Nodus with NODUS_PRESENTER_TRANSPORT=multipeer. This connection improves the responsiveness of the pointer, highlighting and drawing.

- Synthesis queries with Chemistry Studio can use recorded reaction conditions, schemes from your books and commercial stock lists you import. The report shows sources for each step, material availability and possible incompatibilities between reagents and functional groups. Route search also considers reagents in the schemes. Requires Chemistry Studio 2.5.8 and the corresponding local indexes or lists.

- Idea search in Research Chat is faster when you select many works. It keeps the same selected-corpus boundaries and avoids checking every work separately for each idea.

- The Linux AppImage supports updating Nodus with external AppImageUpdate tools. The release includes the required metadata and a .zsync file. The built-in updater and previous download links remain available.

### Fixes

- Long presentation names no longer widen the PDF Presenter sidebar or hide the options button. Cards fit the available width and retain vertical scrolling.

- The browser keeps the page visible when you open menus and dialogs. When you resize the sidebar, the page adjusts without overlapping navigation.

- PDF extraction and source retrieval no longer lose a completed result when their background process exits. Research Chat can receive it while other intensive tasks are running.

- Turning reasoning off no longer causes errors with models that require a specific setting. Nodus uses the supported opt-out or the lowest permitted level when reasoning is mandatory. It preserves your chosen level when reasoning is enabled.

- Update status appears once in the banner below the header. The banner stays visible during backup and installation, including when you install a postponed update from Settings.

## 5.7.4 — 2026-10-02

### New features

- PDF Presenter lets you control a presentation with the iPhone/iPad app by scanning a QR code on macOS, Windows and Linux. The app receives slides and notes and lets you navigate, use the pointer and control the timer and videos. On Windows and Linux, both devices must be on the same local network. Browser control remains available.

- Text extraction can simplify reaction schemes and figure fragments in new PDFs while preserving body text, captions and references. The option is enabled by default in Settings, Text extraction. Previously processed documents keep their existing extraction.

### Enhancements

- PDF Presenter organizes presentations in folders and subfolders. Search them, move them with the menu or drag them, and choose whether to keep their copies when deleting a folder. Existing tags become folders without losing notes or videos. In presenter mode, you can resize the slide previews and notes area.

- Library orientation summaries are generated with reasoning turned off to avoid extra usage on models that support disabling it.

### Fixes

- Nodus retries once when a response loses its connection before delivering text. Research Chat also retries once when a response reaches the output limit during reasoning.

- Immersion can read pages of originals available in Zotero and include citations that open them. Research Chat distinguishes local sources from actual Zotero MCP queries and reports connection failures or queries that return no readable pages.

- In Study and Teaching calendars, day numbers no longer overlap events in the month view.

- The macOS volume control follows system changes and keeps the latest value when you adjust it rapidly. Browser controls identify the active player more accurately to pause and resume readers with custom audio.

- The Documentary Index waits for pending passage indexing of the same work to finish so its result is not discarded. While text is being prepared, progress shows “Preparing…” instead of “passage 1/0”.

## 5.7.3 — 2026-09-30

### New features

- Nodus Drift lets you combine up to six ambient sounds, noises or binaural tones offline. Adjust each sound’s volume, save named mixes and find sounds through search, favourites or categories. It has a fullscreen view and a player that lets you control the mix while using other Nodus tools.

- The complete study guide generates chapters from the materials, notes and recordings you select. It includes cited explanations, concepts, formulas, self-check questions and a review sheet. You can add figures from your materials and optional web content, labelled separately. Before starting, it shows an estimate of cost and time. Export the guide to PDF, Word or Markdown, or download just the review sheet.

- In Settings, you can check which favourite models are absent from their provider’s catalogue. Remove them from favourites or replace them in every task that uses them. If a catalogue cannot be read, the check reports it. A model absent from the catalogue may still work as an alias.

### Enhancements

- The Library identifies works whose text was mainly recovered through OCR and shows how many pages were not processed because of the OCR limit. It distinguishes those pages from pages without recovered text and only shows the limit when it is recorded in the extraction data.

- Updating saved citations to the correct passages takes less time when opening a vault. The repair avoids repeated queries over the same sources, especially in large libraries.

- Research Chat prepares the source inventory faster in large corpora and reduces the text sent to the model to describe the query scope. Saved coverage includes only consulted sources. If a request exceeds the model’s limit, the notice explains which part is too large and what you can reduce.

### Fixes

- Nodus uses the context and input limits reported by each provider and also applies them to report generation. It preserves custom limits if catalogue discovery fails and budgets reasoning and response space separately. This avoids rejecting valid requests or exceeding the model’s limit.

- AI responses that keep sending text or reasoning no longer stop at three minutes. The timeout tracks inactivity, with a total limit that prevents requests from running indefinitely.

- Sync archives works in Nodus when they are trashed, deleted or merged in Zotero. It preserves their notes and analysis, lets you restore them if they return to Zotero and retries pending checks if the connection is interrupted.

## 5.7.2 — 2026-09-29

- Research Chat now plans each turn. It rewrites your question as a goal that stands on its own, keeps the topic of the conversation, looks up the authors and titles you mention in the library catalogue with accents folded and one typo tolerated, and reads several sources before answering. If an answer rests on fewer than three independent sources while candidates remain unread, it rejects the answer and names those candidates.
- Follow-up questions keep the thread. Earlier citations come back to the conversation, the answer lists only the sources that took part with their author and year, and it explains in plain words what it searched, looked up and read. It no longer says an indexed work has no index, and it no longer states that Zotero is unavailable.
- Research Chat answers without freezing the window. On a library of 1,229 sources the longest block of the interface fell from about five seconds to under one. A question also no longer fails when one of the stored ideas has no statement.
- Preparing documents is faster and takes less space. Two documents are prepared at the same time, each document keeps up to four batches of vectors in flight, remote embeddings are requested in parallel, the source is checked at most every five seconds instead of on every page, and vectors are stored once in a compact format. The store is compacted in the background and semantic search is faster.
- Only real scans wait for OCR. A digital book is no longer sent to OCR because it has a single image-only page, and the preparation preview and the preparation itself now use the same rule.
- Graph health in Settings, Data now also detects relations from an idea to itself and repairs them.
- A citation now rests on the passage that holds the quoted text, inside its own source and as close as possible to its page. Supports published earlier are re-pointed once per vault.
- A section's page range stays inside its own source. It no longer ends on the page of the next attachment.
- Library records are cleaner. An idea can no longer be related to itself, two ideas from the same scan with the same statement are joined into one, and the checkpoints of a failed job are dropped when a later one succeeds.
- Extracted text arrives complete. The characters that made a query stop reading at that point are replaced, so a passage no longer reports a shorter length or a cut-off snippet. A work whose document profile failed no longer appears in red as if it had no profile at all, and the row now says the profile failed and offers the retry.
- After a reprocess pass, only the ideas whose theme text changed are converted into vectors again, once each, instead of the whole library. This applies to the automatic pass and to both manual reprocess actions.
- The Linux packages start again on Ubuntu 22.04, Debian 12 and other systems with glibc older than 2.38. Version 5.7.1 stopped before its first window with the message GLIBC_2.38 not found. Linux packages are now built on Ubuntu 22.04, and the release fails if any bundled library needs a newer glibc.
- Updated the desktop, server, Zotero and browser connector versions, source release links, citation and website metadata.

## 5.7.1 — 2026-09-28

- The indexing welcome answers at once: its Yes, start button no longer stays disabled behind Loading… while Nodus inspected every unindexed PDF, one after another, before letting you choose. That per-file check is only shown when managing the preparation, so the welcome no longer waits for it.
- The What’s New modal is the 5.7.0 one, unchanged.
- Updated the desktop, server, Zotero and browser connector versions, source release links, citation and website metadata.

## 5.7.0 — 2026-09-28

- In academic vaults you can prepare your works to query their full text without extracting ideas. Research Chat and Deep Research answer with passages from that text and with the available ideas, and every citation points at the original and keeps the exact revision of the source. Extracting ideas is a separate, optional step, and the preparation notice explains the difference.
- Research notebooks group the sources of a conversation: a fixed selection of works, or Zotero collections that stay linked, with their subcollections if you ask for them. A notebook's chat reads only those sources and says so when the documentary coverage is partial. You can prepare the sources from the notebook itself, without generating ideas or profiles.
- The chat's Context balloon now has three switches: Ideas, Documents and Web search. A layer switched off is not consulted at all, and with all three off the answer relies on general knowledge and cites nothing. The activity balloon shows what each layer is doing, and how many results it found, while the answer is being written.
- Research Chat can search the web when the library is not enough or when you ask it to. Nodus uses a search engine bundled with the application, reads the pages it finds and cites passages with their address, like any work. The citation opens the page in Nodus Browser. The search never works around a block or a CAPTCHA.
- Synthesis routes are checked against the systematic IUPAC name as the reference. The model writes the names and the role of every step, and Nodus derives and balances the structures with RDKit. When a step fails, the notice offers to fix all steps, to fix from the final product backwards, or to fix one specific step. A model review marks the route as not verified when it finds a problem in a structure.
- Historical maps are drawn with the divisions of the period you ask for, retrieved from OpenHistoricalMap, and the result states the period, the licence and what was left out. Labels that do not fit inside the frame are dropped without covering the map. When a value in the request is not valid, the notice names the property to correct.
- Settings, Data includes Graph health in academic vaults: it checks the ideas, the themes and the relations, and repairs without AI whatever can be fixed, after saving a copy of the vault. The repair also clears the themes an earlier bug left dangling and can analyse the affected works again. Analyses no longer fail because of links to dormant ideas or to deleted themes.
- The thinking level is remembered per model: when you pick a model again, the chat opens with the level you used with it. A model you have never used opens on the middle level of its own ladder, not on Standard. The same control and the same memory are in the Deep Research and Immersion forms.
- Conversations with Claude models no longer fail when the provider changes the parameters it accepts: Nodus repeats the request once without the rejected parameter and remembers the change for the next ones. If the model declines the request, or the answer is cut off at the token limit, the notice says so in those words instead of showing an empty answer.
- When a conversation continues, Nodus sends the model only the text the model wrote, not the blocks the application adds, such as drawings, tool results or correction instructions. In a real conversation this removed 92 % of the replayed text, and it keeps the provider from reading those instructions as commands.
- Native menus follow the interface language: the cut, copy and paste menu of text fields and the Nodus Browser context menu no longer appear in Spanish when the interface is in another language.
- Text that appeared in English although a translation existed was corrected: 93 keys in Italian and between 13 and 14 in the other European languages. Translations with the wrong sense were also corrected in Japanese, Korean, Turkish and Italian, among them immersion, stations, the database chart types and a duration in minutes.
- The first-run guide offers every interface language, including Traditional Chinese and Korean, and each option switches the interface to that language. The model guidance slides are now translated into all twelve languages. Each language also uses a single term for vault throughout the interface.
- In Study vaults you can run focus sessions in blocks, with an intention per block, manual transitions and a progress page. Focus mode replaces the sidebar with a rail holding the timer, the subject and its notes and materials. The mode can be customised per vault, it turns on when you start a block, and you can turn it off.
- Workspace notes can be linked to courses, subjects, folders, topics and specific materials. The note is not copied: it stays in the Workspace and also appears in every linked place, with a badge saying so. A material opens a panel with its notes, and new Study and Teaching vaults show the Workspace in the sidebar by default.
- The Study and Teaching calendar exports one event or the whole calendar to Outlook as an .ics file. On macOS you can choose an Apple calendar and enable sync: Nodus creates, updates and deletes its own events while it is running, in one direction only, from Nodus to Apple. Outlook imports are a copy and do not update themselves, and Google and Exchange stay out of automatic sync.
- Research Chat's history organisation reaches the databases and worldbuilding vaults, and Study and Teaching: projects, nested folders, notebooks, pinned conversations, archive and search. The rules are the same in every history: deleting a folder deletes no conversation, a conversation pointing at a folder that no longer exists is re-filed by itself, and folder changes travel to the other devices.
- The help text of interface elements is shown in a layer of Nodus's own, following the light or dark theme of the application, instead of the system notice. It appears sooner, it is placed inside the window, and long text wraps onto several lines.
- In the Research Atlas each filter now holds several values at once, each with a checkbox. Values of the same filter add up and values of different filters combine. The panel stays open while you choose, and the pill summarises the selection, for example 2 selected.
- Tabs and bookmarks in Nodus Browser show each site's icon again, including bookmarks saved earlier. When a site declares only an SVG icon, Nodus looks for the site's usual icons. The globe is left only for pages that offer no icon at all.
- In Teaching, every group has two tabs: Students and Attendance. Attendance is marked per day in a week or month view, with four states, present, excused absence, unexcused absence and late, and an optional comment per cell. You can mark everyone present and mark a day as a holiday, and copy the holiday to the groups that share that day. Per-student totals export to CSV or XLSX for a course, a subject, a group or one student.
- Added the 5.7.0 What’s New modal in all twelve interface languages.
- Updated the desktop, server, Zotero and browser connector versions, source release links, citation and website metadata.

## 5.6.0 — 2026-09-20

- When creating an academic vault, you can choose Auto or Manual. In Manual mode, importing or syncing documents does not automatically generate ideas or themes. The choice is saved for that vault and cannot be changed after creation.
- Manual mode lets you write ideas and add quotations, works, themes and connections in one form. All these links are optional. Ideas are indexed locally for search, without generative AI. Research Chat and Deep Research can use them when you run those tools.
- Concilium is a new Research Chat feature that lets you consult two to five models with the same question, sources and files. The model you choose as coordinator writes the final answer from the individual responses. You can open each response and inspect errors, even after reopening the conversation.
- Graph themes open in separate tabs. You can show the whole theme or ideas within one, two or three connections of the selected idea, and limit the connections drawn per idea without hiding ideas in the selected set.
- Updates appear in the header notice without opening a second dialog when the app starts. The notice shows progress and the available actions.
- The warning about a missing AI model configuration appears in Notifications. You can open the relevant settings from there to complete the configuration.
- The Research Chat header keeps its controls within the available space and removes duplicate actions. This makes it easier to use in narrow windows.
- In Study and Teaching, you can select chat sources by course, subject and folder. Search finds titles, filenames, tags and locations. You can select groups and keep your selection while filtering.
- In Study and Teaching, you can move notes and materials between locations from the list or grid. Content, annotations, generated knowledge and other locations are preserved. Folders and topics use the same move action.
- Nodi searches the Nodus documentation for information relevant to your questions about the app. This provides more complete information about features, settings and procedures. The Skills picker also avoids horizontal scrolling.
- Nodus Tools brings utilities and research tools together in a searchable catalogue. You can open a tool from the catalogue and pin it individually to the sidebar.
- The Zotero plugin closes its database on exit, even if you closed the sidebar first. This fixes a problem that could prevent Zotero from shutting down and block the next launch.
- Added the 5.6.0 What’s New modal in all twelve interface languages.
- Updated the desktop, server, Zotero and browser connector versions, source release links, citation and website metadata.

## 5.5.0 — 2026-09-18

Nodus speaks twelve interface languages, the local engine reaches the GPU on
Windows and Linux, and the app gains colour palettes.

- Traditional Chinese, Japanese and Korean join the nine interface languages, so the whole application, Nodus Server Web, the server-rendered pages and the pipeline logs render in 繁體中文, 日本語 or 한국어. Every catalogue carries the same keys as English. The Traditional Chinese column is written in Taiwan-standard vocabulary rather than converted glyph by glyph, and the Japanese and Korean columns are a machine-translated first pass that a native speaker has not reviewed yet, with two known stylistic inconsistencies (저자/작성자, 테마/주제). Prompt languages already included all three and are unchanged. The portable-profile allowlist keeps zh-CN, zh-TW, ja and ko, and a zh-TW prompt resolves to zh-Hant.

The application gains colour palettes, chosen independently of the light and dark mode.

- Appearance settings offer sixteen palettes plus the original look, and a theme editor that defines the accent, the application background for each mode, the light and dark surfaces, the two text colours and a surface tint. Saving requires full six-digit hex colours and refuses a combination below the contrast minimum of 4.5 on any of the six checked text and background pairs.
- A palette belongs to one vault or to all of them, and light and dark stay common either way. The same system drives Server Web, and the last palette is painted before the app starts so the default never flashes on screen.

Integrated local models run on the GPU on Windows and Linux instead of the CPU-only engine the installer used to fetch (issue #851).

- The local engine is now the build this machine can actually accelerate with. Windows and Linux used to install the CPU-only llama.cpp archive even on a machine with a discrete GPU, so every local model ran on the processor while the launcher still asked for `--n-gpu-layers 999`, an option a CPU build ignores. The installer picks the GPU build for the host, runs it once to confirm it can see a device (`--list-devices`), and falls back to the verified CPU archive only when it cannot. Installations made by earlier versions are upgraded on first use, without re-downloading any model.
- GPU layers are fitted by llama.cpp itself. Windows and Linux stop forcing a layer count and let the pinned runtime's own fitter place as many layers as fit in the device memory it measures, while the context size stays exactly the one Nodus asked for. macOS keeps its Metal path unchanged.
- Settings → Integrated local models reports the engine instead of assuming it: the installed archive, the backend, the device the runtime itself reported with its memory, how many layers reached the GPU, whether an NVIDIA driver was seen (reported, never claimed as the backend), the recorded concurrency measurement and the reason the CPU engine was chosen when that happened. A "Recheck engine" action re-probes the runtime and installs the best build the machine can use.
- A local run can no longer look frozen for reasons the user cannot see. Concurrency is no longer measured automatically when a model is downloaded or selected, so the first inference never waits behind a synthetic benchmark; measuring stays available as an explicit action. Each health check is bounded, startup failures name their cause — including a security product blocking the binary, with the folder to exclude — and every backend decision is appended to `local-ai/runtime.log` next to the models.
- A cancelled runtime upgrade no longer leaves the machine without an engine: the new build is unpacked and probed in a staging directory and only then swapped in.
- Idea fusion finishes on the integrated runtime. A small model answers a new idea with `merged_label: null`, which the decision validator rejected while the code that consumes the decision already fell back to the idea's own label, so every affected idea was reported as invalid JSON and its whole work ended failed after a successful extraction. The label is now optional and falls back. The output ceiling was also too small: a reasoning-capable model spends part of an 800-token budget before the JSON starts and the reply arrives cut off. Fusion asks for real headroom and retries a cut-off answer once at a larger ceiling, exactly as the summary already did.
- When a structured reply is rejected, the log says why: the idea being fused, how many candidates it was judged against and the exact failure (truncated, invalid JSON, schema miss), with a bounded preview of the reply itself.
- Granite 4.0 Micro is no longer offered for extraction or fusion. Validated end to end on Windows with an RTX 3060 Ti over six arXiv papers, it extracted ideas correctly but violated the fusion decision contract on every large work — a prose explanation where the contract requires `explicit`/`inferred`, and edge types in place of a resolution — which deterministically failed whole works even after their extraction had succeeded. It stays available for conversation, summaries and document profiles. Gemma 4 E2B remained the only local model that completed all six works.

Nodus Research Connector speaks thirteen languages and every message it composes comes from the catalog of the language in use.

- Nodus Research Connector ships the nine interface languages plus Japanese, Korean, Russian and Traditional Chinese, which the extension gains ahead of the desktop interface. The popup, the settings page, the privacy page it opens and the document-type list you review before saving stop being English only, and the privacy page is localized for the first time instead of existing in English alone.
- Every message the extension writes by itself is translated as well. The 64 MiB transfer notice, a failed download, the sign-in page a publisher returns instead of the PDF, the errors the Manifest V3 worker reports back into the popup and the labels the detector saves when a page brings none now come from the catalog of the language in use, so the Spanish connector stops mixing English into its own interface.
- The document-type table moves into the shared presentation module with all thirteen languages. Nodus Browser's built-in connector dialog renders the reviewed type in the language you work in, and a legal hearing stops being translated as an audience.

The queue bar's live line only moves forward.

- Fragment extraction runs several chunks of the same work in parallel and every worker wrote the same line, so the counter, the percentage and the seconds changed owner whenever another worker reported: "Analizando fragmento 4/4 … (92s)" was followed by a fragment that had just started, and the number read as jumping backwards and forwards for the whole analysis. The line now belongs to the phase — the counter names the oldest fragment still in flight, the percentage counts fragments finished and the seconds measure the phase — and all three only advance.
- A deep scan reports one percentage for the whole analysis instead of restarting it at every step. The bar used to reach 100 % while reading the pages and fall back to 5 % when the model started, and fusion dropped to 0 % right after the fragments finished at 92 %. Extraction owns the first half of the work, the analysis the second, and the phases that cannot be sized (the required summary, indexing, the OCR pass over problem pages) report no percentage at all instead of parking the previous step's number next to an unrelated label.
- With several works in flight the bar narrates the oldest one still running instead of the last one to start, so the title, the elapsed time, the fragment counter and the percentage stop re-pointing at another work every time a slot frees. The row changes only when the work it was showing ends.

Graph post-processing says what it is doing, and stops failing the same way.

- Its line carries its own clock. Grouping ideas into themes and validating semantic pairs are one model call per batch and report nothing while that call is in flight, so the bar stood still for minutes with no way to tell work from a stall; the label now ticks the pass it is running, next to the reason it is running at all.
- Retry is no longer indistinguishable from doing nothing. The amber banner kept showing the previous failure while the retry was already running — the queue line underneath was the only sign — so a click that did re-run the step looked dead, and a failure that repeated itself looked identical. While an attempt is in flight the banner says it is retrying, names the attempt and ticks the clock; once it stops it brings the reason back with the attempt count beside it.
- A batch is bounded by the text it carries, not only by how many items it holds. Thirty long statements filled the model's window by themselves, so the planner could reserve only 512 tokens for the answer: the reply arrived cut mid-JSON and the whole post-processing failed with "the response was cut off at the 512-output-token limit", a failure every retry reproduced because nothing about the request had changed. Keeping each request inside a text budget leaves the planner the room the task asks for, and the batch counter advances once per request instead of standing at (1/1) on a heavy vault. Theme checkpoints are keyed by the new policy, so batches written under the old batching are not reused.

A custom OpenAI-compatible endpoint is treated as local when it is, and a gateway that refuses the optional request body no longer ends the scan (issue #802).

- A custom endpoint on the user's own machine gets the on-device completion budget. Nodus gave the longer deadline by provider id, so a llama.cpp, vLLM or LiteLLM server reached through the custom provider — the setup that provider exists for — was held to the three-minute cloud ceiling and timed out on every long extraction chunk, with no setting able to say otherwise. The locality is read off the address the user already typed: loopback, a private range, an IPv6 unique-local address, a container host alias or a private-network name all count, and an endpoint reached over the internet keeps the cloud ceiling. Nothing new to configure.
- A refusal that names no field is now replayed instead of failing the work. Every JSON call carries `response_format`, and a deep scan of a thinking model also carries a reasoning hint; a proxy in front of a real API often answers a bare 400 that names neither, and the recovery only ran when the reasoning hint had been sent and only dropped that one field — so a gateway that refused `response_format` matched no branch at all and the library ended on "the provider rejected the request (400) without explaining why". The request is replayed without the reasoning hint first, which keeps JSON mode, and then as the plain OpenAI body, which is what a gateway that refuses both needs. The field that landed is remembered for the session, so a long library costs one request per chunk instead of walking the ladder again. Recovery stays bounded at three requests per call, a refusal that names the field keeps its single replay, and anything other than a 400 or 422 is still the provider's own answer.

Batch judgements no longer fail on a model that reasons before answering.

- The output budget for a batch of judgements — theme assignment, relation validation, semantic bridges and chapter typing — now pays for the trace and the JSON separately. It used to be the item count times a per-item allowance with a floor of 512 for a single item, which assumes a model that answers directly; a model that reasons is charged for its trace out of the same budget, and the JSON only starts after it. Measured on the engine Nodus ships, with Gemma 4 E2B and real ideas from a scanned paper: one relation judgement at the old 512-token floor came back with no content at all and finished at 2.000, and a full batch of fifteen came back empty at the old 3.136-token allowance and finished at 5.000. "Reprocess theme connections" failed on exactly that, and a single pair cannot be split to buy room: the fallback clips the input text, which is not what ran out.
- A judgement that is cut off anyway is retried once with more room, the same recovery work summaries and idea fusion already had. A reply that parses but misses the schema is not retried that way — more room would not change its shape — and a request that already asks for the ceiling is left to the batch splitter instead of being repeated unchanged.

A citation opens the page it names, and the Library stops corrupting the text of two-column papers.

- The citation dialog turns each anchored row into a "View page N" button, the passage panel names its own page, and every surface that jumps to a work — the graph detail panel, the argument map, the document profile, the debate view, study material and the Nodi overlay — hands the reader the cited page instead of page one. A slide deck opens on its slide, the Library applies `readerPage` once and clears it so switching tabs never bounces the reader back, and a work with no page-capable copy anywhere still offers no button it cannot honour.
- Library extraction reads a two-column page column by column. The left column's last line no longer joins the right column's first, gutters are tracked across paragraph breaks, and the pipeline moves to `nodus-clean-markdown/11`, so documents already in a library are re-extracted automatically instead of keeping the corrupted text. Verified on three real two-column papers. A paragraph continuing onto the next page is still split at the boundary, a known limit left open on purpose.
- The Documentary Index publishes the profiles its acceptance gate keeps instead of failing the work. A partial synthesis is accepted and marked as partial, a chunk below `MIN_SECTION_WORDS` merges into a neighbour so a title page cannot degrade a whole profile, the index follows the configured prompt language, the audit score is a defined 0-1 scale against the 0.8 acceptance threshold, and the failure lines shown in the UI are translated. Re-indexing a work is possible again.

Study takes work out of the application in two new ways.

- A chat answer can be saved as a study note. The Save to notes dialog gains a destination that asks for course, subject, optional folder and topic, and the note stores the answer followed by its provenance: the conversation title, the date, the provider and model that wrote it, and the cited sources as links.
- Reports export to Word (.docx) from the report reader, from the bulk archive — one document per report inside the ZIP, next to the existing Markdown and PDF choices — and from the database research reader, where the export is redacted exactly as the Markdown one is. Figures are embedded in the document instead of left as Markdown, and the bibliography no longer drops study-material citations.

The research assistant inspects molecules with RDKit when Chemistry Studio is enabled.

- SMILES in the question are parsed locally by RDKit, with no drawing and no model call, and injected into the prompt as verified context, so the model reasons from the canonical structure instead of the raw text. A synthesis route gets one drawing per verified step plus a report of the steps the checker refused, and a refused route adds a one-click chip that sends the checker's own correction request as the user's next message. The bootstrap pin moves to Chemistry Studio 2.3.0, the version whose worker performs the route check.

Every model that runs on this machine is marked in red.

- The warning appears beside the text model, the embedding model, every per-task row and both wizard pickers, and explains what to expect from a local model: they may be slow, Gemma is currently the recommended one, and Ollama and LM Studio are supported while cloud providers are the most tested. A profile that already chose a model keeps it, and the new-vault wizard no longer preselects one, so choosing a local model is a deliberate act. `isLocalModelProvider` covers `nodus`, `ollama` and `lmstudio` and deliberately leaves custom endpoints out.
- Models served as `deepseek-flash` and the pinned `deepseek-v4-*` names get their reasoning-effort control back, on the native route and on OpenCode Go, instead of reporting that the model publishes no thinking control. An endpoint that answers a 400 naming `temperature` as deprecated is replayed once without that field and the model is remembered for the session, while an unnamed refusal, a 5xx or a 429 is never replayed.
- Visual resources for a document are generated with the model chosen in the enrichment dialog, which opens on the task's model rather than the one stored on the report. The choice travels with the request and with Retry, and a document that keeps no figure now says how many proposals were discarded and why, with the motives persisted in the manifest and counted in the processing log.
- Release builds add an RPM package to the .deb and the AppImage. `Nodus-linux-x86_64.rpm` installs on Fedora, openSUSE and other RPM-based distributions, and the README, the site's download pages and the download-stats classifier now list it.
- Added the complete 5.5.0 What's New modal in all twelve interface languages.

## 5.4.5 — 2026-09-15

Nodus 5.4.5 gives the Library bulk removal and bulk repair, makes the Documentary
Index explain its own failures and stops it from overstating a document profile.

- The Library deletes the works you select in the current vault, with everything derived from them. The confirmation names both halves: the works and their own analysis go, and the analysis other works share with them stays. The batch is one transaction, so a failure restores every work, a work the scan queue is analysing right now is refused rather than deleted half-finished, and shared ideas and themes survive intact.
- The selection bar repairs a whole selection in one action. For every selected work it queues only the steps that are incomplete, pending or failed, and never re-runs what is already done, so a work whose themes or ideas are unfinished still runs the whole chain. The action appears only while some selected work still has something to finish.
- The Documentary Index gains a log viewer. Every extraction, OCR, indexing and embedding event, and every failure the pipelines can produce, is filterable by level, type, origin, vault and day, sortable, searchable by code, model or id, and copyable or downloadable one line at a time or as the filtered view. Lines are stored as a catalogue id plus its values, so the sentence is rendered in the language chosen beside the filters, English by default.
- A document profile no longer mixes languages or overstates its confidence. Sections without a heading are left untitled and localized in the interface instead of shipping a hard-coded Spanish `Sección N`, a profile published from literal quotes says it was indexed without synthesis instead of showing 100 % support, and a confidence substituted by the contractual floor is marked as a minimum rather than looking like a measurement. A synthesis whose evidence contract holds is published as partial instead of being discarded, provider verdicts are read as providers write them, and a model with a small window degrades locally instead of failing the whole work.
- Add reference takes a link. `doi.org`, `arxiv.org`, PubMed and PMC addresses resolve through the identifier they name, and any other page is read for the record it publishes (Highwire `citation_*`, Dublin Core, schema.org JSON-LD, Open Graph), with the PDF links it declares as the attachment. arXiv resolves through DataCite, which carries the same record without throttling, so it stops failing on the Atom API's rate limit, and a throttled provider gets its own sentence instead of a bare status code.
- Stopping or pausing a job is recorded as a cancellation instead of a permanent failure. Row actions carry the job's own vault id, so they keep working after you switch vaults, a campaign stop also cancels the standalone jobs it left running, a settled job stops ticking, and per-action pending and error state replaces the single global busy flag.
- Nodus Browser exports and imports its bookmarks as Netscape Bookmark HTML, the format Chrome, Edge, Firefox, Brave and Opera read. Export writes the main process's own snapshot, so an active search cannot narrow it, and import merges to the same preview the Bookmarks manager already uses, naming bookmarks, folders and duplicates before anything lands. Two serializer defects went with it: apostrophes are escaped, and tags are stripped from the raw markup so an escaped angle bracket survives as text.
- Every browser tab has one fixed width and the strip scrolls with an arrow at whichever end has tabs left to show. The selected tab is brought into view when activation, a new tab or a longer title changes which one it is.
- Previous and Next work on players that keep their whole playlist inside one element, such as Spotify or YouTube. A media key can never reach a page, so the preload now remembers the handlers the page registers with `navigator.mediaSession.setActionHandler` and calls them, with the element path kept for play, pause and stop.
- Failures in the extraction, scan and indexing queues reach the screen in the interface language. `tr()` now consults the same catalogues the main process uses, which fixes the scan queue's paused banner and every field the main-process gate never sees, and the Vault filter that had state and IPC support but no control is reachable beside Level, Type, Origin and Day.
- Confirmation dialogs are opaque in dark mode. They used the 60 % translucent `.card`, so the list behind read through the wording of an action that cannot be undone, and they now use the same `.card-modal` surface as every other dialog.
- Added the complete 5.4.5 What's New modal in all nine interface languages.

## 5.4.4 — 2026-09-14

Nodus 5.4.4 adds Simplified Chinese as the ninth interface language and makes
Chinese text survive PDF export.

- Simplified Chinese joins the interface as its ninth language. The whole catalogue is translated with key- and placeholder-parity with English, and so are the native file dialogs, the main-process error patterns and the runtime error tables, the demo study and prosopography vaults, and the Server Web copy. Prompt languages and documentation are deliberately left untouched.
- Exported PDFs render CJK. The server exporter and the desktop report embed a bundled Noto Sans SC subset, re-subset per document with HarfBuzz so the files stay small, and Latin reports keep Helvetica exactly. Chinese text was stripped to nothing on the server and threw on the desktop stamps. The Toolkit watermark, the OCR invisible text layer and the flattened study annotations use the same font.
- A custom OpenAI-compatible gateway stops failing long scans with “Connection error.”. A status-less socket failure or a connection reset is now retriable, the provider receives the reasoning effort you chose, and background scans ask a thinking model to skip its private trace. The reasoning hint can no longer break a scan either, because it is only sent to a model that announces the mode, only on background scans, and one replay drops exactly that field on a 400 or 422.
- The Documentary Index shows standalone jobs. A per-work scan or a Deep Research preparation now has its own row in the rail, with retry and cancel actions, and the queue panel, the header badge and the “no tasks” message all derive from the same selection instead of the campaigns alone.
- Linking from the global library refreshes the vault's Library list instead of leaving the pre-link page on screen. The extraction queue's progress messages are registered for renderer translation, and a row only paints an error for a genuinely failed job.
- The Nodus Server image boots again: `subset-font` is declared, so the PDF path resolves and the image health smoke passes.
- Added the complete 5.4.4 What's New modal in all nine interface languages.

## 5.4.3 — 2026-09-14

Nodus 5.4.3 fixes three things that happened behind the user's back: a work
summary stored clipped at the model's output ceiling, the browser pairing prompt
on macOS and the JSON a capability tool returned into a chat.

- Work summaries are no longer stored cut off mid-sentence. A reasoning model spends the 800-token output ceiling on its thinking trace and stops before the closing lines, and the clipped text used to be saved as a finished summary. The first attempt now has real headroom and a cut-off answer is retried once at the app's default 8,000-token ceiling. If the model exhausts that as well, the summary is marked failed instead of stored incomplete.
- The browser connector's pairing prompt now reaches the front. On macOS it opened behind Chrome, which stayed the active application, and the request timed out unseen. Nodus activates itself when the request arrives and, if the system refuses, falls back to the platform's attention signal, a taskbar flash or a dock bounce, cleared as soon as the window takes focus or the pairing settles.
- JSON results from a capability tool are collapsed under Evidence instead of dumped as an unstyled, full-height block, so the figure or answer they support keeps the centre of the message and the raw payload stays one click away.
- Added the complete 5.4.3 What's New modal in all eight interface languages.

## 5.4.2 — 2026-09-13

Nodus 5.4.2 rebuilds the Study question bank around bulk management and
interchange, renders Markdown and LaTeX on every question and flashcard surface,
and adds seven prompt languages.

- The Study question bank has two tabs for questions and flashcards, search and filters by subject, topic, cognitive level, source, material, document, tag and collection, sorting and multi-select. Status, difficulty, category, tags, collection and spaced-repetition state apply to a whole selection, and each flashcard is created, edited or deleted with its own SRS actions.
- The bank imports and exports Nodus JSON, CSV, Anki TSV and `.apkg` packages, and Moodle XML and GIFT quizzes from one dialog that previews what will enter.
- One Markdown pipeline covers every question and flashcard surface: prompts, options, answers, explanations, the review session, AI generation previews, the exam builder, immersion quizzes and worldbuilding questions. Writing fields gain an Edit/Preview toggle, generation is asked for LaTeX, and Nodus Server web typesets published study catalogs and dossiers.
- Seven prompt languages join the pickers: Simplified and Traditional Chinese, Vietnamese, Japanese, Russian, Ukrainian and Korean, bringing prompt support to fifteen languages. The interface keeps its eight.
- Saved Research chat answers keep their provenance: the conversation, the model and the sources. From the note you can reopen the conversation and jump to the exact message, and exported notes carry the provenance with them.
- In Deep Research and Immersion creation dialogs, only Image Atelier is classified as paid per call. Every other installed Skill keeps the optional ceiling and no longer requires a mandatory maximum.
- The Skills Marketplace lists skills, plugins, signed packages and inbox plugins in one catalogue, one card per item, with the same identity, collapsible details and a single permission review before installing or updating.
- Signed v2 packages execute through their own trusted capability pipeline instead of advertising their tools through the legacy generic fence.
- The Nodus Browser follows each document’s colours in dark mode, so unstyled pages and 401 errors are readable without selecting text, and HTTP Basic authentication is answered from a browser bar that stores no credentials. The native view also stays aligned with the renderer zoom.
- Zotero being unreachable is no longer reported as a missing attachment: text resolution retries, scans fail retriably and the queue requeues them. The Incomplete filter gates on all five analysis steps with a semantic state that matches each row, and a deep fusion resumes only the ideas it did not finish.
- Added the complete 5.4.2 What’s New modal in all eight interface languages.

## 5.4.0 — 2026-09-12

Nodus 5.4.0 includes everything prepared for the unpublished 5.3.2, plus unified
Research chat and search, file attachments, visual report Skills and the fixes below.
It takes chemistry, law and genomics out of the application. They are
official capability packages now, signed by NodusResearch and installed like any
other, and the application that ships to someone who never draws a molecule no
longer carries the machinery to draw one.

- Chemistry Studio, Legalize and AlphaGenome are installable packages rather than built-in skills. The Skills view shows each one's verified publisher, permissions, size, the platforms it runs on and the capabilities it provides, and any of them can be installed, updated, rolled back or removed.
- A profile upgrading from 5.3.1 moves across on its own. A built-in that was enabled, an enabled copy downloaded from the official catalog, a skill of your own that depends on one of these capabilities, or a profile predating the skills library all cause the matching package to be installed. A default left untouched, deleted or switched off causes nothing: the migration does not overrule a decision you already made.
- Adoption keeps the identity. A migrated skill keeps its local id, its place in the list and its per-surface activation, instructions you edited become an overlay on the package's text, and an edit that cannot be expressed that way survives as its own disabled skill rather than being discarded. Two identical copies of one package become one skill, enabled wherever either was.
- The migration is resumable and works offline. Every phase is recorded before the next begins, so a crash resumes rather than restarts, and the signed packages travel inside the update itself so an upgrade with no connection still completes. A failure leaves the skill with the activation you chose, the previous data intact and a retry, and never holds up the window.
- Capability API v2 adds `nodus-trusted-worker-v1`, reserved to packages signed by NodusResearch. `javascript-sandbox-v1` is unchanged and remains the only route for community plugins. The signature is the security boundary: a v2 worker runs in its own utility process for fault isolation, cancellation and hard limits, not as a sandbox.
- A package only installs if its release manifest verifies against a publishing key built into Nodus, and if the bytes downloaded match the size and digest that manifest pinned, checked before the archive is opened. Downgrades and different content published under the same version are refused, and an update that widens permissions waits for approval.
- The chat pipeline no longer knows a discipline by name. A reply is parsed once into a generic tree, and installed packages claim fenced protocols by declaration and run in the order they declare. Hooks return typed mutations rather than text, a stored result is never executed, and no hook can turn a result into the next request.
- Results are stored as artifacts beside the conversation, with their own hash. What the model may see of one is read from the package's own declaration instead of a rule written into Nodus, so an AlphaGenome prediction still never leaves the device. A result whose package has been removed keeps its summary and offers to reinstall the provider.
- Package settings are declarative. The AlphaGenome key, its terms and its Python runtime are configured on the package's own card, the key is kept in the system credential store and reaches the interpreter through stdin, and the runtime is built from a lock that pins every wheel by URL, size and digest and installs with `--no-index --require-hashes`.
- RDKit, OpenChemLib and the TeX engine are no longer dependencies of Nodus, and the AlphaGenome Python worker is no longer a packaged resource. A test builds the real main-process and renderer bundles and fails if any of it comes back.
- A skill that declares a capability nothing provides yet can be installed and keeps the activation you chose. It simply does not run until its provider is installed, so the order of two installs no longer matters.
- Updated the complete 5.4.0 What's New modal in all eight interface languages, preserving all nine notes prepared for 5.3.2.

- Research chat is shared across all nine vault types with collapsible history/context panels while preserving native conversations, citations, source selection and tools.
- Added provider-aware reasoning effort, searchable author/work corpus filters with persisted history boundaries, and vault-local custom system prompts that can change without resetting the conversation.
- Research chat accepts file attachments through the integrated + button or drag and drop. DOC/DOCX, PDF, spreadsheets, CSV/TSV, XML, images and other supported formats use the selected model, with vision where required. Originals and extracted resources belong to the conversation and are deleted with it. File cards have readable light/dark outlines and vault accents. Unsupported formats and processing limits are explicit.
- Reading position and citation previews are fixed in Research chat. Stopping a streamed answer keeps the received partial text in history.
- Deep Research and Immersion gain per-document visual Skills, explicit paid-call ceilings, figures for new/existing reports, interactive views, downloads, removal/undo and PDF export. Database Deep Research is outside this visual-report change.
- Native cartography builds downloadable maps from real geographic sources and attributed boundaries, layers, routes, markers and legends. Compatible Skills can also request bounded thumbnail relevance review using the selected vision model, with explicit unavailable/no-match results.
- Plugins gain verified read-only packaged assets, interactive glTF/GLB model views and rich native results including formulas, charts, trees, comparisons, annotated passages, maps, images, audio and zoomable documents. Saved results retain their referenced resources.
- Unified lexical/semantic search across all desktop vaults, with native content-type filters and saved searches.
- Skills Marketplace has a dedicated header entry. Skills and packages share one ordered card with clearer actions, installation errors are translated, and migration installs all Skills in each bundled package while preserving user preferences and author workflows.
- PDF Presenter uses tags with filtering and confirmed deletion that preserves presentations, downloads library PDFs and imports recovered-notes TXT files as well as native exports.
- Valid SVG comments no longer discard drawings. Chemistry Studio keeps drawable portions when full verification is unavailable and makes the limitations visible. The update carries Chemistry Studio 2.2.1.
- Browser bookmarks use compact cards and recover site favicons, including after editing.
- Word alternatives preserve selection whitespace and make a bounded second attempt when the first response lacks enough distinct suggestions.
- Graph actions and the Tutor sidebar have clearer icons and contrast. Chat context respects light mode, the send button is centered and the light-mode logo background is fixed. Teaching hides deferred sections from navigation.

## 5.3.1 — 2026-09-10

Nodus 5.3.1 turns the Skills Marketplace into a view of the library you actually
have, and adds the plugin format: a versioned package that can carry sandboxed
capabilities of its own.

- The Marketplace now shows which skills you already have. Skills included in Nodus appear as installed instead of being offered again, an All / Installed / Available filter reviews your library from the catalog, and each installed skill can be uninstalled from its card or its detail page.
- Installing a catalog entry that Nodus already includes restores the version shipped with your build instead of adding a duplicate skill with the same name, and removes a duplicate a previous version had already installed. AlphaGenome and Legalize can be restored this way too.
- Uninstalling affects the skill only. Native capabilities stay in Nodus and come back with the skill, and My skills now explains that a built-in skill can be reinstalled from the Marketplace.
- Skills can now come as plugins: one versioned package bundling several skills, or a skill with a sandboxed capability of its own. A capability runs in an ephemeral Chromium session with no Node, filesystem, application bridge, navigation or direct network access, and reaches the outside only through the HTTPS endpoints its manifest declares. Keys you configure are injected into the request by Nodus and are never visible to the plugin's code.
- Plugins update as one unit and can always be undone. An update that asks for more than you approved waits for your approval, instructions you edited locally survive as an overlay you can reset to the author's version, and the previous version stays available for rollback. Auto-update is on for the official Marketplace and per-plugin opt-in for other sources.
- Plugins dropped into the profile's plugins/inbox folder are listed for review with the exact permissions they request, and nothing in them runs before you approve it.
- AlphaGenome and Legalize are ordinary capabilities now, so any compatible skill can declare them instead of them being reserved for the built-ins.
- Nodus warns before installing a plugin the running build cannot execute. The review screen compares the build with the plugin's `minNodusVersion` floor and says so above the install button, and the confirmation matches. A plugin already staged as pending because it is incompatible now names the version it needs instead of showing its own description.
- Tools and capabilities are charged to two separate lanes. Sandboxed work that declares no network, secret or storage permission has sixteen calls per reply, and anything that declares one keeps four. The single-image and single-chemistry-plan limits are unchanged.
- Deep Research treats "Max. N sections" as a ceiling instead of a floor. A rich corpus no longer overrides the number you picked, and the coverage grace slot is reachable only in auto mode. No evidence is dropped: surplus sections are merged and every idea, work, gap, contradiction and coverage question is reassigned.
- Added "Guideline section length" to every Deep Research composer: Auto, 2,500, 5,000, 10,000, 15,000 or 20,000 words, or a custom figure. It counts words rather than tokens and is editorial guidance, produced by bounded continuation passes rather than by raising `maxTokens`. The selection travels through IPC, the persisted queue, MCP and Nodus Server, and is stored on the report. Database Deep Research remains the exception and steers only its writer and editor roles.
- The research assistant's corpus context picker opens as a balloon anchored to its header trigger instead of a centered modal covering the conversation, with outside-click and Escape dismissal and an upward flip when there is no room below.
- Italian is offered in the Writing Workshop language picker. All three composers now render the shared `PROMPT_LANGUAGE_OPTIONS` list, and a contract test fails the build if a picker hand-writes its own options or the list drifts from `PROMPT_LANGUAGES`.
- Leaving the Stellar graph while its render loop is in flight no longer throws. The self-scheduling frame returns early when the host ref has already been detached.
- Nodi's standalone overlay keeps the track of every unchecked skills switch visible and applies light and dark scrollbar tokens to each of its scroll surfaces.
- A chemistry drawing that cannot be fully verified is rendered with its labels instead of being discarded.
- Added the complete 5.3.1 What's New modal in all eight interface languages.

## 5.3.0 — 2026-09-09

Nodus 5.3.0 opens Skills to installable community packages and adds two
reviewed, opt-in research integrations.

- Introducing the Skills Marketplace. Explore the official catalog, inspect each package before installation, and add other public GitHub repositories. Catalog updates and source removal never alter installed skills.
- Skills can include JavaScript tools for calculations, transformations and generators. They run in an ephemeral sandbox without access to files, credentials, the network or Nodus data. Complete skill packages can also be imported and exported.
- AlphaGenome is available as an optional skill for non-commercial regulatory-variant research. It uses the official client and the user’s own key, keeps prediction data local, and preserves the service’s attribution and output terms in exports.
- Legalize retrieves real legislation from 32 reviewed national and European Union repositories. Results include the official source, repository revision, licence and attribution, with no Git installation, account or API key required.
- Deep Research and Immersion no longer run out of memory on large corpora. The Writing Workshop candidate pools counted related rows with grouped joins that multiplied every work by its themes, ideas and gaps before aggregating, holding the whole cross product in memory; on a corpus of a few hundred works with document profiles built, that ended the process mid-query. They now aggregate with subqueries and stay linear in the candidates they return.
- Imported temporary files on Windows are now opened with write access before the durability sync, preventing valid imports from failing at the final save step.
- The Stellar graph’s Context control stays in its original position when enabled instead of jumping within the toolbar.
- PDF Presenter tutorial cards now use the presentation icon and presentation-specific gradient instead of an unrelated thumbnail.
- Add the complete 5.3.0 What’s New modal in all eight interface languages, with the Marketplace’s own basket-and-N icon.

## 5.2.2 — 2026-09-09

- Chemistry Studio comes to chat. Create molecular structures from SMILES, Lewis diagrams and ChemFig drawings, with controls to enlarge and download the result. The interface is translated and your customized skill instructions are preserved.
- Chemical drawings gain explicit checks. Nodus validates molecular identity and supports Fischer, Haworth and Newman projections and bounded rules for SN2, E2, aldol, Diels–Alder and amide resonance. Download the evidence and checked ChemFig. When a proposal cannot be verified, Nodus says so instead of inventing a drawing.
- Complete, balanced reaction schemes preserve declared species, counterions and coefficients, with agents shown separately. Nodus checks elements, isotopes, hydrogens and charge and compiles the complete ChemFig export. A balanced scheme does not mean a verified mechanism or predict reaction feasibility. Rendering several drawings is also more stable.
- Fewer errors when requesting AI answers. Requests adapt to the parameters each model accepts, including Claude 4.7 and later, GPT-5, GPT-6 and o-series models. The fix covers both complete and streaming responses while preserving compatibility with older models.
- The graph opens on a permanent themes hub. Enter a theme and adjust depth and visible relationships per idea, or open independent explorations in other tabs. Add and remove ideas in the hub and preserve each exploration when navigating. Zoom, captions, selection and controls are clearer, with your vault colors in light and dark mode.
- See your graph within the corpus. Enable a context background with adjustable intensity in the themes hub and explorations. External connections stand out, and clicking a background idea adds it to your work. Context does not alter playback or working counts. Corpus totals count unique ideas even across overlapping themes, and published Nodus Server graphs gain the same improvements.
- Faster searches in large libraries. Document profile queries find each work by its identifier, avoiding repeated scans of all profiles. Results stay the same while performance improves as the library grows.
- A new PDF Presenter tutorial helps you discover the tool. Find it in Features, on the website and in the wiki, with title and description in twelve languages. An announcement shows the video after the release notes without autoplay. Dismissing it marks it as seen so it does not return on later launches.

- Translate all eight new What’s New highlights into all eight interface languages and retain the published 5.2.1 history.

## 5.2.1 — 2026-09-06

- Stop completed and cancelled queue history from reappearing at startup, remember dismissed results across restarts, and keep cancellation messages from triggering false error alerts.
- Add a translated **Clear finished** action with confirmation for all queue lanes. It dismisses completed, cancelled and failed results while preserving active, queued and paused work and generated documents.
- Reuse the 5.2.0 What's New highlights unchanged in all eight interface languages for this focused hotfix.

## 5.2.0 — 2026-09-06

Nodus 5.2.0 introduces the Stellar idea graph, tabbed research workspaces,
chat skills and visual answers, and a clearer desktop interface.

- Introducing Stellar, the new idea graph. Search for an idea and explore its connections step by step or with automatic playback. Move forward, go back and consult the sources and evidence for each relationship as you explore the graph. Available in the corpus, works, Study, Immersion and published Nodus Server spaces.
- Several graphs open at once. Each tab keeps its own ideas, positions, exploration history and evidence panel during the session. Add ideas from search, remove them from the canvas or open another exploration without replacing the previous one. You can also work in full screen.
- A visual argument map. Explore the central idea and its branches through expandable cards, filter relationship types and open their evidence. Automatic zoom brings the selected argument closer, and you can return to the previous view without closing branches. The outline view remains available.
- Tabs in Deep Research and Immersion. Keep several reports or sessions open and switch between them from a tab bar, with direct access to the gallery. Deep Research also remembers your reading position in each report as you switch between them.
- Ideas and evidence are easier to read. Connections and summaries have a simpler presentation, with fewer nested boxes. The ideas dialog for a work now uses an opaque background so the content behind it does not interfere with reading.
- The Dictionary shows the correct status when finished. Once a definition is complete, the generation indicator gives way to the entry's actual status. Active entries no longer keep showing “Generated” for the rest of the session.
- A refreshed home. Cards on home screens have a clearer presentation and adapt to the available space. They improve contrast in light and dark themes and retain each vault's colors to identify its sections and statuses.
- All activity in the top bar. The processing queue and progress indicators come together in a dropdown panel. Check active and pending tasks and follow their progress in one place, leaving more room to work.
- You decide when to install updates. Nodus downloads the new version in the background and lets you choose “Install and restart” or “Later”. Downloading no longer triggers an automatic restart, and installation retains the pre-update backup check.
- Settings remembers where you were. When you reopen Settings, you return to the last tab you were viewing. Shortcuts to a specific section still take you to their intended destination.
- Better citation formatting. Linked citations and their parentheses stay together when a line wraps, avoiding stray punctuation in reports and chat responses.
- Skills to personalize your conversations. Enable reusable instructions for studying, writing, developing ideas, comparing options or reviewing an argument. You can create your own skills, import Markdown or JSON files and edit the included ones. Chats share the configuration. Nodi keeps its own selection.
- Diagrams and images directly in chat. SVG Studio creates vector diagrams, and Image Atelier generates images with the provider and model configured in Settings. Enlarge, copy and download the results, inspect the SVG code or view the instructions used to generate an image. Both skills are enabled by default.
- Choosing a model is easier. Model selectors use searchable menus with a look that matches the app's theme. Search accepts different ways of writing the name, and dropdowns adapt to the available space.
- Your favorite utilities close at hand. Pin Toolkit tools to the sidebar using the pin on each card. Open the ones you use most directly and remove their shortcuts whenever you like.

## 5.1.7 — 2026-09-04

Nodus 5.1.7 is a single-fix release for the Dictionary, which reported a failure
while the definition was being written correctly.

- Stopped the main-process localizer from rewriting the Dictionary generation
  status as the generic "the operation could not be completed" notice. The
  queued, corpus-analysis and definition-generation lines travel in a `message`
  field, so they were localized as failures in every interface language other
  than Spanish while the definition itself came out fine. They now reach
  `DictionaryView` untouched and are translated where they are rendered.
- Added regression coverage pinning the Dictionary progress catalogue to the
  renderer-translated allowlist in all seven non-Spanish languages.

## 5.1.6 — 2026-09-03

Nodus 5.1.6 adds a custom OpenAI-compatible AI provider in Settings and
completes the interface translation of progress bars and main-process errors.

- Added a `custom` AI provider for the user's own OpenAI-compatible endpoint
  (gateways, local servers and proxies). The base URL is used exactly as typed
  apart from the trailing slash, the model list combines hand-typed slugs with
  an optional `GET /models` discovery, and Settings offers connection testing
  with an optional API key stored like the other credentials.
- Sent the OpenCode Go session header (`x-opencode-session`) with a named
  `Nodus/<version>` User-Agent on every opencode.ai call, grouping each unit
  of work under a fresh random session id that is never persisted.
- Translated every progress-bar line into all seven non-Spanish interface
  languages and stopped healthy states from being rewritten as errors, while
  preserving library and work names verbatim.
- Translated every main-process error into all seven non-Spanish interface
  languages, so connection tests and failure notices now state their real
  cause instead of leaking Spanish or collapsing into the generic notice.
- Added regression coverage pinning the custom-provider contract, the
  progress-bar language round-trip and the main-process error catalogue.

Nodus 5.1.5 is a focused hotfix for local idea extraction with reasoning
models, restoring the reliable 16K output allowance used before 5.1.4.

- Restored a real 16K structured-output allowance for deep idea extraction,
  independent of the prompt and context-window budget, with enough transport
  time for a slow local model to finish that allowance.
- Allowed automatic context planning to select 32K for deep extraction when
  needed, while retaining the previous 16K automatic ceiling for ordinary
  local-model tasks.
- Kept LM Studio reasoning traces separate from the assistant JSON and detected
  responses that spend their full allowance on reasoning, so adaptive recovery
  can split and retry the source instead of silently losing the analysis.
- Added regressions for the 16K/32K planner contract and LM Studio's native
  reasoning-exhaustion response shape.

## 5.1.4 — 2026-09-02

Nodus 5.1.4 writes every AI instruction natively in the eight interface
languages, makes local-model analysis finish and recover, and refreshes the
academic onboarding tour.

- Added native prompt and runtime packs for all eight supported locales across
  every AI workflow, keeping protocol keys, identifiers, enums and citation
  rules untouched.
- Separated the UI locale from the prompt and output language and localized IPC
  payloads, Server Web views, Nodi documentation, native dialogs and Word
  add-in warnings that still surfaced Spanish copy.
- Separated local-model context capacity from per-task output budgets and mapped
  the resulting limits correctly onto Ollama and OpenAI-compatible LM Studio
  requests, with a new context-window control and a last-local-request card in
  Settings.
- Replaced fixed structured-output ceilings with task-aware planning, adaptive
  batching, completeness validation and recovery for idea extraction, summaries,
  merging and semantic relation validation.
- Made document reanalysis transactional so a failed or cancelled run preserves
  the previous valid analysis, while a successful run replaces ideas,
  embeddings, relations, graph data and profiles without dangling references.
- Corrected stale Pending and Analyzing labels across cancellation, resume and
  relaunch flows.
- Added explicit `hypothesis` and `finding` document-profile kinds with strict
  provenance, coverage, audit and repair rules.
- Replaced the embedding-threshold fusion heuristic with a proposition-level
  decision contract, strict runtime validation and rejection of fusion targets
  that were not among the candidates supplied to the model.
- Replaced the outdated fourteen-step academic vault tour with a nine-step
  Library, Ideas and Graph workflow, complete in all eight languages.
- Added sortable Zotero date-added, date-modified and access-date fields while
  preserving compatibility with older records.
- Released the Zotero add-on's semantic retrieval memory by terminating the
  local embedding worker after inactivity or teardown and compacting legacy
  evidence sidecars on first read.
- Integrated the 5.1.3 Developer ID signing and Apple notarization pipeline,
  which shipped from its own release branch and had never reached the main
  line.

## 5.1.3 — 2026-08-31

Nodus 5.1.3 introduces the complete Developer ID signing and Apple notarization
pipeline and improves the quality and transparency of Dictionary evidence.

- Signed the macOS application and every nested executable component with the
  minimum required entitlements and Hardened Runtime enabled.
- Submitted the signed application to Apple, stapled the accepted ticket and
  made publication fail closed unless `codesign`, `spctl` and `stapler` all
  verify the result.
- Balanced Dictionary evidence across works and authors, combined semantic and
  lexical retrieval, exposed source provenance and added coverage warnings.
- Added a focused two-item What's New modal in all eight interface languages,
  led by the Apple notarization milestone and its dedicated SVG icon.
- Prevented beta installations from presenting an older stable release as an
  available update after `electron-updater` had correctly rejected the downgrade.

## 5.1.2 — 2026-08-31

Nodus 5.1.2 improves Word model selection and fixes local analysis, Zotero
titles, summary diagnostics and the first-vault password flow.

- Replaced Synonyms with explicit, phrase-aware Alternatives in the Word add-in,
  stopped automatic generation on tab entry and added one searchable,
  keyboard-accessible model picker across all five Copilot tasks.
- Let local embedding models process inputs beyond the previous 512-token
  physical batch limit while remaining inside the configured context window.
- Preserved completed summaries when optional provenance or embedding work
  fails, and persisted actionable errors when summary generation itself fails.
- Rendered Zotero rich-text titles as clean text throughout the interface while
  retaining their original markup for stable change detection.
- Unified the master-password policy across first-vault setup, Settings, IPC and
  recovery creation, with immediate translated feedback for short or mismatched
  passwords.
- Kept every 5.1.1 entry in the What's New modal and added these corrections in
  all eight interface languages.

## 5.1.1 — 2026-08-31

Nodus 5.1.1 is a Zotero hotfix that keeps the header refresh limited to the
catalog of monitored collections and prevents false whole-library changes.

- Made the header's Zotero refresh strictly catalog-only: it updates monitored
  collections and shows new or changed items without starting theme, deep,
  summary, embedding, passage, graph or documentary-index work.
- Added a stable metadata fingerprint for Zotero 10 local APIs that report every
  item as version zero, preventing both whole-library false changes and missed
  edits after the compatibility transition.
- Kept every 5.1.0 entry in the What's New modal and added this correction in
  all eight interface languages.

## 5.1.0 — 2026-08-30

Nodus 5.1.0 is a repair-focused release that makes AI processing faster and
more transparent while hardening Zotero, Server Web, Library, Word and the
Chrome connector.

- Added adaptive AI concurrency with automatic provider-aware pacing, manual
  limits from 1 to 8 and total plus per-item elapsed time in processing rails.
- Let local models finish demanding analyses, split oversized passages after a
  timeout and restore model discovery directly from the general selector.
- Made Zotero imports exhaustive, resumable and hash-verified across personal
  and group libraries, with actionable connection errors and safer filenames.
- Brought Server Web closer to desktop parity across navigation, editing,
  search, Deep Research and all supported vault types.
- Added the first-use Library guide, made Documentary Index opt-in per work and
  removed the document-understanding prompt from startup.
- Unified Database Deep Research with the academic library, composer, queue and
  reader flow while retaining advanced role and preview controls.
- Added Word ribbon shortcuts and per-task model selectors, and hardened
  contextual synonym generation and the citation-style picker.
- Renamed the Chrome extension to Nodus Research Connector and replaced native
  pairing alerts with a clear, translated, cancel-first dialog.
- Added the 5.1.0 changes to the What's New modal in all eight interface
  languages, grouped by product surface.

## 5.0.6 — 2026-08-28

Nodus 5.0.6 brings verifiable Deep Research to database vaults and extends the
research workflow across Word, Zotero, Chrome, Compass and Nodus Browser.

- Added Data Deep Research with editable previews, reproducible snapshots,
  traceable evidence, explicit limitations and Markdown, PDF and ZIP exports.
- Added contextual synonyms and a grounded per-document chat to Nodus Copilot.
- Made Nodus for Zotero retrieve across complete selected attachments, audit
  exact citations, interpret visual pages and stream persistent conversations.
- Restored installation and startup compatibility for the standalone plugin on
  Zotero 10 while retaining Zotero 9 support.
- Expanded the Chrome connector with reviewed metadata, batch capture,
  background transfers and duplicate-safe Library ingestion.
- Improved Compass author matching across diacritics, initials and name order,
  and added a one-click action to clear a completed search.
- Made Nodus Bookmarks cards compact, directly clickable and safely deletable.
- Added edit and delete actions for custom writing-improvement prompts while
  preserving their model settings and protecting built-in prompts.
- Added the 5.0.6 changes to the What's New modal in all eight interface
  languages.

## 5.0.5 — 2026-08-27

Nodus 5.0.5 refines the Word and LibreOffice copilot pane: it stops discarding
generated proposals, keeps up with the selection on its own and adopts the
visual language the Zotero sidebar already used.

- Kept a generated proposal on screen until the next generation instead of
  discarding it whenever the Word selection moved.
- Made the prompts tab poll the Word selection while it is open, so selecting
  text updates the pane without touching an unrelated control.
- Froze the selected-text box while a proposal is generating, so moving the
  cursor never looks like it redirected the running request.
- Marked the prompts tab while a generation is running, which continues and is
  delivered even from another tab.
- Redesigned the task pane around the Nodus accent, rounded cards and pill
  badges shared with the Zotero sidebar, in light and dark.
- Fixed every tab of the strip in place, moved the search box below the tabs and
  adopted the desktop Nodus mark.
- Added the 5.0.5 change to the What's New modal in all eight interface languages.

## 5.0.4 — 2026-08-27

Nodus 5.0.4 brings secure multi-user web parity to Nodus Server, extends Word
Copilot writing workflows and limits accumulated migration recovery snapshots.

- Added a responsive Nodus Server web client that follows the Desktop visual
  language and opens shared workspace views from phones and browsers.
- Added private per-user conversations, notes, annotations and artifacts, plus
  synchronized profile preferences across connected devices.
- Added per-account AI providers, models and encrypted credentials, with private
  jobs and results and an immutable embedding compatibility contract.
- Enforced ownership, membership and provenance across server mutations and
  hardened login, secret redaction, quotas, backups and Docker deployment.
- Added a review-first Word Copilot tab for saved workspace writing styles, with
  model selection and explicit copy or replace actions.
- Kept Word reference tabs compact, isolated concurrent prompt results and added
  visible generation feedback without changing the document prematurely.
- Retained only the two newest managed migration recovery snapshots per vault in
  a serialized background cleanup that preserves unrelated recovery material.
- Allowed the public GitHub download total to be refreshed manually and updated
  the figures displayed by the website.
- Added every 5.0.4 change to the What's New modal in all eight interface languages.

## 5.0.3 — 2026-08-26

Nodus 5.0.3 turns Compass into a credential-free discovery engine, protects
generated Dictionary prose and collects the interface and website improvements
merged after 5.0.2.

- Rebuilt Compass around direct public APIs for a much broader mix of scholarly
  literature and open primary sources, with discipline-aware query planning,
  stronger ranking and deduplication, transparent providers and optional AI
  interpretation that remains disabled by default.
- Made Compass searches and candidates durable, distinguished verified open files
  from landing pages, expanded import with metadata completion and available-file
  attachment, and surfaced rate limits, partial results and skipped work.
- Restored Deep Research v1 as the lower-cost default while preserving explicit v2
  choices in the application and MCP clients.
- Prevented degraded extractive Dictionary fallbacks from replacing synthesized
  definitions. Truncated, malformed and unverified results are retried, recorded for
  diagnosis and shown without changing the last valid version.
- Added immediate localized tooltips for all thirteen writing transformations.
- Added the vault name to both stages of deletion confirmation.
- Gave Compass and State of the Art distinct icons and bottom-aligned the actions in
  Deep Research and Immersion gallery cards.
- Rebuilt public-site metadata, canonical links, social previews and citation output
  from one source of truth, published the Nodus versus NotebookLM article and
  refreshed the public GitHub download total.
- Added every 5.0.3 change to the What's New modal in all eight interface languages.

## 5.0.2 — 2026-08-26

Nodus 5.0.2 repairs the generation and document-analysis workflows reported after
5.0.1, polishes the shared catalogue views and introduces Nodus Compass.

- Kept Deep Research running when changing tabs, moved heavy work away from the
  renderer path, repaired and retried transient or malformed model responses, and
  simplified the queue to one animation plus live position numbers.
- Restored editable Dictionary forms and responsive Regenerate and Update actions,
  aligned their controls, and added controlled recovery for incomplete or malformed
  generated definitions.
- Fixed switching from clean Markdown to the internal PDF viewer by resolving the
  local attachment before serving it, while preserving direct external opening.
- Unified documentary campaign and lower-strip progress, kept rows stable while
  section counts advance, corrected rescan reasons, and repaired light-mode styling.
- Matched idea-type colours between Ideas and Argument map and added the missing
  vertical spacing and alignment to Ideas rows.
- Added Nodus Compass for federated academic discovery across open catalogues, with
  deduplication, recommendation reasons, saved candidates, provenance and checked
  Library import.
- Added all 5.0.2 changes to the What's New modal in all eight interface languages.

## 5.0.1 — 2026-08-25

Nodus 5.0.1 collects every repair merged since 5.0.0 and makes model setup easier
to understand and harder to miss.

- Expanded Dictionary creation with six evidence-oriented prompt presets, custom
  instructions, evidence review and state restoration for the open entry, search,
  filters and table position. Regeneration preserves a recoverable prior version.
- Added parallel Dictionary generation with a visible per-entry queue, concurrency
  limits, failure isolation and selective retry while the rest of the Dictionary
  remains usable.
- Hardened the academic and Global Library navigation state, linked and group-library
  attachment resolution, stale selection handling, exact citation destinations and
  published document-profile continuity.
- Recovered interrupted document-index campaigns safely, requeued sources changed
  during analysis and localized status and error payloads arriving from background
  processes.
- Unified app and MCP Deep Research generation in one durable main-process queue.
  Queued and running jobs can be removed with confirmation, survive restarts, recover
  previously stalled records and refresh the gallery without duplicate jobs.
- Moved migration-copy and automatic-backup inspections out of the Electron main
  process, bounded their work and prevented stale results after changing vault or
  backup folder from freezing or misleading Settings.
- Added consistent short descriptions to every AI model and related control in
  Settings. AI tasks without a configured model now raise a compact translated modal
  in light and dark themes with a direct route to Settings → AI Models.
- Added all of these changes to the What's New modal in all eight interface languages.

## 5.0.0 — 2026-08-25

Nodus 5 adds evidence-backed document understanding and a versioned academic
Dictionary, rebuilds Deep Research around hierarchical retrieval, and hardens the path
from a local attachment to every claim and citation. This stable release includes every
change since 4.2.5, including the fixes merged after the first beta tag.

- Added a persistent Dictionary to academic vaults with list and table browsing, search,
  filters, sorting, editing, evidence and citation navigation, concept relations, version
  history and incremental detection of new relevant evidence. Updates and regenerations
  preserve the previous definition, and suggested relations still require confirmation.
- Added hierarchical document understanding with document profiles, section summaries,
  lexical and vector indexes, freshness tracking and evidence-first drill-down. Background
  indexing asks for explicit one-time consent and provides durable progress with pause,
  resume, stop, retry and crash recovery from Library and Settings.
- Fixed documentary indexing campaigns pausing again after every Resume when a legacy
  deep-scan fingerprint differed from the canonical resolved text. Profile publication now
  guards the resolved corpus atomically, campaign failures stay actionable and localized,
  and warning and destructive controls remain legible in both light and dark themes.
- Added Deep Research v2 with idea-and-relationship-first retrieval, selective expansion
  into full documents, version routing and reproducible report metadata. Source and
  proposition coverage now decide when research is complete instead of a requested word
  count, and every Deep Research workflow gains balanced controls and continuous
  single-block output while saved v1 reports remain compatible.
- Integrated hierarchical retrieval into Research Assistant, Nodi, Immersion, Writing,
  Study, Teaching, Genealogy, Prosopography and MCP clients, while keeping citation
  verification fail-closed and traceable to exact evidence.
- Made each local attachment the source of truth for extracted text, including linked
  files and Zotero group libraries. Zotero's full-text index is now only a fallback for an
  unavailable file and can never invent a page number. Citations retain their attachment
  and verified page and open directly at that location.
- Made deep scans recover safely from truncated model output by widening the budget once
  and then splitting at page-aware boundaries. Replacing an analysis is atomic, failed
  work keeps its previous graph and checkpoints, queued rescans survive restarts, stale
  passages are excluded from retrieval, and text cleanup no longer glues valid words
  together by guesswork.
- Fixed Nodus Browser control of custom and WebAudio players. Pause and Resume track the
  active player and avoid ambiguous page-wide controls even when a React page replaces
  its buttons. The document-understanding consent modal now has correct light and dark
  surfaces.
- Fixed the Zotero selection popup so localized actions remain accessible without
  overflowing, and vertically centered idea type markers against complete catalogue rows.
- Prevented slow or stalled cloud recovery folders from blocking startup. Authenticated
  snapshot metadata is read from a small sidecar index inside a disposable utility process
  with separate startup and interactive deadlines. Startup fails open, manual inspection
  remains bounded and the protection screen now uses the vault-coloured Nodus mark.
- Added the typed connected-vault action contract to the classic Nodus Server. Desktop can
  claim, process and confirm actions from classic and Cloudflare deployments through the
  same durable flow, including author-synthesis regeneration.
- Refreshed the README and getting-started guide with current English demo screenshots,
  navigation, download totals, primary actions and concise licensing information.
- Added all of these changes to the What's New modal in all eight interface languages.

## 4.2.5 — 2026-08-23

- Fixed the macOS updater leaving a second Nodus behind. It moved the running bundle to `Nodus.app.previous` and never removed it, and that suffix is on the directory name only: what stayed was a complete application bundle with the same identifier, which LaunchServices registered as a second copy of Nodus. macOS then showed two Dock icons for one app, and every update kept another 1.8 GB forever. The displaced bundle is now unregistered before the relaunch and deleted after it.
- The updater relaunches with `open` rather than `open -n`, which forced a new process even when one was already running.
- Nodus also removes such a bundle on launch. An updater fix only reaches the update *after* the one that ships it, so without this a 4.2.4 install would keep its duplicate for one more cycle.

## 4.2.4 — 2026-08-23

- Fixed the Nodus Browser media button, which reported a tab as paused as soon as any spare player on the page stopped and then did nothing when pressed. Playback state is now the page's own answer about the whole document, Play and Pause act on the track actually playing, and the search reaches same-origin frames and open shadow roots.
- Fixed the media panel blanking the web page while it was open. The page is now frozen into a snapshot before the native view is hidden, as the notifications panel already did.
- Added Cut, Copy and Paste to the browser page context menu, in that order, and gave Nodus's own text fields a context menu of their own, including the Browser address bar.
- Added Cmd/Ctrl+T for a new tab, working while a page has focus, and Cmd/Ctrl-click or middle-click on Back and Forward to open that destination in a new tab.
- Fixed macOS updating, which this release would otherwise have broken. Nodus ships unsigned on macOS and replaces its own bundle with a helper script, and the helper that runs always belongs to the version being replaced. Renaming the packaged product to "Nodus Research" renamed the bundle to `Nodus Research.app`, so every installed copy searched for `Nodus.app`, found nothing, failed after the app had already quit, and never reopened. The packaged product name is `Nodus` again, which also restores the Windows install directory and the Linux package name.
- Hardened that helper so a future rename cannot repeat this: it now locates the incoming bundle by shape rather than by a name hardcoded when it shipped.
- Pinned the installer filenames to `Nodus-<os>-<arch>.<ext>` independently of the product name. Those filenames are what the download buttons and every electron-updater manifest resolve, and interpolating the product name into them broke the release upload.

## 4.2.3 — 2026-08-22

- Added a full-screen Deep Research reading mode with a wider report column, live reading progress, a returning header, height-aware source panels and direct links from cited authors to their dossiers.
- Re-derived saved-report citation labels from the current corpus when reports are read, keeping inline citations, synthesis matrices and bibliographies aligned with corrected authorship and dates without rewriting saved reports.
- Repaired author and editor attribution across existing vaults. Chapter ideas now belong to their authors, edited works are separated in author dossiers, editor-only volumes are marked provisional and stored bylines are corrected during the upgrade.
- Reworked Google sign-in handling in Nodus Browser so blocked embedded flows explain the system-browser route, preserve the originating site and restore the previous internal or web page when dismissed. Back also returns reliably to Bookmarks and Research Atlas.
- Unified the integrated wiki sidebars with the central content background in the app and on the web across light and dark themes.
- Updated project social links and public GitHub release download totals, and added the GitHub star announcement channel entry.
- Added this release to the What's New modal in all eight interface languages.

## 4.2.2 — 2026-08-21

- Added in-page search to Nodus Browser with Cmd/Ctrl+F, a toolbar search button, match navigation and case-sensitive search.
- Fixed Browser tab recovery so closing the last tab restores exactly one home tab, and fixed vault-switcher and Browser-to-Settings overlay flashes.
- Fixed the Deep Research and Immersion source modal: scrolling works, its size stays stable across tabs, and light mode has its own palette.
- Improved Google compatibility in Nodus Browser by matching Chromium client hints to the real engine version. Third-party Google authentication now completes in the same Nodus Browser session, while Nodus OAuth can return through the `nodus://` protocol.
- Added the fixes and Browser strings to the What's New modal in all eight interface languages.

## 4.2.1 — 2026-08-20

- Fixed Deep Research typography controls freezing the interface, detaching persistent
  highlights and comments, and preventing the selection ribbon from opening.
- Font-size changes now preserve the visible reading position and reuse the 4.2.0 What's
  New presentation.

## 4.2.0 — 2026-08-20

Nodus 4.2 introduces an integrated research browser and a global research radar, brings
databases much closer to Notion-scale workflows, and expands how research reports are
planned, read, annotated and connected back to the Library.

- Nodus Browser provides secure multi-tab browsing, downloads, media controls, local
  bookmarks and history, Research Atlas, Nodi page actions and direct Connector capture
  into the Library.
- Nodus Radar follows topics, searches, authors, journals, papers, RSS feeds and websites,
  checks them on a schedule and gathers updates in a global inbox with notifications and
  Library actions.
- Databases add universal pages and blocks, advanced properties, formulas, rollups,
  relations, templates, tasks, automations, forms, comments, history, permissions and
  virtualized large-data views, together with more faithful Notion imports.
- Deep Research adds seven research approaches that adapt retrieval, planning and writing,
  and records the chosen approach and model with each report.
- Deep Research and Immersion share persistent highlights, comments and bookmarks, while
  the source workspace opens ideas, authors and works in state-preserving tabs with Zotero
  and Nodus Library actions.
- Authors, ideas and argument maps can remain open in independent tabs for comparison, and
  nullable metadata no longer breaks affected searches.
- Global Library record actions move to the detail header, metadata editing is clearer and
  revealing attachments in Finder is reliable from both entry points.
- Nodi's original 100% size is now the maximum, with seven presets down to 40%, and streamed
  answers no longer force the chat viewport to the bottom.
- Large encrypted backups restore with bounded memory and real progress through decryption,
  verification, extraction and finalization while preserving safety snapshots and rollback.
- The What's New modal presents this release in all eight interface languages, with dedicated
  Browser and Radar icons.

## 4.1.6 — 2026-08-18

Nodus 4.1.6 repairs the Zotero import of the Global Library, which catalogued documents
without ever copying an attachment and then refused to run a second time, and keeps the
two reading galleries from forgetting how they were set or flashing on the way back in.

- The Zotero import bundles turndown and its HTML parser as external CommonJS, so loading
  it in the main process no longer throws before the attachment loop and both notes and
  attachments are copied again. A failed import reports the first failure's own message
  instead of always claiming that Zotero is unavailable.
- A 404 from Zotero's `/deleted` endpoint, which the local API does not implement, is read
  as "no tombstones reported" rather than as a missing library, so the second and later
  syncs no longer abort before reading an item. Deletions made in Zotero are not mirrored
  incrementally until a full refresh, which the release notes state.
- The resumable-session banner follows the newest session by `updatedAt` alone, so an old
  failure no longer presents a later clean import as interrupted.
- Ordering, the read filter and grid-versus-list are written to a small per-vault store on
  disk and seed the snapshot Deep Research, the study and teaching unit galleries and
  Inmersión mount with. The search box, the open report and the place in a list stay in
  memory. Deleting a vault takes its stored preferences with it.
- Deep Research and Inmersión hold a quiet pane while the report or session they are
  returning to is read back, showing a spinner only after 250ms, so neither section paints
  its gallery on the way in. A session that no longer exists lands on the gallery.
- The study and teaching organization heading goes through `t()` for its three interface
  fallbacks, which were bare Spanish literals rendered raw, with a regression test.
- The What's New modal presents this release in all eight interface languages.

## 4.1.5 — 2026-08-17

Nodus 4.1.5 puts the floating selection ribbon where the hand that made the selection
left it, and removes the last two places where a search stopped the whole window while
it thought.

- The reader's selection ribbon and the workspace, study and teaching note toolbars wait
  for the pointer to be released and are placed above it, or above the caret when the
  selection was made with the keyboard.
- Clicking a stored highlight reopens the full ribbon with colours, comment, copy,
  bookmark and Nodi quote, with its current colour marked and deletion at the end, so a
  highlight can be recoloured instead of only deleted.
- The research chat and Nodi's active-vault context use the paged vector scans, so asking
  a question no longer blocks the main process, and a new Nodi chat starts with the
  current vault selected.
- `nodus_search_ideas` and `nodus_search_passages` use the paged vector scans too, so an
  MCP client searching from another application no longer freezes the Nodus window behind
  it. `test-mcp.mjs` now refuses the blocking call sites outright.
- The What's New modal presents this release in all eight interface languages.

## 4.1.4 — 2026-08-16

Nodus 4.1.4 keeps the desktop responsive during automatic backups and connected-vault
publication, fixes the first administrator setup in production Cloudflare deployments,
and introduces the project’s new public home at nodusresearch.com.

- Automatic backups and connected-vault publication now run outside the main process with
  bounded memory, hard process deadlines, retry backoff and unchanged-data shortcuts.
- Nodus Cloud can initialise its first administrator on Cloudflare Workers and surfaces the
  server’s real error when deployment setup fails.
- The notification centre reports the outcome of a manual refresh and preserves its last
  valid snapshot when the remote feed is unavailable.
- The redesigned website brings together the wiki, manuals, interactive demos, FAQ, blog
  and contribution paths at nodusresearch.com.
- The What’s New modal presents this release in all eight interface languages.

## 4.1.3 — 2026-08-15

Nodus 4.1.3 extends the section snapshots of 4.1.2 to the three places a reader stays inside the
longest, and remembers how far into a report the reading had got.

### Added

- Deep Research, Immersion and the Library's tab strip restore the item that was open, not only the
  state of their list. A report is found again in the gallery the section already reads, an
  immersion is fetched by id and lands on the step its own progress records, and a Library tab
  reopens with the reference it was opened with.
- A Deep Research report reopens at the block that was under the top edge, counted over the
  paragraphs, headings, quotes and tables of the rendering on screen, so window width, font size and
  a cover image that had not loaded yet no longer move the place. The place is reapplied while the
  report is still growing and yields as soon as the reader scrolls or types. A place counted in one
  rendering is dropped rather than approximated when an applied translation changes the block count.

### Changed

- The composer, the scope screen and an applied translation are deliberately not restored: they are
  work in progress rather than a place in a document.

## 4.1.2 — 2026-08-15

Nodus 4.1.2 orders the author dossier by works before ideas, fixes its modals and connections list,
lets every section remember where you left it, and finishes translating the Cloudflare deployment
flow into all eight interface languages.

### Added

- Every section that renders through the shared list registry (Ideas, Authors, the Global Library,
  the Argument Map, the Library, and the Workspace) restores its filters, sort order, active tab and
  scroll anchor when you return to it, scoped to the active vault.

### Changed

- The author dossier lists an author's works before their ideas.
- The connected authors list on an author dossier shows the five strongest relations and opens the
  full list in a separate modal.

### Fixed

- Modals opened from an author dossier render into `document.body` so a parent `space-y-*` stack can
  no longer give their backdrop a stray top margin.
- The connected authors list and the reader's text-selection ribbon now use the correct surface and
  hover colours in light mode.
- The Cloudflare deployment wizard is now fully translated in all eight interface languages instead
  of English only.

## 4.1.1 — 2026-08-14

Nodus 4.1.1 adds a Cloudflare deployment owned entirely by the person who runs it, publishes the
complete Nodus Wiki and vault manuals, and corrects Global Library file handling, Coverage question
loading, the Contradictions graph and several editor and modal details.

### Added

- Direct user-owned Cloudflare deployment through the official Deploy to Cloudflare wizard, which
  creates D1 and R2 in the owner's own account and publishes a free workers.dev address. Nodus
  receives no Cloudflare credentials or permissions.
- Global Library settings for attachment naming, with three author, year and title formats, per
  file-type selection, name synchronisation and an automatic reading-preparation switch.
- The complete Nodus Wiki and per-vault manuals on the website, with mobile navigation and
  downloadable PDF manuals.

### Changed

- The Contradictions graph preset is routed through the bounded semantic atlas and preserves both
  sides of every retained debate.
- Coverage questions are processed through a serial queue, so several can be launched in a row.

### Fixed

- Saved Coverage questions are reloaded for the active vault, and destructive deletion of a question
  or a Library note is confirmed first.
- Internal protected-span markers no longer leak into text-improvement previews or document content,
  and the synonyms action no longer keeps a persistent outline.
- Nodi renders immediately in update-related modals, and idea type markers stay circular inside flex
  layouts.
- Nodus Server image publication installs workflow dependencies before the server tests and reruns
  when dependency manifests change.

## 4.1.0 — 2026-08-13

Nodus 4.1 aligns its research views, workspaces, server and mobile reader around the same
library-oriented workflow. It also tightens responsive navigation, notification handling,
Word and Chrome integrations, and the visual consistency of Toolkit and the website.

### Added

- Library-style Authors, Ideas and Argument Map views, plus the unified Coverage, Debates and
  Gaps workspace under State of the Question.
- Tags, tag filters, multi-selection, context actions and Trash for workspace notes and ideas.
- Published Library packages with hierarchical collections, metadata, clean Markdown, figures
  and offline document management in Nodus Mobile.
- Multi-vault account permissions, editable access, protected email changes, renameable spaces,
  copyable identifiers and URLs, and canonical vault colours in Nodus Server.
- Chrome Web Store installation as the recommended connector path while retaining the manual ZIP.

### Changed

- Desktop and mobile editors share professional selection tools and searchable model picking.
- Compact sidebars keep the Nodus mark centred, use the vault accent for scrolling, and remain
  usable at narrow window widths.
- Notifications from one document or report are grouped, and update checks can be requested from
  the header or Nodi.
- Update and what’s-new modals retain their presentation with less rendering and memory work.
- Toolkit applications and website demos share their respective product headers and visual system.

### Fixed

- Dark-mode, passage encoding and live citation-style selection in the Word copilot.
- Search-field icon overlap, hidden narrow-window controls, clipped notification badges and theme
  colours that leaked between light and dark surfaces.
- Chrome connector regressions are prevented while Spanish localization and store installation
  are added on top of automatic pairing and scholarly full-text resolution.

## 4.0.1 — 2026-08-12

The Chrome connector now completes its local pairing automatically after it is enabled in Nodus.
It also follows extensionless scholarly full-text links through publisher landing pages, verifies
the real PDF bytes, and prepares clean Markdown from that paper instead of an HTML snapshot.

### Fixed

- **Chrome pairing asked twice for the same consent.** Enabling the connector in Nodus is now the
  authorization step. Opening the extension obtains or renews its loopback token without a native
  dialog, while the extension-origin and bearer-token protections remain in place.
- **Dialnet and similar catalogue links saved the landing page instead of the paper.** Full-text
  labels are detected even when their URL has no extension. Nodus follows guarded public redirects,
  reads publisher PDF declarations such as `citation_pdf_url`, and accepts the result only after
  checking the PDF signature.
- **HTML could be prepared as if it were a PDF.** Both desktop downloads and browser-assisted
  uploads reject HTML or other bytes labelled as PDF before they can become the primary attachment.

## 3.2.6 — 2026-08-09

Nodi becomes a real report reader, authors gain a persistent shelf, and MCP
clients can finally read the same vault content that Nodus itself can see. The
release also makes model reasoning honest and stops two startup modals from
spending resources after they have finished presenting themselves.

### Added

- **Full report context and selection actions for Nodi.** With Current view
  enabled, complete Deep Research reports and Immersion sessions now take
  priority in Nodi's context. Selecting text opens actions to copy it, keep one
  persistent reading bookmark per document, or quote it into Nodi. The same flow
  works in the embedded companion and the always-on-top window.
- **A Saved workspace for authors.** Authors can be saved from cards and dossiers
  and remain saved across rescans through their canonical identity. The saved
  view reuses search, sorting, synthesis filters, pagination, export, dossiers
  and graph navigation, with bulk export scoped to the saved selection.
- **Persistent Deep Research retrieval through MCP.** Dedicated list and detail
  tools expose the saved report gallery independently of the temporary generation
  queue. Catalogues are compact, searchable and paginated, while an individual
  report returns its complete Markdown, evidence selection, traceability matrix
  and bibliography.

### Changed

- **The reasoning level is per job, not per model.** Raising Immersion to High no
  longer raises Deep Research, the writing workshop and every other job pointed
  at the same model. Each job keeps its own level, while Providers retains the
  per-model default used when a job stays on Default.
- **Every MCP read remains available across vault switches.** Clients that cache
  an older tool catalogue can still retrieve ideas, works, passages, notes,
  authors and every other read-only layer from the vault Nodus is serving.
  Mutating and action tools remain restricted to compatible vault types.
- **What’s New and the startup updater settle after their active moment.** Nodi's
  SVG animation and the decorative aurora and confetti now stop, updater progress
  is throttled, and closing the updater detaches its listener and unmounts the
  modal. The one-off 3.2.4 mobile preview also stays retired in later versions.

### Fixed

- **Reasoning levels did not reach scans.** Extraction, summaries, fusion,
  Immersion generation and other structured calls ignored the selected level.
  An explicit level now applies, while leaving it unset keeps the previous fast
  no-reasoning behavior. Returning to Basic mode also clears any hidden per-job
  level that the single picker cannot show.
- **Ideas could reopen with a stale total after a background scan.** The first
  request of every visit now bypasses the vault query cache, while pagination and
  sorting inside the mounted view retain the existing cache.
- **Clearing notifications left announcements behind.** Clear now behaves the
  same in Nodi and in the header, asks for confirmation, removes recent activity
  and persistently dismisses only the announcements currently visible. Future
  announcements remain eligible to arrive.
- **Citation previews in floating Nodi could remain on Loading.** The restricted
  preload now exposes citation previews, and synchronous bridge failures can no
  longer strand the hover card.

## 3.2.5 — 2026-08-07

A corpus that had quietly stopped growing a month ago, the blindfold that kept it
quiet, and the setting that decides how long a scan takes finally sitting where a
model is chosen.

### Added

- **The reasoning level beside the model, in Settings › Models.** Every picker
  that assigns a model to a job now carries its level: the general text model,
  the five shared advanced roles, the per-vault overrides, and the study vault's
  primary and fallback columns. It appears only for models that publish levels,
  which today is Codex and nothing else, so every other row is unchanged.
- **One level per model, shared by both screens.** The level belongs to the model
  rather than to the role using it, and Models and Providers now write it through
  a single function, so setting it in either place sets it for every job running
  that model. Left on «Default» it stores nothing, which keeps it following the
  model's own recommendation when Codex changes it.

### Fixed

- **Deep scans could no longer create ideas once a vault passed 9,999 of them.**
  The id counter was read as text, and the four-digit zero padding keeps a text
  sort honest only up to `g-9999`: past it `'g-9999'` sorts above `'g-10000'`, so
  the allocator kept proposing an id that already existed and every scan with a
  genuinely new idea to record died on `UNIQUE constraint failed: ideas.global_id`.
  It failed at the very end, after the whole extraction had been paid for, and a
  work whose ideas all fused into existing ones still went through, so it read as
  intermittent rather than total. The counter is now read as a number. No
  migration: ids keep their padding and grow to five digits on their own.
- **A failed scan said only "Failed".** The queue has always carried the reason
  and never rendered it, leaving it in the developer console. The state label now
  carries the message on hover.

## 3.2.4 — 2026-08-06

The header stops being a shelf, and Nodus gains a way to say something between
releases. Around that: the project's own accounts, a first look at Nodus on a
phone, and an academic vault that opens with fewer sections than it can fill.

### Added

- **A notification centre button in the header**, immediately left of Settings.
  It shows the same two lists Nodi shows — the announcements published by Nodus
  and what the app has been doing — which matters because Nodi is optional: with
  the mascot disabled the centre was unreachable entirely.
- **An announcements channel.** Nodus can now say something between one release
  and the next: a survey, a known problem, an important change. Notices carry
  their own copy per language, may carry an https link, expire on their own and
  can target a version range. Reading is per notice. The whole thing switches off
  in Settings, and off means no request at all.
- **Links to the project's accounts** from the release modal and from Settings ›
  About Nodus: Reddit, YouTube and X, each with its own mark. The links open in
  your browser and nothing is sent to those networks.
- **A first look at Nodus on a phone**, shown once on this release: nine screens
  of the mobile app, what it does and what it does not do yet, and a short survey
  about whether anybody wants it. The screenshots and the form are English only,
  and the gallery around them says so in all eight languages.
- **On the phone, ask a report about the words you have selected.** The passage
  travels into that report's conversation as a quotation, and the question is
  already about something. Bookmark and Ask now sit at the front of the selection
  menu, ahead of Copy.

### Changed

- **Three icons leave the right rail.** Vaults goes because the centred badge
  opens the same panel, and that badge is now shown at every window width.
  Collections was already in the command palette; Roadmap gains a card in
  Settings › About Nodus.
- **The inbox is conditional on having entries**, since it is per vault and means
  nothing on a local install, and Refresh stops showing in primary-sources
  vaults, which do not sync with Zotero.
- **An academic vault opens with fewer sections.** Gaps becomes a tab inside
  Coverage, because a gap only means something against what your own question is
  missing. Hypotheses and Reading path start hidden, since on a freshly synced
  corpus they answered with noise. Both come back from Settings.

### Fixed

- **The local AI engine answered at the wrong address once it was already
  running.** The request that started the server reached the OpenAI-compatible
  interface, the ones that found it running reached the native one, and that is
  where empty embedding vectors came from, silently. Both exits now derive the
  URL from the same field, with a test that reproduces the difference against a
  stand-in for llama-server.
- **Buttons that laid out without their icon.** A name the icon set does not have
  draws nothing at all, so the control still laid out and still clicked while
  showing a gap — as Next did in Gaps, beside a Previous that had its arrow.
  Twelve names across twenty-six call sites are named again, and a test now walks
  every `<Icon>` tag to keep them that way.
- **On the phone, a citation stopped opening** when the reading bookmark shipped,
  because the two tap recognizers competed. A source now opens the instant it is
  pressed rather than after UIKit has ruled out a double tap, and reading a
  report no longer re-parses its prose every time something on the page changes.

## 3.2.3 — 2026-08-05

Reading, rather than finding. A report can be marked as read, a passage on the
phone can be kept as the place you stopped, and a work on the phone leads back to
its item in Zotero. Search on a connected phone also answers at all again.

### Added

- **A Deep Research report can be marked as read**, on the desktop and on the
  phone. The gallery says so at a glance — a badge over the cover, a lighter
  title — so the question a list of twenty reports raises is answered by
  scanning rather than by opening each one. On the desktop the mark travels
  between your own machines in a sync package; it is deliberately not an edit of
  the report, so it never goes back on the wire to a connected vault.
- **A reading bookmark on the phone.** Select a passage in a report and keep it.
  There is one per report, it is marked in the text itself, reopening the report
  goes straight to it, and tapping the marked words offers to remove it.
- **A work on the phone opens in Zotero.** The Zotero key stops being a dead line
  of the record and becomes the way back to the PDF, the notes and the
  annotations that live in the other app.

### Fixed

- **Search on a connected phone answers again** when what you are looking for
  appears in a theme, a character or a scene. One such match was enough for the
  app to be unable to read the answer, so it showed no results at all.

## 3.2.0 — 2026-08-04

Work that arrives from another device has somewhere to land, and the two places
Nodus used to stop responding — the window while a report is written, the server
while somebody searches by meaning — keep answering instead.

### Added

- **An Inbox in the header.** What another device sends now lands in a record of
  arrivals rather than only where you happened to be looking: the chip says what
  arrived and not just how many, a report can appear while you are elsewhere in
  the app, and an idle desktop still receives because the ledger is drained on a
  timer instead of on the next thing you click.
- **The Deep Research queue says where it stands.** The report being generated
  carries a bar with its real percentage and the ones waiting say how many are
  ahead of them, in place of an icon that spun the same way for a report that had
  just started and one about to finish.

### Changed

- **A semantic search on Nodus Server runs off the event loop.** Working out one
  search used to hold every other request behind it; the arithmetic now runs on
  worker threads and the server keeps replying while it happens. The pool also
  drops a dead thread that was idle, which it previously kept.
- **The snapshot cache is bounded by what it weighs, not by how many vaults it
  holds.** Three published vaults of any size went past a gigabyte for a large
  corpus. The ceiling is memory now, and an administrator can raise it.
- **The desktop, Nodus Server and the mobile app all state 3.2.0.**

### Fixed

- **Generating a report no longer freezes the window.** Nodus goes through the
  whole corpus several times per report, and each of those searches blocked the
  app for as long as it took. They run in parts and hand control back between
  them. The last two that still blocked are paged as well, and the pass that kept
  a hundred ideas stopped looking up the works behind all ten thousand.
- **A finished report appears in the gallery by itself.** With several queued,
  all but the last stayed out of it until you left the section and came back. A
  report that generates but cannot be saved now says so instead of disappearing
  without a trace.
- **The Inbox chips are legible in the light theme.**
- **The ledger stopped reissuing sequence numbers it had already handed out.**

## 3.1.0 — 2026-08-03

Nodus Server stops being a read-only shop window. A vault can now live on a
server and be replicated whole onto a machine, an account's access level in a
space decides where that person's work ends up, and the computer in front of
you can be the server without Docker or a domain.

### Added

- **Connected vaults.** Creating a vault offers a second origin: enter a Nodus
  Server address and your credentials, pick from the spaces the account can
  reach, and pull down a complete replica. It is a real SQLite database on
  disk, not a remote viewer, so the graph, debates, argument map, Deep Research
  and immersions work offline exactly as a local vault does, and a background
  service refreshes it. Losing access leaves the vault whole and merely stops
  the sync, with a plain notice saying so.
- **Per-space access levels, enforced by the replica's own schema.** A reader's
  notes, reports and immersions have no route out of their machine, rather than
  an interface that declines to offer one; a writer's travel to the main vault
  the next time its owner connects, and the screen states how many changes are
  waiting. An administrator assigns several spaces at once, each at its own
  level, and changes a level without revoking and re-granting.
- **Genealogy, teaching, study and database vaults publish too**, not only
  academic ones.
- **Basic server mode.** Settings → Nodus Server runs the identical
  `server/server.mjs` as a child of the desktop, with no Docker, no domain and
  no port forwarding (`electron/localServer/`). The card states who can reach
  it at any moment — this computer only, the local network, or a tailnet — and
  there is deliberately no option to serve the network over plain HTTP. A
  network change that breaks a bound address relaunches the listener, and
  keeping the lid open asks for the administrator password through the OS, not
  through Nodus.
- **The report layout became shared code.** `shared/professionalReport.ts` and
  `shared/deepResearchReport.ts` compile into `server/lib/core/generated/` via
  `npm run build:server-shared`, so a replica or a phone prints the document the
  desktop prints instead of an approximation of it.

### Changed

- **The privacy policy told the truth about embeddings.** It claimed vectors are
  never uploaded, which shared semantic search had made false: idea vectors do
  travel, so a replica or a phone can search by meaning. The document now says
  so and says that it changed, and a new "Include semantic vectors" switch
  really stops it. Passage vectors stay tied to the passages switch.
- **The Deep Research reader header is a rail of icons** that open their labels
  on hover or keyboard focus, the same treatment the titlebar uses, and the
  permanently disabled "Guardado" button is gone — the reader auto-saves, so it
  could never do anything.
- **The add-vault dialog keeps one size** whichever origin is selected, instead
  of collapsing to a third of its height and back.
- **The desktop, Nodus Server and the mobile app share one version number.**
  `scripts/test-version-agreement.mjs` holds `package.json`,
  `server/package.json` and `server/lib/version.mjs` together.

### Fixed

- **A shared study or teaching vault was publishing class recordings, attempt
  records and grading runs.** It no longer does. Report illustrations and
  people's portraits, which a replica used to lose, now arrive complete.
- **Pairing codes contained characters nobody could transcribe.** They were
  built from uppercased base64url, so 22% carried a `-` or `_` inside a group,
  next to the group separator, and the fold of `a` onto `A` made a letter twice
  as likely as a digit. `pairingCode()` now draws from a fixed 32-symbol
  alphabet with no I, O, 0 or 1, five bits per symbol and no modulo bias. The
  endpoint test only failed on an unlucky draw, so the generator has a
  ten-thousand-draw test of its own.
- **An owner membership could not be changed while another owner remained.**
- **The connected password field can be revealed** before it is sent, since
  signing in is one shot and a typo comes back only as "wrong credentials".

## 3.0.4 — 2026-08-01

Deep Research becomes something an MCP client can queue instead of wait on, and
two surfaces stop repeating themselves: a retry that always returned to the
engine that had just refused, and an argument map that redrew every hub as a
star.

### Added

- **Deep Research reports can be queued over MCP.** `nodus_generate_deep_research`
  holds the call open for the whole generation — minutes during which a client can
  time out — and it competed with whatever the window was already generating. A
  single generation lane (`electron/ai/deepResearchQueue.ts`) is now shared by the
  app and MCP clients, and four tools let a client enqueue and poll instead of
  wait: `nodus_enqueue_deep_research`, `nodus_list_deep_research_jobs`,
  `nodus_get_deep_research_job`, `nodus_cancel_deep_research_job`. Each job is
  bound to the vault active when it was queued — checked again before it starts
  and once more before its draft is saved — and switching vault cancels anything
  still waiting for a different one. MCP-originated reports appear in the app's
  queue strip with an MCP badge and raise a Nodi notification when they finish,
  since the client that asked for them may have disconnected by then.
- **The image engine is choosable per image.** The design modal gains a model
  picker listing the whole catalogue with its per-image price; the footer states
  what the button is about to use rather than what last ran.

### Fixed

- **A failed image was retried on the engine that had just refused it.** The retry
  read the provider and model off the failed record, so a report stuck on "the
  image could not be generated" reproduced the identical failure on every attempt,
  and changing the image provider in Settings did nothing for it. The engine now
  comes from the request or from Settings: a failed image opens on the current
  default, a ready one keeps its own, and what a retry repeats is the request, its
  prompt and its style — not the engine.
- **Image failure reasons leaked Spanish or were flattened into a generic
  message.** These reasons are stored and read back later, unlike every other
  runtime error, and reached the renderer two ways that disagreed:
  `localizeIpcPayload` collapsed most of them into "the operation could not be
  completed", the ones its Spanish detector missed leaked verbatim, and the
  `images:changed` event bypassed localization entirely. They are now registered
  as renderer-translated, translated in all seven languages, and every
  `images:changed` broadcast is localized like an IPC result. The modal leads with
  the reason; the reassurance about the report is a footnote. Four reasons that
  interpolated a model or provider name became fixed sentences so they can have a
  translation key at all.
- **The argument map collapsed hub ideas into a flat star.** The local-subgraph
  walk capped the idea budget in row order before ranking by relevance, so a
  well-connected idea silently lost some of its strongest debates; and it kept only
  the edges the walk itself crossed, which for any hub meant no neighbour-to-
  neighbour edge survived — every branch was forced to be a leaf regardless of the
  configured tree depth — while the header quoted the post-cap counts instead of
  the idea's real connectivity. It now expands strongest-link-first, keeps the full
  induced subgraph so branches can ramify, grows the structural tree level by level
  with branches split across debates/support/other instead of ranking alone (which
  handed every slot to debates), and reports real graph-wide connection counts plus
  how many links were left undrawn. Pinned by
  `scripts/test-argument-map-graph.mjs`. Closes #329.

### Changed

- **The website's live demos are usable on a phone.** All six demo vaults ship a
  mobile layout (`site/demo/mobile.css`, `site/demo/mobile.js`) instead of a
  desktop shell squeezed into a narrow viewport.

## 3.0.3 — 2026-07-31

Getting reports out of Deep Research, and a Cancel button that left the job
running. Both the archive and the cancellation are covered by tests that were
watched failing before the fix.

### Added

- **Reports leave Deep Research in bulk, and by the card.** Everything the
  gallery produced left one report at a time through the reader: thirty reports
  meant thirty save dialogs, and a card could not be downloaded without opening
  it. A Download button in the header turns the existing selection mode into a
  bulk export — select-all included, Markdown / PDF / both — and returns one ZIP;
  every card and list row also gains a download icon. Reports are rendered one at
  a time because a PDF is printed by a real Chromium window whose deferred
  teardown only holds if the next print starts after the previous one let go,
  hence the progress bar: a serial pass can run for a minute, and a silent minute
  reads as a hang. Two things `scripts/test-deep-research-archive.mjs` pins that
  a naive archive gets wrong — a zip entry overwrites its namesake, so reports
  sharing a title get distinct names; and each report's files are staged before
  being added, so a report whose PDF fails leaves nothing behind instead of an
  orphan Markdown.
- **"Suggest with AI" in the image design modal.** It streams a scene description
  written from the report's own summary into the prompt box — what the generator
  would have written for itself, which was only ever invisible. Nothing is
  persisted until the user generates with it. Closes #325.

### Fixed

- **The audio Cancel button did not cancel.** Cancelling only added the job key
  to a module-level `Set`. That notified no subscriber, so the panel never
  re-rendered and the click looked like a no-op; and the loop read the flag only
  between segments, always awaiting the synthesis in flight. A long section takes
  minutes, a dead TTS worker or a stalled cloud request never settles, and the
  job then stayed running for the rest of the session with no way to start over.
  Cancellation is now a record per key: a promise the loop races against the
  segment in flight, an `AbortSignal` handed to the synthesiser, and an immediate
  job update so the button acknowledges the click as "Cancelling…". The
  local-voice synthesiser drops the aborted request and terminates its worker
  when nothing else is using it, so a cancelled segment stops burning a core to
  finish a narration nobody will hear. Closes #323.

## 3.0.2 — 2026-07-31

The Deep Research release. The engine used to overstate itself in ways that
compounded: it reported coverage it had not achieved, published attributions its
sources did not support, and printed raw identifiers where a citation should be.
Every number below was measured on reports generated over a snapshot of a real
academic vault, not on fixtures.

### Added

- **The writer now sees the evidence it cites.** The citation menu carried
  placeholders — "an anchored research gap", "a literal passage from the full
  text" — so a report cited zero passages and argued gaps and debates from a
  label. It now carries each idea's statement, what a gap claims, what a
  contradiction opposes and who holds each side, and the literal text of a
  passage with its page. A passage whose text cannot be read is never offered.
- **Citations are checked against their sources.** Each claim is paired with the
  material cited for it and judged for entailment; what a source does not support
  is removed from the prose and from the bibliography, so a false attribution
  cannot survive anywhere in the report.
- **A support-check panel.** A third of the citations that pass verification are
  only partially supported — the source backs a weaker version of the sentence
  than the sentence claims. Those are listed beside the text of their source and
  the author-year to open, turning a manual check from hours into minutes.
- **Reading order is planned.** The planner declares each section's role and what
  it presupposes, and a stable topological sort turns that into the sequence. Two
  runs of the same objective previously produced a genealogy and a flat thematic
  list; the progression is now a property of the engine.
- **Self-contradictions are reported.** A read-only pass flags passages of the
  report that cannot both be right, quoting both sides verbatim and discarding
  any finding whose quotes are not in the text. It never rewrites: editing
  assembled prose would put every verified citation at risk.

### Fixed

- **Coverage counted the plan, not the prose.** Every idea is assigned to some
  section, and assignment counted as coverage, so the statistic read 120/120
  while 77 ideas were really cited — and the top-up that lifts a short report was
  unreachable dead code. Reports landed two pages under their minimum with no
  truncation flag. Coverage is now what the text cites.
- **Reports landed on the floor of their page range.** Sections were sized at
  1400 words on the theory that few long sections beat many short ones; measured,
  a section asked for 1575 words came back with ~1040 and stayed there even after
  being rewritten. Sizing the plan to what a section really delivers moves a
  report from 9 pages to 11–12, with 20% more citations and 22% more ideas.
- **Malformed citations printed raw identifiers.** Models emit references in
  shapes the citation pattern never matched, and those escaped both the prose and
  the accounting. References are now repaired where the label can be
  reconstructed and dropped where it cannot, and a final sweep guarantees no
  `nodus://` identifier can reach the page.
- **Gaps and debates read as debug labels.** "(hueco)" and "(contradicción)"
  appeared 50 times across three reports as visible text in academic prose. A gap
  is now cited by the work it is anchored to and a debate by whoever holds one of
  its sides. Sources whose author the corpus never captured are cited by a
  shortened title instead of "(Author)".
- **Split headings.** `Title: subtitle` headings are folded into one phrase,
  keeping the subtitle rather than truncating it.
- **The abstract and limitations appeared twice.** The reader showed the abstract
  as a subtitle and again as the first section, and the markdown export added its
  own copies on top of the ones already in the body.
- **The argument map and debates froze the window.** They painted tens of
  thousands of elements at once; they now render in chunks as you scroll, and the
  map unfolds one branch at a time instead of opening whole.
- **Image generation with Google.** It was being asked for an image format the
  API no longer accepts.
- **Interviewed characters recited their sheet.** In worldbuilding demo mode they
  answered by reading their own character sheet aloud instead of speaking.
- **The macOS update never finished installing.** Nodus ships unsigned, so it
  replaces its own bundle with an external helper rather than handing off to
  Squirrel.Mac, and the helper waits for the app to exit first. `app.quit()` is
  cooperative and did not always terminate the process — finishing a download
  makes electron-updater start a local proxy and register with Squirrel.Mac
  before it ever consults `autoInstallOnAppQuit` — so the app sat idle in its run
  loop while the helper waited on a PID that never died. Force Quit then killed
  the helper too, nothing was installed, and reopening staged another helper
  doomed the same way. Three layers, because each failed independently: the quit
  falls back to `app.exit(0)` if the process is still alive shortly after
  `app.quit()`; the helper ignores TERM/HUP/INT so it survives a force quit, and
  stops waiting after two minutes instead of forever; and startup reads the
  helper's state file — written all along, read by nobody — so a stalled install
  is reported instead of silently re-offered. Covered by
  `scripts/test-unsigned-mac-update.mjs`, which runs the real generated helper
  against fake bundles and force-quits it mid-wait.

### Changed

- **The Codex runtime bundled with Nodus can generate images**, so a connected
  ChatGPT subscription needs no extra key for illustrations.

### Measured and rejected

Kept in the code with the measurement beside it, so none is retried blind:
multi-probe retrieval (tripled unsupported citations without a relevance floor;
with one, changed 5–10% of the pool while reducing the distinct works behind it),
longer sections (the expansion pass fires on 10 of 12 sections, is accepted, and
the section still finishes at ~1040 words), and preferring literal passages over
derived ideas (verbatim quoting more than tripled, the argument leaned on a third
fewer distinct works, and unsupported citations doubled).

## 3.0.1 — 2026-07-30

A performance release, from an audit run against a real 465 MB academic vault.
No new surface; three causes behind the app feeling slow, plus the tooling that
found them so the other vault types can be measured the same way.

### Fixed

- **Sections that blocked the whole window now open promptly.** Every read path
  runs to completion on the single main-process event loop that also answers the
  renderer, so a slow query is not slow rendering — it is a frozen application.
  The graph bound one placeholder per idea into its aggregate queries, making
  SQLite's cost grow with ideas x works (2,745 ms -> 170 ms). The argument map
  loaded 9,721 nodes and 34,531 edges to fill a picker that shows sixty and never
  reads an edge (448 ms -> 16 ms, and its IPC payload 10.0 MB -> 2.4 MB). Debates
  rebuilt each side once per edge and fetched works one at a time through a batch
  API (261 ms -> 87 ms). The reading path assembled every gap statement in the
  corpus to display three (212 ms -> 157 ms). Author dossiers ran the same theme
  query once per related author (397 ms -> 69 ms).
- **Nodi no longer animates when nothing is happening.** Its SVG repainted every
  frame forever, costing about half a core with the application idle and warming
  the machine. It now holds its pose a few seconds after the last activity and
  wakes on hover, on a state change or on a notification; the animations are
  paused, not removed, so they resume exactly where they stopped.
- **The extracted-text cache is bounded.** It was written with an upsert and never
  pruned, reaching a quarter of the vault file and entering every backup archive.
  It is capped at 64 MB, newest first; evicted text is re-extracted on demand.

### Added

- Six benchmarks under `scripts/bench-*` that measure main-process blocking, idle
  CPU per helper process, per-section render cost in the real window, and SQL
  attribution per statement. They run against a copy of a profile, never the live
  one.

## 3.0.0 — 2026-07-30

Four new vault types arrived in this cycle, which is what moves the major. A
"2.8.0" was briefly authored for the Testimony vault alone and never published;
its notes are part of this release, and no 2.8.0 exists.

### Added

- **Testimony vault, for oral history and journalism.** The unit is the whole
  interview — its preparation, participants, sessions, master files, transcripts
  and the agreement it was made under. The master file enters exactly as
  received, with its SHA-256 checksum and marked immutable; correcting,
  reviewing, approving, anonymising or translating creates a derived version that
  remembers where it came from, and quoted fragments re-anchor when they can and
  are flagged when they cannot. Agreement status, access level and workflow
  status are three independent dimensions behind one gate (`evaluateAccess`) that
  genuinely blocks exports, access packages and what the AI may see. Coding by
  selection, comparisons across interviews, notes carrying quotation and
  timecode, local Whisper transcription, speaker separation with manual naming,
  a consent-governed semantic index, and three archival export packages
  (preservation, access, review) with manifests and stated exclusions. Schema
  v105–v106; demo "Memoria del valle" with synthetic voices generated from its
  own script.
- **Worldbuilding vault.** Characters (a `persons` row plus a
  `character_profiles` overlay, so kinship, life events, places and portrait are
  inherited rather than duplicated), places as a tree of 37 kinds, factions and
  cultures, scenes with independent world-day and narrative orderings, secrets
  with their knowers, and an invented calendar. Maps with nested canvases,
  calibrated scale, pins/outlines/routes, distances and travel-time reports, and
  labels drawn by Nodus rather than the image model. An A–Z encyclopedia with
  `[[wiki-links]]` promoted to `nodus://` links on save. The Analizar layer —
  Rules, Conflicts, Arcs, Continuity and Open questions as five readings of
  `world_beats`, surfaced on the scene sheet. The manuscript as the column the
  scene was missing, with a books shelf, snapshots, typewriter mode and a
  beats-only AI reading. World chat where Nodus computes the facts and the model
  writes with them. Schema v91–v101.
- **Primary Sources vault.** Repositories and archival hierarchy, capture
  sessions, working collections, templates, files served over a restricted
  `nodus-archive:` protocol, reviewed text, excerpts, evidence links,
  proposals, citations, policies, audit records, exports and recovery, plus map,
  timeline, people, relations, notes and research. Reversible synthetic
  documentary demo corpus with generated document images and gazetteer-backed
  places.
- **Prosopography vault.** Canonical evidence-aware domain model, source capture
  and criticism, identity resolution, factoids, population/cohort/questionnaire
  workflows, layered network analysis and interchange. Interview diarization
  preserves the literal transcript, aligns to the timeline, accepts
  expected-speaker guidance and large uploads, and guarantees remote-file
  cleanup.
- **Teaching: the Analyze group and Unit design.** Chat, Ideas and Graph scoped
  to `docencia` over the same `study_*` corpus, and "Unidades didácticas" becomes
  Deep Research with a target audience — teacher lesson plan or student handout —
  threaded through the plan, write and finalize prompts in all seven languages
  (`shared/studyDeepResearchAudience.ts`).
- **Turkish.** The seventh complete interface language, kinship terminology
  included, plus full localization of every Toolkit surface.
- **Product feedback in Suggest / Report.** An optional 0–10 survey (coverage,
  usability, performance, stability, visual design) with free-text, routed to one
  permanent shared thread instead of a new issue per response, with the Nodus
  version and OS filled in. Community Standards files added alongside it.
- **Genealogy branch visibility, custom searchable fact types, configured places
  when recording a fact, and multi-day calendar event bars.**
- **Tutorial video pipeline** (`scripts/tutorial/`), which records narrated
  tutorials by driving the real application. Nothing in the app changes.

### Changed

- **The academic Library is organised around one readable status.** The five
  analysis-pipeline fields fold into one derived readiness value
  (`src/libraryStatus.ts`): twelve columns become eight, each row keeps one
  primary verb plus Zotero and an overflow menu, the four-dimension status matrix
  becomes one-click presets that filter in SQL over the whole corpus, and the
  selection bar drops from eight buttons to one verb with an explicit scope. A
  per-work breakdown retries each step on its own. The two indexes are renamed
  for what they give the reader — semantic search and citable text — replacing
  five controls that all said "Indexar".
- **First run.** The guide shows the introduction alone and says where the rest
  are; the ten published tutorials live in Settings on four shelves with tabs and
  a search box, and a vault's video is offered when that vault is created. After
  the guide, a cinematic screen names the first vault and picks its mode instead
  of handing over an academic vault called "Principal". The vault-type picker
  moved to `src/components/vaultTypeUi.tsx` so the switcher modal and the
  first-run chooser cannot drift.
- **AI setup can be postponed and model downloads cancelled.**
- **Sidebar customization is scoped per vault** instead of applying globally.
- **MCP and Nodus Server reach parity with the new vaults** in snapshots, tools,
  validation and tests; Deep Research export branding is standardized and
  vault-aware; Nodi's product knowledge now describes the implemented Toolkit,
  the available vaults, the server roadmap, collaboration and the planned
  iOS/iPadOS apps.
- **What's New badges read their vault's own glyph and accent** from
  `VAULT_TYPE_COLORS`/`vaultTypeIcon` rather than a second hardcoded copy, which
  is how `prosopography` had ended up slate here and blue everywhere else. The
  MCP scope moves to navy, since blue-600 now belongs to a vault.
- **The Zotero setup assistant names the local API correctly.** There is no
  "local Zotero 7 API"; the client talks to Zotero's local implementation of Web
  API v3. Reworded across the source and all seven translations, and the dead
  `itemsSince()` client path removed.
- **Project documentation is in English**, and the website moved under `site/`
  with its own Pages deployment workflow.

### Fixed

- **The Zotero sidebar connects on its own.** It read
  `~/.nodus/zotero-bridge.json` once at boot, so starting Nodus after Zotero left
  the sidebar on "not connected" until the user opened Settings and pressed Test
  connection. A backoff loop (1.5s → 15s) re-reads the bridge file on every
  attempt and retries immediately on Zotero regaining focus, Settings opening and
  before sending a message. The probe validates the token against
  `/api/z/models`, because `/api/z/health` is deliberately tokenless and would
  report "connected" for a stale token; while the link is up, HTTP
  re-validation happens every five minutes rather than every tick. Plugin
  bumped to 3.0.0.
- **Worldbuilding AI workflows are bounded to author-provided canon.** World chat
  consumes bounded conversation history as non-evidentiary context, citations are
  restricted to the exact retrieved context with a deterministic source fallback,
  prompts are hardened against instructions embedded in vault data, embedding
  vectors are validated so partial indexing cannot be counted or persisted,
  cosine comparisons across incompatible dimensions are rejected, and archive
  embeddings persist provider/model/dimension provenance so edited or legacy
  vectors are invalidated instead of silently reused.
- **Word add-in navigation and localization.**
- **Gray bands around Deep Research PDF cover images**, caused by a blurred cover
  shadow some viewers flatten into filter bounds.
- **Full-resolution originals are preserved and downloadable**, portrait framing
  is retained after dragging, and database image assets load through the native
  cache.
- Light-theme coverage across the worldbuilding views, dropdowns kept inside the
  viewport, manuscript rail overflow, group card styling, and PDF.js font-face
  disabling.

## 2.7.0 — 2026-07-26

### Added

- **Video tutorials, in-app.** First run now asks a third question — watch the
  tutorials or read the written guide — and the video path renders the published
  catalogue as a grid inside the same cinematic chrome, with an in-app player
  (pause, seek, captions, speed, fullscreen). Watched flags are global, so a
  video watched in one vault stays watched in the others. Settings → Tutorials
  leads with the same grid above its replay buttons, and a vault tour whose
  ground a video covers opens with three ways in (watch, walk the app, not now).
  The catalogue is fetched from `site/tutorials.json` in the main process,
  validated entry by entry and cached in `userData`; the three built-in
  tutorials are always a complete fallback. The written deck remains the offline
  path. Existing installs, which were never asked the question, get a one-time
  announcement modal that embeds the same grid.

### Changed

- **The header sync button matches the rest of the rail.** The Zotero sync
  action was the only header icon rendered with `btn-primary`, permanently
  filled with the vault accent colour. It is now `btn-ghost` like its
  neighbours, keeping its spinner and pinned label while syncing.
- **Person dossier add buttons are icon-only.** The `+` actions for family and
  social relations, places, name variants and life events claimed at least 176px
  of the section header and wrapped their own label, squeezing the title and
  description into a one-word-per-line strip. They are now 32×32 icons with the
  wording in a tooltip and a specific `aria-label` per action; the biography
  action, whose label carries state, keeps the wide style.

### Fixed

- **Automatic backups no longer freeze the app.** `createBackupArchive` ran
  unattended every 30 minutes and was fully synchronous: on a 220 MB payload
  `AdmZip.toBuffer()` alone blocked the main process for 3.65 s (0.28 s now,
  async zlib), plus synchronous `scryptSync` and `readFileSync`/`writeFileSync`.
  Linear in library size, so a 1–2 GB library meant 20–45 s of freeze per
  backup. Hashing and entry addition now yield, and `serverSyncService` gzips
  asynchronously for the same reason. The archive format is unchanged.
- **Nodi stays responsive and its lists scroll.** The mascot preload used
  `ipcRenderer.sendSync` for the mouse hit-test — fired on every transition —
  which parked the overlay renderer until the main process was free without ever
  buying the ordering it was written for; the hit test is now fire-and-forget and
  the first frame's placement travels in the URL. Separately, `.nodi-note-row`
  and `.nodi-msg` were left at the default `flex-shrink: 1`, so quick notes and
  chat compressed their rows (33px instead of 60px) and clipped their own text
  instead of scrolling; `flex: 0 0 auto` restores natural heights.
- **The Word add-in installer no longer deletes files from the Office cache.**
  `installCopilotAddin` walked Office's Wef cache and unlinked anything matching
  `nodus` or the add-in GUID, including `Word.RibbonCache.<locale>`, the index
  shared by every installed add-in — which Microsoft documents as a way to make
  all add-ins stop loading. Bumping the manifest `<Version>` is the sanctioned
  way to make Office pick up a changed manifest, and it is now the only thing
  the installer does. `word-addin/README.md` documents the real install flow and
  a troubleshooting note for the unrelated Office-side failure on Word for Mac
  16.109 with work accounts.

## 2.6.3 — 2026-07-24

### Added

- **Zotero plugin self-updates.** The Nodus for Zotero add-on now keeps itself
  current: it registers with Zotero's own add-on updater and installs each new
  plugin release automatically from the latest GitHub Release (downloaded and
  sha256-verified by Zotero, applied on the next restart). This is on by default
  and can be turned off under Settings → Updates; turning it off asks for
  confirmation first. Plugin bumped to 2.7.0.

### Changed

- **Nodus Server publishes every connected vault.** A server pairing is stored
  per vault, but the desktop only published the active one, so a shared vault
  silently went stale after switching away. Every connected vault is now tracked
  and published in the background regardless of which is open, Settings lists all
  connections with their status, and each can be synced or disconnected
  individually.
- **Refined Deep Research PDF report design.** The exported report now uses the
  stylized Nodus brand mark in the header, a clean title-page cover, a centered
  executive summary, automatic section numbering (01–04) and a compact
  table-based traceability matrix; the standalone research outline section was
  removed.

### Fixed

- **Page-aware answers for long Zotero PDFs.** A document map now injects
  authoritative structural facts (total pages, current reader page, first/last
  labels and honest truncation coverage) ahead of the evidence, so page and
  length questions are answered from the map instead of guessed. Positional
  retrieval fetches "current/last/first page" and "page N" deterministically,
  embedding is bounded and non-blocking (only BM25 candidates plus the current
  page embed up front, the rest continues in the background), and full-text mode
  marks truncation honestly while always including the requested pages.
- **Audio narration lifecycle and local Whisper cancellation.** Audio synthesis
  now lives in the global background-jobs store, so generation survives leaving
  the view and the panel restores its progress on return. A Deep Research report
  no longer narrates its abstract twice, Kokoro input is chunked on sentence
  boundaries so long segments are no longer truncated mid-word, and the local
  Whisper worker is no longer terminated on view unmount so an in-flight
  transcription finishes and persists in the background.

## 2.6.2 — 2026-07-23

### Changed

- **Zotero plugin indexing overhaul.** The single index action is now split into
  a Quick index (text extraction and chunking, ready almost instantly) and a Full
  index that progressively computes embeddings in the background, keeping the
  composer responsive. OCR is now on-demand instead of always running during
  indexing, and when reading a single document whose text fits the context
  window, full-text-in-context is used directly, matching the speed of competing
  single-document reading tools.
- **Smarter Zotero retrieval.** Query-time LLM round-trips are reduced: the
  rerank call is skipped when there are few candidates, citation repair is
  configurable (off/auto/always), and agentic search rounds are now configurable
  (default 1, was hardcoded 2). OCR processing is parallelised up to 3 vision
  LLM calls at once, and the local embeddings worker prefers WebGPU with a Wasm
  fallback when WebGPU is unavailable.

## 2.6.1 — 2026-07-23

### Fixed

- The in-app What's New modal for 2.6.0 only surfaced three Zotero-plugin
  highlights, silently dropping every other user-facing change shipped since
  2.5.4. The 2.6.0 and 2.6.1 entries now list the complete set — Nodus Apps,
  Nodus Translate, local FLUX.2 Klein image generation, professional PDF
  exports, the experimental Nodus Server, and the rest of the Zotero add-on
  work — translated into every supported language, so the fix reaches users
  regardless of which version they're updating from.

## 2.6.0 — 2026-07-23

### Added

- **Local semantic search for Zotero.** Nodus for Zotero adds fully local
  multilingual semantic search with a quantised E5 small model: no embedding
  API setup or cost, compressed indexes and vectors persisted in the Zotero
  profile.
- **Long PDF reconstruction and retrieval.** Long PDFs are reconstructed by
  page, column and paragraph with deduplicated headers/footers and
  coordinate-preserving citations/highlights; a bounded two-round retriever
  reformulates searches, inspects page ranges and expands evidence, with OCR
  and visual analysis fallback.
- **Nodus Apps.** A new Toolkit mini-app studio: build AI-generated sandboxed
  web apps and share sessions live via QR code or PIN.
- **Nodus Translate.** Translate pasted text, files and Zotero attachments
  with a chosen AI model, preserving DOCX/EPUB structure, plus a rasterized
  PDF facsimile mode.
- **Nodus Server (experimental).** Self-hosted, Docker-based server for
  sharing a filtered, read-only vault view with a group, reachable remotely
  from ChatGPT/Claude via an OAuth-protected MCP tunnel.
- **Professional PDF exports.** Deep Research, Immersion and Writing Workshop
  now export PDFs with a cover page, table of contents, structured sections
  and metrics.
- **Zotero add-on install/update from Settings.** Nodus for Zotero can be
  installed and updated from Settings, and is also published as a
  `nodus-zotero.xpi` file with every release.
- **Richer Zotero assistant.** In-context chat in the reader popup, an
  auto-highlighter for relevant passages, and the ability to save
  conversations as Zotero notes.
- **Zotero agent mode.** Proposes notes, highlights, tags or field edits from
  the conversation, requesting per-action confirmation by default.
- **Connected workflows guide.** A new onboarding guide explains when to use
  the local MCP server, Nodus Server, the Zotero plugin, or the full
  Toolkit.

## 2.5.4 — 2026-07-22

### Added

- **Office presentation imports.** PDF Presenter can now import PowerPoint,
  OpenDocument Presentation and Keynote files in addition to PDFs. Nodus converts
  them locally through an installed PowerPoint, Keynote or LibreOffice app,
  preserves compatible speaker notes and leaves the original file untouched.

### Changed

- GitHub releases remain as drafts until the macOS, Windows and Linux installers
  and their updater manifests have all been uploaded and verified.

### Fixed

- Closing the main window on macOS and reopening Nodus now restores both the app
  window and the enabled always-on-top Nodi companion.

## 2.5.3 — 2026-07-22

### Added

- **Guided ChatGPT connection via OpenAI Secure MCP Tunnel.** Settings now walks
  non-technical users through creating a tunnel, saving a runtime key, and
  attaching it in ChatGPT. Nodus downloads the current official tunnel client,
  verifies its SHA-256 digest before installation, diagnoses permissions, and
  reconnects automatically without exposing the local MCP listener.
- Runtime credentials stay outside renderer state and process arguments, and
  users can disconnect temporarily or forget the saved connection entirely.
- **Database comparison properties.** Compare two or more source columns and
  write their unique exact majority value per row or across the whole table.
- **Per-column AI models.** Text and image AI properties can override the global
  model, while their long-running cell and column jobs retain progress across
  navigation and report failures cleanly.
- **Spanish Kokoro voices.** Local narration supports Spain and Latin American
  voices with Spanish-aware normalisation and phonemisation.
- **Presenter notes as TXT.** Speaker notes can be exported to a stable,
  slide-numbered text format and imported again after validation.

### Changed

- **Toolkit polish.** PDF Presenter has reliable live annotation tools,
  shortcuts, resizable overlays, a more robust phone remote and better
  single-display behaviour. OCR Workspace adds new/library tabs, content search,
  provider-aware concurrency, model selection when reprocessing and clearer
  progress. Nodus Protect gets consistent controls and live slider previews.
- **Safer Study deletion.** Notes and materials support multi-selection and a
  two-step choice to retain or purge their derived ideas, embeddings, evidence
  and connections. Shared ideas remain intact, late AI work cannot resurrect
  deleted content, and individual ideas can be deleted from their detail view.
- **Clearer Settings.** Legal documents open in localised in-app modals, updates
  have their own section, model selection is separated from local/audio services,
  and favourite models are shared across vaults.
- Nodi chat text is selectable, with controls to copy one answer or the complete
  conversation.
- Shared Study material-table headers are centred and aligned.
- The Teaching vault now carries a BETA badge.

### Fixed

- The Teaching gradebook empty state once again creates the first gradebook.
- The ChatGPT MCP connector is readable in light theme and its guided setup gives
  more precise permission, installation and recovery instructions.

### Notes

- ChatGPT developer-mode permission remains a separate workspace setting managed
  by the user or their ChatGPT administrator.

## 2.3.2 — 2026-07-15

### Fixed

- Restores each vault's embedding provider/model from the metadata attached to
  its existing vectors when the 2.3 migration replaced that selection with the
  OpenAI default. The repair does not delete or reindex embeddings, and future
  intentional model changes are not reverted.
- Recovers favorite models by merging the per-vault fallback copies that 2.3
  left intact, without deleting any newer favorite.
- Restores differentiated task-model choices from the retired 2.2 global fields
  when 2.3 incorrectly collapsed them into basic mode.
- Keeps the basic/advanced mode, migration version and embedding selection with
  the vault they describe. A new or basic vault can no longer overwrite another
  vault's advanced task configuration or vector-index selection.
- Includes the 2.3.1 Safe Storage repair that recovers AI API keys hidden by the
  macOS application-name migration and preserves their encrypted historical
  copies.

### Notes

- Recovery is evidence-based and one-shot. Existing vector BLOBs and user
  documents are never rewritten by this settings migration.

## 2.2.0 — 2026-07-13

### Added

- **Nodi, the Nodus mascot.** A small node-of-light companion floats at the
  bottom right of the window. It can be dragged around, follows the corner when
  the window is resized or maximized, and is toggled from Settings → Interface.
- **Nodi companion menu.** Clicking Nodi opens a radial menu: a streaming chat
  with an AI that is given a compact, Nodus-aware system prompt (active vault,
  models, language) with an optional cross-vault mode; a notification center
  (app-wide store; unread items are flagged with a red badge and Nodi raising an
  arm until read); and a quick help bubble.
- **Per-vault look.** Nodi wears a small accessory that matches the vault mode
  (academic cap, genealogy sprout, study glasses), with a brief animation when
  the vault changes. This can be disabled to show the plain Nodi everywhere.
- **Always-on-top desktop mode.** Optionally, Nodi lives in a transparent,
  click-through desktop window that stays above other applications — including
  apps in macOS fullscreen (via a non-activating panel window).

## 2.1.1 — 2026-07-13

### Changed

- **AI model configuration is now shared across vaults.** API keys were already
  global; the models you select — favorites per provider, every workload/feature
  selector, local-provider base URLs and the image model — now travel with them,
  so configuring a provider once makes it usable in every vault. The shared store
  is seeded only from a vault that actually configured a value, so opening an
  unconfigured vault first can never overwrite a configured one.
- **Removed the "load API keys from another vault" prompt.** Keys and models are
  already shared between vaults, so the importer block in Settings → Providers is
  no longer necessary and has been retired.

### Notes

- No database migration; settings persistence only. The shared model
  configuration lives in `userData/app-prefs.json` alongside theme/language.

## 1.7.2 — 2026-07-11

### Changed

- **AI model dropdowns are now sorted.** Every model selector (feature pickers,
  the research assistant, and the tutor) lists models alphabetically by provider
  and then by model name, so the same option always sits in the same place.
- **Search results reuse each section's own detail view.** Clicking an idea in
  global search opens the same idea detail modal as the Ideas section, and
  clicking a work opens the same modal as the Library; other result kinds jump
  straight to their home view. The generic preview modal has been removed.
- The Argument Map header no longer shows the redundant back-to-graph arrow;
  navigation happens from the sidebar like every other section.

### Notes

- No database migration; the schema stays at v31.

## 1.7.0 — 2026-07-11

### Added

- **Word writing copilot, official beta.** The add-in is now installable from
  the packaged app — no development tooling required. Nodus generates its own
  local CA (10 years, trusted once per machine via the system dialog) and a
  localhost certificate (1 year) that is silently re-issued before expiry, with
  no new trust prompt. Machines that already trusted the old dev certificate
  keep working unchanged.
- The task pane follows the Nodus interface language (Spanish/English), and its
  status chip doubles as a retry button when Nodus is unreachable. The Settings
  section shows the three setup steps and is labeled as beta.

### Changed

- The test suite now runs under Node's built-in test runner: `npm test`
  discovers `scripts/test-*.mjs` and runs the 32 scripts in parallel (seconds
  instead of a serial chain), with unified reporting. Each script remains
  runnable on its own (`node scripts/test-<name>.mjs`); the e2e smoke stays a
  separate `npm run test:e2e`.
- Dependency swap: `office-addin-dev-certs` (CLI, unusable from a packaged app)
  replaced by `mkcert` (pure JS, bundled into the main process).

### Notes

- No database migration; the schema stays at v31.

## 1.6.0 — 2026-07-11

Consolidation release: no new features. Provider configuration that had been
copied across the app now lives in one shared registry, and two real bugs that
drift had already caused are fixed.

### Fixed

- Encrypted exports created with "include secrets" now also carry the optional
  access tokens for local providers (Ollama, LM Studio). They were silently
  skipped on export and left untouched on restore, because the export code kept
  its own — outdated — provider list.
- The MCP model override now accepts every provider the app supports. Xiaomi
  MiMo, Ollama and LM Studio were rejected by an out-of-date provider list in
  the MCP tool schema, so MCP clients could not route writing or deep-research
  jobs through those providers.

### Changed

- Provider identity, display labels, local-server base URLs, the embedding
  provider list and the default embedding model per provider are now defined
  once in a shared registry used by both the main process and the renderer.
  Six independently maintained copies were removed; adding a provider now
  requires touching one file (plus the type union, which enforces the rest at
  compile time).

### Notes

- No database migration; the schema stays at v31. Settings and stored keys are
  untouched.

## 1.5.3 — 2026-07-11

### Added

- Local AI providers: Ollama and LM Studio can now be configured in Settings →
  Providers, alongside the cloud providers. Set the server address (IP and port),
  test the connection, and load the models installed on your machine.
- Loaded models list their metadata inline — parameter size, quantization,
  context length and on-disk size — and LM Studio marks which models are already
  loaded in memory.
- An optional access token per local provider, for instances secured behind one,
  stored encrypted at rest like every other key. Neither provider requires a key
  by default.
- Local models can be starred as favorites and used anywhere a cloud model can be
  used — chat, summaries, deep research, immersion, writing, and more — once
  marked. They also appear as an embeddings provider (e.g. Ollama's
  `nomic-embed-text`); switching embedding model re-embeds the corpus offline.

### Notes

- Ollama runs on `http://localhost:11434` and LM Studio on `http://localhost:1234`
  by default; both addresses are editable, including a LAN IP for a remote host.
- Small local models may produce lower-quality structured output during deep
  scans; Nodus already repairs and retries, so scans degrade gracefully.

## 1.5.2 — 2026-07-11

### Added

- Audio voices (Settings → AI → "Audio y voz"): a search box and filters to find a
  voice quickly. Filter by language for every provider, and — for Hume — also by
  library (Hume's voices vs. your own). Hume language filtering is applied on the
  server via the voices API, and each Hume voice shows its Octave model version.

## 1.5.1 — 2026-07-11

### Changed

- Sidebar: Ideas and Autores now live under "Explorar"; Deep Research moved to
  "Analizar".
- Projects view redesigned to give the writing area more room: the project stats
  and the chapter list moved into the left sidebar (with a project search box),
  the new-project form is now a modal opened from a button, and the chapter text
  no longer splits editor/preview side by side — a single full-width view with an
  icon toggle switches between reading and editing.

### Added

- First run: the setup wizard opens in English and its first step is choosing the
  interface language (English or Spanish).
- Interface theme: a new "System" option follows the operating system's light/dark
  preference and updates live when it changes.

## 1.5.0 — 2026-07-11

### Added

- Audio narration: generate spoken audio of a Deep Research report or an
  immersion. Audio is produced section by section (or stage by stage), so you can
  start listening while the rest is still being generated. Citation buttons are
  never read aloud — only the prose.
- Three voice providers, selectable in Settings → AI → "Audio y voz":
  - **Piper** — native-sounding, offline, per-language voices including Spanish
    (Spain / Mexico); each voice downloads separately.
  - **Kokoro** — one shared, offline English model (downloaded once) with many
    high-quality US/UK voices.
  - **Hume** (Octave) — cloud studio voices using your own API key (billed to
    your account); voices are loaded from your Hume library.
- Voice manager: download/remove local voices and models, add a cloud key, load
  and pick the active voice, and set a playback speed. Local voices run fully
  offline and are cached for reuse.
- A global audio player docked at the bottom of the window: scrub through the
  clip, adjust playback speed (0.25×–2×), play/pause, skip between sections, and
  stop to close it. Playback continues while you navigate the app.
- Each report/immersion has an audio panel to generate, play (one clip or the
  whole thing in sequence), regenerate and delete its narration. Generated audio
  is stored per vault and excluded from backups and sync (regenerable on demand).

## 1.4.7 — 2026-07-10

### Added

- The image "Design" panel is now reachable inside the immersion player (on the
  panorama), not only on the setup screen and the Deep Research reader.
- Upload your own decorative image from the Design panel, in both the immersion
  and Deep Research views. Uploads are compressed automatically to keep local
  storage light.
- After regenerating an image you can go back to the previous one with a single
  click.

## 1.4.6 — 2026-07-10

### Fixed

- Search bars: the magnifying-glass icon no longer overlaps the placeholder text
  in the Settings and Deep Research search fields.

## 1.4.5 — 2026-07-10

### Added

- Find in page (Cmd/Ctrl+F) in the Deep Research reader and the immersion player:
  type to highlight every match and step through them with Enter / Shift+Enter.
- The immersion decorative image now also opens the panorama as a header.

### Changed

- Deep Research report text is now justified.
- In the Deep Research reader, the copy / save / export actions moved into the
  header next to the support-matrix toggle, for a cleaner reading column.

## 1.4.4 — 2026-07-10

### Added

- Deep Research is now a gallery of your saved reports: search across them, sort
  by date or title, and switch between a grid (mosaic) and a list view.
- A generation queue — line up several reports and Nodus generates them one after
  another in the background while you keep working.
- An immersive full-screen reader for each report, with a back button to the
  gallery and its decorative image, citations and export in one place.

### Changed

- Deeper immersions: routes now scale with the chosen depth (~6 stations for a
  quick pass, ~12 for an afternoon, ~20 for a deep dive), and the planner may use
  a coherent few more or fewer as the topic warrants.
- The immersion curriculum planner was reworked to build a progressive,
  well-sequenced route that can devote several consecutive stations to deepening a
  single rich thread instead of cramming it into one stop.
- Immersion time estimates now reflect the actual length of the planned route.

## 1.4.3 — 2026-07-10

### Added

- New "Image design" dialog for Immersion and Deep Research: preview the image,
  switch style, edit the scene description, and regenerate or delete it in one place.
- Five photographic and realistic decorative styles — realistic photograph,
  vintage photograph, black & white, cinematic, and oil painting (twelve in total).
- An editable scene description that rebuilds the prompt for the chosen style while
  preserving the "no text" safeguards.

### Changed

- Decorative images now render larger and more polished. The inline action buttons
  are replaced by a single unobtrusive "Design" pill that opens the design dialog,
  keeping the Immersion and Deep Research views uncluttered.
- The "immersion ready" screen is now part of the main immersion view instead of a
  separate standalone page.

## 1.4.2 — 2026-07-10

### Added

- Optional single decorative images for Immersion and Deep Research, generated
  only after the main content has been saved.
- Seven centralized styles, optimized reusable images and lazy list thumbnails.
- Independent image-provider/model settings for Google, the official OpenAI
  Images API, and live image-output OpenRouter models.
- Published input/output/per-generation pricing, unavailable-price states,
  real-time search, and provider-safe sorting.
- Persistent image audit/status metadata with manual retry, delete, and confirmed
  regeneration controls.
- A common full-detail modal for every textual and semantic search result type.

### Changed

- Search results no longer navigate to the graph automatically; graph/location
  actions are secondary modal actions.
- The search disclosure chevron rotates without simultaneous vertical movement.
- Full encrypted backups now include decorative image records and BLOBs.

### Reliability

- Image errors, timeouts, missing credit, or provider failures never roll back or
  block an Immersion or Deep Research report.
- No automatic image retries or duplicate generation of an existing ready image.
- Stale and deleted in-flight attempts cannot overwrite the current image state.
- Existing saved content without images remains fully compatible.

### Known limitations

- Google-generated images include mandatory SynthID provenance.
- OpenAI GPT Image access can require organization verification.
- OpenRouter pricing units vary by endpoint, so price ordering is scoped within
  provider groups and unavailable values are not estimated.
- Decorative image BLOBs are included in full backups but not the lightweight
  cross-vault sync package.
