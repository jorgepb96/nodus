# Nodus Cloud for Cloudflare

Nodus synchronisation and publication server, installed directly into each user's own Cloudflare account. Cloudflare runs the Worker, keeps structured data in D1 and private files in R2. Nodus receives no credentials and no permissions over that account.

## Recommended deployment

Nodus Desktop opens the official **Deploy to Cloudflare** wizard with this folder as the template. Cloudflare then:

1. creates a copy of the code in the GitHub or GitLab account the user chooses;
2. creates D1 and R2 and connects both resources to the Worker;
3. asks for the `NODUS_BOOTSTRAP_SECRET_HASH` secret that Desktop displays;
4. applies the migrations and publishes a free `workers.dev` URL.

There is no domain to buy, no traditional hosting to arrange and no Cloudflare token to hand over to Nodus. The location of D1 and R2 is whatever Cloudflare selects automatically in this flow. The official button documents no parameter for pinning jurisdiction; anyone who needs strict pinning should create those resources manually and review Cloudflare's current options.

Official documentation: [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [D1](https://developers.cloudflare.com/d1/), [R2](https://developers.cloudflare.com/r2/).

## What the template contains

- `src/`: the Nodus Cloud Worker and API.
- `migrations/`: the versioned D1 schema.
- `wrangler.jsonc`: the D1/R2 bindings and the maintenance task.
- `.dev.vars.example`: the secret variable Cloudflare asks for during deployment.
- `package.json`: applies the migrations before publishing the Worker.

Vectorize is optional. Its indexes require a specific dimension that depends on each vault's embedding model, which a static public template cannot know. Direct deployment uses portable matrices in R2 and exact search; if the owner adds `VECTORS_<dim>` bindings, the Worker announces them and Desktop uses them automatically.

## Local development

Wrangler 4.123 or later requires Node 22 or later. Compute the SHA-256 of a test secret first and pass it to the Worker; the verifier uses the original secret.

```sh
cd cloudflare
npm install
npx wrangler d1 migrations apply DB --local
NODUS_TEST_BOOTSTRAP_HASH="$(printf %s final-local-secret | shasum -a 256 | awk '{print $1}')"
npx wrangler dev --local --port 8799 --var "NODUS_BOOTSTRAP_SECRET_HASH:$NODUS_TEST_BOOTSTRAP_HASH"
```

In another terminal, from the repository root:

```sh
node scripts/verify-cloudflare-local.mjs
```

To exercise scheduled maintenance, start Wrangler with `--test-scheduled` and open `http://localhost:8799/__scheduled?cron=17+3+*+*+*`.

### Limits that only appear on a real deployment

The open-source workerd behind `wrangler dev` does not enforce every limit of Cloudflare's production runtime. The known case is PBKDF2: Workers rejects more than **100,000 iterations** with `NotSupportedError`, while local development accepts any count, so an invalid constant passes local verification and breaks the real deployment with an HTTP 500. `scripts/test-cloudflare-bootstrap.mjs` reproduces that ceiling against the real `auth.mjs` and runs as part of `npm test`.

That ceiling is the platform's, not a choice: it sits below the 600,000 iterations OWASP recommends for PBKDF2-SHA256, and Workers offers no alternative. Raising it the day Cloudflare lifts the cap means changing `PASSWORD_ITERATIONS` in `src/auth.mjs` and nothing else: every password records in `password_scheme` the count it was computed with, and `verifyPassword` replays it, so passwords already on record keep verifying.

## Synchronization safety

Automatic Desktop synchronization runs at most once per minute per lane, without overlapping
passes. Failures back off and stop after five attempts; HTTP 401, 403, 426 and 429 stop immediately.
Before syncing, Desktop verifies the Worker advertises these protections; older deployments pause with an upgrade message before publication writes. The breaker checkpoint survives timer and application restarts. Explicit manual synchronization
or a new credential resumes it; neither action resets the server budget. Pending work stays local.

D1 atomically reserves an **installation-wide daily AND monthly budget**, shared by every client
and space, before authenticated routes, uploads or publications run. UTC window changes reset
counters; backwards clocks cannot reopen older windows. Defaults are:

| Budget | Daily | Monthly |
| --- | ---: | ---: |
| Admitted requests | 10,000 | 100,000 |
| Work allowance | 250,000 | 2,500,000 |
| Incoming bytes | 1 GiB | 10 GiB |

Work allowance is a conservative workload weight (4 units for a read request, 128 for a write),
**not Cloudflare's metered row or currency counter**. Failed/duplicate requests retain their
reservation. Bodies cannot exceed their reserved length; missing Content-Length reserves a
bounded route allowance. A budget rejection returns HTTP 429 before further D1/R2 work.
Configure positive integers with `NODUS_SYNC_DAILY_REQUESTS`, `NODUS_SYNC_MONTHLY_REQUESTS`,
`NODUS_SYNC_DAILY_WORK`, `NODUS_SYNC_MONTHLY_WORK`, `NODUS_SYNC_DAILY_BYTES`, and
`NODUS_SYNC_MONTHLY_BYTES`. Zero, infinity and malformed values fail closed. Large publications
may require explicitly raising these limits; doing so increases the permitted consumption.

Each publication also stops at 10,000 requests and runs in a utility process with a 30-minute
deadline. HTTP calls and bodies have 60-second deadlines. Library packaging yields between
documents. Table chunks contain at most 15 rows/1 MiB, mutation batches at most 3 entries, and
pagination at most eight advancing pages per pass. Direct publication objects stop at 8 MiB;
larger objects use 8 MiB multipart parts. Exact vector sets stop at 32 MiB. Personal Library
objects stream to R2 with a fixed length and a verified SHA-256, avoiding a full in-memory copy.
Duplicate Library uploads drain their bounded bodies before acknowledging them, without
retaining chunks or writing R2 again. The drain also has a 60-second deadline, so a stalled
upload cannot hang the duplicate response.

R2 writes receive unique physical keys and durable cleanup jobs **before** bytes are uploaded.
Reference acquisition and queue removal commit together. GC enqueues obsolete keys and removes
D1 references in one transaction. Failed deletes keep their jobs and back off (1 hour to 7 days);
maintenance retries at most 10 batches of 1,000 keys per run. Upload abandonment, failed metadata
commits, expired chunks and expired relay bodies use the same queue. Physical keys are never
reused, so a delayed delete cannot remove a newer upload with the same content hash. Maintenance
has a separate persistent budget and services one space per run in persisted rotation; it can
continue when the synchronization budget is exhausted. Incomplete R2 multipart uploads also
have Cloudflare's automatic seven-day expiration. The template caps paid invocation CPU at 5 s.

Replica snapshots download to a temporary file. A separate utility process decompresses,
parses and applies them atomically in SQLite WAL, with a two-minute download deadline and a
two-minute import deadline. Limits are 512 MiB downloaded, 256 MiB decoded, two million rows and
10,000 image references. Cancellation or process death rolls back data and outbox trigger
removal together. Main SQLite reads continue, and main writes wait at most 50 ms during import.
Images yield between rows, retain one image in memory, fetch at most 32 per pass and resume
from persisted references on HTTP 304. A failed image does not redownload the full snapshot.

Cloudflare supports the replica mutation relay (`?relay=1`), binary Yjs updates and resumable
attachment blobs. Every replica has its own durable acknowledgement cursor; owner acknowledgements
retain bodies for 30 days for other replicas. Private mutations and their binaries stay scoped
to the authenticated owner. Binary uploads verify chunk and whole-file hashes; downloads support
HEAD and byte ranges. Limits are 8 MiB per Yjs update, 32 MiB per blob, 512 MiB of binary storage,
64 MiB reserved partial storage and 16 partial uploads per space. Atomic reservations prevent
concurrent uploads or mutation writers from exceeding quotas. Unreferenced binaries expire
after seven days; partial chunks expire after one day. No unsupported SSE reconnect loop is used.

Run `npm run test:cloudflare-safety` for offline fault/concurrency tests using local workerd,
SQLite D1 and filesystem R2, plus separate Electron-as-Node replica processes. Outbound Worker
network access is disabled. No deployment, Cloudflare account or production credential is used.
Local emulation does not reproduce every production CPU/memory limit. These application budgets
bound admitted synchronization work; they cannot impose a currency cap on an entire Cloudflare
account or stop Cloudflare billing requests from external traffic, including rejected requests.
Workers CPU/requests, D1 rows/storage and R2 operations/storage are billed separately.

Official references: [Workers billing and CPU limits](https://developers.cloudflare.com/workers/platform/pricing/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[D1 billing](https://developers.cloudflare.com/d1/platform/pricing/),
[R2 billing](https://developers.cloudflare.com/r2/pricing/), and
[R2 API and delete limits](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

## Licence and updates

The code is distributed under AGPL-3.0-only. The capabilities response links to the corresponding source code. The copy created by the wizard belongs to the user; commits to that copy trigger Workers Builds. Read `UPDATING.md` before taking in a new version of Nodus Cloud.
