# Experimental documentary answer verification

This change addresses demonstrated omissions and malformed tables without changing
embedding vectors, contracts, scores or default models. The new chain remains off
by default. Native Research Chat exposes **Verify sources** as an experimental
option; additional provider calls and latency are disclosed in its tooltip.

## Behavior

The application first selects one to six literal question facets and original
source excerpts. Stable facet IDs become a minimum checklist for drafting and
repair. The plan's `excerptPremises: none` means that it selected no excerpt premise,
not that the requested fact is unavailable. Supplied metadata can establish attribution
to the document record, including a facet found only by independent coverage review;
it cannot establish world facts or corroboration. Planning is not evidence approval:
the existing atomic prose auditor checks
the rendered answer against the same frozen sources. Independent full-question
coverage proof must account for each planned facet. It can also identify a facet
that the planner omitted; a bounded repair receives the expanded checklist and
must pass a fresh prose audit and coverage proof. Unknown transport or budget
failures never approve an answer or trigger a model substitution.

The writer returns structured table cells. The renderer checks bounded dimensions,
equal widths, safe controls and citation destinations before constructing Markdown.
After factual filtering, a requested table must still have its header, separator
and at least one data row. Derived calculations and interpretations may remain in
separate, explicitly labelled prose. Table facet IDs alone do not establish that
the requested comparison is complete; source review must assess that content.

Answers are withheld during verification. Cancellation discards provisional prose;
notebook scope is checked again before authorizing history reuse. Skills, attachment
and council paths retain their existing behavior. This option verifies the native
documentary path; it does not claim to verify those other paths.

## Local verification

`grounding.log` records 25 passing test entries, including the existing 38-case
inner grounding suite. Additional regressions cover literal facet/evidence proof,
an omitted planner facet, bounded repair, invented coverage spans, malformed table
widths, default-off settings and real chat cancellation with a network-denying
provider double. Metadata-only attribution is accepted only after audit; a world
fact based on metadata is rejected and repaired. `retrieval.log` records five
passing test files, including 18 synthesis-context cases, using the actual
documentary retrieval worker and frozen deterministic fixtures.

`lint.log`, `typecheck.log` and `build.log` record successful verification on this
macOS ARM64 checkout. `ui-smoke.json` records a real Electron run under the isolated
OS policy: every recorded database open is in the QA profile, outside writes
and network are denied, three synthetic library sources are created and a scoped
text passage is prepared, excluded citations
are revoked, original PDF pages open, and the verification toggle persists its
off/structured/off changes through the production settings API. No embedding runtime
is loaded in this smoke, so preparation can remain lexical/incomplete. Compiled Electron
bundle hashes and runtime versions are recorded, with an unchanged-build check at exit. Zero model calls
were made in that UI run. It is not a generated-answer quality measurement.

```sh
npm run test:research:grounding
npm run test:research:retrieval
npm run test:research:openrouter
npm run audit:research:openrouter               # dry run, no provider calls
# OpenRouter dispatch is stopped by the recorded user instruction.
node scripts/collect-research-openrouter.mjs
node scripts/e2e-research-isolated.mjs --notebooks --verification --pdf --activity
npm run test:research:luna
npm run audit:research:luna                    # fixed-plan dry run
```

## Quality and cost

The separate OpenRouter campaign is limited to USD 0.50 total, including failed
preflights and unknown usage reservations. The original USD 8 DeepSeek campaign
remains closed. Fixed Mistral Small 3.2 / DeepInfra FP8 routing uses ZDR, denies data
collection and fallbacks, and caps input/output rates at USD 0.075/0.20 per million.
Public catalog and ZDR endpoint metadata are checked before dispatch. The provider
may not substitute a different model or endpoint.

Both production verification paths receive the identical original frozen evidence
for 60 cases, with counterbalanced order. Expected answers and reviewer annotations
never enter provider context. This controlled generation comparison does not rerun
retrieval, extraction, multilingual embeddings or the application citation dialogs.
It is a repeated directed regression, not an untouched holdout or population score.
Independent source inspection is required; automatic auditor approval is not the
quality score. Interrupted attempts and failures are retained in the sibling
`research-openrouter-*-attempt` and `research-openrouter-*-preflight` directories,
and in `../research-openrouter-keychain-startup/`; the authorization record references
every cost-bearing attempt. A completed new `../research-openrouter/` campaign does not yet exist.
No embedding profile is promoted by this report. Quality acceptance remains pending.

After integrating `main` at merge commit `ca5caa4d`, the regenerated Electron 43.6.0 runtime passes the isolated UI flow. Native strict schema requests for OpenAI/OpenRouter are verified by a loopback-only production-transport regression; a 400 cannot silently strip the schema. Schema identity enters request hashing only when opted in, and schema bytes enter context admission before any HTTP request. Upstream failures pause the QA proxy on the first response and retain all unresolved reservations. Sanitized upstream errors are also used for caller responses so persisted campaign errors cannot retain raw credential or prompt echoes.

