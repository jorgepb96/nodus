# Documentary Research Chat verification

Research Chat checks documentary prose against the literal passages authorized
for that turn before publishing it. This happens after retrieval and applies to
any embedding provider. Embedding defaults, vector preparation, contracts and
existing indexes remain unchanged; no index rebuild is needed for this change.

The writer first answers the actual question at an appropriate length, preserves
attributions, quantities, negations and corrections, and distinguishes source
facts from calculations. For drafts with more than three prose statements, more than sixty words, or a citation outside the
frozen original evidence, a source-only writer produces a concise fresh draft
from the question and original excerpts. It does not receive the previous prose,
generated orientation, council opinions or chat history as evidence, so invented
counts and source relationships in that draft cannot become its premises. Simple
answers keep their initial drafting path. Fresh prose and every table cell still
require the full claim audit and coverage proof; an empty, unavailable or cancelled
redraft cannot publish. QA traces retain the original draft, `sourceRedraft` flag
and `focusedDraft` replacement, with `sourceDraftMs` separate from auditing.
The existing Deep Research auditor then checks atomic
premises. A verdict needs known source IDs, literal evidence and consistent
premises; a positive model judgement alone cannot approve invented quotes. Evidence
entailment permits faithful paraphrases, while preserving the subject, action,
object and temporal scope. A directly stated negation can be described as
explicit without the source calling itself explicit. This does not permit adding
unstated facts or inferring absence from an entire corpus. A positive verdict
that recognizes an explicitly labelled derivation but classifies it as a fact
gets one request for a fresh consistent verdict; code never repairs the verdict
or approves it automatically. Repeated inconsistencies remain unverified. Source
metadata are labelled separately from the excerpt. An additional deterministic
check rejects unlabelled direct quotations that do not occur in their verified
source. A labelled translation may differ from the original wording. Simple binary
equations and single-result arithmetic table rows are also checked in code, so a
positive semantic judgement cannot approve a wrong subtraction. This check covers
explicit arithmetic, not arbitrary mathematical reasoning or symbolic algebra.
Malformed verdicts get one bounded retry with precise schema diagnostics; missing
or invalid verdicts still cannot approve a claim.

When claims are removed, one repair uses the same frozen evidence and selected
generative model. The repair is audited afresh: rejecting an unsupported compound
sentence must not permanently retire its true premises. Salvageable facts
are kept in separate short sentences. Repairs do not narrate
the audit diagnosis or add evidence-gap acknowledgements about unrequested
distinctions; derived interpretations need their own labelled sentence. Unsupported assertions
are removed; empty headings and broken table citation placement are cleaned up.
An additional coverage check catches supported but irrelevant background and
omitted requested facts. It can request one further repair, which is audited
again. Both positive coverage judgements and incomplete-coverage verdicts need independent exact-span proof before acting. The full-question proof receives neither the original positive verdict nor retired-claim diagnoses. A positive judgement is decomposed into separate requested facets, each anchored to a literal span of the question and an exact meaningful answer span or source-backed omission. Empty proofs, invented request facets and duplicate records fail validation. This includes requested conclusions and comparisons; one correct value or a factual inventory cannot substitute for the other facets. A comparison derived from literal measurement qualifications may be requested as the answer's own labelled reasoning even when the source never uses the word limit; its premises still need the full prose audit. For the confirmation:
each dismissed complaint needs one to six separate exact meaningful spans of the
verified answer in `answerQuotes`; the legacy `answerQuote` remains supported.
Separate paragraphs or bullet points must stay separate, never joined with
synthetic ellipses. Every span is checked individually and the aggregate length
is bounded; invented text, duplicate spans and mixed formats fail validation.
each omitted available fact needs an exact authorized source quote, while an
unaddressed evidence gap asks only for a scoped acknowledgement. Fabricated spans,
empty formatting and unknown source IDs fail validation. The application derives
completeness from the validated proof instead of trusting redundant model fields.
A malformed proof gets one retry of the identical frozen request; provider and
transport failures are never replayed. This resolves coverage
complaints that demand an unsupported absence assertion or speculative conclusion
without restoring rejected prose. The original critic and confirmation are both
retained in QA traces. When a confirmed missing acknowledgement has already
verified nonfactual limits, a narrow equivalence check compares only those limits
with the requested acknowledgement, without the source exposition or original
critic. Every equivalence needs an exact meaningful quote from a known verified
statement; unknown indices, invented spans and unrelated limits cannot satisfy
the proof. It neither restores rejected facts nor removes available-fact
omissions. Its decisions are also retained in QA traces. A verified epistemic limitation retains the exact requested facet even
when there are no supported factual claims. Repairs receive the deterministic
failure code as well as the semantic reason, so a true but unqualified inference
can be labelled and a translated direct quote can become a paraphrase. If no
verified answer remains, the response states that evidence is insufficient.
If verification is unavailable or an answer still
omits requested facts available in its excerpts, the turn reports an availability
error instead of recording an apparently successful absence answer.

