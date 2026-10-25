# Nodus 5.13.0

## New features

- Nodus Research Harness is the new shared engine for Research Chat, Deep Research, Immersion and Dictionary. It organizes the investigation, uses the enabled sources and options, asks related questions and connects findings to the original question. It can stop searching when further work adds little useful information. The activity panel lets you inspect tasks and pause, continue or cancel the investigation.

- Fast and Expanded modes control research breadth. Fast focuses searches and readings. Expanded gives more room to explore related questions and compare sources. Chat and Dictionary start in Fast, while Deep Research and Immersion start in Expanded. Each tool remembers your choice independently of the model’s thinking level.

- EmbeddingGemma 2 is an additional experimental local model for semantic text search. Its 512 and 256 dimension profiles share one optional download and run on the CPU. Switching profiles requires preparing compatible indexes. It is unavailable on Intel Macs. Existing default models are preserved.

## Enhancements

- Chat distinguishes research requests from translations, paraphrases and text edits that do not require source lookup. A later explicit request to search the sources starts a lookup even if the previous answer did not need one.

- Chat answers use connected prose, with headings only when requested. Notices about source availability open from a separate alert button and stay outside copied text.

- Documentary retrieval preserves prose after PDF tables that continue across pages and keeps relevant passages when fitting the model context. Verify sources improves checks of citations, coverage and calculations based on the sources. It remains optional and off by default.

## Fixes

- Scriptor’s citation picker can be closed while it searches for sources. Searches read the necessary metadata and load details for selected sources. Focus and bibliographic edits are preserved, and stale responses cannot replace a newer search.

- Scriptor asks for confirmation before deleting uploaded or AI-generated images and supports undoing deletion. Large images are stored as vault assets to avoid size errors when saving documents. Previews and downloads remain available.

- Graph research actions show one translated tooltip on hover or keyboard focus, without repeating the same text.

- Synthesis route compatibility checks also recognize consumed reagents listed as reactants. This allows incompatibilities to be detected even when the reagent is absent from the conditions or agent list.

- Text generation has improved compatibility with OpenRouter models that do not support reasoning. Optional visual planning accepts lists of proposals, including an empty list when no figure is useful.
