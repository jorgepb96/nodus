# Local embeddings in Nodus for Zotero

Validated on 2026-10-23 with Zotero 10.0.6 on macOS ARM64, using the packaged
XPI and disposable profiles. The user's profile and library were not opened.
All local inference was sequential: one model session at a time, individual
inputs, a maximum of four WASM threads and 512 tokens per input.

## Measured retrieval

The preregistered authored fixture contains 18 short scientific passages and
36 questions (18 Spanish, 18 English), including cross-language retrieval and
related distractors. Every question has one relevant passage. This is a small
controlled retrieval test, not a representative evaluation of full research
libraries or generated answers. The results do not establish significance or
accuracy on a user's collection. Ranking below is semantic-only cosine ranking.

| Model (Q8) | Correct first result | Recall@5 | MRR | Warm median | Warm p95 | Index 18 passages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| E5 small | 25/36 (69.4%) | 91.7% | .7910 | 28 ms | 32 ms | 1,009 ms |
| Granite 97M R2 | 29/36 (80.6%) | 100% | .9028 | 27 ms | 34 ms | 897 ms |
| Harrier 270M | 29/36 (80.6%) | 97.2% | .8678 | 389 ms | 768 ms | 7,242 ms |

All three reached Recall@10 of at least 97.2%. Cold queries including download
and initialization took 5.60 s, 5.47 s and 10.06 s respectively. Sampled resident
memory for the entire Zotero process was approximately 1,225 / 1,056 / 1,310 MiB;
these are not isolated model RAM measurements or continuously sampled peaks.
See [raw results](native-results.json) for contracts, per-query ranks, memory
caveats and fixture digest. Timing is one run, on this machine only.

Granite is the default for a new empty installation: it provided better first
results than E5 and matched Harrier's first-result accuracy at much lower
latency on this fixture. Existing cached libraries without a saved model choice
retain E5. Explicit choices persist. No automatic later model migration occurs.
Native Windows/Linux measurements and broader corpus validation remain pending.

## Integration and recovery

Settings → Context → Local semantic model offers all three models. Choose one
and press **Prepare and activate**. Only that model's weights are downloaded.
Preparation reuses extracted text, stages each cached document, and preserves
vectors for other model contracts in the binary cache. The active preference
changes only after all documents succeed. Stop cancels preparation and retains
the active model. Successfully completed documents can be reused on retry.
Concurrent chat is blocked during a switch; the existing index remains intact.
Normal semantic search loads only the active model. Workers expire after five
minutes idle. Cached models are available offline; the existing cache-clear
control removes document indexes, not downloaded weights.

Metadata and vectors are saved as a new file generation before the SQLite
pointer is updated. A failed write cannot replace half of the old pair.
Old generations are removed after publication; orphan generations are pruned
by the existing cache maintenance. Equal dimensions do not imply compatibility.

Harrier's upstream Q8 graph contains GatherBlockQuantized, which the packaged
WASM backend cannot execute. The bundled compatibility graph expands only that
operator into standard ONNX operations, dequantizing requested token rows. Q8
weights remain pinned upstream downloads. Native CPU comparison of the original
operator and the equivalent graph passes over 1,920 deterministic values.
See the packaged [notice and graph digest](../../zotero-plugin/content/models/NOTICE.md)
and [reproduction script](../../scripts/prepare-zotero-harrier-onnx.py).

## Reproduce

With the repository's npm dependencies installed:

```sh
node --test --test-concurrency=1 scripts/test-zotero-plugin.mjs
node --test --test-concurrency=1 scripts/test-zotero-harrier-graph.mjs
node scripts/build-zotero-xpi.mjs
node scripts/smoke-zotero-xpi.mjs --embedding-benchmark --keep-profile
node scripts/smoke-zotero-xpi.mjs --embedding-switch-smoke --keep-profile
```

Run these commands sequentially. The benchmark downloads each model into its
disposable Zotero profile. Native activation/reuse/cancellation checks use one
controlled index. The smoke runner also checks startup, evidence persistence,
encrypted credentials across restart, and normal shutdown. It fails if any
model benchmark fails or activation/reuse/cancellation proof is missing.

Validation completed: 103 plugin tests after merging main (including PR #1304), one operator parity test, real packaged
retrieval for all three models, and native activation/reuse/cancellation smoke.

Integration with #1304 also passes the packaged native smoke: per-item history
persists across restart and deletion, alongside embedding activation, binary
vector reuse, cancellation and credential lifecycle checks. The dedicated
Zotero workflow runs both plugin regressions and operator parity before XPI
packaging.
