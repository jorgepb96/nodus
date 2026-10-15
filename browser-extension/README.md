# Nodus Research Connector for Chrome

Nodus Research Connector captures the page or document that the user has deliberately opened and saves it
to the local Nodus Library. It is a separate Manifest V3 extension and does not require a Nodus
account or a hosted service.

## What it detects

The connector combines the same categories of evidence used by modern bibliographic connectors:

- direct PDF, EPUB, office, text, dataset, image, audio and video URLs;
- Highwire/Google Scholar citation metadata and publisher PDF links;
- Schema.org/JSON-LD, COinS/OpenURL, Dublin Core and Open Graph metadata;
- DOI and ISBN values embedded in metadata or the URL;
- linked files advertised by the page.

Nodus then enriches DOI, ISBN, PMID/PMCID and arXiv records through the desktop application's
existing metadata resolvers. The user sees and may correct title, authors, date, publication, DOI and
the detected Zotero-compatible item type; select a nested editable Nodus collection; review tags;
choose files; and decide whether to retain a bounded readable page snapshot. Search/result pages
that expose independent COinS or Schema.org records can be reviewed one reference at a time and saved as a batch. Each reference retains its own metadata, tags and file choices.

Imported Zotero collections remain read-only. They can be synchronized by the Zotero workflow,
while the browser connector writes to the Library root or to Nodus-owned collections. Saving an
attachment queues the usual clean-reading extraction in the desktop application.

## Install locally in Chrome

1. In Nodus, open **Settings → Integrations → Nodus Research Connector**, enable the connector,
   and choose **Download Chrome extension**. Alternatively run `npm run browser:zip` from this
   repository.
2. Extract `nodus-research-connector-chrome.zip` to a permanent folder. Chrome cannot load an unpacked
   extension directly from a ZIP archive.
3. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the
   extracted folder containing `manifest.json`.
4. Pin the stylized Nodus icon from Chrome's Extensions menu.
5. Leave Nodus open, visit a paper, book page, or document, and click the icon. When the connector
   is enabled in Nodus it establishes or renews its local pairing automatically.

To update an unpacked build, replace the extracted files and click **Reload** on
`chrome://extensions`. The local connection can be reset in the extension settings, while Nodus
Settings can rotate connector access for every installed browser.

## Security and privacy

The extension uses `activeTab`, not permanent browsing-history access. It runs the detector only
after a toolbar click. Its only mandatory origins are `127.0.0.1` and `localhost`, where Nodus
exposes a token-authenticated, extension-origin-only API. Cross-site attachment access is optional
and requested for the exact site only after Nodus cannot retrieve the selected public URL itself;
newly granted access is revoked after transfer. The package contains no analytics, advertising,
remotely hosted code, or `eval`. Its Manifest V3 service worker owns pairing and the entire confirmed save job, so closing the popup does not interrupt pairing or the remainder of a batch. A local history shows saved references, pending files and failures. Failed operations can be retried; completed references and files are retained. A recovery alarm resumes interrupted jobs after worker or browser restarts.

Requests to the local Nodus API use extension-page `fetch()` with both the standard installed
extension origin and a dedicated request marker. Current Chromium versions allow extensions with
explicit loopback host access to set `Origin`; updated Nodus builds accept the marker only when an
older Chromium build omits that header. Any request carrying an ordinary web origin is rejected.
Initial pairing requires confirmation in Nodus. The resulting token is bound to that exact
extension origin and remains limited to the loopback-only API.

See [PRIVACY.md](PRIVACY.md) for the Chrome Web Store disclosure and
[STORE_LISTING.md](STORE_LISTING.md) for release instructions and permission justifications.

## Interface language

The connector ships thirteen languages, one catalog per language under `_locales/`: the nine the
interface speaks (English, Spanish, French, German, Portuguese (Portugal), Portuguese (Brazil),
Italian, Turkish and Simplified Chinese) plus Japanese, Korean, Russian and Traditional Chinese,
which the extension carries ahead of the desktop interface. Every string a user can read lives
there, including the popup, the settings page, the privacy page and the errors the Manifest V3
worker reports back into the popup. All thirteen catalogs must define the same messages with the
same placeholders, and the static markup mirrors the English catalog so the copy can be reviewed in
place; `scripts/test-browser-connector.mjs` fails when a message, a placeholder, a translation or a
rendered surface drifts.

The pure `lib/` modules carry no Chrome API, so they cannot read `_locales` themselves. They default
to English labels and accept the ones the adapter renders (`DETECTOR_LABELS`, `METADATA_LABELS`, and
the transfer message passed to `readResponseWithLimit`). Document-type names are the exception to the
catalog rule: they live in `lib/presentation.js` for all thirteen languages because the Chrome popup
and Nodus Browser's own review dialog share that table.

## Development and verification

```bash
npm run browser:zip
node --test scripts/test-browser-connector.mjs
npm run verify:browser-connector
npm run verify:browser-capture-jobs
npm run test:e2e:browser-connector
# Also exercise native optional-permission approval in a visible test browser:
NODUS_TEST_HEADED=1 npm run test:e2e:browser-connector:recovery
```

Tests use a temporary Nodus profile and a synthetic Library. They never open or mutate the user's
real vault, Zotero database, or `nodus-library` folder.
