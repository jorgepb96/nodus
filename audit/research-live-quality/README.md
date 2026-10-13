# Current-source Research Chat quality campaign

Status: in progress. No new embedding profile is validated by this directory.

The owner approved prospective, separate targets: at least 85% correct and complete answers over all planned answerable questions, 95% published answers without material unsupported claims, 90% published recognition of insufficient evidence, passage-level Recall@10 of 90%, actual resolution of every captured citation, and zero observed scope/contract leaks. The policy is `research-answer-quality/3`; every arm requires sixty preregistered answerable questions. These are directed project targets, not population guarantees. Prior campaigns keep their original policy and failed or pending results.

## Verified implementation and product controls

- Generic structured planning/writing now returns bounded validator diagnostics on its existing single retry. Literal spans and evidence authorization remain enforced; provider/transport failures are not retried by that mechanism.
- Omitted coverage facet IDs bind only to one uniquely exact frozen question quote. Explicit wrong IDs, fabricated quotes, duplicated facets and incomplete proof still fail.
- Grounding tests: 25 outer tests passed. Retrieval tests: five files passed. Type checking, lint and production build passed on macOS ARM64.
- `current-electron-ui-smoke.json`: real Electron notebook/verification/PDF/activity checks passed in a new isolated root, with sixteen database opens contained in that profile, no model generation and literal-empty provider keys disabling Safe Storage.
- `current-pdf-retrieval-probe.json`: current full QLoRA PDF extraction preserved the paged-optimizer mechanism; 63 real Q8-512 vectors were indexed and the actual documentary retrieval worker ranked that passage first for three paraphrases. Lexical retrieval also ranked it first. This is not semantic lift, population quality, product citation-resolution proof or packaged-platform validation.

The first complete-corpus preparation attempt imported and extracted all forty original documents, including six scanned PDFs. Electron then aborted with twenty-one documents ready and nineteen queued, before any quality retrieval or generation. `native-abort-evidence.json` binds the macOS crash receipt to that isolated process: an ONNX native binding raised an uncaught C++ exception in the embeddings worker thread and caused `SIGABRT` in the owning Electron process. The receipt does not establish an out-of-memory cause or identify the triggering input.

The runtime now uses the existing background utility process infrastructure to contain native inference failures outside Electron's main process. Weights, tokenizer, prefixes, dimensions, normalization and vector contracts stay the same. `current-process-parity.json` records seven real Q8 vectors per profile through both the direct-thread reference and the isolated production-source host: both 512 and 256 dimensions have identical hashes, maximum component difference zero and norm error below 1e-6. After killing only the recorded QA utility PID, real Electron 43.6.0 remained responsive and a fresh Q8-512 process produced identical vectors. This is an unpackaged macOS ARM64 architecture check, not full-corpus stability or answer quality. Original failure artifacts remain under `harness-preparation-failures`; recovery uses separately numbered receipts and the same forty source hashes and eighty preregistered questions.

The updated production build, both TypeScript checks and lint passed. Contract tests passed 39/39; process lifecycle/capture/parity-plan checks passed 9/9, the worker operation guard passed 1/1, and the Luna campaign/collection tests passed seven files. These deterministic checks do not establish the answer-quality targets.

## Library source qualification and corrected extraction

The complete-corpus recovery produced eighty notebook retrievals with semantic candidates, no lexical fallback and 893 hash-bound `getPassage` resolutions. A separate metadata-only audit verified forty semantic index identities against their published lexical variants, including complete source identity and embedding contract. These receipts establish that the vectors and citations belong to the frozen QA sources; they do not establish source completeness or relevance.

Source inspection subsequently found a generic Library PDF defect: a continued captioned table without a source footer consumed later body lines that its row parser could not parse. On QLoRA page five this removed the CPU/RAM paging paragraph. The lower-level PDF probe above had used a different extraction route and therefore did not qualify Library's full-corpus source extraction.

The correction stops a table at existing paragraph-boundary signals and preserves unparseable lines for prose extraction. The extraction pipeline is now `nodus-clean-markdown/12`; existing published revisions require explicit re-extraction. Six-page synthetic tests cover table continuation, wrapped cells, zero-cell prose and page locators. Re-extraction of all ten pinned public PDFs preserved their source hashes and valid source-map anchors; the QLoRA mechanism is now present in Library's detected-table output. The comparison still reports 134 differing token kinds attributable to layout, mathematical expressions and identifiers; this is not a claim of complete token conservation. The diagnostic receipts remain under `library-table-text-loss`.

The old source campaign is permanently marked invalid for further answer generation. Its thirty-nine fresh Luna completions, three published answers, one interrupted fourth case and seventy-six unstarted cases are preserved under `source-invalid-answer-campaign`. They do not qualify the corrected extraction or satisfy the sixty-answerable-case minimum. An erratum records that terminal event counts, rather than the pre-close network summary, include the abandoned request. The runner now counts events after bridge closure and supports stopping admission between cases.

