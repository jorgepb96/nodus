# EmbeddingGemma 2 Desktop

EmbeddingGemma 2 is an additional, experimental local text encoder. Existing defaults and historical embedding preparation remain unchanged. A successful runtime smoke or short controlled retrieval benchmark does **not** mark a profile validated. Product quality, grounding, scope isolation and native packaging gates must all pass first.

## Immutable profiles

| Profile | Native encoder | Output |
| --- | --- | --- |
| `embeddinggemma-2-text-q8-512-v1` | ONNX Q8, CPU | 512, then L2 |
| `embeddinggemma-2-text-q8-256-v1` | Same assets | 256, then L2 |

Both profiles resolve to `embeddinggemma-2-text-q8-v1` on disk. Download, progress, cancellation and deletion operate on that family. Neither profile installs vision or audio encoders. Each resource records its Apache-2.0 declaration, upstream license URL and packaged notice, and is pinned to revision `daa72c51243991dfcaf9f9137d2c573d8f7790c0`, size and SHA-256. Deleting the weights affects both profiles, including a selected profile. Corrupt or incomplete assets fail verification before inference.

The exclusive npm alias `@nodus/embeddinggemma-transformers` pins Transformers.js **4.3.1**. Other consumers retain their existing Transformers.js dependency. The standalone `embeddingGemma2Worker.cjs` is built into `dist-electron`; the alias and both versions of ONNX Runtime’s native libraries are unpacked from ASAR. A missing or unsupported runtime fails explicitly. No automatic precision or model fallback is permitted.

Queries use `task: search result | query: `; documents use `title: … | text: `, with `none` when no title is available. The model’s `sentence_embedding` output already includes its pooling/projection. The worker checks the native 768-component output, performs Matryoshka prefix reduction, then L2 normalization. Counts, dimensions, finiteness and nonzero norms are checked before publication.

Tokenization includes prompts and special tokens, with truncation disabled. More than 8,192 tokens produces an explicit error. Documentary preparation’s existing UTF-8 bounded, locator-preserving chunks remain below this limit; an indivisible excessive title/input is rejected. Historical models retain their previous 8,000-character preparation.

Legacy Transformers models now dispatch at most eight inputs and 2,048 padded tokens per native call, with larger inputs individually. Their tokenizer, text, pooling and normalization are unchanged. Real Electron runs exposed native allocator crashes with large E5/GTE batches; changing dispatch bounds addresses those crashes without assigning new vector semantics to historical indices.

There is one worker for this asset family, one active operation, at most four CPU threads and query priority between inference batches. Batches contain at most eight entries with a maximum padded input cost of 2,048 tokens; longer entries run individually. Cancellation drops queued results and terminates active native work. Crashes reject outstanding work; a later explicit request can recreate the worker. Idle workers terminate after five minutes and application shutdown closes them.

## Index identity and publication

`shared/embeddingGemma2.ts` constructs the existing nine-field embedding contract. It records weights/tokenizer revision, precision, dimensions, both prompts, special tokens, maximum context, projection, reduction and normalization. Changing any vector semantics requires a **new profile ID**, even if dimensions remain the same.

Legacy vault tables continue distinguishing vectors by their original provider/model/dimension; the immutable new profile IDs identify the complete registered contract. Documentary jobs, checkpoints, caches and ready revisions additionally carry the canonical full contract. Retrieval requires the selected profile’s identity. Incompatible indices remain pending and can be explicitly prepared again, reusing valid extracted text. Notebook creation counts use the same readiness check as the backend, including missing, partial and incompatible vectors; a lexical publication alone does not count as prepared while embeddings are expected. No dimension-only compatibility is inferred.

Execution captures vault path, configuration/endpoint and an embedding settings revision for every provider. Query execution also captures a live vault epoch, so switching away and back rejects the original result. Document publication checks the owning scope, source revision and selected contract. Settings revisions include a process session: held work cannot publish after a configuration change, while persisted jobs can resume after restarting with the same contract. Full contracts accompany server vector exports; transport `int8-l2` is separate from encoder Q8 precision. Server index locks and contract-aware queries remain mandatory.

The opt-in `NODUS_EMBEDDING_QA_TRACE=1` is accepted only with a matching isolated manifest/profile. Its trace records the query, selected profile/contract, compatible vector revision keys, semantic/lexical candidates, evidence selection and incomplete preparation. Content-bearing traces are never enabled in an ordinary profile.

## Isolated validation

Use Node 22.12+ and rebuild native SQLite for the installed Electron version:

