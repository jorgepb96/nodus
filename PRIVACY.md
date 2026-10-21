# Nodus Privacy Policy

**Version:** 1.3

**Date of validity:** 10 August 2026

**Scope:** Desktop application Nodus 2.5 and later

## Clear summary

Nodus is a free, open source and mainly local application. It does not require a Nodus account, does
not incorporate advertising, telemetry, remote analytics or send content to a cloud operated by the
project. Databases, files, recordings, transcripts, notes, files and results are saved on the user's
device unless it expressly activates a remote function.

Selecting a file or starting a recording **does not publish it or upload it to Nodus**. Some
optional features can contact third-party services: for example, a user-chosen cloud AI provider,
Zotero, Unpaywall, GitHub to check updates, Hugging Face to download models, OpenAI secure MCP
tunnel to use Nodus from ChatGPT, or the web search of Research Chat, which sends the search terms
derived from your question to public search engines and reads the pages it finds. These services
receive the necessary data for the requested operation and apply their own conditions and policies.

**Cross-vault Library.** When a backup folder is configured, Nodus stores the global document
library in its nested `nodus-library` folder. That folder can contain originals, clean Markdown,
extracted images, page maps, bibliographic metadata, highlights, comments and saved document-chat
history. It is local unless the user chooses a backup or synchronization provider for that folder;
that provider then receives the files under its own terms. Linking a Library item to a vault does
not upload or duplicate its original.
Items manually emptied from the Library trash are retained locally in a dated
`nodus-library/.nodus/recovery/purged` package so the catalogue operation remains
recoverable. Those packages remain part of the selected backup until the user or
data controller removes them under the applicable retention policy.
Before the first Nodus 4 migration, the application also creates one verified pre-v4 recovery copy.
It contains the existing vault databases, Library originals and derived files, and local profile
sidecars. With a configured backup folder it is stored under
`nodus-library/.nodus/recovery/pre-v4`; otherwise it remains in the local Nodus profile. Nodus does
not upload this copy. A third-party folder synchronization service receives it only when the user
has selected a folder managed by that service. Ordinary encrypted backups exclude the pre-v4 tree
to avoid recursively embedding a complete copy, but include the active Global Library itself.

**Nodus Server is optional and self-hosted.** If the user connects it in Settings, the application
publishes a logical and minimized copy of the vault on the server chosen by the user or his/her
organization. Never uploads the SQLite database, keys, passwords, local paths or PDF files. The
passages and content created by the user are included only if it activates their specific options.
Student lists, groups, ratings and evaluation results are not published using this function.

**Semantic search vectors.** Earlier versions of this document said embeddings were never uploaded.
That is no longer accurate and the statement has been corrected. A published space can now carry the
numerical vectors of its **ideas and audited document profiles**, so that a phone or a shared replica
can search by meaning instead of only by literal text; without them, a search that finds nothing is
indistinguishable from a corpus that does not discuss the topic. Document vectors represent generated
macro-level fields such as a work's thesis and overview, not the source PDF. These vectors are derived
from data that already travels, they are quantized, and they are not reversible into the original text.
It is a switch — *Include semantic vectors* in Settings — and turning it off stops them being sent.
Vectors derived from passages follow the passages switch: a matrix built from full text is not
published when the text itself was withheld.

The publication also carries the user's **dismissed relations** (`edge_feedback`). These are needed
so a shared space hides the same debates the owner has already dismissed on their own screen; without
them the server would present, to other people, connections the user had explicitly rejected. Each
row records a rejected pair of ideas and an optional note.

**Documents never travel; three kinds of image do.** No PDF, no audio and no recording is ever sent
to Nodus Server: source PDFs live in Zotero's own storage outside the vault, and narration audio is
a file on disk that is not part of the publication. The only binaries that travel are the
illustration attached to a Deep Research report, a person's portrait, and the images held in a
database's attachment columns — and only when the user has enabled sharing of authored content.
Three independent mechanisms enforce this, and the server refuses any upload whose bytes are not a
PNG, JPEG, WEBP or GIF image regardless of what the sender declared. That last rule is what governs
database attachments in particular: such a column accepts any file, so a photograph in one is
published while a PDF, a video or an audio file in the same column is not — the row still records
that the file exists and what it is called, and its bytes stay on the computer.

