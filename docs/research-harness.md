# Nodus Research Harness (v1 preview)

The academic vault can opt into a shared research execution across Research Chat,
Deep Research and Immersion. The existing `legacy` path remains the default.
Functional tests establish execution guarantees. The source-inspected Chat campaign
below provides additional case evidence, but does not establish universal accuracy
or a blind paired advantage over legacy. Promotion requires broader evaluation.

## Use and rollback

- Enable **Nodus Research Harness · Vista previa** in the research composer. The
  preference is saved as `researchHarnessVersion`; requests may explicitly select
  `harnessVersion: 'v1' | 'legacy'`.
- Chat keeps its context controls. Deep Research and Immersion expose an additional
  web switch in v1, initially **off**. Web does not enlarge the authorized library.
- Expand the execution panel to see questions, queued work, consumed steps and
  model calls. Pause/continue/cancel apply to that execution. After restarting the
  app, an execution without a live worker appears paused and can be continued.
- Turning the preview off routes new requests through legacy. Existing saved
  reports, sessions, conversations, citations and checkpoints remain readable.
- A source, notebook, model, effort, instruction or conversation change can prevent
  continuation. Start a new request using the current context in that case.

The preview only operates in the academic vault. Autonomous work stays inside the
current investigation; it cannot start independent reports, change filters, enable
disabled capabilities, write arbitrary files, execute commands or contact people.

## Execution model

`shared/researchHarness.ts` owns the serializable agenda and operational contracts.
`electron/ai/researchHarnessRuntime.ts` owns run identity, authorization validation,
model-call accounting, cancellation and completed semantic stages. A stage is reused
only inside its original request/context fingerprint. It stores application data,
not provider reasoning. Interrupted output is not a completed stage.

`ResearchCorpusRun` remains the evidence authority. The v1 coordinator sees the
enabled context layers, model/effort, source boundary, actual local and web excerpts,
unresolved questions, pending tasks and remaining allowance. It can search the
catalogue, retrieve indexed passages, read documents/originals, use granted web
access, enqueue complementary questions, defer unhelpful tasks and finish with a
reason. Actions use a closed schema and execute through backend permission checks.

Broad Research Chat questions now plan up to four complementary research lines,
each with its own question, source-language query, priority and purpose connecting
it to the user's objective. These are provisional facets, contextual questions,
contrasts or possible mechanisms, not findings. The model proposes questions;
query embeddings retrieve their evidence. Opening probes batch their embeddings
in order and leave a chunk and a round for later investigation. Pending lines
join the durable agenda; the supervisor can investigate, reprioritize or defer
them as evidence arrives. A focused query refinement keeps its task ID, question
and purpose; it cannot silently leave the original branch pending. Explicitly
deferring an optional branch does not prevent finishing an answered user objective.
The writer receives the agenda and must reconnect
useful findings to the original question, omitting adjacent material that does
not help answer it. Purpose is shown in the execution panel and never counts as
documentary support. Narrow facts, source-free turns, constructive exercises,
and disabled expansion do not open this branch queue. Indexed-only V1 can refine searches and queue relevant index queries within its grant; it cannot enable other layers.

The agenda deduplicates queries, prioritizes pending work and permits at most 32
questions and 64 tasks. Two actions without new evidence permit one strategy
change; continued stagnation ends research. Useful new evidence resets that
counter. Finish distinguishes sufficient evidence, exhausted sources, diminishing
returns, budget, interruption, context changes and technical failure. An agenda
assessment is operational state, **not** an independently verified quality score.

Retrieval rounds, evidence allowance and decision allowance belong to the entire
run. Evidence/decision text is conservatively counted in UTF-8 bytes, not estimated
monetary cost. Model requests are reserved durably before dispatch (32 for Chat,
256 for a report/session). Interrupted attempts keep consumed allowance; continuing
does not reset it. Discovery in long-form generators initially uses at most about
one third of the rounds, leaving room for section/station research. There is no
per-section budget reset. Context-window checks still apply to the complete provider
request. These limits are initial bounds and require calibration on real workloads.

## Grounding by surface

| Surface | v1 behavior |
| --- | --- |
| Research Chat | Keeps the turn planner, indexed-only policy, context switches, notebook/source restrictions, Concilium and skills. Ordinary prose receives bounded whole-answer review against source-bound premises, citation checks and a separate semantic veto. Changed prose must be reviewed again before publication. |
| Deep Research | Shares one ledger and budget through discovery and sections. Retains section coverage repair, claim audits and report consistency checks. Later web findings join section evidence and the audit ledger as web receipts, without fictitious local works. |
| Immersion | Retains curriculum/panorama/stations/contrasts/exam. Admits initial literal passages to the shared allowance and can investigate each station before writing. Prepared station inputs and completed generated phases survive continuation. Expository prose, positions and quiz explanations/expected answers are verified before saving. |

