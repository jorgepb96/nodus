# Research retrieval follow-up, 9 October 2026

This follow-up fixes demonstrated retrieval and coverage-proof defects for every
embedding model. It uses local SQLite, the actual documentary worker and frozen
QA traces. Two Codex Luna agents assisted diagnosis and regression review; no
DeepSeek or other provider API was called. The original USD 8 campaign stays
closed. These results do not establish a new factual-answer accuracy rate.

## Evidence and implementation

[diagnosis.json](diagnosis.json) inspects the 17 classified failures across the
five final profile reports at measured runtime `82dac50f`, with input hashes,
questions, categories and frozen source excerpts. Several omitted facts were
already selected: QLoRA's double-quantization sentence, the statistics' median
and mean, and both percentages needed for a calculation. Other failures concern
verification or presentation. `partial=true` and `truncated=true` alone cannot
establish that relevant facts were lost; the archive lacks complete candidate
texts and scores needed to reconstruct recall.

Code inspection identified four bounded defects, corrected together:

- All four planned facets now reach independent FTS probes in the opening
  retrieval, instead of losing later queries. Their candidate lists are fused
  into one lexical lane before the existing lexical/semantic fusion. Identical
  probe strings are searched once.
- Additional semantic probes require space for a complete prepared chunk and
  a remaining round. The original one-third opening evidence allowance and
  supervisor/original-read reserve are preserved. Small windows still send all
  lexical facets without creating five unusably small evidence slices.
- Context expansion accepts one neighbor per anchor before taking a second
  neighbor from an earlier anchor.
- Original selections and neighbors use the same document/text/locator content
  key before charging the UTF-8 budget. Aliases cannot consume duplicate space.

Scope keys, embedding contracts, cosine thresholds, passage quotas and direct
page/context reads remain enforced. Stored vectors and their identities do not
change; these corrections do not require an index rebuild.

Three archived invalid coverage proofs join distinct answer paragraphs with
synthetic ellipses. The verifier now requests `answerQuotes`, an array of one to
six separate exact answer spans. Each span is checked against the audited final
answer; invented text, mixed formats, duplicate spans and excessive aggregate
length still fail. The legacy single-span format remains supported. Atomic
source audits, question-facet checks and omission proofs are unchanged. A valid
quote representation alone does not establish factual fidelity or adequacy.

## Paired local results

The same temporary SQLite database and serialized input run through both actual
workers. The baseline source is frozen from commit
`af66e85fd76554322980686a5b54d9c0adc57410`, SHA-256
`3a4c41878b9f09f22182a828d81b293e57f5b579dc35376d5a88908d43072895`;
the test checks those bytes and also works in shallow CI checkouts.
[retrieval-comparison.json](retrieval-comparison.json) records fixture/input and
current-source hashes plus Apple M2 / macOS ARM64 / Electron runtime metadata.

| Deterministic regression | Baseline | Current |
| --- | ---: | ---: |
| Four planned lexical facets returned when the goal has no FTS match | 0/4 | 4/4 |
| Works contributing neighbors with two available expansion slots | 1 | 2 |
| Copies of identical neighbor content admitted under different index IDs | 2 | 1 |
| Evidence bytes charged in the alias fixture | 141 | 98 |

These are fixture-specific behavior measurements, not representative-corpus
Recall, nDCG or answer-quality percentages. Fixture cosine vectors test local
ranking and scope mechanics, not any embedding model's multilingual ability.

[coverage-quote-replay.json](coverage-quote-replay.json) records sixteen local
checks, including three archived representation failures. Separately copied
literal spans pass; their former ellipsis-joined strings and fabricated additions
remain rejected. It does not reapprove the old answers' facts or repair them.

## Reproduction and verification

```sh
npm run test:research:retrieval
npm run test:research:grounding
node scripts/test-documentary-retrieval.mjs --report=/absolute/path/retrieval-comparison.json
node scripts/test-research-coverage-quotes.mjs --report=/absolute/path/coverage-quote-replay.json
node scripts/test-documentary-writers.mjs
node scripts/test-documentary-requests.mjs
npm run typecheck
npm run build
node scripts/e2e-smoke.mjs
```

The worker, real-SQL corpus/agent bindings, preparation/citation writers, chunk
boundaries, grounding (38 inner cases), quotation replay, cancellation and scope
regressions pass locally. Targeted ESLint, both TypeScript checks and production
build pass. The full Electron UI smoke uses a fresh throwaway profile, fixture
services and no provider credentials; it passes without renderer page errors.
It tests the shell and document flows, not generated-answer quality. Its
[log](e2e-smoke.txt) is retained. Native CI includes the new worker regression;
cross-platform results must be assessed from the updated PR checks.

The previous 113/120 execution and its failed 95% factual-answer gate are retained
unchanged. A fresh, source-reviewed generative evaluation is still needed for
quality acceptance; neither offline fixtures nor Luna's code review substitute
for that evaluation. EmbeddingGemma stays experimental and PR #1071 stays draft.
