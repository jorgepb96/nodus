# Nodus 5.16.0

## New features

- When text is read aloud, Nodus highlights the sentence and the word being spoken. This works in Deep Research, Research chat, the Dictionary, Nodus Scriptor, study documents and Immersion. The Library’s Markdown reader can also read aloud from the visible block or from the selection. The view follows the reading. If you scroll the text yourself, a button takes you back to the narration. ⌥/Alt + click on a word makes the audio jump to it. At higher speeds, groups of words are highlighted. In Settings, Voice and narration, you can choose word and sentence, sentence only or no highlight, and a colour fill or underline only.

- The Nodus add-on for Zotero offers three local embedding models in Settings: Multilingual E5 small, Granite 97M Multilingual R2 and Harrier 270M. Only the model you choose is downloaded. Granite is the default if you have not chosen another. When you switch models, the new vectors are prepared before the model is activated. If you cancel or something fails, the current model stays in use. Preparation continues when you change item or reader. Settings shows the active model, progress, errors and a cancel button.

## Enhancements

- The Nodus add-on for Zotero prepares the local model when it starts and downloads it if needed. When you open an attachment in the reader, it prepares its text and vectors in the background. You no longer need to open Settings or click Prepare. The chat stays available meanwhile. Turning off document context also turns off automatic preparation.

- Linked Zotero collections now sync on their own after the window opens and when you open an academic vault, including in manual sync mode. This sync only updates the catalog. New sources follow your automatic embedding preference, and Ideas and summary analysis are not turned on. In the Library, This vault uses compact icons with translated tooltips, including a new button to sync Zotero manually.

- The handle for resizing the sidebar of the Nodus add-on for Zotero is now 6 pixels wide instead of 1. It shows the resize cursor and is highlighted when you hover over it.

- The Library now calls the reading version it generates Markdown instead of clean version. The actions are Open Markdown and Rebuild Markdown. Preparation and error messages use the same name, also in the Nodus Server web app.

## Fixes

- In the Nodus add-on for Zotero, each item keeps its own conversation. Moving to another item opens its active conversation or an empty chat, and going back restores the previous one. Returning from the reader to the Library tab keeps the chat and its sources. Your messages are saved before the response starts. Local history is on by default unless you had turned it off.

- Syncing Zotero collections while ideas are being extracted no longer freezes the window on macOS. Documents are read in separate processes, and extraction and chunking share a limit on processor use. Saved summaries that stayed marked as pending are recovered, and the view refreshes when a job finishes.

- Nodus Sign shows the specific reason when it cannot continue, instead of a generic message. It says when there is no document, when a signature must be added or the operation confirmed, or when the page range is not valid, with an example such as 1, 3-5.

- The library Nodus uses to read ZIP files is updated to version 0.6.1. It fixes seven published security advisories, including file overwrites through symbolic links and decompression bombs.