Source existence is not entailment. Verification requires an authorized ID, a
literal supporting quote and a valid premise verdict. Generated interpretations
can support attribution, not independent factual corroboration. Ordinary Chat prose is revised coherently instead of being reduced by deleting
individual sentences. If review cannot verify a useful answer within its bounds,
the result states that verification limitation. It must not turn a technical
review failure into a claim that the library contains no evidence. Visual blocks
remain opaque to the prose transformation.

Limits: semantic entailment still depends on the configured model; a successful
verdict is not a proof of truth. Multimodal attachments retain their existing
answer flow and record `visual_evidence_not_audited`, because a text-only auditor
cannot verify pixels. Plaintext attachments are explicit evidence and retain
filename/location citations instead of fabricated vault IDs. Chemistry keeps its
specialized verifier. Immersion's distractors and open questions are pedagogical
content: their explanations and expected answers are audited, but this preview
does not claim independent validation of every question's presuppositions or
false alternative. Tiny model windows and provider failures may yield incomplete
verification. These are evaluation cases, not grounds to silently skip checks.

## Persistence and API

Migration 202 creates the local `research_harness_runs` table. Its compact summary
is separate from the full checkpoint. Checkpoints contain the pinned request and
context, agenda, evidence receipts, traversal, used allowance, completed operations
and semantic phase results. They are local execution state, excluded from sync
allowlists. Deleting an owning conversation/report/session removes its checkpoints.
Saved academic reports and sessions carry optional `researchRun` metadata; old
archives require no conversion.

The local schema version is 202; the synchronization wire version stays 200.
This migration changes only a machine-bound table. Regression checks establish
that checkpoints enter neither sync packages, server publications nor mutation
outboxes, and that index-only v201 publications still reach a schema-200 peer.

The renderer API adds `listResearchRuns`, `getResearchRun`, `pauseResearchRun`,
`resumeResearchRun`, `cancelResearchRun` and `onResearchRun`. The MCP exposes
`nodus_list_research_runs` and `nodus_control_research_run` in academic vaults;
Deep Research requests accept `harnessVersion` and `webSearch`. Continuation uses
the same application services and shared Deep Research lane. Saving a resumed
report/session reuses its artifact identity instead of creating another copy.

## Verification

Run the focused functional checks with:

```sh
node --test scripts/test-research-harness.mjs scripts/test-research-harness-evaluation.mjs
node scripts/test-research-expansion.mjs
node --test scripts/test-research-actions.mjs scripts/test-research-corpus-run.mjs scripts/test-research-source-filters.mjs scripts/test-research-chat-agent.mjs
node --test scripts/test-research-claim-audit.mjs scripts/test-research-claim-audit-batching.mjs scripts/test-research-request-budget.mjs
node --test scripts/test-deep-research.mjs scripts/test-deep-research-quality.mjs scripts/test-deep-research-queue.mjs scripts/test-immersion.mjs scripts/test-ipc-contract.mjs
npm run typecheck
node scripts/verify-research-harness-ui.mjs
```

The harness fixtures use temporary databases, fake providers and no network. They
cover deduplication/priority, schema boundaries, forged evidence IDs, provenance,
web-informed scheduling, late web evidence, interrupted budget accounting,
completed-stage reuse, context revocation, ownership and deletion. The Electron UI
fixture checks opt-in/web controls, pause/continue, terminal state, console errors
and narrow/light/dark layouts. Screenshots are written under ignored
`artifacts/research-harness/`.

## Paired quality evaluation before rollout

Use the same objective, frozen scope/revisions, model, effort, language, retrieval
allowance and web setting for both versions. Include each of the three surfaces:
empty/sparse corpus, contradictory sources, several complementary questions,
indexed-only, notebook/filter restrictions, multilingual sources, attachments,
original reads, web off/on, local small-window models and interruption/restart.
Run both orders and repeat variable cases. Keep provider/model versions and the
original outputs with the measurements. Do not use fixtures as evidence of quality.

Review outputs blindly against a fixed question rubric. Record independently:
questions answered with support, factual claims supported, citation errors, model
calls, elapsed time and preference. Include useful depth, qualified disagreement,
false absence claims and truncated/incomplete results in the review. Token/currency
cost can be retained alongside the model-call count when actual provider usage is
available; model calls alone are only a cost proxy.

