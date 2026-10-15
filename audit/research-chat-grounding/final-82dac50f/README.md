# Research Chat accuracy regression campaign

Acceptance is not complete; no profile is promoted to validated.

Acceptance evaluation. Executed 113/120 planned cases; independently source-reviewed 106 published answers and triaged 7 failures. Factual support **and answer adequacy**: pending. Insufficient-evidence recognition with faithful wording: pending. Citation resolution: 100.0% (113 captured links). Errors and unavailable answers count as failures, never correct refusals.

All **113 captured cases** have a bound source review or failure triage. The complete-campaign rates above remain unset because seven cases were budget-stopped. Observed executed-case counts are **61/77 positive** (79.2%) and **35/36 absence** (97.2%); these are partial regression observations, not acceptance rates or estimates for arbitrary documents. Only three positive cases remain, so even perfect pending answers could reach at most **64/80**, below the 95% gate. `allReviewed=false` in the collector denotes the unmet complete-120-case gate, not unreviewed captured answers.

| Profile | Positive pass/executed | Absence pass/executed | Pending |
| --- | ---: | ---: | ---: |
| EmbeddingGemma Q8 512 | 11/16 | 8/8 | 0 |
| E5 Small INT8 | 15/16 | 8/8 | 0 |
| GTE Multilingual Base INT8 | 13/16 | 7/8 | 0 |
| BGE-M3 Q8 | 13/16 | 8/8 | 0 |
| EmbeddingGemma Q8 256 | 9/13 | 4/4 | 7 |

The [analysis](analysis.json) separates eight requested-facet omissions, one unsupported published assertion, one requested-table formatting failure, four invalid verification proofs, two other unavailable verifications and one budget-blocked request. The budget failure's UI said invalid key, while the proxy records `research_budget_exhausted`; the credential is not diagnosed as invalid. Unavailable answers remain failures. Seventy of 71 published positive answers have faithful facts, but that narrower denominator excludes six unavailable positives and does not establish adequate answers or the acceptance gate.

The questions were already attempted before the latest fixes. This is a repeated regression sample, not a fresh blinded holdout or an estimate for arbitrary user documents. The original directed review (19/42 supported factual answers) is retained separately and uses a different sample.

Measured revision: 82dac50f. Candidate matches measured runtime: **true**. Subsequent fixes need another paid application run; unit tests do not establish the quality thresholds.

Review records bind to exact answer and cited-source SHA-256 values. Codex inspected source evidence independently of the application's own model judgement; no external human review is claimed. Reports retain literal sources, semantic retrieval selection, contracts, drafts, verdicts, repairs, coverage checks, resolved citations, UI screenshots and failed earlier attempts.

The shared campaign ledger records an accounted upper bound of USD 7.8207 for calls with known usage and USD 7.9559 including unresolved reservations, within its USD 8 global limit. This is proxy accounting, not a provider billing invoice. Embeddings run locally; the generative provider is direct DeepSeek Flash. Source versions and actual request settings are in each profile report.

The [closure record](../cost/closed-campaign.json) preserves all 6,336 original-campaign calls and all six unknown reservations. All QA processes/proxies closed and no further paid run is started. The proxy conservatively refused the next maximum-cost reservation before the ledger could exceed USD 8; unused headroom is not a budget reset.

Successful-trace verification p50 ranges from 7.7–11.6 seconds; per-profile p95 ranges from 19.2–40.5 seconds. Whole-request p50 is 22.2–30.1 seconds and p95 43.2–63.8 seconds, including planning, retrieval and generation. [Per-stage timings and exact sample counts](analysis.json) separate source redrafting, audits and coverage/repair; failed traces without explicit timings are not imputed. These figures are not local embedding/search latency. Reproduce this derived analysis with `node analysis-generator.cjs .` from this directory; the archived profile reports are its input.

Generic grounding rules do not change vector contracts or require rebuilding indexes. Verification adds generative calls and latency; its stage timings are distinct from local embedding/search latency. Creative exercises, skills and direct multimodal attachment paths retain their existing behaviour. See [implementation notes](../../../docs/research-chat-grounding.md). Native EmbeddingGemma execution on Windows, Linux and macOS Intel remains pending.