Documentary content deltas are held until verification completes. Thinking and
the existing activity indicator can still stream. Cancellation returns no
unchecked partial answer, and source/vault authorization is checked again before
publication and history persistence. Council member opinions, previous answers,
generated orientation and catalogue entries are never promoted to audit evidence.

The extra verification uses the selected chat model, adding provider calls and
latency. It is not a proof of truth: independent source review remains necessary
for quality acceptance. The opt-in content-bearing QA trace records the draft,
verdicts, repair, final answer and stage durations only inside a marked isolated
profile. Ordinary profiles do not record those traces.

Documentary turns with the document layer enabled and no literal evidence return
an evidence gap without buying verification calls; an invented draft cannot
escape checking because retrieval found nothing. Explicitly constructed exercises and creative artifacts retain their writing
mode. Plain documentary turns with literal passages are checked. Skill/artifact
execution, direct multimodal attachments and turns without literal documentary
evidence retain their existing paths; this change does not validate them. The
auditor's original Deep Research policy and retired-claim behaviour are unchanged.

## Verification commands

```sh
npm run test:research:grounding
npm run test:research:retrieval
npm run build
npm run audit:research:grounding -- --stage=development
npm run audit:research:grounding -- --stage=repair --profiles=embeddinggemma-2-text-q8-512-v1
npm run audit:research:grounding -- --stage=coverage
npm run audit:research:grounding -- --stage=evaluation --budget-usd=8
```

The paid UI campaign requires the completed disposable product roots recorded in
`audit/embeddinggemma-2/campaign.json`. It never opens or imports a real profile or
vault. Each model reuses only its own isolated corpus/index/profile. All paid
calls go through the original shared DeepSeek Flash proxy, with two concurrent
calls and one shared campaign ledger; running another stage does not reset it.
The original authorization was USD 5. On 7 October 2026 the user explicitly
authorized a final cumulative USD 8 ceiling, with no further increase. Preserve
all calls, unknown reservations and the before/after ledger evidence. The runner
default remains USD 5; `--budget-usd=8` requires the ledger to already record that
authorization and cannot raise it by itself. The runner refuses missing or mismatched completed product fixtures.