**Connected vaults.** A user may create a vault that is a replica of a space on somebody else's
Nodus Server. What their account may do there is decided by that server, not by the application:
with read-only access, everything they write or generate stays on their own computer and is never
uploaded. With write access, only content they authored themselves — notes, saved drafts, Deep
Research reports, immersion sessions, saved searches, research questions and dismissed relations —
is queued and sent; nothing derived from someone else's corpus is ever sent back. If the server
revokes their access, synchronisation stops and **the local copy is kept intact**: their own work is
not deleted because a server withdrew permission.

Nodus **does not use AI to rate, grade, rank, profile, or evaluate any student**. Notes and rubrics
are entered or confirmed by a person. Multiple choice questions can be corrected locally by
deterministic matching with the answer marked as correct; no model is involved.

## 1. Who processes the data

The Nodus project, maintained by Jorge Pérez Burgueño, publishes the software but does not receive
or access the content stored in a normal installation or in a third-party-hosted Nodus Server. The
project does not operate a cloud, account or central backend. For security incidents that need not
be public, the private channel GitHub can be used:
https://github.com/jorgepb96/nodus/security/advisories/new

The person, university, educational center, company or organization who decides which personal data
he or she introduces, what he or she uses them for, and how long he or she normally retains them is
the **processor responsible** for such data. The individual user may act on his or her own account
or as a person authorized by that controller. This policy does not replace the privacy notice to be
provided by the specific controller pursuant to Articles 13 and 14 of the GDPR.

When setting up an external provider, the controller must determine whether the provider acts as an
independent maintainer or controller, review its terms, formalize the Article 28 GDPR contract where
appropriate, and verify the guarantees for international transfers. Nodus does not conclude such
contracts on behalf of the user.

Whoever installs and manages Nodus Server determines its users, permissions, domain, hosting, copies
and retention times. That person or organization is usually responsible — or, depending on the
context, in charge — for the treatment performed on its server and must inform the persons with
access.

## 2. Data that the application can store

Depending on the functions used, the device may contain:

- documents, references, quotations, annotations, images and imported files;
- names, identifiers, groups, attendance, headings and qualifications manually entered in a teaching
  vault;
- audio recordings, third party voices, transcripts and temporary marks;
- notes, timetables, curricula, responses and local progress;
- historical, genealogical or research data provided by the user;
- locally saved AI prompts, responses and metadata;
- settings, file paths and service credentials. Supported keys are saved via secure operating system
  storage and not in the interface.

Nodus does not need special categories of data to function. Health, biometrics, ideology, religion,
sexual orientation, trade union membership or other specially protected data should not be entered
unless there is a real need, a valid legal basis and adequate safeguards.

## 3. Legal purposes and bases

Nodus processes the information locally for the functions that the user activates: organizing
sources, producing documents, managing teaching or study, transcribing, searching, exporting and
creating backups. The legal basis is not decided by the application. It must be determined by the
person responsible in accordance with Article 6 GDPR and, where appropriate, Article 9.

In regulated education, the mission of public interest and educational regulations may be
applicable, not necessarily consent. In other contexts, a contract, a legal obligation, a duly
weighted legitimate interest, or a free and revocable consent may apply. Mark "continue" in a Nodus
notice confirms only that the user has read the notice; **does not in itself create a legal basis or
substitute the consent of the persons concerned**.

## 4. Archives and recordings

The files that the user incorporates are processed locally and not uploaded to Nodus Server. The
optional publication may include metadata, derived academic content and, only with separate options,
passages or content created by the user. Before activating the microphone, a previous notice is
displayed, which the user can accept promptly or remember not to display again.

Narration runs entirely on the user's computer (Ming 3.0 TTS). Reference voices recorded or uploaded
to clone them stay in the application's data folder on that computer and are never uploaded, synced
or included in published content; saving one requires confirming that the voice is the user's own or
that its owner has given permission. Generated narration clips are deleted automatically after the
retention period chosen in Settings, unless the user keeps them.

Those who record should:

