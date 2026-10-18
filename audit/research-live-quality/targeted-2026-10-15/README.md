# Targeted follow-up: incomplete, no quality credit

Five previously inspected failure cases were selected before generation:
R005, R007, R009, R012 and R014. These are development regressions, not a new
holdout or a replacement for the closed eighty-case baseline. Three separately
qualified disposable profiles preserved the same forty-source scope and vectors.
The first admitted R005; only the four still-unattempted cases were transferred
to the two additional profiles. The original pending entries remain preserved.

| Case | Result | Accepted / completed / abandoned requests |
| --- | --- | --- |
| R005 | Protocol failure; no published answer | 17 / 16 / 1 |
| R007 | Protocol failure; no published answer | 11 / 9 / 2 |
| R012 | Protocol failure; no published answer | 3 / 2 / 1 |
| R009 | Not attempted | 0 / 0 / 0 |
| R014 | Not attempted | 0 / 0 / 0 |

All three segments closed with `completed=false`: 31 requests, 27 valid bridge
completions and four deadline abandonments. No case or completion was retried,
repaired, credited or silently substituted. No paid provider call was made.

The [diagnosis](failure-diagnosis.json) distinguishes transport loss from actual
product findings. Three abandoned requests have no read/raw record, so their
five-minute intervals cannot be attributed to a specific queue or generation
stage. R007's late raw result appeared over nine minutes after its deadline,
without a completion wrapper; it also retained one omitted facet. Earlier
R007 adequacy work had already found undercoverage. R005 lost final independent
coverage confirmation, and R012 did not finish documentary planning. These are
not three newly validated answers and not evidence that only transport remains
to be fixed. No global improvement percentage can be inferred.

The closed baseline remains 35/60 correct complete positives, 48/48 conditional
qualified-published fidelity and 13/20 correct absence handling. The useful-answer
and absence gates still fail. A reliable prospective generation path is required
before running another quality campaign; simply extending the deadline or
repeating these cases would not establish precision.

## Additional merged-runtime checks

The merged-source R009 replay reuses all eight exact recorded search decisions
and stops before new generation. It retains both Alba and Linde inside the
same conservative 32,768 window: initial bound 45,469, final bound 32,489.
The context size differs from the earlier revision and is recorded separately.
This verifies evidence delivery after integration, not a generated answer.

The first merged installer matcher assumed `napi-v3` beneath the new alias.
That was an incomplete check: ONNX 1.30 actually ships `napi-v6`. The corrected
tests inspect installed native files, and a fresh actual ASAR retains only its
macOS ARM64 slice. Both real Q8 profiles again pass offline inference/search.
The locally packaged app is 34,496 KiB smaller. The previous package's successful
inference receipt remains valid for that build; its alias foreign-slice pruning
claim is superseded by this correction.

The pinned ONNX 1.30 npm artifact contains no macOS Intel binding. EmbeddingGemma
is unavailable there with this dependency set; an Intel Nodus build is not
evidence of model support. Windows/Linux real-weight packages remain pending.

CI exposed an outdated canonical-ID batching fixture and an optional CUDA
download timeout. The fixture now verifies alias transport and canonical result
restoration while keeping its original bisection/cancellation assertions. CPU CI
skips optional CUDA installation; routing, coverage and deadlines are unchanged.
Thirteen focused tests and 29 workflow checks pass locally. The corrected CI
run is recorded as pending at report creation; later status belongs to its exact
Git revision. `closeout.json` binds the receipts, source revisions and limitations.
