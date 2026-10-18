# Chrome Web Store release checklist

## Suggested listing

- **Name:** Nodus Research Connector
- **Summary:** Save academic pages, documents, metadata, collections, and tags to your local Nodus Library.
- **Category:** Productivity
- **Language:** English, Spanish, French, German, Portuguese (Portugal), Portuguese (Brazil), Italian, Turkish, Simplified Chinese, Japanese, Korean, Russian and Traditional Chinese
- **Single purpose:** Save the current user-selected page or document to the locally running Nodus desktop application.

Use the project logo for the store icon. Provide at least one 1280×800 or 640×400 screenshot that
shows the detected document type, hierarchical collection selector, searchable tags, file choices,
and automatic local connection status. Do not use screenshots containing private library data.

## Permission justifications

- **activeTab:** read bibliographic metadata from only the tab on which the user clicks the icon.
- **scripting:** execute the bundled, deterministic metadata collector in that active tab.
- **storage:** retain the loopback port, pairing token, last chosen collection, and pending save jobs on the device. Completed history is limited to 20 jobs.
- **alarms:** recover only user-confirmed save jobs interrupted by browser or service-worker shutdown.
- **127.0.0.1 / localhost:** send the reviewed capture to the local Nodus desktop app.
- **Optional website access:** download only an attachment selected by the user when its site
  requires the active browser session and Nodus's public download has failed. Chrome presents this
  exact-site request at use time, and the connector revokes newly granted access after transfer.

No permission is used for advertising, analytics, browsing profiles, or unrelated functionality.

## Publication

1. Register a Chrome Web Store developer account, accept the developer agreement, and pay Google's
   one-time registration fee.
2. Run the full verification commands, then `npm run browser:zip`.
3. In the Chrome Web Store Developer Dashboard, create a new item and upload
   `dist-browser/nodus-research-connector-chrome.zip`.
4. Complete the store listing, distribution regions, privacy practices, permission justifications,
   support URL, and the public privacy-policy URL. Declare that authentication information and page
   content are handled only for the user-facing feature and are not sold or used for advertising.
5. Link the exact source for the released version and identify Nodus as `AGPL-3.0-only`.
6. Save as a draft, resolve every dashboard warning, submit for review, and publish only after review
   succeeds. Keep the item ID stable for later updates.

The release owner must perform these account-bound steps. Nodus cannot silently install an
extension, accept the Web Store agreement, pay the fee, or submit under somebody else's Google
developer identity.

## Update discipline

Every update must increment `manifest.json`, keep it synchronized with the Nodus version, rebuild
the ZIP, and upload that ZIP to the existing item. Manifest V3 forbids remote executable code, so
all JavaScript used by the connector must stay inside the submitted archive.
