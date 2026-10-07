# Documentary Research Chat verification

Research Chat checks documentary prose against the literal passages authorized
for that turn before publishing it. This happens after retrieval and applies to
any embedding provider. Embedding defaults, vector preparation, contracts and
existing indexes remain unchanged; no index rebuild is needed for this change.

The writer first answers the actual question at an appropriate length, preserves
attributions, quantities, negations and corrections, and distinguishes source
facts from calculations. The existing Deep Research auditor then checks atomic
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
again. If no substantive supported answer remains, the response states that
evidence is insufficient. If verification is unavailable or an answer still
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
npm run audit:research:grounding -- --stage=evaluation
```

The paid UI campaign requires the completed disposable product roots recorded in
`audit/embeddinggemma-2/campaign.json`. It never opens or imports a real profile or
vault. Each model reuses only its own isolated corpus/index/profile. All paid
calls go through the original shared DeepSeek Flash proxy, with two concurrent
calls and the original global USD 5 budget; running another stage does not reset
the ledger. The runner refuses missing or mismatched completed product fixtures.

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

`completed` reports execution completion only. Releasing a validated embedding
profile still requires its retrieval, quality, isolation, performance and native
packaging gates. Preserve the original failed campaign as a baseline alongside
any subsequent improvement report.