1. inform all persons concerned in advance and in a comprehensible manner;
2. identify the person responsible, purpose, legal basis, addressees and conservation;
3. obtain consent where applicable, including that of legal representatives where appropriate;
4. limit access and avoid any dissemination incompatible with the informed purpose;
5. respect the rules of the centre, confidentiality and legislation on image, voice, intellectual
   property and secrecy of communications.

Nodus is not designed for covert recording, surveillance, emotional recognition, biometric
identification, or test control.

## 5. AI and students: prohibition of evaluation

The aim of the IA of Nodus is limited to working on academic or teaching content: to help structure
programming, generate draft materials, questions, explanations or summaries and to assist in
research.

Nodus does not offer or authorize as intended:

- send to a model names, files, notes or student responses to obtain an evaluation;
- produce notes, performance predictions, rankings, profiles or decisions on admission, promotion,
  itineraries or access to opportunities;
- Infer emotions, attention, behavior, disability, personality or risk;
- monitor or detect prohibited conduct during testing.

Gradebook grades are human inputs or deterministic arithmetical calculations defined by the teacher.
Generating a question or rubric with AI does not amount to evaluating a person: the model does not
receive the answer or decides the note.

## 6. Optional external communications

Nodus can make the following connections, only when the function is configured or necessary for the
specified operation:

- **IA and audio providers in the cloud:**prompts, fragments, images, audio or text necessary for
  the user's request are sent.The provider, model and account is chosen by the user. Local models do
  not make that submission.
- **Optional public image review (`nodus:vision`):** when a Skill is allowed to use this capability,
  bounded thumbnails of public tool-retrieved images (including public cultural and historical images
  depicting people), or images generated by a trusted capability, and safe metadata may be sent to the
  selected vision model solely to assess relevance to the request. This does not grant access to private
  files, credentials, student records or unrelated application data. Unknown/text-only models skip
  review. Active student privacy scopes continue to prohibit image transmission. See
  [the capability contract](docs/capability-vision.md) for limits and provenance.
- **Zotero:** consults libraries and files authorized by the user.
- **Nodus Connector for Chrome:** after the user clicks its toolbar icon, the extension reads only
  the active tab's bibliographic metadata and document links. The user reviews the detected item
  type, collection, tags, snapshot and files before saving them over an authenticated loopback
  connection to the local desktop app. The pairing secret remains in Chrome local extension
  storage. Optional per-site permission is requested only when Chrome must use the current browser
  session to retrieve a selected attachment. The extension contains no telemetry or remote code.
- **Crossref, Open Library, NCBI and arXiv:** when the user requests bibliographic metadata, Nodus
  sends only the DOI, ISBN, ISSN, PMID, PMCID or arXiv identifier selected for that lookup. Bulk
  requests are rate-limited and cancelable. Candidates are shown for review and are not applied
  automatically.
- **Web search in Research Chat:** when the web step is on (the globe toggle in the chat composer, on
  by default and remembered per user) and the agent decides the library is not enough, or the user asks
  for an internet search, Nodus starts a local SearXNG instance packaged with the application and sends
  the search terms — derived from the question being asked — to the search engines it is configured
  with: DuckDuckGo, Bing, Brave, Yahoo and Seznam, plus the scholarly services arXiv, OpenAlex,
  EuropePMC, PubMed, Semantic Scholar and Google Scholar. The pages it then reads are fetched directly
  from their own servers. No Nodus server takes part and none of this reaches the project: the queries
  leave from the user's own address, each engine or site can see what any web request exposes, such as
  the IP address, and the retrieved text is stored only in the local database of that vault. The step
  never solves, evades or retries around a CAPTCHA or an access block: a page that refuses is recorded
  as blocked and the answer says so. Turning the toggle off keeps the whole turn in the library, and no
  search request is made at all.
- **Clean-reader chat and remote OCR:** these actions use the AI model explicitly configured by the
  user. A remote chat provider receives the clean document text, relevant annotations and recent
  conversation needed to answer; remote OCR receives the selected page image. A local model keeps
  that content on the device. Opening, reading, highlighting or annotating alone invokes no model.
- **Unpaywall and publishing servers:** consult a DOI and you can download the accessible text; the
  mail configured for Unpaywall is included in the request.
