# Nodus 5.10.0

## New features

- Academic vaults offer Simple, Intermediate, Advanced and Custom interface profiles. Choose which sidebar sections and header buttons appear, and change the profile, theme, language and Nodi options from the Interface selector. New local academic vaults start in Simple. Existing vaults keep their layout, and switching profiles preserves your saved custom layout and research.

- Academic vaults include 12 resumable lessons in the real workspace. Prepare sources, ask questions and check citations, extract ideas and inspect their evidence, or practice research tools and Scriptor. Each lesson checks the results of your actions. Initial setup configures chat and embeddings separately from idea analysis.

- Bookmarks is the default home page in Nodus Browser. Mark favorites, show only favorites, sort by date or name, put folders first, and switch between cards and a list. Custom home addresses and blank-page settings are preserved.

## Enhancements

- Report galleries support several values in each filter, show option counts and let you clear all filters at once. Deep Research adds approach and language filters where applicable. Immersion adds progress and language filters.

- Research, writing and browser workspaces use consistent tabs with visible close buttons and horizontal scrolling. Scriptor tabs sit above the formatting toolbar, and the active tab stays in view.

- Desktop installation packages are smaller. Codex and GitHub Copilot engines download when first needed, with progress and retry controls in the queue. Existing users of these providers receive the engines automatically after updating.

- Startup no longer shows the old Presenter, mobile preview, integrations, Toolkit beta or tutorial catalogue announcements. Current tutorials remain available.

- Reaction index preparation supports forward reaction templates and externally supplied atom mappings. For large synthesis targets, compatible Chemistry Studio versions can search evidence for individual building blocks. If decomposition is unavailable or incomplete, searches use the whole target.

- Research answers can use the full output limits of GPT-6.1 Sol and Claude Fable 5.1, allowing longer responses.

- Deep Research keeps reader actions in fixed positions when you hover or use the keyboard. Audio narration opens from the reader toolbar, with generation, cancellation and playback controls in a dialog.

## Fixes

- New citations and generated reports use the content language. Report and exam exports and portable backup text use the interface language. Previously saved content keeps its original text.

- Japanese and Korean labels now distinguish read status, reading progress and actions correctly in the desktop app and Server web.

- Research retries a truncated answer with a lower supported reasoning level when available. It also allows more time for models that think without streaming text before treating the response as stalled.

- Synthesis route checks compare molecular connectivity instead of the order of atoms in SMILES text. Equivalent structures no longer cause false errors, while connectivity and regiochemistry errors still fail the check.

- Nodus Server in basic mode starts correctly from the installed desktop app. Its web interface, shared vaults and published links are available.

- Nodus Scriptor’s 13 built-in improvement styles show translated names, descriptions and instructions in every interface language. Selection and advanced formatting controls have consistent sizes.

- Dictionary entries use the model, reasoning and web search settings from the main toolbar. Duplicate controls and empty progress rows have been removed.

- The sidebar scrollbar and header logo follow the selected color palette in light and dark modes, including custom themes and system theme changes.