```sh
npm install
npx electron-builder install-app-deps
npm run test:embeddinggemma:contracts
npm run test:embeddinggemma:runtime
npm run audit:embeddinggemma -- --all
npm run test:e2e:embeddinggemma
```

Commands create marked roots under the OS temporary directory and retain artifacts for inspection. Every model uses its own process, profile, library, caches and stores. The macOS sandbox proves outside writes, descendant writes, external network and unauthorized loopback denial before launch. The sentinel is deliberately created outside QA’s inherited TMPDIR. Other operating systems require a native disposable environment with equivalent enforcement; they are not inferred from macOS results.

The product runner copies only the authorized **encrypted DeepSeek credential**, before Electron starts. It never loads a real registry, settings database, vault or secrets migration code. Only `deepseek-flash` is allowed by its paid proxy, at most two paid calls in flight across all proxies/processes of the campaign, with an originally **USD 5 campaign ledger**. The precision follow-up received explicit authorization for a final cumulative USD 8 ceiling, preserving every earlier call and unknown reservation; that campaign is now closed at USD 7.9559 committed. See [the closure record](../audit/research-chat-grounding/cost/closed-campaign.json). An atomic two-slot file gate and reserved upper-bound costs enforce the limits. Pass the same `--campaign-root` to subsequent authorized profile runs; a stage or larger caller limit cannot reset or raise the ledger. No OpenRouter credential or remote embedding route is admitted. Model downloads are byte-forwarded from an allowlist of pinned upstream URLs through a disposable loopback proxy; the proxy does not publish or retain weights.

```sh
node scripts/embeddinggemma-qa.mjs corpus
node scripts/embeddinggemma-qa.mjs replay-corpus --manifest=audit/embeddinggemma-2/corpus-manifest.json
node scripts/embeddinggemma-qa.mjs audit --all
node scripts/embeddinggemma-qa.mjs prepare-child --root=/absolute/marked/qa-root --profile=embeddinggemma-2-text-q8-512-v1 --audit --capacity --persist-capacity
node scripts/embeddinggemma-qa.mjs prepare-child --root=/absolute/marked/qa-root --profile=embeddinggemma-2-text-q8-512-v1 --context
node scripts/e2e-embeddinggemma.mjs --profile=embeddinggemma-2-text-q8-256-v1 --corpus-root=/absolute/marked/corpus-root --campaign-root=/absolute/marked/campaign-root
npm run test:embeddinggemma:capacity -- --capacity-root=/absolute/marked/qa-root --contention=quiet
npm run test:embeddinggemma:restart -- --model-root=/absolute/marked/qa-root
npm run test:embeddinggemma:server
npm run test:embeddinggemma:server:native -- --product-root=/absolute/marked/completed-product-512
npm run test:embeddinggemma:package -- --executable=/absolute/Nodus.app/Contents/MacOS/Nodus --model-root=/absolute/marked/qa-root
```

The corpus has 30 synthetic fixtures and ten hash-pinned public PDFs, matching 12 digital PDFs, six scanned PDFs, six DOCX, four EPUB, four Markdown, four TXT, two CSV and two XLSX. Gold facts and 120 queries (40 development, 80 evaluation) stay in `artifacts/`, outside the imported files. The controlled lane uses authored/curated short excerpts; the product lane imports and extracts the actual originals, including local OCR. This distinction must remain visible in every report.

The product runner exercises visible model download, both profile selections and Library import, then checks actual extraction/OCR before preparing vectors. It creates academic manual/automatic vaults and fixed/linked notebooks and measures the 120 queries against the extracted corpus. Lifecycle checks cover incremental additions, title/text edits, original replacement, delete/restore, fixed membership, exclusion revocation and scope isolation. Real native worker termination, simulated allocation failure and held inference test recovery and stale-result rejection. Offline local search permits only BGE’s own sandboxed llama.cpp loopback transport. Academic processing exercises passages, ideas, summaries and document profiles on one representative source per configuration with the same DeepSeek model; all forty originals undergo extraction and documentary vector preparation.

Research Chat runs twelve scenarios twice through the UI, captures actual IPC responses and retrieval traces, opens citation dialogs and records screenshots. An attachment test covers plain filename citations in a general conversation, followed by explicit promotion of the file into a fixed notebook to test semantic indexing, clickable citations and access revocation. Notebook membership intentionally excludes unpromoted conversation files. Generative grounding failures remain recorded even when retrieval and citation resolution succeed. `completed` means the runner’s actions completed, never that all release gates passed. Do not rebuild Vite while a product run is open: replacing its hashed UI resources invalidates the run.

