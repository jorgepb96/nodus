# Documentary Research Chat verification

Research Chat checks documentary prose against the literal passages authorized
for that turn before publishing it. This happens after retrieval and applies to
any embedding provider. Embedding defaults, vector preparation, contracts and
existing indexes remain unchanged; no index rebuild is needed for this change.

The writer first answers the actual question at an appropriate length, preserves
attributions, quantities, negations and corrections, and distinguishes source
facts from calculations. For drafts with more than six prose statements, a
relevance selector first retains whole statements needed for the requested facets
and evidence limits, dropping unrequested background and duplicate exposition.
It cannot rewrite a claim or cut away its negation or qualification. Table rows
and headings are preserved; the retained content still needs the full source
audit and coverage check. Invalid selections fail as availability errors. QA
traces retain the original draft, selected indices and focused draft separately.
The existing Deep Research auditor then checks atomic
premises. A verdict needs known source IDs, literal evidence and consistent
premises; a positive model judgement alone cannot approve invented quotes. Source
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
sentence must not permanently retire its true premises. Unsupported assertions
are removed; empty headings and broken table citation placement are cleaned up.
An additional coverage check catches supported but irrelevant background and
omitted requested facts. It can request one further repair, which is audited
again. An incomplete-coverage verdict is independently confirmed before acting:
each dismissed complaint needs an exact meaningful span of the verified answer;
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