`scripts/compare-research-harness.mjs` compares offline paired reviews. It rejects
unmatched contexts and empty answers, reports quality and cost/latency deltas, and
does not change application settings:

```sh
node scripts/compare-research-harness.mjs /path/to/paired-review.json
```

Input is an array of `{caseId, legacy, v1, blindPreference?}`. Both run objects have
the following shape (these are field examples, not measured results):

```json
{
  "context": {
    "mode": "chat",
    "objective": "The exact research question",
    "scopeId": "frozen-scope-fingerprint",
    "model": { "provider": "configured-provider", "model": "exact-model" },
    "effort": "standard",
    "retrieval": { "rounds": 8, "evidenceTokens": 16000 },
    "web": false,
    "language": "es"
  },
  "metrics": {
    "requiredQuestions": 4,
    "answeredQuestions": 3,
    "claims": 10,
    "supportedClaims": 9,
    "citationErrors": 0,
    "modelCalls": 5,
    "elapsedMs": 30000
  }
}
```

`blindPreference` is `legacy`, `v1` or `tie`. A no-regression row is only a screening
result. Promote v1 only after reviewing all surfaces, real answer preference and
the observed latency/cost tradeoff. Until then the default stays legacy.

## Coherent answer verification

### Source-free turns and later lookup requests

Routing follows the current task rather than the topic words in the text. Clear
provided-text transformations, social turns and explicit source-free instructions
bypass planning and corpus-run construction; other generic explanations and ambiguous requests receive one bounded
semantic planning call. A no-search plan accepts empty queries and contributes
no authors, titles, source context, research agenda or citation-recovery retries.
Source-only instructions apply to documentary work, not to translating supplied
text. Editing preserves meaning, qualifications and existing reference targets.

Quoted/fenced text and transformation payloads cannot grant library/web access.
Mentioning Zotero or MCP is not itself a lookup request. A new explicit search
instruction overrides a mistaken no-search model decision and retains the
authorized conversation's topic, even after several edits. Conversely a previous
search does not force the next translation to research again. Missing source text
that must first be located remains documentary work; missing unspecified edit
input calls for clarification. Routing policy is part of the context fingerprint
so old decisions cannot be reused after the policy changes.

`test-research-turn-intent.mjs` covers lexical boundaries, while
`test-research-turn-routing.mjs` exercises three complete transition attempts,
authorized history, actual evidence admission and a single final writing call for
each direct translation. The explicitly paid `--phase=intent` campaign uses
synthetic conversations and the original per-provider authorization; it never
looks up corpus material or resets its spending ledger.

The final native routing campaign tests 22 synthetic situations three times with
DeepSeek: all 66 decisions match the expected route, with 51 planning calls and 15
deterministic decisions. It includes generic explanations, polite translation and
paraphrase, missing input, quoted tool commands, subsequent/accepted lookups,
locating text before translation, mixed edit/verification tasks, arithmetic,
proofreading, synonyms, factual correction versus spelling, and translation with
date updates. Earlier 48- and 57-decision campaigns are retained separately;
these are repeated cases, not distinct research questions or an accuracy guarantee.
Long inputs also retain their tail in the bounded planner context so a final
lookup instruction cannot disappear behind the text being edited.

### Verifying documentary answers

The review binds each factual clause to its own cited source. Local literal
excerpt keys are restored by the backend; a model cannot invent supporting
quotation text or use a citation ID as proof by itself. Paragraph deductions may
depend on earlier verified premises or paragraphs, never themselves or later
claims. Operational records establish searches, counts and scope, not historical
facts. Catalogue records establish identity and metadata, not a reading of the
work. Secondary references retain their mediation and editor credits do not
silently become chapter authorship.

The verifier receives uncited retrieved passages separately for coverage checks.
They may expose an omitted requested facet or refute a false evidence-gap claim,
but cannot justify a clause linked to a different passage. Whole-answer review
checks relationships as well as individual facts: shared vocabulary or a
bibliography entry cannot establish influence, consensus, disagreement or change
of theory. Section names and page locators must follow the actual excerpt.

Revision and citation repair have separate bounded allowances. A citation-only
repair may reuse an unchanged premise proof, with citation and semantic checks
still applied; any factual text change invalidates that reuse. One structural
recovery can correct malformed proof/action JSON using the original allowance.
Authorization and transport failures do not silently replay. Explicitly disabled
reasoning stays disabled; native reasoning reserves are applied only where the
selected model and effort permit them.