Capacity uses 1,000 and 10,000 real generated text embeddings, and 50,000 vector comparisons. `--persist-capacity` retains native float32 vectors and their texts. The separate Desktop capacity runner loads these into the production documentary store under a complete explicit QA identity, then measures cold and twenty hot queries with distinct request suffixes and token counts including prefixes/special tokens, native semantic participation, renderer frame gaps, process memory and SQLite size. Its injected chunks are a capacity fixture, not extraction/quality evidence. Label concurrent-load measurements separately from a quiet reference run. Resident memory can decrease under compression; per-process peaks are not a simultaneous application total. The 50K JavaScript scan is reported separately.

The restart runner kills only its own marked Electron process during held native inference, verifies that vectors remain incomplete and resumes persisted preparation after a new process session. The server contract tests check full-contract locks, same-dimension incompatibility and transport quantization. The separate native-server runner reads an actual completed QA vault, uses Desktop’s exporter and a real ONNX query, and publishes to a disposable server to compare exact/transported nearest results. It never reads a real vault. The package runner uses the actual ASAR application under the same OS boundary and checks both profiles offline.

The archived campaign includes the exact thirty generated fixtures because PDF/ZIP timestamps make regeneration byte-variable. Replay verifies their hashes and downloads only the ten allowlisted, pinned public PDFs. Gold annotations stay outside imported files. Generate a durable report with:

```sh
npm run report:embeddinggemma -- --controlled-root=/absolute/marked/controlled-root --corpus-root=/absolute/marked/corpus-root --campaign-root=/absolute/marked/campaign-root --product-roots=/absolute/marked/product-512,/absolute/marked/product-256 --capacity-root=/absolute/marked/capacity-root --context-root=/absolute/marked/context-root --desktop-capacity-root=/absolute/marked/desktop-root --package-root=/absolute/marked/package-root --restart-root=/absolute/marked/restart-root --native-server-root=/absolute/marked/completed-product-512 --supplementary-desktop-roots=/absolute/marked/contended-desktop-root --reviews-file=audit/embeddinggemma-2/manual-reviews.json
```

Reports preserve individual answers, citations, traces, rankings, screenshots, cost bounds and classified failures. Manual reviews identify the reviewer, answer/source hashes and specific unsupported claims. A reviewed sample is not generalized to unreviewed answers.

The [model-independent Research Chat follow-up](research-chat-grounding.md) adds frozen-source redrafting, claim/quotation/arithmetic checks and exact coverage proof without rebuilding vectors. Its [final recorded regression](../audit/research-chat-grounding/README.md) remains below the required joint fidelity/adequacy threshold; the PR stays a draft. Separate native 256-dimensional Desktop capacity now records hot p95 447 ms against 10,000 chunks on the M2/16 GB reference, with approximately 1 GiB sampled runtime resident-memory growth. Fixture generation was contended and is not a quiet indexing-throughput measurement. Other native operating systems remain pending.

## Release gates

Validated profiles require Recall@10 ≥ 0.85; 512-dimensional nDCG@10 within 0.02 of correctly prepared E5 with no major-category regression > 0.05; and 256-dimensional nDCG@10 within 0.02 of 512. Citations must resolve 100%, at least 95% of factual answers must be supported and at least 90% of insufficient-evidence scenarios recognized. There must be zero contract/scope mixes and zero real database access. Review twenty answers and every grounding failure against actual source passages. Native and packaged smoke tests are required on Windows x64, Linux x64, macOS ARM64 and macOS Intel.

The Apple M2/16 GB target is hot query p95 ≤ 1.5 seconds against 10,000 chunks and ordinary runtime memory growth ≤ 1.5 GiB. Report 2K/8K-token runs independently. Profiles remain experimental until all applicable gates have evidence; preserve failed results and do not replace an existing default.

## Provenance and terms

[Google’s model card](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2) and [upstream model repository](https://huggingface.co/google/embeddinggemma-2) identify Apache 2.0. [The official license](https://ai.google.dev/gemma/apache_2) is permissive and compatible with Nodus’s AGPL-3.0 code distribution when notices are preserved. The model card also says deployments must adhere to the Gemma Prohibited Use Policy. That additional sentence is not reconciled here with the Apache declaration; the terms of the specific text conversion require clarification before redistribution/mirroring. Nodus downloads from [the conversion origin](https://huggingface.co/onnx-community/embeddinggemma-2-ONNX) only on user request and does not ship weight copies. Model/Google attribution and notices from Transformers.js, ONNX Runtime and other dependencies are retained in the generated third-party bundle. Experimental availability is not a legal determination about unspecified future distribution arrangements.
