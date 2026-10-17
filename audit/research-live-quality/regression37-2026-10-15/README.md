# Selected Research Chat regression campaign

**Status: closed incomplete on 2026-10-17. The user authorized delivery and merge as an experimental integration. This is not a completed 37-case evaluation or a validated-model release.**

Thirteen preserved published answers passed independent model-assisted source review: eleven previous failures and two normal controls (R018 and R022). Two additional cases were verification-withheld (R002 and R009), and R005 ended in a protocol failure. The other 21 cases have no final evidence; the last observed case R029 was in progress. They receive no credit. See `closed-results.json` for the full frozen roster and provenance limits.

The dispatcher stopped on a Codex usage limit. On resumption, the temporary QA profile, databases, original queues, source snapshots and full collector outputs were absent. The preserved packet/read-receipt/judgment hashes remain verifiable, but original transport qualification can no longer be independently reconstructed. The cause of the temporary-file loss is unknown. No new campaign was substituted and no unknown outcome was labelled successful or unattempted.

This campaign repeats the 32 unsuccessful cases from the closed 80-case baseline and five deterministically selected successful controls. The selection was frozen before execution; the original baseline is unchanged. It evaluates the current Research Chat flow with `embeddinggemma-2-text-q8-512-v1`, not all embedding models or all supported platforms.

A recovered failure requires a published answer with valid execution and read bindings, an independent source-bound review, no material unsupported claims, and a complete, correct answer (or appropriate insufficient-evidence handling). Withheld answers, protocol failures, and unqualified publications receive no credit. A selected-failure cohort cannot establish a general percentage improvement in embedding accuracy.

## Provenance and execution

- `selection.json` pins the 32 failures and five controls; `preregistration.json` pins the acceptance and review rules.
- Production behavior remains commit `d73b72b1f0f25a4d5e54ff110dce9527a9e5c4f6`. Commit `d8bd4d0c` changes QA admission, queue allowance, inter-case pauses, hidden windows, and receipt timestamp instructions only.
- Generation uses fresh `gpt-6-luna` agents following immutable application job prompts. Expected answers and baseline labels are excluded. No DeepSeek or OpenRouter calls are used in this campaign.
- All application state remains in marked temporary QA profiles. No real vault, database, credential store, or keychain access is authorized.
- `initial-attempt-results.json` retains the first execution's bounded summary. Its valid withheld result R002 is final. Exactly six infrastructure-invalid attempts had one preregistered replacement in `serial-amendment.json`. Original raw histories were retained during execution but are no longer present; the surviving summaries and source-review packets are committed here. Further infrastructure failures remain unresolved. Quality results were not retried.
- `metadata-read-tool-recovery.json` permits only a documented metadata filename correction in the same still-live child, before reading or producing an answer. It does not extend any request deadline or permit answer or receipt repair.

## Resource limits

The user's other Codex sessions take priority. There is at most one native QA application, one application-generation agent, and one independent source reviewer reading a small saved JSON packet. The application closes between cases, waits at least 30 seconds, and does not start the next case unless macOS reports at least 20% free memory. QA processes keep nice 10; the graphic helper uses nice 19 and macOS background policy. Normal disk I/O is retained for model/tokenizer reads. These controls are recorded in `resource-policy.json` and `resource-policy-amendment-002.json`.

Process RSS observations include shared pages and are not a complete memory benchmark. Deliberate resource throttling and fresh-agent scheduling make campaign wall-clock time unsuitable for estimating normal interactive provider latency.

## Independent review evidence

Each `blind-review-pack-NNN.json` contains only the question, answer and actually supplied sources. The corresponding `source-review-NNN.json` binds each judgment to answer and source hashes. Its read receipt records the complete ordered byte ranges and packet hash. Packets are checked for case, baseline, control, gold and expected-answer labels. The reviewer is isolated from the generating agent; neither verdicts nor corrections are sent back to generation.

These are model-assisted source reviews, not external human assessments. Effective reviewer model/effort is reported as unknown where the runtime does not expose it. Intermediate progress files are dated checkpoints and must not be presented as final results.

From the repository root with Node 24, verify the preserved packet hashes, complete read ranges, judgment bindings, frozen selection and closed baseline:

```sh
node audit/research-live-quality/regression37-2026-10-15/verify-proofs.mjs
```

Verify that the deliberately incomplete closure matches the preserved judgments and the frozen roster:

```sh
node audit/research-live-quality/regression37-2026-10-15/verify-proofs.mjs --require-closed
```

The complete-evaluation gate intentionally fails for this campaign; it still requires all 37 terminal cases and review coverage:

```sh
node audit/research-live-quality/regression37-2026-10-15/verify-proofs.mjs --require-complete
```

The verifier checks evidence integrity and count consistency. It does not independently prove the reviewers' factual judgments. Parent source inspections are supplemental and explicitly not blinded; they preserve presentation defects separately from factual-support judgments.

## Limits of the closed result

Final reporting must separate resolved prior failures (denominator 32), retained controls (denominator 5), legitimate verification withholding, infrastructure/protocol failures, and independent source-review failures. It must preserve unsuccessful cases and any unreviewed or unexecuted work. Generator changes and recovery from previous execution failures prevent attribution of every recovered case to the embedding model or retrieval algorithm alone.

This campaign does not complete the pending Windows/Linux/native Intel package coverage or the complete final-build delete/redownload/index/search smoke test. It does not validate all EmbeddingGemma profiles, change default embeddings, or justify a global embedding-quality claim.

The supplemental parent inspections record a stray provider citation opener before an otherwise valid link and a technical-explanation scope caveat. These frozen answers were not edited. No additional paid provider call was made. Merging the experimental integration does not revise the closed baseline or promote any entry into `validatedProfiles`.