Budget reservations always use peak/cache-miss prices. Known DeepSeek usage may
settle at the verified off-peak cache-miss upper bound only when the entire UTC
request interval is outside weekday peak hours. Boundary crossings, invalid dates
and dates outside the tariff's verified window retain peak accounting. Unknown
usage keeps its full reservation. Historical peak estimates can be reconciled
with `node scripts/reconcile-research-tariff.mjs --root=/absolute/marked/campaign-root`
only when the proxy's exact reservation/usage evidence agrees. Reconciliation
preserves every call, the original ledger and the campaign's unchanged limit;
provider-reported invoice costs are never discounted. These figures remain upper
bounds, not billing invoices. [Tariff source](https://api-docs.deepseek.com/quick_start/pricing/).

Development repeats six earlier failure scenarios. The separate evaluation has
eight positive and four insufficient-evidence questions per profile, each twice,
across E5, GTE, BGE-M3 and both EmbeddingGemma profiles. Evaluation expectations
never enter the index or provider context. A positive answer must both answer the
question and have its factual content supported; a refusal is a failure when
evidence exists. Availability failures are recorded separately and never count
as correct refusals. Citation resolution and actual UI citation dialogs are
checked independently. Auditor approval is not the campaign's quality score.
After inspecting the first attempted evaluation, repetitions against revised code
are identified as regression evaluation, not an untouched held-out estimate.
The coverage probe repeats the distribution, QLoRA, price and individual-data failures
once per profile before purchasing a full evaluation. Its separate report is a
diagnostic, never a substitute for the 120-case acceptance campaign.

Collect an audit with independently inspected answer/source hashes:

```sh
node scripts/collect-research-grounding-audit.mjs --revision=MEASURED_COMMIT --reviews=/path/to/reviews.json
node scripts/collect-research-grounding-audit.mjs --stage=coverage --revision=MEASURED_COMMIT --reviews=/path/to/probe-reviews.json
```

The collector separates earlier runtimes, rejects stale answer/evidence reviews,
and cannot approve a candidate whose source/runtime differs from the measured
campaign. Published-answer reviews and failure triage are recorded separately.
The shared proxy's budget admission can stop a campaign before every repetition;
those cases stay pending and never count as successful absence responses.
The coverage collector expects all twenty probe cases, computes diagnostic rates
separately and always leaves the acceptance gate false, even if every probe passes.

`completed` reports execution completion only. Releasing a validated embedding
profile still requires its retrieval, quality, isolation, performance and native
packaging gates. Preserve the original failed campaign as a baseline alongside
any subsequent improvement report.

## Recorded result and limits

The [final regression at `82dac50f`](../audit/research-chat-grounding/final-82dac50f/README.md)
executed 113/120 cases before the shared proxy refused a reservation. Every
captured answer/failure was independently inspected: 61/77 executed positive
cases meet both source fidelity and answer adequacy; 35/36 executed absence
cases pass; all 113 captured citation targets resolve. Seven cases stay pending,
and full-campaign rates are not extrapolated. The 95% positive gate is already
impossible even if all remaining cases pass. The partly synthetic, repeated
regression sample is not a population or blinded accuracy estimate.

The implementation still permits coverage false positives on omitted requested
interpretations and mechanisms. Some proof responses concatenate noncontiguous
quotes with synthetic ellipses and correctly fail the literal-span guard; other
verifiers reject already-scoped evidence gaps. One unsupported comparison escaped
the auditor. A malformed three-column/four-separator table also failed the actual
Electron presentation requirement. These findings remain in the source reviews
and [failure analysis](../audit/research-chat-grounding/final-82dac50f/analysis.json).
They are not solved by relaxing evidence validation or changing embedding models.

The final budget-blocked request displayed the provider's generic invalid-key
error because the QA proxy used HTTP 403. The proxy/report separately identify
`research_budget_exhausted`; no credential problem is inferred. Availability
failures never count as correct evidence-gap answers.

The [campaign is closed](../audit/research-chat-grounding/cost/closed-campaign.json)
at USD 7.9559 committed, including all six unknown reservations, within the
final cumulative USD 8 authorization. No further paid run is started. The paid
commands above document reproduction, not permission to restart this campaign.
Unit/build/package checks pass for the measured runtime, while product-quality,
other native platforms and resource-terms release gates remain unfinished.

The [9 October offline follow-up](../audit/research-retrieval-followup/README.md)
diagnoses the frozen failures before changing code. It preserves all four planned
lexical facet probes, bounds additional semantic probes by full-chunk capacity,
shares context expansion fairly between anchors, and removes repeated evidence
before charging its budget. Its paired tests use the actual baseline/current
SQLite workers. Structured coverage quotes address a demonstrated representation
failure while retaining source and question-facet validation. The isolated
Electron smoke passes without provider calls. These findings apply to all
embedding models and require no index rebuild; they do not revise the previous
answer-quality rate or reopen the closed paid campaign.
