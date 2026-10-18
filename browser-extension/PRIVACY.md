# Nodus Research Connector privacy policy

Last updated: 15 October 2026

Nodus Research Connector has one purpose: capture a document or web reference chosen by the user and save it in the user's local Nodus Library.

## Data handled

Only after the user clicks the Nodus toolbar icon, the extension reads the active tab's URL, title, embedded bibliographic metadata, structured data, document links, and—if selected by the user—the page snapshot or document file. It also reads the collection and tag catalogue returned by the locally running Nodus desktop application.

## Processing and storage

Captured data is sent to the Nodus desktop application through the loopback address `127.0.0.1`. The pairing token, port, last selected collection and user-confirmed save jobs are stored in Chrome's local extension storage. Pending jobs retain the reviewed capture until Nodus acknowledges it; completed history is limited to 20 jobs and contains progress, reference titles, attachment URLs and errors rather than full page snapshots. Nodus stores accepted records and files in the user's configured `nodus-library` folder.

The extension does not send captured content, browsing activity, credentials, or library data to Nodus developers. It contains no analytics, advertising, tracking, or telemetry code. Bibliographic identifier enrichment performed by the desktop application may contact the public metadata providers documented by Nodus (for example Crossref, Open Library, PubMed, or arXiv).

## Permissions

- `activeTab` and `scripting`: inspect only the tab on which the user clicked the extension.
- `storage`: retain the local pairing token, port, last collection and save progress.
- `alarms`: resume previously confirmed jobs after an interruption; no new pages are read.
- `http://127.0.0.1/*` and `http://localhost/*`: communicate with the local Nodus desktop application.
- Optional per-site HTTP/HTTPS access: retrieve a user-selected attachment only when Nodus first fails to download it without the browser session. The user clicks “Authorize and download” to request that exact site; newly granted access is revoked after the transfer. An on-demand Manifest V3 service worker lets that user-confirmed transfer finish if the popup closes.

Users can revoke site permissions in Chrome, forget the pairing from the extension settings, disable the connector in Nodus, or delete captured records from the Nodus Library.

Nodus Research Connector's use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. Data is used only to provide the user-facing save-to-Nodus feature, is not transferred for advertising or profiling, and is not made available for human review except when the user explicitly supplies it for support or law requires it.
