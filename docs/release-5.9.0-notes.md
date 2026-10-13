# Nodus 5.9.0

## New features

- Backups, in Tools, exports the content you choose from one or more vaults as Markdown, CSV or JSON, to a folder or a ZIP file. You can select individual records, include the library documents linked to those vaults or the whole library, and save the selection for later use. Research can be organized by works, authors or ideas. The complete .nodus backup remains available in the same tool. Available on Desktop.

- Nodus Scriptor supports dictation with installed local transcription models. Words appear in the document as you speak, as ordinary text you can edit and undo. You can pause, resume or stop dictation. Audio is not sent to any external service. Available on Desktop.

- When you select text in Nodus Scriptor, you can ask the AI to improve it using a style from your prompt library, the model you choose and optional instructions. The proposal appears in the text as it is generated, with added and removed words marked. The document changes only if you accept the whole proposal, and you can undo it in one step. Available on Desktop.

- Nodus Scriptor can create images with AI from a description. Choose the image model, review the preview and insert the image at the cursor position. You can cancel generation and save favorite models. Available on Desktop.

## Enhancements

- Research Chat is faster in large libraries. Searching documents, collecting evidence for ideas and syntheses, and checking the Zotero scope take less time. Long conversations stay responsive while an answer is being written.

- The graph loads the complete map of large libraries much faster. Ideas and their connections appear in seconds instead of minutes.

- Nodus Scriptor uses the colors of the active vault or the selected theme in light and dark modes. Dictation settings and additional formatting options open in separate menus, and the formatting bar no longer needs scrolling.

- Nodus Cloud deployments on Cloudflare limit daily and monthly synchronization usage. When a limit is reached, synchronization pauses and Nodus shows a notice. Importing large vault copies no longer blocks the app, and connected copies can synchronize with each other while the publishing device is offline. Requires updating the service on Cloudflare.

## Fixes

- Opening an attachment or preserved source that is an executable file shows it in the file manager instead of running it. The local network PIN for PDF Presenter and shared apps limits attempts. Browser downloads no longer overwrite existing files. The HTML of imported publications is cleaned before it is displayed and keeps mathematical formulas.

- Backups larger than 4 GiB are created correctly. Synchronization keeps changes made during an upload, does not restore items deleted in another copy and includes all Nodi notes. If the first download of a connected vault fails, the connection is undone.

- Changes typed just before leaving a page are saved. Closing a recording while microphone permission is being requested releases the microphone. Notion imports with links to files outside the ZIP complete with a notice. GEDCOM export keeps both parents when neither is recorded as male.

- In synthesis route checks, each step shows a result consistent with the route verdict, including continuity errors. Stopping the check keeps the answer you were viewing, and requests to search the web are followed.

- Cancelling a call to a plugin tool stops the processes it started. A timeout in one call no longer makes other calls fail, and removing or updating a plugin stops its running processes.

- Works whose document index completes after an error no longer appear under “With errors”. An unreadable page no longer cancels OCR or causes a whole PDF to be rejected. Duplicate detection checks every record, not only the first 5,000, and ISBNs separated by spaces are read individually.
