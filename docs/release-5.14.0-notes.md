# Nodus 5.14.0

## New features

- Each vault can keep several embedding indexes, one for each model you use. When you select another embedding model in Settings, Nodus shows how much content can be reused and how much is pending before you choose Prepare and activate. The current index stays active while the new one is prepared. Switching back to a saved index activates it without generating the embeddings again.

- Compare A/B retrieval runs the same test questions against two saved indexes without activating them. It calculates quality metrics only when you enter the complete list of relevant results for a question. The comparison can be exported.

- Research Chat has a request queue. Press Cmd+Enter on macOS or Ctrl+Enter on Windows and Linux to add a request to the queue. Each request keeps the model, sources and options selected when you added it. Requests run in order, and you can reorder, edit or delete them, or pause the queue.

## Enhancements

- Search in indexed texts can reorder its results with an optional local model. The model requires a separate download and does not change the embeddings. If reordering fails or takes too long, the original order is kept.

- Indexes for E5, Nomic, Gemini and EmbeddingGemma 2 models prepare questions and documents in the format each model expects. The model input profile also accepts custom prefixes. Existing indexes keep the format they were created with.

- The Web search and Verify sources controls in Research Chat are now icon buttons with tooltips. This leaves more space for writing the request.

## Fixes

- Indexing a new document no longer freezes Nodus in vaults with many indexed texts. Earlier documents remain searchable while it is added.

- Changing the sources of an existing Research Chat conversation keeps its earlier messages. Follow-up requests such as asking to review the answer again keep the original question and topic.

- Idea search in Research Chat returns valid ideas again when the vault contains current and older indexed versions of the same works. The context summary lists only the idea and passage sections that were sent to the model.

- Conversation titles in the Research Chat sidebar use the full width of the row. The pin and more actions buttons appear over the right edge on hover or keyboard focus.

- Nodus requests embeddings from OpenAI-compatible providers explicitly as decimal numbers. This prevents vectors from being decoded incorrectly.