Chat answers use connected prose and inline Nodus citations by default. Headings
require an explicit user request. Positive catalogue examples link to their real
work records or passages; unrelated links do not satisfy missing references.
Unknown or ambiguous identities and zero-result searches never require fabricated
links. A unique adjacent literal quote can narrow a tagged page range; otherwise
the actual passage range is retained.

The coordinator reserves room for a complete evidence chunk in later research
steps, within the original shared allowance. This prevents useful related queries
from finding passages that cannot be admitted because a per-step allowance is
smaller than a prepared chunk. Retrieval success is recorded separately from
semantic support. Completion defers outstanding tasks and marks unanswered
questions unresolved rather than implying every branch was answered.

## Source-inspected validation

The final private campaign covers 25 declared Research Chat questions in two
rounds of 15 and 10, with targeted repeats after corrections. It covers false
premises and publications, catalogue counts/types, source filters, context layers,
indexed-only retrieval, multilingual literal quotations, author/editor roles,
causality, comparison, and explicit/default presentation. Native requests use
DeepSeek Flash directly and DeepSeek V4.1 Flash through eligible OpenRouter
endpoints. No provider privacy setting was weakened to obtain a model.

The selected final attempts all pass native review, resolve their citations,
close the agenda without pending/running states, and respect the requested
presentation. Every selected answer also has a current valid source-bound Gemini
review and a separate non-blind source inspection by the coding agent. Review
export includes complete catalogue operations so a missing export cannot be
mistaken for an invented count. Actual vector identities and semantic results
were checked; proxy transport must not accidentally change the identity of an
existing embedding index.

These are the latest attempts across recorded development revisions, not 25
fresh end-to-end runs on the final PR commit. An earlier paired prototype exposed
harmful sentence-deletion auditing; the coherent review and subsequent fixes
followed that result. The final campaign does not establish a blind accuracy rate
or quantify an overall advantage over legacy. Automated reviewers missed defects
subsequently found by source inspection. Five secondary Mistral reviews exhausted
output without valid JSON and are recorded as errors, never successful reviews.

The 25 selected runs average 63.8 seconds (median 52.4; range 20.4–197.1).
Cumulative consumption plus full uncertain reservations across all attempts is
USD 0.825485075 for DeepSeek, USD 0.755927158 for OpenRouter and USD 0.375065250 for
Google, within the authorized EUR 1 per API. BGE is excluded as requested. These
are conservative ledger totals including subsequent routing validation, not provider invoices. The original authorization,
failed attempts and uncertain reservations were retained. Temporary encrypted
credential copies were removed after the campaign. No raw answers, source
excerpts, vault identifiers, credentials or local reports are published here.

Long-tail latency, multimodal evidence and broader paired evaluation across Deep
Research and Immersion remain rollout considerations. V1 stays opt-in.

## Private campaign tooling

The paid runner requires an explicit source profile for a disposable SQLite
snapshot. The quality runner requires an existing isolated root with its marker,
passed through `--resume-root` or the local ignored authorization manifest. It
never substitutes another root for an existing authorization or resets its ledger.
Selected benchmark works resolve by exact title inside the snapshot; missing or
ambiguous titles fail instead of broadening the source filter. Credentials are
copied only for explicitly requested providers and never included in exports.

The macOS sandbox denies access to production Nodus/Zotero profiles, external
network and unlisted loopback ports. Only the reserving proxy can contact the
selected providers. Generation budgets are separate per provider, with BGE
accounted separately when excluded by the authorization. Failed and uncertain
calls retain their consumption or full reservation. Paid phases are sequential
so their active-case attribution cannot overlap.

The runners and offline reporters are:

- `scripts/research-harness-ab-live.mjs` for explicitly authorized paired,
  expansion or ablation campaigns over a frozen disposable snapshot.
- `scripts/research-harness-quality-live.mjs` for native 15/10 rounds, targeted
  corrections and independent source-bound review under one durable authorization.
- `scripts/summarize-research-quality.mjs` for a local HTML/JSON report with the
  latest attempt, model/revision, sources, operations, options, agenda, reviewer
  errors, inspection history and cumulative budgets per case.

Raw outputs and reports stay in ignored `artifacts/research-harness-ab/` and the
isolated root. The UI fixture uses synthetic content; screenshots stay under
ignored `artifacts/research-harness/`. Publishing source-backed evaluation content
requires separate review of the material intended for disclosure.

## UI examples

These screenshots use synthetic questions and execution events from the isolated
UI fixture, with no private research content.

![Harness controls and paused agenda in the light theme](images/research-harness-light.png)

![Harness controls and agenda at a narrow viewport](images/research-harness-narrow.png)