- **GitHub:** Check and download updates, open incidents and downloads of the project. It also hosts
  the official download of the OpenAI tunnel client, whose integrity checks Nodus before executing
  it. GitHub can receive network data such as IP address.
- **Nodus announcements:** Nodus downloads a public, static file of announcements published on the
  project website (GitHub Pages) so it can warn about surveys, known issues or important changes
  between releases. The request is a plain conditional GET made at most once every four hours, plus
  one shortly after startup. It sends no identifier, no account, no vault name and no data of any
  kind about the user's corpus; the server can see only what any web request exposes, such as the IP
  address. It can be turned off completely in Settings > Updates and news, and when it is off no
  request is made at all.
- **Hugging Face or other fixed repositories:** optional download of models, voices and runtimes.
  The repository can receive network data.
- **OpenAI Secure MCP Tunnel and ChatGPT:** If the user expressly configures this integration, Nodus
  executes the official OpenAI client and opens an outgoing HTTPS connection to OpenAI. Nodus MCP
  server continues to listen only to localhost: no incoming port is opened or a Nodus URL is
  published. OpenAI and ChatGPT receive the tool requests and their results, which may contain
  fragments, metadata and active vault content requested by the user or model. The tunnel execution
  key is stored in the device's credentials warehouse and is not included in the backups.
- **Nodus Server autohosted, ChatGPT and Claude:** if the user matches a Vault, Nodus opens a
  outgoing HTTPS connection to the configured domain and publishes a filtered projection. The device
  token is encrypted with the secure system warehouse; if it is not available, it is only stored in
  memory until Nodus is closed. It remains outside the renderer and backups, and is different from
  the local MCP token and port. Readers access the remote MCP endpoint via OAuth; the server checks
  user, space, expiration, audience and permissions on each request. The server administrator and AI
  providers used by readers receive the consulted data. PDFs, credentials and qualification or
  student data are not part of the publication.
- **External links:** PayPal, calendars, license pages and other links are only opened when
  requested by the user.

Nodus does not control the subsequent preservation by these third parties. Before using a remote
service with personal data, the controller must review your region, retention, use for training,
sub-loads, security measures and international transfer mechanism. For student data or special
categories it is recommended to use exclusively local models except documented institutional
authorization.

## 7. Maintenance and erasing

Local data is kept until the user deletes them. Trash, records, exports, preserved clips and backups
can maintain additional copies; they must be reviewed and deleted according to the time limit
defined by the responsible. Uninstalling the application does not guarantee that the user's
databases, exports or backups are automatically deleted.

External providers and each self-hosted Nodus Server apply their own deadlines. Disconnecting a
Vault stops new submissions, but does not automatically delete the latest server posting; the
administrator must delete it in accordance with its policy. The responsible must configure and
document these deadlines before transmitting personal data.

## 8. Security

Nodus applies default minimization, local processing, Electron isolation, secure system-compatible
credentials storage, just-in-time notifications and exports or protectionable backups. Nodus Server
requires HTTPS out of localhost, single-use matching tokens, OAuth with PKCE, CSRF sessions, space
access control, and short access tokens. However, **local does not mean automatic encryption of the
entire database**. The user or organization must protect the system account, enable full disk
encryption, install updates, limit permissions, encrypt backups and control physical access.

No software can promise zero risk. An organization must maintain appropriate technical and
organizational measures, periodic testing, a breach procedure and recovery according to its risk
analysis.

## 9. Rights of individuals

When the data is only on one device, the Nodus project cannot search, rectify or delete them because
it does not have access. Requests for access, rectification, deletion, limitation, opposition or
portability should be addressed to the controller who used Nodus. The application allows you to
consult, modify, export and delete much of the local content; the controller must also complete
those operations in copies and external systems.

Individuals may file a complaint with the competent data protection authority. In Spain:
https://www.aepd.es/

## 10. Legitimate liability and use

The user is responsible for not entering or communicating data that he or she is not authorized to
process and not to use Nodus for unlawful or incompatible purposes. The controller must comply with
his or her own obligations of information, legality, minimization, contracts, security, rights care
and impact assessment.