The Linux CI run for `91945f4c` failed four tests whose fixtures retained earlier
publication/API assumptions. The fixes explicitly exercise legacy verified
cancellation and consensus, intercept `embedQuery`, and check early retrieval
on the authorized corpus path; an unscoped local-model request deliberately waits
for the full gather to size its exact context. Their expectations were preserved
and all four pass locally. They now belong to the focused commands above. The
full CI result for the new commit must be assessed independently.

The additional `local-runtime/` records exercise the real Q8 CPU worker under
network/write isolation with separate 512- and 256-dimensional profiles. Worker
startup took 2.21/0.87 seconds; five warm query calls ranged 62–98/63–80 ms. Pinned
asset and worker/source hashes are retained. These are native Node worker smokes,
not current packaged Electron proofs or 10,000-chunk product latency measurements.
They do not establish retrieval or factual-answer accuracy or promote a profile.

The OpenRouter comparison is not complete. The first availability attempt retained 33 reservations (USD 0.09076114), with repeated upstream 429 responses; a prior Qwen ZDR refusal retained USD 0.00211523. The integrated Electron 43.6.0 launch then blocked inside the macOS Keychain before any model request. A native process sample establishes that wait; it does not establish a bad credential. Isolated startup already skips legacy-key recovery; neither a recovery scan nor a plaintext credential workaround was used. The authorized encrypted QA copy was removed after shutdown. The cumulative additional committed upper bound is USD 0.09287637 of USD 0.50; USD 0.40712363 remains. The production corrections are verified offline, but no new factual-answer accuracy rate or 95% acceptance is claimed.

After the user confirmed accepting the macOS prompt, the next retained attempt
(`../research-openrouter-credential-unavailable/`) launched successfully but the
production reader reported no available OpenRouter credential before preflight.
It made zero provider calls and committed USD 0. Availability, decryption identity
and credential validity must not be conflated.
The subsequent `../research-openrouter-deferred-credential-timeout/` attempt
opened the QA window, but its explicit encrypted reader remained in the native
Keychain wait. It made zero provider calls and committed USD 0. The owned process
was stopped and its encrypted copy removed. On the user's instruction, further
credential access is now stopped in the durable authorization record; budget
claiming rejects new attempts before any credential import. No further native
credential diagnostics or prompts are authorized by this campaign.

`qa-credential-guards/` records 18 passing offline guard tests, typecheck, lint,
the production build and another isolated real Electron UI run (15 guarded
database opens, zero model calls). Delayed credential metadata is an explicit
QA-only opt-in checked against the isolation manifest; actual key reads retain
the ordinary encrypted reader. Ordinary profiles do not defer metadata.

CI for `72a47e75` passed full Linux coverage and native macOS/Windows checks in
[run 38272033596](https://github.com/jorgepb96/nodus/actions/runs/38272033596).
Windows initially timed out waiting for a Presenter PDF preview; the exact job
passed on rerun without changing its deadline or assertions. These results do
not cover subsequent uncommitted harness/credential-guard changes.

The distinct Luna campaign uses real fresh `gpt-6-luna` agents through a local
file-queue custom provider, with an empty isolated key file disabling OS Safe
Storage. Nodus makes no HTTP requests to paid provider APIs; agent inference
uses the ordinary Codex service and allowance, whose usage is not independently
priced by this harness. It is not local CPU inference, an OpenRouter model, or
an offline generation test. The first `../research-luna-bridge-probe/` attempt
was stopped after missing completion receipts exposed a transport problem.
Its incomplete answers and diagnostics are retained; they establish no quality
acceptance. The fixed ten-case, twenty-answer plan is a directed regression,
with the same frozen source evidence for both arms, not an untouched holdout.

The next retained run, `../research-luna-facet-id-failure/`, completed all ten
accepted calls but withheld its structured answer. Two actual coverage proofs
copied all three planned question quotes and literal answer spans while omitting
their routing IDs: the request required IDs but its final shape example omitted
them. `facet-routing/` records the correction and replay of both captured proofs.
Only absent IDs can bind to unique exact frozen question quotes; explicit wrong
IDs, paraphrased questions, duplicate or omitted facets and forged answer quotes
still fail the original guards. Raw proofs and application bindings are separate
trace fields. This fixes a measured availability problem without changing vectors
or weakening source validation.

`../research-luna-directed/` retains the current paired generation run. The first
four attempts and their 30 completed receipts are preserved, including a baseline
JSON-format failure; the remaining sixteen are continued once in the same
isolated root with a cumulative 150-request ceiling. A completed receipt-backed
verification refusal is a negative measured outcome. Transport failure, missing
receipts, cancellation or changed runtime sources pause acceptance. The fixed
eight-positive/two-absence denominators include every failed answer; a baseline
failure does not veto a passing structured arm. Hash-bound source review is still
pending for the complete campaign, and no new acceptance rate is claimed here.
The collector uses exact full URL tokens for blinded source links, preventing
numeric prefix collisions without changing generated answers.
