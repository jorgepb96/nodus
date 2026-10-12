# Experimental documentary answer verification

This change addresses demonstrated omissions and malformed tables without changing
embedding vectors, contracts, scores or default models. The new chain remains off
by default. Native Research Chat exposes **Verify sources** as an experimental
option; additional provider calls and latency are disclosed in its tooltip.

## Behavior

The application first selects one to six literal question facets and original
source excerpts. Stable facet IDs become a minimum checklist for drafting and
repair. Planning is not evidence approval: the existing atomic prose auditor checks
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

`grounding.log` records 23 passing test entries, including the existing 38-case
inner grounding suite. Additional regressions cover literal facet/evidence proof,
an omitted planner facet, bounded repair, invented coverage spans, malformed table
widths, default-off settings and real chat cancellation with a network-denying
provider double. `retrieval.log` records 17 passing entries using the actual
documentary retrieval worker and frozen deterministic fixtures.

`lint.log`, `typecheck.log` and `build.log` record successful verification on this
macOS ARM64 checkout. `ui-smoke.json` records a real Electron run under the isolated
OS policy: all nine initial database opens are in the QA profile, outside writes
and network are denied, three synthetic sources are prepared, excluded citations
are revoked, original PDF pages open, and the verification toggle persists its
off/structured/off changes through the production settings API. Zero model calls
were made in that UI run. It is not a generated-answer quality measurement.

```sh
npm run test:research:grounding
npm run test:research:retrieval
npm run test:research:openrouter
npm run audit:research:openrouter               # dry run, no provider calls
npm run audit:research:openrouter -- --run-paid # requires remaining authorization
node scripts/collect-research-openrouter.mjs
node scripts/e2e-research-isolated.mjs --notebooks --verification --pdf --activity
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
quality score. Results and failures are retained in `../research-openrouter/`.
No embedding profile is promoted by this report. Quality acceptance remains pending.

After integrating `main` at merge commit `ca5caa4d`, the regenerated Electron 43.6.0 runtime passes the same isolated UI flow and the 23-entry grounding / 17-entry retrieval groups. Native strict schema requests for OpenAI/OpenRouter are verified by a loopback-only production-transport regression; a 400 cannot silently strip the schema. Upstream failures pause the QA proxy on the first response and retain all unresolved reservations.

The OpenRouter comparison is not complete. The first availability attempt retained 33 reservations (USD 0.09076114), with repeated upstream 429 responses; a prior Qwen ZDR refusal retained USD 0.00211523. The integrated Electron 43.6.0 launch then blocked inside the macOS Keychain before any model request. A native process sample establishes that wait; it does not establish a bad credential. The authorized encrypted QA copy was removed after shutdown. The cumulative additional committed upper bound is USD 0.09287637 of USD 0.50; USD 0.40712363 remains. The two production corrections are verified offline, but no new factual-answer accuracy rate or 95% acceptance is claimed.