The GNU Affero General Public License v3.0 only delivers the software "as is", without technical warranty, to the maximum extent
permitted by law. **This clause does not eliminate mandatory legal obligations, does not
automatically make the user solely responsible and does not exclude liability that the law does not
allow to exclude**.

## 11. Requirements for GDPR implementation

The local configuration of Nodus facilitates compliance, but an application alone cannot certify the
complete processing of an institution. Before using personal data in an organization, the actions of
`legal/RGPD_DEPLOYMENT_CHECKLIST.md` must be completed, including the identity and contact of the
controller, registration of activities, legal basis, deadlines, managers, transfers, rights
procedure, security and, where there is a high risk, an impact assessment.

## 12. Official references

- Regulation (EU) 2016/679 (GDPR): https://eur-lex.europa.eu/eli/reg/2016/679/oj
- Organic Law 3/2018 (LOPDGDD): https://www.boe.es/eli/es/lo/2018/12/05/3/con
- Default data protection, AEPD:
  https://www.aepd.es/derechos-y-deberes/cumple-tus-deberes/medidas-de-cumplimiento/proteccion-de-datos-por-defecto
- Artificial Intelligence Regulation (EU) 2024/1689: https://eur-lex.europa.eu/eli/reg/2024/1689/oj

## 13. Changes in this policy

Material changes will be published in the repository and included in the new versions. Git's history
allows you to audit each modification.

## Optional AlphaGenome skill

AlphaGenome sends only the explicitly requested genomic variant, centered
reference interval, tissue ontology and signal type directly to Google DeepMind
using the user's personal AlphaGenome key. Google's service terms and privacy
policy apply: https://deepmind.google.com/science/alphagenome/terms and
https://deepmind.google.com/science/alphagenome/privacy. Do not submit patient
records or HIPAA-regulated information.

The new key is entered in the skill's password field, passed once to the main
process, OS-encrypted on this device and cleared from the form. It is never
returned by configuration/status APIs or included in chat, Nodus backups or
synchronization. The Python adapter receives it only over a local stdin pipe.
An explicit setup action downloads the official client and dependencies from
GitHub/PyPI into an isolated environment.

Predictions remain in device-local chat assets. Conversation history contains
only opaque references, so predictions are not forwarded to text providers or
Nodus Server and are not included in Nodus backup archives. Deleting or pruning
the corresponding chat removes its assets. User-requested JSON/SVG exports
contain results, parameters, provenance, modifications and binding output-term
notices; recipients must comply with those terms.

### Legalize chat skill

Legalize is disabled by default. When enabled and invoked, Nodus contacts
GitHub (`api.github.com`, `raw.githubusercontent.com`, `codeload.github.com`)
for the selected public country repository and document paths. No GitHub token,
Git executable, Legalize account or API key is used. The network requests do not
include the chat, personal legal circumstances or vault documents. Title
matching occurs locally against a downloaded country snapshot; GitHub receives
the IP address and requested country/document paths.

The latest country title/identifier/path index is cached under
`userData/legalize-indexes/<country>.json`, replacing the previous version for
that country. Compressed archives are processed in memory, never executed or
extracted into the filesystem. Retrieved law text, original metadata and
attribution are saved in the chat result, so they follow that chat's normal
history, synchronization and backup rules. They may be included in later prompts
to the text provider selected for that chat. Downloads include the same source
and licence attribution. These are public legislative sources; this feature is
not a confidential legal advice service.

## Native Presenter remote

The iPhone/iPad companion's own data handling, camera permissions and cache
retention are described in [Nodus Presenter Privacy Policy](PRESENTER_PRIVACY.md).

While a PDF presentation is active, Nodus for macOS can advertise an Apple local/peer-to-peer service for the optional iPhone/iPad Presenter companion. Scanning its native QR grants that device access to the current PDF, speaker notes and presentation controls through a TLS session with a fresh per-presentation key. That key is discarded when presenting ends. The helper reads only the PDF chosen for that session; no vault or unrelated file paths are exposed. This feature does not create a cloud account, upload presentations to a Nodus server or change the Mac's Wi-Fi configuration. The existing PIN-protected browser remote remains available.