A fresh isolated source campaign completed on `/12`, using the same forty original files and eighty preregistered questions. All forty sources are fully prepared with 787 semantic passages. All eighty searches contain semantic candidates, with no lexical fallback, search errors or observed scope leaks; all 885 captured citations resolve. These counts establish execution and citation integrity, not retrieval relevance or answer precision.

Electron exited normally with code zero. The coordinator subsequently failed while asking Playwright for the disposed application's PID. The original error and progress artifacts remain intact. The offline finalizer verified the forty source hashes, all eighty question identities and context hashes, and 1,262 source files plus 222 build artifacts before producing a separately versioned report. The original progress status and missing final aggregate hash remain documented rather than rewritten.

A separate metadata-only identity audit verified all forty lexical/semantic index pairs, their full contracts and readiness. The initial read-only snapshot reader created SQLite sidecars; that receipt is retained. Both readers now open an immutable SQLite URI with URI handling enabled before loading the native module. A new audit and full 787-passage inventory have unchanged before/after database hashes and no sidecars. Lexical citation aliases require matching source, scope, document, ordinal, exact text and locator; they do not make incompatible vector contracts interchangeable.

The actual macOS ARM64 ASAR package also passed offline inference and semantic search with both profiles, one shared utility process and an explicit rebuild after switching profiles. `current-utility-package-smoke.json` records the real application and utility PIDs, asset hashes, shared download card, experimental/license labels and cancelled deletion. Weights were copied only between marked QA roots and were not bundled. Windows, Linux and Intel-native model checks remain pending.

Passage annotations were independently approved and frozen before opening the new rankings. The approved bytes bind 512 literal evidence references to the 787-passage inventory and exact preregistration. Thirty-six positive questions have complete exhaustive gold; twenty-four retain explicit pending exhaustive review. All twenty insufficient-evidence questions received independent full-corpus review, preserving known partial facts without inventing the requested missing facts.

`current-passage-quality-summary.json` records the first measurement. Verified EvidenceHit@10 and FactCoverage@10 lower bounds over all sixty planned positive questions are 59/60 (98.33%) for semantic candidates and 56/60 (93.33%) for actual selected evidence. Lexical candidates have an EvidenceHit lower bound of 60/60 and FactCoverage lower bound of 98.36%. The arrays come from one recorded product search and are candidate-lane diagnostics, not independent ablations. Exhaustive Recall/MRR/nDCG remain partially pending; the means over thirty-six complete cases must not be reported as full-cohort results. All insufficient-evidence searches return candidates, so candidate-presence false hits do not measure whether a generated answer correctly acknowledges missing evidence.

The corrected-source eighty-question answer campaign has started through the actual Research Chat API using fresh Luna completions. TypeScript checks, lint, build and extraction tests passed after the correction; current-source answer quality has not yet been measured.

## Evaluation method

The live evidence runner preregisters eighty questions: ten complex regressions, ten difficult evaluation questions, forty multilingual core questions selected deterministically, and twenty insufficient-evidence questions. It imports original corpus bytes through Library, extracts/OCRs and prepares them using the actual local model, then records notebook retrieval and `getPassage` receipts. Gold annotations remain outside indexed content and provider requests. This is a directed regression sample, not an untouched holdout.

The answer runner uses the actual product Research Chat API and context builder against that notebook. Delegated generation uses fresh `gpt-6-luna` agents through the isolated file queue; its use of Codex service/quota is not local CPU generation or a priced OpenRouter request. Native temperature, context limits and schema enforcement are not established by the proxy. Read receipts are self-reported full-file tool-read attestations, not an independent observation of model reading. Every attempt and receipt remains recorded. Completed failures are never retried as new successes; only unstarted cases can continue in another capped segment.

The historical interrupted Luna run is preserved under `../research-luna-directed/interrupted-terminal-collection`, including dispatch/read metadata and orchestration errors. It is not resumed after the production changes.

## Cost and isolation

DeepSeek remains closed at USD 7.9559 committed of its USD 8 ceiling. The separate OpenRouter authorization remains USD 0.50, with USD 0.09287637 committed and further credential access stopped by the owner. This campaign accesses no encrypted credential or real profile and makes no paid DeepSeek/OpenRouter calls. QA model assets are copied only from marked disposable roots; profiles, corpus stores, notebooks and databases remain isolated.

On 2026-10-13 the owner conditionally authorized another EUR 0.50 for OpenRouter, only if necessary. That reserve is inactive, with zero committed spend; it has not been converted to USD or added to a provider ledger. The local-runtime and Luna campaign do not require it at this stage.

## Pending

Current-source answer reviews, per-language/format/difficulty metrics and passage-level retrieval annotations remain pending until captured. Real-weight package validation on Windows/Linux and Intel-native coverage remain pending; macOS checks are not extrapolated to those systems. EmbeddingGemma remains an additional experimental option, with no default or vector-contract change.
