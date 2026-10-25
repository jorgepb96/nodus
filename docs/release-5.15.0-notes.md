# Nodus 5.15.0

## New features

- Nodus Support is a separate application for when Nodus does not start or shows errors. You install it only if you need it, from Settings → Help, and it is not part of the Nodus installer. It checks your profiles and vaults on isolated copies, creates protection copies of your data and verifies them. It also prepares a bug report that you review before you share it.

- Nodus can read text aloud with three local engines: Ming 3.0, which can clone voices, Phonon and Kokoro. The Listen button is on Research Chat answers, in Immersion, Deep Research, the Dictionary and the Nodus Scriptor header. In Scriptor you can also listen to only the selected text. The voice is generated on your computer. Engines, models and voices are installed and managed in Settings → Voice and narration.

## Enhancements

- Research Chat has a Context button next to web search. One click pauses indexed texts, ideas, full documents and the web, and the AI answers from its general knowledge. Another click restores exactly the previous selection. The Context → Focus panel also has a Select all switch for the four layers.

- Research Chat answers have a Copy without references action next to Markdown copy. It removes parenthetical and Nodus citations and keeps explanatory asides in the text. When you drag a conversation, the destination folder or project is highlighted with a clearer border and background.

- Cmd+F on macOS or Ctrl+F on Windows and Linux searches the open Research Chat conversation and the visible tab of the citation workspace. The citation workspace now fits its content and takes less space. Its passage headers link to the work and the author, and opening the source in Zotero keeps the cited page and attachment.

- Harrier 0.6B is a new built-in embedding model that runs on your computer. It downloads from Settings like the other local models. It accepts texts of up to 8,000 tokens and is recommended with 16 GB of memory.

- Settings offers three local models to reorder search results: BGE Reranker v2 M3 in a light and a full version, and Qwen3 Reranker 0.6B. Each one shows its size and license, and can be downloaded, selected and deleted. The model you already had installed is detected and is not downloaded again.

- BGE-M3 and GTE Multilingual Base have a new profile that processes texts the way these models were trained, which gives better search results. Existing indexes keep working without a rebuild. A note on the index offers to prepare the new version, and both profiles share the same model download.

- Answers about chemical synthesis routes in Research Chat remember the data of each structure already analyzed. Later turns of the conversation do not calculate it again, so long routes answer faster.

## Fixes

- Research Chat answers no longer fail while the library is being indexed at the same time. Nodus checks which documents the answer may read and with which permissions, and no longer cancels it because the extracted text of a document changed. If a document enters or leaves the scope, or its permissions change, the answer still stops.

- When you load a provider’s models in Settings, Nodus first saves the API key you just typed. If it cannot be saved, the typed key is kept, the error is shown and the provider is not contacted. Custom providers, Ollama and LM Studio also save their credentials before loading models or testing the connection. A rejected key is now reported separately from a connection failure.

- Remote model catalogs and downloads of built-in models and runtimes now use the proxy and certificates configured in the system. They now also work on university and company networks that require a proxy. Direct connections to Ollama and LM Studio do not change.

- The Ready and Incomplete filters in the Library show the correct works again in vaults with indexed passages. Since 5.14.0 they were swapped: Ready showed no works and Incomplete showed all of them.
